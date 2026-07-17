from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import json
import re
import tempfile
from typing import Any, Literal, cast
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

# 미리보기(render_preview)와 최종 HWPX가 공유하는 위계 표기
ROMAN_NUMERALS = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ"]
GANADA = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하"]

# 1p 요약 글상자: 최종 HWPX 에서는 1×1 표(테두리 글상자)로, 평문 미리보기에서는
# 상/하 룰 라인으로 표현한다. '요약' 제목 없이 문서 요지를 한눈에 보이게 하는 장치다.
SUMMARY_BOX_RULE = "─" * 30


# ---------------------------------------------------------------------------
# 구조 마커: authoring /build 가 content-base 마크다운에 구조 JSON을 심어 두면
# finalize(write_public_hwpx_document)가 이를 그대로 문단화한다.
# 미리보기 = 최종 HWPX (WYSIWYG) 를 보장하는 단일 중간 표현이다.
# ---------------------------------------------------------------------------

STRUCTURE_MARKER_PREFIX = "<!--gongmu-doc-structure:"
_STRUCTURE_MARKER_RE = re.compile(r"^<!--gongmu-doc-structure:(\{.*\})-->[ \t]*$", re.MULTILINE)


def embed_structure_marker(format_key: str, structure: dict[str, Any]) -> str:
    payload = json.dumps({"format": format_key, "structure": structure}, ensure_ascii=False)
    return f"{STRUCTURE_MARKER_PREFIX}{payload}-->"


def extract_structure_marker(markdown_text: str) -> tuple[str, dict[str, Any]] | None:
    match = _STRUCTURE_MARKER_RE.search(markdown_text or "")
    if not match:
        return None
    try:
        parsed = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    format_key = parsed.get("format") if isinstance(parsed, dict) else None
    structure = parsed.get("structure") if isinstance(parsed, dict) else None
    if format_key in BUILTIN_FORMAT_DIRS and isinstance(structure, dict):
        return str(format_key), structure
    return None


def strip_structure_marker(markdown_text: str) -> str:
    return _STRUCTURE_MARKER_RE.sub("", markdown_text or "")


# F-13a: summary 다문장이 한 ◦줄로 뭉치는 '한 문장 한 줄' 위반 방지 —
# 마침표(.!?)+공백을 문장 경계로 보되, 숫자 사이 마침표(소수점·"2026. 7." 날짜)는 제외한다.
_SENTENCE_BOUNDARY_PATTERN = re.compile(r"(?<=[.!?])\s+")


def split_summary_sentences(text: str) -> list[str]:
    """요약 문자열을 문장 단위로 나눈다. 빈 문자열이면 빈 목록을 돌려준다.

    클라이언트 renderLocalAuthoringPreview(DocumentsScreen.tsx)의 splitSummarySentences 와
    동일 규칙 — 서버 미리보기·최종 HWPX·클라이언트 미리보기가 같은 줄 구성을 가져야 한다.
    """
    raw = str(text or "").strip()
    if not raw:
        return []
    parts: list[str] = []
    start = 0
    for match in _SENTENCE_BOUNDARY_PATTERN.finditer(raw):
        punct = raw[match.start() - 1] if match.start() >= 1 else ""
        before = raw[match.start() - 2] if match.start() >= 2 else ""
        if punct == "." and before.isdigit():
            continue  # 소수점·"2026. 7." 날짜 등 숫자 뒤 마침표는 문장 경계가 아니다
        segment = raw[start : match.start()].strip()
        if segment:
            parts.append(segment)
        start = match.end()
    tail = raw[start:].strip()
    if tail:
        parts.append(tail)
    return parts or [raw]


def structure_to_lines(format_key: str, structure: dict[str, Any]) -> list[str]:
    """구조 JSON → 문단 줄 목록. render_preview(텍스트 미리보기)와 최종 HWPX가
    같은 목록을 소비한다 — 두 산출물의 문단 구성이 1:1 로 일치해야 한다."""
    if format_key == "onePageReport":
        lines = [str(structure.get("title", ""))]
        if structure.get("subtitle"):
            lines.append(f"- {structure['subtitle']} -")
        # 요약은 '요약' 제목 없이 글상자(표)로 감싼다 — 평문 미리보기는 상/하 룰 라인으로 표현.
        # F-13a: 다문장 요약은 문장마다 별도 ◦ 줄로 렌더한다. 빈 요약이면 상자 자체를 만들지 않는다.
        summary_sentences = split_summary_sentences(str(structure.get("summary", "")))
        if summary_sentences:
            lines += ["", SUMMARY_BOX_RULE]
            lines += [f" ◦ {sentence}" for sentence in summary_sentences]
            lines.append(SUMMARY_BOX_RULE)
        for section in structure.get("sections", []) or []:
            lines += ["", f"□ {section.get('heading', '')}"]
            for item in section.get("items", []) or []:
                lines.append(f" ◦ {item}")
            if section.get("detail"):
                lines.append(f"   - {section['detail']}")
            if section.get("note"):
                lines.append(f" ※ {section['note']}")
        return lines

    if format_key == "fullReport":
        lines = [str(structure.get("title", "")), "", "□ 요약"]
        for summary_line in structure.get("summary", []) or []:
            # F-13a: 항목 안 다문장도 문장마다 별도 ◦ 줄로 렌더한다
            for sentence in split_summary_sentences(str(summary_line)) or [str(summary_line)]:
                lines.append(f" ◦ {sentence}")
        for index, chapter in enumerate(structure.get("chapters", []) or []):
            numeral = ROMAN_NUMERALS[min(index, len(ROMAN_NUMERALS) - 1)]
            lines += ["", f"{numeral}. {chapter.get('heading', '')}"]
            for section in chapter.get("sections", []) or []:
                lines.append(f"□ {section.get('heading', '')}")
                for item in section.get("items", []) or []:
                    lines.append(f" ◦ {item}")
        schedule = structure.get("schedule") or {}
        rows = schedule.get("rows") if isinstance(schedule, dict) else None
        if rows:
            lines += ["", "※ 추진 일정"]
            for row in rows:
                note = row.get("비고") or ""
                suffix = f" ({note})" if note else ""
                lines.append(f" ◦ {row.get('항목', '')}: {row.get('일정', '')}{suffix}")
        return lines

    if format_key == "officialMemo":
        lines = [
            f"수신: {structure.get('receiver', '')}",
            f"제목: {structure.get('title', '')}",
            "",
            f"1. {structure.get('opening', '')}",
            "2. 세부 사항",
        ]
        for index, item in enumerate(structure.get("items", []) or []):
            marker = GANADA[min(index, len(GANADA) - 1)]
            lines.append(f"  {marker}. {item.get('text', '')}")
            for sub_index, sub in enumerate(item.get("subs") or [], start=1):
                lines.append(f"    {sub_index}) {sub}")
        attachments = structure.get("attachments") or []
        for attachment in attachments:
            lines.append(f"붙임: {attachment}")
        lines.append("끝.")
        if structure.get("sender"):
            lines += ["", str(structure["sender"])]
        return lines

    if format_key == "email":
        lines = [f"제목: {structure.get('subject', '')}"]
        if structure.get("greeting"):
            lines += ["", str(structure["greeting"])]
        for paragraph in structure.get("body_paragraphs", []) or []:
            lines += ["", str(paragraph)]
        if structure.get("closing"):
            lines += ["", str(structure["closing"])]
        if structure.get("signature"):
            lines += ["", str(structure["signature"])]
        return lines

    raise ValueError(f"지원하지 않는 문서 양식입니다: {format_key}")


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
    related: str
    recipient: str
    sender: str
    deadline: str
    security_level: str
    expected_length: str
    urgency_level: str
    needs_traceability: str
    requires_official_form: str


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
    session_lines = sections.get("업무대화 세션", [])
    conversation_lines = _usable_section_values(sections, "업무대화 기록")
    linked_file_lines = _usable_section_values(sections, "세션 연결 파일")
    direct_file_lines = _usable_section_values(sections, "직접 연결 파일")
    instruction_lines = _usable_section_values(sections, "세션 기반 작성 개요") + _usable_section_values(sections, "바로 작성 개요")
    reference_lines = _usable_section_values(sections, "참고자료") + linked_file_lines + direct_file_lines
    core_context_lines = _dedupe_non_empty(linked_file_lines + direct_file_lines + instruction_lines + conversation_lines)
    evidence_lines = _dedupe_non_empty(
        linked_file_lines
        + direct_file_lines
        + instruction_lines
        + _usable_section_values(sections, "참고자료")
        + session_lines
        + conversation_lines
    )
    requested_action_lines = [requested_action] if requested_action.strip() else _first_non_empty(
        sections,
        ["후속 조치", "결정 사항", "권고안", "요청사항", "작성 슬롯"],
    )
    solutions = _first_non_empty(
        sections,
        ["후속 조치", "결정 사항", "권고안", "해결방안", "조치사항"],
        fallback=core_context_lines[:3] if core_context_lines else None,
    )
    pick = lambda keys, fallback=None: _apply_writing_principles(_first_non_empty(sections, keys, fallback=fallback))

    return PublicDocumentPayload(
        title=title or sections.get("_title", ["공무 업무 문서"])[0],
        document_purpose=purpose,
        selected_format=selected_format,
        summary=_apply_writing_principles(
            core_context_lines[:3]
            or _first_non_empty(
                sections,
                ["핵심 내용", "회의 목적", "검토 배경", "업무대화 세션", "개요", "바로 작성 개요", "세션 기반 작성 개요"],
            )
        ),
        background=_apply_writing_principles(
            (conversation_lines + session_lines)[:3]
            or _first_non_empty(sections, ["검토 배경", "회의 목적", "개요", "바로 작성 개요", "세션 기반 작성 개요"])
        ),
        current_status=_apply_writing_principles(
            (linked_file_lines + direct_file_lines + conversation_lines)[:4]
            or _first_non_empty(sections, ["핵심 내용", "논의 안건"])
        ),
        issues=_apply_writing_principles(
            (linked_file_lines + direct_file_lines + conversation_lines)[:4]
            or _first_non_empty(sections, ["핵심 내용", "논의 안건", "검토 의견", "문제점", "바로 작성 개요", "세션 기반 작성 개요"])
        ),
        solutions=_apply_writing_principles(solutions),
        expected_effects=pick(
            ["기대효과"],
            fallback=["후속 절차를 명확히 하고 업무 이력을 재사용할 수 있습니다."],
        ),
        actions=pick(["후속 조치", "결정 사항", "권고안", "조치사항"], fallback=core_context_lines[:2] if core_context_lines else None),
        requested_action=_apply_writing_principles(requested_action_lines),
        evidence=_apply_writing_principles(evidence_lines),
        related="; ".join(reference_lines) if reference_lines else "작성 내용을 근거로 정리했습니다.",
        recipient=audience_type or "관련 부서",
        sender="공무 워크스페이스",
        deadline=_normalize_deadline(deadline),
        security_level=security_level or "일반",
        expected_length=expected_length or "미지정",
        urgency_level=urgency_level or "보통",
        needs_traceability=needs_traceability or "미지정",
        requires_official_form=requires_official_form or "미지정",
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
    structured = extract_structure_marker(content_markdown)
    if structured is not None:
        structured_format, structure = structured
        return _write_structured_document(
            output_path=output_path,
            format_key=structured_format,
            structure=structure,
            fallback_title=title,
            user_template_path=user_template_path,
        )

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


# ---------------------------------------------------------------------------
# 구조 기반(WYSIWYG) 최종 렌더링 — 고정 목차 슬롯 매핑을 쓰지 않는다.
# 스켈레톤은 용지 서식·헤더(제목 상자)·날짜 표기용으로만 쓰고,
# 본문은 구조의 섹션 제목·항목을 □→◦→-→※ 위계 문단으로 그대로 옮긴다.
# ---------------------------------------------------------------------------

_TOKEN_PATTERN = re.compile(r"\{\{([^}]+)\}\}")

# 본문 주입 영역: 이 토큰들이 들어 있는 최상위 문단 구간을 통째로 걷어내고
# 구조에서 생성한 문단으로 대체한다.
_STRUCTURED_BODY_TOKENS: dict[str, set[str]] = {
    "onePageReport": {f"text_{index:03d}" for index in range(4, 24)},
    "email": {f"text_{index:03d}" for index in range(5, 18)},
    "officialMemo": {
        "목차_항목_001",
        "목차_항목_002",
        "목차_항목_003",
        "text_010",
        "text_011",
        "text_012",
        "text_013",
    },
}

# 위계 수준별 문단 스타일 표본(스켈레톤 자신의 문단을 복제해 서식을 물려받는다)
_STRUCTURED_LEVEL_TOKENS: dict[str, dict[str, str]] = {
    "onePageReport": {"heading": "text_004", "item": "text_005", "sub": "text_007", "note": "text_008"},
    "fullReport": {"heading": "본문_절_001", "item": "본문_항목_001", "sub": "본문_세부_001", "note": "본문_주석_001"},
    "officialMemo": {"item": "목차_항목_001", "sub": "text_010", "attach": "목차_항목_003"},
    "email": {"item": "text_006"},
}


def _normalize_deadline(value: str) -> str:
    text = (value or "").strip()
    return "" if text in {"", "기한 미정", "미정"} else text


def _split_top_level_paragraph_spans(xml: str) -> list[tuple[int, int]]:
    """<hp:sec> 바로 아래의 최상위 <hp:p> 구간을 찾는다(표 안의 중첩 문단 제외)."""
    spans: list[tuple[int, int]] = []
    depth = 0
    start = 0
    for match in re.finditer(r"<hp:p\b|</hp:p>", xml):
        if match.group(0) == "<hp:p":
            if depth == 0:
                start = match.start()
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                spans.append((start, match.end()))
    return spans


def _paragraph_tokens(paragraph: str) -> list[str]:
    return _TOKEN_PATTERN.findall(paragraph)


_HIERARCHY_MARKERS = ("□", "◦", "-", "※", "•", "·")


def _fill_template_text(template: str, text: str) -> str:
    # 표본 문단이 글머리 기호를 별도 런(run)으로 이미 갖고 있으면(예: 풀버전 ◦)
    # 주입 텍스트의 같은 기호를 제거해 이중 표기를 막는다.
    literal_texts = re.findall(r"<hp:t(?:\s[^>]*)?>(.*?)</hp:t>", template, re.DOTALL)
    literal = _TOKEN_PATTERN.sub("", re.sub(r"<[^>]+>", "", "".join(literal_texts))).strip()
    body = text
    if literal and literal in _HIERARCHY_MARKERS:
        stripped = text.lstrip()
        if stripped.startswith(literal):
            body = stripped[len(literal):].lstrip()
    escaped = _xml_escape(body)
    filled = _TOKEN_PATTERN.sub(lambda _match: escaped, template, count=1)
    return _TOKEN_PATTERN.sub("", filled)


def _paragraphs_from_plan(
    plan: list[tuple[str, str]],
    templates: dict[str, str],
    gap_template: str,
) -> list[str]:
    fallback = templates.get("item") or next(iter(templates.values()), "")
    paragraphs: list[str] = []
    for level, text in plan:
        if level == "gap":
            if gap_template:
                paragraphs.append(gap_template)
            continue
        template = templates.get(level) or fallback
        if not template:
            continue
        paragraphs.append(_fill_template_text(template, text))
    return paragraphs


def _harvest_level_templates(paragraphs: list[str], format_key: str) -> dict[str, str]:
    templates: dict[str, str] = {}
    for level, token in _STRUCTURED_LEVEL_TOKENS[format_key].items():
        needle = "{{" + token + "}}"
        for paragraph in paragraphs:
            if needle in paragraph and "<hp:tbl" not in paragraph:
                templates[level] = paragraph
                break
    return templates


# 요약 글상자 표·문단에 부여하는 고정 id — 스켈레톤 기존 id 대역(2·9·10자리)과 겹치지 않는
# 높은 값으로 잡아 결정적 산출을 보장한다.
_SUMMARY_BOX_TBL_ID = "9100000001"
_SUMMARY_BOX_WRAP_ID = "9100000002"


def _build_onepage_summary_box(item_template: str, sentences: list[str]) -> str:
    """1p 요약을 1×1 표(테두리 글상자)로 감싼 최상위 문단 XML을 만든다.

    셀 안 문단은 item 표본(text_005)의 글자·문단 서식(charPr/paraPr)을 물려받아 본문
    ◦ 항목과 같은 모양을 유지한다. 표 테두리는 스켈레톤에 이미 정의된 실선 borderFill(id=4)을
    쓴다. 한/글이 문서를 열 때 셀 높이·라인 세그먼트를 재계산하므로 높이는 최소 추정치만 넣는다.
    """
    para_match = re.search(r'paraPrIDRef="([^"]*)"', item_template)
    style_match = re.search(r'styleIDRef="([^"]*)"', item_template)
    char_match = re.search(r'charPrIDRef="([^"]*)"', item_template)
    para_pr = para_match.group(1) if para_match else "0"
    style_id = style_match.group(1) if style_match else "0"
    char_pr = char_match.group(1) if char_match else "0"

    cell_paragraphs: list[str] = []
    for index, sentence in enumerate(sentences):
        escaped = _xml_escape(f"◦ {sentence}")
        vertpos = index * 1300
        cell_paragraphs.append(
            f'<hp:p id="0" paraPrIDRef="{para_pr}" styleIDRef="{style_id}" '
            f'pageBreak="0" columnBreak="0" merged="0">'
            f'<hp:run charPrIDRef="{char_pr}"><hp:t>{escaped}</hp:t></hp:run>'
            f'<hp:linesegarray><hp:lineseg textpos="0" vertpos="{vertpos}" vertsize="1300" '
            f'textheight="1300" baseline="1105" spacing="1040" horzpos="0" horzsize="45640" '
            f'flags="393216"/></hp:linesegarray></hp:p>'
        )
    cell_body = "".join(cell_paragraphs)
    cell_height = len(sentences) * 1500 + 400
    tbl_height = cell_height + 566
    return (
        f'<hp:p id="{_SUMMARY_BOX_WRAP_ID}" paraPrIDRef="0" styleIDRef="0" '
        f'pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="{char_pr}">'
        f'<hp:tbl id="{_SUMMARY_BOX_TBL_ID}" zOrder="0" numberingType="TABLE" '
        f'textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" '
        f'pageBreak="CELL" repeatHeader="1" rowCnt="1" colCnt="1" cellSpacing="0" '
        f'borderFillIDRef="4" noAdjust="0">'
        f'<hp:sz width="47341" widthRelTo="ABSOLUTE" height="{tbl_height}" '
        f'heightRelTo="ABSOLUTE" protect="0"/>'
        f'<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" '
        f'holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" '
        f'horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
        f'<hp:outMargin left="283" right="283" top="141" bottom="283"/>'
        f'<hp:inMargin left="141" right="141" top="141" bottom="141"/>'
        f'<hp:tr><hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" '
        f'borderFillIDRef="4"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" '
        f'vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" '
        f'textHeight="0" hasTextRef="0" hasNumRef="0">{cell_body}</hp:subList>'
        f'<hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>'
        f'<hp:cellSz width="47341" height="{cell_height}"/>'
        f'<hp:cellMargin left="424" right="424" top="141" bottom="141"/></hp:tc></hp:tr>'
        f'</hp:tbl><hp:t/></hp:run>'
        f'<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="{tbl_height}" '
        f'textheight="{tbl_height}" baseline="{tbl_height - 200}" spacing="200" horzpos="0" '
        f'horzsize="48188" flags="393216"/></hp:linesegarray></hp:p>'
    )


def _structured_body_plan(format_key: str, structure: dict[str, Any]) -> list[tuple[str, str]]:
    """structure_to_lines(미리보기)와 1:1 로 대응하는 (스타일, 본문 텍스트) 목록.

    미리보기에서 양식 고유 슬롯(제목 상자·수신/발신 칸 등)으로 옮겨지는 줄만 제외한다.
    """
    plan: list[tuple[str, str]] = []
    if format_key == "onePageReport":
        # 요약은 _render_structured_section_xml 에서 글상자(1×1 표)로 별도 주입한다 —
        # 본문 계획에는 섹션만 담는다('요약' 헤딩·블릿 나열 폐지).
        for section in structure.get("sections", []) or []:
            plan.append(("gap", ""))
            plan.append(("heading", f"□ {section.get('heading', '')}"))
            for item in section.get("items", []) or []:
                plan.append(("item", f"◦ {item}"))
            if section.get("detail"):
                # 1p 세부 문단 스타일은 자체 '-' 글머리를 갖고 있어 텍스트에는 넣지 않는다
                plan.append(("sub", str(section["detail"])))
            if section.get("note"):
                plan.append(("note", f"※ {section['note']}"))
        return plan

    if format_key == "officialMemo":
        for index, item in enumerate(structure.get("items", []) or []):
            marker = GANADA[min(index, len(GANADA) - 1)]
            plan.append(("item", f"{marker}. {item.get('text', '')}"))
            for sub_index, sub in enumerate(item.get("subs") or [], start=1):
                plan.append(("sub", f"{sub_index}) {sub}"))
        attachments = structure.get("attachments") or []
        if attachments:
            plan.append(("gap", ""))
            for attachment in attachments:
                plan.append(("attach", f"붙임: {attachment}"))
        return plan

    if format_key == "email":
        if structure.get("greeting"):
            plan.append(("item", str(structure["greeting"])))
            plan.append(("gap", ""))
        body_paragraphs = structure.get("body_paragraphs", []) or []
        for index, paragraph in enumerate(body_paragraphs):
            plan.append(("item", str(paragraph)))
            if index < len(body_paragraphs) - 1:
                plan.append(("gap", ""))
        if structure.get("closing"):
            plan.append(("gap", ""))
            plan.append(("item", str(structure["closing"])))
        if structure.get("signature"):
            plan.append(("gap", ""))
            plan.append(("item", str(structure["signature"])))
        return plan

    raise ValueError(f"본문 계획을 만들 수 없는 양식입니다: {format_key}")


def _structured_full_plans(structure: dict[str, Any]) -> tuple[list[tuple[str, str]], list[list[tuple[str, str]]]]:
    summary_plan: list[tuple[str, str]] = [("heading", "□ 요약")]
    for summary_line in structure.get("summary", []) or []:
        # F-13a: structure_to_lines(미리보기)와 동일하게 문장 단위로 나눈다
        for sentence in split_summary_sentences(str(summary_line)) or [str(summary_line)]:
            summary_plan.append(("item", f"◦ {sentence}"))

    chapter_plans: list[list[tuple[str, str]]] = []
    for chapter in structure.get("chapters", []) or []:
        plan: list[tuple[str, str]] = []
        for section in chapter.get("sections", []) or []:
            plan.append(("heading", f"□ {section.get('heading', '')}"))
            for item in section.get("items", []) or []:
                plan.append(("item", f"◦ {item}"))
            plan.append(("gap", ""))
        chapter_plans.append(plan)

    schedule = structure.get("schedule") or {}
    rows = schedule.get("rows") if isinstance(schedule, dict) else None
    if rows and chapter_plans:
        tail = chapter_plans[-1]
        tail.append(("note", "※ 추진 일정"))
        for row in rows:
            note = row.get("비고") or ""
            suffix = f" ({note})" if note else ""
            tail.append(("item", f"◦ {row.get('항목', '')}: {row.get('일정', '')}{suffix}"))
    return summary_plan, chapter_plans


def _structured_values(format_key: str, structure: dict[str, Any], title: str) -> dict[str, str]:
    """스켈레톤에 남는 고정 슬롯 값 — 용지 서식·헤더·날짜·양식 고유 요소(수신/발신/붙임)만."""
    date_label = _safe_date_label()
    if format_key == "onePageReport":
        return {
            "표지_제목": title,
            "text_001": title,
            "text_002": str(structure.get("subtitle") or ""),
            "text_003": f"<공무원, {date_label}>",
        }

    if format_key == "officialMemo":
        receiver = str(structure.get("receiver") or "관련 부서")
        sender = str(structure.get("sender") or "공무원")
        return {
            "표지_제목": title,
            "text_001": "로컬 AI 업무 에이전트",
            "text_002": "",
            "text_003": sender,
            "text_004": f"수신: {receiver}",
            "text_005": "",
            "text_006": title,
            "text_007": f"1. {structure.get('opening', '')}",
            "text_008": "2. 세부 사항" if structure.get("items") else "",
            "text_009": "",
            "목차_항목_004": "끝.",
            "text_014": sender,
            "text_015": receiver,
            "text_020": "공무원-문서",
            "text_021": date_label,
            "text_022": "전화",
            "text_023": "전송",
        }

    if format_key == "fullReport":
        values: dict[str, str] = {
            "표지_제목": title,
            "text_001": "",
            "text_002": title,
            "문서번호": "-",
            "보존기간": "1년",
            "보고일": date_label,
            "기관명": "공무원",
            "본부부서명": "로컬 AI 업무 에이전트",
            "참고자료_1": "",
            "참고자료_2": "",
            "참고자료_3": "",
        }
        chapters = structure.get("chapters", []) or []
        toc_rows: list[str] = []
        for index, chapter in enumerate(chapters):
            numeral = ROMAN_NUMERALS[min(index, len(ROMAN_NUMERALS) - 1)]
            toc_rows.append(f"{numeral}. {chapter.get('heading', '')}")
            if index < 6:
                # 장 상자에는 로마숫자 디자인 셀이 이미 있으므로 제목만 넣는다
                values[f"장{index + 1:02d}_제목"] = str(chapter.get("heading", ""))
        for slot in range(1, 53):
            if slot % 2 == 1:
                row = (slot - 1) // 2
                values[f"목차_항목_{slot:03d}"] = toc_rows[row] if row < len(toc_rows) else ""
            else:
                values[f"목차_항목_{slot:03d}"] = ""
        return values

    if format_key == "email":
        return {
            "문서_제목": title,
            "text_000": "업무 이메일",
            "text_001": f"제목: {title}",
            "text_004": f"작성일: {date_label}",
        }

    raise ValueError(f"지원하지 않는 문서 양식입니다: {format_key}")


def _render_structured_section_xml(xml: str, format_key: str, structure: dict[str, Any]) -> str:
    spans = _split_top_level_paragraph_spans(xml)
    if not spans:
        return xml
    paragraphs = [xml[start:end] for start, end in spans]
    prefix = xml[: spans[0][0]]
    suffix = xml[spans[-1][1]:]
    templates = _harvest_level_templates(paragraphs, format_key)

    if format_key == "fullReport":
        new_paragraphs = _assemble_full_report_paragraphs(paragraphs, structure, templates)
    else:
        body_tokens = _STRUCTURED_BODY_TOKENS[format_key]
        body_indexes = [
            index
            for index, paragraph in enumerate(paragraphs)
            if _paragraph_tokens(paragraph) and set(_paragraph_tokens(paragraph)) <= body_tokens
        ]
        if not body_indexes:
            return xml
        first, last = min(body_indexes), max(body_indexes)
        gap_template = next(
            (paragraph for paragraph in paragraphs[first : last + 1] if not _paragraph_tokens(paragraph)),
            "",
        )
        plan = _structured_body_plan(format_key, structure)
        injected = _paragraphs_from_plan(plan, templates, gap_template)
        if format_key == "onePageReport":
            summary_sentences = split_summary_sentences(str(structure.get("summary", "")))
            if summary_sentences:
                item_template = templates.get("item")
                if item_template:
                    injected = [_build_onepage_summary_box(item_template, summary_sentences)] + injected
                else:
                    # 템플릿 부재 폴백: 상자 없이 ◦ 문장 문단으로 강등(내용 유실 금지)
                    fallback = _paragraphs_from_plan(
                        [("item", f"◦ {sentence}") for sentence in summary_sentences],
                        templates,
                        gap_template,
                    )
                    injected = fallback + injected
        new_paragraphs = paragraphs[:first] + injected + paragraphs[last + 1 :]

    return prefix + "".join(new_paragraphs) + suffix


def _assemble_full_report_paragraphs(
    paragraphs: list[str],
    structure: dict[str, Any],
    templates: dict[str, str],
) -> list[str]:
    box_positions: list[int] = []
    for chapter_number in range(1, 7):
        needle = "{{장" + f"{chapter_number:02d}" + "_제목}}"
        position = next((index for index, paragraph in enumerate(paragraphs) if needle in paragraph), None)
        if position is not None:
            box_positions.append(position)
    if not box_positions:
        return paragraphs

    first_box = box_positions[0]
    boundaries = box_positions + [len(paragraphs)]
    first_region = paragraphs[box_positions[0] + 1 : boundaries[1]]
    gap_template = next((paragraph for paragraph in first_region if not _paragraph_tokens(paragraph)), "")

    summary_plan, chapter_plans = _structured_full_plans(structure)
    assembled = list(paragraphs[:first_box])
    assembled += _paragraphs_from_plan(summary_plan, templates, gap_template)
    for region_index, box_index in enumerate(box_positions):
        if region_index >= len(chapter_plans):
            continue  # 사용하지 않는 장 상자와 그 구간은 통째로 제거
        assembled.append(paragraphs[box_index])
        assembled += _paragraphs_from_plan(chapter_plans[region_index], templates, gap_template)
    return assembled


def _drop_unfilled_token_paragraphs(xml: str, values: dict[str, str]) -> str:
    """채워지지 않는 토큰만 남은 최상위 문단(빈 장 상자·안 쓰는 슬롯)을 삭제한다."""
    spans = _split_top_level_paragraph_spans(xml)
    pieces: list[str] = []
    cursor = 0
    for start, end in spans:
        paragraph = xml[start:end]
        pieces.append(xml[cursor:start])
        cursor = end
        tokens = _paragraph_tokens(paragraph)
        keep = True
        if tokens and "<hp:secPr" not in paragraph:
            if not any(str(values.get(token) or "").strip() for token in tokens):
                texts = re.findall(r"<hp:t[^>]*>(.*?)</hp:t>", paragraph, re.DOTALL)
                if all(re.fullmatch(r"(?:\s|\{\{[^}]+\}\})*", text or "") for text in texts):
                    keep = False
        if keep:
            pieces.append(paragraph)
    pieces.append(xml[cursor:])
    return "".join(pieces)


def _strip_layout_cache(xml: str) -> str:
    """스켈레톤에서 복제된 <hp:linesegarray>(줄 배치 캐시)를 걷어낸다.

    캐시의 vertpos 는 '템플릿 원본에서 그 문단이 있던 위치'다. 문단을 복제·재조립하면
    값이 그대로 따라와 순서가 뒤엉킨다(다음 문단이 앞 문단보다 위, 같은 값 반복, 0 으로 리셋).
    한컴은 파일을 열 때 배치를 다시 계산해서 영향이 없지만, 캐시를 그대로 믿는 뷰어는
    vertpos 가 되돌아가는 지점마다 새 쪽을 시작한다 — 1페이지 보고서가 제목쪽·본문쪽·빈쪽으로
    쪼개지던 원인. 캐시를 지우면 두 엔진 모두 같은 배치를 새로 계산한다.
    """
    return re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", xml, flags=re.DOTALL)


def _drop_forced_empty_page(xml: str) -> str:
    """채울 내용이 없어 빈 껍데기만 남은 강제 쪽나눔 블록을 통째로 지운다.

    1페이지 보고서 스켈레톤은 뒤에 '붙임/근거' 쪽을 쪽나눔으로 매달고 있다. 근거가 없으면
    글자는 비지만 쪽나눔과 빈 표는 남아 빈 쪽이 생긴다(쪽나눔만 풀면 빈 표가 본문에 노출된다).
    """
    spans = _split_top_level_paragraph_spans(xml)
    start = next(
        (index for index, (a, b) in enumerate(spans) if re.match(r'<hp:p[^>]*pageBreak="1"', xml[a:b])),
        None,
    )
    if start is None:
        return xml
    tail = xml[spans[start][0] :]
    if "<hp:pic" in tail or any(text.strip() for text in re.findall(r"<hp:t>(.*?)</hp:t>", tail, re.DOTALL)):
        return xml  # 실제 내용이 있으면 그대로 둔다
    return xml[: spans[start][0]] + xml[spans[-1][1] :]


def _finalize_section_xml(workdir: Path) -> None:
    """토큰 치환이 끝나 내용이 확정된 뒤 실행하는 구역 XML 마무리."""
    for section_path in sorted(workdir.glob("Contents/section*.xml")):
        xml = section_path.read_text(encoding="utf-8", errors="ignore")
        xml = _drop_forced_empty_page(xml)
        xml = _strip_layout_cache(xml)
        section_path.write_text(xml, encoding="utf-8")


def _fill_structured_skeleton(
    skeleton_path: Path,
    output_path: Path,
    *,
    format_key: str,
    structure: dict[str, Any],
    values: dict[str, str],
    lines: list[str],
) -> None:
    with tempfile.TemporaryDirectory(prefix="gongmu-hwpx-") as temp_dir:
        workdir = Path(temp_dir)
        with zipfile.ZipFile(skeleton_path, "r") as archive:
            archive.extractall(workdir)

        section_path = workdir / "Contents" / "section0.xml"
        if section_path.exists():
            section_xml = section_path.read_text(encoding="utf-8", errors="ignore")
            section_xml = _render_structured_section_xml(section_xml, format_key, structure)
            section_xml = _drop_unfilled_token_paragraphs(section_xml, values)
            section_path.write_text(section_xml, encoding="utf-8")

        for xml_path in workdir.rglob("*.xml"):
            text = xml_path.read_text(encoding="utf-8", errors="ignore")
            text = _replace_skeleton_tokens(text, values)
            xml_path.write_text(text, encoding="utf-8")

        _finalize_section_xml(workdir)

        hpf_path = workdir / "Contents" / "content.hpf"
        if hpf_path.exists() and values.get("표지_제목"):
            hpf = hpf_path.read_text(encoding="utf-8", errors="ignore")
            safe_title = _xml_escape(values["표지_제목"])
            hpf = re.sub(r"<opf:title>[^<]*</opf:title>", f"<opf:title>{safe_title}</opf:title>", hpf, count=1)
            hpf_path.write_text(hpf, encoding="utf-8")

        preview_text_path = workdir / "Preview" / "PrvText.txt"
        if preview_text_path.exists():
            preview_text_path.write_bytes("\n".join(lines).encode("utf-16-le"))

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


def _write_structured_document(
    *,
    output_path: Path,
    format_key: str,
    structure: dict[str, Any],
    fallback_title: str,
    user_template_path: str | None,
) -> dict[str, str]:
    title = str(structure.get("title") or structure.get("subject") or "").strip() or (
        (fallback_title or "").strip() or "공무 업무 문서"
    )
    lines = structure_to_lines(format_key, structure)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path = output_path.with_suffix(".md")

    builtin_template_path = _builtin_skeleton_path(cast(PublicDocumentFormat, format_key))
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
        values = _structured_values(format_key, structure, title)
        _fill_structured_skeleton(
            builtin_template_path,
            output_path,
            format_key=format_key,
            structure=structure,
            values=values,
            lines=lines,
        )
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
        "format": format_key,
        "template_source": template_source,
        "template_path": template_path,
    }


def _fill_skeleton_template(skeleton_path: Path, values: dict[str, str], output_path: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="gongmu-hwpx-") as temp_dir:
        workdir = Path(temp_dir)
        with zipfile.ZipFile(skeleton_path, "r") as archive:
            archive.extractall(workdir)

        for xml_path in workdir.rglob("*.xml"):
            text = xml_path.read_text(encoding="utf-8", errors="ignore")
            text = _replace_skeleton_tokens(text, values)
            xml_path.write_text(text, encoding="utf-8")

        _finalize_section_xml(workdir)

        hpf_path = workdir / "Contents" / "content.hpf"
        if hpf_path.exists() and values.get("표지_제목"):
            hpf = hpf_path.read_text(encoding="utf-8", errors="ignore")
            safe_title = _xml_escape(values["표지_제목"])
            hpf = re.sub(r"<opf:title>[^<]*</opf:title>", f"<opf:title>{safe_title}</opf:title>", hpf, count=1)
            hpf_path.write_text(hpf, encoding="utf-8")

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


def _replace_skeleton_tokens(text: str, values: dict[str, str]) -> str:
    def replacement(match: re.Match[str]) -> str:
        token = match.group(1)
        return _xml_escape(values.get(token, ""))

    return re.sub(r"\{\{([^}]+)\}\}", replacement, text)


def _xml_escape(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _build_skeleton_values(payload: PublicDocumentPayload, lines: list[str]) -> dict[str, str]:
    if payload.selected_format == "officialMemo":
        return _build_gongmun_values(payload)
    if payload.selected_format == "fullReport":
        return _build_full_report_values(payload)
    if payload.selected_format == "email":
        return _build_email_values(payload, lines)
    return _build_onepage_values(payload, lines)


def _line_or(items: list[str], index: int, fallback: str = "") -> str:
    return items[index] if index < len(items) else fallback


def _build_onepage_values(payload: PublicDocumentPayload, lines: list[str]) -> dict[str, str]:
    values = {
        "표지_제목": payload.title,
        "text_001": payload.title,
        "text_002": payload.document_purpose or f"{payload.selected_format} 보고",
        "text_003": f"<공무원, {_safe_date_label()}>",
        "text_004": "1. 개요",
        "text_005": _line_or(payload.summary, 0, payload.document_purpose),
        "text_006": _line_or(payload.summary, 1, "업무대화와 연결자료를 바탕으로 핵심을 정리"),
        "text_007": _line_or(payload.background, 0, "검토 배경을 간결하게 정리"),
        "text_008": _line_or(payload.background, 1, ""),
        "text_009": "2. 현황 및 쟁점",
        "text_010": _line_or(payload.issues, 0, "주요 쟁점을 요약"),
        "text_011": _line_or(payload.current_status, 0, "현재 상황을 정리"),
        "text_012": _line_or(payload.issues, 1, ""),
        "text_013": _line_or(payload.current_status, 1, ""),
        "text_014": "3. 조치안",
        "text_015": _line_or(payload.solutions, 0, "후속 조치안을 제시"),
        "text_016": _line_or(payload.actions, 0, _line_or(payload.requested_action, 0, "검토 후 결정")),
        "text_017": _line_or(payload.solutions, 1, ""),
        "text_018": _line_or(payload.actions, 1, ""),
        "text_019": "4. 기대효과 및 요청",
        "text_020": _line_or(payload.expected_effects, 0, "업무 처리 기준 명확화"),
        "text_021": _line_or(payload.requested_action, 0, "검토 요청"),
        "text_022": f"기한: {payload.deadline}" if payload.deadline else "",
        "text_023": _line_or(payload.expected_effects, 1, ""),
        "장01_제목": "붙임",
        "장02_제목": "근거 및 연결자료",
        "본문_절_001": "□ 출처 및 활용 계획",
        "text_024": _line_or(payload.evidence, 0, payload.related),
        "text_025": _line_or(payload.evidence, 1, ""),
        "text_026": _line_or(payload.evidence, 2, ""),
        "본문_주석_001": "※ 연결 파일과 대화 이력을 근거로 정리",
        "본문_절_002": "",
        "text_027": _line_or(payload.evidence, 3, ""),
        "text_028": _line_or(payload.evidence, 4, ""),
        "text_029": _line_or(payload.evidence, 5, ""),
        "본문_주석_002": "",
    }
    _fill_numbered_text_tokens(values, lines, start=30, end=35)
    return values


def _build_gongmun_values(payload: PublicDocumentPayload) -> dict[str, str]:
    evidence = _evidence_items(payload)
    return {
        "표지_제목": payload.title,
        "text_001": "로컬 AI 업무 에이전트",
        "text_002": "",
        "text_003": "공무원",
        "text_004": f"수신: {payload.recipient}",
        "text_005": "",
        "text_006": payload.title,
        "text_007": f"1. {payload.document_purpose or '관련 사항입니다.'}",
        "text_008": "2. 아래와 같이 검토 또는 조치를 요청합니다.",
        "text_009": _line_or(payload.requested_action, 0, "검토 요청"),
        "목차_항목_001": f"가. {_line_or(payload.summary, 0, '주요 내용')}",
        "목차_항목_002": f"나. {_line_or(payload.solutions, 0, '조치 계획')}",
        "text_010": f"1) {_line_or(payload.issues, 0, '현황 정리')}",
        "text_011": f"가) {_line_or(payload.actions, 0, '후속 조치')}",
        "text_012": f"(1) {_line_or(evidence, 0, '근거자료 확인')}",
        "text_013": f"① {_line_or(evidence, 1, '연결 파일 참고')}",
        "목차_항목_003": f"붙임: {_line_or(evidence, 0, '관련자료')} 1부",
        "목차_항목_004": "끝.",
        "text_014": "공무원",
        "text_015": payload.recipient,
        "text_020": "공무원-문서",
        "text_021": _safe_date_label(),
        "text_022": "전화",
        "text_023": "전송",
    }


def _build_full_report_values(payload: PublicDocumentPayload) -> dict[str, str]:
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
        "장01_제목": "추진배경 및 목적",
        "장02_제목": "현황 및 쟁점",
        "장03_제목": "해결방안",
        "장04_제목": "기대효과",
        "장05_제목": "조치사항",
        "장06_제목": "근거 및 연결자료",
    }
    toc = [
        "Ⅰ. 추진배경 및 목적",
        "1",
        "Ⅱ. 현황 및 쟁점",
        "3",
        "Ⅲ. 해결방안",
        "5",
        "Ⅳ. 기대효과",
        "7",
        "Ⅴ. 조치사항",
        "9",
        "Ⅵ. 근거 및 연결자료",
        "11",
    ]
    for index in range(1, 53):
        values[f"목차_항목_{index:03d}"] = _line_or(toc, index - 1, "")
    body_groups = [
        ("본문_절_001", "본문_항목_001", "본문_세부_001", "본문_주석_001", "□ 추진배경", payload.background),
        ("본문_절_002", "본문_항목_002", "본문_세부_002", "본문_주석_002", "□ 현황", payload.current_status),
        ("본문_절_003", "본문_항목_003", "본문_세부_003", "본문_주석_003", "□ 쟁점", payload.issues),
        ("본문_절_004", "본문_항목_004", "본문_세부_004", "본문_주석_004", "□ 해결방안", payload.solutions),
        ("본문_절_005", "본문_항목_005", "본문_세부_005", "본문_주석_005", "□ 기대효과", payload.expected_effects),
        ("본문_절_006", "본문_항목_006", "본문_세부_006", "본문_주석_006", "□ 조치사항", payload.actions),
        ("본문_절_007", "본문_항목_007", "본문_세부_007", "본문_주석_007", "□ 요청사항", payload.requested_action),
        ("본문_절_008", "본문_항목_008", "본문_세부_008", "본문_주석_008", "□ 근거자료", _evidence_items(payload)),
    ]
    for section_token, item_token, detail_token, note_token, heading, items in body_groups:
        values[section_token] = heading
        values[item_token] = _line_or(items, 0, "")
        values[detail_token] = _line_or(items, 1, "")
        values[note_token] = _line_or(items, 2, "")
    for index in range(1, 13):
        values.setdefault(f"일정표_셀_{index:03d}", "")
    return values


def _build_email_values(payload: PublicDocumentPayload, lines: list[str]) -> dict[str, str]:
    evidence = _evidence_items(payload)
    values = {
        "문서_제목": payload.title,
        "text_000": "업무 이메일",
        "text_001": f"제목: {payload.title}",
        "text_002": f"수신: {payload.recipient}",
        "text_003": f"발신: {payload.sender}",
        "text_004": f"작성일: {_safe_date_label()}",
        "text_005": "1. 핵심 요약",
        "text_006": f"- {_line_or(payload.summary, 0, payload.document_purpose)}",
        "text_007": f"- {_line_or(payload.summary, 1, '')}",
        "text_008": "2. 요청사항",
        "text_009": f"- {_line_or(payload.requested_action, 0, '검토 요청')}",
        "text_010": f"- {_line_or(payload.requested_action, 1, '')}",
        "text_011": f"- 요청 기한: {payload.deadline}" if payload.deadline else "",
        "text_012": "3. 근거 및 연결 파일",
        "text_013": f"- {_line_or(evidence, 0, payload.related)}",
        "text_014": f"- {_line_or(evidence, 1, '')}",
        "text_015": "",
        "text_016": "",
        "text_017": "",
    }
    _fill_numbered_text_tokens(values, lines, start=18, end=24)
    return values


def _fill_numbered_text_tokens(values: dict[str, str], lines: list[str], *, start: int, end: int) -> None:
    compact_lines = [line for line in lines if line.strip()]
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
        value = line[2:].strip() if line.startswith("- ") else line
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
    return fallback or ["작성 내용을 기준으로 정리합니다."]


def _usable_section_values(sections: dict[str, list[str]], key: str) -> list[str]:
    return [
        value.strip()
        for value in sections.get(key, [])
        if value.strip()
        and not _looks_like_placeholder_value(value)
        and not _looks_like_document_generation_instruction(value)
    ]


def _looks_like_placeholder_value(value: str) -> bool:
    normalized = re.sub(r"\s+", " ", value).strip()
    if normalized in {"사용자:", "어시스턴트:", "-", "—"}:
        return True
    return "내용을 여기에 정리합니다" in normalized


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
        if "\\" in normalized or "/" in normalized:
            return False
        if re.search(r"\.(txt|md|pdf|docx?|hwp|hwpx|xlsx?|pptx?)\s*:", normalized, flags=re.IGNORECASE):
            return False
        if len(normalized) > 120:
            return False
    lowered = normalized.lower()
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
        ):
            continue
        seen.add(value)
        results.append(value)
    return results


def _apply_writing_principles(items: list[str]) -> list[str]:
    return [_compact_public_sentence(item) for item in items if _compact_public_sentence(item)]


def _compact_public_sentence(value: str) -> str:
    compacted = value.strip()
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
    return ["작성 내용을 근거로 작성했습니다."]


def _render_onepage(payload: PublicDocumentPayload) -> list[str]:
    lines = [payload.title, ""]
    lines += _metadata_lines(payload)
    lines += _section("1. 개요", payload.summary)
    lines += _section("2. 현황 및 쟁점", payload.issues)
    lines += _section("3. 조치안", payload.solutions)
    lines += _section("4. 기대효과", payload.expected_effects)
    lines += _section("5. 요청사항", payload.requested_action)
    lines += _section("6. 근거 및 연결자료", _evidence_items(payload))
    return lines


def _render_official_memo(payload: PublicDocumentPayload) -> list[str]:
    lines = [payload.title, "", f"수신: {payload.recipient}", f"발신: {payload.sender}", ""]
    lines += _metadata_lines(payload)
    lines.append(f"1. 관련: {payload.related}")
    lines.append("2. 아래와 같이 협조 또는 조치를 요청하오니 기한 내 검토하여 주시기 바랍니다.")
    lines.append("")
    lines.append("- 요청 내용 -")
    lines.append("")
    for item in payload.requested_action:
        lines.append(f"- {item}")
    if payload.deadline:
        lines.append(f"- 제출 기한: {payload.deadline}")
    lines.append("")
    lines.append("3. 근거 및 연결자료")
    for item in _evidence_items(payload):
        lines.append(f"- {item}")
    lines.append("")
    lines.append("4. 문의: 담당 부서")
    lines.append("")
    return lines


def _render_full_report(payload: PublicDocumentPayload) -> list[str]:
    lines = [payload.title, ""]
    lines += _metadata_lines(payload)
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
    lines += _section("I. 추진배경 및 목적", payload.background)
    lines += _section("II. 현황", payload.current_status)
    lines += _section("III. 쟁점", payload.issues)
    lines += _section("IV. 해결방안", payload.solutions)
    lines += _section("V. 기대효과", payload.expected_effects)
    lines += _section("VI. 조치사항", payload.actions)
    lines += _section("VII. 요청사항", payload.requested_action)
    lines += _section("VIII. 근거 및 연결자료", _evidence_items(payload))
    return lines


def _render_email(payload: PublicDocumentPayload) -> list[str]:
    lines = [f"제목: {payload.title}", "", f"수신: {payload.recipient}", f"발신: {payload.sender}", ""]
    lines += _metadata_lines(payload)
    lines += _section("요지", payload.summary)
    lines += _section("요청사항", payload.requested_action)
    lines += _section("근거 및 연결자료", _evidence_items(payload))
    if payload.deadline:
        lines.append(f"- 요청 기한: {payload.deadline}")
        lines.append("")
    lines.append("감사합니다.")
    lines.append("")
    return lines
