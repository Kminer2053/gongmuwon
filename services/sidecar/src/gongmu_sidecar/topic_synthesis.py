"""F-09 백과사전 종합 — 문서≥2 주제를 나무위키식 골격으로 종합 서술한다 (Wave D).

GraphRAG의 Community Summaries 방법론을 로컬-경량모델 제품에 이식:
주제 소속 문서들의 (제목·날짜·요약 or 추출본 발췌)를 컨텍스트 예산 내로 압축해
LLM 1회 호출로 골격 JSON(개요/핵심내용/경과/문서별요점/연관주제)을 만들고,
pydantic 검증 + 1회 repair 후 저장한다(문서작성 파이프라인과 동일 패턴).

경량모델(gemma-4-E2B) 대응 원칙:
- 지능은 빌드타임에: 백그라운드 보강에서 주제당 1호출, 입력은 ≤2.5k자로 절단.
- 실패 허용: 종합 실패 주제는 링크 목록 유지(dirty 유지 → 다음 보강 재시도).
- 결정적 부분(각주 번호·연표 정렬·렌더)은 코드로, 서술만 LLM.

설계 근거: docs/design/2026-07-11-wiki-encyclopedia-redesign.md §구현 사양 2.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, Field, ValidationError

# 종합 대상 최소 문서 수 — 싱글턴 주제는 종합을 생략하고 문서 카드 링크만 둔다.
SYNTHESIS_MIN_DOCS = 2
# 입력 압축 예산: 최대 8건 × 발췌 500자, 발췌 총량 2.5k자.
MAX_INPUT_DOCS = 8
DOC_EXCERPT_CHARS = 500
TOTAL_INPUT_CHARS = 2500


# ---------------------------------------------------------------- 골격 스키마


class TopicKeyPoint(BaseModel):
    """핵심 내용 소주제 1건 — 서술 뒤에 근거 번호 각주 [n]가 붙는다."""

    subtopic: str = Field(min_length=1)
    narrative: str = Field(min_length=1)
    evidence: list[int] = Field(default_factory=list)


class TopicTimelineEntry(BaseModel):
    """경과(연표) 1건 — 날짜는 근거 문서의 날짜에서만 가져오게 유도한다."""

    date: str = ""
    event: str = Field(min_length=1)
    evidence: list[int] = Field(default_factory=list)


class TopicDocPoint(BaseModel):
    """문서별 요점 1건."""

    title: str = Field(min_length=1)
    point: str = Field(min_length=1)
    evidence: list[int] = Field(default_factory=list)


class TopicSynthesis(BaseModel):
    """주제 페이지 골격 JSON — 렌더는 render_topic_synthesis_lines가 결정적으로 수행."""

    definition: str = ""
    overview: str = Field(min_length=1)
    key_points: list[TopicKeyPoint] = Field(default_factory=list)
    timeline: list[TopicTimelineEntry] = Field(default_factory=list)
    doc_points: list[TopicDocPoint] = Field(default_factory=list)
    related_topics: list[str] = Field(default_factory=list)


# ------------------------------------------------------------ 프롬프트 조립


def _clean_line(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def build_synthesis_messages(topic: str, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """주제 종합 프롬프트 — 근거 발췌는 [n] 번호로 제시하고 각주 재인용을 유도한다."""
    evidence_lines: list[str] = []
    used_chars = 0
    for source in sources[:MAX_INPUT_DOCS]:
        index = int(source.get("index") or 0)
        title = _clean_line(source.get("title"))
        date = _clean_line(source.get("date"))
        excerpt = _clean_line(source.get("excerpt"))[:DOC_EXCERPT_CHARS]
        # 발췌 총량 예산(≤2.5k자) 내 절단 — 제목 줄은 남기고 발췌만 줄인다.
        remaining = TOTAL_INPUT_CHARS - used_chars
        if remaining <= 0:
            excerpt = ""
        elif len(excerpt) > remaining:
            excerpt = excerpt[:remaining]
        used_chars += len(excerpt)
        header = f"[{index}] {title}" + (f" ({date})" if date else "")
        evidence_lines.append(header)
        if excerpt:
            evidence_lines.append(f"    발췌: {excerpt}")
    system_text = (
        "당신은 공공기관 문서 사서입니다. 아래 근거 문서 발췌만 사용해 "
        f"주제 '{topic}'의 백과사전 항목을 한국어 JSON 하나로 작성하세요.\n"
        "출력 형식(JSON only):\n"
        "{\n"
        '  "definition": "한 줄 정의",\n'
        '  "overview": "2~4문장 개요(정의·맥락)",\n'
        '  "key_points": [{"subtopic": "소주제", "narrative": "종합 서술", "evidence": [1, 2]}],\n'
        '  "timeline": [{"date": "YYYY-MM-DD", "event": "사건/결정", "evidence": [3]}],\n'
        '  "doc_points": [{"title": "문서제목", "point": "핵심 1줄", "evidence": [1]}],\n'
        '  "related_topics": ["연관 주제"]\n'
        "}\n"
        "규칙: evidence는 아래 근거 번호만 사용. 근거에 없는 사실·날짜는 만들지 말 것. "
        "timeline은 날짜를 아는 항목만. key_points는 1~4개, doc_points는 문서당 1줄.\n\n"
        "[근거 문서]\n" + "\n".join(evidence_lines)
    )
    return [
        {"role": "system", "text": system_text},
        {"role": "user", "text": f"주제 '{topic}' 백과사전 JSON을 출력하세요."},
    ]


# ------------------------------------------------------- 호출·검증·repair


def _extract_json_payload(raw: Any) -> dict[str, Any] | None:
    if not raw:
        return None
    match = re.search(r"\{.*\}", str(raw), re.DOTALL)
    if not match:
        return None
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _validation_hints(exc: ValidationError) -> str:
    hints = []
    for error in exc.errors()[:5]:
        location = ".".join(str(part) for part in error.get("loc", ()))
        hints.append(f"{location}: {error.get('msg', '')}")
    return "; ".join(hints)


def synthesize_topic(
    *,
    topic: str,
    sources: list[dict[str, Any]],
    llm: Callable[[list[dict[str, Any]]], str | None],
) -> dict[str, Any] | None:
    """주제 1건 종합 — 검증 실패 시 1회 repair, 그래도 실패면 None(조용히 링크 목록 유지)."""
    if len(sources) < SYNTHESIS_MIN_DOCS:
        return None
    messages = build_synthesis_messages(topic, sources)
    try:
        raw = llm(messages)
    except Exception:  # noqa: BLE001 - LLM 실패는 종합 생략으로 흡수
        return None
    payload = _extract_json_payload(raw)
    hint = "JSON 객체를 찾지 못했습니다"
    if payload is not None:
        try:
            return TopicSynthesis.model_validate(payload).model_dump()
        except ValidationError as exc:
            hint = _validation_hints(exc)
    # 1회 repair — 실패 원인을 한국어 힌트로 되돌려 재요청한다.
    repair_messages = [
        *messages,
        {"role": "assistant", "text": str(raw or "")[:2000]},
        {
            "role": "user",
            "text": (
                "위 출력은 요구한 JSON 스키마를 만족하지 않습니다"
                f" ({hint}). 설명 없이 스키마에 맞는 JSON 하나만 다시 출력하세요."
            ),
        },
    ]
    try:
        repaired_raw = llm(repair_messages)
    except Exception:  # noqa: BLE001
        return None
    repaired = _extract_json_payload(repaired_raw)
    if repaired is None:
        return None
    try:
        return TopicSynthesis.model_validate(repaired).model_dump()
    except ValidationError:
        return None


# ------------------------------------------------------------------- 렌더


def _citation_suffix(evidence: Any, valid_indexes: set[int]) -> str:
    """근거 번호 각주 — 결정적, 유효 번호만 오름차순으로."""
    numbers: set[int] = set()
    if isinstance(evidence, list):
        for value in evidence:
            try:
                number = int(value)
            except (TypeError, ValueError):
                continue
            if number in valid_indexes:
                numbers.add(number)
    if not numbers:
        return ""
    return " " + "".join(f"[{number}]" for number in sorted(numbers))


def render_topic_synthesis_lines(
    synthesis: dict[str, Any], sources: list[dict[str, Any]]
) -> list[str]:
    """백과사전 골격 마크다운(사양서 §골격) — 서술만 LLM, 구조·각주는 코드가 보장한다.

    반환 lines는 `# {주제}` 표제 다음에 이어붙인다. 근거 문서 각주 [n]는
    저장 시점의 sources 스냅샷을 사용해 evidence 번호와 항상 일치한다.
    """
    valid_indexes = {int(source.get("index") or 0) for source in sources}
    overview = _clean_line(synthesis.get("overview"))
    definition = _clean_line(synthesis.get("definition"))
    if not definition:
        # 한 줄 정의 폴백: 개요 첫 문장.
        first_sentence = re.split(r"(?<=[.!?다])\s+", overview, maxsplit=1)[0]
        definition = first_sentence
    lines: list[str] = []
    if definition:
        lines.append(f"> {definition}")
        lines.append("")
    lines.append("## 개요")
    lines.append(overview)
    lines.append("")
    key_points = [point for point in (synthesis.get("key_points") or []) if isinstance(point, dict)]
    if key_points:
        lines.append("## 핵심 내용")
        for point in key_points:
            subtopic = _clean_line(point.get("subtopic"))
            narrative = _clean_line(point.get("narrative"))
            if not subtopic or not narrative:
                continue
            lines.append(f"### {subtopic}")
            lines.append(narrative + _citation_suffix(point.get("evidence"), valid_indexes))
        lines.append("")
    timeline = [entry for entry in (synthesis.get("timeline") or []) if isinstance(entry, dict)]
    timeline_lines: list[str] = []
    # 연표는 날짜 오름차순으로 결정적 정렬(날짜 없는 항목은 말미).
    for entry in sorted(
        timeline, key=lambda item: (_clean_line(item.get("date")) == "", _clean_line(item.get("date")))
    ):
        event = _clean_line(entry.get("event"))
        if not event:
            continue
        date = _clean_line(entry.get("date"))
        prefix = f"{date} — " if date else ""
        timeline_lines.append(f"- {prefix}{event}{_citation_suffix(entry.get('evidence'), valid_indexes)}")
    if timeline_lines:
        lines.append("## 경과")
        lines.extend(timeline_lines)
        lines.append("")
    doc_points = [point for point in (synthesis.get("doc_points") or []) if isinstance(point, dict)]
    doc_point_lines: list[str] = []
    for point in doc_points:
        title = _clean_line(point.get("title"))
        text = _clean_line(point.get("point"))
        if not title or not text:
            continue
        doc_point_lines.append(f"- **{title}** — {text}{_citation_suffix(point.get('evidence'), valid_indexes)}")
    if doc_point_lines:
        lines.append("## 문서별 요점")
        lines.extend(doc_point_lines)
        lines.append("")
    related = [
        _clean_line(topic) for topic in (synthesis.get("related_topics") or []) if _clean_line(topic)
    ]
    if related:
        lines.append("## 연관 주제")
        lines.append("- " + " · ".join(f"[[{topic}]]" for topic in related))
        lines.append("")
    lines.append("## 근거 문서")
    for source in sources:
        index = int(source.get("index") or 0)
        title = _clean_line(source.get("title")) or "(제목 없음)"
        slug = _clean_line(source.get("slug"))
        source_name = _clean_line(source.get("source_name"))
        link = f"[{title}](../docs/{slug}.md)" if slug else title
        suffix = f" · {source_name}" if source_name else ""
        lines.append(f"[{index}] {link}{suffix}")
    return lines
