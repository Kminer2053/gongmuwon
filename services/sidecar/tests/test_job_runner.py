from __future__ import annotations

import time
from pathlib import Path

from gongmu_sidecar.app import create_app


def _services(tmp_path: Path):
    app = create_app(tmp_path)
    client = app.state.test_client_factory()
    return client.app.state.services


def _wait_for_status(services, job_id: str, statuses: set[str], timeout: float = 2.0) -> dict:
    deadline = time.monotonic() + timeout
    latest = services.jobs.require_job(job_id)
    while time.monotonic() < deadline:
        latest = services.jobs.require_job(job_id)
        if latest["status"] in statuses:
            return latest
        time.sleep(0.02)
    return latest


def test_job_runner_executes_managed_job_and_records_result(tmp_path: Path) -> None:
    services = _services(tmp_path)
    job = services.jobs.create_job(
        kind="test.runner",
        title="runner smoke",
        resource_key="runner:alpha",
        resource_policy="exclusive",
    )

    services.job_runner.submit(
        job["id"],
        lambda running_job: {"job_id": running_job["id"], "ok": True},
        stage="runner execution",
    )

    completed = _wait_for_status(services, job["id"], {"succeeded"})
    events = services.jobs.list_events(job["id"])

    assert completed["status"] == "succeeded"
    assert completed["result"]["ok"] is True
    assert services.job_runner.metrics()["active_count"] == 0
    assert any(event["event_type"] == "job.runner_queued" for event in events)


def test_job_runner_waits_for_same_resource_before_running_handler(tmp_path: Path) -> None:
    services = _services(tmp_path)
    running = services.jobs.create_job(
        kind="test.runner",
        title="running",
        resource_key="runner:shared",
        resource_policy="exclusive",
    )
    blocked = services.jobs.create_job(
        kind="test.runner",
        title="blocked",
        resource_key="runner:shared",
        resource_policy="exclusive",
    )
    called = {"blocked": False}

    services.jobs.start_job_with_lock(running["id"], stage="occupy resource")
    services.job_runner.submit(
        blocked["id"],
        lambda _job: called.__setitem__("blocked", True),
        stage="blocked execution",
    )

    latest = _wait_for_status(services, blocked["id"], {"blocked"})

    assert latest["status"] == "blocked"
    assert called["blocked"] is False

    services.jobs.complete_job(running["id"], status="succeeded", stage="resource released")
    completed = _wait_for_status(services, blocked["id"], {"succeeded"})

    assert completed["status"] == "succeeded"
    assert called["blocked"] is True


def test_job_runner_keeps_different_resources_concurrent(tmp_path: Path) -> None:
    services = _services(tmp_path)
    first = services.jobs.create_job(
        kind="test.runner",
        title="first",
        resource_key="runner:first",
        resource_policy="exclusive",
    )
    second = services.jobs.create_job(
        kind="test.runner",
        title="second",
        resource_key="runner:second",
        resource_policy="exclusive",
    )

    services.job_runner.submit(first["id"], lambda _job: {"name": "first"}, stage="first")
    services.job_runner.submit(second["id"], lambda _job: {"name": "second"}, stage="second")

    assert _wait_for_status(services, first["id"], {"succeeded"})["status"] == "succeeded"
    assert _wait_for_status(services, second["id"], {"succeeded"})["status"] == "succeeded"
