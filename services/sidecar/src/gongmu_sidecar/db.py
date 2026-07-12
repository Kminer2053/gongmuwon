from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from collections.abc import Iterator
from typing import Any
from uuid import uuid4
from urllib.parse import quote

from .workspace import WorkspacePaths


SCHEMA = """
CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    view TEXT NOT NULL,
    remind_before_minutes INTEGER,
    reminder_acknowledged_at TEXT,
    reminder_notified_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    schedule_id TEXT,
    status TEXT NOT NULL,
    context_summary_text TEXT,
    context_summary_upto TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_session_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'chat',
    status TEXT NOT NULL DEFAULT 'completed',
    provider TEXT,
    model TEXT,
    latency_ms INTEGER,
    citations_json TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_session_attachments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    message_id TEXT,
    file_name TEXT NOT NULL,
    mime_type TEXT,
    stored_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    text_excerpt TEXT,
    text_char_count INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_session_file_links (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    label TEXT,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES work_sessions(id)
);

-- 레거시: Reference Set 기능은 제거되었다. 기존 사용자 데이터 보존을 위해
-- reference_sets / reference_items 테이블 정의만 유지하며 새 코드는 사용하지 않는다.
CREATE TABLE IF NOT EXISTS reference_sets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    session_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reference_items (
    id TEXT PRIMARY KEY,
    reference_set_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_tickets (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    decided_at TEXT,
    decision_note TEXT,
    target_label TEXT
);

CREATE TABLE IF NOT EXISTS execution_logs (
    id TEXT PRIMARY KEY,
    feature TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    inputs_json TEXT NOT NULL,
    outputs_json TEXT NOT NULL,
    approval_ticket_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 50,
    resource_key TEXT,
    resource_policy TEXT NOT NULL DEFAULT 'none',
    progress_percent INTEGER NOT NULL DEFAULT 0,
    current_stage TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    input_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT NOT NULL DEFAULT '{}',
    error_message TEXT,
    created_at TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS work_job_events (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    level TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES work_jobs(id)
);

CREATE TABLE IF NOT EXISTS work_job_locks (
    resource_key TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    lock_type TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES work_jobs(id)
);

CREATE TABLE IF NOT EXISTS knowledge_sources (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    root_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    last_scanned_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS knowledge_source_files (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    modified_at TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT,
    mime_type TEXT,
    text_excerpt TEXT,
    extracted_text_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(source_id) REFERENCES knowledge_sources(id)
);

CREATE TABLE IF NOT EXISTS knowledge_ingestion_jobs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    status TEXT NOT NULL,
    current_stage TEXT,
    current_stage_index INTEGER NOT NULL DEFAULT 0,
    stage_count INTEGER NOT NULL DEFAULT 6,
    progress_percent INTEGER NOT NULL DEFAULT 0,
    queued_count INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    deleted_document_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    force_rebuild INTEGER NOT NULL DEFAULT 0,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    last_processed_path TEXT,
    last_processed_at TEXT,
    duration_ms INTEGER,
    average_ms_per_file REAL,
    error_message TEXT,
    log_dump_path TEXT,
    diagnostic_event_count INTEGER NOT NULL DEFAULT 0,
    last_diagnostic_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY(source_id) REFERENCES knowledge_sources(id)
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id TEXT PRIMARY KEY,
    source_file_id TEXT NOT NULL UNIQUE,
    source_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_hash TEXT,
    ingestion_signature TEXT,
    title TEXT NOT NULL,
    document_type TEXT NOT NULL,
    document_number TEXT,
    sender_org TEXT,
    receiver_org TEXT,
    issued_date TEXT,
    security_level TEXT,
    attachment_count INTEGER NOT NULL DEFAULT 0,
    parser_name TEXT NOT NULL,
    parser_version TEXT NOT NULL DEFAULT '',
    quality_score REAL NOT NULL DEFAULT 0,
    partial INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(source_file_id) REFERENCES knowledge_source_files(id),
    FOREIGN KEY(source_id) REFERENCES knowledge_sources(id)
);

CREATE TABLE IF NOT EXISTS knowledge_document_sections (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    heading TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    order_index INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY(document_id) REFERENCES knowledge_documents(id)
);

CREATE TABLE IF NOT EXISTS knowledge_document_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    section_id TEXT,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    embedding_backend TEXT NOT NULL DEFAULT 'deterministic',
    embedding_model TEXT NOT NULL DEFAULT 'hash',
    embedding_json TEXT NOT NULL DEFAULT '[]',
    vector_ref TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(document_id) REFERENCES knowledge_documents(id),
    FOREIGN KEY(section_id) REFERENCES knowledge_document_sections(id)
);

CREATE TABLE IF NOT EXISTS knowledge_table_blocks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    section_id TEXT,
    order_index INTEGER NOT NULL,
    caption TEXT,
    headers_json TEXT NOT NULL DEFAULT '[]',
    rows_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY(document_id) REFERENCES knowledge_documents(id),
    FOREIGN KEY(section_id) REFERENCES knowledge_document_sections(id)
);

CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
    id TEXT PRIMARY KEY,
    node_type TEXT NOT NULL,
    label TEXT NOT NULL,
    source_document_id TEXT,
    confidence REAL NOT NULL DEFAULT 0.5,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
    id TEXT PRIMARY KEY,
    source_node_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_wiki_docs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_file_id TEXT NOT NULL UNIQUE,
    document_id TEXT,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    source_path TEXT NOT NULL,
    relative_path TEXT NOT NULL DEFAULT '',
    file_hash TEXT NOT NULL DEFAULT '',
    doc_type TEXT NOT NULL DEFAULT '',
    parser_name TEXT NOT NULL DEFAULT '',
    quality_score REAL NOT NULL DEFAULT 0,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    card_path TEXT NOT NULL,
    extracted_path TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    keywords_json TEXT NOT NULL DEFAULT '[]',
    topics_json TEXT NOT NULL DEFAULT '[]',
    enriched INTEGER NOT NULL DEFAULT 0,
    norm_title TEXT NOT NULL DEFAULT '',
    norm_body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(source_id) REFERENCES knowledge_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_wiki_docs_source
ON knowledge_wiki_docs(source_id, updated_at DESC);

-- T-01 Work-Aware 분류체계: 확정 체계(SCHEMA.md 원본 JSON) + 니즈 인터뷰 + 분류 대기 큐
CREATE TABLE IF NOT EXISTS knowledge_taxonomy (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL UNIQUE,
    taxonomy_json TEXT NOT NULL DEFAULT '{}',
    quality_json TEXT NOT NULL DEFAULT '{}',
    schema_path TEXT,
    confirmed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(source_id) REFERENCES knowledge_sources(id)
);

CREATE TABLE IF NOT EXISTS knowledge_taxonomy_interview (
    id TEXT PRIMARY KEY,
    org_type TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    duty TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_tag_queue (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    wiki_doc_id TEXT NOT NULL,
    doc_slug TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    source_path TEXT NOT NULL DEFAULT '',
    candidates_json TEXT NOT NULL DEFAULT '{}',
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_work_area_slug TEXT,
    resolved_doc_role TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY(source_id) REFERENCES knowledge_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_tag_queue_source_status
ON knowledge_tag_queue(source_id, status);

-- Wave D F-09: 주제 백과사전 종합 저장소 + 증분 dirty 마킹.
-- topic_key = normalize_topic_key(주제) 정규화 키. payload_json에는
-- {"synthesis": 골격 JSON, "sources": 각주 근거 목록}을 저장한다.
-- 문서 색인/보강으로 주제 구성이 바뀌면 dirty=1 → 다음 enrich 말미에 재종합.
CREATE TABLE IF NOT EXISTS topic_synthesis (
    topic_key TEXT PRIMARY KEY,
    topic_label TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '',
    synthesized_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT ''
);

-- 주제 어휘집 §6: L3 후보 큐 — 보강 중 LLM `NEW:` 제안·기존 자유 주제의 어휘집 미포함분을
-- norm_key(normalize_topic_key) 단위로 접어 적재한다. 동일 키 재등장 시 hit_count++.
-- status: pending | approved | rejected | merged (merged면 merged_into_id에 대상 주제 id).
CREATE TABLE IF NOT EXISTS vocab_candidates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    norm_key TEXT NOT NULL UNIQUE,
    hit_count INTEGER NOT NULL DEFAULT 1,
    sample_docs_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    merged_into_id TEXT,
    first_seen_at TEXT NOT NULL,
    decided_at TEXT
);

-- 주제 어휘집 §1/§6: L3 승인 확장의 정본. <workspace>/vocab/user-approved.json은 미러(이식성).
-- name이 ''이면 synonym-only 오버라이드(병합 승인) — 하위 층 name/scope_note를 유지한 채
-- synonyms만 합집합에 기여한다 (§3-1).
CREATE TABLE IF NOT EXISTS vocab_user_topics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    synonyms_json TEXT NOT NULL DEFAULT '[]',
    broader TEXT,
    scope_note TEXT NOT NULL DEFAULT '',
    work_area_hint TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    source_candidate_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ''
);

-- W7 P3 §6: 무결성 점검(verify) 리포트 — 실행당 1행 (상세는 logs/knowledge-verify/*.jsonl)
CREATE TABLE IF NOT EXISTS knowledge_verify_reports (
    id TEXT PRIMARY KEY,
    ran_at TEXT NOT NULL,
    mode TEXT NOT NULL,
    checks_json TEXT NOT NULL DEFAULT '[]',
    disk_reclaimed_bytes INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    log_path TEXT
);

CREATE TABLE IF NOT EXISTS local_file_index (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL UNIQUE,
    search_root TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    name TEXT NOT NULL,
    name_lower TEXT NOT NULL,
    stem_lower TEXT NOT NULL,
    compact_name TEXT NOT NULL,
    compact_stem TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    modified_at TEXT NOT NULL,
    indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_candidates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    candidate_type TEXT NOT NULL,
    status TEXT NOT NULL,
    proposed_page_slug TEXT NOT NULL,
    proposed_page_type TEXT NOT NULL,
    approved_page_id TEXT,
    approved_page_path TEXT,
    created_at TEXT NOT NULL,
    approved_at TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_pages (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    page_type TEXT NOT NULL,
    path TEXT NOT NULL,
    source_candidate_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personalization_candidates (
    id TEXT PRIMARY KEY,
    candidate_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    source_session_id TEXT,
    risk_level TEXT NOT NULL,
    status TEXT NOT NULL,
    proposed_payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT
);

CREATE TABLE IF NOT EXISTS content_bases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    purpose TEXT NOT NULL,
    template_key TEXT NOT NULL,
    reference_set_id TEXT,
    source_session_id TEXT,
    outline TEXT NOT NULL DEFAULT '',
    document_format TEXT NOT NULL DEFAULT 'auto',
    audience_type TEXT NOT NULL DEFAULT '',
    expected_length TEXT NOT NULL DEFAULT '',
    urgency_level TEXT NOT NULL DEFAULT '',
    needs_traceability TEXT NOT NULL DEFAULT '',
    requires_official_form TEXT NOT NULL DEFAULT '',
    requested_action TEXT NOT NULL DEFAULT '',
    deadline TEXT NOT NULL DEFAULT '',
    security_level TEXT NOT NULL DEFAULT '',
    direct_file_paths_json TEXT NOT NULL DEFAULT '[]',
    user_template_path TEXT,
    artifact_path TEXT NOT NULL,
    preview_path TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS final_document_outputs (
    id TEXT PRIMARY KEY,
    content_base_id TEXT NOT NULL,
    approval_ticket_id TEXT NOT NULL UNIQUE,
    output_name TEXT NOT NULL,
    artifact_path TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    applied_at TEXT,
    FOREIGN KEY(content_base_id) REFERENCES content_bases(id),
    FOREIGN KEY(approval_ticket_id) REFERENCES approval_tickets(id)
);

CREATE TABLE IF NOT EXISTS anything_launch_requests (
    id TEXT PRIMARY KEY,
    approval_ticket_id TEXT NOT NULL UNIQUE,
    query TEXT NOT NULL,
    launch_target TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    applied_at TEXT,
    FOREIGN KEY(approval_ticket_id) REFERENCES approval_tickets(id)
);

CREATE TABLE IF NOT EXISTS file_org_proposals (
    id TEXT PRIMARY KEY,
    target_path TEXT NOT NULL,
    proposal_type TEXT NOT NULL,
    proposed_destination TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_org_operations (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    source_path TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    action TEXT NOT NULL,
    approval_ticket_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rolled_back_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_execution_logs_created_at
ON execution_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_source_updated
ON knowledge_documents(source_id, updated_at DESC, title ASC);

-- W7 P1 §4.2: 이동 판정((size, file_hash) 대조)과 refcount 조회 가속
CREATE INDEX IF NOT EXISTS idx_knowledge_source_files_source_hash
ON knowledge_source_files(source_id, file_hash);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_sections_document
ON knowledge_document_sections(document_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_chunks_document
ON knowledge_document_chunks(document_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_table_blocks_document
ON knowledge_table_blocks(document_id);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Database:
    paths: WorkspacePaths

    def __post_init__(self) -> None:
        self._lock = threading.RLock()
        self._transaction_depth = 0
        self.connection = sqlite3.connect(self.paths.db_file, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode = WAL")
        self.connection.execute("PRAGMA busy_timeout = 5000")
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.executescript(SCHEMA)
        self._ensure_column("work_session_messages", "message_type", "TEXT NOT NULL DEFAULT 'chat'")
        self._ensure_column("work_session_messages", "status", "TEXT NOT NULL DEFAULT 'completed'")
        self._ensure_column("work_session_messages", "provider", "TEXT")
        self._ensure_column("work_session_messages", "model", "TEXT")
        self._ensure_column("work_session_messages", "latency_ms", "INTEGER")
        self._ensure_column("work_session_messages", "citations_json", "TEXT")
        # T-02 컨텍스트 예산: 세션 롤링 요약 (비파괴 마이그레이션)
        self._ensure_column("work_sessions", "context_summary_text", "TEXT")
        self._ensure_column("work_sessions", "context_summary_upto", "TEXT")
        self._ensure_column("work_session_attachments", "text_char_count", "INTEGER")
        # F-20 일정 알림 (비파괴 마이그레이션)
        self._ensure_column("schedules", "remind_before_minutes", "INTEGER")
        self._ensure_column("schedules", "reminder_acknowledged_at", "TEXT")
        self._ensure_column("schedules", "reminder_notified_at", "TEXT")
        self._ensure_column("approval_tickets", "target_label", "TEXT")
        self._ensure_column("knowledge_sources", "status", "TEXT NOT NULL DEFAULT 'active'")
        self._ensure_column("knowledge_sources", "last_scanned_at", "TEXT")
        self._ensure_column("knowledge_sources", "updated_at", "TEXT NOT NULL DEFAULT ''")
        # W7 P0 스캔 위생 (비파괴 마이그레이션): mtime_ns는 기록만(비교는 과도기 동안
        # ISO 문자열 유지), needs_rescan은 stat-해시-stat 샌드위치 불일치 시 재처리 플래그.
        self._ensure_column("knowledge_source_files", "mtime_ns", "INTEGER")
        self._ensure_column("knowledge_source_files", "needs_rescan", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("knowledge_ingestion_jobs", "current_stage", "TEXT")
        self._ensure_column("knowledge_ingestion_jobs", "current_stage_index", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("knowledge_ingestion_jobs", "stage_count", "INTEGER NOT NULL DEFAULT 6")
        self._ensure_column("knowledge_ingestion_jobs", "progress_percent", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("knowledge_ingestion_jobs", "deleted_document_count", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("knowledge_ingestion_jobs", "skipped_count", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("knowledge_ingestion_jobs", "force_rebuild", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("knowledge_ingestion_jobs", "cancel_requested", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("knowledge_ingestion_jobs", "last_processed_path", "TEXT")
        self._ensure_column("knowledge_ingestion_jobs", "last_processed_at", "TEXT")
        self._ensure_column("knowledge_ingestion_jobs", "duration_ms", "INTEGER")
        self._ensure_column("knowledge_ingestion_jobs", "average_ms_per_file", "REAL")
        self._ensure_column("knowledge_ingestion_jobs", "log_dump_path", "TEXT")
        self._ensure_column("knowledge_ingestion_jobs", "diagnostic_event_count", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("knowledge_ingestion_jobs", "last_diagnostic_message", "TEXT")
        # W7 P1: 선행 스캔의 보류(UNSTABLE) 건수를 잡 카드 배지로 노출하기 위해 보존.
        self._ensure_column("knowledge_ingestion_jobs", "unstable_count", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("knowledge_documents", "file_hash", "TEXT")
        self._ensure_column("knowledge_documents", "ingestion_signature", "TEXT")
        # T-01 Work-Aware 분류체계 태깅 컬럼 (비파괴 마이그레이션)
        self._ensure_column("knowledge_wiki_docs", "work_area_slug", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("knowledge_wiki_docs", "doc_role", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("knowledge_wiki_docs", "tag_confidence", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("knowledge_wiki_docs", "family_id", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("knowledge_wiki_docs", "family_role", "TEXT NOT NULL DEFAULT ''")
        # W7 P0 증분 정합: 재인제스트 시 요약 stale 표기 + enrich 실패 백오프 (비파괴 마이그레이션)
        self._ensure_column("knowledge_wiki_docs", "summary_stale", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("knowledge_wiki_docs", "enrich_fail_count", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("knowledge_wiki_docs", "enrich_skip", "INTEGER NOT NULL DEFAULT 0")
        # W7 P2a §5.2: 사용자 확정 태그 보존(tag_locked) + apply 취소 부분 상태 봉합(run_id)
        self._ensure_column("knowledge_wiki_docs", "tag_locked", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("knowledge_tag_queue", "run_id", "TEXT NOT NULL DEFAULT ''")
        # W7 P2b §5.5 소프트 삭제: 원본 소실 문서를 30일 유예 보관(missing)한다.
        self._ensure_column("knowledge_wiki_docs", "status", "TEXT NOT NULL DEFAULT 'active'")
        self._ensure_column("knowledge_wiki_docs", "missing_since", "TEXT")
        # W7 P2b §5.6 카드 정체성: 불변 8자 doc_uid — 슬러그 안정화·인용 폴백 키.
        self._ensure_column("knowledge_wiki_docs", "doc_uid", "TEXT NOT NULL DEFAULT ''")
        # W7 P2b §5.7 사용자 메모 보존: 시스템 작성본 정규화 해시 + 카드 patch 실패 재시도 플래그.
        self._ensure_column("knowledge_wiki_docs", "card_hash", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("knowledge_wiki_docs", "card_dirty", "INTEGER NOT NULL DEFAULT 0")
        # W7 P3 §5.9 분류체계 드리프트: 확정 폴더 vs 현재 1단계 폴더 diff 제안(자동 재구성 금지).
        self._ensure_column("knowledge_taxonomy", "drift_json", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("knowledge_document_chunks", "embedding_model", "TEXT NOT NULL DEFAULT 'hash'")
        self._ensure_column("knowledge_document_chunks", "embedding_json", "TEXT NOT NULL DEFAULT '[]'")
        self._ensure_column("content_bases", "source_session_id", "TEXT")
        self._ensure_column("content_bases", "outline", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("content_bases", "document_format", "TEXT NOT NULL DEFAULT 'auto'")
        self._ensure_column("content_bases", "audience_type", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("content_bases", "expected_length", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("content_bases", "urgency_level", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("content_bases", "needs_traceability", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("content_bases", "requires_official_form", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("content_bases", "requested_action", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("content_bases", "deadline", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("content_bases", "security_level", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("content_bases", "direct_file_paths_json", "TEXT NOT NULL DEFAULT '[]'")
        self._ensure_column("content_bases", "user_template_path", "TEXT")
        self.fts5_available = self._ensure_knowledge_fts()
        self.connection.commit()

    def _ensure_knowledge_fts(self) -> bool:
        """지식위키 전문 검색용 FTS5 가상 테이블을 준비한다.

        contentless(content='')나 external-content 방식 대신 자체 저장(standalone)
        FTS5 테이블을 사용한다. 이유:
        1) snippet()/bm25()가 저장된 원문을 필요로 하므로 contentless는 발췌를 만들 수 없다.
        2) external-content는 트리거 동기화가 필요해 마이그레이션·복구가 복잡해진다.
        본문은 문서당 200KB로 캡핑해 저장 중복을 제한하고, 문서 갱신 시 delete+insert로
        일관성을 유지한다. tokenize='trigram'은 한국어(3자 이상) 질의를 지원하며,
        3자 미만 질의는 knowledge_wiki_docs.norm_* 컬럼 LIKE 폴백으로 처리한다.
        """
        try:
            self.connection.execute(
                "CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts "
                "USING fts5(doc_id UNINDEXED, title, body, card, tokenize='trigram')"
            )
            return True
        except sqlite3.OperationalError:
            return False

    @contextmanager
    def read_connection(self) -> Iterator[sqlite3.Connection]:
        db_uri = f"file:{quote(str(self.paths.db_file), safe=':/')}?mode=ro"
        connection = sqlite3.connect(db_uri, uri=True, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        try:
            yield connection
        finally:
            connection.close()

    def _ensure_column(self, table: str, column: str, definition: str) -> None:
        with self._lock:
            columns = {
                row["name"]
                for row in self.connection.execute(f"PRAGMA table_info({table})").fetchall()
            }
            if column not in columns:
                self.connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    @contextmanager
    def transaction(self) -> Iterator[None]:
        with self._lock:
            outermost = self._transaction_depth == 0
            if outermost:
                self.connection.execute("BEGIN IMMEDIATE")
            self._transaction_depth += 1
            try:
                yield
            except Exception:
                self._transaction_depth -= 1
                if outermost:
                    self.connection.rollback()
                raise
            else:
                self._transaction_depth -= 1
                if outermost:
                    self.connection.commit()

    def insert(self, table: str, payload: dict[str, Any]) -> dict[str, Any]:
        columns = ", ".join(payload.keys())
        placeholders = ", ".join("?" for _ in payload)
        with self._lock:
            self.connection.execute(
                f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
                tuple(payload.values()),
            )
            if self._transaction_depth == 0:
                self.connection.commit()
        return payload

    def fetch_all(self, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self._lock:
            rows = self.connection.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def fetch_one(self, query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        with self._lock:
            row = self.connection.execute(query, params).fetchone()
        return dict(row) if row else None

    def fetch_all_readonly(self, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.read_connection() as connection:
            rows = connection.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def fetch_one_readonly(self, query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        with self.read_connection() as connection:
            row = connection.execute(query, params).fetchone()
        return dict(row) if row else None

    def execute(self, query: str, params: tuple[Any, ...] = ()) -> None:
        with self._lock:
            self.connection.execute(query, params)
            if self._transaction_depth == 0:
                self.connection.commit()

    def rollback(self) -> None:
        with self._lock:
            self.connection.rollback()

    def log(
        self,
        *,
        feature: str,
        action: str,
        status: str,
        inputs: dict[str, Any] | None = None,
        outputs: dict[str, Any] | None = None,
        approval_ticket_id: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "id": str(uuid4()),
            "feature": feature,
            "action": action,
            "status": status,
            "inputs_json": json.dumps(inputs or {}, ensure_ascii=False),
            "outputs_json": json.dumps(outputs or {}, ensure_ascii=False),
            "approval_ticket_id": approval_ticket_id,
            "created_at": now_iso(),
        }
        self.insert("execution_logs", payload)
        return {
            "id": payload["id"],
            "feature": feature,
            "action": action,
            "status": status,
            "inputs": inputs or {},
            "outputs": outputs or {},
            "approval_ticket_id": approval_ticket_id,
            "created_at": payload["created_at"],
        }

    def list_logs(self, limit: int = 50) -> list[dict[str, Any]]:
        bounded_limit = max(1, min(limit, 500))
        rows = self.fetch_all_readonly("SELECT * FROM execution_logs ORDER BY created_at DESC LIMIT ?", (bounded_limit,))
        return [
            {
                "id": row["id"],
                "feature": row["feature"],
                "action": row["action"],
                "status": row["status"],
                "inputs": json.loads(row["inputs_json"]),
                "outputs": json.loads(row["outputs_json"]),
                "approval_ticket_id": row["approval_ticket_id"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def create_approval_ticket(
        self,
        *,
        target_type: str,
        target_id: str,
        action: str,
        status: str = "pending",
        decision_note: str | None = None,
        target_label: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "id": str(uuid4()),
            "target_type": target_type,
            "target_id": target_id,
            "action": action,
            "status": status,
            "requested_at": now_iso(),
            "decided_at": now_iso() if status != "pending" else None,
            "decision_note": decision_note,
            "target_label": target_label,
        }
        self.insert("approval_tickets", payload)
        return payload
