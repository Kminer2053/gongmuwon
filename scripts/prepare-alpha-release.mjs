import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputRoot = path.join(repoRoot, "release", "alpha");
const bundleRoot = path.join(
  repoRoot,
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "release",
  "bundle",
);

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const desktopPackageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "apps", "desktop", "package.json"), "utf8"),
);
const tauriConfig = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "apps", "desktop", "src-tauri", "tauri.conf.json"), "utf8"),
);

const documentsToStage = [
  "services/sidecar/README.md",
  "docs/operations/2026-04-20-alpha-offline-packaging-runbook.md",
  "docs/operations/2026-04-20-sidecar-packaging-strategy.md",
];

fs.mkdirSync(outputRoot, { recursive: true });

for (const relativePath of documentsToStage) {
  const sourcePath = path.join(repoRoot, relativePath);
  const destinationPath = path.join(outputRoot, path.basename(relativePath));
  fs.copyFileSync(sourcePath, destinationPath);
}

const bundleTargets = fs.existsSync(bundleRoot)
  ? fs.readdirSync(bundleRoot).filter((entry) =>
      fs.statSync(path.join(bundleRoot, entry)).isDirectory(),
    )
  : [];

const manifest = {
  generated_at: new Date().toISOString(),
  product: {
    name: tauriConfig.productName,
    identifier: tauriConfig.identifier,
    version: tauriConfig.version,
  },
  scripts: {
    verify_all: packageJson.scripts["verify:all"],
    desktop_bundle: packageJson.scripts["desktop:bundle"],
    desktop_bundle_debug: packageJson.scripts["desktop:bundle:debug"],
  },
  desktop: {
    package_name: desktopPackageJson.name,
    bundle_root: path.relative(repoRoot, bundleRoot),
    bundle_targets: bundleTargets,
    bundle_ready: bundleTargets.length > 0,
  },
  sidecar: {
    package_name: "gongmu-sidecar",
    source_root: "services/sidecar",
    strategy_document: "2026-04-20-sidecar-packaging-strategy.md",
    recommended_windows_strategy: "PyInstaller one-folder bundle",
  },
  runtime: {
    workspace_root: "runtime-workspace",
    log_path: "runtime-workspace/logs/sidecar-runtime.log",
    sidecar_url: "http://127.0.0.1:8765",
  },
  staged_documents: documentsToStage.map((relativePath) => path.basename(relativePath)),
  next_checks: [
    "Windows host에서 npm run desktop:bundle 실행",
    "bundle 산출물과 staged 문서를 함께 반입 패키지로 묶기",
    "PyInstaller 기반 sidecar 독립 실행 파일 산출 검증",
  ],
};

fs.writeFileSync(
  path.join(outputRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

const summary = [
  "# Gongmu Alpha Release Staging",
  "",
  `- generated_at: ${manifest.generated_at}`,
  `- product: ${manifest.product.name} ${manifest.product.version}`,
  `- bundle_ready: ${manifest.desktop.bundle_ready ? "yes" : "no"}`,
  `- bundle_targets: ${manifest.desktop.bundle_targets.join(", ") || "(none)"}`,
  "",
  "## Included Documents",
  ...manifest.staged_documents.map((item) => `- ${item}`),
  "",
  "## Next Checks",
  ...manifest.next_checks.map((item) => `- ${item}`),
  "",
].join("\n");

fs.writeFileSync(path.join(outputRoot, "README.md"), summary, "utf8");

console.log(`prepared alpha release staging at ${path.relative(repoRoot, outputRoot)}`);
