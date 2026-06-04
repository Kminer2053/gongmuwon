from __future__ import annotations

import json
import re
from html import escape
from pathlib import Path
from typing import Any
from uuid import uuid4

from .db import Database, now_iso
from .document_parsers import parse_document
from .document_planning import FileExcerptReader, build_document_plan, compile_document_brief, render_brief_markdown
from .graphrag_models import StructuredDocument
from .hwpx_writer import write_public_hwpx_document
from .workspace import WorkspacePaths


TEMPLATES = {
    "report": {
        "name": "보고서형",
        "sections": ["개요", "핵심 내용", "후속 조치", "참고자료"],
    },
    "meeting": {
        "name": "회의자료형",
        "sections": ["회의 목적", "논의 안건", "결정 사항", "참고자료"],
    },
    "review": {
        "name": "검토메모형",
        "sections": ["검토 배경", "검토 의견", "권고안", "참고자료"],
    },
}

DOCUMENT_FORMAT_LABELS = {
    "auto": "자동 선택",
    "officialMemo": "시행문",
    "onePageReport": "1페이지 보고서",
    "fullReport": "풀버전 보고서",
    "email": "이메일",
}

TEMPLATE_EXTENSIONS = {".hwpx", ".hwtx"}
TEXT_EXCERPT_EXTENSIONS = {".txt", ".md", ".markdown", ".csv", ".json", ".log", ".yaml", ".yml"}
STRUCTURED_EXCERPT_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx", ".hwp", ".hwpx"}
MAX_IMMEDIATE_PARSE_BYTES = 20 * 1024 * 1024
AUTHORING_CONTEXT_BUDGET_BYTES = 32 * 1024
AUTHORING_PER_FILE_BUDGET_BYTES = 8 * 1024


class DocumentManager:
    def __init__(self, paths: WorkspacePaths, db: Database, graphrag: Any | None = None) -> None:
        self.paths = paths
        self.db = db
        self.graphrag = graphrag

    def create_content_base(
        self,
        *,
        title: str,
        purpose: str,
        template_key: str,
        reference_set_id: str | None,
        source_session_id: str | None = None,
        outline: str = "",
        document_format: str = "auto",
        audience_type: str = "",
        expected_length: str = "",
        urgency_level: str = "",
        needs_traceability: str = "",
        requires_official_form: str = "",
        requested_action: str = "",
        deadline: str = "",
        security_level: str = "",
        direct_file_paths: list[str] | None = None,
        user_template_path: str | None = None,
        prepared_content_markdown: str | None = None,
    ) -> dict[str, Any]:
        template = TEMPLATES.get(template_key, TEMPLATES["report"])
        references = self._reference_lines(reference_set_id)
        session_context = self._session_context(source_session_id)
        direct_paths = [path.strip() for path in direct_file_paths or [] if path.strip()]
        selected_template_path = self._normalize_user_template_path(user_template_path)
        source_analysis = self.analyze_authoring_sources(direct_paths)
        content_base_id = str(uuid4())
        base_path = self.paths.content_bases / f"{content_base_id}.md"
        preview_path = self.paths.drafts / f"{content_base_id}.html"
        slots = {
            "audience_type": audience_type,
            "expected_length": expected_length,
            "urgency_level": urgency_level,
            "needs_traceability": needs_traceability,
            "requires_official_form": requires_official_form,
            "requested_action": requested_action,
            "deadline": deadline,
            "security_level": security_level,
        }
        knowledge_items = self._document_knowledge_items(
            title=title,
            purpose=purpose,
            outline=outline,
            source_session_id=source_session_id,
            session_context=session_context,
            direct_file_paths=direct_paths,
            source_analysis=source_analysis,
        )
        file_excerpt_reader = self._authoring_excerpt_reader(source_analysis)
        brief = compile_document_brief(
            title=title,
            purpose=purpose,
            outline=outline,
            document_format=document_format,
            session_context=session_context,
            references=references,
            direct_file_paths=direct_paths,
            slots=slots,
            file_excerpt_reader=file_excerpt_reader,
            knowledge_items=knowledge_items,
        )
        plan = build_document_plan(brief)
        if prepared_content_markdown and prepared_content_markdown.strip():
            body = self._normalize_prepared_markdown(
                prepared_content_markdown.strip(),
                title=title,
                purpose=purpose,
                document_format=document_format,
                user_template_path=selected_template_path,
                slots=slots,
            )
        else:
            body = self._render_markdown(
                title=title,
                purpose=purpose,
                template=template,
                references=references,
                session_context=session_context,
                outline=outline,
                document_format=document_format,
                slots=slots,
                direct_file_paths=direct_paths,
                user_template_path=selected_template_path,
                brief=brief,
                plan=plan,
            )
        base_path.write_text(body, encoding="utf-8")
        preview_path.write_text(self._render_html(body), encoding="utf-8")

        record = {
            "id": content_base_id,
            "title": title,
            "purpose": purpose,
            "template_key": template_key,
            "reference_set_id": reference_set_id,
            "source_session_id": source_session_id,
            "outline": outline,
            "document_format": document_format,
            "audience_type": audience_type,
            "expected_length": expected_length,
            "urgency_level": urgency_level,
            "needs_traceability": needs_traceability,
            "requires_official_form": requires_official_form,
            "requested_action": requested_action,
            "deadline": deadline,
            "security_level": security_level,
            "direct_file_paths_json": json.dumps(direct_paths, ensure_ascii=False),
            "user_template_path": selected_template_path,
            "artifact_path": str(base_path),
            "preview_path": str(preview_path),
            "created_at": now_iso(),
        }
        self.db.insert("content_bases", record)
        self.db.log(
            feature="documents",
            action="documents.content_base.created",
            status="success",
            inputs={
                "title": title,
                "template_key": template_key,
                "reference_set_id": reference_set_id,
                "source_session_id": source_session_id,
                "document_format": document_format,
            },
            outputs={"content_base_id": content_base_id, "path": str(base_path)},
        )
        return {
            "id": content_base_id,
            "title": title,
            "purpose": purpose,
            "template_key": template_key,
            "reference_set_id": reference_set_id,
            "source_session_id": source_session_id,
            "outline": outline,
            "document_format": document_format,
            "direct_file_paths": direct_paths,
            "user_template_path": selected_template_path,
            "artifact": {"path": str(base_path)},
            "preview": {"path": str(preview_path)},
            "content": body,
            "source_analysis": source_analysis,
        }

    def analyze_authoring_sources(
        self,
        direct_file_paths: list[str],
        *,
        budget_bytes: int = AUTHORING_CONTEXT_BUDGET_BYTES,
    ) -> dict[str, Any]:
        remaining = max(0, budget_bytes)
        direct_files: list[dict[str, Any]] = []
        warnings: list[str] = []
        for file_path in direct_file_paths[:10]:
            item = self._analyze_authoring_file(file_path, remaining)
            direct_files.append(item)
            warnings.extend(item.get("warnings") or [])
            excerpt = str(item.get("excerpt") or "")
            remaining = max(0, remaining - len(excerpt.encode("utf-8", errors="ignore")))
        modes = {str(item.get("analysis_mode") or "normal") for item in direct_files}
        if "limited" in modes:
            overall_mode = "limited"
        elif "partial" in modes:
            overall_mode = "partial"
        else:
            overall_mode = "normal" if direct_files else "none"
        return {
            "budget_bytes": budget_bytes,
            "used_bytes": budget_bytes - remaining,
            "overall_mode": overall_mode,
            "direct_files": direct_files,
            "warnings": _dedupe_strings(warnings),
        }

    def _analyze_authoring_file(self, file_path: str, remaining_budget: int) -> dict[str, Any]:
        path = Path(file_path)
        label = path.name or file_path
        item: dict[str, Any] = {
            "path": file_path,
            "file_name": label,
            "size_bytes": None,
            "analysis_mode": "limited",
            "excerpt": "",
            "warnings": [],
        }
        if remaining_budget <= 0:
            item["warnings"].append(f"{label}: 문서작성 입력 예산 32KB를 초과해 본문 분석을 생략했습니다.")
            return item
        if not path.exists() or not path.is_file():
            item["warnings"].append(f"{label}: 파일을 찾을 수 없어 경로 정보만 반영합니다.")
            return item

        try:
            size_bytes = path.stat().st_size
        except OSError:
            size_bytes = None
        item["size_bytes"] = size_bytes
        suffix = path.suffix.lower()
        per_file_budget = min(AUTHORING_PER_FILE_BUDGET_BYTES, max(0, remaining_budget))

        if suffix in TEXT_EXCERPT_EXTENSIONS:
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                item["warnings"].append(f"{label}: 텍스트 파일을 읽지 못해 경로 정보만 반영합니다.")
                return item
            excerpt, truncated = _truncate_to_utf8_budget(_clean_text(text), per_file_budget)
            item["excerpt"] = excerpt
            item["analysis_mode"] = "partial" if truncated else "normal"
            if truncated:
                item["warnings"].append(f"{label}: 32KB 문서작성 입력 예산에 맞춰 일부 본문만 반영했습니다.")
            return item

        if suffix not in STRUCTURED_EXCERPT_EXTENSIONS:
            item["warnings"].append(f"{label}: 지원하지 않는 형식이어서 파일명과 경로만 반영합니다.")
            return item

        if size_bytes is not None and size_bytes > MAX_IMMEDIATE_PARSE_BYTES:
            item["analysis_mode"] = "limited"
            item["warnings"].append(
                f"{label}: 파일이 {format_file_size(size_bytes)}로 커서 전체 본문을 즉시 분석하지 못했습니다. "
                "첨부는 유지하지만 보고서 품질을 높이려면 주요내용/활용목적을 입력하거나 지식폴더 색인을 먼저 실행하세요."
            )
            return item

        try:
            document = parse_document(path)
            text = self._structured_document_excerpt(document, limit=AUTHORING_PER_FILE_BUDGET_BYTES * 2)
        except Exception:
            item["warnings"].append(f"{label}: 본문 추출에 실패해 파일명과 경로만 반영합니다.")
            return item
        excerpt, truncated = _truncate_to_utf8_budget(_clean_text(text), per_file_budget)
        item["excerpt"] = excerpt
        item["analysis_mode"] = "partial" if truncated else "normal"
        if truncated:
            item["warnings"].append(f"{label}: 추출 본문이 길어 관련 일부만 문서작성 근거로 반영했습니다.")
        if not excerpt:
            item["analysis_mode"] = "limited"
            item["warnings"].append(f"{label}: 추출된 본문이 없어 파일명과 경로만 반영합니다.")
        return item

    def _authoring_excerpt_reader(self, source_analysis: dict[str, Any]) -> FileExcerptReader:
        excerpts = {
            str(item.get("path") or ""): str(item.get("excerpt") or "")
            for item in source_analysis.get("direct_files", [])
            if str(item.get("path") or "") and str(item.get("excerpt") or "")
        }

        def read(file_path: str) -> str | None:
            return excerpts.get(file_path) or self._safe_file_excerpt(file_path)

        return read

    def _normalize_prepared_markdown(
        self,
        markdown_text: str,
        *,
        title: str,
        purpose: str,
        document_format: str,
        user_template_path: str | None,
        slots: dict[str, str],
    ) -> str:
        lines: list[str] = []
        if not markdown_text.lstrip().startswith("# "):
            lines.extend([f"# {title}", ""])
        lines.extend(
            [
                "## 문서 작성 기준",
                f"- 문서 목적: {purpose}",
                f"- 출력 유형: {DOCUMENT_FORMAT_LABELS.get(document_format, document_format)} ({document_format})",
                f"- 사용자 양식: {user_template_path or '선택 안 함'}",
                "- 작성 방식: LLM WorkSessionBrief -> DocumentPlan -> public-doc-to-hwpx 서식 매핑",
                "",
            ]
        )
        lines.extend(self._slot_lines(slots))
        lines.append(markdown_text)
        return "\n".join(lines).strip() + "\n"

    def list_custom_templates(self) -> list[dict[str, Any]]:
        items = []
        for path in sorted(self.paths.templates.glob("*")):
            if path.suffix.lower() not in TEMPLATE_EXTENSIONS or not path.is_file():
                continue
            stat = path.stat()
            file_name = path.name.split("-", 1)[1] if "-" in path.name else path.name
            items.append(
                {
                    "file_name": file_name,
                    "path": str(path),
                    "size_bytes": stat.st_size,
                    "uploaded_at": now_iso(),
                }
            )
        return items

    def save_custom_template(self, file_name: str, content: bytes) -> dict[str, Any]:
        suffix = Path(file_name).suffix.lower()
        if suffix not in TEMPLATE_EXTENSIONS:
            raise ValueError("HWPX 또는 HWTX 양식 파일만 업로드할 수 있습니다.")
        if not content:
            raise ValueError("빈 양식 파일은 업로드할 수 없습니다.")

        safe_name = self._safe_template_file_name(file_name)
        path = self.paths.templates / f"{uuid4()}-{safe_name}"
        path.write_bytes(content)
        uploaded_at = now_iso()
        self.db.log(
            feature="documents",
            action="documents.template.uploaded",
            status="success",
            inputs={"file_name": file_name},
            outputs={"path": str(path)},
        )
        return {
            "file_name": safe_name,
            "path": str(path),
            "size_bytes": len(content),
            "uploaded_at": uploaded_at,
        }

    def request_final_document_output(self, *, content_base_id: str, output_name: str) -> dict[str, Any]:
        content_base = self.db.fetch_one(
            "SELECT * FROM content_bases WHERE id = ?",
            (content_base_id,),
        )
        if content_base is None:
            raise KeyError(content_base_id)

        ticket = self.db.create_approval_ticket(
            target_type="document_output",
            target_id=content_base_id,
            action="documents.finalize",
        )
        request = {
            "id": str(uuid4()),
            "content_base_id": content_base_id,
            "approval_ticket_id": ticket["id"],
            "output_name": output_name,
            "artifact_path": None,
            "status": "pending",
            "created_at": now_iso(),
            "applied_at": None,
        }
        self.db.insert("final_document_outputs", request)
        self.db.log(
            feature="documents",
            action="documents.finalize.requested",
            status="pending_approval",
            inputs={"content_base_id": content_base_id, "output_name": output_name},
            outputs={
                "approval_ticket_id": ticket["id"],
                "final_document_output_id": request["id"],
            },
            approval_ticket_id=ticket["id"],
        )
        return {
            "approval_ticket": ticket,
            "final_document_output": request,
        }

    def apply_final_document_output(self, ticket_id: str) -> dict[str, Any]:
        ticket = self.db.fetch_one(
            "SELECT * FROM approval_tickets WHERE id = ?",
            (ticket_id,),
        )
        if ticket is None:
            raise KeyError(ticket_id)
        if ticket["status"] != "approved":
            raise PermissionError(ticket_id)

        request = self.db.fetch_one(
            "SELECT * FROM final_document_outputs WHERE approval_ticket_id = ?",
            (ticket_id,),
        )
        if request is None:
            raise KeyError(ticket_id)

        content_base = self.db.fetch_one(
            "SELECT * FROM content_bases WHERE id = ?",
            (request["content_base_id"],),
        )
        if content_base is None:
            raise KeyError(request["content_base_id"])

        if request["status"] == "applied" and request["artifact_path"]:
            artifact_path = Path(request["artifact_path"])
            return {
                "approval_ticket": ticket,
                "final_document_output": request,
                "artifact": {
                    "path": request["artifact_path"],
                    "markdown_path": str(artifact_path.with_suffix(".md")),
                    "format": content_base.get("document_format") or "auto",
                },
            }

        source_path = Path(content_base["artifact_path"])
        body = source_path.read_text(encoding="utf-8")
        output_path = self._available_output_path(request["output_name"])
        artifact = write_public_hwpx_document(
            output_path=output_path,
            title=content_base["title"],
            purpose=content_base["purpose"],
            template_key=content_base["template_key"],
            content_markdown=body,
            document_format=content_base.get("document_format") or "auto",
            audience_type=content_base.get("audience_type") or "",
            expected_length=content_base.get("expected_length") or "",
            urgency_level=content_base.get("urgency_level") or "",
            needs_traceability=content_base.get("needs_traceability") or "",
            requires_official_form=content_base.get("requires_official_form") or "",
            requested_action=content_base.get("requested_action") or "",
            deadline=content_base.get("deadline") or "",
            security_level=content_base.get("security_level") or "",
            user_template_path=content_base.get("user_template_path"),
        )

        applied_at = now_iso()
        updated_request = {
            **request,
            "artifact_path": str(output_path),
            "status": "applied",
            "applied_at": applied_at,
        }
        self.db.execute(
            "UPDATE final_document_outputs SET artifact_path = ?, status = ?, applied_at = ? WHERE approval_ticket_id = ?",
            (str(output_path), "applied", applied_at, ticket_id),
        )
        self.db.log(
            feature="documents",
            action="documents.finalize.applied",
            status="success",
            inputs={"ticket_id": ticket_id},
            outputs={
                "content_base_id": request["content_base_id"],
                "final_document_output_id": request["id"],
                "artifact_path": str(output_path),
                "format": artifact["format"],
            },
            approval_ticket_id=ticket_id,
        )
        return {
            "approval_ticket": ticket,
            "final_document_output": updated_request,
            "artifact": artifact,
        }

    def _session_context(self, source_session_id: str | None) -> dict[str, Any] | None:
        if not source_session_id:
            return None
        session = self.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (source_session_id,))
        if session is None:
            raise KeyError(source_session_id)
        schedule = None
        if session.get("schedule_id"):
            schedule = self.db.fetch_one("SELECT * FROM schedules WHERE id = ?", (session["schedule_id"],))
        messages = self.db.fetch_all(
            "SELECT * FROM work_session_messages WHERE session_id = ? ORDER BY created_at ASC",
            (source_session_id,),
        )
        file_links = self.db.fetch_all(
            "SELECT * FROM work_session_file_links WHERE session_id = ? ORDER BY created_at ASC",
            (source_session_id,),
        )
        return {
            "session": session,
            "schedule": schedule,
            "messages": messages,
            "file_links": file_links,
        }

    def _reference_lines(self, reference_set_id: str | None) -> list[str]:
        if not reference_set_id:
            return ["- 참고자료가 아직 연결되지 않았습니다."]

        items = self.db.fetch_all(
            "SELECT kind, label, value FROM reference_items WHERE reference_set_id = ? ORDER BY created_at ASC",
            (reference_set_id,),
        )
        if not items:
            return ["- 참고자료가 아직 연결되지 않았습니다."]

        return [f"- {item['label']} ({item['kind']}): {item['value']}" for item in items]

    def _document_knowledge_items(
        self,
        *,
        title: str,
        purpose: str,
        outline: str,
        source_session_id: str | None,
        session_context: dict[str, Any] | None,
        direct_file_paths: list[str] | None = None,
        source_analysis: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        if self.graphrag is None:
            return []
        direct_paths = [path for path in direct_file_paths or [] if path]
        if direct_paths and not _document_request_explicitly_mentions_knowledge(title, purpose, outline):
            return []
        query_parts = [outline, purpose, title]
        for message in self._document_context_messages((session_context or {}).get("messages") or []):
            query_parts.append(str(message.get("text", "")))
        query = re.sub(r"\s+", " ", " ".join(part for part in query_parts if part)).strip()
        if not query:
            return []
        query = query[:2000]
        try:
            result = self.graphrag.retrieve(query=query, session_id=source_session_id, limit=5)
        except TypeError:
            result = self.graphrag.retrieve(query=query, limit=5)
        except Exception:
            return []
        if isinstance(result, dict):
            items = result.get("items") or []
            return [item for item in items if isinstance(item, dict)]
        if isinstance(result, list):
            return [item for item in result if isinstance(item, dict)]
        return []

    def _render_markdown(
        self,
        *,
        title: str,
        purpose: str,
        template: dict[str, Any],
        references: list[str],
        session_context: dict[str, Any] | None,
        outline: str,
        document_format: str,
        slots: dict[str, str],
        direct_file_paths: list[str],
        user_template_path: str | None,
        brief: Any,
        plan: Any,
    ) -> str:
        lines = [f"# {title}", ""]
        lines += [
            "## 문서 작성 기준",
            f"- 문서 목적: {purpose}",
            f"- 출력 유형: {DOCUMENT_FORMAT_LABELS.get(document_format, document_format)} ({document_format})",
            f"- 사용자 양식: {user_template_path or '선택 안 함'}",
            "",
        ]
        lines += render_brief_markdown(brief, plan)
        lines += self._slot_lines(slots)

        if session_context:
            lines += self._session_context_lines(session_context)
            if outline.strip():
                lines += ["## 세션 기반 작성 개요", f"- {outline.strip()}", ""]
        else:
            lines += [
                "## 바로 작성 개요",
                f"- {outline.strip() or '작성 개요가 아직 입력되지 않았습니다.'}",
                "",
            ]

        if direct_file_paths:
            lines += ["## 직접 연결 파일"]
            lines += self._file_context_lines(direct_file_paths)
            lines.append("")

        for section in template["sections"]:
            if section == "참고자료":
                lines.append(f"## {section}")
                lines.extend(references)
                lines.append("")
            else:
                lines.append(f"## {section}")
                lines.append(f"- {section} 내용을 여기에 정리합니다.")
                lines.append("")

        return "\n".join(lines)

    def _slot_lines(self, slots: dict[str, str]) -> list[str]:
        labels = {
            "audience_type": "수신/대상",
            "expected_length": "예상 분량",
            "urgency_level": "긴급도",
            "needs_traceability": "추적성 필요",
            "requires_official_form": "공식 서식 필요",
            "requested_action": "요청 조치",
            "deadline": "기한",
            "security_level": "보안 수준",
        }
        lines = ["## 작성 슬롯"]
        for key, label in labels.items():
            value = slots.get(key, "").strip() or "미지정"
            lines.append(f"- {label}: {value}")
        lines.append("")
        return lines

    def _session_context_lines(self, context: dict[str, Any]) -> list[str]:
        session = context["session"]
        schedule = context.get("schedule")
        messages = context.get("messages") or []
        file_links = context.get("file_links") or []
        lines = [
            "## 업무대화 세션",
            f"- 세션 제목: {session['title']}",
            f"- 세션 ID: {session['id']}",
        ]
        if schedule:
            lines.extend(
                [
                    f"- 연결 일정: {schedule['title']}",
                    f"- 일정 시간: {schedule['starts_at']} ~ {schedule['ends_at']}",
                ]
            )
        else:
            lines.append("- 연결 일정: 없음")
        lines.append("")

        lines.append("## 업무대화 기록")
        document_messages = self._document_context_messages(messages)
        if document_messages:
            for message in document_messages:
                role = "사용자" if message["role"] == "user" else "어시스턴트"
                text = str(message["text"]).replace("\n", " ").strip()
                lines.append(f"- {role}: {text}")
        else:
            lines.append("- 아직 저장된 대화가 없습니다.")
        lines.append("")

        lines.append("## 세션 연결 파일")
        if file_links:
            for link in file_links:
                label = link.get("label") or Path(link["file_path"]).name
                lines.append(f"- {label}: {link['file_path']}")
                excerpt = self._safe_file_excerpt(link["file_path"])
                if excerpt:
                    lines.append(f"  - 본문 요약: {excerpt}")
        else:
            lines.append("- 아직 연결된 파일이 없습니다.")
        lines.append("")
        return lines

    @staticmethod
    def _document_context_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [message for message in messages if not DocumentManager._is_tool_confirmation_message(message)]

    @staticmethod
    def _is_tool_confirmation_message(message: dict[str, Any]) -> bool:
        if message.get("role") != "assistant":
            return False
        model = str(message.get("model") or "")
        if model.endswith(".confirm.request") or model == "tool.confirm.rejected":
            return True
        text = str(message.get("text") or "")
        return "처리할까요?" in text and "제가 이해한 내용" in text

    def _file_context_lines(self, file_paths: list[str]) -> list[str]:
        lines: list[str] = []
        for path in file_paths:
            label = Path(path).name or path
            lines.append(f"- {label}: {path}")
            excerpt = self._safe_file_excerpt(path)
            if excerpt:
                lines.append(f"  - 본문 요약: {excerpt}")
        return lines

    def _safe_file_excerpt(self, file_path: str, limit: int = 1200) -> str | None:
        path = Path(file_path)
        if not path.exists() or not path.is_file():
            return None
        suffix = path.suffix.lower()
        if suffix in TEXT_EXCERPT_EXTENSIONS:
            text = path.read_text(encoding="utf-8", errors="ignore")
            text = re.sub(r"\s+", " ", text).strip()
            return text[:limit] if text else None
        if suffix not in STRUCTURED_EXCERPT_EXTENSIONS:
            return None
        try:
            if path.stat().st_size > MAX_IMMEDIATE_PARSE_BYTES:
                return None
            document = parse_document(path)
        except Exception:
            return None
        text = self._structured_document_excerpt(document)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:limit] if text else None

    @staticmethod
    def _structured_document_excerpt(document: StructuredDocument, limit: int = 1800) -> str:
        parts: list[str] = []
        if document.title:
            parts.append(document.title)
        if document.metadata:
            metadata_parts = [
                f"{key}: {value}"
                for key, value in document.metadata.items()
                if value is not None and str(value).strip()
            ]
            if metadata_parts:
                parts.append("; ".join(metadata_parts[:6]))

        for section in document.sections[:4]:
            if section.heading:
                parts.append(section.heading)
            parts.extend(paragraph for paragraph in section.paragraphs[:8] if paragraph.strip())
            for table in section.tables[:2]:
                projection_lines = table.to_text_projection().splitlines()
                parts.extend(line for line in projection_lines[:4] if line.strip())
            if len(" ".join(parts)) >= limit:
                break

        text = " ".join(parts)
        return text[:limit]

    def _render_html(self, markdown_text: str) -> str:
        paragraphs = []
        for line in markdown_text.splitlines():
            escaped = escape(line)
            if line.startswith("# "):
                paragraphs.append(f"<h1>{escape(line[2:])}</h1>")
            elif line.startswith("## "):
                paragraphs.append(f"<h2>{escape(line[3:])}</h2>")
            elif line.startswith("- "):
                paragraphs.append(f"<li>{escape(line[2:])}</li>")
            elif not line.strip():
                paragraphs.append("")
            else:
                paragraphs.append(f"<p>{escaped}</p>")

        return (
            "<!doctype html><html><head><meta charset='utf-8'><title>Content Base Preview</title>"
            "<style>body{font-family:system-ui;padding:32px;max-width:900px;margin:0 auto;}li{margin-bottom:8px;}</style>"
            f"</head><body>{''.join(paragraphs)}</body></html>"
        )

    def _normalize_user_template_path(self, user_template_path: str | None) -> str | None:
        if not user_template_path:
            return None
        path = Path(user_template_path).expanduser().resolve()
        if path.suffix.lower() not in TEMPLATE_EXTENSIONS:
            raise ValueError("HWPX 또는 HWTX 양식 파일만 사용할 수 있습니다.")
        if not path.exists():
            raise ValueError("선택한 사용자 양식 파일을 찾을 수 없습니다.")
        return str(path)

    def _safe_template_file_name(self, file_name: str) -> str:
        name = Path(file_name).name
        suffix = Path(name).suffix.lower()
        stem = Path(name).stem
        stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", stem).strip(" .")
        stem = stem or "template"
        return f"{stem}{suffix}"

    def _final_output_filename(self, output_name: str) -> str:
        filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", output_name.strip())
        filename = filename.rstrip(" .")
        lower_filename = filename.lower()
        if lower_filename.endswith(".hwpx"):
            stem = filename[:-5].rstrip(" .")
        elif lower_filename.endswith(".md"):
            stem = filename[:-3].rstrip(" .")
        else:
            stem = filename
        stem = stem or "final-document"
        if stem.upper() in {
            "CON",
            "PRN",
            "AUX",
            "NUL",
            *(f"COM{index}" for index in range(1, 10)),
            *(f"LPT{index}" for index in range(1, 10)),
        }:
            stem = f"_{stem}"
        return f"{stem}.hwpx"

    def _available_output_path(self, output_name: str) -> Path:
        filename = self._final_output_filename(output_name)
        path = self.paths.outputs / filename
        if not path.exists():
            return path

        suffix = path.suffix
        stem = path.stem
        counter = 2
        while True:
            candidate = path.with_name(f"{stem}-{counter}{suffix}")
            if not candidate.exists():
                return candidate
            counter += 1


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _truncate_to_utf8_budget(value: str, budget_bytes: int) -> tuple[str, bool]:
    if budget_bytes <= 0:
        return "", bool(value)
    encoded = value.encode("utf-8", errors="ignore")
    if len(encoded) <= budget_bytes:
        return value, False
    truncated = encoded[:budget_bytes].decode("utf-8", errors="ignore").rstrip()
    return truncated, True


def _dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = _clean_text(str(value or ""))
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        result.append(cleaned)
    return result


def _document_request_explicitly_mentions_knowledge(*texts: str) -> bool:
    haystack = " ".join(texts).lower()
    return any(
        token in haystack
        for token in [
            "graphrag",
            "graph rag",
            "rag",
            "지식폴더",
            "지식 폴더",
            "지식베이스",
            "지식 베이스",
            "지식검색",
            "지식 검색",
            "로컬 지식",
        ]
    )


def format_file_size(size_bytes: int) -> str:
    if size_bytes >= 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f}MB"
    if size_bytes >= 1024:
        return f"{size_bytes / 1024:.1f}KB"
    return f"{size_bytes}B"
