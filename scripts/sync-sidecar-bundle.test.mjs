import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { syncSidecarBundle } from "./sync-sidecar-bundle.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gongmu-sync-sidecar-"));
try {
  const sourceRoot = path.join(tempRoot, "release", "sidecar", "windows-x64", "gongmu-sidecar");
  const destinationRoot = path.join(
    tempRoot,
    "apps",
    "desktop",
    "src-tauri",
    "resources",
    "sidecar",
    "windows-x64",
    "gongmu-sidecar",
  );

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "gongmu-sidecar.exe"), "fake exe", "utf8");
  fs.mkdirSync(path.join(tempRoot, "services", "sidecar", "src", "gongmu_sidecar"), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, "services", "sidecar", "src", "gongmu_sidecar", "app.py"),
    "def create_app(): pass\n",
    "utf8",
  );
  fs.mkdirSync(path.join(tempRoot, "services", "sidecar", "packaging"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "services", "sidecar", "packaging", "gongmu-sidecar.spec"), "# spec\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "services", "sidecar", "pyproject.toml"), "[project]\nname='x'\n", "utf8");

  const result = syncSidecarBundle({ repoRoot: tempRoot, sourceRoot, destinationRoot });
  const manifestPath = path.join(destinationRoot, "gongmu-sidecar.bundle-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(fs.existsSync(path.join(destinationRoot, "gongmu-sidecar.exe")), true);
  assert.equal(result.manifest.source_fingerprint.sha256, manifest.source_fingerprint.sha256);
  assert.ok(manifest.source_fingerprint.files.includes("services/sidecar/src/gongmu_sidecar/app.py"));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("sync-sidecar-bundle checks passed");
