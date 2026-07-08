import type { ReactNode } from "react";

export function renderInlineMarkdown(text: string, onOpenExternal?: (target: string) => void) {
  const nodes: ReactNode[] = [];
  // 위키링크 [[target|alias]] 를 표준 링크·강조보다 먼저 매칭한다(⑤).
  const pattern = /(\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const wikiLink = token.match(/^\[\[([^\]]+)\]\]$/);
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (wikiLink) {
      // Obsidian 위키링크: [[topics/slug|주제]] → 라벨은 alias, 이동 대상은 target(vault-root 상대).
      const inner = wikiLink[1];
      const pipe = inner.indexOf("|");
      const rawTarget = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
      const label = (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim() || rawTarget;
      // 확장자가 없으면 .md 카드로 간주한다(topics/slug → topics/slug.md).
      const target = /\.[a-z0-9]+$/i.test(rawTarget) ? rawTarget : `${rawTarget}.md`;
      nodes.push(
        onOpenExternal ? (
          <button
            key={`${match.index}-wikilink`}
            type="button"
            className="inline-open-target inline-open-target--link"
            onClick={() => onOpenExternal(target)}
          >
            <span>{label}</span>
          </button>
        ) : (
          <span key={`${match.index}-wikilink`}>{label}</span>
        ),
      );
    } else if (link) {
      const label = link[1];
      const target = link[2].trim();
      nodes.push(
        onOpenExternal ? (
          <button
            key={`${match.index}-link`}
            type="button"
            className="inline-open-target inline-open-target--link"
            onClick={() => onOpenExternal(target)}
          >
            <span>{label}</span>
          </button>
        ) : (
          <span key={`${match.index}-link`}>{label}</span>
        ),
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={`${match.index}-code`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={`${match.index}-em`}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function parseOpenTargetLine(text: string): { label: string; target: string } | null {
  const match = text.match(/^(파일 열기|폴더 열기):\s*(.+)$/);
  if (!match) {
    return null;
  }
  return { label: match[1], target: match[2].trim() };
}

export function isMarkdownTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

export function parseMarkdownTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

export type MarkdownListEntry = {
  level: number;
  ordered: boolean;
  text: string;
  number?: number;
};

export function parseMarkdownListLine(rawLine: string): MarkdownListEntry | null {
  const unordered = rawLine.match(/^([ \t]*)-\s+(.*)$/);
  if (unordered) {
    return {
      level: Math.min(2, Math.floor(unordered[1].replace(/\t/g, "  ").length / 2)),
      ordered: false,
      text: unordered[2].trim(),
    };
  }
  const ordered = rawLine.match(/^([ \t]*)(\d+)[.)]\s+(.*)$/);
  if (ordered) {
    return {
      level: Math.min(2, Math.floor(ordered[1].replace(/\t/g, "  ").length / 2)),
      ordered: true,
      text: ordered[3].trim(),
      number: Number.parseInt(ordered[2], 10),
    };
  }
  return null;
}

export function renderMarkdownListItemBody(text: string, onOpenExternal?: (target: string) => void): ReactNode {
  const openTarget = parseOpenTargetLine(text);
  if (openTarget && onOpenExternal) {
    return (
      <button type="button" className="inline-open-target" onClick={() => onOpenExternal(openTarget.target)}>
        <span>{openTarget.label}</span>
        <code>{openTarget.target}</code>
      </button>
    );
  }
  return renderInlineMarkdown(text, onOpenExternal);
}

export function buildMarkdownList(
  entries: MarkdownListEntry[],
  cursor: { index: number },
  level: number,
  keyPrefix: string,
  onOpenExternal?: (target: string) => void,
): ReactNode {
  const ordered = entries[cursor.index]?.ordered ?? false;
  const startNumber = ordered ? entries[cursor.index]?.number : undefined;
  const items: ReactNode[] = [];

  while (cursor.index < entries.length) {
    const entry = entries[cursor.index];
    if (entry.level < level || (entry.level === level && entry.ordered !== ordered)) {
      break;
    }
    cursor.index += 1;
    let childList: ReactNode = null;
    if (cursor.index < entries.length && entries[cursor.index].level > level && level < 2) {
      childList = buildMarkdownList(entries, cursor, level + 1, `${keyPrefix}-${items.length}`, onOpenExternal);
    }
    items.push(
      // ordered 항목은 원문 번호를 value로 보존한다 — 빈 줄로 목록이 갈려도 "1."만 반복되지 않는다.
      <li key={`${keyPrefix}-item-${items.length}`} value={ordered ? entry.number : undefined}>
        {renderMarkdownListItemBody(entry.text, onOpenExternal)}
        {childList}
      </li>,
    );
  }

  return ordered ? (
    <ol key={`${keyPrefix}-ol`} start={startNumber}>
      {items}
    </ol>
  ) : (
    <ul key={`${keyPrefix}-ul`}>{items}</ul>
  );
}

export function renderMarkdownContent(markdown: string, onOpenExternal?: (target: string) => void) {
  const normalizedMarkdown = markdown
    .replace(/\r/g, "")
    // gemma가 섞어 내보내는 전각 숫자·구두점을 ASCII로 정규화한다 (2026-07-08 리뷰: 숫자/원문자 혼재).
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/．/g, ".")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    // 원문자 ①②③…를 줄머리에서 "1. " 형태의 순서 목록 마커로 치환한다.
    .replace(
      /^([ \t]*)([①-⑳])[ \t]*/gm,
      (_match, indent: string, ch: string) => `${indent}${ch.charCodeAt(0) - 0x2460 + 1}. `,
    )
    // 선행 글머리표(*, •, ◦)는 들여쓰기를 유지한 채 "- "로 통일한다.
    .replace(/^([ \t]*)[*•◦][ \t]+/gm, "$1- ")
    // 문장 중간에 이어붙은 번호/대시 항목은 줄로 분리하되, 줄바꿈과 들여쓰기는 보존한다.
    .replace(/([^\s])[ \t]+(\d+[.)])[ \t]+/g, "$1\n$2 ")
    .replace(/([^\s])[ \t]+(-[ \t]+)/g, "$1\n$2");
  const lines = normalizedMarkdown.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trimEnd() ?? "";
    const trimmed = line.trim();

    if (!trimmed || /^#{1,6}$/.test(trimmed)) {
      // 내용 없는 "###" 단독 줄(경량 모델이 자주 출력)은 표시하지 않는다.
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 4) as 2 | 3 | 4;
      const title = heading[2];
      if (level === 2) {
        blocks.push(<h2 key={`block-${index}`}>{renderInlineMarkdown(title, onOpenExternal)}</h2>);
      } else if (level === 3) {
        blocks.push(<h3 key={`block-${index}`}>{renderInlineMarkdown(title, onOpenExternal)}</h3>);
      } else {
        blocks.push(<h4 key={`block-${index}`}>{renderInlineMarkdown(title, onOpenExternal)}</h4>);
      }
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index]?.trim() ?? "").startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre key={`block-${index}`} className="chat-code-block">
          {language ? <span className="chat-code-block__lang">{language}</span> : null}
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && (lines[index]?.trim() ?? "").startsWith(">")) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`block-${index}`}>
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={`quote-${index}-${quoteIndex}`}>{renderInlineMarkdown(quoteLine, onOpenExternal)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (trimmed.includes("|") && index + 1 < lines.length && isMarkdownTableDivider(lines[index + 1] ?? "")) {
      const headers = parseMarkdownTableRow(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length) {
        const row = (lines[index] ?? "").trim();
        if (!row || !row.includes("|")) {
          break;
        }
        rows.push(parseMarkdownTableRow(row));
        index += 1;
      }
      blocks.push(
        <div key={`block-${index}`} className="chat-markdown-table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((header, headerIndex) => (
                  <th key={`table-head-${index}-${headerIndex}`}>{renderInlineMarkdown(header, onOpenExternal)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`table-row-${index}-${rowIndex}`}>
                  {headers.map((_, cellIndex) => (
                    <td key={`table-cell-${index}-${rowIndex}-${cellIndex}`}>
                      {renderInlineMarkdown(row[cellIndex] ?? "", onOpenExternal)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (parseMarkdownListLine(lines[index] ?? "")) {
      // 들여쓰기(2칸 = 1단계)를 유지한 채 목록 항목을 모아 최대 3단계 중첩 목록으로 만든다.
      const entries: MarkdownListEntry[] = [];
      let previousLevel = -1;
      while (index < lines.length) {
        const entry = parseMarkdownListLine(lines[index] ?? "");
        if (!entry) {
          // 빈 줄 하나로 끊긴 경우 다음 줄이 같은 목록 항목이면 이어서 하나의 목록으로 유지한다
          // (gemma는 번호 항목 사이에 빈 줄을 자주 넣어 목록이 갈라지고 번호가 리셋됐다).
          const isBlank = (lines[index] ?? "").trim() === "";
          if (isBlank && parseMarkdownListLine(lines[index + 1] ?? "")) {
            index += 1;
            continue;
          }
          break;
        }
        const level = Math.min(entry.level, previousLevel + 1);
        entries.push({ ...entry, level });
        previousLevel = level;
        index += 1;
      }
      const cursor = { index: 0 };
      while (cursor.index < entries.length) {
        blocks.push(
          buildMarkdownList(entries, cursor, entries[cursor.index].level, `list-${index}-${cursor.index}`, onOpenExternal),
        );
      }
      continue;
    }

    // 작성자의 줄 구조를 그대로 살린다 — 연속된 줄을 하나의 문단으로 합치지 않는다.
    blocks.push(<p key={`block-${index}`}>{renderInlineMarkdown(trimmed, onOpenExternal)}</p>);
    index += 1;
  }

  return blocks;
}
