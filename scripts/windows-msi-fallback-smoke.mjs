#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { spawn, spawnSync } from "node:child_process";

import { buildMsiOutputPath } from "./tauri-build-with-wix-fallback.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const gongmuRegistryKey = "HKCU\\Software\\gongmu\\Gongmu";

function readTauriConfig(root = repoRoot) {
  const configPath = path.join(root, "apps", "desktop", "src-tauri", "tauri.conf.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

export function buildSmokePaths({ root = repoRoot, stamp }) {
  const cacheRoot = path.join(root, "runtime-workspace", "cache");
  return {
    cacheRoot,
    installDir: path.join(cacheRoot, `msi-smoke-install-${stamp}`),
    workspaceRoot: path.join(cacheRoot, `msi-smoke-workspace-${stamp}`),
    installLogPath: path.join(cacheRoot, `msi-smoke-install-${stamp}.log`),
    uninstallLogPath: path.join(cacheRoot, `msi-smoke-uninstall-${stamp}.log`),
    stdoutLogPath: path.join(cacheRoot, `msi-smoke-sidecar-${stamp}.out.log`),
    stderrLogPath: path.join(cacheRoot, `msi-smoke-sidecar-${stamp}.err.log`),
  };
}

export function listFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(candidate);
      } else {
        files.push(candidate);
      }
    }
  }

  files.sort();
  return files;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

function ensureRemoved(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function runMsiexec(args, acceptedStatuses = [0]) {
  const result = spawnSync("msiexec.exe", args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  const status = result.status ?? 1;
  if (!acceptedStatuses.includes(status)) {
    throw new Error(`msiexec failed with status ${status}`);
  }
}

function runCommand(command, args, acceptedStatuses = [0]) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  const status = result.status ?? 1;
  if (!acceptedStatuses.includes(status)) {
    throw new Error(`${command} failed with status ${status}`);
  }

  return result.stdout;
}

export function parseInstallDirOutput(output) {
  for (const line of output.split(/\r?\n/)) {
    if (line.includes("InstallDir") && line.includes("REG_SZ")) {
      const parts = line.trim().split(/\s{2,}/);
      return parts.at(-1)?.trim() ?? null;
    }
  }

  return null;
}

function clearInstallRegistryHints() {
  runCommand("reg", ["delete", gongmuRegistryKey, "/f"], [0, 1]);
}

function resolveInstalledDirectory(preferredPath) {
  if (fs.existsSync(path.join(preferredPath, "gongmu-desktop.exe"))) {
    return preferredPath;
  }

  const queryOutput = runCommand("reg", ["query", gongmuRegistryKey, "/v", "InstallDir"], [0, 1]);
  const registryPath = parseInstallDirOutput(queryOutput);
  if (registryPath) {
    const normalized = path.resolve(registryPath);
    if (fs.existsSync(path.join(normalized, "gongmu-desktop.exe"))) {
      return normalized;
    }
  }

  return preferredPath;
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("unable to reserve port")));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "health check did not start";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      lastError = `health returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }

  throw new Error(lastError);
}

function assertExists(candidate, label) {
  if (!fs.existsSync(candidate)) {
    throw new Error(`${label} not found: ${candidate}`);
  }
}

async function launchSidecarAndCheck(sidecarPath, { workspaceRoot, stdoutLogPath, stderrLogPath }) {
  const port = await reservePort();
  const stdoutFd = fs.openSync(stdoutLogPath, "a");
  const stderrFd = fs.openSync(stderrLogPath, "a");

  const child = spawn(sidecarPath, [], {
    cwd: path.dirname(path.dirname(path.dirname(path.dirname(sidecarPath)))),
    env: {
      ...process.env,
      GONGMU_WORKSPACE_ROOT: workspaceRoot,
      GONGMU_SIDECAR_HOST: "127.0.0.1",
      GONGMU_SIDECAR_PORT: String(port),
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["ignore", stdoutFd, stderrFd],
  });

  try {
    const payload = await waitForHealth(`http://127.0.0.1:${port}/health`);
    return { payload, port };
  } finally {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    await delay(500);
    if (!child.killed && child.exitCode === null) {
      child.kill("SIGKILL");
    }
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

export async function main() {
  const config = readTauriConfig();
  const msiPath = buildMsiOutputPath({
    root: repoRoot,
    profile: "release",
    productName: config.productName,
    version: config.version,
  });
  const stamp = timestamp();
  const paths = buildSmokePaths({ stamp });

  assertExists(msiPath, "msi bundle");

  ensureDir(paths.cacheRoot);
  ensureRemoved(paths.installDir);
  ensureRemoved(paths.workspaceRoot);
  for (const logPath of [
    paths.installLogPath,
    paths.uninstallLogPath,
    paths.stdoutLogPath,
    paths.stderrLogPath,
  ]) {
    ensureRemoved(logPath);
  }

  clearInstallRegistryHints();
  runMsiexec(["/x", msiPath, "/qn", "/L*V", paths.uninstallLogPath], [0, 1605, 1614]);
  runMsiexec(
    ["/i", msiPath, "/qn", "MSIINSTALLPERUSER=1", `INSTALLDIR=${paths.installDir}`, "/L*V", paths.installLogPath],
    [0],
  );

  const actualInstallDir = resolveInstalledDirectory(paths.installDir);
  const desktopExe = path.join(actualInstallDir, "gongmu-desktop.exe");
  const sidecarExe = path.join(
    actualInstallDir,
    "resources",
    "sidecar",
    "windows-x64",
    "gongmu-sidecar",
    "gongmu-sidecar.exe",
  );

  assertExists(desktopExe, "desktop executable");
  assertExists(sidecarExe, "bundled sidecar executable");

  ensureDir(paths.workspaceRoot);
  const health = await launchSidecarAndCheck(sidecarExe, paths);

  runMsiexec(["/x", msiPath, "/qn", "/L*V", paths.uninstallLogPath], [0]);

  const remainingFiles = listFiles(actualInstallDir);
  const summary = {
    msi_path: path.relative(repoRoot, msiPath),
    install_dir: path.relative(repoRoot, actualInstallDir),
    workspace_root: path.relative(repoRoot, paths.workspaceRoot),
    install_log: path.relative(repoRoot, paths.installLogPath),
    uninstall_log: path.relative(repoRoot, paths.uninstallLogPath),
    sidecar_stdout_log: path.relative(repoRoot, paths.stdoutLogPath),
    sidecar_stderr_log: path.relative(repoRoot, paths.stderrLogPath),
    health,
    remaining_install_files: remainingFiles.map((candidate) => path.relative(repoRoot, candidate)),
  };

  if (summary.remaining_install_files.length > 0) {
    throw new Error(`installer left files behind: ${summary.remaining_install_files.join(", ")}`);
  }

  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
