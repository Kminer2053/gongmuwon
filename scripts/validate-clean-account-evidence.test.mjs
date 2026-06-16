import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateCleanAccountEvidence } from "./validate-clean-account-evidence.mjs";

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sampleEvidence(overrides = {}) {
  const checks = [
    ["Python 3.11 detected or optional", true, "Python 3.11: C:/Python311/python.exe"],
    ["Ollama executable detected", true, "C:/Users/User/AppData/Local/Programs/Ollama/ollama.exe"],
    ["Ollama server responding", true, "http://127.0.0.1:11434/api/tags"],
    ["gemma4:e2b model listed", true, "gemma4:e2b"],
    ["Text chat response", true, "로컬 AI 검증 응답입니다."],
    ["Image chat response", true, "이미지 입력을 수신했습니다."],
    ["Gongmu settings file exists", true, "C:/Users/User/AppData/Local/kr.gongmu.workspace/runtime-workspace/settings.json"],
    ["Gongmu settings point to Ollama model", true, "settings.json"],
    ["Install log exists", true, "install-gongmu-ai.log"],
    ["Validation log exists", true, "validate-gongmu-ai.log"],
  ].map(([name, passed, detail]) => ({ name, passed, detail }));

  return {
    schemaVersion: 1,
    title: "Gongmu clean-account evidence",
    ready: true,
    startedAt: "2026-06-16T02:00:00.000Z",
    completedAt: "2026-06-16T02:05:00.000Z",
    computerName: "GONGMU-CLEAN-VM",
    userName: "clean-user",
    os: { Caption: "Microsoft Windows 11 Pro", Version: "10.0.26100", BuildNumber: "26100" },
    packageDir: "D:/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-1046",
    modelName: "gemma4:e2b",
    ollamaHost: "127.0.0.1:11434",
    python: "C:/Python311/python.exe",
    ollamaExe: "C:/Users/User/AppData/Local/Programs/Ollama/ollama.exe",
    modelNames: ["gemma4:e2b"],
    settingsPath: "C:/Users/User/AppData/Local/kr.gongmu.workspace/runtime-workspace/settings.json",
    installLog: { path: "install-gongmu-ai.log", exists: true, sha256: "A".repeat(64) },
    validateLog: { path: "validate-gongmu-ai.log", exists: true, sha256: "B".repeat(64) },
    textResponse: "로컬 AI 검증 응답입니다.",
    imageResponse: "이미지 입력을 수신했습니다.",
    checks,
    ...overrides,
  };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "gongmu-clean-evidence-test-"));
  try {
    const evidencePath = join(root, "evidence", "ai-pack-clean-account-evidence.json");
    const outJson = join(root, "clean-account-evidence-validation.json");
    const outMarkdown = join(root, "clean-account-evidence-validation.md");
    await writeJson(evidencePath, sampleEvidence());

    const report = await validateCleanAccountEvidence({
      evidencePath,
      outJson,
      outMarkdown,
    });

    assert.equal(report.ready, true);
    assert.equal(report.evidence.ready, true);
    assert.equal(report.evidence.modelName, "gemma4:e2b");
    assert.equal(report.requiredChecks.every((check) => check.present && check.passed), true);
    assert.equal(report.errors.length, 0);
    assert.match(await readFile(outMarkdown, "utf8"), /Clean-account evidence validation/);
    assert.equal(JSON.parse(await readFile(outJson, "utf8")).ready, true);

    const badEvidencePath = join(root, "bad", "ai-pack-clean-account-evidence.json");
    const bad = sampleEvidence({
      ready: true,
      checks: sampleEvidence().checks.map((check) =>
        check.name === "Image chat response" ? { ...check, passed: false, detail: "image request failed" } : check,
      ),
      imageResponse: "",
    });
    await writeJson(badEvidencePath, bad);
    const badReport = await validateCleanAccountEvidence({
      evidencePath: badEvidencePath,
      outJson: join(root, "bad-validation.json"),
      outMarkdown: join(root, "bad-validation.md"),
    });
    assert.equal(badReport.ready, false);
    assert.ok(badReport.errors.some((error) => error.includes("Image chat response")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
