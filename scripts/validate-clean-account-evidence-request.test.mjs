import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateCleanAccountEvidenceRequest } from "./validate-clean-account-evidence-request.mjs";

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value, "utf8");
}

function artifactReport() {
  return {
    ready: true,
    packageDir: "C:/repo/release/ai-pack/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-1213",
    manifest: {
      model: {
        name: "gemma4:e2b",
        displayName: "GEMMA4 E2B IT Multimodal",
        multimodal: true,
        embedded: true,
      },
    },
    zip: {
      path: "C:/repo/release/ai-pack/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-1213.zip",
      present: true,
      sizeBytes: 8016697130,
      sha256: "E0ADF41DD714E5E35F961363B62543C4EC90CB827BFAC6EF9ACDBA2B44EC05B7",
    },
  };
}

function requestJson(overrides = {}) {
  return {
    ready: true,
    artifact: {
      zipPath: "C:/repo/release/ai-pack/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260616-1213.zip",
      zipSizeBytes: 8016697130,
      zipSha256: "E0ADF41DD714E5E35F961363B62543C4EC90CB827BFAC6EF9ACDBA2B44EC05B7",
      modelName: "gemma4:e2b",
      multimodal: true,
      modelEmbedded: true,
    },
    targetPcSteps: [
      "copy AI Pack zip",
      "verify SHA256",
      "extract zip",
      "run RUN_FULL_VALIDATION.bat",
      "copy evidence JSON back to repository",
    ],
    copyBack: {
      sourcePathOnTargetPc: "evidence\\ai-pack-clean-account-evidence.json",
      targetPath: "docs/operations/generated/clean-account-evidence/ai-pack-clean-account-evidence.json",
      validationCommand: "npm.cmd run release:ai-pack:evidence:validate",
    },
    ...overrides,
  };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "gongmu-clean-request-validation-test-"));
  try {
    const artifactPath = join(root, "docs", "operations", "generated", "ai-pack-artifact-validation.json");
    const requestDir = join(root, "release", "clean-account-evidence-request");
    const requestPath = join(requestDir, "REQUEST.json");
    const readmePath = join(requestDir, "README.md");
    const outJson = join(root, "docs", "operations", "generated", "clean-account-evidence-request-validation.json");
    const outMarkdown = join(root, "docs", "operations", "generated", "clean-account-evidence-request-validation.md");

    await writeJson(artifactPath, artifactReport());
    await writeJson(requestPath, requestJson());
    await writeText(readmePath, "Run RUN_FULL_VALIDATION.bat, then return evidence\\ai-pack-clean-account-evidence.json.\n");

    const report = await validateCleanAccountEvidenceRequest({
      repoRoot: root,
      artifactReportPath: artifactPath,
      requestPath,
      requestReadmePath: readmePath,
      outJson,
      outMarkdown,
    });

    assert.equal(report.ready, true);
    assert.equal(report.checks.every((check) => check.ok), true);
    assert.equal(report.request.artifact.zipSha256, artifactReport().zip.sha256);
    assert.match(await readFile(outMarkdown, "utf8"), /clean-account evidence request validation/);
    const firstJson = await readFile(outJson, "utf8");
    const firstMarkdown = await readFile(outMarkdown, "utf8");

    await validateCleanAccountEvidenceRequest({
      repoRoot: root,
      artifactReportPath: artifactPath,
      requestPath,
      requestReadmePath: readmePath,
      outJson,
      outMarkdown,
    });
    assert.equal(await readFile(outJson, "utf8"), firstJson);
    assert.equal(await readFile(outMarkdown, "utf8"), firstMarkdown);

    await writeJson(requestPath, requestJson({ artifact: { ...requestJson().artifact, zipSha256: "BAD" } }));
    const stale = await validateCleanAccountEvidenceRequest({
      repoRoot: root,
      artifactReportPath: artifactPath,
      requestPath,
      requestReadmePath: readmePath,
      outJson,
      outMarkdown,
    });
    assert.equal(stale.ready, false);
    assert.ok(stale.errors.some((error) => error.includes("zip SHA256")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
