import assert from "node:assert/strict";

import {
  buildManifest,
  resolveReleaseFileName,
  stagedDocuments,
} from "./prepare-alpha-release.mjs";

assert.ok(
  stagedDocuments.includes("docs/operations/2026-04-22-windows-interactive-install-validation.md"),
  "alpha staging should include the 2026-04-22 interactive install validation doc",
);

assert.ok(
  stagedDocuments.includes("docs/operations/2026-04-23-anything-external-integration-validation.md"),
  "alpha staging should include the Anything external integration validation doc",
);

assert.ok(
  stagedDocuments.includes("docs/operations/2026-04-23-functional-validation-results.md"),
  "alpha staging should include the latest functional validation results doc",
);

assert.ok(
  stagedDocuments.includes("docs/operations/2026-04-20-windows-remote-validation-checklist.md"),
  "alpha staging should include the Windows remote validation checklist for the GUI lane",
);

assert.ok(
  stagedDocuments.includes("docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md"),
  "alpha staging should include the checkpoint board for the latest handoff evidence",
);

assert.equal(
  resolveReleaseFileName("services/sidecar/README.md"),
  "sidecar-README.md",
  "sidecar README should not overwrite the generated alpha README",
);

const manifest = buildManifest();

assert.ok(
  manifest.staged_documents.includes("2026-04-22-windows-interactive-install-validation.md"),
  "manifest should advertise the latest Windows interactive validation doc",
);

assert.ok(
  manifest.staged_documents.includes("2026-04-20-gongmu-mvp-checkpoint-board.md"),
  "manifest should advertise the latest checkpoint board",
);

assert.ok(
  manifest.staged_documents.includes("2026-04-23-anything-external-integration-validation.md"),
  "manifest should advertise the Anything external integration validation doc",
);

assert.ok(
  manifest.staged_documents.includes("2026-04-23-functional-validation-results.md"),
  "manifest should advertise the latest functional validation results doc",
);

assert.ok(
  manifest.staged_documents.includes("2026-04-20-windows-remote-validation-checklist.md"),
  "manifest should advertise the Windows remote validation checklist",
);

assert.ok(
  manifest.next_checks.includes("Review the latest Anything-to-Documents handoff evidence in the checkpoint board."),
  "manifest should surface the latest handoff verification follow-up",
);

assert.ok(
  manifest.next_checks.includes("Run npm run desktop:prepare:anything before Anything external-integration checks."),
  "manifest should surface the Anything helper command",
);

assert.ok(
  manifest.next_checks.includes("Review the Anything external integration validation note before release sign-off."),
  "manifest should remind operators about the Anything integration validation note",
);

assert.ok(
  manifest.next_checks.includes("Review the latest functional validation results before changing IA or workflow behavior."),
  "manifest should remind operators to review the latest functional validation results",
);

assert.ok(
  manifest.next_checks.includes("Run npm run desktop:prepare:gui before a human GUI install pass on Windows."),
  "manifest should surface the GUI helper command for the manual validation lane",
);

assert.ok(
  manifest.next_checks.includes(
    "Use the Windows remote validation checklist for the manual GUI lane and close the desktop app before uninstall.",
  ),
  "manifest should remind operators about the close-before-uninstall rule for GUI validation",
);

console.log("prepare-alpha-release checks passed");
