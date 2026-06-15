import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildSidecarBundleManifest,
  collectNewestFileMtime,
  computeSourceFingerprint,
  evaluateSidecarBundleFreshness,
  parseFreshnessArgs,
  writeFreshnessReport,
} from "./check-sidecar-bundle-freshness.mjs";

function withTempDir(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gongmu-sidecar-freshness-"));
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeFileWithMtime(filePath, mtime) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "x", "utf8");
  fs.utimesSync(filePath, mtime, mtime);
}

withTempDir((tempRoot) => {
  const sourceDir = path.join(tempRoot, "services", "sidecar", "src");
  const exePath = path.join(tempRoot, "apps", "desktop", "src-tauri", "resources", "sidecar", "gongmu-sidecar.exe");
  const manifestPath = path.join(path.dirname(exePath), "gongmu-sidecar.bundle-manifest.json");
  const oldTime = new Date("2026-01-01T00:00:00.000Z");
  const newTime = new Date("2026-06-01T00:00:00.000Z");

  writeFileWithMtime(path.join(sourceDir, "gongmu_sidecar", "app.py"), newTime);
  writeFileWithMtime(path.join(sourceDir, "gongmu_sidecar", "db.py"), oldTime);
  writeFileWithMtime(exePath, oldTime);

  const newest = collectNewestFileMtime(sourceDir, [".py"]);
  assert.equal(newest.relativePath.replaceAll("\\", "/"), "gongmu_sidecar/app.py");
  const fingerprint = computeSourceFingerprint(sourceDir, [".py"]);
  assert.equal(fingerprint.files.length, 2);
  assert.match(fingerprint.sha256, /^[a-f0-9]{64}$/);

  const stale = evaluateSidecarBundleFreshness({
    sourceDir,
    executable: exePath,
    manifestPath,
    extensions: [".py"],
  });
  assert.equal(stale.status, "stale");
  assert.match(stale.reason, /newer than bundled sidecar/);

  fs.utimesSync(exePath, newTime, newTime);
  const missingManifest = evaluateSidecarBundleFreshness({
    sourceDir,
    executable: exePath,
    manifestPath,
    extensions: [".py"],
  });
  assert.equal(missingManifest.status, "missing-manifest");

  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      buildSidecarBundleManifest({
        sourceFingerprint: fingerprint,
        executable: exePath,
        generatedAt: "2026-06-01T00:00:00.000Z",
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
  const fresh = evaluateSidecarBundleFreshness({
    sourceDir,
    executable: exePath,
    manifestPath,
    extensions: [".py"],
  });
  assert.equal(fresh.status, "fresh");
  assert.equal(fresh.manifest.source_fingerprint.sha256, fingerprint.sha256);
});

{
  const args = parseFreshnessArgs([
    "--source",
    "src",
    "--exe",
    "sidecar.exe",
    "--manifest",
    "manifest.json",
    "--out",
    "freshness.json",
    "--ext",
    ".py,.toml",
  ]);
  assert.equal(args.sourceDir, "src");
  assert.equal(args.executable, "sidecar.exe");
  assert.equal(args.manifestPath, "manifest.json");
  assert.equal(args.outPath, "freshness.json");
  assert.deepEqual(args.extensions, [".py", ".toml"]);
}

withTempDir((tempRoot) => {
  const outPath = path.join(tempRoot, "generated", "freshness.json");
  const report = writeFreshnessReport(
    {
      status: "stale",
      reason: "regenerate sidecar bundle",
    },
    outPath,
  );
  const written = JSON.parse(fs.readFileSync(outPath, "utf8"));

  assert.equal(report.status, "stale");
  assert.equal(written.status, "stale");
  assert.match(written.generated_at, /^\d{4}-\d{2}-\d{2}T/);
});

console.log("check-sidecar-bundle-freshness checks passed");
