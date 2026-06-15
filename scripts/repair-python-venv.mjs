#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

export function parsePyvenvConfig(text) {
  const parsed = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    parsed[match[1].trim()] = match[2].trim();
  }
  return parsed;
}

function venvPythonPath(root, platform) {
  return platform === "win32"
    ? path.win32.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
}

function pyvenvConfigPath(root) {
  return path.join(root, ".venv", "pyvenv.cfg");
}

function defaultRunProbe(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr || result.error?.message || "",
  };
}

export function inspectPythonVenv({
  repoRoot: root = repoRoot,
  platform = process.platform,
  readTextFile = (filePath) => fs.readFileSync(filePath, "utf8"),
  exists = (filePath) => fs.existsSync(filePath),
  runProbe = defaultRunProbe,
} = {}) {
  const venvPython = venvPythonPath(root, platform);
  const configPath = pyvenvConfigPath(root);
  const result = {
    status: "missing",
    repoRoot: root,
    venvPython,
    pyvenvConfig: configPath,
    pyvenv: {},
    versionOutput: "",
    reason: "",
  };

  if (!exists(configPath)) {
    result.reason = ".venv/pyvenv.cfg 파일이 없습니다.";
    return result;
  }

  result.pyvenv = parsePyvenvConfig(readTextFile(configPath));

  if (!exists(venvPython)) {
    result.reason = `.venv Python 실행 파일이 없습니다: ${venvPython}`;
    return result;
  }

  const probe = runProbe(venvPython, ["--version"]);
  result.versionOutput = (probe.stdout || probe.stderr || "").trim();
  if (!probe.ok) {
    result.status = "broken";
    result.reason = result.versionOutput || "venv Python 실행에 실패했습니다.";
    return result;
  }

  if (!/Python 3\.11\./.test(result.versionOutput)) {
    result.status = "wrong-version";
    result.reason = `Python 3.11이 필요하지만 현재 출력은 '${result.versionOutput}'입니다.`;
    return result;
  }

  result.status = "ok";
  result.reason = "Python 3.11 venv가 정상입니다.";
  return result;
}

export function resolvePython311Candidates({
  platform = process.platform,
  localAppData = process.env.LOCALAPPDATA ?? "",
  programFiles = process.env.ProgramFiles ?? "",
  programFilesX86 = process.env["ProgramFiles(x86)"] ?? "",
} = {}) {
  if (platform === "win32") {
    return [
      "py -3.11",
      "python",
      ...(localAppData
        ? [path.win32.join(localAppData, "Programs", "Python", "Python311", "python.exe")]
        : []),
      ...(programFiles ? [path.win32.join(programFiles, "Python311", "python.exe")] : []),
      ...(programFilesX86 ? [path.win32.join(programFilesX86, "Python311", "python.exe")] : []),
    ];
  }

  return ["python3.11", "python3", "python"];
}

function splitCommand(candidate) {
  if (/[\\/]/.test(candidate) || /\.exe$/i.test(candidate)) {
    return { command: candidate, args: [] };
  }
  const parts = candidate.split(" ").filter(Boolean);
  return { command: parts[0], args: parts.slice(1) };
}

export function inspectPython311Candidates({
  candidates = resolvePython311Candidates(),
  runProbe = defaultRunProbe,
} = {}) {
  return candidates.map((candidate) => {
    const { command, args } = splitCommand(candidate);
    const probeArgs = [...args, "--version"];
    const probe = runProbe(command, probeArgs);
    return {
      candidate,
      command,
      args: probeArgs,
      ok: probe.ok && /Python 3\.11\./.test(`${probe.stdout} ${probe.stderr}`),
      output: `${probe.stdout} ${probe.stderr}`.trim(),
    };
  });
}

export function parseRepairArgs(argv = process.argv.slice(2)) {
  const parsed = {
    repair: false,
    checkOnly: true,
    pythonCommand: null,
    outputJson: null,
    outputMarkdown: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repair") {
      parsed.repair = true;
      parsed.checkOnly = false;
    } else if (arg === "--check") {
      parsed.checkOnly = true;
    } else if (arg === "--python") {
      const value = argv[++index];
      if (!value) {
        throw new Error("--python requires a Python 3.11 executable path or command");
      }
      parsed.pythonCommand = value;
    } else if (arg === "--out") {
      const value = argv[++index];
      if (!value) {
        throw new Error("--out requires a JSON report path");
      }
      parsed.outputJson = value;
    } else if (arg === "--markdown") {
      const value = argv[++index];
      if (!value) {
        throw new Error("--markdown requires a Markdown report path");
      }
      parsed.outputMarkdown = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

export function buildRepairPlan({
  repoRoot: root = repoRoot,
  platform = process.platform,
  pythonCommand,
  requirementsPath = "services/sidecar/requirements.txt",
} = {}) {
  if (!pythonCommand) {
    throw new Error("pythonCommand is required");
  }
  const python = splitCommand(pythonCommand);
  const venvDir = path.join(root, ".venv");
  const venvPython = venvPythonPath(root, platform);
  const requirements = path.resolve(root, requirementsPath);
  return {
    venvDir,
    venvPython,
    commands: [
      { command: python.command, args: [...python.args, "-m", "venv", venvDir] },
      { command: venvPython, args: ["-m", "pip", "install", "-r", requirements] },
      { command: venvPython, args: ["-m", "pip", "install", "-e", path.resolve(root, "services/sidecar")] },
    ],
  };
}

export function buildPythonVenvReport(
  inspection,
  { generatedAt = new Date().toISOString(), candidateChecks = [] } = {},
) {
  const ready = inspection.status === "ok";
  return {
    schemaVersion: 1,
    generatedAt,
    status: inspection.status,
    ready,
    expectedPython: "3.11",
    needsUserAction: !ready,
    repoRoot: inspection.repoRoot,
    venvPython: inspection.venvPython,
    pyvenvConfig: inspection.pyvenvConfig,
    baseHome: inspection.pyvenv.home ?? "",
    baseVersion: inspection.pyvenv.version ?? "",
    versionOutput: inspection.versionOutput,
    reason: inspection.reason,
    candidateChecks,
    recoveryCommands: [
      'node scripts/repair-python-venv.mjs --repair --python "C:\\path\\to\\Python311\\python.exe"',
      "npm.cmd run sidecar:bundle:windows",
      "node scripts/sync-sidecar-bundle.mjs",
      "npm.cmd run sidecar:bundle:freshness",
      "npm.cmd run sidecar:smoke:bundled",
      "npm.cmd run verify:all",
    ],
  };
}

export function renderPythonVenvMarkdown(report) {
  const lines = [];
  lines.push("# Python 3.11 가상환경 리포트");
  lines.push("");
  lines.push(`생성시각: ${report.generatedAt}`);
  lines.push(`현재 상태: ${report.status}`);
  lines.push(`최종완성 가능: ${report.ready ? "예" : "아니오"}`);
  lines.push("");
  lines.push("## 진단");
  lines.push("");
  lines.push(`- 필요 Python: ${report.expectedPython}`);
  lines.push(`- venv Python: ${report.venvPython}`);
  lines.push(`- pyvenv.cfg: ${report.pyvenvConfig}`);
  if (report.baseHome) lines.push(`- base home: ${report.baseHome}`);
  if (report.baseVersion) lines.push(`- base version: ${report.baseVersion}`);
  if (report.versionOutput) lines.push(`- version output: ${report.versionOutput}`);
  lines.push(`- 원인: ${report.reason}`);
  if (report.candidateChecks?.length) {
    lines.push("");
    lines.push("## Python 3.11 후보 탐색");
    lines.push("");
    lines.push("| 후보 | 결과 | 출력 |");
    lines.push("| --- | --- | --- |");
    for (const candidate of report.candidateChecks) {
      const output = candidate.output ? candidate.output.replace(/\|/g, "\\|") : "(출력 없음)";
      lines.push(`| \`${candidate.candidate}\` | ${candidate.ok ? "사용 가능" : "사용 불가"} | ${output} |`);
    }
  }
  lines.push("");
  lines.push("## 복구 절차");
  lines.push("");
  if (!report.needsUserAction) {
    lines.push("- 추가 조치가 필요하지 않습니다.");
  } else {
    lines.push("아래 순서로 Python 3.11 실행파일을 지정해 venv를 복구한 뒤, sidecar 번들과 최종 검증을 다시 실행합니다.");
    lines.push("");
    for (const command of report.recoveryCommands) {
      lines.push(`- \`${command}\``);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function writePythonVenvReport(report, { outputJson, outputMarkdown, repoRoot: root = repoRoot } = {}) {
  if (outputJson) {
    const outputJsonPath = path.resolve(root, outputJson);
    fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
    fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (outputMarkdown) {
    const outputMarkdownPath = path.resolve(root, outputMarkdown);
    fs.mkdirSync(path.dirname(outputMarkdownPath), { recursive: true });
    fs.writeFileSync(outputMarkdownPath, renderPythonVenvMarkdown(report), "utf8");
  }
}

function findUsablePython311(candidates) {
  for (const candidate of candidates) {
    const { command, args } = splitCommand(candidate);
    const probe = defaultRunProbe(command, [...args, "--version"]);
    const output = `${probe.stdout} ${probe.stderr}`.trim();
    if (probe.ok && /Python 3\.11\./.test(output)) {
      return candidate;
    }
  }
  return null;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function printInspection(inspection) {
  console.log(`venv_status=${inspection.status}`);
  console.log(`venv_python=${inspection.venvPython}`);
  console.log(`pyvenv_config=${inspection.pyvenvConfig}`);
  if (inspection.pyvenv.home) console.log(`base_home=${inspection.pyvenv.home}`);
  if (inspection.pyvenv.version) console.log(`base_version=${inspection.pyvenv.version}`);
  if (inspection.versionOutput) console.log(`version_output=${inspection.versionOutput}`);
  console.log(`reason=${inspection.reason}`);
}

function writeReportForParsedArgs(inspection, parsed) {
  if (!parsed.outputJson && !parsed.outputMarkdown) {
    return;
  }
  writePythonVenvReport(buildPythonVenvReport(inspection, { candidateChecks: inspectPython311Candidates() }), {
    outputJson: parsed.outputJson,
    outputMarkdown: parsed.outputMarkdown,
  });
}

export function main(argv = process.argv.slice(2)) {
  const parsed = parseRepairArgs(argv);
  const inspection = inspectPythonVenv();
  printInspection(inspection);
  writeReportForParsedArgs(inspection, parsed);

  if (inspection.status === "ok") {
    return 0;
  }

  if (parsed.checkOnly) {
    console.error(
      "Python 3.11 venv is not ready. Run `npm.cmd run sidecar:venv:repair` after confirming Python 3.11 is installed. If Python is installed in a custom path, run `node scripts/repair-python-venv.mjs --repair --python <python.exe>`.",
    );
    return 1;
  }

  const pythonCommand = findUsablePython311(
    parsed.pythonCommand ? [parsed.pythonCommand] : resolvePython311Candidates(),
  );
  if (!pythonCommand) {
    console.error("Python 3.11 executable was not found. Install Python 3.11 first, or pass it with `--python <python.exe>`.");
    return 1;
  }

  const plan = buildRepairPlan({ pythonCommand });
  console.log(`repair_python=${pythonCommand}`);
  console.log(`repair_venv=${plan.venvDir}`);
  for (const step of plan.commands) {
    runCommand(step.command, step.args);
  }
  const after = inspectPythonVenv();
  printInspection(after);
  writeReportForParsedArgs(after, parsed);
  return after.status === "ok" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = main();
}
