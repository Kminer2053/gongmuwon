#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

export const ANYTHING_RELEASES_URL = "https://github.com/chrisryugj/Docufinder/releases";

export function resolveAnythingCandidatePaths(env = process.env) {
  const candidates = [];

  if (env.GONGMU_ANYTHING_EXE) {
    candidates.push(env.GONGMU_ANYTHING_EXE);
  }

  if (env.LOCALAPPDATA) {
    candidates.push(path.join(env.LOCALAPPDATA, "Anything", "docufinder.exe"));
    candidates.push(path.join(env.LOCALAPPDATA, "Programs", "Anything", "Anything.exe"));
    candidates.push(path.join(env.LOCALAPPDATA, "Programs", "Docufinder", "Anything.exe"));
  }

  if (env.ProgramFiles) {
    candidates.push(path.join(env.ProgramFiles, "Anything", "Anything.exe"));
    candidates.push(path.join(env.ProgramFiles, "Docufinder", "Anything.exe"));
    candidates.push(path.join(env.ProgramFiles, "Anything", "docufinder.exe"));
    candidates.push(path.join(env.ProgramFiles, "Docufinder", "docufinder.exe"));
  }

  if (env["ProgramFiles(x86)"]) {
    candidates.push(path.join(env["ProgramFiles(x86)"], "Anything", "Anything.exe"));
    candidates.push(path.join(env["ProgramFiles(x86)"], "Docufinder", "Anything.exe"));
    candidates.push(path.join(env["ProgramFiles(x86)"], "Anything", "docufinder.exe"));
    candidates.push(path.join(env["ProgramFiles(x86)"], "Docufinder", "docufinder.exe"));
  }

  return [...new Set(candidates)];
}

export function detectAnythingExecutable({
  env = process.env,
  exists = (candidate) => fs.existsSync(candidate),
} = {}) {
  const candidates = resolveAnythingCandidatePaths(env);
  const detectedPath = candidates.find((candidate) => exists(candidate)) ?? null;

  return {
    releaseUrl: ANYTHING_RELEASES_URL,
    envOverride: env.GONGMU_ANYTHING_EXE ?? null,
    candidates,
    detectedPath,
    mode: detectedPath ? "external_app_detected" : "install_page_fallback",
    manualChecks: detectedPath
      ? [
          "Approve an Anything launch request and confirm the external Anything app opens.",
          "Confirm the app path shown below matches the actual installed Anything executable.",
          "Import selected paths into a Reference Set and continue into Documents.",
        ]
      : [
          "Open the release URL and install Anything outside the Gongmu installer.",
          "Re-run this helper after installation and confirm a detected executable path appears.",
          "Then approve an Anything launch request and confirm the app opens from Gongmu.",
        ],
  };
}

export function printAnythingValidationStatus(status) {
  console.log("# Windows Anything Validation Helper");
  console.log("");
  console.log(`mode: ${status.mode}`);
  console.log(`release_url: ${status.releaseUrl}`);
  console.log(`env_override: ${status.envOverride ?? "-"}`);
  console.log(`detected_path: ${status.detectedPath ?? "-"}`);
  console.log("");
  console.log("candidate_paths:");
  for (const candidate of status.candidates) {
    console.log(`- ${candidate}`);
  }
  console.log("");
  console.log("manual_checks:");
  for (const item of status.manualChecks) {
    console.log(`- ${item}`);
  }
}

function main() {
  printAnythingValidationStatus(detectAnythingExecutable());
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
