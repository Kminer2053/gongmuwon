#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = process.cwd();

function parseArg(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return path.resolve(root, arg ? arg.slice(prefix.length) : fallback);
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function commandBlock(command) {
  return `\`${command}\``;
}

function renderList(items, fallback = "- 없음") {
  const normalized = normalizeArray(items).filter(Boolean);
  if (normalized.length === 0) return fallback;
  return normalized.map((item) => `- ${item}`).join("\n");
}

function renderCommandList(commands) {
  const normalized = normalizeArray(commands).filter(Boolean);
  if (normalized.length === 0) return "- 없음";
  return normalized.map((command) => `- ${commandBlock(command)}`).join("\n");
}

function blockerProblems(blocker) {
  const problems = [];
  if (blocker.status !== "pass") {
    problems.push(`게이트 상태가 pass가 아닙니다: ${blocker.status}`);
  }
  problems.push(...normalizeArray(blocker.missingFiles), ...normalizeArray(blocker.jsonStatusErrors));
  return problems;
}

function nextExecutionPlan(blockers) {
  if (blockers.some((blocker) => blocker.id === "G11")) {
    return {
      description:
        "아래 순서는 클린계정/폐쇄망 증거 수집 루프입니다. 대상 PC에서 원클릭 검증을 실행한 뒤 evidence 폴더를 개발 저장소 inbox로 반입합니다.",
      commands: [
        "npm.cmd run release:ai-pack:evidence:request:validate",
        "대상 PC에서 AI pack zip SHA256 확인",
        "대상 PC에서 RUN_FULL_VALIDATION.bat 실행",
        "대상 PC의 evidence 폴더를 release\\clean-account-evidence-inbox 로 복사",
        "npm.cmd run release:ai-pack:evidence:finalize",
        "npm.cmd run verify:completion",
      ],
    };
  }

  return {
    description: "아래 순서는 Python 3.11 복구 후 stale sidecar 번들부터 다시 닫는 기본 루프입니다.",
    commands: [
      "npm.cmd run sidecar:venv:check",
      'node scripts/repair-python-venv.mjs --repair --python "C:\\path\\to\\Python311\\python.exe"',
      "npm.cmd run sidecar:bundle:windows",
      "node scripts/sync-sidecar-bundle.mjs",
      "npm.cmd run sidecar:bundle:freshness",
      "npm.cmd run sidecar:smoke:bundled",
      "npm.cmd run verify:all",
      "npm.cmd run desktop:bundle",
      "npm.cmd run desktop:smoke:nsis",
      "npm.cmd run release:offline",
      "npm.cmd run verify:completion",
    ],
  };
}

export function renderBlockerMarkdown(report) {
  const blockers = normalizeArray(report.results).filter((result) => result.blocksCompletion);
  const lines = [];

  lines.push("# 최종완성 차단요약");
  lines.push("");
  lines.push(`생성시각: ${new Date().toISOString()}`);
  lines.push(`기준 리포트: ${report.generatedAt ?? "알 수 없음"}`);
  lines.push("");
  lines.push("## 현재 판정");
  lines.push("");
  if (report.summary?.complete) {
    lines.push("최종완성 게이트가 모두 통과되었습니다.");
  } else {
    lines.push(`아직 최종완성 조건을 충족하지 못했습니다. 현재 완료 차단 게이트는 ${blockers.length}개입니다.`);
  }
  lines.push("");
  lines.push("## 완료 차단 항목");
  lines.push("");

  if (blockers.length === 0) {
    lines.push("- 없음");
  }

  for (const blocker of blockers) {
    lines.push(`### ${blocker.id}. ${blocker.title}`);
    lines.push("");
    lines.push(`- 현재 상태: ${blocker.status}`);
    lines.push(`- 빠진 증거: ${normalizeArray(blocker.missingFiles).length}개`);
    lines.push(`- JSON 상태 오류: ${normalizeArray(blocker.jsonStatusErrors).length}개`);
    lines.push("");
    lines.push("확인된 문제:");
    lines.push(renderList(blockerProblems(blocker)));
    lines.push("");
    lines.push("필요한 후속조치:");
    lines.push(renderList(blocker.blockingFollowUp));
    lines.push("");
    lines.push("관련 검증 명령:");
    lines.push(renderCommandList(blocker.commands));
    lines.push("");
  }

  lines.push("## 다음 실행 순서");
  lines.push("");
  const nextPlan = nextExecutionPlan(blockers);
  lines.push(nextPlan.description);
  lines.push("");
  lines.push(renderCommandList(nextPlan.commands));
  lines.push("");
  lines.push("## 해석");
  lines.push("");
  lines.push(
    "이 문서는 완료 선언용이 아니라 완료 차단 제거용입니다. `verify:completion`이 통과하기 전에는 최종완성으로 보지 않습니다.",
  );

  return `${lines.join("\n")}\n`;
}

export function writeBlockerMarkdown({ reportPath, outputPath }) {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Completion report not found: ${reportPath}`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderBlockerMarkdown(report), "utf8");
  return outputPath;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const reportPath = parseArg("report", "docs/operations/generated/final-completion-verification-report.json");
  const outputPath = parseArg("out", "docs/operations/generated/final-completion-blockers.md");
  try {
    writeBlockerMarkdown({ reportPath, outputPath });
    console.log(`Final completion blocker summary written: ${path.relative(root, outputPath)}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
