import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const criteriaPath = path.resolve("docs/operations/final-completion-criteria.json");
const criteria = JSON.parse(fs.readFileSync(criteriaPath, "utf8"));

const g11 = criteria.gates.find((gate) => gate.id === "G11");
assert.ok(g11, "G11 clean install evidence gate must exist");

const commands = g11.evidence?.commands ?? [];
assert.ok(
  commands.includes("npm.cmd run release:ai-pack:evidence:request:validate"),
  "G11 must validate that the clean-account evidence request matches the latest AI pack",
);
assert.ok(
  commands.includes("npm.cmd run release:ai-pack:evidence:validate"),
  "G11 must validate imported clean-account evidence after the target PC run",
);

const requiredFiles = g11.evidence?.requiredFiles ?? [];
assert.ok(
  requiredFiles.includes("docs/operations/generated/clean-account-evidence-request-validation.json"),
  "G11 must require the clean-account evidence request validation JSON",
);
assert.ok(
  requiredFiles.includes("docs/operations/generated/clean-account-evidence-request-validation.md"),
  "G11 must require the clean-account evidence request validation Markdown",
);

const notesAndFollowUps = [...(g11.evidence?.notes ?? []), ...(g11.blockingFollowUp ?? [])].join("\n");
assert.match(
  notesAndFollowUps,
  /RUN_FULL_VALIDATION\.bat/,
  "G11 must make the one-click clean-account validation launcher the primary target-PC path",
);
assert.match(
  notesAndFollowUps,
  /START_INSTALL\.bat.*VALIDATE_INSTALL\.bat.*COLLECT_EVIDENCE\.bat/s,
  "G11 may still document the step-by-step fallback launchers",
);

console.log("final-completion-criteria checks passed");
