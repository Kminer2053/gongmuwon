from __future__ import annotations

from datetime import datetime, timedelta, timezone
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


def test_stale_queued_job_is_auto_canceled_on_list(tmp_path: Path) -> None:
    client = _client(tmp_path)
    jobs = client.app.state.services.jobs
    job = jobs.create_job(kind="test.stale_queue", title="대기열 테스트")

    stale_queued_at = (datetime.now(timezone.utc) - timedelta(minutes=31)).isoformat()
    jobs.db.execute(
        "UPDATE work_jobs SET queued_at = ? WHERE id = ?",
        (stale_queued_at, job["id"]),
    )

    response = client.get("/api/jobs")
    assert response.status_code == 200
    listed = next(item for item in response.json()["items"] if item["id"] == job["id"])
    assert listed["status"] == "canceled"
    assert listed["error_message"] == "대기 시간 초과로 자동 취소되었습니다"

    events = client.get(f"/api/jobs/{job['id']}/events").json()["items"]
    assert any(event["event_type"] == "job.canceled" for event in events)

    logs = client.get("/api/execution-logs").json()["items"]
    assert any(entry["action"] == "job.stale_queued.canceled" for entry in logs)


def test_freshly_queued_job_is_not_auto_canceled(tmp_path: Path) -> None:
    client = _client(tmp_path)
    jobs = client.app.state.services.jobs
    job = jobs.create_job(kind="test.fresh_queue", title="신규 대기열 테스트")

    response = client.get("/api/jobs")
    assert response.status_code == 200
    listed = next(item for item in response.json()["items"] if item["id"] == job["id"])
    assert listed["status"] == "queued"
