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
    "# Local AI Agent Workplace : Gongmuwon AI Setup Pack",
    "",
    "This package prepares a closed-network or clean Windows account for Gongmu local AI use.",
    "",
    "## What START_INSTALL.bat does",
    "",
    "1. Installs Gongmu when a Windows NSIS installer is bundled in `gongmu/`.",
    "2. Detects Python 3.11. Gongmu's bundled desktop app can run without system Python, but Python 3.11 is useful for repair, diagnostics, and development-mode support.",
    "3. Installs Python 3.11 when a CPython installer is bundled in `python/`.",
    "4. Detects or installs Ollama from `ollama/OllamaSetup.exe`.",
    "5. Copies the packaged Ollama model store from `models/` into `%USERPROFILE%\\.ollama\\models`.",
    "6. Starts Ollama on `127.0.0.1:11434`.",
    `7. Verifies that ${MODEL_NAME} is available.`,
    "8. Writes Gongmu settings so the app uses Ollama local-first mode.",
    "9. Runs a text response check and an image-input API check.",
    "",
    "## Package status",
    "",
    `- Gongmu installer: ${hasGongmuInstaller ? "included" : "not included"}`,
    `- Python 3.11 installer: ${hasPythonInstaller ? "included" : "not included"}`,
    `- Ollama installer: ${hasOllamaInstaller ? "included" : "not included"}`,
    `- Ollama model cache for ${MODEL_NAME}: ${hasModelStore ? "included" : "not included"}`,
    "",
    "## Beginner path",
    "",
    "For the simplest clean-account validation, double-click:",
    "",
    "```text",
    "RUN_FULL_VALIDATION.bat",
    "```",
    "",
    "This runs setup, validation, and evidence collection in sequence. It writes `install-gongmu-ai.log`, `validate-gongmu-ai.log`, and `evidence/ai-pack-clean-account-evidence.json`.",
    "",
    "If you prefer step-by-step execution, run the files below in order.",
    "",
    "Double-click:",
    "",
    "```text",
    "START_INSTALL.bat",
    "```",
    "",
    "After setup, double-click:",
    "",
    "```text",
    "VALIDATE_INSTALL.bat",
    "```",
    "",
    "If setup fails, open `install-gongmu-ai.log`. If validation fails, open `validate-gongmu-ai.log`.",
    "",
    "For clean-account or closed-network release evidence, run after validation:",
    "",
    "```text",
    "COLLECT_EVIDENCE.bat",
    "```",
    "",
    "This writes `evidence/ai-pack-clean-account-evidence.json` and `evidence/ai-pack-clean-account-evidence.md`.",
    "",
    "## Closed-network checklist",
    "",
    "- `models/manifests/registry.ollama.ai/library/gemma4/e2b` must exist for a fully offline model install.",
    "- `models/blobs/` must contain the referenced model layers.",
    "- `ollama/OllamaSetup.exe` must exist when the target PC does not already have Ollama.",
    "- `python/python-3.11.x-amd64.exe` is optional for the bundled app, but useful for repair and diagnostics.",
    "- Use `SHA256SUMS.txt` to verify file integrity after copying the package.",
  ];
  await writeTextFile(path, `${lines.join("\n")}\n`);
}

async function writeThirdPartyNotices(path) {
  await writeTextFile(
    path,
    `# Third Party Notices

## Python

- Component: CPython 3.11 Windows installer, when supplied at build time.
- License: Python Software Foundation License.
- Project: https://www.python.org/
- Note: The packaged Gongmu desktop app uses a bundled sidecar executable and does not require system Python for normal operation.

## Ollama

- Component: Ollama Windows runtime, when supplied at build time.
- License: MIT.
- Project: https://github.com/ollama/ollama

## Gemma 4 E2B IT

- Component: \`${MODEL_NAME}\` via Ollama model library.
- License: Apache-2.0 metadata is expected for the requested model family, but your organization should review the authoritative model terms before redistributing weights.
- Note: Include model weights only when your organization has approved the model distribution policy.
`,
  );
}

async function writeLicenseFiles(packageDir) {
  await writeTextFile(
    join(packageDir, "licenses", "python", "NOTICE.txt"),
    "If a CPython installer is included, verify the authoritative Python license at https://www.python.org/downloads/.\n",
  );
  await writeTextFile(
    join(packageDir, "licenses", "ollama", "NOTICE.txt"),
    "If OllamaSetup.exe is included, verify the authoritative Ollama license at https://github.com/ollama/ollama.\n",
  );
  await writeTextFile(
    join(packageDir, "licenses", "gemma4-e2b-it", "NOTICE.txt"),
    "If model weights are included, verify the authoritative model license and usage terms before redistribution.\n",
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
  New-Item -ItemType Directory -Force -Path $OllamaModels | Out-Null
  Copy-Item -Path (Join-Path $source "*") -Destination $OllamaModels -Recurse -Force
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
  $onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJ9W5QAAAABJRU5ErkJggg=="
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
  Install-GongmuIfPresent
  Install-Python311IfAvailable
  $ollamaExe = Install-OllamaIfNeeded
  Import-PackagedModelStore | Out-Null
  Start-OllamaServer $ollamaExe
  Ensure-Model $ollamaExe
  Write-GongmuSettings
  Test-GemmaMultimodal
  Write-Step "Setup complete"
  Write-Host "Open Gongmu and check Settings -> model provider: Ollama / $ModelName."
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
      $onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJ9W5QAAAABJRU5ErkJggg=="
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

function installBatchScriptContent() {
  return `@echo off
chcp 65001 > nul
title Gongmu Local AI Setup
cd /d "%~dp0"
echo.
echo ============================================================
echo  Gongmu Local AI Setup
echo  Python 3.11 check + Ollama + GEMMA4 E2B IT Multimodal
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

function validateBatchScriptContent() {
  return `@echo off
chcp 65001 > nul
title Gongmu Local AI Validation
cd /d "%~dp0"
echo.
echo ============================================================
echo  Gongmu Local AI Validation
echo ============================================================
echo.
if "%GONGMU_AI_PACK_DRY_RUN%"=="1" (
  echo Dry run mode: launcher syntax is OK.
  exit /b 0
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0validate-gongmu-ai.ps1"
set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" (
  echo Validation failed. Error code: %EXIT_CODE%
  echo Check validate-gongmu-ai.log.
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
echo ============================================================
echo  Gongmu Clean Account Evidence Collection
echo ============================================================
echo.
if "%GONGMU_AI_PACK_DRY_RUN%"=="1" (
  echo Dry run mode: launcher syntax is OK.
  exit /b 0
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect-clean-account-evidence.ps1"
set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" (
  echo Evidence collection found failing checks. Error code: %EXIT_CODE%
  echo Check evidence\\ai-pack-clean-account-evidence.md.
) else (
  echo Evidence collection completed.
  echo Check evidence\\ai-pack-clean-account-evidence.md.
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
echo ============================================================
echo  Gongmu Local AI Full Validation
echo  Setup + validation + clean-account evidence
echo ============================================================
echo.
echo This one-click path runs:
echo  1. install-gongmu-ai.ps1
echo  2. validate-gongmu-ai.ps1
echo  3. collect-clean-account-evidence.ps1
echo.
echo Logs:
echo  - install-gongmu-ai.log
echo  - validate-gongmu-ai.log
echo  - evidence\\ai-pack-clean-account-evidence.md
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
  echo Full validation finished with failures. Error code: %EXIT_CODE%
  echo Check install-gongmu-ai.log, validate-gongmu-ai.log, and evidence\\ai-pack-clean-account-evidence.md.
) else (
  echo Full validation completed.
  echo Send evidence\\ai-pack-clean-account-evidence.json back to the development repository.
)
echo.
pause
exit /b %EXIT_CODE%
`;
}

async function writeBatchLaunchers(packageDir) {
  const installContent = installBatchScriptContent();
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
  await writeValidateScript(join(packageDir, "validate-gongmu-ai.ps1"));
  await writeEvidenceScript(join(packageDir, "collect-clean-account-evidence.ps1"));
  await writeBatchLaunchers(packageDir);
  await writePackageReadme(join(packageDir, "README.md"), {
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
