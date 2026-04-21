#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

export function getVerifySteps({ skipBundle = false } = {}) {
  const steps = [];

  if (!skipBundle) {
    steps.push("desktop:bundle");
  }

  steps.push("desktop:smoke:msi", "desktop:smoke:nsis");
  return steps;
}

export function buildRunCommand(scriptName, platform = process.platform) {
  if (platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", `npm.cmd run ${scriptName}`],
    };
  }

  return {
    command: "npm",
    args: ["run", scriptName],
  };
}

function runStep(scriptName) {
  const invocation = buildRunCommand(scriptName);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  const status = result.status ?? 1;
  if (status !== 0) {
    throw new Error(`${scriptName} failed with status ${status}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const skipBundle = argv.includes("--skip-bundle");
  const steps = getVerifySteps({ skipBundle });

  for (const step of steps) {
    runStep(step);
  }

  console.log(
    JSON.stringify(
      {
        mode: skipBundle ? "fast" : "full",
        steps,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
