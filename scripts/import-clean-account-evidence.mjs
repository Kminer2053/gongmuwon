import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateCleanAccountEvidence } from "./validate-clean-account-evidence.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE_DIR = "release/clean-account-evidence-inbox";
const DEFAULT_OUTPUT_DIR = "docs/operations/generated/clean-account-evidence";
const DEFAULT_VALIDATION_JSON = "docs/operations/generated/clean-account-evidence-validation.json";
const DEFAULT_VALIDATION_MARKDOWN = "docs/operations/generated/clean-account-evidence-validation.md";
const DEFAULT_IMPORT_JSON = "docs/operations/generated/clean-account-evidence-import.json";
const DEFAULT_IMPORT_MARKDOWN = "docs/operations/generated/clean-account-evidence-import.md";
const REQUIRED_EVIDENCE_JSON = "ai-pack-clean-account-evidence.json";
const OPTIONAL_EVIDENCE_FILES = [
  "ai-pack-clean-account-evidence.md",
  "collect-clean-account-evidence.log",
  "install-gongmu-ai.log",
  "validate-gongmu-ai.log",
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readSourceInfo(path) {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new Error(`Evidence source directory not found: ${path}`);
  }
  return info;
}

async function detectEvidenceSource(sourcePath) {
  const sourceInfo = await readSourceInfo(sourcePath);
  if (sourceInfo.isFile()) {
    if (basename(sourcePath) !== REQUIRED_EVIDENCE_JSON) {
      throw new Error(`Evidence source file must be ${REQUIRED_EVIDENCE_JSON}: ${sourcePath}`);
    }
    const evidenceDir = dirname(sourcePath);
    return {
      kind: "evidence-json-file",
      sourceDir: sourcePath,
      evidenceDir,
      packageRoot: basename(evidenceDir).toLowerCase() === "evidence" ? dirname(evidenceDir) : evidenceDir,
    };
  }

  if (!sourceInfo.isDirectory()) {
    throw new Error(`Evidence source directory must be a directory or ${REQUIRED_EVIDENCE_JSON} file: ${sourcePath}`);
  }

  const sourceDir = sourcePath;
  const directEvidence = join(sourceDir, REQUIRED_EVIDENCE_JSON);
  if (await exists(directEvidence)) {
    return {
      kind: "evidence-folder",
      sourceDir,
      evidenceDir: sourceDir,
      packageRoot: sourceDir,
    };
  }

  const nestedEvidenceDir = join(sourceDir, "evidence");
  const nestedEvidence = join(nestedEvidenceDir, REQUIRED_EVIDENCE_JSON);
  if (await exists(nestedEvidence)) {
    return {
      kind: "package-root",
      sourceDir,
      evidenceDir: nestedEvidenceDir,
      packageRoot: sourceDir,
    };
  }

  throw new Error(
    `Required evidence file not found. Expected ${directEvidence} or ${nestedEvidence}.`,
  );
}

async function copyIfPresent(sourceDir, outputDir, fileName, required = false) {
  const source = join(sourceDir, fileName);
  const present = await exists(source);
  if (!present && required) {
    throw new Error(`Required evidence file not found: ${source}`);
  }
  if (!present) {
    return null;
  }
  const target = join(outputDir, fileName);
  await copyFile(source, target);
  const info = await stat(target);
  return {
    name: fileName,
    source,
    target,
    bytes: info.size,
    required,
  };
}

async function copyFirstPresent(sourceDirs, outputDir, fileName, required = false) {
  for (const sourceDir of sourceDirs) {
    const item = await copyIfPresent(sourceDir, outputDir, fileName, false);
    if (item) {
      return item;
    }
  }
  if (required) {
    throw new Error(`Required evidence file not found: ${sourceDirs.map((dir) => join(dir, fileName)).join(" or ")}`);
  }
  return null;
}

function buildMarkdown(report) {
  return `# Clean-account evidence import

- createdAt: ${report.createdAt}
- ready: ${report.ready}
- sourceDir: \`${report.sourceDir}\`
- detectedSourceKind: ${report.detectedSourceKind}
- outputDir: \`${report.outputDir}\`
- validationReady: ${report.validation.ready}

## Copied files

${report.files.map((file) => `- ${file.name}: ${file.bytes} bytes`).join("\n")}

## Validation

- validationJson: \`${report.validationJson}\`
- validationMarkdown: \`${report.validationMarkdown}\`
- errors: ${report.validation.errors.length}

${report.validation.errors.length === 0 ? "- No validation errors." : report.validation.errors.map((error) => `- ${error}`).join("\n")}
`;
}

export async function importCleanAccountEvidence(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
  const sourceDir = resolve(repoRoot, options.sourceDir ?? DEFAULT_SOURCE_DIR);
  const outputDir = resolve(repoRoot, options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const validationJson = resolve(repoRoot, options.validationJson ?? DEFAULT_VALIDATION_JSON);
  const validationMarkdown = resolve(repoRoot, options.validationMarkdown ?? DEFAULT_VALIDATION_MARKDOWN);
  const importJson = resolve(repoRoot, options.importJson ?? DEFAULT_IMPORT_JSON);
  const importMarkdown = resolve(repoRoot, options.importMarkdown ?? DEFAULT_IMPORT_MARKDOWN);

  const detected = await detectEvidenceSource(sourceDir);
  await mkdir(outputDir, { recursive: true });
  await mkdir(dirname(validationJson), { recursive: true });
  await mkdir(dirname(importJson), { recursive: true });

  const copied = [];
  copied.push(await copyIfPresent(detected.evidenceDir, outputDir, REQUIRED_EVIDENCE_JSON, true));
  const candidateDirs = [detected.evidenceDir, detected.packageRoot];
  for (const fileName of OPTIONAL_EVIDENCE_FILES) {
    const item = await copyFirstPresent(candidateDirs, outputDir, fileName, false);
    if (item) {
      copied.push(item);
    }
  }

  const extraFiles = (await readdir(detected.evidenceDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg"))
    .sort();
  for (const fileName of extraFiles) {
    const item = await copyIfPresent(detected.evidenceDir, outputDir, fileName, false);
    if (item) {
      copied.push(item);
    }
  }

  const evidencePath = join(outputDir, REQUIRED_EVIDENCE_JSON);
  const validation = await validateCleanAccountEvidence({
    evidencePath,
    outJson: validationJson,
    outMarkdown: validationMarkdown,
  });

  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    ready: validation.ready,
    sourceDir,
    detectedSourceKind: detected.kind,
    evidenceSourceDir: detected.evidenceDir,
    outputDir,
    evidencePath,
    validationJson,
    validationMarkdown,
    files: copied.filter(Boolean).map((item) => ({
      ...item,
      name: basename(item.name),
    })),
    validation: {
      ready: validation.ready,
      evidence: validation.evidence,
      errors: validation.errors,
    },
  };

  await writeFile(importJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(importMarkdown, buildMarkdown(report), "utf8");
  return report;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") options.sourceDir = argv[++index];
    else if (arg === "--out-dir") options.outputDir = argv[++index];
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node scripts/import-clean-account-evidence.mjs --from <target-evidence-dir-or-json>

Options:
  --from <path>    Evidence copied from target PC. Defaults to release/clean-account-evidence-inbox.
                 Accepts the evidence folder, the extracted AI pack root that contains evidence\\,
                 or the ai-pack-clean-account-evidence.json file itself.
  --out-dir <dir>  Repository evidence output directory.
`);
    return;
  }
  const report = await importCleanAccountEvidence(options);
  console.log(JSON.stringify({ ready: report.ready, outputDir: report.outputDir, errors: report.validation.errors }, null, 2));
  if (!report.ready) {
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
