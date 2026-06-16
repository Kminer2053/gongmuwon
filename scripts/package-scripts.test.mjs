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
  scripts["verify:completion:test"] ?? "",
  /prepare-ollama-ai-pack\.test\.mjs/,
  "verify:completion:test must include AI pack package checks",
);

assert.match(
  scripts["verify:completion:test"] ?? "",
  /validate-ai-pack-artifact\.test\.mjs/,
  "verify:completion:test must include AI pack artifact validation checks",
);

assert.match(
  scripts["release:ai-pack:validate"] ?? "",
  /validate-ai-pack-artifact\.mjs/,
  "release:ai-pack:validate must validate the generated AI pack artifact",
);

assert.match(
  scripts["release:ai-pack:evidence:validate"] ?? "",
  /validate-clean-account-evidence\.mjs/,
  "release:ai-pack:evidence:validate must validate clean-account evidence from a target PC",
);

assert.match(
  scripts["release:ai-pack:evidence:import"] ?? "",
  /import-clean-account-evidence\.mjs/,
  "release:ai-pack:evidence:import must copy target-PC evidence and run validation",
);

assert.match(
  scripts["release:ai-pack:evidence:finalize"] ?? "",
  /finalize-clean-account-evidence\.mjs/,
  "release:ai-pack:evidence:finalize must import target-PC evidence and rerun completion gates",
);

assert.match(
  scripts["release:ai-pack:evidence:request"] ?? "",
  /prepare-clean-account-evidence-request\.mjs/,
  "release:ai-pack:evidence:request must generate target-PC clean-account evidence handoff instructions",
);

assert.match(
  scripts["release:ai-pack:evidence:request:validate"] ?? "",
  /validate-clean-account-evidence-request\.mjs/,
  "release:ai-pack:evidence:request:validate must verify the handoff request matches the current AI pack artifact",
);

assert.match(
  scripts["verify:completion:test"] ?? "",
  /validate-clean-account-evidence\.test\.mjs/,
  "verify:completion:test must include clean-account evidence validation checks",
);

assert.match(
  scripts["verify:completion:test"] ?? "",
  /import-clean-account-evidence\.test\.mjs/,
  "verify:completion:test must include clean-account evidence import checks",
);

assert.match(
  scripts["verify:completion:test"] ?? "",
  /finalize-clean-account-evidence\.test\.mjs/,
  "verify:completion:test must include clean-account evidence finalization checks",
);

assert.match(
  scripts["verify:completion:test"] ?? "",
  /prepare-clean-account-evidence-request\.test\.mjs/,
  "verify:completion:test must include clean-account evidence request generation checks",
);

assert.match(
  scripts["verify:completion:test"] ?? "",
  /validate-clean-account-evidence-request\.test\.mjs/,
  "verify:completion:test must include clean-account evidence request freshness checks",
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
