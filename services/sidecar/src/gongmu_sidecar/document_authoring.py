"""문서작성 개선 파이프라인 (ax-playground 패턴 이식).

2단계 생성 구조:
  1) organize  — 지시·참고자료·업무대화를 양식과 무관한 구조화 마크다운으로 정리 (LLM)
  2) format    — 정리된 마크다운을 양식별 JSON 스키마로 변환 (LLM + pydantic 검증)
검증 실패 시 한국어 힌트 재요청 1회 → 그래도 실패하면 repair_doc()이
1단계 마크다운에서 개조식 항목을 긁어와 최소 스키마를 채운다. 사용자에게 하드 실패를 돌려주지 않는다.

구조 JSON은 사용자가 검토·수정한 뒤 /build 로 전달되며, 최종 렌더링은
LLM 없이 결정적 코드로 content-base 마크다운을 만들어 기존
content-base → finalize → HWPX 파이프라인(documents.py / hwpx_writer.py)에 넘긴다.

앱 연결(오케스트레이터용):
    from .document_authoring import register_authoring_routes
    # create_app() 안에서 `app.state.services = services` 다음 줄에 추가
    register_authoring_routes(app, services)
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from queue import Queue
from threading import Thread
from time import perf_counter
from typing import Any, Callable, Iterator, cast

from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from .context_budget import assemble_transcript_context
from .hwpx_writer import (
    DocumentFormat,
    embed_structure_marker,
    strip_structure_marker,
    structure_to_lines,
    write_public_hwpx_document,
)
from .llm import LLMGenerationError, generate_session_reply, generate_session_reply_streaming

# LLM 클라이언트 시그니처: (messages, *, temperature) -> str
# messages 는 llm.generate_session_reply 와 동일한 [{"role": ..., "text": ...}] 형식.
AuthoringLLM = Callable[..., str]

FORMAT_KEYS = ("officialMemo", "onePageReport", "fullReport", "email")

FORMAT_ALIASES = {
    "officialmemo": "officialMemo",
    "gongmun": "officialMemo",
    "시행문": "officialMemo",
    "onepagereport": "onePageReport",
    "onepage": "onePageReport",
    "1p": "onePageReport",
    "fullreport": "fullReport",
    "full": "fullReport",
    "email": "email",
    "이메일": "email",
}

_SCHEDULE_PENDING_PATTERN = re.compile(r"미정|추후|TBD", re.IGNORECASE)
_BULLET_PATTERN = re.compile(r"^(?:[-*•◦□·※]|\d+[.)]|[가-하][.)]|[ⅠⅡⅢⅣⅤⅥ][.)]?)\s+(.*)$")


def normalize_format_key(value: str) -> str:
    key = str(value or "").strip()
    if key in FORMAT_KEYS:
        return key
    normalized = FORMAT_ALIASES.get(key.lower())
    if normalized:
        return normalized
    raise ValueError(
        f"지원하지 않는 문서 양식입니다: {value!r} (사용 가능: officialMemo/gongmun, onePageReport/onepage, fullReport/full, email)"
    )


# ---------------------------------------------------------------------------
# 소형 모델 관용 정규화기 (z.preprocess 대응)
# ---------------------------------------------------------------------------


def _coerce_text(value: Any) -> Any:
    """{"text": ...} → str, list → 첫 항목 병합. 문자열은 그대로."""
    if isinstance(value, dict) and "text" in value:
        return str(value["text"])
    if isinstance(value, list):
        parts = [str(_coerce_text(item)).strip() for item in value]
        return " ".join(part for part in parts if part)
    return value


def _blank_to_none(value: Any) -> Any:
    value = _coerce_text(value)
    if isinstance(value, str) and not value.strip():
        return None
    return value


def _coerce_str_list(value: Any) -> Any:
    """string → [string], 줄바꿈 문자열 → 줄 단위 목록, {"text": ...} 요소 허용."""
    if value is None:
        return []
    if isinstance(value, str):
        lines = []
        for raw in value.splitlines():
            line = raw.strip()
            match = _BULLET_PATTERN.match(line)
            if match:
                line = match.group(1).strip()
            if line:
                lines.append(line)
        if lines:
            return lines
        return [value.strip()] if value.strip() else []
    if isinstance(value, dict) and "text" in value:
        return [str(value["text"])]
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            if item is None:
                continue
            text = str(_coerce_text(item)).strip()
            if text:
                out.append(text)
        return out
    return value


# ---------------------------------------------------------------------------
# 양식별 pydantic 스키마
# ---------------------------------------------------------------------------


class OnePageSection(BaseModel):
    heading: str
    items: list[str] = Field(min_length=1)
    detail: str | None = None
    note: str | None = None

    @field_validator("heading", mode="before")
    @classmethod
    def _heading_text(cls, value: Any) -> Any:
        return _coerce_text(value)

    @field_validator("items", mode="before")
    @classmethod
    def _items_list(cls, value: Any) -> Any:
        return _coerce_str_list(value)

    @field_validator("detail", "note", mode="before")
    @classmethod
    def _optional_text(cls, value: Any) -> Any:
        return _blank_to_none(value)


class SchemaOnePage(BaseModel):
    title: str
    subtitle: str | None = None
    summary: str = Field(max_length=200)
    sections: list[OnePageSection] = Field(min_length=2, max_length=5)

    @field_validator("title", mode="before")
    @classmethod
    def _title_text(cls, value: Any) -> Any:
        return _coerce_text(value)

    @field_validator("subtitle", mode="before")
    @classmethod
    def _subtitle_text(cls, value: Any) -> Any:
        return _blank_to_none(value)

    @field_validator("summary", mode="before")
    @classmethod
    def _summary_text(cls, value: Any) -> Any:
        value = _coerce_text(value)
        if isinstance(value, str):
            return value.strip()[:200]
        return value


class FullSection(BaseModel):
    heading: str
    items: list[str] = Field(min_length=1)

    @field_validator("heading", mode="before")
    @classmethod
    def _heading_text(cls, value: Any) -> Any:
        return _coerce_text(value)

    @field_validator("items", mode="before")
    @classmethod
    def _items_list(cls, value: Any) -> Any:
        return _coerce_str_list(value)


class FullChapter(BaseModel):
    heading: str
    sections: list[FullSection] = Field(min_length=1)

    @field_validator("heading", mode="before")
    @classmethod
    def _heading_text(cls, value: Any) -> Any:
        return _coerce_text(value)


class ScheduleRow(BaseModel):
    항목: str
    일정: str
    비고: str | None = None

    @field_validator("항목", "일정", mode="before")
    @classmethod
    def _required_text(cls, value: Any) -> Any:
        return _coerce_text(value)

    @field_validator("비고", mode="before")
    @classmethod
    def _optional_text(cls, value: Any) -> Any:
        return _blank_to_none(value)


class ScheduleTable(BaseModel):
    rows: list[ScheduleRow] = Field(default_factory=list)


def _schedule_row_pending(row: ScheduleRow) -> bool:
    haystack = " ".join(filter(None, [row.항목, row.일정, row.비고 or ""]))
    return bool(_SCHEDULE_PENDING_PATTERN.search(haystack))


class SchemaFull(BaseModel):
    title: str
    summary: list[str] = Field(min_length=1)
    chapters: list[FullChapter] = Field(min_length=3, max_length=6)
    schedule: ScheduleTable | None = None

    @field_validator("title", mode="before")
    @classmethod
    def _title_text(cls, value: Any) -> Any:
        return _coerce_text(value)

    @field_validator("summary", mode="before")
    @classmethod
    def _summary_list(cls, value: Any) -> Any:
        return _coerce_str_list(value)

    @field_validator("schedule", mode="before")
    @classmethod
    def _schedule_shape(cls, value: Any) -> Any:
        if value is None or value == "" or value == {} or value == []:
            return None
        if isinstance(value, list):
            return {"rows": value}
        return value

    @model_validator(mode="after")
    def _filter_schedule(self) -> "SchemaFull":
        # 미정/추후/TBD 행 제거, 2행 미만이면 일정표 자체를 생략
        if self.schedule is not None:
            kept = [row for row in self.schedule.rows if not _schedule_row_pending(row)]
            self.schedule = ScheduleTable(rows=kept) if len(kept) >= 2 else None
        return self


class GongmunItem(BaseModel):
    text: str
    subs: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _string_to_obj(cls, value: Any) -> Any:
        if isinstance(value, str):
            return {"text": value}
        return value

    @field_validator("text", mode="before")
    @classmethod
    def _text(cls, value: Any) -> Any:
        return _coerce_text(value)

    @field_validator("subs", mode="before")
    @classmethod
    def _subs_list(cls, value: Any) -> Any:
        return _coerce_str_list(value)


class SchemaGongmun(BaseModel):
    title: str
    receiver: str
    opening: str
    items: list[GongmunItem] = Field(min_length=1)
    attachments: list[str] = Field(default_factory=list)
    sender: str | None = None

    @field_validator("title", "receiver", "opening", mode="before")
    @classmethod
    def _required_text(cls, value: Any) -> Any:
        return _coerce_text(value)

    @field_validator("attachments", mode="before")
    @classmethod
    def _attachments_list(cls, value: Any) -> Any:
        return _coerce_str_list(value)

    @field_validator("sender", mode="before")
    @classmethod
    def _sender_text(cls, value: Any) -> Any:
        return _blank_to_none(value)


class SchemaEmail(BaseModel):
    subject: str
    greeting: str | None = None
    body_paragraphs: list[str] = Field(min_length=1)
    closing: str | None = None
    signature: str | None = None

    @field_validator("subject", mode="before")
    @classmethod
    def _subject_text(cls, value: Any) -> Any:
        return _coerce_text(value)

    @field_validator("body_paragraphs", mode="before")
    @classmethod
    def _body_list(cls, value: Any) -> Any:
        return _coerce_str_list(value)

    @field_validator("greeting", "closing", "signature", mode="before")
    @classmethod
    def _optional_text(cls, value: Any) -> Any:
        return _blank_to_none(value)


FORMAT_SCHEMAS: dict[str, type[BaseModel]] = {
    "officialMemo": SchemaGongmun,
    "onePageReport": SchemaOnePage,
    "fullReport": SchemaFull,
    "email": SchemaEmail,
}


# ---------------------------------------------------------------------------
# 검증 오류 → 한국어 힌트
# ---------------------------------------------------------------------------


def validation_error_hints(exc: ValidationError) -> list[str]:
    hints: list[str] = []
    for err in exc.errors():
        loc = ".".join(str(part) for part in err.get("loc", ()))
        err_type = err.get("type", "")
        ctx = err.get("ctx") or {}
        if err_type == "missing":
            message = "필수 항목 누락"
        elif err_type == "too_short":
            message = f"항목 부족(최소 {ctx.get('min_length', '?')}개 필요)"
        elif err_type == "too_long":
            message = f"항목 초과(최대 {ctx.get('max_length', '?')}개 허용)"
        elif err_type == "string_too_long":
            message = f"글자 수 초과(최대 {ctx.get('max_length', '?')}자)"
        elif err_type == "string_type":
            message = "문자열이어야 합니다"
        elif err_type == "list_type":
            message = "목록(배열)이어야 합니다"
        elif err_type in {"dict_type", "model_type", "model_attributes_type"}:
            message = "객체(JSON object)여야 합니다"
        else:
            message = err.get("msg", "형식 오류")
        hints.append(f"{loc}: {message}" if loc else message)
    return hints


# ---------------------------------------------------------------------------
# 프롬프트
# ---------------------------------------------------------------------------

WRITING_CORE_PROMPT = (
    "공공기관 문서 작성 원칙:\n"
    "- 두괄식: 결론과 핵심을 문서 맨 앞에 배치한다.\n"
    "- 개조식: 한 항목은 40자 내외, 명사형으로 끝맺는다.\n"
    "- '적/의/것/들' 남용을 금지하고 군더더기 조사를 줄인다.\n"
    "- 구체 수치·날짜·기관명을 우선 사용한다.\n"
    "- 지시문에 포함된 수치·비율·횟수·날짜는 반드시 산출물에 표기 그대로 보존한다.\n"
    "- 지시에 없는 수치·연도·통계를 창작하지 않는다.\n"
    "- 위계 표기: 1페이지 보고서는 □→◦→-, 풀버전 보고서는 Ⅰ→□→◦→-→※ 순서를 따른다.\n"
)

ORGANIZE_SYSTEM_PROMPT = (
    "당신은 대한민국 공공기관의 문서 작성 보조자입니다.\n"
    "작성 지시, 참고자료, 업무대화 기록을 읽고 특정 양식과 무관한 '구조화 마크다운'으로 내용을 정리하세요.\n\n"
    "출력 규칙:\n"
    "- 첫 줄은 `# 제목`, 이후 `## 섹션 제목`과 `- 항목`(개조식)으로만 구성한다.\n"
    "- 마크다운 이외의 설명, 인사말, 코드펜스는 출력하지 않는다.\n"
    "- 섹션은 3~6개, 각 섹션에 항목 2개 이상을 목표로 한다.\n\n"
    "실패 방어 규칙(중요):\n"
    "- 지시에 [문서 주제] 블록이 있으면 반드시 그 주제로 작성한다. 참고자료가 주제와 무관하면 무시한다.\n"
    "- 작성 지시가 '방금 내용'·'위 내용' 등 대화를 가리키면 업무대화 기록에서 주제를 찾는다.\n"
    "- 작성 지시가 짧거나 모호하고 업무대화 기록도 없으면 첨부된 참고자료 자체를 주제로 삼아 내용을 구성한다.\n"
    "- 참고자료도 없으면 업무대화 기록에서 주제를 찾아 정리한다.\n"
    "- 절대 '내용 없음', '자료 부족' 같은 문구로 비워 두지 않는다.\n\n" + WRITING_CORE_PROMPT
)

_FORMAT_PROMPT_TAIL = (
    "\n출력 규칙:\n"
    "- 위 스키마를 만족하는 JSON 객체 하나만 출력한다. 설명·코드펜스·주석 금지.\n"
    "- 원문에 없는 사실을 지어내지 않는다. 항목이 부족하면 원문 문장을 개조식으로 쪼개 채운다.\n\n"
    + WRITING_CORE_PROMPT
)

FORMAT_SYSTEM_PROMPTS: dict[str, str] = {
    "onePageReport": (
        "정리된 마크다운을 '1페이지 보고서' JSON으로 변환하세요.\n"
        "스키마: title(문자열), subtitle(선택), summary(200자 이내 두괄식 요약), "
        "sections(2~5개, 각각 {heading, items[1개 이상], detail?, note?}).\n"
        "완성 예시:\n"
        + json.dumps(
            {
                "title": "청사 에너지 절감 추진계획 보고",
                "subtitle": "2026년 하반기 실행 중심",
                "summary": "전력 사용량 12% 절감을 위해 3개 과제를 하반기에 즉시 추진",
                "sections": [
                    {
                        "heading": "추진 배경",
                        "items": [
                            "2025년 청사 전력비 3.2억 원, 전년 대비 8% 증가",
                            "정부 에너지 절감 지침(2026.5.) 시달",
                        ],
                        "detail": "냉난방 전력이 전체의 61% 차지",
                        "note": "공공기관 에너지이용 합리화 지침 근거",
                    },
                    {
                        "heading": "주요 과제",
                        "items": [
                            "냉난방 설정온도 자동제어 도입",
                            "옥상 태양광 50kW 증설",
                            "야간 대기전력 차단 콘센트 교체",
                        ],
                    },
                    {
                        "heading": "향후 조치",
                        "items": ["7월 중 자동제어 시범 적용", "8월 예산 재배정 요구"],
                    },
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + _FORMAT_PROMPT_TAIL
    ),
    "fullReport": (
        "정리된 마크다운을 '풀버전 보고서' JSON으로 변환하세요.\n"
        "스키마: title, summary(요약 문장 목록 1개 이상), "
        "chapters(3~6개, 각각 {heading, sections[]: {heading, items[]}}), "
        "schedule(선택, {rows: [{항목, 일정, 비고?}]}).\n"
        "일정 행에 '미정', '추후', 'TBD'를 쓰지 마세요. 확정 일정만 넣습니다.\n"
        "완성 예시:\n"
        + json.dumps(
            {
                "title": "2026년 청사 에너지 절감 종합계획",
                "summary": [
                    "전력 사용량 12% 절감 목표, 3대 과제 하반기 착수",
                    "예산 1.8억 원, 기존 시설예산 재배정으로 충당",
                ],
                "chapters": [
                    {
                        "heading": "추진 배경",
                        "sections": [
                            {
                                "heading": "현황",
                                "items": ["2025년 전력비 3.2억 원, 전년 대비 8% 증가"],
                            }
                        ],
                    },
                    {
                        "heading": "추진 과제",
                        "sections": [
                            {
                                "heading": "설비 개선",
                                "items": ["냉난방 자동제어 도입", "태양광 50kW 증설"],
                            },
                            {"heading": "행태 개선", "items": ["야간 대기전력 차단"]},
                        ],
                    },
                    {
                        "heading": "행정 사항",
                        "sections": [
                            {
                                "heading": "일정·예산",
                                "items": ["7월 시범 적용, 8월 예산 재배정"],
                            }
                        ],
                    },
                ],
                "schedule": {
                    "rows": [
                        {"항목": "자동제어 시범 적용", "일정": "2026.7.", "비고": "본관 우선"},
                        {"항목": "태양광 증설 발주", "일정": "2026.9.", "비고": ""},
                    ]
                },
            },
            ensure_ascii=False,
            indent=2,
        )
        + _FORMAT_PROMPT_TAIL
    ),
    "officialMemo": (
        "정리된 마크다운을 '시행문(공문)' JSON으로 변환하세요.\n"
        "스키마: title, receiver(수신), opening(첫 문장, '~와 관련하여 아래와 같이 ...' 형태), "
        "items(가나다 위계 항목 목록, 각각 {text, subs?[]}), attachments?(붙임 목록), sender?(발신 명의).\n"
        "완성 예시:\n"
        + json.dumps(
            {
                "title": "청사 에너지 절감 협조 요청",
                "receiver": "각 부서장",
                "opening": "청사 에너지 절감 추진과 관련하여 아래와 같이 협조를 요청합니다.",
                "items": [
                    {
                        "text": "냉난방 설정온도 준수(하절기 26℃)",
                        "subs": ["회의실 등 공용공간 우선 적용", "부서별 점검책임자 지정"],
                    },
                    {"text": "야간 대기전력 차단 협조"},
                ],
                "attachments": ["에너지 절감 실행계획 1부"],
                "sender": "행정지원과장",
            },
            ensure_ascii=False,
            indent=2,
        )
        + _FORMAT_PROMPT_TAIL
    ),
    "email": (
        "정리된 마크다운을 '업무 이메일' JSON으로 변환하세요.\n"
        "스키마: subject(제목), greeting?(첫인사), body_paragraphs(본문 문단 목록 1개 이상), "
        "closing?(맺음말), signature?(서명).\n"
        "서명 규칙(반드시 지킬 것):\n"
        "- 지시에 없는 개인 이름·직급·내선번호·전화번호·이메일 주소를 만들지 말 것.\n"
        "- '(담당자명)', 'OOO', '내선 XXXX' 같은 자리표시자를 쓰지 말 것.\n"
        "- 서명은 부서/팀명만 쓴다(예: '행정지원과 드림'). 지시에 실명·연락처가 있을 때만 그대로 쓴다.\n"
        "완성 예시:\n"
        + json.dumps(
            {
                "subject": "[협조] 청사 에너지 절감 실천 안내",
                "greeting": "안녕하십니까, 행정지원과입니다.",
                "body_paragraphs": [
                    "하절기 전력 수요 증가에 따라 부서별 에너지 절감 실천을 요청드립니다.",
                    "냉방 설정온도 26℃ 준수와 퇴근 시 대기전력 차단을 부탁드립니다.",
                ],
                "closing": "협조에 감사드립니다.",
                "signature": "행정지원과 드림",
            },
            ensure_ascii=False,
            indent=2,
        )
        + _FORMAT_PROMPT_TAIL
    ),
}


# ---------------------------------------------------------------------------
# LLM 응답 파싱 유틸
# ---------------------------------------------------------------------------


def _strip_code_fences(text: str) -> str:
    cleaned = text.strip()
    fence = re.search(r"```(?:json|markdown|md)?\s*\n?(.*?)```", cleaned, re.DOTALL)
    if fence:
        return fence.group(1).strip()
    return cleaned


def _extract_json_block(text: str) -> dict[str, Any]:
    cleaned = _strip_code_fences(text)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("응답에서 JSON 객체를 찾지 못했습니다.")
    candidate = cleaned[start : end + 1]
    parsed = json.loads(candidate)
    if not isinstance(parsed, dict):
        raise ValueError("JSON 객체가 아닌 값이 반환되었습니다.")
    return parsed


# ---------------------------------------------------------------------------
# 1단계: organizeContent
# ---------------------------------------------------------------------------


def organize_content(
    llm: AuthoringLLM,
    *,
    instruction: str = "",
    reference_texts: list[str] | None = None,
    transcript: list[dict[str, Any]] | None = None,
    on_delta: Callable[[str], None] | None = None,
) -> str:
    user_parts: list[str] = []
    instruction_text = (instruction or "").strip()
    if instruction_text:
        user_parts.append(f"[작성 지시]\n{instruction_text}")
    else:
        user_parts.append(
            "[작성 지시]\n(지시 없음) 아래 참고자료와 업무대화 자체를 주제로 삼아 문서 내용을 구성하세요."
        )
    for index, reference in enumerate(reference_texts or [], start=1):
        text = str(reference or "").strip()
        if text:
            user_parts.append(f"[참고자료 {index}]\n{text[:6000]}")
    transcript_lines: list[str] = []
    for message in transcript or []:
        text = str(message.get("text", "")).strip()
        if not text:
            continue
        if message.get("role") == "summary":
            # T-02: 예산에서 밀려난 과거 턴을 대표하는 "[이전 대화 요약]" 블록은 원문 그대로 싣는다.
            transcript_lines.append(text)
            continue
        role = "사용자" if message.get("role") == "user" else "어시스턴트"
        transcript_lines.append(f"{role}: {text}")
    if transcript_lines:
        user_parts.append("[업무대화 기록]\n" + "\n".join(transcript_lines[-60:]))

    messages = [
        {"role": "system", "text": ORGANIZE_SYSTEM_PROMPT},
        {"role": "user", "text": "\n\n".join(user_parts)},
    ]
    if on_delta is not None:
        try:
            raw = llm(messages, temperature=0.3, on_delta=on_delta)
        except TypeError:
            # 스트리밍 미지원 LLM(구 스텁 등)은 델타 없이 비스트리밍 결과만 돌려준다.
            raw = llm(messages, temperature=0.3)
    else:
        raw = llm(messages, temperature=0.3)
    organized = _strip_code_fences(str(raw))
    if not organized.strip():
        raise LLMGenerationError("내용 정리 단계에서 빈 응답이 반환되었습니다.")
    return organized


# ---------------------------------------------------------------------------
# 마크다운 스크레이핑 (repair 용)
# ---------------------------------------------------------------------------


def _scrape_markdown(markdown_text: str) -> dict[str, Any]:
    title: str | None = None
    sections: list[tuple[str, list[str]]] = []
    paragraphs: list[str] = []
    bullets: list[str] = []
    current: list[str] | None = None

    for raw_line in markdown_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("# ") and title is None:
            title = line[2:].strip()
            continue
        heading_match = re.match(r"^#{2,4}\s+(.*)$", line)
        if heading_match:
            current = []
            sections.append((heading_match.group(1).strip(), current))
            continue
        bullet_match = _BULLET_PATTERN.match(line)
        if bullet_match:
            text = bullet_match.group(1).strip()
            if text:
                bullets.append(text)
                if current is not None:
                    current.append(text)
            continue
        paragraphs.append(line)

    return {
        "title": title,
        "sections": [(heading, items) for heading, items in sections],
        "paragraphs": paragraphs,
        "bullets": bullets,
    }


def _chunk_lines(lines: list[str], count: int, filler: str) -> list[list[str]]:
    pool = [line for line in lines if line.strip()]
    while len(pool) < count:
        pool.append(filler)
    size, extra = divmod(len(pool), count)
    chunks: list[list[str]] = []
    cursor = 0
    for index in range(count):
        take = size + (1 if index < extra else 0)
        chunks.append(pool[cursor : cursor + take])
        cursor += take
    return chunks


# ---------------------------------------------------------------------------
# repair_doc: 최후 방어선 — 1단계 마크다운에서 최소 스키마 구성
# ---------------------------------------------------------------------------


def repair_doc(
    format_key: str,
    organized_markdown: str,
    raw_structure: dict[str, Any] | None = None,
) -> BaseModel:
    scraped = _scrape_markdown(organized_markdown)
    raw = raw_structure if isinstance(raw_structure, dict) else {}
    title = str(_coerce_text(raw.get("title") or raw.get("subject") or "") or "").strip() or (
        scraped["title"] or "업무 보고"
    )
    bullets: list[str] = scraped["bullets"] or scraped["paragraphs"]
    filler = f"{title} 관련 내용 정리"
    if not bullets:
        bullets = [filler]

    if format_key == "onePageReport":
        summary_source = raw.get("summary") or (scraped["paragraphs"][0] if scraped["paragraphs"] else bullets[0])
        summary = str(_coerce_text(summary_source)).strip()[:200] or filler
        section_pairs = [(heading, items) for heading, items in scraped["sections"] if items][:5]
        if len(section_pairs) < 2:
            halves = _chunk_lines(bullets, 2, filler)
            section_pairs = [("주요 내용", halves[0]), ("세부 내용", halves[1])]
        payload = {
            "title": title,
            "summary": summary,
            "sections": [
                {"heading": heading, "items": items[:8]} for heading, items in section_pairs
            ],
        }
        return SchemaOnePage.model_validate(payload)

    if format_key == "fullReport":
        summary_lines = _coerce_str_list(raw.get("summary")) or bullets[:2]
        chapter_pairs = [(heading, items) for heading, items in scraped["sections"] if items][:6]
        if len(chapter_pairs) < 3:
            thirds = _chunk_lines(bullets, 3, filler)
            chapter_pairs = [
                ("추진 배경", thirds[0]),
                ("주요 내용", thirds[1]),
                ("향후 계획", thirds[2]),
            ]
        payload = {
            "title": title,
            "summary": summary_lines,
            "chapters": [
                {
                    "heading": heading,
                    "sections": [{"heading": "주요 내용", "items": items[:8]}],
                }
                for heading, items in chapter_pairs
            ],
        }
        return SchemaFull.model_validate(payload)

    if format_key == "officialMemo":
        receiver = str(_coerce_text(raw.get("receiver") or "") or "").strip() or "관련 부서"
        opening_source = raw.get("opening") or (
            scraped["paragraphs"][0] if scraped["paragraphs"] else None
        )
        opening = (
            str(_coerce_text(opening_source)).strip()
            if opening_source
            else f"{title}와 관련하여 아래와 같이 알려드립니다."
        )
        payload = {
            "title": title,
            "receiver": receiver,
            "opening": opening,
            "items": [{"text": bullet} for bullet in bullets[:8]],
            "attachments": _coerce_str_list(raw.get("attachments")),
            "sender": raw.get("sender"),
        }
        return SchemaGongmun.model_validate(payload)

    if format_key == "email":
        body = scraped["paragraphs"] or bullets
        payload = {
            "subject": title,
            "greeting": raw.get("greeting"),
            "body_paragraphs": body[:10],
            "closing": raw.get("closing"),
            "signature": raw.get("signature"),
        }
        return SchemaEmail.model_validate(payload)

    raise ValueError(f"지원하지 않는 문서 양식입니다: {format_key}")


# ---------------------------------------------------------------------------
# 2단계: formatToSchema (검증 + 한국어 힌트 재시도 + repair)
# ---------------------------------------------------------------------------


def format_to_schema(
    llm: AuthoringLLM,
    *,
    format_key: str,
    organized_markdown: str,
) -> tuple[BaseModel, dict[str, Any]]:
    model_cls = FORMAT_SCHEMAS[format_key]
    messages = [
        {"role": "system", "text": FORMAT_SYSTEM_PROMPTS[format_key]},
        {
            "role": "user",
            "text": f"[정리된 내용]\n{organized_markdown}\n\n위 내용을 스키마에 맞는 JSON 하나로만 출력하세요.",
        },
    ]

    raw_text: str | None = None
    raw_dict: dict[str, Any] | None = None
    hints: list[str] = []
    try:
        raw_text = str(llm(messages, temperature=0.1))
        raw_dict = _extract_json_block(raw_text)
        structure = model_cls.model_validate(raw_dict)
        return structure, {"attempts": 1, "repaired": False, "hints": []}
    except LLMGenerationError:
        structure = repair_doc(format_key, organized_markdown, raw_dict)
        return structure, {
            "attempts": 1,
            "repaired": True,
            "hints": ["LLM 호출 실패로 정리 내용에서 최소 구조를 복구했습니다."],
        }
    except ValidationError as exc:
        # 주의: pydantic ValidationError 는 ValueError 의 하위 클래스라 순서가 중요하다
        hints = validation_error_hints(exc)
    except (ValueError, json.JSONDecodeError):
        hints = ["JSON 파싱 실패: 설명이나 코드펜스 없이 순수 JSON 객체만 출력하세요."]

    retry_messages = messages + [
        {"role": "assistant", "text": raw_text or ""},
        {
            "role": "user",
            "text": (
                "직전 출력에 아래 오류가 있습니다. 오류를 모두 수정한 JSON 하나만 다시 출력하세요.\n"
                + "\n".join(f"- {hint}" for hint in hints)
            ),
        },
    ]
    retry_dict: dict[str, Any] | None = None
    try:
        retry_text = str(llm(retry_messages, temperature=0.1))
        retry_dict = _extract_json_block(retry_text)
        structure = model_cls.model_validate(retry_dict)
        return structure, {"attempts": 2, "repaired": False, "hints": hints}
    except LLMGenerationError:
        pass
    except ValidationError as exc:
        hints = hints + validation_error_hints(exc)
    except (ValueError, json.JSONDecodeError):
        hints = hints + ["재시도 응답도 JSON 파싱 실패"]

    structure = repair_doc(format_key, organized_markdown, retry_dict or raw_dict)
    return structure, {"attempts": 2, "repaired": True, "hints": hints}


# ---------------------------------------------------------------------------
# F-12: email 서명 placeholder·창작 연락처 방어 (후처리 가드)
# ---------------------------------------------------------------------------

# few-shot 유출(홍길동·내선 1234)·자리표시자((담당자명)·OOO·XXXX)·창작 연락처 판정 패턴.
# 매칭된 문자열이 지시문에 실제로 등장하면 사용자가 준 정보이므로 유지한다.
_EMAIL_SIGNATURE_SUSPECT_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\(\s*담당자\s*명?\s*\)"),
    re.compile(r"\(\s*내선\s*번호?\s*\)"),
    re.compile(r"담당자명"),
    re.compile(r"[OＯ○◯]{2,}"),
    re.compile(r"[XＸ]{2,}"),
    re.compile(r"홍길동"),
    re.compile(r"내선\s*(?:번호)?\s*[:：]?\s*\d+"),
    re.compile(r"\d{2,4}\s*-\s*\d{3,4}\s*-\s*\d{4}"),
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
)

# 서명 치환에 쓸 부서/팀명 추출 — "행정지원과", "총무팀", "AI혁신처" 등
_DEPARTMENT_NAME_PATTERN = re.compile(
    r"[가-힣A-Za-z0-9]{2,}(?:과|팀|실|센터|단|국|본부|처|원|청)"
)


def _department_name_from(*texts: str) -> str | None:
    for text in texts:
        match = _DEPARTMENT_NAME_PATTERN.search(str(text or ""))
        if match:
            return match.group(0)
    return None


def _sanitize_email_signature(structure: dict[str, Any], instruction: str) -> dict[str, Any]:
    """email 구조의 signature에서 placeholder·창작 연락처를 감지해 부서명 서명으로 치환한다.

    순수 함수 — 입력 구조를 변경하지 않고 필요 시 복사본을 돌려준다.
    지시문에 실제로 존재하는 값(예: 사용자가 알려준 내선번호)은 창작이 아니므로 유지한다.
    """
    signature = str(structure.get("signature") or "").strip()
    if not signature:
        return structure
    instruction_haystack = re.sub(r"\s+", "", str(instruction or ""))
    tainted = False
    for pattern in _EMAIL_SIGNATURE_SUSPECT_PATTERNS:
        for match in pattern.finditer(signature):
            token = re.sub(r"\s+", "", match.group(0))
            if token and token in instruction_haystack:
                continue  # 지시문에 실재하는 값 — 유지
            tainted = True
            break
        if tainted:
            break
    if not tainted:
        return structure
    department = _department_name_from(
        signature, str(structure.get("greeting") or ""), str(instruction or "")
    )
    sanitized = dict(structure)
    sanitized["signature"] = f"{department} 드림" if department else "담당 부서 드림"
    return sanitized


# ---------------------------------------------------------------------------
# F-13/F-13b: 지시 수치 보존 검증 — 누락 시 1회 재생성
# ---------------------------------------------------------------------------

_NUMERIC_TOKEN_PATTERN = re.compile(r"\d+(?:[.,]\d+)?\s*(?:%|회|건|명|점|년|월|일)?")


def extract_numeric_tokens(text: str) -> list[str]:
    """지시문에서 보존 대상 수치 토큰(수치+단위)을 순서 보존·중복 제거로 추출한다."""
    tokens: list[str] = []
    for match in _NUMERIC_TOKEN_PATTERN.finditer(str(text or "")):
        token = re.sub(r"\s+", "", match.group(0))
        if token and token not in tokens:
            tokens.append(token)
    return tokens


def find_missing_numeric_tokens(instruction: str, structure: dict[str, Any]) -> list[str]:
    """지시문 수치 토큰 중 구조 JSON 직렬화 텍스트에 없는 것을 반환한다(공백 무시 비교)."""
    tokens = extract_numeric_tokens(instruction)
    if not tokens:
        return []
    haystack = re.sub(r"\s+", "", json.dumps(structure, ensure_ascii=False))
    return [token for token in tokens if token not in haystack]


def _instruction_number_snippets(instruction: str) -> dict[str, str]:
    """수치 토큰 → 지시문 주변 맥락(앞뒤 8자). 재생성 보강 지시에 함께 실어
    '3회'가 무엇의 횟수인지 모델이 알 수 있게 한다."""
    snippets: dict[str, str] = {}
    text = str(instruction or "")
    for match in _NUMERIC_TOKEN_PATTERN.finditer(text):
        token = re.sub(r"\s+", "", match.group(0))
        if not token or token in snippets:
            continue
        start = max(0, match.start() - 8)
        end = min(len(text), match.end() + 8)
        snippets[token] = text[start:end].strip()
    return snippets


def format_with_numeric_guard(
    llm: AuthoringLLM,
    *,
    format_key: str,
    organized_markdown: str,
    instruction: str = "",
) -> tuple[BaseModel, dict[str, Any]]:
    """format_to_schema + 지시 수치 보존 검증.

    지시문 수치 토큰이 구조 결과에서 누락되면 누락 목록을 명시한 보강 지시를 붙여
    1회 재생성하고, 누락이 줄어든 경우에만 재생성 결과를 채택한다.
    """
    structure, meta = format_to_schema(
        llm, format_key=format_key, organized_markdown=organized_markdown
    )
    missing = find_missing_numeric_tokens(instruction, structure.model_dump())
    if not missing:
        return structure, meta

    snippets = _instruction_number_snippets(instruction)
    reinforced_markdown = (
        f"{organized_markdown}\n\n"
        "[수치 보존 지시]\n"
        "- 아래 수치는 작성 지시에 포함된 핵심 수치인데 직전 산출물에서 누락되었습니다.\n"
        "- 각 수치를 아래 표기 그대로 산출물 본문에 반드시 포함하세요. 수치를 일반 서술로 대체하지 마세요.\n"
        + "\n".join(
            f"- {token} (지시문 맥락: …{snippets[token]}…)" if snippets.get(token) else f"- {token}"
            for token in missing
        )
    )
    retry_structure, retry_meta = format_to_schema(
        llm, format_key=format_key, organized_markdown=reinforced_markdown
    )
    retry_missing = find_missing_numeric_tokens(instruction, retry_structure.model_dump())
    if len(retry_missing) < len(missing):
        return retry_structure, {
            **retry_meta,
            "numeric_retry": True,
            "missing_numeric_tokens": retry_missing,
        }
    return structure, {**meta, "numeric_retry": True, "missing_numeric_tokens": missing}


# ---------------------------------------------------------------------------
# F-08: revise — 현재 구조 + 자연어 수정 지시 → 검증된 새 구조
# ---------------------------------------------------------------------------

REVISE_SYSTEM_PREFIX = (
    "아래는 이미 작성된 문서의 구조 JSON입니다. 사용자 수정 지시를 반영한 '새 구조 JSON' 하나만 출력하세요.\n"
    "- 지시가 모호하면 최소 변경만 합니다. 지시에서 언급되지 않은 항목은 그대로 유지합니다.\n"
    "- 원문에 없는 사실을 지어내지 않습니다.\n\n"
)


def revise_structure(
    llm: AuthoringLLM,
    *,
    format_key: str,
    current_structure: dict[str, Any],
    instruction: str,
) -> tuple[BaseModel, dict[str, Any]]:
    """format_to_schema 와 동일한 검증 재시도(한국어 힌트) 파이프라인을 재사용한다.

    최후 방어선(repair): 수정 지시를 반영한 유효 구조를 얻지 못하면 이미 검증된
    '현재 구조'를 그대로 돌려준다(최소 변경의 극단 = 무변경). 하드 실패를 돌려주지 않는다.
    """
    model_cls = FORMAT_SCHEMAS[format_key]
    current_json = json.dumps(current_structure, ensure_ascii=False, indent=2)
    messages = [
        {"role": "system", "text": REVISE_SYSTEM_PREFIX + FORMAT_SYSTEM_PROMPTS[format_key]},
        {
            "role": "user",
            "text": (
                f"[현재 문서 구조 JSON]\n{current_json}\n\n"
                f"[수정 지시]\n{instruction}\n\n"
                "지시를 반영한 스키마 준수 JSON 하나만 출력하세요."
            ),
        },
    ]

    raw_text: str | None = None
    hints: list[str] = []
    try:
        raw_text = str(llm(messages, temperature=0.1))
        raw_dict = _extract_json_block(raw_text)
        structure = model_cls.model_validate(raw_dict)
        return structure, {"attempts": 1, "repaired": False, "hints": []}
    except LLMGenerationError:
        structure = model_cls.model_validate(current_structure)
        return structure, {
            "attempts": 1,
            "repaired": True,
            "hints": ["LLM 호출 실패로 수정 지시를 반영하지 못해 기존 구조를 유지했습니다."],
        }
    except ValidationError as exc:
        # 주의: pydantic ValidationError 는 ValueError 의 하위 클래스라 순서가 중요하다
        hints = validation_error_hints(exc)
    except (ValueError, json.JSONDecodeError):
        hints = ["JSON 파싱 실패: 설명이나 코드펜스 없이 순수 JSON 객체만 출력하세요."]

    retry_messages = messages + [
        {"role": "assistant", "text": raw_text or ""},
        {
            "role": "user",
            "text": (
                "직전 출력에 아래 오류가 있습니다. 오류를 모두 수정한 JSON 하나만 다시 출력하세요.\n"
                + "\n".join(f"- {hint}" for hint in hints)
            ),
        },
    ]
    try:
        retry_text = str(llm(retry_messages, temperature=0.1))
        retry_dict = _extract_json_block(retry_text)
        structure = model_cls.model_validate(retry_dict)
        return structure, {"attempts": 2, "repaired": False, "hints": hints}
    except LLMGenerationError:
        pass
    except ValidationError as exc:
        hints = hints + validation_error_hints(exc)
    except (ValueError, json.JSONDecodeError):
        hints = hints + ["재시도 응답도 JSON 파싱 실패"]

    structure = model_cls.model_validate(current_structure)
    return structure, {
        "attempts": 2,
        "repaired": True,
        "hints": hints + ["수정 지시를 반영한 유효 구조를 얻지 못해 기존 구조를 유지했습니다."],
    }


# ---------------------------------------------------------------------------
# 임의형식(custom) — 사용자 HWPX/HWTX 양식 채우기·본문 반영 (ax-playground 이식)
# ---------------------------------------------------------------------------
# 흐름: 업로드(custom-template) → 감지(custom-detect: kordoc fill --dry-run)
#   → 서식(폼)이면 값 제안(custom-fill-suggest) → 채우기(custom-fill-apply: kordoc fill)
#   → 문서형이면 organize 마크다운을 문단 매핑해 본문 교체(custom-patch: kordoc patch)


class KordocCliUnavailable(RuntimeError):
    pass


_KORDOC_TIMEOUT_SECONDS = 90
# 폼 판정 기준(ax와 동일): 감지 확신도 0.5 이상 + 빈 라벨-값 필드 3개 이상
_CUSTOM_FORM_MIN_FIELDS = 3
_CUSTOM_FORM_MIN_CONFIDENCE = 0.5
_KORDOC_NO_FIELDS_MARKER = "서식 필드를 찾을 수 없습니다"
_KORDOC_APPLIED_PATTERN = re.compile(r"(\d+)개 변경 적용")
_KORDOC_FILLED_PATTERN = re.compile(r"(\d+)개 필드 채움")
_LABEL_NORMALIZE_PATTERN = re.compile(r"[\s()（）「」『』:：·.]")
# kordoc fill 출력은 hwpx(zip, PK..) 또는 hwp(CFB, D0 CF) — 매직바이트 1차 검증(ax와 동일)
_HWPX_MAGIC = (b"PK", b"\xd0\xcf")

# patch 대상에서 제외할 블록: 표·이미지(kordoc이 보존), 각주 포함 문단(무결성 위험 — ax 주석 참고)
_PATCH_SKIP_BLOCK_PATTERN = re.compile(r"^(<table|<tr|\||!\[|<img)")
_PATCH_FOOTNOTE_PATTERN = re.compile(r"\(주\s*[:：]")
# 확인문·서명란·날짜 같은 정형구는 내용이 아닌 양식 요소 → 교체하지 않고 보존(ax isFixedPhrase 이식)
_FIXED_PHRASE_PATTERNS = (
    re.compile(r"사실과\s*다름없|틀림없|확인합니다|확인함|동의합니다|동의함|서약"),
    re.compile(r"신청인\s*[:：]|\(\s*(서명|인|날인)\s*\)|（\s*서명\s*）"),
    re.compile(r"^20\d{2}\s*\.[\s.]*$|^20\d{2}\s*\.\s+\.\s+\."),
)

CUSTOM_FORM_FILL_SYSTEM_PROMPT = (
    "당신은 공공기관 서식(신청서·보고서 양식)의 빈 칸을 채우는 작성기입니다. "
    "목표는 단 하나 — [양식 빈 필드]의 각 라벨에 들어갈 '값'을 [내용]에서 찾아내는 것입니다. "
    "새 문서를 쓰거나 내용을 요약·재구성하지 말고, 오직 각 칸에 들어갈 값만 추출하세요.\n\n"
    "[작업 방식 — 라벨마다 '값 찾기']\n"
    '- 라벨을 질문으로 바꿔 생각한다. 예: "성명"→"이 사람 이름은?", "신청일"→"신청 날짜는?", '
    '"연락처"→"전화번호는?", "사업자등록번호"→"그 번호는?".\n'
    "- 그 답을 [내용](작성 지시·업무대화 기록·참고자료)에서 찾아 값으로 넣는다. "
    "라벨과 표현이 달라도 뜻이 같으면 매칭한다(성명=이름, 연락처=전화/휴대폰, 주소=소재지, 금액=비용/예산, 기간=일정 등).\n"
    "- 단서가 여러 곳이면 가장 구체적이고 최신인 값을 쓴다. "
    "값은 칸에 그대로 들어갈 '결과값'만(라벨·설명 문구 반복 금지).\n\n"
    "[출력 — 엄수]\n"
    '- {"라벨":"값", ...} 형태의 JSON 객체만 출력. 키는 [양식 빈 필드]의 라벨과 글자까지 정확히 동일하게.\n'
    "- 코드블록·설명·머리말 없이 JSON 객체만.\n\n"
    "[규칙]\n"
    "- [내용]에 근거가 없는 필드는 키를 아예 생략한다(빈칸으로 남김). 추측·창작 금지 — 없으면 비운다.\n"
    '- 라벨이 값을 받는 칸이 아니라 묶음 머리글(예: "회사개요", "구분", "신청내용")이면 생략한다.\n'
    "- 날짜·전화·법인번호·금액 등은 형식을 지키고, 과장 없이 [내용]의 사실만 반영한다.\n"
    "- 한 필드 값은 표 칸에 들어갈 만큼 한 줄로 간결하게.\n"
)


def resolve_kordoc_cli() -> Path:
    """kordoc CLI(dist/cli.js) 경로를 해석한다. 환경변수 → 상위 폴더의 node_modules 순."""
    candidates: list[Path] = []
    env_cli = os.environ.get("GONGMU_KORDOC_CLI")
    if env_cli:
        candidates.append(Path(env_cli).expanduser())
    seen: set[Path] = set()
    for base in [Path.cwd(), *Path(__file__).resolve().parents]:
        candidate = base / "node_modules" / "kordoc" / "dist" / "cli.js"
        if candidate not in seen:
            seen.add(candidate)
            candidates.append(candidate)
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise KordocCliUnavailable(
        "kordoc CLI(node_modules/kordoc/dist/cli.js)를 찾지 못했습니다. "
        "GONGMU_KORDOC_CLI 환경변수로 경로를 지정할 수 있습니다."
    )


def _run_kordoc_cli(args: list[str], *, timeout: int = _KORDOC_TIMEOUT_SECONDS) -> subprocess.CompletedProcess[bytes]:
    """kordoc CLI를 node 서브프로세스로 실행한다(kordoc_bridge 패턴).

    stdout 은 바이너리(hwpx 바이트)일 수 있어 bytes 로 캡처하고, 텍스트가 필요한
    호출부에서 utf-8 로 디코딩한다.
    """
    node = os.environ.get("GONGMU_NODE_EXE", "node")
    cli = resolve_kordoc_cli()
    try:
        return subprocess.run(
            [node, str(cli), *args],
            check=False,
            capture_output=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise KordocCliUnavailable("kordoc 실행에 필요한 Node 런타임을 찾지 못했습니다.") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="kordoc 처리 시간이 초과되었습니다. 다시 시도해 주세요.") from exc


def _decode_output(raw: bytes | None) -> str:
    return (raw or b"").decode("utf-8", errors="replace")


def detect_custom_template_fields(template_path: Path) -> dict[str, Any]:
    """kordoc `fill --dry-run` 으로 빈 라벨-값 필드를 감지한다.

    반환: {"mode": "form"|"document", "fields": [{"label","current"}], "confidence", "total_fields"}
    필드가 없거나 확신도가 낮으면 본문 교체형 문서(mode="document")로 판정한다.
    """
    completed = _run_kordoc_cli(["fill", str(template_path), "--dry-run", "--silent"])
    stderr_text = _decode_output(completed.stderr)
    if completed.returncode != 0:
        if _KORDOC_NO_FIELDS_MARKER in stderr_text:
            return {"mode": "document", "fields": [], "confidence": 0.0, "total_fields": 0}
        message = stderr_text.strip() or _decode_output(completed.stdout).strip() or "kordoc 실행 실패"
        raise HTTPException(status_code=502, detail=f"양식 분석에 실패했습니다: {message[:200]}")

    try:
        parsed = json.loads(_decode_output(completed.stdout))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="양식 분석 결과(JSON)를 읽지 못했습니다.") from exc

    raw_fields = parsed.get("fields") if isinstance(parsed, dict) else None
    confidence = float(parsed.get("confidence") or 0.0) if isinstance(parsed, dict) else 0.0
    empty_labels: list[str] = []
    seen_labels: set[str] = set()
    total_fields = 0
    for field in raw_fields or []:
        if not isinstance(field, dict):
            continue
        total_fields += 1
        label = str(field.get("label") or "").strip()
        value = str(field.get("value") or "").strip()
        if not label or value:
            continue
        if label in seen_labels:
            continue
        seen_labels.add(label)
        empty_labels.append(label)

    is_form = confidence >= _CUSTOM_FORM_MIN_CONFIDENCE and len(empty_labels) >= _CUSTOM_FORM_MIN_FIELDS
    return {
        "mode": "form" if is_form else "document",
        "fields": [{"label": label, "current": ""} for label in empty_labels],
        "confidence": confidence,
        "total_fields": total_fields,
    }


def match_custom_form_values(raw_text: str, labels: list[str]) -> dict[str, str]:
    """LLM이 낸 {라벨:값} JSON을 양식 라벨에 매칭한다(괄호·공백·콜론 표기 차이 허용, 빈 값 제외)."""

    def norm(text: str) -> str:
        return _LABEL_NORMALIZE_PATTERN.sub("", text)

    by_norm = {norm(label): label for label in labels}
    values: dict[str, str] = {}
    try:
        parsed = _extract_json_block(raw_text)
    except (ValueError, json.JSONDecodeError):
        return values
    for key, value in parsed.items():
        text = str(_coerce_text(value) or "").strip() if value is not None else ""
        if not text:
            continue
        label = key if key in labels else by_norm.get(norm(str(key)))
        if label:
            values[label] = text
    return values


def build_custom_fill_content_text(
    *,
    instruction: str,
    transcript: list[dict[str, Any]] | None,
    reference_texts: list[str] | None,
) -> str:
    """값-찾기 소스를 출처별로 구분해 조립한다(ax와 동일: 지시 + 대화 + 참고자료)."""
    parts: list[str] = []
    if instruction.strip():
        parts.append(f"[작성 지시]\n{instruction.strip()}")
    transcript_lines: list[str] = []
    for message in transcript or []:
        text = str(message.get("text", "")).strip()
        if not text:
            continue
        if message.get("role") == "summary":
            transcript_lines.append(text)
            continue
        role = "사용자" if message.get("role") == "user" else "어시스턴트"
        transcript_lines.append(f"{role}: {text}")
    if transcript_lines:
        parts.append("[업무대화 기록]\n" + "\n".join(transcript_lines[-60:]))
    for index, reference in enumerate(reference_texts or [], start=1):
        text = str(reference or "").strip()
        if text:
            parts.append(f"[참고자료 {index}]\n{text[:6000]}")
    return "\n\n".join(parts) or "(제공된 내용 없음)"


def build_custom_patch_markdown(template_markdown: str, organized_markdown: str) -> tuple[str, int]:
    """organize 마크다운을 양식 문단에 매핑한 편집 마크다운을 만든다(v1 단순화 버전).

    ax 의 classify→rewrite 3-pass 대신, 교체 가능한 본문 문단(표·이미지·각주·정형구 제외)에
    정리된 내용 줄을 순서대로 얹는다. 원본 글머리 기호는 유지하고 내용만 바꾼다.
    반환: (편집 마크다운, 교체한 문단 수)
    """
    blocks = [block for block in re.split(r"\n{2,}", template_markdown)]
    replace_indexes: list[int] = []
    for index, block in enumerate(blocks):
        stripped = block.strip()
        if not stripped:
            continue
        if _PATCH_SKIP_BLOCK_PATTERN.match(stripped) or _PATCH_FOOTNOTE_PATTERN.search(stripped):
            continue
        if any(pattern.search(stripped) for pattern in _FIXED_PHRASE_PATTERNS):
            continue
        replace_indexes.append(index)

    scraped = _scrape_markdown(organized_markdown)
    organized_lines: list[str] = []
    if scraped["title"]:
        organized_lines.append(str(scraped["title"]))
    for heading, items in scraped["sections"]:
        organized_lines.append(f"□ {heading}")
        organized_lines.extend(f" ◦ {item}" for item in items)
    for paragraph in scraped["paragraphs"]:
        organized_lines.append(str(paragraph))
    organized_lines = [line for line in organized_lines if line.strip()]
    if not organized_lines:
        organized_lines = [organized_markdown.strip()]

    replaced = 0
    new_blocks = list(blocks)
    for position, block_index in enumerate(replace_indexes):
        if position >= len(organized_lines):
            break  # 남은 원본 문단은 그대로 둔다(내용 부족 시 빈 문단으로 깨뜨리지 않음)
        original = blocks[block_index].strip()
        content = organized_lines[position].strip()
        # 원본의 제목(#)·글머리(□ ◦ …) 표기는 유지하고 텍스트 내용만 교체한다
        heading_match = re.match(r"^(#{1,4})\s+", original)
        bullet_match = re.match(r"^([□○◦\-▲*·])\s*", original)
        if heading_match and not content.startswith("#"):
            content = f"{heading_match.group(1)} {content.lstrip('□○◦-▲*· ')}"
        elif bullet_match and not re.match(r"^[□○◦\-▲*·#]", content):
            content = f"{bullet_match.group(1)} {content}"
        if position == len(replace_indexes) - 1 and len(organized_lines) > len(replace_indexes):
            # 교체 대상보다 정리된 내용이 많으면 마지막 문단에 이어 붙인다(블록 수 유지)
            leftovers = [line.strip() for line in organized_lines[len(replace_indexes):]]
            content = "\n".join([content, *leftovers])
        new_blocks[block_index] = content
        replaced += 1
    return "\n\n".join(new_blocks), replaced


# ---------------------------------------------------------------------------
# 평문 미리보기 렌더러 (결정적, LLM 없음)
# ---------------------------------------------------------------------------


def render_preview(format_key: str, structure: dict[str, Any]) -> str:
    """구조 JSON → 텍스트 미리보기. 최종 HWPX와 같은 문단 목록(structure_to_lines)을 공유한다."""
    return "\n".join(structure_to_lines(format_key, structure))


# ---------------------------------------------------------------------------
# 빌드: 구조 JSON → content-base 마크다운 (결정적, LLM 없음)
# ---------------------------------------------------------------------------
# 마크다운은 사람이 읽는 미리보기 본문(structure_to_lines)과, 최종 HWPX 렌더링이
# 그대로 사용할 구조 JSON 마커(embed_structure_marker) 두 부분으로 구성한다.
# finalize(write_public_hwpx_document)는 마커의 구조를 문단화하므로
# 미리보기 = 최종 HWPX (WYSIWYG) 가 보장된다. 고정 목차 슬롯 매핑은 폐지했다.


def build_content_base_markdown(format_key: str, structure: dict[str, Any]) -> str:
    if format_key not in FORMAT_SCHEMAS:
        raise ValueError(f"지원하지 않는 문서 양식입니다: {format_key}")
    lines = structure_to_lines(format_key, structure)
    title = str(structure.get("title") or structure.get("subject") or "").strip()
    body_lines = list(lines)
    if body_lines and body_lines[0].strip() == title:
        body_lines = body_lines[1:]
    while body_lines and not body_lines[0].strip():
        body_lines = body_lines[1:]
    marker = embed_structure_marker(format_key, structure)
    body = "\n".join(body_lines).rstrip()
    return f"# {title}\n\n{marker}\n\n{body}\n"


def _content_base_purpose(format_key: str, structure: dict[str, Any]) -> str:
    if format_key == "onePageReport":
        return str(structure.get("summary", "")).strip() or "1페이지 보고"
    if format_key == "fullReport":
        summary = structure.get("summary") or []
        return str(summary[0]).strip() if summary else "풀버전 보고"
    if format_key == "officialMemo":
        return str(structure.get("opening", "")).strip() or "시행문 발송"
    body = structure.get("body_paragraphs") or []
    return (str(body[0]).strip()[:120] if body else "") or "업무 이메일 발송"


# ---------------------------------------------------------------------------
# 스테이지 이벤트 생성기
# ---------------------------------------------------------------------------


def run_authoring_stages(
    llm: AuthoringLLM,
    *,
    format_key: str,
    instruction: str = "",
    reference_texts: list[str] | None = None,
    transcript: list[dict[str, Any]] | None = None,
    stream_content: bool = False,
) -> Iterator[dict[str, Any]]:
    organize_started = perf_counter()
    yield {"stage": "organize", "status": "start"}
    if stream_content:
        # 정리(organize) 단계 LLM 을 스레드로 돌리며 토큰을 content 이벤트로 흘린다.
        # 사용자는 문서 내용이 작성되는 과정을 실시간으로 본다(최종 미리보기는 done에서 확정).
        events: Queue = Queue()
        box: dict[str, str] = {}

        def _run_organize() -> None:
            try:
                box["text"] = organize_content(
                    llm,
                    instruction=instruction,
                    reference_texts=reference_texts,
                    transcript=transcript,
                    on_delta=lambda delta: events.put(("delta", delta)),
                )
                events.put(("done", None))
            except BaseException as exc:  # noqa: BLE001 - 스레드 예외를 본 제너레이터로 재전파
                events.put(("error", exc))

        Thread(target=_run_organize, daemon=True).start()
        while True:
            kind, value = events.get()
            if kind == "delta":
                yield {"content": {"stage": "organize", "text": str(value)}}
                continue
            if kind == "error":
                raise value
            break
        organized_markdown = box["text"]
    else:
        organized_markdown = organize_content(
            llm,
            instruction=instruction,
            reference_texts=reference_texts,
            transcript=transcript,
        )
    yield {
        "stage": "organize",
        "status": "done",
        "elapsed_ms": int((perf_counter() - organize_started) * 1000),
    }

    format_started = perf_counter()
    yield {"stage": "format", "status": "start"}
    # F-13/F-13b: 지시문 수치 보존 검증 + 누락 시 1회 재생성
    structure, meta = format_with_numeric_guard(
        llm,
        format_key=format_key,
        organized_markdown=organized_markdown,
        instruction=instruction,
    )
    yield {
        "stage": "format",
        "status": "done",
        "elapsed_ms": int((perf_counter() - format_started) * 1000),
        "attempts": meta["attempts"],
        "repaired": meta["repaired"],
    }

    structure_dict = structure.model_dump()
    if format_key == "email":
        # F-12: 서명 placeholder·창작 연락처 후처리 가드
        structure_dict = _sanitize_email_signature(structure_dict, instruction)
    yield {
        "done": True,
        "format": format_key,
        "structure": structure_dict,
        "preview": render_preview(format_key, structure_dict),
        "organized_markdown": organized_markdown,
        "meta": meta,
    }


# ---------------------------------------------------------------------------
# API 모델
# ---------------------------------------------------------------------------


class AuthoringStructureRequest(BaseModel):
    format: str
    instruction: str = ""
    session_id: str | None = None
    reference_texts: list[str] = Field(default_factory=list)
    transcript: list[dict[str, Any]] = Field(default_factory=list)
    stream: bool = True

    @field_validator("format")
    @classmethod
    def _normalize_format(cls, value: str) -> str:
        return normalize_format_key(value)


class AuthoringBuildRequest(BaseModel):
    format: str
    structure: dict[str, Any]
    title: str | None = None

    @field_validator("format")
    @classmethod
    def _normalize_format(cls, value: str) -> str:
        return normalize_format_key(value)


class AuthoringReviseRequest(BaseModel):
    format: str
    structure: dict[str, Any]
    instruction: str

    @field_validator("format")
    @classmethod
    def _normalize_format(cls, value: str) -> str:
        return normalize_format_key(value)


class CustomDetectRequest(BaseModel):
    template_path: str


class CustomFillSuggestRequest(BaseModel):
    template_path: str | None = None
    fields: list[Any] = Field(default_factory=list)
    instruction: str = ""
    session_id: str | None = None
    reference_texts: list[str] = Field(default_factory=list)

    def labels(self) -> list[str]:
        labels: list[str] = []
        for field in self.fields:
            if isinstance(field, str):
                label = field.strip()
            elif isinstance(field, dict):
                label = str(field.get("label") or "").strip()
            else:
                label = ""
            if label and label not in labels:
                labels.append(label)
        return labels


class CustomFillApplyRequest(BaseModel):
    template_path: str
    values: dict[str, str] = Field(default_factory=dict)
    output_name: str = ""


class CustomPatchRequest(BaseModel):
    template_path: str
    instruction: str = ""
    session_id: str | None = None
    reference_texts: list[str] = Field(default_factory=list)
    output_name: str = ""


FORMAT_METADATA: list[dict[str, Any]] = [
    {
        "key": "officialMemo",
        "aliases": ["gongmun"],
        "label": "시행문",
        "description": "수신처에 발송하는 공문. 가나다 위계 항목과 붙임으로 구성",
        "icon": "stamp",
        "schema_fields": ["title", "receiver", "opening", "items[{text, subs?}]", "attachments?", "sender?"],
    },
    {
        "key": "onePageReport",
        "aliases": ["onepage", "1p"],
        "label": "1페이지 보고서",
        "description": "두괄식 요약 + 섹션 2~5개(□→◦→- 위계)로 정리하는 한 장 보고",
        "icon": "file-text",
        "schema_fields": ["title", "subtitle?", "summary(≤200자)", "sections[2..5]{heading, items[], detail?, note?}"],
    },
    {
        "key": "fullReport",
        "aliases": ["full"],
        "label": "풀버전 보고서",
        "description": "장(Ⅰ~Ⅵ)·절(□)·항목(◦) 위계의 상세 보고서. 확정 일정표 포함 가능",
        "icon": "book-open",
        "schema_fields": ["title", "summary[]", "chapters[3..6]{heading, sections[]{heading, items[]}}", "schedule?{rows[{항목, 일정, 비고?}]}"],
    },
    {
        "key": "email",
        "aliases": ["이메일"],
        "label": "이메일",
        "description": "업무 이메일 본문. 제목·인사·본문 문단·맺음말·서명으로 구성",
        "icon": "mail",
        "schema_fields": ["subject", "greeting?", "body_paragraphs[]", "closing?", "signature?"],
    },
]


# ---------------------------------------------------------------------------
# 라우트 등록
# ---------------------------------------------------------------------------


def register_authoring_routes(
    app: FastAPI,
    deps: Any,
    *,
    llm_complete: AuthoringLLM | None = None,
) -> None:
    """문서작성 개선 라우트를 FastAPI 앱에 추가한다.

    deps: `.settings`(SidecarSettings), `.documents`(DocumentManager), `.db`(Database)를
    가진 객체 — app.py 의 AppServices 인스턴스를 그대로 넘기면 된다.
    llm_complete: 테스트/커스텀 주입용 LLM 클라이언트. 생략하면
    llm.generate_session_reply(settings 기반)를 사용한다.
    (참고: 기본 어댑터는 llm.py 가 temperature 를 노출하지 않아 temperature 인자를 무시한다.)

    재등록 시 기존 authoring 라우트를 교체한다(idempotent) — create_app이 기본
    라우트를 등록한 뒤 테스트가 스텁 LLM으로 다시 등록해도 스텁이 이긴다.
    """

    authoring_prefix = "/api/documents/authoring"
    outputs_file_path = "/api/documents/outputs/file"
    app.router.routes = [
        route
        for route in app.router.routes
        if not (
            getattr(route, "path", "").startswith(authoring_prefix)
            or getattr(route, "path", "") == outputs_file_path
        )
    ]

    def _resolve_llm() -> AuthoringLLM:
        if llm_complete is not None:
            return llm_complete

        def _default(
            messages: list[dict[str, Any]],
            *,
            temperature: float = 0.2,
            on_delta: Callable[[str], None] | None = None,
        ) -> str:
            if on_delta is not None:
                return generate_session_reply_streaming(
                    deps.settings, messages, on_delta=on_delta
                ).text
            return generate_session_reply(deps.settings, messages).text

        return _default

    def _sse_event(event: str, data: dict[str, Any]) -> str:
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        return f"event: {event}\ndata: {payload}\n\n"

    def _load_session_transcript(session_id: str | None) -> list[dict[str, Any]]:
        if not session_id:
            return []
        session = deps.db.fetch_one("SELECT * FROM work_sessions WHERE id = ?", (session_id,))
        if session is None:
            raise HTTPException(status_code=404, detail="work session not found")
        rows = deps.db.fetch_all(
            "SELECT role, text FROM work_session_messages WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        )
        # T-02: 전체 이력 대신 예산 안의 최근 턴 + 롤링 요약 블록으로 축약한다.
        transcript, _stats = assemble_transcript_context(
            session_messages=[dict(row) for row in rows],
            rolling_summary=session.get("context_summary_text"),
            budget_tokens=getattr(deps.settings, "context_budget_tokens", 6000),
        )
        return transcript

    def _resolve_transcript(payload: AuthoringStructureRequest) -> list[dict[str, Any]]:
        if payload.transcript:
            return payload.transcript
        return _load_session_transcript(payload.session_id)

    def _resolve_custom_template_path(raw_path: str) -> Path:
        documents_root = Path(deps.paths.documents_root).resolve()
        try:
            target = Path(raw_path).expanduser().resolve()
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="올바르지 않은 양식 파일 경로입니다.") from exc
        if target != documents_root and documents_root not in target.parents:
            raise HTTPException(
                status_code=403, detail="문서 폴더 밖의 양식 파일은 사용할 수 없습니다."
            )
        if not target.is_file():
            raise HTTPException(status_code=404, detail="양식 파일을 찾을 수 없습니다. 다시 업로드해 주세요.")
        return target

    def _allocate_custom_output_path(output_name: str, template_path: Path, default_suffix: str) -> Path:
        base = output_name.strip() or f"{template_path.stem}{default_suffix}"
        safe = re.sub(r'[\\/:*?"<>|\s]+', "_", base).strip("._") or "임의형식_문서"
        outputs_root = Path(deps.paths.outputs)
        outputs_root.mkdir(parents=True, exist_ok=True)
        candidate = outputs_root / f"{safe}.hwpx"
        counter = 2
        while candidate.exists():
            candidate = outputs_root / f"{safe}_{counter}.hwpx"
            counter += 1
        return candidate

    @app.get("/api/documents/authoring/formats")
    def list_authoring_formats() -> dict[str, Any]:
        return {"items": FORMAT_METADATA}

    @app.post("/api/documents/authoring/structure")
    def create_authoring_structure(payload: AuthoringStructureRequest):
        transcript = _resolve_transcript(payload)
        llm = _resolve_llm()

        if payload.stream:
            def generate():
                try:
                    for item in run_authoring_stages(
                        llm,
                        format_key=payload.format,
                        instruction=payload.instruction,
                        reference_texts=payload.reference_texts,
                        transcript=transcript,
                        stream_content=True,
                    ):
                        if item.get("done"):
                            yield _sse_event("done", item)
                        elif "content" in item:
                            # 정리 단계 토큰 — 프런트가 미리보기에 실시간 반영한다.
                            yield _sse_event("content", item["content"])
                        else:
                            yield _sse_event("stage", item)
                except LLMGenerationError as exc:
                    yield _sse_event(
                        "error",
                        {"message": f"내용 정리 단계에서 LLM 호출에 실패했습니다: {exc}"},
                    )

            return StreamingResponse(
                generate(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

        stages: list[dict[str, Any]] = []
        final: dict[str, Any] | None = None
        try:
            for item in run_authoring_stages(
                llm,
                format_key=payload.format,
                instruction=payload.instruction,
                reference_texts=payload.reference_texts,
                transcript=transcript,
            ):
                if item.get("done"):
                    final = item
                else:
                    stages.append(item)
        except LLMGenerationError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"내용 정리 단계에서 LLM 호출에 실패했습니다: {exc}",
            ) from exc
        assert final is not None
        return {
            "format": final["format"],
            "structure": final["structure"],
            "preview": final["preview"],
            "organized_markdown": final["organized_markdown"],
            "meta": final["meta"],
            "stages": stages,
        }

    @app.post("/api/documents/authoring/revise")
    def revise_authoring_structure(payload: AuthoringReviseRequest) -> dict[str, Any]:
        model_cls = FORMAT_SCHEMAS[payload.format]
        instruction = payload.instruction.strip()
        if not instruction:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "수정 지시가 비어 있습니다.",
                    "hints": ["instruction: 반영할 수정 지시를 입력하세요."],
                },
            )
        try:
            current_model = model_cls.model_validate(payload.structure)
        except ValidationError as exc:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "구조 JSON이 양식 스키마에 맞지 않습니다.",
                    "hints": validation_error_hints(exc),
                },
            ) from exc

        structure_model, meta = revise_structure(
            _resolve_llm(),
            format_key=payload.format,
            current_structure=current_model.model_dump(),
            instruction=instruction,
        )
        structure = structure_model.model_dump()
        return {
            "format": payload.format,
            "structure": structure,
            "preview": render_preview(payload.format, structure),
            "meta": meta,
        }

    @app.post("/api/documents/authoring/build", status_code=201)
    def build_authoring_document(payload: AuthoringBuildRequest) -> dict[str, Any]:
        model_cls = FORMAT_SCHEMAS[payload.format]
        try:
            structure_model = model_cls.model_validate(payload.structure)
        except ValidationError as exc:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "구조 JSON이 양식 스키마에 맞지 않습니다.",
                    "hints": validation_error_hints(exc),
                },
            ) from exc

        structure = structure_model.model_dump()
        title = (payload.title or "").strip() or str(
            structure.get("title") or structure.get("subject") or "문서"
        )
        markdown = build_content_base_markdown(payload.format, structure)
        content_base = deps.documents.create_content_base(
            title=title,
            purpose=_content_base_purpose(payload.format, structure),
            template_key="report",
            document_format=payload.format,
            outline="",
        )
        artifact_path = Path(content_base["artifact"]["path"])
        artifact_path.write_text(markdown, encoding="utf-8")
        try:
            preview_path = Path(content_base["preview"]["path"])
            preview_path.write_text(
                deps.documents._render_html(strip_structure_marker(markdown)), encoding="utf-8"
            )
        except (OSError, AttributeError):
            pass
        content_base["content"] = markdown

        return {
            "format": payload.format,
            "content_base": {
                "id": content_base["id"],
                "title": title,
                "document_format": payload.format,
                "artifact_path": str(artifact_path),
                "preview_path": content_base["preview"]["path"],
            },
            "content_markdown": markdown,
            "preview": render_preview(payload.format, structure),
            "finalize": {
                "method": "POST",
                "endpoint": "/api/documents/finalize",
                "body": {"content_base_id": content_base["id"], "output_name": title},
                "note": (
                    "finalize 요청 후 반환된 approval_ticket 을 "
                    "/api/approval-tickets/{ticket_id}/decision 으로 승인하고 "
                    "/api/documents/finalize/{ticket_id}/apply 를 호출하면 HWPX가 생성됩니다."
                ),
            },
        }

    @app.post("/api/documents/authoring/preview-hwpx")
    def preview_authoring_hwpx(payload: AuthoringBuildRequest) -> Response:
        """D-02: 검증된 구조를 임시 HWPX 바이트로 렌더링해 반환한다.

        디스크 잔존물 없이 TemporaryDirectory 안에서만 생성하고 바이트를 돌려준다.
        content-base 마크다운 → 기존 hwpx_writer 변환 경로를 그대로 재사용한다.
        """
        model_cls = FORMAT_SCHEMAS[payload.format]
        try:
            structure_model = model_cls.model_validate(payload.structure)
        except ValidationError as exc:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "구조 JSON이 양식 스키마에 맞지 않습니다.",
                    "hints": validation_error_hints(exc),
                },
            ) from exc

        structure = structure_model.model_dump()
        title = (payload.title or "").strip() or str(
            structure.get("title") or structure.get("subject") or "문서"
        )
        markdown = build_content_base_markdown(payload.format, structure)
        with tempfile.TemporaryDirectory(prefix="gongmu-hwpx-preview-") as temp_dir:
            output_path = Path(temp_dir) / "preview.hwpx"
            write_public_hwpx_document(
                output_path=output_path,
                title=title,
                purpose=_content_base_purpose(payload.format, structure),
                template_key="report",
                content_markdown=markdown,
                document_format=cast(DocumentFormat, payload.format),
            )
            data = output_path.read_bytes()
        return Response(
            content=data,
            media_type="application/octet-stream",
            headers={"Content-Disposition": 'attachment; filename="preview.hwpx"'},
        )

    # ------------------------------------------------------------------
    # 임의형식(custom): 사용자 양식 업로드 → 감지 → 값 제안 → 채우기/본문 반영
    # ------------------------------------------------------------------

    @app.post("/api/documents/authoring/custom-template", status_code=201)
    async def upload_custom_authoring_template(file: UploadFile = File(...)) -> dict[str, Any]:
        """임의형식 양식(hwpx/hwtx) 업로드 — 기존 custom template 저장 인프라를 재사용한다."""
        try:
            item = deps.documents.save_custom_template(file.filename or "template.hwpx", await file.read())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"item": item}

    @app.post("/api/documents/authoring/custom-detect")
    def detect_custom_authoring_template(payload: CustomDetectRequest) -> dict[str, Any]:
        """kordoc `fill --dry-run` 으로 빈 라벨-값 필드를 감지해 폼/문서형을 판정한다."""
        template_path = _resolve_custom_template_path(payload.template_path)
        try:
            result = detect_custom_template_fields(template_path)
        except KordocCliUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        deps.db.log(
            feature="documents",
            action="documents.authoring.custom_detect",
            status="success",
            inputs={"template_path": str(template_path)},
            outputs={"mode": result["mode"], "empty_fields": len(result["fields"])},
        )
        return result

    @app.post("/api/documents/authoring/custom-fill-suggest")
    def suggest_custom_authoring_fill(payload: CustomFillSuggestRequest) -> dict[str, Any]:
        """LLM이 각 필드 라벨을 질문으로 바꿔 [내용]에서 값을 찾아 제안한다(근거 없으면 생략)."""
        labels = payload.labels()
        if not labels:
            raise HTTPException(
                status_code=400,
                detail={"message": "제안할 필드가 없습니다.", "hints": ["fields: 감지된 필드 라벨을 전달하세요."]},
            )
        transcript = _load_session_transcript(payload.session_id)
        content_text = build_custom_fill_content_text(
            instruction=payload.instruction,
            transcript=transcript,
            reference_texts=payload.reference_texts,
        )
        numbered = "\n".join(f"{index}. {label}" for index, label in enumerate(labels, start=1))
        messages = [
            {"role": "system", "text": CUSTOM_FORM_FILL_SYSTEM_PROMPT},
            {
                "role": "user",
                "text": f"[양식 빈 필드 {len(labels)}개]\n{numbered}\n\n[내용]\n{content_text}",
            },
        ]
        llm = _resolve_llm()
        try:
            raw = str(llm(messages, temperature=0.2))
        except LLMGenerationError as exc:
            raise HTTPException(
                status_code=502, detail=f"값 제안 LLM 호출에 실패했습니다: {exc}"
            ) from exc
        values = match_custom_form_values(raw, labels)
        return {"values": values, "matched_count": len(values), "total_fields": len(labels)}

    @app.post("/api/documents/authoring/custom-fill-apply", status_code=201)
    def apply_custom_authoring_fill(payload: CustomFillApplyRequest) -> dict[str, Any]:
        """검토·수정된 값으로 kordoc `fill` 실행 — 라벨·표·서식은 보존하고 값만 채운다."""
        template_path = _resolve_custom_template_path(payload.template_path)
        values = {
            str(label).strip(): str(value).strip()
            for label, value in payload.values.items()
            if str(label).strip() and str(value).strip()
        }
        if not values:
            raise HTTPException(
                status_code=422,
                detail="채울 값이 없습니다. 작성 콘텐츠에서 필드 값을 입력해 주세요.",
            )

        with tempfile.TemporaryDirectory(prefix="gongmu-custom-fill-") as temp_dir:
            values_path = Path(temp_dir) / "values.json"
            values_path.write_text(json.dumps(values, ensure_ascii=False), encoding="utf-8")
            try:
                # kordoc fill 은 결과 hwpx 를 stdout 으로 출력(-o 미보장) → 바이트로 캡처한다(ax와 동일).
                completed = _run_kordoc_cli(
                    ["fill", str(template_path), "-j", str(values_path), "--silent"]
                )
            except KordocCliUnavailable as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
        stderr_text = _decode_output(completed.stderr)
        output_bytes = completed.stdout or b""
        if completed.returncode != 0 and not output_bytes.startswith(_HWPX_MAGIC):
            message = stderr_text.strip() or "kordoc fill 실행 실패"
            raise HTTPException(status_code=502, detail=f"양식 채우기에 실패했습니다: {message[:200]}")
        if len(output_bytes) < 200 or not output_bytes.startswith(_HWPX_MAGIC):
            raise HTTPException(status_code=502, detail="양식 채우기 결과가 유효한 HWPX가 아닙니다.")

        output_path = _allocate_custom_output_path(payload.output_name, template_path, "_작성")
        output_path.write_bytes(output_bytes)

        filled_match = _KORDOC_FILLED_PATTERN.search(stderr_text)
        filled_count = int(filled_match.group(1)) if filled_match else len(values)
        unmatched: list[str] = []
        unmatched_match = re.search(r"매칭 실패:\s*(.+)", stderr_text)
        if unmatched_match:
            unmatched = [part.strip() for part in unmatched_match.group(1).split(",") if part.strip()]
        deps.db.log(
            feature="documents",
            action="documents.authoring.custom_fill_applied",
            status="success",
            inputs={"template_path": str(template_path), "requested_fields": len(values)},
            outputs={"path": str(output_path), "filled_count": filled_count, "unmatched": unmatched},
        )
        return {
            "artifact": {"path": str(output_path), "format": "hwpx"},
            "filled_count": filled_count,
            "requested_count": len(values),
            "unmatched": unmatched,
            "note": "양식의 표·서식은 보존하고 빈 필드 값만 채웠습니다. 한컴오피스에서 최종 확인하세요.",
        }

    @app.post("/api/documents/authoring/custom-patch", status_code=201)
    def patch_custom_authoring_template(payload: CustomPatchRequest) -> dict[str, Any]:
        """문서형 양식: organize 마크다운을 본문 문단에 매핑해 kordoc `patch` 로 반영한다.

        v1 단순화: ax 의 classify→rewrite 3-pass 대신 정리된 내용을 문단 순서대로
        매핑한다(표·이미지·각주·정형구 문단은 원본 보존).
        """
        template_path = _resolve_custom_template_path(payload.template_path)
        if not payload.instruction.strip() and not payload.session_id and not payload.reference_texts:
            raise HTTPException(
                status_code=400,
                detail="반영할 내용이 없습니다. 지시/개요를 입력하거나 업무대화 세션을 연결하세요.",
            )
        transcript = _load_session_transcript(payload.session_id)

        with tempfile.TemporaryDirectory(prefix="gongmu-custom-patch-") as temp_dir:
            workdir = Path(temp_dir)
            parsed_path = workdir / "template.md"
            try:
                parse_run = _run_kordoc_cli(
                    [str(template_path), "-o", str(parsed_path), "--silent"]
                )
            except KordocCliUnavailable as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
            if parse_run.returncode != 0 or not parsed_path.is_file():
                message = _decode_output(parse_run.stderr).strip() or "kordoc 파싱 실패"
                raise HTTPException(status_code=502, detail=f"양식을 읽지 못했습니다: {message[:200]}")
            template_markdown = parsed_path.read_text(encoding="utf-8")
            if not template_markdown.strip():
                raise HTTPException(status_code=400, detail="양식에서 본문을 찾지 못했습니다(빈 문서).")

            try:
                organized_markdown = organize_content(
                    _resolve_llm(),
                    instruction=payload.instruction,
                    reference_texts=payload.reference_texts,
                    transcript=transcript,
                )
            except LLMGenerationError as exc:
                raise HTTPException(
                    status_code=502, detail=f"내용 정리 단계에서 LLM 호출에 실패했습니다: {exc}"
                ) from exc

            edited_markdown, replaced_blocks = build_custom_patch_markdown(
                template_markdown, organized_markdown
            )
            if replaced_blocks == 0:
                raise HTTPException(
                    status_code=422,
                    detail="양식에서 교체할 본문 문단을 찾지 못했습니다(표·이미지 위주 양식일 수 있습니다).",
                )
            edited_path = workdir / "edited.md"
            edited_path.write_text(edited_markdown, encoding="utf-8")

            patched_path = workdir / "patched.hwpx"
            patch_run = _run_kordoc_cli(
                ["patch", str(template_path), str(edited_path), "-o", str(patched_path)]
            )
            # patch 는 일부 변경을 skip 하면 non-zero exit 을 내지만 파일은 정상 생성한다(ax 주석).
            # exit code 대신 "적용된 변경 수 + 산출물 존재"로 성공을 판정한다.
            patch_log = f"{_decode_output(patch_run.stdout)}\n{_decode_output(patch_run.stderr)}"
            applied_match = _KORDOC_APPLIED_PATTERN.search(patch_log)
            applied_changes = int(applied_match.group(1)) if applied_match else 0
            if applied_changes == 0 or not patched_path.is_file():
                raise HTTPException(
                    status_code=422,
                    detail="양식과 정리된 내용이 맞지 않아 반영된 변경이 없습니다. 지시를 더 구체적으로 적어 주세요.",
                )
            output_path = _allocate_custom_output_path(payload.output_name, template_path, "_AI수정")
            output_path.write_bytes(patched_path.read_bytes())

        deps.db.log(
            feature="documents",
            action="documents.authoring.custom_patch_applied",
            status="success",
            inputs={"template_path": str(template_path), "replaced_blocks": replaced_blocks},
            outputs={"path": str(output_path), "applied_changes": applied_changes},
        )
        return {
            "artifact": {"path": str(output_path), "format": "hwpx"},
            "applied_changes": applied_changes,
            "replaced_blocks": replaced_blocks,
            "organized_markdown": organized_markdown,
            "note": "양식의 표·로고·서식은 보존한 채 본문 문단만 교체했습니다. 한컴오피스에서 최종 확인하세요.",
        }

    @app.get(outputs_file_path)
    def serve_document_output_file(path: str) -> FileResponse:
        """finalize apply 산출물(HWPX 등)을 서빙한다. documents_root 하위만 허용."""
        documents_root = Path(deps.paths.documents_root).resolve()
        try:
            target = Path(path).resolve()
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="올바르지 않은 파일 경로입니다.") from exc
        if target != documents_root and documents_root not in target.parents:
            raise HTTPException(
                status_code=403, detail="문서 산출물 폴더 밖의 파일은 열 수 없습니다."
            )
        if not target.is_file():
            raise HTTPException(status_code=404, detail="산출물 파일을 찾을 수 없습니다.")
        return FileResponse(
            target, media_type="application/octet-stream", filename=target.name
        )
