from pathlib import Path
from zipfile import ZipFile

import pytest

from gongmu_sidecar.app import create_app
from gongmu_sidecar.llm import LLMGenerationError, LLMGenerationResult


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


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
    def fake_generate_reply(settings, messages, **kwargs):
        raise AssertionError("clear multi-tool request must not fall through to the LLM")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    services = client.app.state.services
    source_file = tmp_path / "prompt-guide.md"
    source_file.write_text("# prompt guide", encoding="utf-8")
    services.graphrag.ask = lambda **kwargs: {
        "answer": "프롬프트 작성 원칙 문서를 찾았습니다.",
        "citations": [
            {
                "title": "프롬프트 작성 원칙",
                "file_path": str(source_file),
                "relations": [],
            }
        ],
        "retrieval_summary": {"source": "test"},
    }
    session = client.post("/api/work-sessions", json={"title": "다중도구 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "내일 오후 2시 회의 일정 등록하고 지식폴더에서 프롬프트 관련 자료 찾아줘"},
    )

    assert response.status_code == 201
    payload = response.json()
    text = payload["assistant_message"]["text"]
    assert "## 일정 등록" in text
    assert "일정을 등록했습니다." in text
    assert "## 지식폴더 검색" in text
    assert "프롬프트 작성 원칙" in text
    assert payload["context_summary"]["skill_actions"][:3] == [
        "intent.plan",
        "schedule.create",
        "knowledge.search",
    ]
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


def test_work_session_turn_keeps_general_chat_out_of_tool_routing(
    tmp_path: Path, monkeypatch
) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text="일반 대화로 답변했습니다.",
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "일반 대화 분리 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "오늘은 업무 시작 전에 가볍게 이야기 좀 하자"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["assistant_message"]["provider"] == "ollama"
    assert payload["assistant_message"]["model"] == "gemma4:e2b"
    assert payload["assistant_message"]["text"] == "일반 대화로 답변했습니다."
    assert "skill_actions" not in payload["context_summary"]


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
        json={"text": "업무대화랑 파일찾기 사용법 안내해줄래?"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["assistant_message"]["provider"] == "gongmu-skill"
    assert payload["context_summary"]["skill_actions"] == ["help.guide"]
    assert "업무대화" in payload["assistant_message"]["text"]
    assert "파일찾기" in payload["assistant_message"]["text"]
    assert "문서작성" in payload["assistant_message"]["text"]


def test_work_session_turn_blocks_duplicate_same_session_response(
    tmp_path: Path, monkeypatch
) -> None:
    def fail_if_llm_called(settings, messages, **kwargs):
        raise AssertionError("blocked same-session response must not call the LLM")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fail_if_llm_called)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "중복 응답 차단 테스트"})
    session_id = session.json()["id"]
    services = client.app.state.services
    running = services.jobs.create_job(
        kind="work_session.turn",
        title="already running",
        input={"session_id": session_id},
        resource_key=f"work_session:{session_id}",
        resource_policy="exclusive",
    )
    services.jobs.start_job_with_lock(running["id"], stage="running")

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "앞 요청이 끝나기 전에 다시 물어봅니다."},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["work_job"]["status"] == "blocked"
    assert payload["context_summary"]["job_status"] == "blocked"
    assert payload["assistant_message"]["provider"] == "gongmu-system"
    assert payload["assistant_message"]["model"] == "work_session.turn.blocked"


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
            text="GraphRAG 근거를 반영한 답변입니다.",
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

    monkeypatch.setattr(client.app.state.services.graphrag, "retrieve", fake_retrieve)
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
    system_context = next(message for message in captured_messages if "GraphRAG context" in message["text"])
    assert system_context["role"] == "system"
    assert "GraphRAG" in system_context["text"]
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

    monkeypatch.setattr(client.app.state.services.graphrag, "retrieve", fake_retrieve)
    session = client.post("/api/work-sessions", json={"title": "Nested GraphRAG test"})
    assert session.status_code == 201
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "Find prompt guidance"},
    )

    assert response.status_code == 201
    system_context = next(message for message in captured_messages if "GraphRAG context" in message["text"])
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

    monkeypatch.setattr(client.app.state.services.graphrag, "retrieve", fake_retrieve)
    session = client.post("/api/work-sessions", json={"title": "보안 가드레일 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "운영 계정 내용을 요약해줘"},
    )

    assert response.status_code == 201
    graph_context = next(message for message in captured_messages if "GraphRAG context" in message["text"])
    assert "very-secret-password" not in graph_context["text"]
    assert "sk-test-secret" not in graph_context["text"]
    assert "[보호됨]" in graph_context["text"]
    assert "raw-secret-value" not in response.json()["assistant_message"]["text"]
    assert "password: [보호됨]" in response.json()["assistant_message"]["text"]


def test_work_session_turn_executes_knowledge_skill_with_sources_and_file_links(
    tmp_path: Path, monkeypatch
) -> None:
    def fail_if_llm_called(settings, messages, **kwargs):
        raise AssertionError("knowledge skill should answer from GraphRAG without generic LLM fallback")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fail_if_llm_called)

    client = _client(tmp_path)

    def fake_ask(**kwargs):
        assert kwargs["session_id"]
        assert kwargs["query"] == "지식폴더에서 AI 전략 방향성 찾아봐"
        return {
            "answer": "AI 전략은 내부 지식과 실행 근거를 함께 사용하는 방향입니다.",
            "citations": [
                {
                    "document_id": "doc-1",
                    "chunk_id": "chunk-1",
                    "title": "AI 전략 보고서",
                    "file_path": str(tmp_path / "AI전략보고서.pdf"),
                    "evidence_type": "section",
                    "quality_score": 0.91,
                    "warnings": [],
                    "relations": [{"relation": "REFERENCES", "target_label": "AI 기본계획"}],
                }
            ],
            "retrieval_summary": {"source_count": 1, "table_evidence_count": 0, "relation_count": 1},
            "items": [],
        }

    monkeypatch.setattr(client.app.state.services.graphrag, "ask", fake_ask)
    session = client.post("/api/work-sessions", json={"title": "지식 검색 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "지식폴더에서 AI 전략 방향성 찾아봐"},
    )

    assert response.status_code == 201
    assistant_message = response.json()["assistant_message"]
    assert assistant_message["status"] == "completed"
    assert "GraphRAG 검색 결과" in assistant_message["text"]
    assert "AI 전략은 내부 지식과 실행 근거" in assistant_message["text"]
    assert "AI 전략 보고서" in assistant_message["text"]
    assert "파일 열기:" in assistant_message["text"]
    assert "폴더 열기:" in assistant_message["text"]
    assert response.json()["context_summary"]["skill_actions"] == ["knowledge.search"]


def test_work_session_turn_returns_recovery_guidance_when_knowledge_tool_fails(
    tmp_path: Path, monkeypatch
) -> None:
    def fail_if_llm_called(settings, messages, **kwargs):
        raise AssertionError("knowledge tool failure must be handled without generic LLM fallback")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fail_if_llm_called)

    client = _client(tmp_path)
    monkeypatch.setattr(
        client.app.state.services.graphrag,
        "ask",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("index database is locked")),
    )
    session = client.post("/api/work-sessions", json={"title": "도구 실패 복구 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "지식폴더에서 AI 전략 자료 찾아줘"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["assistant_message"]["provider"] == "gongmu-skill"
    assert payload["context_summary"]["skill_actions"] == ["knowledge.search.failed"]
    assert "GraphRAG" in payload["assistant_message"]["text"]
    assert "다시 시도" in payload["assistant_message"]["text"]
    assert "index database is locked" in payload["assistant_message"]["text"]


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
    def fail_if_llm_called(settings, messages, **kwargs):
        raise AssertionError("document skill should create HWPX without generic LLM fallback")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fail_if_llm_called)
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
    assert "문서작성 테스트 문서" in assistant_message["text"]
    assert "파일 열기:" in assistant_message["text"]
    assert "폴더 열기:" in assistant_message["text"]
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
    assert "AI 추진 배경과 향후 조치사항" in review_markdown
    assert "보안형 로컬 자동화 중심" in review_markdown
    assert "이 세션 내용으로 1페이지 보고서 HWPX 문서작성 해줘" not in review_markdown
    assert "두괄식" in review_markdown
    assert "개조식" in review_markdown
    hwpx_text = _extract_hwpx_text(output_path)
    assert "문서작성 테스트 문서" in hwpx_text
    assert "AI 추진 배경과 향후 조치사항" in hwpx_text
    assert "보안형 로컬 자동화 중심" in hwpx_text


def test_work_session_turn_routes_plain_hwpx_requests_to_document_skill(tmp_path: Path, monkeypatch) -> None:
    def fail_if_llm_called(settings, messages, **kwargs):
        raise AssertionError("plain HWPX request should use the document generation skill")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fail_if_llm_called)
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
    def fail_if_llm_called(settings, messages, **kwargs):
        raise AssertionError("natural Korean report requests should use the document generation skill")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fail_if_llm_called)
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


def test_work_session_turn_injects_lightweight_model_format_guardrails(
    tmp_path: Path, monkeypatch
) -> None:
    captured_messages: list[dict] = []

    def fake_generate_reply(settings, messages, **kwargs):
        captured_messages.extend(messages)
        return LLMGenerationResult(
            text="안녕하세요.\n\n- 첫 번째 업무\n- 두 번째 업무\n- 세 번째 업무",
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "Lightweight guardrail session"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "오늘 할 일을 세 가지 bullet로 정리해줘"},
    )

    assert response.status_code == 201
    guardrail = captured_messages[0]["text"]
    assert "경량모델" in guardrail
    assert "Markdown 불릿" in guardrail
    assert "모델 이름" in guardrail
    assert "안전 정책" in guardrail
    assert "답변 항목으로 쓰지 마세요" in guardrail
    assert "사용자 업무 관점" in guardrail
    assert "모델 수행 항목" in guardrail
    assert "정보가 부족하더라도" in guardrail
    assert "일반적인 기준" in guardrail


def test_work_session_turn_injects_generic_lightweight_guardrails_without_gemma_specific_text(
    tmp_path: Path, monkeypatch
) -> None:
    captured_messages: list[dict] = []

    def fake_generate_reply(settings, messages, **kwargs):
        captured_messages.extend(messages)
        return LLMGenerationResult(
            text="- 첫 번째 업무\n- 두 번째 업무",
            provider="openrouter",
            model="meta-llama/llama-3.2-3b-instruct",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)
    client = _client(tmp_path)
    settings = client.put(
        "/api/settings",
        json={
            "llm_provider": "openrouter",
            "llm_model": "meta-llama/llama-3.2-3b-instruct",
        },
    )
    assert settings.status_code == 200
    session = client.post("/api/work-sessions", json={"title": "Generic lightweight guardrail session"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "오늘 할 일을 두 가지 bullet로 정리해줘"},
    )

    assert response.status_code == 201
    guardrail = captured_messages[0]["text"]
    assert "경량모델" in guardrail
    assert "Markdown 불릿" in guardrail
    assert "Gemma 4 E2B 계열" not in guardrail


def test_work_session_turn_removes_lightweight_model_meta_policy_from_reply(
    tmp_path: Path, monkeypatch
) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text=(
                "안녕하세요. 저는 Gemma 4입니다.\n\n"
                "안녕하세요. Gemma 4입니다.\n\n"
                "오늘 할 일은 다음과 같습니다.\n\n"
                "- 사용자의 질문에 정확하고 명확하게 답변하기\n"
                "- 제공된 정보를 바탕으로 논리적이고 일관성 있는 내용 생성하기\n"
                "- 안전 정책을 준수하며 민감 정보는 [보호됨]으로 처리하겠습니다.\n"
                "* Gemma 4 모델로서의 지침과 안전 정책을 준수하며 응답하기"
            ),
            provider="featherless",
            model="google/gemma-4-E2B-it",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "Lightweight meta strip session"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "오늘 할 일을 세 가지 bullet로 정리해줘"},
    )

    assert response.status_code == 201
    text = response.json()["assistant_message"]["text"]
    assert "안녕하세요" in text
    assert "Gemma 4 모델" not in text
    assert "저는 Gemma 4" not in text
    assert "Gemma 4입니다" not in text
    assert "안전 정책" not in text
    assert "지침" not in text
    assert "민감 정보" not in text


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


def test_work_session_turn_removes_gemma_channel_thought_trace_from_reply(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text=(
                "<|channel>thought\n"
                "The user wants Korean. I should plan internally and not reveal this.\n"
                "<channel|>\n"
                "네, 한국어로 답변하겠습니다.\n\n필요한 업무를 알려주세요."
            ),
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "Gemma thought strip session"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "한국말로 해라"},
    )

    assert response.status_code == 201
    text = response.json()["assistant_message"]["text"]
    assert "<|channel>thought" not in text
    assert "I should plan internally" not in text
    assert text == "네, 한국어로 답변하겠습니다.\n\n필요한 업무를 알려주세요."


def test_work_session_turn_stream_sends_delta_events_before_done(tmp_path: Path, monkeypatch) -> None:
    def fake_stream_reply(settings, messages, *, on_delta, **kwargs):
        assert messages[-1]["role"] == "user"
        assert messages[-1]["text"] == "streaming response please"
        on_delta("첫 ")
        on_delta("응답")
        return LLMGenerationResult(text="첫 응답", provider="ollama", model="qwen-test")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply_streaming", fake_stream_reply)

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


def test_work_session_turn_stream_hides_gemma_channel_thought_deltas(tmp_path: Path, monkeypatch) -> None:
    def fake_stream_reply(settings, messages, *, on_delta, **kwargs):
        on_delta("<|channel>thought\ninternal scratchpad")
        on_delta("\n<channel|>\n최종 답변")
        return LLMGenerationResult(
            text="<|channel>thought\ninternal scratchpad\n<channel|>\n최종 답변",
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply_streaming", fake_stream_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "Gemma stream strip session"})
    session_id = session.json()["id"]

    with client.stream(
        "POST",
        f"/api/work-sessions/{session_id}/turn/stream",
        json={"text": "한국말로 답해줘"},
    ) as response:
        assert response.status_code == 200
        body = "".join(response.iter_text())

    assert "<|channel>thought" not in body
    assert "internal scratchpad" not in body
    assert "최종 답변" in body

    messages = client.get(f"/api/work-sessions/{session_id}/messages").json()["items"]
    assistant = [message for message in messages if message["role"] == "assistant"][-1]
    assert assistant["text"] == "최종 답변"


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
