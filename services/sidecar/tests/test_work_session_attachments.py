from pathlib import Path

from gongmu_sidecar.app import create_app
from gongmu_sidecar.llm import LLMGenerationResult


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_work_session_attachment_upload_and_turn_context(tmp_path: Path, monkeypatch) -> None:
    captured_messages: list[dict[str, str]] = []

    def fake_generate_reply(settings, messages, **kwargs):
        captured_messages[:] = messages
        return LLMGenerationResult(
            text="I reviewed the attached file.",
            provider="openai_compatible",
            model="gpt-4.1-mini",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "Attachment session"})
    assert session.status_code == 201
    session_id = session.json()["id"]

    upload = client.post(
        f"/api/work-sessions/{session_id}/attachments",
        files=[("files", ("notes.txt", b"alpha\nbeta\ngamma", "text/plain"))],
    )
    assert upload.status_code == 201
    uploaded_items = upload.json()["items"]
    assert len(uploaded_items) == 1
    assert uploaded_items[0]["message_id"] is None
    assert uploaded_items[0]["file_name"] == "notes.txt"
    assert "alpha" in (uploaded_items[0]["text_excerpt"] or "")

    turn = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "Please review this file", "attachment_ids": [uploaded_items[0]["id"]]},
    )
    assert turn.status_code == 201
    payload = turn.json()
    assert payload["duration_ms"] >= 0
    assert payload["assistant_message"]["latency_ms"] >= 0
    assert payload["user_message"]["attachments"][0]["file_name"] == "notes.txt"
    assert payload["assistant_message"]["text"] == "I reviewed the attached file."

    assert any(message["role"] == "user" and "[Attached files]" in message["text"] for message in captured_messages)
    assert any("notes.txt" in message["text"] for message in captured_messages if message["role"] == "user")

    messages = client.get(f"/api/work-sessions/{session_id}/messages")
    items = messages.json()["items"]
    assert items[0]["attachments"][0]["file_name"] == "notes.txt"
    assert items[1]["latency_ms"] >= 0
