from __future__ import annotations

from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from .db import Database, now_iso
from .documents import DocumentManager
from .file_organizer import FileOrganizer
from .knowledge import KnowledgeManager
from .settings import SidecarSettings, WorkspaceSettingsResponse
from .tools import TOOLS
from .workspace import WorkspacePaths, ensure_workspace


class ScheduleCreate(BaseModel):
    title: str
    starts_at: str
    ends_at: str
    view: Literal["month", "week", "list"] = "list"


class WorkSessionCreate(BaseModel):
    title: str
    schedule_id: str | None = None


class ReferenceItemInput(BaseModel):
    kind: str
    label: str
    value: str


class ReferenceSetCreate(BaseModel):
    title: str
    session_id: str | None = None
    items: list[ReferenceItemInput] = Field(default_factory=list)


class CandidateFromNote(BaseModel):
    title: str
    body: str
    candidate_type: Literal["topic", "project", "issue", "entity"] = "topic"


class CandidateApproveRequest(BaseModel):
    page_type: Literal["topic", "project", "issue", "entity"] = "topic"


class ContentBaseCreate(BaseModel):
    title: str
    purpose: str
    reference_set_id: str | None = None
    template_key: Literal["report", "meeting", "review"] = "report"


class FinalDocumentFinalizeRequest(BaseModel):
    content_base_id: str
    output_name: str


class AnythingLaunchRequest(BaseModel):
    query: str | None = None


class AnythingLaunchImportRequest(BaseModel):
    title: str
    session_id: str | None = None
    paths: list[str] = Field(default_factory=list)


class FileProposalRequest(BaseModel):
    target_path: str


class ApprovalDecisionRequest(BaseModel):
    status: Literal["approved", "rejected"]
    decision_note: str | None = None


class AppServices:
    def __init__(self, workspace_root: Path | str | None = None) -> None:
        self.settings = SidecarSettings()
        self.paths: WorkspacePaths = ensure_workspace(workspace_root)
        self.db = Database(self.paths)
        self.knowledge = KnowledgeManager(self.paths, self.db)
        self.documents = DocumentManager(self.paths, self.db)
        self.file_organizer = FileOrganizer(self.paths, self.db)

    def create_schedule(self, payload: ScheduleCreate) -> dict[str, Any]:
        record = {
            "id": str(uuid4()),
            "title": payload.title,
            "starts_at": payload.starts_at,
            "ends_at": payload.ends_at,
            "view": payload.view,
            "created_at": now_iso(),
        }
        self.db.insert("schedules", record)
        self.db.log(
            feature="schedule",
            action="schedule.created",
            status="success",
            inputs=payload.model_dump(),
            outputs={"schedule_id": record["id"]},
        )
        return record

    def list_schedules(self) -> list[dict[str, Any]]:
        return self.db.fetch_all("SELECT * FROM schedules ORDER BY starts_at ASC")

    def create_work_session(self, payload: WorkSessionCreate) -> dict[str, Any]:
        record = {
            "id": str(uuid4()),
            "title": payload.title,
            "schedule_id": payload.schedule_id,
            "status": "open",
            "created_at": now_iso(),
        }
        self.db.insert("work_sessions", record)
        self.db.log(
            feature="chat",
            action="work_session.created",
            status="success",
            inputs=payload.model_dump(),
            outputs={"session_id": record["id"]},
        )
        return record

    def list_work_sessions(self) -> list[dict[str, Any]]:
        return self.db.fetch_all("SELECT * FROM work_sessions ORDER BY created_at DESC")

    def create_reference_set(self, payload: ReferenceSetCreate) -> dict[str, Any]:
        record = {
            "id": str(uuid4()),
            "title": payload.title,
            "session_id": payload.session_id,
            "created_at": now_iso(),
        }
        self.db.insert("reference_sets", record)
        items = []
        for item in payload.items:
            stored = {
                "id": str(uuid4()),
                "reference_set_id": record["id"],
                "kind": item.kind,
                "label": item.label,
                "value": item.value,
                "created_at": now_iso(),
            }
            self.db.insert("reference_items", stored)
            items.append(
                {
                    "id": stored["id"],
                    "kind": item.kind,
                    "label": item.label,
                    "value": item.value,
                }
            )
        self.db.log(
            feature="references",
            action="reference_set.created",
            status="success",
            inputs=payload.model_dump(),
            outputs={"reference_set_id": record["id"], "item_count": len(items)},
        )
        return {
            "id": record["id"],
            "title": record["title"],
            "session_id": record["session_id"],
            "items": items,
            "created_at": record["created_at"],
        }

    def list_reference_sets(self) -> list[dict[str, Any]]:
        rows = self.db.fetch_all("SELECT * FROM reference_sets ORDER BY created_at DESC")
        result = []
        for row in rows:
            items = self.db.fetch_all(
                "SELECT id, kind, label, value FROM reference_items WHERE reference_set_id = ? ORDER BY created_at ASC",
                (row["id"],),
            )
            result.append(
                {
                    "id": row["id"],
                    "title": row["title"],
                    "session_id": row["session_id"],
                    "items": items,
                    "created_at": row["created_at"],
                }
            )
        return result

    def create_anything_launch_ticket(self, payload: AnythingLaunchRequest) -> dict[str, Any]:
        query = (payload.query or "").strip() or "Anything"
        ticket = self.db.create_approval_ticket(
            target_type="external_launch",
            target_id=str(uuid4()),
            action="anything.launch",
        )
        launch_request = {
            "id": str(uuid4()),
            "approval_ticket_id": ticket["id"],
            "query": query,
            "launch_target": f"es:{quote(query)}",
            "status": "pending",
            "created_at": now_iso(),
            "applied_at": None,
        }
        self.db.insert("anything_launch_requests", launch_request)
        self.db.log(
            feature="search",
            action="anything.launch.requested",
            status="pending_approval",
            inputs={"query": query},
            outputs={
                "approval_ticket_id": ticket["id"],
                "launch_request_id": launch_request["id"],
                "launch_target": launch_request["launch_target"],
            },
            approval_ticket_id=ticket["id"],
        )
        return {
            "approval_ticket": ticket,
            "launch_request": launch_request,
        }

    def list_anything_launches(self) -> list[dict[str, Any]]:
        return self.db.fetch_all(
            "SELECT * FROM anything_launch_requests ORDER BY created_at DESC"
        )

    def apply_anything_launch(self, ticket_id: str) -> dict[str, Any]:
        launch_request = self.db.fetch_one(
            "SELECT * FROM anything_launch_requests WHERE approval_ticket_id = ?",
            (ticket_id,),
        )
        if launch_request is None:
            raise KeyError(ticket_id)

        ticket = self.db.fetch_one(
            "SELECT * FROM approval_tickets WHERE id = ?",
            (ticket_id,),
        )
        if ticket is None:
            raise KeyError(ticket_id)
        if ticket["status"] != "approved":
            raise PermissionError(ticket_id)

        if launch_request["status"] != "applied":
            applied_at = now_iso()
            self.db.execute(
                "UPDATE anything_launch_requests SET status = ?, applied_at = ? WHERE approval_ticket_id = ?",
                ("applied", applied_at, ticket_id),
            )
            self.db.log(
                feature="search",
                action="anything.launch.applied",
                status="success",
                inputs={
                    "approval_ticket_id": ticket_id,
                    "query": launch_request["query"],
                },
                outputs={
                    "launch_request_id": launch_request["id"],
                    "launch_target": launch_request["launch_target"],
                },
                approval_ticket_id=ticket_id,
            )

        launch_request = self.db.fetch_one(
            "SELECT * FROM anything_launch_requests WHERE approval_ticket_id = ?",
            (ticket_id,),
        )
        return {
            "approval_ticket": ticket,
            "launch_request": launch_request,
        }

    def import_anything_launch_reference_set(
        self, ticket_id: str, payload: AnythingLaunchImportRequest
    ) -> dict[str, Any]:
        launch_request = self.db.fetch_one(
            "SELECT * FROM anything_launch_requests WHERE approval_ticket_id = ?",
            (ticket_id,),
        )
        if launch_request is None:
            raise KeyError(ticket_id)
        if launch_request["status"] != "applied":
            raise PermissionError(ticket_id)

        reference_set = self.create_reference_set(
            ReferenceSetCreate(
                title=payload.title,
                session_id=payload.session_id,
                items=[
                    ReferenceItemInput(
                        kind="file",
                        label=Path(path).name or path,
                        value=path,
                    )
                    for path in payload.paths
                ],
            )
        )
        self.db.log(
            feature="search",
            action="anything.launch.imported",
            status="success",
            inputs={
                "approval_ticket_id": ticket_id,
                "title": payload.title,
                "session_id": payload.session_id,
                "path_count": len(payload.paths),
            },
            outputs={
                "reference_set_id": reference_set["id"],
                "launch_request_id": launch_request["id"],
            },
            approval_ticket_id=ticket_id,
        )
        return {
            "launch_request": launch_request,
            "reference_set": reference_set,
        }

    def list_approval_tickets(self) -> list[dict[str, Any]]:
        return self.db.fetch_all(
            "SELECT * FROM approval_tickets ORDER BY requested_at DESC"
        )

    def decide_approval_ticket(self, ticket_id: str, payload: ApprovalDecisionRequest) -> dict[str, Any]:
        existing = self.db.fetch_one(
            "SELECT * FROM approval_tickets WHERE id = ?",
            (ticket_id,),
        )
        if existing is None:
            raise KeyError(ticket_id)

        decided_at = now_iso()
        self.db.execute(
            "UPDATE approval_tickets SET status = ?, decided_at = ?, decision_note = ? WHERE id = ?",
            (payload.status, decided_at, payload.decision_note, ticket_id),
        )
        updated = self.db.fetch_one(
            "SELECT * FROM approval_tickets WHERE id = ?",
            (ticket_id,),
        )
        self.db.log(
            feature="approval",
            action="approval_ticket.decided",
            status=payload.status,
            inputs={"ticket_id": ticket_id, **payload.model_dump()},
            outputs={
                "target_type": updated["target_type"],
                "target_id": updated["target_id"],
                "action": updated["action"],
            },
            approval_ticket_id=ticket_id,
        )
        return updated

    def propose_file_organization(self, target_path: str) -> list[dict[str, Any]]:
        path = Path(target_path)
        proposals = []
        if path.exists() and path.is_dir():
            candidates = sorted(path.iterdir(), key=lambda candidate: candidate.name.lower())[:10]
            for candidate in candidates:
                proposal_type = "knowledge_candidate" if candidate.suffix.lower() in {".md", ".txt"} else "archive"
                destination = (
                    self.paths.knowledge_raw / candidate.name
                    if proposal_type == "knowledge_candidate"
                    else self.paths.root / "archive" / candidate.name
                )
                proposal = {
                    "id": str(uuid4()),
                    "target_path": str(candidate),
                    "proposal_type": proposal_type,
                    "proposed_destination": str(destination),
                    "reason": "최근 변경분을 지식 반영 또는 보관 후보로 제안합니다.",
                    "status": "proposed",
                    "created_at": now_iso(),
                }
                self.db.insert("file_org_proposals", proposal)
                proposals.append(proposal)
        self.db.log(
            feature="fileorg",
            action="file_org.proposals.created",
            status="success",
            inputs={"target_path": target_path},
            outputs={"proposal_count": len(proposals)},
        )
        return proposals

    def list_file_organization_proposals(self) -> list[dict[str, Any]]:
        return self.db.fetch_all(
            "SELECT * FROM file_org_proposals ORDER BY created_at DESC"
        )


def create_app(workspace_root: Path | str | None = None) -> FastAPI:
    services = AppServices(workspace_root)
    app = FastAPI(title="gongmu-sidecar", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.services = services
    app.state.test_client_factory = lambda: TestClient(app)

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "workspace_root": str(services.paths.root),
            "database": str(services.paths.db_file),
        }

    @app.get("/api/settings", response_model=WorkspaceSettingsResponse)
    def get_settings() -> WorkspaceSettingsResponse:
        return WorkspaceSettingsResponse(
            defaults={
                "llm_mode": services.settings.llm_mode,
                "anything_launch_mode": services.settings.anything_launch_mode,
                "default_template_key": services.settings.default_template_key,
                "internal_api_base_url": services.settings.internal_api_base_url,
            },
            paths={
                "workspace_root": str(services.paths.root),
                "database": str(services.paths.db_file),
                "knowledge_root": str(services.paths.knowledge_root),
                "documents_root": str(services.paths.documents_root),
            },
        )

    @app.get("/api/templates")
    def templates() -> dict[str, Any]:
        return {
            "items": [
                {"key": "report", "label": "보고서형"},
                {"key": "meeting", "label": "회의자료형"},
                {"key": "review", "label": "검토메모형"},
            ]
        }

    @app.get("/api/tools")
    def list_tools() -> dict[str, Any]:
        return {"items": TOOLS}

    @app.post("/api/schedules", status_code=201)
    def create_schedule(payload: ScheduleCreate) -> dict[str, Any]:
        return services.create_schedule(payload)

    @app.get("/api/schedules")
    def list_schedules() -> dict[str, Any]:
        return {"items": services.list_schedules()}

    @app.post("/api/work-sessions", status_code=201)
    def create_work_session(payload: WorkSessionCreate) -> dict[str, Any]:
        return services.create_work_session(payload)

    @app.get("/api/work-sessions")
    def list_work_sessions() -> dict[str, Any]:
        return {"items": services.list_work_sessions()}

    @app.post("/api/reference-sets", status_code=201)
    def create_reference_set(payload: ReferenceSetCreate) -> dict[str, Any]:
        return services.create_reference_set(payload)

    @app.get("/api/reference-sets")
    def list_reference_sets() -> dict[str, Any]:
        return {"items": services.list_reference_sets()}

    @app.post("/api/knowledge/candidates/from-note", status_code=201)
    def create_candidate(payload: CandidateFromNote) -> dict[str, Any]:
        return services.knowledge.create_candidate(
            title=payload.title,
            body=payload.body,
            candidate_type=payload.candidate_type,
        )

    @app.get("/api/knowledge/candidates")
    def list_candidates() -> dict[str, Any]:
        return {
            "items": services.db.fetch_all(
                "SELECT * FROM knowledge_candidates ORDER BY created_at DESC"
            )
        }

    @app.post("/api/knowledge/candidates/{candidate_id}/approve")
    def approve_candidate(candidate_id: str, payload: CandidateApproveRequest) -> dict[str, Any]:
        try:
            return services.knowledge.approve_candidate(candidate_id, payload.page_type)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="candidate not found") from exc

    @app.get("/api/knowledge/pages")
    def list_pages() -> dict[str, Any]:
        return {
            "items": services.db.fetch_all(
                "SELECT * FROM knowledge_pages ORDER BY created_at DESC"
            )
        }

    @app.get("/api/knowledge/search")
    def search_knowledge(query: str) -> dict[str, Any]:
        return services.knowledge.search(query)

    @app.get("/api/knowledge/graph")
    def knowledge_graph() -> dict[str, Any]:
        return services.knowledge.graph_summary()

    @app.post("/api/documents/content-bases", status_code=201)
    def create_content_base(payload: ContentBaseCreate) -> dict[str, Any]:
        return services.documents.create_content_base(
            title=payload.title,
            purpose=payload.purpose,
            reference_set_id=payload.reference_set_id,
            template_key=payload.template_key,
        )

    @app.post("/api/documents/finalize", status_code=202)
    def request_document_finalize(payload: FinalDocumentFinalizeRequest) -> dict[str, Any]:
        try:
            return services.documents.request_final_document_output(
                content_base_id=payload.content_base_id,
                output_name=payload.output_name,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="content base not found") from exc

    @app.post("/api/documents/finalize/{ticket_id}/apply", status_code=201)
    def apply_document_finalize(ticket_id: str) -> dict[str, Any]:
        try:
            return services.documents.apply_final_document_output(ticket_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="final document request not found") from exc
        except PermissionError as exc:
            raise HTTPException(status_code=409, detail="approval ticket must be approved") from exc

    @app.post("/api/integrations/anything/launch", status_code=202)
    def request_anything_launch(payload: AnythingLaunchRequest) -> dict[str, Any]:
        return services.create_anything_launch_ticket(payload)

    @app.get("/api/integrations/anything/launches")
    def list_anything_launches() -> dict[str, Any]:
        return {"items": services.list_anything_launches()}

    @app.post("/api/integrations/anything/launch/{ticket_id}/apply", status_code=201)
    def apply_anything_launch(ticket_id: str) -> dict[str, Any]:
        try:
            return services.apply_anything_launch(ticket_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="anything launch request not found") from exc
        except PermissionError as exc:
            raise HTTPException(status_code=409, detail="approval ticket must be approved") from exc

    @app.post("/api/integrations/anything/launch/{ticket_id}/reference-set", status_code=201)
    def import_anything_launch_reference_set(
        ticket_id: str, payload: AnythingLaunchImportRequest
    ) -> dict[str, Any]:
        try:
            return services.import_anything_launch_reference_set(ticket_id, payload)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="anything launch request not found") from exc
        except PermissionError as exc:
            raise HTTPException(status_code=409, detail="anything launch must be applied first") from exc

    @app.get("/api/approval-tickets")
    def list_approval_tickets() -> dict[str, Any]:
        return {"items": services.list_approval_tickets()}

    @app.post("/api/approval-tickets/{ticket_id}/decision")
    def decide_approval_ticket(
        ticket_id: str, payload: ApprovalDecisionRequest
    ) -> dict[str, Any]:
        try:
            return services.decide_approval_ticket(ticket_id, payload)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="approval ticket not found") from exc

    @app.post("/api/file-organizer/proposals")
    def create_file_org_proposals(payload: FileProposalRequest) -> dict[str, Any]:
        return {"items": services.propose_file_organization(payload.target_path)}

    @app.get("/api/file-organizer/proposals")
    def list_file_org_proposals() -> dict[str, Any]:
        return {"items": services.list_file_organization_proposals()}

    @app.post("/api/file-organizer/proposals/{proposal_id}/apply", status_code=202)
    def request_file_org_apply(proposal_id: str) -> dict[str, Any]:
        try:
            return services.file_organizer.request_apply(proposal_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="file organizer proposal not found") from exc

    @app.post("/api/file-organizer/proposals/{proposal_id}/apply/commit", status_code=201)
    def commit_file_org_apply(proposal_id: str) -> dict[str, Any]:
        try:
            return services.file_organizer.commit_apply(proposal_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="file organizer proposal not found") from exc
        except PermissionError as exc:
            raise HTTPException(status_code=409, detail="approval ticket must be approved") from exc

    @app.post("/api/file-organizer/operations/{operation_id}/rollback")
    def rollback_file_org(operation_id: str) -> dict[str, Any]:
        try:
            return services.file_organizer.rollback(operation_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="file organizer operation not found") from exc

    @app.get("/api/execution-logs")
    def list_execution_logs() -> dict[str, Any]:
        return {"items": services.db.list_logs()}

    return app
