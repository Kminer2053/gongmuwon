import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "check-release-hygiene.mjs");

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8" });
}

function withGitRepo(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gongmu-release-hygiene-"));
  try {
    run("git", ["init"], tempRoot);
    run("git", ["config", "user.email", "test@example.com"], tempRoot);
    run("git", ["config", "user.name", "Test User"], tempRoot);
    fs.mkdirSync(path.join(tempRoot, "apps", "desktop"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "apps", "desktop", "package.json"), "{}\n", "utf8");
    run("git", ["add", "."], tempRoot);
    run("git", ["commit", "-m", "init"], tempRoot);
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

function readJson(tempRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(tempRoot, relativePath), "utf8"));
}

withGitRepo((tempRoot) => {
  fs.writeFileSync(path.join(tempRoot, "apps", "desktop", "package.json"), "{\"changed\":true}\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "apps", "desktop", "tsconfig.app.tsbuildinfo"), "generated\n", "utf8");
  fs.mkdirSync(path.join(tempRoot, "docs", "operations", "generated"), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, "docs", "operations", "generated", "final-completion-report.json"),
    "{}\n",
    "utf8",
  );
  fs.writeFileSync(path.join(tempRoot, "README.md"), "# Readme\n", "utf8");

  const result = run(process.execPath, [scriptPath], tempRoot);
  assert.equal(result.status, 1);
  const report = readJson(tempRoot, "docs/operations/generated/release-hygiene-report.json");
  assert.equal(report.status, "dirty");
  assert.equal(report.summary.total, 4);
  assert.equal(report.summary.source, 1);
  assert.equal(report.summary.generatedBuild, 1);
  assert.equal(report.summary.generatedEvidence, 1);
  assert.equal(report.summary.docs, 1);
  assert.equal(report.clean, false);
  assert.ok(report.items.some((item) => item.path === "apps/desktop/package.json" && item.category === "source"));
  assert.ok(
    report.items.some(
      (item) => item.path === "apps/desktop/tsconfig.app.tsbuildinfo" && item.category === "generatedBuild",
    ),
  );
  const markdown = fs.readFileSync(
    path.join(tempRoot, "docs", "operations", "generated", "release-hygiene-report.md"),
    "utf8",
  );
  assert.match(markdown, /# Release Hygiene 리포트/);
  assert.match(markdown, /apps\/desktop\/package\.json/);
  assert.match(markdown, /## 정리 권장 순서/);
  assert.match(markdown, /소스 변경 1개/);
  assert.match(markdown, /빌드 산출물 1개/);
  assert.match(markdown, /커밋 전 제외 또는 의도적 포함 여부를 결정/);
});

withGitRepo((tempRoot) => {
  const result = run(process.execPath, [scriptPath], tempRoot);
  assert.equal(result.status, 0, result.stderr);
  const report = readJson(tempRoot, "docs/operations/generated/release-hygiene-report.json");
  assert.equal(report.status, "clean");
  assert.equal(report.summary.total, 0);
  assert.equal(report.clean, true);
});

console.log("check-release-hygiene checks passed");
