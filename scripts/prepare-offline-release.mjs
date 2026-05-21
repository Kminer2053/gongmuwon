#!/usr/bin/env node
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.cwd();
const desktopPackage = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "apps", "desktop", "package.json"), "utf8"),
);
const version = desktopPackage.version ?? "0.0.0";
const nsisRoot = path.join(
  repoRoot,
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
);
const offlineRoot = path.join(repoRoot, "release", "offline");

function pad(value) {
  return String(value).padStart(2, "0");
}

function buildStamp(now = new Date()) {
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
  ].join("");
}

function formatKoreanDate(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function findLatestNsisInstaller() {
  if (!fs.existsSync(nsisRoot)) {
    throw new Error(`NSIS bundle directory does not exist: ${path.relative(repoRoot, nsisRoot)}`);
  }

  const installers = fs
    .readdirSync(nsisRoot)
    .filter((fileName) => fileName.toLowerCase().endsWith(".exe"))
    .map((fileName) => {
      const fullPath = path.join(nsisRoot, fileName);
      return {
        fileName,
        fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (installers.length === 0) {
    throw new Error(`No NSIS installer found in ${path.relative(repoRoot, nsisRoot)}`);
  }

  return installers[0];
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase();
}

function escapePowerShellLiteral(value) {
  return value.replace(/'/g, "''");
}

function compressArchive(packageDir, zipPath) {
  const command = [
    "$ErrorActionPreference = 'Stop';",
    `Compress-Archive -LiteralPath '${escapePowerShellLiteral(packageDir)}' -DestinationPath '${escapePowerShellLiteral(zipPath)}' -Force`,
  ].join(" ");

  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    stdio: "inherit",
  });
}

function buildReadme({ createdAt, installerName, installerSizeMb, installerSha, smokeCommand }) {
  return `# Gongmu Windows x64 폐쇄망 설치패키지

- 생성일: ${createdAt}
- 제품: Gongmu ${version}
- 설치파일: \`${installerName}\`
- 설치파일 크기: ${installerSizeMb} MB
- SHA256: \`${installerSha}\`

## 포함 범위

- Gongmu Tauri Desktop 앱
- Windows x64 Python/FastAPI 업무엔진 번들
- 로컬 SQLite 작업공간
- GraphRAG/ChromaDB 관련 Python 런타임 의존성
- 문서 파서 및 HWPX 작성 관련 런타임 의존성
- Microsoft Edge WebView2 오프라인 설치 모드 설정

## 폐쇄망 설치 방법

1. 이 폴더 전체 또는 zip 파일을 폐쇄망 PC로 복사합니다.
2. \`${installerName}\`을 실행합니다.
3. 설치 후 Gongmu를 실행합니다.
4. 우측 상단 업무엔진 신호등이 정상 상태인지 확인합니다.
5. 업무대화, 일정, 파일찾기, 지식폴더, 문서작성 기능을 순서대로 점검합니다.

## 검증 명령

빌드 PC에서 아래 명령으로 NSIS 설치 smoke를 재확인할 수 있습니다.

\`\`\`powershell
${smokeCommand}
\`\`\`

## 운영 참고

- 폐쇄망 PC의 로컬 LLM은 설치패키지에 포함되지 않습니다. 대상 PC에서 Ollama 또는 내부 OpenAI-compatible endpoint를 별도로 준비해야 합니다.
- 지식폴더 GraphRAG 품질은 문서 포맷, 파서 성공률, 로컬 embedding 모델 상태의 영향을 받습니다.
- 배포 전 설치파일 SHA256 값을 \`SHA256SUMS.txt\`와 대조하세요.
`;
}

export function prepareOfflineRelease({ now = new Date(), skipZip = false } = {}) {
  const installer = findLatestNsisInstaller();
  const stamp = process.env.GONGMU_RELEASE_STAMP || buildStamp(now);
  const packageName = `Gongmu_${version}_windows_x64_offline_${stamp}`;
  const packageDir = path.join(offlineRoot, packageName);
  const zipPath = path.join(offlineRoot, `${packageName}.zip`);

  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });

  const installerDestination = path.join(packageDir, installer.fileName);
  fs.copyFileSync(installer.fullPath, installerDestination);

  const installerSha = sha256File(installerDestination);
  const installerSizeMb = (fs.statSync(installerDestination).size / 1024 / 1024).toFixed(2);
  const shaLines = [`${installerSha}  ${installer.fileName}`, ""].join("\n");
  fs.writeFileSync(path.join(packageDir, "SHA256SUMS.txt"), shaLines, "utf8");
  fs.writeFileSync(
    path.join(packageDir, "README.md"),
    buildReadme({
      createdAt: formatKoreanDate(now),
      installerName: installer.fileName,
      installerSizeMb,
      installerSha,
      smokeCommand: "npm.cmd run desktop:smoke:nsis",
    }),
    "utf8",
  );

  if (!skipZip) {
    fs.rmSync(zipPath, { force: true });
    compressArchive(packageDir, zipPath);
  }

  const result = {
    package_dir: path.relative(repoRoot, packageDir),
    zip_path: skipZip ? null : path.relative(repoRoot, zipPath),
    installer: path.relative(repoRoot, installerDestination),
    installer_sha256: installerSha,
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  prepareOfflineRelease({ skipZip: process.argv.includes("--skip-zip") });
}
