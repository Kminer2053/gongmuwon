from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_file_proposal_apply_and_rollback(tmp_path: Path) -> None:
    client = _client(tmp_path)
    incoming = tmp_path / "incoming"
    incoming.mkdir()
    source = incoming / "회의메모.md"
    source.write_text("# 회의메모", encoding="utf-8")

    proposals = client.post("/api/file-organizer/proposals", json={"target_path": str(incoming)})
    proposal_id = proposals.json()["items"][0]["id"]

    request_apply = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply")
    assert request_apply.status_code == 202
    ticket_id = request_apply.json()["approval_ticket"]["id"]

    client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "적용 승인"},
    )

    applied = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply/commit")
    assert applied.status_code == 201
    operation_id = applied.json()["operation"]["id"]
    assert Path(applied.json()["operation"]["destination_path"]).exists()

    rollback = client.post(f"/api/file-organizer/operations/{operation_id}/rollback")
    assert rollback.status_code == 200
    assert Path(rollback.json()["restored_path"]).exists()
