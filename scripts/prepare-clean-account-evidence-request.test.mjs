import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { prepareCleanAccountEvidenceRequest } from "./prepare-clean-account-evidence-request.mjs";

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function artifactReport(overrides = {}) {
  return {
    schemaVersion: 1,
    ready: true,
    packageDir: "C:/release/ai-pack/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-1046",
    manifest: {
      model: {
        name: "gemma4:e2b",
        displayName: "GEMMA4 E2B IT Multimodal",
        multimodal: true,
        embedded: true,
      },
      python: { installerIncluded: true },
      ollama: { installerIncluded: true },
    },
    zip: {
      path: "C:/release/ai-pack/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-1046.zip",
      present: true,
      sizeBytes: 8016696189,
      sha256: "B8A86027570FA8F7262E403B64AB7BCF23545469ABB0FBBB1C63DAECCC0D75DC",
    },
    ...overrides,
  };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "gongmu-clean-request-test-"));
  try {
    const artifactPath = join(root, "ai-pack-artifact-validation.json");
    const outDir = join(root, "request");
    await writeJson(artifactPath, artifactReport());

    const request = await prepareCleanAccountEvidenceRequest({
      artifactReportPath: artifactPath,
      outDir,
    });

    assert.equal(request.ready, true);
    assert.equal(request.artifact.modelName, "gemma4:e2b");
    assert.equal(request.artifact.multimodal, true);
    assert.equal(request.artifact.zipSha256, "B8A86027570FA8F7262E403B64AB7BCF23545469ABB0FBBB1C63DAECCC0D75DC");
    assert.equal(request.copyBack.sourcePathOnTargetPc, "evidence");
    assert.equal(request.copyBack.targetPath.endsWith("release/clean-account-evidence-inbox"), true);
    assert.equal(request.copyBack.validationCommand, "npm.cmd run release:ai-pack:evidence:finalize");

    const readme = await readFile(join(outDir, "README.md"), "utf8");
    assert.match(readme, /START_INSTALL_GUI\.bat/);
    assert.match(readme, /설치 모니터/);
    assert.match(readme, /RUN_FULL_VALIDATION\.bat/);
    assert.match(readme, /START_INSTALL\.bat/);
    assert.match(readme, /VALIDATE_INSTALL\.bat/);
    assert.match(readme, /COLLECT_EVIDENCE\.bat/);
    assert.match(readme, /install-gongmu-ai-gui\.log/);
    assert.match(readme, /release[\\/]clean-account-evidence-inbox/);
    assert.match(readme, /release:ai-pack:evidence:finalize/);
    assert.match(readme, /runtime-clean-account-evidence\.template\.json/);
    assert.match(readme, /COLLECT_RUNTIME_EVIDENCE\.bat/);
    assert.match(readme, /release:runtime-evidence:validate/);
    assert.match(readme, /클린계정\/폐쇄망 검증 요청서/);
    assert.match(readme, /대상 PC에서 실행할 순서/);
    assert.doesNotMatch(readme, /[怨媛利濡蹂寃]/, "README should not contain mojibake characters");
    assert.doesNotMatch(
      readme,
      /release:ai-pack:evidence:finalize\r?\nnpm\.cmd run release:runtime-evidence:validate/,
      "README should not ask users to run runtime validation as a second command after finalize",
    );
    assert.match(readme, /B8A86027570FA8F7262E403B64AB7BCF23545469ABB0FBBB1C63DAECCC0D75DC/);

    const sha = await readFile(join(outDir, "EXPECTED_SHA256.txt"), "utf8");
    assert.match(sha, /B8A86027570FA8F7262E403B64AB7BCF23545469ABB0FBBB1C63DAECCC0D75DC/);

    const copyTargets = await readFile(join(outDir, "COPY_TARGETS.txt"), "utf8");
    assert.match(copyTargets, /evidence folder/);
    assert.match(copyTargets, /release\/clean-account-evidence-inbox/);
    assert.match(copyTargets, /runtime-clean-account-evidence\.json/);
    assert.doesNotMatch(
      copyTargets,
      /^  npm\.cmd run release:runtime-evidence:validate/m,
      "COPY_TARGETS should keep finalize as the single primary repository command",
    );

    const runtimeTemplate = JSON.parse(
      await readFile(join(outDir, "runtime-clean-account-evidence.template.json"), "utf8"),
    );
    assert.equal(runtimeTemplate.ready, false);
    assert.ok(
      runtimeTemplate.checks.some((check) => check.name === "Work engine health OK"),
      "runtime evidence template should ask for work engine health confirmation",
    );
    assert.ok(
      runtimeTemplate.checks.some((check) => String(check.detail).includes("업무엔진")),
      "runtime evidence template details should be readable Korean",
    );
    assert.doesNotMatch(
      JSON.stringify(runtimeTemplate),
      /[怨媛利濡蹂寃]/,
      "runtime evidence template should not contain mojibake characters",
    );

    const runtimeScript = await readFile(join(outDir, "COLLECT_RUNTIME_EVIDENCE.ps1"), "utf8");
    assert.match(runtimeScript, /runtime-clean-account-evidence\.json/);
    assert.match(runtimeScript, /Work engine health OK/);
    assert.match(runtimeScript, /Invoke-RestMethod/);

    const runtimeBatch = await readFile(join(outDir, "COLLECT_RUNTIME_EVIDENCE.bat"), "utf8");
    assert.match(runtimeBatch, /COLLECT_RUNTIME_EVIDENCE\.ps1/);

    const badArtifactPath = join(root, "bad-ai-pack-artifact-validation.json");
    await writeJson(badArtifactPath, artifactReport({ ready: false, zip: { present: false } }));
    await assert.rejects(
      () =>
        prepareCleanAccountEvidenceRequest({
          artifactReportPath: badArtifactPath,
          outDir: join(root, "bad-request"),
        }),
      /AI pack artifact validation is not ready/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
