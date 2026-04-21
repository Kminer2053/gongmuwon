import assert from "node:assert/strict";
import path from "node:path";

import { resolveCommand, resolvePython, resolveCargo } from "./portable-run.mjs";

function runChecks() {
  {
    const repoRoot = "C:\\repo";
    const venvPython = path.win32.join(repoRoot, ".venv", "Scripts", "python.exe");
    const command = resolvePython({
      repoRoot,
      platform: "win32",
      isExecutable: (candidate) => candidate === venvPython,
      probeCommand: (candidate) => ({ ok: candidate === venvPython }),
      localAppData: "C:\\Users\\USER\\AppData\\Local",
    });

    assert.equal(command, "C:\\repo\\.venv\\Scripts\\python.exe");
  }

  {
    const repoRoot = "C:\\repo";
    const venvPython = path.win32.join(repoRoot, ".venv", "Scripts", "python.exe");
    const command = resolvePython({
      repoRoot,
      platform: "win32",
      isExecutable: (candidate) => candidate === venvPython,
      probeCommand: (candidate) => ({
        ok: candidate === "python.exe",
      }),
      localAppData: "C:\\Users\\USER\\AppData\\Local",
    });

    assert.equal(command, "python.exe");
  }

  {
    const installedPython = "C:\\Users\\USER\\AppData\\Local\\Programs\\Python\\Python311\\python.exe";
    const command = resolvePython({
      repoRoot: "C:\\repo",
      platform: "win32",
      isExecutable: (candidate) => candidate === installedPython,
      probeCommand: () => ({ ok: false }),
      localAppData: "C:\\Users\\USER\\AppData\\Local",
    });

    assert.equal(command, installedPython);
  }

  {
    const command = resolvePython({
      repoRoot: "/repo",
      platform: "linux",
      isExecutable: () => false,
      probeCommand: (candidate) => ({ ok: candidate === "python3" }),
    });

    assert.equal(command, "python3");
  }

  {
    const command = resolveCargo({
      platform: "win32",
      probeCommand: (candidate) => ({ ok: candidate === "cargo.exe" }),
      isExecutable: () => false,
      homeDir: "C:\\Users\\USER",
    });

    assert.equal(command, "cargo.exe");
  }

  assert.throws(
    () =>
      resolveCommand("npm", {
        repoRoot: "/repo",
        platform: "linux",
        homeDir: "/home/user",
        isExecutable: () => false,
        probeCommand: () => ({ ok: false }),
      }),
    /unsupported kind: npm/,
  );
}

runChecks();
console.log("portable-run checks passed");
