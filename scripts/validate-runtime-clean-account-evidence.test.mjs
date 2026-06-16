import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { validateRuntimeCleanAccountEvidence } from "./validate-runtime-clean-account-evidence.mjs";

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sampleEvidence(overrides = {}) {
  const checks = [
    ["Gongmu app launched", true, "앱 메인 화면 표시 확인"],
    ["Work engine health OK", true, "/health status=ok"],
    ["Engine restart or recovery guidance observed", true, "강제 종료 후 재시작 안내 확인"],
    ["Long job remained responsive", true, "GraphRAG 인덱싱 중 파일검색 응답 확인"],
    ["Runtime logs captured", true, "runtime-validation.log"],
  ].map(([name, passed, detail]) => ({ name, passed, detail }));

  return {
    schemaVersion: 1,
    title: "Gongmu runtime clean-account evidence",
    ready: true,
    startedAt: "2026-06-16T05:00:00.000Z",
    completedAt: "2026-06-16T05:10:00.000Z",
    computerName: "GONGMU-CLEAN-VM",
    userName: "clean-user",
    installPath: "C:/Users/clean-user/AppData/Local/Programs/gongmu",
    appVersion: "0.1.0",
    engineHealthUrl: "http://127.0.0.1:8765/health",
    runtimeLog: { path: "runtime-validation.log", exists: true, sha256: "C".repeat(64) },
    screenshots: ["app-main.png", "engine-popover.png"],
    checks,
    ...overrides,
  };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "gongmu-runtime-evidence-test-"));
  try {
    const evidencePath = join(root, "runtime-clean-account-evidence.json");
    const outJson = join(root, "runtime-clean-account-evidence-validation.json");
    const outMarkdown = join(root, "runtime-clean-account-evidence-validation.md");
    await writeJson(evidencePath, sampleEvidence());

    const report = await validateRuntimeCleanAccountEvidence({
      evidencePath,
      outJson,
      outMarkdown,
    });

    assert.equal(report.ready, true);
    assert.equal(report.evidence.ready, true);
    assert.equal(report.requiredChecks.every((check) => check.present && check.passed), true);
    assert.equal(report.errors.length, 0);
    assert.match(await readFile(outMarkdown, "utf8"), /Runtime clean-account evidence validation/);
    assert.equal(JSON.parse(await readFile(outJson, "utf8")).ready, true);

    const badEvidencePath = join(root, "bad-runtime-clean-account-evidence.json");
    await writeJson(
      badEvidencePath,
      sampleEvidence({
        checks: sampleEvidence().checks.map((check) =>
          check.name === "Work engine health OK" ? { ...check, passed: false, detail: "connection refused" } : check,
        ),
      }),
    );
    const badReport = await validateRuntimeCleanAccountEvidence({
      evidencePath: badEvidencePath,
      outJson: join(root, "bad-validation.json"),
      outMarkdown: join(root, "bad-validation.md"),
    });
    assert.equal(badReport.ready, false);
    assert.ok(badReport.errors.some((error) => error.includes("Work engine health OK")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
