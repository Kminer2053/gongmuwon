from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


FileExcerptReader = Callable[[str], str | None]


FORMAT_LABELS = {
    "auto": "자동 선택",
    "officialMemo": "시행문",
    "onePageReport": "1페이지 보고서",
    "fullReport": "풀버전 보고서",
    "email": "이메일",
}


@dataclass(frozen=True)
class DocumentEvidence:
    kind: str
    label: str
    value: str
    excerpt: str = ""
    path: str = ""
    source: str = ""


@dataclass(frozen=True)
class DocumentBrief:
    title: str
    purpose: str
    instruction: str
    document_format: str
    source_mode: str
    summary: list[str]
    background: list[str]
    current_status: list[str]
    issues: list[str]
    solutions: list[str]
    expected_effects: list[str]
    actions: list[str]
    requested_action: list[str]
    evidence: list[DocumentEvidence]
    quality_checks: list[str]

    def evidence_summary(self) -> list[str]:
        return [
            f"{item.label}: {item.excerpt or item.path or item.value}"
            for item in self.evidence
        ] or ["연결 근거자료 없음"]


@dataclass(frozen=True)
class DocumentPlan:
    selected_format: str
    format_label: str
    writing_strategy: list[str]
    sections: list[tuple[str, list[str]]]
    quality_checks: list[str]


def compile_document_brief(
    *,
    title: str,
    purpose: str,
    outline: str,
    document_format: str,
    session_context: dict[str, Any] | None,
    references: list[str],
    direct_file_paths: list[str],
    slots: dict[str, str],
    file_excerpt_reader: FileExcerptReader,
    knowledge_items: list[dict[str, Any]] | None = None,
) -> DocumentBrief:
    raw_instruction = _clean(outline or purpose or title)
    instruction = _instruction_summary(
        raw_instruction,
        document_format=document_format,
        has_session=bool(session_context),
    )
    messages = _session_messages(session_context)
    schedule = _schedule_evidence(session_context)
    session = (session_context or {}).get("session") if session_context else None
    file_evidence = _file_evidence(session_context, direct_file_paths, file_excerpt_reader)
    reference_evidence = _reference_evidence(references)
    knowledge_evidence = _knowledge_evidence(knowledge_items or [])
    evidence = _dedupe_evidence(schedule + file_evidence + reference_evidence + knowledge_evidence)

    topic_lines = _topic_lines(messages, instruction)
    session_title = _clean(str(session.get("title", ""))) if session else ""
    requested_action = _clean(slots.get("requested_action", "")) or _infer_requested_action(instruction)
    schedule_lines = [item.value for item in schedule]
    knowledge_titles = [item.label for item in knowledge_evidence if item.label]
    file_titles = [item.label for item in file_evidence if item.label]
    evidence_excerpts = [item.excerpt for item in evidence if item.excerpt]

    summary = _dedupe_non_empty(
        [
            f"문서작성 방향: {instruction}" if instruction else "",
            f"대상 세션: {session_title}" if session_title else "",
            f"연결 일정: {schedule_lines[0]}" if schedule_lines else "",
            f"지식폴더 근거: {', '.join(knowledge_titles[:3])}" if knowledge_titles else "",
            *topic_lines[:3],
        ]
    )
    background = _dedupe_non_empty(
        [
            purpose,
            f"{session_title}의 대화내용, 연결 일정, 연결 파일, 지식폴더 근거를 종합합니다."
            if session_title
            else "사용자가 입력한 작업설명과 연결 파일을 종합합니다.",
            *topic_lines[:2],
        ]
    )
    current_status = _dedupe_non_empty(
        [
            *schedule_lines,
            *[f"연결 파일: {name}" for name in file_titles[:4]],
            *[f"지식 근거: {name}" for name in knowledge_titles[:4]],
            *evidence_excerpts[:3],
        ]
    )
    issues = _dedupe_non_empty(
        [
            *_risk_lines(messages + evidence_excerpts),
            "근거 문서와 대화 이력을 함께 제시해야 이후 검토 과정에서 추적성을 확보할 수 있습니다."
            if evidence
            else "문서작성 근거가 부족하므로 추가 자료 연결이 필요합니다.",
        ]
    )
    solutions = _dedupe_non_empty(
        [
            "보고서에는 대화세션의 요청사항, 연결 일정, 연결 파일, 지식폴더 근거를 분리해 배치합니다.",
            "핵심 판단은 앞부분에 두고 세부 근거는 수집 근거 섹션에 명시합니다.",
            requested_action,
        ]
    )
    expected_effects = _dedupe_non_empty(
        [
            "업무대화에서 수집한 맥락을 재사용해 보고서 초안 품질과 추적성을 높입니다.",
            "출처 문서와 연결 파일을 함께 남겨 후속 검토 시간을 줄입니다.",
        ]
    )
    actions = _dedupe_non_empty(
        [
            requested_action,
            "필요 시 원문 파일을 열어 수치와 문구를 최종 확인합니다." if evidence else "",
        ]
    )

    return DocumentBrief(
        title=title,
        purpose=purpose,
        instruction=instruction,
        document_format=document_format,
        source_mode="session" if session_context else "direct",
        summary=summary or ["입력된 목적과 자료를 기준으로 문서 초안을 구성합니다."],
        background=background or ["문서작성 배경을 입력 자료 기준으로 정리합니다."],
        current_status=current_status or ["현재 연결된 자료를 기준으로 현황을 정리합니다."],
        issues=issues or ["쟁점은 추가 검토가 필요한 항목 중심으로 정리합니다."],
        solutions=solutions or ["후속 조치와 요청사항을 명확히 제시합니다."],
        expected_effects=expected_effects,
        actions=actions or ["검토 후 후속 조치를 확정합니다."],
        requested_action=[requested_action] if requested_action else ["검토 요청"],
        evidence=evidence,
        quality_checks=_public_doc_quality_checks(),
    )


def build_document_plan(brief: DocumentBrief) -> DocumentPlan:
    selected_format = _selected_format(brief.document_format, brief.title, brief.purpose)
    label = FORMAT_LABELS.get(selected_format, selected_format)
    if selected_format == "officialMemo":
        sections = [
            ("관련 근거", brief.evidence_summary()),
            ("요청 내용", brief.requested_action + brief.solutions[:2]),
            ("조치 기한", brief.actions),
        ]
    elif selected_format == "fullReport":
        sections = [
            ("추진배경 및 목적", brief.background),
            ("현황 및 쟁점", brief.current_status + brief.issues),
            ("해결방안", brief.solutions),
            ("기대효과 및 조치사항", brief.expected_effects + brief.actions),
            ("근거 및 연결자료", brief.evidence_summary()),
        ]
    elif selected_format == "email":
        sections = [
            ("핵심 안내", brief.summary),
            ("요청사항", brief.requested_action + brief.actions),
            ("첨부 및 근거", brief.evidence_summary()),
        ]
    else:
        sections = [
            ("보고요지", brief.summary),
            ("배경·현황", brief.background + brief.current_status),
            ("주요내용·검토", brief.issues),
            ("향후계획·요청사항", brief.solutions + brief.actions + brief.expected_effects),
            ("근거 및 연결자료", brief.evidence_summary()),
        ]
    return DocumentPlan(
        selected_format=selected_format,
        format_label=label,
        writing_strategy=[
            "두괄식: 결론과 요청사항을 앞부분에 배치합니다.",
            "개조식: 긴 설명을 항목 단위로 나눕니다.",
            "한 문장 한 핵심: 문장마다 하나의 판단만 담습니다.",
            "출처 분리: 대화, 일정, 파일, 지식폴더 근거를 구분해 남깁니다.",
        ],
        sections=sections,
        quality_checks=brief.quality_checks,
    )


def render_brief_markdown(brief: DocumentBrief, plan: DocumentPlan) -> list[str]:
    lines: list[str] = [
        "## WorkSessionBrief",
        f"- 작성 지시: {brief.instruction or brief.purpose}",
        f"- 입력 경로: {'업무대화 세션' if brief.source_mode == 'session' else '바로 작성'}",
        f"- 출력 형식: {plan.format_label} ({plan.selected_format})",
        "",
    ]
    lines += _section("## 핵심 내용", brief.summary)
    lines += [
        "## DocumentPlan",
        *[f"- 작성 전략: {item}" for item in plan.writing_strategy],
        *[
            f"- 섹션: {title} - {_join_preview(items)}"
            for title, items in plan.sections
            if _join_preview(items)
        ],
        "",
    ]
    lines += _section("## 현황 및 쟁점", brief.current_status + brief.issues)
    lines += _section("## 조치안", brief.solutions + brief.actions)
    lines += _section("## 기대효과 및 요청", brief.expected_effects + brief.requested_action)
    lines += ["## 수집 근거"]
    if brief.evidence:
        for item in brief.evidence:
            value = item.path or item.value
            lines.append(f"- [{item.kind}] {item.label}: {value}")
            if item.excerpt:
                lines.append(f"  - 내용: {item.excerpt}")
    else:
        lines.append("- 아직 연결된 근거자료가 없습니다.")
    lines.append("")
    lines += _section("## 작성 품질 점검", brief.quality_checks)
    return lines


def _section(title: str, items: list[str]) -> list[str]:
    lines = [title]
    values = _dedupe_non_empty(items)
    if values:
        lines.extend(f"- {item}" for item in values)
    else:
        lines.append("- 입력 자료를 기준으로 정리합니다.")
    lines.append("")
    return lines


def _session_messages(context: dict[str, Any] | None) -> list[str]:
    messages = []
    for message in (context or {}).get("messages") or []:
        role = "사용자" if message.get("role") == "user" else "어시스턴트"
        text = _clean(str(message.get("text", "")))
        if text:
            messages.append(f"{role}: {text}")
    return messages


def _schedule_evidence(context: dict[str, Any] | None) -> list[DocumentEvidence]:
    schedule = (context or {}).get("schedule") if context else None
    if not schedule:
        return []
    value = f"{schedule.get('title')} ({schedule.get('starts_at')} ~ {schedule.get('ends_at')})"
    return [DocumentEvidence(kind="schedule", label=str(schedule.get("title") or "연결 일정"), value=value)]


def _file_evidence(
    context: dict[str, Any] | None,
    direct_file_paths: list[str],
    file_excerpt_reader: FileExcerptReader,
) -> list[DocumentEvidence]:
    evidence: list[DocumentEvidence] = []
    for link in (context or {}).get("file_links") or []:
        path = str(link.get("file_path") or "")
        label = str(link.get("label") or Path(path).name or path)
        excerpt = file_excerpt_reader(path) or ""
        evidence.append(DocumentEvidence(kind="session-file", label=label, value=path, path=path, excerpt=excerpt))
    for path in direct_file_paths:
        label = Path(path).name or path
        excerpt = file_excerpt_reader(path) or ""
        evidence.append(DocumentEvidence(kind="direct-file", label=label, value=path, path=path, excerpt=excerpt))
    return evidence


def _reference_evidence(references: list[str]) -> list[DocumentEvidence]:
    evidence: list[DocumentEvidence] = []
    for line in references:
        text = _clean(line.lstrip("- "))
        if not text or "아직 연결되지 않았습니다" in text:
            continue
        label, value = _split_reference_line(text)
        evidence.append(DocumentEvidence(kind="reference", label=label, value=value, path=value if _looks_like_path(value) else ""))
    return evidence


def _knowledge_evidence(items: list[dict[str, Any]]) -> list[DocumentEvidence]:
    evidence: list[DocumentEvidence] = []
    for item in items:
        document = item.get("document") or {}
        chunk = item.get("chunk") or {}
        title = _clean(str(document.get("title") or item.get("title") or "지식폴더 근거"))
        path = _clean(str(document.get("file_path") or item.get("file_path") or ""))
        excerpt = _clean(str(item.get("text") or chunk.get("text") or item.get("excerpt") or ""))
        relations = item.get("relations") or []
        if relations:
            relation_text = ", ".join(
                _clean(f"{rel.get('relation', '')} {rel.get('target_label', '')}") for rel in relations[:3]
            )
            excerpt = _clean(f"{excerpt} 관련 관계: {relation_text}")
        evidence.append(DocumentEvidence(kind="knowledge", label=title, value=path or title, path=path, excerpt=excerpt))
    return evidence


def _topic_lines(messages: list[str], instruction: str) -> list[str]:
    text = " ".join(messages + [instruction])
    results: list[str] = []
    if any(token in text for token in ["프롬프트", "Prompt", "prompt"]):
        results.append("프롬프트 관련 자료와 작성 원칙을 중심으로 검토했습니다.")
    if "일정" in text or "회의" in text:
        results.append("회의 일정과 후속 검토 흐름을 함께 반영했습니다.")
    if "파일찾기" in text or "파일" in text:
        results.append("파일찾기와 연결 파일을 문서작성 근거로 활용합니다.")
    if "GraphRAG" in text or "지식폴더" in text:
        results.append("지식폴더 GraphRAG 근거를 출처와 함께 반영합니다.")
    return results


def _risk_lines(values: list[str]) -> list[str]:
    risks: list[str] = []
    text = " ".join(values)
    if "403" in text or "upgrade_required" in text:
        risks.append("외부 LLM API 권한 오류가 발생할 수 있어 로컬 모델 또는 구독 상태 확인이 필요합니다.")
    if "민감정보" in text or "비밀번호" in text or "API key" in text.lower():
        risks.append("민감정보는 보고서 본문에 그대로 노출하지 않고 보호 처리해야 합니다.")
    if "GraphRAG" in text or "지식폴더" in text:
        risks.append("GraphRAG 근거는 문서명과 원문 위치를 함께 남겨야 합니다.")
    return risks


def _infer_requested_action(instruction: str) -> str:
    if "검토" in instruction:
        return "검토 요청"
    if "등록" in instruction:
        return "등록 결과 확인"
    if "보고" in instruction or "보고서" in instruction:
        return "보고 및 후속 조치 검토"
    return "검토 요청"


def _instruction_summary(instruction: str, *, document_format: str, has_session: bool) -> str:
    if not instruction:
        return ""
    lowered = instruction.lower()
    has_document_marker = any(
        marker in lowered for marker in ["문서작성", "hwpx", "hwp", "document", "report"]
    ) or any(marker in instruction for marker in ["보고서", "공문", "시행문", "이메일"])
    has_action_marker = any(
        marker in instruction for marker in ["작성", "생성", "만들", "정리", "파일로", "뽑아"]
    )
    if has_document_marker and has_action_marker:
        format_label = FORMAT_LABELS.get(_selected_format(document_format, instruction, ""), "공공문서")
        source_label = "업무대화 세션 내용" if has_session else "입력 자료와 연결 파일"
        return f"{source_label}을 {format_label} 형식으로 구조화"
    return instruction


def _selected_format(document_format: str, title: str, purpose: str) -> str:
    if document_format and document_format != "auto":
        return document_format
    text = f"{title} {purpose}"
    if any(token in text for token in ["시행", "공문", "협조"]):
        return "officialMemo"
    if any(token in text for token in ["이메일", "메일"]):
        return "email"
    if "풀버전" in text or "상세" in text:
        return "fullReport"
    return "onePageReport"


def _split_reference_line(text: str) -> tuple[str, str]:
    if ": " in text:
        left, right = text.split(": ", 1)
        return _clean(left), _clean(right)
    return text, text


def _looks_like_path(value: str) -> bool:
    return bool(re.search(r"^[A-Za-z]:[\\/]", value) or "/" in value or "\\" in value)


def _join_preview(items: list[str], limit: int = 160) -> str:
    return _truncate(" / ".join(_dedupe_non_empty(items)[:3]), limit)


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _truncate(value: str, limit: int = 700) -> str:
    text = _clean(value)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _dedupe_non_empty(items: list[str]) -> list[str]:
    seen: set[str] = set()
    results: list[str] = []
    for item in items:
        value = _truncate(item)
        if not value or value in seen:
            continue
        seen.add(value)
        results.append(value)
    return results


def _dedupe_evidence(items: list[DocumentEvidence]) -> list[DocumentEvidence]:
    seen: set[tuple[str, str, str]] = set()
    results: list[DocumentEvidence] = []
    for item in items:
        key = (item.kind, item.label, item.path or item.value)
        if key in seen:
            continue
        seen.add(key)
        results.append(
            DocumentEvidence(
                kind=item.kind,
                label=_truncate(item.label, 120),
                value=_truncate(item.value, 240),
                excerpt=_truncate(item.excerpt, 700),
                path=item.path,
                source=item.source,
            )
        )
    return results


def _public_doc_quality_checks() -> list[str]:
    return [
        "두괄식: 결론과 요청사항을 앞부분에 배치했습니다.",
        "개조식: 문단을 짧은 항목으로 나누어 빠르게 읽히도록 정리했습니다.",
        "한 문장 한 핵심: 긴 서술 대신 판단 단위를 분리했습니다.",
        "적/의/것/들: 불필요한 표현을 줄여 공공문서 문체로 압축했습니다.",
    ]
