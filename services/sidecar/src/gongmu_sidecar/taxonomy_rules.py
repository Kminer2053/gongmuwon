"""Work-Aware 분류 규칙 — 순수 함수 단일 구현 (P2a §5.1 순환 의존 해소).

work_taxonomy(적용 배치)와 knowledge_wiki(색인 내 증분 태깅)가 같은 판정을
공유해야 하는데, work_taxonomy → knowledge_wiki 단방향 의존이라 knowledge_wiki가
work_taxonomy를 임포트하면 순환이 생긴다. 그래서 파일명/폴더 규칙과
`match_work_area` 판정을 이 모듈로 이동해 **단일 구현**을 유지한다
(설계서 2026-07-05 §5.1 구현 주의 — 경로별 태그 불일치 회귀 방지, 코드 리뷰 게이트).

이 모듈은 표준 라이브러리만 사용한다(사이드카 내부 모듈 임포트 금지 — 순환 차단).
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path
from typing import Any
from uuid import uuid4


def nfc(value: str) -> str:
    return unicodedata.normalize("NFC", value or "")


# --------------------------------------------------------------------- 프리셋

# 공공 문서역할 8종 + 그림자(임시/백업). 순서 = 파일명 매칭 우선순위.
DOC_ROLES: list[dict[str, Any]] = [
    {
        "key": "temp_backup",
        "label": "임시/백업",
        "shadow": True,
        "filename_patterns": [r"(?i:backup)", r"백업", r"\(구\)", r"(?i:\bold\b)", r"(?i:copy)", r"사본", r"복사본", r"임시"],
    },
    {
        "key": "form",
        "label": "양식/서식",
        "shadow": False,
        "filename_patterns": [r"양식", r"서식", r"(?i:template)", r"템플릿"],
    },
    {
        "key": "official",
        "label": "공문/시행문",
        "shadow": False,
        "filename_patterns": [r"시행문", r"공문", r"발송"],
    },
    {
        "key": "regulation",
        "label": "규정/지침",
        "shadow": False,
        "filename_patterns": [r"규정", r"지침", r"조례", r"훈령", r"예규"],
    },
    {
        "key": "manual",
        "label": "업무매뉴얼",
        "shadow": False,
        "filename_patterns": [r"매뉴얼", r"가이드", r"안내서"],
    },
    {
        "key": "meeting",
        "label": "회의자료",
        "shadow": False,
        "filename_patterns": [r"회의", r"\(\d+차\)"],
    },
    {
        "key": "report",
        "label": "보고서",
        "shadow": False,
        "filename_patterns": [r"결과보고", r"현황보고", r"검토보고", r"보고서", r"보고"],
    },
    {
        "key": "plan",
        "label": "계획(안)",
        "shadow": False,
        "filename_patterns": [r"계획", r"\(안\)", r"기획안"],
    },
    {
        "key": "reference",
        "label": "참고자료",
        "shadow": False,
        "filename_patterns": [r"\(붙임\)", r"붙임", r"증빙", r"참고"],
    },
]

DOC_ROLE_BY_KEY = {role["key"]: role for role in DOC_ROLES}
DEFAULT_DOC_ROLE_KEYS = [role["key"] for role in DOC_ROLES if not role["shadow"]]

# 파일명 규칙 라이브러리
FILENAME_SIGNALS: dict[str, re.Pattern[str]] = {
    # 날짜 프리픽스: 6자리(YYMMDD)/8자리(YYYYMMDD)
    "date_prefix": re.compile(r"^(\d{6}|\d{8})[\s_\-\.]?"),
    # 괄호 날짜 변형: (1017) (251017) (20251017)
    "date_paren": re.compile(r"\((\d{4}|\d{6}|\d{8})\)"),
    # 버전: v2 / V3 / v1.2
    "version": re.compile(r"[vV]\.?(\d+)"),
    # 최종 신호: (최종) 최최종 최종본 final
    "final": re.compile(r"\(최종\)|최최종|최종본|최종|(?i:final)"),
    "revised": re.compile(r"\(수정\)"),
    # 회차: (2차)
    "round": re.compile(r"\((\d+)차\)"),
    # 중요도 접두사: □주요□ / ■참고■ / □기타□
    "importance_prefix": re.compile(r"^[□■◆◇▶]\s*(주요|중요|참고|기타)\s*[□■◆◇▶]?"),
    "attachment": re.compile(r"\(붙임\)|붙임"),
    "backup": re.compile(r"(?i:backup|copy)|백업|\(구\)|사본|복사본"),
}


# ---------------------------------------------------------------- 정규화 유틸

def work_area_slug(name: str) -> str:
    base = nfc(str(name or "")).strip().lower()
    base = re.sub(r"[^\w가-힣]+", "-", base, flags=re.UNICODE).strip("-")
    return base[:40] or f"work-{uuid4().hex[:6]}"


def folder_importance(name: str) -> str | None:
    """폴더 접두사 관행 판정: 주요/중요=major, 참고=reference, 기타=etc."""
    match = FILENAME_SIGNALS["importance_prefix"].match(nfc(str(name or "")).strip())
    if not match:
        return None
    marker = match.group(1)
    if marker in {"주요", "중요"}:
        return "major"
    if marker == "참고":
        return "reference"
    return "etc"


def is_reference_shelf(name: str) -> bool:
    """참고/기타 접두사 폴더 → '참고자료 서고'로 별도 취급한다."""
    return folder_importance(name) in {"reference", "etc"}


def is_reference_shelf_path(relative_path: str) -> bool:
    """상대 경로의 디렉터리 조각 중 하나라도 참고서고 폴더면 태깅 대상에서 제외한다 (§5.1)."""
    parts = Path(nfc(str(relative_path or ""))).parts[:-1]
    return any(is_reference_shelf(part) for part in parts)


def normalize_folder_name(name: str) -> str:
    """접두사/번호/연도를 걷어낸 업무 후보 이름."""
    value = nfc(str(name or "")).strip()
    value = FILENAME_SIGNALS["importance_prefix"].sub("", value)
    value = re.sub(r"^\d{1,2}[\.\)\-_]\s*", "", value)
    # 연도 토큰 제거: "2026", "2026년", "2026년도" 모두 소거 (년만 지우고 "도"가
    # 남아 "도 사업계획" 처럼 나오던 회귀 방지 — 2026-07-08 리뷰).
    value = re.sub(r"(19|20)\d{2}\s*(?:년도|년)?", "", value)
    value = re.sub(r"[\s_\-]+", " ", value).strip()
    return value


def version_signals(stem: str) -> dict[str, Any]:
    value = nfc(str(stem or ""))
    version_hits = [int(match) for match in FILENAME_SIGNALS["version"].findall(value)]
    round_match = FILENAME_SIGNALS["round"].search(value)
    date_token: str | None = None
    prefix_match = FILENAME_SIGNALS["date_prefix"].match(value)
    if prefix_match:
        date_token = prefix_match.group(1)
    else:
        paren_match = FILENAME_SIGNALS["date_paren"].search(value)
        if paren_match:
            date_token = paren_match.group(1)
    return {
        "final": bool(FILENAME_SIGNALS["final"].search(value)),
        "revised": bool(FILENAME_SIGNALS["revised"].search(value)),
        "version": max(version_hits) if version_hits else None,
        "round": int(round_match.group(1)) if round_match else None,
        "date_token": date_token,
        "attachment": bool(FILENAME_SIGNALS["attachment"].search(value)),
        "backup": bool(FILENAME_SIGNALS["backup"].search(value)),
    }


def normalize_family_key(stem: str) -> str:
    """가족 감지용 파일명 정규화: 날짜/버전/(최종)/(붙임)/공백을 걷어낸다."""
    value = nfc(str(stem or ""))
    value = FILENAME_SIGNALS["importance_prefix"].sub("", value)
    value = re.sub(r"^(\d{6}|\d{8})[\s_\-\.]*", "", value)
    value = FILENAME_SIGNALS["date_paren"].sub("", value)
    value = re.sub(r"\(\d+차\)", "", value)
    value = re.sub(r"[\(\[]\s*(최종|최최종|수정|안|초안|붙임|참고|구)\s*[\)\]]", "", value)
    value = re.sub(r"[vV]\.?\d+(\.\d+)*", "", value)
    value = re.sub(r"최최종|최종본|최종", "", value)
    value = re.sub(r"(?i:backup|copy|final)|백업|사본|복사본", "", value)
    # Windows 사본 마커 "(1)"/"- 사본"/번호 접미사와 연도(년도 포함) 정규화 —
    # 유사 파일이 개별문서로 갈라지던 회귀 방지 (2026-07-08 리뷰 §9).
    value = re.sub(r"[\-_\s]*(?:사본|copy)\s*\d*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\(\s*\d+\s*\)", "", value)
    value = re.sub(r"(19|20)\d{2}\s*(?:년도|년)?", "", value)
    value = re.sub(r"[\s_\-\.\(\)\[\]#,·]+", "", value).lower()
    return value


def family_key_for(relative_path: str) -> tuple[str, str]:
    """문서 패밀리 키: (정규화 stem, 부모 폴더 posix 경로) — §5.3."""
    rel = Path(nfc(str(relative_path or "")))
    return (normalize_family_key(rel.stem), rel.parent.as_posix())


def family_id_for(norm_key: str, folder: str) -> str:
    return hashlib.sha1(f"{norm_key}|{folder}".encode("utf-8")).hexdigest()[:12]


def family_sort_key(signals: dict[str, Any], mtime: str) -> tuple[Any, ...]:
    """가족 최신본 판정 정렬키: (최종) > 버전번호(vN) > 수정일 > 날짜토큰 — 결정적."""
    return (
        1 if signals["final"] else 0,
        signals["version"] or 0,
        str(mtime or ""),
        signals["date_token"] or "",
    )


def match_doc_role(filename: str, *, enabled_keys: list[str] | None = None) -> dict[str, Any] | None:
    """파일명 → 문서역할. DOC_ROLES 순서가 우선순위(그림자 최우선)."""
    value = nfc(str(filename or ""))
    for role in DOC_ROLES:
        if enabled_keys is not None and not role["shadow"] and role["key"] not in enabled_keys:
            continue
        for pattern in role["filename_patterns"]:
            if re.search(pattern, value):
                return role
    return None


def match_doc_role_candidates(filename: str) -> list[str]:
    value = nfc(str(filename or ""))
    hits: list[str] = []
    for role in DOC_ROLES:
        if any(re.search(pattern, value) for pattern in role["filename_patterns"]):
            hits.append(role["key"])
    return hits


def match_work_area(
    taxonomy: dict[str, Any],
    *,
    relative_path: str,
    source_path: str = "",
    title: str = "",
) -> tuple[str | None, str, list[dict[str, Any]], str]:
    """확정 taxonomy 기반 업무영역 판정 — returns (slug, confidence, candidates, reason).

    apply 배치(work_taxonomy)와 색인 내 증분 태깅(knowledge_wiki)이 공유하는
    단일 구현. 폴더 직매핑=high, 이름/키워드 단독=medium, 충돌·무신호=low.
    """
    areas = taxonomy.get("work_areas") or []
    rel = nfc(str(relative_path or ""))
    segments = rel.split("/")[:-1]
    normalized_segments = {normalize_folder_name(segment) for segment in segments}
    filename = Path(rel or str(source_path or "")).stem
    haystack = nfc(f"{filename} {title or ''}")

    folder_matches: list[dict[str, Any]] = []
    for area in areas:
        for folder in area.get("folders") or []:
            normalized_folder = normalize_folder_name(folder)
            if folder in segments or (normalized_folder and normalized_folder in normalized_segments):
                folder_matches.append(area)
                break
    if len(folder_matches) == 1:
        return folder_matches[0]["slug"], "high", [], "folder"
    if len(folder_matches) > 1:
        candidates = [
            {"work_area_slug": area["slug"], "name": area["name"], "signal": "folder"}
            for area in folder_matches
        ]
        return None, "low", candidates, "conflict"

    keyword_matches: list[dict[str, Any]] = []
    for area in areas:
        terms = [area["name"], *(area.get("keywords") or [])]
        if any(term and term in haystack for term in terms):
            keyword_matches.append(area)
    if len(keyword_matches) == 1:
        return keyword_matches[0]["slug"], "medium", [], "keyword"
    if len(keyword_matches) > 1:
        candidates = [
            {"work_area_slug": area["slug"], "name": area["name"], "signal": "keyword"}
            for area in keyword_matches
        ]
        return None, "low", candidates, "conflict"
    return None, "low", [], "no_signal"
