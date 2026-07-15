import { describe, expect, it } from "vitest";
import {
  citationReflectedInAnswer,
  cleanCitationSnippet,
  countReflected,
  orderCitationsForDisplay,
  qualityTier,
} from "./knowledgeCitations";
import type { KnowledgeAskCitation } from "./api";

function citation(overrides: Partial<KnowledgeAskCitation>): KnowledgeAskCitation {
  return {
    title: "문서",
    file_path: "/docs/문서.pdf",
    ...overrides,
  };
}

describe("citationReflectedInAnswer", () => {
  it("flags a citation when distinctive snippet tokens appear in the answer", () => {
    const answer = "출장여비는 교통비, 일비, 숙박비로 구분되며 실제 경로에 따라 지급됩니다.";
    expect(
      citationReflectedInAnswer(
        { title: "여비지급세칙", snippet: "출장여비 교통비 숙박비 지급 기준" },
        answer,
      ),
    ).toBe(true);
  });

  it("does not flag a citation whose content is absent from the answer", () => {
    const answer = "출장여비는 교통비, 일비, 숙박비로 구분됩니다.";
    expect(
      citationReflectedInAnswer(
        { title: "채용공고", snippet: "신규 임용 시험 응시원서 접수 기간" },
        answer,
      ),
    ).toBe(false);
  });

  it("flags by a 4+ char title token appearing in the answer", () => {
    const answer = "개인정보보호법에 따라 처리 기준을 점검한다.";
    expect(
      citationReflectedInAnswer(
        { title: "개인정보보호법 해설", snippet: "무관한 발췌" },
        answer,
      ),
    ).toBe(true);
  });

  it("returns false for an empty answer (streaming not started)", () => {
    expect(
      citationReflectedInAnswer({ title: "여비지급세칙", snippet: "출장여비 교통비" }, ""),
    ).toBe(false);
  });

  it("ignores short/stopword tokens to avoid false positives", () => {
    const answer = "그리고 이것은 대한 경우에 있다.";
    expect(
      citationReflectedInAnswer({ title: "가나", snippet: "그리고 대한 경우 있다 한다" }, answer),
    ).toBe(false);
  });
});

describe("orderCitationsForDisplay", () => {
  it("floats answer-reflected citations above unreflected ones, then sorts by quality", () => {
    const answer = "출장여비는 교통비와 숙박비로 구분되어 지급됩니다.";
    const citations = [
      citation({ title: "채용공고", snippet: "임용 시험 응시원서 접수", quality_score: 0.95 }),
      citation({ title: "여비세칙", snippet: "출장여비 교통비 숙박비 지급", quality_score: 0.6 }),
      citation({ title: "여비지침", snippet: "출장여비 숙박비 정산 교통비", quality_score: 0.8 }),
    ];
    const ordered = orderCitationsForDisplay(citations, answer);
    // 반영된 두 건이 먼저(품질 0.8 > 0.6), 미반영 채용공고가 마지막
    expect(ordered.map((item) => item.citation.title)).toEqual(["여비지침", "여비세칙", "채용공고"]);
    expect(ordered.map((item) => item.reflected)).toEqual([true, true, false]);
    expect(ordered.map((item) => item.rank)).toEqual([0, 1, 2]);
    expect(countReflected(ordered)).toBe(2);
  });

  it("is a stable sort — equal reflected+quality keeps original retrieval order", () => {
    const citations = [
      citation({ title: "A", snippet: "무관", quality_score: 0.5 }),
      citation({ title: "B", snippet: "무관", quality_score: 0.5 }),
      citation({ title: "C", snippet: "무관", quality_score: 0.5 }),
    ];
    const ordered = orderCitationsForDisplay(citations, "겹치지 않는 답변 문장");
    expect(ordered.map((item) => item.citation.title)).toEqual(["A", "B", "C"]);
  });

  it("orders citations with missing quality_score last among equally-reflected", () => {
    const citations = [
      citation({ title: "무점수", snippet: "무관", quality_score: null }),
      citation({ title: "점수", snippet: "무관", quality_score: 0.3 }),
    ];
    const ordered = orderCitationsForDisplay(citations, "겹치지 않는 답변");
    expect(ordered.map((item) => item.citation.title)).toEqual(["점수", "무점수"]);
  });
});

describe("cleanCitationSnippet", () => {
  it("fixes spaced parentheses and punctuation from PDF extraction", () => {
    // 여는 괄호 뒤·닫는 괄호 앞·문장부호 앞 공백을 정리한다(여는 괄호 앞 공백은 자연스러워 보존).
    expect(cleanCitationSnippet("수행절차를 AI 가 판단 ( 에이전틱 ) 하고 , 조율한다 .")).toBe(
      "수행절차를 AI 가 판단 (에이전틱) 하고, 조율한다.",
    );
  });

  it("preserves newlines and tabs so outline/table structure survives", () => {
    const outline = "□ 첫째 항목\n\t셀A\t셀B";
    expect(cleanCitationSnippet(outline)).toBe(outline);
  });

  it("truncates long text at a boundary with an ellipsis", () => {
    const long = `${"가나다라마 ".repeat(100)}끝문장.`;
    const cleaned = cleanCitationSnippet(long, 80);
    expect(cleaned.length).toBeLessThanOrEqual(82);
    expect(cleaned.endsWith("…")).toBe(true);
  });

  it("returns empty string for nullish input", () => {
    expect(cleanCitationSnippet(null)).toBe("");
    expect(cleanCitationSnippet(undefined)).toBe("");
  });
});

describe("qualityTier", () => {
  it("maps scores into high/mid/low tiers", () => {
    expect(qualityTier(0.9)).toBe("high");
    expect(qualityTier(0.75)).toBe("high");
    expect(qualityTier(0.6)).toBe("mid");
    expect(qualityTier(0.5)).toBe("mid");
    expect(qualityTier(0.4)).toBe("low");
  });
});
