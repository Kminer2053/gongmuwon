#!/usr/bin/env node
import { accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

function defaultProbeCommand(command, args = ["--version"]) {
  const probe = spawnSync(command, args, { stdio: "ignore" });
  return {
    ok: !probe.error && probe.status === 0,
  };
}

function isExecutable(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function run(command, commandArgs, cwd = repoRoot) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

function getVenvPythonCandidates(root, platform) {
  if (platform === "win32") {
    return [path.win32.join(root, ".venv", "Scripts", "python.exe")];
  }

  return [path.join(root, ".venv", "bin", "python")];
}

function getWindowsInstalledPythonCandidates(localAppData) {
  if (!localAppData) {
    return [];
  }

  return [
    path.win32.join(localAppData, "Programs", "Python", "Python311", "python.exe"),
    path.win32.join(localAppData, "Programs", "Python", "Python310", "python.exe"),
    path.win32.join(localAppData, "Programs", "Python", "Python313", "python.exe"),
  ];
}

export function resolvePython({
  repoRoot: root = repoRoot,
  platform = process.platform,
  isExecutable: executableCheck = isExecutable,
  probeCommand = defaultProbeCommand,
  localAppData = process.env.LOCALAPPDATA ?? "",
} = {}) {
  for (const candidate of getVenvPythonCandidates(root, platform)) {
    if (executableCheck(candidate) && probeCommand(candidate).ok) {
      return candidate;
    }
  }

  if (platform === "win32") {
    for (const candidate of getWindowsInstalledPythonCandidates(localAppData)) {
      if (executableCheck(candidate)) {
        return candidate;
      }
    }
  }

  const pythonCandidates =
    platform === "win32" ? ["python.exe", "python", "py.exe", "py"] : ["python3", "python"];

  for (const candidate of pythonCandidates) {
    const probe = probeCommand(candidate);
    if (probe.ok) {
      return candidate;
    }
  }

  throw new Error("Unable to resolve python executable");
}

export function resolveCargo({
  platform = process.platform,
  probeCommand = defaultProbeCommand,
  isExecutable: executableCheck = isExecutable,
  homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "",
} = {}) {
  const systemCandidates = platform === "win32" ? ["cargo.exe", "cargo"] : ["cargo"];

  for (const candidate of systemCandidates) {
    const probe = probeCommand(candidate);
    if (probe.ok) {
      return candidate;
    }
  }

  const homeCargo =
    platform === "win32"
      ? path.win32.join(homeDir, ".cargo", "bin", "cargo.exe")
      : path.join(homeDir, ".cargo", "bin", "cargo");

  if (executableCheck(homeCargo)) {
    return homeCargo;
  }

  throw new Error("Unable to resolve cargo executable");
}

export function resolveCommand(
  kind,
  {
    repoRoot: root = repoRoot,
    platform = process.platform,
    homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "",
    localAppData = process.env.LOCALAPPDATA ?? "",
    isExecutable: executableCheck = isExecutable,
    probeCommand = defaultProbeCommand,
  } = {},
) {
  if (kind === "python") {
    return resolvePython({
      repoRoot: root,
      platform,
      isExecutable: executableCheck,
      probeCommand,
      localAppData,
    });
  }

  if (kind === "cargo") {
    return resolveCargo({
      platform,
      probeCommand,
      isExecutable: executableCheck,
      homeDir,
    });
  }

  throw new Error(`unsupported kind: ${kind}`);
}

export function main(argv = process.argv.slice(2)) {
  const [kind, ...args] = argv;

  if (!kind) {
    console.error("usage: portable-run.mjs <python|cargo> [args...]");
    process.exit(1);
  }

  try {
    run(resolveCommand(kind), args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
