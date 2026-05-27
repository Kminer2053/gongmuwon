import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
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

const MODEL_NAME = "gemma4:e2b";
const MODEL_DISPLAY_NAME = "GEMMA4 E2B IT 멀티모달";
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

async function writePackageReadme(path, { hasModelStore, hasOllamaInstaller, hasGongmuInstaller }) {
  const modelStatus = hasModelStore
    ? "이 패키지에는 `gemma4:e2b` Ollama 모델 캐시가 포함되어 있어 폐쇄망 PC에서 바로 가져올 수 있습니다."
    : "`models` 폴더에는 모델 캐시가 아직 없습니다. 인터넷이 되는 제작 PC에서 `ollama pull gemma4:e2b` 후 `npm run release:ai-pack -- --include-models \"%USERPROFILE%\\.ollama\\models\"`로 다시 생성하세요.";
  const ollamaStatus = hasOllamaInstaller
    ? "이 패키지에는 Windows용 Ollama 설치파일이 포함되어 있습니다."
    : "Ollama 설치파일은 포함되어 있지 않습니다. `ollama/OllamaSetup.exe`를 추가하거나 설치 대상 PC에 Ollama를 먼저 설치하세요.";
  const gongmuStatus = hasGongmuInstaller
    ? "이 패키지에는 최신 공무원 Windows 설치파일이 함께 포함되어 있습니다."
    : "공무원 앱 설치파일은 발견되지 않아 포함하지 못했습니다.";

  await writeTextFile(
    path,
    `# 로컬 AI에이전트 워크플레이스 : 공무원 AI 원클릭 셋업 팩

이 팩은 폐쇄망 또는 내부망 PC에서 공무원 앱을 Ollama 기반 로컬 모델과 연결하기 위한 보조 설치 패키지입니다.

## 포함 모델

- 모델: \`${MODEL_NAME}\`
- 표시명: ${MODEL_DISPLAY_NAME}
- 용도: 업무대화 텍스트 응답 + 이미지 첨부 입력을 받는 멀티모달 테스트
- 공급 방식: Ollama 로컬 런타임

## 현재 패키지 상태

- 공무원 앱 설치파일: ${hasGongmuInstaller ? "포함" : "미포함"}
- Ollama 설치파일: ${hasOllamaInstaller ? "포함" : "미포함"}
- Gemma4 E2B IT 모델 캐시: ${hasModelStore ? "포함" : "미포함"}

${gongmuStatus}

${ollamaStatus}

${modelStatus}

## 설치 방법

가장 쉬운 방법은 압축을 푼 뒤 아래 파일을 더블클릭하는 것입니다.

\`\`\`text
START_INSTALL.bat
\`\`\`

아래 파일들도 같은 작업을 수행합니다.

\`\`\`text
설치_시작.bat
install-gongmu-ai.bat
\`\`\`

직접 PowerShell에서 실행하려면 관리자 권한 또는 일반 권한 PowerShell을 열고 아래 명령을 실행합니다.

\`\`\`powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\\install-gongmu-ai.ps1
\`\`\`

모델 캐시가 없는 제작용 패키지에서 인터넷 연결을 허용해 내려받고 싶으면 아래처럼 실행합니다.

\`\`\`powershell
.\\install-gongmu-ai.ps1 -AllowDownload
\`\`\`

## 설치 스크립트가 하는 일

1. 공무원 설치파일이 있으면 실행합니다.
2. Ollama가 없고 설치파일이 있으면 설치를 안내합니다.
3. Ollama 서버를 \`127.0.0.1:11434\`에서 실행합니다.
4. 포함된 \`models\` 캐시가 있으면 \`%USERPROFILE%\\.ollama\\models\`로 복사합니다.
5. \`${MODEL_NAME}\` 모델이 준비되었는지 확인합니다.
6. 공무원 설정을 Ollama + \`${MODEL_NAME}\` 기준으로 저장합니다.
7. 텍스트 응답과 이미지 입력 API가 동작하는지 짧게 점검합니다.

## 폐쇄망 반입 전 체크

- \`models/manifests/registry.ollama.ai/library/gemma4/e2b\` 파일이 있어야 모델 포함 패키지입니다.
- \`models/blobs\` 폴더에 실제 모델 레이어가 있어야 합니다.
- \`ollama/OllamaSetup.exe\`가 있으면 대상 PC에서 Ollama 설치까지 진행할 수 있습니다.
- \`SHA256SUMS.txt\`로 파일 무결성을 확인하세요.
`,
  );
}

async function writeThirdPartyNotices(path) {
  await writeTextFile(
    path,
    `# Third Party Notices

## Ollama

- Component: Ollama Windows runtime
- License: MIT
- Project: https://github.com/ollama/ollama
- Note: This AI pack may include the Windows installer when supplied at build time.

## Gemma 4 E2B IT

- Component: \`${MODEL_NAME}\` via Ollama model library
- License: Apache-2.0
- Model page: https://huggingface.co/google/gemma-4-e2b-it
- Note: Include model weights only when your organization has reviewed and accepted the model terms and distribution policy.
`,
  );
}

async function writeLicenseFiles(packageDir) {
  await writeTextFile(
    join(packageDir, "licenses", "ollama", "LICENSE"),
    `Ollama is distributed under the MIT License.

Refer to the official project license for the authoritative text:
https://github.com/ollama/ollama/blob/main/LICENSE
`,
  );
  await writeTextFile(
    join(packageDir, "licenses", "gemma4-e2b-it", "LICENSE"),
    `Gemma 4 E2B IT is listed with Apache-2.0 licensing metadata.

Refer to the model page for authoritative license and usage terms:
https://huggingface.co/google/gemma-4-e2b-it
`,
  );
}

function installScriptContent() {
  return `#requires -Version 5.1
param(
  [string]$ModelName = "${MODEL_NAME}",
  [string]$OllamaHost = "127.0.0.1:11434",
  [string]$OllamaModels = "$env:USERPROFILE\\.ollama\\models",
  [switch]$AllowDownload,
  [switch]$SkipGongmuInstall
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogPath = Join-Path $ScriptRoot "install-gongmu-ai.log"
Start-Transcript -Path $LogPath -Append | Out-Null

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-HttpOk([string]$Url) {
  try {
    Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Get-OllamaExe {
  $cmd = Get-Command ollama -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $local = Join-Path $env:LOCALAPPDATA "Programs\\Ollama\\ollama.exe"
  if (Test-Path $local) { return $local }
  $programFiles = Join-Path $env:ProgramFiles "Ollama\\ollama.exe"
  if (Test-Path $programFiles) { return $programFiles }
  return $null
}

function Start-OllamaServer([string]$OllamaExe) {
  $env:OLLAMA_HOST = $OllamaHost
  $env:OLLAMA_MODELS = $OllamaModels
  if (Test-HttpOk "http://$OllamaHost/api/tags") {
    Write-Host "Ollama 서버가 이미 실행 중입니다."
    return
  }
  Write-Step "Ollama 서버 시작"
  Start-Process -FilePath $OllamaExe -ArgumentList "serve" -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-HttpOk "http://$OllamaHost/api/tags") {
      Write-Host "Ollama 서버 연결 확인 완료"
      return
    }
  }
  throw "Ollama 서버가 30초 안에 응답하지 않았습니다."
}

function Install-OllamaIfNeeded {
  $ollama = Get-OllamaExe
  if ($ollama) { return $ollama }
  $installer = Join-Path $ScriptRoot "ollama\\OllamaSetup.exe"
  if (!(Test-Path $installer)) {
    throw "Ollama가 설치되어 있지 않고 ollama\\OllamaSetup.exe도 없습니다."
  }
  Write-Step "Ollama 설치파일 실행"
  Write-Host "설치 마법사가 열리면 설치를 완료하세요. 완료 후 이 창으로 돌아오면 자동으로 계속 확인합니다."
  Start-Process -FilePath $installer -Wait
  for ($i = 0; $i -lt 20; $i++) {
    $ollama = Get-OllamaExe
    if ($ollama) { return $ollama }
    Start-Sleep -Seconds 2
  }
  throw "Ollama 설치 후 ollama.exe를 찾지 못했습니다."
}

function Import-PackagedModelStore {
  $source = Join-Path $ScriptRoot "models"
  $manifest = Join-Path $source "manifests\\registry.ollama.ai\\library\\gemma4\\e2b"
  if (!(Test-Path $manifest)) {
    Write-Host "포함된 Gemma4 E2B IT 모델 캐시가 없습니다."
    return $false
  }
  Write-Step "포함 모델 캐시 복사"
  New-Item -ItemType Directory -Force -Path $OllamaModels | Out-Null
  Copy-Item -Path (Join-Path $source "*") -Destination $OllamaModels -Recurse -Force
  return $true
}

function Get-OllamaModels {
  try {
    $tags = Invoke-RestMethod -Uri "http://$OllamaHost/api/tags" -Method Get -TimeoutSec 5
    return @($tags.models | ForEach-Object { $_.name })
  } catch {
    return @()
  }
}

function Ensure-Model([string]$OllamaExe) {
  $models = Get-OllamaModels
  if ($models -contains $ModelName) {
    Write-Host "$ModelName 모델 확인 완료"
    return
  }
  $imported = Import-PackagedModelStore
  if ($imported) {
    $models = Get-OllamaModels
    if ($models -contains $ModelName) {
      Write-Host "$ModelName 모델 캐시 등록 확인 완료"
      return
    }
  }
  if ($AllowDownload) {
    Write-Step "$ModelName 모델 다운로드"
    & $OllamaExe pull $ModelName
    return
  }
  throw "$ModelName 모델을 찾지 못했습니다. 폐쇄망 반입 전 모델 캐시를 포함하거나 -AllowDownload로 실행하세요."
}

function Invoke-OllamaChat($Body) {
  $json = $Body | ConvertTo-Json -Depth 20 -Compress
  return Invoke-RestMethod -Uri "http://$OllamaHost/api/chat" -Method Post -ContentType "application/json" -Body $json -TimeoutSec 120
}

function Test-GemmaMultimodal {
  Write-Step "Gemma4 E2B IT 텍스트 응답 점검"
  $textResult = Invoke-OllamaChat @{
    model = $ModelName
    stream = $false
    messages = @(
      @{ role = "system"; content = "한국어로 짧고 정확하게 답하세요." },
      @{ role = "user"; content = "공무원 앱 연결 테스트입니다. 한 문장으로 응답하세요." }
    )
  }
  if (!$textResult.message.content) { throw "텍스트 응답이 비어 있습니다." }
  Write-Host $textResult.message.content

  Write-Step "Gemma4 E2B IT 이미지 입력 API 점검"
  $onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJ9W5QAAAABJRU5ErkJggg=="
  $imageResult = Invoke-OllamaChat @{
    model = $ModelName
    stream = $false
    messages = @(
      @{ role = "user"; content = "첨부 이미지를 볼 수 있는지 한국어로 짧게 답하세요."; images = @($onePixelPng) }
    )
  }
  if (!$imageResult.message.content) { throw "이미지 입력 응답이 비어 있습니다." }
  Write-Host $imageResult.message.content
}

function Write-GongmuSettings {
  Write-Step "공무원 업무엔진 모델 설정 저장"
  $workspace = Join-Path $env:LOCALAPPDATA "kr.gongmu.workspace\\runtime-workspace"
  New-Item -ItemType Directory -Force -Path $workspace | Out-Null
  $settingsPath = Join-Path $workspace "settings.json"
  $settings = [ordered]@{
    llm_mode = "local_first"
    llm_provider = "ollama"
    llm_model = $ModelName
    internal_api_base_url = "http://$OllamaHost"
    embedding_provider = "deterministic"
    embedding_model = ""
    embedding_base_url = ""
    llm_profiles = @{
      ollama = @{
        provider = "ollama"
        mode = "local_first"
        model = $ModelName
        base_url = "http://$OllamaHost"
        api_key = ""
        enabled = $true
      }
    }
  }
  $settings | ConvertTo-Json -Depth 20 | Set-Content -Path $settingsPath -Encoding UTF8
  Write-Host "settings.json 저장: $settingsPath"
}

function Install-GongmuIfPresent {
  if ($SkipGongmuInstall) { return }
  $gongmuDir = Join-Path $ScriptRoot "gongmu"
  $installer = Get-ChildItem -Path $gongmuDir -Filter "*.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (!$installer) {
    Write-Host "공무원 설치파일이 없어 앱 설치 단계는 건너뜁니다."
    return
  }
  Write-Step "공무원 설치파일 실행"
  Start-Process -FilePath $installer.FullName -Wait
}

try {
  Write-Step "로컬 AI에이전트 워크플레이스 : 공무원 AI 셋업 시작"
  Install-GongmuIfPresent
  $ollamaExe = Install-OllamaIfNeeded
  Start-OllamaServer $ollamaExe
  Ensure-Model $ollamaExe
  Write-GongmuSettings
  Test-GemmaMultimodal
  Write-Step "완료"
  Write-Host "공무원 앱에서 모델 공급자를 Ollama / $ModelName 으로 선택해 테스트하세요."
} finally {
  Stop-Transcript | Out-Null
}
`;
}

async function writeInstallScript(path) {
  await writeTextFile(path, `\uFEFF${installScriptContent()}`);
}

function batchScriptContent() {
  return `@echo off
chcp 65001 > nul
title Gongmu AI Pack Installer
cd /d "%~dp0"
echo.
echo ============================================================
echo  Gongmu AI Pack Installer
echo  Ollama + GEMMA4 E2B IT Multimodal Setup
echo ============================================================
echo.
echo Do not close this window until setup finishes.
echo If setup fails, check install-gongmu-ai.log in this folder.
echo.
if "%GONGMU_AI_PACK_DRY_RUN%"=="1" (
  echo Dry run mode: launcher syntax is OK.
  exit /b 0
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-gongmu-ai.ps1"
set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" (
  echo Setup or validation failed. Error code: %EXIT_CODE%
  echo Check install-gongmu-ai.log, then run this file again.
) else (
  echo Setup and basic validation completed.
)
echo.
pause
exit /b %EXIT_CODE%
`;
}

async function writeBatchLaunchers(packageDir) {
  const content = batchScriptContent();
  await writeTextFile(join(packageDir, "START_INSTALL.bat"), content);
  await writeTextFile(join(packageDir, "install-gongmu-ai.bat"), content);
  await writeTextFile(join(packageDir, "설치_시작.bat"), content);
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
  const tarResult = spawnSync("tar.exe", ["-a", "-cf", zipPath, "-C", packageDir, "."], {
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

  const latestOffline = await findLatestOfflineRelease(repoRoot);
  const hasGongmuInstaller = Boolean(latestOffline?.installer);
  if (!hasGongmuInstaller && !options.allowMissingGongmu) {
    throw new Error("No Gongmu offline installer found. Run npm run release:offline first or pass --allow-missing-gongmu.");
  }

  if (hasGongmuInstaller) {
    await copyRecursive(latestOffline.dir, join(packageDir, "gongmu"));
  } else {
    await writeTextFile(join(packageDir, "gongmu", "README.md"), "공무원 설치파일이 포함되지 않았습니다.\n");
  }

  if (hasOllamaInstaller) {
    await copyRecursive(ollamaInstaller, join(packageDir, "ollama", "OllamaSetup.exe"));
  } else {
    await writeTextFile(
      join(packageDir, "ollama", "README.md"),
      "OllamaSetup.exe를 이 폴더에 넣으면 설치 스크립트가 Ollama 설치까지 안내합니다.\n",
    );
  }

  if (hasModelStore) {
    await copyRecursive(modelStore, join(packageDir, "models"));
  } else {
    await writeTextFile(
      join(packageDir, "models", "README.md"),
      "모델 캐시가 포함되지 않았습니다. gemma4:e2b를 pull한 뒤 ~/.ollama/models를 --include-models로 지정해 다시 생성하세요.\n",
    );
  }

  await writeInstallScript(join(packageDir, "install-gongmu-ai.ps1"));
  await writeBatchLaunchers(packageDir);
  await writePackageReadme(join(packageDir, "README.md"), { hasModelStore, hasOllamaInstaller, hasGongmuInstaller });
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
      name: "로컬 AI에이전트 워크플레이스 : 공무원",
      installerIncluded: hasGongmuInstaller,
      installerSource: latestOffline?.dir ?? null,
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
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
