import json
from pathlib import Path
from zipfile import ZipFile

import pytest

from gongmu_sidecar.app import create_app
from gongmu_sidecar.document_authoring import FORMAT_SYSTEM_PROMPTS
from gongmu_sidecar.llm import LLMGenerationError, LLMGenerationResult
from test_document_authoring import (
    EMAIL_JSON,
    FULL_JSON,
    GONGMUN_JSON,
    ONEPAGE_JSON,
    ORGANIZED_MD,
)


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


_STRUCTURE_BY_FORMAT = {
    "onePageReport": ONEPAGE_JSON,
    "fullReport": FULL_JSON,
    "officialMemo": GONGMUN_JSON,
    "email": EMAIL_JSON,
}
_FORMAT_BY_SYSTEM_PROMPT = {value: key for key, value in FORMAT_SYSTEM_PROMPTS.items()}


def authoring_aware_reply(settings, messages, **kwargs):
    """2026-07-08 리뷰: 업무대화 문서작성이 문서작성 UI와 동일한 authoring 파이프라인
    (organize→format_to_schema)을 호출하도록 통일됐다. organize/format/일반챗을 구분해
    유효한 응답을 돌려주는 공용 스텁 — LLM이 실제로 문서 내용을 생성함을 검증한다."""
    system_text = ""
    for message in messages:
        if message.get("role") == "system":
            system_text = str(message.get("text") or "")
            break
    fmt = _FORMAT_BY_SYSTEM_PROMPT.get(system_text)
    if fmt is not None:  # format_to_schema 단계
        return LLMGenerationResult(
            text=json.dumps(_STRUCTURE_BY_FORMAT[fmt], ensure_ascii=False),
            provider="ollama",
            model="gemma4:e2b",
        )
    if "참고자료" in system_text or "구조화 마크다운" in system_text:  # organize_content 단계
        return LLMGenerationResult(text=ORGANIZED_MD, provider="ollama", model="gemma4:e2b")
    return LLMGenerationResult(text="확인했습니다.", provider="ollama", model="gemma4:e2b")


def _extract_hwpx_text(path: Path) -> str:
    chunks: list[str] = []
    with ZipFile(path) as archive:
        for name in archive.namelist():
            if name.lower().endswith(".xml") or name == "Preview/PrvText.txt":
                chunks.append(archive.read(name).decode("utf-8", errors="ignore"))
    return "\n".join(chunks)


def test_work_session_turn_persists_user_and_assistant_messages(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        assert settings.llm_provider == "ollama"
        assert messages[-1]["role"] == "user"
        assert messages[-1]["text"] == "주간 보고 초안을 만들어줘"
        assert all(message["status"] != "pending" for message in messages)
        return LLMGenerationResult(
            text="검토 초안을 먼저 정리해보겠습니다.",
            provider="openai_compatible",
            model="gpt-4.1-mini",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "업무대화 테스트"})
    assert session.status_code == 201
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "주간 보고 초안을 만들어줘"},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["user_message"]["role"] == "user"
    assert payload["assistant_message"]["role"] == "assistant"
    assert payload["assistant_message"]["status"] == "completed"
    assert payload["assistant_message"]["text"] == "검토 초안을 먼저 정리해보겠습니다."

    messages = client.get(f"/api/work-sessions/{session_id}/messages")
    items = messages.json()["items"]
    assert len(items) == 2
    assert items[0]["text"] == "주간 보고 초안을 만들어줘"
    assert items[1]["status"] == "completed"

    logs = client.get("/api/execution-logs")
    actions = [entry["action"] for entry in logs.json()["items"]]
    assert "work_session.turn.completed" not in actions
    assert "work_session.message.created" not in actions


def test_work_session_turn_records_ordered_work_job(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text="작업 순서를 지켜 답변했습니다.",
            provider="ollama",
            model="qwen3.6:27b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "동시작업 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "순서 보장 테스트"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["work_job"]["kind"] == "work_session.turn"
    assert payload["work_job"]["status"] == "succeeded"
    assert payload["work_job"]["resource_key"] == f"work_session:{session_id}"
    assert payload["work_job"]["resource_policy"] == "exclusive"
    assert payload["work_job"]["result"]["assistant_message_id"] == payload["assistant_message"]["id"]

    events = client.get(f"/api/jobs/{payload['work_job']['id']}/events").json()["items"]
    assert any(event["event_type"] == "job.progress" for event in events)
    assert events[-1]["event_type"] == "job.succeeded"


def test_work_session_turn_blocks_when_same_session_job_is_running(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        raise AssertionError("blocked turn must not call the LLM")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "동시작업 테스트"})
    session_id = session.json()["id"]
    services = client.app.state.services
    running_job = services.jobs.create_job(
        kind="work_session.turn",
        title="이미 실행 중인 응답",
        input={"session_id": session_id},
        resource_key=f"work_session:{session_id}",
        resource_policy="exclusive",
    )
    services.jobs.start_job_with_lock(running_job["id"], stage="LLM 응답 생성")

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "바로 이어서 질문"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["work_job"]["status"] == "blocked"
    assert payload["work_job"]["resource_key"] == f"work_session:{session_id}"
    assert "앞선 응답" in payload["assistant_message"]["text"]
    assert payload["assistant_message"]["provider"] == "gongmu-system"


def test_work_session_turn_runs_multiple_clear_tool_intents_in_order(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", authoring_aware_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "다중도구 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "내일 오후 2시 회의 일정 등록하고 이 내용으로 1페이지 보고서 hwpx 문서작성 해줘"},
    )

    assert response.status_code == 201
    payload = response.json()
    text = payload["assistant_message"]["text"]
    assert "## 일정 등록" in text
    assert "일정을 등록했습니다." in text
    assert "## 문서작성" in text
    assert "HWPX 문서를 생성했습니다" in text
    assert payload["context_summary"]["skill_actions"][:2] == [
        "intent.plan",
        "schedule.create",
    ]
    assert "document.create" in payload["context_summary"]["skill_actions"]
    assert payload["work_job"]["status"] == "succeeded"


def test_work_session_turn_does_not_persist_waiting_placeholder_after_completion(
    tmp_path: Path, monkeypatch
) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text="최종 답변입니다.",
            provider="ollama",
            model="qwen3.6:27b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "테스트"})
    assert session.status_code == 201
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "안녕", "attachment_ids": []},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["assistant_message"]["status"] == "completed"
    assert payload["assistant_message"]["text"] == "최종 답변입니다."
    assert "기다려" not in payload["assistant_message"]["text"]
    assert "준비" not in payload["assistant_message"]["text"]


def test_work_session_turn_routes_feature_usage_questions_to_local_guide(tmp_path: Path, monkeypatch) -> None:
    def fail_if_llm_called(settings, messages, **kwargs):
        raise AssertionError("feature usage guide should not call the LLM")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fail_if_llm_called)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "사용법 테스트"})
    assert session.status_code == 201
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "업무대화랑 문서작성 사용법 안내해줄래?"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["assistant_message"]["provider"] == "gongmu-skill"
    assert payload["context_summary"]["skill_actions"] == ["help.guide"]
    assert "업무대화" in payload["assistant_message"]["text"]
    assert "일정" in payload["assistant_message"]["text"]
    assert "문서작성" in payload["assistant_message"]["text"]
    assert "내 지식폴더" in payload["assistant_message"]["text"]
    assert "실행기록" in payload["assistant_message"]["text"]
    assert "환경설정" in payload["assistant_message"]["text"]
    assert "파일찾기" not in payload["assistant_message"]["text"]
    assert "파일 연결" in payload["assistant_message"]["text"]


def test_work_session_turn_records_failed_assistant_message(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        raise LLMGenerationError("LLM server URL is not configured.")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "오류 테스트"})
    assert session.status_code == 201
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "초안을 도와줘"},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["assistant_message"]["status"] == "failed"
    assert "LLM 응답 생성에 실패했습니다." in payload["assistant_message"]["text"]

    messages = client.get(f"/api/work-sessions/{session_id}/messages")
    items = messages.json()["items"]
    assert len(items) == 2
    assert items[1]["status"] == "failed"

    logs = client.get("/api/execution-logs")
    actions = [entry["action"] for entry in logs.json()["items"]]
    assert "work_session.turn.failed" in actions


def test_work_session_turn_injects_graphrag_context_by_default(tmp_path: Path, monkeypatch) -> None:
    captured_messages = []

    def fake_generate_reply(settings, messages, **kwargs):
        captured_messages.extend(messages)
        return LLMGenerationResult(
            text="지식폴더 근거를 반영한 답변입니다.",
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)

    def fake_retrieve(**kwargs):
        assert kwargs["session_id"]
        assert kwargs["query"] == "AI 전략 방향성 알려줘"
        return {
            "items": [
                {
                    "document": {
                        "title": "AI 전략 보고서",
                        "file_path": "D:/docs/ai-strategy.pdf",
                    },
                    "text": "AI 전략은 업무대화와 지식폴더 근거를 함께 활용한다.",
                    "evidence_type": "section",
                    "quality_warnings": [],
                    "relations": [{"relation": "REFERENCES", "target_label": "AI 정책"}],
                }
            ]
        }

    monkeypatch.setattr(client.app.state.services.wiki, "retrieve", fake_retrieve)
    session = client.post("/api/work-sessions", json={"title": "GraphRAG 테스트"})
    assert session.status_code == 201
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "AI 전략 방향성 알려줘"},
    )

    assert response.status_code == 201
    guardrail_context = captured_messages[0]
    assert guardrail_context["role"] == "system"
    assert "민감정보" in guardrail_context["text"]
    system_context = next(message for message in captured_messages if "[지식폴더 근거]" in message["text"])
    assert system_context["role"] == "system"
    assert "AI 전략 보고서" in system_context["text"]
    assert "D:/docs/ai-strategy.pdf" in system_context["text"]
    assert "AI 전략은 업무대화와 지식폴더 근거" in system_context["text"]


def test_work_session_turn_uses_nested_retrieval_chunk_text(tmp_path: Path, monkeypatch) -> None:
    captured_messages = []

    def fake_generate_reply(settings, messages, **kwargs):
        captured_messages.extend(messages)
        return LLMGenerationResult(
            text="Nested GraphRAG evidence was included.",
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)

    def fake_retrieve(**kwargs):
        assert kwargs["session_id"]
        return {
            "items": [
                {
                    "document": {
                        "title": "Prompt guide",
                        "file_path": "D:/docs/prompt-guide.md",
                    },
                    "chunk": {
                        "text": "Prompt work should include purpose, constraints, and output format."
                    },
                    "evidence_type": "section",
                    "relations": [],
                }
            ]
        }

    monkeypatch.setattr(client.app.state.services.wiki, "retrieve", fake_retrieve)
    session = client.post("/api/work-sessions", json={"title": "Nested GraphRAG test"})
    assert session.status_code == 201
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "Find prompt guidance"},
    )

    assert response.status_code == 201
    system_context = next(message for message in captured_messages if "[지식폴더 근거]" in message["text"])
    assert system_context["role"] == "system"
    assert "Prompt guide" in system_context["text"]
    assert "Prompt work should include purpose, constraints, and output format." in system_context["text"]


def test_work_session_turn_redacts_sensitive_rag_values_in_prompt_and_reply(tmp_path: Path, monkeypatch) -> None:
    captured_messages = []

    def fake_generate_reply(settings, messages, **kwargs):
        captured_messages.extend(messages)
        return LLMGenerationResult(
            text="확인 결과 password: raw-secret-value 가 문서에 있습니다.",
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)
    client = _client(tmp_path)

    def fake_retrieve(**kwargs):
        return {
            "items": [
                {
                    "document": {"title": "운영 계정", "file_path": "D:/secure/account.md"},
                    "text": "운영 서버 비밀번호: very-secret-password API key = sk-test-secret",
                    "evidence_type": "section",
                    "relations": [],
                }
            ]
        }

    monkeypatch.setattr(client.app.state.services.wiki, "retrieve", fake_retrieve)
    session = client.post("/api/work-sessions", json={"title": "보안 가드레일 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "운영 계정 내용을 요약해줘"},
    )

    assert response.status_code == 201
    graph_context = next(message for message in captured_messages if "[지식폴더 근거]" in message["text"])
    assert "very-secret-password" not in graph_context["text"]
    assert "sk-test-secret" not in graph_context["text"]
    assert "[보호됨]" in graph_context["text"]
    assert "raw-secret-value" not in response.json()["assistant_message"]["text"]
    assert "password: [보호됨]" in response.json()["assistant_message"]["text"]


def test_work_session_turn_sends_knowledge_queries_to_llm_with_evidence_block(
    tmp_path: Path, monkeypatch
) -> None:
    captured_messages = []

    def fake_generate_reply(settings, messages, **kwargs):
        captured_messages.extend(messages)
        return LLMGenerationResult(
            text="AI 전략은 내부 지식과 실행 근거를 함께 사용하는 방향입니다.",
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)

    def fake_retrieve(**kwargs):
        assert kwargs["session_id"]
        return {
            "items": [
                {
                    "document": {"title": "AI 전략 보고서", "file_path": str(tmp_path / "AI전략보고서.pdf")},
                    "text": "AI 전략은 내부 지식과 실행 근거를 함께 사용한다.",
                    "evidence_type": "wiki",
                    "relations": [],
                }
            ]
        }

    monkeypatch.setattr(client.app.state.services.wiki, "retrieve", fake_retrieve)
    session = client.post("/api/work-sessions", json={"title": "지식 검색 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "지식폴더에서 AI 전략 방향성 찾아봐"},
    )

    assert response.status_code == 201
    assistant_message = response.json()["assistant_message"]
    assert assistant_message["status"] == "completed"
    assert assistant_message["provider"] == "ollama"
    assert "AI 전략은 내부 지식과 실행 근거" in assistant_message["text"]
    evidence = next(message for message in captured_messages if "[지식폴더 근거]" in message["text"])
    assert "AI 전략 보고서" in evidence["text"]
    assert "각 내용 뒤에 (출처: 문서 제목) 형식으로 인용하세요" in evidence["text"]
    assert "파일 경로는 답변에 쓰지 마세요" in evidence["text"]
    assert response.json()["context_summary"]["graphrag_used"] is True


def test_work_session_turn_persists_and_returns_citations_from_knowledge_evidence(
    tmp_path: Path, monkeypatch
) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text="AI 전략은 내부 지식과 실행 근거를 함께 사용하는 방향입니다. (출처: AI 전략 보고서)",
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    file_path = str(tmp_path / "AI전략보고서.pdf")

    def fake_retrieve(**kwargs):
        return {
            "items": [
                {
                    "document": {"title": "AI 전략 보고서", "file_path": file_path},
                    "text": "AI 전략은 내부 지식과 실행 근거를 함께 사용한다.",
                    "evidence_type": "wiki",
                    "relations": [],
                }
            ]
        }

    monkeypatch.setattr(client.app.state.services.wiki, "retrieve", fake_retrieve)
    session = client.post("/api/work-sessions", json={"title": "인용 저장 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "지식폴더에서 AI 전략 방향성 찾아봐"},
    )

    assert response.status_code == 201
    assistant_message = response.json()["assistant_message"]
    assert assistant_message["citations"] == [
        {
            "title": "AI 전략 보고서",
            "file_path": file_path,
            "snippet": "AI 전략은 내부 지식과 실행 근거를 함께 사용한다.",
            "doc_uid": "",
        }
    ]

    # Round-trip through the messages listing endpoint (fresh serialization pass).
    messages = client.get(f"/api/work-sessions/{session_id}/messages").json()["items"]
    assistant_row = next(item for item in messages if item["role"] == "assistant")
    assert assistant_row["citations"] == [
        {
            "title": "AI 전략 보고서",
            "file_path": file_path,
            "snippet": "AI 전략은 내부 지식과 실행 근거를 함께 사용한다.",
            "doc_uid": "",
        }
    ]
    assert "citations_json" not in assistant_row


def test_work_session_turn_creates_schedule_from_chat_instruction(tmp_path: Path, monkeypatch) -> None:
    def fail_if_llm_called(settings, messages, **kwargs):
        raise AssertionError("schedule skill should create schedule without generic LLM fallback")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fail_if_llm_called)
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "일정 등록 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "2026-05-20 15:00 AI 전략회의 일정 등록해줘"},
    )

    assert response.status_code == 201
    assistant_message = response.json()["assistant_message"]
    assert assistant_message["status"] == "completed"
    assert "일정을 등록했습니다" in assistant_message["text"]
    assert "AI 전략회의" in assistant_message["text"]
    assert response.json()["context_summary"]["skill_actions"] == ["schedule.create"]

    schedules = client.get("/api/schedules").json()["items"]
    assert schedules[0]["title"] == "AI 전략회의"
    assert schedules[0]["starts_at"].startswith("2026-05-20T15:00:00")


def test_work_session_turn_creates_schedule_from_korean_natural_datetime(tmp_path: Path, monkeypatch) -> None:
    def fail_if_llm_called(settings, messages, **kwargs):
        raise AssertionError("natural Korean schedule skill should create schedule without generic LLM fallback")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fail_if_llm_called)
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "자연어 일정 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "2026년 5월 21일 오후 4시에 예산 검토 회의 업무일정 등록해줘"},
    )

    assert response.status_code == 201
    assistant_message = response.json()["assistant_message"]
    assert assistant_message["status"] == "completed"
    assert "일정을 등록했습니다" in assistant_message["text"]
    assert response.json()["context_summary"]["skill_actions"] == ["schedule.create"]

    schedules = client.get("/api/schedules").json()["items"]
    assert schedules[0]["title"] == "예산 검토 회의"
    assert schedules[0]["starts_at"].startswith("2026-05-21T16:00:00")


def test_work_session_turn_accepts_english_schedule_command(tmp_path: Path, monkeypatch) -> None:
    def fail_if_llm_called(settings, messages, **kwargs):
        raise AssertionError("english schedule skill should create schedule without generic LLM fallback")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fail_if_llm_called)
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "UI smoke session"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "2026-05-21 16:00 UI smoke schedule add"},
    )

    assert response.status_code == 201
    assistant_message = response.json()["assistant_message"]
    assert "일정을 등록했습니다" in assistant_message["text"]
    assert "UI smoke" in assistant_message["text"]
    assert response.json()["context_summary"]["skill_actions"] == ["schedule.create"]

    schedules = client.get("/api/schedules").json()["items"]
    assert schedules[0]["title"] == "UI smoke"


def test_work_session_turn_deletes_schedule_from_chat_instruction(tmp_path: Path, monkeypatch) -> None:
    def fail_if_llm_called(settings, messages, **kwargs):
        raise AssertionError("schedule delete skill should not call generic LLM fallback")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fail_if_llm_called)
    client = _client(tmp_path)
    schedule = client.post(
        "/api/schedules",
        json={
            "title": "삭제할 회의",
            "starts_at": "2026-05-20T15:00:00+09:00",
            "ends_at": "2026-05-20T16:00:00+09:00",
            "view": "day",
        },
    )
    assert schedule.status_code == 201
    session = client.post("/api/work-sessions", json={"title": "일정 삭제 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "삭제할 회의 일정 삭제해줘"},
    )

    assert response.status_code == 201
    assistant_message = response.json()["assistant_message"]
    assert "일정을 삭제했습니다" in assistant_message["text"]
    assert "삭제할 회의" in assistant_message["text"]
    assert response.json()["context_summary"]["skill_actions"] == ["schedule.delete"]
    assert client.get("/api/schedules").json()["items"] == []


def test_work_session_turn_creates_hwpx_document_from_chat_instruction(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", authoring_aware_reply)
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "문서작성 테스트"})
    session_id = session.json()["id"]
    client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "user", "text": "AI 추진 배경과 향후 조치사항을 정리했습니다."},
    )
    linked_file = tmp_path / "ai-action-plan.md"
    linked_file.write_text(
        "보안형 로컬 자동화 중심으로 AI 실행계획을 수립하고, 부서별 책임자와 추진기한을 명시해야 합니다.",
        encoding="utf-8",
    )
    linked = client.post(
        f"/api/work-sessions/{session_id}/file-links",
        json={
            "items": [
                {
                    "file_path": str(linked_file),
                    "label": "AI 실행계획 근거",
                    "source": "manual",
                }
            ]
        },
    )
    assert linked.status_code == 201

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "이 세션 내용으로 1페이지 보고서 HWPX 문서작성 해줘"},
    )

    assert response.status_code == 201
    assistant_message = response.json()["assistant_message"]
    assert assistant_message["status"] == "completed"
    assert "HWPX 문서를 생성했습니다" in assistant_message["text"]
    # F-16: 제목은 세션명("... 문서")이 아니라 산출 구조의 제목을 쓴다.
    assert "청사 에너지 절감 추진계획 보고" in assistant_message["text"]
    assert "파일 열기:" in assistant_message["text"]
    assert "폴더 열기:" in assistant_message["text"]
    # F-06: 근거 유무를 응답에 명시한다(정직성).
    assert "지식폴더 근거" in assistant_message["text"]
    assert response.json()["context_summary"]["skill_actions"] == ["document.create"]

    skill_result = response.json()["context_summary"]["skill_results"][0]
    content_base_id = skill_result["content_base_id"]
    assert skill_result["work_job_status"] == "succeeded"
    assert client.get(f"/api/jobs/{skill_result['work_job_id']}").json()["kind"] == "documents.generate"
    output_path = Path(skill_result["artifact_path"])
    markdown_path = Path(skill_result["markdown_path"])
    assert content_base_id
    assert output_path.exists()
    assert markdown_path.exists()
    review_markdown = markdown_path.read_text(encoding="utf-8")
    # 통일된 파이프라인: 구조화 LLM 출력으로 문서를 채우며, 골격 잔재(플레이스홀더/"연결된
    # 파일 없음")와 프롬프트 원문 에코가 없어야 한다 (2026-07-08 리뷰 P0).
    assert "청사 에너지 절감 추진계획 보고" in review_markdown
    assert "이 세션 내용으로 1페이지 보고서 HWPX 문서작성 해줘" not in review_markdown
    assert "내용을 여기에 정리합니다" not in review_markdown
    assert "아직 연결된 파일이 없습니다" not in review_markdown
    assert "두괄식" not in review_markdown
    assert "개조식" not in review_markdown
    hwpx_text = _extract_hwpx_text(output_path)
    assert "청사 에너지 절감 추진계획 보고" in hwpx_text


def test_work_session_turn_routes_plain_hwpx_requests_to_document_skill(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", authoring_aware_reply)
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "Plain document skill session"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "Use the document creation feature and make a one page hwpx report."},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["assistant_message"]["provider"] == "gongmu-skill"
    assert payload["context_summary"]["skill_actions"] == ["document.create"]
    artifact_path = Path(payload["context_summary"]["skill_results"][0]["artifact_path"])
    assert artifact_path.exists()
    assert artifact_path.suffix == ".hwpx"


@pytest.mark.parametrize(
    ("instruction", "expected_format"),
    [
        ("보고서를 만들어줘", "onePageReport"),
        ("1p 보고서 hwpx파일로 만들어줘", "onePageReport"),
        ("회의 내용을 보고서로 정리해줘", "onePageReport"),
        ("이 세션 내용으로 공문 만들어줘", "officialMemo"),
        ("시행문 HWPX로 작성해줘", "officialMemo"),
        ("이 내용을 이메일로 정리해줘", "email"),
    ],
)
def test_work_session_turn_routes_natural_korean_report_requests_to_document_skill(
    tmp_path: Path, monkeypatch, instruction: str, expected_format: str
) -> None:
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", authoring_aware_reply)
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "보고서 자연어 라우팅"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": instruction},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["assistant_message"]["provider"] == "gongmu-skill"
    assert payload["context_summary"]["skill_actions"] == ["document.create"]
    skill_result = payload["context_summary"]["skill_results"][0]
    assert skill_result["format"] == expected_format
    artifact_path = Path(skill_result["artifact_path"])
    assert artifact_path.exists()
    assert artifact_path.suffix == ".hwpx"


def test_work_session_turn_removes_model_reasoning_trace_from_reply(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text=(
                '* User says: "한국말로 해라"\n'
                "* Context: internal planning that should not be displayed.\n"
                "* Final Decision: answer briefly.\n"
                "네, 한국어로 답변하겠습니다.\n\n무엇을 도와드릴까요?"
            ),
            provider="openai_compatible",
            model="gemma4:31b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "Reasoning strip session"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "한국말로 해라"},
    )

    assert response.status_code == 201
    text = response.json()["assistant_message"]["text"]
    assert "User says" not in text
    assert "Context:" not in text
    assert "Final Decision" not in text
    assert "네, 한국어로 답변하겠습니다." in text


def test_work_session_turn_removes_inline_model_reasoning_trace_from_reply(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text=(
                '* User says: "한국말로 해라" (Speak in Korean).\n'
                "* Language: Korean. * Style: Concise. * Policy: Follow Gongmu safety policy.\n"
                "* Confirm and continue speaking in Korean. * Keep it short and professional.네, 한국어로 답변하겠습니다.\n\n"
                "무엇을 도와드릴까요?"
            ),
            provider="openai_compatible",
            model="gemma4:31b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "Inline reasoning strip session"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "한국말로 해라"},
    )

    assert response.status_code == 201
    text = response.json()["assistant_message"]["text"]
    assert "User says" not in text
    assert "Policy:" not in text
    assert "Keep it short" not in text
    assert "네, 한국어로 답변하겠습니다." in text
    assert "무엇을 도와드릴까요?" in text


def test_work_session_turn_stream_sends_delta_events_before_done(tmp_path: Path, monkeypatch) -> None:
    def fake_stream_reply(settings, messages, *, on_delta, **kwargs):
        assert messages[-1]["role"] == "user"
        assert messages[-1]["text"] == "streaming response please"
        on_delta("첫 ")
        on_delta("응답")
        return LLMGenerationResult(text="첫 응답", provider="ollama", model="qwen-test")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply_streaming", fake_stream_reply)
    # T-02 롤링 요약 갱신(비스트림 호출)이 실제 LLM에 닿지 않도록 차단 → 결정론 다이제스트 사용
    monkeypatch.setattr(
        "gongmu_sidecar.app.generate_session_reply",
        lambda settings, messages, **kwargs: (_ for _ in ()).throw(LLMGenerationError("stub")),
    )

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "스트림 테스트"})
    session_id = session.json()["id"]

    with client.stream(
        "POST",
        f"/api/work-sessions/{session_id}/turn/stream",
        json={"text": "streaming response please"},
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        body = "".join(response.iter_text())

    assert body.index("event: delta") < body.index("event: done")
    assert '"text":"첫 "' in body
    assert '"text":"응답"' in body
    assert '"provider":"ollama"' in body
    assert '"model":"qwen-test"' in body

    messages = client.get(f"/api/work-sessions/{session_id}/messages").json()["items"]
    assistant = [message for message in messages if message["role"] == "assistant"][-1]
    assert assistant["status"] == "completed"
    assert assistant["text"] == "첫 응답"


def test_work_session_turn_stream_persists_citations_from_knowledge_evidence(
    tmp_path: Path, monkeypatch
) -> None:
    def fake_stream_reply(settings, messages, *, on_delta, **kwargs):
        on_delta("지식폴더 근거를 반영한 답변입니다.")
        return LLMGenerationResult(
            text="지식폴더 근거를 반영한 답변입니다.", provider="ollama", model="gemma4:e2b"
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply_streaming", fake_stream_reply)
    # T-02 롤링 요약 갱신(비스트림 호출)이 실제 LLM에 닿지 않도록 차단 → 결정론 다이제스트 사용
    monkeypatch.setattr(
        "gongmu_sidecar.app.generate_session_reply",
        lambda settings, messages, **kwargs: (_ for _ in ()).throw(LLMGenerationError("stub")),
    )

    client = _client(tmp_path)
    file_path = str(tmp_path / "AI전략보고서.pdf")

    def fake_retrieve(**kwargs):
        return {
            "items": [
                {
                    "document": {"title": "AI 전략 보고서", "file_path": file_path},
                    "text": "AI 전략은 내부 지식과 실행 근거를 함께 사용한다.",
                    "evidence_type": "wiki",
                    "relations": [],
                }
            ]
        }

    monkeypatch.setattr(client.app.state.services.wiki, "retrieve", fake_retrieve)
    session = client.post("/api/work-sessions", json={"title": "스트림 인용 테스트"})
    session_id = session.json()["id"]

    with client.stream(
        "POST",
        f"/api/work-sessions/{session_id}/turn/stream",
        json={"text": "지식폴더에서 AI 전략 방향성 찾아봐"},
    ) as response:
        assert response.status_code == 200
        list(response.iter_text())

    messages = client.get(f"/api/work-sessions/{session_id}/messages").json()["items"]
    assistant = [message for message in messages if message["role"] == "assistant"][-1]
    assert assistant["status"] == "completed"
    assert assistant["citations"] == [
        {
            "title": "AI 전략 보고서",
            "file_path": file_path,
            "snippet": "AI 전략은 내부 지식과 실행 근거를 함께 사용한다.",
            "doc_uid": "",
        }
    ]


def test_llm_connection_test_returns_success_result(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text="연결 테스트 응답입니다.",
            provider="openai_compatible",
            model="gpt-4.1-mini",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    response = client.post("/api/settings/llm-test", json={})
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["text"] == "연결 테스트 응답입니다."

    logs = client.get("/api/execution-logs")
    actions = [entry["action"] for entry in logs.json()["items"]]
    assert "settings.llm.test.completed" in actions


def test_llm_connection_test_returns_failure_result(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        raise LLMGenerationError("LLM server unreachable")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    response = client.post("/api/settings/llm-test", json={})
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "failed"
    assert payload["text"] == "LLM server unreachable"

    logs = client.get("/api/execution-logs")
    actions = [entry["action"] for entry in logs.json()["items"]]
    assert "settings.llm.test.failed" in actions


# ── 2026-07-14 WI-1: 멀티인텐트 라우팅 수정 회귀 (수용 G5 L-02 FAIL 원인 3중) ──


def test_multi_intent_g5_original_creates_schedule_and_email(tmp_path: Path, monkeypatch) -> None:
    """G5 원문: help.guide 선점('안내'+'일정')과 '잡고' 미매치로 완전 미작동했던 문장."""
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", authoring_aware_reply)

    client = _client(tmp_path)
    session_id = client.post("/api/work-sessions", json={"title": "G5 재현"}).json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={
            "text": (
                "다음주 화요일(2026년 7월 21일) 오후 3시에 AI 업무 추진 팀 회의 일정을 잡고, "
                "그 일정 내용으로 회의 안내 이메일도 작성해줘"
            )
        },
    )

    assert response.status_code == 201
    payload = response.json()
    actions = payload["context_summary"]["skill_actions"]
    assert actions[0] == "intent.plan"
    assert "schedule.create" in actions
    assert "document.create" in actions
    assert "help.guide" not in actions

    schedules = client.get("/api/schedules").json()["items"]
    matched = [s for s in schedules if "회의" in s["title"]]
    assert len(matched) == 1
    assert matched[0]["starts_at"] == "2026-07-21T15:00:00+09:00"
    assert matched[0]["ends_at"] == "2026-07-21T16:00:00+09:00"


def test_multi_intent_reversed_order_document_first(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", authoring_aware_reply)

    client = _client(tmp_path)
    session_id = client.post("/api/work-sessions", json={"title": "역순"}).json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "회의 안내 이메일을 작성해줘. 그리고 2026년 7월 22일 오후 2시에 국장 보고 일정도 잡아줘"},
    )

    assert response.status_code == 201
    actions = response.json()["context_summary"]["skill_actions"]
    assert "schedule.create" in actions and "document.create" in actions

    schedules = client.get("/api/schedules").json()["items"]
    assert any(s["starts_at"] == "2026-07-22T14:00:00+09:00" and s["title"] == "국장 보고" for s in schedules)


def test_schedule_parse_supports_relative_weekday() -> None:
    from datetime import datetime, timedelta, timezone

    from gongmu_sidecar.app import AppServices

    parsed = AppServices._parse_schedule_request("다음주 금요일 오후 4시에 예산 조정 협의 일정을 잡아줘")
    assert parsed is not None
    today = datetime.now(timezone(timedelta(hours=9)))
    expected = (today - timedelta(days=today.weekday())) + timedelta(days=4, weeks=1)
    assert parsed["starts_at"].startswith(f"{expected.year:04d}-{expected.month:02d}-{expected.day:02d}T16:00")
    assert parsed["title"] == "예산 조정 협의"


def test_notice_email_phrase_does_not_route_to_help_guide(tmp_path: Path, monkeypatch) -> None:
    """'안내 이메일' 상용구가 도움말로 오분류되지 않아야 한다 (수정 전 FAIL 재현 케이스)."""
    from gongmu_sidecar.app import AppServices

    assert AppServices._looks_like_feature_usage_request(
        "다음주 화요일(2026년 7월 21일) 오후 3시에 AI 업무 추진 팀 회의 일정을 잡고, 그 일정 내용으로 회의 안내 이메일도 작성해줘"
    ) is False
    # 순수 도움말은 유지 (네거티브 컨트롤)
    assert AppServices._looks_like_feature_usage_request("일정 기능 사용법 알려줘") is True
    assert AppServices._looks_like_feature_usage_request("문서작성 어떻게 해?") is True


def test_plan_adds_knowledge_answer_for_question_clause(tmp_path: Path, monkeypatch) -> None:
    """P1-1: 일정 지시와 묶인 지식 질의 절은 knowledge.answer 인텐트로 함께 계획된다."""
    monkeypatch.setattr(
        "gongmu_sidecar.app.generate_session_reply",
        lambda settings, messages, **kwargs: LLMGenerationResult(
            text="출장여비는 교통비, 일비, 숙박비, 식비로 구성됩니다.", provider="ollama", model="gemma4:e2b"
        ),
    )

    client = _client(tmp_path)
    session_id = client.post("/api/work-sessions", json={"title": "지식+일정"}).json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "출장비 지급 기준이 뭔지 알려주고, 내일 오전 10시에 출장비 정산 회의 일정도 등록해줘"},
    )

    assert response.status_code == 201
    payload = response.json()
    actions = payload["context_summary"]["skill_actions"]
    assert actions[0] == "intent.plan"
    assert "schedule.create" in actions
    assert "knowledge.answer" in actions
    assert "## 질의 응답" in payload["assistant_message"]["text"]
    assert "교통비" in payload["assistant_message"]["text"]

    schedules = client.get("/api/schedules").json()["items"]
    assert any("출장비 정산 회의" in s["title"] for s in schedules)


def test_single_intents_do_not_regress(tmp_path: Path, monkeypatch) -> None:
    """단일 일정 등록/조회는 intent.plan 없이 기존 단일 스킬 체인을 유지한다."""
    monkeypatch.setattr(
        "gongmu_sidecar.app.generate_session_reply",
        lambda settings, messages, **kwargs: LLMGenerationResult(text="ok", provider="ollama", model="gemma4:e2b"),
    )

    client = _client(tmp_path)
    session_id = client.post("/api/work-sessions", json={"title": "단일"}).json()["id"]

    created = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "2026년 7월 30일 오후 5시에 반기 실적 점검 회의 일정 잡아줘"},
    )
    assert created.json()["context_summary"]["skill_actions"] == ["schedule.create"]

    listed = client.post(f"/api/work-sessions/{session_id}/turn", json={"text": "이번 주 일정 확인해줘"})
    assert listed.json()["context_summary"]["skill_actions"] == ["schedule.list"]


def _ingest_knowledge_fixture(client, tmp_path: Path) -> None:
    """WI-4 turn 억제 테스트용 지식폴더 픽스처 — 예산편성 문서를 색인해 근거 주입을 발생시킨다."""
    source = tmp_path / "knowledge-source"
    source.mkdir()
    (source / "plan.md").write_text(
        "# 사업계획\n\n## 추진배경\n\n지역 예산편성 사업의 추진배경과 세부계획입니다.",
        encoding="utf-8",
    )
    created = client.post("/api/knowledge/sources", json={"label": "업무자료", "root_path": str(source)})
    assert created.status_code == 201
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert (
        client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code
        == 201
    )


def test_turn_suppresses_citations_for_no_evidence_answer(tmp_path: Path, monkeypatch) -> None:
    """WI-4 E2E-A6-CHAT: 근거 주입은 발생했지만 LLM이 무근거를 선언하면 출처 칩 데이터를 비운다."""

    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text="요청하신 회식 규정 정보는 지식폴더에서 찾을 수 없습니다.",
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    _ingest_knowledge_fixture(client, tmp_path)
    session_id = client.post("/api/work-sessions", json={"title": "무근거 억제"}).json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "예산편성 추진배경 설명해줘"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["assistant_message"]["status"] == "completed"
    assert payload["context_summary"]["graphrag_used"] is True, "근거 주입 자체는 발생해야 한다"
    assert payload["assistant_message"]["citations"] == [], "무근거 답변에는 출처 칩 데이터가 없어야 한다"


def test_turn_keeps_citations_for_cited_answer(tmp_path: Path, monkeypatch) -> None:
    """WI-4 E2E-A7-CHAT-REG: 실출처 인용 답변은 citations를 유지한다(억제 미발동 회귀 방지)."""

    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text="예산편성은 상반기에 확정됩니다. (출처: 사업계획)",
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    _ingest_knowledge_fixture(client, tmp_path)
    session_id = client.post("/api/work-sessions", json={"title": "유근거 유지"}).json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "예산편성 추진배경 설명해줘"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["assistant_message"]["status"] == "completed"
    assert payload["context_summary"]["graphrag_used"] is True
    assert len(payload["assistant_message"]["citations"]) >= 1


def test_multi_intent_email_draft_verb_sseojwo(tmp_path: Path, monkeypatch) -> None:
    """'메일 초안도 써줘' — G5 2호 배터리 E2E-04 실측 FAIL 원인('써줘' 동사 부재) 회귀."""
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", authoring_aware_reply)

    client = _client(tmp_path)
    session_id = client.post("/api/work-sessions", json={"title": "E2E-04"}).json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "내일 오전 9시 30분에 주간 업무 점검 회의 일정 추가하고 참석 안내 메일 초안도 써줘"},
    )

    assert response.status_code == 201
    actions = response.json()["context_summary"]["skill_actions"]
    assert "schedule.create" in actions
    assert "document.create" in actions

    schedules = client.get("/api/schedules").json()["items"]
    assert any("주간 업무 점검" in s["title"] and "T09:30" in s["starts_at"] for s in schedules)
