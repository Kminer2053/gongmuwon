"""임의형식(custom) 문서작성 — 업로드→감지→값 제안→채우기/본문 반영 (kordoc 실호출).

kordoc CLI 는 리포지토리 루트 node_modules 의 실제 바이너리를 node 서브프로세스로 호출한다.
node 또는 kordoc 이 없으면 해당 테스트를 skip 한다(로컬 환경 보호).
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from gongmu_sidecar.app import create_app
from gongmu_sidecar.document_authoring import (
    KordocCliUnavailable,
    build_custom_fill_content_text,
    build_custom_patch_markdown,
    match_custom_form_values,
    register_authoring_routes,
    resolve_kordoc_cli,
)
from gongmu_sidecar.llm import LLMGenerationError

TEMPLATE_ROOT = (
    Path(__file__).resolve().parents[1] / "src" / "gongmu_sidecar" / "public_doc_templates"
)
GONGMUN_FORM_TEMPLATE = TEMPLATE_ROOT / "format_gongmun" / "standard.hwpx"


def _kordoc_ready() -> bool:
    try:
        cli = resolve_kordoc_cli()
    except KordocCliUnavailable:
        return False
    node = os.environ.get("GONGMU_NODE_EXE", "node")
    try:
        completed = subprocess.run(
            [node, "--version"], check=False, capture_output=True, timeout=15
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return completed.returncode == 0 and cli.is_file()


requires_kordoc = pytest.mark.skipif(
    not _kordoc_ready(), reason="node + kordoc CLI가 설치된 환경에서만 실행"
)


class StubLLM:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, messages, *, temperature=0.2):
        self.calls.append({"messages": messages, "temperature": temperature})
        if not self.responses:
            raise AssertionError("스텁 응답이 더 이상 없습니다.")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _client(tmp_path: Path, llm):
    app = create_app(tmp_path)
    register_authoring_routes(app, app.state.services, llm_complete=llm)
    return app.state.test_client_factory()


def _upload_template(client, source: Path, file_name: str | None = None) -> str:
    with source.open("rb") as handle:
        response = client.post(
            "/api/documents/authoring/custom-template",
            files={"file": (file_name or source.name, handle, "application/octet-stream")},
        )
    assert response.status_code == 201, response.text
    item = response.json()["item"]
    assert Path(item["path"]).exists()
    return item["path"]


def _generate_document_hwpx(target: Path) -> Path:
    """본문 문단형 hwpx 를 kordoc generate 로 만든다(폼 필드 없음 → document 모드)."""
    markdown = target.with_suffix(".md")
    markdown.write_text(
        "# 주간 업무 공유\n\n"
        "이번 주에는 민원 처리 절차 개선을 논의했습니다.\n\n"
        "다음 주에는 개선안을 시범 적용할 예정입니다.\n",
        encoding="utf-8",
    )
    node = os.environ.get("GONGMU_NODE_EXE", "node")
    completed = subprocess.run(
        [node, str(resolve_kordoc_cli()), "generate", str(markdown), "-o", str(target), "--silent"],
        check=False,
        capture_output=True,
        timeout=120,
    )
    assert completed.returncode == 0, completed.stderr.decode("utf-8", errors="replace")
    assert target.exists()
    return target


# ---------------------------------------------------------------------------
# 업로드 + 감지
# ---------------------------------------------------------------------------


def test_custom_template_upload_rejects_non_hwpx(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    response = client.post(
        "/api/documents/authoring/custom-template",
        files={"file": ("주간보고.docx", b"PK\x03\x04fake", "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "HWPX" in response.json()["detail"]


@requires_kordoc
def test_custom_detect_reports_form_mode_with_empty_fields(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    template_path = _upload_template(client, GONGMUN_FORM_TEMPLATE, "부서공문양식.hwpx")

    response = client.post(
        "/api/documents/authoring/custom-detect", json={"template_path": template_path}
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["mode"] == "form"
    assert payload["confidence"] >= 0.5
    labels = [field["label"] for field in payload["fields"]]
    assert len(labels) >= 3
    assert "수신자" in labels
    # 빈 필드만 대상으로 하고 값은 아직 비어 있어야 한다
    assert all(field["current"] == "" for field in payload["fields"])
    # 중복 라벨 제거
    assert len(labels) == len(set(labels))


@requires_kordoc
def test_custom_detect_falls_back_to_document_mode(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    generated = _generate_document_hwpx(tmp_path / "document.hwpx")
    template_path = _upload_template(client, generated, "본문교체양식.hwpx")

    response = client.post(
        "/api/documents/authoring/custom-detect", json={"template_path": template_path}
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["mode"] == "document"
    assert payload["fields"] == []


def test_custom_detect_rejects_paths_outside_documents_root(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    outside = tmp_path / "outside.hwpx"
    outside.write_bytes(b"PK\x03\x04")
    response = client.post(
        "/api/documents/authoring/custom-detect", json={"template_path": str(outside)}
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# 값 제안 (LLM 스텁 — 라벨 표기 차이 매칭·추측 금지)
# ---------------------------------------------------------------------------


def test_custom_fill_suggest_matches_labels_and_skips_unfounded(tmp_path: Path) -> None:
    stub = StubLLM(
        [json.dumps({"수신자": "각 부서장", "협 조 자": "홍길동 주무관", "없는라벨": "버려질 값"}, ensure_ascii=False)]
    )
    client = _client(tmp_path, stub)
    response = client.post(
        "/api/documents/authoring/custom-fill-suggest",
        json={
            "fields": [{"label": "수신자"}, {"label": "협조자"}, {"label": "시행"}],
            "instruction": "각 부서장에게 보낼 협조 공문. 담당은 홍길동 주무관.",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    # 표기 차이("협 조 자")는 정규화 매칭, 근거 없는 "시행"은 비워 둔다
    assert payload["values"] == {"수신자": "각 부서장", "협조자": "홍길동 주무관"}
    assert payload["matched_count"] == 2
    assert payload["total_fields"] == 3

    # 프롬프트: 라벨→질문 변환·추측 금지 규칙 + 지시가 [내용]에 실려야 한다
    system_text = stub.calls[0]["messages"][0]["text"]
    assert "라벨을 질문으로 바꿔" in system_text
    assert "추측·창작 금지" in system_text
    user_text = stub.calls[0]["messages"][1]["text"]
    assert "[양식 빈 필드 3개]" in user_text
    assert "각 부서장에게 보낼 협조 공문" in user_text


def test_custom_fill_suggest_uses_session_transcript(tmp_path: Path) -> None:
    stub = StubLLM([json.dumps({"수신자": "총무과장"}, ensure_ascii=False)])
    client = _client(tmp_path, stub)
    session = client.post("/api/work-sessions", json={"title": "공문 준비"})
    session_id = session.json()["id"]
    client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "user", "text": "수신자는 총무과장으로 해줘"},
    )
    response = client.post(
        "/api/documents/authoring/custom-fill-suggest",
        json={"fields": ["수신자"], "session_id": session_id},
    )
    assert response.status_code == 200
    assert response.json()["values"] == {"수신자": "총무과장"}
    assert "수신자는 총무과장으로 해줘" in stub.calls[0]["messages"][1]["text"]


def test_custom_fill_suggest_llm_failure_returns_502(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([LLMGenerationError("연결 실패")]))
    response = client.post(
        "/api/documents/authoring/custom-fill-suggest",
        json={"fields": ["수신자"], "instruction": "테스트"},
    )
    assert response.status_code == 502
    assert "값 제안 LLM 호출에 실패" in response.json()["detail"]


def test_match_custom_form_values_normalizes_label_variants() -> None:
    raw = json.dumps(
        {"성 명": "홍길동", "연락처(휴대폰)": "010-1234-5678", "비고": "", "머리글": None},
        ensure_ascii=False,
    )
    values = match_custom_form_values(raw, ["성명", "연락처 (휴대폰)", "비고"])
    assert values == {"성명": "홍길동", "연락처 (휴대폰)": "010-1234-5678"}


def test_build_custom_fill_content_text_orders_sources() -> None:
    text = build_custom_fill_content_text(
        instruction="협조 공문 작성",
        transcript=[{"role": "user", "text": "담당은 홍길동"}],
        reference_texts=["예산 자료 본문"],
    )
    assert text.index("[작성 지시]") < text.index("[업무대화 기록]") < text.index("[참고자료 1]")
    assert "사용자: 담당은 홍길동" in text


# ---------------------------------------------------------------------------
# 채우기 적용 (kordoc fill 실호출 — 서식 보존)
# ---------------------------------------------------------------------------


@requires_kordoc
def test_custom_fill_apply_writes_hwpx_to_outputs(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    template_path = _upload_template(client, GONGMUN_FORM_TEMPLATE, "부서공문양식.hwpx")

    response = client.post(
        "/api/documents/authoring/custom-fill-apply",
        json={
            "template_path": template_path,
            "values": {"수신자": "각 부서장", "협조자": "홍길동 주무관", "비어있는값": ""},
            "output_name": "협조공문 채움",
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    artifact_path = Path(payload["artifact"]["path"])
    assert artifact_path.exists()
    assert artifact_path.suffix == ".hwpx"
    assert artifact_path.parent == (tmp_path / "documents" / "outputs")
    # HWPX(zip) 매직바이트
    assert artifact_path.read_bytes()[:2] == b"PK"
    assert payload["filled_count"] >= 1
    # 빈 값은 채움 요청에서 제외된다
    assert payload["requested_count"] == 2

    # 산출물 서빙 경로(documents_root 하위)로 내려받을 수 있어야 한다 — 최종 탭 rhwp 미리보기 재사용
    served = client.get(
        "/api/documents/outputs/file", params={"path": str(artifact_path)}
    )
    assert served.status_code == 200


def test_custom_fill_apply_rejects_when_no_values(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    template_path = _upload_template(client, GONGMUN_FORM_TEMPLATE)
    response = client.post(
        "/api/documents/authoring/custom-fill-apply",
        json={"template_path": template_path, "values": {"수신자": "  "}},
    )
    assert response.status_code == 422
    assert "채울 값이 없습니다" in response.json()["detail"]


# ---------------------------------------------------------------------------
# 문서형: organize → 문단 매핑 → kordoc patch 실호출
# ---------------------------------------------------------------------------

ORGANIZED_FOR_PATCH = """# 민원 처리 개선 보고
## 추진 배경
- 민원 처리 지연 누적
- 처리 절차 복잡
## 개선 방안
- 처리 절차 간소화
- 담당자 재배치
"""


@requires_kordoc
def test_custom_patch_replaces_body_and_saves_output(tmp_path: Path) -> None:
    stub = StubLLM([ORGANIZED_FOR_PATCH])
    client = _client(tmp_path, stub)
    generated = _generate_document_hwpx(tmp_path / "document.hwpx")
    template_path = _upload_template(client, generated, "본문교체양식.hwpx")

    response = client.post(
        "/api/documents/authoring/custom-patch",
        json={
            "template_path": template_path,
            "instruction": "민원 처리 개선 내용으로 본문을 교체해줘",
            "output_name": "민원개선 반영",
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    artifact_path = Path(payload["artifact"]["path"])
    assert artifact_path.exists()
    assert artifact_path.read_bytes()[:2] == b"PK"
    assert payload["applied_changes"] >= 1
    assert payload["replaced_blocks"] >= 1
    assert payload["organized_markdown"].startswith("# 민원 처리 개선 보고")

    # 반영 결과를 다시 파싱하면 새 내용이 들어 있어야 한다(서식 보존 라운드트립)
    node = os.environ.get("GONGMU_NODE_EXE", "node")
    reparsed = subprocess.run(
        [node, str(resolve_kordoc_cli()), str(artifact_path), "-o", str(tmp_path / "re.md"), "--silent"],
        check=False,
        capture_output=True,
        timeout=120,
    )
    assert reparsed.returncode == 0
    text = (tmp_path / "re.md").read_text(encoding="utf-8")
    assert "민원 처리 개선 보고" in text


def test_custom_patch_requires_some_content(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    template_path = _upload_template(client, GONGMUN_FORM_TEMPLATE)
    response = client.post(
        "/api/documents/authoring/custom-patch",
        json={"template_path": template_path, "instruction": "   "},
    )
    assert response.status_code == 400
    assert "반영할 내용이 없습니다" in response.json()["detail"]


def test_build_custom_patch_markdown_preserves_tables_and_fixed_phrases() -> None:
    template_markdown = (
        "# 신청 안내\n\n"
        "기존 안내 문단입니다.\n\n"
        "| 항목 | 값 |\n| --- | --- |\n\n"
        "위 내용이 사실과 다름없음을 확인합니다.\n\n"
        "□ 기존 개조식 항목\n\n"
        "신청인: (서명)"
    )
    edited, replaced = build_custom_patch_markdown(template_markdown, ORGANIZED_FOR_PATCH)
    blocks = edited.split("\n\n")
    # 표·확인문·서명란은 원본 그대로
    assert "| 항목 | 값 |\n| --- | --- |" in edited
    assert "위 내용이 사실과 다름없음을 확인합니다." in blocks
    assert "신청인: (서명)" in blocks
    # 본문 문단과 개조식 항목은 정리된 내용으로 교체 (글머리 유지)
    assert replaced >= 2
    assert "민원 처리 개선 보고" in edited
    assert any(block.startswith("□ ") and "기존 개조식" not in block for block in blocks)
    # 블록 수는 유지된다(kordoc patch 대응)
    assert len(blocks) == len(template_markdown.split("\n\n"))
