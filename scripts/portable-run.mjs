#!/usr/bin/env node
import { accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [kind, ...args] = process.argv.slice(2);

if (!kind) {
  console.error("usage: portable-run.mjs <python|cargo> [args...]");
  process.exit(1);
}

function isExecutable(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

function resolvePython() {
  const venvPython = path.join(repoRoot, ".venv", "bin", "python");
  if (isExecutable(venvPython)) {
    return venvPython;
  }

  for (const candidate of ["python3", "python"]) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }

  throw new Error("Unable to resolve python executable");
}

function resolveCargo() {
  const systemCargo = spawnSync("cargo", ["--version"], { stdio: "ignore" });
  if (!systemCargo.error && systemCargo.status === 0) {
    return "cargo";
  }

  const homeCargo = path.join(process.env.HOME ?? "", ".cargo", "bin", "cargo");
  if (isExecutable(homeCargo)) {
    return homeCargo;
  }

  throw new Error("Unable to resolve cargo executable");
}

try {
  if (kind === "python") {
    run(resolvePython(), args);
  } else if (kind === "cargo") {
    run(resolveCargo(), args);
  } else {
    console.error(`unsupported kind: ${kind}`);
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
