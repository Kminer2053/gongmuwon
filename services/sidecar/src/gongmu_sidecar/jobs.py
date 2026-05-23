from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from .db import Database, now_iso


TERMINAL_STATUSES = {"succeeded", "partial", "failed", "canceled"}
ACTIVE_STATUSES = {"queued", "blocked", "running", "waiting_approval", "cancel_requested"}


class JobManager:
    def __init__(self, db: Database) -> None:
        self.db = db

    def create_job(
        self,
        *,
        kind: str,
        title: str,
        input: dict[str, Any] | None = None,
        resource_key: str | None = None,
        resource_policy: str = "none",
        priority: int = 50,
    ) -> dict[str, Any]:
        timestamp = now_iso()
        payload = {
            "id": str(uuid4()),
            "kind": kind,
            "title": title,
            "status": "queued",
            "priority": priority,
            "resource_key": resource_key,
            "resource_policy": resource_policy,
            "progress_percent": 0,
            "current_stage": "대기 중",
            "cancel_requested": 0,
            "input_json": json.dumps(input or {}, ensure_ascii=False),
            "result_json": "{}",
            "error_message": None,
            "created_at": timestamp,
            "queued_at": timestamp,
            "started_at": None,
            "completed_at": None,
        }
        self.db.insert("work_jobs", payload)
        self.append_event(
            payload["id"],
            level="info",
            event_type="job.created",
            message="작업이 대기열에 등록되었습니다.",
            payload={"kind": kind, "resource_key": resource_key},
        )
        return self.get_job(payload["id"]) or self._serialize_job(payload)

    def start_job(self, job_id: str, *, stage: str = "실행 중") -> dict[str, Any]:
        timestamp = now_iso()
        self.db.execute(
            """
            UPDATE work_jobs
            SET status = ?, started_at = COALESCE(started_at, ?), current_stage = ?
            WHERE id = ?
            """,
            ("running", timestamp, stage, job_id),
        )
        self.append_event(job_id, level="info", event_type="job.started", message=stage)
        return self.require_job(job_id)

    def start_job_with_lock(self, job_id: str, *, stage: str = "실행 중") -> dict[str, Any]:
        job = self.require_job(job_id)
        if job["status"] in TERMINAL_STATUSES:
            return job
        if job["status"] == "cancel_requested" or job["cancel_requested"]:
            return job
        resource_key = job.get("resource_key")
        if job.get("resource_policy") == "exclusive" and resource_key:
            if not self.acquire_lock(job_id, str(resource_key), lock_type="exclusive"):
                return self.require_job(job_id)
        return self.start_job(job_id, stage=stage)

    def update_progress(
        self,
        job_id: str,
        *,
        progress_percent: int,
        stage: str,
        message: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        progress = max(0, min(100, int(progress_percent)))
        self.db.execute(
            """
            UPDATE work_jobs
            SET progress_percent = ?, current_stage = ?
            WHERE id = ?
            """,
            (progress, stage, job_id),
        )
        self.append_event(
            job_id,
            level="info",
            event_type="job.progress",
            message=message or stage,
            payload={"progress_percent": progress, **(payload or {})},
        )
        return self.require_job(job_id)

    def complete_job(
        self,
        job_id: str,
        *,
        status: str = "succeeded",
        result: dict[str, Any] | None = None,
        stage: str = "완료",
    ) -> dict[str, Any]:
        if status not in TERMINAL_STATUSES:
            raise ValueError(f"unsupported terminal job status: {status}")
        timestamp = now_iso()
        self.db.execute(
            """
            UPDATE work_jobs
            SET status = ?, progress_percent = ?, current_stage = ?, result_json = ?, completed_at = ?
            WHERE id = ?
            """,
            (status, 100, stage, json.dumps(result or {}, ensure_ascii=False), timestamp, job_id),
        )
        self.release_lock(job_id)
        self.append_event(job_id, level="info", event_type=f"job.{status}", message=stage, payload=result or {})
        return self.require_job(job_id)

    def fail_job(self, job_id: str, *, error_message: str, stage: str = "실패") -> dict[str, Any]:
        timestamp = now_iso()
        self.db.execute(
            """
            UPDATE work_jobs
            SET status = ?, current_stage = ?, error_message = ?, completed_at = ?
            WHERE id = ?
            """,
            ("failed", stage, error_message, timestamp, job_id),
        )
        self.release_lock(job_id)
        self.append_event(
            job_id,
            level="error",
            event_type="job.failed",
            message=error_message,
            payload={"stage": stage},
        )
        return self.require_job(job_id)

    def request_cancel(self, job_id: str) -> dict[str, Any]:
        job = self.require_job(job_id)
        if job["status"] in TERMINAL_STATUSES:
            return job
        if job["status"] in {"queued", "blocked"}:
            timestamp = now_iso()
            self.db.execute(
                """
                UPDATE work_jobs
                SET status = ?, cancel_requested = ?, current_stage = ?, completed_at = ?
                WHERE id = ?
                """,
                ("canceled", 1, "취소 완료", timestamp, job_id),
            )
            self.release_lock(job_id)
            self.append_event(
                job_id,
                level="warning",
                event_type="job.canceled",
                message="실행 전 작업이 취소되었습니다.",
            )
            return self.require_job(job_id)
        self.db.execute(
            """
            UPDATE work_jobs
            SET status = ?, cancel_requested = ?, current_stage = ?
            WHERE id = ?
            """,
            ("cancel_requested", 1, "취소 요청됨", job_id),
        )
        self.append_event(
            job_id,
            level="warning",
            event_type="job.cancel_requested",
            message="사용자가 작업 취소를 요청했습니다.",
        )
        return self.require_job(job_id)

    def recover_interrupted_jobs(self) -> int:
        rows = self.db.fetch_all(
            "SELECT * FROM work_jobs WHERE status IN (?, ?)",
            ("running", "cancel_requested"),
        )
        for row in rows:
            self.fail_job(
                row["id"],
                error_message="업무엔진이 재시작되어 진행 중이던 작업을 안전하게 중단했습니다.",
                stage="재시작 복구",
            )
        return len(rows)

    def list_jobs(self, *, limit: int = 50) -> list[dict[str, Any]]:
        safe_limit = max(1, min(limit, 200))
        rows = self.db.fetch_all(
            """
            SELECT *
            FROM work_jobs
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (safe_limit,),
        )
        return [self._serialize_job(row) for row in rows]

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        row = self.db.fetch_one("SELECT * FROM work_jobs WHERE id = ?", (job_id,))
        return self._serialize_job(row) if row else None

    def require_job(self, job_id: str) -> dict[str, Any]:
        job = self.get_job(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def list_events(self, job_id: str, *, limit: int = 200) -> list[dict[str, Any]]:
        self.require_job(job_id)
        safe_limit = max(1, min(limit, 1000))
        rows = self.db.fetch_all(
            """
            SELECT *
            FROM work_job_events
            WHERE job_id = ?
            ORDER BY seq ASC
            LIMIT ?
            """,
            (job_id, safe_limit),
        )
        return [self._serialize_event(row) for row in rows]

    def append_event(
        self,
        job_id: str,
        *,
        level: str,
        event_type: str,
        message: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        timestamp = now_iso()
        with self.db.transaction():
            seq_row = self.db.fetch_one(
                "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM work_job_events WHERE job_id = ?",
                (job_id,),
            )
            event = {
                "id": str(uuid4()),
                "job_id": job_id,
                "seq": int(seq_row["next_seq"] if seq_row else 1),
                "level": level,
                "event_type": event_type,
                "message": message,
                "payload_json": json.dumps(payload or {}, ensure_ascii=False),
                "created_at": timestamp,
            }
            self.db.insert("work_job_events", event)
        return self._serialize_event(event)

    def acquire_lock(self, job_id: str, resource_key: str, *, lock_type: str = "exclusive") -> bool:
        existing = self.db.fetch_one("SELECT * FROM work_job_locks WHERE resource_key = ?", (resource_key,))
        if existing and existing["job_id"] == job_id:
            return True
        if existing and existing["job_id"] != job_id:
            self.db.execute(
                "UPDATE work_jobs SET status = ?, current_stage = ? WHERE id = ?",
                ("blocked", "선행 작업 완료 후 실행 대기", job_id),
            )
            self.append_event(
                job_id,
                level="warning",
                event_type="job.blocked",
                message="같은 자원을 사용하는 작업이 끝날 때까지 대기합니다.",
                payload={"resource_key": resource_key, "blocking_job_id": existing["job_id"]},
            )
            return False
        self.db.insert(
            "work_job_locks",
            {
                "resource_key": resource_key,
                "job_id": job_id,
                "lock_type": lock_type,
                "acquired_at": now_iso(),
            },
        )
        return True

    def release_lock(self, job_id: str) -> None:
        rows = self.db.fetch_all("SELECT resource_key FROM work_job_locks WHERE job_id = ?", (job_id,))
        resource_keys = [str(row["resource_key"]) for row in rows]
        self.db.execute("DELETE FROM work_job_locks WHERE job_id = ?", (job_id,))
        for resource_key in resource_keys:
            self._unblock_next_job(resource_key)

    def _unblock_next_job(self, resource_key: str) -> None:
        row = self.db.fetch_one(
            """
            SELECT id
            FROM work_jobs
            WHERE resource_key = ? AND status = ?
            ORDER BY priority ASC, created_at ASC
            LIMIT 1
            """,
            (resource_key, "blocked"),
        )
        if not row:
            return
        job_id = str(row["id"])
        self.db.execute(
            """
            UPDATE work_jobs
            SET status = ?, current_stage = ?
            WHERE id = ?
            """,
            ("queued", "선행 작업 완료, 실행 대기", job_id),
        )
        self.append_event(
            job_id,
            level="info",
            event_type="job.unblocked",
            message="선행 작업이 끝나 실행 대기열로 돌아왔습니다.",
            payload={"resource_key": resource_key},
        )

    @staticmethod
    def _json_object(value: Any) -> dict[str, Any]:
        if not isinstance(value, str) or not value:
            return {}
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def _serialize_job(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "cancel_requested": bool(row.get("cancel_requested")),
            "input": self._json_object(row.get("input_json")),
            "result": self._json_object(row.get("result_json")),
        }

    def _serialize_event(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "payload": self._json_object(row.get("payload_json")),
        }
