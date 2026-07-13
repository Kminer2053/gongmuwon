#!/usr/bin/env node
/**
 * kordoc 러너를 설치본용 자립 스테이징으로 만든다.
 *
 * 배경(2026-07-13 수용 테스트 발견): kordoc_runner.js는 `import "kordoc"`으로
 * 리포 node_modules에 의존한다. PyInstaller 사이드카에는 node_modules가 없어
 * 설치본에서 HWP 170건 전부가 조용히 metadata-fallback(품질 0.0)으로 떨어졌다.
 *
 * 방식: npm으로 kordoc과 의존성 전체를 스테이징 node_modules에 vendoring한다.
 * (esbuild 단일 번들은 실패했다 — kordoc dist가 내부에서 createRequire로 cfb 등을
 * 런타임 require하므로 정적 번들에 담기지 않고, 빌드 머신에서는 리포
 * node_modules가 구멍을 메워 스모크가 거짓 통과했다.)
 *
 * 산출물(스테이징): runtime-workspace/cache/kordoc-bundle/
 *   kordoc_runner.js   — 러너 (소스 그대로)
 *   package.json       — {"type":"module"} + kordoc 의존성
 *   node_modules/      — kordoc + 전체 의존성 (순수 JS)
 *   node.exe           — 동봉 Node 런타임 (MIT)
 *
 * 검증: 스테이징을 리포 '밖' 임시 폴더로 복사한 뒤(리포 node_modules 오염 차단)
 * 동봉 node.exe로 --selftest와 HWPX 실파싱 스모크를 실행한다.
 */
import { spawnSync } from "node:child_process";
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerSource = path.join(repoRoot, "services", "sidecar", "packaging", "kordoc", "kordoc_runner.js");
const outDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, "runtime-workspace", "cache", "kordoc-bundle");
const bundledNode = path.join(outDir, "node.exe");

const require = createRequire(import.meta.url);
const kordocVersion = require(path.join(repoRoot, "node_modules", "kordoc", "package.json")).version;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// ESM 러너/kordoc dist를 확정적으로 ESM으로 로드 + npm 설치 대상 명시
writeFileSync(
  path.join(outDir, "package.json"),
  JSON.stringify({ name: "gongmu-kordoc-staging", private: true, type: "module" }, null, 2) + "\n",
);

// kordoc + 전체 프로덕션 의존성 vendoring (순수 JS — 네이티브 모듈 없음 확인됨)
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const install = spawnSync(
  npmCmd,
  [
    "install",
    `kordoc@${kordocVersion}`,
    "--prefix", outDir,
    "--omit=dev",
    "--omit=optional",
    "--prefer-offline",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
  ],
  // Node 20.12+는 보안상 .cmd 스폰에 shell을 요구한다. 인자에 공백 경로가 없도록
  // outDir는 리포 상대 고정 경로만 쓴다.
  { encoding: "utf8", timeout: 300000, shell: true },
);
if (install.status !== 0) {
  console.error("npm install for kordoc staging FAILED");
  console.error("status:", install.status, "error:", install.error);
  console.error(install.stdout);
  console.error(install.stderr);
  process.exit(1);
}

copyFileSync(runnerSource, path.join(outDir, "kordoc_runner.js"));
// 폐쇄망 대응: 빌드 머신의 Node 런타임 동봉
copyFileSync(process.execPath, bundledNode);

// ---- 격리 검증: 리포 밖 임시 폴더에서 스테이징 그대로 실행 ----
// 스테이징이 리포 안에 있으면 node가 리포 node_modules까지 거슬러 올라가
// 누락 의존성을 몰래 메워 스모크가 거짓 통과한다(실제로 겪은 함정).
const isolated = mkdtempSync(path.join(tmpdir(), "gongmu-kordoc-smoke-"));
try {
  cpSync(outDir, isolated, { recursive: true });
  const isoNode = path.join(isolated, "node.exe");
  const isoRunner = path.join(isolated, "kordoc_runner.js");

  const runJson = (args, label) => {
    const proc = spawnSync(isoNode, args, { encoding: "utf8", timeout: 120000 });
    let parsed = null;
    try {
      parsed = JSON.parse(String(proc.stdout || "").trim().split("\n").pop());
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.success !== true) {
      console.error(`kordoc staging ${label} FAILED (isolated)`);
      console.error("stdout:", proc.stdout);
      console.error("stderr:", proc.stderr);
      process.exit(1);
    }
    return parsed;
  };

  const selftest = runJson([isoRunner, "--selftest"], "selftest");

  const fixture = path.join(
    repoRoot,
    "services", "sidecar", "src", "gongmu_sidecar",
    "public_doc_templates", "format_1p", "standard.hwpx",
  );
  runJson([isoRunner, fixture], "HWPX parse smoke");

  const sizeMb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
  console.log(
    JSON.stringify(
      {
        staging: path.relative(repoRoot, outDir),
        kordoc_version: kordocVersion,
        node_mb: sizeMb(statSync(bundledNode).size),
        isolated_selftest: "ok",
        isolated_hwpx_parse_smoke: "ok",
        selftest_version: selftest.version ?? "",
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(isolated, { recursive: true, force: true });
}
