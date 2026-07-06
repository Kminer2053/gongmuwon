from pathlib import Path

from gongmu_sidecar.app import create_app
from gongmu_sidecar.llm import LLMGenerationResult


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_work_session_attachment_upload_and_turn_context(tmp_path: Path, monkeypatch) -> None:
    # 첫 호출 = 턴 프롬프트, 이후 호출 = T-02 롤링 요약 갱신
    captured_calls: list[list[dict[str, str]]] = []

    def fake_generate_reply(settings, messages, **kwargs):
        captured_calls.append(list(messages))
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

    # T-02: 첨부 발췌는 가드레일/지식 블록 다음의 독립 system 블록으로 주입되고,
    # "[첨부 발췌: 전체 N자 중 M자]" 표기로 반영 범위를 드러낸다.
    turn_messages = captured_calls[0]
    attachment_block = next(
        message for message in turn_messages if "[Attached files]" in message["text"]
    )
    assert attachment_block["role"] == "system"
    assert "notes.txt" in attachment_block["text"]
    assert "[첨부 발췌: 전체" in attachment_block["text"]
    assert "alpha" in attachment_block["text"]
    assert turn_messages[-1]["role"] == "user"
    assert turn_messages[-1]["text"] == "Please review this file"

    messages = client.get(f"/api/work-sessions/{session_id}/messages")
    items = messages.json()["items"]
    assert items[0]["attachments"][0]["file_name"] == "notes.txt"
    assert items[1]["latency_ms"] >= 0
