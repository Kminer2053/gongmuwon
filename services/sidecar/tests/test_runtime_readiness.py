from __future__ import annotations

from pathlib import Path

from gongmu_sidecar.app import create_app


def test_ready_endpoint_reports_runtime_checks(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    client = app.state.test_client_factory()

    response = client.get("/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["checks"]["database"]["ok"] is True
    assert payload["checks"]["workspace"]["ok"] is True
    assert payload["checks"]["jobs"]["ok"] is True
    assert payload["recovered"]["work_jobs"] == 0


def test_runtime_metrics_counts_job_states(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    client = app.state.test_client_factory()
    services = client.app.state.services

    running = services.jobs.create_job(
        kind="test.metrics",
        title="running",
        resource_key="metrics:shared",
        resource_policy="exclusive",
    )
    blocked = services.jobs.create_job(
        kind="test.metrics",
        title="blocked",
        resource_key="metrics:shared",
        resource_policy="exclusive",
    )
    services.jobs.start_job_with_lock(running["id"], stage="running")
    services.jobs.start_job_with_lock(blocked["id"], stage="blocked")

    response = client.get("/api/runtime/metrics")

    assert response.status_code == 200
    payload = response.json()
    assert payload["jobs"]["active_count"] >= 2
    assert payload["jobs"]["running"] >= 1
    assert payload["jobs"]["blocked"] >= 1
    assert payload["runner"]["active_count"] == 0


def test_ready_endpoint_reports_recovered_interrupted_work_jobs(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    client = app.state.test_client_factory()
    services = client.app.state.services

    job = services.jobs.create_job(kind="test.recovery", title="recovery")
    services.jobs.start_job(job["id"], stage="running before restart")

    restarted_app = create_app(tmp_path)
    restarted_client = restarted_app.state.test_client_factory()
    response = restarted_client.get("/ready")
    recovered = restarted_client.get(f"/api/jobs/{job['id']}").json()

    assert response.json()["recovered"]["work_jobs"] == 1
    assert recovered["status"] == "failed"
