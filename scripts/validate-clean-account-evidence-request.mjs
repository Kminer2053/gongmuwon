#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ARTIFACT_REPORT = "docs/operations/generated/ai-pack-artifact-validation.json";
const DEFAULT_REQUEST_JSON = "release/clean-account-evidence-request/REQUEST.json";
const DEFAULT_REQUEST_README = "release/clean-account-evidence-request/README.md";
const DEFAULT_OUT_JSON = "docs/operations/generated/clean-account-evidence-request-validation.json";
const DEFAULT_OUT_MARKDOWN = "docs/operations/generated/clean-account-evidence-request-validation.md";

function samePath(left, right) {
  return String(left ?? "").replace(/\\/g, "/") === String(right ?? "").replace(/\\/g, "/");
}

function addCheck(checks, name, ok, detail) {
  checks.push({ name, ok, detail: detail ?? "" });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function buildMarkdown(report) {
  return `# clean-account evidence request validation

- createdAt: ${report.createdAt}
- ready: ${report.ready}
- artifactReportPath: \`${report.artifactReportPath}\`
- requestPath: \`${report.requestPath}\`

## Checks

${report.checks.map((check) => `- ${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`).join("\n")}

## Errors

${report.errors.length === 0 ? "- none" : report.errors.map((error) => `- ${error}`).join("\n")}
`;
}

export async function validateCleanAccountEvidenceRequest(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
  const artifactReportPath = resolve(repoRoot, options.artifactReportPath ?? DEFAULT_ARTIFACT_REPORT);
  const requestPath = resolve(repoRoot, options.requestPath ?? DEFAULT_REQUEST_JSON);
  const requestReadmePath = resolve(repoRoot, options.requestReadmePath ?? DEFAULT_REQUEST_README);
  const outJson = resolve(repoRoot, options.outJson ?? DEFAULT_OUT_JSON);
  const outMarkdown = resolve(repoRoot, options.outMarkdown ?? DEFAULT_OUT_MARKDOWN);

  const artifact = await readJson(artifactReportPath);
  const request = await readJson(requestPath);
  const readme = await readFile(requestReadmePath, "utf8");
  const checks = [];

  addCheck(checks, "AI pack artifact validation is ready", artifact.ready === true, `ready=${artifact.ready}`);
  addCheck(checks, "request is ready", request.ready === true, `ready=${request.ready}`);
  addCheck(
    checks,
    "request zip path matches latest AI pack",
    samePath(request.artifact?.zipPath, artifact.zip?.path),
    `${request.artifact?.zipPath ?? ""}`,
  );
  addCheck(
    checks,
    "request zip SHA256 matches latest AI pack",
    request.artifact?.zipSha256 === artifact.zip?.sha256,
    `${request.artifact?.zipSha256 ?? ""}`,
  );
  addCheck(
    checks,
    "request zip size matches latest AI pack",
    request.artifact?.zipSizeBytes === artifact.zip?.sizeBytes,
    `${request.artifact?.zipSizeBytes ?? ""}`,
  );
  addCheck(
    checks,
    "request model matches latest AI pack",
    request.artifact?.modelName === artifact.manifest?.model?.name,
    `${request.artifact?.modelName ?? ""}`,
  );
  addCheck(
    checks,
    "request keeps multimodal embedded model flags",
    request.artifact?.multimodal === artifact.manifest?.model?.multimodal &&
      request.artifact?.modelEmbedded === artifact.manifest?.model?.embedded,
    `multimodal=${request.artifact?.multimodal}; embedded=${request.artifact?.modelEmbedded}`,
  );
  addCheck(
    checks,
    "target PC steps prefer one-click validation",
    Array.isArray(request.targetPcSteps) && request.targetPcSteps.includes("run RUN_FULL_VALIDATION.bat"),
    (request.targetPcSteps ?? []).join(" | "),
  );
  addCheck(
    checks,
    "README mentions one-click validation launcher",
    readme.includes("RUN_FULL_VALIDATION.bat"),
    requestReadmePath,
  );
  addCheck(
    checks,
    "request points to clean-account evidence JSON",
    String(request.copyBack?.sourcePathOnTargetPc ?? "").includes("ai-pack-clean-account-evidence.json") &&
      String(request.copyBack?.targetPath ?? "").includes("ai-pack-clean-account-evidence.json"),
    `${request.copyBack?.sourcePathOnTargetPc ?? ""} -> ${request.copyBack?.targetPath ?? ""}`,
  );
  addCheck(
    checks,
    "request includes repository validation command",
    String(request.copyBack?.validationCommand ?? "").includes("release:ai-pack:evidence:validate") ||
      String(request.copyBack?.validationCommand ?? "").includes("release:ai-pack:evidence:import"),
    `${request.copyBack?.validationCommand ?? ""}`,
  );

  const errors = checks.filter((check) => !check.ok).map((check) => check.name);
  const report = {
    schemaVersion: 1,
    createdAt: request.createdAt ?? artifact.createdAt ?? null,
    ready: errors.length === 0,
    artifactReportPath,
    requestPath,
    requestReadmePath,
    artifact: {
      packageDir: artifact.packageDir,
      zipPath: artifact.zip?.path,
      zipSha256: artifact.zip?.sha256,
      modelName: artifact.manifest?.model?.name,
    },
    request: {
      artifact: request.artifact,
      copyBack: request.copyBack,
      targetPcSteps: request.targetPcSteps,
    },
    checks,
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
    if (arg === "--artifact-report") options.artifactReportPath = argv[++index];
    else if (arg === "--request") options.requestPath = argv[++index];
    else if (arg === "--readme") options.requestReadmePath = argv[++index];
    else if (arg === "--out") options.outJson = argv[++index];
    else if (arg === "--markdown") options.outMarkdown = argv[++index];
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node scripts/validate-clean-account-evidence-request.mjs [options]

Options:
  --artifact-report <path>  AI pack artifact validation JSON.
  --request <path>          Clean-account evidence REQUEST.json.
  --readme <path>           Clean-account evidence request README.md.
  --out <path>              JSON report path.
  --markdown <path>         Markdown report path.
`);
    return;
  }
  const report = await validateCleanAccountEvidenceRequest(options);
  console.log(JSON.stringify({ ready: report.ready, errors: report.errors }, null, 2));
  if (!report.ready) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
