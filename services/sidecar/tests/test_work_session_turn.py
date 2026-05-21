from pathlib import Path
from zipfile import ZipFile

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
        json={"text": "업무대화랑 파일찾기 사용법 안내해줄래?"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["assistant_message"]["provider"] == "gongmu-skill"
    assert payload["context_summary"]["skill_actions"] == ["help.guide"]
    assert "업무대화" in payload["assistant_message"]["text"]
    assert "파일찾기" in payload["assistant_message"]["text"]
    assert "문서작성" in payload["assistant_message"]["text"]


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

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "이 세션 내용으로 1페이지 보고서 HWPX 문서작성 해줘"},
    )

    assert response.status_code == 201
    assistant_message = response.json()["assistant_message"]
    assert assistant_message["status"] == "completed"
    assert "HWPX 문서를 생성했습니다" in assistant_message["text"]
    assert "문서작성 테스트 문서" in assistant_message["text"]
    assert response.json()["context_summary"]["skill_actions"] == ["document.create"]

    content_base_id = response.json()["context_summary"]["skill_results"][0]["content_base_id"]
    output_path = Path(response.json()["context_summary"]["skill_results"][0]["artifact_path"])
    assert content_base_id
    assert output_path.exists()
    hwpx_text = _extract_hwpx_text(output_path)
    assert "문서작성 테스트 문서" in hwpx_text
    assert "AI 추진 배경과 향후 조치사항" in hwpx_text


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
