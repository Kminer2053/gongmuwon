#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSidecarBundleManifest } from "./check-sidecar-bundle-freshness.mjs";

const scriptPath = fileURLToPath(import.meta.url);

function defaultSourceRoot(repoRoot) {
  return path.join(repoRoot, "release", "sidecar", "windows-x64", "gongmu-sidecar");
}

function defaultDestinationRoot(repoRoot) {
  return path.join(
    repoRoot,
    "apps",
    "desktop",
    "src-tauri",
    "resources",
    "sidecar",
    "windows-x64",
    "gongmu-sidecar",
  );
}

export function syncSidecarBundle({
  repoRoot = process.cwd(),
  sourceRoot = defaultSourceRoot(repoRoot),
  destinationRoot = defaultDestinationRoot(repoRoot),
} = {}) {
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`sidecar bundle not found: ${sourceRoot}`);
  }

  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destinationRoot), { recursive: true });
  fs.cpSync(sourceRoot, destinationRoot, { recursive: true });
  const manifest = writeSidecarBundleManifest({
    repoRoot,
    manifestPath: path.join(destinationRoot, "gongmu-sidecar.bundle-manifest.json"),
    executable: path.join(destinationRoot, "gongmu-sidecar.exe"),
  });

  return {
    destinationRoot,
    manifest,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const repoRoot = process.cwd();
    const result = syncSidecarBundle({ repoRoot });
    console.log(`synced sidecar bundle to ${path.relative(repoRoot, result.destinationRoot)}`);
    console.log(`sidecar source fingerprint ${result.manifest.source_fingerprint.sha256}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
