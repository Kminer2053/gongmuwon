import assert from "node:assert/strict";
import fs from "node:fs";

function readPackageScripts(packagePath = "package.json") {
  return JSON.parse(fs.readFileSync(packagePath, "utf8")).scripts ?? {};
}

function assertBundleScriptHasFreshSidecarGate(scriptName, script) {
  assert.ok(script, `${scriptName} script is missing`);
  const bundleIndex = script.indexOf("sidecar:bundle:windows");
  const syncIndex = script.indexOf("sync-sidecar-bundle.mjs");
  const smokeIndex = script.indexOf("sidecar:smoke:bundled");
  const tauriIndex = script.indexOf("tauri-build-with-wix-fallback.mjs");

  assert.notEqual(bundleIndex, -1, `${scriptName} must build the sidecar bundle first`);
  assert.notEqual(syncIndex, -1, `${scriptName} must sync the sidecar bundle into Tauri resources`);
  assert.notEqual(smokeIndex, -1, `${scriptName} must smoke-test the synced bundled sidecar`);
  assert.notEqual(tauriIndex, -1, `${scriptName} must build the Tauri installer after sidecar smoke`);
  assert.ok(bundleIndex < syncIndex, `${scriptName} must sync after sidecar bundle`);
  assert.ok(syncIndex < smokeIndex, `${scriptName} must smoke after syncing sidecar resources`);
  assert.ok(smokeIndex < tauriIndex, `${scriptName} must run installer build after sidecar smoke`);
}

function assertSidecarScriptStartsWithVenvCheck(scriptName, script) {
  assert.ok(script, `${scriptName} script is missing`);
  const venvIndex = script.indexOf("sidecar:venv:check");
  const portableIndex = script.indexOf("portable-run.mjs");
  assert.notEqual(venvIndex, -1, `${scriptName} must check the Python 3.11 venv before running sidecar Python`);
  assert.notEqual(portableIndex, -1, `${scriptName} must run Python through portable-run.mjs`);
  assert.ok(venvIndex < portableIndex, `${scriptName} must check the venv before portable-run starts Python`);
}

const scripts = readPackageScripts();
assertSidecarScriptStartsWithVenvCheck("sidecar:test", scripts["sidecar:test"]);
assertSidecarScriptStartsWithVenvCheck("sidecar:serve", scripts["sidecar:serve"]);
assertSidecarScriptStartsWithVenvCheck("sidecar:bundle:windows", scripts["sidecar:bundle:windows"]);
assert.match(
  scripts["sidecar:venv:report"] ?? "",
  /repair-python-venv\.mjs --check --out docs\/operations\/generated\/python-venv-report\.json --markdown docs\/operations\/generated\/python-venv-report\.md/,
  "sidecar:venv:report must write the Python venv recovery report",
);
assertBundleScriptHasFreshSidecarGate("desktop:bundle", scripts["desktop:bundle"]);
assertBundleScriptHasFreshSidecarGate("desktop:bundle:debug", scripts["desktop:bundle:debug"]);

assert.match(
  scripts["verify:completion:test"] ?? "",
  /package-scripts\.test\.mjs/,
  "verify:completion:test must include package script regression checks",
);

assert.match(
  scripts["verify:completion:test"] ?? "",
  /final-completion-blockers\.test\.mjs/,
  "verify:completion:test must include final completion blocker summary checks",
);

assert.match(
  scripts["verify:completion:test"] ?? "",
  /final-completion-preflight\.test\.mjs/,
  "verify:completion:test must include final completion preflight checks",
);

assert.match(
  scripts["verify:completion:test"] ?? "",
  /check-release-hygiene\.test\.mjs/,
  "verify:completion:test must include release hygiene checks",
);

assert.match(
  scripts["verify:completion:preflight"] ?? "",
  /final-completion-preflight\.mjs/,
  "verify:completion:preflight must generate the final completion preflight report",
);

assert.match(
  scripts["verify:completion:hygiene"] ?? "",
  /check-release-hygiene\.mjs/,
  "verify:completion:hygiene must generate the release hygiene report",
);

assert.match(
  scripts["verify:completion:audit"] ?? "",
  /final-completion-blockers\.mjs/,
  "verify:completion:audit must generate the blocker summary after the audit report",
);

console.log("package-scripts checks passed");
