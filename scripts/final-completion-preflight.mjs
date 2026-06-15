#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const DEFAULT_TIMEOUT_MS = 120_000;

function parsePathArg(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  if (!arg) return fallback ? path.resolve(root, fallback) : "";
  return path.resolve(root, arg.slice(prefix.length));
}

function runCheck(check) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const timeoutMs = check.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const result = spawnSync(check.command, {
      cwd: root,
      encoding: "utf8",
      timeout: timeoutMs,
      shell: true,
      windowsHide: true,
    });
    const timedOut = result.error?.code === "ETIMEDOUT";
    const status = timedOut ? "timeout" : result.status === 0 ? "pass" : "fail";
    return {
      id: check.id,
      title: check.title,
      required: check.required !== false,
      command: check.command,
      status,
      exitCode: result.status,
      durationMs: Date.now() - started,
      startedAt,
      stdout: String(result.stdout ?? "").slice(-4000),
      stderr: String(result.stderr ?? result.error?.message ?? "").slice(-4000),
      blockerHint: check.blockerHint ?? "",
    };
  } catch (error) {
    return {
      id: check.id,
      title: check.title,
      required: check.required !== false,
      command: check.command,
      status: "fail",
      exitCode: null,
      durationMs: Date.now() - started,
      startedAt,
      stdout: "",
      stderr: error.message,
      blockerHint: check.blockerHint ?? "",
    };
  }
}

function summarize(results) {
  const summary = {
    total: results.length,
    required: results.filter((result) => result.required).length,
    pass: results.filter((result) => result.status === "pass").length,
    fail: results.filter((result) => result.status === "fail").length,
    timeout: results.filter((result) => result.status === "timeout").length,
    requiredBlocking: results.filter((result) => result.required && result.status !== "pass").length,
  };
  summary.ready = summary.requiredBlocking === 0;
  return summary;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# 최종완성 Preflight 리포트");
  lines.push("");
  lines.push(`생성시각: ${report.generatedAt}`);
  lines.push(`판정: ${report.summary.ready ? "최종 검증 실행 가능" : "최종 검증 실행 전 차단 있음"}`);
  lines.push("");
  lines.push("## 요약");
  lines.push("");
  lines.push(`- 전체 점검: ${report.summary.total}`);
  lines.push(`- 필수 점검: ${report.summary.required}`);
  lines.push(`- 통과: ${report.summary.pass}`);
  lines.push(`- 실패: ${report.summary.fail}`);
  lines.push(`- 타임아웃: ${report.summary.timeout}`);
  lines.push(`- 필수 차단: ${report.summary.requiredBlocking}`);
  lines.push("");
  lines.push("## 점검 결과");
  lines.push("");
  lines.push("| ID | 상태 | 필수 | 제목 | 명령 | 후속조치 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const result of report.results) {
    lines.push(
      `| ${result.id} | ${result.status} | ${result.required ? "예" : "아니오"} | ${result.title} | \`${result.command.replace(/\|/g, "\\|")}\` | ${result.blockerHint || ""} |`,
    );
  }
  lines.push("");
  lines.push("## 실패/차단 상세");
  lines.push("");
  const failed = report.results.filter((result) => result.status !== "pass");
  if (failed.length === 0) {
    lines.push("- 없음");
  }
  for (const result of failed) {
    lines.push(`### ${result.id}. ${result.title}`);
    lines.push("");
    lines.push(`- 상태: ${result.status}`);
    lines.push(`- 소요시간: ${result.durationMs}ms`);
    if (result.blockerHint) lines.push(`- 후속조치: ${result.blockerHint}`);
    if (result.stderr) {
      lines.push("");
      lines.push("```text");
      lines.push(result.stderr.trim());
      lines.push("```");
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const defaultConfig = {
  outputJson: "docs/operations/generated/final-completion-preflight-report.json",
  outputMarkdown: "docs/operations/generated/final-completion-preflight-report.md",
  checks: [
    {
      id: "python-venv",
      title: "Python 3.11 venv",
      command: "npm.cmd run sidecar:venv:report",
      required: true,
      timeoutMs: 30_000,
      blockerHint: "Python 3.11 실행파일을 복구하거나 repair-python-venv에 명시 경로를 제공한다.",
    },
    {
      id: "completion-tests",
      title: "Completion helper tests",
      command: "npm.cmd run verify:completion:test",
      required: true,
      timeoutMs: 120_000,
      blockerHint: "최종완성 검증 보조 스크립트 회귀 실패를 먼저 수정한다.",
    },
    {
      id: "desktop-tests",
      title: "Desktop test suite",
      command: "npm.cmd run desktop:test",
      required: true,
      timeoutMs: 180_000,
      blockerHint: "프론트엔드 회귀 테스트 실패를 수정한다.",
    },
    {
      id: "release-hygiene",
      title: "Release hygiene",
      command: "npm.cmd run verify:completion:hygiene",
      required: true,
      timeoutMs: 30_000,
      blockerHint: "작업트리를 정리해 의도된 변경만 커밋하고 generated/build 잡음을 제거한다.",
    },
    {
      id: "desktop-build",
      title: "Desktop production build",
      command: "npm.cmd run desktop:build",
      required: true,
      timeoutMs: 180_000,
      blockerHint: "TypeScript/Vite production build 실패를 수정한다.",
    },
    {
      id: "cargo-check",
      title: "Tauri cargo check",
      command: "node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml",
      required: true,
      timeoutMs: 180_000,
      blockerHint: "Rust/Tauri 컴파일 오류를 수정한다.",
    },
    {
      id: "bundle-freshness",
      title: "Bundled sidecar freshness",
      command: "npm.cmd run sidecar:bundle:freshness",
      required: true,
      timeoutMs: 30_000,
      blockerHint: "최신 sidecar 번들을 재생성하고 Tauri 리소스로 동기화한다.",
    },
    {
      id: "completion-audit",
      title: "Final completion audit",
      command: "npm.cmd run verify:completion:audit",
      required: true,
      timeoutMs: 60_000,
      blockerHint: "감사 리포트에서 표시한 blocking gate를 닫는다.",
    },
  ],
};

export function runPreflight(config) {
  const results = config.checks.map(runCheck);
  return {
    generatedAt: new Date().toISOString(),
    summary: summarize(results),
    results,
  };
}

export function writePreflightReport(config) {
  const report = runPreflight(config);
  const outputJsonPath = path.resolve(root, config.outputJson);
  const outputMarkdownPath = path.resolve(root, config.outputMarkdown);
  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputMarkdownPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(outputMarkdownPath, renderMarkdown(report), "utf8");
  return { report, outputJsonPath, outputMarkdownPath };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const configPath = parsePathArg("config", "");
  const config = configPath && fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : defaultConfig;
  const { report, outputMarkdownPath } = writePreflightReport(config);
  console.log(`Final completion preflight written: ${path.relative(root, outputMarkdownPath)}`);
  console.log(
    `Summary: ${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.timeout} timeout, ${report.summary.requiredBlocking} required blocking`,
  );
  if (!report.summary.ready) {
    process.exit(1);
  }
}
