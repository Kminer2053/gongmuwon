import assert from "node:assert/strict";

import {
  ANYTHING_RELEASES_URL,
  detectAnythingExecutable,
  resolveAnythingCandidatePaths,
} from "./windows-anything-validation-helper.mjs";

const fakeEnv = {
  GONGMU_ANYTHING_EXE: "C:\\custom\\Anything.exe",
  LOCALAPPDATA: "C:\\Users\\USER\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
};

assert.deepEqual(resolveAnythingCandidatePaths(fakeEnv), [
  "C:\\custom\\Anything.exe",
  "C:\\Users\\USER\\AppData\\Local\\Anything\\docufinder.exe",
  "C:\\Users\\USER\\AppData\\Local\\Programs\\Anything\\Anything.exe",
  "C:\\Users\\USER\\AppData\\Local\\Programs\\Docufinder\\Anything.exe",
  "C:\\Program Files\\Anything\\Anything.exe",
  "C:\\Program Files\\Docufinder\\Anything.exe",
  "C:\\Program Files\\Anything\\docufinder.exe",
  "C:\\Program Files\\Docufinder\\docufinder.exe",
  "C:\\Program Files (x86)\\Anything\\Anything.exe",
  "C:\\Program Files (x86)\\Docufinder\\Anything.exe",
  "C:\\Program Files (x86)\\Anything\\docufinder.exe",
  "C:\\Program Files (x86)\\Docufinder\\docufinder.exe",
]);

const detected = detectAnythingExecutable({
  env: fakeEnv,
  exists: (candidate) => candidate === "C:\\Users\\USER\\AppData\\Local\\Anything\\docufinder.exe",
});

assert.equal(detected.releaseUrl, ANYTHING_RELEASES_URL);
assert.equal(detected.envOverride, "C:\\custom\\Anything.exe");
assert.equal(detected.detectedPath, "C:\\Users\\USER\\AppData\\Local\\Anything\\docufinder.exe");
assert.equal(detected.mode, "external_app_detected");
assert.ok(
  detected.manualChecks.includes(
    "Approve an Anything launch request and confirm the external Anything app opens.",
  ),
);

const missing = detectAnythingExecutable({
  env: { LOCALAPPDATA: "C:\\Users\\USER\\AppData\\Local" },
  exists: () => false,
});

assert.equal(missing.detectedPath, null);
assert.equal(missing.mode, "install_page_fallback");
assert.equal(missing.releaseUrl, ANYTHING_RELEASES_URL);
assert.ok(
  missing.manualChecks.includes(
    "Open the release URL and install Anything outside the Gongmu installer.",
  ),
);

console.log("windows anything validation helper checks passed");
