// P3(위키 상세검색 출처 개선, 2026-07): 상세검색 답변의 출처(citation)를
// (답변 반영 여부, 품질) 우선순위로 정렬하고, 각 출처가 실제 답변 본문에
// 반영됐는지 결정적 휴리스틱으로 표시한다. LLM 무관 순수 함수(단위테스트 대상).
//
// 배경: 백엔드 citations는 이미 검색 점수 내림차순이지만, "실제로 답변에
// 쓰였는지"를 알려주는 신호가 없다(무근거 억제만 전체 단위로 존재). 그래서
// 답변 본문과 출처(제목/발췌)의 특징 토큰 겹침으로 "답변 반영"을 추정한다.
// 겹침이 없다고 무조건 숨기지는 않는다 — 경량 모델이 패러프레이즈하면 토큰이
// 안 겹칠 수 있어(위음성) 실제 출처를 은폐할 위험이 있기 때문. 대신 정렬로
// 반영된 출처를 위로 올리고 배지로 표시한다.

import type { KnowledgeAskCitation } from "./api";

// 너무 흔해 변별력이 없는 토큰(조사/서술어/형식어). 겹침 판정에서 제외한다.
const CITATION_STOPWORDS = new Set<string>([
  "그리고", "그러나", "그래서", "합니다", "입니다", "때문", "경우", "대한", "관련",
  "위한", "있는", "있다", "한다", "하는", "된다", "되는", "또는", "이다", "같은",
  "따라", "통해", "우리", "여기", "지금", "모든", "각각", "해당", "다음", "이번",
]);

/** 문자열에서 변별력 있는 토큰(3자 이상, 불용어 제외)만 추출한다. */
function distinctiveTokens(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }
  const normalized = text.normalize("NFC").toLowerCase();
  const raw = normalized.split(/[^0-9a-z가-힣]+/u).filter(Boolean);
  const out: string[] = [];
  for (const token of raw) {
    if (token.length < 3) {
      continue; // 1~2자는 흔해서 오탐이 많다
    }
    if (CITATION_STOPWORDS.has(token)) {
      continue;
    }
    out.push(token);
  }
  return out;
}

type ReflectableCitation = Pick<KnowledgeAskCitation, "title" | "snippet">;

/**
 * 출처가 답변 본문에 반영됐는지 추정한다.
 * (1) 제목(파일명 유래)의 4자 이상 토큰이 답변에 등장하거나,
 * (2) 발췌의 변별 토큰이 2개 이상 답변에 등장하면 반영으로 본다.
 */
export function citationReflectedInAnswer(
  citation: ReflectableCitation,
  answerText: string,
): boolean {
  const answer = (answerText ?? "").normalize("NFC").toLowerCase();
  if (answer.length === 0) {
    return false;
  }
  for (const token of distinctiveTokens(citation.title)) {
    if (token.length >= 4 && answer.includes(token)) {
      return true;
    }
  }
  const seen = new Set<string>();
  let hits = 0;
  for (const token of distinctiveTokens(citation.snippet)) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    if (answer.includes(token)) {
      hits += 1;
      if (hits >= 2) {
        return true;
      }
    }
  }
  return false;
}

export type OrderedCitation = {
  citation: KnowledgeAskCitation;
  reflected: boolean;
  /** 정렬 후 순위(0-base) — 카드 번호 표시에 사용 */
  rank: number;
};

function qualityValue(citation: KnowledgeAskCitation): number {
  return typeof citation.quality_score === "number" ? citation.quality_score : -1;
}

/**
 * 상세검색 출처를 (답변 반영 desc, 품질 desc, 원 검색순 asc)로 정렬한다.
 * 원 검색순(index)을 마지막 타이브레이커로 두어 안정 정렬을 보장한다.
 */
export function orderCitationsForDisplay(
  citations: KnowledgeAskCitation[],
  answerText: string,
): OrderedCitation[] {
  const decorated = citations.map((citation, index) => ({
    citation,
    reflected: citationReflectedInAnswer(citation, answerText),
    index,
  }));
  decorated.sort((a, b) => {
    if (a.reflected !== b.reflected) {
      return a.reflected ? -1 : 1;
    }
    const qa = qualityValue(a.citation);
    const qb = qualityValue(b.citation);
    if (qa !== qb) {
      return qb - qa;
    }
    return a.index - b.index;
  });
  return decorated.map(({ citation, reflected }, rank) => ({ citation, reflected, rank }));
}

/** 정렬된 출처 중 답변에 반영된 것의 개수(헤더 요약용). */
export function countReflected(ordered: OrderedCitation[]): number {
  return ordered.reduce((total, item) => total + (item.reflected ? 1 : 0), 0);
}

/**
 * 출처 발췌를 가독성 있게 정리한다. PDF 추출 특유의 '( 에이전틱 )'식 괄호·문장부호
 * 앞뒤 공백을 붙이고, 줄 끝 공백/과도한 빈 줄을 정리한 뒤 너무 길면 문장·공백 경계에서
 * 자른다. 표/개조식 구조 판정을 깨지 않도록 개행과 탭(셀 구분)은 보존한다.
 */
export function cleanCitationSnippet(
  text: string | null | undefined,
  maxChars = 360,
): string {
  if (!text) {
    return "";
  }
  let cleaned = text
    .normalize("NFC")
    .replace(/\(\s+/g, "(") // "( 에이전틱" → "(에이전틱"
    .replace(/\s+\)/g, ")") // "에이전틱 )" → "에이전틱)"
    .replace(/\s+([,.;:!?、。])/g, "$1") // " ," → ","  " ." → "."
    .replace(/[ \t]+$/gm, ""); // 줄 끝 공백 제거(개행 보존)
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim(); // 과도한 빈 줄 축소
  if (cleaned.length > maxChars) {
    const slice = cleaned.slice(0, maxChars);
    const boundary = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("다."),
      slice.lastIndexOf("\n"),
      slice.lastIndexOf(" "),
    );
    cleaned = `${(boundary > maxChars * 0.5 ? slice.slice(0, boundary + 1) : slice).trimEnd()}…`;
  }
  return cleaned;
}

/** 품질 점수(0~1)를 3단계 티어로 나눈다(카드 품질 배지 색상용). */
export function qualityTier(score: number): "high" | "mid" | "low" {
  if (score >= 0.75) {
    return "high";
  }
  if (score >= 0.5) {
    return "mid";
  }
  return "low";
}
