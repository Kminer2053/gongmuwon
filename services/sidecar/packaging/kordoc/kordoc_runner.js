#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const filePath = process.argv[2];

if (!filePath) {
  console.log(JSON.stringify({ success: false, error: "file path is required" }));
  process.exit(0);
}

// 설치본 자가진단: kordoc 패키지가 실제로 로드되는지까지 검증한다.
// (러너 파일 존재만으로 "사용 가능"이라고 판단했다가 조용히 폴백된 사고 방지)
if (filePath === "--selftest") {
  try {
    const kordoc = await import("kordoc");
    const parse = kordoc.parse ?? kordoc.default?.parse;
    const ok = typeof parse === "function";
    console.log(JSON.stringify({ success: ok, selftest: true, version: kordoc.version ?? "" }));
    process.exit(ok ? 0 : 1);
  } catch (error) {
    console.log(
      JSON.stringify({
        success: false,
        selftest: true,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  }
}

function normalizeBlock(block) {
  const type = String(block?.type ?? "").toLowerCase();
  if (type === "heading") {
    return {
      type: "heading",
      text: String(block.text ?? block.content ?? ""),
      level: Number(block.level ?? 1),
    };
  }
  if (type === "paragraph") {
    return {
      type: "paragraph",
      text: String(block.text ?? block.content ?? ""),
    };
  }
  if (type === "table") {
    const table = block.table && typeof block.table === "object" ? block.table : block;
    return {
      type: "table",
      caption: table.caption ?? null,
      headers: Array.isArray(table.headers) ? table.headers.map(String) : [],
      rows: Array.isArray(table.rows)
        ? table.rows.filter(Array.isArray).map((row) => row.map(String))
        : [],
    };
  }
  return {
    type: type || "paragraph",
    text: String(block?.text ?? block?.content ?? ""),
  };
}

try {
  const kordoc = await import("kordoc");
  const parse = kordoc.parse ?? kordoc.default?.parse;
  if (typeof parse !== "function") {
    throw new Error("kordoc.parse is not available");
  }

  const result = await parse(filePath);
  if (!result?.success) {
    console.log(
      JSON.stringify({
        success: false,
        error: result?.error ? String(result.error) : "kordoc parse failed",
      }),
    );
    process.exit(0);
  }

  const metadata = result.metadata && typeof result.metadata === "object" ? result.metadata : {};
  const blocks = Array.isArray(result.blocks) ? result.blocks.map(normalizeBlock) : [];
  console.log(
    JSON.stringify({
      success: true,
      parser: "kordoc",
      version: kordoc.version ?? "",
      metadata,
      markdown: String(result.markdown ?? ""),
      blocks,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      runner: pathToFileURL(import.meta.url).href,
    }),
  );
}
