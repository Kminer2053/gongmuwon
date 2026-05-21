from pathlib import Path
import unicodedata

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path / "workspace")
    return app.state.test_client_factory()


def test_local_file_search_finds_exact_filename_outside_knowledge_sources(
    tmp_path: Path,
    monkeypatch,
) -> None:
    search_root = tmp_path / "pc"
    search_root.mkdir()
    target = search_root / "회의자료.hwpx"
    target.write_text("dummy", encoding="utf-8")
    (search_root / "다른자료.txt").write_text("dummy", encoding="utf-8")
    monkeypatch.setenv("GONGMU_FILE_SEARCH_ROOTS", str(search_root))
    monkeypatch.setenv("GONGMU_FILE_SEARCH_MAX_SECONDS", "2")

    client = _client(tmp_path)
    response = client.get("/api/files/search?query=회의자료.hwpx&limit=10")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["file"]["file_path"] == str(target)
    assert payload["items"][0]["file"]["status"] == "filename_match"
    assert "파일명 정확 일치" in payload["items"][0]["match_reasons"]


def test_local_file_search_can_find_filename_by_stem(tmp_path: Path, monkeypatch) -> None:
    search_root = tmp_path / "pc"
    search_root.mkdir()
    target = search_root / "예산검토보고서.docx"
    target.write_text("dummy", encoding="utf-8")
    monkeypatch.setenv("GONGMU_FILE_SEARCH_ROOTS", str(search_root))
    monkeypatch.setenv("GONGMU_FILE_SEARCH_MAX_SECONDS", "2")

    client = _client(tmp_path)
    response = client.get("/api/files/search?query=예산검토보고서&limit=10")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["file"]["file_path"] == str(target)
    assert "파일명 정확 일치" in payload["items"][0]["match_reasons"]


def test_local_file_search_matches_filename_across_common_separators(
    tmp_path: Path,
    monkeypatch,
) -> None:
    search_root = tmp_path / "pc"
    search_root.mkdir()
    target = search_root / "Budget_Report-2026.docx"
    target.write_text("dummy", encoding="utf-8")
    (search_root / "reporting-notes.txt").write_text("dummy", encoding="utf-8")
    monkeypatch.setenv("GONGMU_FILE_SEARCH_ROOTS", str(search_root))
    monkeypatch.setenv("GONGMU_FILE_SEARCH_MAX_SECONDS", "2")

    client = _client(tmp_path)
    response = client.get("/api/files/search?query=budget report&limit=10")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["file"]["file_path"] == str(target)
    assert "파일명 단어 일치" in payload["items"][0]["match_reasons"]


def test_local_file_search_uses_rebuilt_filename_index(tmp_path: Path, monkeypatch) -> None:
    search_root = tmp_path / "pc"
    search_root.mkdir()
    target = search_root / "Civil_Service_Report.docx"
    target.write_text("dummy", encoding="utf-8")
    monkeypatch.setenv("GONGMU_FILE_SEARCH_ROOTS", str(search_root))
    monkeypatch.setenv("GONGMU_FILE_SEARCH_MAX_SECONDS", "2")

    client = _client(tmp_path)
    rebuild = client.post("/api/files/index/rebuild")

    assert rebuild.status_code == 200
    assert rebuild.json()["indexed_count"] == 1

    monkeypatch.delenv("GONGMU_FILE_SEARCH_ROOTS")
    response = client.get("/api/files/search?query=civil service&limit=10")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["file"]["file_path"] == str(target)
    assert payload["local_index_count"] == 1


def test_local_file_search_does_not_rescan_pc_when_filename_index_has_hits(
    tmp_path: Path,
    monkeypatch,
) -> None:
    search_root = tmp_path / "pc"
    search_root.mkdir()
    target = search_root / "Instant_Index_Result.hwpx"
    target.write_text("dummy", encoding="utf-8")
    monkeypatch.setenv("GONGMU_FILE_SEARCH_ROOTS", str(search_root))
    monkeypatch.setenv("GONGMU_FILE_SEARCH_MAX_SECONDS", "2")

    client = _client(tmp_path)
    assert client.post("/api/files/index/rebuild").status_code == 200

    def fail_direct_scan(**_kwargs):
        raise AssertionError("indexed search should not perform a fresh filesystem scan")

    monkeypatch.setattr("gongmu_sidecar.app.search_local_files_by_name", fail_direct_scan)

    response = client.get("/api/files/search?query=instant index&limit=10")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["file"]["file_path"] == str(target)
    assert payload["items"][0]["file"]["status"] == "filename_index_match"
    assert payload["local_index_count"] == 1


def test_local_file_search_normalizes_korean_unicode_filenames(tmp_path: Path, monkeypatch) -> None:
    search_root = tmp_path / "pc"
    search_root.mkdir()
    decomposed_name = unicodedata.normalize("NFD", "회의자료.hwpx")
    target = search_root / decomposed_name
    target.write_text("dummy", encoding="utf-8")
    monkeypatch.setenv("GONGMU_FILE_SEARCH_ROOTS", str(search_root))
    monkeypatch.setenv("GONGMU_FILE_SEARCH_MAX_SECONDS", "2")

    client = _client(tmp_path)
    response = client.get("/api/files/search?query=회의자료&limit=10")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["file"]["file_path"] == str(target)
    assert "파일명 정확 일치" in payload["items"][0]["match_reasons"]
