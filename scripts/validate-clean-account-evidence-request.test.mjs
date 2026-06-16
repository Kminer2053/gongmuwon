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
      "run COLLECT_RUNTIME_EVIDENCE.bat after launching Gongmu",
      "copy evidence JSON back to repository",
    ],
    copyBack: {
      sourcePathOnTargetPc: "evidence",
      targetPath: "release/clean-account-evidence-inbox",
      validationCommand: "npm.cmd run release:ai-pack:evidence:finalize",
      runtimeValidationCommand: "npm.cmd run release:runtime-evidence:validate",
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
    await writeText(
      readmePath,
      [
        "# 클린계정/폐쇄망 검증 요청서",
        "대상 PC에서 실행할 순서입니다.",
        "Run RUN_FULL_VALIDATION.bat and COLLECT_RUNTIME_EVIDENCE.bat.",
        "Copy the evidence folder into release\\clean-account-evidence-inbox.",
        "Then run release:ai-pack:evidence:finalize.",
        "Use release:runtime-evidence:validate only as a runtime-only fallback.",
        "업무엔진 상태와 런타임 증거를 함께 확인합니다.",
      ].join("\n"),
    );
    await writeText(
      join(requestDir, "COLLECT_RUNTIME_EVIDENCE.ps1"),
      "Invoke-RestMethod http://127.0.0.1:8765/health\nWork engine health OK\nruntime-clean-account-evidence.json\n",
    );
    await writeText(join(requestDir, "COLLECT_RUNTIME_EVIDENCE.bat"), "COLLECT_RUNTIME_EVIDENCE.ps1\n");
    await writeText(
      join(requestDir, "runtime-clean-account-evidence.template.json"),
      JSON.stringify({ checks: [{ name: "Work engine health OK", detail: "업무엔진 /health 상태를 확인합니다." }] }),
    );

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
    assert.ok(
      report.checks.some((check) => check.name === "README keeps finalizer as the single primary repository command"),
      "request validator should reject duplicate post-finalize runtime validation instructions",
    );
    assert.ok(
      report.checks.some((check) => check.name === "README has readable Korean operator guidance"),
      "request validator should check that target-PC operator guidance is readable Korean",
    );
    assert.ok(
      report.checks.some((check) => check.name === "runtime evidence template has readable Korean guidance"),
      "request validator should check that runtime evidence template guidance is readable Korean",
    );
    assert.ok(
      report.checks.some((check) => check.name === "request includes runtime evidence collector"),
      "request validator should check the runtime evidence collector",
    );
    assert.ok(
      report.checks.some((check) => check.name === "request includes runtime validation command"),
      "request validator should check the runtime validation command",
    );
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

    await writeJson(requestPath, requestJson());
    await writeText(
      readmePath,
      "클린계정 검증 요청서\nRun RUN_FULL_VALIDATION.bat and COLLECT_RUNTIME_EVIDENCE.bat, then run release:ai-pack:evidence:finalize and release:runtime-evidence:validate.\n",
    );
    const duplicateRuntimeValidation = await validateCleanAccountEvidenceRequest({
      repoRoot: root,
      artifactReportPath: artifactPath,
      requestPath,
      requestReadmePath: readmePath,
      outJson,
      outMarkdown,
    });
    assert.equal(duplicateRuntimeValidation.ready, false);
    assert.ok(
      duplicateRuntimeValidation.errors.some((error) =>
        error.includes("single primary repository command"),
      ),
    );

    await writeJson(requestPath, requestJson());
    await writeText(
      readmePath,
      [
        "# ?대┛怨꾩젙/?먯뇙留?寃利??붿껌??",
        "Run RUN_FULL_VALIDATION.bat and COLLECT_RUNTIME_EVIDENCE.bat.",
        "Then run release:ai-pack:evidence:finalize.",
      ].join("\n"),
    );
    const mojibakeReadme = await validateCleanAccountEvidenceRequest({
      repoRoot: root,
      artifactReportPath: artifactPath,
      requestPath,
      requestReadmePath: readmePath,
      outJson,
      outMarkdown,
    });
    assert.equal(mojibakeReadme.ready, false);
    assert.ok(
      mojibakeReadme.errors.some((error) => error.includes("readable Korean")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
