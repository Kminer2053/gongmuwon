import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildMsiOutputPath,
  getWixArtifacts,
  resolveWixLightExe,
} from "./tauri-build-with-wix-fallback.mjs";

function withTempDir(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gongmu-wix-fallback-"));
  try {
    callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

withTempDir((tempRoot) => {
  const wixCache = path.join(tempRoot, "tauri");
  const older = path.join(wixCache, "WixTools313");
  const newer = path.join(wixCache, "WixTools314");

  fs.mkdirSync(older, { recursive: true });
  fs.mkdirSync(newer, { recursive: true });
  fs.writeFileSync(path.join(older, "light.exe"), "");
  fs.writeFileSync(path.join(newer, "light.exe"), "");

  assert.equal(resolveWixLightExe(tempRoot), path.join(newer, "light.exe"));
});

assert.equal(
  buildMsiOutputPath({
    root: "C:\\repo",
    profile: "release",
    productName: "Gongmu",
    version: "0.1.0",
  }),
  "C:\\repo\\apps\\desktop\\src-tauri\\target\\release\\bundle\\msi\\Gongmu_0.1.0_x64_en-US.msi",
);

assert.deepEqual(
  getWixArtifacts({ root: "C:\\repo", profile: "debug" }),
  {
    wixRoot: "C:\\repo\\apps\\desktop\\src-tauri\\target\\debug\\wix\\x64",
    localePath: "C:\\repo\\apps\\desktop\\src-tauri\\target\\debug\\wix\\x64\\locale.wxl",
    objectPath: "C:\\repo\\apps\\desktop\\src-tauri\\target\\debug\\wix\\x64\\main.wixobj",
    sourcePath: "C:\\repo\\apps\\desktop\\src-tauri\\target\\debug\\wix\\x64\\main.wxs",
  },
);

console.log("tauri build fallback checks passed");
