from __future__ import annotations

from html import escape
from pathlib import Path
from typing import Any
from uuid import uuid4

from .db import Database, now_iso
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


class DocumentManager:
    def __init__(self, paths: WorkspacePaths, db: Database) -> None:
        self.paths = paths
        self.db = db

    def create_content_base(
        self,
        *,
        title: str,
        purpose: str,
        template_key: str,
        reference_set_id: str | None,
    ) -> dict[str, Any]:
        template = TEMPLATES.get(template_key, TEMPLATES["report"])
        references = self._reference_lines(reference_set_id)
        content_base_id = str(uuid4())
        base_path = self.paths.content_bases / f"{content_base_id}.md"
        preview_path = self.paths.drafts / f"{content_base_id}.html"
        body = self._render_markdown(title=title, template=template, references=references)
        base_path.write_text(body, encoding="utf-8")
        preview_path.write_text(self._render_html(body), encoding="utf-8")

        record = {
            "id": content_base_id,
            "title": title,
            "purpose": purpose,
            "template_key": template_key,
            "reference_set_id": reference_set_id,
            "artifact_path": str(base_path),
            "preview_path": str(preview_path),
            "created_at": now_iso(),
        }
        self.db.insert("content_bases", record)
        self.db.log(
            feature="documents",
            action="documents.content_base.created",
            status="success",
            inputs={"title": title, "template_key": template_key, "reference_set_id": reference_set_id},
            outputs={"content_base_id": content_base_id, "path": str(base_path)},
        )
        return {
            "id": content_base_id,
            "title": title,
            "purpose": purpose,
            "template_key": template_key,
            "artifact": {"path": str(base_path)},
            "preview": {"path": str(preview_path)},
            "content": body,
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

    def _render_markdown(self, *, title: str, template: dict[str, Any], references: list[str]) -> str:
        sections = []
        for section in template["sections"]:
            if section == "참고자료":
                sections.append(f"## {section}\n" + "\n".join(references))
            else:
                sections.append(f"## {section}\n- {section} 내용을 여기에 정리합니다.")

        return f"# {title}\n\n" + "\n\n".join(sections) + "\n"

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

