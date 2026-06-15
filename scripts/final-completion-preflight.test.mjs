import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "final-completion-preflight.mjs");

function withTempProject(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gongmu-final-preflight-"));
  try {
    fs.mkdirSync(path.join(tempRoot, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "package.json"),
      `${JSON.stringify({ name: "tmp-preflight", scripts: {} }, null, 2)}\n`,
      "utf8",
    );
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

function writeCommandFixture(tempRoot) {
  const fixturePath = path.join(tempRoot, "scripts", "preflight-fixture.mjs");
  fs.writeFileSync(
    fixturePath,
    `
const mode = process.argv[2];
if (mode === "pass") {
  console.log("ok");
  process.exit(0);
}
if (mode === "fail") {
  console.error("broken");
  process.exit(7);
}
if (mode === "slow") {
  setTimeout(() => console.log("late"), 200);
}
`.trimStart(),
    "utf8",
  );
  return fixturePath;
}

function runPreflight(tempRoot, configPath) {
  return spawnSync(process.execPath, [scriptPath, `--config=${path.relative(tempRoot, configPath)}`], {
    cwd: tempRoot,
    encoding: "utf8",
  });
}

function runDefaultPreflight(tempRoot) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: tempRoot,
    encoding: "utf8",
  });
}

function nodeFixtureCommand(fixturePath, mode) {
  return `"${process.execPath}" "${fixturePath}" ${mode}`;
}

withTempProject((tempRoot) => {
  const fixturePath = writeCommandFixture(tempRoot);
  const outputJson = "docs/operations/generated/final-completion-preflight-report.json";
  const outputMarkdown = "docs/operations/generated/final-completion-preflight-report.md";
  const configPath = path.join(tempRoot, "preflight.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        outputJson,
        outputMarkdown,
        checks: [
          {
            id: "desktop-tests",
            title: "Desktop tests",
            command: nodeFixtureCommand(fixturePath, "pass"),
            required: true,
          },
          {
            id: "python-venv",
            title: "Python 3.11 venv",
            command: nodeFixtureCommand(fixturePath, "fail"),
            required: true,
            blockerHint: "Python 3.11 실행파일을 복구한다.",
          },
          {
            id: "optional-slow",
            title: "Optional slow",
            command: nodeFixtureCommand(fixturePath, "slow"),
            required: false,
            timeoutMs: 20,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const result = runPreflight(tempRoot, configPath);
  assert.equal(result.status, 1, result.stderr);

  const report = JSON.parse(fs.readFileSync(path.join(tempRoot, outputJson), "utf8"));
  assert.equal(report.summary.total, 3);
  assert.equal(report.summary.pass, 1);
  assert.equal(report.summary.fail, 1);
  assert.equal(report.summary.timeout, 1);
  assert.equal(report.summary.requiredBlocking, 1);
  assert.equal(report.summary.ready, false);
  assert.equal(report.results[0].status, "pass");
  assert.equal(report.results[1].status, "fail");
  assert.equal(report.results[2].status, "timeout");

  const markdown = fs.readFileSync(path.join(tempRoot, outputMarkdown), "utf8");
  assert.match(markdown, /# 최종완성 Preflight 리포트/);
  assert.match(markdown, /Python 3\.11 실행파일을 복구한다/);
  assert.match(markdown, /desktop-tests/);
});

withTempProject((tempRoot) => {
  const result = runDefaultPreflight(tempRoot);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /EISDIR/);
  const jsonPath = path.join(tempRoot, "docs", "operations", "generated", "final-completion-preflight-report.json");
  assert.equal(fs.existsSync(jsonPath), true);
  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.ok(report.results.some((item) => item.id === "release-hygiene"));
  const pythonVenv = report.results.find((item) => item.id === "python-venv");
  assert.match(pythonVenv.command, /sidecar:venv:report/);
});

console.log("final-completion-preflight checks passed");
