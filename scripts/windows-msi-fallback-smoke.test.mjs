import assert from "node:assert/strict";

import { buildSmokePaths, listFiles, parseInstallDirOutput } from "./windows-msi-fallback-smoke.mjs";

const paths = buildSmokePaths({ root: "C:\\repo", stamp: "20260421-131500" });

assert.equal(
  paths.installDir,
  "C:\\repo\\runtime-workspace\\cache\\msi-smoke-install-20260421-131500",
);
assert.equal(
  paths.workspaceRoot,
  "C:\\repo\\runtime-workspace\\cache\\msi-smoke-workspace-20260421-131500",
);
assert.equal(
  paths.installLogPath,
  "C:\\repo\\runtime-workspace\\cache\\msi-smoke-install-20260421-131500.log",
);

assert.equal(
  parseInstallDirOutput(`\r\nHKEY_CURRENT_USER\\Software\\gongmu\\Gongmu\r\n    InstallDir    REG_SZ    C:\\Users\\USER\\AppData\\Local\\Gongmu\\\r\n`),
  "C:\\Users\\USER\\AppData\\Local\\Gongmu\\",
);

assert.deepEqual(listFiles("C:\\path-that-does-not-exist"), []);

console.log("windows msi smoke checks passed");
