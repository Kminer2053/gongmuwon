"""T-02 컨텍스트 예산 관리자.

경량 로컬모델(4k~8k 컨텍스트)에서도 장기 업무대화 세션이 입력 상한을 넘지 않도록
턴 프롬프트를 예산(토큰) 안에서 조립한다.

정책(고정 순서):
    가드레일 → 지식폴더 근거 → 첨부 발췌 → [이전 대화 요약] → 최근 N턴 원문

- 최근 턴은 최신 메시지부터(newest-first) 예산이 허용하는 만큼 채운다.
  최신 사용자 메시지는 예산을 초과하더라도 항상 포함한다(질문 자체가 잘리면 안 됨).
- 예산에서 밀려난 과거 턴은 세션의 롤링 요약(work_sessions.context_summary_text)
  한 블록("[이전 대화 요약]")으로 대표된다. 요약이 없으면 그냥 생략된다.
- 롤링 요약은 매 턴 성공 후 증분 갱신된다(LLM 1회 호출, 실패 시 결정론 다이제스트
  또는 기존 요약 유지 — 절대 턴을 막지 않는다).
"""

from __future__ import annotations

from typing import Any

SUMMARY_BLOCK_HEADER = "[이전 대화 요약]"

# 결정론 다이제스트(LLM 미가용 시)의 최대 길이
DETERMINISTIC_DIGEST_CAP = 800

# LLM 요약 결과 저장 상한 (요약이 폭주해 그 자체가 예산을 먹는 것을 방지)
LLM_SUMMARY_CAP = 1200


def estimate_tokens(text: str | None) -> int:
    """저비용 토큰 추정 휴리스틱: ``ceil(len(text) / 2.5)``.

    근거: 일반 서브워드 토크나이저 기준 한국어는 글자당 대략 0.5~0.7토큰,
    영어는 글자당 대략 0.25토큰이다. 공문서 한/영 혼용 텍스트에서
    chars/2.5(글자당 0.4토큰)는 중간값에 가깝고, 짧은 텍스트에서 +1 보정으로
    약간 과대추정(=예산 초과를 막는 안전한 방향)하도록 설계했다.
    정확한 토크나이저 호출은 모델·프로바이더별로 달라 사이드카에서 유지비가 크다.
    """
    if not text:
        return 0
    return int(len(text) / 2.5) + 1


def _system_block(text: str, block_id: str) -> dict[str, Any]:
    """프롬프트용 합성 system 메시지. 기존 turn 조립 결과와 키 호환을 유지한다."""
    return {
        "id": block_id,
        "role": "system",
        "text": text,
        "message_type": "system",
        "status": "completed",
    }


def summary_block_text(rolling_summary: str) -> str:
    return f"{SUMMARY_BLOCK_HEADER}\n{rolling_summary.strip()}"


def _select_recent_messages(
    session_messages: list[dict[str, Any]],
    turn_budget_tokens: int,
) -> tuple[list[dict[str, Any]], int]:
    """최신 메시지부터 예산 안에 담고, (시간순 목록, 사용 토큰)을 돌려준다."""
    included_reversed: list[dict[str, Any]] = []
    used = 0
    for message in reversed(session_messages):
        cost = estimate_tokens(str(message.get("text") or ""))
        if not included_reversed:
            # 최신 메시지(현재 사용자 질문)는 항상 포함
            included_reversed.append(message)
            used += cost
            continue
        if used + cost > turn_budget_tokens:
            break
        included_reversed.append(message)
        used += cost
    return list(reversed(included_reversed)), used


def assemble_turn_context(
    *,
    guardrail_block: str,
    knowledge_block: str | None,
    attachment_block: str | None,
    session_messages: list[dict[str, Any]],
    rolling_summary: str | None,
    budget_tokens: int,
) -> tuple[list[dict[str, Any]], bool, dict[str, int]]:
    """업무대화 턴 프롬프트를 예산 안에서 조립한다.

    Args:
        guardrail_block: 안전 가드레일 시스템 프롬프트 (항상 포함).
        knowledge_block: 지식폴더 근거 블록 (있으면 항상 포함).
        attachment_block: 첨부 발췌 블록 (있으면 항상 포함).
        session_messages: 세션 메시지 목록(오래된 것 → 최신 순). pending/자리표시
            메시지는 호출 측에서 미리 걸러서 넘긴다.
        rolling_summary: 세션 롤링 요약(없으면 None).
        budget_tokens: 입력 토큰 예산.

    Returns:
        (prompt_messages, summary_used, stats)
        stats = {estimated_tokens, included_turns, summarized_turns}
    """
    normalized_summary = (rolling_summary or "").strip() or None

    fixed_messages: list[dict[str, Any]] = [_system_block(guardrail_block, "context-guardrail")]
    if knowledge_block:
        fixed_messages.append(_system_block(knowledge_block, "context-knowledge"))
    if attachment_block:
        fixed_messages.append(_system_block(attachment_block, "context-attachments"))
    fixed_cost = sum(estimate_tokens(message["text"]) for message in fixed_messages)

    summary_text = summary_block_text(normalized_summary) if normalized_summary else None
    summary_cost = estimate_tokens(summary_text) if summary_text else 0

    # 요약이 존재하면 요약 자리를 먼저 예약해 두고 남는 예산으로 최근 턴을 채운다.
    # (모든 턴이 들어가면 요약은 쓰지 않으므로 예약분이 낭비되지만, 그 경우
    #  전체 원문이 이미 예산 안이라는 뜻이라 손해가 없다.)
    turn_budget = budget_tokens - fixed_cost - summary_cost
    included, turns_cost = _select_recent_messages(session_messages, turn_budget)

    summarized_turns = len(session_messages) - len(included)
    summary_used = summarized_turns > 0 and summary_text is not None

    prompt_messages = list(fixed_messages)
    if summary_used:
        assert summary_text is not None
        prompt_messages.append(_system_block(summary_text, "context-rolling-summary"))
    prompt_messages.extend(included)

    estimated_tokens = fixed_cost + (summary_cost if summary_used else 0) + turns_cost
    stats = {
        "estimated_tokens": estimated_tokens,
        "included_turns": len(included),
        "summarized_turns": summarized_turns,
    }
    return prompt_messages, summary_used, stats


def assemble_transcript_context(
    *,
    session_messages: list[dict[str, Any]],
    rolling_summary: str | None,
    budget_tokens: int,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """문서작성(authoring) 업무대화 기록용: 최근 턴 원문 + 요약 블록으로 축약한다.

    반환 transcript 항목은 {"role", "text"} 형태이며, 요약 블록은
    role="summary" 로 표시된다(문서작성 organize 단계가 원문 그대로 싣는다).
    """
    normalized_summary = (rolling_summary or "").strip() or None
    summary_text = summary_block_text(normalized_summary) if normalized_summary else None
    summary_cost = estimate_tokens(summary_text) if summary_text else 0

    turn_budget = budget_tokens - summary_cost
    included, turns_cost = _select_recent_messages(session_messages, turn_budget)
    summarized_turns = len(session_messages) - len(included)
    summary_used = summarized_turns > 0 and summary_text is not None

    transcript: list[dict[str, Any]] = []
    if summary_used:
        assert summary_text is not None
        transcript.append({"role": "summary", "text": summary_text})
    transcript.extend(
        {"role": str(message.get("role") or "user"), "text": str(message.get("text") or "")}
        for message in included
    )
    stats = {
        "estimated_tokens": (summary_cost if summary_used else 0) + turns_cost,
        "included_turns": len(included),
        "summarized_turns": summarized_turns,
    }
    return transcript, stats


def _first_sentence(text: str, cap: int = 120) -> str:
    stripped = " ".join(str(text or "").split())
    if not stripped:
        return ""
    for delimiter in (". ", "? ", "! ", "다. ", "요. ", "\n"):
        index = stripped.find(delimiter)
        if 0 < index < cap:
            return stripped[: index + len(delimiter)].strip()
    return stripped[:cap].strip()


def deterministic_digest(
    previous_summary: str | None,
    user_text: str,
    cap: int = DETERMINISTIC_DIGEST_CAP,
) -> str | None:
    """LLM 없이 만드는 롤링 요약: 턴별 사용자 첫 문장 bullet 누적, cap자 제한.

    최신 발화가 더 중요하므로 cap을 넘으면 오래된 bullet부터 버린다.
    """
    bullets = [
        line.strip()
        for line in str(previous_summary or "").splitlines()
        if line.strip().startswith("- ")
    ]
    sentence = _first_sentence(user_text)
    if sentence:
        bullets.append(f"- {sentence}")
    while bullets and len("\n".join(bullets)) > cap:
        bullets.pop(0)
    digest = "\n".join(bullets).strip()
    return digest or None
