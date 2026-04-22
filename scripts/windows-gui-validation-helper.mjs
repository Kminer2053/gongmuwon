#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

function readTauriConfig(root = repoRoot) {
  const configPath = path.join(root, "apps", "desktop", "src-tauri", "tauri.conf.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

export function buildNsisBundlePath({ root = repoRoot, profile = "release", productName, version }) {
  if (!productName || !version) {
    throw new Error("productName and version are required");
  }

  return path.join(
    root,
    "apps",
    "desktop",
    "src-tauri",
    "target",
    profile,
    "bundle",
    "nsis",
    `${productName}_${version}_x64-setup.exe`,
  );
}

export function buildGuiValidationPlan({
  root = repoRoot,
  stamp = timestamp(),
  productName,
  version,
}) {
  const installerPath = buildNsisBundlePath({ root, profile: "release", productName, version });
  const installDir = path.join(root, "runtime-workspace", "cache", `nsis-gui-install-${stamp}`);
  const workspaceRoot = path.join(root, "runtime-workspace", "cache", `nsis-gui-workspace-${stamp}`);
  const desktopExe = path.join(installDir, "gongmu-desktop.exe");
  const bundledSidecarExe = path.join(
    installDir,
    "resources",
    "sidecar",
    "windows-x64",
    "gongmu-sidecar",
    "gongmu-sidecar.exe",
  );

  return {
    installerPath,
    installDir,
    workspaceRoot,
    desktopExe,
    bundledSidecarExe,
    manualChecks: [
      "Complete the NSIS wizard with the suggested install directory.",
      "Launch the installed desktop app and confirm the window becomes visible.",
      "Confirm the bundled sidecar tree exists under resources\\sidecar\\windows-x64\\gongmu-sidecar.",
      "Run the uninstaller and confirm the install directory is removed.",
    ],
  };
}

export function printGuiValidationPlan(plan) {
  console.log("# Windows GUI Validation Helper");
  console.log("");
  console.log(`installer_path: ${plan.installerPath}`);
  console.log(`suggested_install_dir: ${plan.installDir}`);
  console.log(`suggested_workspace_root: ${plan.workspaceRoot}`);
  console.log(`desktop_exe: ${plan.desktopExe}`);
  console.log(`bundled_sidecar_exe: ${plan.bundledSidecarExe}`);
  console.log("");
  console.log("manual_checks:");
  for (const item of plan.manualChecks) {
    console.log(`- ${item}`);
  }
}

function main() {
  const config = readTauriConfig();
  const plan = buildGuiValidationPlan({
    root: repoRoot,
    productName: config.productName,
    version: config.version,
  });
  printGuiValidationPlan(plan);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
