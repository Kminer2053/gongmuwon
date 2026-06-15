from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from uuid import uuid4

from .db import Database, now_iso


PROFILE_ID = "default"

ROLE_LABELS = {
    "org_source": "조직/직무 기준",
    "policy_source": "규정/지침",
    "work_product": "생산문서",
    "collaboration_record": "협업문서",
    "data_source": "데이터시트",
    "template_source": "양식",
    "reference_material": "참고자료",
    "decision_record": "의사결정자료",
}

VERSION_MARKERS = {
    "final": ("최종", "제출", "제출본", "완료", "확정"),
    "revision": ("수정", "개정", "보완", "검토", "v2", "v3", "v4", "rev"),
    "draft": ("초안", "draft", "시안", "작성중"),
    "converted": ("pdf", "스캔", "변환"),
}

POLICY_TERMS = (
    "규정",
    "지침",
    "위임전결",
    "전결",
    "직제",
    "업무분장",
    "문서관리",
    "보안",
    "개인정보",
    "계약",
    "예산",
)
ORG_TERMS = ("조직도", "업무분장", "직제", "부서", "담당업무", "역할")
DATA_TERMS = ("실적", "통계", "현황", "데이터", "집계", "목록", "대장", "표")
TEMPLATE_TERMS = ("양식", "서식", "템플릿", "template", "작성양식")
DECISION_TERMS = ("회의록", "결정", "의사결정", "검토결과", "결재", "보고결과")
COLLAB_TERMS = ("협의", "협업", "회신", "의견", "인터뷰", "회의", "공유")
REFERENCE_TERMS = ("참고", "벤치마킹", "가이드", "매뉴얼", "자료", "사례")
WORK_PRODUCT_TERMS = ("계획", "보고", "추진", "결과", "검토", "초안", "개선", "전략")


class WorkAwareKnowledgeManager:
    def __init__(self, db: Database) -> None:
        self.db = db

    def get_profile(self) -> dict[str, Any]:
        row = self.db.fetch_one("SELECT * FROM knowledge_work_profile WHERE id = ?", (PROFILE_ID,))
        if row is None:
            return {
                "id": PROFILE_ID,
                "org_name": "",
                "department_name": "",
                "team_name": "",
                "position": "",
                "duty_keywords": [],
                "created_at": None,
                "updated_at": None,
            }
        return self._serialize_profile(row)

    def save_profile(
        self,
        *,
        org_name: str = "",
        department_name: str = "",
        team_name: str = "",
        position: str = "",
        duty_keywords: list[str] | None = None,
    ) -> dict[str, Any]:
        timestamp = now_iso()
        normalized_keywords = [
            keyword.strip()
            for keyword in (duty_keywords or [])
            if keyword and keyword.strip()
        ]
        existing = self.db.fetch_one("SELECT * FROM knowledge_work_profile WHERE id = ?", (PROFILE_ID,))
        payload = {
            "org_name": org_name.strip(),
            "department_name": department_name.strip(),
            "team_name": team_name.strip(),
            "position": position.strip(),
            "duty_keywords_json": json.dumps(normalized_keywords, ensure_ascii=False),
            "updated_at": timestamp,
        }
        if existing is None:
            self.db.insert(
                "knowledge_work_profile",
                {
                    "id": PROFILE_ID,
                    **payload,
                    "created_at": timestamp,
                },
            )
        else:
            self.db.execute(
                """
                UPDATE knowledge_work_profile
                SET org_name = ?,
                    department_name = ?,
                    team_name = ?,
                    position = ?,
                    duty_keywords_json = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    payload["org_name"],
                    payload["department_name"],
                    payload["team_name"],
                    payload["position"],
                    payload["duty_keywords_json"],
                    payload["updated_at"],
                    PROFILE_ID,
                ),
            )
        return self.get_profile()

    def analyze_source(self, source_id: str) -> dict[str, Any]:
        source = self.db.fetch_one("SELECT * FROM knowledge_sources WHERE id = ?", (source_id,))
        if source is None:
            raise KeyError(source_id)
        source_files = self.db.fetch_all(
            """
            SELECT *
            FROM knowledge_source_files
            WHERE source_id = ? AND status != ?
            ORDER BY relative_path ASC
            """,
            (source_id, "deleted"),
        )
        profile = self.get_profile()
        run_id = str(uuid4())
        timestamp = now_iso()
        family_keys = self._family_keys(source_files)
        classifications: list[dict[str, Any]] = []
        for file_record in source_files:
            classification = self._classify_file(
                source_id=source_id,
                run_id=run_id,
                file_record=file_record,
                family_key=family_keys.get(file_record["id"], ""),
                profile=profile,
                timestamp=timestamp,
            )
            classifications.append(classification)

        summary = self._summary(classifications, profile)
        questions = summary["questions_needed"]
        self.db.insert(
            "knowledge_discovery_runs",
            {
                "id": run_id,
                "source_id": source_id,
                "status": "completed",
                "summary_json": json.dumps(summary, ensure_ascii=False),
                "questions_json": json.dumps(questions, ensure_ascii=False),
                "confirmed": 0,
                "created_at": timestamp,
                "completed_at": timestamp,
                "confirmed_at": None,
            },
        )
        for classification in classifications:
            self.db.insert("knowledge_document_classifications", classification)
        return self.get_analysis(source_id, run_id=run_id)

    def get_analysis(self, source_id: str, *, run_id: str | None = None) -> dict[str, Any]:
        run = self._analysis_run(source_id, run_id=run_id)
        if run is None:
            return {
                "run_id": None,
                "source_id": source_id,
                "status": "not_analyzed",
                "confirmed": False,
                "summary": self._empty_summary(self.get_profile()),
                "questions_needed": [],
                "classifications": [],
            }
        return self._serialize_analysis_run(run)

    def confirm_analysis(self, source_id: str, run_id: str | None = None) -> dict[str, Any]:
        run = self._analysis_run(source_id, run_id=run_id)
        if run is None:
            raise KeyError(source_id)
        timestamp = now_iso()
        self.db.execute(
            "UPDATE knowledge_discovery_runs SET confirmed = 1, confirmed_at = ? WHERE id = ?",
            (timestamp, run["id"]),
        )
        self.db.execute(
            """
            UPDATE knowledge_document_classifications
            SET confirmed = 1, updated_at = ?
            WHERE run_id = ?
            """,
            (timestamp, run["id"]),
        )
        return self.get_analysis(source_id, run_id=run["id"]) | {"confirmed": True}

    def classification_for_source_file(self, source_file_id: str) -> dict[str, Any] | None:
        row = self.db.fetch_one(
            """
            SELECT *
            FROM knowledge_document_classifications
            WHERE source_file_id = ?
            ORDER BY confirmed DESC, updated_at DESC
            LIMIT 1
            """,
            (source_file_id,),
        )
        return self._serialize_classification(row) if row else None

    def attach_document_id(self, source_file_id: str, document_id: str) -> None:
        timestamp = now_iso()
        self.db.execute(
            """
            UPDATE knowledge_document_classifications
            SET document_id = ?, updated_at = ?
            WHERE source_file_id = ?
            """,
            (document_id, timestamp, source_file_id),
        )

    def infer_query_intent(self, query: str) -> dict[str, str]:
        normalized = query.lower()
        if any(term in normalized for term in ("절차", "규정", "전결", "지침", "근거", "기준")):
            return {"key": "work_procedure", "label": "업무절차 질의"}
        if any(term in normalized for term in ("보고서", "문서", "작성", "초안", "서식")):
            return {"key": "document_writing", "label": "문서작성 질의"}
        if any(term in normalized for term in ("실적", "통계", "데이터", "표", "수치", "현황")):
            return {"key": "data_question", "label": "데이터 질의"}
        return {"key": "research", "label": "리서치 질의"}

    def work_boost_for_document(
        self,
        *,
        document_metadata: dict[str, Any],
        query_intent: str,
    ) -> tuple[float, dict[str, float], str]:
        work_context = document_metadata.get("work_context")
        if not isinstance(work_context, dict):
            return 0.0, {}, "업무 분석 정보 없음"
        role = str(work_context.get("document_role") or "")
        confidence = float(work_context.get("confidence") or 0.0)
        multiplier = 1.0 if confidence >= 0.65 else 0.4
        breakdown: dict[str, float] = {}

        if query_intent == "work_procedure":
            if role == "policy_source":
                breakdown["policy_boost"] = 80.0 * multiplier
            elif role == "org_source":
                breakdown["org_boost"] = 50.0 * multiplier
            elif role == "reference_material":
                breakdown["reference_penalty"] = -25.0
        elif query_intent == "document_writing":
            if role == "work_product":
                breakdown["work_product_boost"] = 65.0 * multiplier
            elif role == "template_source":
                breakdown["template_boost"] = 55.0 * multiplier
            elif role == "policy_source":
                breakdown["policy_boost"] = 35.0 * multiplier
        elif query_intent == "data_question":
            if role == "data_source":
                breakdown["data_boost"] = 75.0 * multiplier
            elif role == "work_product":
                breakdown["work_product_boost"] = 25.0 * multiplier
        else:
            if role == "work_product":
                breakdown["work_product_boost"] = 35.0 * multiplier
            elif role == "collaboration_record":
                breakdown["collaboration_boost"] = 25.0 * multiplier
            elif role == "reference_material":
                breakdown["reference_penalty"] = -10.0

        department = str(work_context.get("department") or "")
        profile = self.get_profile()
        if department and department == profile.get("department_name"):
            breakdown["department_boost"] = 20.0 * multiplier

        boost = sum(breakdown.values())
        return boost, breakdown, self._ranking_explanation(role, query_intent, breakdown)

    def _classify_file(
        self,
        *,
        source_id: str,
        run_id: str,
        file_record: dict[str, Any],
        family_key: str,
        profile: dict[str, Any],
        timestamp: str,
    ) -> dict[str, Any]:
        text = self._analysis_text(file_record)
        role, confidence, reasons = self._document_role(text, file_record)
        family_relation = self._family_relation(text, file_record)
        if family_key and family_relation:
            confidence = min(1.0, confidence + 0.05)
            reasons.append(f"문서군 관계: {family_relation}")
        needs_review = confidence < 0.62
        metadata = {
            "title_candidate": file_record.get("title") or Path(file_record["file_path"]).stem,
            "relative_path": file_record.get("relative_path"),
            "department": profile.get("department_name") or "",
            "team": profile.get("team_name") or "",
            "role_label": ROLE_LABELS.get(role, role),
        }
        return {
            "id": str(uuid4()),
            "run_id": run_id,
            "source_id": source_id,
            "source_file_id": file_record["id"],
            "document_id": None,
            "document_role": role,
            "family_key": family_key,
            "family_relation": family_relation,
            "confidence": round(confidence, 2),
            "reasons_json": json.dumps(reasons, ensure_ascii=False),
            "ranking_hint": self._ranking_hint(role),
            "needs_review": 1 if needs_review else 0,
            "metadata_json": json.dumps(metadata, ensure_ascii=False),
            "confirmed": 0,
            "created_at": timestamp,
            "updated_at": timestamp,
        }

    def _document_role(self, text: str, file_record: dict[str, Any]) -> tuple[str, float, list[str]]:
        extension = Path(file_record["file_path"]).suffix.lower()
        if "업무분장" in text and "규정" not in Path(file_record["file_path"]).stem:
            return "org_source", 0.9, ["역할 단서: 업무분장표"]
        candidates: list[tuple[str, float, str]] = []
        for role, terms, score in (
            ("policy_source", POLICY_TERMS, 0.88),
            ("org_source", ORG_TERMS, 0.82),
            ("data_source", DATA_TERMS, 0.82),
            ("template_source", TEMPLATE_TERMS, 0.82),
            ("decision_record", DECISION_TERMS, 0.78),
            ("collaboration_record", COLLAB_TERMS, 0.72),
            ("reference_material", REFERENCE_TERMS, 0.66),
            ("work_product", WORK_PRODUCT_TERMS, 0.7),
        ):
            matched = [term for term in terms if term.lower() in text]
            if matched:
                candidates.append((role, min(0.96, score + len(matched) * 0.02), ", ".join(matched[:3])))
        if extension in {".csv", ".xlsx"}:
            candidates.append(("data_source", 0.86, f"{extension} 데이터 파일"))

        if not candidates:
            return "reference_material", 0.48, ["명확한 업무 역할 단서를 찾지 못함"]

        role, confidence, reason = max(candidates, key=lambda item: item[1])
        return role, confidence, [f"역할 단서: {reason}"]

    def _family_keys(self, source_files: list[dict[str, Any]]) -> dict[str, str]:
        normalized: dict[str, str] = {}
        groups: defaultdict[str, list[str]] = defaultdict(list)
        for file_record in source_files:
            key = self._family_key(file_record)
            normalized[file_record["id"]] = key
            groups[key].append(file_record["id"])
        return {
            file_id: key
            for file_id, key in normalized.items()
            if key and len(groups[key]) >= 2
        }

    def _family_key(self, file_record: dict[str, Any]) -> str:
        stem = Path(file_record["file_path"]).stem.lower()
        stem = re.sub(r"\([^)]*\)", " ", stem)
        stem = re.sub(r"[_\-\s]*(최종|제출본|제출|수정|보완|검토|초안|draft|v\d+|rev\d*)$", "", stem, flags=re.I)
        stem = re.sub(r"[_\-\s]+", " ", stem).strip()
        return stem

    def _family_relation(self, text: str, file_record: dict[str, Any]) -> str:
        suffix = Path(file_record["file_path"]).suffix.lower()
        for relation, markers in VERSION_MARKERS.items():
            if any(marker.lower() in text for marker in markers):
                return relation
        if suffix == ".pdf":
            return "converted"
        return "base"

    def _analysis_text(self, file_record: dict[str, Any]) -> str:
        parts = [
            str(file_record.get("title") or ""),
            str(file_record.get("relative_path") or ""),
            str(file_record.get("file_path") or ""),
            str(file_record.get("text_excerpt") or ""),
        ]
        return " ".join(parts).lower()

    def _summary(self, classifications: list[dict[str, Any]], profile: dict[str, Any]) -> dict[str, Any]:
        role_counts = Counter(item["document_role"] for item in classifications)
        family_keys = {
            item["family_key"]
            for item in classifications
            if item.get("family_key")
        }
        questions = []
        if not profile.get("org_name"):
            questions.append("기관명을 확인해 주세요.")
        if not profile.get("department_name"):
            questions.append("부서명을 확인해 주세요.")
        if not profile.get("duty_keywords"):
            questions.append("담당업무 키워드를 확인해 주세요.")
        return {
            "document_count": len(classifications),
            "discovered_regulation_count": role_counts.get("policy_source", 0),
            "produced_document_count": role_counts.get("work_product", 0),
            "data_source_count": role_counts.get("data_source", 0),
            "collaboration_document_count": role_counts.get("collaboration_record", 0),
            "duplicate_file_count": sum(1 for item in classifications if item.get("family_key")),
            "version_family_count": len(family_keys),
            "needs_review_count": sum(1 for item in classifications if item.get("needs_review")),
            "role_counts": dict(role_counts),
            "questions_needed": questions,
            "profile": {
                "org_name": profile.get("org_name") or "",
                "department_name": profile.get("department_name") or "",
                "team_name": profile.get("team_name") or "",
                "position": profile.get("position") or "",
                "duty_keywords": profile.get("duty_keywords") or [],
            },
        }

    def _empty_summary(self, profile: dict[str, Any]) -> dict[str, Any]:
        return self._summary([], profile)

    def _analysis_run(self, source_id: str, *, run_id: str | None = None) -> dict[str, Any] | None:
        if run_id:
            return self.db.fetch_one(
                "SELECT * FROM knowledge_discovery_runs WHERE source_id = ? AND id = ?",
                (source_id, run_id),
            )
        return self.db.fetch_one(
            """
            SELECT *
            FROM knowledge_discovery_runs
            WHERE source_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (source_id,),
        )

    def _serialize_analysis_run(self, run: dict[str, Any]) -> dict[str, Any]:
        classifications = self.db.fetch_all(
            """
            SELECT c.*, f.relative_path, f.file_path, f.title
            FROM knowledge_document_classifications c
            JOIN knowledge_source_files f ON f.id = c.source_file_id
            WHERE c.run_id = ?
            ORDER BY c.confidence DESC, f.relative_path ASC
            """,
            (run["id"],),
        )
        summary = json.loads(run["summary_json"])
        return {
            "run_id": run["id"],
            "source_id": run["source_id"],
            "status": run["status"],
            "confirmed": bool(run["confirmed"]),
            "summary": summary,
            "questions_needed": json.loads(run["questions_json"]),
            "classifications": [self._serialize_classification(row) for row in classifications],
            "created_at": run["created_at"],
            "completed_at": run.get("completed_at"),
            "confirmed_at": run.get("confirmed_at"),
        }

    def _serialize_classification(self, row: dict[str, Any]) -> dict[str, Any]:
        metadata = json.loads(row["metadata_json"])
        return {
            "id": row["id"],
            "run_id": row["run_id"],
            "source_id": row["source_id"],
            "source_file_id": row["source_file_id"],
            "document_id": row.get("document_id"),
            "document_role": row["document_role"],
            "document_role_label": ROLE_LABELS.get(row["document_role"], row["document_role"]),
            "family_key": row["family_key"],
            "family_relation": row["family_relation"],
            "confidence": row["confidence"],
            "reasons": json.loads(row["reasons_json"]),
            "ranking_hint": row["ranking_hint"],
            "needs_review": bool(row["needs_review"]),
            "confirmed": bool(row["confirmed"]),
            "metadata": metadata,
            "relative_path": row.get("relative_path") or metadata.get("relative_path"),
            "file_path": row.get("file_path"),
            "title": row.get("title") or metadata.get("title_candidate"),
        }

    def _serialize_profile(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "org_name": row["org_name"],
            "department_name": row["department_name"],
            "team_name": row["team_name"],
            "position": row["position"],
            "duty_keywords": json.loads(row["duty_keywords_json"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _ranking_hint(self, role: str) -> str:
        return {
            "policy_source": "업무절차 질의에서 규정 근거로 우선 활용",
            "org_source": "부서/업무 범위 판단에 활용",
            "work_product": "문서작성 질의에서 기존 생산문서로 우선 활용",
            "collaboration_record": "협업관계와 이해관계자 판단에 활용",
            "data_source": "수치/현황 질의에서 데이터 근거로 우선 활용",
            "template_source": "문서작성 시 서식 근거로 활용",
            "reference_material": "보조 참고자료로 활용",
            "decision_record": "최근 의사결정 근거로 활용",
        }.get(role, "업무 맥락 보조 근거로 활용")

    def _ranking_explanation(self, role: str, query_intent: str, breakdown: dict[str, float]) -> str:
        if breakdown.get("policy_boost", 0) > 0 and query_intent == "work_procedure":
            return "업무절차 질의라서 규정 문서를 우선 반영했습니다."
        if breakdown.get("work_product_boost", 0) > 0:
            return "문서작성/리서치 질의라서 기존 생산문서를 우선 반영했습니다."
        if breakdown.get("data_boost", 0) > 0:
            return "데이터 질의라서 실적표와 데이터시트를 우선 반영했습니다."
        if breakdown.get("department_boost", 0) > 0:
            return "사용자 부서와 연결된 문서라서 우선도를 높였습니다."
        if breakdown.get("reference_penalty", 0) < 0:
            return "참고자료는 보조 근거로 낮은 우선순위를 적용했습니다."
        return f"{ROLE_LABELS.get(role, role)} 역할로 분류된 문서입니다."
