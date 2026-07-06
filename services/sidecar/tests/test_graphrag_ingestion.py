"""지식폴더 색인(위키 엔진) 수명주기 + 문서 파서 계약 테스트.

GraphRAG(청크/벡터/온톨로지 그래프) 시절의 검증은 지식위키 2.0 전환으로 제거했고,
파서 계약과 색인 작업 수명주기는 새 경로 기준으로 유지한다.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from gongmu_sidecar.app import create_app
from gongmu_sidecar.document_parsers import parse_document


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_knowledge_schema_tables_exist(tmp_path: Path) -> None:
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
    assert "knowledge_table_blocks" in tables
    assert "knowledge_wiki_docs" in tables
    if db.fts5_available:
        virtual_tables = {
            row["name"]
            for row in db.connection.execute(
                "SELECT name FROM sqlite_master WHERE name = 'knowledge_fts'"
            ).fetchall()
        }
        assert "knowledge_fts" in virtual_tables


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


def test_ingest_source_creates_job_documents_and_wiki_cards(tmp_path: Path) -> None:
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
    assert job["stage_count"] == 4

    tables = client.get("/api/knowledge/tables")
    assert tables.status_code == 200
    assert tables.json()["items"][0]["headers"] == ["항목", "예산"]

    wiki_root = tmp_path / "knowledge-wiki"
    assert (wiki_root / "index.md").exists()
    assert (wiki_root / "log.md").exists()
    cards = list((wiki_root / "docs").glob("*.md"))
    assert len(cards) == 1
    extracted = list((wiki_root / "extracted").glob("*.md"))
    assert len(extracted) == 1


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
    assert "지식폴더 색인" in blocked_create.json()["detail"]


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
        ("running", "extract", 85, 14, job_id),
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
        ("running", "extract", 85, job_id),
    )

    canceled = client.post(f"/api/knowledge/ingestion-jobs/{job_id}/cancel")

    assert canceled.status_code == 200
    job = canceled.json()["job"]
    assert job["status"] == "canceled"
    assert job["cancel_requested"] == 1
    assert "worker is not active" in job["error_message"]


def test_ingest_source_removes_deleted_file_documents_and_search_hits(tmp_path: Path) -> None:
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
    search = client.get("/api/knowledge/search", params={"query": "procurement"})
    assert search.status_code == 200
    assert search.json()["items"] == []


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


def test_public_document_fixture_ingests_with_quality_and_search(tmp_path: Path) -> None:
    # 이 픽스처 루트는 저장소(.claude 워크트리 포함) 아래에 있어
    # _is_excluded가 루트 상위 조상 경로를 검사하던 버그의 회귀 테스트도 겸한다.
    source = Path(__file__).parent / "fixtures" / "public_docs"
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "public docs", "root_path": str(source)})
    source_id = created.json()["id"]
    scan = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert scan.status_code == 200
    assert scan.json()["indexed_count"] >= 3

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

    search = client.get("/api/knowledge/search", params={"query": "개인정보보호법"})
    assert search.status_code == 200
    titles = [item["title"] for item in search.json()["items"]]
    assert "민원 자동화 개선 시행계획" in titles


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
    assert document["parser_name"] == "gongmu-pdf"
    assert document["partial"] is False
    assert document["quality_score"] >= 0.45
    search = client.get("/api/knowledge/search", params={"query": "budget evidence"})
    assert search.json()["items"]


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
    assert job["stage_count"] == 4
    assert job["diagnostic_event_count"] >= 6
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
    stale = client.get("/api/knowledge/search", params={"query": "OldMarkerUnique"})
    assert stale.status_code == 200
    assert stale.json()["items"] == []
    fresh = client.get("/api/knowledge/search", params={"query": "FreshMarkerUnique"})
    assert fresh.status_code == 200
    assert fresh.json()["items"][0]["title"] == "First Updated"


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
    assert client.get("/api/knowledge/documents").json()["items"] == []

    jobs = client.get("/api/knowledge/ingestion-jobs")
    assert jobs.status_code == 200
    assert jobs.json()["items"][0]["id"] == job_id

    run = client.post(f"/api/knowledge/ingestion-jobs/{job_id}/run")

    assert run.status_code == 200
    assert run.json()["job"]["status"] == "completed"
    documents = client.get("/api/knowledge/documents").json()["items"]
    assert documents[0]["title"] == "Queued Plan"


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
    assert client.get("/api/knowledge/documents").json()["items"] == []


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
    assert "지식폴더 색인 작업이 진행 중입니다" in duplicate.json()["detail"]


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

    wiki = client.app.state.services.wiki
    original_ingest = wiki._ingest_source_file
    processed_paths: list[str] = []

    def cancel_after_first(source_file):
        processed_paths.append(source_file["relative_path"])
        result = original_ingest(source_file)
        if len(processed_paths) == 1:
            wiki.request_cancel(job_id)
        return result

    wiki._ingest_source_file = cancel_after_first

    run = client.post(f"/api/knowledge/ingestion-jobs/{job_id}/run")

    assert run.status_code == 200
    job = run.json()["job"]
    assert job["status"] == "canceled"
    assert job["processed_count"] == 1
    assert job["cancel_requested"] == 1
    assert job["last_processed_path"] == "doc-0.md"


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
    for _ in range(40):
        latest_job = client.get("/api/knowledge/ingestion-jobs").json()["items"][0]
        if latest_job["status"] == "completed":
            break
        time.sleep(0.05)

    assert latest_job["status"] == "completed"
    assert latest_job["processed_count"] == 1
    assert client.get("/api/knowledge/documents").json()["items"][0]["title"] == "Background Plan"
