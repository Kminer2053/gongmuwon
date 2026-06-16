#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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

async function readOptionalText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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

function readmeKeepsSinglePrimaryFinalizer(readme) {
  const normalized = readme.replace(/\r\n/g, "\n");
  const directDuplicatePattern =
    /run\s+(?:npm\.cmd\s+run\s+)?release:ai-pack:evidence:finalize\s+(?:and|then|&|\n)\s*(?:run\s+)?(?:npm\.cmd\s+run\s+)?release:runtime-evidence:validate/i;
  return !directDuplicatePattern.test(normalized);
}

function hasLikelyMojibake(text) {
  return /[\uFFFD\u4E00-\u9FFF]/u.test(text);
}

function hasReadableKoreanGuidance(text, requiredPhrases) {
  return requiredPhrases.every((phrase) => text.includes(phrase)) && !hasLikelyMojibake(text);
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
  const requestDir = dirname(requestPath);
  const runtimeScriptPath = join(requestDir, "COLLECT_RUNTIME_EVIDENCE.ps1");
  const runtimeBatchPath = join(requestDir, "COLLECT_RUNTIME_EVIDENCE.bat");
  const runtimeTemplatePath = join(requestDir, "runtime-clean-account-evidence.template.json");
  const runtimeScript = await readOptionalText(runtimeScriptPath);
  const runtimeBatch = await readOptionalText(runtimeBatchPath);
  const runtimeTemplate = await readOptionalText(runtimeTemplatePath);
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
    "request points to clean-account evidence inbox",
    String(request.copyBack?.sourcePathOnTargetPc ?? "").replace(/\\/g, "/").includes("evidence") &&
      String(request.copyBack?.targetPath ?? "").replace(/\\/g, "/").includes("release/clean-account-evidence-inbox"),
    `${request.copyBack?.sourcePathOnTargetPc ?? ""} -> ${request.copyBack?.targetPath ?? ""}`,
  );
  addCheck(
    checks,
    "request includes repository finalization command",
    String(request.copyBack?.validationCommand ?? "").includes("release:ai-pack:evidence:finalize"),
    `${request.copyBack?.validationCommand ?? ""}`,
  );
  addCheck(
    checks,
    "README keeps finalizer as the single primary repository command",
    readmeKeepsSinglePrimaryFinalizer(readme),
    "release:runtime-evidence:validate may be mentioned only as a runtime-only fallback or as work performed inside the finalizer",
  );
  addCheck(
    checks,
    "README has readable Korean operator guidance",
    hasReadableKoreanGuidance(readme, ["클린계정", "대상 PC", "업무엔진"]),
    "README must include readable Korean headings/instructions for target-PC operators and no likely mojibake",
  );
  addCheck(
    checks,
    "request includes runtime validation command",
    String(request.copyBack?.runtimeValidationCommand ?? "").includes("release:runtime-evidence:validate") &&
      (request.targetPcSteps ?? []).some((step) => String(step).includes("COLLECT_RUNTIME_EVIDENCE.bat")) &&
      readme.includes("COLLECT_RUNTIME_EVIDENCE.bat"),
    `${request.copyBack?.runtimeValidationCommand ?? ""}`,
  );
  addCheck(
    checks,
    "request includes runtime evidence collector",
    (await exists(runtimeScriptPath)) &&
      (await exists(runtimeBatchPath)) &&
      (await exists(runtimeTemplatePath)) &&
      runtimeScript.includes("Invoke-RestMethod") &&
      runtimeScript.includes("Work engine health OK") &&
      runtimeScript.includes("runtime-clean-account-evidence.json") &&
      runtimeBatch.includes("COLLECT_RUNTIME_EVIDENCE.ps1") &&
      runtimeTemplate.includes("Work engine health OK"),
    `${runtimeScriptPath}; ${runtimeBatchPath}; ${runtimeTemplatePath}`,
  );
  addCheck(
    checks,
    "runtime evidence template has readable Korean guidance",
    hasReadableKoreanGuidance(runtimeTemplate, ["업무엔진"]),
    "runtime evidence template must keep Korean check details readable and no likely mojibake",
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
