#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const filePath = process.argv[2];

if (!filePath) {
  console.log(JSON.stringify({ success: false, error: "file path is required" }));
  process.exit(0);
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
