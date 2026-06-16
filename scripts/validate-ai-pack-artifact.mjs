import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT_JSON = "docs/operations/generated/ai-pack-artifact-validation.json";
const DEFAULT_OUT_MARKDOWN = "docs/operations/generated/ai-pack-artifact-validation.md";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function listFiles(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function findLatestPackageDir(repoRoot) {
  const root = join(repoRoot, "release", "ai-pack");
  const entries = await listFiles(root);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (!entry.name.startsWith("Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_")) {
      continue;
    }
    const fullPath = join(root, entry.name);
    candidates.push({ path: fullPath, mtimeMs: (await stat(fullPath)).mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path ?? null;
}

async function findFirstFileBySuffix(dir, suffix) {
  const entries = await listFiles(dir);
  const hit = entries.find((entry) => entry.isFile() && entry.name.endsWith(suffix));
  return hit ? join(dir, hit.name) : null;
}

async function sha256(path) {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex").toUpperCase()));
  });
}

function runCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function runLauncherDryRun(batchPath, packageDir) {
  if (process.platform !== "win32") {
    return {
      skipped: true,
      ok: true,
      reason: "Launcher dry-run is only executed on Windows.",
    };
  }
  return runCommand("cmd.exe", ["/c", batchPath], {
    cwd: packageDir,
    env: { ...process.env, GONGMU_AI_PACK_DRY_RUN: "1" },
  });
}

function escapePowerShellLiteral(path) {
  return path.replace(/'/g, "''");
}

function parsePowerShellScript(scriptPath, packageDir) {
  if (process.platform !== "win32") {
    return {
      skipped: true,
      ok: true,
      reason: "PowerShell syntax parse is only executed on Windows.",
    };
  }
  const literal = escapePowerShellLiteral(scriptPath);
  return runCommand(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `[scriptblock]::Create((Get-Content -Raw -LiteralPath '${literal}')) | Out-Null`,
    ],
    { cwd: packageDir, env: process.env },
  );
}

function checkManifest(manifest) {
  const checks = [
    {
      name: "app installer included",
      ok: manifest.app?.installerIncluded === true,
    },
    {
      name: "Python installer included",
      ok: manifest.python?.installerIncluded === true,
    },
    {
      name: "bundled app does not require system Python",
      ok: manifest.python?.requiredForBundledApp === false,
    },
    {
      name: "Ollama installer included",
      ok: manifest.ollama?.installerIncluded === true,
    },
    {
      name: "Gemma 4 E2B model selected",
      ok: manifest.model?.name === "gemma4:e2b",
    },
    {
      name: "model marked multimodal",
      ok: manifest.model?.multimodal === true,
    },
    {
      name: "model store embedded",
      ok: manifest.model?.embedded === true,
    },
  ];
  return checks;
}

async function buildMarkdown(report) {
  const failed = report.checks.filter((check) => !check.ok);
  const requiredMissing = report.requiredFiles.filter((item) => !item.present);
  return `# AI pack artifact validation

- createdAt: ${report.createdAt}
- ready: ${report.ready}
- packageDir: \`${report.packageDir}\`
- zipPath: \`${report.zip.path ?? ""}\`
- zipSizeBytes: ${report.zip.sizeBytes}
- zipSha256: ${report.zip.sha256 ?? ""}
- model: ${report.manifest.model.name}
- multimodal: ${report.manifest.model.multimodal}
- embeddedModelStore: ${report.manifest.model.embedded}

## 필수 파일

${report.requiredFiles
  .map((item) => `- ${item.present ? "PASS" : "FAIL"} ${item.label}: \`${item.relativePath}\``)
  .join("\n")}

## 모델 저장소

- manifest: ${report.modelStore.hasManifest ? "PASS" : "FAIL"}
- blobCount: ${report.modelStore.blobCount}
- blobBytes: ${report.modelStore.blobBytes}

## 런처/스크립트 검증

- START_INSTALL.bat dry-run: ${report.launchers.startInstall.dryRun?.ok ?? "not-run"}
- VALIDATE_INSTALL.bat dry-run: ${report.launchers.validateInstall.dryRun?.ok ?? "not-run"}
- COLLECT_EVIDENCE.bat dry-run: ${report.launchers.collectEvidence.dryRun?.ok ?? "not-run"}
- RUN_FULL_VALIDATION.bat dry-run: ${report.launchers.fullValidation.dryRun?.ok ?? "not-run"}
- install-gongmu-ai.ps1 parse: ${report.powerShell.install?.ok ?? "not-run"}
- validate-gongmu-ai.ps1 parse: ${report.powerShell.validate?.ok ?? "not-run"}
- collect-clean-account-evidence.ps1 parse: ${report.powerShell.collect?.ok ?? "not-run"}

## 실패 항목

${failed.length === 0 && requiredMissing.length === 0 ? "- 없음" : ""}
${failed.map((check) => `- ${check.name}`).join("\n")}
${requiredMissing.map((item) => `- missing ${item.relativePath}`).join("\n")}
`;
}

export async function validateAiPackArtifact(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
  const packageDir = resolve(options.packageDir ?? (await findLatestPackageDir(repoRoot)) ?? "");
  const zipPath = options.zipPath === null ? null : resolve(options.zipPath ?? `${packageDir}.zip`);
  const outJson = resolve(repoRoot, options.outJson ?? DEFAULT_OUT_JSON);
  const outMarkdown = resolve(repoRoot, options.outMarkdown ?? DEFAULT_OUT_MARKDOWN);
  const errors = [];

  if (!packageDir || !(await exists(packageDir))) {
    throw new Error(`AI pack package directory not found: ${packageDir || "(none)"}`);
  }

  const manifestPath = join(packageDir, "manifest.json");
  if (!(await exists(manifestPath))) {
    throw new Error(`manifest.json not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const appInstaller = await findFirstFileBySuffix(join(packageDir, "gongmu"), ".exe");
  const modelManifest = join(packageDir, "models", "manifests", "registry.ollama.ai", "library", "gemma4", "e2b");
  const modelBlobsDir = join(packageDir, "models", "blobs");
  const blobEntries = (await listFiles(modelBlobsDir)).filter((entry) => entry.isFile());
  let blobBytes = 0;
  for (const entry of blobEntries) {
    blobBytes += await fileSize(join(modelBlobsDir, entry.name));
  }

  const required = [
    ["manifest", "manifest.json", manifestPath],
    ["readme", "README.md", join(packageDir, "README.md")],
    ["third party notices", "THIRD_PARTY_NOTICES.md", join(packageDir, "THIRD_PARTY_NOTICES.md")],
    ["sha256 sums", "SHA256SUMS.txt", join(packageDir, "SHA256SUMS.txt")],
    ["start launcher", "START_INSTALL.bat", join(packageDir, "START_INSTALL.bat")],
    ["validate launcher", "VALIDATE_INSTALL.bat", join(packageDir, "VALIDATE_INSTALL.bat")],
    ["evidence launcher", "COLLECT_EVIDENCE.bat", join(packageDir, "COLLECT_EVIDENCE.bat")],
    ["full validation launcher", "RUN_FULL_VALIDATION.bat", join(packageDir, "RUN_FULL_VALIDATION.bat")],
    ["install script", "install-gongmu-ai.ps1", join(packageDir, "install-gongmu-ai.ps1")],
    ["validate script", "validate-gongmu-ai.ps1", join(packageDir, "validate-gongmu-ai.ps1")],
    ["evidence script", "collect-clean-account-evidence.ps1", join(packageDir, "collect-clean-account-evidence.ps1")],
    ["app installer", appInstaller ? appInstaller.slice(packageDir.length + 1) : "gongmu/*.exe", appInstaller],
    ["Ollama installer", "ollama/OllamaSetup.exe", join(packageDir, "ollama", "OllamaSetup.exe")],
    ["Python 3.11 installer", "python/python-3.11.9-amd64.exe", join(packageDir, "python", "python-3.11.9-amd64.exe")],
    ["Gemma model manifest", "models/manifests/registry.ollama.ai/library/gemma4/e2b", modelManifest],
  ];

  const requiredFiles = [];
  for (const [label, relativePath, path] of required) {
    const present = Boolean(path) && (await exists(path));
    requiredFiles.push({ label, relativePath, path, present });
    if (!present) {
      errors.push(`Missing required file: ${relativePath}`);
    }
  }

  const checks = checkManifest(manifest);
  for (const check of checks) {
    if (!check.ok) {
      errors.push(`Manifest check failed: ${check.name}`);
    }
  }

  const zipPresent = Boolean(zipPath) && (await exists(zipPath));
  const zipSizeBytes = zipPresent ? await fileSize(zipPath) : 0;
  const minZipBytes = Number(options.minZipBytes ?? 1);
  if (options.requireZip && !zipPresent) {
    errors.push(`Missing zip artifact: ${zipPath}`);
  }
  if (options.requireZip && zipPresent && zipSizeBytes < minZipBytes) {
    errors.push(`Zip artifact is too small: ${zipSizeBytes} < ${minZipBytes}`);
  }

  const startLauncher = join(packageDir, "START_INSTALL.bat");
  const validateLauncher = join(packageDir, "VALIDATE_INSTALL.bat");
  const collectLauncher = join(packageDir, "COLLECT_EVIDENCE.bat");
  const fullValidationLauncher = join(packageDir, "RUN_FULL_VALIDATION.bat");
  const installPs = join(packageDir, "install-gongmu-ai.ps1");
  const validatePs = join(packageDir, "validate-gongmu-ai.ps1");
  const collectPs = join(packageDir, "collect-clean-account-evidence.ps1");

  const launchers = {
    startInstall: {
      path: startLauncher,
      present: await exists(startLauncher),
      dryRun: options.runLauncherDryRun ? runLauncherDryRun(startLauncher, packageDir) : null,
    },
    validateInstall: {
      path: validateLauncher,
      present: await exists(validateLauncher),
      dryRun: options.runLauncherDryRun ? runLauncherDryRun(validateLauncher, packageDir) : null,
    },
    collectEvidence: {
      path: collectLauncher,
      present: await exists(collectLauncher),
      dryRun: options.runLauncherDryRun ? runLauncherDryRun(collectLauncher, packageDir) : null,
    },
    fullValidation: {
      path: fullValidationLauncher,
      present: await exists(fullValidationLauncher),
      dryRun: options.runLauncherDryRun ? runLauncherDryRun(fullValidationLauncher, packageDir) : null,
    },
  };

  if (launchers.startInstall.dryRun && !launchers.startInstall.dryRun.ok) {
    errors.push("START_INSTALL.bat dry-run failed");
  }
  if (launchers.validateInstall.dryRun && !launchers.validateInstall.dryRun.ok) {
    errors.push("VALIDATE_INSTALL.bat dry-run failed");
  }
  if (launchers.collectEvidence.dryRun && !launchers.collectEvidence.dryRun.ok) {
    errors.push("COLLECT_EVIDENCE.bat dry-run failed");
  }
  if (launchers.fullValidation.dryRun && !launchers.fullValidation.dryRun.ok) {
    errors.push("RUN_FULL_VALIDATION.bat dry-run failed");
  }

  const powerShell = {
    install: options.parsePowerShell ? parsePowerShellScript(installPs, packageDir) : null,
    validate: options.parsePowerShell ? parsePowerShellScript(validatePs, packageDir) : null,
    collect: options.parsePowerShell ? parsePowerShellScript(collectPs, packageDir) : null,
  };
  if (powerShell.install && !powerShell.install.ok) {
    errors.push("install-gongmu-ai.ps1 PowerShell parse failed");
  }
  if (powerShell.validate && !powerShell.validate.ok) {
    errors.push("validate-gongmu-ai.ps1 PowerShell parse failed");
  }
  if (powerShell.collect && !powerShell.collect.ok) {
    errors.push("collect-clean-account-evidence.ps1 PowerShell parse failed");
  }

  const zipHash = options.hashZip && zipPresent ? await sha256(zipPath) : null;
  const appInstallerHash = appInstaller && options.hashPrimaryFiles ? await sha256(appInstaller) : null;

  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    ready: errors.length === 0,
    packageDir,
    manifest,
    checks,
    requiredFiles,
    modelStore: {
      manifestPath: modelManifest,
      hasManifest: await exists(modelManifest),
      blobCount: blobEntries.length,
      blobBytes,
    },
    zip: {
      path: zipPath,
      present: zipPresent,
      sizeBytes: zipSizeBytes,
      sha256: zipHash,
    },
    hashes: {
      appInstallerSha256: appInstallerHash,
    },
    launchers,
    powerShell,
    errors,
  };

  await mkdir(dirname(outJson), { recursive: true });
  await writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(outMarkdown, await buildMarkdown(report), "utf8");

  return report;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--package-dir") args.packageDir = argv[++i];
    else if (arg === "--zip") args.zipPath = argv[++i];
    else if (arg === "--out") args.outJson = argv[++i];
    else if (arg === "--markdown") args.outMarkdown = argv[++i];
    else if (arg === "--require-zip") args.requireZip = true;
    else if (arg === "--min-zip-bytes") args.minZipBytes = Number(argv[++i]);
    else if (arg === "--run-launcher-dry-run") args.runLauncherDryRun = true;
    else if (arg === "--parse-powershell") args.parsePowerShell = true;
    else if (arg === "--hash-zip") args.hashZip = true;
    else if (arg === "--hash-primary-files") args.hashPrimaryFiles = true;
    else if (arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/validate-ai-pack-artifact.mjs [options]

Options:
  --package-dir <dir>          AI pack directory. Defaults to latest release/ai-pack folder.
  --zip <path>                 AI pack zip path. Defaults to <package-dir>.zip.
  --out <path>                 JSON report path.
  --markdown <path>            Markdown report path.
  --require-zip                Fail when zip artifact is missing.
  --min-zip-bytes <bytes>      Minimum zip size when --require-zip is used.
  --run-launcher-dry-run       Execute START/VALIDATE launchers with GONGMU_AI_PACK_DRY_RUN=1.
  --parse-powershell           Parse generated PowerShell scripts.
  --hash-zip                   Calculate SHA256 for the zip. Slow for full model packs.
  --hash-primary-files         Calculate SHA256 for app installer.
`);
    return;
  }
  const report = await validateAiPackArtifact(args);
  console.log(JSON.stringify({ ready: report.ready, errors: report.errors }, null, 2));
  if (!report.ready) {
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
