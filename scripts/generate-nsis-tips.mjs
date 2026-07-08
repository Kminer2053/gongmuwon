#!/usr/bin/env node
/**
 * NSIS 설치 프로그램 팁 생성기.
 *
 * 팁 문구의 단일 원천은 apps/desktop/src/shared/tips.ts 이다.
 * 이 스크립트는 tips.ts에서 설치 프로그램용으로 고른 팁(INSTALLER_TIP_IDS)의
 * 문구를 추출해 apps/desktop/src-tauri/nsis/installer-hooks.nsh 의
 * "BEGIN GENERATED TIPS" ~ "END GENERATED TIPS" 구간을 다시 쓴다.
 *
 * 사용법:
 *   node scripts/generate-nsis-tips.mjs          # 재생성(파일 갱신)
 *   node scripts/generate-nsis-tips.mjs --check  # 동기화 확인만(불일치 시 종료코드 1)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

export const TIPS_SOURCE_RELATIVE = path.join("apps", "desktop", "src", "shared", "tips.ts");
export const HOOKS_RELATIVE = path.join(
  "apps",
  "desktop",
  "src-tauri",
  "nsis",
  "installer-hooks.nsh",
);

/**
 * 설치 화면에서 보여줄 팁의 id 목록 (tips.ts의 AppTip.id).
 * 카테고리가 고르게 섞이도록 고른다. 순서 = 설치 로그에 찍히는 순서.
 */
export const INSTALLER_TIP_IDS = [
  "chat-schedule-create",
  "chat-document-create",
  "chat-multi-intent",
  "chat-knowledge-evidence",
  "documents-custom-form",
  "knowledge-taxonomy-wizard",
  "settings-profiles",
];

const BEGIN_MARKER = "; --- BEGIN GENERATED TIPS (generate-nsis-tips.mjs) ---";
const END_MARKER = "; --- END GENERATED TIPS ---";

/** tips.ts 소스 문자열에서 { id, text } 목록을 추출한다. */
export function extractTips(source) {
  const tips = [];
  const pattern = /\{\s*id:\s*"([^"]+)",[\s\S]*?text:\s*"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    tips.push({ id: match[1], text: match[2] });
  }
  return tips;
}

/** NSIS 문자열 리터럴용 이스케이프. */
export function escapeNsis(text) {
  return text.replace(/\$/g, "$$$$").replace(/"/g, '$\\"');
}

/** 생성 구간(마커 사이) 본문을 만든다. */
export function buildTipsBlock(tipsSource, ids = INSTALLER_TIP_IDS) {
  const all = extractTips(tipsSource);
  const byId = new Map(all.map((tip) => [tip.id, tip.text]));

  const lines = [
    "; 자동 생성 구간 — 직접 수정 금지. 문구를 바꾸려면",
    "; apps/desktop/src/shared/tips.ts 를 고치고 `node scripts/generate-nsis-tips.mjs` 실행.",
    `!define GONGMU_TIP_COUNT ${ids.length}`,
  ];

  ids.forEach((id, index) => {
    const text = byId.get(id);
    if (!text) {
      throw new Error(`installer tip id not found in tips.ts: ${id}`);
    }
    lines.push(`!define GONGMU_TIP_${index + 1} "${escapeNsis(text)}"`);
  });

  return lines.join("\r\n");
}

/** installer-hooks.nsh 전체 내용에서 생성 구간만 교체한 결과를 돌려준다. */
export function renderHooksFile(hooksContent, tipsBlock) {
  const beginIndex = hooksContent.indexOf(BEGIN_MARKER);
  const endIndex = hooksContent.indexOf(END_MARKER);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    throw new Error("generated-tips markers not found in installer-hooks.nsh");
  }

  const head = hooksContent.slice(0, beginIndex + BEGIN_MARKER.length);
  const tail = hooksContent.slice(endIndex);
  return `${head}\r\n${tipsBlock}\r\n${tail}`;
}

/** BOM 보장: makensis가 인코딩을 확실히 UTF-8로 읽도록 한다. */
function ensureBom(content) {
  return content.startsWith("﻿") ? content : `﻿${content}`;
}

export function generate({ root = repoRoot, check = false } = {}) {
  const tipsSource = fs.readFileSync(path.join(root, TIPS_SOURCE_RELATIVE), "utf8");
  const hooksPath = path.join(root, HOOKS_RELATIVE);
  const current = fs.readFileSync(hooksPath, "utf8");
  const next = ensureBom(renderHooksFile(current, buildTipsBlock(tipsSource)));

  const inSync = current === next;
  if (check) {
    if (!inSync) {
      throw new Error(
        `installer-hooks.nsh is out of sync with tips.ts — run: node scripts/generate-nsis-tips.mjs`,
      );
    }
    return { hooksPath, changed: false };
  }

  if (!inSync) {
    fs.writeFileSync(hooksPath, next, "utf8");
  }
  return { hooksPath, changed: !inSync };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const check = process.argv.includes("--check");
    const result = generate({ check });
    console.log(
      check
        ? "nsis installer tips are in sync with tips.ts"
        : result.changed
          ? `updated ${path.relative(repoRoot, result.hooksPath)}`
          : "nsis installer tips already up to date",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
