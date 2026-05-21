from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_work_session_file_links_can_be_created_listed_and_removed(tmp_path: Path) -> None:
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "자료 검토 세션"})
    assert session.status_code == 201
    session_id = session.json()["id"]

    source_file = tmp_path / "meeting.md"
    source_file.write_text("# 회의자료\n\n검토 대상", encoding="utf-8")

    created = client.post(
        f"/api/work-sessions/{session_id}/file-links",
        json={
            "items": [
                {
                    "file_path": str(source_file),
                    "label": "회의자료",
                    "source": "manual",
                }
            ]
        },
    )
    assert created.status_code == 201
    link = created.json()["items"][0]
    assert link["session_id"] == session_id
    assert link["label"] == "회의자료"
    assert link["source"] == "manual"

    listed = client.get(f"/api/work-sessions/{session_id}/file-links")
    assert listed.status_code == 200
    assert listed.json()["items"][0]["file_path"] == str(source_file)

    deleted = client.delete(f"/api/work-sessions/{session_id}/file-links/{link['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True

    listed_after_delete = client.get(f"/api/work-sessions/{session_id}/file-links")
    assert listed_after_delete.status_code == 200
    assert listed_after_delete.json()["items"] == []


def test_file_link_creation_requires_existing_work_session(tmp_path: Path) -> None:
    client = _client(tmp_path)

    created = client.post(
        "/api/work-sessions/missing-session/file-links",
        json={"items": [{"file_path": str(tmp_path / "memo.md"), "source": "manual"}]},
    )
    assert created.status_code == 404
