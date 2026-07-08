import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: vi.fn(async () => null),
  startDesktopSidecar: vi.fn(),
  stopDesktopSidecar: vi.fn(),
  restartDesktopSidecar: vi.fn(),
  pickDirectory: vi.fn(async () => null),
  launchAnythingQuery: vi.fn(),
  openExternalTarget: vi.fn(async () => undefined),
  copyTextToClipboard: vi.fn(async () => undefined),
}));

import { renderMarkdownContent } from "./app";

function renderMarkdown(markdown: string, onOpenExternal?: (target: string) => void) {
  return render(<div>{renderMarkdownContent(markdown, onOpenExternal)}</div>);
}

describe("renderMarkdownContent", () => {
  it("converts asterisk bullets into a two-item list and keeps bold intact", () => {
    const { container } = renderMarkdown("*   **리스크:** 일정 지연 가능성\n*   대응 방안 마련");

    const lists = container.querySelectorAll("ul");
    expect(lists).toHaveLength(1);
    const items = Array.from(lists[0]!.children).filter((element) => element.tagName === "LI");
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector("strong")?.textContent).toBe("리스크:");
    expect(items[0]!.textContent).toContain("일정 지연 가능성");
    expect(items[1]!.textContent).toBe("대응 방안 마련");
  });

  it("normalizes • and ◦ bullets into list items", () => {
    const { container } = renderMarkdown("• 첫 항목\n◦ 둘째 항목");

    const items = container.querySelectorAll("ul li");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe("첫 항목");
    expect(items[1]!.textContent).toBe("둘째 항목");
  });

  it("nests indented list items under their parent item", () => {
    const { container } = renderMarkdown("- 상위 항목\n  - 하위 항목\n- 다음 항목");

    const topList = container.querySelector("ul");
    expect(topList).not.toBeNull();
    const topItems = Array.from(topList!.children).filter((element) => element.tagName === "LI");
    expect(topItems).toHaveLength(2);

    const nestedList = topItems[0]!.querySelector("ul");
    expect(nestedList).not.toBeNull();
    expect(nestedList!.textContent).toContain("하위 항목");
    expect(topItems[1]!.textContent).toBe("다음 항목");
  });

  it("supports up to three nesting levels", () => {
    const { container } = renderMarkdown("- 1단계\n  - 2단계\n    - 3단계");

    const level1 = container.querySelector("ul > li");
    const level2 = level1?.querySelector("ul > li");
    const level3 = level2?.querySelector("ul > li");
    expect(level3?.textContent).toBe("3단계");
  });

  it("keeps each source line as its own paragraph instead of joining lines", () => {
    const { container } = renderMarkdown("첫 번째 줄입니다.\n두 번째 줄입니다.");

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]!.textContent).toBe("첫 번째 줄입니다.");
    expect(paragraphs[1]!.textContent).toBe("두 번째 줄입니다.");
  });

  it("no longer re-splits long paragraphs into artificial sentence chunks", () => {
    const longLine = "결재권자가 확인해야 하는 핵심 근거를 정리했습니다. ".repeat(8).trim();
    expect(longLine.length).toBeGreaterThan(180);

    const { container } = renderMarkdown(longLine);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("still renders headings, quotes, tables, code fences and open-target buttons", () => {
    const onOpenExternal = vi.fn();
    const markdown = [
      "# 요약",
      "> 인용 줄",
      "| 항목 | 값 |",
      "| --- | --- |",
      "| 근거 | 첨부 |",
      "- 파일 열기: C:\\tmp\\result.hwpx",
      "```json",
      '{"ok":true}',
      "```",
    ].join("\n");
    const { container, getByRole } = renderMarkdown(markdown, onOpenExternal);

    expect(getByRole("heading", { name: "요약" })).toBeInTheDocument();
    expect(container.querySelector("blockquote")?.textContent).toContain("인용 줄");
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("pre code")?.textContent).toContain('{"ok":true}');

    const openButton = getByRole("button", { name: /파일 열기/ });
    openButton.click();
    expect(onOpenExternal).toHaveBeenCalledWith("C:\\tmp\\result.hwpx");
  });

  it("preserves source ordinals across blank-line-separated numbered items (no all-1 bug)", () => {
    const { container } = renderMarkdown("1. 첫째 과제\n\n2. 둘째 과제\n\n3. 셋째 과제");

    const ordered = container.querySelectorAll("ol");
    expect(ordered).toHaveLength(1);
    const items = ordered[0]!.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0]!.getAttribute("value")).toBe("1");
    expect(items[1]!.getAttribute("value")).toBe("2");
    expect(items[2]!.getAttribute("value")).toBe("3");
  });

  it("normalizes fullwidth digits and circled numerals into ordered items", () => {
    const { container } = renderMarkdown("１. 전각 항목\n② 원문자 항목");

    const items = container.querySelectorAll("ol li");
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]!.textContent).toContain("전각 항목");
    const circled = Array.from(items).find((li) => li.textContent?.includes("원문자 항목"));
    expect(circled).toBeTruthy();
    expect(circled!.getAttribute("value")).toBe("2");
  });
});
