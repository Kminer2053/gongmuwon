import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  assert.deepEqual(commands, [
    "npm.cmd run release:runtime-evidence:validate",
    "npm.cmd run verify:completion:preflight",
    "npm.cmd run verify:completion:audit",
  ]);
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
