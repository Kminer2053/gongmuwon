import assert from "node:assert/strict";

import { buildNsisOutputPath, buildSmokePaths, listFiles } from "./windows-nsis-smoke.mjs";

assert.equal(
  buildNsisOutputPath({
    root: "C:\\repo",
    profile: "release",
    productName: "Gongmu",
    version: "0.1.0",
  }),
  "C:\\repo\\apps\\desktop\\src-tauri\\target\\release\\bundle\\nsis\\Gongmu_0.1.0_x64-setup.exe",
);

const paths = buildSmokePaths({ root: "C:\\repo", stamp: "20260421-133500" });
assert.equal(
  paths.installDir,
  "C:\\repo\\runtime-workspace\\cache\\nsis-smoke-install-20260421-133500",
);
assert.equal(
  paths.workspaceRoot,
  "C:\\repo\\runtime-workspace\\cache\\nsis-smoke-workspace-20260421-133500",
);

assert.deepEqual(listFiles("C:\\path-that-does-not-exist"), []);

console.log("windows nsis smoke checks passed");
