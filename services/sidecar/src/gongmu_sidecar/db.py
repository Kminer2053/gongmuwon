from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
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

CREATE TABLE IF NOT EXISTS knowledge_sources (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    root_path TEXT NOT NULL,
    created_at TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS content_bases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    purpose TEXT NOT NULL,
    template_key TEXT NOT NULL,
    reference_set_id TEXT,
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

CREATE TABLE IF NOT EXISTS file_org_proposals (
    id TEXT PRIMARY KEY,
    target_path TEXT NOT NULL,
    proposal_type TEXT NOT NULL,
    proposed_destination TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Database:
    paths: WorkspacePaths

    def __post_init__(self) -> None:
        self.connection = sqlite3.connect(self.paths.db_file, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.executescript(SCHEMA)
        self.connection.commit()

    def insert(self, table: str, payload: dict[str, Any]) -> dict[str, Any]:
        columns = ", ".join(payload.keys())
        placeholders = ", ".join("?" for _ in payload)
        self.connection.execute(
            f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
            tuple(payload.values()),
        )
        self.connection.commit()
        return payload

    def fetch_all(self, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        rows = self.connection.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def fetch_one(self, query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        row = self.connection.execute(query, params).fetchone()
        return dict(row) if row else None

    def execute(self, query: str, params: tuple[Any, ...] = ()) -> None:
        self.connection.execute(query, params)
        self.connection.commit()

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
