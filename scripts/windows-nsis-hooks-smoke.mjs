#!/usr/bin/env node
/**
 * NSIS 설치 훅(installer-hooks.nsh) 컴파일 스모크.
 *
 * 전체 desktop:bundle(cargo+PyInstaller) 없이, Tauri installer.nsi 템플릿과
 * 같은 순서(훅 include → MUI 페이지 정의 → Install 섹션에서 훅 매크로 삽입)를
 * 재현한 드라이버 스크립트를 makensis로 컴파일해
 *  - installer-hooks.nsh 가 문법적으로 유효한지
 *  - MUI_WELCOMEPAGE / MUI_FINISHPAGE define과 훅 매크로가 충돌 없이 붙는지
 *  - 한국어(Korean) 언어와 한글 문구가 컴파일되는지
 * 를 확인한다. 팁 생성 구간이 tips.ts와 동기화됐는지도 함께 검사한다.
 *
 * 사용법: node scripts/windows-nsis-hooks-smoke.mjs
 * makensis 위치는 GONGMU_MAKENSIS 환경변수로 재지정할 수 있다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { generate, HOOKS_RELATIVE } from "./generate-nsis-tips.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

export function resolveMakensis({
  env = process.env,
} = {}) {
  if (env.GONGMU_MAKENSIS) {
    return env.GONGMU_MAKENSIS;
  }

  const localAppData = env.LOCALAPPDATA ?? "";
  if (localAppData) {
    const tauriCached = path.win32.join(localAppData, "tauri", "NSIS", "Bin", "makensis.exe");
    if (fs.existsSync(tauriCached)) {
      return tauriCached;
    }
  }

  return "makensis";
}

/**
 * Tauri installer.nsi 템플릿과 같은 순서를 흉내 낸 드라이버 스크립트.
 * (MUI2 include → 훅 include → 페이지 정의 → Install 섹션에서 훅 삽입)
 */
export function buildDriverScript({ hooksPath, outputExe }) {
  return [
    "Unicode true",
    "ManifestDPIAware true",
    '!include "MUI2.nsh"',
    '!include "StrFunc.nsh"',
    "",
    `!include "${hooksPath}"`,
    "",
    'Name "GongmuHooksSmoke"',
    `OutFile "${outputExe}"`,
    'InstallDir "$TEMP\\gongmu-nsis-hooks-smoke"',
    "SetCompressor zlib",
    "",
    "; Tauri 템플릿과 동일한 페이지 구성(리인스톨/시작메뉴 커스텀 페이지 제외)",
    "!insertmacro MUI_PAGE_WELCOME",
    "!insertmacro MUI_PAGE_DIRECTORY",
    "!insertmacro MUI_PAGE_INSTFILES",
    "!define MUI_FINISHPAGE_NOAUTOCLOSE",
    "!insertmacro MUI_PAGE_FINISH",
    "",
    '!insertmacro MUI_LANGUAGE "Korean"',
    "",
    "Section Install",
    "  SetOutPath $INSTDIR",
    "  !ifmacrodef NSIS_HOOK_PREINSTALL",
    "    !insertmacro NSIS_HOOK_PREINSTALL",
    "  !endif",
    "  !ifmacrodef NSIS_HOOK_POSTINSTALL",
    "    !insertmacro NSIS_HOOK_POSTINSTALL",
    "  !endif",
    "SectionEnd",
    "",
  ].join("\r\n");
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

export async function main() {
  // 1. 팁 생성 구간이 tips.ts와 동기화됐는지 확인.
  generate({ root: repoRoot, check: true });

  // 2. 드라이버 스크립트 작성.
  const stamp = timestamp();
  const workDir = path.join(repoRoot, "runtime-workspace", "cache", `nsis-hooks-smoke-${stamp}`);
  fs.mkdirSync(workDir, { recursive: true });

  const hooksPath = path.join(repoRoot, HOOKS_RELATIVE);
  const driverPath = path.join(workDir, "driver.nsi");
  const outputExe = path.join(workDir, "gongmu-hooks-smoke.exe");
  fs.writeFileSync(driverPath, `﻿${buildDriverScript({ hooksPath, outputExe })}`, "utf8");

  // 3. makensis 컴파일.
  const makensis = resolveMakensis();
  const result = spawnSync(makensis, ["/INPUTCHARSET", "UTF8", driverPath], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`makensis failed with status ${result.status}`);
  }
  if (!fs.existsSync(outputExe)) {
    throw new Error(`makensis reported success but output missing: ${outputExe}`);
  }

  const summary = {
    makensis,
    hooks: path.relative(repoRoot, hooksPath),
    driver: path.relative(repoRoot, driverPath),
    output: path.relative(repoRoot, outputExe),
    output_bytes: fs.statSync(outputExe).size,
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
