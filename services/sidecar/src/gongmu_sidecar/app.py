from __future__ import annotations

import json
import mimetypes
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from queue import Queue
from threading import Thread
from time import perf_counter
from typing import Any, Literal
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from .context_budget import (
    assemble_transcript_context,
    assemble_turn_context,
    deterministic_digest,
    LLM_SUMMARY_CAP,
)
from .db import Database, now_iso
from .document_authoring import (
    FORMAT_SCHEMAS,
    build_content_base_markdown,
    register_authoring_routes,
    run_authoring_stages,
    strip_structure_marker,
)
from .document_parsers import parse_document
from .documents import DocumentManager
from .job_runner import JobRunner
from .jobs import JobManager
from .kordoc_bridge import kordoc_status
from .knowledge import KnowledgeManager
from .knowledge_wiki import KnowledgeWikiManager
from .local_file_search import (
    compact_filename_text,
    scan_local_files_for_index,
    score_filename,
    search_local_files_by_name,
)
from .llm import LLMGenerationError, generate_session_reply, generate_session_reply_streaming
from .personalization import PersonalizationManager
from .settings import SidecarSettings, WorkspaceSettingsResponse, WorkspaceSettingsUpdate
from .tools import TOOLS
from .work_taxonomy import InvalidTagError, WorkTaxonomyManager
from .workspace import WorkspacePaths, ensure_workspace


class ScheduleCreate(BaseModel):
    title: str
    starts_at: str
    ends_at: str
    view: Literal["month", "week", "day"] = "day"
    # F-20: 분 단위 사전 알림 (None = 알림 없음)
    remind_before_minutes: int | None = Field(default=None, ge=0)


class ScheduleUpdate(BaseModel):
    title: str
    starts_at: str
    ends_at: str
    view: Literal["month", "week", "day"] = "day"
    remind_before_minutes: int | None = Field(default=None, ge=0)


class WorkSessionCreate(BaseModel):
    title: str
    schedule_id: str | None = None


class WorkSessionUpdate(BaseModel):
    schedule_id: str | None = None


class WorkSessionMessageCreate(BaseModel):
    role: Literal["user", "assistant"] = "user"
    text: str
    message_type: Literal["chat", "note", "system"] = "chat"
    status: Literal["pending", "streaming", "completed", "failed"] = "completed"
    provider: str | None = None
    model: str | None = None
    latency_ms: int | None = None


class WorkSessionTurnRequest(BaseModel):
    text: str
    attachment_ids: list[str] = Field(default_factory=list)
    model_override: str | None = None
    reasoning_effort: Literal["auto", "minimal", "low", "medium", "high"] = "auto"


class WorkSessionFileLinkInput(BaseModel):
    file_path: str
    label: str | None = None
    source: Literal["manual", "anything", "knowledge", "attachment"] = "manual"


class WorkSessionFileLinksCreate(BaseModel):
    items: list[WorkSessionFileLinkInput] = Field(default_factory=list)


class LLMConnectionTestRequest(BaseModel):
    prompt: str = "간단한 상태 점검 응답을 한 문장으로 돌려주세요."


class CandidateFromNote(BaseModel):
    title: str
    body: str
    candidate_type: Literal["topic", "project", "issue", "entity"] = "topic"


class CandidateApproveRequest(BaseModel):
    page_type: Literal["topic", "project", "issue", "entity"] = "topic"


class KnowledgeSourceCreate(BaseModel):
    label: str
    root_path: str


class KnowledgeIngestRequest(BaseModel):
    source_id: str
    run_now: bool = True
    background: bool = False


class KnowledgeRetrieveRequest(BaseModel):
    query: str
    session_id: str | None = None
    limit: int = 5


class KnowledgeEnrichRequest(BaseModel):
    source_id: str | None = None
    background: bool = True
    # P2a §5.4: 실행당 LLM 호출 상한 — 기본 20건(사용자 승인값), 초과분 이월.
    limit: int | None = None


class KnowledgeLintRequest(BaseModel):
    fix: bool = True
    deep: bool = False


class KnowledgeVerifyRequest(BaseModel):
    # P3 §6: quick 모드는 재해시 금지 — deep=True일 때만 전량 재해시(V11 silent change).
    deep: bool = False
    background: bool = False


class KnowledgeDocUidMigrateRequest(BaseModel):
    source_id: str | None = None


class KnowledgeParseDocumentRequest(BaseModel):
    file_path: str


class TaxonomyInterviewRequest(BaseModel):
    org_type: str = ""
    department: str = ""
    duty: str = ""
    purpose: str = ""


class TaxonomyWorkAreaInput(BaseModel):
    name: str
    folders: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)


class TaxonomyConfirmRequest(BaseModel):
    source_id: str
    work_areas: list[TaxonomyWorkAreaInput]
    doc_roles_enabled: list[str] = Field(default_factory=list)
    family_policy: str = "latest_representative"


class TaxonomyApplyRequest(BaseModel):
    source_id: str
    background: bool = False


class TaxonomyQueueResolveRequest(BaseModel):
    work_area_slug: str = ""
    doc_role: str = ""


class PersonalizationDecisionRequest(BaseModel):
    status: Literal["approved", "rejected"]


class ContentBaseCreate(BaseModel):
    title: str
    purpose: str
    template_key: Literal["report", "meeting", "review"] = "report"
    source_session_id: str | None = None
    outline: str = ""
    document_format: Literal["auto", "officialMemo", "onePageReport", "fullReport", "email"] = "auto"
    audience_type: str = ""
    expected_length: str = ""
    urgency_level: str = ""
    needs_traceability: str = ""
    requires_official_form: str = ""
    requested_action: str = ""
    deadline: str = ""
    security_level: str = ""
    direct_file_paths: list[str] = Field(default_factory=list)
    user_template_path: str | None = None


class FinalDocumentFinalizeRequest(BaseModel):
    content_base_id: str
    output_name: str


class DocumentGenerateRequest(ContentBaseCreate):
    output_name: str | None = None


class ApprovalDecisionRequest(BaseModel):
    status: Literal["approved", "rejected"]
    decision_note: str | None = None


class AppServices:
    def __init__(self, workspace_root: Path | str | None = None) -> None:
        self.paths: WorkspacePaths = ensure_workspace(workspace_root)
        self.settings = SidecarSettings.load(self.paths.config_file)
        self._ensure_personalization_root()
        self.db = Database(self.paths)
        self.jobs = JobManager(self.db)
        self.recovered_work_jobs = self.jobs.recover_interrupted_jobs()
        self.job_runner = JobRunner(self.jobs)
        self.knowledge = KnowledgeManager(self.paths, self.db)
        self.wiki = KnowledgeWikiManager(self.paths, self.db)
        # W7 P1 §4.3: 스캔의 MOVED 판정이 위키 rebind(경로 사본 7곳 전파)를
        # 파일당 단일 트랜잭션 안에서 호출할 수 있게 배선한다.
        self.knowledge.wiki_rebinder = self.wiki.rebind_moved_source_file
        # 이동이 있었던 스캔은 index.md를 바로 재생성해 구 슬러그 카드로의
        # 일시적 죽은 링크(다음 인제스트/lint까지)를 없앤다.
        self.knowledge.wiki_index_rebuilder = self.wiki.rebuild_index
        self.taxonomy = WorkTaxonomyManager(self.paths, self.db, self.wiki)
        # W7 P2a §5.3: 색인 내 증분 태깅·패밀리 국소 재평가가 dirty 업무 허브만
        # 축소 재작성할 수 있게 배선한다(순환 의존 없이 훅 주입).
        self.wiki.hub_refresher = self.taxonomy.refresh_hubs
        # W7 P3 §5.9: 스캔 완료 시 분류체계 드리프트 감지에 편승한다(제안 배지만).
        self.knowledge.drift_detector = self.taxonomy.detect_drift
        self.recovered_knowledge_jobs = self.wiki.recover_interrupted_jobs()
        self.personalization = PersonalizationManager(self.db)
        self.documents = DocumentManager(self.paths, self.db)

    @property
    def personalization_root(self) -> Path:
        if self.settings.personalization_root:
            return Path(self.settings.personalization_root).expanduser().resolve()
        return self.paths.personalization_root

    def _ensure_personalization_root(self) -> None:
        root = self.personalization_root
        for path in (
            root,
            root / "session-summaries",
            root / "work-patterns",
            root / "user-preferences",
            root / "entity-aliases",
            root / "extraction-rules",
            root / "feedback-signals",
            root / "audit-log",
        ):
            path.mkdir(parents=True, exist_ok=True)

    def analyze_work_session(self, session_id: str) -> dict[str, Any]:
        """'이 세션 지식 반영': 개인화 요약 저장 후 위키 업무 기록(work/) 페이지를 갱신한다."""
        result = self.personalization.analyze_session(
            session_id=session_id,
            apply_mode=self.settings.personalization_apply_mode,
            personalization_root=self.personalization_root,
        )
        session = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if session is None:
            raise KeyError(session_id)
        messages = self.db.fetch_all(
            "SELECT * FROM work_session_messages WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        )
        file_links = self.db.fetch_all(
            "SELECT * FROM work_session_file_links WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        )
        schedule = None
        if session.get("schedule_id"):
            schedule = self.db.fetch_one(
                "SELECT * FROM schedules WHERE id = ?", (session["schedule_id"],)
            )
        summary = ""
        try:
            proposed = json.loads(result["candidate"]["proposed_payload"])
            summary = str(proposed.get("summary") or "")
        except (KeyError, TypeError, ValueError):
            summary = ""
        work_page: dict[str, Any] | None = None
        try:
            work_page = self.wiki.write_work_page(
                session=session,
                messages=messages,
                file_links=file_links,
                summary=summary,
                schedule=schedule,
            )
            self.db.log(
                feature="knowledge",
                action="knowledge.wiki.work_page.updated",
                status="success",
                inputs={"session_id": session_id},
                outputs={
                    "slug": work_page["slug"],
                    "relative_path": work_page["relative_path"],
                    "cited_doc_count": len(work_page["cited_doc_slugs"]),
                },
            )
        except OSError as exc:
            self.db.log(
                feature="knowledge",
                action="knowledge.wiki.work_page.failed",
                status="failed",
                inputs={"session_id": session_id},
                outputs={"error": str(exc)},
            )
        return {**result, "wiki_work_page": work_page}

    def _wiki_llm_generate(self, messages: list[dict[str, Any]]) -> str | None:
        """지식위키 ask/enrich용 LLM 호출. 실패 시 None → 결정론 답변 유지."""
        try:
            result = generate_session_reply(self.settings, messages)
        except LLMGenerationError:
            return None
        return self._prepare_assistant_output_text(result.text)

    def _serialize_attachment(self, record: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": record["id"],
            "session_id": record["session_id"],
            "message_id": record.get("message_id"),
            "file_name": record["file_name"],
            "mime_type": record.get("mime_type"),
            "stored_path": record["stored_path"],
            "size_bytes": record["size_bytes"],
            "text_excerpt": record.get("text_excerpt"),
            "text_char_count": record.get("text_char_count"),
            "created_at": record["created_at"],
        }

    def _serialize_work_session_messages(self, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not records:
            return []

        message_ids = [record["id"] for record in records]
        placeholders = ", ".join("?" for _ in message_ids)
        attachments = self.db.fetch_all(
            f"SELECT * FROM work_session_attachments WHERE message_id IN ({placeholders}) ORDER BY created_at ASC",
            tuple(message_ids),
        )
        attachments_by_message: dict[str, list[dict[str, Any]]] = {}
        for attachment in attachments:
            attachments_by_message.setdefault(attachment["message_id"], []).append(
                self._serialize_attachment(attachment)
            )

        return [
            {
                **{key: value for key, value in record.items() if key != "citations_json"},
                "attachments": attachments_by_message.get(record["id"], []),
                "citations": self._parse_citations_json(record.get("citations_json")),
            }
            for record in records
        ]

    @staticmethod
    def _parse_citations_json(raw: str | None) -> list[dict[str, str]]:
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            return []
        if not isinstance(parsed, list):
            return []
        citations: list[dict[str, str]] = []
        for entry in parsed:
            if not isinstance(entry, dict):
                continue
            citations.append(
                {
                    "title": str(entry.get("title") or ""),
                    "file_path": str(entry.get("file_path") or ""),
                    "snippet": str(entry.get("snippet") or ""),
                    # §5.6: doc_uid — 원본 이동·삭제 시 위키 카드 폴백 키.
                    # 기존 3필드 인용(doc_uid 부재)은 빈 문자열로 하위호환.
                    "doc_uid": str(entry.get("doc_uid") or ""),
                }
            )
        return citations

    def _serialize_work_session(self, record: dict[str, Any]) -> dict[str, Any]:
        messages = self.db.fetch_all(
            "SELECT * FROM work_session_messages WHERE session_id = ? ORDER BY created_at ASC",
            (record["id"],),
        )
        return {
            **record,
            "messages": self._serialize_work_session_messages(messages),
        }

    def create_work_session_attachments(
        self, session_id: str, files: list[tuple[str, str | None, bytes]]
    ) -> list[dict[str, Any]]:
        existing = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if not existing:
            raise KeyError(session_id)

        attachment_root = self.paths.cache / "attachments" / session_id
        attachment_root.mkdir(parents=True, exist_ok=True)

        created: list[dict[str, Any]] = []
        for original_name, mime_type, payload in files:
            safe_name = Path(original_name or "attachment.bin").name or "attachment.bin"
            stored_name = f"{uuid4()}-{safe_name}"
            stored_path = attachment_root / stored_name
            stored_path.write_bytes(payload)

            excerpt: str | None = None
            guessed_mime = mime_type or mimetypes.guess_type(safe_name)[0]
            if guessed_mime and guessed_mime.startswith("text/"):
                excerpt = payload.decode("utf-8", errors="ignore")[:4000].strip() or None
            elif safe_name.lower().endswith((".md", ".txt", ".json", ".csv", ".py", ".ts", ".tsx", ".js")):
                excerpt = payload.decode("utf-8", errors="ignore")[:4000].strip() or None

            record = {
                "id": str(uuid4()),
                "session_id": session_id,
                "message_id": None,
                "file_name": safe_name,
                "mime_type": guessed_mime,
                "stored_path": str(stored_path),
                "size_bytes": len(payload),
                "text_excerpt": excerpt,
                "created_at": now_iso(),
            }
            self.db.insert("work_session_attachments", record)
            created.append(self._serialize_attachment(record))

        self.db.log(
            feature="chat",
            action="work_session.attachments.created",
            status="success",
            inputs={"session_id": session_id, "count": len(created)},
            outputs={"attachment_ids": [item["id"] for item in created]},
        )
        return created

    def assign_work_session_attachments(
        self, session_id: str, message_id: str, attachment_ids: list[str]
    ) -> list[dict[str, Any]]:
        if not attachment_ids:
            return []

        placeholders = ", ".join("?" for _ in attachment_ids)
        rows = self.db.fetch_all(
            f"SELECT * FROM work_session_attachments WHERE id IN ({placeholders})",
            tuple(attachment_ids),
        )
        by_id = {row["id"]: row for row in rows}
        attached: list[dict[str, Any]] = []
        for attachment_id in attachment_ids:
            row = by_id.get(attachment_id)
            if not row or row["session_id"] != session_id:
                continue
            self.db.execute(
                "UPDATE work_session_attachments SET message_id = ? WHERE id = ?",
                (message_id, attachment_id),
            )
            updated = self.db.fetch_one("SELECT * FROM work_session_attachments WHERE id = ?", (attachment_id,))
            if updated:
                attached.append(self._serialize_attachment(updated))
        return attached

    def _build_attachment_prompt_block(self, attachments: list[dict[str, Any]]) -> str:
        lines = ["[Attached files]"]
        for attachment in attachments:
            line = f"- {attachment['file_name']} ({attachment.get('mime_type') or 'unknown'}, {attachment['size_bytes']} bytes)"
            lines.append(line)
            if attachment.get("text_excerpt"):
                lines.append(f"  excerpt: {attachment['text_excerpt']}")
        return "\n".join(lines)

    def create_schedule(self, payload: ScheduleCreate) -> dict[str, Any]:
        record = {
            "id": str(uuid4()),
            "title": payload.title,
            "starts_at": payload.starts_at,
            "ends_at": payload.ends_at,
            "view": payload.view,
            "remind_before_minutes": payload.remind_before_minutes,
            "reminder_acknowledged_at": None,
            "reminder_notified_at": None,
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

    def update_schedule(self, schedule_id: str, payload: ScheduleUpdate) -> dict[str, Any]:
        existing = self.db.fetch_one("SELECT * FROM schedules WHERE id = ?", (schedule_id,))
        if not existing:
            raise KeyError(schedule_id)

        # 일정 내용이 바뀌면 알림 상태(확인/발생)를 초기화해 다시 알림이 가도록 한다.
        self.db.execute(
            """
            UPDATE schedules
            SET title = ?, starts_at = ?, ends_at = ?, view = ?,
                remind_before_minutes = ?, reminder_acknowledged_at = NULL, reminder_notified_at = NULL
            WHERE id = ?
            """,
            (
                payload.title,
                payload.starts_at,
                payload.ends_at,
                payload.view,
                payload.remind_before_minutes,
                schedule_id,
            ),
        )
        updated = self.db.fetch_one("SELECT * FROM schedules WHERE id = ?", (schedule_id,))
        assert updated is not None
        self.db.log(
            feature="schedule",
            action="schedule.updated",
            status="success",
            inputs={"schedule_id": schedule_id, **payload.model_dump()},
            outputs={"schedule_id": schedule_id},
        )
        return updated

    def delete_schedule(self, schedule_id: str) -> dict[str, Any]:
        existing = self.db.fetch_one("SELECT * FROM schedules WHERE id = ?", (schedule_id,))
        if not existing:
            raise KeyError(schedule_id)
        self.db.execute("UPDATE work_sessions SET schedule_id = NULL WHERE schedule_id = ?", (schedule_id,))
        self.db.execute("DELETE FROM schedules WHERE id = ?", (schedule_id,))
        self.db.log(
            feature="schedule",
            action="schedule.deleted",
            status="success",
            inputs={"schedule_id": schedule_id},
            outputs={"schedule_id": schedule_id, "title": existing["title"]},
        )
        return {"id": schedule_id, "deleted": True, "schedule": existing}

    @staticmethod
    def _parse_schedule_moment(value: Any) -> datetime | None:
        """일정 ISO 문자열 → aware datetime. naive 값은 로컬 시간으로 해석한다."""
        try:
            parsed = datetime.fromisoformat(str(value))
        except (TypeError, ValueError):
            return None
        return parsed.astimezone()

    def list_due_schedule_reminders(self) -> list[dict[str, Any]]:
        """F-20: 알림 창(starts_at - remind_before <= now < starts_at)에 들어온 미확인 일정.

        클라이언트가 기존 30초 heartbeat 로 이 목록을 폴링한다. 처음 목록에 실린
        시점(reminder_notified_at)에 실행기록(알림 발생)을 1회 남긴다.
        """
        now = datetime.now(timezone.utc)
        rows = self.db.fetch_all(
            """
            SELECT * FROM schedules
            WHERE remind_before_minutes IS NOT NULL AND reminder_acknowledged_at IS NULL
            ORDER BY starts_at ASC
            """
        )
        due: list[dict[str, Any]] = []
        for row in rows:
            starts_at = self._parse_schedule_moment(row.get("starts_at"))
            if starts_at is None:
                continue
            try:
                window = timedelta(minutes=int(row["remind_before_minutes"]))
            except (TypeError, ValueError):
                continue
            if not (starts_at - window <= now < starts_at):
                continue
            if not row.get("reminder_notified_at"):
                notified_at = now_iso()
                self.db.execute(
                    "UPDATE schedules SET reminder_notified_at = ? WHERE id = ?",
                    (notified_at, row["id"]),
                )
                row["reminder_notified_at"] = notified_at
                self.db.log(
                    feature="schedule",
                    action="schedule.reminder.triggered",
                    status="success",
                    inputs={"schedule_id": row["id"]},
                    outputs={
                        "title": row["title"],
                        "starts_at": row["starts_at"],
                        "remind_before_minutes": row["remind_before_minutes"],
                    },
                )
            due.append(row)
        return due

    def acknowledge_schedule_reminder(self, schedule_id: str) -> dict[str, Any]:
        existing = self.db.fetch_one("SELECT * FROM schedules WHERE id = ?", (schedule_id,))
        if not existing:
            raise KeyError(schedule_id)
        acknowledged_at = now_iso()
        self.db.execute(
            "UPDATE schedules SET reminder_acknowledged_at = ? WHERE id = ?",
            (acknowledged_at, schedule_id),
        )
        updated = self.db.fetch_one("SELECT * FROM schedules WHERE id = ?", (schedule_id,))
        assert updated is not None
        self.db.log(
            feature="schedule",
            action="schedule.reminder.acknowledged",
            status="success",
            inputs={"schedule_id": schedule_id},
            outputs={"title": updated["title"], "acknowledged_at": acknowledged_at},
        )
        return updated

    def update_settings(self, payload: WorkspaceSettingsUpdate) -> WorkspaceSettingsResponse:
        self.settings = self.settings.apply_update(payload)
        self._ensure_personalization_root()
        self.settings.persist(self.paths.config_file)
        self.db.log(
            feature="settings",
            action="settings.updated",
            status="success",
            inputs=payload.model_dump(),
            outputs={
                "llm_mode": self.settings.llm_mode,
                "llm_provider": self.settings.llm_provider,
                "llm_model": self.settings.llm_model,
                "llm_api_key": "***" if self.settings.llm_api_key else None,
                "llm_site_url": self.settings.llm_site_url,
                "llm_application_name": self.settings.llm_application_name,
                "llm_profiles": self.settings.llm_profiles.model_dump(),
                "default_template_key": self.settings.default_template_key,
                "internal_api_base_url": self.settings.internal_api_base_url,
                "personalization_apply_mode": self.settings.personalization_apply_mode,
                "personalization_root": str(self.personalization_root),
                "embedding_provider": self.settings.embedding_provider,
                "embedding_model": self.settings.embedding_model,
                "embedding_base_url": self.settings.embedding_base_url,
                "embedding_fallback_enabled": self.settings.embedding_fallback_enabled,
                "graphrag_vector_backend": self.settings.graphrag_vector_backend,
                "knowledge_engine": self.settings.knowledge_engine,
            },
        )
        return WorkspaceSettingsResponse(
            defaults={
                "llm_mode": self.settings.llm_mode,
                "llm_provider": self.settings.llm_provider,
                "llm_model": self.settings.llm_model,
                "llm_api_key": self.settings.llm_api_key,
                "llm_site_url": self.settings.llm_site_url,
                "llm_application_name": self.settings.llm_application_name,
                "profiles": self.settings.llm_profiles,
                "default_template_key": self.settings.default_template_key,
                "internal_api_base_url": self.settings.internal_api_base_url,
                "personalization_apply_mode": self.settings.personalization_apply_mode,
                "embedding_provider": self.settings.embedding_provider,
                "embedding_model": self.settings.embedding_model,
                "embedding_base_url": self.settings.embedding_base_url,
                "embedding_fallback_enabled": self.settings.embedding_fallback_enabled,
                "graphrag_vector_backend": self.settings.graphrag_vector_backend,
                "knowledge_engine": self.settings.knowledge_engine,
            },
            paths={
                "workspace_root": str(self.paths.root),
                "database": str(self.paths.db_file),
                "knowledge_root": str(self.paths.knowledge_root),
                "documents_root": str(self.paths.documents_root),
                "personalization_root": str(self.personalization_root),
            },
        )

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
        return self._serialize_work_session(record)

    def list_work_sessions(self) -> list[dict[str, Any]]:
        return [
            self._serialize_work_session(item)
            for item in self.db.fetch_all("SELECT * FROM work_sessions ORDER BY created_at DESC")
        ]

    def update_work_session(self, session_id: str, payload: WorkSessionUpdate) -> dict[str, Any]:
        existing = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if not existing:
            raise KeyError(session_id)

        self.db.execute(
            "UPDATE work_sessions SET schedule_id = ? WHERE id = ?",
            (payload.schedule_id, session_id),
        )
        updated = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        assert updated is not None
        self.db.log(
            feature="chat",
            action="work_session.updated",
            status="success",
            inputs={"session_id": session_id, **payload.model_dump()},
            outputs={"session_id": session_id, "schedule_id": updated["schedule_id"]},
        )
        return self._serialize_work_session(updated)

    def reset_work_session_context(self, session_id: str) -> dict[str, Any]:
        existing = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if not existing:
            raise KeyError(session_id)
        # 세션에 누적된 롤링 요약(응답 맥락)을 비운다 — 이후 턴은 새 맥락으로 시작 (2026-07-08 리뷰).
        self.db.execute(
            "UPDATE work_sessions SET context_summary_text = NULL, context_summary_upto = NULL WHERE id = ?",
            (session_id,),
        )
        updated = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        assert updated is not None
        self.db.log(
            feature="chat",
            action="work_session.context.reset",
            status="success",
            inputs={"session_id": session_id},
            outputs={"session_id": session_id},
        )
        return self._serialize_work_session(updated)

    def list_work_session_file_links(self, session_id: str) -> list[dict[str, Any]]:
        existing = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if not existing:
            raise KeyError(session_id)
        return self.db.fetch_all(
            "SELECT * FROM work_session_file_links WHERE session_id = ? ORDER BY created_at DESC",
            (session_id,),
        )

    def create_work_session_file_links(
        self,
        session_id: str,
        payload: WorkSessionFileLinksCreate,
    ) -> list[dict[str, Any]]:
        existing = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if not existing:
            raise KeyError(session_id)

        created: list[dict[str, Any]] = []
        for item in payload.items:
            file_path = item.file_path.strip()
            if not file_path:
                continue
            label = (item.label or "").strip() or Path(file_path).name
            duplicate = self.db.fetch_one(
                "SELECT * FROM work_session_file_links WHERE session_id = ? AND file_path = ?",
                (session_id, file_path),
            )
            if duplicate is not None:
                self.db.execute(
                    "UPDATE work_session_file_links SET label = ?, source = ? WHERE id = ?",
                    (label, item.source, duplicate["id"]),
                )
                updated = self.db.fetch_one(
                    "SELECT * FROM work_session_file_links WHERE id = ?",
                    (duplicate["id"],),
                )
                if updated is not None:
                    created.append(updated)
                continue

            record = {
                "id": str(uuid4()),
                "session_id": session_id,
                "file_path": file_path,
                "label": label,
                "source": item.source,
                "created_at": now_iso(),
            }
            self.db.insert("work_session_file_links", record)
            created.append(record)

        self.db.log(
            feature="chat",
            action="work_session.file_links.created",
            status="success",
            inputs={"session_id": session_id, "count": len(payload.items)},
            outputs={"created_count": len(created)},
        )
        return created

    def delete_work_session_file_link(self, session_id: str, link_id: str) -> dict[str, Any]:
        existing = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if not existing:
            raise KeyError(session_id)
        link = self.db.fetch_one(
            "SELECT * FROM work_session_file_links WHERE id = ? AND session_id = ?",
            (link_id, session_id),
        )
        if not link:
            raise KeyError(link_id)

        self.db.execute("DELETE FROM work_session_file_links WHERE id = ?", (link_id,))
        self.db.log(
            feature="chat",
            action="work_session.file_link.deleted",
            status="success",
            inputs={"session_id": session_id, "link_id": link_id},
            outputs={"deleted": True},
        )
        return {"id": link_id, "deleted": True}

    def build_work_session_graph(self, session_id: str) -> dict[str, Any]:
        session = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if session is None:
            raise KeyError(session_id)

        nodes: list[dict[str, Any]] = [
            {
                "id": f"session:{session_id}",
                "label": session["title"],
                "node_type": "work_session",
            }
        ]
        edges: list[dict[str, Any]] = []
        seen_nodes = {f"session:{session_id}"}

        file_links = self.list_work_session_file_links(session_id)
        for link in file_links:
            linked_node_id = f"linked_file:{link['id']}"
            nodes.append(
                {
                    "id": linked_node_id,
                    "label": link["label"] or Path(link["file_path"]).name,
                    "node_type": "linked_file",
                    "path": link["file_path"],
                    "source": link["source"],
                }
            )
            seen_nodes.add(linked_node_id)
            edges.append(
                {
                    "source": f"session:{session_id}",
                    "target": linked_node_id,
                    "relation": "links_file",
                }
            )

            source_file = self.db.fetch_one(
                "SELECT * FROM knowledge_source_files WHERE file_path = ? AND status != ?",
                (link["file_path"], "deleted"),
            )
            if source_file is None:
                continue

            source_file_node_id = f"source_file:{source_file['id']}"
            if source_file_node_id not in seen_nodes:
                nodes.append(
                    {
                        "id": source_file_node_id,
                        "label": source_file["title"] or source_file["relative_path"],
                        "node_type": "source_file",
                        "path": source_file["file_path"],
                        "status": source_file["status"],
                    }
                )
                seen_nodes.add(source_file_node_id)
            edges.append(
                {
                    "source": linked_node_id,
                    "target": source_file_node_id,
                    "relation": "indexed_as",
                }
            )

            source = self.db.fetch_one(
                "SELECT * FROM knowledge_sources WHERE id = ?",
                (source_file["source_id"],),
            )
            if source is None:
                continue
            source_node_id = f"source_folder:{source['id']}"
            if source_node_id not in seen_nodes:
                nodes.append(
                    {
                        "id": source_node_id,
                        "label": source["label"],
                        "node_type": "source_folder",
                        "path": source["root_path"],
                    }
                )
                seen_nodes.add(source_node_id)
            edges.append(
                {
                    "source": source_node_id,
                    "target": source_file_node_id,
                    "relation": "contains",
                }
            )

        return {
            "session_id": session_id,
            "node_count": len(nodes),
            "edge_count": len(edges),
            "nodes": nodes,
            "edges": edges,
        }

    def create_work_session_message(
        self, session_id: str, payload: WorkSessionMessageCreate
    ) -> dict[str, Any]:
        existing = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if not existing:
            raise KeyError(session_id)

        record = {
            "id": str(uuid4()),
            "session_id": session_id,
            "role": payload.role,
            "text": payload.text.strip(),
            "message_type": payload.message_type,
            "status": payload.status,
            "provider": payload.provider,
            "model": payload.model,
            "latency_ms": payload.latency_ms,
            "citations_json": None,
            "created_at": now_iso(),
        }
        self.db.insert("work_session_messages", record)
        return {
            **{key: value for key, value in record.items() if key != "citations_json"},
            "attachments": [],
            "citations": [],
        }

    def list_work_session_messages(self, session_id: str) -> list[dict[str, Any]]:
        existing = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if not existing:
            raise KeyError(session_id)
        return self._serialize_work_session_messages(
            self.db.fetch_all(
                "SELECT * FROM work_session_messages WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,),
            )
        )

    def create_work_session_attachments(
        self, session_id: str, files: list[tuple[str, str | None, bytes]]
    ) -> list[dict[str, Any]]:
        existing = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if not existing:
            raise KeyError(session_id)

        attachment_root = self.paths.cache / "attachments" / session_id
        attachment_root.mkdir(parents=True, exist_ok=True)

        created: list[dict[str, Any]] = []
        for original_name, mime_type, payload in files:
            safe_name = Path(original_name or "attachment.bin").name or "attachment.bin"
            stored_path = attachment_root / f"{uuid4()}-{safe_name}"
            stored_path.write_bytes(payload)

            guessed_mime = mime_type or mimetypes.guess_type(safe_name)[0]
            excerpt: str | None = None
            text_char_count: int | None = None
            is_texty = bool(guessed_mime and guessed_mime.startswith("text/")) or safe_name.lower().endswith(
                (".md", ".txt", ".json", ".csv", ".js", ".ts", ".tsx", ".py")
            )
            if is_texty:
                decoded = payload.decode("utf-8", errors="ignore").strip()
                text_char_count = len(decoded) or None
                excerpt = decoded[:4000].strip() or None

            record = {
                "id": str(uuid4()),
                "session_id": session_id,
                "message_id": None,
                "file_name": safe_name,
                "mime_type": guessed_mime,
                "stored_path": str(stored_path),
                "size_bytes": len(payload),
                "text_excerpt": excerpt,
                "text_char_count": text_char_count,
                "created_at": now_iso(),
            }
            self.db.insert("work_session_attachments", record)
            created.append(self._serialize_attachment(record))

        self.db.log(
            feature="chat",
            action="work_session.attachments.created",
            status="success",
            inputs={"session_id": session_id, "count": len(created)},
            outputs={"attachment_ids": [item["id"] for item in created]},
        )
        return created

    def assign_work_session_attachments(
        self, session_id: str, message_id: str, attachment_ids: list[str]
    ) -> list[dict[str, Any]]:
        if not attachment_ids:
            return []

        placeholders = ", ".join("?" for _ in attachment_ids)
        rows = self.db.fetch_all(
            f"SELECT * FROM work_session_attachments WHERE id IN ({placeholders})",
            tuple(attachment_ids),
        )
        by_id = {row["id"]: row for row in rows}
        attached: list[dict[str, Any]] = []
        for attachment_id in attachment_ids:
            row = by_id.get(attachment_id)
            if not row or row["session_id"] != session_id:
                continue
            self.db.execute(
                "UPDATE work_session_attachments SET message_id = ? WHERE id = ?",
                (message_id, attachment_id),
            )
            updated = self.db.fetch_one("SELECT * FROM work_session_attachments WHERE id = ?", (attachment_id,))
            if updated:
                attached.append(self._serialize_attachment(updated))
        return attached

    def _build_attachment_prompt_block(self, attachments: list[dict[str, Any]]) -> str:
        lines = ["[Attached files]"]
        for attachment in attachments:
            lines.append(
                f"- {attachment['file_name']} ({attachment.get('mime_type') or 'unknown'}, {attachment['size_bytes']} bytes)"
            )
            excerpt = attachment.get("text_excerpt")
            if excerpt:
                # T-02: 발췌가 원문의 일부임을 모델·사용자 검증이 알 수 있게 표기.
                # (전체 FTS 색인 기반 질의연동 발췌는 W4+ 과제)
                total_chars = attachment.get("text_char_count") or len(excerpt)
                lines.append(f"  [첨부 발췌: 전체 {total_chars}자 중 {len(excerpt)}자]")
                lines.append(f"  excerpt: {excerpt}")
        return "\n".join(lines)

    def create_document_attachments(self, files: list[tuple[str, str | None, bytes]]) -> list[dict[str, Any]]:
        attachment_root = self.paths.cache / "document-attachments"
        attachment_root.mkdir(parents=True, exist_ok=True)

        created: list[dict[str, Any]] = []
        for original_name, mime_type, payload in files:
            safe_name = Path(original_name or "attachment.bin").name or "attachment.bin"
            stored_path = attachment_root / f"{uuid4()}-{safe_name}"
            stored_path.write_bytes(payload)

            guessed_mime = mime_type or mimetypes.guess_type(safe_name)[0]
            excerpt: str | None = None
            if guessed_mime and guessed_mime.startswith("text/"):
                excerpt = payload.decode("utf-8", errors="ignore")[:4000].strip() or None
            elif safe_name.lower().endswith((".md", ".txt", ".json", ".csv", ".js", ".ts", ".tsx", ".py")):
                excerpt = payload.decode("utf-8", errors="ignore")[:4000].strip() or None

            created.append(
                {
                    "id": str(uuid4()),
                    "file_name": safe_name,
                    "mime_type": guessed_mime,
                    "stored_path": str(stored_path),
                    "size_bytes": len(payload),
                    "text_excerpt": excerpt,
                    "created_at": now_iso(),
                }
            )

        self.db.log(
            feature="documents",
            action="documents.attachments.created",
            status="success",
            inputs={"count": len(created)},
            outputs={"paths": [item["stored_path"] for item in created]},
        )
        return created

    @staticmethod
    def _redact_sensitive_text(text: str) -> str:
        """Keep local RAG useful without echoing raw credentials into chat."""
        if not text:
            return text

        patterns = [
            re.compile(
                r"(?i)\b(password|passwd|pwd|api[_\s-]*key|secret|token|access[_\s-]*token|authorization|bearer)\b\s*[:=]\s*([^\s,;]+)"
            ),
            re.compile(r"(비밀번호|암호|패스워드|토큰|인증키|API\s*키)\s*[:=]\s*([^\s,;]+)"),
        ]
        redacted = text
        for pattern in patterns:
            redacted = pattern.sub(lambda match: f"{match.group(1)}: [보호됨]", redacted)
        redacted = re.sub(r"\b\d{6}-\d{7}\b", "[주민등록번호 보호됨]", redacted)
        return redacted

    @staticmethod
    def _strip_assistant_reasoning_trace(text: str) -> str:
        """Hide model scratchpad-style reasoning that some local models echo."""
        if not text:
            return text

        cleaned = re.sub(r"(?is)<think>.*?</think>", "", text)
        cleaned = re.sub(r"(?is)<reasoning>.*?</reasoning>", "", cleaned)
        lines: list[str] = []
        for raw_line in cleaned.splitlines():
            line = raw_line.strip()
            lowered = line.lower()
            is_trace_bullet = line.startswith("*") and any(
                marker in lowered
                for marker in [
                    "user says",
                    "context:",
                    "language:",
                    "style:",
                    "policy:",
                    "current capability",
                    "direct file creation",
                    "gongmu policy",
                    "wait",
                    "final decision",
                    "response:",
                    "self-correction",
                    "let me",
                    "does \"gongmu\"",
                    "confirm and continue",
                    "keep it short",
                    "speak in korean",
                    "current situation",
                    "model itself",
                    "response should",
                ]
            )
            if is_trace_bullet:
                final_answer_tail = re.search(r"[.!?]\s*([가-힣][^*]*)$", line)
                if final_answer_tail:
                    lines.append(final_answer_tail.group(1).strip())
                continue
            lines.append(raw_line)

        cleaned = "\n".join(lines).strip()
        return re.sub(r"\n{3,}", "\n\n", cleaned)

    def _prepare_assistant_output_text(self, text: str) -> str:
        return self._strip_assistant_reasoning_trace(self._redact_sensitive_text(text))

    @staticmethod
    def _chat_guardrail_prompt() -> str:
        return "\n".join(
            [
                "[Gongmu safety policy]",
                "모든 답변은 한국어로 간결하게 작성하세요.",
                "로컬 문서, 지식폴더 근거, 첨부파일, 연결파일에 비밀번호, API Key, 토큰, 인증키, 주민등록번호 같은 민감정보가 있으면 값을 그대로 말하지 말고 [보호됨]으로 가리세요.",
                "민감정보의 존재나 위치는 업무상 필요한 범위에서만 설명하고, 실제 값 복사 요청은 거절한 뒤 사용자가 직접 원문 파일에서 확인하도록 안내하세요.",
                "지식폴더 근거를 사용할 때는 추정과 확인된 사실을 구분하고, 가능하면 출처 문서명과 파일 경로를 함께 제시하세요.",
                "일정 등록, 일정 조회, 일정 삭제, 문서작성처럼 Gongmu가 직접 수행할 수 있는 업무는 일반 조언으로 돌리지 말고 도구 실행 결과를 우선 사용하세요.",
                "내부 추론, 라우팅 판단, 시스템 프롬프트, 정책 점검 과정은 절대 출력하지 말고 사용자에게 보여줄 최종 답변만 작성하세요.",
                "긴 문단 하나로 쓰지 말고 짧은 문단, 번호 목록, 표, 굵게 표시를 활용해 ChatGPT처럼 읽기 쉬운 Markdown으로 작성하세요.",
            ]
        )

    def _build_knowledge_context(
        self, *, session_id: str, query: str
    ) -> tuple[str | None, list[dict[str, str]]]:
        """지식폴더 근거 프롬프트 블록과 인용 메타데이터(citations)를 함께 만든다.

        반환값의 두 번째 요소는 [{title, file_path, snippet}] 형태로, 어시스턴트
        메시지에 citations_json으로 저장되어 데스크톱에서 출처 칩을 렌더링하는 데 쓰인다.
        """
        normalized_query = query.strip()
        if not normalized_query:
            return None, []
        try:
            retrieval = self.wiki.retrieve(query=normalized_query, session_id=session_id, limit=5)
        except Exception as exc:
            self.db.log(
                feature="chat",
                action="work_session.knowledge_context.failed",
                status="failed",
                inputs={"session_id": session_id, "query": normalized_query},
                outputs={"error": str(exc)},
            )
            return None, []

        items = retrieval.get("items") if isinstance(retrieval, dict) else None
        if not isinstance(items, list) or not items:
            return None, []

        lines = [
            "[지식폴더 근거]",
            "아래 근거는 사용자가 등록한 지식폴더 위키에서 검색한 로컬 근거입니다.",
            "답변에는 이 근거를 우선 반영하고, 각 내용 뒤에 (출처: 문서 제목) 형식으로 인용하세요. 파일 경로는 답변에 쓰지 마세요.",
        ]
        citations: list[dict[str, str]] = []
        for index, item in enumerate(items[:5], start=1):
            if not isinstance(item, dict):
                continue
            document = item.get("document") if isinstance(item.get("document"), dict) else {}
            title = str(document.get("title") or item.get("title") or "제목 없음")
            file_path = str(document.get("file_path") or item.get("file_path") or "")
            chunk = item.get("chunk") if isinstance(item.get("chunk"), dict) else {}
            text = str(item.get("text") or item.get("snippet") or chunk.get("text") or "").strip()
            text = self._redact_sensitive_text(text)
            if len(text) > 500:
                text = f"{text[:500]}..."
            lines.append(f"{index}. {title}")
            if file_path:
                lines.append(f"   원본: {file_path}")
            if text:
                lines.append(f"   발췌: {text}")
            snippet = text[:200] if text else ""
            citations.append(
                {
                    "title": title,
                    "file_path": file_path,
                    "snippet": snippet,
                    # §5.6: 인용 칩 '원본 열기' 폴백용 doc_uid (title/file_path/snippet 유지).
                    "doc_uid": str(item.get("doc_uid") or ""),
                }
            )

        prompt_block = "\n".join(lines).strip() or None
        return prompt_block, citations

    def _build_knowledge_prompt_block(self, *, session_id: str, query: str) -> str | None:
        prompt_block, _citations = self._build_knowledge_context(session_id=session_id, query=query)
        return prompt_block

    def _assemble_chat_prompt(
        self,
        *,
        session: dict[str, Any],
        session_id: str,
        assistant_message_id: str,
        attached_files: list[dict[str, Any]],
        graphrag_prompt_block: str | None,
    ) -> tuple[list[dict[str, Any]], bool, dict[str, int]]:
        """T-02: 턴 프롬프트를 컨텍스트 예산 안에서 조립한다.

        고정 순서: 가드레일 → 지식폴더 근거 → 첨부 발췌 → [이전 대화 요약] → 최근 N턴 원문.
        예산에서 밀려난 과거 턴은 세션 롤링 요약 블록으로 대표된다.
        """
        session_messages = [
            message
            for message in self.list_work_session_messages(session_id)
            if message["id"] != assistant_message_id and message.get("status") != "pending"
        ]
        attachment_block = (
            self._build_attachment_prompt_block(attached_files) if attached_files else None
        )
        return assemble_turn_context(
            guardrail_block=self._chat_guardrail_prompt(),
            knowledge_block=graphrag_prompt_block,
            attachment_block=attachment_block,
            session_messages=session_messages,
            rolling_summary=session.get("context_summary_text"),
            budget_tokens=self.settings.context_budget_tokens,
        )

    def _update_session_rolling_summary(
        self,
        session_id: str,
        *,
        user_text: str,
        assistant_text: str,
        upto_message_id: str,
    ) -> None:
        """T-02: 턴 성공 후 세션 롤링 요약을 증분 갱신한다.

        LLM이 구성돼 있으면 짧은 호출 1회(이전 요약 + 이번 턴 2메시지 → 5문장 요약).
        LLM 호출이 실패하면 결정론 다이제스트(사용자 첫 문장 bullet, 800자 제한)로
        대체하고, 그 외 예기치 못한 오류는 기존 요약을 유지한다. 어떤 경우에도
        턴 응답을 막거나 실패시키지 않는다.
        """
        try:
            row = self.db.fetch_one(
                "SELECT context_summary_text FROM work_sessions WHERE id = ?",
                (session_id,),
            )
        except Exception:
            return
        previous = (row or {}).get("context_summary_text")
        prompt = [
            {
                "role": "system",
                "text": (
                    "[대화 요약 갱신]\n"
                    "당신은 업무대화 세션의 롤링 요약기입니다. 이전 요약과 이번 턴의 두 메시지를 "
                    "반영해 갱신된 요약을 한국어 5문장 이내로만 출력하세요. "
                    "업무 사실(주제, 결정, 일정, 파일, 요청)만 남기고 인사말과 군더더기는 제외합니다."
                ),
            },
            {
                "role": "user",
                "text": (
                    f"[이전 요약]\n{previous or '(없음)'}\n\n"
                    f"[이번 턴 사용자]\n{str(user_text or '')[:2000]}\n\n"
                    f"[이번 턴 어시스턴트]\n{str(assistant_text or '')[:2000]}\n\n"
                    "갱신된 요약:"
                ),
            },
        ]
        new_summary: str | None
        try:
            result = generate_session_reply(self.settings, prompt)
            candidate = self._prepare_assistant_output_text(result.text or "").strip()
            new_summary = candidate[:LLM_SUMMARY_CAP] or previous
        except LLMGenerationError:
            new_summary = deterministic_digest(previous, user_text) or previous
        except Exception:
            return
        if not new_summary or new_summary == previous:
            return
        try:
            self.db.execute(
                "UPDATE work_sessions SET context_summary_text = ?, context_summary_upto = ? WHERE id = ?",
                (new_summary, upto_message_id, session_id),
            )
        except Exception:
            return

    def _try_run_work_session_skill(
        self,
        *,
        session_id: str,
        session: dict[str, Any],
        user_message: dict[str, Any],
        text: str,
    ) -> dict[str, Any] | None:
        normalized = text.strip()
        if not normalized:
            return None
        if self._looks_like_feature_usage_request(normalized):
            return self._run_feature_usage_guide(normalized)
        planned_intents = self._plan_work_session_intents(normalized)
        if len(planned_intents) > 1:
            return self._run_work_session_intent_plan(
                session_id=session_id,
                session=session,
                text=normalized,
                intents=planned_intents,
            )
        if self._looks_like_schedule_delete_request(normalized):
            return self._run_schedule_delete_skill(normalized)
        if self._looks_like_schedule_create_request(normalized):
            schedule_result = self._run_schedule_create_skill(normalized)
            if schedule_result is not None:
                return schedule_result
        if self._looks_like_schedule_list_request(normalized):
            return self._run_schedule_list_skill(normalized)
        if self._looks_like_document_create_request(normalized):
            return self._run_document_create_skill(session_id=session_id, session=session, text=normalized)
        return None

    def _plan_work_session_intents(self, text: str) -> list[str]:
        planned: list[str] = []
        if self._looks_like_schedule_delete_request(text):
            planned.append("schedule.delete")
        elif self._looks_like_schedule_create_request(text) and self._parse_schedule_request(text) is not None:
            planned.append("schedule.create")
        elif self._looks_like_schedule_list_request(text):
            planned.append("schedule.list")
        if self._looks_like_document_create_request(text):
            planned.append("documents.generate")
        return planned

    def _run_work_session_intent_plan(
        self,
        *,
        session_id: str,
        session: dict[str, Any],
        text: str,
        intents: list[str],
    ) -> dict[str, Any] | None:
        actions: list[str] = ["intent.plan"]
        results: list[dict[str, Any]] = [{"intents": intents}]
        sections = ["요청을 여러 작업으로 나누어 순서대로 처리했습니다."]

        # F-17: 앞 인텐트(일정 등록)의 결과를 뒤 문서작성 지시에 넘겨 일시·제목이 반영되게 한다.
        created_schedule: dict[str, Any] | None = None
        for intent in intents:
            skill_result: dict[str, Any] | None = None
            if intent == "schedule.delete":
                skill_result = self._run_schedule_delete_skill(text)
            elif intent == "schedule.create":
                skill_result = self._run_schedule_create_skill(text)
                if skill_result is not None:
                    for item in skill_result.get("results", []):
                        if isinstance(item, dict) and item.get("schedule_id"):
                            created_schedule = item
            elif intent == "schedule.list":
                skill_result = self._run_schedule_list_skill(text)
            elif intent == "documents.generate":
                document_text = text
                if created_schedule is not None:
                    schedule_row = self.db.fetch_one(
                        "SELECT title, starts_at, ends_at FROM schedules WHERE id = ?",
                        (created_schedule["schedule_id"],),
                    )
                    if schedule_row:
                        document_text = (
                            f"{text}\n\n[등록된 일정 정보 — 문서에 반드시 반영] "
                            f"제목: {schedule_row['title']}, "
                            f"일시: {schedule_row['starts_at']} ~ {schedule_row['ends_at']}"
                        )
                skill_result = self._run_document_create_skill(
                    session_id=session_id, session=session, text=document_text
                )

            if skill_result is None:
                continue
            actions.extend(str(action) for action in skill_result.get("actions", []))
            result_items = skill_result.get("results", [])
            if isinstance(result_items, list):
                results.extend(item for item in result_items if isinstance(item, dict))
            label = {
                "schedule.delete": "일정 삭제",
                "schedule.create": "일정 등록",
                "schedule.list": "일정 조회",
                "documents.generate": "문서작성",
            }.get(intent, intent)
            sections.extend(["", f"## {label}", str(skill_result.get("text") or "").strip()])

        if len(actions) == 1:
            return None
        return {
            "actions": actions,
            "results": results,
            "text": "\n".join(section for section in sections if section is not None).strip(),
        }

    @staticmethod
    def _looks_like_feature_usage_request(text: str) -> bool:
        lowered = text.lower()
        usage_markers = ["사용법", "어떻게", "안내", "설명", "도움말", "가이드", "help", "guide", "how to"]
        feature_markers = [
            "업무대화",
            "일정",
            "문서작성",
            "지식폴더",
            "실행기록",
            "환경설정",
        ]
        return any(marker in lowered for marker in usage_markers) and any(marker in text or marker in lowered for marker in feature_markers)

    @staticmethod
    def _run_feature_usage_guide(query: str) -> dict[str, Any]:
        lines = [
            "Gongmu 기능 사용법입니다.",
            "",
            "1. 업무대화",
            "- 작업을 자연어로 말하면 일정 조회/등록, 지식폴더 검색, 문서작성 같은 연계 기능을 먼저 시도합니다.",
            "- 답변에 출처가 있는 경우 파일 열기/폴더 열기 링크로 원문 위치를 확인할 수 있습니다.",
            "- 필요한 파일은 툴바의 [파일 연결] 버튼으로 검색해 현재 세션에 연결한 뒤 대화와 문서작성 근거로 사용할 수 있습니다.",
            "",
            "2. 일정",
            "- 캘린더 칸을 클릭해 일정을 등록하거나, 업무대화에서 '내일 오후 2시 회의 일정 등록'처럼 요청할 수 있습니다.",
            "",
            "3. 문서작성",
            "- 업무대화 세션, 연결 파일, 직접 입력한 개요를 작성 콘텐츠로 정리한 뒤 HWPX 산출로 이어갑니다.",
            "- 시행문, 1페이지 보고서, 풀버전 보고서, 이메일 형식 중 하나를 선택할 수 있습니다.",
            "",
            "4. 내 지식폴더",
            "- 업무 폴더를 등록한 뒤 색인 처리를 실행하면 지식위키가 만들어져 업무대화 검색 근거로 사용됩니다.",
            "",
            "5. 실행기록",
            "- 업무대화, 일정, 문서작성, 지식폴더 등에서 실행된 작업 이력과 승인 내역을 확인합니다.",
            "",
            "6. 환경설정",
            "- LLM 연결, 개인화, 지식폴더 색인 등 동작 방식을 프로필 단위로 관리합니다.",
        ]
        return {
            "actions": ["help.guide"],
            "results": [{"query": query, "guide_sections": 6}],
            "text": "\n".join(lines),
        }

    @staticmethod
    def _looks_like_schedule_create_request(text: str) -> bool:
        lowered = text.lower()
        action_marker = any(token in text for token in ["등록", "추가", "생성", "만들", "잡아", "예약"]) or any(
            token in lowered for token in ["add", "create", "register", "book", "schedule"]
        )
        has_schedule_marker = (
            "일정" in text
            or "스케줄" in text
            or "schedule" in lowered
            or "calendar" in lowered
            or (action_marker and any(token in text for token in ["회의", "미팅", "면담", "보고"]))
        )
        has_delete_marker = any(token in text for token in ["삭제", "지워", "취소"]) or any(
            token in lowered for token in ["delete", "remove", "cancel"]
        )
        if not has_schedule_marker or has_delete_marker:
            return False
        return action_marker

    @staticmethod
    def _looks_like_schedule_delete_request(text: str) -> bool:
        lowered = text.lower()
        has_schedule_marker = "일정" in text or "schedule" in lowered or "calendar" in lowered
        has_delete_marker = any(token in text for token in ["삭제", "지워", "취소"]) or any(
            token in lowered for token in ["delete", "remove", "cancel"]
        )
        return has_schedule_marker and has_delete_marker

    @staticmethod
    def _looks_like_schedule_list_request(text: str) -> bool:
        lowered = text.lower()
        has_schedule_marker = "일정" in text or "schedule" in lowered or "calendar" in lowered
        has_list_marker = any(token in text for token in ["확인", "보여", "조회", "알려"]) or any(
            token in lowered for token in ["show", "list", "check", "view"]
        )
        return has_schedule_marker and has_list_marker

    @staticmethod
    def _looks_like_document_create_request(text: str) -> bool:
        lowered = text.lower()
        has_document_marker = any(
            token in lowered
            for token in [
                "문서작성",
                "문서",
                "보고서",
                "보고서를",
                "보고서로",
                "공문",
                "시행문",
                "이메일",
                "메일",
                "hwpx",
                "hwp",
                "document",
                "report",
                "email",
            ]
        )
        if not has_document_marker:
            return False
        return any(
            token in lowered
            for token in [
                "작성",
                "생성",
                "만들",
                "정리",
                "산출",
                "제작",
                "파일로",
                "뽑아",
                "create",
                "write",
                "generate",
                "make",
                "export",
            ]
        )

    def _run_schedule_list_skill(self, text: str = "") -> dict[str, Any]:
        schedules = self.list_schedules()
        # F-15: "오늘/내일/이번 주/이번 달" 기간 한정어를 반영해 필터링한다.
        period_label = ""
        now = datetime.now()
        window: tuple[datetime, datetime] | None = None
        lowered = text.replace(" ", "")
        if "오늘" in lowered:
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            window, period_label = (start, start + timedelta(days=1)), "오늘"
        elif "내일" in lowered:
            start = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
            window, period_label = (start, start + timedelta(days=1)), "내일"
        elif "이번주" in lowered:
            start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=now.weekday())
            window, period_label = (start, start + timedelta(days=7)), "이번 주"
        elif "이번달" in lowered:
            start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            next_month = (start + timedelta(days=32)).replace(day=1)
            window, period_label = (start, next_month), "이번 달"
        if window is not None:
            def _in_window(schedule: dict[str, Any]) -> bool:
                try:
                    starts = datetime.fromisoformat(str(schedule["starts_at"]))
                except (ValueError, KeyError):
                    return True
                starts_naive = starts.replace(tzinfo=None) if starts.tzinfo else starts
                return window[0] <= starts_naive < window[1]
            schedules = [s for s in schedules if _in_window(s)]
        lines = [f"등록된 일정입니다.{f' ({period_label})' if period_label else ''}"]
        if not schedules:
            lines.append(f"- {period_label or '등록된'} 일정이 없습니다.")
        for schedule in schedules[:10]:
            lines.append(f"- {schedule['title']}: {schedule['starts_at']} ~ {schedule['ends_at']}")
        return {
            "actions": ["schedule.list"],
            "results": [{"count": len(schedules), "period": period_label or None}],
            "text": "\n".join(lines),
        }

    def _run_schedule_create_skill(self, text: str) -> dict[str, Any] | None:
        parsed = self._parse_schedule_request(text)
        if parsed is None:
            return None
        schedule = self.create_schedule(
            ScheduleCreate(
                title=parsed["title"],
                starts_at=parsed["starts_at"],
                ends_at=parsed["ends_at"],
                view="day",
            )
        )
        return {
            "actions": ["schedule.create"],
            "results": [{"schedule_id": schedule["id"], "title": schedule["title"]}],
            "text": (
                "일정을 등록했습니다.\n\n"
                f"- 제목: {schedule['title']}\n"
                f"- 시간: {schedule['starts_at']} ~ {schedule['ends_at']}"
            ),
        }

    def _run_schedule_delete_skill(self, text: str) -> dict[str, Any] | None:
        query = self._schedule_delete_query(text)
        schedules = self.list_schedules()
        matched = next(
            (
                schedule
                for schedule in schedules
                if query and (query in schedule["title"] or schedule["title"] in query)
            ),
            None,
        )
        if matched is None and len(schedules) == 1:
            matched = schedules[0]
        if matched is None:
            return {
                "actions": ["schedule.delete"],
                "results": [{"deleted": False, "query": query}],
                "text": f"삭제할 일정을 찾지 못했습니다. 검색어: {query or '없음'}",
            }
        deleted = self.delete_schedule(matched["id"])
        schedule = deleted["schedule"]
        return {
            "actions": ["schedule.delete"],
            "results": [{"schedule_id": schedule["id"], "title": schedule["title"], "deleted": True}],
            "text": f"일정을 삭제했습니다.\n\n- 제목: {schedule['title']}",
        }

    @staticmethod
    def _parse_schedule_request(text: str) -> dict[str, str] | None:
        date_match = re.search(
            r"(?P<date>\d{4}[-.]\d{1,2}[-.]\d{1,2})|(?:(?P<year>\d{4})년\s*)?(?P<month>\d{1,2})월\s*(?P<day>\d{1,2})일",
            text,
        )
        today = datetime.now(timezone(timedelta(hours=9)))
        if date_match:
            if date_match.group("date"):
                date_text = date_match.group("date").replace(".", "-")
                year, month, day = [int(part) for part in date_text.split("-")]
            else:
                year = int(date_match.group("year") or today.year)
                month = int(date_match.group("month"))
                day = int(date_match.group("day"))
        elif "내일" in text:
            next_day = today + timedelta(days=1)
            year, month, day = next_day.year, next_day.month, next_day.day
        elif "오늘" in text:
            year, month, day = today.year, today.month, today.day
        else:
            return None

        time_match = re.search(
            r"(?P<ampm>오전|오후|아침|저녁|밤)?\s*(?P<hour>\d{1,2})(?::(?P<minute_colon>\d{2})|\s*시(?:\s*(?P<minute_text>\d{1,2})\s*분?)?)",
            text,
        )
        if time_match is None:
            return None

        hour = int(time_match.group("hour"))
        minute = int(time_match.group("minute_colon") or time_match.group("minute_text") or "0")
        ampm = time_match.group("ampm") or ""
        if ampm in {"오후", "저녁", "밤"} and hour < 12:
            hour += 12
        if ampm in {"오전", "아침"} and hour == 12:
            hour = 0
        starts_at = datetime(year, month, day, hour, minute, tzinfo=timezone(timedelta(hours=9)))
        ends_at = starts_at + timedelta(hours=1)
        raw_title = text
        raw_title = re.sub(
            r"(?P<date>\d{4}[-.]\d{1,2}[-.]\d{1,2})|(?:(?P<year>\d{4})년\s*)?(?P<month>\d{1,2})월\s*(?P<day>\d{1,2})일|오늘|내일",
            " ",
            raw_title,
        )
        raw_title = re.sub(
            r"(오전|오후|아침|저녁|밤)?\s*\d{1,2}(?::\d{2}|\s*시(?:\s*\d{1,2}\s*분?)?)",
            " ",
            raw_title,
        )
        raw_title = re.sub(
            r"(업무일정|일정|스케줄|schedule|calendar)?\s*(등록|추가|생성|만들어?줘?|잡아줘?|예약해줘?|add|create|register|book).*",
            "",
            raw_title,
            flags=re.IGNORECASE,
        ).strip()
        raw_title = re.sub(r"\b(업무일정|일정|스케줄|등록|추가|생성|만들|잡아|예약)\b", " ", raw_title)
        raw_title = re.sub(r"\s+", " ", raw_title).strip(" .,-:")
        raw_title = re.sub(r"^(에|에서)\s+", "", raw_title).strip(" .,-:")
        title = raw_title or "새 일정"
        return {
            "title": title,
            "starts_at": starts_at.isoformat(),
            "ends_at": ends_at.isoformat(),
        }

    @staticmethod
    def _schedule_delete_query(text: str) -> str:
        query = re.sub(r"(일정|schedule|calendar)?\s*(삭제|지워|취소|delete|remove|cancel).*", "", text, flags=re.IGNORECASE).strip()
        query = query.replace("일정", "").strip()
        query = re.sub(r"\b(schedule|calendar)\b", "", query, flags=re.IGNORECASE).strip()
        return query

    def _run_document_create_skill(
        self,
        *,
        session_id: str,
        session: dict[str, Any],
        text: str,
    ) -> dict[str, Any]:
        document_format = self._document_format_from_text(text)
        if document_format not in FORMAT_SCHEMAS:  # "auto" 등 미지정 → 1페이지 보고서 기본
            document_format = "onePageReport"
        direct_paths = [
            row["file_path"]
            for row in self.list_work_session_file_links(session_id)
            if str(row.get("file_path") or "").strip()
        ]
        work_job = self.jobs.create_job(
            kind="documents.generate",
            title=f"{session['title']} HWPX 생성",
            input={
                "source": "work_session_skill",
                "session_id": session_id,
                "document_format": document_format,
                "linked_file_count": len(direct_paths),
            },
            resource_key=f"work_session:{session_id}:document",
            resource_policy="exclusive",
        )
        self.jobs.start_job(work_job["id"], stage="업무대화 컨텍스트 수집")

        # 2026-07-08 리뷰 P0: 업무대화 문서작성을 문서작성 UI와 "동일한" 고품질 파이프라인으로
        # 통일한다. 기존엔 LLM을 호출하지 않고 골격 템플릿(플레이스홀더·프롬프트 원문 에코)을 그대로
        # HWPX로 렌더해 산출물이 쓰레기였다. organize(LLM 정리)→format_to_schema(검증·repair)→
        # 구조마커 마크다운→결정적 HWPX. 대화 맥락(축약 transcript)과 연결파일 발췌를 근거로 준다.
        def _authoring_llm(messages: list[dict[str, Any]], *, temperature: float = 0.2) -> str:
            return generate_session_reply(self.settings, messages).text

        message_rows = self.db.fetch_all(
            "SELECT role, text FROM work_session_messages WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        )
        transcript, _budget_stats = assemble_transcript_context(
            session_messages=[dict(row) for row in message_rows],
            rolling_summary=session.get("context_summary_text"),
            budget_tokens=getattr(self.settings, "context_budget_tokens", 6000),
        )
        reference_texts = [
            excerpt
            for path in direct_paths
            if (excerpt := self.documents._safe_file_excerpt(path))
        ]

        # F-05: 지식폴더(위키) 근거를 문서작성에 주입한다 — 세션 연결파일만으로는
        # 실제 보유 문서와 모순되는 '허위 보고서'가 생성됐다(2026-07-11 E2E).
        wiki_citations: list[dict[str, Any]] = []
        try:
            retrieval = self.wiki.retrieve(query=text, session_id=session_id, limit=4)
            for item in retrieval.get("items", []):
                body = str(item.get("text") or item.get("snippet") or "").strip()
                if not body:
                    continue
                title = str(item.get("title") or "").strip() or "지식 문서"
                reference_texts.append(f"[지식폴더 근거: {title}]\n{body}")
                wiki_citations.append(
                    {"title": title, "file_path": str(item.get("file_path") or "")}
                )
        except Exception:  # noqa: BLE001 - 위키 검색 실패가 문서작성을 막지 않게
            pass

        # F-06: 근거가 하나도 없으면 '자료를 확인했다'류 단정 서술을 금지한다(정직성).
        instruction = text
        if not reference_texts:
            instruction = (
                f"{text}\n\n"
                "[중요] 참고자료가 제공되지 않았다. '자료를 확인한 결과', '검토 결과 파악했다' 등 "
                "근거를 확인한 듯한 표현을 쓰지 말고, 일반 초안임을 전제로 작성하라. "
                "지시에 없는 수치·사실을 창작하지 마라."
            )

        self.jobs.update_progress(work_job["id"], progress_percent=35, stage="AI 문서 구조 생성")
        structure: dict[str, Any] | None = None
        for stage_item in run_authoring_stages(
            _authoring_llm,
            format_key=document_format,
            instruction=instruction,
            reference_texts=reference_texts or None,
            transcript=transcript or None,
        ):
            if stage_item.get("done"):
                structure = stage_item["structure"]
        if structure is None:
            self.jobs.complete_job(work_job["id"], status="failed", stage="문서 구조 생성 실패")
            raise RuntimeError("문서 구조 생성에 실패했습니다.")

        markdown = build_content_base_markdown(document_format, structure)
        # F-16: 제목은 산출 구조의 제목을 우선 사용한다 — "<세션명> 문서"는 내용과 무관했다.
        structure_title = str(
            structure.get("title") or structure.get("subject") or ""
        ).strip()
        document_title = structure_title[:80] or f"{session['title']} 문서"
        content_base = self.documents.create_content_base(
            title=document_title,
            purpose="업무대화 세션 기반 자동 문서작성",
            template_key="report",
            source_session_id=session_id,
            outline="",  # 원시 프롬프트 에코 원천 차단
            document_format=document_format,
        )
        content_base_markdown_path = Path(content_base["artifact"]["path"])
        content_base_markdown_path.write_text(markdown, encoding="utf-8")
        try:
            Path(content_base["preview"]["path"]).write_text(
                self.documents._render_html(strip_structure_marker(markdown)),
                encoding="utf-8",
            )
        except (OSError, AttributeError, KeyError):
            pass

        finalize = self.documents.request_final_document_output(
            content_base_id=content_base["id"],
            output_name=content_base["title"],
        )
        ticket_id = finalize["approval_ticket"]["id"]
        self.jobs.update_progress(work_job["id"], progress_percent=70, stage="HWPX 산출 승인 적용")
        self.decide_approval_ticket(
            ticket_id,
            ApprovalDecisionRequest(status="approved", decision_note="업무대화 문서작성 스킬 자동 승인"),
        )
        applied = self.documents.apply_final_document_output(ticket_id)
        artifact = applied["artifact"]
        artifact_path = Path(artifact["path"])
        folder_path = artifact_path.parent
        completed_job = self.jobs.complete_job(
            work_job["id"],
            status="succeeded",
            result={
                "content_base_id": content_base["id"],
                "artifact_path": artifact["path"],
                "markdown_path": artifact["markdown_path"],
                "format": artifact["format"],
            },
            stage="HWPX 문서 생성 완료",
        )
        return {
            "actions": ["document.create"],
            "results": [
                {
                    "content_base_id": content_base["id"],
                    "work_job_id": completed_job["id"],
                    "work_job_status": completed_job["status"],
                    "artifact_path": artifact["path"],
                    "markdown_path": artifact["markdown_path"],
                    "folder_path": str(folder_path),
                    "format": artifact["format"],
                    "open_targets": [
                        {"label": "파일 열기", "target": artifact["path"]},
                        {"label": "폴더 열기", "target": str(folder_path)},
                    ],
                }
            ],
            "text": (
                "HWPX 문서를 생성했습니다.\n\n"
                f"- 제목: {content_base['title']}\n"
                f"- 형식: {artifact['format']}\n"
                f"- 파일 열기: {artifact['path']}\n"
                f"- 폴더 열기: {folder_path}\n"
                f"- 검토용 Markdown: {artifact['markdown_path']}\n"
                + (
                    "- 지식폴더 근거: "
                    + ", ".join(cite["title"] for cite in wiki_citations[:4])
                    if wiki_citations
                    else "- 지식폴더 근거: 없음 (근거 미확인 서술 방지 규칙 적용)"
                )
            ),
        }

    def generate_document_from_request(self, payload: DocumentGenerateRequest) -> dict[str, Any]:
        content_base = self.documents.create_content_base(
            title=payload.title,
            purpose=payload.purpose,
            template_key=payload.template_key,
            source_session_id=payload.source_session_id,
            outline=payload.outline,
            document_format=payload.document_format,
            audience_type=payload.audience_type,
            expected_length=payload.expected_length,
            urgency_level=payload.urgency_level,
            needs_traceability=payload.needs_traceability,
            requires_official_form=payload.requires_official_form,
            requested_action=payload.requested_action,
            deadline=payload.deadline,
            security_level=payload.security_level,
            direct_file_paths=payload.direct_file_paths,
            user_template_path=payload.user_template_path,
        )
        finalize = self.documents.request_final_document_output(
            content_base_id=content_base["id"],
            output_name=(payload.output_name or payload.title).strip() or content_base["title"],
        )
        ticket_id = finalize["approval_ticket"]["id"]
        approved_ticket = self.decide_approval_ticket(
            ticket_id,
            ApprovalDecisionRequest(status="approved", decision_note="document generate one-shot approved"),
        )
        finalize["approval_ticket"] = approved_ticket
        applied = self.documents.apply_final_document_output(ticket_id)
        return {
            "content_base": content_base,
            "finalize": {
                **finalize,
                "final_document_output": applied["final_document_output"],
                "artifact": applied["artifact"],
            },
            "artifact": applied["artifact"],
        }

    @staticmethod
    def _document_format_from_text(text: str) -> Literal["auto", "officialMemo", "onePageReport", "fullReport", "email"]:
        lowered = text.lower()
        if "시행문" in text or "공문" in text:
            return "officialMemo"
        if "이메일" in text or "메일" in text:
            return "email"
        if "풀버전" in text or "상세" in text:
            return "fullReport"
        if "1페이지" in text or "1p" in lowered or "한장" in text:
            return "onePageReport"
        return "auto"

    def update_work_session_message(
        self,
        message_id: str,
        *,
        text: str,
        status: Literal["pending", "streaming", "completed", "failed"],
        provider: str | None = None,
        model: str | None = None,
        latency_ms: int | None = None,
        citations: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        existing = self.db.fetch_one("SELECT * FROM work_session_messages WHERE id = ?", (message_id,))
        if not existing:
            raise KeyError(message_id)

        if citations is None:
            citations_json = existing.get("citations_json")
        elif citations:
            citations_json = json.dumps(citations, ensure_ascii=False)
        else:
            citations_json = None

        self.db.execute(
            """
            UPDATE work_session_messages
            SET text = ?, status = ?, provider = ?, model = ?, latency_ms = ?, citations_json = ?
            WHERE id = ?
            """,
            (text.strip(), status, provider, model, latency_ms, citations_json, message_id),
        )
        updated = self.db.fetch_one("SELECT * FROM work_session_messages WHERE id = ?", (message_id,))
        assert updated is not None
        return self._serialize_work_session_messages([updated])[0]

    def run_work_session_turn(self, session_id: str, payload: WorkSessionTurnRequest) -> dict[str, Any]:
        existing = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if not existing:
            raise KeyError(session_id)

        user_message = self.create_work_session_message(
            session_id,
            WorkSessionMessageCreate(
                role="user",
                text=payload.text,
                message_type="chat",
                status="completed",
            ),
        )
        attached_files = self.assign_work_session_attachments(
            session_id,
            user_message["id"],
            payload.attachment_ids,
        )
        user_message["attachments"] = attached_files
        assistant_message = self.create_work_session_message(
            session_id,
            WorkSessionMessageCreate(
                role="assistant",
                text="응답을 준비하는 중입니다.",
                message_type="chat",
                status="pending",
                provider=self.settings.llm_provider,
                model=self.settings.llm_model,
            ),
        )
        assistant_message = self.update_work_session_message(
            assistant_message["id"],
            text="",
            status="pending",
            provider=self.settings.llm_provider,
            model=self.settings.llm_model,
        )
        turn_started = perf_counter()
        work_job = self.jobs.create_job(
            kind="work_session.turn",
            title=f"{existing['title']} 업무대화 응답",
            input={
                "session_id": session_id,
                "user_message_id": user_message["id"],
                "text": payload.text,
                "attachment_ids": payload.attachment_ids,
                "model_override": payload.model_override,
                "reasoning_effort": payload.reasoning_effort,
            },
            resource_key=f"work_session:{session_id}",
            resource_policy="exclusive",
        )
        started_job = self.jobs.start_job_with_lock(work_job["id"], stage="업무대화 응답 준비")
        if started_job["status"] == "blocked":
            duration_ms = int((perf_counter() - turn_started) * 1000)
            blocked_text = (
                "같은 업무대화 세션에서 앞선 응답이 아직 진행 중입니다.\n\n"
                "우측 `작업 진행`에서 이전 응답 상태를 확인하거나 취소한 뒤 다시 요청해 주세요."
            )
            assistant_message = self.update_work_session_message(
                assistant_message["id"],
                text=blocked_text,
                status="completed",
                provider="gongmu-system",
                model="work_session.turn.blocked",
                latency_ms=duration_ms,
            )
            return {
                "user_message": user_message,
                "assistant_message": assistant_message,
                "duration_ms": duration_ms,
                "work_job": started_job,
                "context_summary": {
                    "graphrag_used": False,
                    "graphrag_evidence_count": 0,
                    "attachment_count": len(attached_files),
                    "linked_file_count": len(self.list_work_session_file_links(session_id)),
                    "provider": assistant_message.get("provider"),
                    "model": assistant_message.get("model"),
                    "job_status": started_job["status"],
                },
            }

        self.jobs.update_progress(
            work_job["id"],
            progress_percent=10,
            stage="업무대화 라우팅 확인",
            payload={"session_id": session_id, "user_message_id": user_message["id"]},
        )
        skill_result = self._try_run_work_session_skill(
            session_id=session_id,
            session=existing,
            user_message=user_message,
            text=payload.text,
        )
        if skill_result is not None:
            duration_ms = int((perf_counter() - turn_started) * 1000)
            assistant_message = self.update_work_session_message(
                assistant_message["id"],
                text=skill_result["text"],
                status="completed",
                provider="gongmu-skill",
                model=", ".join(skill_result["actions"]),
                latency_ms=duration_ms,
            )
            completed_job = self.jobs.complete_job(
                work_job["id"],
                status="succeeded",
                result={
                    "session_id": session_id,
                    "user_message_id": user_message["id"],
                    "assistant_message_id": assistant_message["id"],
                    "skill_actions": skill_result["actions"],
                    "duration_ms": duration_ms,
                },
                stage="업무대화 스킬 실행 완료",
            )
            return {
                "user_message": user_message,
                "assistant_message": assistant_message,
                "duration_ms": duration_ms,
                "work_job": completed_job,
                "context_summary": {
                    "graphrag_used": "knowledge.search" in skill_result["actions"],
                    "graphrag_evidence_count": (
                        skill_result["results"][0].get("citation_count", 0)
                        if "knowledge.search" in skill_result["actions"] and skill_result["results"]
                        else 0
                    ),
                    "attachment_count": len(attached_files),
                    "linked_file_count": len(self.list_work_session_file_links(session_id)),
                    "provider": assistant_message.get("provider"),
                    "model": assistant_message.get("model"),
                    "skill_actions": skill_result["actions"],
                    "skill_results": skill_result["results"],
                },
            }

        graphrag_prompt_block, knowledge_citations = self._build_knowledge_context(
            session_id=session_id,
            query=payload.text,
        )
        graphrag_evidence_count = (
            sum(
                1
                for line in graphrag_prompt_block.splitlines()
                if line.strip().split(".", 1)[0].isdigit()
            )
            if graphrag_prompt_block
            else 0
        )
        linked_file_count = len(self.list_work_session_file_links(session_id))
        # T-02: 세션 전체 이력 주입 대신 예산 기반 조립(최근 N턴 + 롤링 요약)
        prompt_messages, context_summary_used, context_stats = self._assemble_chat_prompt(
            session=existing,
            session_id=session_id,
            assistant_message_id=assistant_message["id"],
            attached_files=attached_files,
            graphrag_prompt_block=graphrag_prompt_block,
        )
        context_summary: dict[str, Any] = {
            "graphrag_used": bool(graphrag_prompt_block),
            "graphrag_evidence_count": graphrag_evidence_count,
            "attachment_count": len(attached_files),
            "linked_file_count": linked_file_count,
            "provider": None,
            "model": None,
            "input_token_estimate": context_stats["estimated_tokens"],
            "context_included_turns": context_stats["included_turns"],
            "context_summarized_turns": context_stats["summarized_turns"],
            "context_summary_used": context_summary_used,
            "context_budget_tokens": self.settings.context_budget_tokens,
        }
        try:
            self.jobs.update_progress(
                work_job["id"],
                progress_percent=35,
                stage="LLM 응답 생성",
                payload={
                    "graphrag_used": bool(graphrag_prompt_block),
                    "attachment_count": len(attached_files),
                    "input_token_estimate": context_stats["estimated_tokens"],
                },
            )
            result = generate_session_reply(
                self.settings,
                prompt_messages,
                model_override=payload.model_override,
                reasoning_effort=payload.reasoning_effort,
            )
            duration_ms = int((perf_counter() - turn_started) * 1000)
            assistant_message = self.update_work_session_message(
                assistant_message["id"],
                text=self._prepare_assistant_output_text(result.text),
                status="completed",
                provider=result.provider,
                model=result.model,
                latency_ms=duration_ms,
                citations=knowledge_citations,
            )
            work_job_result = self.jobs.complete_job(
                work_job["id"],
                status="succeeded",
                result={
                    "session_id": session_id,
                    "user_message_id": user_message["id"],
                    "assistant_message_id": assistant_message["id"],
                    "duration_ms": duration_ms,
                    "provider": result.provider,
                    "model": result.model,
                    "input_token_estimate": context_stats["estimated_tokens"],
                },
                stage="업무대화 응답 완료",
            )
            self._update_session_rolling_summary(
                session_id,
                user_text=user_message["text"],
                assistant_text=assistant_message["text"],
                upto_message_id=assistant_message["id"],
            )
        except LLMGenerationError as exc:
            duration_ms = int((perf_counter() - turn_started) * 1000)
            assistant_message = self.update_work_session_message(
                assistant_message["id"],
                text=f"LLM 응답 생성에 실패했습니다.\n\n{exc}",
                status="failed",
                provider=self.settings.llm_provider,
                model=self.settings.llm_model,
                latency_ms=duration_ms,
            )
            assistant_message = self.update_work_session_message(
                assistant_message["id"],
                text=f"LLM 응답 생성에 실패했습니다.\n\n{exc}",
                status="failed",
                provider=self.settings.llm_provider,
                model=self.settings.llm_model,
                latency_ms=duration_ms,
            )
            self.db.log(
                feature="chat",
                action="work_session.turn.failed",
                status="failed",
                inputs={
                    "session_id": session_id,
                    "text": payload.text,
                    "model_override": payload.model_override,
                    "reasoning_effort": payload.reasoning_effort,
                },
                outputs={
                    "user_message_id": user_message["id"],
                    "assistant_message_id": assistant_message["id"],
                    "error": str(exc),
                    "duration_ms": duration_ms,
                    "attachment_ids": payload.attachment_ids,
                },
            )
            work_job_result = self.jobs.fail_job(
                work_job["id"],
                error_message=str(exc),
                stage="업무대화 응답 실패",
            )

        context_summary["provider"] = assistant_message.get("provider")
        context_summary["model"] = assistant_message.get("model")
        return {
            "user_message": user_message,
            "assistant_message": assistant_message,
            "duration_ms": duration_ms,
            "work_job": work_job_result,
            "context_summary": context_summary,
        }

    def run_work_session_turn_stream(self, session_id: str, payload: WorkSessionTurnRequest):
        existing = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if not existing:
            raise KeyError(session_id)

        user_message = self.create_work_session_message(
            session_id,
            WorkSessionMessageCreate(
                role="user",
                text=payload.text,
                message_type="chat",
                status="completed",
            ),
        )
        attached_files = self.assign_work_session_attachments(
            session_id,
            user_message["id"],
            payload.attachment_ids,
        )
        user_message["attachments"] = attached_files
        assistant_message = self.create_work_session_message(
            session_id,
            WorkSessionMessageCreate(
                role="assistant",
                text="응답을 준비하는 중입니다.",
                message_type="chat",
                status="pending",
                provider=self.settings.llm_provider,
                model=self.settings.llm_model,
            ),
        )
        assistant_message = self.update_work_session_message(
            assistant_message["id"],
            text="",
            status="streaming",
            provider=self.settings.llm_provider,
            model=self.settings.llm_model,
        )

        turn_started = perf_counter()
        work_job = self.jobs.create_job(
            kind="work_session.turn",
            title=f"{existing['title']} 업무대화 응답",
            input={
                "session_id": session_id,
                "user_message_id": user_message["id"],
                "text": payload.text,
                "attachment_ids": payload.attachment_ids,
                "model_override": payload.model_override,
                "reasoning_effort": payload.reasoning_effort,
                "stream": True,
            },
            resource_key=f"work_session:{session_id}",
            resource_policy="exclusive",
        )
        started_job = self.jobs.start_job_with_lock(work_job["id"], stage="업무대화 응답 준비")
        if started_job["status"] == "blocked":
            duration_ms = int((perf_counter() - turn_started) * 1000)
            blocked_text = (
                "같은 업무대화 세션에서 앞선 응답이 아직 진행 중입니다.\n\n"
                "우측 `작업 진행`에서 이전 응답 상태를 확인하거나 취소한 뒤 다시 요청해 주세요."
            )
            assistant_message = self.update_work_session_message(
                assistant_message["id"],
                text=blocked_text,
                status="completed",
                provider="gongmu-system",
                model="work_session.turn.blocked",
                latency_ms=duration_ms,
            )
            yield {"event": "user_message", "data": user_message}
            yield {"event": "assistant_message", "data": assistant_message}
            yield {"event": "delta", "data": {"text": blocked_text}}
            yield {
                "event": "done",
                "data": {
                    "user_message": user_message,
                    "assistant_message": assistant_message,
                    "duration_ms": duration_ms,
                    "work_job": started_job,
                    "context_summary": {
                        "graphrag_used": False,
                        "graphrag_evidence_count": 0,
                        "attachment_count": len(attached_files),
                        "linked_file_count": len(self.list_work_session_file_links(session_id)),
                        "provider": assistant_message.get("provider"),
                        "model": assistant_message.get("model"),
                        "job_status": started_job["status"],
                    },
                },
            }
            return
        self.jobs.update_progress(
            work_job["id"],
            progress_percent=10,
            stage="업무대화 라우팅 확인",
            payload={"session_id": session_id, "user_message_id": user_message["id"], "stream": True},
        )
        yield {"event": "user_message", "data": user_message}
        yield {"event": "assistant_message", "data": assistant_message}

        skill_result = self._try_run_work_session_skill(
            session_id=session_id,
            session=existing,
            user_message=user_message,
            text=payload.text,
        )
        if skill_result is not None:
            duration_ms = int((perf_counter() - turn_started) * 1000)
            assistant_message = self.update_work_session_message(
                assistant_message["id"],
                text=skill_result["text"],
                status="completed",
                provider="gongmu-skill",
                model=", ".join(skill_result["actions"]),
                latency_ms=duration_ms,
            )
            completed_job = self.jobs.complete_job(
                work_job["id"],
                status="succeeded",
                result={
                    "session_id": session_id,
                    "user_message_id": user_message["id"],
                    "assistant_message_id": assistant_message["id"],
                    "skill_actions": skill_result["actions"],
                    "duration_ms": duration_ms,
                },
                stage="업무대화 스킬 실행 완료",
            )
            if skill_result["text"]:
                yield {"event": "delta", "data": {"text": skill_result["text"]}}
            yield {
                "event": "done",
                "data": {
                    "user_message": user_message,
                    "assistant_message": assistant_message,
                    "duration_ms": duration_ms,
                    "work_job": completed_job,
                    "context_summary": {
                        "graphrag_used": "knowledge.search" in skill_result["actions"],
                        "graphrag_evidence_count": (
                            skill_result["results"][0].get("citation_count", 0)
                            if "knowledge.search" in skill_result["actions"] and skill_result["results"]
                            else 0
                        ),
                        "attachment_count": len(attached_files),
                        "linked_file_count": len(self.list_work_session_file_links(session_id)),
                        "provider": assistant_message.get("provider"),
                        "model": assistant_message.get("model"),
                        "skill_actions": skill_result["actions"],
                        "skill_results": skill_result["results"],
                    },
                },
            }
            return

        graphrag_prompt_block, knowledge_citations = self._build_knowledge_context(
            session_id=session_id,
            query=payload.text,
        )
        graphrag_evidence_count = (
            sum(
                1
                for line in graphrag_prompt_block.splitlines()
                if line.strip().split(".", 1)[0].isdigit()
            )
            if graphrag_prompt_block
            else 0
        )
        linked_file_count = len(self.list_work_session_file_links(session_id))
        # T-02: 세션 전체 이력 주입 대신 예산 기반 조립(최근 N턴 + 롤링 요약)
        prompt_messages, context_summary_used, context_stats = self._assemble_chat_prompt(
            session=existing,
            session_id=session_id,
            assistant_message_id=assistant_message["id"],
            attached_files=attached_files,
            graphrag_prompt_block=graphrag_prompt_block,
        )
        context_summary: dict[str, Any] = {
            "graphrag_used": bool(graphrag_prompt_block),
            "graphrag_evidence_count": graphrag_evidence_count,
            "attachment_count": len(attached_files),
            "linked_file_count": linked_file_count,
            "provider": None,
            "model": None,
            "input_token_estimate": context_stats["estimated_tokens"],
            "context_included_turns": context_stats["included_turns"],
            "context_summarized_turns": context_stats["summarized_turns"],
            "context_summary_used": context_summary_used,
            "context_budget_tokens": self.settings.context_budget_tokens,
        }

        events: Queue[tuple[str, Any]] = Queue()
        self.jobs.update_progress(
            work_job["id"],
            progress_percent=35,
            stage="LLM 응답 생성",
            payload={
                "graphrag_used": bool(graphrag_prompt_block),
                "attachment_count": len(attached_files),
                "input_token_estimate": context_stats["estimated_tokens"],
                "stream": True,
            },
        )

        def run_llm() -> None:
            try:
                result = generate_session_reply_streaming(
                    self.settings,
                    prompt_messages,
                    model_override=payload.model_override,
                    reasoning_effort=payload.reasoning_effort,
                    on_delta=lambda delta: events.put(("delta", delta)),
                )
                events.put(("done", result))
            except LLMGenerationError as exc:
                events.put(("error", exc))

        Thread(target=run_llm, daemon=True).start()

        collected_text = ""
        while True:
            kind, value = events.get()
            if kind == "delta":
                collected_text += str(value)
                # Keep streaming latency and spacing intact; final persisted text
                # gets the heavier scratchpad/reasoning cleanup below.
                delta_text = self._redact_sensitive_text(str(value))
                if delta_text:
                    yield {"event": "delta", "data": {"text": delta_text}}
                continue

            if kind == "error":
                duration_ms = int((perf_counter() - turn_started) * 1000)
                error_text = f"LLM 응답 생성에 실패했습니다.\n\n{value}"
                assistant_message = self.update_work_session_message(
                    assistant_message["id"],
                    text=error_text,
                    status="failed",
                    provider=self.settings.llm_provider,
                    model=self.settings.llm_model,
                    latency_ms=duration_ms,
                )
                self.db.log(
                    feature="chat",
                    action="work_session.turn.failed",
                    status="failed",
                    inputs={
                        "session_id": session_id,
                        "text": payload.text,
                        "model_override": payload.model_override,
                        "reasoning_effort": payload.reasoning_effort,
                    },
                    outputs={
                        "user_message_id": user_message["id"],
                        "assistant_message_id": assistant_message["id"],
                        "error": str(value),
                        "duration_ms": duration_ms,
                        "attachment_ids": payload.attachment_ids,
                    },
                )
                failed_job = self.jobs.fail_job(
                    work_job["id"],
                    error_message=str(value),
                    stage="업무대화 응답 실패",
                )
                yield {"event": "error", "data": {"message": str(value)}}
                yield {
                    "event": "done",
                    "data": {
                        "user_message": user_message,
                        "assistant_message": assistant_message,
                        "duration_ms": duration_ms,
                        "work_job": failed_job,
                        "context_summary": {
                            **context_summary,
                            "provider": assistant_message.get("provider"),
                            "model": assistant_message.get("model"),
                        },
                    },
                }
                return

            result = value
            duration_ms = int((perf_counter() - turn_started) * 1000)
            final_text = self._prepare_assistant_output_text(result.text)
            assistant_message = self.update_work_session_message(
                assistant_message["id"],
                text=final_text,
                status="completed",
                provider=result.provider,
                model=result.model,
                latency_ms=duration_ms,
                citations=knowledge_citations,
            )
            context_summary["provider"] = assistant_message.get("provider")
            context_summary["model"] = assistant_message.get("model")
            completed_job = self.jobs.complete_job(
                work_job["id"],
                status="succeeded",
                result={
                    "session_id": session_id,
                    "user_message_id": user_message["id"],
                    "assistant_message_id": assistant_message["id"],
                    "duration_ms": duration_ms,
                    "provider": result.provider,
                    "model": result.model,
                    "input_token_estimate": context_stats["estimated_tokens"],
                },
                stage="업무대화 응답 완료",
            )
            self._update_session_rolling_summary(
                session_id,
                user_text=user_message["text"],
                assistant_text=assistant_message["text"],
                upto_message_id=assistant_message["id"],
            )
            yield {
                "event": "done",
                "data": {
                    "user_message": user_message,
                    "assistant_message": assistant_message,
                    "duration_ms": duration_ms,
                    "work_job": completed_job,
                    "context_summary": context_summary,
                },
            }
            return

    def test_llm_connection(self, payload: LLMConnectionTestRequest) -> dict[str, Any]:
        probe_messages = [
            {
                "role": "system",
                "text": "You are validating that the Gongmu workspace can reach the configured LLM.",
            },
            {"role": "user", "text": payload.prompt.strip()},
        ]
        try:
            result = generate_session_reply(self.settings, probe_messages)
            self.db.log(
                feature="settings",
                action="settings.llm.test.completed",
                status="success",
                inputs={"prompt": payload.prompt},
                outputs={
                    "provider": result.provider,
                    "model": result.model,
                    "text": result.text,
                },
            )
            return {
                "status": "ok",
                "provider": result.provider,
                "model": result.model,
                "text": result.text,
            }
        except LLMGenerationError as exc:
            self.db.log(
                feature="settings",
                action="settings.llm.test.failed",
                status="failed",
                inputs={"prompt": payload.prompt},
                outputs={"error": str(exc)},
            )
            return {
                "status": "failed",
                "provider": self.settings.llm_provider,
                "model": self.settings.llm_model,
                "text": str(exc),
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
        if existing["status"] != "pending":
            raise ValueError("approval ticket already decided")

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

    def rebuild_file_search_index(self) -> dict[str, Any]:
        work_job = self.jobs.create_job(
            kind="files.index.rebuild",
            title="파일명 인덱스 갱신",
            input={"scope": "local_filename"},
            resource_key="local_file_index",
            resource_policy="exclusive",
        )
        started_job = self.jobs.start_job_with_lock(work_job["id"], stage="로컬 파일 목록 스캔")
        if started_job["status"] == "blocked":
            return {
                "status": "blocked",
                "indexed_count": self._local_file_index_total_count(),
                "searched_roots": [],
                "partial": False,
                "indexed_at": None,
                "work_job": started_job,
            }
        scan = scan_local_files_for_index()
        self.jobs.update_progress(
            work_job["id"],
            progress_percent=70,
            stage="파일명 인덱스 저장",
            message=f"{scan['indexed_count']}개 파일을 인덱스에 반영합니다.",
        )
        indexed_at = now_iso()
        try:
            with self.db.transaction():
                self.db.execute("DELETE FROM local_file_index")
                for item in scan["items"]:
                    file_record = item["file"]
                    name = file_record["title"]
                    stem = Path(name).stem
                    self.db.execute(
                        """
                        INSERT OR REPLACE INTO local_file_index (
                            id,
                            file_path,
                            search_root,
                            relative_path,
                            name,
                            name_lower,
                            stem_lower,
                            compact_name,
                            compact_stem,
                            size_bytes,
                            modified_at,
                            indexed_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            file_record["id"],
                            file_record["file_path"],
                            item["search_root"],
                            file_record["relative_path"],
                            name,
                            name.lower(),
                            stem.lower(),
                            compact_filename_text(name),
                            compact_filename_text(stem),
                            file_record["size_bytes"],
                            file_record["modified_at"],
                            indexed_at,
                        ),
                    )
        except Exception as exc:
            self.jobs.fail_job(work_job["id"], error_message=str(exc), stage="파일명 인덱스 저장 실패")
            raise
        result = {
            "status": "completed" if not scan["partial"] else "partial",
            "indexed_count": scan["indexed_count"],
            "searched_roots": scan["searched_roots"],
            "partial": scan["partial"],
            "indexed_at": indexed_at,
        }
        completed_job = self.jobs.complete_job(
            work_job["id"],
            status="succeeded" if not scan["partial"] else "partial",
            result=result,
            stage="파일명 인덱스 갱신 완료",
        )
        self.db.log(
            feature="files",
            action="files.index.rebuilt",
            status=result["status"],
            inputs={"searched_roots": scan["searched_roots"]},
            outputs={"indexed_count": scan["indexed_count"], "partial": scan["partial"]},
        )
        result["work_job"] = completed_job
        return result

    def run_knowledge_ingestion_work_job(self, work_job_id: str, ingestion_job_id: str) -> dict[str, Any]:
        started_job = self.jobs.start_job_with_lock(work_job_id, stage="지식위키 색인 실행")
        if started_job["status"] == "blocked":
            return started_job
        try:
            result = self.wiki.run_job(ingestion_job_id)
        except Exception as exc:
            self.jobs.fail_job(work_job_id, error_message=str(exc), stage="지식위키 색인 실패")
            raise
        status = result.get("status")
        terminal_status = (
            "succeeded"
            if status == "completed"
            else ("canceled" if status == "canceled" else ("partial" if status == "partial" else "failed"))
        )
        return self.jobs.complete_job(
            work_job_id,
            status=terminal_status,
            result={
                "ingestion_job_id": ingestion_job_id,
                "status": status,
                "processed_count": result.get("processed_count"),
                "failed_count": result.get("failed_count"),
            },
            stage="지식위키 색인 완료" if terminal_status in {"succeeded", "partial"} else "지식위키 색인 중단",
        )

    def run_knowledge_enrichment_work_job(
        self, work_job_id: str, source_id: str | None, limit: int | None = None
    ) -> dict[str, Any]:
        started_job = self.jobs.start_job_with_lock(work_job_id, stage="지식위키 LLM 보강 실행")
        if started_job["status"] == "blocked":
            return started_job

        def should_cancel() -> bool:
            job = self.jobs.get_job(work_job_id)
            return bool(job and (job.get("cancel_requested") or job.get("status") == "cancel_requested"))

        def report_progress(done: int, total: int) -> None:
            percent = 99 if total <= 0 else max(1, min(99, round((done / total) * 100)))
            self.jobs.update_progress(
                work_job_id,
                progress_percent=percent,
                stage="지식위키 LLM 보강",
                message=f"{done}/{total} 문서 보강",
            )

        try:
            result = self.wiki.enrich(
                source_id=source_id,
                llm=self._wiki_llm_generate,
                should_cancel=should_cancel,
                progress_cb=report_progress,
                limit=limit,
            )
        except Exception as exc:
            self.jobs.fail_job(work_job_id, error_message=str(exc), stage="지식위키 LLM 보강 실패")
            raise
        status_map = {"completed": "succeeded", "canceled": "canceled", "partial": "partial"}
        # F-11 자동 연속 보강: 정상 완료(취소·부분 아님)인데 이월분이 남았으면
        # 다음 배치 잡을 자동 체이닝한다 — 동일 resource_key(exclusive) 직렬,
        # 체인 각 배치는 일반 잡이므로 작업 패널의 취소 버튼이 그대로 통한다.
        chained_job: dict[str, Any] | None = None
        if (
            str(result.get("status")) == "completed"
            and int(result.get("remaining_count") or 0) > 0
        ):
            chained_job = self._create_chained_enrichment_job(
                source_id=source_id, limit=limit, parent_job_id=work_job_id
            )
        if chained_job is not None:
            result = {**result, "chained_work_job_id": chained_job["id"]}
        completed = self.jobs.complete_job(
            work_job_id,
            status=status_map.get(str(result.get("status")), "partial"),
            result=result,
            stage="지식위키 LLM 보강 완료" if result.get("status") == "completed" else "지식위키 LLM 보강 중단",
        )
        if chained_job is not None:
            # 현재 잡의 완료(락 해제) 후에 다음 배치를 백그라운드로 잇는다.
            chained_job_id = str(chained_job["id"])
            self.job_runner.submit_existing(
                chained_job_id,
                lambda: self.run_knowledge_enrichment_work_job(chained_job_id, source_id, limit),
            )
        return completed

    def _create_chained_enrichment_job(
        self, *, source_id: str | None, limit: int | None, parent_job_id: str
    ) -> dict[str, Any] | None:
        """F-11: 이월분 잔존 시 다음 보강 배치 잡을 생성한다(실패는 체이닝 생략으로 흡수)."""
        try:
            return self.jobs.create_job(
                kind="knowledge.enrich",
                title="지식위키 LLM 보강 (자동 연속)",
                input={
                    "source_id": source_id,
                    "background": True,
                    "limit": limit,
                    "chained_from": parent_job_id,
                },
                resource_key="knowledge_wiki:enrich",
                resource_policy="exclusive",
            )
        except Exception:  # noqa: BLE001 - 체이닝 실패가 완료된 보강을 망치면 안 된다
            return None

    def run_knowledge_verify_work_job(self, work_job_id: str, *, deep: bool = False) -> dict[str, Any]:
        """P3 §6: 무결성 점검(verify) 잡 — 색인과 동일 리소스 키(exclusive)로 상호 배제."""
        started_job = self.jobs.start_job_with_lock(work_job_id, stage="지식위키 무결성 점검 실행")
        if started_job["status"] == "blocked":
            return started_job
        try:
            report = self.wiki.verify(deep=deep, job_id=work_job_id)
        except Exception as exc:
            self.jobs.fail_job(work_job_id, error_message=str(exc), stage="지식위키 무결성 점검 실패")
            raise
        return self.jobs.complete_job(
            work_job_id,
            status="succeeded",
            result=report,
            stage="지식위키 무결성 점검 완료",
        )

    def run_taxonomy_apply_work_job(self, work_job_id: str, source_id: str) -> dict[str, Any]:
        started_job = self.jobs.start_job_with_lock(work_job_id, stage="업무 분류 적용 실행")
        if started_job["status"] == "blocked":
            return started_job

        def should_cancel() -> bool:
            job = self.jobs.get_job(work_job_id)
            return bool(job and (job.get("cancel_requested") or job.get("status") == "cancel_requested"))

        indexed_before_apply = False
        indexed_count = 0
        ingestion_job_id: str | None = None
        try:
            # 1) 스캔 연쇄: 파일이 아예 없으면(미스캔) 폴더 스캔을 먼저 실행한다.
            file_count_row = self.db.fetch_one(
                "SELECT COUNT(*) AS count FROM knowledge_source_files WHERE source_id = ? AND status != ?",
                (source_id, "deleted"),
            )
            if int(file_count_row["count"] if file_count_row else 0) == 0:
                self.jobs.update_progress(
                    work_job_id,
                    progress_percent=2,
                    stage="색인",
                    message="스캔된 파일이 없어 지식폴더 스캔을 먼저 실행합니다.",
                )
                self.knowledge.scan_source(source_id)

            # 2) 색인 연쇄: 미색인 파일이 있거나 위키 문서가 없으면 같은 작업에서 색인을 선실행한다.
            pending_files, skipped_count = self.wiki._source_files_for_ingestion(source_id)
            wiki_doc_row = self.db.fetch_one(
                "SELECT COUNT(*) AS count FROM knowledge_wiki_docs WHERE source_id = ?",
                (source_id,),
            )
            wiki_doc_count = int(wiki_doc_row["count"] if wiki_doc_row else 0)
            if pending_files or wiki_doc_count == 0:
                self.jobs.update_progress(
                    work_job_id,
                    progress_percent=5,
                    stage="색인",
                    message=f"미색인 문서 {len(pending_files)}건을 먼저 색인합니다.",
                    payload={"pending_count": len(pending_files), "skipped_count": skipped_count},
                )
                # 기존 enqueue 흐름과 동일하게 knowledge_ingestion_jobs 레코드를 만들고
                # 같은 스레드에서 동기 실행한다(별도 work_job/락 없음 → 데드락·409 없음).
                ingestion_job = self.wiki.ingest_source(source_id, run_now=False)
                ingestion_job_id = str(ingestion_job["id"])
                if should_cancel():
                    self.wiki.request_cancel(ingestion_job_id)
                finished = self.wiki.run_job(ingestion_job_id)
                indexed_before_apply = True
                indexed_count = int(finished.get("processed_count") or 0)
                self.jobs.update_progress(
                    work_job_id,
                    progress_percent=50,
                    stage="색인",
                    message=f"색인 {indexed_count}건 완료",
                    payload={
                        "ingestion_job_id": ingestion_job_id,
                        "ingestion_status": finished.get("status"),
                        "processed_count": indexed_count,
                        "failed_count": finished.get("failed_count"),
                        "skipped_count": finished.get("skipped_count"),
                    },
                )
                if finished.get("status") == "canceled" or should_cancel():
                    return self.jobs.complete_job(
                        work_job_id,
                        status="canceled",
                        result={
                            "source_id": source_id,
                            "indexed_before_apply": indexed_before_apply,
                            "indexed_count": indexed_count,
                            "ingestion_job_id": ingestion_job_id,
                        },
                        stage="업무 분류 적용 취소",
                    )

            base_percent = 50 if indexed_before_apply else 0

            def report_progress(done: int, total: int) -> None:
                span = 99 - base_percent
                percent = (
                    99
                    if total <= 0
                    else max(base_percent + 1, min(99, base_percent + round((done / total) * span)))
                )
                self.jobs.update_progress(
                    work_job_id,
                    progress_percent=percent,
                    stage="분류 적용",
                    message=f"{done}/{total} 문서 태깅",
                )

            report = self.taxonomy.apply_taxonomy(
                source_id,
                progress_cb=report_progress,
                should_cancel=should_cancel,
                indexed_before_apply=indexed_before_apply,
                indexed_count=indexed_count,
            )
        except Exception as exc:
            self.jobs.fail_job(work_job_id, error_message=str(exc), stage="업무 분류 적용 실패")
            raise
        result = {**report, "ingestion_job_id": ingestion_job_id}
        return self.jobs.complete_job(
            work_job_id,
            status="succeeded",
            result=result,
            stage="업무 분류 적용 완료",
        )

    def _search_indexed_files(self, query: str, limit: int) -> dict[str, Any]:
        normalized_query = query.strip().lower()
        compact_query = compact_filename_text(normalized_query)
        if not normalized_query:
            return {"items": [], "index_count": 0, "index_total_count": self._local_file_index_total_count()}
        rows = self.db.fetch_all(
            """
            SELECT *
            FROM local_file_index
            WHERE name_lower LIKE ?
               OR stem_lower LIKE ?
               OR compact_name LIKE ?
               OR compact_stem LIKE ?
            ORDER BY modified_at DESC
            LIMIT ?
            """,
            (
                f"%{normalized_query}%",
                f"%{normalized_query}%",
                f"%{compact_query}%",
                f"%{compact_query}%",
                max(20, min(limit * 10, 500)),
            ),
        )
        hits: list[dict[str, Any]] = []
        for row in rows:
            score, reasons = score_filename(row["name"], query)
            if score <= 0:
                continue
            hits.append(
                {
                    "file": {
                        "id": row["id"],
                        "source_id": "local-file-index",
                        "file_path": row["file_path"],
                        "relative_path": row["relative_path"],
                        "file_hash": row["id"],
                        "size_bytes": row["size_bytes"],
                        "modified_at": row["modified_at"],
                        "status": "filename_index_match",
                        "title": row["name"],
                        "mime_type": None,
                        "text_excerpt": None,
                        "extracted_text_path": None,
                        "created_at": row["indexed_at"],
                        "updated_at": row["indexed_at"],
                    },
                    "score": score + 20,
                    "match_reasons": [*reasons, "파일명 인덱스"],
                    "search_root": row["search_root"],
                }
            )
        hits.sort(key=lambda item: (item["score"], item["file"]["updated_at"]), reverse=True)
        return {
            "items": hits[: max(1, min(limit, 100))],
            "index_count": len(hits),
            "index_total_count": self._local_file_index_total_count(),
        }

    def _local_file_index_total_count(self) -> int:
        row = self.db.fetch_one("SELECT COUNT(*) AS count FROM local_file_index")
        return int(row["count"]) if row else 0

    def search_files(self, query: str, limit: int = 20) -> dict[str, Any]:
        knowledge_results = self.knowledge.search_source_files(query=query, limit=limit)
        for item in knowledge_results["items"]:
            if "파일명" in item.get("match_reasons", []):
                item["score"] = item.get("score", 0) + 300
        knowledge_paths = {item["file"]["file_path"] for item in knowledge_results["items"]}
        indexed_results = self._search_indexed_files(query=query, limit=limit)
        indexed_paths = {item["file"]["file_path"] for item in indexed_results["items"]}
        if indexed_results["index_total_count"] > 0:
            local_results = {
                "query": query,
                "items": [],
                "scope": "local_filename_index",
                "searched_roots": sorted(
                    {
                        item["search_root"]
                        for item in indexed_results["items"]
                        if item.get("search_root")
                    }
                ),
                "partial": False,
            }
        else:
            local_results = search_local_files_by_name(query=query, limit=limit)
        merged_items = [*knowledge_results["items"], *indexed_results["items"]]

        for item in local_results["items"]:
            if item["file"]["file_path"] in knowledge_paths or item["file"]["file_path"] in indexed_paths:
                continue
            merged_items.append(item)

        merged_items.sort(
            key=lambda item: (item.get("score", 0), item["file"].get("updated_at") or ""),
            reverse=True,
        )
        return {
            **local_results,
            "items": merged_items[: max(1, min(limit, 100))],
            "knowledge_index_count": len(knowledge_results["items"]),
            "local_index_count": indexed_results["index_count"],
            "local_index_total_count": indexed_results["index_total_count"],
        }


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
    register_authoring_routes(app, services)
    app.state.test_client_factory = lambda: TestClient(app)

    def ensure_no_active_knowledge_ingestion() -> None:
        active_job = services.wiki.active_job()
        if active_job is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "지식폴더 색인 작업이 진행 중입니다. "
                    f"작업 {str(active_job['id'])[:8]}을 완료하거나 취소한 뒤 다시 시도하세요."
                ),
            )
        # §6: verify↔색인 양방향 상호 배제 — verify 진행 중에는 색인·스캔도 막아
        # V4 GC·V5 FTS 재동기화가 병행 색인의 쓰기 중 상태를 오판하지 않게 한다.
        active_verify = services.db.fetch_one(
            "SELECT id FROM work_jobs WHERE kind = ? AND status IN ('queued', 'running') LIMIT 1",
            ("knowledge.verify",),
        )
        if active_verify is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "지식폴더 무결성 점검이 진행 중입니다. "
                    f"작업 {str(active_verify['id'])[:8]}이 끝난 뒤 다시 시도하세요."
                ),
            )

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "workspace_root": str(services.paths.root),
            "database": str(services.paths.db_file),
        }

    @app.get("/ready")
    def ready() -> dict[str, Any]:
        workspace_ok = services.paths.root.exists()
        database_ok = services.paths.db_file.exists()
        job_counts = services.jobs.status_counts()
        runner_metrics = services.job_runner.metrics()
        checks = {
            "workspace": {"ok": workspace_ok, "path": str(services.paths.root)},
            "database": {"ok": database_ok, "path": str(services.paths.db_file)},
            "jobs": {
                "ok": True,
                "active_count": job_counts.get("active_count", 0),
                "runner_active_count": runner_metrics["active_count"],
            },
        }
        ready_status = "ready" if all(check["ok"] for check in checks.values()) else "degraded"
        return {
            "status": ready_status,
            "checks": checks,
            "recovered": {
                "work_jobs": services.recovered_work_jobs,
                "knowledge_ingestion_jobs": services.recovered_knowledge_jobs,
            },
        }

    @app.get("/api/runtime/metrics")
    def runtime_metrics() -> dict[str, Any]:
        job_counts = services.jobs.status_counts()
        knowledge_active = services.wiki.active_job()
        return {
            "jobs": {
                "active_count": job_counts.get("active_count", 0),
                "terminal_count": job_counts.get("terminal_count", 0),
                "queued": job_counts.get("queued", 0),
                "blocked": job_counts.get("blocked", 0),
                "running": job_counts.get("running", 0),
                "waiting_approval": job_counts.get("waiting_approval", 0),
                "cancel_requested": job_counts.get("cancel_requested", 0),
                "failed": job_counts.get("failed", 0),
                "succeeded": job_counts.get("succeeded", 0),
                "partial": job_counts.get("partial", 0),
                "canceled": job_counts.get("canceled", 0),
            },
            "runner": services.job_runner.metrics(),
            "knowledge": {
                "active_ingestion_job_id": knowledge_active["id"] if knowledge_active else None,
                "active_ingestion_status": knowledge_active["status"] if knowledge_active else None,
            },
            "recovered": {
                "work_jobs": services.recovered_work_jobs,
                "knowledge_ingestion_jobs": services.recovered_knowledge_jobs,
            },
        }

    @app.get("/api/jobs")
    def list_jobs(limit: int = 50) -> dict[str, Any]:
        return {"items": services.jobs.list_jobs(limit=limit)}

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str) -> dict[str, Any]:
        try:
            return services.jobs.require_job(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work job not found") from exc

    @app.get("/api/jobs/{job_id}/events")
    def list_job_events(job_id: str, limit: int = 200) -> dict[str, Any]:
        try:
            return {"items": services.jobs.list_events(job_id, limit=limit)}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work job not found") from exc

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel_job(job_id: str) -> dict[str, Any]:
        try:
            return services.jobs.request_cancel(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work job not found") from exc

    @app.get("/api/settings", response_model=WorkspaceSettingsResponse)
    def get_settings() -> WorkspaceSettingsResponse:
        return WorkspaceSettingsResponse(
            defaults={
                "llm_mode": services.settings.llm_mode,
                "llm_provider": services.settings.llm_provider,
                "llm_model": services.settings.llm_model,
                "llm_api_key": services.settings.llm_api_key,
                "llm_site_url": services.settings.llm_site_url,
                "llm_application_name": services.settings.llm_application_name,
                "profiles": services.settings.llm_profiles,
                "default_template_key": services.settings.default_template_key,
                "internal_api_base_url": services.settings.internal_api_base_url,
                "personalization_apply_mode": services.settings.personalization_apply_mode,
                "embedding_provider": services.settings.embedding_provider,
                "embedding_model": services.settings.embedding_model,
                "embedding_base_url": services.settings.embedding_base_url,
                "embedding_fallback_enabled": services.settings.embedding_fallback_enabled,
                "graphrag_vector_backend": services.settings.graphrag_vector_backend,
                "knowledge_engine": services.settings.knowledge_engine,
            },
            paths={
                "workspace_root": str(services.paths.root),
                "database": str(services.paths.db_file),
                "knowledge_root": str(services.paths.knowledge_root),
                "documents_root": str(services.paths.documents_root),
                "personalization_root": str(services.personalization_root),
            },
        )

    @app.put("/api/settings", response_model=WorkspaceSettingsResponse)
    def update_settings(payload: WorkspaceSettingsUpdate) -> WorkspaceSettingsResponse:
        return services.update_settings(payload)

    @app.post("/api/settings/llm-test")
    def test_llm_connection(payload: LLMConnectionTestRequest) -> dict[str, Any]:
        return services.test_llm_connection(payload)

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

    @app.patch("/api/schedules/{schedule_id}")
    def update_schedule(schedule_id: str, payload: ScheduleUpdate) -> dict[str, Any]:
        try:
            return services.update_schedule(schedule_id, payload)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="schedule not found") from error

    @app.delete("/api/schedules/{schedule_id}")
    def delete_schedule(schedule_id: str) -> dict[str, Any]:
        try:
            return services.delete_schedule(schedule_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="schedule not found") from error

    @app.get("/api/schedules/reminders/due")
    def list_due_schedule_reminders() -> dict[str, Any]:
        return {"items": services.list_due_schedule_reminders(), "now": now_iso()}

    @app.post("/api/schedules/{schedule_id}/reminders/ack")
    def acknowledge_schedule_reminder(schedule_id: str) -> dict[str, Any]:
        try:
            return services.acknowledge_schedule_reminder(schedule_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="schedule not found") from error

    @app.post("/api/work-sessions", status_code=201)
    def create_work_session(payload: WorkSessionCreate) -> dict[str, Any]:
        return services.create_work_session(payload)

    @app.get("/api/work-sessions")
    def list_work_sessions() -> dict[str, Any]:
        return {"items": services.list_work_sessions()}

    @app.patch("/api/work-sessions/{session_id}")
    def update_work_session(session_id: str, payload: WorkSessionUpdate) -> dict[str, Any]:
        try:
            return services.update_work_session(session_id, payload)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work session not found") from exc

    @app.post("/api/work-sessions/{session_id}/context/reset")
    def reset_work_session_context(session_id: str) -> dict[str, Any]:
        try:
            return services.reset_work_session_context(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work session not found") from exc

    @app.get("/api/work-sessions/{session_id}/file-links")
    def list_work_session_file_links(session_id: str) -> dict[str, Any]:
        try:
            return {"items": services.list_work_session_file_links(session_id)}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work session not found") from exc

    @app.post("/api/work-sessions/{session_id}/file-links", status_code=201)
    def create_work_session_file_links(
        session_id: str,
        payload: WorkSessionFileLinksCreate,
    ) -> dict[str, Any]:
        try:
            return {"items": services.create_work_session_file_links(session_id, payload)}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work session not found") from exc

    @app.delete("/api/work-sessions/{session_id}/file-links/{link_id}")
    def delete_work_session_file_link(session_id: str, link_id: str) -> dict[str, Any]:
        try:
            return services.delete_work_session_file_link(session_id, link_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work session file link not found") from exc

    @app.get("/api/work-sessions/{session_id}/graph")
    def work_session_graph(session_id: str) -> dict[str, Any]:
        try:
            return services.build_work_session_graph(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work session not found") from exc

    @app.post("/api/work-sessions/{session_id}/messages", status_code=201)
    def create_work_session_message(
        session_id: str, payload: WorkSessionMessageCreate
    ) -> dict[str, Any]:
        try:
            return services.create_work_session_message(session_id, payload)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work session not found") from exc

    @app.get("/api/work-sessions/{session_id}/messages")
    def list_work_session_messages(session_id: str) -> dict[str, Any]:
        try:
            return {"items": services.list_work_session_messages(session_id)}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work session not found") from exc

    @app.post("/api/work-sessions/{session_id}/attachments", status_code=201)
    async def upload_work_session_attachments(
        session_id: str, files: list[UploadFile] = File(...)
    ) -> dict[str, Any]:
        try:
            payloads: list[tuple[str, str | None, bytes]] = []
            for file in files:
                payloads.append((file.filename or "attachment.bin", file.content_type, await file.read()))
            return {"items": services.create_work_session_attachments(session_id, payloads)}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work session not found") from exc

    @app.post("/api/work-sessions/{session_id}/turn", status_code=201)
    def run_work_session_turn(session_id: str, payload: WorkSessionTurnRequest) -> dict[str, Any]:
        try:
            return services.run_work_session_turn(session_id, payload)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work session not found") from exc

    def _sse_event(event: str, data: dict[str, Any]) -> str:
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        return f"event: {event}\ndata: {payload}\n\n"

    @app.post("/api/work-sessions/{session_id}/turn/stream")
    def stream_work_session_turn(session_id: str, payload: WorkSessionTurnRequest) -> StreamingResponse:
        def generate():
            try:
                for item in services.run_work_session_turn_stream(session_id, payload):
                    yield _sse_event(str(item["event"]), item["data"])
            except KeyError:
                yield _sse_event("error", {"message": "work session not found"})

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

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

    @app.get("/api/knowledge/sources")
    def list_knowledge_sources() -> dict[str, Any]:
        return {"items": services.knowledge.list_sources()}

    @app.post("/api/knowledge/sources", status_code=201)
    def create_knowledge_source(payload: KnowledgeSourceCreate) -> dict[str, Any]:
        ensure_no_active_knowledge_ingestion()
        try:
            return services.knowledge.register_source(
                label=payload.label,
                root_path=payload.root_path,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/knowledge/sources/{source_id}/scan")
    def scan_knowledge_source(source_id: str) -> dict[str, Any]:
        ensure_no_active_knowledge_ingestion()
        try:
            return services.knowledge.scan_source(source_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="knowledge source not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/api/knowledge/sources/{source_id}/diff")
    def diff_knowledge_source(source_id: str) -> dict[str, Any]:
        """W7 P1 §9: 변경 확인 견적 — 읽기 전용 diff(반영·기록 없음, 연속 호출 동일 결과)."""
        try:
            return services.knowledge.diff_source(source_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="knowledge source not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/api/knowledge/source-files")
    def list_knowledge_source_files(source_id: str | None = None) -> dict[str, Any]:
        return {"items": services.knowledge.list_source_files(source_id=source_id)}

    def enqueue_or_run_ingestion(
        payload: KnowledgeIngestRequest,
        background_tasks: BackgroundTasks,
        *,
        force: bool = False,
    ) -> dict[str, Any]:
        ensure_no_active_knowledge_ingestion()
        source = services.db.fetch_one("SELECT * FROM knowledge_sources WHERE id = ?", (payload.source_id,))
        if source is None:
            raise KeyError(payload.source_id)
        work_job = services.jobs.create_job(
            kind="knowledge.reindex" if force else "knowledge.ingest",
            title=f"{source['label']} 지식위키 {'강제 재색인' if force else '색인'}",
            input={"source_id": payload.source_id, "run_now": payload.run_now, "background": payload.background, "force": force},
            resource_key=f"knowledge_source:{payload.source_id}",
            resource_policy="exclusive",
        )
        scan_result = services.knowledge.scan_source(payload.source_id)
        scan_unstable = int(scan_result.get("unstable_count") or 0)

        def stamp_unstable(ingestion_job: dict[str, Any]) -> dict[str, Any]:
            # W7 P1: 잡 카드의 "보류 N건 — 다음 스캔에서 처리" 배지용.
            if scan_unstable:
                services.db.execute(
                    "UPDATE knowledge_ingestion_jobs SET unstable_count = ? WHERE id = ?",
                    (scan_unstable, ingestion_job["id"]),
                )
                ingestion_job["unstable_count"] = scan_unstable
            return ingestion_job

        if payload.background and payload.run_now:
            job = stamp_unstable(
                services.wiki.ingest_source(payload.source_id, run_now=False, force=force)
            )
            services.jobs.update_progress(
                work_job["id"],
                progress_percent=1,
                stage="지식위키 작업 등록",
                message="백그라운드 색인 작업을 준비했습니다.",
                payload={"ingestion_job_id": job["id"]},
            )
            services.job_runner.submit_existing(
                work_job["id"],
                lambda: services.run_knowledge_ingestion_work_job(work_job["id"], job["id"]),
            )
            return {"job": job, "work_job": services.jobs.require_job(work_job["id"])}

        if not payload.run_now:
            job = stamp_unstable(
                services.wiki.ingest_source(payload.source_id, run_now=False, force=force)
            )
            services.jobs.update_progress(
                work_job["id"],
                progress_percent=0,
                stage="지식위키 대기열 등록",
                message="수동 실행 대기열에 등록했습니다.",
                payload={"ingestion_job_id": job["id"]},
            )
            return {"job": job, "work_job": services.jobs.require_job(work_job["id"])}

        started_work_job = services.jobs.start_job_with_lock(work_job["id"], stage="지식위키 색인 실행")
        if started_work_job["status"] == "blocked":
            return {"job": {}, "work_job": started_work_job}
        job = stamp_unstable(
            services.wiki.ingest_source(payload.source_id, run_now=True, force=force)
        )
        terminal_status = (
            "succeeded"
            if job.get("status") == "completed"
            else ("partial" if job.get("status") == "partial" else "failed")
        )
        completed = services.jobs.complete_job(
            work_job["id"],
            status=terminal_status,
            result={
                "ingestion_job_id": job["id"],
                "status": job.get("status"),
                "processed_count": job.get("processed_count"),
                "failed_count": job.get("failed_count"),
            },
            stage="지식위키 색인 완료" if terminal_status in {"succeeded", "partial"} else "지식위키 색인 실패",
        )
        return {"job": job, "work_job": completed}

    @app.post("/api/knowledge/ingest", status_code=201)
    def ingest_knowledge_source(
        payload: KnowledgeIngestRequest,
        background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        try:
            return enqueue_or_run_ingestion(payload, background_tasks)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="knowledge source not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/knowledge/reindex", status_code=201)
    def reindex_knowledge_source(
        payload: KnowledgeIngestRequest,
        background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        try:
            return enqueue_or_run_ingestion(payload, background_tasks, force=True)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="knowledge source not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/api/knowledge/ingestion-jobs")
    def list_knowledge_ingestion_jobs() -> dict[str, Any]:
        return {"items": services.wiki.list_jobs()}

    @app.get("/api/knowledge/ingestion-jobs/{job_id}/log")
    def read_knowledge_ingestion_job_log(job_id: str, limit: int = 200) -> dict[str, Any]:
        try:
            return services.wiki.read_job_log(job_id, limit=limit)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="knowledge ingestion job not found") from exc

    @app.post("/api/knowledge/ingestion-jobs/{job_id}/run")
    def run_knowledge_ingestion_job(job_id: str) -> dict[str, Any]:
        try:
            return {"job": services.wiki.run_job(job_id)}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="knowledge ingestion job not found") from exc

    @app.post("/api/knowledge/ingestion-jobs/{job_id}/cancel")
    def cancel_knowledge_ingestion_job(job_id: str) -> dict[str, Any]:
        try:
            return {"job": services.wiki.request_cancel(job_id)}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="knowledge ingestion job not found") from exc

    @app.post("/api/knowledge/lint")
    def lint_knowledge_wiki(payload: KnowledgeLintRequest | None = None) -> dict[str, Any]:
        # W7 P0: lint quick 모드 API 노출 — 기본은 재해시 없는 quick, deep=True만 전량 재해시
        ensure_no_active_knowledge_ingestion()
        options = payload or KnowledgeLintRequest()
        report = services.wiki.lint(fix=options.fix, deep=options.deep)
        mode_label = "심층" if options.deep else "빠른"
        services.db.log(
            feature="knowledge",
            action="knowledge.wiki.lint",
            status="completed",
            inputs={"fix": options.fix, "deep": options.deep},
            outputs={
                "message": (
                    f"지식위키 정합성 점검({mode_label} 모드): 문서 {report['checked_count']}건 점검, "
                    f"고아 {len(report['orphans'])}건, 카드 실종 {len(report['missing_cards'])}건, "
                    f"해시 불일치 {len(report['stale'])}건, 자동 정리 {report['fixed']['orphans_removed']}건"
                ),
                "mode": report["mode"],
                "checked_count": report["checked_count"],
                "orphan_count": len(report["orphans"]),
                "stale_count": len(report["stale"]),
                "orphans_removed": report["fixed"]["orphans_removed"],
            },
        )
        return report

    @app.post("/api/knowledge/verify", status_code=201)
    def verify_knowledge_wiki(payload: KnowledgeVerifyRequest | None = None) -> dict[str, Any]:
        # P3 §6: verify 잡 — lint 확장. 색인 진행 중에는 409(상호 배제), work_job으로 실행.
        options = payload or KnowledgeVerifyRequest()
        ensure_no_active_knowledge_ingestion()
        work_job = services.jobs.create_job(
            kind="knowledge.verify",
            title=f"지식위키 무결성 점검({'심층' if options.deep else '빠른'})",
            input={"deep": options.deep, "background": options.background},
            resource_key="knowledge_wiki:verify",
            resource_policy="exclusive",
        )
        if options.background:
            services.job_runner.submit_existing(
                work_job["id"],
                lambda: services.run_knowledge_verify_work_job(work_job["id"], deep=options.deep),
            )
            return {"work_job": services.jobs.require_job(work_job["id"])}
        completed = services.run_knowledge_verify_work_job(work_job["id"], deep=options.deep)
        return {"work_job": completed, "report": completed.get("result")}

    @app.get("/api/knowledge/verify/latest")
    def latest_knowledge_verify_report() -> dict[str, Any]:
        # P3 §6: 대시보드 "마지막 검증 N일 전" 근거 — 0건 리포트도 그대로 노출된다.
        return {"report": services.wiki.latest_verify_report()}

    @app.post("/api/knowledge/migrate-doc-uid")
    def migrate_knowledge_doc_uid(
        payload: KnowledgeDocUidMigrateRequest | None = None,
    ) -> dict[str, Any]:
        # W7 P2b §5.6: doc_uid 무파싱 마이그레이션 — 색인 잡 시작 시 자동 편입도 되지만
        # (run_job 1회성), 수동 즉시 실행 경로를 함께 노출한다. 색인과 상호 배제.
        ensure_no_active_knowledge_ingestion()
        options = payload or KnowledgeDocUidMigrateRequest()
        return services.wiki.migrate_doc_uids(source_id=options.source_id)

    @app.get("/api/knowledge/cards/by-uid/{doc_uid}")
    def knowledge_card_by_uid(doc_uid: str) -> dict[str, Any]:
        # W7 P2b §5.6: 채팅 인용 칩 '원본 열기' 폴백 — 카드 존재·상태 조회.
        try:
            return services.wiki.card_by_uid(doc_uid)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="knowledge card not found") from exc

    @app.get("/api/knowledge/chunks")
    def list_knowledge_chunks(document_id: str | None = None) -> dict[str, Any]:
        # 레거시 호환: wiki 엔진은 청크를 기록하지 않으므로 기존 데이터만 노출된다.
        if document_id:
            rows = services.db.fetch_all(
                "SELECT * FROM knowledge_document_chunks WHERE document_id = ? ORDER BY chunk_index ASC",
                (document_id,),
            )
        else:
            rows = services.db.fetch_all(
                "SELECT * FROM knowledge_document_chunks ORDER BY created_at DESC, chunk_index ASC"
            )
        return {"items": rows}

    @app.get("/api/knowledge/documents")
    def list_knowledge_documents(source_id: str | None = None) -> dict[str, Any]:
        return {"items": services.wiki.list_documents(source_id=source_id)}

    @app.get("/api/knowledge/document-structure")
    def knowledge_document_structure(document_id: str, section_limit: int = 60) -> dict[str, Any]:
        try:
            return services.wiki.document_structure(document_id, section_limit=section_limit)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="knowledge document not found") from exc

    @app.get("/api/knowledge/tables")
    def list_knowledge_tables(document_id: str | None = None) -> dict[str, Any]:
        return {"items": services.wiki.list_tables(document_id=document_id)}

    @app.post("/api/knowledge/retrieve")
    def retrieve_knowledge(payload: KnowledgeRetrieveRequest) -> dict[str, Any]:
        return services.wiki.retrieve(
            query=payload.query,
            session_id=payload.session_id,
            limit=payload.limit,
        )

    @app.post("/api/knowledge/ask")
    def ask_knowledge(payload: KnowledgeRetrieveRequest) -> dict[str, Any]:
        return services.wiki.ask(
            query=payload.query,
            session_id=payload.session_id,
            limit=payload.limit,
            llm=services._wiki_llm_generate,
        )

    def parse_structured_document_response(payload: KnowledgeParseDocumentRequest) -> dict[str, Any]:
        path = Path(payload.file_path).expanduser().resolve()
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="document file not found")
        document = parse_document(path)
        sections = [
            {
                "heading": section.heading,
                "level": section.level,
                "paragraphs": section.paragraphs,
                "tables": [
                    {
                        "headers": table.headers,
                        "rows": table.rows,
                        "caption": table.caption,
                    }
                    for table in section.tables
                ],
            }
            for section in document.sections
        ]
        tables = [
            {
                "section_heading": section.heading,
                "headers": table.headers,
                "rows": table.rows,
                "caption": table.caption,
            }
            for section in document.sections
            for table in section.tables
        ]
        return {
            "document": {
                "title": document.title,
                "document_type": document.document_type,
                "metadata": document.metadata,
                "parser_name": document.parser_name,
                "parser_version": document.parser_version,
                "quality_score": document.quality_score,
                "partial": document.partial,
            },
            "sections": sections,
            "tables": tables,
        }

    @app.post("/api/knowledge/parse-hwp")
    def parse_hwp_document(payload: KnowledgeParseDocumentRequest) -> dict[str, Any]:
        return parse_structured_document_response(payload)

    @app.post("/api/knowledge/parse-hwpx")
    def parse_hwpx_document(payload: KnowledgeParseDocumentRequest) -> dict[str, Any]:
        return parse_structured_document_response(payload)

    @app.post("/api/knowledge/candidates/{candidate_id}/approve")
    def approve_candidate(candidate_id: str, payload: CandidateApproveRequest) -> dict[str, Any]:
        try:
            return services.knowledge.approve_candidate(candidate_id, payload.page_type)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="candidate not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/api/knowledge/pages")
    def list_pages() -> dict[str, Any]:
        return {
            "items": services.db.fetch_all(
                "SELECT * FROM knowledge_pages ORDER BY created_at DESC"
            )
        }

    @app.get("/api/knowledge/search")
    def search_knowledge(query: str, limit: int = 8) -> dict[str, Any]:
        return services.wiki.search(query, limit=limit)

    @app.get("/api/files/search")
    def search_files(query: str, limit: int = 20) -> dict[str, Any]:
        return services.search_files(query=query, limit=limit)

    @app.post("/api/files/index/rebuild")
    def rebuild_file_search_index() -> dict[str, Any]:
        return services.rebuild_file_search_index()

    @app.get("/api/knowledge/graph")
    def knowledge_graph() -> dict[str, Any]:
        return services.wiki.graph_summary()

    @app.get("/api/knowledge/backend-status")
    def knowledge_backend_status() -> dict[str, Any]:
        llm_configured = bool(services.settings.llm_model and services.settings.llm_provider)
        return services.wiki.backend_status(llm_configured=llm_configured)

    @app.get("/api/knowledge/parser-status")
    def knowledge_parser_status() -> dict[str, Any]:
        return {"kordoc": kordoc_status()}

    @app.get("/api/knowledge/graph/query")
    def query_knowledge_graph(query: str, limit: int = 20) -> dict[str, Any]:
        return services.wiki.graph_query(query=query, limit=limit)

    @app.post("/api/knowledge/enrich", status_code=201)
    def enrich_knowledge(payload: KnowledgeEnrichRequest) -> dict[str, Any]:
        work_job = services.jobs.create_job(
            kind="knowledge.enrich",
            title="지식위키 LLM 보강",
            input={
                "source_id": payload.source_id,
                "background": payload.background,
                "limit": payload.limit,
            },
            resource_key="knowledge_wiki:enrich",
            resource_policy="exclusive",
        )
        if payload.background:
            services.job_runner.submit_existing(
                work_job["id"],
                lambda: services.run_knowledge_enrichment_work_job(
                    work_job["id"], payload.source_id, payload.limit
                ),
            )
            return {"work_job": services.jobs.require_job(work_job["id"])}
        return {
            "work_job": services.run_knowledge_enrichment_work_job(
                work_job["id"], payload.source_id, payload.limit
            )
        }

    @app.get("/api/knowledge/wiki/index")
    def knowledge_wiki_index() -> dict[str, Any]:
        return services.wiki.wiki_index()

    @app.get("/api/knowledge/wiki/tree")
    def knowledge_wiki_tree() -> dict[str, Any]:
        return services.wiki.wiki_tree()

    @app.get("/api/knowledge/wiki/page")
    def knowledge_wiki_page(path: str) -> dict[str, Any]:
        try:
            return services.wiki.read_page(path)
        except PermissionError as exc:
            raise HTTPException(status_code=400, detail="invalid wiki page path") from exc
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="wiki page not found") from exc

    # ----------------------------------------------- T-01 Work-Aware 분류체계

    @app.post("/api/knowledge/taxonomy/interview")
    def save_taxonomy_interview(payload: TaxonomyInterviewRequest) -> dict[str, Any]:
        return {"interview": services.taxonomy.save_interview(payload.model_dump())}

    @app.get("/api/knowledge/taxonomy/interview")
    def get_taxonomy_interview() -> dict[str, Any]:
        return {"interview": services.taxonomy.get_interview()}

    @app.get("/api/knowledge/taxonomy/proposal")
    def taxonomy_proposal(source_id: str, llm_refine: bool = False) -> dict[str, Any]:
        try:
            return services.taxonomy.analyze_source(
                source_id,
                llm=services._wiki_llm_generate if llm_refine else None,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="knowledge source not found") from exc

    @app.post("/api/knowledge/taxonomy", status_code=201)
    def confirm_taxonomy(payload: TaxonomyConfirmRequest) -> dict[str, Any]:
        try:
            return services.taxonomy.confirm_taxonomy(
                source_id=payload.source_id,
                work_areas=[area.model_dump() for area in payload.work_areas],
                doc_roles_enabled=payload.doc_roles_enabled,
                family_policy=payload.family_policy,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="knowledge source not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/knowledge/taxonomy")
    def get_taxonomy(source_id: str | None = None) -> dict[str, Any]:
        return services.taxonomy.current_taxonomy(source_id=source_id)

    @app.post("/api/knowledge/taxonomy/apply", status_code=201)
    def apply_taxonomy(payload: TaxonomyApplyRequest) -> dict[str, Any]:
        source = services.db.fetch_one(
            "SELECT * FROM knowledge_sources WHERE id = ?", (payload.source_id,)
        )
        if source is None:
            raise HTTPException(status_code=404, detail="knowledge source not found")
        configured = services.taxonomy.current_taxonomy(source_id=payload.source_id)
        if not configured["configured"]:
            raise HTTPException(status_code=409, detail="taxonomy is not confirmed for this source")
        work_job = services.jobs.create_job(
            kind="knowledge.taxonomy.apply",
            title=f"{source['label']} 업무 분류체계 적용",
            input={"source_id": payload.source_id, "background": payload.background},
            resource_key=f"knowledge_source:{payload.source_id}",
            resource_policy="exclusive",
        )
        if payload.background:
            services.job_runner.submit_existing(
                work_job["id"],
                lambda: services.run_taxonomy_apply_work_job(work_job["id"], payload.source_id),
            )
            return {"work_job": services.jobs.require_job(work_job["id"])}
        try:
            completed = services.run_taxonomy_apply_work_job(work_job["id"], payload.source_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"work_job": completed, "quality": (completed.get("result") or {}).get("quality")}

    @app.get("/api/knowledge/taxonomy/quality")
    def taxonomy_quality(source_id: str | None = None) -> dict[str, Any]:
        return services.taxonomy.quality(source_id=source_id)

    @app.get("/api/knowledge/taxonomy/queue")
    def taxonomy_queue(source_id: str | None = None, status: str = "pending") -> dict[str, Any]:
        return {"items": services.taxonomy.list_queue(source_id=source_id, status=status)}

    @app.post("/api/knowledge/taxonomy/queue/{item_id}/resolve")
    def resolve_taxonomy_queue_item(
        item_id: str, payload: TaxonomyQueueResolveRequest
    ) -> dict[str, Any]:
        try:
            return {
                "item": services.taxonomy.resolve_queue_item(
                    item_id,
                    work_area_slug=payload.work_area_slug,
                    doc_role=payload.doc_role,
                )
            }
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="taxonomy queue item not found") from exc
        except InvalidTagError as exc:
            # §5.2: 확정 taxonomy에 없는 slug/역할 — 유령 태그 차단 (400)
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/personalization/work-sessions/{session_id}/analyze", status_code=201)
    def analyze_work_session_for_personalization(session_id: str) -> dict[str, Any]:
        try:
            return services.analyze_work_session(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="work session not found") from exc

    @app.get("/api/personalization/candidates")
    def list_personalization_candidates() -> dict[str, Any]:
        return {"items": services.personalization.list_candidates()}

    @app.post("/api/personalization/candidates/{candidate_id}/decide")
    def decide_personalization_candidate(
        candidate_id: str,
        payload: PersonalizationDecisionRequest,
    ) -> dict[str, Any]:
        try:
            return services.personalization.decide_candidate(
                candidate_id=candidate_id,
                status=payload.status,
                personalization_root=services.personalization_root,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="personalization candidate not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/documents/content-bases", status_code=201)
    def create_content_base(payload: ContentBaseCreate) -> dict[str, Any]:
        try:
            return services.documents.create_content_base(
                title=payload.title,
                purpose=payload.purpose,
                template_key=payload.template_key,
                source_session_id=payload.source_session_id,
                outline=payload.outline,
                document_format=payload.document_format,
                audience_type=payload.audience_type,
                expected_length=payload.expected_length,
                urgency_level=payload.urgency_level,
                needs_traceability=payload.needs_traceability,
                requires_official_form=payload.requires_official_form,
                requested_action=payload.requested_action,
                deadline=payload.deadline,
                security_level=payload.security_level,
                direct_file_paths=payload.direct_file_paths,
                user_template_path=payload.user_template_path,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="source work session not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/documents/generate", status_code=201)
    def generate_document(payload: DocumentGenerateRequest) -> dict[str, Any]:
        work_job = services.jobs.create_job(
            kind="documents.generate",
            title=f"{payload.title or payload.output_name or '문서'} HWPX 생성",
            input={
                "title": payload.title,
                "document_format": payload.document_format,
                "source_session_id": payload.source_session_id,
                "direct_file_count": len(payload.direct_file_paths),
            },
            resource_key=f"document_output:{payload.output_name or payload.title}",
            resource_policy="exclusive",
        )
        try:
            started_job = services.jobs.start_job_with_lock(work_job["id"], stage="문서 컨텍스트 수집")
            if started_job["status"] == "blocked":
                return {"status": "blocked", "work_job": started_job}
            result = services.generate_document_from_request(payload)
            completed = services.jobs.complete_job(
                work_job["id"],
                status="succeeded",
                result={
                    "content_base_id": result.get("content_base", {}).get("id"),
                    "artifact_path": result.get("artifact", {}).get("path"),
                    "markdown_path": result.get("artifact", {}).get("markdown_path"),
                    "format": result.get("artifact", {}).get("format"),
                },
                stage="HWPX 문서 생성 완료",
            )
            result["work_job"] = completed
            return result
        except KeyError as exc:
            services.jobs.fail_job(work_job["id"], error_message="source work session or content base not found", stage="문서 컨텍스트 수집 실패")
            raise HTTPException(status_code=404, detail="source work session or content base not found") from exc
        except ValueError as exc:
            services.jobs.fail_job(work_job["id"], error_message=str(exc), stage="문서 생성 요청 검증 실패")
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            services.jobs.fail_job(work_job["id"], error_message=str(exc), stage="HWPX 문서 생성 실패")
            raise

    @app.get("/api/documents/templates/custom")
    def list_custom_document_templates() -> dict[str, Any]:
        return {"items": services.documents.list_custom_templates()}

    @app.post("/api/documents/templates/custom", status_code=201)
    async def upload_custom_document_template(file: UploadFile = File(...)) -> dict[str, Any]:
        try:
            return {"item": services.documents.save_custom_template(file.filename or "template.hwpx", await file.read())}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/documents/attachments", status_code=201)
    async def upload_document_attachments(files: list[UploadFile] = File(...)) -> dict[str, Any]:
        payloads: list[tuple[str, str | None, bytes]] = []
        for file in files:
            payloads.append((file.filename or "attachment.bin", file.content_type, await file.read()))
        return {"items": services.create_document_attachments(payloads)}

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
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

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
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/api/execution-logs")
    def list_execution_logs(limit: int = 50) -> dict[str, Any]:
        return {"items": services.db.list_logs(limit=limit)}

    return app
