from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_register_and_scan_knowledge_source_indexes_supported_files(tmp_path: Path) -> None:
    source = tmp_path / "source-documents"
    nested = source / "nested"
    nested.mkdir(parents=True)
    (source / "budget.md").write_text("# 예산 검토\n\n예산편성 회의자료를 정리한다.", encoding="utf-8")
    (nested / "meeting.txt").write_text("회의록과 사업계획 자료를 함께 검토한다.", encoding="utf-8")
    (source / "ignored.tmp").write_text("ignored", encoding="utf-8")

    client = _client(tmp_path)

    created = client.post(
        "/api/knowledge/sources",
        json={"label": "업무자료", "root_path": str(source)},
    )
    assert created.status_code == 201
    source_id = created.json()["id"]
    assert created.json()["status"] == "active"

    scan = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert scan.status_code == 200
    payload = scan.json()
    assert payload["source_id"] == source_id
    assert payload["status"] == "completed"
    assert payload["indexed_count"] == 2
    assert payload["deleted_count"] == 0

    files = client.get("/api/knowledge/source-files")
    assert files.status_code == 200
    indexed = {item["relative_path"].replace("\\", "/"): item for item in files.json()["items"]}
    assert set(indexed) == {"budget.md", "nested/meeting.txt"}
    assert indexed["budget.md"]["title"] == "예산 검토"
    assert indexed["budget.md"]["status"] == "indexed"
    assert "예산편성" in indexed["budget.md"]["text_excerpt"]

    sources = client.get("/api/knowledge/sources")
    assert sources.status_code == 200
    assert sources.json()["items"][0]["last_scanned_at"]


def test_rescan_marks_removed_knowledge_source_files_deleted(tmp_path: Path) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    tracked = source / "tracked.md"
    tracked.write_text("# 남길 문서\n\n초기 인덱스", encoding="utf-8")

    client = _client(tmp_path)
    created = client.post(
        "/api/knowledge/sources",
        json={"label": "삭제 감지", "root_path": str(source)},
    )
    source_id = created.json()["id"]

    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    tracked.unlink()

    scan = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert scan.status_code == 200
    assert scan.json()["deleted_count"] == 1

    files = client.get(f"/api/knowledge/source-files?source_id={source_id}")
    assert files.status_code == 200
    assert files.json()["items"][0]["status"] == "deleted"


def test_knowledge_search_returns_hits_from_ingested_source_files(tmp_path: Path) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    (source / "budget.md").write_text("# 예산 검토\n\n예산편성 회의자료를 정리한다.", encoding="utf-8")

    client = _client(tmp_path)
    created = client.post(
        "/api/knowledge/sources",
        json={"label": "업무자료", "root_path": str(source)},
    )
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    search = client.get("/api/knowledge/search?query=예산편성")
    assert search.status_code == 200
    payload = search.json()
    assert payload["items"]
    assert payload["items"][0]["title"] == "예산 검토"
    assert payload["items"][0]["source_path"].endswith("budget.md")


def test_local_file_search_finds_files_by_name_and_extracted_content(tmp_path: Path) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    (source / "budget-plan.md").write_text("# 예산 검토\n\n예산편성 회의자료를 정리한다.", encoding="utf-8")
    metadata_only = source / "scan-only.hwp"
    metadata_only.write_bytes(b"\x00\x01binary")

    client = _client(tmp_path)
    created = client.post(
        "/api/knowledge/sources",
        json={"label": "업무자료", "root_path": str(source)},
    )
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    filename_search = client.get("/api/files/search?query=scan-only")
    assert filename_search.status_code == 200
    filename_payload = filename_search.json()
    assert filename_payload["items"][0]["file"]["relative_path"] == "scan-only.hwp"
    assert "파일명" in filename_payload["items"][0]["match_reasons"]

    content_search = client.get("/api/files/search?query=예산편성")
    assert content_search.status_code == 200
    content_payload = content_search.json()
    assert content_payload["items"][0]["file"]["relative_path"] == "budget-plan.md"
    assert "본문" in content_payload["items"][0]["match_reasons"]
    assert content_payload["items"][0]["score"] > 0


def test_scan_extracts_docx_text_into_source_file_index(tmp_path: Path) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    docx_path = source / "meeting.docx"
    with ZipFile(docx_path, "w", ZIP_DEFLATED) as docx:
        docx.writestr(
            "word/document.xml",
            (
                "<?xml version='1.0' encoding='UTF-8'?>"
                "<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'>"
                "<w:body><w:p><w:r><w:t>Budget extraction meeting note</w:t></w:r></w:p></w:body>"
                "</w:document>"
            ),
        )

    client = _client(tmp_path)
    created = client.post(
        "/api/knowledge/sources",
        json={"label": "업무자료", "root_path": str(source)},
    )
    source_id = created.json()["id"]

    scan = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert scan.status_code == 200
    assert scan.json()["indexed_count"] == 1

    files = client.get(f"/api/knowledge/source-files?source_id={source_id}")
    assert files.status_code == 200
    file_record = files.json()["items"][0]
    assert file_record["status"] == "indexed"
    assert "Budget extraction" in file_record["text_excerpt"]


def test_knowledge_graph_includes_sources_and_documents(tmp_path: Path) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    (source / "budget.md").write_text("# Budget Review\n\nbudget planning meeting note", encoding="utf-8")

    client = _client(tmp_path)
    created = client.post(
        "/api/knowledge/sources",
        json={"label": "업무자료", "root_path": str(source)},
    )
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    graph = client.get("/api/knowledge/graph")
    assert graph.status_code == 200
    node_types = {node["node_type"] for node in graph.json()["nodes"]}
    assert {"source_folder", "document"}.issubset(node_types)
    edges = graph.json()["edges"]
    assert any(edge["relation"] == "contains" for edge in edges)
