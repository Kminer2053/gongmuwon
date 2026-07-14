#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.cwd();
const releaseRoot = path.join(repoRoot, "release", "alpha");
const docsRoot = path.join(repoRoot, "docs", "operations");
const sidecarRoot = path.join(repoRoot, "services", "sidecar");
const desktopBundleRoot = path.join(
  repoRoot,
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "release",
  "bundle",
);
const sidecarBundleRoot = path.join(
  repoRoot,
  "release",
  "sidecar",
  "windows-x64",
  "gongmu-sidecar",
);
export const stagedDocuments = [
  "services/sidecar/README.md",
  "docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md",
  "docs/operations/2026-04-20-alpha-offline-packaging-runbook.md",
  "docs/operations/2026-04-20-sidecar-packaging-strategy.md",
  "docs/operations/2026-04-20-windows-install-validation.md",
  "docs/operations/2026-04-20-windows-remote-validation-checklist.md",
  "docs/operations/2026-04-21-windows-sidecar-packaging-validation.md",
  "docs/operations/2026-04-21-windows-desktop-sidecar-integration-validation.md",
  "docs/operations/2026-04-22-windows-interactive-install-validation.md",
  "docs/operations/2026-04-23-anything-external-integration-validation.md",
  "docs/operations/2026-04-23-functional-validation-results.md",
  "docs/operations/2026-04-25-llm-chat-integration-validation.md",
];

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

export function resolveReleaseFileName(sourceRelativePath) {
  if (sourceRelativePath === "services/sidecar/README.md") {
    return "sidecar-README.md";
  }

  return path.basename(sourceRelativePath);
}

function copyFileIntoRelease(sourceRelativePath) {
  const sourcePath = path.join(repoRoot, sourceRelativePath);
  const destinationPath = path.join(releaseRoot, resolveReleaseFileName(sourceRelativePath));

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`missing staged document: ${sourceRelativePath}`);
  }

  fs.copyFileSync(sourcePath, destinationPath);
  return path.basename(destinationPath);
}

function listExistingChildren(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  return fs.readdirSync(targetPath).sort();
}

export function buildManifest() {
  const generatedAt = new Date().toISOString();
  const manifest = {
    generated_at: generatedAt,
    product: {
      name: "Gongmu",
      identifier: "kr.gongmu.workspace",
      version: "0.1.4",
    },
    scripts: {
      verify_all: "npm run verify:all",
      desktop_bundle: "npm run desktop:bundle",
      desktop_bundle_debug: "npm run desktop:bundle:debug",
      desktop_smoke_msi: "npm run desktop:smoke:msi",
      desktop_smoke_nsis: "npm run desktop:smoke:nsis",
      desktop_prepare_anything: "npm run desktop:prepare:anything",
      sidecar_bundle_windows: "npm run sidecar:bundle:windows",
    },
    desktop: {
      package_name: "@gongmu/desktop",
      bundle_root: path.relative(repoRoot, desktopBundleRoot),
      bundle_targets: listExistingChildren(desktopBundleRoot),
      bundle_ready: fs.existsSync(desktopBundleRoot),
    },
    sidecar: {
      package_name: "gongmu-sidecar",
      source_root: path.relative(repoRoot, sidecarRoot),
      bundle_root: path.relative(repoRoot, sidecarBundleRoot),
      bundle_ready: fs.existsSync(path.join(sidecarBundleRoot, "gongmu-sidecar.exe")),
      strategy_document: "2026-04-20-sidecar-packaging-strategy.md",
      validation_document: "2026-04-21-windows-sidecar-packaging-validation.md",
      recommended_windows_strategy: "PyInstaller one-folder bundle",
    },
    runtime: {
      workspace_root: "runtime-workspace",
      log_path: "runtime-workspace/logs/sidecar-runtime.log",
      sidecar_url: "http://127.0.0.1:8765",
    },
    staged_documents: stagedDocuments.map((sourcePath) => resolveReleaseFileName(sourcePath)),
    next_checks: [
      "Run npm run verify:all before final release sign-off.",
      "Run npm run desktop:bundle when installer artifacts need to be refreshed.",
      "Run npm run desktop:prepare:gui before a human GUI install pass on Windows.",
      "Run npm run desktop:prepare:anything before Anything external-integration checks.",
      "Run npm run desktop:smoke:msi after MSI-affecting changes on Windows.",
      "Run npm run desktop:smoke:nsis after NSIS-affecting changes on Windows.",
      "Confirm NSIS installer smoke test with bundled sidecar on the target Windows host.",
      "Use the Windows remote validation checklist for the manual GUI lane and close the desktop app before uninstall.",
      "Use MSI install-and-uninstall smoke checks instead of administrative extraction when payload proof is needed.",
      "Review the latest Anything-to-Documents handoff evidence in the checkpoint board.",
      "Review the Anything external integration validation note before release sign-off.",
      "Review the latest functional validation results before changing IA or workflow behavior.",
    ],
  };

  return manifest;
}

export function buildReadme(manifest) {
  const lines = [
    "# Gongmu Alpha Release Staging",
    "",
    `- generated_at: ${manifest.generated_at}`,
    `- product: ${manifest.product.name} ${manifest.product.version}`,
    `- desktop_bundle_ready: ${manifest.desktop.bundle_ready ? "yes" : "no"}`,
    `- sidecar_bundle_ready: ${manifest.sidecar.bundle_ready ? "yes" : "no"}`,
    `- desktop_bundle_targets: ${manifest.desktop.bundle_targets.join(", ") || "none"}`,
    "",
    "## Included Documents",
    ...manifest.staged_documents.map((documentName) => `- ${documentName}`),
    "",
    "## Commands",
    `- verify_all: ${manifest.scripts.verify_all}`,
    `- desktop_bundle: ${manifest.scripts.desktop_bundle}`,
    `- desktop_bundle_debug: ${manifest.scripts.desktop_bundle_debug}`,
    `- desktop_smoke_msi: ${manifest.scripts.desktop_smoke_msi}`,
    `- desktop_smoke_nsis: ${manifest.scripts.desktop_smoke_nsis}`,
    `- desktop_prepare_anything: ${manifest.scripts.desktop_prepare_anything}`,
    `- sidecar_bundle_windows: ${manifest.scripts.sidecar_bundle_windows}`,
    "",
    "## Bundle Paths",
    `- desktop: ${manifest.desktop.bundle_root}`,
    `- sidecar: ${manifest.sidecar.bundle_root}`,
    "",
    "## Next Checks",
    ...manifest.next_checks.map((item) => `- ${item}`),
    "",
  ];

  return lines.join("\n");
}

export function prepareAlphaRelease() {
  fs.rmSync(releaseRoot, { recursive: true, force: true });
  ensureDir(releaseRoot);

  for (const sourceRelativePath of stagedDocuments) {
    copyFileIntoRelease(sourceRelativePath);
  }

  const manifest = buildManifest();
  const manifestPath = path.join(releaseRoot, "manifest.json");
  const readmePath = path.join(releaseRoot, "README.md");

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(readmePath, buildReadme(manifest));

  console.log(`prepared alpha release staging in ${path.relative(repoRoot, releaseRoot)}`);
}

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  prepareAlphaRelease();
}
