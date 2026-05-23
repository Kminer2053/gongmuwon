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


def test_file_proposal_apply_and_rollback_record_work_jobs(tmp_path: Path) -> None:
    client = _client(tmp_path)
    incoming = tmp_path / "incoming"
    incoming.mkdir()
    source = incoming / "meeting-note.md"
    source.write_text("# incoming", encoding="utf-8")

    proposals = client.post("/api/file-organizer/proposals", json={"target_path": str(incoming)})
    proposal_id = proposals.json()["items"][0]["id"]
    request_apply = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply")
    ticket_id = request_apply.json()["approval_ticket"]["id"]
    client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "approved"},
    )

    applied = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply/commit")

    assert applied.status_code == 201
    assert applied.json()["work_job"]["kind"] == "fileorg.apply"
    assert applied.json()["work_job"]["status"] == "succeeded"
    assert applied.json()["work_job"]["progress_percent"] == 100

    operation_id = applied.json()["operation"]["id"]
    rollback = client.post(f"/api/file-organizer/operations/{operation_id}/rollback")

    assert rollback.status_code == 200
    assert rollback.json()["work_job"]["kind"] == "fileorg.rollback"
    assert rollback.json()["work_job"]["status"] == "succeeded"

    jobs = client.get("/api/jobs").json()["items"]
    assert any(job["kind"] == "fileorg.apply" for job in jobs)
    assert any(job["kind"] == "fileorg.rollback" for job in jobs)


def test_file_proposal_apply_versions_existing_destination_and_preserves_original(tmp_path: Path) -> None:
    client = _client(tmp_path)
    incoming = tmp_path / "incoming"
    incoming.mkdir()
    source = incoming / "meeting-note.md"
    source.write_text("# incoming", encoding="utf-8")

    existing_destination = (
        client.app.state.services.paths.knowledge_raw / source.name
    )
    existing_destination.write_text("# existing", encoding="utf-8")

    proposals = client.post("/api/file-organizer/proposals", json={"target_path": str(incoming)})
    proposal_id = proposals.json()["items"][0]["id"]

    request_apply = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply")
    ticket_id = request_apply.json()["approval_ticket"]["id"]
    client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "approved"},
    )

    applied = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply/commit")
    assert applied.status_code == 201
    destination_path = Path(applied.json()["operation"]["destination_path"])
    assert destination_path.exists()
    assert destination_path != existing_destination
    assert existing_destination.read_text(encoding="utf-8") == "# existing"

    rollback = client.post(f"/api/file-organizer/operations/{applied.json()['operation']['id']}/rollback")
    assert rollback.status_code == 200
    assert not destination_path.exists()
    assert existing_destination.read_text(encoding="utf-8") == "# existing"


def test_file_proposal_commit_rejects_replay_after_apply(tmp_path: Path) -> None:
    client = _client(tmp_path)
    incoming = tmp_path / "incoming"
    incoming.mkdir()
    source = incoming / "meeting-note.md"
    source.write_text("# incoming", encoding="utf-8")

    proposals = client.post("/api/file-organizer/proposals", json={"target_path": str(incoming)})
    proposal_id = proposals.json()["items"][0]["id"]

    request_apply = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply")
    ticket_id = request_apply.json()["approval_ticket"]["id"]
    client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "approved"},
    )

    first_commit = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply/commit")
    assert first_commit.status_code == 201

    second_commit = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply/commit")
    assert second_commit.status_code == 409
    assert second_commit.json()["detail"] == "file organizer proposal already applied"


def test_file_proposal_apply_can_archive_directory_tree(tmp_path: Path) -> None:
    client = _client(tmp_path)
    incoming = tmp_path / "incoming"
    incoming.mkdir()
    source_dir = incoming / "meeting-assets"
    source_dir.mkdir()
    nested = source_dir / "notes.md"
    nested.write_text("# notes", encoding="utf-8")

    proposals = client.post("/api/file-organizer/proposals", json={"target_path": str(incoming)})
    proposal_id = proposals.json()["items"][0]["id"]

    request_apply = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply")
    ticket_id = request_apply.json()["approval_ticket"]["id"]
    client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "approved"},
    )

    applied = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply/commit")
    assert applied.status_code == 201

    destination_path = Path(applied.json()["operation"]["destination_path"])
    assert destination_path.is_dir()
    assert (destination_path / "notes.md").read_text(encoding="utf-8") == "# notes"


def test_file_proposal_rollback_removes_archived_directory_tree(tmp_path: Path) -> None:
    client = _client(tmp_path)
    incoming = tmp_path / "incoming"
    incoming.mkdir()
    source_dir = incoming / "meeting-assets"
    source_dir.mkdir()
    nested = source_dir / "notes.md"
    nested.write_text("# notes", encoding="utf-8")

    proposals = client.post("/api/file-organizer/proposals", json={"target_path": str(incoming)})
    proposal_id = proposals.json()["items"][0]["id"]

    request_apply = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply")
    ticket_id = request_apply.json()["approval_ticket"]["id"]
    client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "approved"},
    )

    applied = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply/commit")
    assert applied.status_code == 201

    operation_id = applied.json()["operation"]["id"]
    destination_path = Path(applied.json()["operation"]["destination_path"])
    assert destination_path.is_dir()

    rolled_back = client.post(f"/api/file-organizer/operations/{operation_id}/rollback")
    assert rolled_back.status_code == 200
    assert not destination_path.exists()
