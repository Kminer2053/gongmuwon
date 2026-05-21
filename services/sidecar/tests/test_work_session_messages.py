from pathlib import Path

from test_api_flows import _client


def test_work_session_messages_persist_turn_contract_metadata(tmp_path: Path) -> None:
    client = _client(tmp_path)

    session = client.post("/api/work-sessions", json={"title": "Weekly report session"})
    assert session.status_code == 201
    session_id = session.json()["id"]

    created = client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={
            "role": "assistant",
            "text": "Preparing the draft outline now.",
            "message_type": "chat",
            "status": "pending",
            "provider": "openai",
            "model": "gpt-5.4",
        },
    )

    assert created.status_code == 201
    payload = created.json()
    assert payload["message_type"] == "chat"
    assert payload["status"] == "pending"
    assert payload["provider"] == "openai"
    assert payload["model"] == "gpt-5.4"

    messages = client.get(f"/api/work-sessions/{session_id}/messages")
    assert messages.status_code == 200
    items = messages.json()["items"]
    assert len(items) == 1
    assert items[0]["status"] == "pending"
    assert items[0]["provider"] == "openai"
    assert items[0]["model"] == "gpt-5.4"
