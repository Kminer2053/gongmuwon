"""D-02: preview-hwpx 바이트 렌더링 + 산출물 파일 서빙(outputs/file) 테스트."""

from pathlib import Path

from gongmu_sidecar.app import create_app
from gongmu_sidecar.document_authoring import register_authoring_routes


class StubLLM:
    def __call__(self, messages, *, temperature=0.2):
        raise AssertionError("preview-hwpx / outputs-file 경로는 LLM을 호출하면 안 됩니다.")


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    register_authoring_routes(app, app.state.services, llm_complete=StubLLM())
    return app.state.test_client_factory()


ONEPAGE_STRUCTURE = {
    "title": "청사 에너지 절감 추진계획 보고",
    "summary": "전력 사용량 12% 절감을 위해 3개 과제를 하반기에 즉시 추진",
    "sections": [
        {
            "heading": "추진 배경",
            "items": ["2025년 청사 전력비 3.2억 원", "정부 에너지 절감 지침 시달"],
        },
        {
            "heading": "향후 조치",
            "items": ["7월 중 자동제어 시범 적용", "8월 예산 재배정 요구"],
        },
    ],
}


# ---------------------------------------------------------------------------
# POST /api/documents/authoring/preview-hwpx
# ---------------------------------------------------------------------------


def test_preview_hwpx_returns_zip_bytes_without_disk_leftovers(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.post(
        "/api/documents/authoring/preview-hwpx",
        json={"format": "onePageReport", "structure": ONEPAGE_STRUCTURE},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/octet-stream")
    # HWPX 는 zip 컨테이너 — 시그니처 PK 로 시작해야 한다
    assert response.content[:2] == b"PK"
    assert len(response.content) > 500

    # 디스크 잔존물 없음: documents 폴더 아래에 hwpx/md 파일이 생기지 않는다
    documents_root = Path(client.app.state.services.paths.documents_root)
    assert list(documents_root.rglob("*.hwpx")) == []
    assert list(documents_root.rglob("preview*.md")) == []


def test_preview_hwpx_rejects_invalid_structure_with_korean_hints(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.post(
        "/api/documents/authoring/preview-hwpx",
        json={"format": "onePageReport", "structure": {"title": "제목만 있음"}},
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["message"] == "구조 JSON이 양식 스키마에 맞지 않습니다."
    assert any("summary" in hint for hint in detail["hints"])
    assert any("sections" in hint for hint in detail["hints"])


def test_preview_hwpx_rejects_unknown_format(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.post(
        "/api/documents/authoring/preview-hwpx",
        json={"format": "unknownFormat", "structure": ONEPAGE_STRUCTURE},
    )

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/documents/outputs/file
# ---------------------------------------------------------------------------


def test_outputs_file_serves_file_under_documents_root(tmp_path: Path) -> None:
    client = _client(tmp_path)
    documents_root = Path(client.app.state.services.paths.documents_root)
    output_path = documents_root / "outputs" / "weekly-report.hwpx"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(b"PK\x03\x04fake-hwpx-bytes")

    response = client.get(
        "/api/documents/outputs/file", params={"path": str(output_path)}
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/octet-stream")
    assert response.content == b"PK\x03\x04fake-hwpx-bytes"


def test_outputs_file_rejects_path_outside_documents_root(tmp_path: Path) -> None:
    client = _client(tmp_path)
    secret_path = tmp_path / "secret.txt"
    secret_path.write_text("비밀", encoding="utf-8")

    response = client.get(
        "/api/documents/outputs/file", params={"path": str(secret_path)}
    )

    assert response.status_code == 403


def test_outputs_file_rejects_dotdot_traversal(tmp_path: Path) -> None:
    client = _client(tmp_path)
    secret_path = tmp_path / "secret.txt"
    secret_path.write_text("비밀", encoding="utf-8")
    documents_root = Path(client.app.state.services.paths.documents_root)
    traversal = documents_root / "outputs" / ".." / ".." / ".." / "secret.txt"

    response = client.get(
        "/api/documents/outputs/file", params={"path": str(traversal)}
    )

    assert response.status_code == 403


def test_outputs_file_returns_404_for_missing_file(tmp_path: Path) -> None:
    client = _client(tmp_path)
    documents_root = Path(client.app.state.services.paths.documents_root)

    response = client.get(
        "/api/documents/outputs/file",
        params={"path": str(documents_root / "outputs" / "missing.hwpx")},
    )

    assert response.status_code == 404
