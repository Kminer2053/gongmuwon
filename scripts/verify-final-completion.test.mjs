import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "verify-final-completion.mjs");

function withTempProject(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gongmu-final-completion-"));
  try {
    fs.mkdirSync(path.join(tempRoot, "docs", "operations"), { recursive: true });
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeCriteria(tempRoot, gates) {
  const criteriaPath = path.join(tempRoot, "criteria.json");
  fs.writeFileSync(
    criteriaPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        projectName: "로컬 AI에이전트 워크플레이스 : 공무원",
        gates,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return criteriaPath;
}

function runVerifier(tempRoot, criteriaPath, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [scriptPath, `--criteria=${path.relative(tempRoot, criteriaPath)}`, ...extraArgs],
    {
      cwd: tempRoot,
      encoding: "utf8",
    },
  );
}

function readReport(tempRoot) {
  const jsonPath = path.join(tempRoot, "docs", "operations", "generated", "final-completion-verification-report.json");
  const markdownPath = path.join(tempRoot, "docs", "operations", "generated", "final-completion-verification-report.md");
  return {
    json: JSON.parse(fs.readFileSync(jsonPath, "utf8")),
    markdown: fs.readFileSync(markdownPath, "utf8"),
  };
}

function runChecks() {
  withTempProject((tempRoot) => {
    fs.writeFileSync(path.join(tempRoot, "evidence.txt"), "ok\n", "utf8");
    const criteriaPath = writeCriteria(tempRoot, [
      {
        id: "G01",
        title: "완료된 게이트",
        required: true,
        status: "pass",
        completionCriteria: ["증거 파일이 있다."],
        evidence: {
          requiredFiles: ["evidence.txt"],
          commands: ["echo ok"],
        },
      },
    ]);

    const result = runVerifier(tempRoot, criteriaPath);
    assert.equal(result.status, 0, result.stderr);
    const report = readReport(tempRoot);
    assert.equal(report.json.summary.complete, true);
    assert.match(report.markdown, /# 최종완성 감사 리포트/);
    assert.match(report.markdown, /판정: 최종완성 조건 충족/);
    assert.match(report.markdown, /프로젝트: 로컬 AI에이전트 워크플레이스 : 공무원/);
  });

  withTempProject((tempRoot) => {
    const criteriaPath = writeCriteria(tempRoot, [
      {
        id: "G02",
        title: "미완료 게이트",
        required: true,
        status: "partial",
        completionCriteria: ["아직 미완료다."],
        evidence: {
          requiredFiles: ["missing.txt"],
        },
        blockingFollowUp: ["증거를 보강한다."],
      },
    ]);

    const strictResult = runVerifier(tempRoot, criteriaPath);
    assert.equal(strictResult.status, 1);
    assert.match(strictResult.stderr, /Final completion gate failed/);

    const auditResult = runVerifier(tempRoot, criteriaPath, ["--allow-pending"]);
    assert.equal(auditResult.status, 0, auditResult.stderr);
    const report = readReport(tempRoot);
    assert.equal(report.json.summary.complete, false);
    assert.equal(report.json.summary.blocking, 1);
    assert.equal(report.json.summary.missingEvidenceFiles, 1);
    assert.match(report.markdown, /미완료 게이트/);
    assert.match(report.markdown, /증거를 보강한다/);
  });

  withTempProject((tempRoot) => {
    const criteriaPath = writeCriteria(tempRoot, [
      {
        id: "G03",
        title: "증거 없는 완료 주장",
        required: true,
        status: "pass",
        completionCriteria: ["완료라고 되어 있지만 requiredFiles가 없다."],
        evidence: {
          commands: ["echo unproven"],
        },
      },
    ]);

    const result = runVerifier(tempRoot, criteriaPath, ["--allow-pending"]);
    assert.equal(result.status, 0, result.stderr);
    const report = readReport(tempRoot);
    assert.equal(report.json.results[0].passWithoutEvidence, true);
    assert.equal(report.json.results[0].blocksCompletion, true);
    assert.equal(report.json.summary.complete, false);
  });

  withTempProject((tempRoot) => {
    fs.writeFileSync(path.join(tempRoot, "smoke.json"), JSON.stringify({ status: "fail" }), "utf8");
    const criteriaPath = writeCriteria(tempRoot, [
      {
        id: "G04",
        title: "Smoke status must pass",
        required: true,
        status: "pass",
        completionCriteria: ["Smoke JSON status must be pass."],
        evidence: {
          requiredFiles: ["smoke.json"],
          jsonStatusChecks: [{ file: "smoke.json", path: "status", equals: "pass" }],
        },
      },
    ]);

    const result = runVerifier(tempRoot, criteriaPath, ["--allow-pending"]);
    assert.equal(result.status, 0, result.stderr);
    const report = readReport(tempRoot);
    assert.equal(report.json.summary.complete, false);
    assert.equal(report.json.summary.jsonStatusErrors, 1);
    assert.equal(report.json.results[0].jsonStatusErrors[0], "smoke.json status expected pass, got fail");
    assert.match(report.markdown, /## JSON 상태 오류 상세/);
    assert.match(report.markdown, /smoke\.json status expected pass, got fail/);
  });
}

runChecks();
console.log("verify-final-completion checks passed");
