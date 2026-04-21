#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, "release", "sidecar", "windows-x64", "gongmu-sidecar");
const destinationRoot = path.join(
  repoRoot,
  "apps",
  "desktop",
  "src-tauri",
  "resources",
  "sidecar",
  "windows-x64",
  "gongmu-sidecar",
);

if (!fs.existsSync(sourceRoot)) {
  console.error(`sidecar bundle not found: ${sourceRoot}`);
  process.exit(1);
}

fs.rmSync(destinationRoot, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destinationRoot), { recursive: true });
fs.cpSync(sourceRoot, destinationRoot, { recursive: true });

console.log(`synced sidecar bundle to ${path.relative(repoRoot, destinationRoot)}`);
