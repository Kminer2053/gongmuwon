import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const REGISTRY = "https://registry.ollama.ai";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

function parseModelRef(modelRef) {
  const [modelName, tag = "latest"] = modelRef.split(":");
  if (!modelName || modelName.includes("/")) {
    throw new Error(`Only Ollama library model refs are supported, got: ${modelRef}`);
  }
  return { modelName, tag };
}

function blobFileName(digest) {
  return digest.replace(":", "-");
}

async function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(`sha256:${hash.digest("hex")}`));
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.docker.distribution.manifest.v2+json" },
  });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return response.json();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown";
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function downloadBlob({ url, destination, expectedDigest, expectedSize }) {
  if (await exists(destination)) {
    const current = await stat(destination);
    if (current.size === expectedSize) {
      const digest = await sha256(destination);
      if (digest === expectedDigest) {
        console.log(`skip ${blobFileName(expectedDigest)} (${formatBytes(expectedSize)})`);
        return;
      }
    }
  }

  await ensureDir(dirname(destination));
  const tempPath = `${destination}.download`;
  if (await exists(tempPath)) await unlink(tempPath);

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }

  console.log(`download ${blobFileName(expectedDigest)} (${formatBytes(expectedSize)})`);
  const file = createWriteStream(tempPath);
  const body = Readable.fromWeb(response.body);
  let written = 0;
  let lastLogAt = Date.now();

  await new Promise((resolveDone, reject) => {
    body.on("data", (chunk) => {
      written += chunk.length;
      const now = Date.now();
      if (now - lastLogAt > 5000) {
        const percent = expectedSize ? ((written / expectedSize) * 100).toFixed(1) : "?";
        console.log(`  ${formatBytes(written)} / ${formatBytes(expectedSize)} (${percent}%)`);
        lastLogAt = now;
      }
    });
    body.on("error", reject);
    file.on("error", reject);
    file.on("finish", resolveDone);
    body.pipe(file);
  });

  const digest = await sha256(tempPath);
  if (digest !== expectedDigest) {
    throw new Error(`Digest mismatch for ${destination}: expected ${expectedDigest}, got ${digest}`);
  }
  await rename(tempPath, destination);
}

export async function downloadOllamaModelStore(options = {}) {
  const modelRef = options.model ?? "gemma4:e2b";
  const outDir = resolve(options.outDir ?? join(process.cwd(), "runtime-workspace", "cache", "ollama-models", modelRef.replace(/[:/]/g, "-")));
  const { modelName, tag } = parseModelRef(modelRef);
  const manifestUrl = `${REGISTRY}/v2/library/${modelName}/manifests/${tag}`;
  const manifest = await fetchJson(manifestUrl);
  const manifestPath = join(outDir, "manifests", "registry.ollama.ai", "library", modelName, tag);
  await ensureDir(dirname(manifestPath));
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

  const descriptors = [manifest.config, ...(manifest.layers ?? [])].filter(Boolean);
  const totalSize = descriptors.reduce((sum, descriptor) => sum + (descriptor.size ?? 0), 0);
  console.log(`model ${modelRef}: ${descriptors.length} blobs, ${formatBytes(totalSize)}`);

  for (const descriptor of descriptors) {
    await downloadBlob({
      url: `${REGISTRY}/v2/library/${modelName}/blobs/${descriptor.digest}`,
      destination: join(outDir, "blobs", blobFileName(descriptor.digest)),
      expectedDigest: descriptor.digest,
      expectedSize: descriptor.size,
    });
  }

  const metadata = {
    model: modelRef,
    registry: REGISTRY,
    manifestUrl,
    totalSize,
    downloadedAt: new Date().toISOString(),
    blobs: descriptors.map((descriptor) => ({
      digest: descriptor.digest,
      size: descriptor.size,
      mediaType: descriptor.mediaType,
    })),
  };
  await writeFile(join(outDir, "GONGMU_MODEL_CACHE.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return { outDir, metadata };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--model") {
      options.model = argv[++index];
    } else if (arg === "--out-dir") {
      options.outDir = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

const currentFile = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] ?? "") === currentFile) {
  downloadOllamaModelStore(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(`model store ready: ${result.outDir}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { parseModelRef };
