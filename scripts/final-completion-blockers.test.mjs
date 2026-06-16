import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "final-completion-blockers.mjs");

function withTempProject(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gongmu-final-blockers-"));
  try {
    fs.mkdirSync(path.join(tempRoot, "docs", "operations", "generated"), { recursive: true });
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runBlockerRenderer(tempRoot, extraArgs = []) {
  return spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    cwd: tempRoot,
    encoding: "utf8",
  });
}

withTempProject((tempRoot) => {
  const reportPath = path.join(tempRoot, "docs", "operations", "generated", "final-completion-verification-report.json");
  const outputPath = path.join(tempRoot, "docs", "operations", "generated", "final-completion-blockers.md");
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: "2026-06-15T00:00:00.000Z",
        summary: {
          complete: false,
          blocking: 2,
          jsonStatusErrors: 2,
          missingEvidenceFiles: 0,
        },
        results: [
          {
            id: "G01",
            title: "자동검증",
            status: "partial",
            blocksCompletion: true,
            missingFiles: [],
            jsonStatusErrors: ["sidecar-bundle-freshness-report.json status expected fresh, got stale"],
            blockingFollowUp: ["Python 3.11 복구 후 sidecar 번들을 재생성한다."],
            commands: ["npm.cmd run sidecar:venv:check", "npm.cmd run sidecar:bundle:freshness"],
          },
          {
            id: "G03",
            title: "업무엔진 런타임",
            status: "partial",
            blocksCompletion: true,
            missingFiles: [],
            jsonStatusErrors: ["bundled-sidecar-smoke.json status expected pass, got fail"],
            blockingFollowUp: ["bundled sidecar smoke를 다시 통과시킨다."],
            commands: ["npm.cmd run sidecar:smoke:bundled"],
          },
          {
            id: "G04",
            title: "완료된 참고 게이트",
            status: "pass",
            blocksCompletion: false,
            missingFiles: [],
            jsonStatusErrors: [],
            blockingFollowUp: [],
            commands: [],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const result = runBlockerRenderer(tempRoot);
  assert.equal(result.status, 0, result.stderr);
  const markdown = fs.readFileSync(outputPath, "utf8");
  assert.match(markdown, /# 최종완성 차단요약/);
  assert.match(markdown, /G01/);
  assert.match(markdown, /G03/);
  assert.match(markdown, /게이트 상태가 pass가 아닙니다: partial/);
  assert.match(markdown, /Python 3\.11/);
  assert.match(markdown, /sidecar:smoke:bundled/);
  assert.doesNotMatch(markdown, /G04/);
  assert.match(markdown, /다음 실행 순서/);
});

withTempProject((tempRoot) => {
  const reportPath = path.join(tempRoot, "docs", "operations", "generated", "final-completion-verification-report.json");
  const outputPath = path.join(tempRoot, "docs", "operations", "generated", "final-completion-blockers.md");
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: "2026-06-16T00:00:00.000Z",
        summary: {
          complete: false,
          blocking: 1,
          jsonStatusErrors: 0,
          missingEvidenceFiles: 3,
        },
        results: [
          {
            id: "G11",
            title: "폐쇄망 설치패키지와 clean install 증거",
            status: "partial",
            blocksCompletion: true,
            missingFiles: [
              "docs/operations/generated/clean-account-evidence/ai-pack-clean-account-evidence.json",
            ],
            jsonStatusErrors: [],
            blockingFollowUp: [
              "clean-account 또는 VM에서 `RUN_FULL_VALIDATION.bat`를 실제 실행한다.",
              "대상 PC의 `evidence` 폴더를 `release/clean-account-evidence-inbox`에 넣고 `npm.cmd run release:ai-pack:evidence:finalize`를 실행한다.",
            ],
            commands: [
              "npm.cmd run release:ai-pack:evidence:request:validate",
              "npm.cmd run release:ai-pack:evidence:finalize",
              "npm.cmd run release:ai-pack:evidence:validate",
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const result = runBlockerRenderer(tempRoot);
  assert.equal(result.status, 0, result.stderr);
  const markdown = fs.readFileSync(outputPath, "utf8");
  assert.match(markdown, /클린계정\/폐쇄망 증거 수집 루프/);
  assert.match(markdown, /RUN_FULL_VALIDATION\.bat/);
  assert.match(markdown, /release\\clean-account-evidence-inbox/);
  assert.match(markdown, /release:ai-pack:evidence:finalize/);
  assert.match(markdown, /runtime-clean-account-evidence\.json/);
  assert.match(markdown, /release:runtime-evidence:validate/);
  assert.doesNotMatch(markdown, /Python 3\.11 복구 후 stale sidecar/);
});

console.log("final-completion-blockers checks passed");
