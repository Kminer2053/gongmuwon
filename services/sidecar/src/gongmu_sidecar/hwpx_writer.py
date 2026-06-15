from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import re
import tempfile
from typing import Literal, cast
import zipfile

from hwpx import HwpxDocument


PublicDocumentFormat = Literal["officialMemo", "onePageReport", "fullReport", "email"]
DocumentFormat = Literal["auto", "officialMemo", "onePageReport", "fullReport", "email"]
BUILTIN_TEMPLATE_ROOT = Path(__file__).with_name("public_doc_templates")
BUILTIN_FORMAT_DIRS = {
    "officialMemo": "format_gongmun",
    "onePageReport": "format_1p",
    "fullReport": "format_full",
    "email": "format_email",
}
ONEPAGE_MARKER_PREFIX = {
    "text_005": "◦ ",
    "text_006": "◦ ",
    "text_010": "◦ ",
    "text_011": "◦ ",
    "text_015": "◦ ",
    "text_016": "◦ ",
    "text_020": "◦ ",
    "text_021": "◦ ",
    "text_024": "◦ ",
    "text_025": "◦ ",
    "text_027": "◦ ",
    "text_028": "◦ ",
    "text_008": " * ",
    "text_013": " * ",
    "text_018": " * ",
    "text_023": " * ",
    "본문_주석_001": " * ",
    "본문_주석_002": " * ",
}
ONEPAGE_TRIM_BULLET = {"text_007", "text_012", "text_017", "text_022", "text_026", "text_029"}
ONEPAGE_CHILD_NOTE_SLOTS = {
    "text_008": ("text_007",),
    "text_013": ("text_012",),
    "text_018": ("text_017",),
    "text_023": ("text_020", "text_021", "text_022"),
}
ONEPAGE_CONTENT_SLOTS = (
    "text_005",
    "text_006",
    "text_007",
    "text_008",
    "text_010",
    "text_011",
    "text_012",
    "text_013",
    "text_015",
    "text_016",
    "text_017",
    "text_018",
    "text_020",
    "text_021",
    "text_022",
    "text_023",
    "text_024",
    "text_025",
    "text_026",
    "text_027",
    "text_028",
    "text_029",
)
ONEPAGE_MAIN_SECTION_SLOTS = (
    ("text_004", ("text_005", "text_006", "text_007", "text_008")),
    ("text_009", ("text_010", "text_011", "text_012", "text_013")),
    ("text_014", ("text_015", "text_016", "text_017", "text_018")),
    ("text_019", ("text_020", "text_021", "text_022", "text_023")),
)
BULLET_MARKERS = ["- ", "– ", "− ", "—", "-", "–", "−"]
SUBBULLET_MARKERS = ["◦ ", "○ ", "◇ ", "◦", "○"]
ASTERISK_MARKERS = ["* ", "※ ", " * ", "*"]
EMPTY_PLACEHOLDER_MARKER = "\u200b\u200b__EMPTY_PLACEHOLDER__\u200b\u200b"
CLONE_PARAGRAPH_KEY = "__clone_paragraphs__"
FULL_REPORT_DYNAMIC_BODY_KEY = "__full_report_dynamic_body__"
FULL_REPORT_DYNAMIC_CLEANUP_KEY = "__full_report_dynamic_cleanup__"
FULL_REPORT_SUBSECTION_PREFIX = "__full_report_subsection__:"
DEFAULT_SKELETON_VALUES = {
    "text_004": "수신",
}
INTERNAL_DOCUMENT_PURPOSE_PATTERNS = [
    re.compile(r"^\s*(?:1페이지\s*보고서|시행문|풀버전\s*보고서|이메일|보고서)\s*(?:바로\s*작성|초안)\s*$", re.I),
    re.compile(r"^\s*업무대화\s*세션\s*기반\s*(?:1페이지\s*보고서|시행문|풀버전\s*보고서|이메일|보고서|자동\s*문서작성)\s*작성\s*$", re.I),
    re.compile(r"^\s*세션\s*없이\s*바로\s*작성\s*$", re.I),
]
ONEPAGE_DEFAULT_OUTLINE = ["보고요지", "배경·현황", "주요내용·검토", "향후계획·요청사항"]
FULL_REPORT_DEFAULT_OUTLINE = ["추진배경 및 목적", "현황 및 쟁점", "해결방안", "기대효과", "조치사항", "근거 및 연결자료"]
ROMAN_SECTION_LABELS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]
FULL_REPORT_TOC_CHAPTER_SLOTS = [1, 3, 13, 21, 33, 43]
FULL_REPORT_TOC_SUBSECTION_SLOTS_BY_CHAPTER = (
    [],
    [5, 7, 9, 11],
    [15, 17, 19],
    [23, 25, 27, 29, 31],
    [35, 37, 39, 41],
    [45, 47, 49, 51],
)
FULL_REPORT_CHAPTER_GROUPS = (
    ("장01_제목", "본문_절_001", "본문_항목_001", "본문_세부_001", "본문_주석_001"),
    ("장02_제목", "본문_절_002", "본문_항목_002", "본문_세부_002", "본문_주석_002"),
    ("장03_제목", "본문_절_004", "본문_항목_004", "본문_세부_004", "본문_주석_004"),
    ("장04_제목", "본문_절_006", "본문_항목_006", "본문_세부_006", "본문_주석_006"),
    ("장05_제목", "본문_절_008", "본문_항목_008", "본문_세부_008", "본문_주석_008"),
    ("장06_제목", "본문_절_011", "본문_항목_011", "본문_세부_010", "본문_주석_011"),
)
FULL_REPORT_REMOVABLE_TOKENS = tuple(
    [
        *(f"장{index:02d}_제목" for index in range(1, 7)),
        *(f"본문_절_{index:03d}" for index in range(1, 13)),
        *(f"본문_항목_{index:03d}" for index in range(1, 13)),
        *(f"본문_세부_{index:03d}" for index in range(1, 12)),
        *(f"본문_주석_{index:03d}" for index in range(1, 13)),
    ]
)
ONEPAGE_OUTLINE_PRESETS: list[tuple[tuple[str, ...], list[str]]] = [
    (("회의결과", "회의 결과"), ["결과요약", "회의개요", "결정사항", "조치계획"]),
    (("회의안건", "회의 안건", "회의"), ["안건요지", "회의개요", "주요쟁점", "결정사항"]),
    (("행사계획", "행사 계획", "행사"), ["행사개요", "추진배경", "주요내용", "준비사항"]),
    (("사업", "정책", "계획", "추진", "도입", "구축", "로드맵", "예산"), ["추진방향", "추진배경·현황", "주요내용", "향후계획"]),
    (("예산", "구매", "품의"), ["요청사항", "추진배경", "산출근거", "추진방법"]),
    (("검토", "의사결정", "판단", "선택", "승인", "대안"), ["검토결과", "검토배경·쟁점", "대안검토", "결정요청"]),
    (("개선", "문제해결", "해결방안"), ["개선방향", "현황·문제점", "개선방안", "실행계획"]),
    (("이슈", "리스크", "사고", "민원", "긴급"), ["상황요약", "조치현황", "영향분석", "향후대응"]),
    (("결과", "성과", "완료"), ["결과요약", "추진개요", "주요성과", "후속조치"]),
    (("현황", "동향"), ["보고요지", "주요현황", "영향·시사점", "향후관리"]),
]
INTERNAL_AUTHORING_MARKERS = [
    "Content Base",
    "WorkSessionBrief",
    "DocumentPlan",
    "public-doc-to-hwpx",
    "HWPX skeleton",
    "콘텐츠 기초데이터",
    "작성목적/서식 결정",
    "서식 슬롯",
    "레이아웃 최적화",
    "사용자 양식",
    "출력 유형",
    "작성 방식",
    "작성 품질 점검",
    "원칙 준수",
    "형식 적합성",
    "누락/불확실",
]
BODY_PLACEHOLDERS = {
    "text_007",
    "text_008",
    "text_009",
    "text_010",
    "text_011",
    "text_012",
    "text_013",
    "목차_항목_001",
    "목차_항목_002",
    "목차_항목_003",
    "목차_항목_004",
}
GONGMUN_EXPANSION_RULES = [
    {
        "key": "본문",
        "slots": ["text_007", ("text_008", "text_009")],
        "para_pr": "29",
        "char_pr": "24",
        "anchor": "text_009",
        "slot_indent": "",
        "dynamic_indent": "",
    },
    {
        "key": "본문_가나",
        "slots": [],
        "para_pr": "26",
        "char_pr": "22",
        "anchor": "text_009",
        "slot_indent": "",
        "dynamic_indent": "",
        "dynamic_indent_xml": "  <hp:fwSpace/>",
    },
    {
        "key": "본문_1)",
        "slots": ["text_010"],
        "para_pr": "26",
        "char_pr": "27",
        "anchor": "text_010",
        "slot_indent": "    ",
        "dynamic_indent": "    ",
    },
    {
        "key": "본문_가)",
        "slots": ["text_011"],
        "para_pr": "26",
        "char_pr": "27",
        "anchor": "text_011",
        "slot_indent": "      ",
        "dynamic_indent": "      ",
    },
    {
        "key": "본문_(1)",
        "slots": ["text_012"],
        "para_pr": "26",
        "char_pr": "27",
        "anchor": "text_012",
        "slot_indent": "        ",
        "dynamic_indent": "        ",
    },
    {
        "key": "본문_①",
        "slots": ["text_013"],
        "para_pr": "26",
        "char_pr": "27",
        "anchor": "text_013",
        "slot_indent": "          ",
        "dynamic_indent": "          ",
    },
    {
        "key": "붙임",
        "slots": ["목차_항목_003"],
        "para_pr": "27",
        "char_pr": "22",
        "anchor": "목차_항목_003",
        "slot_indent": "",
        "dynamic_indent": "",
    },
]


@dataclass(frozen=True)
class OnePageCoreSection:
    heading: str
    body: list[str]


@dataclass(frozen=True)
class PublicDocumentPayload:
    title: str
    document_purpose: str
    selected_format: PublicDocumentFormat
    summary: list[str]
    background: list[str]
    current_status: list[str]
    issues: list[str]
    solutions: list[str]
    expected_effects: list[str]
    actions: list[str]
    requested_action: list[str]
    evidence: list[str]
    quality_checks: list[str]
    related: str
    recipient: str
    sender: str
    deadline: str
    security_level: str
    expected_length: str
    urgency_level: str
    needs_traceability: str
    requires_official_form: str
    report_outline_headings: list[str] = field(default_factory=list)
    report_core_sections: list[OnePageCoreSection] = field(default_factory=list)
    onepage_outline_headings: list[str] = field(default_factory=list)
    onepage_core_sections: list[OnePageCoreSection] = field(default_factory=list)


def build_public_document_payload(
    *,
    title: str,
    purpose: str,
    template_key: str,
    content_markdown: str,
    document_format: DocumentFormat = "auto",
    audience_type: str = "",
    expected_length: str = "",
    urgency_level: str = "",
    needs_traceability: str = "",
    requires_official_form: str = "",
    requested_action: str = "",
    deadline: str = "",
    security_level: str = "",
) -> PublicDocumentPayload:
    sections = _parse_markdown_sections(content_markdown)
    selected_format = choose_public_document_format(
        title=title,
        purpose=purpose,
        template_key=template_key,
        document_format=document_format,
    )
    brief_lines = _usable_section_values(sections, "WorkSessionBrief")
    plan_lines = _usable_section_values(sections, "DocumentPlan")
    core_lines = _usable_section_values_any(sections, ["핵심 내용", "핵심요약", "요약"])
    status_issue_lines = _usable_section_values_any(sections, ["현황 및 쟁점", "현황", "쟁점", "문제점"])
    solution_section_lines = _usable_section_values_any(sections, ["조치안", "해결방안", "후속 조치"])
    effect_request_lines = _usable_section_values_any(sections, ["기대효과 및 요청", "기대효과", "요청사항"])
    effect_lines, request_lines = _split_effect_request_lines(effect_request_lines)
    evidence_section_lines = _usable_section_values_any(sections, ["수집 근거", "근거 및 연결자료", "출처"])
    quality_section_lines = _usable_section_values_any(sections, ["작성 품질 점검", "품질 점검"])
    session_lines = sections.get("업무대화 세션", [])
    conversation_lines = _usable_section_values(sections, "업무대화 기록")
    linked_file_lines = _usable_section_values(sections, "세션 연결 파일")
    direct_file_lines = _usable_section_values(sections, "직접 연결 파일")
    instruction_lines = _usable_section_values(sections, "세션 기반 작성 개요") + _usable_section_values(sections, "바로 작성 개요")
    reference_lines = evidence_section_lines + _usable_section_values(sections, "참고자료") + linked_file_lines + direct_file_lines
    session_brief_lines = _session_brief_lines(conversation_lines)
    session_issue_lines = _session_issue_lines(conversation_lines)
    report_context_lines = _dedupe_non_empty(
        core_lines
        + brief_lines
        + status_issue_lines
        + solution_section_lines
        + effect_request_lines
        + linked_file_lines
        + direct_file_lines
        + session_brief_lines
        + instruction_lines
        + conversation_lines
    )
    evidence_lines = _dedupe_non_empty(
        evidence_section_lines
        + linked_file_lines
        + direct_file_lines
        + session_brief_lines
        + instruction_lines
        + _usable_section_values(sections, "참고자료")
        + session_lines
        + conversation_lines
    )
    requested_action_lines = [requested_action] if requested_action.strip() else request_lines or _first_non_empty(
        sections,
        ["기대효과 및 요청", "후속 조치", "결정 사항", "권고안", "요청사항", "작성 슬롯"],
    )
    solutions = _first_non_empty(
        sections,
        ["조치안", "후속 조치", "결정 사항", "권고안", "해결방안", "조치사항"],
        fallback=report_context_lines[:3] if report_context_lines else None,
    )
    onepage_outline_headings = _extract_onepage_outline_headings(
        sections=sections,
        title=title,
        purpose=purpose,
        context_lines=report_context_lines + evidence_lines,
    )
    onepage_core_sections = _extract_onepage_core_sections(
        sections=sections,
        outline_headings=onepage_outline_headings,
    )
    if not _has_explicit_core_section_headings(sections, onepage_outline_headings):
        onepage_core_sections = []
    report_outline_headings = onepage_outline_headings
    report_core_sections = onepage_core_sections
    if selected_format == "fullReport":
        full_report_outline_headings = _extract_full_report_outline_headings(
            markdown_text=content_markdown,
            sections=sections,
            title=title,
            purpose=purpose,
            context_lines=report_context_lines + evidence_lines,
        )
        full_report_core_sections = _extract_full_report_core_sections(
            markdown_text=content_markdown,
            outline_headings=full_report_outline_headings,
        )
        if full_report_core_sections:
            report_outline_headings = full_report_outline_headings
            report_core_sections = full_report_core_sections
        else:
            report_outline_headings = full_report_outline_headings
            report_core_sections = []
    pick = lambda keys, fallback=None: _apply_writing_principles(_first_non_empty(sections, keys, fallback=fallback))

    return PublicDocumentPayload(
        title=title or sections.get("_title", ["공무 업무 문서"])[0],
        document_purpose=purpose,
        selected_format=selected_format,
        summary=_apply_writing_principles(
            core_lines[:4]
            or session_brief_lines[:3]
            or report_context_lines[:3]
            or _first_non_empty(
                sections,
                ["핵심 내용", "회의 목적", "검토 배경", "업무대화 세션", "개요", "바로 작성 개요", "세션 기반 작성 개요"],
            )
        ),
        background=_apply_writing_principles(
            (brief_lines + session_brief_lines + session_lines + conversation_lines)[:4]
            or _first_non_empty(sections, ["검토 배경", "회의 목적", "개요", "바로 작성 개요", "세션 기반 작성 개요"])
        ),
        current_status=_apply_writing_principles(
            (status_issue_lines + linked_file_lines + direct_file_lines + session_brief_lines + conversation_lines)[:5]
            or _first_non_empty(sections, ["핵심 내용", "논의 안건"])
        ),
        issues=_apply_writing_principles(
            (status_issue_lines + session_issue_lines + linked_file_lines + direct_file_lines + session_brief_lines + conversation_lines)[:5]
            or _first_non_empty(sections, ["핵심 내용", "논의 안건", "검토 의견", "문제점", "바로 작성 개요", "세션 기반 작성 개요"])
        ),
        solutions=_apply_writing_principles(solutions),
        expected_effects=_apply_writing_principles(
            effect_lines
            or _first_non_empty(
                sections,
                ["기대효과", "기대효과 및 요청"],
                fallback=["후속 절차를 명확히 하고 업무 이력을 재사용할 수 있습니다."],
            )
        ),
        actions=pick(["조치안", "후속 조치", "결정 사항", "권고안", "조치사항"], fallback=(session_issue_lines + report_context_lines)[:2] if report_context_lines else None),
        requested_action=_apply_writing_principles(requested_action_lines),
        evidence=_apply_writing_principles(evidence_lines),
        quality_checks=_apply_writing_principles(quality_section_lines) or _public_document_quality_checks(),
        related="; ".join(reference_lines) if reference_lines else "Content Base 초안",
        recipient=audience_type or "관련 부서",
        sender="공무 워크스페이스",
        deadline=deadline or "기한 미정",
        security_level=security_level or "일반",
        expected_length=expected_length or "미지정",
        urgency_level=urgency_level or "보통",
        needs_traceability=needs_traceability or "미지정",
        requires_official_form=requires_official_form or "미지정",
        report_outline_headings=report_outline_headings,
        report_core_sections=report_core_sections,
        onepage_outline_headings=onepage_outline_headings,
        onepage_core_sections=onepage_core_sections,
    )


def choose_public_document_format(
    *,
    title: str,
    purpose: str,
    template_key: str,
    document_format: DocumentFormat = "auto",
) -> PublicDocumentFormat:
    if document_format != "auto":
        return cast(PublicDocumentFormat, document_format)

    text = f"{title} {purpose}".lower()
    if any(token in text for token in ["시행", "공문", "지시", "협조요청"]):
        return "officialMemo"
    if any(token in text for token in ["이메일", "메일", "회신"]):
        return "email"
    if template_key == "meeting":
        return "fullReport"
    if template_key == "review":
        return "onePageReport"
    return "onePageReport"


def _extract_onepage_outline_headings(
    *,
    sections: dict[str, list[str]],
    title: str,
    purpose: str,
    context_lines: list[str],
) -> list[str]:
    explicit = _extract_explicit_onepage_outline_headings(sections)
    if explicit:
        return explicit
    return _infer_onepage_outline_headings(title=title, purpose=purpose, context_lines=context_lines)


def _extract_full_report_outline_headings(
    *,
    markdown_text: str,
    sections: dict[str, list[str]],
    title: str,
    purpose: str,
    context_lines: list[str],
) -> list[str]:
    headings: list[str] = []
    for raw_line in _markdown_section_raw_lines(markdown_text, "목차"):
        if not _is_top_level_report_outline_line(raw_line):
            continue
        heading = _clean_full_report_heading(_strip_outline_list_prefix(raw_line.strip()))
        if heading and heading not in headings:
            headings.append(heading)

    if headings:
        return headings

    for raw_line in _markdown_section_raw_lines(markdown_text, "핵심 내용"):
        stripped = raw_line.strip()
        if not stripped.startswith("### "):
            continue
        heading = _clean_full_report_heading(_strip_outline_list_prefix(stripped[4:].strip()))
        if heading and heading not in headings:
            headings.append(heading)

    if headings:
        return headings

    onepage_headings = _extract_onepage_outline_headings(
        sections=sections,
        title=title,
        purpose=purpose,
        context_lines=context_lines,
    )
    return onepage_headings or FULL_REPORT_DEFAULT_OUTLINE


def _extract_full_report_core_sections(
    *,
    markdown_text: str,
    outline_headings: list[str],
) -> list[OnePageCoreSection]:
    normalized_outline = [
        (_normalize_compare_text(_clean_full_report_heading(heading)), _clean_full_report_heading(heading))
        for heading in outline_headings
        if _clean_full_report_heading(heading)
    ]
    results: list[tuple[str, list[str]]] = []
    current_heading = ""
    current_body: list[str] = []
    saw_explicit_section_heading = False

    def flush() -> None:
        nonlocal current_heading, current_body
        body = _dedupe_non_empty(current_body)
        if current_heading and body:
            results.append((current_heading, body))
        current_heading = ""
        current_body = []

    for raw_line in _markdown_section_raw_lines(markdown_text, "핵심 내용"):
        stripped = raw_line.strip()
        if not stripped:
            continue
        if stripped.startswith("### "):
            flush()
            saw_explicit_section_heading = True
            candidate = _clean_full_report_heading(_strip_outline_list_prefix(stripped[4:].strip()))
            current_heading = _match_report_outline_heading(candidate, normalized_outline) or candidate
            continue
        if stripped.startswith("#### "):
            subsection = _clean_full_report_heading(_strip_outline_list_prefix(stripped[5:].strip()))
            if subsection:
                current_body.append(_full_report_subsection_marker(subsection))
            continue
        item = _clean_report_body_line(stripped)
        if not item:
            continue
        if not current_heading and normalized_outline and saw_explicit_section_heading:
            current_heading = normalized_outline[min(len(results), len(normalized_outline) - 1)][1]
        current_body.append(item)

    flush()
    if results:
        return [OnePageCoreSection(heading=heading, body=body) for heading, body in results]
    return []


def _markdown_section_raw_lines(markdown_text: str, section_title: str) -> list[str]:
    lines: list[str] = []
    inside = False
    target = _normalize_compare_text(section_title)
    for raw_line in markdown_text.splitlines():
        stripped = raw_line.strip()
        if stripped.startswith("## ") and not stripped.startswith("### "):
            current = _normalize_compare_text(stripped[3:].strip())
            if inside and current != target:
                break
            inside = current == target
            continue
        if inside:
            lines.append(raw_line.rstrip())
    return lines


def _is_top_level_report_outline_line(value: str) -> bool:
    stripped = value.strip()
    if not stripped:
        return False
    if re.match(r"^\d+\.\d+", stripped):
        return False
    return bool(re.match(r"^(?:\d{1,2}|[IVXLCivxlc]+)[\.)]\s+\S", stripped))


def _match_report_outline_heading(
    candidate: str,
    normalized_outline: list[tuple[str, str]],
) -> str:
    candidate_key = _normalize_compare_text(candidate)
    if not candidate_key:
        return ""
    for outline_key, outline_heading in normalized_outline:
        if candidate_key == outline_key or candidate_key.startswith(outline_key) or outline_key.startswith(candidate_key):
            return outline_heading
    return ""


def _clean_report_body_line(value: str) -> str:
    cleaned = _compact_public_sentence(value)
    if (
        not cleaned
        or _looks_like_placeholder_value(cleaned)
        or _looks_like_label_only(cleaned)
        or _looks_like_document_generation_instruction(cleaned)
        or _looks_like_internal_authoring_metadata(cleaned)
    ):
        return ""
    return cleaned


def _split_effect_request_lines(lines: list[str]) -> tuple[list[str], list[str]]:
    effects: list[str] = []
    requests: list[str] = []
    for line in lines:
        label, content = _split_leading_public_label(line)
        prefix = _normalize_compare_text(line)[:24]
        if label in {"효과", "기대효과"}:
            effects.append(content)
        elif label in {"요청", "요청사항", "요청 사항", "결정요청"}:
            requests.append(content)
        elif label in {"조치", "조치안", "후속조치", "후속 조치"}:
            requests.append(content)
        elif "요청" in prefix:
            requests.append(re.sub(r"^.*?[:：]\s*", "", content).strip())
        elif "효과" in prefix:
            effects.append(re.sub(r"^.*?[:：]\s*", "", content).strip())
        else:
            effects.append(content)
    return _dedupe_labeled_public_items(effects), _dedupe_labeled_public_items(requests)


def _split_leading_public_label(value: str) -> tuple[str, str]:
    cleaned = _strip_inline_markdown(value)
    match = re.match(
        r"^\s*(효과|기대효과|요청사항|요청\s*사항|요청|결정요청|조치안|조치|후속\s*조치)\s*[:：]\s*(.+)$",
        cleaned,
    )
    if not match:
        return "", cleaned
    label = re.sub(r"\s+", " ", match.group(1)).strip()
    return label, match.group(2).strip()


def _dedupe_labeled_public_items(items: list[str]) -> list[str]:
    seen: set[str] = set()
    results: list[str] = []
    for item in items:
        value = item.strip()
        key = _normalize_compare_text(value).casefold()
        if (
            not value
            or key in seen
            or _looks_like_placeholder_value(value)
            or _looks_like_label_only(value)
            or _looks_like_internal_authoring_metadata(value)
        ):
            continue
        seen.add(key)
        results.append(value)
    return results


def _extract_explicit_onepage_outline_headings(sections: dict[str, list[str]]) -> list[str]:
    headings: list[str] = []
    outline_lines = _usable_section_values_any(sections, ["1페이지 목차", "목차"])
    for line in outline_lines:
        title = _clean_outline_heading(_strip_outline_list_prefix(line))
        if title and title not in headings:
            headings.append(title)
        if len(headings) >= 4:
            return headings[:4]

    plan_lines = _usable_section_values_any(sections, ["DocumentPlan", "문서구성", "보고서 구성"])
    for line in plan_lines:
        cleaned = _strip_inline_markdown(line)
        match = re.search(r"(?:섹션|section)\s*\d*\s*[:：]\s*(.+)", cleaned, flags=re.I)
        if not match:
            continue
        title = _clean_outline_heading(match.group(1))
        if title and title not in headings:
            headings.append(title)
        if len(headings) >= 4:
            break
    return headings[:4]


def _extract_onepage_core_sections(
    *,
    sections: dict[str, list[str]],
    outline_headings: list[str],
) -> list[OnePageCoreSection]:
    core_lines = _core_section_values_preserving_headings(sections)
    if not core_lines:
        return []

    normalized_outline = [
        (_normalize_compare_text(_clean_outline_heading(heading)), _clean_outline_heading(heading))
        for heading in outline_headings
        if _clean_outline_heading(heading)
    ]
    results: list[tuple[str, list[str]]] = []
    current_heading = ""
    current_body: list[str] = []

    def flush() -> None:
        nonlocal current_heading, current_body
        if current_heading and current_body:
            results.append((current_heading, _dedupe_non_empty(current_body)))
        current_heading = ""
        current_body = []

    for raw_line in core_lines:
        heading = _onepage_core_heading_from_line(raw_line, normalized_outline)
        if heading:
            flush()
            current_heading = heading
            continue
        body = _compact_public_sentence(raw_line)
        if body:
            if not current_heading and normalized_outline:
                current_heading = normalized_outline[min(len(results), len(normalized_outline) - 1)][1]
            current_body.append(body)

    flush()
    return [OnePageCoreSection(heading=heading, body=body) for heading, body in results[:4]]


def _core_section_values_preserving_headings(sections: dict[str, list[str]]) -> list[str]:
    # `## 작성 품질 점검` is internal metadata, but a `### 품질 점검 체크리스트`
    # under `## 핵심 내용` can be a legitimate report section.
    values: list[str] = []
    for value in sections.get("핵심 내용", []):
        if (
            value.strip()
            and not _looks_like_placeholder_value(value)
            and not _looks_like_label_only(value)
            and not _looks_like_document_generation_instruction(value)
        ):
            values.append(value.strip())
    return values


def _has_explicit_core_section_headings(
    sections: dict[str, list[str]],
    outline_headings: list[str],
) -> bool:
    core_lines = _core_section_values_preserving_headings(sections)
    normalized_outline = [
        (_normalize_compare_text(_clean_outline_heading(heading)), _clean_outline_heading(heading))
        for heading in outline_headings
        if _clean_outline_heading(heading)
    ]
    return any(_onepage_core_heading_from_line(line, normalized_outline) for line in core_lines)


def _onepage_core_heading_from_line(
    value: str,
    normalized_outline: list[tuple[str, str]],
) -> str:
    cleaned = _strip_inline_markdown(value)
    candidate = _clean_outline_heading(_strip_outline_list_prefix(cleaned))
    if not candidate:
        return ""
    candidate_key = _normalize_compare_text(candidate)
    for outline_key, outline_heading in normalized_outline:
        if candidate_key == outline_key or candidate_key.startswith(outline_key):
            return outline_heading
    return ""


def _strip_outline_list_prefix(value: str) -> str:
    cleaned = _strip_inline_markdown(value).strip()
    section_match = re.search(r"(?:섹션|section)\s*\d*\s*[:：]\s*(.+)", cleaned, flags=re.I)
    if section_match:
        cleaned = section_match.group(1).strip()
    number_match = re.match(r"^\s*(?:\d{1,2}|[IVXLCivxlc]+)\s*[\.\)]\s*(.+)$", cleaned)
    if number_match:
        cleaned = number_match.group(1).strip()
    marker_match = re.match(r"^\s*(?:□|◦|○|ㆍ|•|-|\*)\s*(.+)$", cleaned)
    if marker_match:
        cleaned = marker_match.group(1).strip()
    return cleaned


def _infer_onepage_outline_headings(*, title: str, purpose: str, context_lines: list[str]) -> list[str]:
    source = _normalize_compare_text(" ".join([title, purpose, *context_lines])).casefold()
    for tokens, headings in ONEPAGE_OUTLINE_PRESETS:
        if any(token.casefold() in source for token in tokens):
            return headings
    return ONEPAGE_DEFAULT_OUTLINE


def _clean_outline_heading(value: str) -> str:
    heading = re.split(r"\s[-–—]\s|[:：]", value, maxsplit=1)[0]
    heading = re.sub(r"^[\s□○◦*\dIVXLCivxlc\.\)\-–—]+", "", heading)
    heading = re.sub(r"\s+", " ", heading).strip()
    heading = heading.strip("[](){}<>")
    if not heading or _looks_like_internal_authoring_metadata(heading):
        return ""
    return heading


def _clean_full_report_heading(value: str) -> str:
    """Clean full-report chapter headings without dropping meaningful subtitles."""
    heading = _strip_outline_list_prefix(value)
    heading = re.sub(r"^[\s□○◦*\dIVXLCivxlc\.\)\-–—]+", "", heading)
    heading = re.sub(r"\s+", " ", heading).strip()
    heading = heading.strip("[](){}<>")
    if not heading or _looks_like_internal_authoring_metadata(heading):
        return ""
    return heading


def _full_report_subsection_marker(heading: str) -> str:
    return f"{FULL_REPORT_SUBSECTION_PREFIX}{_clean_full_report_heading(heading)}"


def _is_full_report_subsection_item(value: str) -> bool:
    return str(value or "").startswith(FULL_REPORT_SUBSECTION_PREFIX)


def _full_report_subsection_heading(value: str) -> str:
    if not _is_full_report_subsection_item(value):
        return ""
    return _clean_full_report_heading(str(value)[len(FULL_REPORT_SUBSECTION_PREFIX) :])


def _clean_full_report_body_item(value: str) -> str:
    if _is_full_report_subsection_item(value):
        heading = _full_report_subsection_heading(value)
        return _full_report_subsection_marker(heading) if heading else ""
    return _clean_report_body_line(value)


def _full_report_visible_body_item(value: str) -> str:
    heading = _full_report_subsection_heading(value)
    return f"□ {heading}" if heading else value


def render_public_document_lines(payload: PublicDocumentPayload) -> list[str]:
    if payload.selected_format == "officialMemo":
        return _render_official_memo(payload)
    if payload.selected_format == "fullReport":
        return _render_full_report(payload)
    if payload.selected_format == "email":
        return _render_email(payload)
    return _render_onepage(payload)


def write_public_hwpx_document(
    *,
    output_path: Path,
    title: str,
    purpose: str,
    template_key: str,
    content_markdown: str,
    document_format: DocumentFormat = "auto",
    audience_type: str = "",
    expected_length: str = "",
    urgency_level: str = "",
    needs_traceability: str = "",
    requires_official_form: str = "",
    requested_action: str = "",
    deadline: str = "",
    security_level: str = "",
    user_template_path: str | None = None,
) -> dict[str, str]:
    payload = build_public_document_payload(
        title=title,
        purpose=purpose,
        template_key=template_key,
        content_markdown=content_markdown,
        document_format=document_format,
        audience_type=audience_type,
        expected_length=expected_length,
        urgency_level=urgency_level,
        needs_traceability=needs_traceability,
        requires_official_form=requires_official_form,
        requested_action=requested_action,
        deadline=deadline,
        security_level=security_level,
    )
    lines = render_public_document_lines(payload)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path = output_path.with_suffix(".md")

    builtin_template_path = _builtin_skeleton_path(payload.selected_format)
    if user_template_path:
        document = _open_template_document(user_template_path)
        document.add_paragraph("")
        document.add_paragraph("---- 공무 워크스페이스 생성 내용 ----")
        for line in lines:
            document.add_paragraph(line)
        document.save_to_path(output_path)
        template_source = "user"
        template_path = str(Path(user_template_path))
    elif builtin_template_path:
        values = _build_skeleton_values(payload, lines)
        _fill_skeleton_template(builtin_template_path, values, output_path)
        template_source = "builtin"
        template_path = str(builtin_template_path)
    else:
        document = HwpxDocument.new()
        for line in lines:
            document.add_paragraph(line)
        document.save_to_path(output_path)
        template_source = "generated"
        template_path = ""
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    return {
        "path": str(output_path),
        "markdown_path": str(markdown_path),
        "format": payload.selected_format,
        "template_source": template_source,
        "template_path": template_path,
    }


def _open_template_document(user_template_path: str | None) -> HwpxDocument:
    if not user_template_path:
        return HwpxDocument.new()
    path = Path(user_template_path)
    if not path.exists():
        raise ValueError("사용자 양식 파일을 찾을 수 없습니다.")
    return HwpxDocument.open(path)


def _builtin_skeleton_path(selected_format: PublicDocumentFormat) -> Path | None:
    directory = BUILTIN_FORMAT_DIRS.get(selected_format)
    if not directory:
        return None
    path = BUILTIN_TEMPLATE_ROOT / directory / "skeleton.hwpx"
    return path if path.exists() else None


def _fill_skeleton_template(skeleton_path: Path, values: dict[str, object], output_path: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="gongmu-hwpx-") as temp_dir:
        workdir = Path(temp_dir)
        with zipfile.ZipFile(skeleton_path, "r") as archive:
            archive.extractall(workdir)

        for xml_path in workdir.rglob("*.xml"):
            text = xml_path.read_text(encoding="utf-8", errors="ignore")
            if xml_path.relative_to(workdir).as_posix() == "Contents/section0.xml":
                text = _apply_public_doc_skeleton_fixes(text)
                values, text = _apply_gongmun_body_expansion(values, text)
                values, text = _apply_clone_paragraph_expansion(values, text)
                values, text = _apply_full_report_dynamic_body_expansion(values, text)
                needs_full_report_cleanup = bool(values.pop(FULL_REPORT_DYNAMIC_CLEANUP_KEY, ""))
                text = _replace_skeleton_tokens(text, values, remove_empty=True)
                if needs_full_report_cleanup:
                    text = _cleanup_full_report_dynamic_skeleton_remainders(text)
            else:
                text = _replace_skeleton_tokens(text, values)
            xml_path.write_text(text, encoding="utf-8")

        hpf_path = workdir / "Contents" / "content.hpf"
        if hpf_path.exists() and values.get("표지_제목"):
            hpf = hpf_path.read_text(encoding="utf-8", errors="ignore")
            safe_title = _xml_escape(values["표지_제목"])
            hpf = re.sub(r"<opf:title>[^<]*</opf:title>", f"<opf:title>{safe_title}</opf:title>", hpf, count=1)
            hpf_path.write_text(hpf, encoding="utf-8")
        _refresh_preview_text(workdir)

        if output_path.exists():
            output_path.unlink()
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as archive:
            mimetype = workdir / "mimetype"
            if mimetype.exists():
                archive.write(mimetype, "mimetype", compress_type=zipfile.ZIP_STORED)
            for file_path in sorted(workdir.rglob("*")):
                if not file_path.is_file() or file_path.name == "mimetype":
                    continue
                archive.write(file_path, file_path.relative_to(workdir).as_posix())


def _refresh_preview_text(workdir: Path) -> None:
    section_path = workdir / "Contents" / "section0.xml"
    preview_path = workdir / "Preview" / "PrvText.txt"
    if not section_path.exists() or not preview_path.parent.exists():
        return
    raw = section_path.read_text(encoding="utf-8", errors="ignore")
    text = _plain_text_from_hwpx_xml(raw)
    preview_path.write_text(text, encoding="utf-8")


def _plain_text_from_hwpx_xml(raw: str) -> str:
    text = raw.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    text = re.sub(r"</hp:p>|</p>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _apply_public_doc_skeleton_fixes(text: str) -> str:
    fixed, _ = _fix_missing_indent_runs(text)
    fixed, _ = _add_receiver_input_slot(fixed)
    return fixed


def _apply_gongmun_body_expansion(values: dict[str, object], text: str) -> tuple[dict[str, object], str]:
    expanded_values = dict(values)
    dynamic: dict[str, list[tuple[str, str, str, str]]] = {}
    for rule in GONGMUN_EXPANSION_RULES:
        key = rule["key"]
        items = expanded_values.pop(key, None)
        if not isinstance(items, list):
            continue
        slots = rule["slots"]
        consumed = 0
        for slot in slots:
            if consumed >= len(items):
                break
            item = _apply_indent(str(items[consumed]), str(rule.get("slot_indent", "")))
            if isinstance(slot, tuple):
                marker, body = _split_numbered_marker(item)
                expanded_values[slot[0]] = marker
                expanded_values[slot[1]] = body
            else:
                expanded_values[slot] = item
            consumed += 1
        extra_items = items[consumed:]
        if extra_items:
            anchor = str(rule["anchor"])
            dynamic.setdefault(anchor, [])
            for item in extra_items:
                dynamic[anchor].append(
                    (
                        _apply_indent(str(item), str(rule.get("dynamic_indent", ""))),
                        str(rule["para_pr"]),
                        str(rule["char_pr"]),
                        str(rule.get("dynamic_indent_xml", "")),
                    )
                )
    return expanded_values, _insert_dynamic_paragraphs(text, dynamic)


def _split_numbered_marker(text: str) -> tuple[str, str]:
    match = re.match(r"^(\d+\.\s*)(.+)$", text, flags=re.DOTALL)
    if match:
        return match.group(1), match.group(2)
    return "", text


def _apply_indent(text: str, indent: str) -> str:
    if not indent:
        return text
    if text and text[0] in (" ", "\u3000", "\t"):
        return text
    return indent + text


def _insert_dynamic_paragraphs(text: str, dynamic: dict[str, list[tuple[str, str, str, str]]]) -> str:
    for anchor, items in dynamic.items():
        if not items:
            continue
        token = f"{{{{{anchor}}}}}"
        index = text.find(token)
        if index == -1:
            continue
        paragraph_start = text.rfind("<hp:p ", 0, index)
        if paragraph_start == -1:
            continue
        paragraph_end = _find_matching_paragraph_close(text, paragraph_start)
        if paragraph_end == -1:
            continue
        blocks = "".join(
            _build_dynamic_paragraph(item, para_pr, char_pr, indent_xml)
            for item, para_pr, char_pr, indent_xml in items
        )
        text = text[:paragraph_end] + blocks + text[paragraph_end:]
    return text


def _apply_clone_paragraph_expansion(values: dict[str, object], text: str) -> tuple[dict[str, object], str]:
    expanded_values = dict(values)
    clone_map = expanded_values.pop(CLONE_PARAGRAPH_KEY, None)
    if not isinstance(clone_map, dict):
        return expanded_values, text

    normalized: dict[str, list[str]] = {}
    for anchor, items in clone_map.items():
        if not isinstance(anchor, str) or not isinstance(items, list):
            continue
        normalized_items = [str(item).strip() for item in items if str(item).strip()]
        if normalized_items:
            normalized[anchor] = normalized_items
    return expanded_values, _insert_clone_paragraphs(text, normalized)


def _insert_clone_paragraphs(text: str, dynamic: dict[str, list[str]]) -> str:
    for anchor, items in dynamic.items():
        if not items:
            continue
        token = f"{{{{{anchor}}}}}"
        index = text.find(token)
        if index == -1:
            continue
        paragraph_start = text.rfind("<hp:p ", 0, index)
        if paragraph_start == -1:
            continue
        paragraph_end = _find_matching_paragraph_close(text, paragraph_start)
        if paragraph_end == -1:
            continue
        paragraph = text[paragraph_start:paragraph_end]
        blocks = "".join(_clone_paragraph_with_text(paragraph, anchor, item) for item in items)
        text = text[:paragraph_end] + blocks + text[paragraph_end:]
    return text


def _clone_paragraph_with_text(paragraph: str, anchor: str, text: str) -> str:
    cloned = re.sub(r'<hp:p id="[^"]+"', '<hp:p id="0"', paragraph, count=1)
    cloned = re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", cloned, flags=re.DOTALL)
    return cloned.replace(f"{{{{{anchor}}}}}", _xml_escape(text))


def _apply_full_report_dynamic_body_expansion(values: dict[str, object], text: str) -> tuple[dict[str, object], str]:
    expanded_values = dict(values)
    sections = expanded_values.pop(FULL_REPORT_DYNAMIC_BODY_KEY, None)
    if not isinstance(sections, list) or not sections:
        return expanded_values, text
    blocks = _build_full_report_dynamic_body_blocks(sections)
    if not blocks:
        return expanded_values, text
    expanded_values[FULL_REPORT_DYNAMIC_CLEANUP_KEY] = "1"
    insertion_index = text.find("{{장01_제목}}")
    if insertion_index == -1:
        insertion_index = text.find("{{본문_절_001}}")
    if insertion_index == -1:
        return expanded_values, text
    paragraph_start = text.rfind("<hp:p ", 0, insertion_index)
    if paragraph_start == -1:
        return expanded_values, text
    return expanded_values, text[:paragraph_start] + blocks + text[paragraph_start:]


def _build_full_report_dynamic_body_blocks(sections: list[object]) -> str:
    blocks: list[str] = []
    for index, section in enumerate(sections, start=1):
        if not isinstance(section, OnePageCoreSection):
            continue
        heading = _clean_full_report_heading(section.heading)
        body = _dedupe_non_empty([_clean_full_report_body_item(item) for item in section.body])
        if not heading and not body:
            continue
        chapter_label = _roman_label(index)
        if heading:
            blocks.append(_build_dynamic_paragraph(f"{chapter_label}. {heading}", "22", "32"))
        saw_subsection = False
        for item in body:
            subsection = _full_report_subsection_heading(item)
            if subsection:
                saw_subsection = True
                blocks.append(_build_dynamic_paragraph(f" □ {subsection}", "37", "53"))
                continue
            if saw_subsection:
                blocks.append(_build_dynamic_paragraph(f"  ◦ {item}", "38", "54"))
            else:
                blocks.append(_build_dynamic_paragraph(f"  ◦ {item}", "38", "54"))
    return "".join(blocks)


def _build_dynamic_paragraph(text: str, para_pr: str, char_pr: str, indent_xml: str = "") -> str:
    safe_text = _xml_escape(text)
    return (
        f'<hp:p id="0" paraPrIDRef="{para_pr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="{char_pr}"><hp:t>{indent_xml}{safe_text}</hp:t></hp:run>'
        f"</hp:p>"
    )


def _replace_skeleton_tokens(text: str, values: dict[str, object], *, remove_empty: bool = False) -> str:
    tokens = set(re.findall(r"\{\{([^}]+)\}\}", text))
    for token in tokens:
        if token in values and values[token] != "":
            replacement = _xml_escape(str(values[token]))
        elif token in DEFAULT_SKELETON_VALUES:
            replacement = _xml_escape(DEFAULT_SKELETON_VALUES[token])
        elif remove_empty and token in BODY_PLACEHOLDERS:
            replacement = EMPTY_PLACEHOLDER_MARKER
        else:
            replacement = ""
        text = text.replace(f"{{{{{token}}}}}", replacement)
    if remove_empty:
        text = _remove_empty_marker_paragraphs(text)
    return text


def _fix_missing_indent_runs(text: str) -> tuple[str, int]:
    fixed = 0
    for token, indent_char_pr in [("목차_항목_021", "12")]:
        index = text.find(f"{{{{{token}}}}}")
        if index == -1:
            continue
        run_start = text.rfind("<hp:run", 0, index)
        paragraph_start = text.rfind("<hp:p ", 0, run_start)
        if run_start == -1 or paragraph_start == -1:
            continue
        if "<hp:run" in text[paragraph_start:run_start]:
            continue
        indent_run = f'<hp:run charPrIDRef="{indent_char_pr}"><hp:t> </hp:t></hp:run>'
        text = text[:run_start] + indent_run + text[run_start:]
        fixed += 1
    return text, fixed


def _add_receiver_input_slot(text: str) -> tuple[str, bool]:
    index = text.find("{{text_004}}")
    if index == -1:
        return text, False
    label_cell_end = text.find("</hp:tc>", index)
    if label_cell_end == -1:
        return text, False
    next_cell_start = text.find("<hp:tc", label_cell_end + len("</hp:tc>"))
    if next_cell_start == -1:
        return text, False
    next_cell_end = text.find("</hp:tc>", next_cell_start)
    if next_cell_end == -1:
        return text, False
    next_cell = text[next_cell_start:next_cell_end]
    if "{{수신자}}" in next_cell:
        return text, False
    paragraph_close = next_cell.rfind("</hp:p>")
    if paragraph_close == -1:
        return text, False
    label_cell_start = text.rfind("<hp:tc", 0, index)
    label_cell = text[label_cell_start : label_cell_end + len("</hp:tc>")]
    match = re.search(r'<hp:run\s+charPrIDRef="([^"]+)"', label_cell)
    char_pr = match.group(1) if match else "12"
    insert_at = next_cell_start + paragraph_close
    receiver_run = f'<hp:run charPrIDRef="{char_pr}"><hp:t>{{{{수신자}}}}</hp:t></hp:run>'
    return text[:insert_at] + receiver_run + text[insert_at:], True


def _remove_empty_marker_paragraphs(text: str) -> str:
    while True:
        index = text.find(EMPTY_PLACEHOLDER_MARKER)
        if index == -1:
            return text
        paragraph_start = text.rfind("<hp:p ", 0, index)
        if paragraph_start == -1:
            text = text[:index] + text[index + len(EMPTY_PLACEHOLDER_MARKER) :]
            continue
        paragraph_end = _find_matching_paragraph_close(text, paragraph_start)
        if paragraph_end == -1:
            text = text[:index] + text[index + len(EMPTY_PLACEHOLDER_MARKER) :]
            continue
        block = text[paragraph_start:paragraph_end]
        if "<hp:tbl" in block or "<hp:subList" in block:
            text = text[:paragraph_start] + block.replace(EMPTY_PLACEHOLDER_MARKER, "") + text[paragraph_end:]
            continue
        values = re.findall(r"<hp:t\b[^>]*>(.*?)</hp:t>", block, flags=re.DOTALL)
        has_meaningful_text = any(_has_meaningful_non_marker_text(value) for value in values)
        if has_meaningful_text:
            text = text[:paragraph_start] + block.replace(EMPTY_PLACEHOLDER_MARKER, "") + text[paragraph_end:]
        else:
            text = text[:paragraph_start] + text[paragraph_end:]


def _cleanup_full_report_dynamic_skeleton_remainders(text: str) -> str:
    """Remove empty built-in full-report scaffolding after dynamic body insertion."""
    text = _remove_empty_full_report_schedule_tables(text)
    text = _remove_standalone_full_report_chapter_markers(text)
    return text


def _remove_empty_full_report_schedule_tables(text: str) -> str:
    output: list[str] = []
    position = 0
    while True:
        table_start = text.find("<hp:tbl", position)
        if table_start == -1:
            output.append(text[position:])
            return "".join(output)
        table_end = _find_matching_element_close(text, table_start, "hp:tbl")
        if table_end == -1:
            output.append(text[position:])
            return "".join(output)

        table = text[table_start:table_end]
        visible = _plain_text_from_hwpx_xml(table)
        normalized = re.sub(r"[\s\u00a0\u200b]+", "", visible)
        for token in ("구분", "일정", "내용", EMPTY_PLACEHOLDER_MARKER):
            normalized = normalized.replace(token, "")
        if "구분" in visible and "일정" in visible and "내용" in visible and not normalized:
            output.append(text[position:table_start])
        else:
            output.append(text[position:table_end])
        position = table_end


def _remove_standalone_full_report_chapter_markers(text: str) -> str:
    roman_markers = {
        "Ⅰ",
        "Ⅱ",
        "Ⅲ",
        "Ⅳ",
        "Ⅴ",
        "Ⅵ",
        "Ⅶ",
        "Ⅷ",
        "Ⅸ",
        "Ⅹ",
        "I",
        "II",
        "III",
        "IV",
        "V",
        "VI",
        "VII",
        "VIII",
        "IX",
        "X",
    }

    output: list[str] = []
    position = 0
    while True:
        paragraph_start = text.find("<hp:p", position)
        if paragraph_start == -1:
            output.append(text[position:])
            return "".join(output)
        paragraph_end = _find_matching_paragraph_close(text, paragraph_start)
        if paragraph_end == -1:
            output.append(text[position:])
            return "".join(output)

        paragraph = text[paragraph_start:paragraph_end]
        visible = _plain_text_from_hwpx_xml(paragraph)
        normalized = re.sub(r"[\s\u00a0\u200b]+", "", visible)
        if normalized in roman_markers:
            output.append(text[position:paragraph_start])
        else:
            output.append(text[position:paragraph_end])
        position = paragraph_end


def _plain_text_from_hwpx_xml(block: str) -> str:
    values = re.findall(r"<hp:t\b[^>]*>(.*?)</hp:t>", block, flags=re.DOTALL)
    text = " ".join(values)
    text = text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    return re.sub(r"\s+", " ", text).strip()


def _has_meaningful_non_marker_text(value: str) -> bool:
    cleaned = value.replace(EMPTY_PLACEHOLDER_MARKER, "")
    cleaned = re.sub(r"[\s\u00a0\u200b]+", "", cleaned)
    if not cleaned:
        return False
    return not re.fullmatch(r"[□◦○◇ㆍ•\-–−—*※·:：.．\[\]()（）]+", cleaned)


def _find_matching_paragraph_close(text: str, paragraph_start: int) -> int:
    depth = 1
    position = paragraph_start + len("<hp:p ")
    while depth > 0:
        next_open = text.find("<hp:p ", position)
        next_close = text.find("</hp:p>", position)
        if next_close == -1:
            return -1
        if next_open != -1 and next_open < next_close:
            depth += 1
            position = next_open + len("<hp:p ")
        else:
            depth -= 1
            position = next_close + len("</hp:p>")
            if depth == 0:
                return position
    return -1


def _find_matching_element_close(text: str, element_start: int, tag_name: str) -> int:
    open_prefix = f"<{tag_name}"
    close_token = f"</{tag_name}>"
    depth = 1
    position = element_start + len(open_prefix)
    while depth > 0:
        next_open = text.find(open_prefix, position)
        next_close = text.find(close_token, position)
        if next_close == -1:
            return -1
        if next_open != -1 and next_open < next_close:
            depth += 1
            position = next_open + len(open_prefix)
        else:
            depth -= 1
            position = next_close + len(close_token)
            if depth == 0:
                return position
    return -1


def _xml_escape(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _build_skeleton_values(payload: PublicDocumentPayload, lines: list[str]) -> dict[str, object]:
    if payload.selected_format == "officialMemo":
        return _build_gongmun_values(payload)
    if payload.selected_format == "fullReport":
        return _build_full_report_values(payload)
    if payload.selected_format == "email":
        return _build_email_values(payload, lines)
    return _build_onepage_values(payload, lines)


def _line_or(items: list[str], index: int, fallback: str = "") -> str:
    return items[index] if index < len(items) else fallback


def _roman_label(number: int) -> str:
    if number <= 0:
        return str(number)
    unicode_labels = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ"]
    if number <= len(unicode_labels):
        return unicode_labels[number - 1]
    numerals = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ]
    value = number
    output: list[str] = []
    for amount, label in numerals:
        while value >= amount:
            output.append(label)
            value -= amount
    return "".join(output)


def _bullet_value(items: list[str], index: int, fallback: str = "") -> str:
    value = _strip_inline_markdown(_line_or(items, index, fallback)).strip()
    for marker in BULLET_MARKERS + SUBBULLET_MARKERS + ASTERISK_MARKERS:
        if value.startswith(marker):
            value = value[len(marker) :].lstrip()
            break
    return f"- {value}" if value else ""


def _direct_marker_value(value: str, prefix: str, markers: list[str]) -> str:
    cleaned = _strip_inline_markdown(value).strip()
    for marker in markers:
        if cleaned.startswith(marker):
            cleaned = cleaned[len(marker) :].lstrip()
            break
    return f"{prefix}{cleaned}" if cleaned else ""


def _line_or_distinct(items: list[str], excluded: str, fallback: str = "") -> str:
    return _line_or_distinct_from(items, [excluded], fallback)


def _line_or_distinct_from(items: list[str], excluded: list[str], fallback: str = "") -> str:
    normalized_excluded = {_normalize_compare_text(item) for item in excluded if item}
    for item in items:
        if _normalize_compare_text(item) not in normalized_excluded:
            return item
    return fallback


def _meaningful_deadline(value: str) -> bool:
    normalized = re.sub(r"\s+", "", str(value or "")).strip()
    if not normalized:
        return False
    return normalized not in {"기한미정", "미정", "없음", "해당없음", "자동", "미지정"}


def _normalize_compare_text(value: str) -> str:
    normalized = _strip_inline_markdown(value)
    normalized = re.sub(r"^[\s\-–−—◦○◇*※]+", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def _numbered_items(items: list[str], *, suffix: str = ")") -> list[str]:
    return [f"{index}{suffix} {item}" for index, item in enumerate(items, start=1) if item]


def _lettered_items(items: list[str]) -> list[str]:
    letters = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하"]
    return [f"{letters[index] if index < len(letters) else index + 1}. {item}" for index, item in enumerate(items) if item]


def _lettered_parenthesized_items(items: list[str]) -> list[str]:
    letters = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하"]
    return [f"{letters[index] if index < len(letters) else index + 1}) {item}" for index, item in enumerate(items) if item]


def _circled_items(items: list[str]) -> list[str]:
    markers = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"]
    return [f"{markers[index] if index < len(markers) else index + 1} {item}" for index, item in enumerate(items) if item]


def _onepage_headings_for_payload(payload: PublicDocumentPayload) -> list[str]:
    headings = [heading for heading in payload.onepage_outline_headings if heading]
    if not headings:
        headings = _infer_onepage_outline_headings(
            title=payload.title,
            purpose=payload.document_purpose,
            context_lines=(
                payload.summary
                + payload.background
                + payload.current_status
                + payload.issues
                + payload.solutions
                + payload.expected_effects
                + payload.actions
                + payload.requested_action
                + payload.evidence
            ),
        )
    headings = _dedupe_non_empty([_clean_outline_heading(heading) for heading in headings])
    headings = headings[:4]
    while len(headings) < 4:
        headings.append(ONEPAGE_DEFAULT_OUTLINE[len(headings)])
    return headings


def _output_subtitle(payload: PublicDocumentPayload) -> str:
    purpose = payload.document_purpose.strip()
    if not purpose or _is_internal_document_purpose(purpose):
        return ""
    return purpose


def _is_internal_document_purpose(value: str) -> bool:
    compacted = re.sub(r"\s+", " ", _strip_inline_markdown(value)).strip()
    return any(pattern.search(compacted) for pattern in INTERNAL_DOCUMENT_PURPOSE_PATTERNS)


def _build_onepage_values(payload: PublicDocumentPayload, lines: list[str]) -> dict[str, object]:
    headings = _onepage_headings_for_payload(payload)
    first_issue = _line_or_distinct_from(payload.issues + payload.current_status, [], "")
    first_solution = _line_or_distinct_from(payload.solutions + payload.actions, [], "")
    first_effect = _line_or_distinct_from(payload.expected_effects + payload.requested_action + payload.actions, [], "")
    first_evidence = _line_or(payload.evidence, 0, payload.related)
    second_status = _line_or_distinct_from(payload.current_status + payload.issues[1:] + payload.background, [first_issue], "")
    second_solution = _line_or_distinct_from(
        payload.solutions[1:] + payload.actions,
        [first_solution],
        "",
    )
    second_evidence = _line_or_distinct_from(
        payload.evidence[1:] + ([payload.related] if payload.related else []),
        [first_evidence],
        "",
    )
    first_background = _line_or(payload.background, 0, "")
    intro_note = _line_or_distinct_from(
        payload.background[1:] + payload.summary[2:],
        [payload.document_purpose, _line_or(payload.summary, 0, ""), _line_or(payload.summary, 1, ""), first_background],
        "",
    )
    third_issue = _line_or_distinct_from(
        payload.issues[1:] + payload.current_status[1:] + payload.background,
        [first_issue, second_status],
        "",
    )
    issue_note = _line_or_distinct_from(
        payload.issues[2:] + payload.current_status[2:] + payload.background,
        [first_issue, second_status, third_issue],
        "",
    )
    third_solution = _line_or_distinct_from(payload.solutions[1:], [first_solution, second_solution], "")
    solution_note = _line_or_distinct_from(
        payload.solutions[2:] + payload.actions,
        [first_solution, second_solution, third_solution],
        "",
    )
    effect_note = _line_or_distinct_from(payload.expected_effects + payload.requested_action, [first_effect, _line_or(payload.requested_action, 0, "")], "")
    follow_up_first = _line_or_distinct_from(payload.actions + payload.requested_action + payload.expected_effects, [first_solution, second_solution, first_effect], "")
    follow_up_second = _line_or_distinct_from(payload.expected_effects + payload.requested_action + payload.actions, [first_effect, follow_up_first], "")
    follow_up_third = _line_or_distinct_from(payload.requested_action + payload.actions + payload.expected_effects, [follow_up_first, follow_up_second], "")
    deadline_detail = f"기한: {payload.deadline}" if _meaningful_deadline(payload.deadline) else ""
    third_evidence = _line_or_distinct_from(
        payload.evidence[2:] + ([payload.related] if payload.related else []),
        [first_evidence, second_evidence],
        "",
    )
    values = {
        "표지_제목": payload.title,
        "text_001": payload.title,
        "text_002": _output_subtitle(payload),
        "text_003": f"<공무원, {_safe_date_label()}>",
        "text_004": f"□ {headings[0]}",
        "text_005": _line_or(payload.summary, 0, payload.document_purpose),
        "text_006": _line_or_distinct_from(payload.summary[1:] + payload.background, [_line_or(payload.summary, 0, payload.document_purpose)], ""),
        "text_007": first_background,
        "text_008": intro_note,
        "text_009": f"□ {headings[1]}",
        "text_010": first_issue,
        "text_011": second_status,
        "text_012": third_issue,
        "text_013": issue_note,
        "text_014": f"□ {headings[2]}",
        "text_015": first_solution,
        "text_016": second_solution,
        "text_017": third_solution,
        "text_018": solution_note,
        "text_019": f"□ {headings[3]}",
        "text_020": first_effect,
        "text_021": _line_or_distinct_from(payload.requested_action + payload.actions + payload.expected_effects, [first_effect], ""),
        "text_022": deadline_detail,
        "text_023": effect_note,
        "장01_제목": "붙임",
        "장02_제목": "근거 및 연결자료",
        "본문_절_001": "□ 출처 및 활용 계획",
        "text_024": first_evidence,
        "text_025": second_evidence,
        "text_026": third_evidence,
        "본문_주석_001": "※ 연결 파일과 대화 이력을 근거로 정리",
        "본문_절_002": "□ 후속 확인",
        "text_027": follow_up_first,
        "text_028": follow_up_second,
        "text_029": follow_up_third,
        "본문_주석_002": "※ 후속 조치와 적용 기준을 확인",
    }
    _apply_dynamic_onepage_core_sections(values, payload.onepage_core_sections)
    _fill_numbered_text_tokens(values, lines, start=30, end=35)
    return _normalize_onepage_skeleton_values(values)


def _apply_dynamic_onepage_core_sections(
    values: dict[str, object],
    core_sections: list[OnePageCoreSection],
) -> None:
    if not core_sections:
        return
    used_sections = core_sections[: len(ONEPAGE_MAIN_SECTION_SLOTS)]
    for section_index, section in enumerate(used_sections):
        heading_token, body_tokens = ONEPAGE_MAIN_SECTION_SLOTS[section_index]
        values[heading_token] = f"□ {_clean_outline_heading(section.heading)}"
        for token in body_tokens:
            values[token] = ""
        top_level_tokens = body_tokens[:2]
        compact_body = [_compact_public_sentence(line) for line in section.body if _compact_public_sentence(line)]
        for token, line in zip(top_level_tokens, compact_body[:2]):
            values[token] = line
        if len(compact_body) > 2 and len(top_level_tokens) >= 2:
            _append_clone_paragraphs(
                values,
                top_level_tokens[1],
                [f"◦ {line}" for line in compact_body[2:]],
            )
    for heading_token, body_tokens in ONEPAGE_MAIN_SECTION_SLOTS[len(used_sections) :]:
        values[heading_token] = ""
        for token in body_tokens:
            values[token] = ""
    _suppress_generic_dynamic_onepage_follow_up(values, core_sections)


def _append_clone_paragraphs(values: dict[str, object], anchor: str, items: list[str]) -> None:
    normalized_items = [item for item in items if str(item).strip()]
    if not normalized_items:
        return
    clone_map = values.setdefault(CLONE_PARAGRAPH_KEY, {})
    if not isinstance(clone_map, dict):
        clone_map = {}
        values[CLONE_PARAGRAPH_KEY] = clone_map
    anchor_items = clone_map.setdefault(anchor, [])
    if isinstance(anchor_items, list):
        anchor_items.extend(normalized_items)


def _suppress_generic_dynamic_onepage_follow_up(
    values: dict[str, object],
    core_sections: list[OnePageCoreSection],
) -> None:
    values["본문_주석_002"] = ""
    core_heading_keys = {
        _normalize_compare_text(_clean_outline_heading(section.heading))
        for section in core_sections
        if section.heading
    }
    follow_up_tokens = ("text_027", "text_028", "text_029")
    meaningful_items: list[str] = []
    for token in follow_up_tokens:
        item = _onepage_review_value(values, token)
        item_key = _normalize_compare_text(_clean_outline_heading(item))
        if (
            not item
            or _looks_like_generic_onepage_follow_up(item)
            or item_key in core_heading_keys
        ):
            continue
        meaningful_items.append(item)

    if not meaningful_items:
        for token in ("본문_절_002", "본문_항목_002", *follow_up_tokens, "본문_주석_002"):
            values[token] = ""
        return

    for token in follow_up_tokens:
        values[token] = ""
    for token, item in zip(follow_up_tokens, meaningful_items[: len(follow_up_tokens)]):
        values[token] = item


def _looks_like_generic_onepage_follow_up(value: str) -> bool:
    normalized = _normalize_compare_text(value)
    generic_phrases = [
        "수집된 업무 맥락을 기준으로 정리합니다",
        "후속 절차를 명확히 하고 업무 이력을 재사용할 수 있습니다",
        "후속 조치와 적용 기준을 확인",
        "Content Base 초안",
    ]
    return any(_normalize_compare_text(phrase) in normalized for phrase in generic_phrases)


def _official_related_clause(payload: PublicDocumentPayload, evidence: list[str]) -> str:
    related = _dedupe_non_empty(evidence[:3] + ([payload.related] if payload.related else []))
    if not related:
        return "관련 업무 추진계획"
    return "; ".join(_compact_public_sentence(item) for item in related if _compact_public_sentence(item))


def _official_request_sentence(payload: PublicDocumentPayload) -> str:
    request = _line_or(payload.requested_action, 0, "")
    if not request:
        request = _line_or(payload.actions, 0, "")
    if not request:
        request = "관련 사항"
    request = _compact_public_sentence(request)
    return f"위 호와 관련하여 {request}을 다음과 같이 알려드리니 기한 내 검토하여 주시기 바랍니다."


def _official_detail_items(payload: PublicDocumentPayload) -> list[str]:
    items = _dedupe_non_empty(
        payload.summary
        + payload.requested_action
        + payload.expected_effects
    )
    return [_compact_public_sentence(item) for item in items if _compact_public_sentence(item)][:14]


def _official_distinct_nested_items(items: list[str], parent_items: list[str], *, limit: int = 3) -> list[str]:
    parent_keys = {_normalize_compare_text(item) for item in parent_items if item}
    nested: list[str] = []
    for item in items:
        cleaned = _compact_public_sentence(item)
        if not cleaned:
            continue
        key = _normalize_compare_text(cleaned)
        if key in parent_keys:
            continue
        nested.append(cleaned)
        if len(nested) >= limit:
            break
    return nested


def _official_attachment_items(evidence: list[str]) -> list[str]:
    if not evidence:
        return ["붙임  관련자료 1부.  끝."]
    items: list[str] = []
    for index, item in enumerate(evidence[:6], start=1):
        prefix = "붙임  " if index == 1 else "      "
        suffix = "   끝." if index == min(len(evidence), 6) else ""
        items.append(f"{prefix}{index}. {_compact_public_sentence(item)} 1부.{suffix}")
    return items


def _build_gongmun_values(payload: PublicDocumentPayload) -> dict[str, object]:
    evidence = _evidence_items(payload)
    dynamic_context = _flatten_report_core_sections(payload.report_core_sections)
    summary_source = _dedupe_non_empty(dynamic_context or payload.summary)
    related_clause = _official_related_clause(payload, evidence)
    request_sentence = _official_request_sentence(payload)
    detail_items = _official_detail_items(payload)
    summary_items = _lettered_items(detail_items)
    issue_items = _numbered_items(_official_distinct_nested_items(payload.issues, detail_items))
    action_items = _lettered_parenthesized_items(_official_distinct_nested_items(payload.actions, detail_items))
    evidence_parent_items = [f"(1) {_compact_public_sentence(_line_or(evidence, 0, '근거자료 확인'))}"]
    evidence_child_items = _circled_items(
        [_compact_public_sentence(item) for item in evidence[1:4] if _compact_public_sentence(item)]
    )
    attachment_items = _official_attachment_items(evidence)
    main_body_items = [f"1. 관련: {related_clause}", f"2. {request_sentence}"]
    return {
        "표지_제목": payload.title,
        "text_001": "로컬 AI 업무 에이전트",
        "text_002": "",
        "text_003": "공무원",
        "text_004": "수신",
        "수신자": payload.recipient,
        "text_005": "",
        "text_006": payload.title,
        "text_007": main_body_items[0],
        "text_008": "2. ",
        "text_009": request_sentence,
        "목차_항목_001": _line_or(summary_items, 0, ""),
        "목차_항목_002": _line_or(summary_items, 1, ""),
        "text_010": _line_or(issue_items, 0, ""),
        "text_011": _line_or(action_items, 0, ""),
        "text_012": _line_or(evidence_parent_items, 0, ""),
        "text_013": _line_or(evidence_child_items, 0, ""),
        "목차_항목_003": _line_or(attachment_items, 0, ""),
        "목차_항목_004": "끝.",
        "text_014": "공무원",
        "text_015": payload.recipient,
        "text_020": "공무원-문서",
        "text_021": _safe_date_label(),
        "text_022": "전화",
        "text_023": "전송",
        "본문": main_body_items,
        "본문_가나": summary_items,
        "본문_1)": issue_items,
        "본문_가)": action_items,
        "본문_(1)": evidence_parent_items,
        "본문_①": evidence_child_items,
        "붙임": attachment_items,
    }


def _build_full_report_values(payload: PublicDocumentPayload) -> dict[str, object]:
    values = {
        "표지_제목": payload.title,
        "문서번호": "-",
        "보존기간": "1년",
        "text_001": f"- 목차 · {payload.document_purpose or '업무 보고'} -",
        "text_002": payload.title,
        "보고일": _safe_date_label(),
        "기관명": "공무원",
        "본부부서명": "로컬 AI 업무 에이전트",
        "참고자료_1": payload.related or _line_or(payload.evidence, 0, "1. 연결자료"),
        "참고자료_2": " / ".join(payload.evidence[:12]) or "2. 업무대화 기록",
        "참고자료_3": _line_or(payload.evidence, 2, "3. 산출 근거"),
    }
    for token in FULL_REPORT_REMOVABLE_TOKENS:
        values[token] = EMPTY_PLACEHOLDER_MARKER
    output_sections = _full_report_output_sections(payload)

    for index in range(1, 53):
        values[f"목차_항목_{index:03d}"] = ""
    values.update(_full_report_toc_values(output_sections))
    values[FULL_REPORT_DYNAMIC_BODY_KEY] = output_sections
    for index in range(1, 13):
        values.setdefault(f"일정표_셀_{index:03d}", "")
    return values


def _full_report_toc_values(sections: list[OnePageCoreSection]) -> dict[str, str]:
    values: dict[str, str] = {}
    used_slots: set[int] = set()
    chapter_slot_set = set(FULL_REPORT_TOC_CHAPTER_SLOTS)
    fallback_chapter_slots = [index for index in range(1, 53, 2)]
    fallback_subsection_slots = [index for index in range(1, 53, 2) if index not in chapter_slot_set]

    def assign(slot_index: int, text: str, page: str) -> None:
        if slot_index < 1 or slot_index > 52 or slot_index in used_slots:
            return
        values[f"목차_항목_{slot_index:03d}"] = text
        if slot_index + 1 <= 52:
            values[f"목차_항목_{slot_index + 1:03d}"] = page
        used_slots.add(slot_index)
        used_slots.add(slot_index + 1)

    for chapter_index, section in enumerate(sections, start=1):
        heading = _clean_full_report_heading(section.heading)
        if not heading:
            continue
        if chapter_index <= len(FULL_REPORT_TOC_CHAPTER_SLOTS):
            chapter_slot = FULL_REPORT_TOC_CHAPTER_SLOTS[chapter_index - 1]
        else:
            chapter_slot = next((slot for slot in fallback_chapter_slots if slot not in used_slots), 0)
        if not chapter_slot:
            break
        page = str(chapter_index * 2 - 1)
        assign(chapter_slot, f"{_roman_label(chapter_index)}. {heading}", page)

        subsection_slots = (
            FULL_REPORT_TOC_SUBSECTION_SLOTS_BY_CHAPTER[chapter_index - 1]
            if chapter_index <= len(FULL_REPORT_TOC_SUBSECTION_SLOTS_BY_CHAPTER)
            else []
        )
        for subsection_index, subsection in enumerate(_full_report_subsection_headings(section.body), start=1):
            if subsection_index <= len(subsection_slots):
                subsection_slot = subsection_slots[subsection_index - 1]
            else:
                subsection_slot = next((slot for slot in fallback_subsection_slots if slot not in used_slots), 0)
            if not subsection_slot:
                break
            assign(subsection_slot, f"  {subsection_index}. {subsection}", page)
    return values


def _full_report_subsection_headings(items: list[str]) -> list[str]:
    headings: list[str] = []
    for item in items:
        heading = _full_report_subsection_heading(item)
        if heading and heading not in headings:
            headings.append(heading)
    return headings


def _full_report_output_sections(payload: PublicDocumentPayload) -> list[OnePageCoreSection]:
    if payload.report_core_sections:
        sections = [
            OnePageCoreSection(
                heading=_clean_full_report_heading(section.heading),
                body=_dedupe_non_empty([_clean_full_report_body_item(item) for item in section.body]),
            )
            for section in payload.report_core_sections
            if _clean_full_report_heading(section.heading)
        ]
        return [section for section in sections if section.body]

    background_items = _dedupe_non_empty(payload.summary + payload.background)
    fallback_specs = [
        ("추진배경 및 목적", background_items),
        ("현황 및 쟁점", _dedupe_non_empty(payload.current_status + payload.issues)),
        ("해결방안", payload.solutions),
        ("기대효과", payload.expected_effects),
        ("조치 및 요청사항", _full_report_request_items(payload)),
        ("근거 및 연결자료", _evidence_items(payload)),
    ]
    return [
        OnePageCoreSection(heading=heading, body=_dedupe_non_empty(items))
        for heading, items in fallback_specs
        if _dedupe_non_empty(items)
    ]


def _full_report_request_items(payload: PublicDocumentPayload) -> list[str]:
    items = _dedupe_non_empty(payload.actions + payload.requested_action)
    if payload.deadline and not any(payload.deadline in item for item in items):
        items.append(f"기한: {payload.deadline}")
    return items


def _full_report_has_action_section(sections: list[OnePageCoreSection]) -> bool:
    for section in sections:
        heading = _normalize_compare_text(section.heading)
        if any(token in heading for token in ["조치", "요청", "향후", "가이드라인", "계획"]):
            return True
    return False


def _email_summary_items(payload: PublicDocumentPayload) -> list[str]:
    dynamic_context = _flatten_report_core_sections(payload.report_core_sections)
    source = dynamic_context or ([payload.document_purpose, *payload.summary] if payload.document_purpose else payload.summary)
    return _dedupe_non_empty([_compact_public_sentence(item) for item in source if _compact_public_sentence(item)])


def _email_request_items(payload: PublicDocumentPayload) -> list[str]:
    items = payload.requested_action or payload.actions or ["검토 의견 회신"]
    return _dedupe_non_empty([_compact_public_sentence(item) for item in items if _compact_public_sentence(item)])


def _email_request_sentence(payload: PublicDocumentPayload) -> str:
    request = _line_or(_email_request_items(payload), 0, "검토 의견 회신")
    if request.endswith(("요청드립니다.", "부탁드립니다.", "바랍니다.")):
        return request
    return f"{request}을 요청드립니다."


def _email_greeting(payload: PublicDocumentPayload) -> str:
    recipient = payload.recipient or "담당자"
    sender = payload.sender or "공무 워크스페이스"
    return f"{recipient}님 안녕하세요. {sender}입니다."


def _build_email_values(payload: PublicDocumentPayload, lines: list[str]) -> dict[str, str]:
    evidence = _evidence_items(payload)
    email_summary_items = _prioritize_email_context(
        _email_summary_items(payload) + payload.background + payload.current_status + payload.issues,
        preferred_tokens=["GraphRAG", "지식폴더"],
    )
    request_items = _email_request_items(payload)
    follow_up_items = _dedupe_non_empty(payload.expected_effects + payload.actions)
    email_evidence_items = _email_context_slots(
        _prioritize_email_context(
            evidence + payload.background + payload.current_status + payload.issues,
            preferred_tokens=["GraphRAG", "지식폴더"],
        )
    )
    values = {
        "문서_제목": payload.title,
        "text_000": "업무 이메일",
        "text_001": f"제목: {payload.title}",
        "text_002": f"수신: {payload.recipient}",
        "text_003": f"발신: {payload.sender}",
        "text_004": f"작성일: {_safe_date_label()}",
        "text_005": "인사 및 요청",
        "text_006": f"- {_email_greeting(payload)}",
        "text_007": f"- {_email_request_sentence(payload)}",
        "text_008": "□ 요청사항",
        "text_009": _bullet_value(request_items, 0, "검토 의견 회신"),
        "text_010": _bullet_value(request_items, 1),
        "text_011": f"- 요청 기한: {payload.deadline}",
        "text_012": "□ 주요 내용 및 근거",
        "text_013": _bullet_value(email_evidence_items, 0, payload.related),
        "text_014": _bullet_value(email_evidence_items, 1),
        "text_015": "마무리",
        "text_016": "- 빠른 확인 부탁드립니다. 감사합니다.",
        "text_017": f"- {payload.sender}",
    }
    _append_clone_paragraphs(
        values,
        "text_007",
        [_bullet_value(email_summary_items, index) for index in range(0, len(email_summary_items))],
    )
    _append_clone_paragraphs(
        values,
        "text_010",
        [_bullet_value(request_items, index) for index in range(2, len(request_items))],
    )
    _append_clone_paragraphs(
        values,
        "text_014",
        [_bullet_value(follow_up_items, index) for index in range(0, min(len(follow_up_items), 4))],
    )
    return values


def _prioritize_email_context(items: list[str], *, preferred_tokens: list[str]) -> list[str]:
    cleaned = _dedupe_non_empty(items)
    if not cleaned:
        return []
    first = cleaned[0]
    preferred = sorted(
        [
            item
            for item in cleaned
            if item != first and any(token and token in item for token in preferred_tokens)
        ],
        key=lambda item: (_email_context_rank(item, preferred_tokens), cleaned.index(item)),
    )
    others = [item for item in cleaned if item != first and item not in preferred]
    return _dedupe_non_empty([first, *preferred, *others])


def _email_context_rank(item: str, preferred_tokens: list[str]) -> int:
    for index, token in enumerate(preferred_tokens):
        if token and token in item:
            return index
    return len(preferred_tokens)


def _email_context_slots(items: list[str]) -> list[str]:
    if len(items) <= 2:
        return items
    return [items[0], " / ".join(items[1:3])]


def _flatten_report_core_sections(sections: list[OnePageCoreSection]) -> list[str]:
    flattened: list[str] = []
    for section in sections:
        heading = _clean_outline_heading(section.heading)
        body = _dedupe_non_empty(section.body)
        if not body:
            continue
        flattened.append(f"{heading}: {body[0]}" if heading else body[0])
        flattened.extend(body[1:])
    return _dedupe_non_empty(flattened)


def _fill_numbered_text_tokens(values: dict[str, str], lines: list[str], *, start: int, end: int) -> None:
    existing_keys = {
        _onepage_repeat_key(value)
        for value in values.values()
        if str(value or "").strip()
    }
    compact_lines: list[str] = []
    for line in lines:
        if not line.strip():
            continue
        key = _onepage_repeat_key(line)
        if key and key in existing_keys:
            continue
        compact_lines.append(line)
        if key:
            existing_keys.add(key)
    for number in range(start, end + 1):
        values.setdefault(f"text_{number:03d}", _line_or(compact_lines, number - start, ""))


def _safe_date_label() -> str:
    now = datetime.now()
    return f"{now.year}. {now.month}. {now.day}."


def _parse_markdown_sections(markdown_text: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw_line in markdown_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("# "):
            sections["_title"] = [line[2:].strip()]
            continue
        if line.startswith("## "):
            current = line[3:].strip()
            sections.setdefault(current, [])
            continue
        value = re.sub(r"^[-*+]\s+", "", line).strip()
        value = _strip_inline_markdown(value)
        if current:
            sections.setdefault(current, []).append(value)
    return sections


def _first_non_empty(
    sections: dict[str, list[str]],
    keys: list[str],
    fallback: list[str] | None = None,
) -> list[str]:
    for key in keys:
        values = _usable_section_values(sections, key)
        if values:
            return values
    return fallback or ["수집된 업무 맥락을 기준으로 정리합니다."]


def _usable_section_values(sections: dict[str, list[str]], key: str) -> list[str]:
    return [
        value.strip()
        for value in sections.get(key, [])
        if value.strip()
        and not _looks_like_placeholder_value(value)
        and not _looks_like_label_only(value)
        and not _looks_like_document_generation_instruction(value)
    ]


def _usable_section_values_any(sections: dict[str, list[str]], keys: list[str]) -> list[str]:
    values: list[str] = []
    for key in keys:
        values.extend(_usable_section_values(sections, key))
    return _dedupe_non_empty(values)


def _looks_like_placeholder_value(value: str) -> bool:
    normalized = re.sub(r"\s+", " ", value).strip()
    if normalized in {"사용자:", "어시스턴트:", "-", "—"}:
        return True
    placeholder_phrases = [
        "내용을 여기에 정리합니다",
        "아직 연결된 파일이 없습니다",
        "참고자료가 아직 연결되지 않았습니다",
        "아직 저장된 대화가 없습니다",
        "연결 일정: 없음",
        "선택 안 함",
        "미지정",
    ]
    return any(phrase in normalized for phrase in placeholder_phrases)


def _looks_like_label_only(value: str) -> bool:
    normalized = _strip_inline_markdown(value)
    normalized = re.sub(r"^[◦*]\s*", "", normalized).strip()
    if not normalized.endswith(":"):
        return False
    body = normalized[:-1].strip()
    return 0 < len(body) <= 32 and not re.search(r"[.!?。]$", body)


def _looks_like_document_generation_instruction(value: str) -> bool:
    normalized = value.strip()
    is_user_command_line = False
    if normalized.startswith("사용자:"):
        is_user_command_line = True
        normalized = normalized.split(":", 1)[1].strip()
    elif normalized.lower().startswith("user:"):
        is_user_command_line = True
        normalized = normalized.split(":", 1)[1].strip()
    if not is_user_command_line:
        if any(token in normalized for token in ["요청이 함께 남아", "세션에는", "검색 결과"]):
            return False
        if "\\" in normalized or "/" in normalized:
            return False
        if re.search(r"\.(txt|md|pdf|docx?|hwp|hwpx|xlsx?|pptx?)\s*:", normalized, flags=re.IGNORECASE):
            return False
        if len(normalized) > 120:
            return False
    lowered = normalized.lower()
    if not is_user_command_line:
        internal_patterns = [
            r"(문서작성|content base|public-doc-to-hwpx|hwpx skeleton|서식\s*슬롯).*(작성\s*방식|서식\s*매핑|채움|생성\s*단계|내부)",
            r"(업무대화\s*세션\s*기반|세션\s*없이\s*바로)\s*(?:1페이지\s*보고서|시행문|풀버전\s*보고서|이메일|보고서|자동\s*문서작성)\s*작성",
            r"(?:보고서|공문|시행문|이메일|메일|hwpx)\s*(?:로|파일로)?\s*(?:작성해|작성하|생성해|만들어|뽑아|출력해)",
        ]
        return any(re.search(pattern, lowered, flags=re.IGNORECASE) for pattern in internal_patterns)
    has_document_marker = any(
        token in lowered
        for token in [
            "문서작성",
            "hwpx",
            "hwp",
            "document",
            "report",
        ]
    ) or any(token in normalized for token in ["보고서", "공문", "시행문", "이메일", "메일"])
    has_action_marker = any(
        token in lowered
        for token in [
            "작성",
            "생성",
            "만들",
            "정리",
            "파일로",
            "뽑아",
            "create",
            "write",
            "generate",
            "make",
            "export",
        ]
    )
    return has_document_marker and has_action_marker


def _strip_dialog_role(value: str) -> str:
    normalized = value.strip()
    for prefix in ["사용자:", "어시스턴트:", "User:", "Assistant:", "user:", "assistant:"]:
        if normalized.startswith(prefix):
            return normalized[len(prefix) :].strip()
    return normalized


def _source_names_from_text(value: str) -> list[str]:
    names: list[str] = []
    for candidate in [
        "The Art of Prompt Engineering_Beginner",
        "claude-master-guide",
        "AI 전략회의",
        "목표 검증 회의",
    ]:
        if candidate in value:
            names.append(candidate)
    return names


def _session_brief_lines(conversation_lines: list[str]) -> list[str]:
    has_schedule_create = False
    has_knowledge_search = False
    has_help_guide = False
    has_schedule_list = False
    has_summary = False
    source_names: list[str] = []
    for line in conversation_lines:
        text = _strip_dialog_role(line)
        lowered = text.lower()
        source_names.extend(_source_names_from_text(text))
        if "일정을 등록했습니다" in text or ("일정" in text and "등록" in text):
            has_schedule_create = True
        if "graphrag" in lowered or "지식폴더" in text or "검색 결과" in text or "프롬프트" in text:
            has_knowledge_search = True
        if "파일찾기" in text or "기능 사용법" in text or "사용법" in text:
            has_help_guide = True
        if "등록된 일정입니다" in text or "일정 목록" in text or "이번달" in text or "이번 달" in text:
            has_schedule_list = True
        if "세션 내용을 요약" in text or "대화 세션 내용을 요약" in text:
            has_summary = True
    source_label = ", ".join(_dedupe_non_empty(source_names[:4]))
    lines: list[str] = []
    if has_schedule_create:
        lines.append("일정 등록 요청을 처리하고 회의 또는 업무협의 시간을 업무 이력으로 남겼습니다.")
    if has_knowledge_search:
        if source_label:
            lines.append(f"지식폴더 GraphRAG 검색으로 프롬프트 관련 근거자료({source_label})를 확인했습니다.")
        else:
            lines.append("지식폴더 GraphRAG 검색으로 프롬프트 관련 근거자료를 확인했습니다.")
    if has_help_guide:
        lines.append("업무대화와 파일찾기 사용법을 안내하여 세션-파일-문서작성 연계 흐름을 확인했습니다.")
    if has_schedule_list:
        lines.append("이번 달 등록 일정을 조회해 기존 일정 목록과 중복 가능성을 확인했습니다.")
    if has_summary:
        lines.append("세션 요약 요청을 통해 일정, 검색, 기능 안내, 일정 조회 이력을 재정리했습니다.")
    if not lines:
        lines = [_strip_dialog_role(line) for line in conversation_lines[:4]]
    return _dedupe_non_empty(lines)


def _session_issue_lines(conversation_lines: list[str]) -> list[str]:
    issues: list[str] = []
    for line in conversation_lines:
        text = _strip_dialog_role(line)
        lowered = text.lower()
        if "403" in text or "upgrade_required" in lowered or "api access" in lowered:
            issues.append("Featherless API 권한 오류(403)가 발생해 구독 플랜의 API 접근 권한 확인이 필요합니다.")
        if "중복" in text and "일정" in text:
            issues.append("일정 목록에 중복 일정이 있을 수 있어 정리 기준 확인이 필요합니다.")
        if "알 수 없습니다" in text and ("누구" in text or "김이룸" in text):
            issues.append("인물 식별 요청은 세션 또는 지식폴더 근거가 부족하면 답변이 제한됩니다.")
    return _dedupe_non_empty(issues)


def _dedupe_non_empty(items: list[str]) -> list[str]:
    seen: set[str] = set()
    results: list[str] = []
    for item in items:
        value = item.strip()
        if (
            not value
            or value in seen
            or _looks_like_placeholder_value(value)
            or _looks_like_document_generation_instruction(value)
            or _looks_like_internal_authoring_metadata(value)
        ):
            continue
        seen.add(value)
        results.append(value)
    return results


def _apply_writing_principles(items: list[str]) -> list[str]:
    return [_compact_public_sentence(item) for item in items if _compact_public_sentence(item)]


def _compact_public_sentence(value: str) -> str:
    compacted = _strip_inline_markdown(value)
    _, compacted = _split_leading_public_label(compacted)
    replacements = [
        ("와 관련된", " 관련"),
        ("과 관련된", " 관련"),
        ("에 대한", " 관련"),
        ("하는 것이 필요합니다", "가 필요합니다"),
        ("이 필요한 것으로 판단됩니다", "이 필요하다고 판단됩니다"),
        ("가 필요한 것으로 판단됩니다", "가 필요하다고 판단됩니다"),
        ("할 것으로 보입니다", "할 전망입니다"),
        ("것으로 보입니다", "전망입니다"),
        ("것으로 판단됩니다", "판단됩니다"),
        ("할 예정입니다", "할 예정"),
    ]
    for before, after in replacements:
        compacted = compacted.replace(before, after)
    compacted = re.sub(r"많은\s+([가-힣A-Za-z0-9]+)들이", r"\1이", compacted)
    compacted = re.sub(r"여러\s+([가-힣A-Za-z0-9]+)들이", r"\1이", compacted)
    compacted = compacted.replace("사항들이", "사항이")
    compacted = compacted.replace("자료들이", "자료가")
    compacted = re.sub(r"\s+", " ", compacted)
    return compacted.strip()


def _strip_inline_markdown(value: str) -> str:
    compacted = value.strip()
    compacted = re.sub(r"\\([_*\[\](){}#+.!>|~-])", r"\1", compacted)
    compacted = re.sub(r"^#{1,6}\s+", "", compacted).strip()
    compacted = re.sub(r"^[-*+]\s+", "", compacted).strip()
    compacted = re.sub(r"^\d+[\.)]\s+", "", compacted).strip()
    compacted = re.sub(r"\*\*([^*]+)\*\*", r"\1", compacted)
    compacted = re.sub(r"__([^_]+)__", r"\1", compacted)
    compacted = re.sub(r"`([^`]+)`", r"\1", compacted)
    compacted = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", compacted)
    return _strip_dialog_role(compacted).strip()


def _normalize_onepage_skeleton_values(values: dict[str, str]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for token, value in values.items():
        normalized[token] = _normalize_onepage_marker(token, value)
    normalized = _suppress_onepage_repeated_child_notes(normalized)
    normalized = _suppress_onepage_repeated_content(normalized)
    return _suppress_empty_onepage_content_slots(normalized)


def _normalize_onepage_marker(token: str, value: str) -> str:
    if not isinstance(value, str) or not value:
        return value
    if EMPTY_PLACEHOLDER_MARKER in value:
        return value
    if token in ONEPAGE_MARKER_PREFIX:
        prefix = ONEPAGE_MARKER_PREFIX[token]
        prefix_char = prefix.strip()
        stripped = value.lstrip()
        if stripped.startswith(prefix_char):
            return value
        markers = SUBBULLET_MARKERS if prefix_char == "◦" else ASTERISK_MARKERS
        for marker in markers:
            if stripped.startswith(marker):
                stripped = stripped[len(marker) :].lstrip()
                break
        return prefix + stripped
    if token in ONEPAGE_TRIM_BULLET:
        stripped = value.lstrip()
        for marker in BULLET_MARKERS:
            if stripped.startswith(marker):
                return stripped[len(marker) :].lstrip()
    return value


def _suppress_onepage_repeated_child_notes(values: dict[str, str]) -> dict[str, str]:
    result = dict(values)
    for child_token, parent_tokens in ONEPAGE_CHILD_NOTE_SLOTS.items():
        child_key = _onepage_repeat_key(result.get(child_token, ""))
        if not child_key:
            continue
        parent_keys = {
            _onepage_repeat_key(result.get(parent_token, ""))
            for parent_token in parent_tokens
        }
        parent_keys.discard("")
        if child_key in parent_keys:
            result[child_token] = EMPTY_PLACEHOLDER_MARKER
    return result


def _suppress_onepage_repeated_content(values: dict[str, str]) -> dict[str, str]:
    result = dict(values)
    seen: set[str] = set()
    for token in ONEPAGE_CONTENT_SLOTS:
        key = _onepage_repeat_key(result.get(token, ""))
        if not key:
            continue
        if key in seen:
            result[token] = EMPTY_PLACEHOLDER_MARKER
            continue
        seen.add(key)
    return result


def _suppress_empty_onepage_content_slots(values: dict[str, str]) -> dict[str, str]:
    result = dict(values)
    for token in ONEPAGE_CONTENT_SLOTS:
        value = str(result.get(token, ""))
        if EMPTY_PLACEHOLDER_MARKER in value:
            continue
        if not value.strip():
            result[token] = EMPTY_PLACEHOLDER_MARKER
    return result


def _onepage_repeat_key(value: object) -> str:
    if EMPTY_PLACEHOLDER_MARKER in str(value or ""):
        return ""
    normalized = _normalize_compare_text(str(value or ""))
    normalized = re.sub(r"^(요약|핵심|내용|조치|후속\s*조치|효과|기대효과|요청|요청사항|요청\s*사항)\s*[:：]\s*", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip().casefold()


def _public_document_quality_checks() -> list[str]:
    return [
        "두괄식: 결론과 요청사항을 앞부분에 배치했습니다.",
        "개조식: 문단을 짧은 항목으로 나누어 빠르게 읽히도록 정리했습니다.",
        "한 문장 한 핵심: 긴 서술 대신 판단 단위를 분리했습니다.",
        "적/의/것/들: 불필요한 표현을 줄여 공공문서 문체로 압축했습니다.",
    ]


def _looks_like_internal_authoring_metadata(value: str) -> bool:
    compacted = _strip_inline_markdown(value)
    normalized = re.sub(r"\s+", " ", compacted).strip()
    normalized_lower = normalized.lower()
    if not normalized:
        return True
    exact_markers = {
        "WorkSessionBrief".lower(),
        "DocumentPlan".lower(),
        "작성 품질 점검".lower(),
        "문서 작성 기준".lower(),
        "작성 슬롯".lower(),
    }
    if normalized_lower in exact_markers:
        return True
    metadata_prefixes = (
        "문서 목적:",
        "출력 유형:",
        "사용자 양식:",
        "작성 방식:",
        "수신/대상:",
        "예상 분량:",
        "긴급도:",
        "추적성 필요:",
        "공식 서식 필요:",
        "요청 조치:",
        "기한:",
        "보안 수준:",
    )
    if normalized.startswith(metadata_prefixes):
        return True
    internal_phrases = [
        "LLM WorkSessionBrief -> DocumentPlan",
        "public-doc-to-hwpx 서식 매핑",
        "HWPX skeleton 채움",
        "작성목적/서식 결정",
        "서식 슬롯",
        "원칙 준수",
        "형식 적합성",
        "누락/불확실",
    ]
    return any(phrase.lower() in normalized_lower for phrase in internal_phrases)


def _section(title: str, items: list[str]) -> list[str]:
    lines = [title]
    for item in items:
        lines.append(f"- {item}")
    lines.append("")
    return lines


def _metadata_lines(payload: PublicDocumentPayload) -> list[str]:
    return [
        f"- 보안 수준: {payload.security_level}",
        f"- 예상 분량: {payload.expected_length}",
        f"- 긴급도: {payload.urgency_level}",
        f"- 추적성 필요: {payload.needs_traceability}",
        f"- 공식 서식 필요: {payload.requires_official_form}",
        "",
    ]


def _evidence_items(payload: PublicDocumentPayload) -> list[str]:
    if payload.evidence:
        return payload.evidence
    if payload.related:
        return [payload.related]
    return ["Content Base 초안을 근거로 작성했습니다."]


def _render_onepage(payload: PublicDocumentPayload) -> list[str]:
    if payload.onepage_core_sections:
        lines = [payload.title]
        subtitle = _output_subtitle(payload)
        if subtitle:
            lines.append(subtitle)
        lines.append(f"<공무원, {_safe_date_label()}>")
        lines.append("")
        for section in payload.onepage_core_sections[: len(ONEPAGE_MAIN_SECTION_SLOTS)]:
            heading = _clean_outline_heading(section.heading)
            if heading:
                lines.append(f"□ {heading}")
            for item in section.body:
                cleaned = _compact_public_sentence(item)
                if cleaned:
                    lines.append(f"◦ {cleaned}")
            lines.append("")
        evidence = _evidence_items(payload)
        if evidence:
            lines.append("□ 출처 및 활용 계획")
            for item in evidence:
                cleaned = _compact_public_sentence(item)
                if cleaned:
                    lines.append(f"◦ {cleaned}")
            lines.append("* 연결 파일과 대화 이력을 근거로 정리")
            lines.append("")
        while lines and not lines[-1].strip():
            lines.pop()
        return lines

    values = _build_onepage_values(payload, [])
    lines = [_onepage_review_value(values, "text_001") or payload.title]
    subtitle = _onepage_review_value(values, "text_002")
    if subtitle:
        lines.append(subtitle)
    date_line = _onepage_review_value(values, "text_003")
    if date_line:
        lines.append(date_line)
    lines.append("")

    _append_onepage_review_section(lines, values, "text_004", ["text_005", "text_006", "text_007", "text_008"])
    _append_onepage_review_section(lines, values, "text_009", ["text_010", "text_011", "text_012", "text_013"])
    _append_onepage_review_section(lines, values, "text_014", ["text_015", "text_016", "text_017", "text_018"])
    _append_onepage_review_section(lines, values, "text_019", ["text_020", "text_021", "text_022", "text_023"])
    _append_onepage_review_section(lines, values, "본문_항목_001", ["text_024", "text_025", "text_026", "본문_주석_001"])
    _append_onepage_review_section(lines, values, "본문_항목_002", ["text_027", "text_028", "text_029", "본문_주석_002"])
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def _append_onepage_review_section(
    lines: list[str],
    values: dict[str, object],
    heading_token: str,
    body_tokens: list[str],
) -> None:
    heading = _onepage_review_value(values, heading_token)
    body = [_onepage_review_line(values, token) for token in body_tokens]
    body = [line for line in body if line]
    if not heading and not body:
        return
    if heading:
        lines.append(heading)
    lines.extend(body)
    lines.append("")


def _onepage_review_value(values: dict[str, object], token: str) -> str:
    value = str(values.get(token) or "").replace(EMPTY_PLACEHOLDER_MARKER, "").strip()
    return value


def _onepage_review_line(values: dict[str, object], token: str) -> str:
    value = _onepage_review_value(values, token)
    if not value:
        return ""
    if token in ONEPAGE_TRIM_BULLET and not any(
        value.lstrip().startswith(marker) for marker in BULLET_MARKERS
    ):
        return f"- {value}"
    return value


def _render_official_memo(payload: PublicDocumentPayload) -> list[str]:
    lines = [payload.title, "", f"수신: {payload.recipient}", f"발신: {payload.sender}", ""]
    lines += _metadata_lines(payload)
    evidence = _evidence_items(payload)
    lines.append(f"1. 관련: {_official_related_clause(payload, evidence)}")
    lines.append(f"2. {_official_request_sentence(payload)}")
    lines.append("")
    for item in _lettered_items(_official_detail_items(payload)):
        lines.append(item)
    lines.append("")
    for item in _official_attachment_items(evidence):
        lines.append(item)
    lines.append("")
    return lines


def _render_full_report(payload: PublicDocumentPayload) -> list[str]:
    lines = [payload.title, ""]
    lines += _metadata_lines(payload)
    output_sections = _full_report_output_sections(payload)
    if output_sections:
        lines.append("목차")
        for index, section in enumerate(output_sections, start=1):
            lines.append(f"{_roman_label(index)}. {_clean_full_report_heading(section.heading)}")
        lines.append("")
        for index, section in enumerate(output_sections, start=1):
            lines += _full_report_section_lines(
                f"{_roman_label(index)}. {_clean_full_report_heading(section.heading)}",
                section.body,
            )
        return lines

    lines.append("목차")
    lines.append("I. 추진배경 및 목적")
    lines.append("II. 현황")
    lines.append("III. 쟁점")
    lines.append("IV. 해결방안")
    lines.append("V. 기대효과")
    lines.append("VI. 조치사항")
    lines.append("VII. 요청사항")
    lines.append("VIII. 근거 및 연결자료")
    lines.append("")
    lines += _section("I. 추진배경 및 목적", _dedupe_non_empty(payload.summary + payload.background))
    lines += _section("II. 현황", payload.current_status)
    lines += _section("III. 쟁점", payload.issues)
    lines += _section("IV. 해결방안", payload.solutions)
    lines += _section("V. 기대효과", payload.expected_effects)
    lines += _section("VI. 조치사항", payload.actions)
    lines += _section("VII. 요청사항", payload.requested_action)
    lines += _section("VIII. 근거 및 연결자료", _evidence_items(payload))
    return lines


def _full_report_section_lines(title: str, items: list[str]) -> list[str]:
    lines = [title]
    for item in items:
        visible = _full_report_visible_body_item(item)
        if not visible:
            continue
        if visible.startswith("□ "):
            lines.append(visible)
        else:
            lines.append(f"- {visible}")
    lines.append("")
    return lines


def _render_email(payload: PublicDocumentPayload) -> list[str]:
    lines = [f"제목: {payload.title}", "", f"수신: {payload.recipient}", f"발신: {payload.sender}", ""]
    lines.append(_email_greeting(payload))
    lines.append("")
    lines.append(_email_request_sentence(payload))
    lines.append("")

    summary_items = _email_summary_items(payload)
    if summary_items:
        lines.append("□ 주요 내용")
        for item in summary_items[:8]:
            lines.append(f"- {item}")
        lines.append("")

    lines.append("□ 요청사항")
    for item in _email_request_items(payload):
        lines.append(f"- {item}")
    lines.append(f"- 요청 기한: {payload.deadline}")
    lines.append("")

    lines.append("□ 근거 및 연결자료")
    for item in _evidence_items(payload):
        lines.append(f"- {item}")
    lines.append("")

    lines.append("빠른 확인 부탁드립니다. 감사합니다.")
    lines.append("")
    lines.append(payload.sender)
    lines.append("")
    return lines
