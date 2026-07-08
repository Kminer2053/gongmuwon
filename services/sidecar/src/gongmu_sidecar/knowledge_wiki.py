"""지식폴더 2.0 — Karpathy 스타일 LLM 위키 + SQLite FTS5 하이브리드.

결정론 경로(LLM 불필요): 스캔 → parse_document 추출 → extracted/<hash>.md 저장
→ 문서 카드(docs/<slug>.md) 생성 → FTS5 색인 → index.md/log.md 갱신.
LLM 경로(선택): ask() 합성 답변, enrich() 배치 요약·주제 페이지.

설계 근거: docs/superpowers/specs/2026-07-03-knowledge-wiki-2.0-architecture-decision.md
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import perf_counter
from typing import Any
from uuid import uuid4

from .db import Database, now_iso
from .document_parsers import parse_document
from .graphrag_models import StructuredDocument
from .kordoc_bridge import kordoc_available
from .taxonomy_rules import (
    DEFAULT_DOC_ROLE_KEYS,
    family_id_for,
    family_key_for,
    family_sort_key,
    is_reference_shelf_path,
    match_doc_role,
    match_doc_role_candidates,
    match_work_area,
    nfc,
    normalize_family_key,
    version_signals,
)
from .workspace import WorkspacePaths


INGESTION_SIGNATURE = "wiki-fts5-v1"
INGESTION_STAGES = [
    ("scan", "폴더 스캔"),
    ("extract", "본문 추출"),
    ("index", "FTS 색인"),
    ("wiki", "위키 갱신"),
]
INGESTION_STAGE_LABELS = {key: label for key, label in INGESTION_STAGES}
INGESTION_STAGE_INDEXES = {key: index for index, (key, _) in enumerate(INGESTION_STAGES)}
FTS_BODY_MAX_CHARS = 200_000
# W7 P0: queued 색인 잡 방치 시 전 소스 색인이 무기한 409 차단되는 공백 봉합 (§7-5)
STALE_QUEUED_TTL = timedelta(minutes=30)
STALE_QUEUED_MESSAGE = "대기 시간 초과로 자동 취소되었습니다"
# W7 P0: 폭주 파서(kordoc 등)의 무한 소모 방지 — 연속 파싱 실패 상한 (§7-7)
PARSE_FAILURE_ABORT_THRESHOLD = 10
# W7 P0: enrich 실패 백오프 — 3회 실패 문서는 대상 제외 (§5.4)
ENRICH_FAIL_LIMIT = 3
# W7 P2a §5.4/§9: enrich 실행당 LLM 호출 상한 — 사용자 승인 기본값 20건 (설정 가능 파라미터)
ENRICH_DEFAULT_LIMIT = 20
# 해시 파일명(sha256 hex) 판별 — <document_id>.md 형식은 GC 제외 (§5.8)
HASH_NAME_RE = re.compile(r"^[0-9a-f]{64}$")
# W7 P2b §5.5: 소프트 삭제 유예 보관 기간(일) — 사용자 승인값 30일.
# KnowledgeWikiManager.missing_retention_days 인스턴스 속성으로 조정 가능.
MISSING_RETENTION_DAYS = 30
MISSING_BANNER_PREFIX = "> ⚠ 원본이 삭제되었거나 이동됨"
# W7 P2b §5.7: 카드 말미 사용자 메모 구역 — 마커 이하가 사용자 소유(재작성 시 보존).
USER_NOTES_MARKER = "<!-- gongmu:user-notes -->"
DEFAULT_USER_NOTES_BLOCK = USER_NOTES_MARKER + "\n## 내 메모\n"
CARD_AUTOGEN_COMMENT = "<!-- 이 문서는 자동 생성됩니다. '## 내 메모' 아래만 직접 편집하세요 -->"
SNIPPET_MAX_CHARS = 500
OVERVIEW_MAX_CHARS = 300
KEYWORD_COUNT = 10
STRUCTURE_PREVIEW_DEFAULT_SECTIONS = 60
STRUCTURE_PREVIEW_MAX_SECTIONS = 300
STRUCTURE_PREVIEW_TEXT_CHARS = 1600

TOKEN_RE = re.compile(r"[\w가-힣]+", re.UNICODE)
STOPWORDS = {
    "그리고", "그러나", "하지만", "또한", "따라서", "관련", "대한", "위한", "있는", "있다",
    "한다", "된다", "하는", "하여", "및", "등", "수", "것", "이", "그", "저", "the", "and",
    "for", "with", "from", "this", "that", "are", "was", "were", "will", "have", "has",
    "not", "can", "any", "all", "our", "your",
}


def _tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(nfc(text).lower())


def _strip_front_matter(body: str) -> str:
    # 발췌/스니펫에 YAML front matter가 새어 나오지 않게 본문 시작 전 블록을 제거한다.
    if not body.startswith("---"):
        return body
    closing = body.find("\n---", 3)
    if closing < 0:
        return body
    return body[closing + 4 :].lstrip("\n")


def wiki_slugify(title: str, file_hash: str) -> str:
    base = nfc(title).strip().lower()
    base = re.sub(r"[^\w가-힣\s-]", "", base, flags=re.UNICODE)
    base = re.sub(r"[\s_]+", "-", base).strip("-")[:48]
    suffix = (file_hash or uuid4().hex)[:8]
    return f"{base}-{suffix}" if base else f"doc-{suffix}"


def patch_front_matter_text(text: str, updates: dict[str, Any]) -> str | None:
    """문자열 상태의 YAML front matter 키를 제자리 갱신(없으면 추가)한다. 실패 시 None."""
    if not text.startswith("---"):
        return None
    closing = text.find("\n---", 3)
    if closing < 0:
        return None
    block = text[3:closing]
    for key, value in updates.items():
        if isinstance(value, list):
            rendered = json.dumps(value, ensure_ascii=False)
        elif isinstance(value, bool):
            rendered = "true" if value else "false"
        else:
            rendered = "" if value is None else str(value)
        line = f"{key}: {rendered}"
        pattern = re.compile(rf"^{re.escape(key)}:.*$", re.MULTILINE)
        if pattern.search(block):
            # 치환문을 리터럴로 — 값에 Windows 경로 역슬래시(\U 등)가 들어오면
            # re가 이스케이프로 해석해 터지는 함정 방어.
            block = pattern.sub(lambda _match: line, block, count=1)
        else:
            block = block.rstrip("\n") + "\n" + line
    return nfc("---" + block + text[closing:])


def patch_card_front_matter(path: Path, updates: dict[str, Any]) -> bool:
    """카드/페이지의 YAML front matter 키를 제자리 갱신(없으면 추가)한다.

    T-01 업무 태깅처럼 카드 본문을 다시 만들지 않고 메타데이터만 덧입힐 때 쓴다.
    호출자가 card_hash 추적이 필요하면 KnowledgeWikiManager.patch_card를 쓸 것 (§5.7).
    """
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    patched = patch_front_matter_text(text, updates)
    if patched is None:
        return False
    try:
        path.write_text(patched, encoding="utf-8")
    except OSError:
        return False
    return True


def split_user_notes(text: str) -> tuple[str, str | None]:
    """카드 텍스트를 (기계 영역, 사용자 메모 구역)으로 나눈다 (§5.7).

    메모 구역은 마커 줄부터 파일 끝까지 — 재작성 시 그대로 이어붙인다.
    마커가 없으면 (전체, None).
    """
    index = text.find(USER_NOTES_MARKER)
    if index < 0:
        return text, None
    return text[:index], text[index:]


def compose_card_with_notes(machine: str, notes: str | None) -> str:
    """기계 영역 + 사용자 메모 구역을 결정적으로 재조립한다 (§5.7)."""
    base = machine.rstrip("\n")
    block = (notes if notes is not None else DEFAULT_USER_NOTES_BLOCK).rstrip("\n")
    return nfc(base + "\n\n" + block + "\n")


def card_machine_hash(text: str) -> str:
    """시스템 작성본(기계 영역)의 정규화(CRLF→LF) 해시 (§5.7).

    사용자 메모 구역(마커 이하)은 사용자 소유이므로 해시에서 제외한다 —
    메모 편집은 백업을 트리거하지 않고, 기계 영역 편집만 감지한다.
    """
    machine, _notes = split_user_notes(text)
    normalized = machine.replace("\r\n", "\n")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


class KnowledgeWikiManager:
    ENGINE = "wiki"

    def __init__(self, paths: WorkspacePaths, db: Database) -> None:
        self.paths = paths
        self.db = db
        self.wiki_root = paths.root / "knowledge-wiki"
        self.docs_dir = self.wiki_root / "docs"
        self.topics_dir = self.wiki_root / "topics"
        self.work_dir = self.wiki_root / "work"
        self.work_areas_dir = self.wiki_root / "work-areas"
        self.extracted_dir = self.wiki_root / "extracted"
        self.index_path = self.wiki_root / "index.md"
        self.log_path = self.wiki_root / "log.md"
        for directory in (
            self.wiki_root,
            self.docs_dir,
            self.topics_dir,
            self.work_dir,
            self.work_areas_dir,
            self.extracted_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)
        self._active_running_job_ids: set[str] = set()
        # P2a §5.3: dirty 업무 허브 재작성 훅 — WorkTaxonomyManager.refresh_hubs가
        # app.Services에서 주입된다(순환 의존 회피). 미주입 시 다음 apply가 수복한다.
        self.hub_refresher: Callable[[str, list[str]], Any] | None = None
        # P2b §5.5: 소프트 삭제 보관 기간(일) — 상수 기본 30, 인스턴스에서 조정 가능.
        self.missing_retention_days: int = MISSING_RETENTION_DAYS

    # ------------------------------------------------------------------ jobs

    def list_jobs(self) -> list[dict[str, Any]]:
        self.cancel_stale_queued_jobs()
        return self.db.fetch_all("SELECT * FROM knowledge_ingestion_jobs ORDER BY created_at DESC")

    def active_job(self) -> dict[str, Any] | None:
        self.cancel_stale_queued_jobs()
        return self.db.fetch_one(
            """
            SELECT * FROM knowledge_ingestion_jobs
            WHERE status IN (?, ?)
            ORDER BY created_at DESC LIMIT 1
            """,
            ("queued", "running"),
        )

    def cancel_stale_queued_jobs(self) -> list[dict[str, Any]]:
        """queued 상태로 30분을 초과한 색인 잡을 자동 취소한다 (§7-5).

        work_jobs의 STALE_QUEUED_TTL 패턴 준용 — 목록 조회·활성 잡 판정 시점에
        적용해 방치 잡 1건이 전 소스 색인을 무기한 409 차단하는 공백을 봉합한다.
        시계 역행 방어: created_at이 미래면 즉시 stale로 본다.
        """
        rows = self.db.fetch_all(
            "SELECT * FROM knowledge_ingestion_jobs WHERE status = ?", ("queued",)
        )
        if not rows:
            return []
        now = datetime.now(timezone.utc)
        cutoff = now - STALE_QUEUED_TTL
        canceled: list[dict[str, Any]] = []
        for job in rows:
            created_at = self._parse_timestamp(job.get("created_at"))
            if created_at is None:
                continue
            if cutoff < created_at <= now:
                continue  # 아직 TTL 이내(그리고 미래 아님)
            finished = self._finish_job(
                job["id"],
                status="canceled",
                processed_count=job.get("processed_count") or 0,
                failed_count=job.get("failed_count") or 0,
                deleted_document_count=job.get("deleted_document_count") or 0,
                skipped_count=job.get("skipped_count") or 0,
                total_files=job.get("queued_count") or 0,
                duration_ms=job.get("duration_ms"),
                error_message=STALE_QUEUED_MESSAGE,
                cancel_requested=True,
            )
            self._append_job_event(
                job["id"],
                "job.canceled",
                stage="scan",
                level="warning",
                message=STALE_QUEUED_MESSAGE,
                reason="stale_queued_ttl",
                created_at=job.get("created_at"),
            )
            self.db.log(
                feature="knowledge",
                action="knowledge.wiki.ingest.stale_canceled",
                status="canceled",
                inputs={"job_id": job["id"], "created_at": job.get("created_at")},
                outputs={"error_message": STALE_QUEUED_MESSAGE},
            )
            canceled.append(finished)
        return canceled

    @staticmethod
    def _parse_timestamp(value: Any) -> datetime | None:
        if not value or not isinstance(value, str):
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed

    def recover_interrupted_jobs(self, *, reason: str = "sidecar restarted before job completed") -> int:
        rows = self.db.fetch_all(
            "SELECT * FROM knowledge_ingestion_jobs WHERE status = ?",
            ("running",),
        )
        for job in rows:
            self._finish_job(
                job["id"],
                status="canceled",
                processed_count=job.get("processed_count") or 0,
                failed_count=job.get("failed_count") or 0,
                deleted_document_count=job.get("deleted_document_count") or 0,
                skipped_count=job.get("skipped_count") or 0,
                total_files=job.get("queued_count") or 0,
                duration_ms=job.get("duration_ms"),
                error_message=reason,
                cancel_requested=True,
            )
        return len(rows)

    def read_job_log(self, job_id: str, *, limit: int = 200) -> dict[str, Any]:
        job = self.db.fetch_one("SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,))
        if job is None:
            raise KeyError(job_id)
        safe_limit = max(1, min(limit, 1000))
        log_path = Path(job.get("log_dump_path") or self._job_log_path(job_id))
        items: list[dict[str, Any]] = []
        if log_path.exists():
            for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-safe_limit:]:
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    parsed = {"event": "log.parse_error", "message": line}
                if isinstance(parsed, dict):
                    items.append(parsed)
        return {"job_id": job_id, "log_dump_path": str(log_path), "limit": safe_limit, "items": items}

    def ingest_source(self, source_id: str, run_now: bool = True, *, force: bool = False) -> dict[str, Any]:
        source = self.db.fetch_one("SELECT * FROM knowledge_sources WHERE id = ?", (source_id,))
        if source is None:
            raise KeyError(source_id)
        self.cancel_stale_queued_jobs()
        active = self.db.fetch_one(
            """
            SELECT * FROM knowledge_ingestion_jobs
            WHERE source_id = ? AND status IN (?, ?)
            ORDER BY created_at DESC LIMIT 1
            """,
            (source_id, "queued", "running"),
        )
        if active is not None:
            raise ValueError(f"active knowledge ingestion job already exists: {active['id']}")

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
            "log_dump_path": str(self._job_log_path(job_id)),
            "diagnostic_event_count": 0,
            "last_diagnostic_message": None,
            "created_at": timestamp,
            "started_at": None,
            "completed_at": None,
        }
        self.db.insert("knowledge_ingestion_jobs", job)
        self._append_job_event(
            job_id,
            "job.created",
            stage="scan",
            message="지식위키 색인 작업 생성",
            source_id=source_id,
            queued_count=len(source_files),
            skipped_count=skipped_count,
            force_rebuild=force,
        )
        if not run_now:
            return self._job_row(job_id) or job
        return self.run_job(job_id)

    def run_job(self, job_id: str) -> dict[str, Any]:
        job = self.db.fetch_one("SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,))
        if job is None:
            raise KeyError(job_id)
        if job["status"] in {"completed", "canceled"}:
            return job
        if job.get("cancel_requested"):
            return self._finish_job(
                job_id,
                status="canceled",
                processed_count=job.get("processed_count") or 0,
                failed_count=job.get("failed_count") or 0,
                deleted_document_count=job.get("deleted_document_count") or 0,
                skipped_count=job.get("skipped_count") or 0,
                total_files=job.get("queued_count") or 0,
                duration_ms=job.get("duration_ms"),
                error_message=job.get("error_message"),
                cancel_requested=True,
            )

        source_id = job["source_id"]
        force = bool(job.get("force_rebuild"))
        source_files, skipped_count = self._source_files_for_ingestion(source_id, force=force)
        started_perf = perf_counter()
        self.db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET status = ?, queued_count = ?, skipped_count = ?, started_at = ?,
                current_stage = ?, current_stage_index = ?, progress_percent = ?,
                log_dump_path = COALESCE(log_dump_path, ?)
            WHERE id = ?
            """,
            (
                "running",
                len(source_files),
                skipped_count,
                now_iso(),
                INGESTION_STAGE_LABELS["scan"],
                INGESTION_STAGE_INDEXES["scan"],
                1,
                str(self._job_log_path(job_id)),
                job_id,
            ),
        )
        self._active_running_job_ids.add(job_id)
        self._append_job_event(
            job_id,
            "job.started",
            stage="scan",
            message="지식위키 색인 시작",
            source_id=source_id,
            queued_count=len(source_files),
            force_rebuild=force,
        )

        processed_count = 0
        failed_count = 0
        consecutive_failures = 0
        aborted_for_failures = False
        errors: list[str] = []
        deleted_document_count, dirty_work_areas = self._purge_deleted_source_documents(source_id)
        # §5.5 부활: 같은 경로 재등장 시 missing 행을 복원한다(해시 동일이면 재파싱 없이).
        restore_outcome = self._restore_missing_wiki_docs(source_id)
        dirty_work_areas |= restore_outcome["dirty_work_areas"]
        # §5.6 doc_uid 마이그레이션 1회성 자동 편입: 구버전 행(uid 미발급)이 남아 있으면
        # 색인 잡 시작 시 무파싱 마이그레이션으로 수복한다(멱등 — 이후 잡에서는 no-op).
        try:
            legacy_uid_row = self.db.fetch_one(
                "SELECT id FROM knowledge_wiki_docs WHERE source_id = ? "
                "AND (doc_uid IS NULL OR doc_uid = '') LIMIT 1",
                (source_id,),
            )
            if legacy_uid_row is not None:
                self.migrate_doc_uids(source_id=source_id)
        except OSError:
            pass
        for source_file in source_files:
            if self._job_cancel_requested(job_id):
                break
            relative_path = source_file.get("relative_path") or source_file.get("file_path")
            try:
                self._append_job_event(
                    job_id,
                    "file.parse.started",
                    stage="extract",
                    message=f"문서 추출 시작: {relative_path}",
                    relative_path=relative_path,
                    file_path=source_file.get("file_path"),
                )
                self._set_job_stage(job_id, "extract", processed_count + failed_count, len(source_files))
                result = self._ingest_source_file(source_file)
                dirty_work_areas.update(result.get("dirty_work_areas") or [])
                self._set_job_stage(job_id, "index", processed_count + failed_count, len(source_files))
                processed_count += 1
                consecutive_failures = 0
                self._append_job_event(
                    job_id,
                    "file.completed",
                    stage="index",
                    message=f"파일 처리 완료: {relative_path}",
                    relative_path=relative_path,
                    document_id=result.get("document_id"),
                    parser_name=result.get("parser_name"),
                    quality_score=result.get("quality_score"),
                    card_path=result.get("card_path"),
                )
            except Exception as exc:  # noqa: BLE001 - 파일 단위 실패는 계속 진행
                self.db.rollback()
                failed_count += 1
                consecutive_failures += 1
                errors.append(f"{relative_path}: {exc}")
                self._append_job_event(
                    job_id,
                    "file.failed",
                    stage="extract",
                    level="error",
                    message=f"파일 처리 실패: {relative_path}",
                    relative_path=relative_path,
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                )
            self._mark_job_progress(
                job_id,
                source_file,
                processed_count=processed_count,
                failed_count=failed_count,
                total_files=len(source_files),
            )
            if consecutive_failures >= PARSE_FAILURE_ABORT_THRESHOLD:
                # §7-7: 폭주 파서의 무한 소모 방지 — 연속 실패 상한 도달 시 partial 종료
                aborted_for_failures = True
                errors.append(
                    f"연속 파싱 실패 {consecutive_failures}건으로 잔여 파일 처리를 중단했습니다 (파서/kordoc 점검 필요)"
                )
                self._append_job_event(
                    job_id,
                    "job.parse_failure_limit",
                    stage="extract",
                    level="error",
                    message=f"연속 파싱 실패 {consecutive_failures}건 도달 — 작업을 부분 완료로 중단합니다",
                    consecutive_failures=consecutive_failures,
                )
                break

        canceled = self._job_cancel_requested(job_id)
        # §5.5: 30일(설정 가능) 경과 missing 문서 하드 정리 — P0 refcount 준수.
        expired_missing_count = 0
        try:
            expired_missing_count = self._cleanup_expired_missing_docs(source_id)
        except OSError:
            pass
        # §5.7: patch 실패(card_dirty=1) 카드 재투영 재시도 — 다음 잡에서 자기수복.
        try:
            self._repair_dirty_cards(source_id)
        except OSError:
            pass
        # §5.8: 잡 말미 고아 산출물 GC (extracted/·knowledge_raw)
        # 다른 색인 잡이 병행 중이면(예: 분류 적용 내장 색인과 교차 소스 백그라운드 색인)
        # 그 잡이 커밋 직전에 써둔 파일을 고아로 오판할 수 있어 GC를 건너뛴다 —
        # 다음 단독 실행 잡이 청소한다.
        gc_counts = {"extracted_removed": 0, "raw_removed": 0}
        try:
            other_active = self.db.fetch_one(
                "SELECT id FROM knowledge_ingestion_jobs "
                "WHERE status IN ('queued', 'running') AND id != ? LIMIT 1",
                (job_id,),
            )
            if other_active is None:
                gc_counts = self._collect_orphan_artifacts(source_id)
        except OSError:
            pass
        self._set_job_stage(job_id, "wiki", len(source_files), max(1, len(source_files)))
        # P2a §5.3/§5.8: 확정 taxonomy가 있을 때만 dirty 업무 허브를 축소 재작성한다
        # (전량 재작성은 apply 몫). 훅 미주입/실패 시 다음 apply가 수복한다.
        if dirty_work_areas and self.hub_refresher is not None:
            try:
                self.hub_refresher(source_id, sorted(dirty_work_areas))
            except Exception:  # noqa: BLE001 - 허브 재작성 실패가 색인을 막으면 안 된다
                pass
        try:
            self.rebuild_index()
        except OSError:
            pass
        duration_ms = int((perf_counter() - started_perf) * 1000)
        status = "canceled" if canceled else ("completed" if failed_count == 0 else "partial")
        self._append_log_line(
            f"ingest source={source_id} status={status} processed={processed_count} "
            f"failed={failed_count} skipped={skipped_count} deleted={deleted_document_count} "
            f"restored={restore_outcome['restored_count']} expired_missing={expired_missing_count} "
            f"gc_extracted={gc_counts['extracted_removed']} gc_raw={gc_counts['raw_removed']} "
            f"duration_ms={duration_ms}"
        )
        self._append_job_event(
            job_id,
            "job.canceled" if canceled else "job.completed",
            stage="wiki",
            message=(
                "지식위키 색인 취소됨"
                if canceled
                else ("지식위키 검색 준비 완료" if status == "completed" else "지식위키 부분 완료 / 실패 진단 필요")
            ),
            status=status,
            queued_count=len(source_files),
            processed_count=processed_count,
            failed_count=failed_count,
            skipped_count=skipped_count,
            deleted_document_count=deleted_document_count,
            restored_count=restore_outcome["restored_count"],
            expired_missing_count=expired_missing_count,
            gc_extracted_removed=gc_counts["extracted_removed"],
            gc_raw_removed=gc_counts["raw_removed"],
            aborted_for_failures=aborted_for_failures,
            duration_ms=duration_ms,
        )
        finished = self._finish_job(
            job_id,
            status=status,
            processed_count=processed_count,
            failed_count=failed_count,
            deleted_document_count=deleted_document_count,
            skipped_count=skipped_count,
            total_files=len(source_files),
            duration_ms=duration_ms,
            error_message="\n".join(errors) if errors else None,
            cancel_requested=canceled,
        )
        self._active_running_job_ids.discard(job_id)
        self.db.log(
            feature="knowledge",
            action="knowledge.wiki.ingest.completed",
            status=status,
            inputs={"source_id": source_id, "job_id": job_id, "force": force},
            outputs={
                "processed_count": processed_count,
                "failed_count": failed_count,
                "skipped_count": skipped_count,
                "deleted_document_count": deleted_document_count,
                "gc_extracted_removed": gc_counts["extracted_removed"],
                "gc_raw_removed": gc_counts["raw_removed"],
                "aborted_for_failures": aborted_for_failures,
                "duration_ms": duration_ms,
            },
        )
        return finished

    def _collect_orphan_artifacts(self, source_id: str) -> dict[str, int]:
        """잡 말미 고아 산출물 GC (§5.8).

        - extracted/: 파일명(sha256 해시) 집합 − 현행 knowledge_documents.file_hash 집합 = 고아.
          해시 부재로 `<document_id>.md` 형식으로 저장된 파일은 오판 방지를 위해 GC 제외.
        - knowledge_raw/source-files/<source_id>/: 비삭제 knowledge_source_files 해시 기준 동일 GC.
        """
        current_hashes = {
            str(row["file_hash"])
            for row in self.db.fetch_all(
                "SELECT DISTINCT file_hash FROM knowledge_documents "
                "WHERE file_hash IS NOT NULL AND file_hash != ''"
            )
        }
        extracted_removed = 0
        reclaimed_bytes = 0
        for path in self.extracted_dir.glob("*.md"):
            stem = path.stem
            if not HASH_NAME_RE.match(stem):
                continue  # <document_id>.md 형식(해시 부재) — GC 제외
            if stem in current_hashes:
                continue
            try:
                size = path.stat().st_size
                path.unlink()
                extracted_removed += 1
                reclaimed_bytes += size
            except OSError:
                continue
        raw_removed = 0
        raw_dir = self.paths.knowledge_raw / "source-files" / source_id
        if raw_dir.exists():
            source_hashes = {
                str(row["file_hash"])
                for row in self.db.fetch_all(
                    "SELECT DISTINCT file_hash FROM knowledge_source_files "
                    "WHERE source_id = ? AND status != ?",
                    (source_id, "deleted"),
                )
            }
            # §5.5: 유예 보관 중(missing)인 문서의 원문은 살아있는 참조로 취급 —
            # 부활 시 재활용되므로 30일 하드 정리 전까지 GC하지 않는다.
            source_hashes |= {
                str(row["file_hash"])
                for row in self.db.fetch_all(
                    "SELECT DISTINCT file_hash FROM knowledge_wiki_docs "
                    "WHERE source_id = ? AND status = ? AND file_hash != ''",
                    (source_id, "missing"),
                )
            }
            for path in raw_dir.glob("*.txt"):
                stem = path.stem
                if not HASH_NAME_RE.match(stem):
                    continue
                if stem in source_hashes:
                    continue
                try:
                    size = path.stat().st_size
                    path.unlink()
                    raw_removed += 1
                    reclaimed_bytes += size
                except OSError:
                    continue
        return {
            "extracted_removed": extracted_removed,
            "raw_removed": raw_removed,
            # P3 §6 verify 리포트의 disk_reclaimed_bytes 근거 (run_job 경로는 미사용)
            "reclaimed_bytes": reclaimed_bytes,
        }

    def request_cancel(self, job_id: str) -> dict[str, Any]:
        job = self.db.fetch_one("SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,))
        if job is None:
            raise KeyError(job_id)
        if job["status"] in {"completed", "canceled"}:
            return job
        if job["status"] == "queued" or (
            job["status"] == "running" and job_id not in self._active_running_job_ids
        ):
            return self._finish_job(
                job_id,
                status="canceled",
                processed_count=job.get("processed_count") or 0,
                failed_count=job.get("failed_count") or 0,
                deleted_document_count=job.get("deleted_document_count") or 0,
                skipped_count=job.get("skipped_count") or 0,
                total_files=job.get("queued_count") or 0,
                duration_ms=job.get("duration_ms"),
                error_message=(
                    job.get("error_message")
                    if job["status"] == "queued"
                    else "running job worker is not active; marked canceled"
                ),
                cancel_requested=True,
            )
        self.db.execute(
            "UPDATE knowledge_ingestion_jobs SET cancel_requested = 1 WHERE id = ?",
            (job_id,),
        )
        return self._job_row(job_id) or job

    # ------------------------------------------------------ per-file ingest

    def _ingest_source_file(self, source_file: dict[str, Any]) -> dict[str, Any]:
        document = parse_document(Path(source_file["file_path"]))
        quality = self._quality_report(document)
        file_hash = str(source_file.get("file_hash") or "")

        existing_document = self.db.fetch_one(
            "SELECT id FROM knowledge_documents WHERE source_file_id = ?",
            (source_file["id"],),
        )
        document_id = str(existing_document["id"]) if existing_document else str(uuid4())

        # §7-3: 파일 시스템 산출물(extracted/카드)은 DB 확정 전에 먼저 쓴다.
        # 중간 크래시 시 DB에는 흔적이 없고 고아 파일만 남아 잡 말미 GC가 청소한다.
        extracted_body = self._extracted_markdown(document)
        extracted_rel = f"extracted/{file_hash or document_id}.md"
        extracted_path = self.wiki_root / extracted_rel
        extracted_path.write_text(
            self._front_matter(
                {
                    "source_path": source_file["file_path"],
                    "title": document.title,
                    "hash": file_hash,
                    "parser": document.parser_name,
                    "extracted_at": now_iso(),
                }
            )
            + "\n"
            + extracted_body,
            encoding="utf-8",
        )

        existing = self.db.fetch_one(
            "SELECT * FROM knowledge_wiki_docs WHERE source_file_id = ?",
            (source_file["id"],),
        )
        # §5.6 doc_uid: 최초 색인 시 발급되는 불변 8자 — 슬러그 = slugify(title)+doc_uid.
        # 내용 수정이 카드 교체로 이어지지 않고(문서:카드 1:1), 동일 해시 사본의
        # 공유 카드 삭제 연쇄 결손이 사라진다.
        doc_uid = str(existing.get("doc_uid") or "") if existing else ""
        if not doc_uid:
            doc_uid = uuid4().hex[:8]
        slug = wiki_slugify(document.title, doc_uid)

        keywords = self._keywords(extracted_body)
        overview = self._overview(document)
        card_rel = f"docs/{slug}.md"
        card_path = self.wiki_root / card_rel
        summary = str(existing.get("summary") or "") if existing else ""
        topics = self._json_list(existing.get("topics_json")) if existing else []
        enriched = bool(existing.get("enriched")) if existing else False
        # §5.4: 내용(file_hash) 변경 재인제스트는 재보강 대상으로 리셋하되
        # 기존 summary/topics는 유지하고 summary_stale=1로 정직하게 표기한다.
        content_changed = existing is not None and str(existing.get("file_hash") or "") != file_hash
        if content_changed:
            enriched = False
            summary_stale = 1
            enrich_fail_count = 0
            enrich_skip = 0
        elif existing is not None:
            summary_stale = int(existing.get("summary_stale") or 0)
            enrich_fail_count = int(existing.get("enrich_fail_count") or 0)
            enrich_skip = int(existing.get("enrich_skip") or 0)
        else:
            summary_stale = 0
            enrich_fail_count = 0
            enrich_skip = 0

        # P2a §5.1: 색인 내 자동 태깅 — 확정 taxonomy가 있으면 신규 문서와
        # 재판정 필요 문서(내용 변경으로 태그 신호가 바뀔 수 있는 경우)에 규칙 판정을
        # 실행한다. tag_locked=1 문서는 재판정 제외(보존 patch만), 참고서고 폴더 제외.
        relative_path = str(source_file.get("relative_path") or "")
        tag_locked = int(existing.get("tag_locked") or 0) if existing else 0
        tag_judgment: dict[str, str] | None = None
        queue_payload: dict[str, Any] | None = None
        taxonomy = self._confirmed_taxonomy(str(source_file["source_id"]))
        if (
            taxonomy is not None
            and not tag_locked
            and relative_path
            and not is_reference_shelf_path(relative_path)
            and (
                existing is None
                or content_changed
                or not str(existing.get("tag_confidence") or "")
            )
        ):
            area_slug, confidence, candidates, reason = match_work_area(
                taxonomy,
                relative_path=relative_path,
                source_path=str(source_file["file_path"]),
                title=nfc(document.title),
            )
            stem = Path(relative_path).stem
            enabled_keys = list(taxonomy.get("doc_roles_enabled") or DEFAULT_DOC_ROLE_KEYS)
            role = match_doc_role(stem, enabled_keys=enabled_keys)
            tag_judgment = {
                "work_area_slug": area_slug or "",
                "doc_role": role["key"] if role else "",
                "tag_confidence": confidence,
            }
            if confidence == "low":
                queue_payload = {
                    "candidates": {
                        "work_areas": candidates,
                        "doc_roles": match_doc_role_candidates(stem),
                    },
                    "reason": reason,
                }

        card_markdown = self._card_markdown(
            source_file=source_file,
            document=document,
            quality=quality,
            slug=slug,
            doc_uid=doc_uid,
            overview=overview,
            keywords=keywords,
            extracted_rel=extracted_rel,
            summary=summary,
            topics=topics,
            enriched=enriched,
        )
        if existing is not None:
            # T-01: 재색인으로 카드가 다시 쓰여도 기존 업무 태깅 메타는 보존한다.
            tag_updates = {
                "work_area": str(existing.get("work_area_slug") or ""),
                "doc_role": str(existing.get("doc_role") or ""),
                "tag_confidence": str(existing.get("tag_confidence") or ""),
                "family_id": str(existing.get("family_id") or ""),
                "family_role": str(existing.get("family_role") or ""),
            }
            if any(tag_updates.values()):
                card_markdown = patch_front_matter_text(card_markdown, tag_updates) or card_markdown
        if tag_judgment is not None:
            # §5.1: 자동 태깅 결과를 카드 front matter에 처음부터 반영한다.
            card_markdown = (
                patch_front_matter_text(
                    card_markdown,
                    {
                        "work_area": tag_judgment["work_area_slug"],
                        "doc_role": tag_judgment["doc_role"],
                        "tag_confidence": tag_judgment["tag_confidence"],
                    },
                )
                or card_markdown
            )

        # §5.7: 기존 카드의 사용자 메모 구역(마커 이하)을 추출해 재삽입하고,
        # 기계 영역이 사용자 손으로 편집됐으면(card_hash 불일치) 백업을 남긴다.
        preserved_notes: str | None = None
        if existing is not None and existing.get("card_path"):
            old_card_text: str | None = None
            try:
                old_card_file = Path(str(existing["card_path"]))
                if old_card_file.exists():
                    old_card_text = old_card_file.read_text(encoding="utf-8", errors="replace")
            except OSError:
                old_card_text = None
            if old_card_text is not None:
                preserved_notes = split_user_notes(old_card_text)[1]
                self._backup_card_if_edited(existing, old_card_text)
        card_markdown = compose_card_with_notes(card_markdown, preserved_notes)
        card_path.write_text(card_markdown, encoding="utf-8")

        timestamp = now_iso()
        norm_title = nfc(document.title).lower()
        norm_body = nfc(extracted_body).lower()[:FTS_BODY_MAX_CHARS]
        row = {
            "source_id": source_file["source_id"],
            "source_file_id": source_file["id"],
            "document_id": document_id,
            "slug": slug,
            "doc_uid": doc_uid,
            "title": nfc(document.title),
            "source_path": source_file["file_path"],
            "relative_path": source_file.get("relative_path") or "",
            "file_hash": file_hash,
            "doc_type": document.document_type,
            "parser_name": document.parser_name,
            "quality_score": quality["score"],
            "warnings_json": json.dumps(quality["warnings"], ensure_ascii=False),
            "card_path": str(card_path),
            "extracted_path": str(extracted_path),
            "summary": summary,
            "keywords_json": json.dumps(keywords, ensure_ascii=False),
            "topics_json": json.dumps(topics, ensure_ascii=False),
            "enriched": 1 if enriched else 0,
            "summary_stale": summary_stale,
            "enrich_fail_count": enrich_fail_count,
            "enrich_skip": enrich_skip,
            # §5.5: 재인제스트는 부활을 겸한다 — missing 행도 내용 변경 색인 시 복원.
            "status": "active",
            "missing_since": None,
            # §5.7: 시스템 작성본 기계 영역 해시(사용자 편집 감지 기준선).
            "card_hash": card_machine_hash(card_markdown),
            "card_dirty": 0,
            "norm_title": norm_title,
            "norm_body": norm_body,
            "updated_at": timestamp,
        }
        if tag_judgment is not None:
            # §5.1: 자동 태깅을 INSERT/UPDATE row에 포함한다(재판정 없으면 기존 값 보존).
            row.update(tag_judgment)
        # §7-3: 파일 단위 DB 쓰기 전체(documents upsert → children 교체 →
        # wiki_docs upsert → FTS delete+insert)를 단일 트랜잭션으로 묶는다.
        # 스킵 판정 기준인 knowledge_documents의 file_hash+ingestion_signature는
        # 커밋 시점에만 확정되므로, 중단 시 재실행이 이 파일을 다시 처리한다.
        with self.db.transaction():
            self._upsert_document(source_file, document, quality, document_id=document_id)
            self._replace_document_children(document_id, document)
            if existing is None:
                wiki_doc_id = str(uuid4())
                self.db.insert("knowledge_wiki_docs", {"id": wiki_doc_id, **row, "created_at": timestamp})
            else:
                wiki_doc_id = existing["id"]
                assignments = ", ".join(f"{column} = ?" for column in row)
                self.db.execute(
                    f"UPDATE knowledge_wiki_docs SET {assignments} WHERE id = ?",
                    (*row.values(), wiki_doc_id),
                )
            self._upsert_fts(wiki_doc_id, nfc(document.title), norm_body, nfc(card_markdown))
            if tag_judgment is not None:
                if queue_payload is not None:
                    # §5.1: 저확신(low)은 분류 대기 큐 upsert (wiki_doc_id 기록).
                    self.upsert_tag_queue(
                        source_id=str(source_file["source_id"]),
                        wiki_doc_id=wiki_doc_id,
                        doc_slug=slug,
                        title=nfc(document.title),
                        source_path=str(source_file["file_path"]),
                        candidates=queue_payload["candidates"],
                        reason=str(queue_payload["reason"]),
                    )
                else:
                    # high/medium 재판정으로 태그가 확정된 문서의 stale 대기 항목 정리.
                    self.db.execute(
                        "DELETE FROM knowledge_tag_queue WHERE wiki_doc_id = ? AND status = ?",
                        (wiki_doc_id, "pending"),
                    )

        # 슬러그 변경 시 구 카드 정리 — 커밋 후, 동일 카드를 참조하는
        # 생존 행이 없을 때만 unlink한다 (§5.8 refcount, 공유 카드 실종 방지).
        if existing and existing.get("card_path"):
            old_card = Path(str(existing["card_path"]))
            if old_card.name != f"{slug}.md" and old_card.exists():
                survivors = self.db.fetch_one(
                    "SELECT COUNT(*) AS count FROM knowledge_wiki_docs WHERE card_path = ? AND id != ?",
                    (str(existing["card_path"]), wiki_doc_id),
                )
                if int((survivors or {}).get("count") or 0) == 0:
                    old_card.unlink(missing_ok=True)

        # P2a §5.3 트리거 ①: 신규/수정 문서 색인 시 해당 family key 그룹만 국소 재평가.
        dirty_areas: set[str] = set()
        if tag_judgment is not None:
            if tag_judgment["work_area_slug"]:
                dirty_areas.add(tag_judgment["work_area_slug"])
            old_area = str(existing.get("work_area_slug") or "") if existing else ""
            if old_area and old_area != tag_judgment["work_area_slug"]:
                dirty_areas.add(old_area)
        if relative_path:
            norm_key, folder = family_key_for(relative_path)
            family_outcome = self.recompute_family_group(
                str(source_file["source_id"]), norm_key=norm_key, folder=folder
            )
            dirty_areas |= family_outcome["dirty_work_areas"]
        return {
            "document_id": document_id,
            "wiki_doc_id": wiki_doc_id,
            "parser_name": document.parser_name,
            "quality_score": quality["score"],
            "card_path": str(card_path),
            "dirty_work_areas": sorted(dirty_areas),
        }

    def _upsert_fts(self, doc_id: str, title: str, body: str, card: str) -> None:
        if not getattr(self.db, "fts5_available", False):
            return
        self.db.execute("DELETE FROM knowledge_fts WHERE doc_id = ?", (doc_id,))
        self.db.execute(
            "INSERT INTO knowledge_fts (doc_id, title, body, card) VALUES (?, ?, ?, ?)",
            (doc_id, nfc(title), nfc(body)[:FTS_BODY_MAX_CHARS], nfc(card)),
        )

    def _delete_wiki_doc(self, wiki_doc: dict[str, Any]) -> None:
        # §5.8 refcount: 동일 내용 사본이 카드/추출본을 공유하므로,
        # 같은 경로를 참조하는 생존 행이 있으면 파일은 남긴다.
        for column in ("card_path", "extracted_path"):
            path_value = wiki_doc.get(column)
            if not path_value:
                continue
            survivors = self.db.fetch_one(
                f"SELECT COUNT(*) AS count FROM knowledge_wiki_docs WHERE {column} = ? AND id != ?",
                (str(path_value), wiki_doc["id"]),
            )
            if int((survivors or {}).get("count") or 0) == 0:
                Path(str(path_value)).unlink(missing_ok=True)
        if getattr(self.db, "fts5_available", False):
            self.db.execute("DELETE FROM knowledge_fts WHERE doc_id = ?", (wiki_doc["id"],))
        # 삭제 문서의 분류 대기 큐 pending/suspended 항목 정리 (고아 큐 방지, §5.5)
        self.db.execute(
            "DELETE FROM knowledge_tag_queue WHERE wiki_doc_id = ? AND status IN (?, ?)",
            (wiki_doc["id"], "pending", "suspended"),
        )
        self.db.execute("DELETE FROM knowledge_wiki_docs WHERE id = ?", (wiki_doc["id"],))

    def _purge_deleted_source_documents(self, source_id: str) -> tuple[int, set[str]]:
        """삭제 반영 — 2단 소프트 삭제(§5.5) + P2a §5.3 트리거 ③: family 국소 재평가.

        검색·index·허브에서는 즉시 사라지도록 FTS 행과 sections/tables/chunks는
        바로 삭제하되(유령 검색 차단), 카드는 unlink 대신 front matter
        {status: missing, missing_since} + 상단 배너로 유예 보관하고 wiki_doc 행은
        status='missing'으로 보존한다. knowledge_documents 행도 보존한다 —
        해시 동일 부활 시 재파싱 스킵 판정(file_hash+signature)의 원천이자
        extracted GC의 살아있는 참조 근거다. 30일 경과 시 하드 정리(§5.5).
        대표 삭제 시 생존 형제가 승격되고, 그룹이 1건이 되면 family가 해제된다.
        반환: (삭제 반영 문서 수, dirty 업무 허브 slug 집합).
        """
        deleted_files = self.db.fetch_all(
            "SELECT id FROM knowledge_source_files WHERE source_id = ? AND status = ?",
            (source_id, "deleted"),
        )
        deleted_count = 0
        timestamp = now_iso()
        family_keys: set[tuple[str, str]] = set()
        dirty_areas: set[str] = set()
        removed_representatives: dict[tuple[str, str], str] = {}
        for source_file in deleted_files:
            wiki_doc = self.db.fetch_one(
                "SELECT * FROM knowledge_wiki_docs WHERE source_file_id = ?",
                (source_file["id"],),
            )
            if wiki_doc is not None:
                if str(wiki_doc.get("status") or "active") == "missing":
                    continue  # 이미 유예 보관 중 — 재처리(중복 집계·배너 중복) 방지
                relative_path = str(wiki_doc.get("relative_path") or "")
                if relative_path:
                    key = family_key_for(relative_path)
                    family_keys.add(key)
                    if str(wiki_doc.get("family_role") or "") in {"official", "latest"}:
                        # §5.3: 대표가 삭제되는 그룹 — 재평가 후 승격을 실행기록에 남긴다.
                        removed_representatives[key] = str(wiki_doc.get("title") or "")
                area_slug = str(wiki_doc.get("work_area_slug") or "")
                if area_slug:
                    dirty_areas.add(area_slug)
                self._soft_delete_wiki_doc(wiki_doc, missing_since=timestamp)
                # sections/tables/chunks는 즉시 삭제(현행 유지 — 유령 구조 차단),
                # knowledge_documents 행 자체는 보존한다.
                documents = self.db.fetch_all(
                    "SELECT id FROM knowledge_documents WHERE source_file_id = ?",
                    (source_file["id"],),
                )
                for document in documents:
                    self.db.execute(
                        "DELETE FROM knowledge_document_sections WHERE document_id = ?",
                        (document["id"],),
                    )
                    self.db.execute(
                        "DELETE FROM knowledge_table_blocks WHERE document_id = ?",
                        (document["id"],),
                    )
                    self.db.execute(
                        "DELETE FROM knowledge_document_chunks WHERE document_id = ?",
                        (document["id"],),
                    )
                deleted_count += 1
                continue
            # 카드 없이 documents만 남은 행(카드 생성 전 크래시 등)은 현행대로 하드 purge.
            documents = self.db.fetch_all(
                "SELECT id FROM knowledge_documents WHERE source_file_id = ?",
                (source_file["id"],),
            )
            for document in documents:
                self._delete_document_rows(document["id"])
                deleted_count += 1
        for norm_key, folder in family_keys:
            outcome = self.recompute_family_group(source_id, norm_key=norm_key, folder=folder)
            dirty_areas |= outcome["dirty_work_areas"]
            removed_title = removed_representatives.get((norm_key, folder))
            promoted_title = str(outcome.get("representative_title") or "")
            if removed_title and promoted_title:
                self.db.log(
                    feature="knowledge",
                    action="knowledge.family.representative_changed",
                    status="success",
                    inputs={"source_id": source_id, "family_key": norm_key},
                    outputs={
                        "message": (
                            f"문서 패밀리 대표 삭제로 승격: {norm_key} — "
                            f"{removed_title} 삭제 → {promoted_title} 승격"
                        ),
                    },
                )
        return deleted_count, dirty_areas

    # ------------------------------------- P2b §5.5 소프트 삭제·부활·하드 정리

    def _soft_delete_wiki_doc(self, wiki_doc: dict[str, Any], *, missing_since: str) -> None:
        """카드 유예 보관 전환(§5.5): FTS 즉시 삭제 + 행 status='missing' + 카드 배너.

        분류 대기 큐 pending은 삭제 대신 'suspended'로 숨긴다 — 해시 동일 부활은
        재인제스트를 거치지 않으므로, 삭제하면 검토 대기 항목이 조용히 유실된다.
        suspended는 부활 시 pending으로 복원돼 원상태를 정확히 되살린다(선택 근거).
        refcount·GC는 missing 카드/extracted를 살아있는 참조로 취급한다.
        """
        if getattr(self.db, "fts5_available", False):
            self.db.execute("DELETE FROM knowledge_fts WHERE doc_id = ?", (wiki_doc["id"],))
        self.db.execute(
            "UPDATE knowledge_tag_queue SET status = ? WHERE wiki_doc_id = ? AND status = ?",
            ("suspended", wiki_doc["id"], "pending"),
        )
        self.db.execute(
            "UPDATE knowledge_wiki_docs SET status = ?, missing_since = ?, updated_at = ? "
            "WHERE id = ?",
            ("missing", missing_since, missing_since, wiki_doc["id"]),
        )
        self._mark_card_missing(wiki_doc, missing_since=missing_since)
        self._append_log_line(
            f"soft-delete {wiki_doc.get('relative_path') or wiki_doc.get('source_path')} "
            f"(유예 보관 {self.missing_retention_days}일)"
        )

    def _mark_card_missing(self, wiki_doc: dict[str, Any], *, missing_since: str) -> None:
        """카드 front matter {status, missing_since} patch + 본문 최상단 배너 1줄 (§5.5)."""
        card_path = Path(str(wiki_doc.get("card_path") or ""))
        if not str(wiki_doc.get("card_path") or "") or not card_path.exists():
            return
        # 레거시 공유 카드(마이그레이션 전): 다른 생존(active) 행이 같은 카드를
        # 참조하면 배너를 달지 않는다 — 살아있는 문서의 카드를 오염시키지 않는다.
        survivors = self.db.fetch_one(
            "SELECT COUNT(*) AS count FROM knowledge_wiki_docs "
            "WHERE card_path = ? AND id != ? AND status != ?",
            (str(card_path), wiki_doc["id"], "missing"),
        )
        if int((survivors or {}).get("count") or 0) > 0:
            return
        try:
            text = card_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        patched = patch_front_matter_text(
            text, {"status": "missing", "missing_since": missing_since}
        )
        if patched is None:
            return
        if MISSING_BANNER_PREFIX not in patched:
            closing = patched.find("\n---", 3)
            if closing >= 0:
                insert_at = closing + len("\n---") + 1
                banner = f"\n{MISSING_BANNER_PREFIX} (감지: {missing_since[:10]})\n"
                patched = patched[:insert_at] + banner + patched[insert_at:]
        try:
            card_path.write_text(nfc(patched), encoding="utf-8")
        except OSError:
            return
        self._store_card_hash(str(wiki_doc["id"]), nfc(patched))

    def _unmark_card_missing(self, wiki_doc: dict[str, Any]) -> str | None:
        """부활 복원(§5.5): 배너 제거 + front matter status 복원. 최종 카드 텍스트 반환."""
        card_path = Path(str(wiki_doc.get("card_path") or ""))
        if not str(wiki_doc.get("card_path") or "") or not card_path.exists():
            return None
        try:
            text = card_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
        text = re.sub(
            rf"^{re.escape(MISSING_BANNER_PREFIX)}[^\n]*\n?", "", text, flags=re.MULTILINE
        )
        patched = patch_front_matter_text(text, {"status": "active", "missing_since": ""})
        if patched is None:
            patched = text
        try:
            card_path.write_text(nfc(patched), encoding="utf-8")
        except OSError:
            return None
        self._store_card_hash(str(wiki_doc["id"]), nfc(patched))
        return nfc(patched)

    def _restore_missing_wiki_docs(self, source_id: str) -> dict[str, Any]:
        """같은 경로가 재등장(스캔이 행 재사용)한 missing 문서를 복원한다 (§5.5).

        해시 동일이면 재파싱 없이 행·카드·FTS·큐(suspended→pending)를 되살리고,
        해시가 다르면 상태만 복원한다 — 이번 잡의 재인제스트가 카드·FTS를 재작성한다.
        """
        result: dict[str, Any] = {"restored_count": 0, "dirty_work_areas": set()}
        rows = self.db.fetch_all(
            """
            SELECT w.* FROM knowledge_wiki_docs w
            JOIN knowledge_source_files f ON f.id = w.source_file_id
            WHERE w.source_id = ? AND w.status = ? AND f.status != ?
            """,
            (source_id, "missing", "deleted"),
        )
        for doc in rows:
            timestamp = now_iso()
            with self.db.transaction():
                self.db.execute(
                    "UPDATE knowledge_wiki_docs SET status = ?, missing_since = NULL, "
                    "updated_at = ? WHERE id = ?",
                    ("active", timestamp, doc["id"]),
                )
                self.db.execute(
                    "UPDATE knowledge_tag_queue SET status = ? "
                    "WHERE wiki_doc_id = ? AND status = ?",
                    ("pending", doc["id"], "suspended"),
                )
            card_text = self._unmark_card_missing(doc)
            source_file = self.db.fetch_one(
                "SELECT file_hash FROM knowledge_source_files WHERE id = ?",
                (doc["source_file_id"],),
            )
            same_hash = (
                source_file is not None
                and str(source_file.get("file_hash") or "")
                == str(doc.get("file_hash") or "")
            )
            if same_hash and card_text:
                # 해시 동일 — 재파싱 없이 FTS만 되살린다.
                self._upsert_fts(
                    doc["id"],
                    str(doc.get("title") or ""),
                    str(doc.get("norm_body") or ""),
                    card_text,
                )
            relative_path = str(doc.get("relative_path") or "")
            if relative_path:
                norm_key, folder = family_key_for(relative_path)
                outcome = self.recompute_family_group(source_id, norm_key=norm_key, folder=folder)
                result["dirty_work_areas"] |= outcome["dirty_work_areas"]
            area_slug = str(doc.get("work_area_slug") or "")
            if area_slug:
                result["dirty_work_areas"].add(area_slug)
            result["restored_count"] += 1
            self._append_log_line(
                f"restore {relative_path or doc.get('source_path')} "
                f"(원본 재등장 — {'재파싱 생략' if same_hash else '재색인 예정'})"
            )
            self.db.log(
                feature="knowledge",
                action="knowledge.wiki.doc_restored",
                status="success",
                inputs={"source_id": source_id, "wiki_doc_id": doc["id"]},
                outputs={
                    "message": (
                        f"원본 재등장으로 카드 복원: {relative_path or doc.get('source_path')}"
                        + (" (재파싱 생략)" if same_hash else " (내용 변경 — 재색인)")
                    )
                },
            )
        return result

    def _cleanup_expired_missing_docs(
        self, source_id: str, *, retention_days: int | None = None
    ) -> int:
        """missing_since가 보관 기간(기본 30일)을 초과한 행을 하드 정리한다 (§5.5).

        카드·추출본 unlink는 P0 refcount(_delete_wiki_doc)를 그대로 따른다.
        보존해 두었던 knowledge_documents 행도 이 시점에 함께 삭제한다.
        """
        days = retention_days if retention_days is not None else self.missing_retention_days
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        rows = self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE source_id = ? AND status = ?",
            (source_id, "missing"),
        )
        removed = 0
        for doc in rows:
            missing_since = self._parse_timestamp(doc.get("missing_since"))
            if missing_since is None or missing_since > cutoff:
                continue
            with self.db.transaction():
                documents = self.db.fetch_all(
                    "SELECT id FROM knowledge_documents WHERE source_file_id = ?",
                    (doc["source_file_id"],),
                )
                for document in documents:
                    self._delete_document_rows(document["id"])
                self._delete_wiki_doc(doc)
            removed += 1
            self._append_log_line(
                f"hard-delete {doc.get('relative_path') or doc.get('source_path')} "
                f"(유예 {days}일 경과)"
            )
        if removed:
            self.db.log(
                feature="knowledge",
                action="knowledge.wiki.missing_expired",
                status="success",
                inputs={"source_id": source_id, "retention_days": days},
                outputs={"message": f"보관 기간 경과 missing 문서 {removed}건 하드 정리"},
            )
        return removed

    # --------------------------------- P2b §5.7 카드 해시·백업·patch 재시도

    def _store_card_hash(self, wiki_doc_id: str, content: str) -> None:
        self.db.execute(
            "UPDATE knowledge_wiki_docs SET card_hash = ?, card_dirty = 0 WHERE id = ?",
            (card_machine_hash(content), wiki_doc_id),
        )

    def _backup_card_if_edited(self, wiki_doc: dict[str, Any], current_text: str | None) -> bool:
        """재작성 전 기계 영역 편집 감지 — 불일치 시 docs/.backup에 3개 순환 백업 (§5.7)."""
        stored = str(wiki_doc.get("card_hash") or "")
        if not stored or current_text is None:
            return False  # card_hash 백필 이전(기준선 없음)은 감지 대상 아님
        if card_machine_hash(current_text) == stored:
            return False
        slug = str(wiki_doc.get("slug") or "card")
        backup_dir = self.docs_dir / ".backup"
        try:
            backup_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
            backup_path = backup_dir / f"{slug}-{stamp}.md"
            backup_path.write_text(current_text, encoding="utf-8")
            # 파일(슬러그)당 최근 3개 순환
            history = sorted(backup_dir.glob(f"{slug}-*.md"))
            for stale in history[:-3]:
                stale.unlink(missing_ok=True)
        except OSError:
            return False
        self.db.log(
            feature="knowledge",
            action="knowledge.wiki.card_backup",
            status="success",
            inputs={"wiki_doc_id": wiki_doc.get("id"), "slug": slug},
            outputs={
                "message": f"카드 기계 영역의 수동 편집을 감지해 백업했습니다: {backup_path.name}",
                "backup_path": str(backup_path),
            },
        )
        return True

    def patch_card(self, wiki_doc_id: str, path: Path, updates: dict[str, Any]) -> bool:
        """front matter patch + card_hash 추적. 실패 시 card_dirty=1 → 다음 잡 재시도 (§5.7)."""
        if patch_card_front_matter(path, updates):
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                text = None
            if text is not None:
                self._store_card_hash(wiki_doc_id, text)
                return True
        self.db.execute(
            "UPDATE knowledge_wiki_docs SET card_dirty = 1, updated_at = ? WHERE id = ?",
            (now_iso(), wiki_doc_id),
        )
        return False

    def _repair_dirty_cards(self, source_id: str) -> int:
        """card_dirty=1 카드를 DB에서 재투영해 수복한다 — patch 실패의 다음 잡 재시도 (§5.7)."""
        rows = self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE source_id = ? AND card_dirty = 1 "
            "AND status != ?",
            (source_id, "missing"),
        )
        repaired = 0
        for doc in rows:
            card_path = Path(str(doc.get("card_path") or ""))
            old_text: str | None = None
            try:
                if card_path.exists():
                    old_text = card_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                old_text = None
            notes = split_user_notes(old_text)[1] if old_text else None
            self._backup_card_if_edited(doc, old_text)
            machine = self._project_card_from_db(doc)
            content = compose_card_with_notes(machine, notes)
            try:
                card_path.write_text(content, encoding="utf-8")
            except OSError:
                continue  # 여전히 실패 — card_dirty 유지, 다음 잡 재시도
            self._store_card_hash(str(doc["id"]), content)
            repaired += 1
        return repaired

    # ------------------------------------ P2b §5.6 doc_uid 무파싱 마이그레이션

    def migrate_doc_uids(self, *, source_id: str | None = None) -> dict[str, Any]:
        """doc_uid 미발급(레거시) 행에 uid를 발급하고 카드를 개명한다 — 파싱 0회 (§5.6).

        signature bump 금지 계약: kordoc 재파싱 없이 기존 카드 텍스트를 재사용해
        front matter(slug/doc_uid)만 갱신·개명하고(사용자 메모 포함 전체 보존),
        카드 유실 시에만 DB에서 재투영한다. FTS delete+insert, 구 카드는
        refcount(같은 경로를 참조하는 잔여 행 0일 때만) unlink. 멱등.
        """
        if source_id:
            docs = self.db.fetch_all(
                "SELECT * FROM knowledge_wiki_docs "
                "WHERE source_id = ? AND (doc_uid IS NULL OR doc_uid = '') "
                "ORDER BY relative_path ASC",
                (source_id,),
            )
        else:
            docs = self.db.fetch_all(
                "SELECT * FROM knowledge_wiki_docs WHERE doc_uid IS NULL OR doc_uid = '' "
                "ORDER BY source_id ASC, relative_path ASC"
            )
        migrated = 0
        for doc in docs:
            doc_uid = uuid4().hex[:8]
            title = str(doc.get("title") or "")
            new_slug = wiki_slugify(title, doc_uid)
            old_card_path = Path(str(doc.get("card_path") or ""))
            new_card_path = self.docs_dir / f"{new_slug}.md"
            old_text: str | None = None
            try:
                if str(doc.get("card_path") or "") and old_card_path.exists():
                    old_text = old_card_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                old_text = None
            if old_text is not None:
                machine, notes = split_user_notes(old_text)
                machine = (
                    patch_front_matter_text(machine, {"slug": new_slug, "doc_uid": doc_uid})
                    or machine
                )
            else:
                doc_with_uid = {**doc, "doc_uid": doc_uid}
                machine = self._project_card_from_db(doc_with_uid, slug=new_slug)
                notes = None
            content = compose_card_with_notes(machine, notes)
            try:
                new_card_path.write_text(content, encoding="utf-8")
            except OSError:
                continue  # 이 행은 다음 마이그레이션 실행에서 재시도된다(멱등)
            timestamp = now_iso()
            with self.db.transaction():
                self.db.execute(
                    """
                    UPDATE knowledge_wiki_docs
                    SET doc_uid = ?, slug = ?, card_path = ?, card_hash = ?, card_dirty = 0,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        doc_uid,
                        new_slug,
                        str(new_card_path),
                        card_machine_hash(content),
                        timestamp,
                        doc["id"],
                    ),
                )
                if str(doc.get("status") or "active") != "missing":
                    # missing 문서는 검색에 되살리지 않는다(§5.5) — 행 추적성만 확보.
                    self._upsert_fts(
                        doc["id"],
                        title,
                        str(doc.get("norm_body") or ""),
                        content,
                    )
            if (
                old_text is not None
                and old_card_path != new_card_path
            ):
                # §5.8 refcount: 동일 구 카드를 아직 참조하는 행(미마이그레이션 사본 포함)이
                # 없을 때만 unlink — 마지막 사본이 개명될 때 자연 정리된다.
                survivors = self.db.fetch_one(
                    "SELECT COUNT(*) AS count FROM knowledge_wiki_docs "
                    "WHERE card_path = ? AND id != ?",
                    (str(old_card_path), doc["id"]),
                )
                if int((survivors or {}).get("count") or 0) == 0:
                    old_card_path.unlink(missing_ok=True)
            migrated += 1
        if migrated:
            try:
                self._write_topic_pages()
                self.rebuild_index()
            except OSError:
                pass
            self._append_log_line(
                f"migrate-doc-uid source={source_id or 'all'} migrated={migrated} (파싱 0회)"
            )
            self.db.log(
                feature="knowledge",
                action="knowledge.wiki.doc_uid_migrated",
                status="success",
                inputs={"source_id": source_id},
                outputs={
                    "message": f"doc_uid 마이그레이션: 카드 {migrated}건 재투영·개명 (파싱 0회)",
                    "migrated_count": migrated,
                },
            )
        return {"migrated_count": migrated, "candidate_count": len(docs)}

    def card_by_uid(self, doc_uid: str) -> dict[str, Any]:
        """§5.6: 인용 칩 폴백 — doc_uid로 카드 상태를 조회한다. 미존재 시 KeyError."""
        row = self.db.fetch_one(
            "SELECT * FROM knowledge_wiki_docs WHERE doc_uid = ?", (doc_uid,)
        )
        if row is None:
            raise KeyError(doc_uid)
        card_path = str(row.get("card_path") or "")
        return {
            "doc_uid": doc_uid,
            "card_path": card_path,
            "exists": bool(card_path) and Path(card_path).exists(),
            "status": str(row.get("status") or "active"),
            "title": str(row.get("title") or ""),
            "slug": str(row.get("slug") or ""),
            "source_path": str(row.get("source_path") or ""),
        }

    # ---------------------------------------- P2a 증분 태깅·패밀리 공용 헬퍼

    def _confirmed_taxonomy(self, source_id: str) -> dict[str, Any] | None:
        """확정된 분류체계(taxonomy_json)를 반환한다. 없으면 None."""
        row = self.db.fetch_one(
            "SELECT taxonomy_json FROM knowledge_taxonomy WHERE source_id = ?",
            (source_id,),
        )
        if row is None:
            return None
        try:
            taxonomy = json.loads(row.get("taxonomy_json") or "{}")
        except json.JSONDecodeError:
            return None
        if not isinstance(taxonomy, dict) or not taxonomy.get("work_areas"):
            return None
        return taxonomy

    def upsert_tag_queue(
        self,
        *,
        source_id: str,
        wiki_doc_id: str,
        doc_slug: str,
        title: str,
        source_path: str,
        candidates: dict[str, Any],
        reason: str,
        run_id: str = "",
    ) -> None:
        """분류 대기 큐 upsert (§5.1) — 같은 문서의 pending 항목이 있으면 갱신한다."""
        pending = self.db.fetch_one(
            "SELECT id FROM knowledge_tag_queue WHERE wiki_doc_id = ? AND status = ?",
            (wiki_doc_id, "pending"),
        )
        candidates_json = json.dumps(candidates, ensure_ascii=False)
        if pending is not None:
            self.db.execute(
                """
                UPDATE knowledge_tag_queue
                SET doc_slug = ?, title = ?, source_path = ?, candidates_json = ?, reason = ?
                WHERE id = ?
                """,
                (doc_slug, title, source_path, candidates_json, reason, pending["id"]),
            )
            return
        self.db.insert(
            "knowledge_tag_queue",
            {
                "id": str(uuid4()),
                "source_id": source_id,
                "wiki_doc_id": wiki_doc_id,
                "doc_slug": doc_slug,
                "title": title,
                "source_path": source_path,
                "candidates_json": candidates_json,
                "reason": reason,
                "status": "pending",
                "run_id": run_id,
                "resolved_work_area_slug": None,
                "resolved_doc_role": None,
                "created_at": now_iso(),
                "resolved_at": None,
            },
        )

    def recompute_family_group(
        self, source_id: str, *, norm_key: str, folder: str
    ) -> dict[str, Any]:
        """문서 패밀리 국소 재평가 (§5.3) — 단일 공용 구현.

        family key(정규화 stem + 부모폴더) 그룹만 SELECT해 official/latest/previous를
        결정적으로 재배정한다. 배정이 바뀐 형제만 DB UPDATE + 카드 front matter patch.
        그룹이 1건이 되면 family를 해제하고, 대표가 교체되면 실행기록 1줄을 남긴다.
        트리거: ①신규/수정 색인 ②rebind 부모 폴더 변경 ③삭제(purge). apply는 전량 배치 유지.
        """
        result: dict[str, Any] = {
            "changed_count": 0,
            "dirty_work_areas": set(),
            "representative_changed": False,
        }
        if not norm_key:
            return result
        family_id = family_id_for(norm_key, folder)
        members: list[dict[str, Any]] = []
        # ORDER BY relative_path: 배치(_detect_doc_families)와 동일한 입력 순서를 보장해
        # 정렬키 동점 시 대표 선정이 경로 간 진동하지 않게 한다(§5.3 등가 계약).
        # §5.5: missing 문서는 가족 멤버에서 제외한다 — 대표였다면 생존 형제가 승격된다.
        for doc in self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE source_id = ? AND status != ? "
            "ORDER BY relative_path ASC",
            (source_id, "missing"),
        ):
            rel = Path(nfc(str(doc.get("relative_path") or "")))
            if rel.parent.as_posix() == folder and normalize_family_key(rel.stem) == norm_key:
                members.append(doc)

        timestamp = now_iso()

        def _apply_assignment(doc: dict[str, Any], new_family_id: str, new_role: str) -> None:
            if (
                str(doc.get("family_id") or "") == new_family_id
                and str(doc.get("family_role") or "") == new_role
            ):
                return
            self.db.execute(
                "UPDATE knowledge_wiki_docs SET family_id = ?, family_role = ?, updated_at = ? "
                "WHERE id = ?",
                (new_family_id, new_role, timestamp, doc["id"]),
            )
            self.patch_card(
                str(doc["id"]),
                Path(str(doc.get("card_path") or "")),
                {"family_id": new_family_id, "family_role": new_role},
            )
            result["changed_count"] += 1
            area_slug = str(doc.get("work_area_slug") or "")
            if area_slug:
                result["dirty_work_areas"].add(area_slug)

        if len(members) < 2:
            # §5.3: 그룹 1건화(또는 소멸) — 남은 문서의 family를 해제한다.
            for doc in members:
                if str(doc.get("family_id") or "") or str(doc.get("family_role") or ""):
                    _apply_assignment(doc, "", "")
            return result

        files_by_id = {
            str(row["id"]): row
            for row in self.db.fetch_all(
                "SELECT id, modified_at FROM knowledge_source_files WHERE source_id = ?",
                (source_id,),
            )
        }
        scored: list[tuple[tuple[Any, ...], dict[str, Any], dict[str, Any]]] = []
        for member in members:
            stem = Path(str(member.get("relative_path") or "")).stem
            signals = version_signals(stem)
            source_file = files_by_id.get(str(member.get("source_file_id"))) or {}
            mtime = str(source_file.get("modified_at") or "")
            scored.append((family_sort_key(signals, mtime), member, signals))
        scored.sort(key=lambda item: item[0], reverse=True)

        old_representative = next(
            (
                member
                for member in members
                if str(member.get("family_id") or "") == family_id
                and str(member.get("family_role") or "") in {"official", "latest"}
            ),
            None,
        )
        for index, (_, member, signals) in enumerate(scored):
            if index == 0:
                role = "official" if signals["final"] else "latest"
            else:
                role = "previous"
            _apply_assignment(member, family_id, role)

        new_representative = scored[0][1]
        result["representative_title"] = str(new_representative.get("title") or "")
        if (
            old_representative is not None
            and str(old_representative["id"]) != str(new_representative["id"])
        ):
            result["representative_changed"] = True
            # §5.3: 대표 교체 실행기록 1줄
            self.db.log(
                feature="knowledge",
                action="knowledge.family.representative_changed",
                status="success",
                inputs={"source_id": source_id, "family_id": family_id},
                outputs={
                    "message": (
                        f"문서 패밀리 대표 교체: {norm_key} — "
                        f"{old_representative.get('title')} → {new_representative.get('title')}"
                    ),
                    "from_slug": old_representative.get("slug"),
                    "to_slug": new_representative.get("slug"),
                },
            )
        return result

    # -------------------------------------------------------- moved rebind

    def rebind_moved_source_file(
        self, *, source_file_id: str, old_path: str, new_path: str, new_relative: str
    ) -> dict[str, Any]:
        """이동 rebind — 비정규화 경로 사본 전파(설계서 §4.3, 재파싱 0회).

        호출자(knowledge.scan_source의 MOVED 반영)가 파일당 단일 트랜잭션으로 감싼다.
        전파 지점: ② knowledge_documents.file_path ③ knowledge_wiki_docs.source_path/
        relative_path ④ 카드 재투영(파싱 없이 — front matter source_path + 본문
        "원본 경로" 줄) ⑤ FTS delete+insert(card 컬럼에 새 카드 전문) ⑥ 파서 폴백
        title(파일명 stem 유래)이면 title·슬러그도 새 stem으로 갱신.

        ③을 빠뜨리면 lint fix가 rebind 문서를 orphan으로 오판해 하드삭제하고,
        태깅·family 키가 옛 폴더 기준으로 재판정되는 자기모순이 생긴다(§8 기각 사유).
        태그(work_area_slug/doc_role)·enriched·summary는 행 id 보존으로 자동 승계되므로
        건드리지 않는다(family/태그 재평가는 P2 몫). 슬러그 변경 시 구 카드 unlink는
        롤백 안전을 위해 커밋 후 호출자가 수행한다(stale_card_path 반환 — §5.8 refcount).
        """
        timestamp = now_iso()
        result: dict[str, Any] = {
            "rebound": False,
            "title_updated": False,
            "stale_card_path": None,
            "wiki_doc_id": None,
        }
        old_stem = Path(old_path).stem
        new_stem = Path(new_path).stem

        # ② knowledge_documents.file_path (+stem 폴백 title)
        document = self.db.fetch_one(
            "SELECT id, title FROM knowledge_documents WHERE source_file_id = ?",
            (source_file_id,),
        )
        if document is not None:
            doc_title = str(document.get("title") or "")
            if doc_title == old_stem and new_stem != old_stem:
                doc_title = new_stem
            self.db.execute(
                "UPDATE knowledge_documents SET file_path = ?, title = ?, updated_at = ? WHERE id = ?",
                (new_path, doc_title, timestamp, document["id"]),
            )
            result["rebound"] = True

        wiki_doc = self.db.fetch_one(
            "SELECT * FROM knowledge_wiki_docs WHERE source_file_id = ?",
            (source_file_id,),
        )
        if wiki_doc is None:
            # 아직 인제스트 전(스캔만 된 파일) — 다음 색인이 새 경로로 생성한다.
            return result

        old_title = str(wiki_doc.get("title") or "")
        old_slug = str(wiki_doc.get("slug") or "")
        new_title = old_title
        new_slug = old_slug
        # ⑥ rename 시 stem 폴백 title 카드가 옛 파일명으로 남는 한계 봉합(§4.3) — 파싱 없이 가능.
        if nfc(old_title) == nfc(old_stem) and new_stem != old_stem:
            new_title = nfc(new_stem)
            # §5.6: 슬러그 접미는 doc_uid 우선(불변) — uid 미발급 레거시 행만 해시 폴백.
            new_slug = wiki_slugify(
                new_title,
                str(wiki_doc.get("doc_uid") or "") or str(wiki_doc.get("file_hash") or ""),
            )

        old_card_path = Path(str(wiki_doc.get("card_path") or ""))
        new_card_path = self.docs_dir / f"{new_slug}.md"
        card_text: str | None = None
        try:
            if wiki_doc.get("card_path") and old_card_path.exists():
                card_text = old_card_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            card_text = None
        if card_text is None:
            # 카드 유실 시에도 DB 필드만으로 재투영한다(파싱 0회).
            card_text = compose_card_with_notes(
                self._project_card_from_db(
                    wiki_doc, slug=new_slug, title=new_title, source_path=new_path
                ),
                None,
            )
        else:
            card_text = self._rebound_card_text(
                card_text,
                old_path=old_path,
                new_path=new_path,
                old_title=old_title,
                new_title=new_title,
                new_slug=new_slug,
            )
            if USER_NOTES_MARKER not in card_text:
                # §5.7: 마커 도입 이전 카드에 메모 구역을 상설한다.
                card_text = compose_card_with_notes(card_text, None)
        # §7-3 패턴: 파일 산출물을 DB 확정 전에 먼저 쓴다 — 중단 시 DB는 구 상태로 남고
        # 잉여 카드 파일만 남는다.
        new_card_path.write_text(card_text, encoding="utf-8")
        # §5.7: rebind는 기존 텍스트를 통째로 승계하므로(메모 포함) 새 내용을 기준선으로.
        self._store_card_hash(str(wiki_doc["id"]), card_text)

        # ③ wiki_docs 경로·(변경 시) title/slug 갱신 — 행 id 보존으로 태그·요약 승계
        self.db.execute(
            """
            UPDATE knowledge_wiki_docs
            SET source_path = ?, relative_path = ?, title = ?, norm_title = ?,
                slug = ?, card_path = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                new_path,
                new_relative,
                new_title,
                nfc(new_title).lower(),
                new_slug,
                str(new_card_path),
                timestamp,
                wiki_doc["id"],
            ),
        )
        # ⑤ FTS delete+insert — card 컬럼에 새 경로가 실린 카드 전문을 재색인
        self._upsert_fts(
            wiki_doc["id"], new_title, str(wiki_doc.get("norm_body") or ""), nfc(card_text)
        )

        if new_slug != old_slug and str(wiki_doc.get("card_path") or "") and old_card_path != new_card_path:
            # §5.8 refcount: 같은 구 카드를 참조하는 생존 행이 없을 때만 unlink 대상으로 반환.
            survivors = self.db.fetch_one(
                "SELECT COUNT(*) AS count FROM knowledge_wiki_docs WHERE card_path = ? AND id != ?",
                (str(old_card_path), wiki_doc["id"]),
            )
            if int((survivors or {}).get("count") or 0) == 0:
                result["stale_card_path"] = str(old_card_path)

        result["rebound"] = True
        result["title_updated"] = new_title != old_title
        result["wiki_doc_id"] = wiki_doc["id"]

        # P2a §5.3 트리거 ②/§4.3-⑥: 부모 폴더가 바뀐 rebind는 work_area 재판정
        # (tag_locked 제외 — 보존 + 실행기록에 재확인 권장) + family 국소 재평가
        # (구 그룹·신 그룹 양쪽). 호출자(_apply_move)의 파일당 트랜잭션 안에서 수행된다.
        source_id = str(wiki_doc.get("source_id") or "")
        old_relative = str(wiki_doc.get("relative_path") or "")
        old_parent = Path(old_relative).parent.as_posix() if old_relative else ""
        new_parent = Path(new_relative).parent.as_posix()
        parent_changed = bool(old_relative) and old_parent != new_parent
        dirty_areas: set[str] = set()
        if parent_changed:
            taxonomy = self._confirmed_taxonomy(source_id)
            if taxonomy is not None:
                old_area = str(wiki_doc.get("work_area_slug") or "")
                if int(wiki_doc.get("tag_locked") or 0):
                    # §5.2: 사용자 확정(lock) 태그는 보존하고 재확인만 권장한다.
                    self.db.log(
                        feature="knowledge",
                        action="knowledge.taxonomy.rebind.locked_kept",
                        status="success",
                        inputs={"source_id": source_id, "wiki_doc_id": wiki_doc["id"]},
                        outputs={
                            "message": (
                                f"파일 이동 후 분류 재확인 권장: {new_relative} "
                                "(사용자 확정 태그 보존)"
                            )
                        },
                    )
                elif not is_reference_shelf_path(new_relative):
                    area_slug, confidence, candidates, reason = match_work_area(
                        taxonomy,
                        relative_path=new_relative,
                        source_path=new_path,
                        title=new_title,
                    )
                    stem = Path(new_relative).stem
                    enabled_keys = list(
                        taxonomy.get("doc_roles_enabled") or DEFAULT_DOC_ROLE_KEYS
                    )
                    role = match_doc_role(stem, enabled_keys=enabled_keys)
                    role_key = role["key"] if role else ""
                    self.db.execute(
                        """
                        UPDATE knowledge_wiki_docs
                        SET work_area_slug = ?, doc_role = ?, tag_confidence = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (area_slug or "", role_key, confidence, timestamp, wiki_doc["id"]),
                    )
                    self.patch_card(
                        str(wiki_doc["id"]),
                        new_card_path,
                        {
                            "work_area": area_slug or "",
                            "doc_role": role_key,
                            "tag_confidence": confidence,
                        },
                    )
                    if confidence == "low":
                        self.upsert_tag_queue(
                            source_id=source_id,
                            wiki_doc_id=str(wiki_doc["id"]),
                            doc_slug=new_slug,
                            title=new_title,
                            source_path=new_path,
                            candidates={
                                "work_areas": candidates,
                                "doc_roles": match_doc_role_candidates(stem),
                            },
                            reason=reason,
                        )
                    else:
                        self.db.execute(
                            "DELETE FROM knowledge_tag_queue WHERE wiki_doc_id = ? AND status = ?",
                            (wiki_doc["id"], "pending"),
                        )
                    if area_slug:
                        dirty_areas.add(area_slug)
                    if old_area and old_area != (area_slug or ""):
                        dirty_areas.add(old_area)
        family_keys: set[tuple[str, str]] = {family_key_for(new_relative)}
        if old_relative:
            family_keys.add(family_key_for(old_relative))
        for norm_key, folder in family_keys:
            outcome = self.recompute_family_group(source_id, norm_key=norm_key, folder=folder)
            dirty_areas |= outcome["dirty_work_areas"]
        if dirty_areas and self.hub_refresher is not None:
            try:
                self.hub_refresher(source_id, sorted(dirty_areas))
            except Exception:  # noqa: BLE001 - 허브 재작성 실패가 rebind를 막으면 안 된다
                pass
        result["dirty_work_areas"] = sorted(dirty_areas)

        self._append_log_line(f"rebind moved {old_path} -> {new_path} (재파싱 생략)")
        return result

    def _rebound_card_text(
        self,
        text: str,
        *,
        old_path: str,
        new_path: str,
        old_title: str,
        new_title: str,
        new_slug: str,
    ) -> str:
        """기존 카드 텍스트에서 경로·(변경 시) 제목만 제자리 치환한다 — 파싱 불필요(§4.3-④)."""
        if text.startswith("---"):
            closing = text.find("\n---", 3)
            if closing > 0:
                block = text[3:closing]
                for key, value in (
                    ("source_path", new_path),
                    ("slug", new_slug),
                    ("title", new_title),
                ):
                    line = f"{key}: {value}"
                    pattern = re.compile(rf"^{re.escape(key)}:.*$", re.MULTILINE)
                    if pattern.search(block):
                        # 치환문에 Windows 경로 역슬래시(\U 등)가 들어가므로 lambda로 리터럴 치환.
                        block = pattern.sub(lambda _match, _line=line: _line, block, count=1)
                    else:
                        block = block.rstrip("\n") + "\n" + line
                text = "---" + block + text[closing:]
        text = text.replace(f"- 원본 경로: {old_path}", f"- 원본 경로: {new_path}")
        if new_title != old_title:
            replacement = f"# {new_title}"
            text = re.sub(
                rf"^# {re.escape(old_title)}\s*$",
                lambda _match: replacement,
                text,
                count=1,
                flags=re.MULTILINE,
            )
        return nfc(text)

    def _project_card_from_db(
        self,
        wiki_doc: dict[str, Any],
        *,
        slug: str | None = None,
        title: str | None = None,
        source_path: str | None = None,
        summary: str | None = None,
        topics: list[str] | None = None,
        enriched: bool | None = None,
    ) -> str:
        """DB 행(+보존된 sections/tables)만으로 카드 기계 영역을 재투영한다 — 파싱 0회.

        사용처: rebind 카드 유실 복구, enrich 재작성(§5.4), doc_uid 마이그레이션 폴백,
        card_dirty 재시도(§5.7). 사용자 메모 구역은 호출자가 compose_card_with_notes로
        이어붙인다. 소프트 삭제로 sections가 정리된 부활 문서는 아웃라인이 비는
        한계가 있다(카드 파일 자체는 동결 보존되므로 통상 경로에서는 발생하지 않음).
        """
        slug = slug if slug is not None else str(wiki_doc.get("slug") or "")
        title = title if title is not None else str(wiki_doc.get("title") or "")
        source_path = (
            source_path if source_path is not None else str(wiki_doc.get("source_path") or "")
        )
        summary = str(wiki_doc.get("summary") or "").strip() if summary is None else summary
        topics = self._json_list(wiki_doc.get("topics_json")) if topics is None else topics
        enriched = bool(wiki_doc.get("enriched")) if enriched is None else enriched
        keywords = self._json_list(wiki_doc.get("keywords_json"))
        source_file = self.db.fetch_one(
            "SELECT modified_at, file_hash FROM knowledge_source_files WHERE id = ?",
            (wiki_doc.get("source_file_id"),),
        )
        front = self._front_matter(
            {
                "slug": slug,
                "title": title,
                "source_path": source_path,
                "doc_type": wiki_doc.get("doc_type") or "",
                "mtime": (source_file or {}).get("modified_at") or "",
                "parser": wiki_doc.get("parser_name") or "",
                "quality_score": wiki_doc.get("quality_score"),
                "warnings": self._json_list(wiki_doc.get("warnings_json")),
                "hash": wiki_doc.get("file_hash") or "",
                "doc_uid": wiki_doc.get("doc_uid") or "",
                "topics": topics,
                "enriched": enriched,
            }
        )
        lines: list[str] = [front, CARD_AUTOGEN_COMMENT, f"# {title}", ""]
        sections = self.db.fetch_all(
            "SELECT * FROM knowledge_document_sections WHERE document_id = ? "
            "ORDER BY order_index ASC",
            (wiki_doc.get("document_id"),),
        )
        overview = ""
        for section in sections:
            for raw_line in str(section.get("text") or "").splitlines():
                cleaned = re.sub(r"\s+", " ", raw_line).strip()
                if len(cleaned) >= 10:
                    overview = nfc(cleaned[:OVERVIEW_MAX_CHARS])
                    break
            if overview:
                break
        lines.append("## 개요")
        lines.append(overview or "(본문에서 개요를 추출하지 못했습니다.)")
        lines.append("")
        if summary:
            lines.append("## LLM 요약")
            lines.append(summary)
            lines.append("")
        lines.append("## 섹션 아웃라인")
        if sections:
            for section in sections:
                level = int(section.get("level") or 1)
                indent = "  " * max(0, min(4, level - 1))
                lines.append(f"{indent}- {section.get('heading')}")
        else:
            lines.append("- (섹션 없음)")
        lines.append("")
        tables = self.db.fetch_all(
            "SELECT t.*, s.heading AS section_heading FROM knowledge_table_blocks t "
            "LEFT JOIN knowledge_document_sections s ON s.id = t.section_id "
            "WHERE t.document_id = ? ORDER BY t.order_index ASC",
            (wiki_doc.get("document_id"),),
        )
        if tables:
            lines.append("## 표 요약")
            for table in tables:
                label = table.get("caption") or table.get("section_heading") or "표"
                headers = self._json_list(table.get("headers_json"))
                table_rows = []
                try:
                    table_rows = json.loads(table.get("rows_json") or "[]")
                except json.JSONDecodeError:
                    table_rows = []
                header_text = " | ".join(headers) if headers else f"{len(table_rows)}행"
                lines.append(f"- {label}: {header_text}")
            lines.append("")
        if keywords:
            lines.append("## 키워드")
            lines.append(", ".join(keywords))
            lines.append("")
        if topics:
            lines.append("## 주제")
            for topic in topics:
                lines.append(f"- [[topics/{wiki_slugify(topic, topic)}|{topic}]]")
            lines.append("")
        lines.append("## 원본")
        lines.append(f"- 원본 경로: {source_path}")
        extracted = str(wiki_doc.get("extracted_path") or "")
        if extracted:
            try:
                extracted_rel = Path(extracted).relative_to(self.wiki_root).as_posix()
                lines.append(f"- 추출본: [{extracted_rel}](../{extracted_rel})")
            except ValueError:
                lines.append(f"- 추출본: {extracted}")
        warnings = self._json_list(wiki_doc.get("warnings_json"))
        lines.append(
            f"- 품질: {wiki_doc.get('quality_score')} (경고: {', '.join(warnings) or '없음'})"
        )
        machine = nfc("\n".join(lines).strip() + "\n")
        # 태깅·가족 메타는 front matter patch로 관리되므로 재투영에도 반영한다.
        tag_updates = {
            "work_area": str(wiki_doc.get("work_area_slug") or ""),
            "doc_role": str(wiki_doc.get("doc_role") or ""),
            "tag_confidence": str(wiki_doc.get("tag_confidence") or ""),
            "family_id": str(wiki_doc.get("family_id") or ""),
            "family_role": str(wiki_doc.get("family_role") or ""),
        }
        if any(tag_updates.values()):
            machine = patch_front_matter_text(machine, tag_updates) or machine
        return machine

    # ------------------------------------------------------- documents table

    def _upsert_document(
        self,
        source_file: dict[str, Any],
        document: StructuredDocument,
        quality: dict[str, Any],
        *,
        document_id: str | None = None,
    ) -> str:
        existing = self.db.fetch_one(
            "SELECT * FROM knowledge_documents WHERE source_file_id = ?",
            (source_file["id"],),
        )
        timestamp = now_iso()
        metadata = {**document.metadata, "extraction_quality": quality}
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
            "quality_score": quality["score"],
            "partial": 1 if document.partial else 0,
            "metadata_json": json.dumps(metadata, ensure_ascii=False),
            "updated_at": timestamp,
        }
        if existing is None:
            new_document_id = document_id or str(uuid4())
            self.db.insert("knowledge_documents", {"id": new_document_id, **payload, "created_at": timestamp})
            return new_document_id
        existing_id = str(existing["id"])
        assignments = ", ".join(f"{column} = ?" for column in payload)
        self.db.execute(
            f"UPDATE knowledge_documents SET {assignments} WHERE id = ?",
            (*payload.values(), existing_id),
        )
        return existing_id

    def _replace_document_children(self, document_id: str, document: StructuredDocument) -> None:
        """섹션/표 구조를 갱신한다. (청크·그래프·벡터는 위키 경로에서 기록하지 않음)"""
        timestamp = now_iso()
        self.db.execute("DELETE FROM knowledge_document_sections WHERE document_id = ?", (document_id,))
        self.db.execute("DELETE FROM knowledge_table_blocks WHERE document_id = ?", (document_id,))
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

    def _delete_document_rows(self, document_id: str) -> None:
        self.db.execute("DELETE FROM knowledge_document_sections WHERE document_id = ?", (document_id,))
        self.db.execute("DELETE FROM knowledge_table_blocks WHERE document_id = ?", (document_id,))
        self.db.execute("DELETE FROM knowledge_document_chunks WHERE document_id = ?", (document_id,))
        self.db.execute("DELETE FROM knowledge_documents WHERE id = ?", (document_id,))

    def _source_files_for_ingestion(
        self, source_id: str, *, force: bool = False
    ) -> tuple[list[dict[str, Any]], int]:
        source_files = self.db.fetch_all(
            """
            SELECT * FROM knowledge_source_files
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

    # ------------------------------------------------------------ card build

    def _quality_report(self, document: StructuredDocument) -> dict[str, Any]:
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

    def _extracted_markdown(self, document: StructuredDocument) -> str:
        lines: list[str] = [f"# {document.title}", ""]
        for section in document.sections:
            marker = "#" * max(2, min(6, section.level + 1))
            lines.append(f"{marker} {section.heading}")
            lines.append("")
            for paragraph in section.paragraphs:
                lines.append(paragraph)
                lines.append("")
            for table in section.tables:
                if table.caption:
                    lines.append(f"표: {table.caption}")
                if table.headers:
                    lines.append("| " + " | ".join(table.headers) + " |")
                    lines.append("|" + "---|" * len(table.headers))
                for row in table.rows:
                    lines.append("| " + " | ".join(row) + " |")
                lines.append("")
        return nfc("\n".join(lines).strip() + "\n")

    def _overview(self, document: StructuredDocument) -> str:
        for section in document.sections:
            for paragraph in section.paragraphs:
                cleaned = re.sub(r"\s+", " ", paragraph).strip()
                if len(cleaned) >= 10:
                    return nfc(cleaned[:OVERVIEW_MAX_CHARS])
        for section in document.sections:
            for table in section.tables:
                projection = re.sub(r"\s+", " ", table.to_text_projection()).strip()
                if projection:
                    return nfc(projection[:OVERVIEW_MAX_CHARS])
        return ""

    def _keywords(self, text: str) -> list[str]:
        counter: Counter[str] = Counter(
            token
            for token in _tokenize(text)
            if len(token) >= 2 and token not in STOPWORDS and not token.isdigit()
        )
        return [token for token, _count in counter.most_common(KEYWORD_COUNT)]

    def _front_matter(self, fields: dict[str, Any]) -> str:
        lines = ["---"]
        for key, value in fields.items():
            if isinstance(value, list):
                lines.append(f"{key}: {json.dumps(value, ensure_ascii=False)}")
            elif isinstance(value, bool):
                lines.append(f"{key}: {'true' if value else 'false'}")
            else:
                lines.append(f"{key}: {value if value is not None else ''}")
        lines.append("---")
        return "\n".join(lines) + "\n"

    def _card_markdown(
        self,
        *,
        source_file: dict[str, Any],
        document: StructuredDocument,
        quality: dict[str, Any],
        slug: str,
        doc_uid: str,
        overview: str,
        keywords: list[str],
        extracted_rel: str,
        summary: str,
        topics: list[str],
        enriched: bool,
    ) -> str:
        """카드 기계 영역을 생성한다. 사용자 메모 구역은 compose_card_with_notes가 붙인다."""
        front = self._front_matter(
            {
                "slug": slug,
                "title": nfc(document.title),
                "source_path": source_file["file_path"],
                "doc_type": document.document_type,
                "mtime": source_file.get("modified_at") or "",
                "parser": document.parser_name,
                "quality_score": quality["score"],
                "warnings": quality["warnings"],
                "hash": source_file.get("file_hash") or "",
                "doc_uid": doc_uid,
                "topics": topics,
                "enriched": enriched,
            }
        )
        lines: list[str] = [front, CARD_AUTOGEN_COMMENT, f"# {nfc(document.title)}", ""]
        lines.append("## 개요")
        lines.append(overview or "(본문에서 개요를 추출하지 못했습니다.)")
        lines.append("")
        if summary:
            lines.append("## LLM 요약")
            lines.append(summary)
            lines.append("")
        lines.append("## 섹션 아웃라인")
        if document.sections:
            for section in document.sections:
                indent = "  " * max(0, min(4, section.level - 1))
                lines.append(f"{indent}- {section.heading}")
        else:
            lines.append("- (섹션 없음)")
        lines.append("")
        tables = [(section.heading, table) for section in document.sections for table in section.tables]
        if tables:
            lines.append("## 표 요약")
            for heading, table in tables:
                label = table.caption or heading
                headers = " | ".join(table.headers) if table.headers else f"{len(table.rows)}행"
                lines.append(f"- {label}: {headers}")
            lines.append("")
        if keywords:
            lines.append("## 키워드")
            lines.append(", ".join(keywords))
            lines.append("")
        if topics:
            lines.append("## 주제")
            for topic in topics:
                lines.append(f"- [[topics/{wiki_slugify(topic, topic)}|{topic}]]")
            lines.append("")
        lines.append("## 원본")
        lines.append(f"- 원본 경로: {source_file['file_path']}")
        lines.append(f"- 추출본: [{extracted_rel}](../{extracted_rel})")
        lines.append(f"- 품질: {quality['score']} (경고: {', '.join(quality['warnings']) or '없음'})")
        return nfc("\n".join(lines).strip() + "\n")

    # ---------------------------------------------------------- index & log

    def rebuild_index(self) -> str:
        """업무 인지형(Work-Aware) 인덱스: 주제 → 업무 기록 → 문서 순서로 재구성한다."""
        sources = {
            row["id"]: row for row in self.db.fetch_all("SELECT * FROM knowledge_sources ORDER BY label ASC")
        }
        # §5.5: 유예 보관(missing) 문서는 인덱스에서 즉시 제외한다.
        docs = self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE status != ? ORDER BY source_id ASC, title ASC",
            ("missing",),
        )
        topics = self._all_topics()
        work_pages = self.list_work_pages()
        lines = ["# 지식폴더 위키 인덱스", "", f"_갱신: {now_iso()}_", ""]

        # T-01: 확정된 업무 분류체계가 있으면 업무 허브를 최상단에 노출한다.
        work_area_pages = self.list_work_area_pages()
        if work_area_pages:
            lines.append("## 업무")
            lines.append("")
            for page in work_area_pages:
                lines.append(f"- [{page['title']}]({page['path']}) — 문서 {page['doc_count']}건")
            lines.append("")

        lines.append("## 주제")
        lines.append("")
        if topics:
            for topic, doc_rows in sorted(topics.items()):
                topic_slug = wiki_slugify(topic, topic)
                lines.append(f"- [{topic}](topics/{topic_slug}.md) — 문서 {len(doc_rows)}건")
        else:
            lines.append("- (아직 분류된 주제가 없습니다. LLM 보강을 실행하면 주제가 생성됩니다.)")
        lines.append("")

        lines.append("## 업무 기록")
        lines.append("")
        if work_pages:
            for page in work_pages:
                stamp = str(page.get("updated_at") or "")[:10]
                cited_count = len(page.get("cited_docs") or [])
                lines.append(
                    f"- [{page['title']}]({page['path']}) — 갱신 {stamp or '미상'} · 인용 문서 {cited_count}건"
                )
        else:
            lines.append("- (아직 반영된 업무 기록이 없습니다. 업무대화에서 '이 세션 지식 반영'을 실행해 보세요.)")
        lines.append("")

        lines.append("## 문서")
        lines.append("")
        # §5.6 UX 회귀 방지: doc_uid 1:1화로 동일 해시 사본이 각자 카드를 갖게 되므로,
        # 목차에는 동일 file_hash 그룹의 대표 1건 + "사본 N개"로 접어 표기한다.
        by_source: dict[str, list[tuple[dict[str, Any], int]]] = {}
        for source_key, deduped in self._dedupe_docs_by_hash(docs).items():
            by_source[source_key] = deduped
        if not by_source:
            lines.append("- (아직 색인된 문서가 없습니다.)")
            lines.append("")
        for source_id, source_docs in by_source.items():
            source = sources.get(source_id)
            label = source["label"] if source else source_id
            lines.append(f"### {label}")
            lines.append("")
            for doc, duplicate_count in source_docs:
                summary = str(doc.get("summary") or "").strip()
                if not summary:
                    keywords = self._json_list(doc.get("keywords_json"))
                    summary = ", ".join(keywords[:5]) if keywords else "요약 없음"
                summary = re.sub(r"\s+", " ", summary)[:120]
                duplicate_note = f" (사본 {duplicate_count}개)" if duplicate_count > 1 else ""
                lines.append(
                    f"- [{doc['title']}](docs/{doc['slug']}.md){duplicate_note} — {summary} · 원본: {doc['source_path']}"
                )
            lines.append("")
        content = nfc("\n".join(lines).strip() + "\n")
        self.index_path.write_text(content, encoding="utf-8")
        return content

    def _dedupe_docs_by_hash(
        self, docs: list[dict[str, Any]]
    ) -> dict[str, list[tuple[dict[str, Any], int]]]:
        """소스별로 동일 file_hash 그룹을 대표 1건 + 사본 수로 접는다 (§5.6).

        해시가 없는 문서는 접지 않고 그대로 노출한다. 입력 순서(정렬)를 보존한다.
        반환: {source_id: [(대표 doc, duplicate_count), ...]}
        """
        by_source: dict[str, list[tuple[dict[str, Any], int]]] = {}
        seen: dict[tuple[str, str], int] = {}
        for doc in docs:
            source_key = str(doc["source_id"])
            file_hash = str(doc.get("file_hash") or "")
            if not file_hash:
                by_source.setdefault(source_key, []).append((doc, 1))
                continue
            key = (source_key, file_hash)
            if key in seen:
                entry_index = seen[key]
                representative, count = by_source[source_key][entry_index]
                by_source[source_key][entry_index] = (representative, count + 1)
                continue
            by_source.setdefault(source_key, []).append((doc, 1))
            seen[key] = len(by_source[source_key]) - 1
        return by_source

    def _append_log_line(self, message: str) -> None:
        if not self.log_path.exists():
            self.log_path.write_text("# 지식폴더 위키 로그\n\n", encoding="utf-8")
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(f"- [{now_iso()}] {message}\n")

    # ---------------------------------------------------------------- search

    def search(self, query: str, limit: int = 8) -> dict[str, Any]:
        normalized = nfc(query).strip()
        safe_limit = max(1, min(limit, 50))
        if not normalized:
            return {"query": query, "items": [], "mode": "empty"}
        items: list[dict[str, Any]] = []
        mode = "like"
        if getattr(self.db, "fts5_available", False):
            match_expr = self._fts_match_expression(normalized)
            if match_expr:
                mode = "fts5"
                try:
                    rows = self.db.fetch_all(
                        """
                        SELECT doc_id,
                               snippet(knowledge_fts, 2, '', '', '…', 24) AS body_snippet,
                               bm25(knowledge_fts) AS rank
                        FROM knowledge_fts
                        WHERE knowledge_fts MATCH ?
                        ORDER BY rank
                        LIMIT ?
                        """,
                        (match_expr, safe_limit),
                    )
                except Exception:  # noqa: BLE001 - 질의 구문 오류 시 LIKE 폴백
                    rows = []
                    mode = "like"
                for row in rows:
                    doc = self.db.fetch_one(
                        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (row["doc_id"],)
                    )
                    if doc is None or str(doc.get("status") or "active") == "missing":
                        continue  # §5.5: FTS 행은 삭제되지만 이중 방어
                    items.append(self._search_item(doc, row.get("body_snippet"), -float(row["rank"] or 0.0)))
        if not items:
            items = self._like_search(normalized, safe_limit)
            if mode != "fts5":
                mode = "like"
        return {"query": query, "items": items[:safe_limit], "mode": mode}

    def _fts_match_expression(self, normalized_query: str) -> str | None:
        terms = [term for term in _tokenize(normalized_query) if len(term) >= 3]
        compact = re.sub(r"\s+", "", normalized_query.lower())
        if not terms and len(compact) >= 3 and TOKEN_RE.fullmatch(compact):
            terms = [compact]
        if not terms:
            return None
        return " OR ".join('"' + term.replace('"', '""') + '"' for term in terms[:8])

    def _like_search(self, normalized_query: str, limit: int) -> list[dict[str, Any]]:
        needle = normalized_query.lower()
        rows = self.db.fetch_all(
            """
            SELECT * FROM knowledge_wiki_docs
            WHERE status != 'missing' AND (norm_title LIKE ? OR norm_body LIKE ?)
            ORDER BY (norm_title LIKE ?) DESC, updated_at DESC
            LIMIT ?
            """,
            (f"%{needle}%", f"%{needle}%", f"%{needle}%", limit),
        )
        items = []
        for row in rows:
            snippet = self._context_snippet(str(row.get("norm_body") or ""), needle)
            items.append(self._search_item(row, snippet, 1.0))
        return items

    def _context_snippet(self, body: str, needle: str, radius: int = 120) -> str:
        position = body.find(needle)
        if position < 0:
            return body[:radius * 2].strip()
        start = max(0, position - radius)
        end = min(len(body), position + len(needle) + radius)
        return ("…" if start > 0 else "") + body[start:end].strip() + ("…" if end < len(body) else "")

    def _search_item(self, doc: dict[str, Any], snippet: Any, score: float) -> dict[str, Any]:
        return {
            "doc_id": doc["id"],
            "document_id": doc.get("document_id"),
            "doc_uid": str(doc.get("doc_uid") or ""),
            "title": doc["title"],
            "source_path": doc["source_path"],
            "relative_path": doc.get("relative_path"),
            "snippet": re.sub(r"\s+", " ", str(snippet or "")).strip()[:SNIPPET_MAX_CHARS],
            "score": round(float(score), 4),
            "quality_score": doc.get("quality_score"),
            "warnings": self._json_list(doc.get("warnings_json")),
            "card_path": doc.get("card_path"),
            "slug": doc.get("slug"),
        }

    # -------------------------------------------------------------- retrieve

    def retrieve(self, *, query: str, session_id: str | None = None, limit: int = 5) -> dict[str, Any]:
        """채팅/구 API 호환용: search 결과를 document/text 항목 형태로 감싼다."""
        result = self.search(query, limit=max(limit * 2, limit))
        linked_paths = self._session_linked_paths(session_id)
        items: list[dict[str, Any]] = []
        for hit in result["items"]:
            boost = 1000.0 if str(hit.get("source_path")) in linked_paths else 0.0
            text = self._matching_excerpt(hit, query) or hit.get("snippet") or ""
            items.append(
                {
                    "document": {
                        "id": hit.get("document_id"),
                        "title": hit["title"],
                        "file_path": hit["source_path"],
                        "quality_score": hit.get("quality_score"),
                    },
                    "doc_id": hit["doc_id"],
                    "doc_uid": str(hit.get("doc_uid") or ""),
                    "title": hit["title"],
                    "file_path": hit["source_path"],
                    "snippet": hit.get("snippet"),
                    "text": text,
                    "evidence_type": "wiki",
                    "score": float(hit.get("score") or 0.0) + boost,
                    "session_context_boost": boost,
                    "quality_score": hit.get("quality_score"),
                    "quality_warnings": hit.get("warnings") or [],
                    "card_path": hit.get("card_path"),
                    "relations": [],
                }
            )
        items.sort(key=lambda item: item["score"], reverse=True)
        items = items[: max(1, limit)]
        return {
            "query": query,
            "items": items,
            "mode": result.get("mode"),
            "retrieval_summary": self._retrieval_summary(items),
        }

    def _matching_excerpt(self, hit: dict[str, Any], query: str) -> str | None:
        extracted = self.db.fetch_one(
            "SELECT extracted_path FROM knowledge_wiki_docs WHERE id = ?",
            (hit["doc_id"],),
        )
        if not extracted or not extracted.get("extracted_path"):
            return None
        path = Path(str(extracted["extracted_path"]))
        if not path.exists():
            return None
        try:
            body = nfc(path.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            return None
        body = _strip_front_matter(body)
        lowered = body.lower()
        terms = [term for term in _tokenize(query) if len(term) >= 2]
        for term in terms:
            position = lowered.find(term)
            if position >= 0:
                start = max(0, position - 150)
                end = min(len(body), position + 350)
                excerpt = re.sub(r"\s+", " ", body[start:end]).strip()
                return excerpt[:SNIPPET_MAX_CHARS]
        return None

    def _session_linked_paths(self, session_id: str | None) -> set[str]:
        if not session_id:
            return set()
        rows = self.db.fetch_all(
            "SELECT file_path FROM work_session_file_links WHERE session_id = ?",
            (session_id,),
        )
        return {str(row["file_path"]) for row in rows}

    def _retrieval_summary(self, items: list[dict[str, Any]]) -> dict[str, int]:
        return {
            "source_count": len({item["file_path"] for item in items}),
            "hit_count": len(items),
            "low_quality_count": sum(
                1 for item in items if (item.get("quality_score") or 0) < 0.5 or item.get("quality_warnings")
            ),
        }

    # ------------------------------------------------------------------- ask

    def ask(
        self,
        *,
        query: str,
        session_id: str | None = None,
        limit: int = 5,
        llm: Callable[[list[dict[str, Any]]], str | None] | None = None,
    ) -> dict[str, Any]:
        retrieval = self.retrieve(query=query, session_id=session_id, limit=limit)
        items = retrieval["items"]
        citations = [
            {
                "doc_id": item["doc_id"],
                "document_id": item["document"].get("id"),
                "doc_uid": str(item.get("doc_uid") or ""),
                "title": item["title"],
                "source_path": item["file_path"],
                "file_path": item["file_path"],
                "snippet": item.get("text") or item.get("snippet") or "",
                "quality_score": item.get("quality_score"),
                "quality_warnings": item.get("quality_warnings") or [],
                "card_path": item.get("card_path"),
                "evidence_type": item.get("evidence_type") or "wiki",
                "relations": [],
            }
            for item in items
        ]
        answer_mode = "extractive"
        if not items:
            answer = "지식폴더에서 관련 근거를 찾지 못했습니다. 지식폴더 스캔/색인 상태를 확인해 주세요."
        else:
            lines = [f"'{query}' 관련 지식폴더 근거입니다."]
            for index, item in enumerate(items, start=1):
                excerpt = re.sub(r"\s+", " ", str(item.get("text") or item.get("snippet") or "")).strip()
                lines.append(f"{index}. {item['title']} — {excerpt[:300]}")
                lines.append(f"   (원본: {item['file_path']})")
            answer = "\n".join(lines)
        if llm is not None and items:
            evidence_lines = []
            for index, item in enumerate(items, start=1):
                excerpt = re.sub(r"\s+", " ", str(item.get("text") or item.get("snippet") or "")).strip()
                evidence_lines.append(f"{index}. {item['title']} (원본: {item['file_path']})")
                evidence_lines.append(f"   발췌: {excerpt[:SNIPPET_MAX_CHARS]}")
            messages = [
                {
                    "role": "system",
                    "text": (
                        "[지식폴더 근거]\n"
                        "아래 로컬 문서 근거만 사용해 한국어로 간결하게 답하세요.\n"
                        "각 주장 뒤에 (출처: 문서 제목) 형식의 인용을 붙이고, "
                        "근거가 없으면 모른다고 답하세요.\n\n" + "\n".join(evidence_lines)
                    ),
                },
                {"role": "user", "text": query},
            ]
            try:
                generated = llm(messages)
            except Exception:  # noqa: BLE001 - LLM 실패 시 결정론 답변 유지
                generated = None
            if generated and str(generated).strip():
                answer = str(generated).strip()
                answer_mode = "llm"
        return {
            "query": query,
            "answer": answer,
            "answer_mode": answer_mode,
            "citations": citations,
            "items": items,
            "retrieval_summary": retrieval["retrieval_summary"],
        }

    # ---------------------------------------------------------------- enrich

    def enrich(
        self,
        *,
        source_id: str | None = None,
        llm: Callable[[list[dict[str, Any]]], str | None],
        should_cancel: Callable[[], bool] | None = None,
        progress_cb: Callable[[int, int], None] | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        # §5.4: 3회 실패(enrich_skip=1) 문서는 대상에서 제외해
        # 실패 문서가 매 실행을 선점하며 신규 보강을 굶기지 않게 한다.
        # P2a: 대상 = enriched=0 OR summary_stale=1, 우선순위 summary_stale desc,
        # 실행당 상한 기본 20건(사용자 승인값·설정 가능) — 초과분은 다음 실행으로 이월.
        safe_limit = max(1, int(limit)) if limit else ENRICH_DEFAULT_LIMIT
        # §5.5: missing 문서는 보강 대상에서 제외한다.
        target_where = (
            "(enriched = 0 OR summary_stale = 1) AND enrich_skip = 0 AND status != 'missing'"
        )
        if source_id:
            docs = self.db.fetch_all(
                "SELECT * FROM knowledge_wiki_docs "
                f"WHERE {target_where} AND source_id = ? "
                "ORDER BY summary_stale DESC, updated_at ASC LIMIT ?",
                (source_id, safe_limit),
            )
        else:
            docs = self.db.fetch_all(
                "SELECT * FROM knowledge_wiki_docs "
                f"WHERE {target_where} ORDER BY summary_stale DESC, updated_at ASC LIMIT ?",
                (safe_limit,),
            )
        enriched_count = 0
        failed_count = 0
        canceled = False
        for index, doc in enumerate(docs):
            if should_cancel is not None and should_cancel():
                canceled = True
                break
            try:
                card_text = Path(str(doc["card_path"])).read_text(encoding="utf-8", errors="replace")
            except OSError:
                card_text = doc.get("norm_body") or ""
            messages = [
                {
                    "role": "system",
                    "text": (
                        "당신은 공공기관 문서 사서입니다. 아래 문서 카드를 읽고 "
                        'JSON 하나만 출력하세요: {"summary": "3~5문장 한국어 요약", '
                        '"topics": ["주제1", "주제2"]} (주제는 1~3개).'
                    ),
                },
                {"role": "user", "text": str(card_text)[:6000]},
            ]
            try:
                raw = llm(messages)
                parsed = self._parse_enrichment(raw)
            except Exception:  # noqa: BLE001
                parsed = None
            if not parsed:
                failed_count += 1
                # §5.4 실패 백오프: 실패 카운트 누적, 상한 도달 시 enrich_skip 마킹
                fail_count = int(doc.get("enrich_fail_count") or 0) + 1
                self.db.execute(
                    """
                    UPDATE knowledge_wiki_docs
                    SET enrich_fail_count = ?, enrich_skip = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        fail_count,
                        1 if fail_count >= ENRICH_FAIL_LIMIT else 0,
                        now_iso(),
                        doc["id"],
                    ),
                )
                continue
            summary, topics = parsed
            refreshed_card = self._rewrite_enriched_card(doc, summary, topics)
            if refreshed_card is None:
                # 카드 쓰기 실패 — card_dirty로 다음 잡 재시도, FTS는 근사 내용으로.
                refreshed_card = f"{card_text}\n## LLM 요약\n{summary}\n"
            # enriched 플래그와 FTS 반영을 한 트랜잭션으로 — 중간 크래시 시
            # 'enriched=1인데 FTS 누락' 상태가 남지 않게 한다.
            with self.db.transaction():
                self.db.execute(
                    """
                    UPDATE knowledge_wiki_docs
                    SET summary = ?, topics_json = ?, enriched = 1, summary_stale = 0,
                        enrich_fail_count = 0, enrich_skip = 0, updated_at = ?
                    WHERE id = ?
                    """,
                    (summary, json.dumps(topics, ensure_ascii=False), now_iso(), doc["id"]),
                )
                self._upsert_fts(
                    doc["id"],
                    str(doc.get("title") or ""),
                    str(doc.get("norm_body") or ""),
                    nfc(refreshed_card),
                )
            enriched_count += 1
            if progress_cb is not None:
                progress_cb(index + 1, len(docs))
        self._write_topic_pages()
        self.rebuild_index()
        status = "canceled" if canceled else ("completed" if failed_count == 0 else "partial")
        # P2a: 상한 초과 이월분(다음 실행 대상) 집계 — 대시보드 "요약 대기 N건" 근거.
        if source_id:
            remaining_row = self.db.fetch_one(
                "SELECT COUNT(*) AS count FROM knowledge_wiki_docs "
                f"WHERE {target_where} AND source_id = ?",
                (source_id,),
            )
        else:
            remaining_row = self.db.fetch_one(
                f"SELECT COUNT(*) AS count FROM knowledge_wiki_docs WHERE {target_where}"
            )
        remaining_count = int((remaining_row or {}).get("count") or 0)
        self._append_log_line(
            f"enrich status={status} enriched={enriched_count} failed={failed_count} "
            f"total={len(docs)} limit={safe_limit} remaining={remaining_count}"
        )
        return {
            "status": status,
            "total_count": len(docs),
            "enriched_count": enriched_count,
            "failed_count": failed_count,
            "limit": safe_limit,
            "remaining_count": remaining_count,
        }

    def _parse_enrichment(self, raw: Any) -> tuple[str, list[str]] | None:
        if not raw:
            return None
        text = str(raw).strip()
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        try:
            payload = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
        if not isinstance(payload, dict):
            return None
        summary = re.sub(r"\s+", " ", str(payload.get("summary") or "")).strip()
        topics_value = payload.get("topics")
        topics = [
            nfc(str(topic)).strip()
            for topic in (topics_value if isinstance(topics_value, list) else [])
            if str(topic).strip()
        ][:3]
        if not summary:
            return None
        return summary, topics

    def _rewrite_enriched_card(
        self, doc: dict[str, Any], summary: str, topics: list[str]
    ) -> str | None:
        """§5.4: regex 부분수정 대신 'DB 기준 전체 재투영 + 사용자 메모 이어붙임'.

        기계 영역을 DB(행 + 보존된 sections/tables)에서 결정적으로 재생성하고,
        사용자 메모 구역(마커 이하)은 추출해 재삽입한다. 재작성 전 기계 영역이
        수동 편집돼 있으면(card_hash 불일치) 백업을 남긴다(§5.7).
        반환: 새 카드 전문(FTS 재색인용). 쓰기 실패 시 None + card_dirty=1.
        """
        card_path = Path(str(doc["card_path"]))
        old_text: str | None = None
        try:
            if card_path.exists():
                old_text = card_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            old_text = None
        notes = split_user_notes(old_text)[1] if old_text else None
        self._backup_card_if_edited(doc, old_text)
        machine = self._project_card_from_db(doc, summary=summary, topics=topics, enriched=True)
        content = compose_card_with_notes(machine, notes)
        try:
            card_path.write_text(content, encoding="utf-8")
        except OSError:
            self.db.execute(
                "UPDATE knowledge_wiki_docs SET card_dirty = 1, updated_at = ? WHERE id = ?",
                (now_iso(), doc["id"]),
            )
            return None
        self._store_card_hash(str(doc["id"]), content)
        return content

    def _all_topics(self) -> dict[str, list[dict[str, Any]]]:
        topics: dict[str, list[dict[str, Any]]] = {}
        # §5.5: missing 문서는 주제 페이지·인덱스·그래프에서 제외된다.
        for doc in self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE status != ?", ("missing",)
        ):
            for topic in self._json_list(doc.get("topics_json")):
                topics.setdefault(topic, []).append(doc)
        return topics

    def _write_topic_pages(self) -> None:
        work_pages = self.list_work_pages()
        for topic, docs in self._all_topics().items():
            topic_slug = wiki_slugify(topic, topic)
            doc_slugs = {str(doc.get("slug") or "") for doc in docs}
            backlinks = [
                page
                for page in work_pages
                if doc_slugs & set(page.get("cited_docs") or [])
            ]
            lines = [
                self._front_matter(
                    {
                        "topic": topic,
                        "slug": topic_slug,
                        "doc_count": len(docs),
                        "work_count": len(backlinks),
                        "updated_at": now_iso(),
                    }
                ),
                f"# {topic}",
                "",
                "## 관련 문서",
            ]
            for doc in docs:
                lines.append(f"- [{doc['title']}](../docs/{doc['slug']}.md) · 원본: {doc['source_path']}")
            if backlinks:
                lines.append("")
                lines.append("## 관련 업무 기록")
                for page in backlinks:
                    stamp = str(page.get("updated_at") or "")[:10]
                    lines.append(f"- [{page['title']}](../{page['path']}) — 갱신 {stamp or '미상'}")
            (self.topics_dir / f"{topic_slug}.md").write_text(
                nfc("\n".join(lines).strip() + "\n"), encoding="utf-8"
            )

    # ------------------------------------------------------------ work pages

    def write_work_page(
        self,
        *,
        session: dict[str, Any],
        messages: list[dict[str, Any]],
        file_links: list[dict[str, Any]],
        summary: str,
        schedule: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """업무대화 세션을 위키 업무 기록 페이지(work/<slug>.md)로 기록한다."""
        session_id = str(session.get("id") or "")
        title = nfc(str(session.get("title") or "업무 세션")).strip() or "업무 세션"
        slug = wiki_slugify(title, session_id.replace("-", "") or title)
        cited_docs = self._cited_wiki_docs(messages, file_links)
        decisions = self._decision_lines(messages)
        timestamp = now_iso()

        # 같은 세션의 예전 페이지(제목 변경 등으로 slug가 달라진 경우)를 정리한다.
        for stale in self.list_work_pages():
            if stale.get("session_id") == session_id and stale.get("slug") != slug:
                (self.work_dir / f"{stale['slug']}.md").unlink(missing_ok=True)

        front = self._front_matter(
            {
                "slug": slug,
                "session_id": session_id,
                "title": title,
                "created_at": session.get("created_at") or timestamp,
                "updated_at": timestamp,
                "schedule_id": session.get("schedule_id") or "",
                "cited_docs": [str(doc.get("slug") or "") for doc in cited_docs],
            }
        )
        lines: list[str] = [front, f"# {title}", ""]
        lines.append("## 세션 요약")
        lines.append(summary.strip() or "(세션 요약이 없습니다.)")
        lines.append("")
        if schedule:
            lines.append("## 연결 일정")
            lines.append(
                f"- {schedule.get('title')} ({schedule.get('starts_at')} ~ {schedule.get('ends_at')})"
            )
            lines.append("")
        if decisions:
            lines.append("## 주요 결정/후속 액션")
            lines.extend(f"- {decision}" for decision in decisions)
            lines.append("")
        lines.append("## 인용된 지식 문서")
        if cited_docs:
            for doc in cited_docs:
                lines.append(
                    f"- [{doc['title']}](../docs/{doc['slug']}.md) · 원본: {doc['source_path']}"
                )
        else:
            lines.append("- (이 세션에서 인용된 지식 문서가 없습니다.)")
        lines.append("")
        lines.append("## 연결 파일")
        if file_links:
            for link in file_links:
                label = str(link.get("label") or "").strip() or Path(str(link["file_path"])).name
                lines.append(f"- {label}: {link['file_path']}")
        else:
            lines.append("- (연결된 파일이 없습니다.)")

        page_path = self.work_dir / f"{slug}.md"
        page_path.write_text(nfc("\n".join(lines).strip() + "\n"), encoding="utf-8")
        try:
            self._write_topic_pages()
            self.rebuild_index()
        except OSError:
            pass
        self._append_log_line(
            f"work-page session={session_id} slug={slug} cited={len(cited_docs)}"
        )
        return {
            "slug": slug,
            "session_id": session_id,
            "title": title,
            "path": str(page_path),
            "relative_path": f"work/{slug}.md",
            "cited_doc_slugs": [str(doc.get("slug") or "") for doc in cited_docs],
            "updated_at": timestamp,
        }

    def list_work_pages(self) -> list[dict[str, Any]]:
        pages: list[dict[str, Any]] = []
        for path in sorted(self.work_dir.glob("*.md")):
            meta = self._parse_front_matter(path)
            slug = str(meta.get("slug") or path.stem)
            cited = meta.get("cited_docs")
            pages.append(
                {
                    "slug": slug,
                    "title": str(meta.get("title") or path.stem),
                    "session_id": str(meta.get("session_id") or ""),
                    "schedule_id": str(meta.get("schedule_id") or "") or None,
                    "created_at": str(meta.get("created_at") or ""),
                    "updated_at": str(meta.get("updated_at") or ""),
                    "cited_docs": cited if isinstance(cited, list) else [],
                    "path": f"work/{path.stem}.md",
                }
            )
        pages.sort(key=lambda page: page.get("updated_at") or "", reverse=True)
        return pages

    def list_work_area_pages(self) -> list[dict[str, Any]]:
        """T-01 업무 허브(work-areas/<slug>.md) 목록."""
        pages: list[dict[str, Any]] = []
        for path in sorted(self.work_areas_dir.glob("*.md")):
            meta = self._parse_front_matter(path)
            slug = str(meta.get("slug") or path.stem)
            try:
                doc_count = int(str(meta.get("doc_count") or 0))
            except ValueError:
                doc_count = 0
            pages.append(
                {
                    "slug": slug,
                    "title": str(meta.get("work_area") or meta.get("title") or path.stem),
                    "doc_count": doc_count,
                    "updated_at": str(meta.get("updated_at") or ""),
                    "path": f"work-areas/{path.stem}.md",
                }
            )
        pages.sort(key=lambda page: (-page["doc_count"], page["title"]))
        return pages

    def _parse_front_matter(self, path: Path) -> dict[str, Any]:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return {}
        if not text.startswith("---"):
            return {}
        closing = text.find("\n---", 3)
        if closing < 0:
            return {}
        fields: dict[str, Any] = {}
        for line in text[3:closing].splitlines():
            if ":" not in line:
                continue
            key, _, raw_value = line.partition(":")
            value = raw_value.strip()
            if value.startswith("["):
                try:
                    fields[key.strip()] = json.loads(value)
                    continue
                except json.JSONDecodeError:
                    pass
            fields[key.strip()] = value
        return fields

    def _cited_wiki_docs(
        self,
        messages: list[dict[str, Any]],
        file_links: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """세션 대화의 [지식폴더 근거]/출처 표기와 연결 파일에서 인용 문서를 추정한다."""
        # §5.5: missing 문서는 업무 기록 인용 후보에서 제외한다.
        docs = self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE status != ?", ("missing",)
        )
        if not docs:
            return []
        corpus = nfc("\n".join(str(message.get("text") or "") for message in messages))
        linked_paths = {nfc(str(link.get("file_path") or "")) for link in file_links}
        cited: list[dict[str, Any]] = []
        for doc in docs:
            title = nfc(str(doc.get("title") or "")).strip()
            source_path = nfc(str(doc.get("source_path") or ""))
            file_name = Path(source_path).name if source_path else ""
            if (
                (source_path and source_path in linked_paths)
                or (len(title) >= 2 and title in corpus)
                or (source_path and source_path in corpus)
                or (file_name and file_name in corpus)
            ):
                cited.append(doc)
        cited.sort(key=lambda doc: str(doc.get("title") or ""))
        return cited

    def _decision_lines(self, messages: list[dict[str, Any]], limit: int = 8) -> list[str]:
        keywords = ("결정", "후속", "조치", "액션", "기한", "다음 단계")
        lines: list[str] = []
        for message in messages:
            for raw_line in str(message.get("text") or "").splitlines():
                cleaned = re.sub(r"^[\s\-\*\d\.\)]+", "", raw_line).strip()
                if len(cleaned) < 4:
                    continue
                if any(keyword in cleaned for keyword in keywords):
                    normalized = re.sub(r"\s+", " ", cleaned)[:200]
                    if normalized not in lines:
                        lines.append(normalized)
                if len(lines) >= limit:
                    return lines
        return lines

    # ------------------------------------------------------------------ lint

    def lint(self, *, fix: bool = True, deep: bool = False) -> dict[str, Any]:
        """위키 정합성 점검.

        기본(quick)은 재해시 없이 원본 존재·카드 존재·인덱스 누락만 확인한다.
        deep=True일 때만 전 문서를 재해시해 size+mtime 보존 변경(silent change)을
        대조한다 — 대용량 폴더에서 비용이 크므로 명시적으로 요청할 때만 수행.
        """
        docs = self.db.fetch_all("SELECT * FROM knowledge_wiki_docs")
        orphans: list[dict[str, Any]] = []
        stale: list[dict[str, Any]] = []
        missing_cards: list[dict[str, Any]] = []
        missing_docs: list[dict[str, Any]] = []
        index_text = self.index_path.read_text(encoding="utf-8", errors="replace") if self.index_path.exists() else ""
        missing_index: list[dict[str, Any]] = []
        for doc in docs:
            source_path = Path(str(doc["source_path"]))
            entry = {"doc_id": doc["id"], "title": doc["title"], "source_path": doc["source_path"]}
            if str(doc.get("status") or "active") == "missing":
                # §5.5: 유예 보관 문서는 원본 부재가 정상 상태 — orphan과 구분해
                # 보고만 하고 fix(하드삭제) 대상에서 제외한다(30일 정리는 색인 잡 몫).
                missing_docs.append({**entry, "missing_since": doc.get("missing_since")})
                continue
            if not source_path.exists():
                orphans.append(entry)
                continue
            if deep and doc.get("file_hash"):
                current_hash = self._sha256(source_path)
                if current_hash and current_hash != doc["file_hash"]:
                    stale.append(entry)
            if not Path(str(doc["card_path"])).exists():
                missing_cards.append(entry)
            if f"docs/{doc['slug']}.md" not in index_text:
                missing_index.append(entry)
        fixed = {"orphans_removed": 0, "index_rebuilt": False}
        if fix:
            for orphan in orphans:
                row = self.db.fetch_one("SELECT * FROM knowledge_wiki_docs WHERE id = ?", (orphan["doc_id"],))
                if row is not None:
                    self._delete_wiki_doc(row)
                    fixed["orphans_removed"] += 1
            if orphans or missing_index:
                self.rebuild_index()
                fixed["index_rebuilt"] = True
        report = {
            "mode": "deep" if deep else "quick",
            "checked_count": len(docs),
            "orphans": orphans,
            "stale": stale,
            "missing_cards": missing_cards,
            "missing_docs": missing_docs,
            "missing_index": missing_index,
            "fixed": fixed,
        }
        self._append_log_line(
            f"lint mode={'deep' if deep else 'quick'} checked={len(docs)} "
            f"orphans={len(orphans)} stale={len(stale)} missing_docs={len(missing_docs)} "
            f"missing_index={len(missing_index)}"
        )
        return report

    def _sha256(self, path: Path) -> str:
        try:
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
            return digest.hexdigest()
        except OSError:
            return ""

    # ------------------------------------------------------- P3 §6 verify 잡

    def verify(self, *, deep: bool = False, job_id: str | None = None) -> dict[str, Any]:
        """무결성 점검(verify) 잡 — lint 확장 (§6, 검사·치유 표 그대로).

        자동 치유는 파생물 재생성·고아 삭제만(V1 원본부재 purge 수준(soft delete 경유),
        V2 카드 재투영, V4 고아 산출물 GC, V5 FTS 재동기화, V6 고아 큐, V9 0건 topic,
        V10 card_dirty 재patch). 파싱 비용이 드는 V3(추출본 실종)·V7(미색인)·V11(silent
        change)과 분류 V8(무태그)은 보고 + 원클릭 안내만 한다. quick 모드는 재해시 금지 —
        V11 전량 재해시는 deep=True일 때만 수행한다(§8: quick/deep 분리 계약 준수).
        신규 상태 5종(missing/tag_locked/card_dirty/summary_stale/enrich_skip)의
        불변식 검사를 포함한다. 산출: knowledge_verify_reports 1행 + JSONL 상세 +
        실행기록 한국어 1건(0건이어도 기록).
        """
        started_perf = perf_counter()
        report_id = str(uuid4())
        ran_at = now_iso()
        mode = "deep" if deep else "quick"
        log_path = self._verify_log_path(job_id or report_id)
        detail_lines: list[dict[str, Any]] = []
        checks: list[dict[str, Any]] = []
        disk_reclaimed_bytes = 0
        healed_anything = False

        def add_check(
            code: str,
            label_ko: str,
            count: int,
            healed: int,
            action_hint: str,
            items: list[Any] | None = None,
        ) -> None:
            checks.append(
                {
                    "code": code,
                    "label_ko": label_ko,
                    "count": int(count),
                    "healed": int(healed),
                    "action_hint": action_hint,
                }
            )
            detail_lines.append(
                {
                    "timestamp": now_iso(),
                    "code": code,
                    "label_ko": label_ko,
                    "count": int(count),
                    "healed": int(healed),
                    "action_hint": action_hint,
                    "items": (items or [])[:50],
                }
            )

        source_ids = [
            str(row["id"])
            for row in self.db.fetch_all(
                "SELECT id FROM knowledge_sources WHERE status != ? ORDER BY created_at ASC",
                ("deleted",),
            )
        ]

        def active_docs() -> list[dict[str, Any]]:
            return self.db.fetch_all(
                "SELECT * FROM knowledge_wiki_docs WHERE status != ?", ("missing",)
            )

        # V1 원본 부재 행 → 자동: deleted 마킹 + purge 수준(소프트 삭제 경유 — §5.5 계약 정합)
        orphan_docs = [
            doc for doc in active_docs() if not Path(str(doc.get("source_path") or "")).exists()
        ]
        orphan_healed = 0
        if orphan_docs:
            healed_anything = True
            touched_sources: set[str] = set()
            for doc in orphan_docs:
                self.db.execute(
                    "UPDATE knowledge_source_files SET status = ?, updated_at = ? WHERE id = ?",
                    ("deleted", now_iso(), doc["source_file_id"]),
                )
                touched_sources.add(str(doc["source_id"]))
            for source_id in sorted(touched_sources):
                purged, dirty_areas = self._purge_deleted_source_documents(source_id)
                orphan_healed += purged
                if dirty_areas and self.hub_refresher is not None:
                    try:
                        self.hub_refresher(source_id, sorted(dirty_areas))
                    except Exception:  # noqa: BLE001 - 허브 재작성 실패가 점검을 막으면 안 된다
                        pass
        add_check(
            "orphan",
            "원본 부재 카드",
            len(orphan_docs),
            orphan_healed,
            "" if not orphan_docs else f"자동 수리: 소프트 삭제 전환(유예 보관 {self.missing_retention_days}일)",
            [str(doc.get("source_path") or "") for doc in orphan_docs],
        )

        # V2 카드 실종 → 자동: DB에서 카드 재투영(파싱 0회, _project_card_from_db 재사용)
        docs = active_docs()
        missing_card_docs = [
            doc
            for doc in docs
            if str(doc.get("card_path") or "") and not Path(str(doc["card_path"])).exists()
        ]
        card_healed = 0
        for doc in missing_card_docs:
            machine = self._project_card_from_db(doc)
            content = compose_card_with_notes(machine, None)
            try:
                Path(str(doc["card_path"])).write_text(content, encoding="utf-8")
            except OSError:
                continue
            self._store_card_hash(str(doc["id"]), content)
            self._upsert_fts(
                doc["id"],
                str(doc.get("title") or ""),
                str(doc.get("norm_body") or ""),
                content,
            )
            card_healed += 1
            healed_anything = True
        add_check(
            "missing_card",
            "카드 실종",
            len(missing_card_docs),
            card_healed,
            "" if not missing_card_docs else "자동 수리: DB에서 카드 재투영(파싱 0회)",
            [str(doc.get("card_path") or "") for doc in missing_card_docs],
        )

        # V3 extracted 실종 → 보고만: kordoc 재파싱 견적(건수·바이트) + 원클릭 안내
        docs = active_docs()
        missing_extracted_docs = [
            doc
            for doc in docs
            if str(doc.get("extracted_path") or "")
            and not Path(str(doc["extracted_path"])).exists()
        ]
        estimate_bytes = 0
        seen_paths: set[str] = set()
        for doc in missing_extracted_docs:
            key = str(doc.get("extracted_path") or "")
            if key in seen_paths:
                continue  # 동일 해시 사본은 추출본을 공유한다 — 견적 중복 방지
            seen_paths.add(key)
            source_file = self.db.fetch_one(
                "SELECT size_bytes FROM knowledge_source_files WHERE id = ?",
                (doc.get("source_file_id"),),
            )
            estimate_bytes += int((source_file or {}).get("size_bytes") or 0)
        add_check(
            "missing_extracted",
            "추출본 실종",
            len(missing_extracted_docs),
            0,
            ""
            if not missing_extracted_docs
            else (
                f"재파싱 견적: {len(seen_paths)}건 · 약 {estimate_bytes:,}바이트 — "
                "강제 재색인을 실행하면 복구됩니다"
            ),
            [str(doc.get("extracted_path") or "") for doc in missing_extracted_docs],
        )

        # V4 고아 extracted/knowledge_raw → 자동 삭제(P0 GC 재사용, <id>.md형 제외) + 회수량 보고
        # run_job의 GC 가드 준용: 색인 잡이 병행 중이면(라우트 409를 우회한 직접 호출·
        # 백그라운드 레이스) 그 잡이 커밋 직전에 써둔 파일을 고아로 오판할 수 있어 건너뛴다.
        gc_extracted = 0
        gc_raw = 0
        ingestion_active = (
            self.db.fetch_one(
                "SELECT id FROM knowledge_ingestion_jobs "
                "WHERE status IN ('queued', 'running') LIMIT 1"
            )
            is not None
        )
        for source_id in source_ids if not ingestion_active else []:
            gc_counts = self._collect_orphan_artifacts(source_id)
            gc_extracted += int(gc_counts.get("extracted_removed") or 0)
            gc_raw += int(gc_counts.get("raw_removed") or 0)
            disk_reclaimed_bytes += int(gc_counts.get("reclaimed_bytes") or 0)
        if gc_extracted or gc_raw:
            healed_anything = True
        add_check(
            "orphan_artifact",
            "고아 산출물(extracted/raw)",
            gc_extracted + gc_raw,
            gc_extracted + gc_raw,
            "" if not (gc_extracted or gc_raw) else "자동 수리: 고아 파일 삭제(회수량 보고)",
        )

        # V5 FTS↔doc 불일치 → 자동 재동기화(누락 재삽입 + 잔존 행 삭제)
        fts_drift_count = 0
        fts_healed = 0
        if getattr(self.db, "fts5_available", False):
            docs = active_docs()
            active_ids = {str(doc["id"]) for doc in docs}
            fts_ids = {
                str(row["doc_id"])
                for row in self.db.fetch_all("SELECT doc_id FROM knowledge_fts")
            }
            stray_ids = sorted(fts_ids - active_ids)
            absent_ids = active_ids - fts_ids
            for doc_id in stray_ids:
                self.db.execute("DELETE FROM knowledge_fts WHERE doc_id = ?", (doc_id,))
            for doc in docs:
                if str(doc["id"]) not in absent_ids:
                    continue
                card_text: str | None = None
                try:
                    card_file = Path(str(doc.get("card_path") or ""))
                    if str(doc.get("card_path") or "") and card_file.exists():
                        card_text = card_file.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    card_text = None
                if card_text is None:
                    card_text = compose_card_with_notes(self._project_card_from_db(doc), None)
                self._upsert_fts(
                    doc["id"],
                    str(doc.get("title") or ""),
                    str(doc.get("norm_body") or ""),
                    nfc(card_text),
                )
            fts_drift_count = len(stray_ids) + len(absent_ids)
            fts_healed = fts_drift_count
            if fts_drift_count:
                healed_anything = True
        add_check(
            "fts_drift",
            "FTS 검색 색인 불일치",
            fts_drift_count,
            fts_healed,
            "" if not fts_drift_count else "자동 수리: FTS 재동기화",
        )

        # V6 고아 pending/suspended 큐 → 자동 삭제
        orphan_queue_rows = self.db.fetch_all(
            """
            SELECT q.id FROM knowledge_tag_queue q
            LEFT JOIN knowledge_wiki_docs w ON w.id = q.wiki_doc_id
            WHERE q.status IN (?, ?) AND w.id IS NULL
            """,
            ("pending", "suspended"),
        )
        for row in orphan_queue_rows:
            self.db.execute("DELETE FROM knowledge_tag_queue WHERE id = ?", (row["id"],))
        if orphan_queue_rows:
            healed_anything = True
        add_check(
            "orphan_queue",
            "고아 분류 대기 항목",
            len(orphan_queue_rows),
            len(orphan_queue_rows),
            "" if not orphan_queue_rows else "자동 수리: 고아 큐 항목 삭제",
        )

        # V7 stale 해시(스캔만 하고 색인 안 함) → 보고 + "색인 시작" 안내
        stale_index_count = 0
        for source_id in source_ids:
            pending, _skipped = self._source_files_for_ingestion(source_id)
            stale_index_count += len(pending)
        add_check(
            "stale_index",
            "미색인 변경분",
            stale_index_count,
            0,
            "" if not stale_index_count else "색인 시작을 실행하면 반영됩니다",
        )

        # V8 무태그 문서(큐에도 없음) → 보고 + "분류 적용" 안내 (참고서고·locked 제외)
        untagged_count = 0
        untagged_items: list[str] = []
        pending_queue_ids = {
            str(row["wiki_doc_id"])
            for row in self.db.fetch_all(
                "SELECT wiki_doc_id FROM knowledge_tag_queue WHERE status = ?", ("pending",)
            )
        }
        docs = active_docs()
        for source_id in source_ids:
            if self._confirmed_taxonomy(source_id) is None:
                continue
            for doc in docs:
                if str(doc["source_id"]) != source_id:
                    continue
                if int(doc.get("tag_locked") or 0):
                    continue
                relative = str(doc.get("relative_path") or "")
                if relative and is_reference_shelf_path(relative):
                    continue
                if str(doc.get("work_area_slug") or ""):
                    continue
                if str(doc["id"]) in pending_queue_ids:
                    continue
                untagged_count += 1
                untagged_items.append(relative or str(doc.get("source_path") or ""))
        add_check(
            "untagged",
            "무태그 문서(큐 없음)",
            untagged_count,
            0,
            "" if not untagged_count else "분류 적용을 실행하면 태깅·큐 적재가 반영됩니다",
            untagged_items,
        )

        # V9 문서 0건 topic 파일 → 자동 삭제
        valid_topic_slugs = {wiki_slugify(topic, topic) for topic in self._all_topics()}
        orphan_topics: list[str] = []
        for path in sorted(self.topics_dir.glob("*.md")):
            if path.stem in valid_topic_slugs:
                continue
            try:
                size = path.stat().st_size
                path.unlink()
            except OSError:
                continue
            disk_reclaimed_bytes += size
            orphan_topics.append(path.name)
            healed_anything = True
        add_check(
            "orphan_topic",
            "빈 주제 페이지",
            len(orphan_topics),
            len(orphan_topics),
            "" if not orphan_topics else "자동 수리: 문서 0건 topic 파일 삭제",
            orphan_topics,
        )

        # V10 DB↔카드 front matter 불일치(card_dirty) → 자동 재patch(§5.7 수복 재사용)
        dirty_row = self.db.fetch_one(
            "SELECT COUNT(*) AS count FROM knowledge_wiki_docs "
            "WHERE card_dirty = 1 AND status != ?",
            ("missing",),
        )
        fm_drift_count = int((dirty_row or {}).get("count") or 0)
        fm_healed = 0
        for source_id in source_ids:
            try:
                fm_healed += self._repair_dirty_cards(source_id)
            except OSError:
                continue
        if fm_healed:
            healed_anything = True
        add_check(
            "fm_drift",
            "카드 메타 불일치(card_dirty)",
            fm_drift_count,
            fm_healed,
            "" if not fm_drift_count else "자동 수리: DB 기준 카드 재투영",
        )

        # V11 심층: 전량 재해시 대조(silent change) — deep=True일 때만(quick 재해시 금지)
        if deep:
            silent_items: list[str] = []
            for doc in active_docs():
                file_hash = str(doc.get("file_hash") or "")
                if not file_hash:
                    continue
                source_path = Path(str(doc.get("source_path") or ""))
                if not source_path.exists():
                    continue
                current_hash = self._sha256(source_path)
                if current_hash and current_hash != file_hash:
                    silent_items.append(str(source_path))
            add_check(
                "silent_change",
                "원본 변경 미반영(silent change)",
                len(silent_items),
                0,
                ""
                if not silent_items
                else "해당 소스의 색인 시작(스캔+색인)을 실행하면 반영됩니다",
                silent_items,
            )

        # 불변식 5종 — 신규 상태(missing/tag_locked/card_dirty/summary_stale/enrich_skip) 정합
        all_docs = self.db.fetch_all("SELECT * FROM knowledge_wiki_docs")
        invariants = [
            (
                "inv_missing",
                "불변식 위반: missing인데 missing_since 없음",
                lambda doc: str(doc.get("status") or "active") == "missing"
                and not str(doc.get("missing_since") or ""),
            ),
            (
                "inv_tag_locked",
                "불변식 위반: tag_locked인데 업무영역 빈 값",
                lambda doc: int(doc.get("tag_locked") or 0) == 1
                and not str(doc.get("work_area_slug") or ""),
            ),
            (
                "inv_card_dirty",
                "불변식 위반: card_dirty 수복 불가 상태",
                lambda doc: int(doc.get("card_dirty") or 0) == 1
                and (
                    not str(doc.get("card_path") or "")
                    or str(doc.get("status") or "active") == "missing"
                ),
            ),
            (
                "inv_summary_stale",
                "불변식 위반: summary_stale인데 enriched=1",
                lambda doc: int(doc.get("summary_stale") or 0) == 1
                and int(doc.get("enriched") or 0) == 1,
            ),
            (
                "inv_enrich_skip",
                "불변식 위반: enrich_skip인데 실패 3회 미만",
                lambda doc: int(doc.get("enrich_skip") or 0) == 1
                and int(doc.get("enrich_fail_count") or 0) < ENRICH_FAIL_LIMIT,
            ),
        ]
        for code, label, predicate in invariants:
            violations = [doc for doc in all_docs if predicate(doc)]
            add_check(
                code,
                label,
                len(violations),
                0,
                "" if not violations else "상태 정합 위반 — 재색인 또는 문의(자동 수리 대상 아님)",
                [str(doc.get("relative_path") or doc.get("source_path") or "") for doc in violations],
            )

        if healed_anything:
            try:
                self.rebuild_index()
            except OSError:
                pass

        duration_ms = int((perf_counter() - started_perf) * 1000)
        total_count = sum(int(check["count"]) for check in checks)
        healed_count = sum(int(check["healed"]) for check in checks)
        report = {
            "id": report_id,
            "ran_at": ran_at,
            "mode": mode,
            "checks": checks,
            "disk_reclaimed_bytes": disk_reclaimed_bytes,
            "duration_ms": duration_ms,
            "total_count": total_count,
            "healed_count": healed_count,
            "log_path": str(log_path),
        }
        self.db.insert(
            "knowledge_verify_reports",
            {
                "id": report_id,
                "ran_at": ran_at,
                "mode": mode,
                "checks_json": json.dumps(checks, ensure_ascii=False),
                "disk_reclaimed_bytes": disk_reclaimed_bytes,
                "duration_ms": duration_ms,
                "log_path": str(log_path),
            },
        )
        try:
            with log_path.open("a", encoding="utf-8") as handle:
                for line in detail_lines:
                    handle.write(json.dumps(line, ensure_ascii=False) + "\n")
                handle.write(
                    json.dumps(
                        {
                            "timestamp": now_iso(),
                            "code": "summary",
                            "report_id": report_id,
                            "mode": mode,
                            "total_count": total_count,
                            "healed_count": healed_count,
                            "disk_reclaimed_bytes": disk_reclaimed_bytes,
                            "duration_ms": duration_ms,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
        except OSError:
            pass
        mode_label = "심층" if deep else "빠른"
        if total_count:
            message = (
                f"지식위키 무결성 점검({mode_label}): 불일치 {total_count}건 중 "
                f"{healed_count}건 자동 수리, {total_count - healed_count}건 확인 필요"
            )
        else:
            # §6: 0건이어도 기록 — 대시보드 "마지막 검증 N일 전, 이상 없음" 근거.
            message = f"지식위키 무결성 점검({mode_label}): 불일치 0건 — 이상 없음"
        self.db.log(
            feature="knowledge",
            action="knowledge.wiki.verify",
            status="completed",
            inputs={"deep": deep, "job_id": job_id},
            outputs={
                "message": message,
                "report_id": report_id,
                "mode": mode,
                "total_count": total_count,
                "healed_count": healed_count,
                "disk_reclaimed_bytes": disk_reclaimed_bytes,
            },
        )
        self._append_log_line(
            f"verify mode={mode} total={total_count} healed={healed_count} "
            f"reclaimed={disk_reclaimed_bytes} duration_ms={duration_ms}"
        )
        return report

    def latest_verify_report(self) -> dict[str, Any] | None:
        """GET /api/knowledge/verify/latest — 최근 verify 리포트 1건(checks 파싱 포함)."""
        row = self.db.fetch_one(
            "SELECT * FROM knowledge_verify_reports ORDER BY ran_at DESC LIMIT 1"
        )
        if row is None:
            return None
        try:
            checks = json.loads(row.get("checks_json") or "[]")
        except json.JSONDecodeError:
            checks = []
        return {
            "id": row["id"],
            "ran_at": row["ran_at"],
            "mode": row["mode"],
            "checks": checks if isinstance(checks, list) else [],
            "disk_reclaimed_bytes": int(row.get("disk_reclaimed_bytes") or 0),
            "duration_ms": int(row.get("duration_ms") or 0),
            "log_path": row.get("log_path"),
        }

    def _verify_log_path(self, ref: str) -> Path:
        log_dir = self.paths.logs / "knowledge-verify"
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir / f"{ref}.jsonl"

    # ------------------------------------------------------------- wiki read

    def wiki_index(self) -> dict[str, Any]:
        if not self.index_path.exists():
            self.rebuild_index()
        return {
            "path": str(self.index_path),
            "content": self.index_path.read_text(encoding="utf-8", errors="replace"),
        }

    def wiki_tree(self) -> dict[str, Any]:
        """데스크톱 위키 브라우저용 트리: 주제 / 업무 기록 / 소스별 문서."""
        sources = self.db.fetch_all(
            "SELECT * FROM knowledge_sources WHERE status != ? ORDER BY label ASC", ("deleted",)
        )
        # §5.5: missing 문서도 status 필드와 함께 실어 보낸다 — 프론트가
        # "원본 없는 카드" 그룹으로 분리 표시하고 유예 보관 카드를 열람할 수 있게.
        # (index.md·허브·검색에서의 제외는 각 경로 필터가 담당)
        all_docs = self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs ORDER BY source_id ASC, title ASC"
        )
        docs = [doc for doc in all_docs if str(doc.get("status") or "active") != "missing"]
        missing_docs = [doc for doc in all_docs if str(doc.get("status") or "active") == "missing"]
        topics = self._all_topics()
        works = self.list_work_pages()
        work_areas_payload = [
            {
                "slug": page["slug"],
                "title": page["title"],
                "doc_count": page["doc_count"],
                "path": page["path"],
            }
            for page in self.list_work_area_pages()
        ]

        topics_payload = [
            {
                "slug": wiki_slugify(topic, topic),
                "title": topic,
                "doc_count": len(doc_rows),
                "path": f"topics/{wiki_slugify(topic, topic)}.md",
            }
            for topic, doc_rows in sorted(topics.items())
        ]
        works_payload = [
            {
                "slug": page["slug"],
                "title": page["title"],
                "session_id": page["session_id"],
                "updated_at": page["updated_at"],
                "path": page["path"],
            }
            for page in works
        ]
        # §5.6 UX 회귀 방지: 동일 해시 사본은 대표 1건 + duplicate_count로 접는다
        # (doc_uid 1:1화로 사본마다 카드가 생기므로 slug dedupe 의도를 해시 기준으로 계승).
        by_source = self._dedupe_docs_by_hash(docs)

        def _doc_payload(doc: dict[str, Any], duplicate_count: int) -> dict[str, Any]:
            return {
                "slug": doc["slug"],
                "title": doc["title"],
                "path": f"docs/{doc['slug']}.md",
                "quality_score": doc.get("quality_score"),
                "duplicate_count": duplicate_count,
                "status": str(doc.get("status") or "active"),
            }

        missing_by_source: dict[str, list[dict[str, Any]]] = {}
        for doc in missing_docs:
            missing_by_source.setdefault(str(doc["source_id"]), []).append(doc)

        sources_payload: list[dict[str, Any]] = []
        seen_source_ids: set[str] = set()
        for source in sources:
            source_id = str(source["id"])
            seen_source_ids.add(source_id)
            sources_payload.append(
                {
                    "source_id": source_id,
                    "label": source["label"],
                    "docs": [
                        _doc_payload(doc, duplicate_count)
                        for doc, duplicate_count in by_source.get(source_id, [])
                    ]
                    + [_doc_payload(doc, 1) for doc in missing_by_source.get(source_id, [])],
                }
            )
        for source_id, source_docs in by_source.items():
            if source_id in seen_source_ids:
                continue
            sources_payload.append(
                {
                    "source_id": source_id,
                    "label": source_id,
                    "docs": [
                        _doc_payload(doc, duplicate_count)
                        for doc, duplicate_count in source_docs
                    ],
                }
            )
        return {
            "topics": topics_payload,
            "works": works_payload,
            "work_areas": work_areas_payload,
            "sources": sources_payload,
            "counts": {
                "docs": len(docs),
                "topics": len(topics_payload),
                "works": len(works_payload),
                "work_areas": len(work_areas_payload),
            },
        }

    def read_page(self, relative_path: str) -> dict[str, Any]:
        cleaned = nfc(str(relative_path or "")).replace("\\", "/").strip().lstrip("/")
        candidate = (self.wiki_root / cleaned).resolve()
        wiki_root = self.wiki_root.resolve()
        # str.startswith는 형제 디렉터리(knowledge-wiki-extra 등)를 오탐하므로 relative_to로 판정.
        try:
            rel_check = candidate.relative_to(wiki_root)
        except ValueError:
            raise PermissionError(relative_path)
        if rel_check == Path("."):
            raise PermissionError(relative_path)
        if candidate.suffix.lower() != ".md" or not candidate.exists() or not candidate.is_file():
            raise KeyError(relative_path)
        return {
            "path": str(candidate),
            "relative_path": candidate.relative_to(wiki_root).as_posix(),
            "content": candidate.read_text(encoding="utf-8", errors="replace"),
        }

    # ------------------------------------------------------- documents (API)

    def list_documents(self, source_id: str | None = None) -> list[dict[str, Any]]:
        # §5.5: 소프트 삭제 문서의 knowledge_documents 행은 보존되지만(부활·GC 원천)
        # 문서 목록에서는 제외한다 — 유령 문서 노출 방지.
        missing_filter = (
            "NOT EXISTS (SELECT 1 FROM knowledge_wiki_docs w "
            "WHERE w.source_file_id = d.source_file_id AND w.status = 'missing')"
        )
        where_clause = (
            f"WHERE d.source_id = ? AND {missing_filter}" if source_id else f"WHERE {missing_filter}"
        )
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
                FROM knowledge_document_sections GROUP BY document_id
            ) s ON s.document_id = d.id
            LEFT JOIN (
                SELECT document_id, COUNT(*) AS table_count
                FROM knowledge_table_blocks GROUP BY document_id
            ) t ON t.document_id = d.id
            LEFT JOIN (
                SELECT document_id,
                       COUNT(*) AS chunk_count,
                       COUNT(CASE WHEN text LIKE '표:%' THEN 1 END) AS table_chunk_count
                FROM knowledge_document_chunks GROUP BY document_id
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
        count_row = self.db.fetch_one(
            "SELECT COUNT(*) AS count FROM knowledge_document_sections WHERE document_id = ?",
            (document_id,),
        )
        section_count = int(count_row["count"] if count_row else 0)
        sections = self.db.fetch_all(
            """
            SELECT * FROM knowledge_document_sections
            WHERE document_id = ? ORDER BY order_index ASC LIMIT ?
            """,
            (document_id, safe_limit),
        )
        section_ids = [section["id"] for section in sections]
        tables_by_section: dict[str | None, list[dict[str, Any]]] = {}
        if section_ids:
            placeholders = ", ".join("?" for _ in section_ids)
            for table in self.db.fetch_all(
                f"""
                SELECT * FROM knowledge_table_blocks
                WHERE document_id = ? AND section_id IN ({placeholders})
                ORDER BY order_index ASC
                """,
                (document_id, *section_ids),
            ):
                tables_by_section.setdefault(table.get("section_id"), []).append(self._serialize_table(table))
        preview_sections = []
        for section in sections:
            text = str(section.get("text") or "")
            truncated = len(text) > STRUCTURE_PREVIEW_TEXT_CHARS
            preview = text[:STRUCTURE_PREVIEW_TEXT_CHARS].rstrip()
            if truncated:
                preview = f"{preview}..."
            preview_sections.append(
                {
                    **section,
                    "text": preview,
                    "text_truncated": truncated,
                    "tables": tables_by_section.get(section["id"], []),
                }
            )
        counts_row = self.db.fetch_one(
            """
            SELECT COALESCE(COUNT(*), 0) AS chunk_count,
                   COALESCE(COUNT(CASE WHEN text LIKE '표:%' THEN 1 END), 0) AS table_chunk_count
            FROM knowledge_document_chunks WHERE document_id = ?
            """,
            (document_id,),
        )
        document_with_counts = {
            **document,
            "section_count": section_count,
            "table_count": sum(len(tables) for tables in tables_by_section.values()),
            "chunk_count": int((counts_row or {}).get("chunk_count") or 0),
            "table_chunk_count": int((counts_row or {}).get("table_chunk_count") or 0),
        }
        return {
            "document": self._serialize_document(document_with_counts),
            "sections": preview_sections,
            "section_count": section_count,
            "sections_returned": len(sections),
            "has_more_sections": section_count > len(sections),
        }

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

    def _serialize_table(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "headers": self._json_list(row.get("headers_json")),
            "rows": json.loads(row["rows_json"]) if row.get("rows_json") else [],
        }

    def _serialize_document(self, row: dict[str, Any]) -> dict[str, Any]:
        metadata = {}
        if row.get("metadata_json"):
            try:
                metadata = json.loads(row["metadata_json"])
            except json.JSONDecodeError:
                metadata = {}
        return {**row, "partial": bool(row.get("partial")), "metadata": metadata}

    # ----------------------------------------------------------------- graph

    def graph_summary(self) -> dict[str, Any]:
        sources = self.db.fetch_all(
            "SELECT * FROM knowledge_sources WHERE status != ? ORDER BY created_at DESC", ("deleted",)
        )
        # §5.5: missing 문서는 그래프에서 제외한다.
        docs = self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE status != ? ORDER BY updated_at DESC",
            ("missing",),
        )
        pages = self.db.fetch_all("SELECT * FROM knowledge_pages ORDER BY created_at DESC")
        topics = self._all_topics()
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        for source in sources:
            nodes.append(
                {
                    "id": f"source_folder:{source['id']}",
                    "label": source["label"],
                    "node_type": "source_folder",
                    "path": source["root_path"],
                }
            )
        for doc in docs:
            doc_node_id = f"wiki_doc:{doc['id']}"
            nodes.append(
                {
                    "id": doc_node_id,
                    "label": doc["title"],
                    "node_type": "document",
                    "path": doc["source_path"],
                    "card_path": doc.get("card_path"),
                    "quality_score": doc.get("quality_score"),
                }
            )
            edges.append(
                {"source": f"source_folder:{doc['source_id']}", "target": doc_node_id, "relation": "contains"}
            )
        for topic, topic_docs in topics.items():
            topic_node_id = f"topic:{wiki_slugify(topic, topic)}"
            nodes.append({"id": topic_node_id, "label": topic, "node_type": "topic"})
            for doc in topic_docs:
                edges.append(
                    {"source": f"wiki_doc:{doc['id']}", "target": topic_node_id, "relation": "tagged_as"}
                )
        for page in pages:
            nodes.append(
                {
                    "id": f"note:{page['id']}",
                    "label": page["title"],
                    "node_type": "note",
                    "path": page["path"],
                }
            )
        node_labels = {node["id"]: node.get("label", node["id"]) for node in nodes}
        neighbor_map: dict[str, set[str]] = {}
        for edge in edges:
            neighbor_map.setdefault(edge["source"], set()).add(edge["target"])
            neighbor_map.setdefault(edge["target"], set()).add(edge["source"])
        for node in nodes:
            node["neighbors"] = [
                node_labels.get(neighbor, neighbor) for neighbor in sorted(neighbor_map.get(node["id"], set()))
            ]
        graph_json_path = self.paths.knowledge_graph / "graph.json"
        try:
            graph_json_path.write_text(
                json.dumps({"engine": self.ENGINE, "nodes": nodes, "edges": edges}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError:
            pass
        return {
            "engine": self.ENGINE,
            "node_count": len(nodes),
            "edge_count": len(edges),
            "artifacts": {
                "graph_json_path": str(graph_json_path),
                "graph_html_path": str(self.index_path),
                "graph_report_path": str(self.log_path),
            },
            "nodes": nodes[:60],
            "edges": edges[:120],
        }

    def graph_query(self, *, query: str, limit: int = 20) -> dict[str, Any]:
        normalized = nfc(query).strip().lower()
        safe_limit = max(1, min(limit, 100))
        matched_nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        neighbor_nodes: list[dict[str, Any]] = []
        related_documents: list[dict[str, Any]] = []
        if not normalized:
            return {
                "query": query,
                "nodes": [],
                "edges": [],
                "neighbor_nodes": [],
                "related_documents": [],
            }
        docs = self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE status != ?", ("missing",)
        )
        topics = self._all_topics()
        matched_doc_ids: set[str] = set()
        for doc in docs:
            haystack = " ".join(
                [str(doc.get("norm_title") or ""), " ".join(self._json_list(doc.get("keywords_json")))]
            ).lower()
            if normalized in haystack:
                matched_doc_ids.add(doc["id"])
                matched_nodes.append(
                    {
                        "id": f"wiki_doc:{doc['id']}",
                        "label": doc["title"],
                        "node_type": "document",
                        "metadata": {"source_path": doc["source_path"], "card_path": doc.get("card_path")},
                    }
                )
        for topic, topic_docs in topics.items():
            topic_matched = normalized in topic.lower()
            topic_node = {
                "id": f"topic:{wiki_slugify(topic, topic)}",
                "label": topic,
                "node_type": "topic",
                "metadata": {"doc_count": len(topic_docs)},
            }
            if topic_matched:
                matched_nodes.append(topic_node)
            for doc in topic_docs:
                if topic_matched or doc["id"] in matched_doc_ids:
                    edges.append(
                        {
                            "id": f"edge:{doc['id']}:{topic_node['id']}",
                            "source_node_id": f"wiki_doc:{doc['id']}",
                            "target_node_id": topic_node["id"],
                            "relation": "tagged_as",
                            "confidence": 0.9,
                        }
                    )
                    if topic_matched and doc["id"] not in matched_doc_ids:
                        neighbor_nodes.append(
                            {
                                "id": f"wiki_doc:{doc['id']}",
                                "label": doc["title"],
                                "node_type": "document",
                                "metadata": {"source_path": doc["source_path"]},
                            }
                        )
        seen_document_ids: set[str] = set()
        for doc in docs:
            if doc["id"] in matched_doc_ids and doc.get("document_id"):
                document = self.db.fetch_one(
                    "SELECT id, title, file_path, document_type FROM knowledge_documents WHERE id = ?",
                    (doc["document_id"],),
                )
                if document and document["id"] not in seen_document_ids:
                    seen_document_ids.add(document["id"])
                    related_documents.append(document)
        return {
            "query": query,
            "nodes": matched_nodes[:safe_limit],
            "edges": edges[:safe_limit],
            "neighbor_nodes": neighbor_nodes[:safe_limit],
            "related_documents": related_documents[:safe_limit],
        }

    # ---------------------------------------------------------------- status

    def backend_status(self, *, llm_configured: bool = False) -> dict[str, Any]:
        fts5_ok = bool(getattr(self.db, "fts5_available", False))
        kordoc_ok = kordoc_available()
        wiki_backend = {
            "name": "wiki_markdown",
            "role": "knowledge_store",
            "available": True,
            "storage_path": str(self.wiki_root),
            "detail": "Obsidian 호환 Markdown 위키 (index.md/docs/topics/work/extracted)",
        }
        fts_backend = {
            "name": "sqlite_fts5",
            "role": "search",
            "available": fts5_ok,
            "tokenizer": "trigram",
            "storage_path": str(self.paths.db_file),
            "detail": "3자 이상 trigram BM25, 미만은 LIKE 폴백" if fts5_ok else "FTS5 미지원 — LIKE 폴백만 사용",
        }
        return {
            "engine": self.ENGINE,
            "fts5": {"ok": fts5_ok, "tokenizer": "trigram"},
            "kordoc": {"available": kordoc_ok},
            "llm_enrichment": {"configured": llm_configured},
            "backends": [wiki_backend, fts_backend],
            # 데스크톱 렌더 호환 필드 (UI 개편 전까지 유지)
            "vector": {
                "production_backend": "sqlite_fts5",
                "production_available": fts5_ok,
                "production_enabled": fts5_ok,
                "active_backend": "sqlite_fts5" if fts5_ok else "sqlite_like_fallback",
                "available": True,
                "mode": "wiki",
                "storage_path": str(self.paths.db_file),
                "detail": fts_backend["detail"],
            },
            "graph": {
                "production_backend": "wiki_markdown",
                "production_available": True,
                "production_enabled": True,
                "active_backend": "wiki_markdown",
                "available": True,
                "mode": "wiki",
                "storage_path": str(self.wiki_root),
                "detail": wiki_backend["detail"],
            },
        }

    # ----------------------------------------------------------------- utils

    def _json_list(self, value: Any) -> list[str]:
        if not value:
            return []
        try:
            parsed = json.loads(value) if isinstance(value, str) else value
        except json.JSONDecodeError:
            return []
        if not isinstance(parsed, list):
            return []
        return [str(item) for item in parsed]

    def _job_row(self, job_id: str) -> dict[str, Any] | None:
        return self.db.fetch_one("SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,))

    def _job_log_path(self, job_id: str) -> Path:
        log_dir = self.paths.logs / "knowledge-ingestion"
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir / f"{job_id}.jsonl"

    def _append_job_event(
        self, job_id: str, event: str, *, stage: str, message: str, level: str = "info", **payload: Any
    ) -> None:
        log_path = self._job_log_path(job_id)
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

    def _set_job_stage(self, job_id: str, stage: str, completed_files: int, total_files: int) -> None:
        if total_files <= 0:
            progress = 99
        else:
            stage_fraction = INGESTION_STAGE_INDEXES.get(stage, 0) / max(1, len(INGESTION_STAGES))
            progress = max(1, min(99, round(((completed_files + stage_fraction) / total_files) * 100)))
        self.db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET current_stage = ?, current_stage_index = ?, stage_count = ?, progress_percent = ?
            WHERE id = ?
            """,
            (
                INGESTION_STAGE_LABELS.get(stage, stage),
                INGESTION_STAGE_INDEXES.get(stage, 0),
                len(INGESTION_STAGES),
                progress,
                job_id,
            ),
        )

    def _mark_job_progress(
        self,
        job_id: str,
        source_file: dict[str, Any],
        *,
        processed_count: int,
        failed_count: int,
        total_files: int,
    ) -> None:
        attempted = processed_count + failed_count
        progress = 100 if total_files <= 0 else max(0, min(99, round((attempted / total_files) * 100)))
        self.db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET last_processed_path = ?, last_processed_at = ?,
                processed_count = ?, failed_count = ?, progress_percent = ?
            WHERE id = ?
            """,
            (
                source_file.get("relative_path") or source_file.get("file_path"),
                now_iso(),
                processed_count,
                failed_count,
                progress,
                job_id,
            ),
        )

    def _job_cancel_requested(self, job_id: str) -> bool:
        row = self.db.fetch_one(
            "SELECT cancel_requested FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,)
        )
        return bool(row and row.get("cancel_requested"))

    def _finish_job(
        self,
        job_id: str,
        *,
        status: str,
        processed_count: int,
        failed_count: int,
        deleted_document_count: int,
        skipped_count: int,
        total_files: int,
        duration_ms: int | None,
        error_message: str | None,
        cancel_requested: bool = False,
    ) -> dict[str, Any]:
        attempted = processed_count + failed_count
        average = round(duration_ms / max(1, attempted), 2) if duration_ms is not None else None
        if status == "canceled":
            progress = 0 if total_files <= 0 else max(0, min(99, round((attempted / max(1, total_files)) * 100)))
            stage = "취소됨"
        else:
            progress = 100
            stage = "검색 준비 완료" if status == "completed" else "부분 완료"
        self.db.execute(
            """
            UPDATE knowledge_ingestion_jobs
            SET status = ?, cancel_requested = ?, processed_count = ?, failed_count = ?,
                deleted_document_count = ?, skipped_count = ?, duration_ms = ?, average_ms_per_file = ?,
                error_message = ?, current_stage = ?, current_stage_index = ?, progress_percent = ?,
                completed_at = ?
            WHERE id = ?
            """,
            (
                status,
                1 if cancel_requested else 0,
                processed_count,
                failed_count,
                deleted_document_count,
                skipped_count,
                duration_ms,
                average,
                error_message,
                stage,
                INGESTION_STAGE_INDEXES["wiki"],
                progress,
                now_iso(),
                job_id,
            ),
        )
        return self._job_row(job_id) or {}
