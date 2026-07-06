import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INSTALLER_TIP_IDS,
  TIPS_SOURCE_RELATIVE,
  buildTipsBlock,
  escapeNsis,
  extractTips,
  generate,
  renderHooksFile,
} from "./generate-nsis-tips.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// NSIS 문자열 이스케이프
assert.equal(escapeNsis("plain text"), "plain text");
assert.equal(escapeNsis('say "hi"'), 'say $\\"hi$\\"');
assert.equal(escapeNsis("$INSTDIR is $1"), "$$INSTDIR is $$1");

// tips.ts 형태의 소스에서 id/text 추출
const sample = `
export const APP_TIPS = [
  {
    id: "tip-a",
    category: "chat",
    text: "첫 번째 팁",
    menu: "chat",
  },
  {
    id: "tip-b",
    category: "settings",
    text: "두 번째 팁",
    menu: "settings",
    chatExample: "예시",
  },
];
`;
assert.deepEqual(extractTips(sample), [
  { id: "tip-a", text: "첫 번째 팁" },
  { id: "tip-b", text: "두 번째 팁" },
]);

// 생성 구간 교체 — 마커 사이만 바뀐다
const hooks = "; head\r\n; --- BEGIN GENERATED TIPS (generate-nsis-tips.mjs) ---\r\nOLD\r\n; --- END GENERATED TIPS ---\r\n; tail";
const rendered = renderHooksFile(hooks, "NEW");
assert.ok(rendered.includes("NEW"));
assert.ok(!rendered.includes("OLD"));
assert.ok(rendered.startsWith("; head"));
assert.ok(rendered.endsWith("; tail"));
assert.throws(() => renderHooksFile("; no markers", "NEW"), /markers not found/);

// 실제 tips.ts에 설치용 팁 id가 전부 존재해야 한다
const realSource = fs.readFileSync(path.join(repoRoot, TIPS_SOURCE_RELATIVE), "utf8");
const realIds = new Set(extractTips(realSource).map((tip) => tip.id));
for (const id of INSTALLER_TIP_IDS) {
  assert.ok(realIds.has(id), `installer tip id missing from tips.ts: ${id}`);
}

// 존재하지 않는 id는 명시적으로 실패
assert.throws(() => buildTipsBlock(realSource, ["no-such-tip"]), /not found/);

// 체크 모드: 저장소의 installer-hooks.nsh 가 tips.ts와 동기화 상태여야 한다
generate({ root: repoRoot, check: true });

console.log("generate nsis tips checks passed");
