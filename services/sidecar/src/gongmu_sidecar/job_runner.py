from __future__ import annotations

from collections.abc import Callable
from threading import Lock, Thread
import time
from typing import Any

from .jobs import JobManager, TERMINAL_STATUSES


JobHandler = Callable[[dict[str, Any]], dict[str, Any] | None]
ExistingJobHandler = Callable[[], dict[str, Any] | None]


class JobRunner:
    """Small in-process runner for long-running work jobs.

    JobManager remains the source of truth for persisted status. The runner only
    owns thread orchestration, active-job metrics, and safe terminal handling.
    """

    def __init__(self, jobs: JobManager) -> None:
        self.jobs = jobs
        self._lock = Lock()
        self._active_job_ids: set[str] = set()
        self._submitted_count = 0

    def submit(
        self,
        job_id: str,
        handler: JobHandler,
        *,
        stage: str = "실행 중",
        complete_stage: str = "완료",
    ) -> dict[str, Any]:
        self.jobs.require_job(job_id)
        self.jobs.append_event(
            job_id,
            level="info",
            event_type="job.runner_queued",
            message="업무엔진 실행 대기열에 등록되었습니다.",
        )
        thread = Thread(
            target=self._run_managed,
            args=(job_id, handler, stage, complete_stage),
            name=f"gongmu-job-{job_id[:8]}",
            daemon=True,
        )
        with self._lock:
            self._submitted_count += 1
            self._active_job_ids.add(job_id)
        thread.start()
        return self.jobs.require_job(job_id)

    def submit_existing(self, job_id: str, handler: ExistingJobHandler) -> dict[str, Any]:
        self.jobs.require_job(job_id)
        self.jobs.append_event(
            job_id,
            level="info",
            event_type="job.runner_queued",
            message="기존 작업 실행을 업무엔진 대기열에 연결했습니다.",
        )
        thread = Thread(
            target=self._run_existing,
            args=(job_id, handler),
            name=f"gongmu-existing-job-{job_id[:8]}",
            daemon=True,
        )
        with self._lock:
            self._submitted_count += 1
            self._active_job_ids.add(job_id)
        thread.start()
        return self.jobs.require_job(job_id)

    def metrics(self) -> dict[str, Any]:
        with self._lock:
            active_job_ids = sorted(self._active_job_ids)
            submitted_count = self._submitted_count
        return {
            "active_count": len(active_job_ids),
            "active_job_ids": active_job_ids,
            "queue_depth": 0,
            "submitted_count": submitted_count,
        }

    def _run_managed(
        self,
        job_id: str,
        handler: JobHandler,
        stage: str,
        complete_stage: str,
    ) -> None:
        try:
            job = self.jobs.start_job_with_lock(job_id, stage=stage)
            while job["status"] == "blocked":
                self.jobs.append_event(
                    job_id,
                    level="warning",
                    event_type="job.runner_blocked",
                    message="같은 자원을 사용하는 선행 작업이 끝날 때까지 대기합니다.",
                )
                time.sleep(0.05)
                job = self.jobs.require_job(job_id)
                if job["status"] in TERMINAL_STATUSES or job.get("cancel_requested"):
                    return
                if job["status"] == "queued":
                    job = self.jobs.start_job_with_lock(job_id, stage=stage)
            if job["status"] in TERMINAL_STATUSES or job.get("cancel_requested"):
                return
            result = handler(job) or {}
            latest = self.jobs.require_job(job_id)
            if latest["status"] not in TERMINAL_STATUSES:
                if latest.get("cancel_requested") or latest["status"] == "cancel_requested":
                    self.jobs.complete_job(job_id, status="canceled", result=result, stage="취소 완료")
                else:
                    self.jobs.complete_job(job_id, status="succeeded", result=result, stage=complete_stage)
        except Exception as exc:
            self._fail_if_active(job_id, exc)
        finally:
            self._mark_inactive(job_id)

    def _run_existing(self, job_id: str, handler: ExistingJobHandler) -> None:
        try:
            handler()
        except Exception as exc:
            self._fail_if_active(job_id, exc)
        finally:
            self._mark_inactive(job_id)

    def _fail_if_active(self, job_id: str, exc: Exception) -> None:
        job = self.jobs.get_job(job_id)
        if job is None or job["status"] in TERMINAL_STATUSES:
            return
        self.jobs.fail_job(job_id, error_message=str(exc), stage="업무엔진 작업 실패")

    def _mark_inactive(self, job_id: str) -> None:
        with self._lock:
            self._active_job_ids.discard(job_id)
