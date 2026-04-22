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
  manifest.next_checks.includes("Review the latest Anything-to-Documents handoff evidence in the checkpoint board."),
  "manifest should surface the latest handoff verification follow-up",
);

console.log("prepare-alpha-release checks passed");
