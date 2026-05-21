from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_session_analysis_applies_personalization_without_approval(tmp_path: Path) -> None:
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "Budget Review Session"})
    session_id = session.json()["id"]
    client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "user", "text": "Summarize the budget meeting materials."},
    )
    client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "assistant", "text": "I organized the budget review issues."},
    )

    analyzed = client.post(f"/api/personalization/work-sessions/{session_id}/analyze")
    assert analyzed.status_code == 201
    payload = analyzed.json()
    candidate = payload["candidate"]
    assert candidate["candidate_type"] == "session_summary_index"
    assert candidate["status"] == "applied"
    assert candidate["risk_level"] == "low"
    assert "Budget Review Session" in candidate["title"]
    assert Path(payload["application"]["summary_path"]).exists()
    assert Path(payload["application"]["audit_path"]).exists()

    listed = client.get("/api/personalization/candidates")
    assert listed.status_code == 200
    assert listed.json()["items"][0]["status"] == "applied"


def test_personalization_decision_endpoint_rejects_already_applied_candidate(tmp_path: Path) -> None:
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "Document Preference Session"})
    session_id = session.json()["id"]
    client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "user", "text": "I prefer meeting-material style documents."},
    )

    candidate = client.post(f"/api/personalization/work-sessions/{session_id}/analyze").json()["candidate"]
    decided = client.post(
        f"/api/personalization/candidates/{candidate['id']}/decide",
        json={"status": "approved"},
    )
    assert decided.status_code == 409
