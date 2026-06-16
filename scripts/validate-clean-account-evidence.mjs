import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_EVIDENCE_PATH = "docs/operations/generated/clean-account-evidence/ai-pack-clean-account-evidence.json";
const DEFAULT_OUT_JSON = "docs/operations/generated/clean-account-evidence-validation.json";
const DEFAULT_OUT_MARKDOWN = "docs/operations/generated/clean-account-evidence-validation.md";
const EXPECTED_MODEL = "gemma4:e2b";

const REQUIRED_CHECKS = [
  "Ollama executable detected",
  "Ollama server responding",
  `${EXPECTED_MODEL} model listed`,
  "Text chat response",
  "Image chat response",
  "Gongmu settings file exists",
  "Gongmu settings point to Ollama model",
  "Install log exists",
  "Validation log exists",
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function checkByName(evidence, name) {
  return asArray(evidence.checks).find((check) => check?.name === name) ?? null;
}

function buildMarkdown(report) {
  return `# Clean-account evidence validation

- createdAt: ${report.createdAt}
- ready: ${report.ready}
- evidencePath: \`${report.evidencePath}\`
- modelName: ${report.evidence.modelName ?? ""}
- computerName: ${report.evidence.computerName ?? ""}
- userName: ${report.evidence.userName ?? ""}
- completedAt: ${report.evidence.completedAt ?? ""}

## 필수 점검

${report.requiredChecks
  .map((check) => {
    const status = check.present && check.passed ? "PASS" : "FAIL";
    return `- ${status} ${check.name}: ${check.detail ?? ""}`;
  })
  .join("\n")}

## 오류

${report.errors.length === 0 ? "- 없음" : report.errors.map((error) => `- ${error}`).join("\n")}
`;
}

export async function validateCleanAccountEvidence(options = {}) {
  const evidencePath = resolve(options.evidencePath ?? resolve(REPO_ROOT, DEFAULT_EVIDENCE_PATH));
  const outJson = resolve(REPO_ROOT, options.outJson ?? DEFAULT_OUT_JSON);
  const outMarkdown = resolve(REPO_ROOT, options.outMarkdown ?? DEFAULT_OUT_MARKDOWN);
  const expectedModel = options.expectedModel ?? EXPECTED_MODEL;
  const errors = [];

  if (!(await exists(evidencePath))) {
    throw new Error(`Clean-account evidence JSON not found: ${evidencePath}`);
  }

  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  if (evidence.ready !== true) {
    errors.push("Evidence ready must be true.");
  }
  if (evidence.modelName !== expectedModel) {
    errors.push(`Expected modelName ${expectedModel}, got ${evidence.modelName ?? "(missing)"}.`);
  }
  if (!hasText(evidence.computerName)) {
    errors.push("computerName is missing.");
  }
  if (!hasText(evidence.userName)) {
    errors.push("userName is missing.");
  }
  if (!hasText(evidence.completedAt)) {
    errors.push("completedAt is missing.");
  }
  if (!hasText(evidence.textResponse)) {
    errors.push("textResponse is missing.");
  }
  if (!hasText(evidence.imageResponse)) {
    errors.push("imageResponse is missing.");
  }
  if (!evidence.installLog?.exists) {
    errors.push("installLog.exists must be true.");
  }
  if (!evidence.validateLog?.exists) {
    errors.push("validateLog.exists must be true.");
  }

  const requiredChecks = REQUIRED_CHECKS.map((name) => {
    const check = checkByName(evidence, name);
    const item = {
      name,
      present: Boolean(check),
      passed: check?.passed === true,
      detail: check?.detail ?? "",
    };
    if (!item.present) {
      errors.push(`Required check is missing: ${name}`);
    } else if (!item.passed) {
      errors.push(`Required check failed: ${name} - ${item.detail}`);
    }
    return item;
  });

  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    ready: errors.length === 0,
    evidencePath,
    evidence: {
      ready: evidence.ready,
      modelName: evidence.modelName,
      computerName: evidence.computerName,
      userName: evidence.userName,
      os: evidence.os,
      completedAt: evidence.completedAt,
      packageDir: evidence.packageDir,
      installLog: evidence.installLog,
      validateLog: evidence.validateLog,
    },
    requiredChecks,
    errors,
  };

  await mkdir(dirname(outJson), { recursive: true });
  await writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(outMarkdown, buildMarkdown(report), "utf8");
  return report;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--evidence") options.evidencePath = argv[++index];
    else if (arg === "--out") options.outJson = argv[++index];
    else if (arg === "--markdown") options.outMarkdown = argv[++index];
    else if (arg === "--expected-model") options.expectedModel = argv[++index];
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node scripts/validate-clean-account-evidence.mjs --evidence <json>

Options:
  --evidence <path>       Evidence JSON copied from target PC.
  --out <path>            Validation JSON output.
  --markdown <path>       Validation Markdown output.
  --expected-model <name> Expected Ollama model. Defaults to gemma4:e2b.
`);
    return;
  }
  const report = await validateCleanAccountEvidence(options);
  console.log(JSON.stringify({ ready: report.ready, errors: report.errors }, null, 2));
  if (!report.ready) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
