# Gongmu Quality Hardening Batch Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-value quality gaps found after the MVP feature build so the current Windows-first Gongmu workspace behaves safely under real user edits, approval replays, sidecar lifecycle failures, and release handoff scenarios.

**Architecture:** Treat this as one hardening batch across four connected layers: desktop document/runtime UX, Tauri sidecar lifecycle, sidecar data-integrity rules, and Windows release operations. Each task should add a failing regression first, implement the smallest safe behavior change, then re-run the focused suite plus one broader verification command before moving on.

**Tech Stack:** `Tauri 2`, `React 19`, `TypeScript`, `Vitest`, `Rust`, `FastAPI`, `SQLite`, `pytest`, `Node.js`

---

## Batch Scope

This batch should fix and verify these concrete gaps:

1. Desktop can save an outdated Content Base after the user edits the form.
2. Managed sidecar start failure can leak child state and retries can misbehave.
3. Desktop has no recovery path when an unmanaged sidecar is already reachable.
4. File organizer rollback can destroy pre-existing destination files.
5. Knowledge page approval can overwrite an existing Markdown canonical file.
6. Final document output can overwrite an existing artifact with the same output name.
7. Approval tickets can be re-decided after apply, breaking audit consistency.
8. `anything-launch.test.tsx` passes in Vitest but breaks `desktop:build` due to narrow type inference.
9. Release/operations docs and alpha staging do not fully reflect the latest GUI validation path.
10. GUI uninstall behavior should be recorded as a known follow-up, not silently treated as fully clean.

---

### Task 1: Fix Desktop Draft Staleness And Build-Breaking Test Types

**Files:**
- Modify: `apps/desktop/src/app.tsx`
- Modify: `apps/desktop/src/app.test.tsx`
- Modify: `apps/desktop/src/anything-launch.test.tsx`
- Modify: `apps/desktop/src/api.ts` (only if stricter helper typing is needed)
- Modify: `docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md`

- [ ] **Step 1: Write failing desktop regression tests**

Add one test to `apps/desktop/src/app.test.tsx` that:
- creates a content base
- changes document title or selected reference set afterward
- requests final save
- asserts the app either regenerates the content base first or blocks finalize until a fresh draft is created

Add one test update to `apps/desktop/src/anything-launch.test.tsx` so the mocked `anythingLaunches` collection is explicitly typed as `AnythingLaunchItem[]`, then verify the file still compiles under `tsc -b`.

- [ ] **Step 2: Run the focused tests to verify red**

Run:

```powershell
npm.cmd --workspace apps/desktop run test -- src/app.test.tsx
npm.cmd --workspace apps/desktop run build
```

Expected:
- new app regression test fails
- `desktop:build` fails on the current `anything-launch.test.tsx` typing issue

- [ ] **Step 3: Implement the minimal desktop fix**

In `apps/desktop/src/app.tsx`:
- invalidate `lastContentBase` whenever document title, purpose, template, or selected reference set changes after draft generation
- ensure `submitDocumentFinalizeRequest()` refuses to finalize stale draft state and instead regenerates or requires a fresh draft first
- if there is an unmanaged sidecar reachable state, expose a recovery CTA instead of leaving the user with no action path

In `apps/desktop/src/anything-launch.test.tsx`:
- explicitly type mutable mocked launch arrays as `AnythingLaunchItem[]`
- avoid literal narrowing that breaks `tsc -b`

- [ ] **Step 4: Run the focused tests to verify green**

Run:

```powershell
npm.cmd --workspace apps/desktop run test -- src/app.test.tsx
npm.cmd --workspace apps/desktop run test -- src/anything-launch.test.tsx
npm.cmd --workspace apps/desktop run build
```

Expected:
- all three commands PASS

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/app.tsx apps/desktop/src/app.test.tsx apps/desktop/src/anything-launch.test.tsx docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md
git commit -m "fix: harden desktop draft and runtime recovery flows"
```

---

### Task 2: Harden Tauri Managed Sidecar Lifecycle

**Files:**
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Modify: `apps/desktop/src/app.test.tsx`
- Modify: `docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md`

- [ ] **Step 1: Write failing lifecycle regression tests**

Extend `apps/desktop/src/app.test.tsx` or add a focused runtime test to cover:
- sidecar start failure followed by retry does not duplicate managed child state
- unmanaged reachable sidecar state still offers an in-app recovery path

- [ ] **Step 2: Run the focused test to verify red**

Run:

```powershell
npm.cmd --workspace apps/desktop run test -- src/app.test.tsx
```

Expected:
- lifecycle regression test fails on current behavior

- [ ] **Step 3: Implement minimal lifecycle fix**

In `apps/desktop/src-tauri/src/main.rs`:
- if startup health probe fails, clean up the spawned child handle and process before returning error
- distinguish `running + managed=false` state from healthy managed state in a way the frontend can act on
- ensure retry after failed start cannot leave orphaned managed state in memory

In `apps/desktop/src/app.tsx`:
- show a recovery action when `managed=false` but sidecar is reachable
- preserve the existing managed restart/stop flow

- [ ] **Step 4: Run focused verification**

Run:

```powershell
npm.cmd --workspace apps/desktop run test -- src/app.test.tsx
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected:
- both PASS

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src-tauri/src/main.rs apps/desktop/src/app.tsx apps/desktop/src/app.test.tsx docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md
git commit -m "fix: harden managed sidecar lifecycle recovery"
```

---

### Task 3: Prevent Data Loss In Sidecar Content Flows

**Files:**
- Modify: `services/sidecar/src/gongmu_sidecar/file_organizer.py`
- Modify: `services/sidecar/src/gongmu_sidecar/knowledge.py`
- Modify: `services/sidecar/src/gongmu_sidecar/documents.py`
- Modify: `services/sidecar/tests/test_file_organizer_apply.py`
- Modify: `services/sidecar/tests/test_api_flows.py`
- Create or modify: `services/sidecar/tests/test_knowledge_search.py`
- Modify: `docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md`

- [ ] **Step 1: Write failing sidecar regression tests**

Add tests for:
- file organizer apply into an existing destination file must not overwrite and rollback must not delete the original
- approving two knowledge candidates with the same title must produce distinct canonical artifact paths
- finalizing two documents with the same output name must not silently overwrite the older artifact

- [ ] **Step 2: Run focused sidecar tests to verify red**

Run:

```powershell
npm.cmd run sidecar:test
```

Expected:
- new regression tests fail for overwrite behavior

- [ ] **Step 3: Implement the minimal integrity fix**

In `file_organizer.py`:
- detect destination collisions before copy
- either reject apply cleanly or version the destination path
- rollback must only remove files created by the operation, never a pre-existing original

In `knowledge.py`:
- make canonical file path generation collision-safe for duplicate titles

In `documents.py`:
- make final output artifact generation collision-safe for duplicate output names

- [ ] **Step 4: Re-run focused sidecar verification**

Run:

```powershell
npm.cmd run sidecar:test
```

Expected:
- full sidecar suite PASS

- [ ] **Step 5: Commit**

```powershell
git add services/sidecar/src/gongmu_sidecar/file_organizer.py services/sidecar/src/gongmu_sidecar/knowledge.py services/sidecar/src/gongmu_sidecar/documents.py services/sidecar/tests/test_file_organizer_apply.py services/sidecar/tests/test_api_flows.py services/sidecar/tests/test_knowledge_search.py docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md
git commit -m "fix: prevent overwrite collisions in sidecar workflows"
```

---

### Task 4: Lock Approval State And Replay Safety

**Files:**
- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
- Modify: `services/sidecar/tests/test_api_flows.py`
- Modify: `services/sidecar/tests/test_file_organizer_apply.py`
- Modify: `docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md`

- [ ] **Step 1: Write failing approval replay tests**

Add tests for:
- once an approval ticket is decided and applied, a second decision attempt is rejected
- rejected Anything launch cannot be applied
- repeated apply/commit on the same ticket or proposal is rejected cleanly

- [ ] **Step 2: Run focused tests to verify red**

Run:

```powershell
npm.cmd run sidecar:test
```

Expected:
- new replay tests fail on current loose state transitions

- [ ] **Step 3: Implement minimal approval invariants**

In `services/sidecar/src/gongmu_sidecar/app.py`:
- prevent `decide_approval_ticket()` from mutating already-decided tickets
- reject apply routes for tickets that are not approved exactly once
- keep error responses explicit enough for the desktop to surface correctly

- [ ] **Step 4: Re-run verification**

Run:

```powershell
npm.cmd run sidecar:test
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```powershell
git add services/sidecar/src/gongmu_sidecar/app.py services/sidecar/tests/test_api_flows.py services/sidecar/tests/test_file_organizer_apply.py docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md
git commit -m "fix: enforce approval ticket replay safety"
```

---

### Task 5: Align Release And Operations Artifacts With Current Reality

**Files:**
- Modify: `scripts/prepare-alpha-release.mjs`
- Modify: `scripts/prepare-alpha-release.test.mjs`
- Modify: `release/alpha/README.md`
- Modify: `release/alpha/manifest.json`
- Modify: `docs/operations/2026-04-20-alpha-offline-packaging-runbook.md`
- Modify: `docs/operations/2026-04-20-windows-remote-validation-checklist.md`
- Modify: `docs/operations/2026-04-22-windows-interactive-install-validation.md`

- [ ] **Step 1: Write failing release/ops regression tests**

Extend `scripts/prepare-alpha-release.test.mjs` to require:
- GUI validation checklist inclusion in alpha staging metadata or README guidance
- stale files are cleaned before staging is re-generated
- staged document names match what the runbook tells operators to expect

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
node scripts/prepare-alpha-release.test.mjs
```

Expected:
- FAIL on at least one of the newly added release/ops expectations

- [ ] **Step 3: Implement minimal operations alignment**

Update:
- `prepare-alpha-release.mjs` so `release/alpha` is refreshed deterministically, without stale carry-over
- alpha staging guidance so operators can see the GUI validation lane
- offline packaging runbook so it matches today’s Windows main workflow, `sidecar-README.md`, and `desktop:bundle` behavior
- interactive validation doc so the observed uninstall residual issue is recorded as a known follow-up, not silently ignored

- [ ] **Step 4: Re-run verification**

Run:

```powershell
node scripts/prepare-alpha-release.test.mjs
npm.cmd run release:alpha
```

Expected:
- both PASS

- [ ] **Step 5: Commit**

```powershell
git add scripts/prepare-alpha-release.mjs scripts/prepare-alpha-release.test.mjs release/alpha/README.md release/alpha/manifest.json docs/operations/2026-04-20-alpha-offline-packaging-runbook.md docs/operations/2026-04-20-windows-remote-validation-checklist.md docs/operations/2026-04-22-windows-interactive-install-validation.md
git commit -m "docs: align release staging and windows ops guidance"
```

---

### Task 6: Full Batch Verification And Integration Review

**Files:**
- Modify only if needed by verification fallout

- [ ] **Step 1: Run full verification bundle**

Run:

```powershell
npm.cmd run verify:all
npm.cmd run desktop:smoke:nsis
```

Expected:
- all PASS

- [ ] **Step 2: Run a review pass on the batch diff**

Review the full range from the first hardening commit through the last one.

Check:
- no stale draft finalize path remains
- no overwrite collision remains in file organizer / knowledge / document output
- approval replay rules are consistent across all apply flows
- release docs now match current Windows workflow

- [ ] **Step 3: Commit any verification-only fallout**

```powershell
git add -A
git commit -m "test: close quality hardening verification fallout"
```

Only do this if verification required a real code or doc correction.

- [ ] **Step 4: Prepare PR**

PR summary should group changes by:
- desktop runtime and draft safety
- sidecar integrity and approval invariants
- release/ops alignment

PR test plan should include:
- `npm.cmd run sidecar:test`
- `npm.cmd run desktop:test`
- `npm.cmd run verify:all`
- `npm.cmd run desktop:smoke:nsis`

---

## Self-Review

### Coverage

This batch covers every concrete issue found in the audit:
- desktop stale draft finalize
- desktop build failure in `anything-launch.test.tsx`
- managed/unmanaged sidecar recovery gaps
- file organizer overwrite/rollback data loss
- knowledge canonical overwrite collisions
- document output overwrite collisions
- approval replay inconsistency
- release/ops drift and stale alpha staging behavior

### Placeholder Scan

- No `TODO`/`TBD` placeholders remain.
- Each task has exact commands and concrete verification gates.
- Commit boundaries are intentional and map to one quality theme each.

### Assumptions

- The GUI uninstall residual folder issue is recorded as a follow-up unless the hardening work uncovers a safe deterministic fix inside this batch.
- `desktop:smoke:nsis` remains the primary Windows executable proof for this batch.
- The current base branch for integration is `main`.
