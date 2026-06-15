# Final Completion Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` when independent subagents are available, otherwise use `superpowers:executing-plans`. Steps use checkbox syntax for tracking.

**Goal:** Define and automate the final completion gate for `로컬 AI에이전트 워크플레이스 : 공무원` so completion can be judged from current evidence instead of memory or optimism.

**Architecture:** A human-readable Korean criteria document explains the release-quality gates. A machine-readable JSON file stores each gate, required evidence, current status, and blocking follow-up. A Node.js verifier reads the JSON, checks evidence files, writes an audit report, and fails when required gates are not proven complete.

**Tech Stack:** Markdown, JSON, Node.js ESM, existing npm script orchestration.

---

## Task 1: Completion Criteria Artifacts

**Files:**

- `docs/operations/2026-06-15-final-completion-verification-criteria.md`
- `docs/operations/final-completion-criteria.json`

- [x] Define the product completion rule.
- [x] Encode required gates for regression tests, chat-first workflow, runtime, calendar, file search, Knowledge Folder 2.0, document authoring, LLM/model settings, UX evidence, packaging/offline release, release hygiene, and PR/branch integration.
- [x] Mark unresolved gates honestly as `pending` or `partial`, not `pass`.

## Task 2: Verifier Script

**Files:**

- `scripts/verify-final-completion.mjs`
- `scripts/verify-final-completion.test.mjs`
- `package.json`

- [x] Add verifier that reads `docs/operations/final-completion-criteria.json`.
- [x] Check required evidence files.
- [x] Write generated JSON/Markdown reports.
- [x] Exit non-zero unless all required gates are complete.
- [x] Add npm commands:

```json
{
  "verify:completion:test": "node scripts/verify-final-completion.test.mjs",
  "verify:completion": "node scripts/verify-final-completion.mjs",
  "verify:completion:audit": "node scripts/verify-final-completion.mjs --allow-pending"
}
```

## Task 3: Verification Run

**Generated Files:**

- `docs/operations/generated/final-completion-verification-report.json`
- `docs/operations/generated/final-completion-verification-report.md`

- [x] Run the non-blocking audit:

```powershell
npm.cmd run verify:completion:audit
```

Expected: exit code `0`, generated report lists pending gates.

- [ ] Run the strict gate:

```powershell
npm.cmd run verify:completion
```

Expected before final release: non-zero exit because unresolved gates still exist. Expected at final completion: exit code `0`.

## Task 4: Continue Closing Gates

**Files:**

- Update evidence paths in `docs/operations/final-completion-criteria.json`
- Update generated report via `npm.cmd run verify:completion:audit`

- [ ] Resolve dirty worktree.

```powershell
git status --short
```

Expected at final completion: no uncommitted release changes.

- [ ] Refresh full automated verification.

```powershell
npm.cmd run verify:all
```

Expected at final completion: sidecar tests, desktop tests, desktop build, and cargo check all pass on the final release commit.

- [ ] Refresh packaging verification.

```powershell
npm.cmd run desktop:smoke:nsis
npm.cmd run release:offline
```

Expected at final completion: install smoke and offline release artifacts pass for the final release commit.

- [ ] Refresh manual/user-experience evidence for FS-01 through FS-12.

Expected at final completion: a current validation report proves the user-facing workflow with no unwaived `Partial` or `Not run` gate.
