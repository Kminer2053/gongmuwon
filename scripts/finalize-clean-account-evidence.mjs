import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { importCleanAccountEvidence } from "./import-clean-account-evidence.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
  if (importReport.ready !== true) {
    return {
      schemaVersion: 1,
      ready: false,
      import: importReport,
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
        validation: importReport.validation,
        commands,
      };
    }
  }

  return {
    schemaVersion: 1,
    ready: true,
    import: importReport,
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

Imports clean-account evidence, validates it, then reruns:
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
