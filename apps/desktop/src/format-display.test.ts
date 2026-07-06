import { describe, expect, it } from "vitest";

import {
  describeExcerptForDisplay,
  displayTitleForFile,
  fileStemFromPath,
  hasOutlineHierarchy,
  looksLikeTableRowText,
  splitOutlineDisplayLines,
} from "./shared/format";

// 2026-07 사용자 피드백: 파싱 산출물(제목/발췌)이 날것으로 노출되지 않도록 하는
// 표시 보정 헬퍼의 단위 테스트.
describe("displayTitleForFile", () => {
  it("keeps a normal document title as-is", () => {
    expect(displayTitleForFile("2026년 예산 편성 계획", "C:/Docs/업무자료/budget.hwpx")).toBe(
      "2026년 예산 편성 계획",
    );
  });

  it("replaces PPT master boilerplate with the file name", () => {
    expect(
      displayTitleForFile("Click to edit Master title style", "C:/Docs/발표자료/월간보고.pptx"),
    ).toBe("월간보고");
  });

  it("replaces a spreadsheet first-row title (month columns) with the file name", () => {
    expect(
      displayTitleForFile("202506 202507 202508 202509 합계", "C:/Docs/실적/판매실적.xlsx"),
    ).toBe("판매실적");
  });

  it("replaces a repeated table-cell title with the file name", () => {
    expect(
      displayTitleForFile(
        "판매금액 (-) 판매금액 (-) 판매금액 (-) 판매금액 (-)",
        "C:\\Docs\\실적\\3분기 실적.xlsx",
      ),
    ).toBe("3분기 실적");
  });

  it("falls back to the file stem when the title is empty (windows backslash path)", () => {
    expect(displayTitleForFile("", "C:\\Docs\\업무자료\\주간보고.hwpx")).toBe("주간보고");
    expect(displayTitleForFile(null, "C:/Docs/업무자료/주간보고.hwpx")).toBe("주간보고");
  });

  it("replaces slide/sheet placeholder titles", () => {
    expect(displayTitleForFile("Slide 1", "C:/Docs/발표.pptx")).toBe("발표");
    expect(displayTitleForFile("Sheet1", "C:/Docs/정리.xlsx")).toBe("정리");
  });
});

describe("fileStemFromPath", () => {
  it("handles both slash styles and strips the extension", () => {
    expect(fileStemFromPath("C:\\Docs\\업무\\계획서.hwpx")).toBe("계획서");
    expect(fileStemFromPath("C:/Docs/업무/계획서.hwpx")).toBe("계획서");
    expect(fileStemFromPath("")).toBe("");
  });
});

describe("looksLikeTableRowText", () => {
  it("detects numeric-dominant rows and repeated cells", () => {
    expect(looksLikeTableRowText("202506 202507 202508 202509 202510 합계")).toBe(true);
    expect(
      looksLikeTableRowText("판매금액 (-) 판매금액 (-) 판매금액 (-) 판매금액 (-)"),
    ).toBe(true);
  });

  it("does not flag a normal sentence", () => {
    expect(
      looksLikeTableRowText("다음 분기 예산 편성안을 검토하고 주요 변경점을 정리한다."),
    ).toBe(false);
  });
});

describe("describeExcerptForDisplay", () => {
  it("returns null for empty input", () => {
    expect(describeExcerptForDisplay(null)).toBeNull();
    expect(describeExcerptForDisplay("   ")).toBeNull();
  });

  it("passes a normal sentence through as text", () => {
    const display = describeExcerptForDisplay("개인정보 처리 기준을 점검한다");
    expect(display).toEqual({ kind: "text", text: "개인정보 처리 기준을 점검한다" });
  });

  it("summarizes a single-line table-cell dump", () => {
    const raw = "판매금액 (-) 판매금액 (-) 판매금액 (-) 판매금액 (-) 판매금액 (-)";
    const display = describeExcerptForDisplay(raw);
    expect(display?.kind).toBe("table");
    if (display?.kind === "table") {
      expect(display.rowCount).toBe(1);
      expect(display.firstRowPreview.startsWith("판매금액 (-)")).toBe(true);
      expect(display.raw).toBe(raw);
    }
  });

  it("summarizes multi-line numeric table rows with a row count", () => {
    const raw = [
      "구분\t202506\t202507\t202508\t합계",
      "1,200 3,400 5,600 7,800 17,000 100%",
      "2,100 4,300 6,500 8,700 21,600 100%",
    ].join("\n");
    const display = describeExcerptForDisplay(raw);
    expect(display?.kind).toBe("table");
    if (display?.kind === "table") {
      expect(display.rowCount).toBe(3);
      expect(display.firstRowPreview).toContain("구분");
    }
  });

  it("truncates a long first row in the preview", () => {
    const longRow = Array.from({ length: 30 }, (_, i) => `${i * 111}`).join(" ");
    const display = describeExcerptForDisplay(longRow);
    expect(display?.kind).toBe("table");
    if (display?.kind === "table") {
      expect(display.firstRowPreview.length).toBeLessThanOrEqual(61);
      expect(display.firstRowPreview.endsWith("…")).toBe(true);
    }
  });
});

describe("splitOutlineDisplayLines / hasOutlineHierarchy", () => {
  it("keeps 개조식 markers and assigns depth", () => {
    const lines = splitOutlineDisplayLines(
      ["□ 추진 배경", "◦ 전력비 3.2억 원", "- 냉난방 61%", "※ 지침 근거"].join("\n"),
    );
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ depth: 0, kind: "bullet", text: "□ 추진 배경" });
    expect(lines[1]).toMatchObject({ depth: 1, kind: "bullet" });
    expect(lines[2]).toMatchObject({ depth: 2, kind: "bullet" });
    expect(lines[3]).toMatchObject({ depth: 1, kind: "note" });
    expect(hasOutlineHierarchy(lines)).toBe(true);
  });

  it("strips markdown heading markers and marks them as headings", () => {
    const lines = splitOutlineDisplayLines("### 세부 계획\n본문 내용");
    expect(lines[0]).toMatchObject({ depth: 1, kind: "heading", text: "세부 계획" });
    expect(lines[1]).toMatchObject({ kind: "text" });
  });

  it("treats a single plain line as non-hierarchical", () => {
    const lines = splitOutlineDisplayLines("개인정보 처리 기준을 점검한다");
    expect(hasOutlineHierarchy(lines)).toBe(false);
  });
});
