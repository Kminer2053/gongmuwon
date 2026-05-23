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

from .workspace import WorkspacePaths


SCHEMA = """
CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    view TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    schedule_id TEXT,
    status TEXT NOT NULL,
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
    decision_note TEXT
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
        self._ensure_column("knowledge_sources", "status", "TEXT NOT NULL DEFAULT 'active'")
        self._ensure_column("knowledge_sources", "last_scanned_at", "TEXT")
        self._ensure_column("knowledge_sources", "updated_at", "TEXT NOT NULL DEFAULT ''")
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
        self._ensure_column("knowledge_documents", "file_hash", "TEXT")
        self._ensure_column("knowledge_documents", "ingestion_signature", "TEXT")
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
        self.connection.commit()

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

    def list_logs(self) -> list[dict[str, Any]]:
        rows = self.fetch_all("SELECT * FROM execution_logs ORDER BY created_at DESC")
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
        }
        self.insert("approval_tickets", payload)
        return payload
