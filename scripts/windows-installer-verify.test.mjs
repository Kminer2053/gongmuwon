import assert from "node:assert/strict";

import { buildRunCommand, getVerifySteps } from "./windows-installer-verify.mjs";

assert.deepEqual(getVerifySteps(), [
  "desktop:bundle",
  "desktop:smoke:msi",
  "desktop:smoke:nsis",
]);

assert.deepEqual(getVerifySteps({ skipBundle: true }), [
  "desktop:smoke:msi",
  "desktop:smoke:nsis",
]);

assert.deepEqual(buildRunCommand("desktop:smoke:msi", "win32"), {
  command: process.env.ComSpec || "cmd.exe",
  args: ["/d", "/s", "/c", "npm.cmd run desktop:smoke:msi"],
});

assert.deepEqual(buildRunCommand("desktop:smoke:nsis", "linux"), {
  command: "npm",
  args: ["run", "desktop:smoke:nsis"],
});

console.log("windows installer verify checks passed");
