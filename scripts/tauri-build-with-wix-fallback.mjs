#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const wixSuppressedIces = ["ICE38", "ICE64", "ICE90", "ICE91"];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options,
  });
}

function readTauriConfig(root = repoRoot) {
  const configPath = path.join(root, "apps", "desktop", "src-tauri", "tauri.conf.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function resolveTauriCli(root = repoRoot) {
  return path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
}

function bundleTargetsIncludeMsi(config) {
  const targets = config.bundle?.targets ?? "all";
  if (targets === "all" || targets === "msi") {
    return true;
  }
  return Array.isArray(targets) && targets.includes("msi");
}

export function buildMsiOutputPath({
  root = repoRoot,
  profile = "release",
  productName,
  version,
  locale = "en-US",
} = {}) {
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
    "msi",
    `${productName}_${version}_x64_${locale}.msi`,
  );
}

export function resolveWixLightExe(localAppData = process.env.LOCALAPPDATA ?? "") {
  if (!localAppData) {
    throw new Error("LOCALAPPDATA is not set");
  }

  const tauriCacheRoot = path.win32.join(localAppData, "tauri");
  if (!fs.existsSync(tauriCacheRoot)) {
    throw new Error(`WiX cache root not found: ${tauriCacheRoot}`);
  }

  const candidates = fs
    .readdirSync(tauriCacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("WixTools"))
    .map((entry) => path.win32.join(tauriCacheRoot, entry.name, "light.exe"))
    .filter((candidate) => fs.existsSync(candidate))
    .sort();

  if (candidates.length === 0) {
    throw new Error("Unable to locate light.exe in the Tauri WiX cache");
  }

  return candidates[candidates.length - 1];
}

export function getWixArtifacts({ root = repoRoot, profile = "release" } = {}) {
  const wixRoot = path.join(root, "apps", "desktop", "src-tauri", "target", profile, "wix", "x64");
  return {
    wixRoot,
    localePath: path.join(wixRoot, "locale.wxl"),
    objectPath: path.join(wixRoot, "main.wixobj"),
    sourcePath: path.join(wixRoot, "main.wxs"),
  };
}

function ensureArtifacts(paths) {
  for (const candidate of [paths.localePath, paths.objectPath, paths.sourcePath]) {
    if (!fs.existsSync(candidate)) {
      throw new Error(`missing WiX artifact: ${candidate}`);
    }
  }
}

function ensureFreshArtifacts(paths, notOlderThanMs) {
  ensureArtifacts(paths);

  for (const candidate of [paths.localePath, paths.objectPath, paths.sourcePath]) {
    const { mtimeMs } = fs.statSync(candidate);
    if (mtimeMs < notOlderThanMs) {
      throw new Error(`stale WiX artifact: ${candidate}`);
    }
  }
}

export function manualLinkPerUserMsi({
  root = repoRoot,
  profile = "release",
  productName,
  version,
  locale = "en-US",
  localAppData = process.env.LOCALAPPDATA ?? "",
  notOlderThanMs,
} = {}) {
  const wixArtifacts = getWixArtifacts({ root, profile });
  if (typeof notOlderThanMs === "number") {
    ensureFreshArtifacts(wixArtifacts, notOlderThanMs);
  } else {
    ensureArtifacts(wixArtifacts);
  }

  const lightExe = resolveWixLightExe(localAppData);
  const outputPath = buildMsiOutputPath({ root, profile, productName, version, locale });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const lightArgs = [
    ...wixSuppressedIces.map((ice) => `-sice:${ice}`),
    "-ext",
    "WixUIExtension",
    "-cultures:en-us",
    "-loc",
    wixArtifacts.localePath,
    wixArtifacts.objectPath,
    "-o",
    outputPath,
  ];

  const result = run(lightExe, lightArgs);
  if (result.error || result.status !== 0) {
    throw new Error("manual WiX link fallback failed");
  }

  return outputPath;
}

export function main(argv = process.argv.slice(2)) {
  const debug = argv.includes("--debug");
  const config = readTauriConfig();
  const profile = debug ? "debug" : "release";
  const tauriArgs = [resolveTauriCli(), "build"];

  if (debug) {
    tauriArgs.push("--debug");
  }

  const tauriBuildStartedAt = Date.now();
  const tauriBuild = run(process.execPath, tauriArgs, { cwd: desktopRoot });
  if (!tauriBuild.error && tauriBuild.status === 0) {
    process.exit(0);
  }

  if (!bundleTargetsIncludeMsi(config)) {
    process.exit(tauriBuild.status ?? 1);
  }

  try {
    const outputPath = manualLinkPerUserMsi({
      profile,
      productName: config.productName,
      version: config.version,
      notOlderThanMs: tauriBuildStartedAt,
    });
    console.log(`manual WiX MSI fallback produced ${path.relative(repoRoot, outputPath)}`);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(tauriBuild.status ?? 1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
