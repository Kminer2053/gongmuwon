from __future__ import annotations

import inspect
import json
import traceback
import unicodedata
from collections.abc import Callable
from pathlib import Path
from time import perf_counter
from typing import Any
from uuid import uuid4

from .db import Database, now_iso
from .document_parsers import parse_document
from .embeddings import EmbeddingResult, embed_text, tokenize
from .graphrag_backends import build_backend_status
from .graphrag_models import StructuredDocument, StructuredSection
from .ontology import extract_ontology, stable_edge_id, stable_node_id


INGESTION_SIGNATURE = "graphrag-sqlite-quality-v3"
INGESTION_STAGES = [
    ("scan", "폴더 스캔"),
    ("parse", "문서 파싱"),
    ("chunk", "청킹"),
    ("embed", "임베딩/Chroma"),
    ("graph", "그래프 연결"),
    ("ready", "검색 준비"),
]
INGESTION_STAGE_LABELS = {key: label for key, label in INGESTION_STAGES}
INGESTION_STAGE_INDEXES = {key: index for index, (key, _) in enumerate(INGESTION_STAGES)}
SECTION_CHUNK_MAX_CHARS = 4000
SECTION_CHUNK_OVERLAP_CHARS = 250
STRUCTURE_PREVIEW_DEFAULT_SECTIONS = 60
STRUCTURE_PREVIEW_MAX_SECTIONS = 300
STRUCTURE_PREVIEW_TEXT_CHARS = 1600
VECTOR_UPSERT_BATCH_SIZE = 128
QUERY_TERM_EXPANSIONS = {
    "프롬프트": ("prompt", "prompting", "prompt engineering", "system prompt"),
    "프롬프트엔지니어링": ("prompt engineering", "prompt", "instruction design"),
    "프롬프트 엔지니어링": ("prompt engineering", "prompt", "instruction design"),
    "인공지능": ("ai", "artificial intelligence"),
    "생성형 ai": ("generative ai", "genai", "llm"),
    "생성형ai": ("generative ai", "genai", "llm"),
}


class GraphRAGIngestionManager:
    def __init__(
        self,
        db: Database,
        *,
        embedding_provider: Callable[[str], EmbeddingResult] | None = None,
        vector_backend: Any | None = None,
    ) -> None:
        self.db = db
        self.embedding_provider = embedding_provider or (lambda text: embed_text(text))
        self.vector_backend = vector_backend
        self._active_running_job_ids: set[str] = set()
        self._pending_vector_records: list[dict[str, Any]] = []

    def backend_status(self) -> dict[str, dict[str, Any]]:
        return build_backend_status(
            self.db.paths.root,
            production_enabled=self.vector_backend is not None,
        )

    def list_jobs(self) -> list[dict[str, Any]]:
        return self.db.fetch_all(
            "SELECT * FROM knowledge_ingestion_jobs ORDER BY created_at DESC"
        )

    def read_job_log(self, job_id: str, *, limit: int = 200) -> dict[str, Any]:
        job = self.db.fetch_one("SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,))
        if job is None:
            raise KeyError(job_id)
        safe_limit = max(1, min(limit, 1000))
        log_path = Path(job.get("log_dump_path") or self._ingestion_log_path(job_id))
        items: list[dict[str, Any]] = []
        if log_path.exists():
            lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
            for line in lines[-safe_limit:]:
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    parsed = {"event": "log.parse_error", "message": line}
                if isinstance(parsed, dict):
                    items.append(parsed)
        return {
            "job_id": job_id,
            "log_dump_path": str(log_path),
            "limit": safe_limit,
            "items": items,
        }

    def active_job(self) -> dict[str, Any] | None:
        return self.db.fetch_one(
            """
            SELECT *
            FROM knowledge_ingestion_jobs
            WHERE status IN (?, ?)
            ORDER BY created_at DESC
            LIMIT 1
            """,
            ("queued", "running"),
        )

    def recover_interrupted_jobs(self, *, reason: str = "sidecar restarted before job completed") -> int:
        rows = self.db.fetch_all(
            "SELECT * FROM knowledge_ingestion_jobs WHERE status = ?",
            ("running",),
        )
        for job in rows:
            self._mark_job_canceled(
                job["id"],
                processed_count=job.get("processed_count") or 0,
                failed_count=job.get("failed_count") or 0,
                deleted_document_count=job.get("deleted_document_count") or 0,
                skipped_count=job.get("skipped_count") or 0,
                duration_ms=job.get("duration_ms"),
                average_ms_per_file=job.get("average_ms_per_file"),
                error_message=reason,
            )
        return len(rows)

    def ingest_source(self, source_id: str, run_now: bool = True, *, force: bool = False) -> dict[str, Any]:
        source = self.db.fetch_one("SELECT * FROM knowledge_sources WHERE id = ?", (source_id,))
        if source is None:
            raise KeyError(source_id)
        active_job = self._active_job_for_source(source_id)
        if active_job is not None:
            raise ValueError(f"active knowledge ingestion job already exists: {active_job['id']}")

        source_files, skipped_count = self._source_files_for_ingestion(source_id, force=force)
        timestamp = now_iso()
        job_id = str(uuid4())
        job = {
            "id": job_id,
            "source_id": source_id,
            "status": "queued",
            "current_stage": INGESTION_STAGE_LABELS["scan"],
            "current_stage_index": INGESTION_STAGE_INDEXES["scan"],
            "stage_count": len(INGESTION_STAGES),
            "progress_percent": 0,
            "queued_count": len(source_files),
            "processed_count": 0,
            "failed_count": 0,
            "deleted_document_count": 0,
            "skipped_count": skipped_count,
            "force_rebuild": 1 if force else 0,
            "cancel_requested": 0,
            "last_processed_path": None,
            "last_processed_at": None,
            "duration_ms": None,
            "average_ms_per_file": None,
            "error_message": None,
            "log_dump_path": str(self._ingestion_log_path(job_id)),
            "diagnostic_event_count": 0,
            "last_diagnostic_message": None,
            "created_at": timestamp,
            "started_at": None,
            "completed_at": None,
        }
        self.db.insert("knowledge_ingestion_jobs", job)
        self._append_ingestion_event(
            job_id,
            "job.created",
            stage="scan",
            message="GraphRAG ingestion 작업 생성",
            source_id=source_id,
            queued_count=len(source_files),
            skipped_count=skipped_count,
            force_rebuild=force,
        )

        if not run_now:
            return self.db.fetch_one("SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,)) or job

        started_at = now_iso()
        started_perf = perf_counter()
        self.db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET status = ?, started_at = ?, current_stage = ?, current_stage_index = ?, progress_percent = ?
            WHERE id = ?
            """,
            ("running", started_at, INGESTION_STAGE_LABELS["scan"], INGESTION_STAGE_INDEXES["scan"], 1, job_id),
        )
        self._append_ingestion_event(
            job_id,
            "job.started",
            stage="scan",
            message="GraphRAG ingestion 시작",
            source_id=source_id,
            queued_count=len(source_files),
        )

        processed_count = 0
        failed_count = 0
        errors: list[str] = []
        deleted_document_count = self._purge_deleted_source_documents(source_id)
        self._append_ingestion_event(
            job_id,
            "deleted_documents.purged",
            stage="scan",
            message=f"삭제 문서 동기화 {deleted_document_count}건",
            deleted_document_count=deleted_document_count,
        )
        for source_file in source_files:
            try:
                self._ingest_source_file_for_job(
                    source_file,
                    job_id=job_id,
                    completed_files=processed_count + failed_count,
                    total_files=len(source_files),
                )
                processed_count += 1
                self._mark_job_progress(
                    job_id,
                    source_file,
                    processed_count=processed_count,
                    failed_count=failed_count,
                    total_files=len(source_files),
                )
            except Exception as exc:
                self.db.rollback()
                failed_count += 1
                errors.append(f"{source_file.get('relative_path')}: {exc}")
                self._append_ingestion_event(
                    job_id,
                    "file.failed",
                    stage="graph",
                    level="error",
                    message=f"파일 처리 실패: {source_file.get('relative_path')}",
                    relative_path=source_file.get("relative_path"),
                    file_path=source_file.get("file_path"),
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                    traceback=traceback.format_exc(),
                )
                self._mark_job_progress(
                    job_id,
                    source_file,
                    processed_count=processed_count,
                    failed_count=failed_count,
                    total_files=len(source_files),
                )

        status = "completed" if failed_count == 0 else "partial"
        completed_at = now_iso()
        duration_ms = int((perf_counter() - started_perf) * 1000)
        attempted_count = max(1, processed_count + failed_count)
        average_ms_per_file = round(duration_ms / attempted_count, 2)
        error_message = "\n".join(errors) if errors else None
        self.db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET status = ?,
                processed_count = ?,
                failed_count = ?,
                deleted_document_count = ?,
                skipped_count = ?,
                duration_ms = ?,
                average_ms_per_file = ?,
                error_message = ?,
                current_stage = ?,
                current_stage_index = ?,
                progress_percent = ?,
                completed_at = ?
            WHERE id = ?
            """,
            (
                status,
                processed_count,
                failed_count,
                deleted_document_count,
                skipped_count,
                duration_ms,
                average_ms_per_file,
                error_message,
                INGESTION_STAGE_LABELS["ready"],
                INGESTION_STAGE_INDEXES["ready"],
                100,
                completed_at,
                job_id,
            ),
        )
        self._append_ingestion_event(
            job_id,
            "job.completed",
            stage="ready",
            message="GraphRAG 검색 준비 완료" if status == "completed" else "GraphRAG 부분 완료 / 실패 진단 필요",
            status=status,
            queued_count=len(source_files),
            processed_count=processed_count,
            failed_count=failed_count,
            deleted_document_count=deleted_document_count,
            skipped_count=skipped_count,
            duration_ms=duration_ms,
            average_ms_per_file=average_ms_per_file,
        )
        updated = self.db.fetch_one("SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,))
        self.db.log(
            feature="knowledge",
            action="knowledge.ingest.completed",
            status=status,
            inputs={"source_id": source_id, "run_now": run_now, "force": force},
            outputs={
                "job_id": job_id,
                "queued_count": len(source_files),
                "processed_count": processed_count,
                "failed_count": failed_count,
                "deleted_document_count": deleted_document_count,
                "skipped_count": skipped_count,
                "duration_ms": duration_ms,
                "average_ms_per_file": average_ms_per_file,
            },
        )
        return updated or job

    def run_job(self, job_id: str) -> dict[str, Any]:
        job = self.db.fetch_one("SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,))
        if job is None:
            raise KeyError(job_id)
        if job["status"] in {"completed", "canceled"}:
            return job
        if job.get("cancel_requested"):
            return self._mark_job_canceled(
                job_id,
                processed_count=job.get("processed_count") or 0,
                failed_count=job.get("failed_count") or 0,
                deleted_document_count=job.get("deleted_document_count") or 0,
                skipped_count=job.get("skipped_count") or 0,
                duration_ms=job.get("duration_ms"),
                average_ms_per_file=job.get("average_ms_per_file"),
                error_message=job.get("error_message"),
            )

        force = bool(job.get("force_rebuild"))
        source_files, skipped_count = self._source_files_for_ingestion(job["source_id"], force=force)
        started_at = now_iso()
        started_perf = perf_counter()
        self.db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET status = ?,
                queued_count = ?,
                skipped_count = ?,
                started_at = ?,
                current_stage = ?,
                current_stage_index = ?,
                progress_percent = ?,
                log_dump_path = COALESCE(log_dump_path, ?)
            WHERE id = ?
            """,
            (
                "running",
                len(source_files),
                skipped_count,
                started_at,
                INGESTION_STAGE_LABELS["scan"],
                INGESTION_STAGE_INDEXES["scan"],
                1,
                str(self._ingestion_log_path(job_id)),
                job_id,
            ),
        )
        self._active_running_job_ids.add(job_id)
        self._append_ingestion_event(
            job_id,
            "job.started",
            stage="scan",
            message="GraphRAG ingestion 시작",
            source_id=job["source_id"],
            queued_count=len(source_files),
            force_rebuild=force,
        )

        processed_count = 0
        failed_count = 0
        errors: list[str] = []
        deleted_document_count = self._purge_deleted_source_documents(job["source_id"])
        self._append_ingestion_event(
            job_id,
            "deleted_documents.purged",
            stage="scan",
            message=f"삭제 문서 동기화 {deleted_document_count}건",
            deleted_document_count=deleted_document_count,
        )
        for source_file in source_files:
            if self._job_cancel_requested(job_id):
                break
            try:
                self._ingest_source_file_for_job(
                    source_file,
                    job_id=job_id,
                    completed_files=processed_count + failed_count,
                    total_files=len(source_files),
                )
                processed_count += 1
                self._mark_job_progress(
                    job["id"],
                    source_file,
                    processed_count=processed_count,
                    failed_count=failed_count,
                    total_files=len(source_files),
                )
            except Exception as exc:
                self.db.rollback()
                failed_count += 1
                errors.append(f"{source_file.get('relative_path')}: {exc}")
                self._append_ingestion_event(
                    job_id,
                    "file.failed",
                    stage="graph",
                    level="error",
                    message=f"파일 처리 실패: {source_file.get('relative_path')}",
                    relative_path=source_file.get("relative_path"),
                    file_path=source_file.get("file_path"),
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                    traceback=traceback.format_exc(),
                )
                self._mark_job_progress(
                    job["id"],
                    source_file,
                    processed_count=processed_count,
                    failed_count=failed_count,
                    total_files=len(source_files),
                )
            if self._job_cancel_requested(job_id):
                break

        canceled = self._job_cancel_requested(job_id)
        status = "canceled" if canceled else ("completed" if failed_count == 0 else "partial")
        completed_at = now_iso()
        duration_ms = int((perf_counter() - started_perf) * 1000)
        attempted_count = max(1, processed_count + failed_count)
        average_ms_per_file = round(duration_ms / attempted_count, 2)
        error_message = "\n".join(errors) if errors else None
        self.db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET status = ?,
                processed_count = ?,
                failed_count = ?,
                deleted_document_count = ?,
                skipped_count = ?,
                duration_ms = ?,
                average_ms_per_file = ?,
                error_message = ?,
                current_stage = ?,
                current_stage_index = ?,
                progress_percent = ?,
                completed_at = ?
            WHERE id = ?
            """,
            (
                status,
                processed_count,
                failed_count,
                deleted_document_count,
                skipped_count,
                duration_ms,
                average_ms_per_file,
                error_message,
                "취소됨" if canceled else INGESTION_STAGE_LABELS["ready"],
                INGESTION_STAGE_INDEXES["ready"],
                self._completion_progress_percent(canceled, processed_count, failed_count, len(source_files)),
                completed_at,
                job_id,
            ),
        )
        self._append_ingestion_event(
            job_id,
            "job.completed" if not canceled else "job.canceled",
            stage="ready",
            message=(
                "GraphRAG ingestion 취소됨"
                if canceled
                else ("GraphRAG 검색 준비 완료" if status == "completed" else "GraphRAG 부분 완료 / 실패 진단 필요")
            ),
            status=status,
            queued_count=len(source_files),
            processed_count=processed_count,
            failed_count=failed_count,
            deleted_document_count=deleted_document_count,
            skipped_count=skipped_count,
            duration_ms=duration_ms,
            average_ms_per_file=average_ms_per_file,
        )
        updated = self.db.fetch_one("SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,))
        self.db.log(
            feature="knowledge",
            action="knowledge.ingest.job.run",
            status=status,
            inputs={"job_id": job_id, "source_id": job["source_id"], "force": force},
            outputs={
                "queued_count": len(source_files),
                "processed_count": processed_count,
                "failed_count": failed_count,
                "deleted_document_count": deleted_document_count,
                "skipped_count": skipped_count,
                "duration_ms": duration_ms,
                "average_ms_per_file": average_ms_per_file,
            },
        )
        self._active_running_job_ids.discard(job_id)
        return updated or job

    def request_cancel(self, job_id: str) -> dict[str, Any]:
        job = self.db.fetch_one("SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,))
        if job is None:
            raise KeyError(job_id)
        if job["status"] in {"completed", "canceled"}:
            return job
        if job["status"] == "queued":
            return self._mark_job_canceled(
                job_id,
                processed_count=job.get("processed_count") or 0,
                failed_count=job.get("failed_count") or 0,
                deleted_document_count=job.get("deleted_document_count") or 0,
                skipped_count=job.get("skipped_count") or 0,
                duration_ms=job.get("duration_ms"),
                average_ms_per_file=job.get("average_ms_per_file"),
                error_message=job.get("error_message"),
            )
        if job["status"] == "running" and job_id not in self._active_running_job_ids:
            return self._mark_job_canceled(
                job_id,
                processed_count=job.get("processed_count") or 0,
                failed_count=job.get("failed_count") or 0,
                deleted_document_count=job.get("deleted_document_count") or 0,
                skipped_count=job.get("skipped_count") or 0,
                duration_ms=job.get("duration_ms"),
                average_ms_per_file=job.get("average_ms_per_file"),
                error_message="running job worker is not active; marked canceled",
            )
        self.db.execute(
            "UPDATE knowledge_ingestion_jobs SET cancel_requested = ? WHERE id = ?",
            (1, job_id),
        )
        return self.db.fetch_one("SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,)) or job

    def _mark_job_progress(
        self,
        job_id: str,
        source_file: dict[str, Any],
        *,
        processed_count: int | None = None,
        failed_count: int | None = None,
        total_files: int | None = None,
    ) -> None:
        attempted = (processed_count or 0) + (failed_count or 0)
        progress_percent = self._attempted_progress_percent(attempted, total_files or 0)
        self.db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET last_processed_path = ?,
                last_processed_at = ?,
                processed_count = COALESCE(?, processed_count),
                failed_count = COALESCE(?, failed_count),
                progress_percent = ?
            WHERE id = ?
            """,
            (
                source_file.get("relative_path") or source_file.get("file_path"),
                now_iso(),
                processed_count,
                failed_count,
                progress_percent,
                job_id,
            ),
        )

    def _ingestion_log_path(self, job_id: str) -> Path:
        log_dir = self.db.paths.logs / "knowledge-ingestion"
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir / f"{job_id}.jsonl"

    def _append_ingestion_event(
        self,
        job_id: str,
        event: str,
        *,
        stage: str,
        message: str,
        level: str = "info",
        **payload: Any,
    ) -> None:
        log_path = self._ingestion_log_path(job_id)
        entry = {
            "timestamp": now_iso(),
            "job_id": job_id,
            "event": event,
            "stage": stage,
            "stage_label": INGESTION_STAGE_LABELS.get(stage, stage),
            "level": level,
            "message": message,
            **payload,
        }
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        self.db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET log_dump_path = ?,
                diagnostic_event_count = COALESCE(diagnostic_event_count, 0) + 1,
                last_diagnostic_message = ?
            WHERE id = ?
            """,
            (str(log_path), message, job_id),
        )

    def _set_job_stage(
        self,
        job_id: str,
        stage: str,
        *,
        progress_percent: int,
    ) -> None:
        self.db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET current_stage = ?,
                current_stage_index = ?,
                stage_count = ?,
                progress_percent = ?
            WHERE id = ?
            """,
            (
                INGESTION_STAGE_LABELS.get(stage, stage),
                INGESTION_STAGE_INDEXES.get(stage, 0),
                len(INGESTION_STAGES),
                max(0, min(100, progress_percent)),
                job_id,
            ),
        )

    def _stage_progress_percent(self, completed_files: int, total_files: int, stage: str) -> int:
        if total_files <= 0:
            return 100
        stage_index = INGESTION_STAGE_INDEXES.get(stage, 0)
        intra_file_progress = stage_index / max(1, len(INGESTION_STAGES))
        progress = ((completed_files + intra_file_progress) / total_files) * 100
        return max(1, min(99, round(progress)))

    @staticmethod
    def _attempted_progress_percent(attempted_files: int, total_files: int) -> int:
        if total_files <= 0:
            return 100
        return max(0, min(99, round((attempted_files / total_files) * 100)))

    @staticmethod
    def _completion_progress_percent(
        canceled: bool,
        processed_count: int,
        failed_count: int,
        total_files: int,
    ) -> int:
        if not canceled:
            return 100
        if total_files <= 0:
            return 0
        return max(0, min(99, round(((processed_count + failed_count) / total_files) * 100)))

    def _active_job_for_source(self, source_id: str) -> dict[str, Any] | None:
        return self.db.fetch_one(
            """
            SELECT *
            FROM knowledge_ingestion_jobs
            WHERE source_id = ? AND status IN (?, ?)
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (source_id, "queued", "running"),
        )

    def _job_cancel_requested(self, job_id: str) -> bool:
        row = self.db.fetch_one(
            "SELECT cancel_requested FROM knowledge_ingestion_jobs WHERE id = ?",
            (job_id,),
        )
        return bool(row and row.get("cancel_requested"))

    def _ingest_source_file_for_job(
        self,
        source_file: dict[str, Any],
        *,
        job_id: str,
        completed_files: int,
        total_files: int,
    ) -> dict[str, Any]:
        """Call the ingest hook with diagnostics when the current hook supports it."""
        ingest = self._ingest_source_file
        try:
            parameters = inspect.signature(ingest).parameters
        except (TypeError, ValueError):
            parameters = {}
        supports_job_kwargs = "job_id" in parameters or any(
            parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()
        )
        if supports_job_kwargs:
            return ingest(
                source_file,
                job_id=job_id,
                completed_files=completed_files,
                total_files=total_files,
            )
        return ingest(source_file)

    def _mark_job_canceled(
        self,
        job_id: str,
        *,
        processed_count: int,
        failed_count: int,
        deleted_document_count: int,
        skipped_count: int,
        duration_ms: int | None,
        average_ms_per_file: float | None,
        error_message: str | None,
    ) -> dict[str, Any]:
        completed_at = now_iso()
        self.db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET status = ?,
                cancel_requested = ?,
                processed_count = ?,
                failed_count = ?,
                deleted_document_count = ?,
                skipped_count = ?,
                duration_ms = ?,
                average_ms_per_file = ?,
                error_message = ?,
                current_stage = ?,
                current_stage_index = ?,
                progress_percent = ?,
                completed_at = ?
            WHERE id = ?
            """,
            (
                "canceled",
                1,
                processed_count,
                failed_count,
                deleted_document_count,
                skipped_count,
                duration_ms,
                average_ms_per_file,
                error_message,
                "취소됨",
                INGESTION_STAGE_INDEXES["ready"],
                0,
                completed_at,
                job_id,
            ),
        )
        self._append_ingestion_event(
            job_id,
            "job.canceled",
            stage="ready",
            message="GraphRAG ingestion 취소됨",
            processed_count=processed_count,
            failed_count=failed_count,
            deleted_document_count=deleted_document_count,
            skipped_count=skipped_count,
        )
        return self.db.fetch_one("SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,)) or {}

    def list_chunks(self, document_id: str | None = None) -> list[dict[str, Any]]:
        if document_id:
            return self.db.fetch_all(
                "SELECT * FROM knowledge_document_chunks WHERE document_id = ? ORDER BY chunk_index ASC",
                (document_id,),
            )
        return self.db.fetch_all(
            "SELECT * FROM knowledge_document_chunks ORDER BY created_at DESC, chunk_index ASC"
        )

    def list_tables(self, document_id: str | None = None) -> list[dict[str, Any]]:
        if document_id:
            rows = self.db.fetch_all(
                "SELECT * FROM knowledge_table_blocks WHERE document_id = ? ORDER BY order_index ASC",
                (document_id,),
            )
        else:
            rows = self.db.fetch_all(
                "SELECT * FROM knowledge_table_blocks ORDER BY created_at DESC, order_index ASC"
            )
        return [self._serialize_table(row) for row in rows]

    def _list_tables_for_sections(self, document_id: str, section_ids: list[str]) -> list[dict[str, Any]]:
        if not section_ids:
            return []
        placeholders = ", ".join("?" for _ in section_ids)
        rows = self.db.fetch_all(
            f"""
            SELECT *
            FROM knowledge_table_blocks
            WHERE document_id = ? AND section_id IN ({placeholders})
            ORDER BY order_index ASC
            """,
            (document_id, *section_ids),
        )
        return [self._serialize_table(row) for row in rows]

    def list_documents(self, source_id: str | None = None) -> list[dict[str, Any]]:
        where_clause = "WHERE d.source_id = ?" if source_id else ""
        params: tuple[Any, ...] = (source_id,) if source_id else ()
        rows = self.db.fetch_all(
            f"""
            SELECT d.*,
                   COALESCE(s.section_count, 0) AS section_count,
                   COALESCE(t.table_count, 0) AS table_count,
                   COALESCE(c.chunk_count, 0) AS chunk_count,
                   COALESCE(c.table_chunk_count, 0) AS table_chunk_count
            FROM knowledge_documents d
            LEFT JOIN (
                SELECT document_id, COUNT(*) AS section_count
                FROM knowledge_document_sections
                GROUP BY document_id
            ) s ON s.document_id = d.id
            LEFT JOIN (
                SELECT document_id, COUNT(*) AS table_count
                FROM knowledge_table_blocks
                GROUP BY document_id
            ) t ON t.document_id = d.id
            LEFT JOIN (
                SELECT document_id,
                       COUNT(*) AS chunk_count,
                       COUNT(CASE WHEN text LIKE '표:%' THEN 1 END) AS table_chunk_count
                FROM knowledge_document_chunks
                GROUP BY document_id
            ) c ON c.document_id = d.id
            {where_clause}
            ORDER BY d.updated_at DESC, d.title ASC
            """,
            params,
        )
        return [self._serialize_document(row) for row in rows]

    def document_structure(
        self,
        document_id: str,
        *,
        section_limit: int = STRUCTURE_PREVIEW_DEFAULT_SECTIONS,
    ) -> dict[str, Any]:
        document = self.db.fetch_one("SELECT * FROM knowledge_documents WHERE id = ?", (document_id,))
        if document is None:
            raise KeyError(document_id)
        safe_limit = max(1, min(section_limit, STRUCTURE_PREVIEW_MAX_SECTIONS))
        section_count_row = self.db.fetch_one(
            "SELECT COUNT(*) AS count FROM knowledge_document_sections WHERE document_id = ?",
            (document_id,),
        )
        section_count = int(section_count_row["count"] if section_count_row else 0)
        sections = self.db.fetch_all(
            """
            SELECT *
            FROM knowledge_document_sections
            WHERE document_id = ?
            ORDER BY order_index ASC
            LIMIT ?
            """,
            (document_id, safe_limit),
        )
        tables = self._list_tables_for_sections(document_id, [section["id"] for section in sections])
        tables_by_section: dict[str | None, list[dict[str, Any]]] = {}
        for table in tables:
            tables_by_section.setdefault(table.get("section_id"), []).append(table)
        preview_sections = []
        for section in sections:
            text = str(section.get("text") or "")
            text_truncated = len(text) > STRUCTURE_PREVIEW_TEXT_CHARS
            preview_text = text[:STRUCTURE_PREVIEW_TEXT_CHARS].rstrip()
            if text_truncated:
                preview_text = f"{preview_text}..."
            preview_sections.append(
                {
                    **section,
                    "text": preview_text,
                    "text_truncated": text_truncated,
                    "tables": tables_by_section.get(section["id"], []),
                }
            )
        return {
            "document": self._serialize_document(self._document_with_chunk_counts(document)),
            "sections": preview_sections,
            "section_count": section_count,
            "sections_returned": len(sections),
            "has_more_sections": section_count > len(sections),
        }

    def retrieve(self, *, query: str, session_id: str | None = None, limit: int = 5) -> dict[str, Any]:
        normalized_query = unicodedata.normalize("NFC", query.strip().lower())
        safe_limit = max(1, min(limit, 20))
        base_query_tokens = set(tokenize(normalized_query))
        expanded_terms = self._expanded_query_terms(normalized_query, base_query_tokens)
        query_tokens = set(base_query_tokens)
        for term in expanded_terms:
            query_tokens.update(tokenize(term))
        query_embedding = self._safe_embed_query(normalized_query)
        vector_backend_scores = self._vector_backend_scores(query_embedding, safe_limit)
        linked_paths = self._session_linked_paths(session_id)
        candidate_chunk_ids = self._retrieval_candidate_chunk_ids(
            normalized_query=normalized_query,
            query_tokens=query_tokens,
            vector_backend_scores=vector_backend_scores,
            linked_paths=linked_paths,
            limit=safe_limit,
        )
        chunks = self._fetch_retrieval_chunks(candidate_chunk_ids)
        hits: list[dict[str, Any]] = []
        for chunk in chunks:
            text = str(chunk["text"])
            haystack = "\n".join(
                [
                    text,
                    str(chunk.get("document_title") or ""),
                    str(chunk.get("document_file_path") or ""),
                ]
            ).lower()
            text_score = 0
            if normalized_query and normalized_query in haystack:
                text_score += 50
            if any(term and term in haystack for term in expanded_terms):
                text_score += 50
            text_score += len(query_tokens.intersection(tokenize(haystack))) * 10
            graph_score = self._document_graph_score(chunk["document_id"], normalized_query, query_tokens)
            vector_score = self._chunk_vector_score(chunk, query_embedding)
            vector_backend_score = vector_backend_scores.get(chunk["id"], 0.0)
            session_context_boost = 35 if chunk["document_file_path"] in linked_paths else 0
            evidence_type = self._chunk_evidence_type(text)
            table_token_hits = len(query_tokens.intersection(tokenize(haystack)))
            table_evidence_boost = (
                20 + table_token_hits * 8
                if evidence_type == "table" and text_score > 0
                else 0
            )
            if (
                query_embedding is not None
                and query_embedding.backend == "deterministic"
                and text_score == 0
                and graph_score == 0
                and session_context_boost == 0
            ):
                vector_score = 0.0
                vector_backend_score = 0.0
            raw_score = (
                text_score
                + graph_score
                + vector_score
                + vector_backend_score
                + session_context_boost
                + table_evidence_boost
            )
            quality_penalty = self._retrieval_quality_penalty(
                quality_score=chunk["document_quality_score"],
                partial=bool(chunk["document_partial"]),
            )
            score = max(1.0, raw_score + quality_penalty) if raw_score > 0 else raw_score
            if score <= 0:
                continue
            ontology_relations = self._document_ontology_relations(chunk["document_id"])
            hits.append(
                {
                    "evidence_type": evidence_type,
                    "chunk": {
                        "id": chunk["id"],
                        "document_id": chunk["document_id"],
                        "section_id": chunk.get("section_id"),
                        "text": chunk["text"],
                        "chunk_index": chunk["chunk_index"],
                    },
                    "document": {
                        "id": chunk["document_id"],
                        "title": chunk["document_title"],
                        "file_path": chunk["document_file_path"],
                        "document_type": chunk["document_type"],
                        "parser_name": chunk["document_parser_name"],
                        "quality_score": chunk["document_quality_score"],
                        "partial": bool(chunk["document_partial"]),
                        "metadata": self._safe_json_object(chunk.get("document_metadata_json")),
                    },
                    "score": score,
                    "score_breakdown": {
                        "text_score": text_score,
                        "graph_score": graph_score,
                        "vector_score": vector_score,
                        "vector_backend_score": vector_backend_score,
                        "session_context_boost": session_context_boost,
                        "table_evidence_boost": table_evidence_boost,
                        "quality_penalty": quality_penalty,
                    },
                    "relations": [
                        {
                            "source_label": chunk["document_title"],
                            "relation": "HAS_CHUNK",
                            "target_label": self._chunk_label(text),
                        }
                    ]
                    + ontology_relations,
                }
            )

        hits.sort(key=lambda item: item["score"], reverse=True)
        return {"query": query, "session_id": session_id, "items": hits[:safe_limit]}

    @staticmethod
    def _retrieval_quality_penalty(*, quality_score: Any, partial: bool) -> float:
        try:
            score = float(quality_score or 0)
        except (TypeError, ValueError):
            score = 0.0

        penalty = 0.0
        if score <= 0.05:
            penalty -= 90.0
        elif score < 0.3:
            penalty -= 60.0
        elif score < 0.5:
            penalty -= 25.0
        if partial:
            penalty -= 30.0
        return penalty

    def _fetch_retrieval_chunks(self, candidate_chunk_ids: set[str] | None) -> list[dict[str, Any]]:
        base_sql = """
            SELECT c.*,
                   d.title AS document_title,
                   d.file_path AS document_file_path,
                   d.document_type,
                   d.parser_name AS document_parser_name,
                   d.quality_score AS document_quality_score,
                   d.partial AS document_partial,
                   d.metadata_json AS document_metadata_json
            FROM knowledge_document_chunks c
            JOIN knowledge_documents d ON d.id = c.document_id
        """
        if candidate_chunk_ids is None:
            return self.db.fetch_all(f"{base_sql} ORDER BY c.created_at DESC")
        if not candidate_chunk_ids:
            return []
        ordered_ids = sorted(candidate_chunk_ids)
        placeholders = ", ".join("?" for _ in ordered_ids)
        return self.db.fetch_all(
            f"{base_sql} WHERE c.id IN ({placeholders}) ORDER BY c.created_at DESC",
            tuple(ordered_ids),
        )

    def _retrieval_candidate_chunk_ids(
        self,
        *,
        normalized_query: str,
        query_tokens: set[str],
        vector_backend_scores: dict[str, float],
        linked_paths: set[str],
        limit: int,
    ) -> set[str] | None:
        if self.vector_backend is None:
            return None

        max_candidates = max(limit * 20, 80)
        candidate_ids = set(vector_backend_scores)
        candidate_ids.update(self._lexical_candidate_chunk_ids(normalized_query, query_tokens, max_candidates))
        candidate_ids.update(self._graph_candidate_chunk_ids(normalized_query, query_tokens, max_candidates))
        candidate_ids.update(self._session_candidate_chunk_ids(linked_paths, max_candidates))
        return candidate_ids

    def _lexical_candidate_chunk_ids(
        self,
        normalized_query: str,
        query_tokens: set[str],
        max_candidates: int,
    ) -> set[str]:
        patterns = self._retrieval_like_patterns(normalized_query, query_tokens)
        if not patterns:
            return set()
        clauses = []
        params: list[Any] = []
        for pattern in patterns:
            clauses.append("(LOWER(c.text) LIKE ? OR LOWER(d.title) LIKE ?)")
            params.extend([pattern, pattern])
        params.append(max_candidates)
        rows = self.db.fetch_all(
            f"""
            SELECT DISTINCT c.id
            FROM knowledge_document_chunks c
            JOIN knowledge_documents d ON d.id = c.document_id
            WHERE {" OR ".join(clauses)}
            ORDER BY c.created_at DESC
            LIMIT ?
            """,
            tuple(params),
        )
        return {row["id"] for row in rows}

    def _graph_candidate_chunk_ids(
        self,
        normalized_query: str,
        query_tokens: set[str],
        max_candidates: int,
    ) -> set[str]:
        patterns = self._retrieval_like_patterns(normalized_query, query_tokens)
        if not patterns:
            return set()
        clauses = []
        params: list[Any] = []
        for pattern in patterns:
            clauses.append("LOWER(n.label) LIKE ?")
            params.append(pattern)
        params.append(max_candidates)
        rows = self.db.fetch_all(
            f"""
            SELECT DISTINCT c.id
            FROM knowledge_graph_nodes n
            JOIN knowledge_document_chunks c ON c.document_id = n.source_document_id
            WHERE n.source_document_id IS NOT NULL
              AND ({" OR ".join(clauses)})
            ORDER BY c.created_at DESC
            LIMIT ?
            """,
            tuple(params),
        )
        return {row["id"] for row in rows}

    def _session_candidate_chunk_ids(self, linked_paths: set[str], max_candidates: int) -> set[str]:
        if not linked_paths:
            return set()
        ordered_paths = sorted(linked_paths)
        placeholders = ", ".join("?" for _ in ordered_paths)
        rows = self.db.fetch_all(
            f"""
            SELECT DISTINCT c.id
            FROM knowledge_document_chunks c
            JOIN knowledge_documents d ON d.id = c.document_id
            WHERE d.file_path IN ({placeholders})
            ORDER BY c.created_at DESC
            LIMIT ?
            """,
            tuple([*ordered_paths, max_candidates]),
        )
        return {row["id"] for row in rows}

    @staticmethod
    def _expanded_query_terms(normalized_query: str, query_tokens: set[str]) -> list[str]:
        terms: list[str] = []
        for source_term, expansions in QUERY_TERM_EXPANSIONS.items():
            if source_term in normalized_query or source_term in query_tokens:
                terms.extend(expansions)
        deduped: list[str] = []
        for term in terms:
            normalized = term.strip().lower()
            if normalized and normalized not in deduped:
                deduped.append(normalized)
        return deduped

    @staticmethod
    def _retrieval_like_patterns(normalized_query: str, query_tokens: set[str]) -> list[str]:
        expanded_terms = GraphRAGIngestionManager._expanded_query_terms(normalized_query, query_tokens)
        raw_terms = [
            normalized_query,
            *expanded_terms,
            *sorted(query_tokens, key=lambda item: (-len(item), item)),
        ]
        patterns: list[str] = []
        for term in raw_terms:
            clean = term.strip().lower()
            if len(clean) < 2:
                continue
            pattern = f"%{clean}%"
            if pattern not in patterns:
                patterns.append(pattern)
            if len(patterns) >= 8:
                break
        return patterns

    def ask(self, *, query: str, session_id: str | None = None, limit: int = 5) -> dict[str, Any]:
        retrieval = self.retrieve(query=query, session_id=session_id, limit=limit)
        items = retrieval["items"]
        citations = [self._citation_from_item(item) for item in items]
        answer = self._build_grounded_answer(query, items)
        return {
            "query": query,
            "session_id": session_id,
            "answer": answer,
            "citations": citations,
            "retrieval_summary": self._retrieval_summary(items),
            "items": items,
        }

    def _ingest_source_file(
        self,
        source_file: dict[str, Any],
        *,
        job_id: str | None = None,
        completed_files: int = 0,
        total_files: int = 0,
    ) -> dict[str, Any]:
        started_perf = perf_counter()
        relative_path = source_file.get("relative_path") or source_file.get("file_path")
        if job_id:
            self._set_job_stage(
                job_id,
                "parse",
                progress_percent=self._stage_progress_percent(completed_files, total_files, "parse"),
            )
            self._append_ingestion_event(
                job_id,
                "file.parse.started",
                stage="parse",
                message=f"문서 파싱 시작: {relative_path}",
                relative_path=relative_path,
                file_path=source_file.get("file_path"),
                file_hash=source_file.get("file_hash"),
                size_bytes=source_file.get("size_bytes"),
            )
        document = parse_document(Path(source_file["file_path"]))
        extraction_quality = self._build_extraction_quality_report(document)
        if job_id:
            self._append_ingestion_event(
                job_id,
                "file.parse.completed",
                stage="parse",
                message=f"문서 파싱 완료: {relative_path}",
                relative_path=relative_path,
                parser_name=document.parser_name,
                parser_version=document.parser_version,
                document_type=document.document_type,
                quality_score=extraction_quality["score"],
                partial=document.partial,
                section_count=extraction_quality["section_count"],
                paragraph_count=extraction_quality["paragraph_count"],
                table_count=extraction_quality["table_count"],
                text_char_count=extraction_quality["text_char_count"],
                warnings=extraction_quality["warnings"],
            )
            self._set_job_stage(
                job_id,
                "chunk",
                progress_percent=self._stage_progress_percent(completed_files, total_files, "chunk"),
            )
            self._append_ingestion_event(
                job_id,
                "file.document.upsert.started",
                stage="chunk",
                message=f"문서 레코드 갱신 시작: {relative_path}",
                relative_path=relative_path,
            )
        document_id = self._upsert_document(source_file, document)
        if job_id:
            self._set_job_stage(
                job_id,
                "embed",
                progress_percent=self._stage_progress_percent(completed_files, total_files, "embed"),
            )
            self._append_ingestion_event(
                job_id,
                "file.vector_graph.started",
                stage="embed",
                message=f"청크/벡터/그래프 갱신 시작: {relative_path}",
                relative_path=relative_path,
                document_id=document_id,
                vector_backend="chromadb" if self.vector_backend is not None else "sqlite",
            )
        self._replace_document_children(document_id, document)
        if job_id:
            self._set_job_stage(
                job_id,
                "graph",
                progress_percent=self._stage_progress_percent(completed_files, total_files, "graph"),
            )
            chunk_count = self.db.fetch_one(
                "SELECT COUNT(*) AS count FROM knowledge_document_chunks WHERE document_id = ?",
                (document_id,),
            )
            graph_count = self.db.fetch_one(
                "SELECT COUNT(*) AS count FROM knowledge_graph_nodes WHERE source_document_id = ?",
                (document_id,),
            )
            self._append_ingestion_event(
                job_id,
                "file.completed",
                stage="graph",
                message=f"파일 처리 완료: {relative_path}",
                relative_path=relative_path,
                document_id=document_id,
                parser_name=document.parser_name,
                quality_score=extraction_quality["score"],
                section_count=extraction_quality["section_count"],
                table_count=extraction_quality["table_count"],
                chunk_count=(chunk_count or {}).get("count", 0),
                graph_node_count=(graph_count or {}).get("count", 0),
                duration_ms=int((perf_counter() - started_perf) * 1000),
            )
        return self.db.fetch_one("SELECT * FROM knowledge_documents WHERE id = ?", (document_id,)) or {}

    def _source_files_for_ingestion(
        self,
        source_id: str,
        *,
        force: bool = False,
    ) -> tuple[list[dict[str, Any]], int]:
        source_files = self.db.fetch_all(
            """
            SELECT *
            FROM knowledge_source_files
            WHERE source_id = ? AND status != ?
            ORDER BY relative_path ASC
            """,
            (source_id, "deleted"),
        )
        if force:
            return source_files, 0

        pending: list[dict[str, Any]] = []
        skipped_count = 0
        for source_file in source_files:
            existing = self.db.fetch_one(
                "SELECT file_hash, ingestion_signature FROM knowledge_documents WHERE source_file_id = ?",
                (source_file["id"],),
            )
            if (
                existing is not None
                and existing.get("file_hash") == source_file.get("file_hash")
                and existing.get("ingestion_signature") == INGESTION_SIGNATURE
            ):
                skipped_count += 1
                continue
            pending.append(source_file)
        return pending, skipped_count

    def _purge_deleted_source_documents(self, source_id: str) -> int:
        deleted_source_files = self.db.fetch_all(
            """
            SELECT id
            FROM knowledge_source_files
            WHERE source_id = ? AND status = ?
            """,
            (source_id, "deleted"),
        )
        deleted_count = 0
        for source_file in deleted_source_files:
            documents = self.db.fetch_all(
                "SELECT id FROM knowledge_documents WHERE source_file_id = ?",
                (source_file["id"],),
            )
            for document in documents:
                self._delete_document(document["id"])
                deleted_count += 1
        return deleted_count

    def _upsert_document(self, source_file: dict[str, Any], document: StructuredDocument) -> str:
        existing = self.db.fetch_one(
            "SELECT * FROM knowledge_documents WHERE source_file_id = ?",
            (source_file["id"],),
        )
        timestamp = now_iso()
        extraction_quality = self._build_extraction_quality_report(document)
        metadata = {**document.metadata, "extraction_quality": extraction_quality}
        metadata_json = json.dumps(metadata, ensure_ascii=False)
        payload = {
            "source_file_id": source_file["id"],
            "source_id": source_file["source_id"],
            "file_path": source_file["file_path"],
            "file_hash": source_file.get("file_hash"),
            "ingestion_signature": INGESTION_SIGNATURE,
            "title": document.title,
            "document_type": document.document_type,
            "document_number": document.metadata.get("document_number"),
            "sender_org": document.metadata.get("sender_org"),
            "receiver_org": document.metadata.get("receiver_org"),
            "issued_date": document.metadata.get("issued_date"),
            "security_level": document.metadata.get("security_level"),
            "attachment_count": document.attachment_count,
            "parser_name": document.parser_name,
            "parser_version": document.parser_version,
            "quality_score": extraction_quality["score"],
            "partial": 1 if document.partial else 0,
            "metadata_json": metadata_json,
            "updated_at": timestamp,
        }

        if existing is None:
            document_id = str(uuid4())
            self.db.insert(
                "knowledge_documents",
                {
                    "id": document_id,
                    **payload,
                    "created_at": timestamp,
                },
            )
            return document_id

        document_id = existing["id"]
        self._delete_document_children(document_id)
        self.db.execute(
            """
            UPDATE knowledge_documents
            SET source_id = ?,
                file_path = ?,
                file_hash = ?,
                ingestion_signature = ?,
                title = ?,
                document_type = ?,
                document_number = ?,
                sender_org = ?,
                receiver_org = ?,
                issued_date = ?,
                security_level = ?,
                attachment_count = ?,
                parser_name = ?,
                parser_version = ?,
                quality_score = ?,
                partial = ?,
                metadata_json = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                payload["source_id"],
                payload["file_path"],
                payload["file_hash"],
                payload["ingestion_signature"],
                payload["title"],
                payload["document_type"],
                payload["document_number"],
                payload["sender_org"],
                payload["receiver_org"],
                payload["issued_date"],
                payload["security_level"],
                payload["attachment_count"],
                payload["parser_name"],
                payload["parser_version"],
                payload["quality_score"],
                payload["partial"],
                payload["metadata_json"],
                payload["updated_at"],
                document_id,
            ),
        )
        return document_id

    def _build_extraction_quality_report(self, document: StructuredDocument) -> dict[str, Any]:
        section_count = len(document.sections)
        paragraph_count = sum(len(section.paragraphs) for section in document.sections)
        table_count = sum(len(section.tables) for section in document.sections)
        text_char_count = sum(len(section.text) for section in document.sections)
        metadata_field_count = len([value for value in document.metadata.values() if value not in (None, "")])
        warnings: list[str] = []
        if document.partial:
            warnings.append("partial_extraction")
        if section_count == 0:
            warnings.append("no_sections")
        if text_char_count < 20:
            warnings.append("low_text")
        if document.document_type in {"xlsx"} and table_count == 0:
            warnings.append("no_structured_tables")

        score = float(document.quality_score)
        if section_count > 1:
            score += 0.03
        if table_count > 0:
            score += 0.03
        if metadata_field_count > 0:
            score += 0.04
        if text_char_count >= 500:
            score += 0.03
        if document.partial:
            score -= 0.25
        if text_char_count < 20:
            score -= 0.2
        score = round(max(0.0, min(1.0, score)), 2)

        return {
            "parser_name": document.parser_name,
            "parser_version": document.parser_version,
            "score": score,
            "section_count": section_count,
            "paragraph_count": paragraph_count,
            "table_count": table_count,
            "text_char_count": text_char_count,
            "metadata_field_count": metadata_field_count,
            "partial": document.partial,
            "warnings": warnings,
        }

    def _replace_document_children(self, document_id: str, document: StructuredDocument) -> None:
        document_record = self.db.fetch_one("SELECT * FROM knowledge_documents WHERE id = ?", (document_id,))
        if document_record is None:
            raise KeyError(document_id)
        self._pending_vector_records = []
        document_node_id = f"document:{document_id}"
        timestamp = now_iso()
        self._insert_graph_node_once(
            node_id=document_node_id,
            node_type="Document",
            label=document.title,
            source_document_id=document_id,
            confidence=document.quality_score,
            metadata={"file_path": document_record["file_path"]},
            timestamp=timestamp,
        )

        chunk_index = 0
        for section_index, section in enumerate(document.sections):
            section_id = str(uuid4())
            self.db.insert(
                "knowledge_document_sections",
                {
                    "id": section_id,
                    "document_id": document_id,
                    "heading": section.heading,
                    "level": section.level,
                    "order_index": section_index,
                    "text": "\n".join(section.paragraphs),
                    "created_at": timestamp,
                },
            )
            section_chunk_texts = self._section_chunk_texts(section)
            for section_chunk_index, section_chunk_text in enumerate(section_chunk_texts, start=1):
                chunk_id = self._insert_section_chunk(
                    document_id=document_id,
                    section_id=section_id,
                    section=section,
                    text=section_chunk_text,
                    chunk_index=chunk_index,
                    timestamp=timestamp,
                )
                chunk_index += 1
                chunk_label = (
                    section.heading
                    if len(section_chunk_texts) == 1
                    else f"{section.heading} {section_chunk_index}/{len(section_chunk_texts)}"
                )
                self._insert_chunk_graph(document_node_id, document_id, chunk_id, chunk_label, timestamp)
            for table_index, table in enumerate(section.tables):
                self.db.insert(
                    "knowledge_table_blocks",
                    {
                        "id": str(uuid4()),
                        "document_id": document_id,
                        "section_id": section_id,
                        "order_index": table_index,
                        "caption": table.caption,
                        "headers_json": json.dumps(table.headers, ensure_ascii=False),
                        "rows_json": json.dumps(table.rows, ensure_ascii=False),
                        "created_at": timestamp,
                    },
                )
                table_chunk_id = self._insert_table_chunk(
                    document_id=document_id,
                    section_id=section_id,
                    section=section,
                    table=table,
                    chunk_index=chunk_index,
                    timestamp=timestamp,
                )
                chunk_index += 1
                self._insert_chunk_graph(
                    document_node_id,
                    document_id,
                    table_chunk_id,
                    f"표: {table.caption or section.heading}",
                    timestamp,
                )

        self._flush_vector_records()
        self._insert_ontology_graph(document_node_id, document_id, document, timestamp)

    def _safe_embed_query(self, query: str) -> EmbeddingResult | None:
        if not query:
            return None
        try:
            return self.embedding_provider(query)
        except Exception:
            return None

    def _vector_backend_scores(self, query_embedding: EmbeddingResult | None, limit: int) -> dict[str, float]:
        if self.vector_backend is None or query_embedding is None:
            return {}
        try:
            results = self.vector_backend.query_chunks(
                query_embedding.vector,
                limit=max(limit * 8, 40),
            )
        except Exception:
            return {}

        scores: dict[str, float] = {}
        for rank, result in enumerate(results):
            if not isinstance(result, dict):
                continue
            metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
            chunk_id = str(result.get("chunk_id") or metadata.get("chunk_id") or "").strip()
            if not chunk_id:
                continue
            distance = result.get("distance")
            if isinstance(distance, int | float):
                base_score = max(0.0, 65.0 - min(float(distance), 3.0) * 20.0)
            else:
                base_score = 55.0
            rank_boost = max(0.0, 10.0 - rank)
            scores[chunk_id] = max(scores.get(chunk_id, 0.0), round(base_score + rank_boost, 2))
        return scores

    def _chunk_vector_score(
        self,
        chunk: dict[str, Any],
        query_embedding: EmbeddingResult | None,
    ) -> float:
        if query_embedding is None:
            return 0.0
        try:
            chunk_vector = json.loads(chunk.get("embedding_json") or "[]")
        except json.JSONDecodeError:
            return 0.0
        similarity = self._cosine_similarity(query_embedding.vector, chunk_vector)
        return max(0.0, similarity) * 45

    @staticmethod
    def _cosine_similarity(left: list[float], right: Any) -> float:
        if not isinstance(right, list) or len(left) != len(right) or not left:
            return 0.0
        left_norm = sum(value * value for value in left) ** 0.5
        right_values: list[float] = []
        for value in right:
            if not isinstance(value, int | float):
                return 0.0
            right_values.append(float(value))
        right_norm = sum(value * value for value in right_values) ** 0.5
        if left_norm == 0 or right_norm == 0:
            return 0.0
        dot = sum(left_value * right_value for left_value, right_value in zip(left, right_values))
        return dot / (left_norm * right_norm)

    def graph_query(self, *, query: str, limit: int = 20) -> dict[str, Any]:
        normalized_query = query.strip().lower()
        safe_limit = max(1, min(limit, 50))
        nodes = self.db.fetch_all(
            """
            SELECT *
            FROM knowledge_graph_nodes
            WHERE lower(label) LIKE ?
            ORDER BY node_type ASC, label ASC
            LIMIT ?
            """,
            (f"%{normalized_query}%", safe_limit),
        )
        node_ids = [node["id"] for node in nodes]
        if not node_ids:
            return {"query": query, "nodes": [], "edges": [], "neighbor_nodes": [], "related_documents": []}

        placeholders = ", ".join("?" for _ in node_ids)
        edges = self.db.fetch_all(
            f"""
            SELECT *
            FROM knowledge_graph_edges
            WHERE source_node_id IN ({placeholders}) OR target_node_id IN ({placeholders})
            ORDER BY created_at DESC
            """,
            tuple([*node_ids, *node_ids]),
        )
        edge_node_ids = {
            str(edge["source_node_id"])
            for edge in edges
        } | {
            str(edge["target_node_id"])
            for edge in edges
        }
        neighbor_ids = sorted(edge_node_ids - set(node_ids))
        neighbor_nodes: list[dict[str, Any]] = []
        if neighbor_ids:
            neighbor_placeholders = ", ".join("?" for _ in neighbor_ids)
            neighbor_nodes = self.db.fetch_all(
                f"SELECT * FROM knowledge_graph_nodes WHERE id IN ({neighbor_placeholders})",
                tuple(neighbor_ids),
            )

        document_ids = {
            str(node.get("source_document_id"))
            for node in [*nodes, *neighbor_nodes]
            if node.get("source_document_id")
        }
        related_documents: list[dict[str, Any]] = []
        if document_ids:
            document_placeholders = ", ".join("?" for _ in document_ids)
            related_documents = [
                self._serialize_document(row)
                for row in self.db.fetch_all(
                    f"SELECT * FROM knowledge_documents WHERE id IN ({document_placeholders})",
                    tuple(document_ids),
                )
            ]

        return {
            "query": query,
            "nodes": [self._serialize_graph_node(node) for node in nodes],
            "edges": [self._serialize_graph_edge(edge) for edge in edges],
            "neighbor_nodes": [self._serialize_graph_node(node) for node in neighbor_nodes],
            "related_documents": related_documents,
        }

    def _section_chunk_texts(self, section: StructuredSection) -> list[str]:
        text = section.text.strip()
        if not text:
            return [section.heading]
        if len(text) <= SECTION_CHUNK_MAX_CHARS:
            return [text]

        paragraphs = [paragraph.strip() for paragraph in section.paragraphs if paragraph.strip()]
        if not paragraphs:
            return self._split_large_text(text)

        chunks: list[str] = []
        current = ""
        for paragraph in paragraphs:
            paragraph_parts = (
                self._split_large_text(paragraph)
                if len(paragraph) > SECTION_CHUNK_MAX_CHARS
                else [paragraph]
            )
            for paragraph_part in paragraph_parts:
                candidate = f"{current}\n\n{paragraph_part}".strip() if current else paragraph_part
                if len(candidate) <= SECTION_CHUNK_MAX_CHARS:
                    current = candidate
                    continue
                if current:
                    chunks.append(current)
                current = paragraph_part
        if current:
            chunks.append(current)
        return chunks or [text[:SECTION_CHUNK_MAX_CHARS]]

    @staticmethod
    def _split_large_text(text: str) -> list[str]:
        chunks: list[str] = []
        start = 0
        text_length = len(text)
        while start < text_length:
            end = min(start + SECTION_CHUNK_MAX_CHARS, text_length)
            if end < text_length:
                boundary = max(
                    text.rfind("\n", start, end),
                    text.rfind(". ", start, end),
                    text.rfind(" ", start, end),
                )
                if boundary > start + int(SECTION_CHUNK_MAX_CHARS * 0.6):
                    end = boundary + 1
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            if end >= text_length:
                break
            start = max(end - SECTION_CHUNK_OVERLAP_CHARS, start + 1)
        return chunks

    def _insert_section_chunk(
        self,
        *,
        document_id: str,
        section_id: str,
        section: StructuredSection,
        text: str | None = None,
        chunk_index: int,
        timestamp: str,
    ) -> str:
        chunk_id = str(uuid4())
        chunk_text = (text if text is not None else section.text).strip() or section.heading
        embedding = self.embedding_provider(chunk_text)
        vector_ref = self._upsert_vector_chunk(
            chunk_id=chunk_id,
            document_id=document_id,
            section_id=section_id,
            text=chunk_text,
            embedding=embedding,
            chunk_kind="section",
        )
        self.db.insert(
            "knowledge_document_chunks",
            {
                "id": chunk_id,
                "document_id": document_id,
                "section_id": section_id,
                "chunk_index": chunk_index,
                "text": chunk_text,
                "token_count": len(tokenize(chunk_text)),
                "embedding_backend": embedding.backend,
                "embedding_model": embedding.model,
                "embedding_json": json.dumps(embedding.vector, ensure_ascii=False),
                "vector_ref": vector_ref,
                "created_at": timestamp,
            },
        )
        return chunk_id

    def _insert_table_chunk(
        self,
        *,
        document_id: str,
        section_id: str,
        section: StructuredSection,
        table: Any,
        chunk_index: int,
        timestamp: str,
    ) -> str:
        chunk_id = str(uuid4())
        title = table.caption or section.heading
        text = f"표: {title}\n{table.to_text_projection()}".strip()
        embedding = self.embedding_provider(text)
        vector_ref = self._upsert_vector_chunk(
            chunk_id=chunk_id,
            document_id=document_id,
            section_id=section_id,
            text=text,
            embedding=embedding,
            chunk_kind="table",
        )
        self.db.insert(
            "knowledge_document_chunks",
            {
                "id": chunk_id,
                "document_id": document_id,
                "section_id": section_id,
                "chunk_index": chunk_index,
                "text": text,
                "token_count": len(tokenize(text)),
                "embedding_backend": embedding.backend,
                "embedding_model": embedding.model,
                "embedding_json": json.dumps(embedding.vector, ensure_ascii=False),
                "vector_ref": vector_ref,
                "created_at": timestamp,
            },
        )
        return chunk_id

    def _upsert_vector_chunk(
        self,
        *,
        chunk_id: str,
        document_id: str,
        section_id: str,
        text: str,
        embedding: EmbeddingResult,
        chunk_kind: str,
    ) -> str:
        if self.vector_backend is None:
            return f"sqlite:{chunk_id}"
        self._pending_vector_records.append(
            {
                "chunk_id": chunk_id,
                "document_id": document_id,
                "section_id": section_id,
                "text": text,
                "embedding": embedding.vector,
                "metadata": {
                    "chunk_kind": chunk_kind,
                    "embedding_backend": embedding.backend,
                    "embedding_model": embedding.model,
                },
            }
        )
        if len(self._pending_vector_records) >= VECTOR_UPSERT_BATCH_SIZE:
            self._flush_vector_records()
        return self._predicted_vector_ref(chunk_id)

    def _flush_vector_records(self) -> None:
        if self.vector_backend is None or not self._pending_vector_records:
            return
        batch = self._pending_vector_records
        self._pending_vector_records = []
        self.vector_backend.upsert_chunks(batch)

    def _predicted_vector_ref(self, chunk_id: str) -> str:
        collection_name = getattr(self.vector_backend, "collection_name", "gongmu_chunks")
        return f"chromadb:{collection_name}:{chunk_id}"

    def _insert_chunk_graph(
        self,
        document_node_id: str,
        document_id: str,
        chunk_id: str,
        label: str,
        timestamp: str,
    ) -> None:
        chunk_node_id = f"chunk:{chunk_id}"
        self._insert_graph_node_once(
            node_id=chunk_node_id,
            node_type="Chunk",
            label=label,
            source_document_id=document_id,
            confidence=0.7,
            metadata={"chunk_id": chunk_id},
            timestamp=timestamp,
        )
        self._insert_graph_edge_once(
            edge_id=stable_edge_id(document_node_id, "HAS_CHUNK", chunk_node_id),
            source_node_id=document_node_id,
            target_node_id=chunk_node_id,
            relation="HAS_CHUNK",
            confidence=0.9,
            metadata={"chunk_id": chunk_id},
            timestamp=timestamp,
        )

    def _insert_ontology_graph(
        self,
        document_node_id: str,
        document_id: str,
        document: StructuredDocument,
        timestamp: str,
    ) -> None:
        extraction = extract_ontology(document)
        document_labels = {"Document": document.title}
        for node in extraction.nodes:
            self._insert_graph_node_once(
                node_id=node.node_id,
                node_type=node.node_type,
                label=node.label,
                source_document_id=document_id,
                confidence=node.confidence,
                metadata={"source": "ontology"},
                timestamp=timestamp,
            )
        for edge in extraction.edges:
            source_node_id = (
                document_node_id
                if edge.source_type == "Document" and edge.source_label == document_labels["Document"]
                else stable_node_id(edge.source_type, edge.source_label)
            )
            target_node_id = (
                document_node_id
                if edge.target_type == "Document" and edge.target_label == document_labels["Document"]
                else stable_node_id(edge.target_type, edge.target_label)
            )
            self._insert_graph_edge_once(
                edge_id=stable_edge_id(source_node_id, edge.relation, target_node_id),
                source_node_id=source_node_id,
                target_node_id=target_node_id,
                relation=edge.relation,
                confidence=edge.confidence,
                metadata={"source": "ontology"},
                timestamp=timestamp,
            )

    def _insert_graph_node_once(
        self,
        *,
        node_id: str,
        node_type: str,
        label: str,
        source_document_id: str | None,
        confidence: float,
        metadata: dict[str, Any],
        timestamp: str,
    ) -> None:
        self.db.execute(
            """
            INSERT OR IGNORE INTO knowledge_graph_nodes
                (id, node_type, label, source_document_id, confidence, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                node_id,
                node_type,
                label,
                source_document_id,
                confidence,
                json.dumps(metadata, ensure_ascii=False),
                timestamp,
            ),
        )

    def _insert_graph_edge_once(
        self,
        *,
        edge_id: str,
        source_node_id: str,
        target_node_id: str,
        relation: str,
        confidence: float,
        metadata: dict[str, Any],
        timestamp: str,
    ) -> None:
        self.db.execute(
            """
            INSERT OR IGNORE INTO knowledge_graph_edges
                (id, source_node_id, target_node_id, relation, confidence, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                edge_id,
                source_node_id,
                target_node_id,
                relation,
                confidence,
                json.dumps(metadata, ensure_ascii=False),
                timestamp,
            ),
        )

    def _delete_document_children(self, document_id: str) -> None:
        if self.vector_backend is not None:
            self.vector_backend.delete_document(document_id)
        node_rows = self.db.fetch_all(
            "SELECT id FROM knowledge_graph_nodes WHERE source_document_id = ?",
            (document_id,),
        )
        node_ids = [row["id"] for row in node_rows]
        if node_ids:
            placeholders = ", ".join("?" for _ in node_ids)
            self.db.execute(
                f"DELETE FROM knowledge_graph_edges WHERE source_node_id IN ({placeholders}) OR target_node_id IN ({placeholders})",
                tuple([*node_ids, *node_ids]),
            )
        self.db.execute("DELETE FROM knowledge_graph_nodes WHERE source_document_id = ?", (document_id,))
        self.db.execute("DELETE FROM knowledge_table_blocks WHERE document_id = ?", (document_id,))
        self.db.execute("DELETE FROM knowledge_document_chunks WHERE document_id = ?", (document_id,))
        self.db.execute("DELETE FROM knowledge_document_sections WHERE document_id = ?", (document_id,))

    def _delete_document(self, document_id: str) -> None:
        self._delete_document_children(document_id)
        self.db.execute("DELETE FROM knowledge_documents WHERE id = ?", (document_id,))

    def _serialize_table(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "headers": json.loads(row["headers_json"]),
            "rows": json.loads(row["rows_json"]),
        }

    def _serialize_document(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "partial": bool(row["partial"]),
            "metadata": json.loads(row["metadata_json"]),
        }

    def _document_with_chunk_counts(self, row: dict[str, Any]) -> dict[str, Any]:
        counts = self.db.fetch_one(
            """
            SELECT COUNT(*) AS chunk_count,
                   COUNT(CASE WHEN text LIKE '표:%' THEN 1 END) AS table_chunk_count
            FROM knowledge_document_chunks
            WHERE document_id = ?
            """,
            (row["id"],),
        )
        return {
            **row,
            "chunk_count": counts["chunk_count"] if counts else 0,
            "table_chunk_count": counts["table_chunk_count"] if counts else 0,
        }

    def _serialize_graph_node(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "metadata": json.loads(row["metadata_json"]),
        }

    def _serialize_graph_edge(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "metadata": json.loads(row["metadata_json"]),
        }

    def _document_ontology_relations(self, document_id: str) -> list[dict[str, Any]]:
        document_node_id = f"document:{document_id}"
        edges = self.db.fetch_all(
            """
            SELECT e.relation,
                   source.label AS source_label,
                   target.label AS target_label,
                   source.node_type AS source_type,
                   target.node_type AS target_type
            FROM knowledge_graph_edges e
            JOIN knowledge_graph_nodes source ON source.id = e.source_node_id
            JOIN knowledge_graph_nodes target ON target.id = e.target_node_id
            WHERE e.source_node_id = ? AND e.relation != ?
            ORDER BY e.relation ASC, target.label ASC
            """,
            (document_node_id, "HAS_CHUNK"),
        )
        return [
            {
                "source_label": edge["source_label"],
                "source_type": edge["source_type"],
                "relation": edge["relation"],
                "target_label": edge["target_label"],
                "target_type": edge["target_type"],
            }
            for edge in edges
        ]

    @staticmethod
    def _safe_json_object(value: Any) -> dict[str, Any]:
        if not isinstance(value, str) or not value.strip():
            return {}
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def _session_linked_paths(self, session_id: str | None) -> set[str]:
        if not session_id:
            return set()
        rows = self.db.fetch_all(
            "SELECT file_path FROM work_session_file_links WHERE session_id = ?",
            (session_id,),
        )
        return {row["file_path"] for row in rows}

    def _document_graph_score(
        self,
        document_id: str,
        normalized_query: str,
        query_tokens: set[str],
    ) -> int:
        if not normalized_query and not query_tokens:
            return 0
        rows = self.db.fetch_all(
            """
            SELECT target.label AS target_label, target.node_type AS target_type, e.relation
            FROM knowledge_graph_edges e
            JOIN knowledge_graph_nodes target ON target.id = e.target_node_id
            WHERE e.source_node_id = ? AND e.relation != ?
            """,
            (f"document:{document_id}", "HAS_CHUNK"),
        )
        score = 0
        for row in rows:
            label = str(row["target_label"]).lower()
            if normalized_query and normalized_query in label:
                score += 45
            score += len(query_tokens.intersection(tokenize(label))) * 12
        return score

    def _citation_from_item(self, item: dict[str, Any]) -> dict[str, Any]:
        relations = sorted(
            {
                relation["relation"]
                for relation in item.get("relations", [])
                if relation.get("relation")
            }
        )
        return {
            "document_id": item["document"]["id"],
            "title": item["document"]["title"],
            "file_path": item["document"]["file_path"],
            "chunk_id": item["chunk"]["id"],
            "parser_name": item["document"].get("parser_name"),
            "quality_score": item["document"].get("quality_score"),
            "partial": bool(item["document"].get("partial", False)),
            "evidence_type": item.get("evidence_type", "section"),
            "quality_warnings": self._quality_warnings_from_document(item["document"]),
            "score_breakdown": item.get("score_breakdown", {}),
            "relations": relations,
        }

    def _retrieval_summary(self, items: list[dict[str, Any]]) -> dict[str, int]:
        document_ids = {item["document"]["id"] for item in items}
        relation_names = {
            relation.get("relation")
            for item in items
            for relation in item.get("relations", [])
            if relation.get("relation") and relation.get("relation") != "HAS_CHUNK"
        }
        return {
            "source_count": len(document_ids),
            "table_evidence_count": len(
                [item for item in items if item.get("evidence_type") == "table"]
            ),
            "partial_count": len([item for item in items if item["document"].get("partial")]),
            "low_quality_count": len(
                [
                    item
                    for item in items
                    if "low_text" in self._quality_warnings_from_document(item["document"])
                    or float(item["document"].get("quality_score") or 0) < 0.5
                ]
            ),
            "relation_count": len(relation_names),
        }

    @staticmethod
    def _chunk_evidence_type(text: str) -> str:
        return "table" if text.lstrip().startswith("표:") else "section"

    @staticmethod
    def _quality_warnings_from_document(document: dict[str, Any]) -> list[str]:
        metadata = document.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        report = metadata.get("extraction_quality")
        warnings: list[str] = []
        if isinstance(report, dict) and isinstance(report.get("warnings"), list):
            warnings = [warning for warning in report["warnings"] if isinstance(warning, str)]
        if document.get("partial") and "partial_extraction" not in warnings:
            warnings.append("partial_extraction")
        if float(document.get("quality_score") or 0) < 0.5 and "low_quality_score" not in warnings:
            warnings.append("low_quality_score")
        return warnings

    def _build_grounded_answer(self, query: str, items: list[dict[str, Any]]) -> str:
        if not items:
            return f"'{query}'에 대한 로컬 지식폴더 근거를 찾지 못했습니다."
        lines = [f"'{query}'에 대해 로컬 지식폴더에서 확인한 근거입니다."]
        for index, item in enumerate(items[:3], start=1):
            snippet = " ".join(str(item["chunk"]["text"]).split())[:220]
            relation_labels = ", ".join(
                sorted(
                    {
                        relation.get("target_label", "")
                        for relation in item.get("relations", [])
                        if relation.get("relation") != "HAS_CHUNK" and relation.get("target_label")
                    }
                )
            )
            relation_suffix = f" 관련 관계: {relation_labels}." if relation_labels else ""
            lines.append(f"{index}. {item['document']['title']}: {snippet}.{relation_suffix}")
        lines.append("위 응답은 로컬 문서 chunk와 그래프 관계를 근거로 생성되었습니다.")
        return "\n".join(lines)

    def _chunk_label(self, text: str) -> str:
        first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
        return first_line[:80] or "chunk"
