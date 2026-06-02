from __future__ import annotations

from dataclasses import dataclass
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
BULLET_MARKERS = ["- ", "– ", "− ", "—", "-", "–", "−"]
SUBBULLET_MARKERS = ["◦ ", "○ ", "◇ ", "◦", "○"]
ASTERISK_MARKERS = ["* ", "※ ", " * ", "*"]
EMPTY_PLACEHOLDER_MARKER = "\u200b\u200b__EMPTY_PLACEHOLDER__\u200b\u200b"
DEFAULT_SKELETON_VALUES = {
    "text_004": "수신",
}
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
    "품질 점검",
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
        "slots": ["목차_항목_001", "목차_항목_002"],
        "para_pr": "26",
        "char_pr": "22",
        "anchor": "목차_항목_002",
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
    requested_action_lines = [requested_action] if requested_action.strip() else _first_non_empty(
        sections,
        ["기대효과 및 요청", "후속 조치", "결정 사항", "권고안", "요청사항", "작성 슬롯"],
    )
    solutions = _first_non_empty(
        sections,
        ["조치안", "후속 조치", "결정 사항", "권고안", "해결방안", "조치사항"],
        fallback=report_context_lines[:3] if report_context_lines else None,
    )
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
        expected_effects=pick(
            ["기대효과 및 요청", "기대효과"],
            fallback=["후속 절차를 명확히 하고 업무 이력을 재사용할 수 있습니다."],
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
                text = _replace_skeleton_tokens(text, values, remove_empty=True)
            else:
                text = _replace_skeleton_tokens(text, values)
            xml_path.write_text(text, encoding="utf-8")

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
                expanded_values.setdefault(slot[0], marker)
                expanded_values.setdefault(slot[1], body)
            else:
                expanded_values.setdefault(slot, item)
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
        has_meaningful_text = any(value.replace(EMPTY_PLACEHOLDER_MARKER, "").strip() for value in values)
        if has_meaningful_text:
            text = text[:paragraph_start] + block.replace(EMPTY_PLACEHOLDER_MARKER, "") + text[paragraph_end:]
        else:
            text = text[:paragraph_start] + text[paragraph_end:]


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
    return [f"{letters[index] if index < len(letters) else index + 1}) {item}" for index, item in enumerate(items) if item]


def _circled_items(items: list[str]) -> list[str]:
    markers = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"]
    return [f"{markers[index] if index < len(markers) else index + 1} {item}" for index, item in enumerate(items) if item]


def _build_onepage_values(payload: PublicDocumentPayload, lines: list[str]) -> dict[str, str]:
    first_issue = _line_or_distinct_from(payload.issues + payload.current_status, [], "")
    first_solution = _line_or_distinct_from(payload.solutions + payload.actions + payload.requested_action, [], "")
    first_effect = _line_or_distinct_from(payload.expected_effects + payload.requested_action + payload.actions, [], "")
    first_evidence = _line_or(payload.evidence, 0, payload.related)
    second_status = _line_or_distinct_from(payload.current_status + payload.issues[1:] + payload.background, [first_issue], "")
    second_solution = _line_or_distinct_from(
        payload.solutions[1:] + payload.actions + payload.requested_action,
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
        "text_002": payload.document_purpose or f"{payload.selected_format} 보고",
        "text_003": f"<공무원, {_safe_date_label()}>",
        "text_004": "□ 개요",
        "text_005": _line_or(payload.summary, 0, payload.document_purpose),
        "text_006": _line_or_distinct_from(payload.summary[1:] + payload.background, [_line_or(payload.summary, 0, payload.document_purpose)], ""),
        "text_007": first_background,
        "text_008": intro_note,
        "text_009": "□ 현황 및 쟁점",
        "text_010": first_issue,
        "text_011": second_status,
        "text_012": third_issue,
        "text_013": issue_note,
        "text_014": "□ 조치안",
        "text_015": first_solution,
        "text_016": second_solution,
        "text_017": third_solution,
        "text_018": solution_note,
        "text_019": "□ 기대효과 및 요청",
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
    _fill_numbered_text_tokens(values, lines, start=30, end=35)
    return _normalize_onepage_skeleton_values(values)


def _build_gongmun_values(payload: PublicDocumentPayload) -> dict[str, object]:
    evidence = _evidence_items(payload)
    summary_items = [f"가. {_line_or(payload.summary, 0, '주요 내용')}", f"나. {_line_or(payload.solutions, 0, '조치 계획')}"]
    summary_items.extend(f"{label}. {item}" for label, item in zip(["다", "라", "마", "바", "사"], payload.summary[1:] + payload.solutions[1:]))
    issue_items = _numbered_items(payload.issues or ["현황 정리"])
    action_items = _lettered_items(payload.actions or payload.requested_action or ["후속 조치"])
    evidence_parent_items = [f"(1) {_line_or(evidence, 0, '근거자료 확인')}"]
    evidence_child_items = _circled_items(evidence[1:] or ["연결 파일 참고"])
    attachment_items = [f"붙임: {item} 1부" for item in evidence[:6]] or ["붙임: 관련자료 1부"]
    main_body_items = _dedupe_non_empty(
        [
            f"1. {payload.document_purpose or '관련 사항입니다.'}",
            "2. 주요 내용은 다음과 같습니다.",
            *summary_items,
            f"3. {_line_or(payload.requested_action, 0, '아래와 같이 검토 또는 조치를 요청합니다.')}",
            f"4. 기대효과: {_line_or(payload.expected_effects, 0, '후속 절차를 명확히 합니다.')}",
        ]
    )
    return {
        "표지_제목": payload.title,
        "text_001": "로컬 AI 업무 에이전트",
        "text_002": "",
        "text_003": "공무원",
        "text_004": "수신",
        "수신자": payload.recipient,
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
        "본문": main_body_items,
        "본문_가나": summary_items,
        "본문_1)": issue_items,
        "본문_가)": action_items,
        "본문_(1)": evidence_parent_items,
        "본문_①": evidence_child_items,
        "붙임": attachment_items,
    }


def _build_full_report_values(payload: PublicDocumentPayload) -> dict[str, str]:
    background_items = _dedupe_non_empty(payload.summary + payload.background)
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
        ("본문_절_001", "본문_항목_001", "본문_세부_001", "본문_주석_001", "□ 추진배경", background_items),
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
        values[detail_token] = _direct_marker_value(_line_or(items, 1, ""), "   - ", BULLET_MARKERS)
        values[note_token] = _direct_marker_value(_line_or(items, 2, ""), "       ※ ", ASTERISK_MARKERS)
    for index in range(1, 13):
        values.setdefault(f"일정표_셀_{index:03d}", "")
    return values


def _build_email_values(payload: PublicDocumentPayload, lines: list[str]) -> dict[str, str]:
    evidence = _evidence_items(payload)
    summary_items = [payload.document_purpose, *payload.summary] if payload.document_purpose else payload.summary
    follow_up_items = _dedupe_non_empty(payload.actions[:1] + payload.expected_effects + payload.actions[1:])
    email_summary_items = _email_context_slots(
        _prioritize_email_context(
            summary_items + payload.background + payload.current_status + payload.issues,
            preferred_tokens=["GraphRAG", "지식폴더"],
        )
    )
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
        "text_005": "1. 핵심 요약",
        "text_006": _bullet_value(email_summary_items, 0, payload.document_purpose),
        "text_007": _bullet_value(email_summary_items, 1),
        "text_008": "2. 요청사항",
        "text_009": _bullet_value(payload.requested_action, 0, "검토 요청"),
        "text_010": _bullet_value(payload.requested_action, 1),
        "text_011": f"- 요청 기한: {payload.deadline}",
        "text_012": "3. 근거 및 연결 파일",
        "text_013": _bullet_value(email_evidence_items, 0, payload.related),
        "text_014": _bullet_value(email_evidence_items, 1),
        "text_015": "4. 후속 안내",
        "text_016": _bullet_value(follow_up_items, 0),
        "text_017": _bullet_value(follow_up_items, 1),
    }
    _fill_numbered_text_tokens(values, lines, start=18, end=24)
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
    normalized = re.sub(r"^(요약|핵심|내용|조치|후속\s*조치|기대효과|요청)\s*[:：]\s*", "", normalized)
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
    return any(marker.lower() in normalized_lower for marker in INTERNAL_AUTHORING_MARKERS)


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
    lines += _section("I. 추진배경 및 목적", _dedupe_non_empty(payload.summary + payload.background))
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
    lines.append(f"- 요청 기한: {payload.deadline}")
    lines.append("")
    lines.append("감사합니다.")
    lines.append("")
    return lines
