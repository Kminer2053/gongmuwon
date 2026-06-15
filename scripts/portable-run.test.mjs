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
      probeCommand: (candidate) => ({ ok: candidate === venvPython, output: "Python 3.11.8" }),
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
        output: candidate === "python.exe" ? "Python 3.11.8" : "",
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
      probeCommand: (candidate) => ({ ok: candidate === installedPython, output: "Python 3.11.8" }),
      localAppData: "C:\\Users\\USER\\AppData\\Local",
    });

    assert.equal(command, installedPython);
  }

  {
    const installedPython = "C:\\Program Files\\Python311\\python.exe";
    const command = resolvePython({
      repoRoot: "C:\\repo",
      platform: "win32",
      isExecutable: (candidate) => candidate === installedPython,
      probeCommand: (candidate) => ({ ok: candidate === installedPython, output: "Python 3.11.9" }),
      localAppData: "C:\\Users\\USER\\AppData\\Local",
      programFiles: "C:\\Program Files",
      programFilesX86: "C:\\Program Files (x86)",
    });

    assert.equal(command, installedPython);
  }

  {
    const installedPython310 = "C:\\Users\\USER\\AppData\\Local\\Programs\\Python\\Python310\\python.exe";
    assert.throws(
      () =>
        resolvePython({
          repoRoot: "C:\\repo",
          platform: "win32",
          isExecutable: (candidate) => candidate === installedPython310,
          probeCommand: (candidate) => ({ ok: candidate === installedPython310, output: "Python 3.10.11" }),
          localAppData: "C:\\Users\\USER\\AppData\\Local",
        }),
      /Unable to resolve python executable/,
    );
  }

  {
    assert.throws(
      () =>
        resolvePython({
          repoRoot: "C:\\repo",
          platform: "win32",
          isExecutable: () => false,
          probeCommand: (candidate) => ({ ok: candidate === "python.exe", output: "Python 3.12.2" }),
          localAppData: "C:\\Users\\USER\\AppData\\Local",
        }),
      /Unable to resolve python executable/,
    );
  }

  {
    const installedPython = "C:\\Users\\USER\\AppData\\Local\\Programs\\Python\\Python311\\python.exe";
    assert.throws(
      () =>
        resolvePython({
          repoRoot: "C:\\repo",
          platform: "win32",
          isExecutable: (candidate) => candidate === installedPython,
          probeCommand: (candidate) => ({ ok: false, output: candidate }),
          localAppData: "C:\\Users\\USER\\AppData\\Local",
        }),
      /Unable to resolve python executable/,
    );
  }

  {
    const command = resolvePython({
      repoRoot: "/repo",
      platform: "linux",
      isExecutable: () => false,
      probeCommand: (candidate) => ({ ok: candidate === "python3", output: "Python 3.11.9" }),
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
