#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const allowPending = args.has("--allow-pending");
const criteriaArg = process.argv.find((arg) => arg.startsWith("--criteria="));
const criteriaPath = path.resolve(
  root,
  criteriaArg ? criteriaArg.slice("--criteria=".length) : "docs/operations/final-completion-criteria.json",
);
const outputDir = path.resolve(root, "docs/operations/generated");
const outputJsonPath = path.join(outputDir, "final-completion-verification-report.json");
const outputMarkdownPath = path.join(outputDir, "final-completion-verification-report.md");

const allowedStatuses = new Set(["pass", "partial", "pending", "fail", "waived"]);
const allowedCompletionModes = new Set(["manual", "evidence"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function existsFromRoot(relativePath) {
  return fs.existsSync(path.resolve(root, relativePath));
}

function readJsonValue(payload, selector = "status") {
  return String(selector)
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), payload);
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function evaluateGate(gate) {
  const status = gate.status;
  const completionMode = gate.completionMode ?? "manual";
  const requiredFiles = normalizeArray(gate.evidence?.requiredFiles);
  const jsonStatusChecks = normalizeArray(gate.evidence?.jsonStatusChecks);
  const missingFiles = requiredFiles.filter((filePath) => !existsFromRoot(filePath));
  const schemaErrors = [];
  const jsonStatusErrors = [];

  if (!gate.id) schemaErrors.push("missing id");
  if (!gate.title) schemaErrors.push("missing title");
  if (!allowedStatuses.has(status)) schemaErrors.push(`invalid status: ${status}`);
  if (!allowedCompletionModes.has(completionMode)) schemaErrors.push(`invalid completionMode: ${completionMode}`);
  if (!Array.isArray(gate.completionCriteria) || gate.completionCriteria.length === 0) {
    schemaErrors.push("missing completionCriteria");
  }
  if (completionMode === "evidence" && requiredFiles.length === 0 && jsonStatusChecks.length === 0) {
    schemaErrors.push("evidence completion mode requires evidence files or JSON status checks");
  }

  const required = gate.required !== false;
  const passWithoutEvidence = status === "pass" && required && requiredFiles.length === 0;
  if (passWithoutEvidence) {
    schemaErrors.push("pass gate missing required evidence files");
  }

  for (const check of jsonStatusChecks) {
    const filePath = check?.file;
    const selector = check?.path ?? "status";
    const expected = check?.equals ?? "pass";
    if (!filePath) {
      jsonStatusErrors.push("jsonStatusChecks entry missing file");
      continue;
    }
    const absolutePath = path.resolve(root, filePath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }
    try {
      const payload = readJson(absolutePath);
      const actual = readJsonValue(payload, selector);
      if (actual !== expected) {
        jsonStatusErrors.push(`${filePath} ${selector} expected ${expected}, got ${actual}`);
      }
    } catch (error) {
      jsonStatusErrors.push(`${filePath} could not be parsed as JSON: ${error.message}`);
    }
  }

  const evidenceSatisfied = missingFiles.length === 0 && schemaErrors.length === 0 && jsonStatusErrors.length === 0;
  const statusSatisfied = status === "pass" || (completionMode === "evidence" && status !== "fail");
  const complete = statusSatisfied && evidenceSatisfied;
  const blocksCompletion = required && !complete && status !== "waived";

  return {
    id: gate.id,
    title: gate.title,
    required,
    status,
    completionMode,
    complete,
    blocksCompletion,
    missingFiles,
    schemaErrors,
    jsonStatusErrors,
    passWithoutEvidence,
    commands: normalizeArray(gate.evidence?.commands),
    blockingFollowUp: normalizeArray(gate.blockingFollowUp),
    notes: normalizeArray(gate.evidence?.notes),
  };
}

function summarize(results) {
  const summary = {
    total: results.length,
    required: results.filter((result) => result.required).length,
    pass: results.filter((result) => result.status === "pass").length,
    partial: results.filter((result) => result.status === "partial").length,
    pending: results.filter((result) => result.status === "pending").length,
    fail: results.filter((result) => result.status === "fail").length,
    waived: results.filter((result) => result.status === "waived").length,
    blocking: results.filter((result) => result.blocksCompletion).length,
    schemaErrors: results.reduce((count, result) => count + result.schemaErrors.length, 0),
    jsonStatusErrors: results.reduce((count, result) => count + result.jsonStatusErrors.length, 0),
    missingEvidenceFiles: results.reduce((count, result) => count + result.missingFiles.length, 0),
  };
  summary.complete =
    summary.blocking === 0 &&
    summary.schemaErrors === 0 &&
    summary.jsonStatusErrors === 0 &&
    summary.missingEvidenceFiles === 0;
  return summary;
}

function escapeMarkdown(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function renderMarkdown(criteria, report) {
  const lines = [];
  lines.push("# 최종완성 감사 리포트");
  lines.push("");
  lines.push(`생성일: ${report.generatedAt}`);
  lines.push(`프로젝트: ${criteria.projectName}`);
  lines.push(`기준 파일: \`${path.relative(root, criteriaPath).replace(/\\/g, "/")}\``);
  lines.push(`모드: ${allowPending ? "비차단 감사(--allow-pending)" : "최종완성 strict gate"}`);
  lines.push("");
  lines.push("## 요약");
  lines.push("");
  lines.push(`- 전체 게이트: ${report.summary.total}`);
  lines.push(`- 필수 게이트: ${report.summary.required}`);
  lines.push(`- Pass: ${report.summary.pass}`);
  lines.push(`- Partial: ${report.summary.partial}`);
  lines.push(`- Pending: ${report.summary.pending}`);
  lines.push(`- Fail: ${report.summary.fail}`);
  lines.push(`- 완료 차단 게이트: ${report.summary.blocking}`);
  lines.push(`- 누락 증거 파일: ${report.summary.missingEvidenceFiles}`);
  lines.push(`- JSON 상태 오류: ${report.summary.jsonStatusErrors}`);
  lines.push("");
  lines.push(report.summary.complete ? "판정: 최종완성 조건 충족" : "판정: 최종완성 조건 미충족");
  lines.push("");
  lines.push("## 게이트별 상태");
  lines.push("");
  lines.push("| ID | 상태 | 필수 | 제목 | 완료 차단 | 누락 증거 | 다음 조치 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const result of report.results) {
    const missing = result.missingFiles.length > 0 ? result.missingFiles.join("<br>") : "";
    const followUp = result.blockingFollowUp.length > 0 ? result.blockingFollowUp.join("<br>") : "";
    lines.push(
      `| ${escapeMarkdown(result.id)} | ${escapeMarkdown(result.status)} | ${result.required ? "예" : "아니오"} | ${escapeMarkdown(result.title)} | ${result.blocksCompletion ? "예" : "아니오"} | ${escapeMarkdown(missing)} | ${escapeMarkdown(followUp)} |`,
    );
  }
  const jsonStatusErrorResults = report.results.filter((result) => result.jsonStatusErrors.length > 0);
  if (jsonStatusErrorResults.length > 0) {
    lines.push("");
    lines.push("## JSON 상태 오류 상세");
    lines.push("");
    for (const result of jsonStatusErrorResults) {
      lines.push(`### ${result.id}. ${result.title}`);
      lines.push("");
      for (const error of result.jsonStatusErrors) {
        lines.push(`- ${error}`);
      }
      lines.push("");
    }
  }
  lines.push("");
  lines.push("## 실행해야 할 검증 명령");
  lines.push("");
  for (const result of report.results) {
    if (result.commands.length === 0) continue;
    lines.push(`### ${result.id}. ${result.title}`);
    lines.push("");
    for (const command of result.commands) {
      lines.push(`- \`${command}\``);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

if (!fs.existsSync(criteriaPath)) {
  console.error(`Criteria file not found: ${criteriaPath}`);
  process.exit(2);
}

const criteria = readJson(criteriaPath);
const gates = normalizeArray(criteria.gates);
const results = gates.map(evaluateGate);
const report = {
  generatedAt: new Date().toISOString(),
  criteriaPath: path.relative(root, criteriaPath).replace(/\\/g, "/"),
  allowPending,
  summary: summarize(results),
  results,
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
fs.writeFileSync(outputMarkdownPath, renderMarkdown(criteria, report), "utf8");

console.log(`Final completion audit written: ${path.relative(root, outputMarkdownPath)}`);
console.log(
  `Summary: ${report.summary.pass} pass, ${report.summary.partial} partial, ${report.summary.pending} pending, ${report.summary.fail} fail, ${report.summary.blocking} blocking`,
);

if (!report.summary.complete && !allowPending) {
  console.error("Final completion gate failed. Run with --allow-pending for a non-blocking audit report.");
  process.exit(1);
}

if (report.summary.complete) {
  console.log("Final completion gate passed.");
} else {
  console.log("Final completion gate is not complete yet; audit mode allowed pending gates.");
}
