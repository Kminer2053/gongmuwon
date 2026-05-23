from __future__ import annotations

import json
import sys
import time
import types
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from gongmu_sidecar.app import create_app
from gongmu_sidecar.db import now_iso
from gongmu_sidecar.document_parsers import parse_document
from gongmu_sidecar.embeddings import EmbeddingResult


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_graphrag_schema_tables_exist(tmp_path: Path) -> None:
    client = _client(tmp_path)
    db = client.app.state.services.db
    tables = {
        row["name"]
        for row in db.connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }

    assert "knowledge_ingestion_jobs" in tables
    assert "knowledge_documents" in tables
    assert "knowledge_document_sections" in tables
    assert "knowledge_document_chunks" in tables
    assert "knowledge_table_blocks" in tables
    assert "knowledge_graph_nodes" in tables
    assert "knowledge_graph_edges" in tables


def test_markdown_parser_preserves_sections_and_tables(tmp_path: Path) -> None:
    source = tmp_path / "plan.md"
    source.write_text(
        "# 사업계획\n\n"
        "문서번호: ABC-123\n\n"
        "## 추진배경\n\n"
        "지역 사업의 추진배경입니다.\n\n"
        "## 세부추진계획\n\n"
        "| 항목 | 예산 | 비고 |\n"
        "| --- | --- | --- |\n"
        "| 사업 A | 100 | 신규 |\n",
        encoding="utf-8",
    )

    document = parse_document(source)

    assert document.title == "사업계획"
    assert document.metadata["document_number"] == "ABC-123"
    assert [section.heading for section in document.sections] == ["사업계획", "추진배경", "세부추진계획"]
    assert document.sections[2].tables[0].headers == ["항목", "예산", "비고"]
    assert document.sections[2].tables[0].rows == [["사업 A", "100", "신규"]]


def test_docx_parser_preserves_heading_paragraphs_and_tables(tmp_path: Path) -> None:
    source = tmp_path / "plan.docx"
    document_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r><w:t>사업계획</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>추진배경</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>민원 처리 시간을 줄이기 위한 계획이다.</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>예산</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>시스템 개선</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>100</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>
"""
    with ZipFile(source, "w", ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", document_xml)

    document = parse_document(source)

    assert document.parser_name == "gongmu-docx"
    assert document.title == "사업계획"
    assert [section.heading for section in document.sections] == ["사업계획", "추진배경"]
    assert document.sections[1].paragraphs == ["민원 처리 시간을 줄이기 위한 계획이다."]
    assert document.sections[1].tables[0].headers == ["항목", "예산"]
    assert document.sections[1].tables[0].rows == [["시스템 개선", "100"]]


def test_xlsx_parser_preserves_sheet_as_structured_table(tmp_path: Path) -> None:
    source = tmp_path / "budget.xlsx"
    shared_strings = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>항목</t></si>
  <si><t>예산</t></si>
  <si><t>시스템 개선</t></si>
  <si><t>100</t></si>
</sst>
"""
    sheet_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2" t="s"><v>3</v></c>
    </row>
  </sheetData>
</worksheet>
"""
    with ZipFile(source, "w", ZIP_DEFLATED) as archive:
        archive.writestr("xl/sharedStrings.xml", shared_strings)
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)

    document = parse_document(source)

    assert document.parser_name == "gongmu-xlsx"
    assert document.title == "budget"
    assert document.sections[0].heading == "sheet1"
    assert document.sections[0].tables[0].headers == ["항목", "예산"]
    assert document.sections[0].tables[0].rows == [["시스템 개선", "100"]]


def test_pptx_parser_preserves_slides_as_sections(tmp_path: Path) -> None:
    source = tmp_path / "briefing.pptx"
    slide_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp><p:txBody><a:p><a:r><a:t>보고 제목</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:txBody><a:p><a:r><a:t>핵심 추진 내용</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>
"""
    with ZipFile(source, "w", ZIP_DEFLATED) as archive:
        archive.writestr("ppt/slides/slide1.xml", slide_xml)

    document = parse_document(source)

    assert document.parser_name == "gongmu-pptx"
    assert document.title == "보고 제목"
    assert document.sections[0].heading == "보고 제목"
    assert document.sections[0].paragraphs == ["핵심 추진 내용"]


def test_hwpx_xml_fallback_preserves_paragraphs_and_tables(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("GONGMU_NODE_EXE", str(tmp_path / "missing-node.exe"))
    source = tmp_path / "plan.hwpx"
    section_xml = """<?xml version="1.0" encoding="UTF-8"?>
<hp:section xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run><hp:t>사업계획</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>추진배경 본문</hp:t></hp:run></hp:p>
  <hp:tbl>
    <hp:tr>
      <hp:tc><hp:p><hp:run><hp:t>항목</hp:t></hp:run></hp:p></hp:tc>
      <hp:tc><hp:p><hp:run><hp:t>예산</hp:t></hp:run></hp:p></hp:tc>
    </hp:tr>
    <hp:tr>
      <hp:tc><hp:p><hp:run><hp:t>민원 자동화</hp:t></hp:run></hp:p></hp:tc>
      <hp:tc><hp:p><hp:run><hp:t>100</hp:t></hp:run></hp:p></hp:tc>
    </hp:tr>
  </hp:tbl>
</hp:section>
"""
    with ZipFile(source, "w", ZIP_DEFLATED) as archive:
        archive.writestr("Contents/section0.xml", section_xml)

    document = parse_document(source)

    assert document.parser_name == "gongmu-hwpx-xml"
    assert document.title == "사업계획"
    assert document.sections[0].heading == "사업계획"
    assert document.sections[0].paragraphs == ["추진배경 본문"]
    assert document.sections[0].tables[0].headers == ["항목", "예산"]
    assert document.sections[0].tables[0].rows == [["민원 자동화", "100"]]
    assert document.partial is False


def test_ingest_source_creates_job_document_chunks_and_tables(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "plan.md").write_text(
        "# 사업계획\n\n"
        "## 추진배경\n\n"
        "지역 사업의 추진배경입니다.\n\n"
        "## 세부추진계획\n\n"
        "| 항목 | 예산 |\n"
        "| --- | --- |\n"
        "| 사업 A | 100 |\n",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "업무자료", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    ingest = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})

    assert ingest.status_code == 201
    job = ingest.json()["job"]
    assert job["status"] == "completed"
    assert job["queued_count"] == 1
    assert job["processed_count"] == 1
    assert job["failed_count"] == 0

    chunks = client.get("/api/knowledge/chunks")
    assert chunks.status_code == 200
    assert any("추진배경" in item["text"] for item in chunks.json()["items"])

    tables = client.get("/api/knowledge/tables")
    assert tables.status_code == 200
    assert tables.json()["items"][0]["headers"] == ["항목", "예산"]


def test_ingest_source_splits_large_single_section_into_multiple_chunks(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    long_body = " ".join(["prompt strategy instruction design"] * 900)
    (source / "prompt-guide.md").write_text(
        f"# Prompt Guide\n\n{long_body}",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    ingest = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})

    assert ingest.status_code == 201
    chunks = client.get("/api/knowledge/chunks")
    assert chunks.status_code == 200
    items = chunks.json()["items"]
    assert len(items) >= 3
    assert all(len(item["text"]) <= 4300 for item in items)


def test_ingest_source_rescans_folder_before_building_job(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    (source / "new-plan.md").write_text("# New Plan\n\n## Summary\n\nFreshly added content.", encoding="utf-8")

    ingest = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})

    assert ingest.status_code == 201
    job = ingest.json()["job"]
    assert job["queued_count"] == 1
    assert job["processed_count"] == 1
    files = client.get(f"/api/knowledge/source-files?source_id={source_id}").json()["items"]
    assert files[0]["relative_path"] == "new-plan.md"
    assert files[0]["status"] == "indexed"


def test_active_ingestion_blocks_source_mutation_and_new_index_jobs(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "plan.md").write_text("# Plan\n\nPrompt strategy memo.", encoding="utf-8")
    other_source = tmp_path / "other-source"
    other_source.mkdir()

    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    queued = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": False})

    assert queued.status_code == 201
    assert queued.json()["job"]["status"] == "queued"

    blocked_create = client.post(
        "/api/knowledge/sources",
        json={"label": "other", "root_path": str(other_source)},
    )
    blocked_scan = client.post(f"/api/knowledge/sources/{source_id}/scan")
    blocked_reindex = client.post("/api/knowledge/reindex", json={"source_id": source_id, "run_now": True})

    assert blocked_create.status_code == 409
    assert blocked_scan.status_code == 409
    assert blocked_reindex.status_code == 409
    assert "GraphRAG ingestion" in blocked_create.json()["detail"]


def test_create_app_recovers_interrupted_running_ingestion_jobs(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "plan.md").write_text("# Plan\n\nPrompt strategy memo.", encoding="utf-8")

    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    queued = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": False})
    job_id = queued.json()["job"]["id"]
    db = client.app.state.services.db
    db.execute(
        """
        UPDATE knowledge_ingestion_jobs
        SET status = ?, current_stage = ?, progress_percent = ?, processed_count = ?
        WHERE id = ?
        """,
        ("running", "embed", 85, 14, job_id),
    )

    restarted_client = _client(tmp_path)

    jobs = restarted_client.get("/api/knowledge/ingestion-jobs")
    assert jobs.status_code == 200
    recovered = jobs.json()["items"][0]
    assert recovered["id"] == job_id
    assert recovered["status"] == "canceled"
    assert recovered["cancel_requested"] == 1
    assert "sidecar restarted" in recovered["error_message"]
    assert restarted_client.post("/api/knowledge/reindex", json={"source_id": source_id, "run_now": False}).status_code == 201


def test_cancel_running_job_without_active_worker_marks_canceled(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "plan.md").write_text("# Plan\n\nPrompt strategy memo.", encoding="utf-8")

    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    queued = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": False})
    job_id = queued.json()["job"]["id"]
    client.app.state.services.db.execute(
        """
        UPDATE knowledge_ingestion_jobs
        SET status = ?, current_stage = ?, progress_percent = ?
        WHERE id = ?
        """,
        ("running", "embed", 85, job_id),
    )

    canceled = client.post(f"/api/knowledge/ingestion-jobs/{job_id}/cancel")

    assert canceled.status_code == 200
    job = canceled.json()["job"]
    assert job["status"] == "canceled"
    assert job["cancel_requested"] == 1
    assert "worker is not active" in job["error_message"]


def test_ingest_source_removes_deleted_file_documents_and_chunks(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    obsolete = source / "obsolete.md"
    obsolete.write_text("# Obsolete Plan\n\nRetired procurement keyword.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201
    assert client.get("/api/knowledge/documents").json()["items"][0]["title"] == "Obsolete Plan"

    obsolete.unlink()
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    ingest = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})

    assert ingest.status_code == 201
    assert ingest.json()["job"]["deleted_document_count"] == 1
    assert client.get("/api/knowledge/documents").json()["items"] == []
    retrieve = client.post("/api/knowledge/retrieve", json={"query": "procurement", "limit": 5})
    assert retrieve.status_code == 200
    assert retrieve.json()["items"] == []


def test_list_knowledge_documents_exposes_extraction_status(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "plan.md").write_text(
        "# 사업계획\n\n"
        "## 세부추진계획\n\n"
        "| 항목 | 예산 |\n"
        "| --- | --- |\n"
        "| 시스템 개선 | 100 |\n",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    response = client.get("/api/knowledge/documents")

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["title"] == "사업계획"
    assert item["parser_name"] == "gongmu-markdown"
    assert item["quality_score"] > 0.8
    assert item["partial"] is False
    assert item["section_count"] == 2
    assert item["table_count"] == 1


def test_parser_extracts_readable_korean_public_metadata(tmp_path: Path) -> None:
    source = tmp_path / "public-metadata.md"
    source.write_text(
        "# 민원 자동화 계획\n\n"
        "문서번호: GOV-2026-001\n"
        "발신: 디지털정책과\n"
        "수신: 총무과\n"
        "시행일자: 2026-05-06\n"
        "보안등급: 내부\n\n"
        "## 추진내용\n\n"
        "민원 처리 자동화 추진계획입니다.",
        encoding="utf-8",
    )

    document = parse_document(source)

    assert document.metadata["document_number"] == "GOV-2026-001"
    assert document.metadata["sender_org"] == "디지털정책과"
    assert document.metadata["receiver_org"] == "총무과"
    assert document.metadata["issued_date"] == "2026-05-06"
    assert document.metadata["security_level"] == "내부"


def test_ingest_stores_extraction_quality_report(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "quality.md").write_text(
        "# 민원 자동화 계획\n\n"
        "문서번호: GOV-2026-001\n\n"
        "## 추진내용\n\n"
        "민원 처리 자동화 추진계획입니다.\n\n"
        "| 항목 | 예산 |\n"
        "| --- | --- |\n"
        "| 시스템 개선 | 100 |\n",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    document = client.get("/api/knowledge/documents").json()["items"][0]
    quality = document["metadata"]["extraction_quality"]
    assert quality["parser_name"] == "gongmu-markdown"
    assert quality["section_count"] == 2
    assert quality["table_count"] == 1
    assert quality["text_char_count"] > 20
    assert quality["warnings"] == []
    assert document["quality_score"] >= 0.85


def test_ingest_creates_table_specific_retrieval_chunk(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "budget.md").write_text(
        "# 예산 검토\n\n"
        "## 세부 예산\n\n"
        "| 항목 | 예산 | 비고 |\n"
        "| --- | --- | --- |\n"
        "| 민원 자동화 | 100 | 신규 |\n",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    chunks = client.get("/api/knowledge/chunks").json()["items"]
    table_chunks = [chunk for chunk in chunks if chunk["text"].startswith("표: 세부 예산")]
    assert table_chunks
    assert "민원 자동화 | 100 | 신규" in table_chunks[0]["text"]


def test_public_document_fixture_preserves_quality_and_ontology(tmp_path: Path) -> None:
    source = Path(__file__).parent / "fixtures" / "public_docs"
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "public docs", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    documents = client.get("/api/knowledge/documents").json()["items"]
    official = next(item for item in documents if item["title"] == "민원 자동화 개선 시행계획")
    low_quality = next(item for item in documents if item["title"] == "low-quality-scan")
    official_quality = official["metadata"]["extraction_quality"]
    low_quality_report = low_quality["metadata"]["extraction_quality"]
    assert official["document_number"] == "GOV-2026-001"
    assert official["quality_score"] >= 0.9
    assert official_quality["table_count"] == 1
    assert official_quality["warnings"] == []
    assert "low_text" in low_quality_report["warnings"]

    nodes = {
        (row["node_type"], row["label"])
        for row in client.app.state.services.db.fetch_all("SELECT node_type, label FROM knowledge_graph_nodes")
    }
    assert ("Policy", "개인정보보호법") in nodes
    assert ("Task", "상담 이력 자동 요약") in nodes
    assert ("Person", "홍길동") in nodes
    assert ("Department", "총무과") in nodes

    retrieve = client.post("/api/knowledge/retrieve", json={"query": "개인정보보호법", "limit": 3})
    assert retrieve.status_code == 200
    first = retrieve.json()["items"][0]
    assert first["document"]["title"] == "민원 자동화 개선 시행계획"
    assert first["score_breakdown"]["graph_score"] > 0


def test_one_page_report_fixture_preserves_budget_period_and_table_entities(tmp_path: Path) -> None:
    source = Path(__file__).parent / "fixtures" / "public_docs"
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "public docs", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    documents = client.get("/api/knowledge/documents").json()["items"]
    report = next(item for item in documents if item["title"] == "민원 자동화 1페이지 보고서")
    assert report["document_number"] == "GOV-2026-002"
    assert report["chunk_count"] >= 4
    assert report["table_chunk_count"] >= 1

    nodes = {
        (row["node_type"], row["label"])
        for row in client.app.state.services.db.fetch_all("SELECT node_type, label FROM knowledge_graph_nodes")
    }
    assert ("Budget", "30,000천원") in nodes
    assert ("Event", "2026년 5월부터 2026년 8월까지") in nodes
    assert ("Task", "상담 이력 요약") in nodes
    assert ("Department", "총무과") in nodes


def test_docx_public_document_ingestion_preserves_tables_and_metadata(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    docx_path = source / "public-report.docx"
    document_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>공공서비스 1페이지 보고서</w:t></w:r></w:p>
    <w:p><w:r><w:t>문서번호: DOCX-2026-001</w:t></w:r></w:p>
    <w:p><w:r><w:t>예산: 70,000천원</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>조치계획</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>담당자</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>부서</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>업무</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>홍길동</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>총무과</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>민원 자동화</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>
"""
    with ZipFile(docx_path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", document_xml)

    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "docx", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    document = client.get("/api/knowledge/documents").json()["items"][0]
    assert document["title"] == "공공서비스 1페이지 보고서"
    assert document["document_number"] == "DOCX-2026-001"
    assert document["parser_name"] == "gongmu-docx"
    assert document["table_count"] == 1
    assert document["table_chunk_count"] == 1
    nodes = {
        (row["node_type"], row["label"])
        for row in client.app.state.services.db.fetch_all("SELECT node_type, label FROM knowledge_graph_nodes")
    }
    assert ("Budget", "70,000천원") in nodes
    assert ("Person", "홍길동") in nodes
    assert ("Department", "총무과") in nodes


def test_hwpx_public_document_ingestion_uses_xml_fallback_for_tables(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("GONGMU_NODE_EXE", str(tmp_path / "missing-node.exe"))
    source = tmp_path / "source"
    source.mkdir()
    hwpx_path = source / "public-report.hwpx"
    section_xml = """<?xml version="1.0" encoding="UTF-8"?>
<hp:section xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run><hp:t>HWPX 공공서비스 보고서</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>문서번호: HWPX-2026-001</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>기간: 2026년 6월</hp:t></hp:run></hp:p>
  <hp:tbl>
    <hp:tr>
      <hp:tc><hp:p><hp:run><hp:t>첨부</hp:t></hp:run></hp:p></hp:tc>
      <hp:tc><hp:p><hp:run><hp:t>예산</hp:t></hp:run></hp:p></hp:tc>
    </hp:tr>
    <hp:tr>
      <hp:tc><hp:p><hp:run><hp:t>세부계획.hwpx</hp:t></hp:run></hp:p></hp:tc>
      <hp:tc><hp:p><hp:run><hp:t>90,000천원</hp:t></hp:run></hp:p></hp:tc>
    </hp:tr>
  </hp:tbl>
</hp:section>
"""
    with ZipFile(hwpx_path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("Contents/section0.xml", section_xml)

    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "hwpx", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    document = client.get("/api/knowledge/documents").json()["items"][0]
    assert document["title"] == "HWPX 공공서비스 보고서"
    assert document["document_number"] == "HWPX-2026-001"
    assert document["parser_name"] == "gongmu-hwpx-xml"
    assert document["table_count"] == 1
    assert document["table_chunk_count"] == 1
    nodes = {
        (row["node_type"], row["label"])
        for row in client.app.state.services.db.fetch_all("SELECT node_type, label FROM knowledge_graph_nodes")
    }
    assert ("Attachment", "세부계획.hwpx") in nodes
    assert ("Budget", "90,000천원") in nodes
    assert ("Event", "2026년 6월") in nodes


def test_pdf_public_document_ingestion_extracts_text_when_pypdf_is_available(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    pdf_path = source / "public-pdf-report.pdf"
    pdf_path.write_bytes(
        b"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length 78 >> stream
BT /F1 12 Tf 72 720 Td (PDF public service report budget evidence 120000) Tj ET
endstream endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000311 00000 n 
trailer << /Root 1 0 R /Size 6 >>
startxref
439
%%EOF
"""
    )
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "pdf", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    document = client.get("/api/knowledge/documents").json()["items"][0]
    chunks = client.get("/api/knowledge/chunks").json()["items"]
    assert document["parser_name"] == "gongmu-pdf"
    assert document["partial"] is False
    assert document["quality_score"] >= 0.45
    assert "PDF public service report budget evidence" in chunks[0]["text"]


def test_pdf_ingestion_splits_long_extracted_text_into_retrievable_chunks(
    tmp_path: Path,
    monkeypatch,
) -> None:
    class FakePage:
        def __init__(self, text: str) -> None:
            self._text = text

        def extract_text(self) -> str:
            return self._text

    class FakePdfReader:
        def __init__(self, _path: str) -> None:
            self.pages = [
                FakePage(
                    "1. 추진배경\n"
                    "AI 전략 수립을 위한 현황 분석과 대내외 환경 검토가 필요합니다. " * 20
                ),
                FakePage(
                    "2. 추진전략\n"
                    "업무 자동화, 지식검색, GraphRAG 고도화를 단계적으로 추진합니다. " * 20
                ),
                FakePage(
                    "3. 세부 실행계획\n"
                    "부서별 과제, 일정, 성과지표, 보안 기준을 연결해 관리합니다. " * 20
                ),
            ]

    monkeypatch.setitem(sys.modules, "pypdf", types.SimpleNamespace(PdfReader=FakePdfReader))
    source = tmp_path / "source"
    source.mkdir()
    (source / "ai-strategy.pdf").write_bytes(b"%PDF-1.4 fake")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "pdf", "root_path": str(source)})
    source_id = created.json()["id"]

    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    document = client.get("/api/knowledge/documents").json()["items"][0]
    chunks = client.get("/api/knowledge/chunks").json()["items"]
    assert document["parser_name"] == "gongmu-pdf"
    assert document["partial"] is False
    assert document["quality_score"] >= 0.6
    assert document["chunk_count"] >= 3
    assert len(chunks) >= 3
    assert any("추진전략" in chunk["text"] for chunk in chunks)
    assert any("세부 실행계획" in chunk["text"] for chunk in chunks)


def test_document_listing_exposes_chunk_quality_counts(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "table-plan.md").write_text(
        "# 표 중심 계획\n\n"
        "## 예산\n\n"
        "| 항목 | 예산 |\n"
        "| --- | --- |\n"
        "| 시스템 개선 | 100 |\n",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    document = client.get("/api/knowledge/documents").json()["items"][0]
    structure = client.get(f"/api/knowledge/document-structure?document_id={document['id']}").json()

    assert document["chunk_count"] == 3
    assert document["table_chunk_count"] == 1
    assert structure["document"]["chunk_count"] == 3
    assert structure["document"]["table_chunk_count"] == 1


def test_document_structure_defaults_to_bounded_section_preview(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    sections = "\n\n".join(f"## Section {index}\n\nPrompt detail {index}." for index in range(150))
    (source / "large.md").write_text(f"# Large Guide\n\n{sections}", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    document = client.get("/api/knowledge/documents").json()["items"][0]
    response = client.get(f"/api/knowledge/document-structure?document_id={document['id']}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["section_count"] == 151
    assert payload["sections_returned"] == 60
    assert payload["has_more_sections"] is True
    assert len(payload["sections"]) == 60


def test_ingest_batches_chroma_vector_upserts_for_large_documents(tmp_path: Path) -> None:
    class FakeVectorBackend:
        collection_name = "test_chunks"

        def __init__(self) -> None:
            self.calls: list[list[dict[str, object]]] = []

        def upsert_chunks(self, records):
            batch = [dict(record) for record in records]
            self.calls.append(batch)
            return [f"test:{record['chunk_id']}" for record in batch]

        def delete_document(self, document_id: str) -> None:
            return None

    source = tmp_path / "source"
    source.mkdir()
    sections = "\n\n".join(f"## Section {index}\n\nPrompt detail {index}." for index in range(260))
    (source / "large.md").write_text(f"# Large Guide\n\n{sections}", encoding="utf-8")
    client = _client(tmp_path)
    vector_backend = FakeVectorBackend()
    client.app.state.services.graphrag.vector_backend = vector_backend
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    response = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})

    assert response.status_code == 201
    chunk_count = len(client.get("/api/knowledge/chunks").json()["items"])
    assert chunk_count == 261
    assert sum(len(call) for call in vector_backend.calls) == chunk_count
    assert len(vector_backend.calls) <= 3


def test_ingestion_job_records_runtime_metrics(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "first.md").write_text("# First\n\nBudget material.", encoding="utf-8")
    (source / "second.md").write_text("# Second\n\nPolicy material.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    response = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})

    assert response.status_code == 201
    job = response.json()["job"]
    assert job["processed_count"] == 2
    assert job["duration_ms"] >= 0
    assert job["average_ms_per_file"] >= 0


def test_ingestion_job_records_full_diagnostic_log_dump(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "first.md").write_text("# First\n\nBudget material.", encoding="utf-8")
    (source / "second.md").write_text("# Second\n\nPolicy material.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    response = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})

    assert response.status_code == 201
    job = response.json()["job"]
    assert job["progress_percent"] == 100
    assert job["current_stage"] == "검색 준비"
    assert job["current_stage_index"] == 5
    assert job["stage_count"] == 6
    assert job["diagnostic_event_count"] >= 8
    assert job["last_diagnostic_message"] == "GraphRAG 검색 준비 완료"
    assert job["log_dump_path"]
    log_path = Path(job["log_dump_path"])
    assert log_path.exists()
    events = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
    event_names = [event["event"] for event in events]
    assert "job.started" in event_names
    assert "file.parse.started" in event_names
    assert "file.completed" in event_names
    assert "job.completed" in event_names
    assert any(event.get("parser_name") == "gongmu-markdown" for event in events)

    dump = client.get(f"/api/knowledge/ingestion-jobs/{job['id']}/log?limit=3")
    assert dump.status_code == 200
    payload = dump.json()
    assert payload["job_id"] == job["id"]
    assert payload["log_dump_path"] == job["log_dump_path"]
    assert len(payload["items"]) <= 3
    assert payload["items"][-1]["event"] == "job.completed"


def test_ingest_source_skips_unchanged_files_after_initial_run(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "first.md").write_text("# First\n\nBudget material.", encoding="utf-8")
    (source / "second.md").write_text("# Second\n\nPolicy material.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    response = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})

    assert response.status_code == 201
    job = response.json()["job"]
    assert job["queued_count"] == 0
    assert job["processed_count"] == 0
    assert job["skipped_count"] == 2


def test_ingest_source_reprocesses_unchanged_file_when_pipeline_signature_changes(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "first.md").write_text("# First\n\nBudget material.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201
    document = client.get("/api/knowledge/documents").json()["items"][0]
    client.app.state.services.db.execute(
        "UPDATE knowledge_documents SET ingestion_signature = ? WHERE id = ?",
        ("old-pipeline", document["id"]),
    )

    response = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})

    assert response.status_code == 201
    job = response.json()["job"]
    assert job["queued_count"] == 1
    assert job["processed_count"] == 1
    assert job["skipped_count"] == 0
    updated = client.get("/api/knowledge/documents").json()["items"][0]
    assert updated["ingestion_signature"] != "old-pipeline"


def test_ingest_source_reprocesses_only_modified_files(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    target = source / "first.md"
    target.write_text("# First\n\nOldMarkerUnique.", encoding="utf-8")
    (source / "second.md").write_text("# Second\n\nStable policy marker.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    target.write_text("# First Updated\n\nFreshMarkerUnique.", encoding="utf-8")
    response = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})

    assert response.status_code == 201
    job = response.json()["job"]
    assert job["queued_count"] == 1
    assert job["processed_count"] == 1
    assert job["skipped_count"] == 1
    stale = client.post("/api/knowledge/retrieve", json={"query": "OldMarkerUnique", "limit": 5})
    assert stale.status_code == 200
    assert stale.json()["items"] == []
    fresh = client.post("/api/knowledge/retrieve", json={"query": "FreshMarkerUnique", "limit": 5})
    assert fresh.status_code == 200
    assert fresh.json()["items"][0]["document"]["title"] == "First Updated"


def test_reindex_forces_unchanged_files_to_be_processed(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "first.md").write_text("# First\n\nBudget material.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    response = client.post("/api/knowledge/reindex", json={"source_id": source_id, "run_now": True})

    assert response.status_code == 201
    job = response.json()["job"]
    assert job["queued_count"] == 1
    assert job["processed_count"] == 1
    assert job["skipped_count"] == 0
    assert job["force_rebuild"] == 1


def test_ingest_source_stores_chunk_embedding_metadata(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "plan.md").write_text("# Plan\n\n## Background\n\nBudget automation work.", encoding="utf-8")
    client = _client(tmp_path)
    client.app.state.services.graphrag.embedding_provider = lambda text: EmbeddingResult(
        vector=[0.25, 0.75],
        backend="test-vector",
        model="fake-embedding",
    )
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    chunks = client.get("/api/knowledge/chunks").json()["items"]
    assert chunks[0]["embedding_backend"] == "test-vector"
    assert chunks[0]["embedding_model"] == "fake-embedding"
    assert json.loads(chunks[0]["embedding_json"]) == [0.25, 0.75]


def test_ingest_source_upserts_chunks_to_active_vector_backend(tmp_path: Path) -> None:
    class FakeVectorBackend:
        def __init__(self) -> None:
            self.upserts: list[list[dict[str, object]]] = []
            self.deletes: list[str] = []

        def upsert_chunks(self, records):
            chunk_records = list(records)
            self.upserts.append(chunk_records)
            return [f"chromadb:gongmu_chunks:{record['chunk_id']}" for record in chunk_records]

        def delete_document(self, document_id: str) -> None:
            self.deletes.append(document_id)

    source = tmp_path / "source"
    source.mkdir()
    (source / "plan.md").write_text("# Plan\n\n## Background\n\nBudget automation work.", encoding="utf-8")
    client = _client(tmp_path)
    client.app.state.services.graphrag.embedding_provider = lambda text: EmbeddingResult(
        vector=[0.25, 0.75],
        backend="test-vector",
        model="fake-embedding",
    )
    fake_backend = FakeVectorBackend()
    client.app.state.services.graphrag.vector_backend = fake_backend
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    chunks = client.get("/api/knowledge/chunks").json()["items"]
    assert chunks[0]["vector_ref"].startswith("chromadb:gongmu_chunks:")
    assert fake_backend.upserts
    first_upsert = fake_backend.upserts[0][0]
    assert first_upsert["chunk_id"] == chunks[0]["id"]
    assert first_upsert["document_id"] == chunks[0]["document_id"]
    assert first_upsert["section_id"] == chunks[0]["section_id"]
    assert first_upsert["text"] == chunks[0]["text"]
    assert first_upsert["embedding"] == [0.25, 0.75]


def test_delete_document_removes_chunks_from_active_vector_backend(tmp_path: Path) -> None:
    class FakeVectorBackend:
        def __init__(self) -> None:
            self.deletes: list[str] = []

        def upsert_chunks(self, records):
            return [f"chromadb:gongmu_chunks:{record['chunk_id']}" for record in records]

        def delete_document(self, document_id: str) -> None:
            self.deletes.append(document_id)

    source = tmp_path / "source"
    source.mkdir()
    obsolete = source / "obsolete.md"
    obsolete.write_text("# Obsolete\n\nDelete this vector.", encoding="utf-8")
    client = _client(tmp_path)
    fake_backend = FakeVectorBackend()
    client.app.state.services.graphrag.vector_backend = fake_backend
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201
    document_id = client.get("/api/knowledge/documents").json()["items"][0]["id"]

    obsolete.unlink()
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    assert fake_backend.deletes == [document_id]


def test_retrieve_uses_active_vector_backend_candidates(tmp_path: Path) -> None:
    class FakeVectorBackend:
        def __init__(self) -> None:
            self.records: list[dict[str, object]] = []
            self.query_calls: list[list[float]] = []

        def upsert_chunks(self, records):
            chunk_records = list(records)
            self.records.extend(chunk_records)
            return [f"chromadb:gongmu_chunks:{record['chunk_id']}" for record in chunk_records]

        def query_chunks(self, query_embedding, limit: int = 5, where=None):
            self.query_calls.append(list(query_embedding))
            beta = next(record for record in self.records if "Beta" in str(record["text"]))
            return [
                {
                    "chunk_id": beta["chunk_id"],
                    "text": beta["text"],
                    "metadata": beta["metadata"],
                    "distance": 0.01,
                    "vector_ref": f"chromadb:gongmu_chunks:{beta['chunk_id']}",
                }
            ]

        def delete_document(self, document_id: str) -> None:
            pass

    source = tmp_path / "source"
    source.mkdir()
    (source / "alpha.md").write_text("# Alpha\n\nAdministrative memo.", encoding="utf-8")
    (source / "beta.md").write_text("# Beta\n\nProcurement archive.", encoding="utf-8")
    client = _client(tmp_path)
    client.app.state.services.graphrag.embedding_provider = lambda text: EmbeddingResult(
        vector=[0.0, 0.0],
        backend="test-vector",
        model="fake-embedding",
    )
    fake_backend = FakeVectorBackend()
    client.app.state.services.graphrag.vector_backend = fake_backend
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    response = client.post("/api/knowledge/retrieve", json={"query": "semantic-only-query", "limit": 1})

    assert response.status_code == 200
    assert fake_backend.query_calls == [[0.0, 0.0]]
    item = response.json()["items"][0]
    assert item["document"]["title"] == "Beta"
    assert item["score_breakdown"]["vector_backend_score"] > 0


def test_retrieve_limits_scoring_to_candidate_chunks_when_vector_backend_is_active(tmp_path: Path) -> None:
    class FakeVectorBackend:
        def __init__(self) -> None:
            self.records: list[dict[str, object]] = []

        def upsert_chunks(self, records):
            chunk_records = list(records)
            self.records.extend(chunk_records)
            return [f"chromadb:gongmu_chunks:{record['chunk_id']}" for record in chunk_records]

        def query_chunks(self, query_embedding, limit: int = 5, where=None):
            beta = next(record for record in self.records if "Beta" in str(record["text"]))
            return [
                {
                    "chunk_id": beta["chunk_id"],
                    "text": beta["text"],
                    "metadata": beta["metadata"],
                    "distance": 0.02,
                    "vector_ref": f"chromadb:gongmu_chunks:{beta['chunk_id']}",
                }
            ]

        def delete_document(self, document_id: str) -> None:
            pass

    source = tmp_path / "source"
    source.mkdir()
    (source / "alpha.md").write_text("# Alpha\n\nAdministrative memo.", encoding="utf-8")
    (source / "beta.md").write_text("# Beta\n\nProcurement archive.", encoding="utf-8")
    (source / "gamma.md").write_text("# Gamma\n\nFacility archive.", encoding="utf-8")
    client = _client(tmp_path)
    client.app.state.services.graphrag.embedding_provider = lambda text: EmbeddingResult(
        vector=[0.0, 0.0],
        backend="test-vector",
        model="fake-embedding",
    )
    client.app.state.services.graphrag.vector_backend = FakeVectorBackend()
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201
    beta_chunk_id = next(
        row["id"]
        for row in client.app.state.services.db.fetch_all(
            """
            SELECT c.id, d.title
            FROM knowledge_document_chunks c
            JOIN knowledge_documents d ON d.id = c.document_id
            """
        )
        if row["title"] == "Beta"
    )

    def guarded_chunk_vector_score(chunk, query_embedding):
        if chunk["id"] != beta_chunk_id:
            raise AssertionError(f"unexpected full chunk scan for {chunk['id']}")
        return 0.0

    client.app.state.services.graphrag._chunk_vector_score = guarded_chunk_vector_score

    response = client.post("/api/knowledge/retrieve", json={"query": "semantic-only-query", "limit": 1})

    assert response.status_code == 200
    assert response.json()["items"][0]["document"]["title"] == "Beta"


def test_default_chroma_backend_persists_and_queries_chunks(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "quality-gate.md").write_text(
        "# Quality Gate\n\n## GraphRAG Evidence\n\nChroma normal path validates vector retrieval.",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    assert client.app.state.services.settings.graphrag_vector_backend == "chromadb"
    backend_status = client.get("/api/knowledge/backend-status").json()
    assert backend_status["vector"]["active_backend"] == "chromadb"

    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    ingest = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})

    assert ingest.status_code == 201
    assert ingest.json()["job"]["status"] == "completed"
    chunks = client.get("/api/knowledge/chunks").json()["items"]
    assert chunks[0]["vector_ref"].startswith("chromadb:gongmu_chunks:")
    assert any((tmp_path / "knowledge" / "graph" / "chroma").iterdir())

    response = client.post("/api/knowledge/retrieve", json={"query": "vector retrieval", "limit": 3})

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["document"]["title"] == "Quality Gate"
    assert item["score_breakdown"]["vector_backend_score"] > 0


def test_chunk_graph_insert_is_idempotent_for_retry_diagnostics(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "retry.md").write_text("# Retry Plan\n\n## Background\n\nRetry-safe graph insert.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    document = client.get("/api/knowledge/documents").json()["items"][0]
    chunk = client.get("/api/knowledge/chunks").json()["items"][0]
    manager = client.app.state.services.graphrag

    manager._insert_chunk_graph(
        f"document:{document['id']}",
        document["id"],
        chunk["id"],
        "Retry Plan",
        now_iso(),
    )

    nodes = client.app.state.services.db.fetch_all(
        "SELECT * FROM knowledge_graph_nodes WHERE id = ?",
        (f"chunk:{chunk['id']}",),
    )
    assert len(nodes) == 1


def test_queued_ingestion_job_can_be_listed_and_processed_later(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "queued.md").write_text("# Queued Plan\n\n## Background\n\nProcess this later.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    queued = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": False})

    assert queued.status_code == 201
    job_id = queued.json()["job"]["id"]
    assert queued.json()["job"]["status"] == "queued"
    assert client.get("/api/knowledge/chunks").json()["items"] == []

    jobs = client.get("/api/knowledge/ingestion-jobs")
    assert jobs.status_code == 200
    assert jobs.json()["items"][0]["id"] == job_id

    run = client.post(f"/api/knowledge/ingestion-jobs/{job_id}/run")

    assert run.status_code == 200
    assert run.json()["job"]["status"] == "completed"
    chunks = client.get("/api/knowledge/chunks").json()["items"]
    assert chunks[0]["document_id"]


def test_cancel_queued_ingestion_job_marks_canceled_without_processing(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "queued.md").write_text("# Queued Plan\n\n## Background\n\nProcess this later.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    queued = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": False})
    job_id = queued.json()["job"]["id"]

    canceled = client.post(f"/api/knowledge/ingestion-jobs/{job_id}/cancel")

    assert canceled.status_code == 200
    assert canceled.json()["job"]["status"] == "canceled"
    run = client.post(f"/api/knowledge/ingestion-jobs/{job_id}/run")
    assert run.status_code == 200
    assert run.json()["job"]["status"] == "canceled"
    assert client.get("/api/knowledge/chunks").json()["items"] == []


def test_ingest_source_rejects_duplicate_active_job_for_same_source(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "queued.md").write_text("# Queued Plan\n\n## Background\n\nProcess this later.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    queued = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": False})
    assert queued.status_code == 201

    duplicate = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": False})

    assert duplicate.status_code == 409
    assert "GraphRAG ingestion 작업이 진행 중입니다" in duplicate.json()["detail"]


def test_running_ingestion_job_stops_after_cancel_request(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    for index in range(3):
        (source / f"doc-{index}.md").write_text(f"# Doc {index}\n\nCancelable content {index}.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    queued = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": False})
    job_id = queued.json()["job"]["id"]

    graphrag = client.app.state.services.graphrag
    original_ingest = graphrag._ingest_source_file
    processed_paths: list[str] = []

    def cancel_after_first(source_file):
        processed_paths.append(source_file["relative_path"])
        result = original_ingest(source_file)
        if len(processed_paths) == 1:
            graphrag.request_cancel(job_id)
        return result

    graphrag._ingest_source_file = cancel_after_first

    run = client.post(f"/api/knowledge/ingestion-jobs/{job_id}/run")

    assert run.status_code == 200
    job = run.json()["job"]
    assert job["status"] == "canceled"
    assert job["processed_count"] == 1
    assert job["cancel_requested"] == 1
    assert job["last_processed_path"] == "doc-0.md"
    assert len(client.get("/api/knowledge/chunks").json()["items"]) == 1


def test_background_ingest_returns_queued_job_before_processing(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "background.md").write_text(
        "# Background Plan\n\n## Summary\n\nProcess this without blocking the caller.",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "work", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    response = client.post(
        "/api/knowledge/ingest",
        json={"source_id": source_id, "run_now": True, "background": True},
    )

    assert response.status_code == 201
    payload = response.json()
    job = payload["job"]
    work_job = payload["work_job"]
    assert job["status"] == "queued"
    assert work_job["kind"] == "knowledge.ingest"
    assert work_job["status"] in {"queued", "running", "succeeded", "partial"}
    assert job["processed_count"] == 0

    latest_job = job
    for _ in range(20):
        latest_job = client.get("/api/knowledge/ingestion-jobs").json()["items"][0]
        if latest_job["status"] == "completed":
            break
        time.sleep(0.05)

    assert latest_job["status"] == "completed"
    assert latest_job["processed_count"] == 1
    assert client.get("/api/knowledge/chunks").json()["items"][0]["document_id"]


def test_retrieve_returns_chunks_with_document_and_relations(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "plan.md").write_text(
        "# 사업계획\n\n## 세부추진계획\n\n지역 사업 추진계획을 수립한다.",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "업무자료", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    response = client.post("/api/knowledge/retrieve", json={"query": "추진계획", "limit": 3})

    assert response.status_code == 200
    payload = response.json()
    assert payload["query"] == "추진계획"
    assert payload["items"][0]["document"]["title"] == "사업계획"
    assert "추진계획" in payload["items"][0]["chunk"]["text"]
    assert payload["items"][0]["relations"][0]["relation"] == "HAS_CHUNK"
