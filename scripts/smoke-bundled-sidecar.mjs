import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_PORT = 8876;
const HEALTH_ATTEMPTS = 40;
const HEALTH_INTERVAL_MS = 500;

function todayStamp(now = () => new Date().toISOString()) {
  return now().slice(0, 10);
}

function compactDate(now = () => new Date().toISOString()) {
  return todayStamp(now).replaceAll("-", "");
}

export function parseBundledSidecarSmokeArgs(argv = process.argv.slice(2)) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") {
      parsed.port = Number(argv[++index]);
    } else if (arg === "--workspace") {
      parsed.workspace = argv[++index];
    } else if (arg === "--out") {
      parsed.outPath = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.port !== undefined && (!Number.isInteger(parsed.port) || parsed.port <= 0)) {
    throw new Error("--port must be a positive integer");
  }

  return parsed;
}

export function resolveBundledSidecarSmokeConfig({
  repoRoot: root = repoRoot,
  now = () => new Date().toISOString(),
  args = {},
} = {}) {
  const generatedDir = path.join(root, "docs", "operations", "generated");
  return {
    executable: path.join(
      root,
      "apps",
      "desktop",
      "src-tauri",
      "resources",
      "sidecar",
      "windows-x64",
      "gongmu-sidecar",
      "gongmu-sidecar.exe",
    ),
    workspace:
      args.workspace ??
      path.join(root, "runtime-workspace", "cache", `bundled-sidecar-smoke-${compactDate(now)}`),
    outPath:
      args.outPath ??
      path.join(generatedDir, `bundled-sidecar-smoke-${todayStamp(now)}.json`),
    port: args.port ?? DEFAULT_PORT,
  };
}

export function buildSmokeReport({
  status,
  executable,
  workspace,
  port,
  startedAt,
  health = null,
  endpointChecks = [],
  stdout = "",
  stderr = "",
  error = null,
  generatedAt = new Date().toISOString(),
}) {
  return {
    generated_at: generatedAt,
    status,
    executable,
    workspace,
    port,
    started_at: startedAt,
    ...(health ? { health } : {}),
    ...(endpointChecks.length > 0 ? { endpoint_checks: endpointChecks } : {}),
    ...(error ? { error: String(error?.stack ?? error) } : {}),
    stdout_tail: stdout.slice(-2000),
    stderr_tail: stderr.slice(-2000),
  };
}

export function buildBundledSidecarEndpointChecks({
  profilePayload = {
    org_name: "검증기관",
    department_name: "AI혁신과",
    team_name: "업무자동화팀",
    position: "주무관",
    duty_keywords: ["AI", "보고서"],
  },
} = {}) {
  return [
    {
      label: "knowledge work profile can be read",
      method: "GET",
      path: "/api/knowledge/work-profile",
    },
    {
      label: "knowledge work profile can be saved",
      method: "PUT",
      path: "/api/knowledge/work-profile",
      body: profilePayload,
      expect: { department_name: profilePayload.department_name },
    },
    {
      label: "knowledge work profile persists",
      method: "GET",
      path: "/api/knowledge/work-profile",
      expect: { department_name: profilePayload.department_name },
    },
    {
      label: "GraphRAG backend status is reachable",
      method: "GET",
      path: "/api/knowledge/backend-status",
    },
  ];
}

async function runEndpointChecks({ port, fetchFn = fetch, checks = buildBundledSidecarEndpointChecks() }) {
  const results = [];
  for (const check of checks) {
    const url = `http://127.0.0.1:${port}${check.path}`;
    const response = await fetchFn(url, {
      method: check.method,
      headers: check.body ? { "content-type": "application/json" } : undefined,
      body: check.body ? JSON.stringify(check.body) : undefined,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 500) };
    }

    if (!response.ok) {
      throw new Error(`${check.method} ${check.path} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    for (const [key, expected] of Object.entries(check.expect ?? {})) {
      if (payload?.[key] !== expected) {
        throw new Error(`${check.method} ${check.path} expected ${key}=${expected}, got ${payload?.[key]}`);
      }
    }

    results.push({
      label: check.label,
      method: check.method,
      path: check.path,
      status: response.status,
      ok: response.ok,
      payload,
    });
  }
  return results;
}

async function waitForHealth({ port, child, fetchFn = fetch }) {
  const url = `http://127.0.0.1:${port}/health`;
  let lastError = "";
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
    if (child.exitCode !== null) {
      throw new Error(`Bundled sidecar exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetchFn(url);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return { url, payload, attempt: attempt + 1 };
    } catch (error) {
      lastError = String(error?.message ?? error);
    }
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

export async function runBundledSidecarSmoke(config) {
  if (!fs.existsSync(config.executable)) {
    throw new Error(`Missing bundled sidecar exe: ${config.executable}`);
  }
  fs.mkdirSync(config.workspace, { recursive: true });
  fs.mkdirSync(path.dirname(config.outPath), { recursive: true });

  const startedAt = new Date().toISOString();
  const child = spawn(config.executable, [], {
    cwd: path.dirname(config.executable),
    env: {
      ...process.env,
      GONGMU_WORKSPACE_ROOT: config.workspace,
      GONGMU_SIDECAR_HOST: "127.0.0.1",
      GONGMU_SIDECAR_PORT: String(config.port),
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const health = await waitForHealth({ port: config.port, child });
    const endpointChecks = await runEndpointChecks({ port: config.port });
    return buildSmokeReport({
      status: "pass",
      executable: config.executable,
      workspace: config.workspace,
      port: config.port,
      startedAt,
      health,
      endpointChecks,
      stdout,
      stderr,
    });
  } catch (error) {
    return buildSmokeReport({
      status: "fail",
      executable: config.executable,
      workspace: config.workspace,
      port: config.port,
      startedAt,
      stdout,
      stderr,
      error,
    });
  } finally {
    if (!child.killed) {
      child.kill();
    }
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function main() {
  const args = parseBundledSidecarSmokeArgs();
  const config = resolveBundledSidecarSmokeConfig({ args });
  const report = await runBundledSidecarSmoke(config);
  fs.writeFileSync(config.outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
