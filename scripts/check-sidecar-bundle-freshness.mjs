#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

const DEFAULT_SOURCE_DIRS = [
  "services/sidecar/src/gongmu_sidecar",
  "services/sidecar/packaging",
  "services/sidecar/pyproject.toml",
];
const DEFAULT_EXTENSIONS = [".py", ".toml", ".spec", ".json", ".md", ".hwpx", ".xml"];
const DEFAULT_EXE = "apps/desktop/src-tauri/resources/sidecar/windows-x64/gongmu-sidecar/gongmu-sidecar.exe";
const DEFAULT_MANIFEST =
  "apps/desktop/src-tauri/resources/sidecar/windows-x64/gongmu-sidecar/gongmu-sidecar.bundle-manifest.json";

function normalizeExtensions(value) {
  return value
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
}

export function parseFreshnessArgs(argv = process.argv.slice(2)) {
  const parsed = {
    sourceDir: null,
    executable: null,
    manifestPath: null,
    outPath: null,
    extensions: DEFAULT_EXTENSIONS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      parsed.sourceDir = argv[++index];
    } else if (arg === "--exe") {
      parsed.executable = argv[++index];
    } else if (arg === "--manifest") {
      parsed.manifestPath = argv[++index];
    } else if (arg === "--out") {
      parsed.outPath = argv[++index];
    } else if (arg === "--ext") {
      parsed.extensions = normalizeExtensions([argv[++index] ?? ""]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

export function writeFreshnessReport(result, outPath) {
  const report = {
    generated_at: new Date().toISOString(),
    ...result,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function shouldSkipSourceEntry(entryName) {
  return entryName === "__pycache__" || entryName.endsWith(".egg-info");
}

function newestOf(left, right) {
  if (!left) return right;
  if (!right) return left;
  return right.mtimeMs > left.mtimeMs ? right : left;
}

export function collectNewestFileMtime(rootPath, extensions = DEFAULT_EXTENSIONS, basePath = rootPath) {
  if (!fs.existsSync(rootPath)) {
    return null;
  }

  const stat = fs.statSync(rootPath);
  if (stat.isFile()) {
    if (!extensions.includes(path.extname(rootPath))) {
      return null;
    }
    return {
      path: rootPath,
      relativePath: path.relative(basePath, rootPath) || path.basename(rootPath),
      mtimeMs: stat.mtimeMs,
      mtimeIso: stat.mtime.toISOString(),
    };
  }

  let newest = null;
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (shouldSkipSourceEntry(entry.name)) {
      continue;
    }
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      newest = newestOf(newest, collectNewestFileMtime(fullPath, extensions, basePath));
    } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
      const entryStat = fs.statSync(fullPath);
      newest = newestOf(newest, {
        path: fullPath,
        relativePath: path.relative(basePath, fullPath),
        mtimeMs: entryStat.mtimeMs,
        mtimeIso: entryStat.mtime.toISOString(),
      });
    }
  }
  return newest;
}

function collectSourceFiles(rootPath, extensions = DEFAULT_EXTENSIONS, basePath = rootPath) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const stat = fs.statSync(rootPath);
  if (stat.isFile()) {
    if (!extensions.includes(path.extname(rootPath))) {
      return [];
    }
    return [
      {
        path: rootPath,
        relativePath: path.relative(basePath, rootPath) || path.basename(rootPath),
      },
    ];
  }

  const files = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (shouldSkipSourceEntry(entry.name)) {
      continue;
    }
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath, extensions, basePath));
    } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
      files.push({
        path: fullPath,
        relativePath: path.relative(basePath, fullPath),
      });
    }
  }
  return files;
}

export function computeSourceFingerprint(
  sourceDir = DEFAULT_SOURCE_DIRS,
  extensions = DEFAULT_EXTENSIONS,
  { repoRoot: root = repoRoot } = {},
) {
  const sources = Array.isArray(sourceDir) ? sourceDir : [sourceDir];
  const files = sources
    .flatMap((candidate) => {
      const absoluteSource = path.resolve(root, candidate);
      return collectSourceFiles(absoluteSource, extensions, root);
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file.path));
    hash.update("\0");
  }

  return {
    algorithm: "sha256",
    sha256: hash.digest("hex"),
    file_count: files.length,
    files: files.map((file) => file.relativePath.replaceAll("\\", "/")),
  };
}

export function buildSidecarBundleManifest({
  sourceFingerprint,
  executable,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!sourceFingerprint) {
    throw new Error("sourceFingerprint is required");
  }
  const executableSha256 = executable && fs.existsSync(executable)
    ? crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex")
    : null;

  return {
    schema_version: 1,
    generated_at: generatedAt,
    source_fingerprint: sourceFingerprint,
    executable: executable
      ? {
          name: path.basename(executable),
          sha256: executableSha256,
        }
      : null,
  };
}

export function writeSidecarBundleManifest({
  manifestPath = DEFAULT_MANIFEST,
  sourceDir = DEFAULT_SOURCE_DIRS,
  executable = DEFAULT_EXE,
  extensions = DEFAULT_EXTENSIONS,
  repoRoot: root = repoRoot,
  generatedAt = new Date().toISOString(),
} = {}) {
  const absoluteManifestPath = path.resolve(root, manifestPath);
  const absoluteExecutable = path.resolve(root, executable);
  const manifest = buildSidecarBundleManifest({
    sourceFingerprint: computeSourceFingerprint(sourceDir, extensions, { repoRoot: root }),
    executable: absoluteExecutable,
    generatedAt,
  });
  fs.mkdirSync(path.dirname(absoluteManifestPath), { recursive: true });
  fs.writeFileSync(absoluteManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function evaluateSidecarBundleFreshness({
  repoRoot: root = repoRoot,
  sourceDir = DEFAULT_SOURCE_DIRS,
  executable = DEFAULT_EXE,
  manifestPath = DEFAULT_MANIFEST,
  extensions = DEFAULT_EXTENSIONS,
} = {}) {
  const sources = Array.isArray(sourceDir) ? sourceDir : [sourceDir];
  const absoluteExe = path.resolve(root, executable);
  const absoluteManifestPath = path.resolve(root, manifestPath);
  if (!fs.existsSync(absoluteExe)) {
    return {
      status: "missing",
      executable: absoluteExe,
      reason: `Bundled sidecar executable is missing: ${absoluteExe}`,
    };
  }

  const exeStat = fs.statSync(absoluteExe);
  const newestSource = sources
    .map((candidate) => {
      const absoluteSource = path.resolve(root, candidate);
      return collectNewestFileMtime(absoluteSource, extensions, absoluteSource);
    })
    .reduce(newestOf, null);

  if (!newestSource) {
    return {
      status: "unknown",
      executable: absoluteExe,
      executable_mtime: exeStat.mtime.toISOString(),
      reason: "No sidecar source files were found for freshness comparison.",
    };
  }

  const status = newestSource.mtimeMs > exeStat.mtimeMs ? "stale" : "fresh";
  if (status === "stale") {
    return {
      status,
      executable: absoluteExe,
      executable_mtime: exeStat.mtime.toISOString(),
      manifest: fs.existsSync(absoluteManifestPath) ? JSON.parse(fs.readFileSync(absoluteManifestPath, "utf8")) : null,
      newest_source: newestSource,
      reason: `${newestSource.relativePath} is newer than bundled sidecar; regenerate sidecar bundle.`,
    };
  }

  if (!fs.existsSync(absoluteManifestPath)) {
    return {
      status: "missing-manifest",
      executable: absoluteExe,
      executable_mtime: exeStat.mtime.toISOString(),
      manifest_path: absoluteManifestPath,
      newest_source: newestSource,
      reason: `Bundled sidecar manifest is missing: ${absoluteManifestPath}`,
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(absoluteManifestPath, "utf8"));
  } catch (error) {
    return {
      status: "invalid-manifest",
      executable: absoluteExe,
      executable_mtime: exeStat.mtime.toISOString(),
      manifest_path: absoluteManifestPath,
      newest_source: newestSource,
      reason: `Bundled sidecar manifest is not valid JSON: ${error.message}`,
    };
  }

  const currentFingerprint = computeSourceFingerprint(sources, extensions, { repoRoot: root });
  if (manifest?.source_fingerprint?.sha256 !== currentFingerprint.sha256) {
    return {
      status: "manifest-mismatch",
      executable: absoluteExe,
      executable_mtime: exeStat.mtime.toISOString(),
      manifest_path: absoluteManifestPath,
      manifest,
      current_source_fingerprint: currentFingerprint,
      newest_source: newestSource,
      reason: "Bundled sidecar manifest source fingerprint does not match current sidecar source inputs.",
    };
  }

  return {
    status,
    executable: absoluteExe,
    executable_mtime: exeStat.mtime.toISOString(),
    manifest_path: absoluteManifestPath,
    manifest,
    current_source_fingerprint: currentFingerprint,
    newest_source: newestSource,
    reason: "Bundled sidecar manifest matches current sidecar source inputs.",
  };
}

function main() {
  const args = parseFreshnessArgs();
  const result = evaluateSidecarBundleFreshness({
    sourceDir: args.sourceDir ?? DEFAULT_SOURCE_DIRS,
    executable: args.executable ?? DEFAULT_EXE,
    manifestPath: args.manifestPath ?? DEFAULT_MANIFEST,
    extensions: args.extensions,
  });
  const report = args.outPath ? writeFreshnessReport(result, path.resolve(repoRoot, args.outPath)) : result;
  console.log(JSON.stringify(result, null, 2));
  if (report.status !== "fresh") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
