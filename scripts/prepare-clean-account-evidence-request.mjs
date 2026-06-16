import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ARTIFACT_REPORT = "docs/operations/generated/ai-pack-artifact-validation.json";
const DEFAULT_OUT_DIR = "release/clean-account-evidence-request";
const DEFAULT_COPY_BACK_TARGET = "release/clean-account-evidence-inbox";
const DEFAULT_VALIDATION_COMMAND = "npm.cmd run release:ai-pack:evidence:finalize";

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeSlash(path) {
  return path.replace(/\\/g, "/");
}

function artifactFromReport(report) {
  if (report.ready !== true) {
    throw new Error("AI pack artifact validation is not ready. Run npm.cmd run release:ai-pack:validate first.");
  }
  if (!report.zip?.present || !hasText(report.zip?.path) || !hasText(report.zip?.sha256)) {
    throw new Error("AI pack artifact validation is missing zip path or SHA256.");
  }
  if (report.manifest?.model?.embedded !== true) {
    throw new Error("AI pack artifact does not include an embedded model store.");
  }
  if (report.manifest?.model?.multimodal !== true) {
    throw new Error("AI pack artifact does not mark the model as multimodal.");
  }

  return {
    packageDir: report.packageDir,
    zipPath: report.zip.path,
    zipSizeBytes: report.zip.sizeBytes,
    zipSha256: report.zip.sha256,
    modelName: report.manifest.model.name,
    modelDisplayName: report.manifest.model.displayName ?? report.manifest.model.name,
    multimodal: report.manifest.model.multimodal,
    modelEmbedded: report.manifest.model.embedded,
    pythonInstallerIncluded: report.manifest.python?.installerIncluded === true,
    ollamaInstallerIncluded: report.manifest.ollama?.installerIncluded === true,
  };
}

function buildReadme(request) {
  return `# 클린계정/폐쇄망 검증 요청서

이 폴더는 최종 완료 게이트 G11을 닫기 위해 대상 PC에서 실행할 절차만 모아둔 요청서입니다. 현재 개발 PC의 dry-run 증거를 실제 클린계정/VM 증거로 대체하지 않습니다.

## 검증 대상 산출물

- AI Pack zip: \`${request.artifact.zipPath}\`
- Zip SHA256: \`${request.artifact.zipSha256}\`
- Zip size: ${request.artifact.zipSizeBytes} bytes
- 모델: ${request.artifact.modelDisplayName} (${request.artifact.modelName})
- 멀티모달 모델 표시: ${request.artifact.multimodal}
- 모델 저장소 내장: ${request.artifact.modelEmbedded}
- Python 설치파일 포함: ${request.artifact.pythonInstallerIncluded}
- Ollama 설치파일 포함: ${request.artifact.ollamaInstallerIncluded}

## 대상 PC에서 실행할 순서

1. AI Pack zip을 대상 PC로 복사합니다.
2. 아래 명령으로 SHA256이 같은지 확인합니다.

\`\`\`powershell
Get-FileHash .\\${request.artifact.zipName} -Algorithm SHA256
\`\`\`

기대값:

\`\`\`text
${request.artifact.zipSha256}
\`\`\`

3. zip을 로컬 폴더에 압축 해제합니다.
4. 권장 경로: 압축 해제 폴더에서 \`RUN_FULL_VALIDATION.bat\`을 실행합니다.
5. 이 런처가 설치, 검증, 증거 수집을 순서대로 실행합니다.
6. 단계별 확인이 필요하면 \`START_INSTALL.bat\`, \`VALIDATE_INSTALL.bat\`, \`COLLECT_EVIDENCE.bat\`을 순서대로 실행합니다.
7. 생성된 \`evidence\` 폴더를 개발 저장소의 반입 경로로 복사합니다.

## 개발 저장소 반입 경로

\`\`\`text
${request.copyBack.targetPath}
\`\`\`

반입 후 개발 저장소에서 실행:

\`\`\`powershell
${request.copyBack.validationCommand}
\`\`\`

## 반드시 같이 보관할 파일

- \`install-gongmu-ai.log\`
- \`validate-gongmu-ai.log\`
- \`evidence\\collect-clean-account-evidence.log\`
- \`evidence\\ai-pack-clean-account-evidence.json\`
- \`evidence\\ai-pack-clean-account-evidence.md\`

## 합격 기준

- evidence JSON의 \`ready\`가 \`true\`
- \`${request.artifact.modelName}\` 모델이 감지됨
- 텍스트 채팅 응답 성공
- 이미지 채팅 응답 성공
- Gongmu 설정이 Ollama 로컬 모델을 가리킴
- 설치 로그와 검증 로그가 존재함
`;
}

function buildCopyTargets(request) {
  return [
    "Copy this evidence folder from target PC:",
    "  evidence folder",
    "",
    "Into this repository inbox path:",
    `  ${request.copyBack.targetPath}`,
    "",
    "Then run:",
    `  ${request.copyBack.validationCommand}`,
    "",
  ].join("\n");
}

export async function prepareCleanAccountEvidenceRequest(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
  const artifactReportPath = resolve(repoRoot, options.artifactReportPath ?? DEFAULT_ARTIFACT_REPORT);
  const outDir = resolve(repoRoot, options.outDir ?? DEFAULT_OUT_DIR);
  const copyBackTarget = normalizeSlash(options.copyBackTarget ?? DEFAULT_COPY_BACK_TARGET);
  const validationCommand = options.validationCommand ?? DEFAULT_VALIDATION_COMMAND;

  const report = JSON.parse(await readFile(artifactReportPath, "utf8"));
  const artifact = artifactFromReport(report);
  artifact.zipName = artifact.zipPath.split(/[\\/]/).pop();

  const request = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    ready: true,
    artifactReportPath,
    outDir,
    artifact,
    copyBack: {
      sourcePathOnTargetPc: "evidence",
      targetPath: copyBackTarget,
      validationCommand,
    },
    targetPcSteps: [
      "copy AI Pack zip",
      "verify SHA256",
      "extract zip",
      "run RUN_FULL_VALIDATION.bat",
      "or run START_INSTALL.bat, VALIDATE_INSTALL.bat, COLLECT_EVIDENCE.bat step by step",
      "copy evidence folder back to repository inbox",
      "run release:ai-pack:evidence:finalize",
    ],
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "REQUEST.json"), `${JSON.stringify(request, null, 2)}\n`, "utf8");
  await writeFile(join(outDir, "README.md"), buildReadme(request), "utf8");
  await writeFile(join(outDir, "EXPECTED_SHA256.txt"), `${artifact.zipSha256}  ${artifact.zipName}\n`, "utf8");
  await writeFile(join(outDir, "COPY_TARGETS.txt"), buildCopyTargets(request), "utf8");

  return request;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifact-report") options.artifactReportPath = argv[++index];
    else if (arg === "--out-dir") options.outDir = argv[++index];
    else if (arg === "--copy-back-target") options.copyBackTarget = argv[++index];
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node scripts/prepare-clean-account-evidence-request.mjs [options]

Options:
  --artifact-report <path>  AI pack artifact validation JSON.
  --out-dir <path>          Request folder to create. Defaults to release/clean-account-evidence-request.
  --copy-back-target <path> Repository path for imported evidence JSON.
`);
    return;
  }
  const request = await prepareCleanAccountEvidenceRequest(options);
  console.log(JSON.stringify({ ready: request.ready, outDir: request.outDir }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
