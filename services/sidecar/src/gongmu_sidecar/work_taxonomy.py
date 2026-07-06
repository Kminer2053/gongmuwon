"""Work-Aware 지식 분류체계 엔진 (T-01).

프리셋(문서역할 8종+그림자 · 공무원 공통 업무 어휘 · 파일명 신호) ×
니즈 인터뷰 × 실폴더 패턴(Folder Recon + 문서 가족 감지)을 융합해
분류체계 초안(proposal)을 만들고, 사용자가 확정한 체계(SCHEMA.md)를
결정론적으로 적용(자동 태깅 + 저확신 큐 + Quality Report)한다.

설계: docs/superpowers/specs/2026-07-04-work-aware-knowledge-governance-design.md
"""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any
from uuid import uuid4

from .db import Database, now_iso

# patch_card_front_matter 재노출은 하위 호환용 — 신규 코드는 card_hash 추적을 위해
# KnowledgeWikiManager.patch_card를 쓴다 (§5.7).
from .knowledge_wiki import KnowledgeWikiManager, patch_card_front_matter  # noqa: F401

# P2a §5.1 순환 의존 해소: 파일명/폴더 규칙과 match_work_area 판정은
# taxonomy_rules 단일 구현을 쓴다(색인 내 증분 태깅과 apply 배치의 판정 일치 계약).
# 아래 재노출(import)은 기존 사용처(테스트 포함) 호환용이다.
from .taxonomy_rules import (  # noqa: F401 - 하위 호환 재노출
    DEFAULT_DOC_ROLE_KEYS,
    DOC_ROLE_BY_KEY,
    DOC_ROLES,
    FILENAME_SIGNALS,
    family_id_for,
    folder_importance,
    is_reference_shelf,
    is_reference_shelf_path,
    match_doc_role,
    match_doc_role_candidates,
    match_work_area,
    nfc,
    normalize_family_key,
    normalize_folder_name,
    version_signals,
    work_area_slug,
)
from .workspace import WorkspacePaths


# --------------------------------------------------------------------- 프리셋

# 공무원 공통 업무 어휘집 (v1: 기관유형 분화 전 단일본)
WORK_VOCAB: list[str] = [
    "사업계획", "예산", "성과평가", "성과관리", "정기회의", "회의운영", "감사",
    "보도", "홍보", "인사", "계약", "민원", "대외협력", "교육", "연구", "리서치",
    "기획", "평가", "조직", "법무", "규정관리", "자산", "시설", "보안", "정보화",
    "통계", "국제협력", "행사", "포상", "복무",
]

GOVERNANCE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("업무분장", re.compile(r"업무분장|분장표|사무분장")),
    ("직제", re.compile(r"직제")),
    ("조직도", re.compile(r"조직도")),
]

CONFIDENCE_LEVELS = ("high", "medium", "low")
CARD_TAG_KEYS = ("work_area", "doc_role", "tag_confidence", "family_id", "family_role")

# P3 §5.9 드리프트 판정 임계(결정적): 신규 1단계 폴더 파일 ≥5 /
# 최근 색인분 low 유입률 ≥30%(최소 표본 5건) / 확정 폴더 파일 0건화.
DRIFT_NEW_FOLDER_MIN_FILES = 5
DRIFT_LOW_INFLOW_RATIO = 0.30
DRIFT_LOW_INFLOW_MIN_DOCS = 5


class InvalidTagError(ValueError):
    """확정 분류체계에 없는 태그 값(유령 슬러그 등) — API에서 400으로 매핑된다 (§5.2)."""


# ------------------------------------------------------------------- 매니저

class WorkTaxonomyManager:
    def __init__(self, paths: WorkspacePaths, db: Database, wiki: KnowledgeWikiManager) -> None:
        self.paths = paths
        self.db = db
        self.wiki = wiki
        self.schema_path = wiki.wiki_root / "SCHEMA.md"

    # ------------------------------------------------------------ interview

    def save_interview(self, payload: dict[str, Any]) -> dict[str, Any]:
        timestamp = now_iso()
        fields = {
            "org_type": nfc(str(payload.get("org_type") or "")).strip(),
            "department": nfc(str(payload.get("department") or "")).strip(),
            "duty": nfc(str(payload.get("duty") or "")).strip(),
            "purpose": nfc(str(payload.get("purpose") or "")).strip(),
        }
        existing = self.db.fetch_one(
            "SELECT * FROM knowledge_taxonomy_interview WHERE id = ?", ("default",)
        )
        if existing is None:
            self.db.insert(
                "knowledge_taxonomy_interview",
                {"id": "default", **fields, "created_at": timestamp, "updated_at": timestamp},
            )
        else:
            self.db.execute(
                """
                UPDATE knowledge_taxonomy_interview
                SET org_type = ?, department = ?, duty = ?, purpose = ?, updated_at = ?
                WHERE id = ?
                """,
                (*fields.values(), timestamp, "default"),
            )
        self.db.log(
            feature="knowledge",
            action="knowledge.taxonomy.interview.saved",
            status="success",
            inputs=fields,
            outputs={},
        )
        return self.get_interview() or {}

    def get_interview(self) -> dict[str, Any] | None:
        row = self.db.fetch_one(
            "SELECT * FROM knowledge_taxonomy_interview WHERE id = ?", ("default",)
        )
        if row is None:
            return None
        return {
            "org_type": row.get("org_type") or "",
            "department": row.get("department") or "",
            "duty": row.get("duty") or "",
            "purpose": row.get("purpose") or "",
            "updated_at": row.get("updated_at") or "",
        }

    # ------------------------------------------------- Folder Recon / 초안

    def analyze_source(
        self,
        source_id: str,
        *,
        llm: Callable[[list[dict[str, Any]]], str | None] | None = None,
    ) -> dict[str, Any]:
        source = self.db.fetch_one("SELECT * FROM knowledge_sources WHERE id = ?", (source_id,))
        if source is None:
            raise KeyError(source_id)
        files = self.db.fetch_all(
            """
            SELECT * FROM knowledge_source_files
            WHERE source_id = ? AND status != ?
            ORDER BY relative_path ASC
            """,
            (source_id, "deleted"),
        )
        scanned_file_count = len(files)
        if scanned_file_count == 0:
            # 신설치/미스캔 소스: 분석을 건너뛰고 빈 초안 + needs_scan 신호(오류 아님)
            return {
                "source_id": source_id,
                "source_label": source.get("label"),
                "generated_at": now_iso(),
                "scanned_file_count": 0,
                "needs_scan": True,
                "work_areas": [],
                "reference_shelves": [],
                "doc_role_stats": {},
                "families": [],
                "governance_docs": [],
                "conventions": {"prefix_importance": False, "date_prefix": False},
                "interview": self.get_interview(),
                "hints": ["스캔된 파일이 없습니다. 지식폴더 스캔을 먼저 실행하세요."],
                "llm_suggestions": None,
            }
        slug_by_file_id = {
            row["source_file_id"]: row["slug"]
            for row in self.db.fetch_all(
                "SELECT source_file_id, slug FROM knowledge_wiki_docs WHERE source_id = ?",
                (source_id,),
            )
        }

        folder_files: dict[str, list[dict[str, Any]]] = {}
        root_files: list[dict[str, Any]] = []
        for file_record in files:
            rel = nfc(str(file_record.get("relative_path") or ""))
            parts = rel.split("/")
            if len(parts) > 1:
                folder_files.setdefault(parts[0], []).append(file_record)
            else:
                root_files.append(file_record)

        # 1단계 폴더 승격 + 참고자료 서고 분리
        work_areas: list[dict[str, Any]] = []
        reference_shelves: list[dict[str, Any]] = []
        area_by_slug: dict[str, dict[str, Any]] = {}
        for folder, members in sorted(folder_files.items()):
            if is_reference_shelf(folder):
                reference_shelves.append({"folder": folder, "doc_count": len(members)})
                continue
            name = normalize_folder_name(folder) or folder
            slug = work_area_slug(name)
            vocab_hit = any(term in name for term in WORK_VOCAB)
            confidence = "high" if (folder_importance(folder) == "major" or vocab_hit) else "medium"
            existing_area = area_by_slug.get(slug)
            if existing_area is not None:
                existing_area["folders"].append(folder)
                existing_area["doc_count"] += len(members)
                if confidence == "high":
                    existing_area["confidence"] = "high"
                continue
            area = {
                "name": name,
                "slug": slug,
                "folders": [folder],
                "doc_count": len(members),
                "source": "folder",
                "confidence": confidence,
            }
            area_by_slug[slug] = area
            work_areas.append(area)

        # WORK_VOCAB 매칭 보정: 폴더가 없는데 어휘가 파일명에 반복되면 후보 추가
        covered_names = {area["name"] for area in work_areas}
        for term in WORK_VOCAB:
            if any(term in name for name in covered_names):
                continue
            hit_count = sum(
                1 for file_record in root_files
                if term in nfc(str(file_record.get("relative_path") or ""))
            )
            if hit_count >= 2:
                slug = work_area_slug(term)
                if slug in area_by_slug:
                    continue
                area = {
                    "name": term,
                    "slug": slug,
                    "folders": [],
                    "doc_count": hit_count,
                    "source": "vocab",
                    "confidence": "low",
                }
                area_by_slug[slug] = area
                work_areas.append(area)

        # 문서역할 통계
        role_counter: Counter[str] = Counter()
        for file_record in files:
            stem = Path(str(file_record.get("relative_path") or "")).stem
            role = match_doc_role(stem)
            role_counter[role["key"] if role else "unknown"] += 1
        doc_role_stats = dict(role_counter)

        families = self._detect_file_families(files, slug_by_file_id)

        governance_docs: list[dict[str, Any]] = []
        for file_record in files:
            rel = nfc(str(file_record.get("relative_path") or ""))
            stem = Path(rel).stem
            for kind, pattern in GOVERNANCE_PATTERNS:
                if pattern.search(stem):
                    governance_docs.append(
                        {
                            "path": file_record.get("file_path"),
                            "relative_path": rel,
                            "kind": kind,
                        }
                    )
                    break

        date_prefixed = sum(
            1 for file_record in files
            if FILENAME_SIGNALS["date_prefix"].match(Path(str(file_record.get("relative_path") or "")).stem)
        )
        conventions = {
            "prefix_importance": bool(reference_shelves)
            or any(folder_importance(folder) for folder in folder_files),
            "date_prefix": len(files) > 0 and date_prefixed >= 2 and (date_prefixed / len(files)) >= 0.2,
        }

        interview = self.get_interview()
        hints: list[str] = []
        purpose = str((interview or {}).get("purpose") or "")
        if "인수인계" in purpose:
            hints.append("인수인계 목적: 문서 가족(버전 이력)과 최신본 판정을 우선 확인하세요.")
            families.sort(key=lambda family: len(family["members"]), reverse=True)
        if "보고" in purpose:
            hints.append("보고 생산성 목적: 계획·보고서 유형 문서를 업무 허브 핵심 문서로 우선 배치합니다.")
        if "기억" in purpose or "개인" in purpose:
            hints.append("개인 기억 목적: 업무 기록(work/) 백링크와 검색 필터 활용을 권장합니다.")

        proposal: dict[str, Any] = {
            "source_id": source_id,
            "source_label": source.get("label"),
            "generated_at": now_iso(),
            "scanned_file_count": scanned_file_count,
            "needs_scan": False,
            "work_areas": work_areas,
            "reference_shelves": reference_shelves,
            "doc_role_stats": doc_role_stats,
            "families": families,
            "governance_docs": governance_docs,
            "conventions": conventions,
            "interview": interview,
            "hints": hints,
            "llm_suggestions": None,
        }
        if llm is not None and work_areas:
            proposal["llm_suggestions"] = self._llm_refine(work_areas, llm)
        return proposal

    def _detect_file_families(
        self,
        files: list[dict[str, Any]],
        slug_by_file_id: dict[str, str],
    ) -> list[dict[str, Any]]:
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for file_record in files:
            rel = Path(nfc(str(file_record.get("relative_path") or "")))
            key = (normalize_family_key(rel.stem), rel.parent.as_posix())
            if not key[0]:
                continue
            groups.setdefault(key, []).append(file_record)

        families: list[dict[str, Any]] = []
        for (norm_key, folder), members in sorted(groups.items()):
            # 동일 해시 dedupe (기존 스캔 해시 활용)
            seen_hashes: set[str] = set()
            unique_members: list[dict[str, Any]] = []
            for member in members:
                file_hash = str(member.get("file_hash") or member.get("relative_path") or "")
                if file_hash in seen_hashes:
                    continue
                seen_hashes.add(file_hash)
                unique_members.append(member)
            if len(unique_members) < 2:
                continue
            family_id = family_id_for(norm_key, folder)
            scored = []
            for member in unique_members:
                stem = Path(str(member.get("relative_path") or "")).stem
                signals = version_signals(stem)
                sort_key = (
                    1 if signals["final"] else 0,
                    signals["version"] or 0,
                    str(member.get("modified_at") or ""),
                    signals["date_token"] or "",
                )
                scored.append((sort_key, member, signals))
            scored.sort(key=lambda item: item[0], reverse=True)
            latest = scored[0][1]
            official = next((member for _, member, signals in scored if signals["final"]), None)
            families.append(
                {
                    "family_id": family_id,
                    "title": nfc(Path(str(latest.get("relative_path") or "")).stem),
                    "folder": folder,
                    "members": [
                        {
                            "slug": slug_by_file_id.get(member["id"]),
                            "path": member.get("file_path"),
                            "relative_path": member.get("relative_path"),
                            "mtime": member.get("modified_at"),
                            "version_signals": signals,
                        }
                        for _, member, signals in scored
                    ],
                    "latest_slug": slug_by_file_id.get(latest["id"]),
                    "latest_path": latest.get("file_path"),
                    "official_slug": slug_by_file_id.get(official["id"]) if official else None,
                    "unclear_latest": len(scored) >= 2 and scored[0][0] == scored[1][0],
                }
            )
        return families

    def _llm_refine(
        self,
        work_areas: list[dict[str, Any]],
        llm: Callable[[list[dict[str, Any]]], str | None],
    ) -> dict[str, Any] | None:
        names = [area["name"] for area in work_areas]
        messages = [
            {
                "role": "system",
                "text": (
                    "당신은 공공기관 기록관리 전문가입니다. 아래 업무 후보 이름 목록을 다듬어 "
                    'JSON 하나만 출력하세요: {"work_areas": [{"name": "다듬은 업무명", '
                    '"merge_of": ["원래 이름"]}], "notes": "병합/개명 제안 요약"}'
                ),
            },
            {"role": "user", "text": json.dumps(names, ensure_ascii=False)},
        ]
        try:
            raw = llm(messages)
        except Exception:  # noqa: BLE001 - LLM 실패는 무시(결정론 초안 유지)
            return None
        if not raw:
            return None
        match = re.search(r"\{.*\}", str(raw), re.DOTALL)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
        if not isinstance(parsed, dict) or not isinstance(parsed.get("work_areas"), list):
            return None
        return parsed

    # -------------------------------------------------------- 확정 / SCHEMA

    def confirm_taxonomy(
        self,
        *,
        source_id: str,
        work_areas: list[dict[str, Any]],
        doc_roles_enabled: list[str] | None = None,
        family_policy: str = "latest_representative",
    ) -> dict[str, Any]:
        source = self.db.fetch_one("SELECT * FROM knowledge_sources WHERE id = ?", (source_id,))
        if source is None:
            raise KeyError(source_id)
        areas: list[dict[str, Any]] = []
        area_by_slug: dict[str, dict[str, Any]] = {}
        for raw_area in work_areas:
            name = nfc(str(raw_area.get("name") or "")).strip()
            if not name:
                continue
            slug = work_area_slug(name)
            folders = [nfc(str(folder)).strip() for folder in (raw_area.get("folders") or []) if str(folder).strip()]
            keywords = [nfc(str(keyword)).strip() for keyword in (raw_area.get("keywords") or []) if str(keyword).strip()]
            existing = area_by_slug.get(slug)
            if existing is not None:
                existing["folders"] = sorted({*existing["folders"], *folders})
                existing["keywords"] = sorted({*existing["keywords"], *keywords})
                continue
            area = {"name": name, "slug": slug, "folders": folders, "keywords": keywords}
            area_by_slug[slug] = area
            areas.append(area)
        if not areas:
            raise ValueError("work_areas is required to confirm a taxonomy")

        enabled = [key for key in (doc_roles_enabled or []) if key in DOC_ROLE_BY_KEY and not DOC_ROLE_BY_KEY[key]["shadow"]]
        if not enabled:
            enabled = list(DEFAULT_DOC_ROLE_KEYS)
        policy = str(family_policy or "latest_representative").strip() or "latest_representative"

        timestamp = now_iso()
        taxonomy = {
            "source_id": source_id,
            "work_areas": areas,
            "doc_roles_enabled": enabled,
            "family_policy": policy,
            "confirmed_at": timestamp,
        }
        schema_markdown = self._schema_markdown(source, taxonomy, self.get_interview())
        self.schema_path.write_text(schema_markdown, encoding="utf-8")

        existing_row = self.db.fetch_one(
            "SELECT * FROM knowledge_taxonomy WHERE source_id = ?", (source_id,)
        )
        if existing_row is None:
            self.db.insert(
                "knowledge_taxonomy",
                {
                    "id": str(uuid4()),
                    "source_id": source_id,
                    "taxonomy_json": json.dumps(taxonomy, ensure_ascii=False),
                    "quality_json": "{}",
                    "schema_path": str(self.schema_path),
                    "drift_json": "",
                    "confirmed_at": timestamp,
                    "created_at": timestamp,
                    "updated_at": timestamp,
                },
            )
        else:
            # §5.9: 재확정 = 드리프트 해소 — drift_json을 클리어한다(배지 제거).
            self.db.execute(
                """
                UPDATE knowledge_taxonomy
                SET taxonomy_json = ?, schema_path = ?, drift_json = '', confirmed_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    json.dumps(taxonomy, ensure_ascii=False),
                    str(self.schema_path),
                    timestamp,
                    timestamp,
                    existing_row["id"],
                ),
            )
        released_locked = self._revalidate_locked_docs(source_id, taxonomy)
        self.db.log(
            feature="knowledge",
            action="knowledge.taxonomy.confirmed",
            status="success",
            inputs={"source_id": source_id, "work_area_count": len(areas)},
            outputs={
                "schema_path": str(self.schema_path),
                "released_locked_count": released_locked,
            },
        )
        return {
            "configured": True,
            "source_id": source_id,
            "taxonomy": taxonomy,
            "schema_path": str(self.schema_path),
            "released_locked_count": released_locked,
        }

    def _revalidate_locked_docs(self, source_id: str, taxonomy: dict[str, Any]) -> int:
        """taxonomy 재확정 시 locked 문서의 slug 유효성 재검증 (§5.2).

        확정 체계에서 사라진 slug를 물고 있는 locked 문서는 lock을 해제하고
        분류 대기 큐에 다시 적재한다(유령 태그 잔존 방지).
        """
        valid_slugs = {str(area.get("slug") or "") for area in taxonomy.get("work_areas") or []}
        locked_docs = self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE source_id = ? AND tag_locked = 1 "
            "AND status != ?",
            (source_id, "missing"),
        )
        released = 0
        timestamp = now_iso()
        for doc in locked_docs:
            slug = str(doc.get("work_area_slug") or "")
            if not slug or slug in valid_slugs:
                continue
            self.db.execute(
                """
                UPDATE knowledge_wiki_docs
                SET tag_locked = 0, work_area_slug = '', tag_confidence = 'low', updated_at = ?
                WHERE id = ?
                """,
                (timestamp, doc["id"]),
            )
            self.wiki.patch_card(
                str(doc["id"]),
                Path(str(doc.get("card_path") or "")),
                {"work_area": "", "tag_confidence": "low"},
            )
            _area, _confidence, candidates, _reason = self._match_work_area(taxonomy, doc)
            stem = Path(str(doc.get("relative_path") or doc.get("source_path") or "")).stem
            self.wiki.upsert_tag_queue(
                source_id=source_id,
                wiki_doc_id=str(doc["id"]),
                doc_slug=str(doc.get("slug") or ""),
                title=str(doc.get("title") or ""),
                source_path=str(doc.get("source_path") or ""),
                candidates={
                    "work_areas": candidates,
                    "doc_roles": match_doc_role_candidates(stem),
                },
                reason="locked_slug_invalidated",
            )
            released += 1
        return released

    def _schema_markdown(
        self,
        source: dict[str, Any],
        taxonomy: dict[str, Any],
        interview: dict[str, Any] | None,
    ) -> str:
        lines: list[str] = [
            "# 지식 분류체계 (SCHEMA)",
            "",
            f"_갱신: {taxonomy['confirmed_at']}_",
            f"- 지식폴더: {source.get('label')} ({source.get('root_path')})",
            "",
            "## 니즈 요약 (인터뷰)",
        ]
        if interview:
            lines.append(f"- 기관 유형: {interview.get('org_type') or '미입력'}")
            lines.append(f"- 부서: {interview.get('department') or '미입력'}")
            lines.append(f"- 담당 업무: {interview.get('duty') or '미입력'}")
            lines.append(f"- 지식관리 목적: {interview.get('purpose') or '미입력'}")
        else:
            lines.append("- (인터뷰 미실시 — 기본 규칙으로 운영)")
        lines.append("")
        lines.append("## 업무 정의 (폴더 매핑)")
        for area in taxonomy["work_areas"]:
            lines.append(f"### {area['name']} (`{area['slug']}`)")
            folders = ", ".join(area["folders"]) if area["folders"] else "(폴더 매핑 없음)"
            keywords = ", ".join(area["keywords"]) if area["keywords"] else "(키워드 없음)"
            lines.append(f"- 폴더: {folders}")
            lines.append(f"- 키워드: {keywords}")
            lines.append("")
        lines.append("## 문서 유형 규칙")
        for key in taxonomy["doc_roles_enabled"]:
            role = DOC_ROLE_BY_KEY.get(key)
            if role is None:
                continue
            patterns = ", ".join(role["filename_patterns"])
            lines.append(f"- {role['label']} (`{key}`): 파일명 패턴 {patterns}")
        shadow = DOC_ROLE_BY_KEY["temp_backup"]
        lines.append(
            f"- {shadow['label']} (`temp_backup`, 그림자 유형): 백업/사본/임시 파일은 대표 문서에서 제외"
        )
        lines.append("")
        lines.append("## 문서 가족(버전) 정책")
        lines.append(f"- 정책: `{taxonomy['family_policy']}`")
        lines.append("- 가족당 대표 카드 1장(최신·공식본), 이전 버전은 '버전 이력'으로 접힘 표시")
        lines.append("- 최신본 판정: (최종) > 버전번호(vN) > 수정일")
        lines.append("")
        lines.append("## 태깅 확신도 규칙")
        lines.append("- high: 확정 폴더 직매핑")
        lines.append("- medium: 파일명 패턴/키워드 단독 매칭")
        lines.append("- low: 신호 충돌 또는 무신호 → 분류 대기 큐")
        return nfc("\n".join(lines).strip() + "\n")

    def current_taxonomy(self, *, source_id: str | None = None) -> dict[str, Any]:
        if source_id:
            rows = self.db.fetch_all(
                "SELECT * FROM knowledge_taxonomy WHERE source_id = ? ORDER BY updated_at DESC",
                (source_id,),
            )
        else:
            rows = self.db.fetch_all("SELECT * FROM knowledge_taxonomy ORDER BY updated_at DESC")
        items = []
        for row in rows:
            try:
                taxonomy = json.loads(row.get("taxonomy_json") or "{}")
            except json.JSONDecodeError:
                taxonomy = {}
            items.append(
                {
                    "source_id": row.get("source_id"),
                    "taxonomy": taxonomy,
                    "schema_path": row.get("schema_path"),
                    "confirmed_at": row.get("confirmed_at"),
                    # §5.9: 드리프트 감지 결과(없으면 None) — 프론트 "재정비 제안" 배지 근거.
                    "drift": self._parse_drift(row.get("drift_json")),
                }
            )
        return {
            "configured": bool(items),
            "items": items,
            "interview": self.get_interview(),
        }

    # ------------------------------------------------ P3 §5.9 드리프트 감지

    @staticmethod
    def _parse_drift(value: Any) -> dict[str, Any] | None:
        if not value or not str(value).strip():
            return None
        try:
            parsed = json.loads(str(value))
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    def detect_drift(self, source_id: str) -> dict[str, Any] | None:
        """확정 taxonomy.folders vs 현재 1단계 폴더 diff — 제안만, 자동 재구성 금지 (§5.9).

        트리거: 스캔 완료 시(knowledge.drift_detector 주입) + apply 완료 시.
        참고서고(□참고□류) 폴더는 판정에서 제외한다(영구 오탐 방지).
        판정(결정적): ①신규 1단계 폴더 파일 ≥5 ②최근 색인분(확정 이후 생성 문서)
        low 유입률 ≥30%(표본 ≥5) ③확정 폴더의 파일 0건화.
        감지 시 drift_json 저장 + 실행기록 1줄(동일 내용 재감지는 조용히 유지),
        해소 시(재확정 또는 원인 소멸) drift_json 클리어.
        """
        row = self.db.fetch_one(
            "SELECT * FROM knowledge_taxonomy WHERE source_id = ?", (source_id,)
        )
        if row is None:
            return None
        try:
            taxonomy = json.loads(row.get("taxonomy_json") or "{}")
        except json.JSONDecodeError:
            return None
        areas = taxonomy.get("work_areas") or []
        if not areas:
            return None
        confirmed_folders = {
            nfc(str(folder)).strip()
            for area in areas
            for folder in (area.get("folders") or [])
            if str(folder).strip()
        }

        files = self.db.fetch_all(
            "SELECT relative_path FROM knowledge_source_files "
            "WHERE source_id = ? AND status != ?",
            (source_id, "deleted"),
        )
        folder_counts: Counter[str] = Counter()
        for file_record in files:
            rel = nfc(str(file_record.get("relative_path") or ""))
            parts = rel.split("/")
            if len(parts) < 2:
                continue
            folder = parts[0]
            if is_reference_shelf(folder):
                # §5.9: 참고서고 폴더는 태깅 대상이 아니므로 드리프트 판정에서 제외.
                continue
            folder_counts[folder] += 1

        new_folders = [
            {"folder": folder, "file_count": count}
            for folder, count in sorted(folder_counts.items())
            if folder not in confirmed_folders and count >= DRIFT_NEW_FOLDER_MIN_FILES
        ]
        vanished_folders = sorted(
            folder for folder in confirmed_folders if folder_counts.get(folder, 0) == 0
        )

        confirmed_at = str(taxonomy.get("confirmed_at") or row.get("confirmed_at") or "")
        recent_docs = self.db.fetch_all(
            """
            SELECT tag_confidence, relative_path FROM knowledge_wiki_docs
            WHERE source_id = ? AND status != ? AND tag_confidence != ''
              AND created_at > ?
            """,
            (source_id, "missing", confirmed_at),
        )
        recent_docs = [
            doc
            for doc in recent_docs
            if not is_reference_shelf_path(str(doc.get("relative_path") or ""))
        ]
        low_count = sum(
            1 for doc in recent_docs if str(doc.get("tag_confidence") or "") == "low"
        )
        recent_total = len(recent_docs)
        low_ratio_value = (low_count / recent_total) if recent_total else 0.0
        low_triggered = (
            recent_total >= DRIFT_LOW_INFLOW_MIN_DOCS
            and low_ratio_value >= DRIFT_LOW_INFLOW_RATIO
        )

        detected = bool(new_folders or vanished_folders or low_triggered)
        previous = self._parse_drift(row.get("drift_json"))
        if not detected:
            if previous is not None:
                # 원인이 사라졌으면(폴더 정리·재색인 등) 배지도 스스로 내린다.
                self.db.execute(
                    "UPDATE knowledge_taxonomy SET drift_json = '', updated_at = ? WHERE id = ?",
                    (now_iso(), row["id"]),
                )
            return None

        drift = {
            "new_folders": new_folders,
            "vanished_folders": vanished_folders,
            "low_ratio": {
                "low": low_count,
                "total": recent_total,
                "ratio": round(low_ratio_value, 3),
                "triggered": low_triggered,
            },
            "detected_at": now_iso(),
        }
        same_as_previous = previous is not None and (
            previous.get("new_folders") == drift["new_folders"]
            and previous.get("vanished_folders") == drift["vanished_folders"]
            and bool((previous.get("low_ratio") or {}).get("triggered"))
            == low_triggered
        )
        if same_as_previous:
            return previous  # 동일 드리프트 재감지 — 기록·갱신 없이 유지(스팸 방지)
        self.db.execute(
            "UPDATE knowledge_taxonomy SET drift_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(drift, ensure_ascii=False), now_iso(), row["id"]),
        )
        reasons: list[str] = []
        if new_folders:
            reasons.append(f"신규 폴더 {len(new_folders)}건(파일 ≥{DRIFT_NEW_FOLDER_MIN_FILES})")
        if vanished_folders:
            reasons.append(f"확정 폴더 0건화 {len(vanished_folders)}건")
        if low_triggered:
            reasons.append(f"최근 색인분 low 유입률 {round(low_ratio_value * 100)}%")
        self.db.log(
            feature="knowledge",
            action="knowledge.taxonomy.drift_detected",
            status="success",
            inputs={"source_id": source_id},
            outputs={
                "message": (
                    "분류체계 재정비 제안: " + " · ".join(reasons) + " — 마법사에서 재확정하세요"
                ),
                **drift,
            },
        )
        return drift

    # --------------------------------------------------- 적용(태깅+큐+허브)

    def apply_taxonomy(
        self,
        source_id: str,
        *,
        progress_cb: Callable[[int, int], None] | None = None,
        should_cancel: Callable[[], bool] | None = None,
        indexed_before_apply: bool = False,
        indexed_count: int = 0,
    ) -> dict[str, Any]:
        row = self.db.fetch_one(
            "SELECT * FROM knowledge_taxonomy WHERE source_id = ?", (source_id,)
        )
        if row is None:
            raise ValueError("taxonomy is not confirmed for this source")
        taxonomy = json.loads(row.get("taxonomy_json") or "{}")
        # §5.5: missing 문서는 재태깅·큐 적재·family 배치에서 제외한다.
        docs = self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE source_id = ? AND status != ? "
            "ORDER BY relative_path ASC",
            (source_id, "missing"),
        )
        files_by_id = {
            file_record["id"]: file_record
            for file_record in self.db.fetch_all(
                "SELECT * FROM knowledge_source_files WHERE source_id = ?", (source_id,)
            )
        }
        # §5.2: pending 큐 시작 시 전삭제 대신 run_id 기반 — 신규 적재 후 정상 완료
        # 시에만 이전 run pending을 삭제한다(취소 시 "미태깅인데 큐에도 없음" 방지).
        run_id = str(uuid4())
        canceled = False

        family_map, family_meta = self._detect_doc_families(docs, files_by_id)
        counts = {"high": 0, "medium": 0, "low": 0}
        conflicts = 0
        locked_count = 0
        timestamp = now_iso()
        enabled_keys = list(taxonomy.get("doc_roles_enabled") or DEFAULT_DOC_ROLE_KEYS)

        for index, doc in enumerate(docs):
            if should_cancel is not None and should_cancel():
                canceled = True
                break
            family = family_map.get(doc["id"], {})
            if int(doc.get("tag_locked") or 0):
                # §5.2/§8: locked 문서는 work_area/doc_role 재판정·큐 재적재에서
                # 제외하되 family 재평가에는 항상 참여한다(버전 체인 붕괴 방지).
                locked_count += 1
                self.db.execute(
                    """
                    UPDATE knowledge_wiki_docs
                    SET family_id = ?, family_role = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        family.get("family_id") or "",
                        family.get("family_role") or "",
                        timestamp,
                        doc["id"],
                    ),
                )
                self.wiki.patch_card(
                    str(doc["id"]),
                    Path(str(doc["card_path"])),
                    {
                        "family_id": family.get("family_id") or "",
                        "family_role": family.get("family_role") or "",
                    },
                )
                if progress_cb is not None:
                    progress_cb(index + 1, len(docs))
                continue
            relative = str(doc.get("relative_path") or "")
            if is_reference_shelf_path(relative):
                # 증분 색인 경로(§5.1)와 정책 통일: 참고서고 문서는 업무 태깅·큐 적재
                # 대상이 아니다 — 경로별 태그 불일치와 큐 스팸을 막는다. family 배정은
                # 위에서 이미 반영됨.
                self.db.execute(
                    """
                    UPDATE knowledge_wiki_docs
                    SET work_area_slug = '', doc_role = '', tag_confidence = '',
                        family_id = ?, family_role = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        family.get("family_id") or "",
                        family.get("family_role") or "",
                        timestamp,
                        doc["id"],
                    ),
                )
                if progress_cb is not None:
                    progress_cb(index + 1, len(docs))
                continue
            area_slug, confidence, candidates, reason = self._match_work_area(taxonomy, doc)
            stem = Path(str(doc.get("relative_path") or doc.get("source_path") or "")).stem
            role = match_doc_role(stem, enabled_keys=enabled_keys)
            role_key = role["key"] if role else ""
            counts[confidence] += 1
            if reason == "conflict":
                conflicts += 1
            self.db.execute(
                """
                UPDATE knowledge_wiki_docs
                SET work_area_slug = ?, doc_role = ?, tag_confidence = ?,
                    family_id = ?, family_role = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    area_slug or "",
                    role_key,
                    confidence,
                    family.get("family_id") or "",
                    family.get("family_role") or "",
                    timestamp,
                    doc["id"],
                ),
            )
            self.wiki.patch_card(
                str(doc["id"]),
                Path(str(doc["card_path"])),
                {
                    "work_area": area_slug or "",
                    "doc_role": role_key,
                    "tag_confidence": confidence,
                    "family_id": family.get("family_id") or "",
                    "family_role": family.get("family_role") or "",
                },
            )
            if confidence == "low":
                role_candidates = match_doc_role_candidates(stem)
                self.db.insert(
                    "knowledge_tag_queue",
                    {
                        "id": str(uuid4()),
                        "source_id": source_id,
                        "wiki_doc_id": doc["id"],
                        "doc_slug": doc.get("slug") or "",
                        "title": doc.get("title") or "",
                        "source_path": doc.get("source_path") or "",
                        "candidates_json": json.dumps(
                            {"work_areas": candidates, "doc_roles": role_candidates},
                            ensure_ascii=False,
                        ),
                        "reason": reason,
                        "status": "pending",
                        "run_id": run_id,
                        "resolved_work_area_slug": None,
                        "resolved_doc_role": None,
                        "created_at": timestamp,
                        "resolved_at": None,
                    },
                )
            if progress_cb is not None:
                progress_cb(index + 1, len(docs))

        if not canceled:
            # §5.2: 정상 완료 시에만 이전 run(색인 증분 적재분 포함)의 pending을 삭제한다.
            self.db.execute(
                "DELETE FROM knowledge_tag_queue WHERE source_id = ? AND status = ? AND run_id != ?",
                (source_id, "pending", run_id),
            )

        hub_paths = self._write_hubs(source_id, taxonomy)
        try:
            self.wiki.rebuild_index()
        except OSError:
            pass

        queue_count = self._pending_queue_count(source_id)
        duplicates = sum(1 for family in family_meta if family["duplicate"])
        unclear_latest = sum(1 for family in family_meta if family["unclear_latest"])
        quality = {
            "conflicts": conflicts,
            "duplicates": duplicates,
            "unclear_latest": unclear_latest,
            "queue_count": queue_count,
            "generated_at": timestamp,
        }
        self.db.execute(
            "UPDATE knowledge_taxonomy SET quality_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(quality, ensure_ascii=False), now_iso(), row["id"]),
        )
        report = {
            "source_id": source_id,
            "applied_at": timestamp,
            "tagged_count": len(docs),
            "locked_count": locked_count,
            "counts": counts,
            "work_area_count": len(taxonomy.get("work_areas") or []),
            "family_count": len(family_meta),
            "hub_paths": hub_paths,
            "quality": quality,
            "indexed_before_apply": bool(indexed_before_apply),
            "indexed_count": int(indexed_count),
        }
        log_outputs: dict[str, Any] = {
            "tagged_count": len(docs),
            "queue_count": queue_count,
            "indexed_before_apply": bool(indexed_before_apply),
            "indexed_count": int(indexed_count),
        }
        if indexed_before_apply:
            log_outputs["summary"] = f"색인 {int(indexed_count)}건 선행 후 분류 적용"
        self.db.log(
            feature="knowledge",
            action="knowledge.taxonomy.applied",
            status="success",
            inputs={"source_id": source_id},
            outputs=log_outputs,
        )
        # §5.9: apply 완료 시 드리프트 감지에 편승한다(실패해도 apply는 성공).
        try:
            report["drift"] = self.detect_drift(source_id)
        except Exception:  # noqa: BLE001 - 드리프트 감지 실패가 apply를 막으면 안 된다
            report["drift"] = None
        return report

    def _match_work_area(
        self, taxonomy: dict[str, Any], doc: dict[str, Any]
    ) -> tuple[str | None, str, list[dict[str, Any]], str]:
        """returns (work_area_slug, confidence, candidates, reason).

        P2a: 판정 본체는 taxonomy_rules.match_work_area 단일 구현으로 이동했다.
        색인 내 증분 태깅(knowledge_wiki)과 반드시 같은 함수를 써야 한다(§5.1 계약).
        """
        return match_work_area(
            taxonomy,
            relative_path=str(doc.get("relative_path") or ""),
            source_path=str(doc.get("source_path") or ""),
            title=str(doc.get("title") or ""),
        )

    def _detect_doc_families(
        self,
        docs: list[dict[str, Any]],
        files_by_id: dict[str, dict[str, Any]],
    ) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for doc in docs:
            rel = Path(nfc(str(doc.get("relative_path") or "")))
            key = (normalize_family_key(rel.stem), rel.parent.as_posix())
            if not key[0]:
                continue
            groups.setdefault(key, []).append(doc)

        assignment: dict[str, dict[str, Any]] = {}
        family_meta: list[dict[str, Any]] = []
        for (norm_key, folder), members in sorted(groups.items()):
            if len(members) < 2:
                continue
            family_id = family_id_for(norm_key, folder)
            scored = []
            hash_counter: Counter[str] = Counter()
            date_counter: Counter[str] = Counter()
            for member in members:
                stem = Path(str(member.get("relative_path") or "")).stem
                signals = version_signals(stem)
                source_file = files_by_id.get(str(member.get("source_file_id"))) or {}
                mtime = str(source_file.get("modified_at") or "")
                hash_counter[str(member.get("file_hash") or member["id"])] += 1
                date_counter[mtime[:10]] += 1
                sort_key = (
                    1 if signals["final"] else 0,
                    signals["version"] or 0,
                    mtime,
                    signals["date_token"] or "",
                )
                scored.append((sort_key, member, signals))
            scored.sort(key=lambda item: item[0], reverse=True)
            unclear = len(scored) >= 2 and scored[0][0] == scored[1][0]
            duplicate = any(count >= 2 for count in hash_counter.values()) or any(
                count >= 2 for date, count in date_counter.items() if date
            )
            for index, (_, member, signals) in enumerate(scored):
                if index == 0:
                    role = "official" if signals["final"] else "latest"
                else:
                    role = "previous"
                assignment[member["id"]] = {"family_id": family_id, "family_role": role}
            family_meta.append(
                {
                    "family_id": family_id,
                    "member_count": len(scored),
                    "latest_slug": scored[0][1].get("slug"),
                    "unclear_latest": unclear,
                    "duplicate": duplicate,
                }
            )
        return assignment, family_meta

    # ------------------------------------------------------------- 허브 생성

    def refresh_hubs(self, source_id: str, slugs: list[str]) -> list[str]:
        """P2a §5.3: dirty 업무 허브만 축소 재작성한다 — 확정 taxonomy 있을 때만.

        색인(증분 태깅·패밀리 국소 재평가)과 rebind가 knowledge_wiki 쪽 훅
        (hub_refresher)으로 호출한다. 전량 재작성은 apply(_write_hubs) 몫.
        """
        row = self.db.fetch_one(
            "SELECT taxonomy_json FROM knowledge_taxonomy WHERE source_id = ?", (source_id,)
        )
        if row is None:
            return []
        try:
            taxonomy = json.loads(row.get("taxonomy_json") or "{}")
        except json.JSONDecodeError:
            return []
        wanted = {str(slug) for slug in slugs if str(slug)}
        areas = [
            area
            for area in (taxonomy.get("work_areas") or [])
            if str(area.get("slug") or "") in wanted
        ]
        if not areas:
            return []
        docs = self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE source_id = ? AND status != ? "
            "ORDER BY title ASC",
            (source_id, "missing"),
        )
        work_pages = self.wiki.list_work_pages()
        written: list[str] = []
        for area in areas:
            area_docs = [
                doc for doc in docs if str(doc.get("work_area_slug") or "") == area["slug"]
            ]
            written.append(self._write_hub(area, area_docs, work_pages))
        return written

    def _write_hubs(self, source_id: str, taxonomy: dict[str, Any]) -> list[str]:
        # §5.5: missing 문서는 업무 허브에서 제외한다.
        docs = self.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE source_id = ? AND status != ? "
            "ORDER BY title ASC",
            (source_id, "missing"),
        )
        work_pages = self.wiki.list_work_pages()
        slugs = {area["slug"] for area in taxonomy.get("work_areas") or []}
        # 재확정 시 사라진 업무 허브 정리
        for stale in self.wiki.work_areas_dir.glob("*.md"):
            if stale.stem not in slugs:
                stale.unlink(missing_ok=True)
        hub_paths: list[str] = []
        for area in taxonomy.get("work_areas") or []:
            area_docs = [doc for doc in docs if str(doc.get("work_area_slug") or "") == area["slug"]]
            hub_paths.append(self._write_hub(area, area_docs, work_pages))
        return hub_paths

    def _write_hub(
        self,
        area: dict[str, Any],
        area_docs: list[dict[str, Any]],
        work_pages: list[dict[str, Any]],
    ) -> str:
        slug = area["slug"]
        title = area["name"]
        visible = [doc for doc in area_docs if str(doc.get("family_role") or "") != "previous"]
        previous_count = len(area_docs) - len(visible)
        role_counter: Counter[str] = Counter()
        for doc in visible:
            role = DOC_ROLE_BY_KEY.get(str(doc.get("doc_role") or ""))
            role_counter[role["label"] if role else "미지정"] += 1
        previous_by_family: Counter[str] = Counter()
        for doc in area_docs:
            if str(doc.get("family_role") or "") == "previous" and doc.get("family_id"):
                previous_by_family[str(doc["family_id"])] += 1

        front = self.wiki._front_matter(
            {
                "work_area": title,
                "slug": slug,
                "doc_count": len(area_docs),
                "updated_at": now_iso(),
            }
        )
        lines: list[str] = [front, f"# {title}", ""]
        lines.append("## 개요")
        lines.append(f"- 문서 {len(area_docs)}건 (대표 {len(visible)}건 · 이전 버전 {previous_count}건)")
        if role_counter:
            distribution = " · ".join(f"{label} {count}건" for label, count in role_counter.most_common())
            lines.append(f"- 유형 분포: {distribution}")
        lines.append("")

        lines.append("## 핵심 문서")
        core = sorted(
            visible,
            key=lambda doc: (
                str(doc.get("family_role") or "") == "official",
                str(doc.get("doc_role") or "") == "plan",
                str(doc.get("doc_role") or "") == "report",
                str(doc.get("updated_at") or ""),
            ),
            reverse=True,
        )
        core = [
            doc for doc in core
            if str(doc.get("doc_role") or "") in {"plan", "report"}
            or str(doc.get("family_role") or "") == "official"
        ][:8]
        if core:
            for doc in core:
                badge = " [공식본]" if str(doc.get("family_role") or "") == "official" else ""
                lines.append(f"- [{doc['title']}](../docs/{doc['slug']}.md){badge} · 원본: {doc['source_path']}")
        else:
            lines.append("- (핵심 문서 후보가 아직 없습니다.)")
        lines.append("")

        lines.append("## 유형별 문서")
        role_order = [role["label"] for role in DOC_ROLES if not role["shadow"]] + ["임시/백업", "미지정"]
        grouped: dict[str, list[dict[str, Any]]] = {}
        for doc in visible:
            role = DOC_ROLE_BY_KEY.get(str(doc.get("doc_role") or ""))
            grouped.setdefault(role["label"] if role else "미지정", []).append(doc)
        emitted = False
        for label in role_order:
            docs_in_role = grouped.get(label)
            if not docs_in_role:
                continue
            emitted = True
            lines.append(f"### {label}")
            for doc in docs_in_role:
                history = ""
                family_id = str(doc.get("family_id") or "")
                if family_id and previous_by_family.get(family_id):
                    history = f" (버전 이력 {previous_by_family[family_id]}건 접힘)"
                lines.append(f"- [{doc['title']}](../docs/{doc['slug']}.md){history}")
            lines.append("")
        if not emitted:
            lines.append("- (분류된 문서가 없습니다.)")
            lines.append("")

        doc_slugs = {str(doc.get("slug") or "") for doc in area_docs}
        backlinks = [
            page for page in work_pages if doc_slugs & set(page.get("cited_docs") or [])
        ]
        lines.append("## 관련 업무 기록")
        if backlinks:
            for page in backlinks:
                stamp = str(page.get("updated_at") or "")[:10]
                lines.append(f"- [{page['title']}](../{page['path']}) — 갱신 {stamp or '미상'}")
        else:
            lines.append("- (연결된 업무 기록이 없습니다.)")

        hub_path = self.wiki.work_areas_dir / f"{slug}.md"
        hub_path.write_text(nfc("\n".join(lines).strip() + "\n"), encoding="utf-8")
        return f"work-areas/{slug}.md"

    # ------------------------------------------------------ 큐 / 품질 리포트

    def _pending_queue_count(self, source_id: str) -> int:
        row = self.db.fetch_one(
            "SELECT COUNT(*) AS count FROM knowledge_tag_queue WHERE source_id = ? AND status = ?",
            (source_id, "pending"),
        )
        return int(row["count"]) if row else 0

    def list_queue(
        self, *, source_id: str | None = None, status: str = "pending"
    ) -> list[dict[str, Any]]:
        clauses = []
        params: list[Any] = []
        if source_id:
            clauses.append("source_id = ?")
            params.append(source_id)
        if status and status != "all":
            clauses.append("status = ?")
            params.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self.db.fetch_all(
            f"SELECT * FROM knowledge_tag_queue {where} ORDER BY created_at ASC",
            tuple(params),
        )
        items = []
        for row in rows:
            try:
                candidates = json.loads(row.get("candidates_json") or "{}")
            except json.JSONDecodeError:
                candidates = {}
            items.append({**row, "candidates": candidates})
        return items

    def resolve_queue_item(
        self, item_id: str, *, work_area_slug: str = "", doc_role: str = ""
    ) -> dict[str, Any]:
        row = self.db.fetch_one("SELECT * FROM knowledge_tag_queue WHERE id = ?", (item_id,))
        if row is None:
            raise KeyError(item_id)
        if row.get("status") != "pending":
            raise ValueError("queue item is already resolved")
        if doc_role and doc_role not in DOC_ROLE_BY_KEY:
            raise InvalidTagError(f"unknown doc_role: {doc_role}")
        if work_area_slug:
            # §5.2: 확정 taxonomy slug 집합과 검증 — 유령 태그 차단 (무효 400).
            tax_row = self.db.fetch_one(
                "SELECT taxonomy_json FROM knowledge_taxonomy WHERE source_id = ?",
                (str(row.get("source_id") or ""),),
            )
            try:
                confirmed = json.loads((tax_row or {}).get("taxonomy_json") or "{}")
            except json.JSONDecodeError:
                confirmed = {}
            valid_slugs = {
                str(area.get("slug") or "") for area in (confirmed.get("work_areas") or [])
            }
            if work_area_slug not in valid_slugs:
                raise InvalidTagError(f"unknown work_area_slug: {work_area_slug}")
        doc = self.db.fetch_one(
            "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (row["wiki_doc_id"],)
        )
        timestamp = now_iso()
        if doc is not None:
            # §5.2: 사용자 확정 결과는 tag_locked=1로 보존 — 이후 apply·재색인·rebind의
            # 자동 재판정에서 제외된다(family 재평가에는 계속 참여).
            self.db.execute(
                """
                UPDATE knowledge_wiki_docs
                SET work_area_slug = ?, doc_role = ?, tag_confidence = ?, tag_locked = 1,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    work_area_slug or str(doc.get("work_area_slug") or ""),
                    doc_role or str(doc.get("doc_role") or ""),
                    "high",
                    timestamp,
                    doc["id"],
                ),
            )
            self.wiki.patch_card(
                str(doc["id"]),
                Path(str(doc["card_path"])),
                {
                    "work_area": work_area_slug or str(doc.get("work_area_slug") or ""),
                    "doc_role": doc_role or str(doc.get("doc_role") or ""),
                    "tag_confidence": "high",
                },
            )
        self.db.execute(
            """
            UPDATE knowledge_tag_queue
            SET status = ?, resolved_work_area_slug = ?, resolved_doc_role = ?, resolved_at = ?
            WHERE id = ?
            """,
            ("resolved", work_area_slug or None, doc_role or None, timestamp, item_id),
        )
        # 허브/인덱스 최신화 (확정 체계가 있는 소스만)
        source_id = str(row.get("source_id") or "")
        tax_row = self.db.fetch_one(
            "SELECT * FROM knowledge_taxonomy WHERE source_id = ?", (source_id,)
        )
        if tax_row is not None:
            try:
                taxonomy = json.loads(tax_row.get("taxonomy_json") or "{}")
                self._write_hubs(source_id, taxonomy)
                self.wiki.rebuild_index()
            except (OSError, json.JSONDecodeError):
                pass
        resolved = self.db.fetch_one("SELECT * FROM knowledge_tag_queue WHERE id = ?", (item_id,))
        self.db.log(
            feature="knowledge",
            action="knowledge.taxonomy.queue.resolved",
            status="success",
            inputs={"queue_id": item_id, "work_area_slug": work_area_slug, "doc_role": doc_role},
            outputs={},
        )
        return resolved or row

    def quality(self, *, source_id: str | None = None) -> dict[str, Any]:
        if source_id:
            rows = self.db.fetch_all(
                "SELECT * FROM knowledge_taxonomy WHERE source_id = ?", (source_id,)
            )
        else:
            rows = self.db.fetch_all("SELECT * FROM knowledge_taxonomy ORDER BY updated_at DESC")
        items = []
        for row in rows:
            try:
                quality = json.loads(row.get("quality_json") or "{}")
            except json.JSONDecodeError:
                quality = {}
            sid = str(row.get("source_id") or "")
            items.append(
                {
                    "source_id": sid,
                    "conflicts": int(quality.get("conflicts") or 0),
                    "duplicates": int(quality.get("duplicates") or 0),
                    "unclear_latest": int(quality.get("unclear_latest") or 0),
                    "queue_count": self._pending_queue_count(sid),
                    "generated_at": quality.get("generated_at"),
                }
            )
        return {"configured": bool(rows), "items": items}
