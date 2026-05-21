from pathlib import Path

from gongmu_sidecar.app import create_app
from gongmu_sidecar.llm import LLMGenerationError, LLMGenerationResult


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_work_session_turn_sends_user_message_as_last_llm_prompt(tmp_path: Path, monkeypatch) -> None:
    captured_messages = []

    def fake_generate_reply(settings, messages, **kwargs):
        captured_messages.extend(messages)
        return LLMGenerationResult(
            text="프롬프트 순서가 정상입니다.",
            provider="ollama",
            model="qwen3.6:27b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "프롬프트 순서 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "마지막 프롬프트는 이 사용자 메시지여야 합니다."},
    )

    assert response.status_code == 201
    assert captured_messages[-1]["role"] == "user"
    assert captured_messages[-1]["text"] == "마지막 프롬프트는 이 사용자 메시지여야 합니다."
    assert all(message["status"] != "pending" for message in captured_messages)


def test_work_session_turn_returns_context_summary(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text="GraphRAG 근거와 첨부를 반영했습니다.",
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "맥락 요약 테스트"})
    session_id = session.json()["id"]
    client.post(
        f"/api/work-sessions/{session_id}/file-links",
        json={"items": [{"file_path": "D:/docs/strategy.pdf", "label": "전략 문서"}]},
    )

    def fake_retrieve(**kwargs):
        return {
            "items": [
                {
                    "document": {"title": "AI 전략", "file_path": "D:/docs/strategy.pdf"},
                    "text": "AI 전략은 내부 지식과 실행 근거를 함께 사용합니다.",
                    "evidence_type": "section",
                    "relations": [],
                }
            ]
        }

    monkeypatch.setattr(client.app.state.services.graphrag, "retrieve", fake_retrieve)

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "AI 전략 알려줘", "attachment_ids": []},
    )

    assert response.status_code == 201
    assert response.json()["context_summary"] == {
        "graphrag_used": True,
        "graphrag_evidence_count": 1,
        "attachment_count": 0,
        "linked_file_count": 1,
        "provider": "ollama",
        "model": "gemma4:e2b",
    }


def test_work_session_turn_returns_readable_korean_failure_message(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        raise LLMGenerationError("LLM server returned no assistant text.")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "실패 메시지 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "응답 실패 메시지를 확인합니다."},
    )

    assert response.status_code == 201
    assistant_message = response.json()["assistant_message"]
    assert assistant_message["status"] == "failed"
    assert assistant_message["text"].startswith("LLM 응답 생성에 실패했습니다.")
    assert "LLM server returned no assistant text." in assistant_message["text"]
