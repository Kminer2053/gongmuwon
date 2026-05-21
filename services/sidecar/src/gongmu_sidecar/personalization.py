from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from .db import Database, now_iso


class PersonalizationManager:
    def __init__(self, db: Database) -> None:
        self.db = db

    def analyze_session(
        self,
        *,
        session_id: str,
        apply_mode: Literal["approval_required", "auto_apply"],
        personalization_root: Path,
    ) -> dict[str, Any]:
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
        body = self._summarize_session(session=session, messages=messages, file_links=file_links)
        payload = {
            "session_id": session_id,
            "session_title": session["title"],
            "message_count": len(messages),
            "linked_file_count": len(file_links),
            "summary": body,
            "signals": self._extract_signals(messages),
            "requested_apply_mode": apply_mode,
        }
        candidate = {
            "id": str(uuid4()),
            "candidate_type": "session_summary_index",
            "title": f"{session['title']} 개인화 요약",
            "body": body,
            "source_session_id": session_id,
            "risk_level": "low",
            "status": "pending",
            "proposed_payload": json.dumps(payload, ensure_ascii=False, indent=2),
            "created_at": now_iso(),
            "decided_at": None,
        }
        self.db.insert("personalization_candidates", candidate)
        self.db.log(
            feature="personalization",
            action="personalization.session_summary.created",
            status="success",
            inputs={"session_id": session_id, "apply_mode": apply_mode},
            outputs={"candidate_id": candidate["id"], "status": candidate["status"]},
        )

        application = self.apply_candidate(candidate["id"], personalization_root)
        candidate = self.db.fetch_one(
            "SELECT * FROM personalization_candidates WHERE id = ?",
            (candidate["id"],),
        ) or candidate
        return {"candidate": candidate, "application": application}

    def list_candidates(self) -> list[dict[str, Any]]:
        return self.db.fetch_all(
            "SELECT * FROM personalization_candidates ORDER BY created_at DESC"
        )

    def decide_candidate(
        self,
        *,
        candidate_id: str,
        status: Literal["approved", "rejected"],
        personalization_root: Path,
    ) -> dict[str, Any]:
        candidate = self.db.fetch_one(
            "SELECT * FROM personalization_candidates WHERE id = ?",
            (candidate_id,),
        )
        if candidate is None:
            raise KeyError(candidate_id)
        if candidate["status"] in {"applied", "rejected"}:
            raise ValueError("personalization candidate already decided")
        if status == "rejected":
            decided_at = now_iso()
            self.db.execute(
                "UPDATE personalization_candidates SET status = ?, decided_at = ? WHERE id = ?",
                ("rejected", decided_at, candidate_id),
            )
            updated = self.db.fetch_one(
                "SELECT * FROM personalization_candidates WHERE id = ?",
                (candidate_id,),
            )
            return {"candidate": updated, "application": None}

        application = self.apply_candidate(candidate_id, personalization_root)
        updated = self.db.fetch_one(
            "SELECT * FROM personalization_candidates WHERE id = ?",
            (candidate_id,),
        )
        return {"candidate": updated, "application": application}

    def apply_candidate(self, candidate_id: str, personalization_root: Path) -> dict[str, Any]:
        candidate = self.db.fetch_one(
            "SELECT * FROM personalization_candidates WHERE id = ?",
            (candidate_id,),
        )
        if candidate is None:
            raise KeyError(candidate_id)

        payload = json.loads(candidate["proposed_payload"])
        timestamp = now_iso()
        summary_dir = personalization_root / "session-summaries"
        audit_dir = personalization_root / "audit-log" / timestamp[:10]
        summary_dir.mkdir(parents=True, exist_ok=True)
        audit_dir.mkdir(parents=True, exist_ok=True)
        summary_path = summary_dir / f"{candidate_id}.json"
        audit_path = audit_dir / f"{candidate_id}.json"
        summary_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        audit_path.write_text(
            json.dumps(
                {
                    "candidate_id": candidate_id,
                    "candidate_type": candidate["candidate_type"],
                    "applied_at": timestamp,
                    "summary_path": str(summary_path),
                    "payload": payload,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        self.db.execute(
            "UPDATE personalization_candidates SET status = ?, decided_at = ? WHERE id = ?",
            ("applied", timestamp, candidate_id),
        )
        self.db.log(
            feature="personalization",
            action="personalization.session_summary.applied",
            status="success",
            inputs={"candidate_id": candidate_id},
            outputs={"summary_path": str(summary_path), "audit_path": str(audit_path)},
        )
        return {
            "summary_path": str(summary_path),
            "audit_path": str(audit_path),
            "applied_at": timestamp,
        }

    def _summarize_session(
        self,
        *,
        session: dict[str, Any],
        messages: list[dict[str, Any]],
        file_links: list[dict[str, Any]],
    ) -> str:
        message_lines = [f"- {item['role']}: {item['text']}" for item in messages[-6:]]
        file_lines = [
            f"- {item['label'] or Path(item['file_path']).name}: {item['file_path']}"
            for item in file_links[:5]
        ]
        parts = [
            f"세션 제목: {session['title']}",
            f"메시지 수: {len(messages)}",
            f"연결 파일 수: {len(file_links)}",
        ]
        if message_lines:
            parts.append("최근 대화:\n" + "\n".join(message_lines))
        if file_lines:
            parts.append("연결 파일:\n" + "\n".join(file_lines))
        return "\n\n".join(parts)

    def _extract_signals(self, messages: list[dict[str, Any]]) -> list[str]:
        signals: list[str] = []
        text = "\n".join(str(message.get("text") or "") for message in messages).lower()
        if "선호" in text or "좋아" in text:
            signals.append("preference")
        if "회의" in text:
            signals.append("meeting")
        if "예산" in text:
            signals.append("budget")
        if "문서" in text:
            signals.append("document")
        return signals
