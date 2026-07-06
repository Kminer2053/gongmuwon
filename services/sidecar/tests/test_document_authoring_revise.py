"""F-08 revise 엔드포인트 + T-02 문서작성 transcript 축약 테스트."""

import json
from pathlib import Path

from gongmu_sidecar.app import create_app
from gongmu_sidecar.context_budget import SUMMARY_BLOCK_HEADER
from gongmu_sidecar.document_authoring import register_authoring_routes
from gongmu_sidecar.llm import LLMGenerationError


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


CURRENT_ONEPAGE = {
    "title": "청사 에너지 절감 추진계획 보고",
    "summary": "전력 사용량 12% 절감을 위해 3개 과제를 하반기에 즉시 추진",
    "sections": [
        {
            "heading": "추진 배경",
            "items": ["2025년 청사 전력비 3.2억 원, 전년 대비 8% 증가"],
        },
        {
            "heading": "주요 과제",
            "items": ["냉난방 설정온도 자동제어 도입", "옥상 태양광 50kW 증설"],
        },
    ],
}


# ---------------------------------------------------------------------------
# F-08 revise
# ---------------------------------------------------------------------------


def test_revise_returns_updated_structure_with_preview_and_meta(tmp_path: Path) -> None:
    revised = dict(CURRENT_ONEPAGE, title="2026년 청사 에너지 절감 종합 보고")
    stub = StubLLM([json.dumps(revised, ensure_ascii=False)])
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/revise",
        json={
            "format": "onePageReport",
            "structure": CURRENT_ONEPAGE,
            "instruction": "제목을 2026년 종합 보고로 바꿔줘",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["format"] == "onePageReport"
    assert payload["structure"]["title"] == "2026년 청사 에너지 절감 종합 보고"
    assert "2026년 청사 에너지 절감 종합 보고" in payload["preview"]
    assert payload["meta"] == {"attempts": 1, "repaired": False, "hints": []}

    # 프롬프트에 현재 구조와 수정 지시가 함께 전달돼야 한다
    assert len(stub.calls) == 1
    system_text = stub.calls[0]["messages"][0]["text"]
    assert "수정 지시" in system_text
    assert "최소 변경" in system_text
    user_text = stub.calls[0]["messages"][1]["text"]
    assert "[현재 문서 구조 JSON]" in user_text
    assert "청사 에너지 절감 추진계획 보고" in user_text
    assert "[수정 지시]" in user_text
    assert "제목을 2026년 종합 보고로 바꿔줘" in user_text


def test_revise_rejects_invalid_current_structure_with_korean_hints(tmp_path: Path) -> None:
    stub = StubLLM([])  # 검증 실패 시 LLM 은 호출되지 않아야 한다
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/revise",
        json={
            "format": "onePageReport",
            "structure": {"title": "제목만 있는 구조"},
            "instruction": "요약을 다듬어줘",
        },
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["message"] == "구조 JSON이 양식 스키마에 맞지 않습니다."
    assert any("summary" in hint for hint in detail["hints"])
    assert any("sections" in hint for hint in detail["hints"])
    assert stub.calls == []


def test_revise_rejects_blank_instruction(tmp_path: Path) -> None:
    stub = StubLLM([])
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/revise",
        json={"format": "onePageReport", "structure": CURRENT_ONEPAGE, "instruction": "   "},
    )

    assert response.status_code == 400
    assert response.json()["detail"]["message"] == "수정 지시가 비어 있습니다."
    assert stub.calls == []


def test_revise_falls_back_to_current_structure_after_retry_failure(tmp_path: Path) -> None:
    stub = StubLLM(["JSON 아님", "여전히 JSON 아님"])
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/revise",
        json={
            "format": "onePageReport",
            "structure": CURRENT_ONEPAGE,
            "instruction": "섹션을 재구성해줘",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    # 최후 방어선: 검증된 기존 구조를 그대로 유지 (무변경 = 최소 변경의 극단)
    assert payload["structure"]["title"] == CURRENT_ONEPAGE["title"]
    assert payload["meta"]["attempts"] == 2
    assert payload["meta"]["repaired"] is True
    assert any("기존 구조를 유지" in hint for hint in payload["meta"]["hints"])
    assert len(stub.calls) == 2
    retry_text = stub.calls[1]["messages"][-1]["text"]
    assert "오류" in retry_text


def test_revise_falls_back_when_llm_call_fails(tmp_path: Path) -> None:
    stub = StubLLM([LLMGenerationError("서버 연결 실패")])
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/revise",
        json={
            "format": "onePageReport",
            "structure": CURRENT_ONEPAGE,
            "instruction": "요약을 더 짧게",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["structure"]["title"] == CURRENT_ONEPAGE["title"]
    assert payload["meta"]["repaired"] is True


# ---------------------------------------------------------------------------
# T-02: 문서작성 transcript 축약 (최근 턴 + 롤링 요약)
# ---------------------------------------------------------------------------


def test_authoring_structure_transcript_is_trimmed_with_rolling_summary(tmp_path: Path) -> None:
    stage2_json = json.dumps(
        {
            "title": "업무 정리 보고",
            "summary": "최근 논의만 반영한 보고",
            "sections": [
                {"heading": "주요 내용", "items": ["최근 결정 사항 정리"]},
                {"heading": "후속 조치", "items": ["다음 주 실행"]},
            ],
        },
        ensure_ascii=False,
    )
    organized_md = "# 업무 정리 보고\n## 주요 내용\n- 최근 결정 사항 정리\n## 후속 조치\n- 다음 주 실행"
    stub = StubLLM([organized_md, stage2_json])
    client = _client(tmp_path, stub)
    services = client.app.state.services
    services.settings = services.settings.model_copy(update={"context_budget_tokens": 600})

    session = client.post("/api/work-sessions", json={"title": "축약 테스트"})
    session_id = session.json()["id"]
    for index in range(8):
        client.post(
            f"/api/work-sessions/{session_id}/messages",
            json={
                "role": "user" if index % 2 == 0 else "assistant",
                "text": f"오래된 대화 {index} " + "가" * 700,
            },
        )
    client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "user", "text": "최신 결정: 태양광 증설로 확정"},
    )
    services.db.execute(
        "UPDATE work_sessions SET context_summary_text = ? WHERE id = ?",
        ("과거에는 예산과 일정 조정을 논의했다.", session_id),
    )

    response = client.post(
        "/api/documents/authoring/structure",
        json={
            "format": "onePageReport",
            "instruction": "세션 내용을 보고서로",
            "session_id": session_id,
            "stream": False,
        },
    )

    assert response.status_code == 200
    organize_user_text = stub.calls[0]["messages"][1]["text"]
    assert "[업무대화 기록]" in organize_user_text
    # 요약 블록은 원문 그대로, 역할 접두사 없이 실린다
    assert SUMMARY_BLOCK_HEADER in organize_user_text
    assert "과거에는 예산과 일정 조정을 논의했다." in organize_user_text
    assert f"어시스턴트: {SUMMARY_BLOCK_HEADER}" not in organize_user_text
    # 최신 턴 원문은 유지, 예산 밖의 가장 오래된 턴 원문은 제외
    assert "최신 결정: 태양광 증설로 확정" in organize_user_text
    assert "오래된 대화 0" not in organize_user_text
