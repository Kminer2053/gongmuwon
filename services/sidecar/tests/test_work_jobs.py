from __future__ import annotations

from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_work_job_api_tracks_progress_events_and_cancel_request(tmp_path: Path) -> None:
    client = _client(tmp_path)
    jobs = client.app.state.services.jobs

    job = jobs.create_job(
        kind="test.long_task",
        title="테스트 장기 작업",
        input={"source": "pytest"},
        resource_key="test:resource",
        resource_policy="exclusive",
    )
    jobs.start_job(job["id"], stage="준비")
    jobs.update_progress(job["id"], progress_percent=35, stage="파일 처리", message="5개 파일 처리")

    list_response = client.get("/api/jobs")
    detail_response = client.get(f"/api/jobs/{job['id']}")
    event_response = client.get(f"/api/jobs/{job['id']}/events")
    cancel_response = client.post(f"/api/jobs/{job['id']}/cancel")

    assert list_response.status_code == 200
    assert any(item["id"] == job["id"] for item in list_response.json()["items"])
    assert detail_response.status_code == 200
    assert detail_response.json()["progress_percent"] == 35
    assert detail_response.json()["current_stage"] == "파일 처리"
    assert event_response.status_code == 200
    event_types = [item["event_type"] for item in event_response.json()["items"]]
    assert event_types == ["job.created", "job.started", "job.progress"]
    assert cancel_response.status_code == 200
    assert cancel_response.json()["cancel_requested"] is True
    assert cancel_response.json()["status"] == "cancel_requested"


def test_work_jobs_recover_interrupted_running_jobs(tmp_path: Path) -> None:
    client = _client(tmp_path)
    jobs = client.app.state.services.jobs
    job = jobs.create_job(kind="test.recover", title="복구 테스트")
    jobs.start_job(job["id"], stage="실행 중")

    recovered_client = _client(tmp_path)
    response = recovered_client.get(f"/api/jobs/{job['id']}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "failed"
    assert "업무엔진이 재시작" in payload["error_message"]
