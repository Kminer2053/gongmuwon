"""T-02 컨텍스트 예산 관리자 테스트: 조립기 단위 + 턴 통합(롤링 요약/토큰 추정)."""

from pathlib import Path

from gongmu_sidecar.app import create_app
from gongmu_sidecar.context_budget import (
    SUMMARY_BLOCK_HEADER,
    assemble_transcript_context,
    assemble_turn_context,
    deterministic_digest,
    estimate_tokens,
)
from gongmu_sidecar.llm import LLMGenerationError, LLMGenerationResult


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _messages(count: int, chars_per_message: int = 200) -> list[dict]:
    items = []
    for index in range(count):
        role = "user" if index % 2 == 0 else "assistant"
        items.append(
            {
                "id": f"m{index}",
                "role": role,
                "text": f"메시지{index} " + ("가" * chars_per_message),
                "status": "completed",
            }
        )
    return items


# ---------------------------------------------------------------------------
# estimate_tokens
# ---------------------------------------------------------------------------


def test_estimate_tokens_heuristic() -> None:
    assert estimate_tokens("") == 0
    assert estimate_tokens(None) == 0
    # chars/2.5 + 1 보정 (25자 → 11)
    assert estimate_tokens("가" * 25) == 11
    assert estimate_tokens("a") == 1


# ---------------------------------------------------------------------------
# assemble_turn_context
# ---------------------------------------------------------------------------


def test_assemble_turn_context_fits_all_without_summary_block() -> None:
    session_messages = _messages(4, chars_per_message=50)
    prompt, summary_used, stats = assemble_turn_context(
        guardrail_block="[가드레일]",
        knowledge_block="[지식폴더 근거]\n1. 문서",
        attachment_block="[Attached files]\n- a.txt",
        session_messages=session_messages,
        rolling_summary="과거 논의 요약",  # 전부 원문이 들어가므로 요약은 쓰이지 않아야 한다
        budget_tokens=6000,
    )

    assert summary_used is False
    assert stats["included_turns"] == 4
    assert stats["summarized_turns"] == 0
    assert stats["estimated_tokens"] > 0
    # 고정 순서: 가드레일 → 지식 → 첨부 → 최근 턴 원문(시간순)
    assert prompt[0]["text"] == "[가드레일]"
    assert prompt[0]["role"] == "system"
    assert prompt[1]["text"].startswith("[지식폴더 근거]")
    assert prompt[2]["text"].startswith("[Attached files]")
    assert [message["id"] for message in prompt[3:]] == ["m0", "m1", "m2", "m3"]
    assert not any(SUMMARY_BLOCK_HEADER in message["text"] for message in prompt)


def test_assemble_turn_context_overflow_uses_summary_block_in_order() -> None:
    session_messages = _messages(10, chars_per_message=400)  # 메시지당 약 161토큰
    prompt, summary_used, stats = assemble_turn_context(
        guardrail_block="[가드레일]",
        knowledge_block=None,
        attachment_block=None,
        session_messages=session_messages,
        rolling_summary="예산 초과 시 요약으로 대표되는 과거 대화",
        budget_tokens=600,
    )

    assert summary_used is True
    assert 1 <= stats["included_turns"] < 10
    assert stats["summarized_turns"] == 10 - stats["included_turns"]
    assert stats["estimated_tokens"] <= 600 + estimate_tokens(session_messages[-1]["text"])
    # 순서: 가드레일 → [이전 대화 요약] → 최근 턴 원문
    assert prompt[0]["text"] == "[가드레일]"
    assert prompt[1]["text"].startswith(SUMMARY_BLOCK_HEADER)
    assert "예산 초과 시 요약" in prompt[1]["text"]
    # 최신 메시지는 반드시 포함되고, 남은 턴은 시간순을 유지한다
    assert prompt[-1]["id"] == "m9"
    included_ids = [message["id"] for message in prompt[2:]]
    assert included_ids == sorted(included_ids, key=lambda item: int(item[1:]))
    assert "m0" not in included_ids


def test_assemble_turn_context_overflow_without_summary_just_drops_old_turns() -> None:
    session_messages = _messages(8, chars_per_message=400)
    prompt, summary_used, stats = assemble_turn_context(
        guardrail_block="[가드레일]",
        knowledge_block=None,
        attachment_block=None,
        session_messages=session_messages,
        rolling_summary=None,
        budget_tokens=600,
    )

    assert summary_used is False
    assert stats["summarized_turns"] > 0
    assert not any(SUMMARY_BLOCK_HEADER in message["text"] for message in prompt)
    assert prompt[-1]["id"] == "m7"


def test_assemble_turn_context_always_includes_newest_message_even_over_budget() -> None:
    session_messages = _messages(3, chars_per_message=4000)
    prompt, _summary_used, stats = assemble_turn_context(
        guardrail_block="[가드레일]",
        knowledge_block=None,
        attachment_block=None,
        session_messages=session_messages,
        rolling_summary=None,
        budget_tokens=100,
    )

    assert stats["included_turns"] == 1
    assert prompt[-1]["id"] == "m2"


# ---------------------------------------------------------------------------
# assemble_transcript_context (문서작성 transcript)
# ---------------------------------------------------------------------------


def test_assemble_transcript_context_summarizes_old_turns() -> None:
    session_messages = _messages(10, chars_per_message=400)
    transcript, stats = assemble_transcript_context(
        session_messages=session_messages,
        rolling_summary="이전 대화의 핵심 요약",
        budget_tokens=600,
    )

    assert transcript[0]["role"] == "summary"
    assert transcript[0]["text"].startswith(SUMMARY_BLOCK_HEADER)
    assert stats["summarized_turns"] > 0
    assert transcript[-1]["text"].startswith("메시지9")


# ---------------------------------------------------------------------------
# deterministic_digest
# ---------------------------------------------------------------------------


def test_deterministic_digest_accumulates_bullets_and_caps_length() -> None:
    digest = deterministic_digest(None, "예산 보고서 초안을 만들어 주세요. 추가 설명입니다.")
    assert digest is not None
    assert digest.startswith("- 예산 보고서 초안을")

    grown = deterministic_digest(digest, "두 번째 요청입니다")
    assert grown is not None
    assert grown.splitlines()[0].startswith("- 예산 보고서")
    assert grown.splitlines()[-1] == "- 두 번째 요청입니다"

    huge = digest
    for index in range(100):
        huge = deterministic_digest(huge, f"요청 {index} " + "가" * 100)
    assert huge is not None
    assert len(huge) <= 800
    # 최신 bullet 이 유지된다
    assert "요청 99" in huge


# ---------------------------------------------------------------------------
# 턴 통합: input_token_estimate / 롤링 요약 갱신
# ---------------------------------------------------------------------------


def test_turn_response_exposes_input_token_estimate_and_job_payload(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(text="답변", provider="ollama", model="stub")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "토큰 추정 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "토큰 추정치를 보여줘"},
    )

    assert response.status_code == 201
    payload = response.json()
    context_summary = payload["context_summary"]
    assert context_summary["input_token_estimate"] > 0
    assert context_summary["context_included_turns"] >= 1
    assert context_summary["context_summary_used"] is False
    assert payload["work_job"]["result"]["input_token_estimate"] == context_summary["input_token_estimate"]

    events = client.get(f"/api/jobs/{payload['work_job']['id']}/events").json()["items"]
    llm_stage = next(
        event for event in events if event["payload"].get("input_token_estimate") is not None
    )
    assert llm_stage["payload"]["input_token_estimate"] == context_summary["input_token_estimate"]


def test_turn_updates_rolling_summary_with_stub_llm(tmp_path: Path, monkeypatch) -> None:
    responses = iter(
        [
            LLMGenerationResult(text="턴 답변입니다.", provider="ollama", model="stub"),
            LLMGenerationResult(text="요약: 예산 보고 논의 진행 중.", provider="ollama", model="stub"),
        ]
    )

    def fake_generate_reply(settings, messages, **kwargs):
        return next(responses)

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "요약 갱신 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "예산 보고서를 준비해줘"},
    )
    assert response.status_code == 201

    services = client.app.state.services
    row = services.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
    assert row["context_summary_text"] == "요약: 예산 보고 논의 진행 중."
    assert row["context_summary_upto"] == response.json()["assistant_message"]["id"]


def test_turn_summary_falls_back_to_deterministic_digest(tmp_path: Path, monkeypatch) -> None:
    calls = {"count": 0}

    def fake_generate_reply(settings, messages, **kwargs):
        calls["count"] += 1
        if calls["count"] == 1:
            return LLMGenerationResult(text="턴 답변입니다.", provider="ollama", model="stub")
        raise LLMGenerationError("summary llm unavailable")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "다이제스트 폴백 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "예산 집행 현황을 정리해줘"},
    )
    assert response.status_code == 201

    services = client.app.state.services
    row = services.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
    assert row["context_summary_text"] == "- 예산 집행 현황을 정리해줘"


def test_turn_prompt_uses_summary_block_when_budget_is_small(tmp_path: Path, monkeypatch) -> None:
    captured_calls: list[list[dict]] = []

    def fake_generate_reply(settings, messages, **kwargs):
        captured_calls.append(list(messages))
        return LLMGenerationResult(text="답변", provider="ollama", model="stub")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    services = client.app.state.services
    services.settings = services.settings.model_copy(update={"context_budget_tokens": 700})

    session = client.post("/api/work-sessions", json={"title": "예산 축소 테스트"})
    session_id = session.json()["id"]
    for index in range(6):
        client.post(
            f"/api/work-sessions/{session_id}/messages",
            json={"role": "user" if index % 2 == 0 else "assistant", "text": f"긴 과거 메시지 {index} " + "가" * 800},
        )
    services.db.execute(
        "UPDATE work_sessions SET context_summary_text = ? WHERE id = ?",
        ("과거 대화 롤링 요약입니다.", session_id),
    )

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "이제 결론을 정리해줘"},
    )

    assert response.status_code == 201
    context_summary = response.json()["context_summary"]
    assert context_summary["context_summary_used"] is True
    assert context_summary["context_summarized_turns"] > 0

    turn_messages = captured_calls[0]
    summary_block = next(message for message in turn_messages if SUMMARY_BLOCK_HEADER in message["text"])
    assert summary_block["role"] == "system"
    assert "과거 대화 롤링 요약입니다." in summary_block["text"]
    assert turn_messages[-1]["text"] == "이제 결론을 정리해줘"
    assert not any("긴 과거 메시지 0" in message["text"] for message in turn_messages)
