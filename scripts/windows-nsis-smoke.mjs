#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { spawn, spawnSync } from "node:child_process";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

function readTauriConfig(root = repoRoot) {
  const configPath = path.join(root, "apps", "desktop", "src-tauri", "tauri.conf.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

export function buildNsisOutputPath({
  root = repoRoot,
  profile = "release",
  productName,
  version,
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
    "nsis",
    `${productName}_${version}_x64-setup.exe`,
  );
}

export function buildSmokePaths({ root = repoRoot, stamp }) {
  const cacheRoot = path.join(root, "runtime-workspace", "cache");
  return {
    cacheRoot,
    installDir: path.join(cacheRoot, `nsis-smoke-install-${stamp}`),
    workspaceRoot: path.join(cacheRoot, `nsis-smoke-workspace-${stamp}`),
    stdoutLogPath: path.join(cacheRoot, `nsis-smoke-sidecar-${stamp}.out.log`),
    stderrLogPath: path.join(cacheRoot, `nsis-smoke-sidecar-${stamp}.err.log`),
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

function runCommand(command, args, acceptedStatuses = [0]) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  const status = result.status ?? 1;
  if (!acceptedStatuses.includes(status)) {
    throw new Error(`${command} failed with status ${status}`);
  }
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

async function waitForRemoval(targetPath, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!fs.existsSync(targetPath)) {
      return;
    }
    await delay(500);
  }

  throw new Error(`install directory still exists after uninstall: ${targetPath}`);
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
  const nsisPath = buildNsisOutputPath({
    root: repoRoot,
    profile: "release",
    productName: config.productName,
    version: config.version,
  });
  const stamp = timestamp();
  const paths = buildSmokePaths({ stamp });

  assertExists(nsisPath, "nsis bundle");

  ensureDir(paths.cacheRoot);
  ensureRemoved(paths.installDir);
  ensureRemoved(paths.workspaceRoot);
  ensureRemoved(paths.stdoutLogPath);
  ensureRemoved(paths.stderrLogPath);

  runCommand(nsisPath, ["/S", `/D=${paths.installDir}`], [0]);

  const desktopExe = path.join(paths.installDir, "gongmu-desktop.exe");
  const uninstallExe = path.join(paths.installDir, "uninstall.exe");
  const sidecarExe = path.join(
    paths.installDir,
    "resources",
    "sidecar",
    "windows-x64",
    "gongmu-sidecar",
    "gongmu-sidecar.exe",
  );

  assertExists(desktopExe, "desktop executable");
  assertExists(uninstallExe, "nsis uninstaller");
  assertExists(sidecarExe, "bundled sidecar executable");

  ensureDir(paths.workspaceRoot);
  const health = await launchSidecarAndCheck(sidecarExe, paths);

  runCommand(uninstallExe, ["/S"], [0]);
  await waitForRemoval(paths.installDir);

  const remainingFiles = listFiles(paths.installDir);
  const summary = {
    nsis_path: path.relative(repoRoot, nsisPath),
    install_dir: path.relative(repoRoot, paths.installDir),
    workspace_root: path.relative(repoRoot, paths.workspaceRoot),
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
