import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { prepareOllamaAiPack } from "./prepare-ollama-ai-pack.mjs";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeFixture(path, content) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "gongmu-ai-pack-test-"));
  try {
    const offlineDir = join(root, "release", "offline", "Gongmu_0.1.0_windows_x64_offline_20260616_0211");
    const installerPath = join(offlineDir, "Gongmu_0.1.0_x64-setup.exe");
    await writeFixture(installerPath, "fake nsis installer");

    const ollamaInstaller = join(root, "OllamaSetup.exe");
    await writeFixture(ollamaInstaller, "fake ollama installer");

    const pythonInstaller = join(root, "python-3.11.9-amd64.exe");
    await writeFixture(pythonInstaller, "fake python installer");

    const modelStore = join(root, "ollama-models");
    await writeFixture(
      join(modelStore, "manifests", "registry.ollama.ai", "library", "gemma4", "e2b"),
      JSON.stringify({ model: "gemma4:e2b", layers: [{ digest: "sha256:abc" }] }),
    );
    await writeFixture(join(modelStore, "blobs", "sha256-abc"), "fake model layer");

    const result = await prepareOllamaAiPack({
      repoRoot: root,
      outRoot: join(root, "release", "ai-pack"),
      includeOllamaInstaller: ollamaInstaller,
      includePythonInstaller: pythonInstaller,
      includeModels: modelStore,
      skipZip: true,
      stamp: "20260616-030000",
    });

    assert.equal(result.manifest.app.installerIncluded, true);
    assert.equal(result.manifest.python.installerIncluded, true);
    assert.equal(result.manifest.python.requiredForBundledApp, false);
    assert.equal(result.manifest.ollama.installerIncluded, true);
    assert.equal(result.manifest.model.name, "gemma4:e2b");
    assert.equal(result.manifest.model.multimodal, true);
    assert.equal(result.manifest.model.embedded, true);

    const installScript = await readFile(join(result.packageDir, "install-gongmu-ai.ps1"), "utf8");
    assert.match(installScript, /Find-Python311/);
    assert.match(installScript, /Install-Python311IfAvailable/);
    assert.match(installScript, /Gongmu bundled app can run without system Python/);
    assert.match(installScript, /Find-OllamaExe/);
    assert.match(installScript, /Start-OllamaServer/);
    assert.match(installScript, /Import-PackagedModelStore/);
    assert.match(installScript, /Test-GemmaMultimodal/);
    assert.match(installScript, /\/api\/chat/);
    assert.match(installScript, /images/);
    assert.match(installScript, /settings\.json/);
    assert.match(installScript, /llm_profiles/);

    const batchScript = await readFile(join(result.packageDir, "START_INSTALL.bat"), "utf8");
    assert.match(batchScript, /powershell\.exe/);
    assert.match(batchScript, /ExecutionPolicy Bypass/);
    assert.match(batchScript, /install-gongmu-ai\.ps1/);
    assert.match(batchScript, /GONGMU_AI_PACK_DRY_RUN/);
    assert.match(batchScript, /pause/);
    assert.equal(await exists(join(result.packageDir, "install-gongmu-ai.bat")), true);
    assert.equal(await exists(join(result.packageDir, "VALIDATE_INSTALL.bat")), true);

    const validateScript = await readFile(join(result.packageDir, "validate-gongmu-ai.ps1"), "utf8");
    assert.match(validateScript, /Find-Python311/);
    assert.match(validateScript, /Find-OllamaExe/);
    assert.match(validateScript, /gemma4:e2b/);
    assert.match(validateScript, /settings\.json/);

    const readme = await readFile(join(result.packageDir, "README.md"), "utf8");
    assert.match(readme, /Local AI Agent Workplace/);
    assert.match(readme, /Python 3\.11/);
    assert.match(readme, /Ollama/);
    assert.match(readme, /gemma4:e2b/);
    assert.match(readme, /START_INSTALL\.bat/);
    assert.match(readme, /VALIDATE_INSTALL\.bat/);

    const notices = await readFile(join(result.packageDir, "THIRD_PARTY_NOTICES.md"), "utf8");
    assert.match(notices, /Ollama/);
    assert.match(notices, /MIT/);
    assert.match(notices, /Gemma/);
    assert.match(notices, /Apache-2\.0/);
    assert.match(notices, /Python/);

    assert.equal(await exists(join(result.packageDir, "python", "python-3.11.9-amd64.exe")), true);
    assert.equal(await exists(join(result.packageDir, "ollama", "OllamaSetup.exe")), true);
    assert.equal(
      await exists(join(result.packageDir, "models", "manifests", "registry.ollama.ai", "library", "gemma4", "e2b")),
      true,
    );
    assert.equal(await exists(join(result.packageDir, "models", "blobs", "sha256-abc")), true);
    assert.equal(await exists(join(result.packageDir, "gongmu", "Gongmu_0.1.0_x64-setup.exe")), true);
    assert.equal(await exists(join(result.packageDir, "SHA256SUMS.txt")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
