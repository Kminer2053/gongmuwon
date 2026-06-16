import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { finalizeCleanAccountEvidence } from "./finalize-clean-account-evidence.mjs";

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sampleEvidence(overrides = {}) {
  return {
    ready: true,
    modelName: "gemma4:e2b",
    computerName: "CLEAN-VM",
    userName: "tester",
    completedAt: "2026-06-16T12:00:00.000Z",
    textResponse: "안녕하세요.",
    imageResponse: "이미지를 확인했습니다.",
    installLog: { exists: true },
    validateLog: { exists: true },
    checks: [
      { name: "Ollama executable detected", passed: true },
      { name: "Ollama server responding", passed: true },
      { name: "gemma4:e2b model listed", passed: true },
      { name: "Text chat response", passed: true },
      { name: "Image chat response", passed: true },
      { name: "Gongmu settings file exists", passed: true },
      { name: "Gongmu settings point to Ollama model", passed: true },
      { name: "Install log exists", passed: true },
      { name: "Validation log exists", passed: true },
    ],
    ...overrides,
  };
}

function sampleRuntimeEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    title: "Gongmu runtime clean-account evidence",
    ready: true,
    startedAt: "2026-06-16T12:00:00.000Z",
    completedAt: "2026-06-16T12:05:00.000Z",
    computerName: "CLEAN-VM",
    userName: "tester",
    installPath: "C:/Users/tester/AppData/Local/Programs/Gongmu",
    engineHealthUrl: "http://127.0.0.1:8765/health",
    runtimeLog: { path: "runtime-clean-account-evidence.log", exists: true, sha256: "D".repeat(64) },
    screenshots: [],
    checks: [
      { name: "Gongmu app launched", passed: true, detail: "main window visible" },
      { name: "Work engine health OK", passed: true, detail: "/health status=ok" },
      { name: "Engine restart or recovery guidance observed", passed: true, detail: "recovery guidance visible" },
      { name: "Long job remained responsive", passed: true, detail: "chat stayed responsive during indexing" },
      { name: "Runtime logs captured", passed: true, detail: "runtime-clean-account-evidence.log" },
    ],
    ...overrides,
  };
}

async function withTempRepo(callback) {
  const root = await mkdtemp(join(tmpdir(), "gongmu-clean-finalize-test-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await withTempRepo(async (repoRoot) => {
  const sourceDir = join(repoRoot, "incoming-evidence");
  await writeJson(join(sourceDir, "ai-pack-clean-account-evidence.json"), sampleEvidence());
  await writeFile(join(sourceDir, "ai-pack-clean-account-evidence.md"), "# evidence\n", "utf8");
  await writeJson(join(sourceDir, "runtime-clean-account-evidence.json"), sampleRuntimeEvidence());

  const commands = [];
  const result = await finalizeCleanAccountEvidence({
    repoRoot,
    sourceDir,
    runCommand(command, args) {
      commands.push([command, ...args].join(" "));
      return { status: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(result.ready, true);
  assert.equal(result.runtimeImport.copied, true);
  assert.deepEqual(commands, [
    "npm.cmd run release:runtime-evidence:validate",
    "npm.cmd run verify:completion:preflight",
    "npm.cmd run verify:completion:audit",
  ]);
  const importedRuntimeEvidence = JSON.parse(
    await readFile(
      join(repoRoot, "release", "clean-account-evidence-inbox", "runtime-clean-account-evidence.json"),
      "utf8",
    ),
  );
  assert.equal(importedRuntimeEvidence.ready, true);
  assert.equal(importedRuntimeEvidence.computerName, "CLEAN-VM");
});

await withTempRepo(async (repoRoot) => {
  const sourceDir = join(repoRoot, "incoming-evidence-runtime-fail");
  await writeJson(join(sourceDir, "ai-pack-clean-account-evidence.json"), sampleEvidence());

  const commands = [];
  const result = await finalizeCleanAccountEvidence({
    repoRoot,
    sourceDir,
    runCommand(command, args) {
      const rendered = [command, ...args].join(" ");
      commands.push(rendered);
      return {
        status: rendered.includes("release:runtime-evidence:validate") ? 1 : 0,
        stdout: "",
        stderr: "runtime evidence missing",
      };
    },
  });

  assert.equal(result.ready, false);
  assert.deepEqual(commands, ["npm.cmd run release:runtime-evidence:validate"]);
});

await withTempRepo(async (repoRoot) => {
  const inboxDir = join(repoRoot, "release", "clean-account-evidence-inbox");
  await writeJson(join(inboxDir, "ai-pack-clean-account-evidence.json"), sampleEvidence());
  await writeJson(join(inboxDir, "runtime-clean-account-evidence.json"), sampleRuntimeEvidence());

  const commands = [];
  const result = await finalizeCleanAccountEvidence({
    repoRoot,
    runCommand(command, args) {
      commands.push([command, ...args].join(" "));
      return { status: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(result.ready, true);
  assert.equal(result.runtimeImport.alreadyInPlace, true);
  assert.deepEqual(commands, [
    "npm.cmd run release:runtime-evidence:validate",
    "npm.cmd run verify:completion:preflight",
    "npm.cmd run verify:completion:audit",
  ]);
});

await withTempRepo(async (repoRoot) => {
  const sourceDir = join(repoRoot, "bad-evidence");
  await writeJson(join(sourceDir, "ai-pack-clean-account-evidence.json"), sampleEvidence({ ready: false }));

  const commands = [];
  const result = await finalizeCleanAccountEvidence({
    repoRoot,
    sourceDir,
    runCommand(command, args) {
      commands.push([command, ...args].join(" "));
      return { status: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(result.ready, false);
  assert.equal(commands.length, 0);
  assert.match(result.validation.errors.join("\n"), /Evidence ready must be true/);
});

console.log("finalize-clean-account-evidence checks passed");
