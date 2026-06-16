import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { importCleanAccountEvidence } from "./import-clean-account-evidence.mjs";

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function sampleEvidence() {
  const checks = [
    ["Ollama executable detected", true, "ollama.exe"],
    ["Ollama server responding", true, "http://127.0.0.1:11434"],
    ["gemma4:e2b model listed", true, "gemma4:e2b"],
    ["Text chat response", true, "text ok"],
    ["Image chat response", true, "image ok"],
    ["Gongmu settings file exists", true, "settings.json"],
    ["Gongmu settings point to Ollama model", true, "gemma4:e2b"],
    ["Install log exists", true, "install-gongmu-ai.log"],
    ["Validation log exists", true, "validate-gongmu-ai.log"],
  ].map(([name, passed, detail]) => ({ name, passed, detail }));

  return {
    schemaVersion: 1,
    ready: true,
    completedAt: "2026-06-16T04:00:00.000Z",
    computerName: "GONGMU-CLEAN-VM",
    userName: "clean-user",
    os: { Caption: "Windows 11" },
    packageDir: "D:/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-1046",
    modelName: "gemma4:e2b",
    textResponse: "text ok",
    imageResponse: "image ok",
    installLog: { path: "install-gongmu-ai.log", exists: true, sha256: "A".repeat(64) },
    validateLog: { path: "validate-gongmu-ai.log", exists: true, sha256: "B".repeat(64) },
    checks,
  };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "gongmu-evidence-import-test-"));
  try {
    const sourceDir = join(root, "target-evidence");
    const outputDir = join(root, "repo", "docs", "operations", "generated", "clean-account-evidence");
    const validationJson = join(root, "repo", "docs", "operations", "generated", "clean-account-evidence-validation.json");
    const validationMd = join(root, "repo", "docs", "operations", "generated", "clean-account-evidence-validation.md");
    await mkdir(sourceDir, { recursive: true });
    await writeJson(join(sourceDir, "ai-pack-clean-account-evidence.json"), sampleEvidence());
    await writeFile(join(sourceDir, "ai-pack-clean-account-evidence.md"), "# evidence\n", "utf8");
    await writeFile(join(sourceDir, "collect-clean-account-evidence.log"), "collect ok\n", "utf8");
    await writeFile(join(sourceDir, "install-gongmu-ai.log"), "install ok\n", "utf8");
    await writeFile(join(sourceDir, "validate-gongmu-ai.log"), "validate ok\n", "utf8");

    const report = await importCleanAccountEvidence({
      sourceDir,
      outputDir,
      validationJson,
      validationMarkdown: validationMd,
      importJson: join(root, "repo", "docs", "operations", "generated", "clean-account-evidence-import.json"),
      importMarkdown: join(root, "repo", "docs", "operations", "generated", "clean-account-evidence-import.md"),
    });

    assert.equal(report.ready, true);
    assert.equal(report.validation.ready, true);
    assert.equal(report.files.length, 5);
    assert.equal(await exists(join(outputDir, "ai-pack-clean-account-evidence.json")), true);
    assert.equal(await exists(join(outputDir, "ai-pack-clean-account-evidence.md")), true);
    assert.equal(await exists(join(outputDir, "collect-clean-account-evidence.log")), true);
    assert.match(await readFile(validationMd, "utf8"), /Clean-account evidence validation/);

    const packageRoot = join(root, "target-package-root");
    const packageEvidenceDir = join(packageRoot, "evidence");
    const packageOutputDir = join(root, "repo-package", "docs", "operations", "generated", "clean-account-evidence");
    await mkdir(packageEvidenceDir, { recursive: true });
    await writeJson(join(packageEvidenceDir, "ai-pack-clean-account-evidence.json"), sampleEvidence());
    await writeFile(join(packageEvidenceDir, "ai-pack-clean-account-evidence.md"), "# package evidence\n", "utf8");
    await writeFile(join(packageEvidenceDir, "collect-clean-account-evidence.log"), "package collect ok\n", "utf8");
    await writeFile(join(packageRoot, "install-gongmu-ai.log"), "package install ok\n", "utf8");
    await writeFile(join(packageRoot, "validate-gongmu-ai.log"), "package validate ok\n", "utf8");

    const packageReport = await importCleanAccountEvidence({
      sourceDir: packageRoot,
      outputDir: packageOutputDir,
      validationJson: join(root, "repo-package", "docs", "operations", "generated", "clean-account-evidence-validation.json"),
      validationMarkdown: join(root, "repo-package", "docs", "operations", "generated", "clean-account-evidence-validation.md"),
      importJson: join(root, "repo-package", "docs", "operations", "generated", "clean-account-evidence-import.json"),
      importMarkdown: join(root, "repo-package", "docs", "operations", "generated", "clean-account-evidence-import.md"),
    });

    assert.equal(packageReport.ready, true);
    assert.equal(packageReport.detectedSourceKind, "package-root");
    assert.equal(packageReport.files.length, 5);
    assert.equal(await readFile(join(packageOutputDir, "install-gongmu-ai.log"), "utf8"), "package install ok\n");
    assert.equal(await readFile(join(packageOutputDir, "validate-gongmu-ai.log"), "utf8"), "package validate ok\n");

    const singleJsonDir = join(root, "single-json");
    const singleJsonPath = join(singleJsonDir, "ai-pack-clean-account-evidence.json");
    const singleJsonOutputDir = join(root, "repo-single-json", "docs", "operations", "generated", "clean-account-evidence");
    await mkdir(singleJsonDir, { recursive: true });
    await writeJson(singleJsonPath, sampleEvidence());

    const singleJsonReport = await importCleanAccountEvidence({
      sourceDir: singleJsonPath,
      outputDir: singleJsonOutputDir,
      validationJson: join(root, "repo-single-json", "docs", "operations", "generated", "clean-account-evidence-validation.json"),
      validationMarkdown: join(root, "repo-single-json", "docs", "operations", "generated", "clean-account-evidence-validation.md"),
      importJson: join(root, "repo-single-json", "docs", "operations", "generated", "clean-account-evidence-import.json"),
      importMarkdown: join(root, "repo-single-json", "docs", "operations", "generated", "clean-account-evidence-import.md"),
    });

    assert.equal(singleJsonReport.ready, true);
    assert.equal(singleJsonReport.detectedSourceKind, "evidence-json-file");
    assert.equal(singleJsonReport.files.length, 1);
    assert.equal(await exists(join(singleJsonOutputDir, "ai-pack-clean-account-evidence.json")), true);

    await assert.rejects(
      () =>
        importCleanAccountEvidence({
          sourceDir: join(root, "missing"),
          outputDir: join(root, "missing-out"),
          validationJson: join(root, "missing-validation.json"),
          validationMarkdown: join(root, "missing-validation.md"),
        }),
      /Evidence source directory not found/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
