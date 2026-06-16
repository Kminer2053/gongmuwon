import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateAiPackArtifact } from "./validate-ai-pack-artifact.mjs";

async function writeFixture(path, content) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "gongmu-ai-pack-artifact-test-"));
  try {
    const packageDir = join(root, "Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-0941");
    const zipPath = `${packageDir}.zip`;
    const outJson = join(root, "ai-pack-artifact-validation.json");
    const outMarkdown = join(root, "ai-pack-artifact-validation.md");

    await writeFixture(
      join(packageDir, "manifest.json"),
      JSON.stringify(
        {
          package: { name: "gongmu-ollama-gemma4-e2b-it-ai-pack" },
          app: { installerIncluded: true },
          python: { installerIncluded: true, requiredForBundledApp: false },
          ollama: { installerIncluded: true },
          model: {
            name: "gemma4:e2b",
            displayName: "GEMMA4 E2B IT Multimodal",
            multimodal: true,
            embedded: true,
          },
        },
        null,
        2,
      ),
    );
    await writeFixture(join(packageDir, "README.md"), "# Local AI Agent Workplace\n");
    await writeFixture(join(packageDir, "THIRD_PARTY_NOTICES.md"), "# Notices\n");
    await writeFixture(join(packageDir, "SHA256SUMS.txt"), "hash  START_INSTALL.bat\n");
    await writeFixture(join(packageDir, "START_INSTALL.bat"), "@echo off\r\necho dry\r\n");
    await writeFixture(join(packageDir, "VALIDATE_INSTALL.bat"), "@echo off\r\necho dry\r\n");
    await writeFixture(join(packageDir, "COLLECT_EVIDENCE.bat"), "@echo off\r\necho collect\r\n");
    await writeFixture(join(packageDir, "RUN_FULL_VALIDATION.bat"), "@echo off\r\necho full validation\r\n");
    await writeFixture(join(packageDir, "install-gongmu-ai.ps1"), "Write-Output 'install'\n");
    await writeFixture(join(packageDir, "validate-gongmu-ai.ps1"), "Write-Output 'validate'\n");
    await writeFixture(join(packageDir, "collect-clean-account-evidence.ps1"), "Write-Output 'evidence'\n");
    await writeFixture(join(packageDir, "gongmu", "Gongmu_0.1.0_x64-setup.exe"), "fake app installer\n");
    await writeFixture(join(packageDir, "ollama", "OllamaSetup.exe"), "fake ollama installer\n");
    await writeFixture(join(packageDir, "python", "python-3.11.9-amd64.exe"), "fake python installer\n");
    await writeFixture(
      join(packageDir, "models", "manifests", "registry.ollama.ai", "library", "gemma4", "e2b"),
      JSON.stringify({ schemaVersion: 2 }),
    );
    await writeFixture(join(packageDir, "models", "blobs", "sha256-abc"), "fake model blob\n");
    await writeFixture(zipPath, "fake zip\n");

    const report = await validateAiPackArtifact({
      packageDir,
      zipPath,
      outJson,
      outMarkdown,
      requireZip: true,
      minZipBytes: 1,
      runLauncherDryRun: false,
      parsePowerShell: false,
    });

    assert.equal(report.ready, true);
    assert.equal(report.packageDir, packageDir);
    assert.equal(report.zip.present, true);
    assert.equal(report.manifest.model.name, "gemma4:e2b");
    assert.equal(report.manifest.model.multimodal, true);
    assert.equal(report.requiredFiles.every((item) => item.present), true);
    assert.equal(report.modelStore.hasManifest, true);
    assert.equal(report.modelStore.blobCount, 1);
    assert.equal(report.launchers.startInstall.present, true);
    assert.equal(report.launchers.validateInstall.present, true);
    assert.equal(report.launchers.collectEvidence.present, true);
    assert.equal(report.launchers.fullValidation.present, true);

    const json = JSON.parse(await readFile(outJson, "utf8"));
    assert.equal(json.ready, true);
    const markdown = await readFile(outMarkdown, "utf8");
    assert.match(markdown, /AI pack artifact validation/);
    assert.match(markdown, /gemma4:e2b/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
