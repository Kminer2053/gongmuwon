import assert from "node:assert/strict";
import path from "node:path";

import {
  buildGuiValidationPlan,
  buildNsisBundlePath,
} from "./windows-gui-validation-helper.mjs";

const repoRoot = "C:\\repo";

assert.equal(
  buildNsisBundlePath({
    root: repoRoot,
    profile: "release",
    productName: "Gongmu",
    version: "0.1.0",
  }),
  "C:\\repo\\apps\\desktop\\src-tauri\\target\\release\\bundle\\nsis\\Gongmu_0.1.0_x64-setup.exe",
);

const plan = buildGuiValidationPlan({
  root: repoRoot,
  stamp: "20260423-001500",
  productName: "Gongmu",
  version: "0.1.0",
});

assert.equal(
  plan.installerPath,
  "C:\\repo\\apps\\desktop\\src-tauri\\target\\release\\bundle\\nsis\\Gongmu_0.1.0_x64-setup.exe",
);
assert.equal(
  plan.installDir,
  "C:\\repo\\runtime-workspace\\cache\\nsis-gui-install-20260423-001500",
);
assert.equal(
  plan.workspaceRoot,
  "C:\\repo\\runtime-workspace\\cache\\nsis-gui-workspace-20260423-001500",
);
assert.equal(
  plan.desktopExe,
  path.win32.join(plan.installDir, "gongmu-desktop.exe"),
);
assert.equal(
  plan.bundledSidecarExe,
  path.win32.join(
    plan.installDir,
    "resources",
    "sidecar",
    "windows-x64",
    "gongmu-sidecar",
    "gongmu-sidecar.exe",
  ),
);
assert.deepEqual(plan.manualChecks, [
  "Complete the NSIS wizard with the suggested install directory.",
  "Launch the installed desktop app and confirm the window becomes visible.",
  "Confirm the bundled sidecar tree exists under resources\\sidecar\\windows-x64\\gongmu-sidecar.",
  "Run the uninstaller and confirm the install directory is removed.",
]);

console.log("windows gui validation helper checks passed");
