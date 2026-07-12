import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));

// GUI 진행창 '따라하기 그림': 실제 설치 화면 캡처(scripts/assets/ai-pack-guide/)를
// GUI ps1에 base64로 내장한다. 팩에 이미지 파일을 따로 두지 않아 단일 ps1이 유지된다.
function guideImageBase64(name) {
  return readFileSync(join(scriptDir, "assets", "ai-pack-guide", name)).toString("base64");
}

// 스테이지 테이블의 한글은 Convert-UiText(런타임 \uXXXX 복원) 규약을 따른다.
function escapeNonAscii(text) {
  return text.replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const MODEL_NAME = "gemma4:e2b";
const MODEL_DISPLAY_NAME = "GEMMA4 E2B IT Multimodal";
const PACKAGE_PREFIX = "Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal";

async function pathExists(path) {
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

async function writeTextFile(path, content) {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf8");
}

function stringifyJsonAscii(value) {
  return JSON.stringify(value, null, 2).replace(/[^\x00-\x7F]/gu, (character) => {
    let codePoint = character.codePointAt(0);
    if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, "0")}`;
    codePoint -= 0x10000;
    const high = 0xd800 + (codePoint >> 10);
    const low = 0xdc00 + (codePoint & 0x3ff);
    return `\\u${high.toString(16).padStart(4, "0")}\\u${low.toString(16).padStart(4, "0")}`;
  });
}

async function copyRecursive(source, destination) {
  const sourceStat = await stat(source);
  if (sourceStat.isDirectory()) {
    await ensureDir(destination);
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await copyRecursive(join(source, entry.name), join(destination, entry.name));
    }
    return;
  }
  await ensureDir(dirname(destination));
  await copyFile(source, destination);
}

async function listFiles(root) {
  if (!(await pathExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function nowStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("");
}

async function findLatestOfflineRelease(repoRoot) {
  const offlineRoot = join(repoRoot, "release", "offline");
  if (!(await pathExists(offlineRoot))) return null;
  const entries = await readdir(offlineRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(offlineRoot, entry.name);
    const files = await readdir(dir, { withFileTypes: true });
    const installer = files.find((file) => file.isFile() && file.name.toLowerCase().endsWith(".exe"));
    if (!installer) continue;
    const dirStat = await stat(dir);
    candidates.push({ dir, installer: join(dir, installer.name), mtimeMs: dirStat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] ?? null;
}

async function findDefaultModelStore() {
  const candidates = [
    process.env.OLLAMA_MODELS,
    join(homedir(), ".ollama", "models"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const manifestPath = join(candidate, "manifests", "registry.ollama.ai", "library", "gemma4", "e2b");
    if (await pathExists(manifestPath)) return candidate;
  }
  return null;
}

async function writePackageReadme(path, { hasModelStore, hasOllamaInstaller, hasPythonInstaller, hasGongmuInstaller }) {
  const lines = [
    "# 로컬 AI에이전트 워크플레이스 : 공무원 — AI 설치팩",
    "",
    "이 설치팩은 인터넷이 없는 폐쇄망(내부망) PC나 새 Windows 계정에서",
    "'공무원' 앱과 로컬 AI(Ollama + Gemma 모델)를 한 번에 설치하기 위한 것입니다.",
    "",
    "## 가장 쉬운 시작 방법",
    "",
    "이 폴더 안의 아래 파일을 더블클릭하세요.",
    "",
    "```text",
    "START_INSTALL_GUI.bat",
    "```",
    "",
    "설치 진행 상황을 보여주는 안내 창이 열리고, 아래 순서대로 자동으로 설치됩니다.",
    "설치 도중 Ollama 설치 마법사가 뜨면 안내에 따라 완료하면 됩니다.",
    "자세한 한글 안내는 `INSTALL_GUIDE_KO.md` 파일을 참고하세요.",
    "",
    "## 설치 순서 (자동으로 진행됩니다)",
    "",
    "1. Python 3.11 확인/설치 (선택 — 진단·복구용이며 없어도 앱은 동작합니다)",
    "2. Ollama(로컬 AI 엔진) 확인/설치",
    "3. Gemma 모델을 내 PC로 복사 (몇 분 걸릴 수 있습니다)",
    "4. Ollama 서버 시작 및 응답 확인",
    "5. AI 응답(텍스트·이미지) 정상 동작 검증",
    "6. 공무원 앱이 Ollama/Gemma를 사용하도록 설정 저장",
    "7. 마지막으로 공무원 앱 설치 — 설치가 끝나면 바로 사용할 수 있습니다.",
    "",
    "## 설치 중 알아두기",
    "",
    "- 공무원 앱은 맨 마지막에 설치됩니다. Ollama·모델·설정이 모두 준비된 뒤라, 앱이 열리면 곧바로 로컬 AI에 연결된 상태입니다.",
    "- 같은 버전의 공무원 앱이 이미 설치되어 있으면 앱 재설치는 자동으로 건너뜁니다. 설치를 마친 뒤 RUN_FULL_VALIDATION.bat을 실행해도 앱 설치 창이 다시 뜨지 않습니다.",
    "- Ollama 설치 마법사가 열리면 끝까지 완료하고 창을 닫아주세요.",
    "- 검은 명령창(설치 창)은 임의로 닫지 마세요. 모든 설치가 끝날 때까지 그대로 둡니다.",
    "- Gemma 모델 복사는 몇 분 이상 걸릴 수 있습니다. 복사 진행 로그가 표시됩니다.",
    "- 진행이 멈춘 것처럼 보이면, 설치 마법사 창이 다른 창 뒤에 숨어 있는지 확인하세요.",
    "- WSL은 공무원과 Windows용 Ollama 실행에 필요하지 않습니다. 상태만 참고로 기록합니다.",
    "",
    "## 폴더 안 파일 안내",
    "",
    "- `START_INSTALL_GUI.bat` : (권장) 진행 안내 창과 함께 설치합니다.",
    "- `START_INSTALL.bat` : 안내 창 없이 설치만 실행합니다.",
    "- `VALIDATE_INSTALL.bat` : 설치가 잘 되었는지 검증합니다.",
    "- `COLLECT_EVIDENCE.bat` : 설치 결과 증거를 모아 `evidence` 폴더에 저장합니다.",
    "- `RUN_FULL_VALIDATION.bat` : 설치·검증·증거수집을 한 번에 실행합니다.",
    "- `INSTALL_GUIDE_KO.md` : 처음 설치하는 분을 위한 자세한 한글 안내입니다.",
    "- `THIRD_PARTY_NOTICES.md` : 동봉된 구성요소(Ollama·Gemma·Python)의 라이선스 고지입니다.",
    "",
    "## 문제가 생기면 확인할 파일",
    "",
    "- `install-gongmu-ai.log` : 설치 로그",
    "- `install-gongmu-ai-gui.log` : 진행 안내 창 로그",
    "- `validate-gongmu-ai.log` : 검증 로그",
    "- `evidence/ai-pack-clean-account-evidence.md` : 설치 증거 요약(사람이 읽는 형식)",
    "- `evidence/ai-pack-clean-account-evidence.json` : 설치 증거 원본",
    "",
    "설치가 실패하면 위 로그 파일을 열어 확인하고, 같은 배치파일을 다시 실행할 수 있습니다.",
    "",
    "## 설치팩 구성 상태",
    "",
    `- 공무원 앱 설치파일: ${koreanStatus(hasGongmuInstaller)}`,
    `- Python 3.11 설치파일: ${koreanStatus(hasPythonInstaller)}`,
    `- Ollama 설치파일: ${koreanStatus(hasOllamaInstaller)}`,
    `- Gemma 모델(${MODEL_NAME}) 캐시: ${koreanStatus(hasModelStore)}`,
    "",
    "## 폐쇄망(오프라인) 설치 확인 사항",
    "",
    "- `models/manifests/registry.ollama.ai/library/gemma4/e2b` 폴더가 있어야 완전 오프라인 설치가 됩니다.",
    "- `models/blobs/` 에 모델 데이터(레이어)가 있어야 합니다.",
    "- 대상 PC에 Ollama가 없으면 `ollama/OllamaSetup.exe` 가 필요합니다.",
    "- `python/python-3.11.x-amd64.exe` 는 선택 사항이며, 진단·복구에 유용합니다.",
    "- 파일을 복사한 뒤 `SHA256SUMS.txt` 로 무결성을 확인하세요.",
  ];
  await writeTextFile(path, `${lines.join("\n")}\n`);
}

async function writeKoreanInstallGuide(path, { hasModelStore, hasOllamaInstaller, hasPythonInstaller, hasGongmuInstaller }) {
  const lines = [
    "# 공무원 AI 설치팩 설치 안내",
    "",
    "이 파일은 외부 인터넷이 없거나 새 Windows 계정에서 `로컬 AI에이전트 워크플레이스 : 공무원`을 처음 설치하는 사용자를 위한 안내문입니다.",
    "",
    "## 설치팩에 포함된 항목",
    "",
    `- 공무원 앱 설치파일: ${hasGongmuInstaller ? "포함됨" : "포함되지 않음"}`,
    `- Python 3.11 설치파일: ${hasPythonInstaller ? "포함됨" : "포함되지 않음"}`,
    `- Ollama 설치파일: ${hasOllamaInstaller ? "포함됨" : "포함되지 않음"}`,
    `- Gemma4 E2B IT 멀티모달 모델 캐시: ${hasModelStore ? "포함됨" : "포함되지 않음"}`,
    "",
    "## 처음 설치하는 사용자를 위한 순서",
    "",
    "1. 설치팩 폴더를 압축 해제합니다.",
    "2. `START_INSTALL_GUI.bat`을 더블클릭하면 설치 안내(진행률) 창이 열립니다.",
    "3. 먼저 Python(선택) → Ollama → Gemma 모델 설치·복사가 진행됩니다. (모델 복사는 몇 분 걸릴 수 있습니다.)",
    "4. Ollama 설치 마법사가 열리면 끝까지 완료하고 창을 닫아주세요.",
    "5. 마지막으로 공무원 앱 설치 마법사가 실행됩니다. 안내에 따라 끝까지 완료합니다.",
    "6. 설치가 끝나 앱이 자동으로 열려도, 이미 로컬 AI(Ollama/Gemma)에 연결된 상태라 바로 사용할 수 있습니다.",
    "7. 배치파일(명령) 창은 닫지 마세요.",
    "8. 설치 검증 결과가 필요하면 `RUN_FULL_VALIDATION.bat`을 실행하세요. `evidence` 폴더에 검증 결과 파일이 생성됩니다.",
    "",
    "## 왜 중간에 멈춘 것처럼 보이나요?",
    "",
    "배치파일은 각 설치 마법사(Ollama, 그리고 마지막의 공무원 앱)가 종료될 때까지 기다립니다.",
    "따라서 설치 마법사 창이나 공무원 앱 창이 아직 열려 있으면 다음 단계로 넘어가지 않습니다.",
    "",
    "이럴 때는 아래를 확인하세요.",
    "",
    "- 공무원 설치 마법사가 다른 창 뒤에 숨어 있지 않은지 확인합니다.",
    "- 설치 완료 화면에서 `마침`을 눌렀는지 확인합니다.",
    "- 공무원 앱이 자동 실행되었다면 앱 창을 닫습니다.",
    "- 배치파일 창은 닫지 말고 그대로 둡니다.",
    "",
    "## 단계별로 설치하고 싶을 때",
    "",
    "- 설치만 실행: `START_INSTALL.bat`",
    "- 설치 상태 검증: `VALIDATE_INSTALL.bat`",
    "- 설치 증거 수집: `COLLECT_EVIDENCE.bat`",
    "- 설치부터 검증과 증거 수집까지 한 번에 실행: `RUN_FULL_VALIDATION.bat`",
    "",
    "처음 설치하는 경우에는 `RUN_FULL_VALIDATION.bat`을 권장합니다.",
    "",
    "## 문제가 생겼을 때 확인할 파일",
    "",
    "- 설치 로그: `install-gongmu-ai.log`",
    "- 검증 로그: `validate-gongmu-ai.log`",
    "- 설치 증거 요약: `evidence/ai-pack-clean-account-evidence.md`",
    "- 설치 증거 원본: `evidence/ai-pack-clean-account-evidence.json`",
    "",
    "## 설치 후 확인할 내용",
    "",
    "- 공무원 앱이 실행되는지 확인합니다.",
    "- 업무엔진 상태가 정상인지 확인합니다.",
    "- 모델 설정에서 Ollama 로컬 모델이 선택되어 있는지 확인합니다.",
    "- 업무대화에서 짧은 문장을 입력해 응답이 생성되는지 확인합니다.",
    "- 이미지 첨부가 필요한 경우 Gemma4 E2B IT 멀티모달 모델 검증 결과를 확인합니다.",
    "",
    "## 주의사항",
    "",
    "- 인터넷이 없는 PC에서는 설치팩 내부의 `models` 폴더가 반드시 필요합니다.",
    "- Ollama가 이미 설치되어 있으면 설치팩은 기존 Ollama를 우선 감지합니다.",
    "- Python 3.11은 공무원 앱 자체 실행에는 필수는 아니지만, 진단과 복구를 위해 설치팩에 포함할 수 있습니다.",
    "- 설치가 실패해도 먼저 로그 파일을 확인하고 같은 배치파일을 다시 실행할 수 있습니다.",
  ];
  await writeTextFile(path, `\uFEFF${lines.join("\n")}\n`);
}

function koreanStatus(value) {
  return value ? "\uD3EC\uD568\uB428" : "\uD3EC\uD568\uB418\uC9C0 \uC54A\uC74C";
}

async function writeKoreanInstallGuideV2(path, { hasModelStore, hasOllamaInstaller, hasPythonInstaller, hasGongmuInstaller }) {
  const lines = [
    "\uFEFF# \uACF5\uBB34\uC6D0 AI \uC124\uCE58\uD329 \uC124\uCE58 \uC548\uB0B4",
    "",
    "\uC774 \uBB38\uC11C\uB294 \uC778\uD130\uB137\uC774 \uC5C6\uAC70\uB098 \uC0C8 Windows \uACC4\uC815\uC5D0\uC11C \uCC98\uC74C \uC124\uCE58\uD558\uB294 \uC0AC\uC6A9\uC790\uB97C \uC704\uD55C \uC548\uB0B4\uBB38\uC785\uB2C8\uB2E4.",
    "",
    "## \uC124\uCE58\uD329\uC5D0 \uD3EC\uD568\uB41C \uD56D\uBAA9",
    "",
    `- \uACF5\uBB34\uC6D0 \uC571 \uC124\uCE58\uD30C\uC77C: ${koreanStatus(hasGongmuInstaller)}`,
    `- Python 3.11 \uC124\uCE58\uD30C\uC77C: ${koreanStatus(hasPythonInstaller)}`,
    `- Ollama \uC124\uCE58\uD30C\uC77C: ${koreanStatus(hasOllamaInstaller)}`,
    `- Gemma4 E2B IT \uBA40\uD2F0\uBAA8\uB2EC \uBAA8\uB378 \uCE90\uC2DC: ${koreanStatus(hasModelStore)}`,
    "",
    "## \uCC98\uC74C \uC124\uCE58\uD558\uB294 \uC0AC\uC6A9\uC790\uB97C \uC704\uD55C \uC21C\uC11C",
    "",
    "1. \uC124\uCE58\uD329 \uD3F4\uB354\uB97C \uC555\uCD95 \uD574\uC81C\uD569\uB2C8\uB2E4.",
    "2. START_INSTALL_GUI.bat\uC744 \uB354\uBE14\uD074\uB9AD\uD558\uBA74 \uC124\uCE58 \uBAA8\uB2C8\uD130\uAC00 \uC5F4\uB9BD\uB2C8\uB2E4.",
    "3. \uC124\uCE58 \uBAA8\uB2C8\uD130\uC5D0 \uD604\uC7AC \uB2E8\uACC4, \uACBD\uACFC \uC2DC\uAC04, \uD544\uC694\uD55C \uC791\uC5C5 \uC548\uB0B4, \uCD5C\uADFC \uB85C\uADF8\uAC00 \uD45C\uC2DC\uB429\uB2C8\uB2E4.",
    "4. \uD074\uB9B0\uACC4\uC815 \uC99D\uAC70\uAE4C\uC9C0 \uD55C \uBC88\uC5D0 \uB0A8\uAE30\uB824\uBA74 RUN_FULL_VALIDATION.bat\uC744 \uC2E4\uD589\uD569\uB2C8\uB2E4.",
    "5. \uBA3C\uC800 Python(\uC120\uD0DD) \u2192 Ollama \u2192 Gemma \uBAA8\uB378 \uC124\uCE58\u00B7\uBCF5\uC0AC\uAC00 \uC9C4\uD589\uB429\uB2C8\uB2E4.",
    "6. Ollama \uC124\uCE58 \uB9C8\uBC95\uC0AC\uAC00 \uC5F4\uB9AC\uBA74 \uB05D\uAE4C\uC9C0 \uC644\uB8CC\uD558\uACE0 \uCC3D\uC744 \uB2EB\uC544\uC8FC\uC138\uC694.",
    "7. Ollama \uC571\uC774\uB098 \uC548\uB0B4 \uCC3D\uC774 \uC790\uB3D9\uC73C\uB85C \uC5F4\uB9AC\uBA74 \uADF8 \uCC3D\uB3C4 \uB2EB\uC544\uC8FC\uC138\uC694.",
    "8. Gemma \uBAA8\uB378 \uCE90\uC2DC \uBCF5\uC0AC\uB294 \uBA87 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uBC30\uCE58\uCC3D\uC5D0 \uBCF5\uC0AC \uC9C4\uD589 \uB85C\uADF8\uAC00 \uD45C\uC2DC\uB429\uB2C8\uB2E4.",
    "9. \uB9C8\uC9C0\uB9C9\uC73C\uB85C \uACF5\uBB34\uC6D0 \uC571 \uC124\uCE58 \uB9C8\uBC95\uC0AC\uAC00 \uC2E4\uD589\uB429\uB2C8\uB2E4. \uC548\uB0B4\uC5D0 \uB530\uB77C \uB05D\uAE4C\uC9C0 \uC644\uB8CC\uD558\uC138\uC694.",
    "10. \uC124\uCE58\uAC00 \uB05D\uB098 \uC571\uC774 \uC790\uB3D9\uC73C\uB85C \uC5F4\uB824\uB3C4, \uC774\uBBF8 \uB85C\uCEEC AI(Ollama/Gemma)\uC5D0 \uC5F0\uACB0\uB41C \uC0C1\uD0DC\uB77C \uBC14\uB85C \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
    "11. \uACF5\uBB34\uC6D0\uACFC Ollama \uC124\uCE58 \uCC3D\uC774 \uBAA8\uB450 \uC885\uB8CC\uB420 \uB54C\uAE4C\uC9C0 \uBC30\uCE58\uD30C\uC77C \uCC3D\uC740 \uB2EB\uC9C0 \uB9C8\uC138\uC694.",
    "12. WSL\uC740 \uACF5\uBB34\uC6D0\uACFC Windows\uC6A9 Ollama \uC2E4\uD589\uC5D0 \uD544\uC218\uAC00 \uC544\uB2D9\uB2C8\uB2E4. \uC124\uCE58\uD329\uC740 WSL \uC0C1\uD0DC\uB9CC \uC120\uD0DD \uC9C4\uB2E8 \uC815\uBCF4\uB85C \uAE30\uB85D\uD569\uB2C8\uB2E4.",
    "",
    "## \uC911\uAC04\uC5D0 \uBA48\uCD98 \uAC83\uCC98\uB7FC \uBCF4\uC77C \uB54C",
    "",
    "\uC124\uCE58 \uCC3D\uC774\uB098 \uC571 \uCC3D\uC774 \uC5F4\uB824 \uC788\uC73C\uBA74 \uB2E4\uC74C \uB2E8\uACC4\uB85C \uB118\uC5B4\uAC00\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
    "",
    "- Ollama \uC124\uCE58 \uCC3D\uC774 \uB2E4\uB978 \uCC3D \uB4A4\uC5D0 \uC228\uC5B4 \uC788\uB294\uC9C0 \uD655\uC778\uD569\uB2C8\uB2E4.",
    "- Ollama \uC571 \uB610\uB294 \uC548\uB0B4 \uCC3D\uC774 \uC790\uB3D9 \uC2E4\uD589\uB418\uC5C8\uB2E4\uBA74 \uD574\uB2F9 \uCC3D\uC744 \uB2EB\uC2B5\uB2C8\uB2E4.",
    "- \uB9C8\uC9C0\uB9C9 \uB2E8\uACC4\uC778 \uACF5\uBB34\uC6D0 \uC124\uCE58 \uCC3D\uC774 \uC5F4\uB824 \uC788\uC73C\uBA74 \uB05D\uAE4C\uC9C0 \uC644\uB8CC\uD569\uB2C8\uB2E4.",
    "- \uACF5\uBB34\uC6D0 \uC571\uC774 \uC790\uB3D9 \uC2E4\uD589\uB418\uC5C8\uB2E4\uBA74(\uC774\uBBF8 \uC0AC\uC6A9 \uAC00\uB2A5\uD55C \uC0C1\uD0DC) \uD655\uC778 \uD6C4 \uACC4\uC18D \uC9C4\uD589\uD569\uB2C8\uB2E4.",
    "- \uBC30\uCE58\uD30C\uC77C \uCC3D\uC740 \uB2EB\uC9C0 \uB9D0\uACE0 \uADF8\uB300\uB85C \uB461\uB2C8\uB2E4.",
    "",
    "## \uB2E8\uACC4\uBCC4 \uC2E4\uD589 \uD30C\uC77C",
    "",
    "- \uC548\uB0B4\uD615 \uC124\uCE58 \uBAA8\uB2C8\uD130: START_INSTALL_GUI.bat",
    "- \uC124\uCE58\uB9CC \uC2E4\uD589: START_INSTALL.bat",
    "- \uC124\uCE58 \uC0C1\uD0DC \uAC80\uC99D: VALIDATE_INSTALL.bat",
    "- \uC124\uCE58 \uC99D\uAC70 \uC218\uC9D1: COLLECT_EVIDENCE.bat",
    "- \uC124\uCE58\uBD80\uD130 \uAC80\uC99D\uACFC \uC99D\uAC70 \uC218\uC9D1\uAE4C\uC9C0 \uD55C \uBC88\uC5D0 \uC2E4\uD589: RUN_FULL_VALIDATION.bat",
    "",
    "## \uBB38\uC81C\uAC00 \uC0DD\uACBC\uC744 \uB54C \uD655\uC778\uD560 \uD30C\uC77C",
    "",
    "- \uC124\uCE58 \uB85C\uADF8: install-gongmu-ai.log",
    "- \uC124\uCE58 \uBAA8\uB2C8\uD130 \uB85C\uADF8: install-gongmu-ai-gui.log",
    "- \uAC80\uC99D \uB85C\uADF8: validate-gongmu-ai.log",
    "- \uC124\uCE58 \uC99D\uAC70 \uC694\uC57D: evidence/ai-pack-clean-account-evidence.md",
    "- \uC124\uCE58 \uC99D\uAC70 \uC6D0\uBCF8: evidence/ai-pack-clean-account-evidence.json",
  ];
  await writeTextFile(path, `${lines.join("\n")}\n`);
}

const APP_MIT_LICENSE = `MIT License

Copyright (c) 2026 gongmuwon (로컬 AI에이전트 워크플레이스 : 공무원)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

async function writeThirdPartyNotices(path) {
  await writeTextFile(
    path,
    `# 라이선스 고지 (Third Party Notices)

이 문서는 설치팩에 동봉된 외부 구성요소(Ollama, Gemma 4 모델, Python 등)의
라이선스 고지입니다. 공무원 앱 자체는 MIT 라이선스이며, 동봉된 각 구성요소는
자신의 라이선스를 따릅니다. 아래는 구성요소별 원문 고지(영문)입니다.

---

The Gongmu desktop app source code is licensed under the MIT License (see
\`licenses/gongmu-app/LICENSE.txt\`). The offline install package additionally
bundles the following components, each governed by its OWN license.

## Gemma 4 E2B IT (model weights)

- Component: \`${MODEL_NAME}\` model weights via the Ollama model library.
- License: **Apache-2.0.** Gemma 4 ships under the Apache License 2.0 — unlike
  earlier Gemma generations (Gemma 1/2/3/3n), which used Google's custom
  "Gemma Terms of Use".
- Authoritative terms: https://ai.google.dev/gemma/terms (Gemma 4 links to
  Apache 2.0 at https://ai.google.dev/gemma/apache_2).
- Note: Verify the license/NOTICE shown on the exact Ollama/GGUF build you pull
  before redistributing; re-uploaders can mislabel a converted weight file.

## Ollama

- Component: Ollama Windows runtime, when supplied at build time.
- License: MIT. Project: https://github.com/ollama/ollama

## Python (CPython)

- Component: CPython 3.11 Windows installer, when supplied at build time.
- License: Python Software Foundation License. Project: https://www.python.org/
- Note: The packaged app uses a bundled sidecar executable and does not require
  system Python for normal operation.

## Microsoft Edge WebView2 Runtime

- Component: WebView2 runtime used by the Tauri-based desktop app.
- License: Microsoft's own redistribution terms (NOT Apache/MIT). Redistribution
  of the runtime is permitted under those terms.

## kordoc

- Component: Korean document parser (HWP3-5 / HWPX / PDF / DOCX -> Markdown),
  invoked via a bundled JS bridge.
- License: MIT. Project: https://github.com/chrisryugj/kordoc

## python-hwpx

- Component: pure-Python HWPX read / edit / create / validate (sidecar).
- License: Apache-2.0. Project: https://github.com/airmang/python-hwpx

## Sidecar Python libraries

- FastAPI / Starlette / Uvicorn (MIT / BSD-3-Clause), Pydantic (MIT),
  lxml / pypdf (BSD-3-Clause), PyYAML (MIT) — each under its own OSI-approved
  license.
`,
  );
}

async function writeLicenseFiles(packageDir) {
  await writeTextFile(
    join(packageDir, "licenses", "gongmu-app", "LICENSE.txt"),
    APP_MIT_LICENSE,
  );
  await writeTextFile(
    join(packageDir, "licenses", "gemma4-e2b-it", "NOTICE.txt"),
    "Gemma 4 E2B IT model weights.\n" +
      "License: Apache-2.0 (Gemma 4 ships under Apache 2.0, NOT the legacy Gemma Terms of Use).\n" +
      "Authoritative: https://ai.google.dev/gemma/terms -> https://ai.google.dev/gemma/apache_2\n" +
      "Verify the license/NOTICE on the exact Ollama/GGUF build you pull before redistribution.\n",
  );
  await writeTextFile(
    join(packageDir, "licenses", "ollama", "NOTICE.txt"),
    "Ollama Windows runtime. License: MIT. https://github.com/ollama/ollama\n",
  );
  await writeTextFile(
    join(packageDir, "licenses", "python", "NOTICE.txt"),
    "CPython 3.11. License: Python Software Foundation License. https://www.python.org/downloads/\n",
  );
  await writeTextFile(
    join(packageDir, "licenses", "webview2", "NOTICE.txt"),
    "Microsoft Edge WebView2 Runtime. Redistributed under Microsoft's WebView2 distribution terms (not Apache/MIT).\n",
  );
  await writeTextFile(
    join(packageDir, "licenses", "kordoc", "NOTICE.txt"),
    "kordoc - Korean document parser (HWP/HWPX/PDF/DOCX -> Markdown). License: MIT. https://github.com/chrisryugj/kordoc\n",
  );
  await writeTextFile(
    join(packageDir, "licenses", "python-hwpx", "NOTICE.txt"),
    "python-hwpx - pure-Python HWPX read/edit/create/validate. License: Apache-2.0. https://github.com/airmang/python-hwpx\n",
  );
}

function commonPowerShellFunctions() {
  return String.raw`
function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Warn([string]$Message) {
  Write-Host "WARNING: $Message" -ForegroundColor Yellow
}

function Test-HttpOk([string]$Url) {
  try {
    Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Find-Python311 {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    try {
      $version = & py -3.11 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
      if ($LASTEXITCODE -eq 0 -and ($version | Select-Object -First 1).Trim() -eq "3.11") {
        return "py -3.11"
      }
    } catch {}
  }

  $candidates = @(
    (Get-Command python -ErrorAction SilentlyContinue).Source,
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
    "$env:ProgramFiles\Python311\python.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }

  foreach ($candidate in $candidates) {
    try {
      $version = & $candidate -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
      if ($LASTEXITCODE -eq 0 -and ($version | Select-Object -First 1).Trim() -eq "3.11") {
        return $candidate
      }
    } catch {}
  }
  return $null
}

function Find-OllamaExe {
  $cmd = Get-Command ollama -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
    "$env:ProgramFiles\Ollama\ollama.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  return $candidates | Select-Object -First 1
}

function Get-OllamaModelNames([string]$OllamaHost) {
  try {
    $tags = Invoke-RestMethod -Uri "http://$OllamaHost/api/tags" -Method Get -TimeoutSec 5
    return @($tags.models | ForEach-Object { $_.name })
  } catch {
    return @()
  }
}

function Get-WslStatus {
  $cmd = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if (!$cmd) {
    return [ordered]@{
      installed = $false
      detail = "wsl.exe not found. WSL is optional for Gongmu and native Windows Ollama."
    }
  }

  try {
    # 'wsl.exe --status' 출력은 UTF-16LE라 Windows PowerShell 5.1 콘솔 인코딩과 어긋나
    # 증거 파일에서 한글이 깨진다(mojibake). WSL은 선택 진단 항목이므로 원문 상태는
    # 담지 않고 '감지됨'만 기록한다.
    $null = $cmd
    return [ordered]@{
      installed = $true
      detail = "wsl.exe detected. WSL is optional for Gongmu and native Windows Ollama."
    }
  } catch {
    return [ordered]@{
      installed = $true
      detail = "wsl.exe detected, but status command failed. WSL is optional for Gongmu and native Windows Ollama. $($_.Exception.Message)"
    }
  }
}

function Write-WslOptionalStatus {
  Write-Step "Checking optional WSL"
  $wsl = Get-WslStatus
  Write-Host $wsl.detail
}
`;
}

function installScriptContent() {
  return `#requires -Version 5.1
param(
  [string]$ModelName = "${MODEL_NAME}",
  [string]$OllamaHost = "127.0.0.1:11434",
  [string]$OllamaModels = "$env:USERPROFILE\\.ollama\\models",
  [switch]$AllowDownload,
  [switch]$SkipGongmuInstall,
  [switch]$RequirePython
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogPath = Join-Path $ScriptRoot "install-gongmu-ai.log"
Start-Transcript -Path $LogPath -Append | Out-Null

${commonPowerShellFunctions()}

# 한글 안내는 BOM이 있는 이 PS1에서 출력한다. (.bat은 chcp 65001 + UTF-8 한글 조합에서
# cmd가 바이트 오프셋으로 명령을 재탐색하다 중간 절단되므로 ASCII 전용으로 유지)
Write-Host "============================================================"
Write-Host " 공무원 로컬 AI 설치"
Write-Host " Python 3.11 확인 + Ollama + Gemma 4 E2B 멀티모달 모델"
Write-Host "============================================================"
Write-Host ""
Write-Host "설치가 끝날 때까지 이 명령창은 닫지 마세요."
Write-Host ""
Write-Host "안내:"
Write-Host " 1. Python, Ollama, Gemma 모델을 먼저 설치합니다."
Write-Host " 2. Ollama 설치 마법사가 열리면 끝까지 완료하고 창을 닫아주세요."
Write-Host " 3. Gemma 모델 복사는 몇 분 이상 걸릴 수 있습니다."
Write-Host " 4. 공무원 앱은 맨 마지막에 설치됩니다. (같은 버전이 이미 설치되어 있으면 건너뜁니다)"
Write-Host " 5. 설치 마법사를 완료하면 앱이 바로 사용 가능한 상태로 열립니다."
Write-Host ""
Write-Host "진행이 멈춘 것처럼 보이면, Ollama 설치 창이나 공무원 설치 창이"
Write-Host "다른 창 뒤에 숨어 있는지 확인하세요."
Write-Host ""
Write-Host "설치가 실패하면 이 폴더의 install-gongmu-ai.log 파일을 확인하세요."
Write-Host ""

function Install-Python311IfAvailable {
  Write-Step "Checking Python 3.11"
  $python = Find-Python311
  if ($python) {
    Write-Host "Python 3.11 found: $python"
    return
  }

  $installer = Get-ChildItem -Path (Join-Path $ScriptRoot "python") -Filter "python-3.11*-amd64.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($installer) {
    Write-Step "Installing Python 3.11"
    $args = "/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_pip=1 Include_test=0"
    Start-Process -FilePath $installer.FullName -ArgumentList $args -Wait
    $python = Find-Python311
    if ($python) {
      Write-Host "Python 3.11 installed: $python"
      return
    }
    if ($RequirePython) { throw "Python 3.11 installer ran, but Python 3.11 was not detected." }
    Write-Warn "Python 3.11 installer ran, but Python 3.11 was not detected."
    return
  }

  $message = "Gongmu bundled app can run without system Python. Python 3.11 is only needed for diagnostics, repair, and development-mode support."
  if ($RequirePython) { throw "Python 3.11 not found and python/python-3.11.x-amd64.exe is missing. $message" }
  Write-Warn $message
}

function Get-InstalledGongmuVersion {
  foreach ($registryRoot in @("HKCU:", "HKLM:")) {
    $uninstallKey = "$registryRoot\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Gongmu"
    if (Test-Path $uninstallKey) {
      $displayVersion = (Get-ItemProperty -Path $uninstallKey -ErrorAction SilentlyContinue).DisplayVersion
      if ($displayVersion) { return [string]$displayVersion }
    }
  }
  return $null
}

function Install-GongmuIfPresent {
  if ($SkipGongmuInstall) { return }
  $gongmuDir = Join-Path $ScriptRoot "gongmu"
  $installer = Get-ChildItem -Path $gongmuDir -Filter "*.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (!$installer) {
    Write-Warn "No Gongmu installer found in gongmu/. Skipping app install."
    return
  }
  $packVersion = $null
  if ($installer.Name -match "_(\\d+\\.\\d+\\.\\d+)_") { $packVersion = $Matches[1] }
  $installedVersion = Get-InstalledGongmuVersion
  if ($installedVersion -and $packVersion -and ($installedVersion -eq $packVersion)) {
    Write-Step "Gongmu app already installed"
    Write-Host "설치된 공무원 앱 버전($installedVersion)이 이 패키지와 같아 앱 재설치를 건너뜁니다."
    Write-Host "앱을 다시 설치하려면 gongmu 폴더의 설치 파일을 직접 실행하세요."
    return
  }
  if ($installedVersion) {
    Write-Host "Installed Gongmu version $installedVersion differs from pack version $packVersion. Reinstalling."
  }
  Write-Step "Starting Gongmu installer"
  Start-Process -FilePath $installer.FullName -Wait
}

function Install-OllamaIfNeeded {
  Write-Step "Checking Ollama"
  $ollama = Find-OllamaExe
  if ($ollama) {
    Write-Host "Ollama found: $ollama"
    return $ollama
  }

  $installer = Join-Path $ScriptRoot "ollama\\OllamaSetup.exe"
  if (!(Test-Path $installer)) {
    throw "Ollama is not installed and ollama/OllamaSetup.exe is missing."
  }

  Write-Step "Starting Ollama installer"
  Write-Host "Complete the Ollama installer if a setup window appears. This script will continue after the installer exits."
  Write-Host "If the Ollama app or installer window opens after installation, close it so setup can continue."
  Start-Process -FilePath $installer -Wait

  for ($i = 0; $i -lt 20; $i++) {
    $ollama = Find-OllamaExe
    if ($ollama) { return $ollama }
    Start-Sleep -Seconds 2
  }
  throw "Ollama installer finished, but ollama.exe was not detected."
}

function Import-PackagedModelStore {
  $source = Join-Path $ScriptRoot "models"
  $manifest = Join-Path $source "manifests\\registry.ollama.ai\\library\\gemma4\\e2b"
  if (!(Test-Path $manifest)) {
    Write-Warn "Packaged model cache is missing."
    return $false
  }

  Write-Step "Copying packaged Ollama model cache"
  Write-Host "Copying the packaged model cache can take several minutes. Keep this window open."
  Write-Host "Source: $source"
  Write-Host "Destination: $OllamaModels"
  New-Item -ItemType Directory -Force -Path $OllamaModels | Out-Null
  $robocopyArgs = @($source, $OllamaModels, "/E", "/R:2", "/W:2", "/ETA")
  & robocopy @robocopyArgs
  $robocopyExit = $LASTEXITCODE
  if ($robocopyExit -ge 8) {
    throw "robocopy failed while copying the packaged model cache. Exit code: $robocopyExit"
  }
  return $true
}

function Start-OllamaServer([string]$OllamaExe) {
  $env:OLLAMA_HOST = $OllamaHost
  $env:OLLAMA_MODELS = $OllamaModels
  if (Test-HttpOk "http://$OllamaHost/api/tags") {
    Write-Host "Ollama server is already responding."
    return
  }

  Write-Step "Starting Ollama server"
  Start-Process -FilePath $OllamaExe -ArgumentList "serve" -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-HttpOk "http://$OllamaHost/api/tags") {
      Write-Host "Ollama server is ready."
      return
    }
  }
  throw "Ollama server did not respond within 30 seconds."
}

function Ensure-Model([string]$OllamaExe) {
  $models = Get-OllamaModelNames $OllamaHost
  if ($models -contains $ModelName) {
    Write-Host "$ModelName model is available."
    return
  }

  if ($AllowDownload) {
    Write-Step "Downloading $ModelName"
    & $OllamaExe pull $ModelName
    if ($LASTEXITCODE -ne 0) { throw "ollama pull $ModelName failed." }
    return
  }

  throw "$ModelName model is not available. Include models/ for closed-network install or rerun with -AllowDownload on an online PC."
}

function Invoke-OllamaChat($Body) {
  $json = $Body | ConvertTo-Json -Depth 20 -Compress
  return Invoke-RestMethod -Uri "http://$OllamaHost/api/chat" -Method Post -ContentType "application/json" -Body $json -TimeoutSec 180
}

function Test-GemmaMultimodal {
  Write-Step "Testing text response"
  $textResult = Invoke-OllamaChat @{
    model = $ModelName
    stream = $false
    messages = @(
      @{ role = "system"; content = "Answer briefly in Korean." },
      @{ role = "user"; content = "Gongmu local AI setup check. Reply with one short sentence." }
    )
  }
  if (!$textResult.message.content) { throw "Text response was empty." }
  Write-Host $textResult.message.content

  Write-Step "Testing image input API"
  $onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII="
  $imageResult = Invoke-OllamaChat @{
    model = $ModelName
    stream = $false
    messages = @(
      @{ role = "user"; content = "Can you receive the attached image? Reply briefly in Korean."; images = @($onePixelPng) }
    )
  }
  if (!$imageResult.message.content) { throw "Image input response was empty." }
  Write-Host $imageResult.message.content
}

function Write-GongmuSettings {
  Write-Step "Writing Gongmu model settings"
  $workspace = Join-Path $env:LOCALAPPDATA "kr.gongmu.workspace\\runtime-workspace"
  New-Item -ItemType Directory -Force -Path $workspace | Out-Null
  $settingsPath = Join-Path $workspace "settings.json"
  $baseUrl = "http://$OllamaHost"
  $profile = @{
    provider = "ollama"
    model = $ModelName
    api_key = $null
    base_url = $baseUrl
    site_url = $null
    application_name = $null
  }
  $settings = [ordered]@{
    llm_mode = "local_first"
    llm_provider = "ollama"
    llm_model = $ModelName
    llm_api_key = $null
    llm_site_url = $null
    llm_application_name = $null
    internal_api_base_url = $baseUrl
    llm_profiles = @{
      local_first = $profile
      internal_server = @{
        provider = "openai_compatible"
        model = "gpt-4.1-mini"
        api_key = $null
        base_url = "http://127.0.0.1:9000/v1"
        site_url = $null
        application_name = $null
      }
      external_model = @{
        active_provider = "ollama"
        providers = @{
          ollama = $profile
        }
      }
    }
    embedding_provider = "deterministic"
    embedding_model = "nomic-embed-text"
    embedding_base_url = $baseUrl
    embedding_fallback_enabled = $true
    graphrag_vector_backend = "chromadb"
  }
  $settings | ConvertTo-Json -Depth 30 | Set-Content -Path $settingsPath -Encoding UTF8
  Write-Host "Settings written: $settingsPath"
}

try {
  Write-Step "Gongmu local AI setup"
  # 의존성(Python/Ollama/모델/서버)을 먼저 준비하고 설정을 쓴 뒤, 공무원 앱은 마지막에 설치한다.
  # 앱을 먼저 설치하면 NSIS 마침 화면에서 앱이 자동 실행되는데, 그 시점엔 Ollama/모델/설정이
  # 아직 없어 'LLM 미연결' 상태로 열린다. 앱을 마지막에 두면 자동 실행돼도 곧바로 정상 동작한다.
  # (settings.json이 이미 있으면 앱은 그것을 읽고 덮어쓰지 않는다 — settings.py:load)
  Install-Python311IfAvailable
  Write-WslOptionalStatus
  $ollamaExe = Install-OllamaIfNeeded
  Import-PackagedModelStore | Out-Null
  Start-OllamaServer $ollamaExe
  Ensure-Model $ollamaExe
  Test-GemmaMultimodal
  Write-GongmuSettings
  Install-GongmuIfPresent
  Write-Step "Setup complete"
  Write-Host "Gongmu now uses Ollama / $ModelName by default. Open Gongmu to start."
} finally {
  Stop-Transcript | Out-Null
}
`;
}

function validateScriptContent() {
  return `#requires -Version 5.1
param(
  [string]$ModelName = "${MODEL_NAME}",
  [string]$OllamaHost = "127.0.0.1:11434"
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogPath = Join-Path $ScriptRoot "validate-gongmu-ai.log"
Start-Transcript -Path $LogPath -Append | Out-Null

${commonPowerShellFunctions()}

Write-Host "공무원 로컬 AI 검증을 시작합니다. 결과는 validate-gongmu-ai.log 에 기록됩니다."

try {
  Write-Step "Validating Python 3.11"
  $python = Find-Python311
  if ($python) {
    Write-Host "Python 3.11 found: $python"
  } else {
    Write-Warn "Python 3.11 not found. This does not block normal bundled app use."
  }

  Write-Step "Validating Ollama"
  $ollama = Find-OllamaExe
  if (!$ollama) { throw "Ollama executable was not found." }
  Write-Host "Ollama found: $ollama"

  if (!(Test-HttpOk "http://$OllamaHost/api/tags")) {
    throw "Ollama server is not responding at http://$OllamaHost. Run START_INSTALL.bat first."
  }

  $models = Get-OllamaModelNames $OllamaHost
  if (!($models -contains $ModelName)) {
    throw "$ModelName is not listed by Ollama."
  }
  Write-Host "$ModelName model is available."

  Write-Step "Validating Gongmu settings"
  $settingsPath = Join-Path $env:LOCALAPPDATA "kr.gongmu.workspace\\runtime-workspace\\settings.json"
  if (!(Test-Path $settingsPath)) {
    throw "Gongmu settings.json was not found: $settingsPath"
  }
  $settingsText = Get-Content -Raw -Path $settingsPath
  if ($settingsText -notmatch "ollama" -or $settingsText -notmatch [regex]::Escape($ModelName)) {
    throw "Gongmu settings.json does not point to Ollama / $ModelName."
  }
  Write-Host "Settings OK: $settingsPath"

  Write-Step "Validation complete"
} finally {
  Stop-Transcript | Out-Null
}
`;
}

function evidenceScriptContent() {
  return `#requires -Version 5.1
param(
  [string]$ModelName = "${MODEL_NAME}",
  [string]$OllamaHost = "127.0.0.1:11434",
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (!$OutputDir) { $OutputDir = Join-Path $ScriptRoot "evidence" }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$LogPath = Join-Path $OutputDir "collect-clean-account-evidence.log"
Start-Transcript -Path $LogPath -Append | Out-Null

${commonPowerShellFunctions()}

Write-Host "공무원 설치 증거 수집을 시작합니다. 결과는 evidence 폴더에 저장됩니다."

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $script:Checks += [ordered]@{
    name = $Name
    passed = $Passed
    detail = $Detail
  }
}

function Invoke-OllamaChatEvidence($Body) {
  $json = $Body | ConvertTo-Json -Depth 20 -Compress
  return Invoke-RestMethod -Uri "http://$OllamaHost/api/chat" -Method Post -ContentType "application/json" -Body $json -TimeoutSec 180
}

function Get-FileHashOrNull([string]$Path) {
  if (!(Test-Path $Path)) { return $null }
  return (Get-FileHash -Path $Path -Algorithm SHA256).Hash
}

$script:Checks = @()
$StartedAt = (Get-Date).ToString("o")
$InstallLog = Join-Path $ScriptRoot "install-gongmu-ai.log"
$ValidateLog = Join-Path $ScriptRoot "validate-gongmu-ai.log"
$SettingsPath = Join-Path $env:LOCALAPPDATA "kr.gongmu.workspace\\runtime-workspace\\settings.json"
$TextResponse = $null
$ImageResponse = $null
$ModelNames = @()

try {
  Write-Step "Gongmu clean-account evidence"

  $python = Find-Python311
  Add-Check "Python 3.11 detected or optional" $true ($(if ($python) { "Python 3.11: $python" } else { "Python 3.11 not detected; bundled app does not require system Python." }))

  $wsl = Get-WslStatus
  Add-Check "WSL optional status" $true $wsl.detail

  $ollama = Find-OllamaExe
  Add-Check "Ollama executable detected" ([bool]$ollama) ($(if ($ollama) { $ollama } else { "ollama.exe not found" }))

  $serverOk = Test-HttpOk "http://$OllamaHost/api/tags"
  Add-Check "Ollama server responding" $serverOk "http://$OllamaHost/api/tags"

  if ($serverOk) {
    $ModelNames = Get-OllamaModelNames $OllamaHost
    Add-Check "$ModelName model listed" ($ModelNames -contains $ModelName) ($ModelNames -join ", ")

    try {
      $textResult = Invoke-OllamaChatEvidence @{
        model = $ModelName
        stream = $false
        messages = @(
          @{ role = "system"; content = "Answer briefly in Korean." },
          @{ role = "user"; content = "Gongmu clean account validation. Reply with one short sentence." }
        )
      }
      $TextResponse = $textResult.message.content
      Add-Check "Text chat response" ([bool]$TextResponse) $TextResponse
    } catch {
      Add-Check "Text chat response" $false $_.Exception.Message
    }

    try {
      $onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII="
      $imageResult = Invoke-OllamaChatEvidence @{
        model = $ModelName
        stream = $false
        messages = @(
          @{ role = "user"; content = "Can you receive this image input? Reply briefly in Korean."; images = @($onePixelPng) }
        )
      }
      $ImageResponse = $imageResult.message.content
      Add-Check "Image chat response" ([bool]$ImageResponse) $ImageResponse
    } catch {
      Add-Check "Image chat response" $false $_.Exception.Message
    }
  }

  $settingsExists = Test-Path $SettingsPath
  $settingsText = if ($settingsExists) { Get-Content -Raw -Path $SettingsPath } else { "" }
  Add-Check "Gongmu settings file exists" $settingsExists $SettingsPath
  Add-Check "Gongmu settings point to Ollama model" ($settingsText -match "ollama" -and $settingsText -match [regex]::Escape($ModelName)) $SettingsPath

  Add-Check "Install log exists" (Test-Path $InstallLog) $InstallLog
  Add-Check "Validation log exists" (Test-Path $ValidateLog) $ValidateLog

  $Ready = -not ($Checks | Where-Object { -not $_.passed })
  $EvidenceJson = Join-Path $OutputDir "ai-pack-clean-account-evidence.json"
  $EvidenceMd = Join-Path $OutputDir "ai-pack-clean-account-evidence.md"
  $CompletedAt = (Get-Date).ToString("o")

  $Report = [ordered]@{
    schemaVersion = 1
    title = "Gongmu clean-account evidence"
    ready = $Ready
    startedAt = $StartedAt
    completedAt = $CompletedAt
    computerName = $env:COMPUTERNAME
    userName = $env:USERNAME
    os = (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber)
    packageDir = $ScriptRoot
    modelName = $ModelName
    ollamaHost = $OllamaHost
    python = $python
    ollamaExe = $ollama
    modelNames = $ModelNames
    settingsPath = $SettingsPath
    installLog = @{
      path = $InstallLog
      exists = Test-Path $InstallLog
      sha256 = Get-FileHashOrNull $InstallLog
    }
    validateLog = @{
      path = $ValidateLog
      exists = Test-Path $ValidateLog
      sha256 = Get-FileHashOrNull $ValidateLog
    }
    textResponse = $TextResponse
    imageResponse = $ImageResponse
    checks = $Checks
  }

  $Report | ConvertTo-Json -Depth 30 | Set-Content -Path $EvidenceJson -Encoding UTF8

  $lines = @()
  $lines += "# Gongmu clean-account evidence"
  $lines += ""
  $lines += "- ready: $Ready"
  $lines += "- computerName: $env:COMPUTERNAME"
  $lines += "- userName: $env:USERNAME"
  $lines += "- modelName: $ModelName"
  $lines += "- ollamaHost: $OllamaHost"
  $lines += "- settingsPath: $SettingsPath"
  $lines += ""
  $lines += "## Checks"
  foreach ($check in $Checks) {
    $status = if ($check.passed) { "PASS" } else { "FAIL" }
    $lines += "- $status $($check.name): $($check.detail)"
  }
  $lines += ""
  $lines += "## Evidence files"
  $lines += "- JSON: $EvidenceJson"
  $lines += "- Markdown: $EvidenceMd"
  $lines += "- Collector log: $LogPath"
  $lines | Set-Content -Path $EvidenceMd -Encoding UTF8

  Write-Host "Evidence JSON: $EvidenceJson"
  Write-Host "Evidence Markdown: $EvidenceMd"
  if (!$Ready) {
    throw "Clean-account evidence has failing checks. See $EvidenceMd"
  }
} finally {
  Stop-Transcript | Out-Null
}
`;
}

async function writeInstallScript(path) {
  await writeTextFile(path, `\uFEFF${installScriptContent()}`);
}

async function writeValidateScript(path) {
  await writeTextFile(path, `\uFEFF${validateScriptContent()}`);
}

async function writeEvidenceScript(path) {
  await writeTextFile(path, `\uFEFF${evidenceScriptContent()}`);
}

function guiInstallScriptContent() {
  const windowTitle = "\uACF5\uBB34\uC6D0 AI \uC124\uCE58 \uBAA8\uB2C8\uD130";
  const currentStage = "\uD604\uC7AC \uB2E8\uACC4";
  const helpTitle = "\uD544\uC694\uD55C \uC791\uC5C5 \uC548\uB0B4";
  const logTitle = "\uCD5C\uADFC \uC124\uCE58 \uB85C\uADF8";
  const openLog = "\uB85C\uADF8 \uC5F4\uAE30";
  const openFolder = "\uD3F4\uB354 \uC5F4\uAE30";
  const closeText = "\uB2EB\uAE30";
  const preparing = "\uC124\uCE58 \uC900\uBE44 \uC911";
  const preparingHelp = "\uC7A0\uC2DC \uD6C4 \uC124\uCE58\uB97C \uC2DC\uC791\uD569\uB2C8\uB2E4. \uC774 \uCC3D\uC740 \uB2EB\uC9C0 \uB9C8\uC138\uC694.";
  const noLog = "\uC544\uC9C1 \uB85C\uADF8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uC124\uCE58\uAC00 \uC2DC\uC791\uB418\uBA74 \uC774\uACF3\uC5D0 \uC9C4\uD589 \uB0B4\uC6A9\uC774 \uD45C\uC2DC\uB429\uB2C8\uB2E4.";
  const completed = "\uC124\uCE58 \uC644\uB8CC";
  const completedHelp = "\uAE30\uBCF8 \uC124\uCE58\uC640 AI \uC751\uB2F5 \uAC80\uC99D\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uD544\uC694\uD558\uBA74 VALIDATE_INSTALL.bat\uB85C \uCD94\uAC00 \uAC80\uC99D\uC744 \uC2E4\uD589\uD558\uC138\uC694.";
  const failed = "\uC124\uCE58 \uD655\uC778 \uD544\uC694";
  const failedHelp = "\uC124\uCE58 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uB85C\uADF8 \uC5F4\uAE30\uB85C \uC0C1\uC138 \uC624\uB958\uB97C \uD655\uC778\uD558\uACE0, \uBA48\uCD98 \uC124\uCE58 \uCC3D\uC774 \uC788\uB294\uC9C0 \uD655\uC778\uD574\uC8FC\uC138\uC694.";

  return String.raw`#requires -Version 5.1
$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallScript = Join-Path $ScriptRoot "install-gongmu-ai.ps1"
$InstallLogPath = Join-Path $ScriptRoot "install-gongmu-ai.log"
$MonitorLogPath = Join-Path $ScriptRoot "install-gongmu-ai-gui.log"

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
} catch {
  Write-Host "Windows Forms is not available. Falling back to console setup."
  & $InstallScript
  exit $LASTEXITCODE
}

if (!(Test-Path $InstallScript)) {
  [System.Windows.Forms.MessageBox]::Show("install-gongmu-ai.ps1 was not found in this folder.", "${windowTitle}", "OK", "Error") | Out-Null
  exit 1
}

function Read-TextTail([string]$Path, [int]$MaxChars = 16000) {
  if (!(Test-Path $Path)) { return "" }
  try {
    $text = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    if ($text.Length -gt $MaxChars) {
      return $text.Substring($text.Length - $MaxChars)
    }
    return $text
  } catch {
    return "Unable to read log: $($_.Exception.Message)"
  }
}

function Format-Elapsed([datetime]$Start) {
  $elapsed = New-TimeSpan -Start $Start -End (Get-Date)
  return "{0:00}:{1:00}:{2:00}" -f [int]$elapsed.TotalHours, $elapsed.Minutes, $elapsed.Seconds
}

function Convert-UiText([string]$Text) {
  return [regex]::Replace($Text, "\\u([0-9a-fA-F]{4})", {
    param($Match)
    return [char][Convert]::ToInt32($Match.Groups[1].Value, 16)
  })
}

# '따라하기 그림' 원본: 실제 설치 화면 캡처 (빌드 시 base64 내장)
$ImgOllamaWizardB64 = "${guideImageBase64("ollama-wizard.png")}"
$ImgOllamaAppB64 = "${guideImageBase64("ollama-app.png")}"
$ImgGongmuWizardB64 = "${guideImageBase64("gongmu-wizard.png")}"

function ConvertTo-GuideImage([string]$Base64) {
  try {
    $bytes = [Convert]::FromBase64String($Base64)
    $stream = New-Object System.IO.MemoryStream(,$bytes)
    return [System.Drawing.Image]::FromStream($stream)
  } catch {
    return $null
  }
}

$script:ImgOllamaWizard = ConvertTo-GuideImage $ImgOllamaWizardB64
$script:ImgOllamaApp = ConvertTo-GuideImage $ImgOllamaAppB64
$script:ImgGongmuWizard = ConvertTo-GuideImage $ImgGongmuWizardB64

$script:GuideTexts = @{
  idle = Convert-UiText "${escapeNonAscii("이 단계는 자동으로 진행됩니다.\n\n사용자가 직접 할 작업이 생기면 이곳에 실제 화면 그림과 함께 안내가 나타납니다.")}"
  ollamaCap1 = Convert-UiText "${escapeNonAscii("① 이 창이 열리면 [Install] 버튼을 누르세요")}"
  ollamaCap2 = Convert-UiText "${escapeNonAscii("② 설치 후 이 창이 열리면 오른쪽 위 X로 닫으세요")}"
  gongmuCap1 = Convert-UiText "${escapeNonAscii("① 이 창이 열리면 [다음]을 눌러 설치를 완료하세요")}"
}

function Set-GuidePanel([string]$Key) {
  $showPics = $false
  if ($Key -eq "ollama" -and $script:ImgOllamaWizard) {
    $script:GuidePic1.Image = $script:ImgOllamaWizard
    $script:GuideCap1.Text = $script:GuideTexts.ollamaCap1
    $script:GuidePic2.Image = $script:ImgOllamaApp
    $script:GuideCap2.Text = $script:GuideTexts.ollamaCap2
    $script:GuidePic2.Visible = ($null -ne $script:ImgOllamaApp)
    $script:GuideCap2.Visible = ($null -ne $script:ImgOllamaApp)
    $showPics = $true
  } elseif ($Key -eq "gongmu" -and $script:ImgGongmuWizard) {
    $script:GuidePic1.Image = $script:ImgGongmuWizard
    $script:GuideCap1.Text = $script:GuideTexts.gongmuCap1
    $script:GuidePic2.Visible = $false
    $script:GuideCap2.Visible = $false
    $showPics = $true
  }
  $script:GuidePic1.Visible = $showPics
  $script:GuideCap1.Visible = $showPics
  if (-not $showPics) {
    $script:GuidePic2.Visible = $false
    $script:GuideCap2.Visible = $false
  }
  $script:GuideInfo.Visible = -not $showPics
}

$script:Stages = @(
  [pscustomobject]@{ Pattern = "Gongmu local AI setup"; Name = "\uC124\uCE58 \uC900\uBE44"; Help = "\uC124\uCE58 \uD658\uACBD\uC744 \uD655\uC778\uD558\uACE0 \uC2DC\uC791\uD569\uB2C8\uB2E4."; Percent = 3 },
  [pscustomobject]@{ Pattern = "Checking Python 3.11"; Name = "Python 3.11 \uD655\uC778"; Help = "Python\uC740 \uBC88\uB4E4 \uC571 \uC2E4\uD589\uC5D0 \uD544\uC218\uB294 \uC544\uB2C8\uC9C0\uB9CC, \uC9C4\uB2E8\uACFC \uBCF5\uAD6C\uC6A9\uC73C\uB85C \uD655\uC778\uD569\uB2C8\uB2E4."; Percent = 10 },
  [pscustomobject]@{ Pattern = "Installing Python 3.11"; Name = "Python 3.11 \uC124\uCE58"; Help = "Python \uC124\uCE58\uAC00 \uC9C4\uD589 \uC911\uC785\uB2C8\uB2E4. \uC774 \uCC3D\uC740 \uB2EB\uC9C0 \uB9C8\uC138\uC694."; Percent = 16 },
  [pscustomobject]@{ Pattern = "Checking optional WSL"; Name = "WSL \uC120\uD0DD \uC9C4\uB2E8"; Help = "WSL\uC740 \uACF5\uBB34\uC6D0\uACFC Windows\uC6A9 Ollama \uC2E4\uD589\uC5D0 \uD544\uC218\uAC00 \uC544\uB2D9\uB2C8\uB2E4. \uC0C1\uD0DC\uB9CC \uAE30\uB85D\uD569\uB2C8\uB2E4."; Percent = 22 },
  [pscustomobject]@{ Pattern = "Checking Ollama"; Name = "Ollama \uD655\uC778"; Help = "\uB85C\uCEEC AI \uC5D4\uC9C4\uC778 Ollama\uAC00 \uC124\uCE58\uB418\uC5C8\uB294\uC9C0 \uD655\uC778\uD569\uB2C8\uB2E4."; Percent = 30 },
  [pscustomobject]@{ Pattern = "Starting Ollama installer"; Name = "Ollama \uC124\uCE58"; Help = "${escapeNonAscii("\uC624\uB978\uCABD \uADF8\uB9BC\uCC98\uB7FC Ollama \uC124\uCE58 \uCC3D\uC774 \uC5F4\uB9AC\uBA74 [Install] \uBC84\uD2BC\uC744 \uB204\uB974\uC138\uC694. \uC124\uCE58 \uD6C4 Ollama \uCC3D\uC774 \uC0C8\uB85C \uC5F4\uB9AC\uBA74 \uC624\uB978\uCABD \uC704 X\uB85C \uB2EB\uC544\uC8FC\uC138\uC694.")}"; Percent = 40; Guide = "ollama" },
  [pscustomobject]@{ Pattern = "Copying packaged Ollama model cache"; Name = "Gemma \uBAA8\uB378 \uBCF5\uC0AC"; Help = "Gemma \uBAA8\uB378 \uCE90\uC2DC\uB97C \uBCF5\uC0AC\uD569\uB2C8\uB2E4. \uBA87 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC73C\uB2C8 \uAE30\uB2E4\uB824\uC8FC\uC138\uC694."; Percent = 60 },
  [pscustomobject]@{ Pattern = "Starting Ollama server"; Name = "Ollama \uC11C\uBC84 \uC2DC\uC791"; Help = "\uB85C\uCEEC AI \uC11C\uBC84\uB97C \uC2DC\uC791\uD558\uACE0 \uC751\uB2F5 \uC0C1\uD0DC\uB97C \uD655\uC778\uD569\uB2C8\uB2E4."; Percent = 72 },
  [pscustomobject]@{ Pattern = "Testing text response"; Name = "\uD14D\uC2A4\uD2B8 \uC751\uB2F5 \uAC80\uC99D"; Help = "Gemma \uBAA8\uB378\uC758 \uAE30\uBCF8 \uB300\uD654 \uC751\uB2F5\uC744 \uD655\uC778\uD569\uB2C8\uB2E4."; Percent = 80 },
  [pscustomobject]@{ Pattern = "Testing image input API"; Name = "\uC774\uBBF8\uC9C0 \uC785\uB825 \uAC80\uC99D"; Help = "\uBA40\uD2F0\uBAA8\uB2EC \uC774\uBBF8\uC9C0 \uC785\uB825 API\uAC00 \uC751\uB2F5\uD558\uB294\uC9C0 \uD655\uC778\uD569\uB2C8\uB2E4."; Percent = 86 },
  [pscustomobject]@{ Pattern = "Writing Gongmu model settings"; Name = "\uACF5\uBB34\uC6D0 \uBAA8\uB378 \uC124\uC815"; Help = "\uC571\uC774 Ollama/Gemma\uB97C \uC0AC\uC6A9\uD558\uB3C4\uB85D \uC124\uC815\uC744 \uC800\uC7A5\uD569\uB2C8\uB2E4."; Percent = 90 },
  [pscustomobject]@{ Pattern = "Starting Gongmu installer"; Name = "\uACF5\uBB34\uC6D0 \uC571 \uC124\uCE58"; Help = "${escapeNonAscii("\uB9C8\uC9C0\uB9C9 \uB2E8\uACC4\uC785\uB2C8\uB2E4. \uC624\uB978\uCABD \uADF8\uB9BC\uCC98\uB7FC \uACF5\uBB34\uC6D0 \uC124\uCE58 \uCC3D\uC774 \uC5F4\uB9AC\uBA74 [\uB2E4\uC74C]\uC744 \uB20C\uB7EC \uC124\uCE58\uB97C \uC644\uB8CC\uD558\uC138\uC694. \uAC19\uC740 \uBC84\uC804\uC774 \uC774\uBBF8 \uC124\uCE58\uB418\uC5B4 \uC788\uC73C\uBA74 \uC790\uB3D9\uC73C\uB85C \uAC74\uB108\uB701\uB2C8\uB2E4.")}"; Percent = 95; Guide = "gongmu" },
  [pscustomobject]@{ Pattern = "Setup complete"; Name = "${completed}"; Help = "${completedHelp}"; Percent = 100 }
)

function Get-LatestStage([string]$LogText) {
  $latest = $script:Stages[0]
  foreach ($stage in $script:Stages) {
    if ($LogText -match [regex]::Escape($stage.Pattern)) {
      $latest = $stage
    }
  }
  return $latest
}

[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "${windowTitle}"
$form.Size = New-Object System.Drawing.Size(1120, 620)
$form.MinimumSize = New-Object System.Drawing.Size(1120, 580)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(250, 250, 248)
$form.Font = New-Object System.Drawing.Font("Malgun Gothic", 10)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = "${windowTitle}"
$titleLabel.Font = New-Object System.Drawing.Font("Malgun Gothic", 18, [System.Drawing.FontStyle]::Bold)
$titleLabel.AutoSize = $false
$titleLabel.Location = New-Object System.Drawing.Point(24, 18)
$titleLabel.Size = New-Object System.Drawing.Size(700, 42)
$form.Controls.Add($titleLabel)

$stageCaption = New-Object System.Windows.Forms.Label
$stageCaption.Text = "${currentStage}"
$stageCaption.Location = New-Object System.Drawing.Point(26, 78)
$stageCaption.Size = New-Object System.Drawing.Size(160, 24)
$form.Controls.Add($stageCaption)

$stageLabel = New-Object System.Windows.Forms.Label
$stageLabel.Text = "${preparing}"
$stageLabel.Font = New-Object System.Drawing.Font("Malgun Gothic", 14, [System.Drawing.FontStyle]::Bold)
$stageLabel.Location = New-Object System.Drawing.Point(26, 104)
$stageLabel.Size = New-Object System.Drawing.Size(500, 34)
$form.Controls.Add($stageLabel)
$script:StageLabel = $stageLabel

$elapsedLabel = New-Object System.Windows.Forms.Label
$elapsedLabel.Text = "00:00:00"
$elapsedLabel.TextAlign = "MiddleRight"
$elapsedLabel.Location = New-Object System.Drawing.Point(560, 106)
$elapsedLabel.Size = New-Object System.Drawing.Size(150, 28)
$form.Controls.Add($elapsedLabel)
$script:ElapsedLabel = $elapsedLabel

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Location = New-Object System.Drawing.Point(28, 148)
$progressBar.Size = New-Object System.Drawing.Size(690, 22)
$progressBar.Minimum = 0
$progressBar.Maximum = 100
$progressBar.Value = 3
$form.Controls.Add($progressBar)
$script:ProgressBar = $progressBar

$helpCaption = New-Object System.Windows.Forms.Label
$helpCaption.Text = "${helpTitle}"
$helpCaption.Font = New-Object System.Drawing.Font("Malgun Gothic", 11, [System.Drawing.FontStyle]::Bold)
$helpCaption.Location = New-Object System.Drawing.Point(26, 194)
$helpCaption.Size = New-Object System.Drawing.Size(690, 24)
$form.Controls.Add($helpCaption)

$helpBox = New-Object System.Windows.Forms.TextBox
$helpBox.Multiline = $true
$helpBox.ReadOnly = $true
$helpBox.BorderStyle = "FixedSingle"
$helpBox.BackColor = [System.Drawing.Color]::White
$helpBox.Location = New-Object System.Drawing.Point(28, 224)
$helpBox.Size = New-Object System.Drawing.Size(690, 86)
$helpBox.Anchor = "Top,Left"
$helpBox.Text = "${preparingHelp}"
$form.Controls.Add($helpBox)
$script:HelpBox = $helpBox

$logCaption = New-Object System.Windows.Forms.Label
$logCaption.Text = "${logTitle}"
$logCaption.Font = New-Object System.Drawing.Font("Malgun Gothic", 11, [System.Drawing.FontStyle]::Bold)
$logCaption.Location = New-Object System.Drawing.Point(26, 334)
$logCaption.Size = New-Object System.Drawing.Size(690, 24)
$form.Controls.Add($logCaption)

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = "Vertical"
$logBox.WordWrap = $false
$logBox.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 18)
$logBox.ForeColor = [System.Drawing.Color]::FromArgb(235, 235, 235)
$logBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$logBox.Location = New-Object System.Drawing.Point(28, 362)
$logBox.Size = New-Object System.Drawing.Size(690, 150)
$logBox.Anchor = "Top,Left,Bottom"
$logBox.Text = "${noLog}"
$form.Controls.Add($logBox)
$script:LogBox = $logBox

$openLogButton = New-Object System.Windows.Forms.Button
$openLogButton.Text = "${openLog}"
$openLogButton.Location = New-Object System.Drawing.Point(28, 528)
$openLogButton.Size = New-Object System.Drawing.Size(120, 34)
$openLogButton.Anchor = "Left,Bottom"
$openLogButton.Add_Click({
  if (Test-Path $InstallLogPath) {
    Start-Process notepad.exe $InstallLogPath
  } else {
    [System.Windows.Forms.MessageBox]::Show("${noLog}", "${windowTitle}") | Out-Null
  }
})
$form.Controls.Add($openLogButton)

$openFolderButton = New-Object System.Windows.Forms.Button
$openFolderButton.Text = "${openFolder}"
$openFolderButton.Location = New-Object System.Drawing.Point(158, 528)
$openFolderButton.Size = New-Object System.Drawing.Size(120, 34)
$openFolderButton.Anchor = "Left,Bottom"
$openFolderButton.Add_Click({ Start-Process explorer.exe $ScriptRoot })
$form.Controls.Add($openFolderButton)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Text = "${closeText}"
$closeButton.Location = New-Object System.Drawing.Point(598, 528)
$closeButton.Size = New-Object System.Drawing.Size(120, 34)
$closeButton.Anchor = "Left,Bottom"
$closeButton.Add_Click({ $form.Close() })
$form.Controls.Add($closeButton)

# 오른쪽 '따라하기 그림' 패널: 사용자가 직접 눌러야 하는 단계에서 실제 화면 캡처를 표시한다.
$guideCaption = New-Object System.Windows.Forms.Label
$guideCaption.Text = Convert-UiText "${escapeNonAscii("따라하기 그림 안내")}"
$guideCaption.Font = New-Object System.Drawing.Font("Malgun Gothic", 11, [System.Drawing.FontStyle]::Bold)
$guideCaption.Location = New-Object System.Drawing.Point(740, 78)
$guideCaption.Size = New-Object System.Drawing.Size(354, 24)
$form.Controls.Add($guideCaption)

$guidePanel = New-Object System.Windows.Forms.Panel
$guidePanel.Location = New-Object System.Drawing.Point(740, 104)
$guidePanel.Size = New-Object System.Drawing.Size(354, 460)
$guidePanel.BorderStyle = "FixedSingle"
$guidePanel.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($guidePanel)

$guideInfo = New-Object System.Windows.Forms.Label
$guideInfo.Text = $script:GuideTexts.idle
$guideInfo.Location = New-Object System.Drawing.Point(14, 16)
$guideInfo.Size = New-Object System.Drawing.Size(324, 140)
$guideInfo.ForeColor = [System.Drawing.Color]::FromArgb(90, 90, 90)
$guidePanel.Controls.Add($guideInfo)
$script:GuideInfo = $guideInfo

$guidePic1 = New-Object System.Windows.Forms.PictureBox
$guidePic1.Location = New-Object System.Drawing.Point(8, 6)
$guidePic1.Size = New-Object System.Drawing.Size(336, 204)
$guidePic1.SizeMode = "Zoom"
$guidePic1.Visible = $false
$guidePanel.Controls.Add($guidePic1)
$script:GuidePic1 = $guidePic1

$guideCap1 = New-Object System.Windows.Forms.Label
$guideCap1.Font = New-Object System.Drawing.Font("Malgun Gothic", 9.5, [System.Drawing.FontStyle]::Bold)
$guideCap1.Location = New-Object System.Drawing.Point(8, 212)
$guideCap1.Size = New-Object System.Drawing.Size(336, 38)
$guideCap1.Visible = $false
$guidePanel.Controls.Add($guideCap1)
$script:GuideCap1 = $guideCap1

$guidePic2 = New-Object System.Windows.Forms.PictureBox
$guidePic2.Location = New-Object System.Drawing.Point(8, 252)
$guidePic2.Size = New-Object System.Drawing.Size(336, 162)
$guidePic2.SizeMode = "Zoom"
$guidePic2.Visible = $false
$guidePanel.Controls.Add($guidePic2)
$script:GuidePic2 = $guidePic2

$guideCap2 = New-Object System.Windows.Forms.Label
$guideCap2.Font = New-Object System.Drawing.Font("Malgun Gothic", 9.5, [System.Drawing.FontStyle]::Bold)
$guideCap2.Location = New-Object System.Drawing.Point(8, 416)
$guideCap2.Size = New-Object System.Drawing.Size(336, 38)
$guideCap2.Visible = $false
$guidePanel.Controls.Add($guideCap2)
$script:GuideCap2 = $guideCap2

$script:CurrentGuideKey = "-"

$script:StartedAt = Get-Date
$script:Process = $null

function Start-InstallProcess {
  "[$(Get-Date -Format o)] Launching install-gongmu-ai.ps1" | Set-Content -LiteralPath $MonitorLogPath -Encoding UTF8
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "powershell.exe"
  $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + '"' + $InstallScript + '"'
  $psi.WorkingDirectory = $ScriptRoot
  $psi.UseShellExecute = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $script:Process = [System.Diagnostics.Process]::Start($psi)
}

function Update-Monitor {
  $combined = ((Read-TextTail $MonitorLogPath 3000) + [Environment]::NewLine + (Read-TextTail $InstallLogPath 16000)).Trim()
  if ([string]::IsNullOrWhiteSpace($combined)) {
    $combined = "${noLog}"
  }

  $stage = Get-LatestStage $combined
  $script:StageLabel.Text = Convert-UiText $stage.Name
  $script:HelpBox.Text = Convert-UiText $stage.Help
  $script:ElapsedLabel.Text = Format-Elapsed $script:StartedAt
  if ($stage.Percent -ge 0 -and $stage.Percent -le 100) {
    $script:ProgressBar.Value = [int]$stage.Percent
  }

  $guideKey = ""
  if ($stage.PSObject.Properties["Guide"] -and $stage.Guide) { $guideKey = [string]$stage.Guide }
  if ($script:CurrentGuideKey -ne $guideKey) {
    $script:CurrentGuideKey = $guideKey
    Set-GuidePanel $guideKey
  }

  $script:LogBox.Text = $combined
  $script:LogBox.SelectionStart = $script:LogBox.TextLength
  $script:LogBox.ScrollToCaret()

  if ($script:Process -and $script:Process.HasExited) {
    $script:Timer.Stop()
    $script:CurrentGuideKey = ""
    Set-GuidePanel ""
    if ($script:Process.ExitCode -eq 0) {
      $script:StageLabel.Text = "${completed}"
      $script:HelpBox.Text = "${completedHelp}"
      $script:ProgressBar.Value = 100
    } else {
      $script:StageLabel.Text = "${failed}"
      $script:HelpBox.Text = "${failedHelp}" + [Environment]::NewLine + "Exit code: $($script:Process.ExitCode)"
      $script:ProgressBar.Value = [Math]::Max($script:ProgressBar.Value, 5)
    }
  }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({ Update-Monitor })
$script:Timer = $timer

$form.Add_Shown({
  try {
    Start-InstallProcess
    Update-Monitor
    $script:Timer.Start()
  } catch {
    $script:StageLabel.Text = "${failed}"
    $script:HelpBox.Text = "${failedHelp}" + [Environment]::NewLine + $_.Exception.Message
    Add-Content -LiteralPath $MonitorLogPath -Value $_.Exception.ToString() -Encoding UTF8
  }
})

[void]$form.ShowDialog()
if ($script:Process -and $script:Process.HasExited) {
  exit $script:Process.ExitCode
}
exit 0
`;
}

async function writeGuiInstallScript(path) {
  await writeTextFile(path, `\uFEFF${guiInstallScriptContent()}`);
}

// NOTE: Batch launchers must stay pure ASCII. cmd.exe re-reads .bat files by
// byte offset after each command; with chcp 65001 + multi-byte Korean text the
// offsets drift and cmd executes truncated fragments (e.g. "olicy", "og").
// All Korean guidance lives in the BOM-prefixed .ps1 scripts instead.
function guiInstallBatchScriptContent() {
  return `@echo off
chcp 65001 > nul
title Gongmu AI Setup Monitor
cd /d "%~dp0"
echo.
echo Gongmu AI Setup Monitor
echo Korean guidance will appear in the setup monitor window.
echo.
if "%GONGMU_AI_PACK_DRY_RUN%"=="1" (
  echo Dry run mode: launcher syntax is OK.
  exit /b 0
)
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0install-gongmu-ai-gui.ps1"
set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" (
  echo Setup needs attention. Exit code: %EXIT_CODE% - see install-gongmu-ai.log and install-gongmu-ai-gui.log
) else (
  echo Setup completed.
)
echo.
pause
exit /b %EXIT_CODE%
`;
}

function installBatchScriptContent() {
  return `@echo off
chcp 65001 > nul
title Gongmu Local AI Setup
cd /d "%~dp0"
echo.
echo Gongmu Local AI Setup
echo Korean guidance will appear in the installer window. Keep this window open.
echo.
if "%GONGMU_AI_PACK_DRY_RUN%"=="1" (
  echo Dry run mode: launcher syntax is OK.
  exit /b 0
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-gongmu-ai.ps1"
set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" (
  echo Setup failed. Exit code: %EXIT_CODE% - see install-gongmu-ai.log and run this file again.
) else (
  echo Setup and basic validation completed.
)
echo.
pause
exit /b %EXIT_CODE%
`;
}

function validateBatchScriptContent() {
  return `@echo off
chcp 65001 > nul
title Gongmu Local AI Validation
cd /d "%~dp0"
echo.
echo Gongmu Local AI Validation
echo Korean guidance will appear in the validation window.
echo.
if "%GONGMU_AI_PACK_DRY_RUN%"=="1" (
  echo Dry run mode: launcher syntax is OK.
  exit /b 0
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0validate-gongmu-ai.ps1"
set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" (
  echo Validation failed. Exit code: %EXIT_CODE% - see validate-gongmu-ai.log
) else (
  echo Validation completed.
)
echo.
pause
exit /b %EXIT_CODE%
`;
}

function collectEvidenceBatchScriptContent() {
  return `@echo off
chcp 65001 > nul
title Gongmu Clean Account Evidence
cd /d "%~dp0"
echo.
echo Gongmu Clean Account Evidence
echo Korean guidance will appear in the evidence window.
echo.
if "%GONGMU_AI_PACK_DRY_RUN%"=="1" (
  echo Dry run mode: launcher syntax is OK.
  exit /b 0
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect-clean-account-evidence.ps1"
set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" (
  echo Evidence collection has failing checks. Exit code: %EXIT_CODE% - see evidence\\ai-pack-clean-account-evidence.md
) else (
  echo Evidence collection completed. See evidence\\ai-pack-clean-account-evidence.md
)
echo.
pause
exit /b %EXIT_CODE%
`;
}

function fullValidationBatchScriptContent() {
  return `@echo off
chcp 65001 > nul
title Gongmu Local AI Full Validation
cd /d "%~dp0"
echo.
echo Gongmu Local AI Full Validation: install + validate + evidence.
echo Korean guidance will appear in the installer window. Keep this window open.
echo.
if "%GONGMU_AI_PACK_DRY_RUN%"=="1" (
  echo Dry run mode: launcher syntax is OK.
  exit /b 0
)

set "EXIT_CODE=0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-gongmu-ai.ps1"
set "INSTALL_EXIT=%ERRORLEVEL%"
if not "%INSTALL_EXIT%"=="0" set "EXIT_CODE=%INSTALL_EXIT%"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0validate-gongmu-ai.ps1"
set "VALIDATE_EXIT=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" if not "%VALIDATE_EXIT%"=="0" set "EXIT_CODE=%VALIDATE_EXIT%"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect-clean-account-evidence.ps1"
set "EVIDENCE_EXIT=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" if not "%EVIDENCE_EXIT%"=="0" set "EXIT_CODE=%EVIDENCE_EXIT%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Full validation has failing items. Exit code: %EXIT_CODE% - see install-gongmu-ai.log, validate-gongmu-ai.log, evidence\\ai-pack-clean-account-evidence.md
) else (
  echo Full validation completed. Send evidence\\ai-pack-clean-account-evidence.json to the dev team.
)
echo.
pause
exit /b %EXIT_CODE%
`;
}

async function writeBatchLaunchers(packageDir) {
  const installContent = installBatchScriptContent();
  await writeTextFile(join(packageDir, "START_INSTALL_GUI.bat"), guiInstallBatchScriptContent());
  await writeTextFile(join(packageDir, "START_INSTALL.bat"), installContent);
  await writeTextFile(join(packageDir, "install-gongmu-ai.bat"), installContent);
  await writeTextFile(join(packageDir, "VALIDATE_INSTALL.bat"), validateBatchScriptContent());
  await writeTextFile(join(packageDir, "COLLECT_EVIDENCE.bat"), collectEvidenceBatchScriptContent());
  await writeTextFile(join(packageDir, "RUN_FULL_VALIDATION.bat"), fullValidationBatchScriptContent());
}

async function writeShaSums(packageDir) {
  const files = await listFiles(packageDir);
  const lines = [];
  for (const file of files.sort()) {
    const rel = relative(packageDir, file).replaceAll("\\", "/");
    if (rel === "SHA256SUMS.txt") continue;
    lines.push(`${await sha256(file)}  ${rel}`);
  }
  await writeFile(join(packageDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
}

async function compressPackage(packageDir, zipPath) {
  if (await pathExists(zipPath)) await rm(zipPath, { force: true });
  // Windows System32 tar.exe is bsdtar (libarchive): it handles drive-letter
  // paths and zip64 (>4GB). A bare "tar.exe" can resolve to MSYS/GNU tar, which
  // treats "C:\..." as a remote host and fails ("Cannot connect to C:").
  const bsdtar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  const tarResult = spawnSync(bsdtar, ["-a", "-cf", zipPath, "-C", packageDir, "."], {
    encoding: "utf8",
  });
  if (tarResult.status === 0) return;

  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Compress-Archive -Path ${JSON.stringify(join(packageDir, "*"))} -DestinationPath ${JSON.stringify(zipPath)} -Force`,
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `tar.exe failed: ${tarResult.stderr || tarResult.stdout}\nCompress-Archive failed: ${result.stderr || result.stdout}`,
    );
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-zip") {
      options.skipZip = true;
    } else if (arg === "--include-models") {
      options.includeModels = argv[++index];
    } else if (arg === "--include-ollama-installer") {
      options.includeOllamaInstaller = argv[++index];
    } else if (arg === "--include-python-installer") {
      options.includePythonInstaller = argv[++index];
    } else if (arg === "--out-dir") {
      options.outRoot = argv[++index];
    } else if (arg === "--stamp") {
      options.stamp = argv[++index];
    } else if (arg === "--allow-missing-gongmu") {
      options.allowMissingGongmu = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export async function prepareOllamaAiPack(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const outRoot = resolve(options.outRoot ?? join(repoRoot, "release", "ai-pack"));
  const stamp = options.stamp ?? nowStamp();
  const packageDir = join(outRoot, `${PACKAGE_PREFIX}_${stamp}`);
  const zipPath = `${packageDir}.zip`;
  await rm(packageDir, { recursive: true, force: true });
  await ensureDir(packageDir);

  const modelStore = options.includeModels
    ? resolve(options.includeModels)
    : await findDefaultModelStore();
  const hasModelStore = Boolean(modelStore && (await pathExists(modelStore)));

  const ollamaInstaller = options.includeOllamaInstaller ? resolve(options.includeOllamaInstaller) : null;
  const hasOllamaInstaller = Boolean(ollamaInstaller && (await pathExists(ollamaInstaller)));

  const pythonInstaller = options.includePythonInstaller ? resolve(options.includePythonInstaller) : null;
  const hasPythonInstaller = Boolean(pythonInstaller && (await pathExists(pythonInstaller)));

  const latestOffline = await findLatestOfflineRelease(repoRoot);
  const hasGongmuInstaller = Boolean(latestOffline?.installer);
  if (!hasGongmuInstaller && !options.allowMissingGongmu) {
    throw new Error("No Gongmu offline installer found. Run npm run release:offline first or pass --allow-missing-gongmu.");
  }

  if (hasGongmuInstaller) {
    await copyRecursive(latestOffline.dir, join(packageDir, "gongmu"));
  } else {
    await writeTextFile(join(packageDir, "gongmu", "README.md"), "Gongmu installer is not bundled in this test package.\n");
  }

  if (hasPythonInstaller) {
    await copyRecursive(pythonInstaller, join(packageDir, "python", pythonInstaller.split(/[\\/]/).pop()));
  } else {
    await writeTextFile(
      join(packageDir, "python", "README.md"),
      "Optional: place python-3.11.x-amd64.exe here if the target PC needs Python diagnostics or repair support.\n",
    );
  }

  if (hasOllamaInstaller) {
    await copyRecursive(ollamaInstaller, join(packageDir, "ollama", "OllamaSetup.exe"));
  } else {
    await writeTextFile(
      join(packageDir, "ollama", "README.md"),
      "Place OllamaSetup.exe here when the target PC does not already have Ollama installed.\n",
    );
  }

  if (hasModelStore) {
    await copyRecursive(modelStore, join(packageDir, "models"));
  } else {
    await writeTextFile(
      join(packageDir, "models", "README.md"),
      "Model cache is not bundled. Run npm run release:download:gemma4 on an online PC, then rebuild with --include-models.\n",
    );
  }

  await writeInstallScript(join(packageDir, "install-gongmu-ai.ps1"));
  await writeGuiInstallScript(join(packageDir, "install-gongmu-ai-gui.ps1"));
  await writeValidateScript(join(packageDir, "validate-gongmu-ai.ps1"));
  await writeEvidenceScript(join(packageDir, "collect-clean-account-evidence.ps1"));
  await writeBatchLaunchers(packageDir);
  await writePackageReadme(join(packageDir, "README.md"), {
    hasModelStore,
    hasOllamaInstaller,
    hasPythonInstaller,
    hasGongmuInstaller,
  });
  await writeKoreanInstallGuideV2(join(packageDir, "INSTALL_GUIDE_KO.md"), {
    hasModelStore,
    hasOllamaInstaller,
    hasPythonInstaller,
    hasGongmuInstaller,
  });
  await writeThirdPartyNotices(join(packageDir, "THIRD_PARTY_NOTICES.md"));
  await writeLicenseFiles(packageDir);

  const manifest = {
    package: {
      name: "gongmu-ollama-gemma4-e2b-it-ai-pack",
      createdAt: new Date().toISOString(),
      packageDir,
      zipPath: options.skipZip ? null : zipPath,
    },
    app: {
      name: "Local AI Agent Workplace : Gongmuwon",
      installerIncluded: hasGongmuInstaller,
      installerSource: latestOffline?.dir ?? null,
    },
    python: {
      version: "3.11",
      requiredForBundledApp: false,
      installerIncluded: hasPythonInstaller,
      installerSource: pythonInstaller,
    },
    ollama: {
      installerIncluded: hasOllamaInstaller,
      installerSource: ollamaInstaller,
      host: "127.0.0.1:11434",
    },
    model: {
      name: MODEL_NAME,
      displayName: MODEL_DISPLAY_NAME,
      source: "ollama-library",
      multimodal: true,
      embedded: hasModelStore,
      modelStoreSource: modelStore,
    },
  };
  await writeTextFile(join(packageDir, "manifest.json"), `${stringifyJsonAscii(manifest)}\n`);
  await writeShaSums(packageDir);

  if (!options.skipZip) {
    await compressPackage(packageDir, zipPath);
  }

  return { packageDir, zipPath: options.skipZip ? null : zipPath, manifest };
}

const currentFile = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] ?? "") === currentFile) {
  prepareOllamaAiPack(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(`AI pack created: ${result.packageDir}`);
      if (result.zipPath) console.log(`AI pack zip: ${result.zipPath}`);
      console.log(`Model embedded: ${result.manifest.model.embedded ? "yes" : "no"}`);
      console.log(`Python installer embedded: ${result.manifest.python.installerIncluded ? "yes" : "no"}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
