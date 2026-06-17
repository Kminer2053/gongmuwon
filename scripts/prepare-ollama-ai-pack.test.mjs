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
    assert.match(installScript, /Get-WslStatus/);
    assert.match(installScript, /WSL is optional for Gongmu and native Windows Ollama/);
    assert.match(installScript, /Start-OllamaServer/);
    assert.match(installScript, /Import-PackagedModelStore/);
    assert.match(installScript, /If the Ollama app or installer window opens after installation, close it/);
    assert.match(installScript, /Copying the packaged model cache can take several minutes/);
    assert.match(installScript, /robocopy/);
    assert.match(installScript, /Test-GemmaMultimodal/);
    assert.doesNotMatch(installScript, /z8BQDwAFgwJ\/lJ9W5Q/);
    assert.match(installScript, /iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD\/fteaysAAAAASUVORK5CYII=/);
    assert.match(installScript, /\/api\/chat/);
    assert.match(installScript, /images/);
    assert.match(installScript, /settings\.json/);
    assert.match(installScript, /llm_profiles/);

    const batchScript = await readFile(join(result.packageDir, "START_INSTALL.bat"), "utf8");
    assert.match(batchScript, /powershell\.exe/);
    assert.match(batchScript, /ExecutionPolicy Bypass/);
    assert.match(batchScript, /install-gongmu-ai\.ps1/);
    assert.match(batchScript, /GONGMU_AI_PACK_DRY_RUN/);
    assert.match(batchScript, /Gongmu app installer runs first/);
    assert.match(batchScript, /finish the Gongmu installer wizard/);
    assert.match(batchScript, /If the Gongmu app opens, close the app window/);
    assert.match(batchScript, /If the Ollama installer or Ollama app opens, finish it and close it/);
    assert.match(batchScript, /Python, Ollama, and Gemma setup continue after the installer exits/);
    assert.match(batchScript, /After Ollama, the Gemma model cache copy can take several minutes/);
    assert.match(batchScript, /pause/);
    assert.equal(await exists(join(result.packageDir, "install-gongmu-ai.bat")), true);
    assert.equal(await exists(join(result.packageDir, "VALIDATE_INSTALL.bat")), true);
    assert.equal(await exists(join(result.packageDir, "COLLECT_EVIDENCE.bat")), true);

    const fullValidationBatch = await readFile(join(result.packageDir, "RUN_FULL_VALIDATION.bat"), "utf8");
    assert.match(fullValidationBatch, /install-gongmu-ai\.ps1/);
    assert.match(fullValidationBatch, /validate-gongmu-ai\.ps1/);
    assert.match(fullValidationBatch, /collect-clean-account-evidence\.ps1/);
    assert.match(fullValidationBatch, /GONGMU_AI_PACK_DRY_RUN/);
    assert.match(fullValidationBatch, /install-gongmu-ai\.log/);
    assert.match(fullValidationBatch, /evidence\\ai-pack-clean-account-evidence\.md/);
    assert.match(fullValidationBatch, /Gongmu app installer runs first/);
    assert.match(fullValidationBatch, /finish the installer wizard/);
    assert.match(fullValidationBatch, /If Gongmu launches after installation, close the app/);
    assert.match(fullValidationBatch, /If the Ollama installer or Ollama app opens, finish it and close it/);
    assert.match(fullValidationBatch, /Do not close this command window/);
    assert.match(fullValidationBatch, /After Ollama, the Gemma model cache copy can take several minutes/);

    const validateScript = await readFile(join(result.packageDir, "validate-gongmu-ai.ps1"), "utf8");
    assert.match(validateScript, /Find-Python311/);
    assert.match(validateScript, /Find-OllamaExe/);
    assert.match(validateScript, /gemma4:e2b/);
    assert.match(validateScript, /settings\.json/);

    const evidenceScript = await readFile(join(result.packageDir, "collect-clean-account-evidence.ps1"), "utf8");
    assert.match(evidenceScript, /Gongmu clean-account evidence/);
    assert.match(evidenceScript, /WSL optional status/);
    assert.match(evidenceScript, /WSL is optional for Gongmu and native Windows Ollama/);
    assert.match(evidenceScript, /install-gongmu-ai\.log/);
    assert.match(evidenceScript, /validate-gongmu-ai\.log/);
    assert.match(evidenceScript, /ai-pack-clean-account-evidence\.json/);
    assert.match(evidenceScript, /ai-pack-clean-account-evidence\.md/);
    assert.match(evidenceScript, /\/api\/chat/);
    assert.match(evidenceScript, /images/);
    assert.doesNotMatch(evidenceScript, /z8BQDwAFgwJ\/lJ9W5Q/);
    assert.match(evidenceScript, /iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD\/fteaysAAAAASUVORK5CYII=/);

    const readme = await readFile(join(result.packageDir, "README.md"), "utf8");
    assert.match(readme, /Local AI Agent Workplace/);
    assert.match(readme, /Python 3\.11/);
    assert.match(readme, /Ollama/);
    assert.match(readme, /gemma4:e2b/);
    assert.match(readme, /START_INSTALL\.bat/);
    assert.match(readme, /VALIDATE_INSTALL\.bat/);
    assert.match(readme, /COLLECT_EVIDENCE\.bat/);
    assert.match(readme, /RUN_FULL_VALIDATION\.bat/);
    assert.match(readme, /The Gongmu app installer runs first/);
    assert.match(readme, /If Gongmu opens after installation, close the app window/);
    assert.match(readme, /If the Ollama installer or Ollama app opens, finish it and close it/);
    assert.match(readme, /Python\/Ollama\/Gemma setup continues only after the Gongmu installer exits/);
    assert.match(readme, /Gemma model cache copy can take several minutes/);
    assert.match(readme, /WSL is not required for Gongmu or native Windows Ollama/);

    const koreanInstallGuide = await readFile(join(result.packageDir, "INSTALL_GUIDE_KO.md"), "utf8");
    assert.equal(koreanInstallGuide.charCodeAt(0), 0xfeff);
    assert.match(koreanInstallGuide, /\uACF5\uBB34\uC6D0 AI \uC124\uCE58\uD329 \uC124\uCE58 \uC548\uB0B4/);
    assert.match(koreanInstallGuide, /\uCC98\uC74C \uC124\uCE58\uD558\uB294 \uC0AC\uC6A9\uC790\uB97C \uC704\uD55C \uC21C\uC11C/);
    assert.match(koreanInstallGuide, /\uACF5\uBB34\uC6D0 \uC571 \uC124\uCE58 \uB9C8\uBC95\uC0AC\uAC00 \uBA3C\uC800 \uC2E4\uD589\uB429\uB2C8\uB2E4/);
    assert.match(koreanInstallGuide, /\uC571\uC774 \uC790\uB3D9\uC73C\uB85C \uC2E4\uD589\uB418\uBA74 \uC571 \uCC3D\uC744 \uB2EB\uC544\uC8FC\uC138\uC694/);
    assert.match(koreanInstallGuide, /Ollama \uC124\uCE58 \uB9C8\uBC95\uC0AC\uB3C4 \uC644\uB8CC\uD558\uACE0 \uCC3D\uC744 \uB2EB\uC544\uC8FC\uC138\uC694/);
    assert.match(koreanInstallGuide, /\uBC30\uCE58\uD30C\uC77C \uCC3D\uC740 \uB2EB\uC9C0 \uB9C8\uC138\uC694/);
    assert.match(koreanInstallGuide, /Python, Ollama, Gemma \uBAA8\uB378 \uC124\uCE58\uC640 \uAC80\uC99D\uC774 \uC774\uC5B4\uC9D1\uB2C8\uB2E4/);
    assert.match(koreanInstallGuide, /Gemma \uBAA8\uB378 \uCE90\uC2DC \uBCF5\uC0AC\uB294 \uBA87 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4/);
    assert.match(koreanInstallGuide, /WSL\uC740 \uACF5\uBB34\uC6D0\uACFC Windows\uC6A9 Ollama \uC2E4\uD589\uC5D0 \uD544\uC218\uAC00 \uC544\uB2D9\uB2C8\uB2E4/);
    assert.match(koreanInstallGuide, /\uBB38\uC81C\uAC00 \uC0DD\uACBC\uC744 \uB54C \uD655\uC778\uD560 \uD30C\uC77C/);

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
