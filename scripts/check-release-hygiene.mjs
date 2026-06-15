#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = process.cwd();

function parsePathArg(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return path.resolve(root, arg ? arg.slice(prefix.length) : fallback);
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function categorize(filePath) {
  const normalized = normalizePath(filePath);
  if (normalized.startsWith("docs/operations/generated/")) return "generatedEvidence";
  if (normalized.endsWith(".tsbuildinfo") || normalized.includes("/dist/") || normalized.includes("/target/")) {
    return "generatedBuild";
  }
  if (normalized.startsWith("docs/") || normalized === "README.md" || normalized.endsWith(".md")) return "docs";
  if (
    normalized.startsWith("apps/") ||
    normalized.startsWith("services/") ||
    normalized.startsWith("scripts/") ||
    normalized === "package.json" ||
    normalized.endsWith("package.json")
  ) {
    return "source";
  }
  return "other";
}

function parsePorcelainLine(line) {
  const status = line.slice(0, 2);
  const rawPath = line.slice(3);
  const renameSeparator = " -> ";
  const filePath = rawPath.includes(renameSeparator) ? rawPath.split(renameSeparator).at(-1) : rawPath;
  return {
    status: status.trim() || status,
    path: normalizePath(filePath),
    category: categorize(filePath),
  };
}

function summarize(items) {
  const summary = {
    total: items.length,
    source: 0,
    docs: 0,
    generatedEvidence: 0,
    generatedBuild: 0,
    other: 0,
  };
  for (const item of items) {
    summary[item.category] += 1;
  }
  return summary;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Release Hygiene 리포트");
  lines.push("");
  lines.push(`생성시각: ${report.generatedAt}`);
  lines.push(`판정: ${report.clean ? "clean" : "dirty"}`);
  lines.push("");
  lines.push("## 요약");
  lines.push("");
  lines.push(`- 전체 변경: ${report.summary.total}`);
  lines.push(`- 소스/스크립트: ${report.summary.source}`);
  lines.push(`- 문서: ${report.summary.docs}`);
  lines.push(`- 생성 증거: ${report.summary.generatedEvidence}`);
  lines.push(`- 빌드 산출물: ${report.summary.generatedBuild}`);
  lines.push(`- 기타: ${report.summary.other}`);
  lines.push("");
  lines.push("## 변경 파일");
  lines.push("");
  if (report.items.length === 0) {
    lines.push("- 없음");
  } else {
    lines.push("| 상태 | 분류 | 경로 |");
    lines.push("| --- | --- | --- |");
    for (const item of report.items) {
      lines.push(`| ${item.status} | ${item.category} | \`${item.path}\` |`);
    }
  }
  lines.push("");
  lines.push("## 정리 권장 순서");
  lines.push("");
  if (report.clean) {
    lines.push("- 추가 정리 작업이 필요하지 않습니다.");
  } else {
    lines.push(`- 소스 변경 ${report.summary.source}개: 기능/검증 변경으로 묶어 커밋합니다.`);
    lines.push(`- 문서 변경 ${report.summary.docs}개: 계획/상태/검증 기준 문서로 묶어 커밋합니다.`);
    lines.push(`- 생성 증거 ${report.summary.generatedEvidence}개: 릴리스 증거로 남길 파일만 포함합니다.`);
    lines.push(
      `- 빌드 산출물 ${report.summary.generatedBuild}개: 커밋 전 제외 또는 의도적 포함 여부를 결정합니다.`,
    );
    if (report.summary.other > 0) {
      lines.push(`- 기타 ${report.summary.other}개: 범위를 확인해 포함/제외를 결정합니다.`);
    }
  }
  lines.push("");
  lines.push("## 해석");
  lines.push("");
  if (report.clean) {
    lines.push("작업트리가 깨끗합니다. 최종완성의 release hygiene 조건을 만족할 수 있는 상태입니다.");
  } else {
    lines.push("작업트리가 깨끗하지 않습니다. 최종완성 전에는 의도된 변경만 커밋하고 generated/build 잡음을 정리해야 합니다.");
  }
  return `${lines.join("\n")}\n`;
}

export function inspectReleaseHygiene() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "git status failed");
  }
  const items = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parsePorcelainLine)
    .sort((a, b) => a.path.localeCompare(b.path));
  const clean = items.length === 0;
  return {
    generatedAt: new Date().toISOString(),
    status: clean ? "clean" : "dirty",
    clean,
    summary: summarize(items),
    items,
  };
}

export function writeReleaseHygieneReport({ outputJsonPath, outputMarkdownPath }) {
  const report = inspectReleaseHygiene();
  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputMarkdownPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(outputMarkdownPath, renderMarkdown(report), "utf8");
  return report;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const outputJsonPath = parsePathArg("out", "docs/operations/generated/release-hygiene-report.json");
  const outputMarkdownPath = parsePathArg("markdown", "docs/operations/generated/release-hygiene-report.md");
  try {
    const report = writeReleaseHygieneReport({ outputJsonPath, outputMarkdownPath });
    console.log(`Release hygiene report written: ${path.relative(root, outputMarkdownPath)}`);
    console.log(
      `Summary: ${report.status}, ${report.summary.total} changed, ${report.summary.source} source, ${report.summary.generatedBuild} generated build`,
    );
    if (!report.clean) process.exit(1);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
