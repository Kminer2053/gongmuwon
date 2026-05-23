from __future__ import annotations

from pathlib import Path

from gongmu_sidecar.app import create_app


def _jobs(tmp_path: Path):
    app = create_app(tmp_path)
    client = app.state.test_client_factory()
    return client.app.state.services.jobs


def test_exclusive_resource_jobs_block_until_the_running_job_finishes(tmp_path: Path) -> None:
    jobs = _jobs(tmp_path)
    first = jobs.create_job(
        kind="test.resource",
        title="first",
        resource_key="knowledge_source:alpha",
        resource_policy="exclusive",
    )
    second = jobs.create_job(
        kind="test.resource",
        title="second",
        resource_key="knowledge_source:alpha",
        resource_policy="exclusive",
    )

    started_first = jobs.start_job_with_lock(first["id"], stage="first running")
    blocked_second = jobs.start_job_with_lock(second["id"], stage="second running")

    assert started_first["status"] == "running"
    assert blocked_second["status"] == "blocked"
    assert "선행 작업" in blocked_second["current_stage"]

    jobs.complete_job(first["id"], status="succeeded", stage="first done")
    unblocked_second = jobs.require_job(second["id"])

    assert unblocked_second["status"] == "queued"
    assert "실행 대기" in unblocked_second["current_stage"]

    restarted_second = jobs.start_job_with_lock(second["id"], stage="second running")
    assert restarted_second["status"] == "running"


def test_different_resource_jobs_can_run_at_the_same_time(tmp_path: Path) -> None:
    jobs = _jobs(tmp_path)
    first = jobs.create_job(
        kind="test.resource",
        title="first",
        resource_key="knowledge_source:alpha",
        resource_policy="exclusive",
    )
    second = jobs.create_job(
        kind="test.resource",
        title="second",
        resource_key="knowledge_source:beta",
        resource_policy="exclusive",
    )

    assert jobs.start_job_with_lock(first["id"], stage="first running")["status"] == "running"
    assert jobs.start_job_with_lock(second["id"], stage="second running")["status"] == "running"


def test_canceled_blocked_job_does_not_start_after_the_lock_is_released(tmp_path: Path) -> None:
    jobs = _jobs(tmp_path)
    running = jobs.create_job(
        kind="test.resource",
        title="running",
        resource_key="local_file_index",
        resource_policy="exclusive",
    )
    blocked = jobs.create_job(
        kind="test.resource",
        title="blocked",
        resource_key="local_file_index",
        resource_policy="exclusive",
    )

    jobs.start_job_with_lock(running["id"], stage="indexing")
    assert jobs.start_job_with_lock(blocked["id"], stage="next indexing")["status"] == "blocked"

    canceled = jobs.request_cancel(blocked["id"])
    jobs.complete_job(running["id"], status="succeeded", stage="index done")

    assert canceled["status"] == "canceled"
    assert jobs.require_job(blocked["id"])["status"] == "canceled"
