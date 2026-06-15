import assert from "node:assert/strict";
import path from "node:path";

import {
  buildBundledSidecarEndpointChecks,
  buildSmokeReport,
  parseBundledSidecarSmokeArgs,
  resolveBundledSidecarSmokeConfig,
} from "./smoke-bundled-sidecar.mjs";

function runChecks() {
  {
    const config = resolveBundledSidecarSmokeConfig({
      repoRoot: "C:\\repo",
      now: () => "2026-06-15T09:00:00.000Z",
    });

    assert.equal(
      config.executable,
      path.win32.join(
        "C:\\repo",
        "apps",
        "desktop",
        "src-tauri",
        "resources",
        "sidecar",
        "windows-x64",
        "gongmu-sidecar",
        "gongmu-sidecar.exe",
      ),
    );
    assert.equal(config.port, 8876);
    assert.equal(
      config.workspace,
      path.win32.join("C:\\repo", "runtime-workspace", "cache", "bundled-sidecar-smoke-20260615"),
    );
    assert.equal(
      config.outPath,
      path.win32.join("C:\\repo", "docs", "operations", "generated", "bundled-sidecar-smoke-2026-06-15.json"),
    );
  }

  {
    const args = parseBundledSidecarSmokeArgs([
      "--port",
      "9123",
      "--workspace",
      "C:\\tmp\\work",
      "--out",
      "C:\\tmp\\out.json",
    ]);

    assert.equal(args.port, 9123);
    assert.equal(args.workspace, "C:\\tmp\\work");
    assert.equal(args.outPath, "C:\\tmp\\out.json");
  }

  {
    const report = buildSmokeReport({
      status: "pass",
      executable: "C:\\repo\\gongmu-sidecar.exe",
      workspace: "C:\\tmp\\work",
      port: 8876,
      startedAt: "2026-06-15T09:00:00.000Z",
      health: {
        url: "http://127.0.0.1:8876/health",
        payload: { status: "ok" },
        attempt: 3,
      },
      stdout: "ok\n",
      stderr: "server started\n",
      generatedAt: "2026-06-15T09:00:05.000Z",
    });

    assert.equal(report.status, "pass");
    assert.equal(report.health.payload.status, "ok");
    assert.equal(report.stdout_tail, "ok\n");
    assert.equal(report.stderr_tail, "server started\n");
  }

  {
    const checks = buildBundledSidecarEndpointChecks({
      profilePayload: {
        org_name: "테스트기관",
        department_name: "AI혁신과",
        team_name: "업무자동화팀",
        position: "주무관",
        duty_keywords: ["AI", "보고서"],
      },
    });

    assert.deepEqual(
      checks.map((check) => `${check.method} ${check.path}`),
      [
        "GET /api/knowledge/work-profile",
        "PUT /api/knowledge/work-profile",
        "GET /api/knowledge/work-profile",
        "GET /api/knowledge/backend-status",
      ],
    );
    assert.equal(checks[1].body.department_name, "AI혁신과");
  }
}

runChecks();
console.log("smoke-bundled-sidecar checks passed");
