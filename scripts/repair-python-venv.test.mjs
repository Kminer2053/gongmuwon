import assert from "node:assert/strict";
import path from "node:path";

import {
  buildPythonVenvReport,
  buildRepairPlan,
  inspectPythonVenv,
  inspectPython311Candidates,
  parseRepairArgs,
  parsePyvenvConfig,
  renderPythonVenvMarkdown,
  resolvePython311Candidates,
} from "./repair-python-venv.mjs";

function runChecks() {
  {
    const parsed = parsePyvenvConfig("home = C:\\Python311\r\nversion = 3.11.8\r\n");
    assert.equal(parsed.home, "C:\\Python311");
    assert.equal(parsed.version, "3.11.8");
  }

  {
    const repoRoot = "C:\\repo";
    const venvPython = path.win32.join(repoRoot, ".venv", "Scripts", "python.exe");
    const result = inspectPythonVenv({
      repoRoot,
      platform: "win32",
      readTextFile: () => "home = C:\\MissingPython\r\nversion = 3.11.8\r\n",
      exists: (candidate) => candidate === venvPython || candidate.endsWith("pyvenv.cfg"),
      runProbe: () => ({ ok: false, stdout: "", stderr: "No Python at 'C:\\MissingPython\\python.exe'" }),
    });

    assert.equal(result.status, "broken");
    assert.equal(result.venvPython, "C:\\repo\\.venv\\Scripts\\python.exe");
    assert.match(result.reason, /No Python/);
    assert.equal(result.pyvenv.version, "3.11.8");
  }

  {
    const repoRoot = "C:\\repo";
    const venvPython = path.win32.join(repoRoot, ".venv", "Scripts", "python.exe");
    const result = inspectPythonVenv({
      repoRoot,
      platform: "win32",
      readTextFile: () => "home = C:\\Python311\r\nversion = 3.11.8\r\n",
      exists: (candidate) => candidate === venvPython || candidate.endsWith("pyvenv.cfg"),
      runProbe: () => ({ ok: true, stdout: "Python 3.11.8", stderr: "" }),
    });

    assert.equal(result.status, "ok");
    assert.equal(result.versionOutput, "Python 3.11.8");
  }

  {
    const candidates = resolvePython311Candidates({
      platform: "win32",
      localAppData: "C:\\Users\\USER\\AppData\\Local",
      programFiles: "C:\\Program Files",
      programFilesX86: "C:\\Program Files (x86)",
    });

    assert.deepEqual(candidates.slice(0, 5), [
      "py -3.11",
      "python",
      "C:\\Users\\USER\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
      "C:\\Program Files\\Python311\\python.exe",
      "C:\\Program Files (x86)\\Python311\\python.exe",
    ]);
  }

  {
    const checks = inspectPython311Candidates({
      candidates: ["py -3.11", "C:\\Tools\\Python311\\python.exe"],
      runProbe: (command, args) => {
        if (command === "py") return { ok: false, stdout: "", stderr: "py launcher not found" };
        assert.equal(command, "C:\\Tools\\Python311\\python.exe");
        assert.deepEqual(args, ["--version"]);
        return { ok: true, stdout: "Python 3.11.9", stderr: "" };
      },
    });

    assert.deepEqual(checks, [
      {
        candidate: "py -3.11",
        command: "py",
        args: ["-3.11", "--version"],
        ok: false,
        output: "py launcher not found",
      },
      {
        candidate: "C:\\Tools\\Python311\\python.exe",
        command: "C:\\Tools\\Python311\\python.exe",
        args: ["--version"],
        ok: true,
        output: "Python 3.11.9",
      },
    ]);
  }

  {
    const parsed = parseRepairArgs([
      "--repair",
      "--python",
      "C:\\Tools\\Python311\\python.exe",
      "--out",
      "docs\\operations\\generated\\python-venv-report.json",
      "--markdown",
      "docs\\operations\\generated\\python-venv-report.md",
    ]);
    assert.equal(parsed.repair, true);
    assert.equal(parsed.checkOnly, false);
    assert.equal(parsed.pythonCommand, "C:\\Tools\\Python311\\python.exe");
    assert.equal(parsed.outputJson, "docs\\operations\\generated\\python-venv-report.json");
    assert.equal(parsed.outputMarkdown, "docs\\operations\\generated\\python-venv-report.md");
  }

  {
    const plan = buildRepairPlan({
      repoRoot: "C:\\repo",
      platform: "win32",
      pythonCommand: "py -3.11",
      requirementsPath: "services/sidecar/requirements.txt",
    });

    assert.deepEqual(plan.commands, [
      { command: "py", args: ["-3.11", "-m", "venv", "C:\\repo\\.venv"] },
      {
        command: "C:\\repo\\.venv\\Scripts\\python.exe",
        args: ["-m", "pip", "install", "-r", "C:\\repo\\services\\sidecar\\requirements.txt"],
      },
      {
        command: "C:\\repo\\.venv\\Scripts\\python.exe",
        args: ["-m", "pip", "install", "-e", "C:\\repo\\services\\sidecar"],
      },
    ]);
  }

  {
    const inspection = inspectPythonVenv({
      repoRoot: "C:\\repo",
      platform: "win32",
      readTextFile: () => "home = C:\\MissingPython\r\nversion = 3.11.8\r\n",
      exists: (candidate) => candidate.endsWith("pyvenv.cfg"),
      runProbe: () => ({ ok: false, stdout: "", stderr: "should not run" }),
    });
    const report = buildPythonVenvReport(inspection, {
      candidateChecks: [{ candidate: "py -3.11", ok: false, output: "py launcher not found" }],
    });

    assert.equal(report.status, "missing");
    assert.equal(report.ready, false);
    assert.equal(report.expectedPython, "3.11");
    assert.equal(report.needsUserAction, true);
    assert.match(report.recoveryCommands[0], /repair-python-venv\.mjs --repair --python/);
    assert.match(report.recoveryCommands.at(-1), /verify:all/);
    assert.equal(report.candidateChecks[0].candidate, "py -3.11");

    const markdown = renderPythonVenvMarkdown(report);
    assert.match(markdown, /# Python 3\.11 가상환경 리포트/);
    assert.match(markdown, /현재 상태: missing/);
    assert.match(markdown, /py launcher not found/);
    assert.match(markdown, /복구 절차/);
  }
}

runChecks();
console.log("repair-python-venv checks passed");
