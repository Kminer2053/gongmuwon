from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Literal, cast

from hwpx import HwpxDocument


PublicDocumentFormat = Literal["officialMemo", "onePageReport", "fullReport", "email"]
DocumentFormat = Literal["auto", "officialMemo", "onePageReport", "fullReport", "email"]


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
    session_lines = sections.get("업무대화 세션", [])
    conversation_lines = sections.get("업무대화 기록", [])
    linked_file_lines = sections.get("세션 연결 파일", [])
    direct_file_lines = sections.get("직접 연결 파일", [])
    reference_lines = sections.get("참고자료", []) + linked_file_lines + direct_file_lines
    evidence_lines = _dedupe_non_empty(
        session_lines + conversation_lines + linked_file_lines + direct_file_lines + sections.get("참고자료", [])
    )
    requested_action_lines = [requested_action] if requested_action.strip() else _first_non_empty(
        sections,
        ["후속 조치", "결정 사항", "권고안", "요청사항", "작성 슬롯"],
    )
    solutions = _first_non_empty(
        sections,
        ["후속 조치", "결정 사항", "권고안", "해결방안", "조치사항"],
    )
    pick = lambda keys, fallback=None: _apply_writing_principles(_first_non_empty(sections, keys, fallback=fallback))

    return PublicDocumentPayload(
        title=title or sections.get("_title", ["공무 업무 문서"])[0],
        document_purpose=purpose,
        selected_format=selected_format,
        summary=pick(["바로 작성 개요", "세션 기반 작성 개요", "핵심 내용", "회의 목적", "검토 배경", "업무대화 세션", "개요"]),
        background=pick(["바로 작성 개요", "세션 기반 작성 개요", "검토 배경", "회의 목적", "개요"]),
        current_status=pick(["업무대화 기록", "핵심 내용", "논의 안건"]),
        issues=pick(["핵심 내용", "논의 안건", "검토 의견", "문제점", "바로 작성 개요", "세션 기반 작성 개요"]),
        solutions=_apply_writing_principles(solutions),
        expected_effects=pick(
            ["기대효과"],
            fallback=["후속 절차를 명확히 하고 업무 이력을 재사용할 수 있습니다."],
        ),
        actions=pick(["후속 조치", "결정 사항", "권고안", "조치사항"]),
        requested_action=_apply_writing_principles(requested_action_lines),
        evidence=evidence_lines,
        quality_checks=_public_document_quality_checks(),
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

    document = _open_template_document(user_template_path)
    if user_template_path:
        document.add_paragraph("")
        document.add_paragraph("---- 공무 워크스페이스 생성 내용 ----")
    for line in lines:
        document.add_paragraph(line)
    document.save_to_path(output_path)
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    return {
        "path": str(output_path),
        "markdown_path": str(markdown_path),
        "format": payload.selected_format,
    }


def _open_template_document(user_template_path: str | None) -> HwpxDocument:
    if not user_template_path:
        return HwpxDocument.new()
    path = Path(user_template_path)
    if not path.exists():
        raise ValueError("사용자 양식 파일을 찾을 수 없습니다.")
    return HwpxDocument.open(path)


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
        values = [value for value in sections.get(key, []) if value.strip()]
        if values:
            return values
    return fallback or ["Content Base 내용을 기준으로 정리합니다."]


def _dedupe_non_empty(items: list[str]) -> list[str]:
    seen: set[str] = set()
    results: list[str] = []
    for item in items:
        value = item.strip()
        if not value or value in seen:
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


def _public_document_quality_checks() -> list[str]:
    return [
        "두괄식: 결론과 요청사항을 앞부분에 배치했습니다.",
        "개조식: 문단을 짧은 항목으로 나누어 빠르게 읽히도록 정리했습니다.",
        "한 문장 한 핵심: 긴 서술 대신 판단 단위를 분리했습니다.",
        "적/의/것/들: 불필요한 표현을 줄여 공공문서 문체로 압축했습니다.",
    ]


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
    lines += _section("7. 작성 품질 점검", payload.quality_checks)
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
    lines.append("4. 작성 품질 점검")
    for item in payload.quality_checks:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("5. 문의: 담당 부서")
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
    lines.append("IX. 작성 품질 점검")
    lines.append("")
    lines += _section("I. 추진배경 및 목적", payload.background)
    lines += _section("II. 현황", payload.current_status)
    lines += _section("III. 쟁점", payload.issues)
    lines += _section("IV. 해결방안", payload.solutions)
    lines += _section("V. 기대효과", payload.expected_effects)
    lines += _section("VI. 조치사항", payload.actions)
    lines += _section("VII. 요청사항", payload.requested_action)
    lines += _section("VIII. 근거 및 연결자료", _evidence_items(payload))
    lines += _section("IX. 작성 품질 점검", payload.quality_checks)
    return lines


def _render_email(payload: PublicDocumentPayload) -> list[str]:
    lines = [f"제목: {payload.title}", "", f"수신: {payload.recipient}", f"발신: {payload.sender}", ""]
    lines += _metadata_lines(payload)
    lines += _section("요지", payload.summary)
    lines += _section("요청사항", payload.requested_action)
    lines += _section("근거 및 연결자료", _evidence_items(payload))
    lines += _section("작성 품질 점검", payload.quality_checks)
    lines.append(f"- 요청 기한: {payload.deadline}")
    lines.append("")
    lines.append("감사합니다.")
    lines.append("")
    return lines
