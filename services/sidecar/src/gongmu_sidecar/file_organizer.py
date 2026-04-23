from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any
from uuid import uuid4

from .db import Database, now_iso
from .workspace import WorkspacePaths


class FileOrganizer:
    def __init__(self, paths: WorkspacePaths, db: Database) -> None:
        self.paths = paths
        self.db = db

    def request_apply(self, proposal_id: str) -> dict[str, Any]:
        proposal = self.db.fetch_one("SELECT * FROM file_org_proposals WHERE id = ?", (proposal_id,))
        if proposal is None:
            raise KeyError(proposal_id)
        if proposal["status"] == "pending_approval":
            raise ValueError("file organizer proposal already pending approval")
        if proposal["status"] == "applied":
            raise ValueError("file organizer proposal already applied")

        ticket = self.db.create_approval_ticket(
            target_type="file_org_apply",
            target_id=proposal_id,
            action="file_org.apply",
        )
        self.db.execute(
            "UPDATE file_org_proposals SET status = ? WHERE id = ?",
            ("pending_approval", proposal_id),
        )
        self.db.log(
            feature="fileorg",
            action="file_org.apply.requested",
            status="pending_approval",
            inputs={"proposal_id": proposal_id},
            outputs={"approval_ticket_id": ticket["id"]},
            approval_ticket_id=ticket["id"],
        )
        proposal["status"] = "pending_approval"
        return {"approval_ticket": ticket, "proposal": proposal}

    def commit_apply(self, proposal_id: str) -> dict[str, Any]:
        proposal = self.db.fetch_one("SELECT * FROM file_org_proposals WHERE id = ?", (proposal_id,))
        if proposal is None:
            raise KeyError(proposal_id)
        if proposal["status"] == "applied":
            raise ValueError("file organizer proposal already applied")
        if proposal["status"] != "pending_approval":
            raise ValueError("file organizer proposal is not pending approval")

        ticket = self.db.fetch_one(
            "SELECT * FROM approval_tickets WHERE target_id = ? AND action = ? ORDER BY requested_at DESC LIMIT 1",
            (proposal_id, "file_org.apply"),
        )
        if ticket is None:
            raise KeyError(proposal_id)
        if ticket["status"] != "approved":
            raise PermissionError(proposal_id)

        source = Path(proposal["target_path"])
        destination = self._available_destination_path(Path(proposal["proposed_destination"]))
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)

        operation = {
            "id": str(uuid4()),
            "proposal_id": proposal_id,
            "source_path": str(source),
            "destination_path": str(destination),
            "action": "copy",
            "approval_ticket_id": ticket["id"],
            "created_at": now_iso(),
            "rolled_back_at": None,
        }
        self.db.insert("file_org_operations", operation)
        self.db.execute(
            "UPDATE file_org_proposals SET status = ? WHERE id = ?",
            ("applied", proposal_id),
        )
        self.db.log(
            feature="fileorg",
            action="file_org.apply.committed",
            status="success",
            inputs={"proposal_id": proposal_id},
            outputs={"operation_id": operation["id"], "destination_path": str(destination)},
            approval_ticket_id=ticket["id"],
        )
        return {"operation": operation}

    def _available_destination_path(self, destination: Path) -> Path:
        if not destination.exists():
            return destination

        suffix = destination.suffix
        stem = destination.stem
        counter = 2
        while True:
            candidate = destination.with_name(f"{stem}-{counter}{suffix}")
            if not candidate.exists():
                return candidate
            counter += 1

    def rollback(self, operation_id: str) -> dict[str, Any]:
        operation = self.db.fetch_one("SELECT * FROM file_org_operations WHERE id = ?", (operation_id,))
        if operation is None:
            raise KeyError(operation_id)

        destination = Path(operation["destination_path"])
        if destination.exists():
            destination.unlink()

        rolled_back_at = now_iso()
        self.db.execute(
            "UPDATE file_org_operations SET rolled_back_at = ? WHERE id = ?",
            (rolled_back_at, operation_id),
        )
        self.db.execute(
            "UPDATE file_org_proposals SET status = ? WHERE id = ?",
            ("rolled_back", operation["proposal_id"]),
        )
        self.db.log(
            feature="fileorg",
            action="file_org.rollback",
            status="success",
            inputs={"operation_id": operation_id},
            outputs={"restored_path": operation["source_path"]},
        )
        return {"restored_path": operation["source_path"], "operation_id": operation_id}
