import { spawnSync } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { importCleanAccountEvidence } from "./import-clean-account-evidence.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_EVIDENCE_FILE = "runtime-clean-account-evidence.json";
const DEFAULT_RUNTIME_EVIDENCE_INBOX = "release/clean-account-evidence-inbox";

function defaultNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function defaultRunCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
}

function commandResult(command, args, result) {
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function sameResolvedPath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

async function importRuntimeEvidenceIfPresent({ repoRoot, sourceDir, inboxDir }) {
  const sourcePath = join(sourceDir, RUNTIME_EVIDENCE_FILE);
  const targetDir = resolve(repoRoot, inboxDir ?? DEFAULT_RUNTIME_EVIDENCE_INBOX);
  const targetPath = join(targetDir, RUNTIME_EVIDENCE_FILE);
  if (!(await exists(sourcePath))) {
    return {
      copied: false,
      sourcePath,
      targetPath,
      reason: "runtime evidence file was not present in the imported evidence folder",
    };
  }
  if (sameResolvedPath(sourcePath, targetPath)) {
    return {
      copied: false,
      alreadyInPlace: true,
      sourcePath,
      targetPath,
    };
  }
  await mkdir(targetDir, { recursive: true });
  await copyFile(sourcePath, targetPath);
  return {
    copied: true,
    alreadyInPlace: false,
    sourcePath,
    targetPath,
  };
}

export async function finalizeCleanAccountEvidence(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
  const npmCommand = options.npmCommand ?? defaultNpmCommand();
  const runCommand = options.runCommand ?? defaultRunCommand;
  const importReport = await importCleanAccountEvidence({
    repoRoot,
    sourceDir: options.sourceDir,
    outputDir: options.outputDir,
    validationJson: options.validationJson,
    validationMarkdown: options.validationMarkdown,
    importJson: options.importJson,
    importMarkdown: options.importMarkdown,
  });

  const commands = [];
  const runtimeImport = await importRuntimeEvidenceIfPresent({
    repoRoot,
    sourceDir: importReport.evidenceSourceDir ?? importReport.sourceDir,
    inboxDir: options.runtimeEvidenceInbox,
  });
  if (importReport.ready !== true) {
    return {
      schemaVersion: 1,
      ready: false,
      import: importReport,
      runtimeImport,
      validation: importReport.validation,
      commands,
    };
  }

  for (const args of [
    ["run", "release:runtime-evidence:validate"],
    ["run", "verify:completion:preflight"],
    ["run", "verify:completion:audit"],
  ]) {
    const result = runCommand(npmCommand, args, { cwd: repoRoot });
    const item = commandResult(npmCommand, args, result);
    commands.push(item);
    if (result.status !== 0) {
      return {
        schemaVersion: 1,
        ready: false,
        import: importReport,
        runtimeImport,
        validation: importReport.validation,
        commands,
      };
    }
  }

  return {
    schemaVersion: 1,
    ready: true,
    import: importReport,
    runtimeImport,
    validation: importReport.validation,
    commands,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") options.sourceDir = argv[++index];
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node scripts/finalize-clean-account-evidence.mjs [--from <target-evidence-dir-or-json>]

Imports AI pack evidence and runtime evidence from the target evidence folder, validates them, then reruns:
  npm.cmd run release:runtime-evidence:validate
  npm.cmd run verify:completion:preflight
  npm.cmd run verify:completion:audit
`);
    return;
  }
  const report = await finalizeCleanAccountEvidence(options);
  console.log(
    JSON.stringify(
      {
        ready: report.ready,
        validationReady: report.validation.ready,
        runtimeEvidenceAvailable:
          report.runtimeImport?.copied === true || report.runtimeImport?.alreadyInPlace === true,
        runtimeEvidenceImported: report.runtimeImport?.copied === true,
        runtimeEvidenceAlreadyInPlace: report.runtimeImport?.alreadyInPlace === true,
        runtimeEvidenceTarget: report.runtimeImport?.targetPath,
        commands: report.commands.map((item) => ({ command: item.command, status: item.status })),
        errors: report.validation.errors,
      },
      null,
      2,
    ),
  );
  if (!report.ready) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
