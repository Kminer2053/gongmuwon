#!/usr/bin/env node
/**
 * kordoc 러너를 설치본용 자립 번들로 만든다.
 *
 * 배경(2026-07-13 수용 테스트 발견): kordoc_runner.js는 `import "kordoc"`으로
 * 리포 node_modules에 의존한다. PyInstaller 사이드카에는 node_modules가 없어
 * 설치본에서 HWP 170건 전부가 조용히 metadata-fallback(품질 0.0)으로 떨어졌다.
 *
 * 해결:
 *  1) esbuild로 러너+kordoc 의존성 전체를 단일 kordoc_runner.js로 인라인
 *  2) 폐쇄망 사용자 PC에는 Node가 없으므로 빌드 머신의 node.exe를 함께 동봉
 *  3) 동봉한 node.exe로 `--selftest`를 실제 실행해 번들이 살아있는지 증명
 *
 * 산출물(스테이징): runtime-workspace/cache/kordoc-bundle/
 *   kordoc_runner.js  — 자립 번들 (node_modules 불필요)
 *   node.exe          — 동봉 Node 런타임 (MIT)
 * PyInstaller spec이 이 스테이징을 packaging/kordoc으로 수집한다.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(repoRoot, "services", "sidecar", "packaging", "kordoc", "kordoc_runner.js");
const outDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, "runtime-workspace", "cache", "kordoc-bundle");
const outfile = path.join(outDir, "kordoc_runner.js");
const bundledNode = path.join(outDir, "node.exe");

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node18"],
  outdir: outDir,
  // 코드 스플리팅 유지가 핵심: kordoc dist의 지연 파서 청크를 단일 파일로 합치면
  // PDF 청크의 external import가 최상위 정적 import로 승격돼 로드 즉시 실패한다.
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  legalComments: "none",
  logLevel: "warning",
  // PDF·OCR용 무거운 선택 의존성은 제외한다. 리포에도 pdfjs-dist가 설치돼 있지
  // 않은 채 HWP/HWPX 파싱이 동작해 왔으므로(파서 청크가 지연 로드) 안전하다.
  // 공무원 사이드카는 kordoc을 HWP/HWPX 전용으로만 쓴다(PDF는 파이썬 파서 담당).
  external: [
    "pdfjs-dist",
    "pdfjs-dist/*",
    "onnxruntime-node",
    "@huggingface/transformers",
    "sharp",
  ],
  // CJS 의존성(cfb/jszip 등)이 남긴 동적 require를 ESM 번들에서 살리는 표준 배너
  banner: {
    js: "import { createRequire as __gongmuCreateRequire } from 'node:module';\nconst require = __gongmuCreateRequire(import.meta.url);",
  },
});

// ESM 청크를 확정적으로 ESM으로 로드하게 한다 (사이드카 번들에는 상위 package.json이 없음)
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }) + "\n");

// 폐쇄망 대응: 빌드 머신의 Node 런타임 동봉
copyFileSync(process.execPath, bundledNode);

// 셀프테스트는 동봉 node.exe로 실행 — 설치본과 동일한 조합을 그대로 검증한다.
const selftest = spawnSync(bundledNode, [outfile, "--selftest"], {
  encoding: "utf8",
  timeout: 60000,
});
let parsed = null;
try {
  parsed = JSON.parse(String(selftest.stdout || "").trim().split("\n").pop());
} catch {
  parsed = null;
}
if (!parsed || parsed.success !== true) {
  console.error("kordoc bundle selftest FAILED");
  console.error("stdout:", selftest.stdout);
  console.error("stderr:", selftest.stderr);
  process.exit(1);
}

// 실제 파싱 스모크: 리포 내장 HWPX 표준양식을 동봉 node.exe + 번들로 파싱해 본다.
// (import 셀프테스트만으로는 파서 청크의 지연 의존성 문제를 못 잡는다)
const fixture = path.join(
  repoRoot,
  "services", "sidecar", "src", "gongmu_sidecar",
  "public_doc_templates", "format_1p", "standard.hwpx",
);
const parseSmoke = spawnSync(bundledNode, [outfile, fixture], { encoding: "utf8", timeout: 60000 });
let smoke = null;
try {
  smoke = JSON.parse(String(parseSmoke.stdout || "").trim().split("\n").pop());
} catch {
  smoke = null;
}
if (!smoke || smoke.success !== true) {
  console.error("kordoc bundle HWPX parse smoke FAILED");
  console.error("stdout:", parseSmoke.stdout);
  console.error("stderr:", parseSmoke.stderr);
  process.exit(1);
}

const sizeMb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
console.log(
  JSON.stringify(
    {
      bundled: path.relative(repoRoot, outfile),
      runner_mb: sizeMb(statSync(outfile).size),
      node_exe: path.relative(repoRoot, bundledNode),
      node_mb: sizeMb(statSync(bundledNode).size),
      selftest: "ok",
      hwpx_parse_smoke: "ok",
      kordoc_version: parsed.version ?? "",
    },
    null,
    2,
  ),
);
