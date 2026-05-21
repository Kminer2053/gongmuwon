# Feature-First Functional Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` when implementing this plan. This plan is intentionally feature-first: installer/package validation is deferred until the functional blockers are resolved.

## Goal

Use the user-reported functional validation results from April 23, 2026 to fix the real feature blockers first, then improve the most important UX gaps, and only after that return to installer/package validation.

Primary rule:

- `설치패키지 점검은 나중에`
- `기능 blocker 먼저`

## Source Inputs

- [2026-04-23-functional-validation-checklist.md](C:/Users/USER/Agent_Gongmu/Agent_Gongmu_Codex/docs/operations/2026-04-23-functional-validation-checklist.md)
- [2026-04-23-functional-validation-results.md](C:/Users/USER/Agent_Gongmu/Agent_Gongmu_Codex/docs/operations/2026-04-23-functional-validation-results.md)

## Batch Structure

This plan is split into three feature batches.

### Batch 1. Functional Blockers

Fix the three blockers that stop real end-to-end use:

1. `문서작성` Content Base generation fails with `Failed to fetch`
2. `내 지식폴더` approval fails with `Failed to fetch`
3. `파일정리` apply fails with `409 conflict`

### Batch 2. Feature Meaning / Connection UX

Once blockers are fixed, improve the product’s connected-workflow clarity:

1. clarify what `Reference Set` is for
2. improve Anything install / launch / handoff discoverability
3. make `Continue to Documents` easier to discover and test
4. improve candidate/proposal card detail inspection

### Batch 3. Workflow IA / UI Direction

This batch is not a bugfix batch. It is a product-shaping batch:

1. schedule UI toward calendar-first day/week/month
2. move `업무대화` into a top-level primary workflow role
3. define session persistence / saved conversation structure
4. improve execution-log readability and detail expansion

## Batch 1 Plan: Functional Blockers

## Task 1. Debug `ContentBase.md 생성` fetch failure

**Goal:** reproduce the user’s `Failed to fetch` error from the real packaged desktop context or the current release desktop context, identify whether the failure is frontend request formation, runtime bridge state, or sidecar-side exception, and then fix it.

**Likely files:**

- `apps/desktop/src/app.tsx`
- `apps/desktop/src/api.ts`
- `services/sidecar/src/gongmu_sidecar/app.py`
- `services/sidecar/src/gongmu_sidecar/documents.py`
- relevant tests under:
  - `apps/desktop/src/app.test.tsx`
  - `services/sidecar/tests/test_api_flows.py`

### Steps

- [ ] Reproduce the failure from the current Windows desktop executable, not just tests
- [ ] Capture:
  - UI action
  - request target
  - sidecar log
  - desktop runtime log
- [ ] Determine which layer fails:
  - frontend fetch never sent
  - fetch sent but sidecar unavailable
  - sidecar returned internal exception
- [ ] Add a failing regression test if the bug can be reproduced in automated tests
- [ ] Implement the smallest safe fix
- [ ] Re-run:
  - `npm.cmd --workspace apps/desktop run test -- src/app.test.tsx`
  - `npm.cmd run sidecar:test`
  - focused real-app manual retest for A4/A5/A6

### Exit Criteria

- `ContentBase.md 생성` succeeds
- preview appears
- stale protection can now be tested
- final save request/apply can now be tested

## Task 2. Debug knowledge approval fetch failure

**Goal:** fix the `Failed to fetch` on candidate approval and restore C2/C3.

**Likely files:**

- `services/sidecar/src/gongmu_sidecar/app.py`
- `services/sidecar/src/gongmu_sidecar/knowledge.py`
- `apps/desktop/src/api.ts`
- `apps/desktop/src/app.tsx`
- tests:
  - `services/sidecar/tests/test_api_flows.py`
  - `services/sidecar/tests/test_knowledge_search.py`

### Steps

- [ ] Reproduce the approval failure from the desktop app
- [ ] Capture the exact failing endpoint and sidecar traceback
- [ ] Add or extend a failing regression test
- [ ] Implement the minimal fix
- [ ] Re-test:
  - candidate approval
  - resulting page visibility/path
  - knowledge search afterward

### Exit Criteria

- candidate approval succeeds
- page is created
- knowledge search can run against created knowledge data

## Task 3. Debug file organizer apply `409 conflict`

**Goal:** determine whether the `409` is expected replay protection firing incorrectly, proposal state drift, approval mismatch, or frontend sequencing.

**Likely files:**

- `services/sidecar/src/gongmu_sidecar/app.py`
- `services/sidecar/src/gongmu_sidecar/file_organizer.py`
- `apps/desktop/src/app.tsx`
- tests:
  - `services/sidecar/tests/test_file_organizer_apply.py`
  - `services/sidecar/tests/test_api_flows.py`

### Steps

- [ ] Reproduce the apply flow exactly as the user did
- [ ] Confirm whether:
  - request apply is created
  - approval is granted
  - commit endpoint sees the proposal as already applied / invalid
- [ ] Add or extend a regression test
- [ ] Implement the smallest safe fix
- [ ] Re-test apply + rollback

### Exit Criteria

- request -> approve -> apply succeeds
- result path is shown
- rollback can now be tested and succeeds

## Batch 2 Plan: Feature Meaning / Connection UX

Do not start this batch until Batch 1 is green.

## Task 4. Reference Set clarity and import UX

Address the user confusion around what `Reference Set` is for.

### Desired outcomes

- the UI tells the user what a Reference Set is
- Reference Set clearly reads as “작업에 붙일 참고자료 묶음”
- Anything import path feels more direct

### Candidate changes

- helper copy in the search/documents screens
- more explicit labels around imported file collections
- later possibility: drag/drop import for file paths

## Task 5. Anything install / launch discoverability

### Desired outcomes

- if Anything is not installed, the app says so clearly
- if the user approves an Anything open action but the target tool is unavailable, the app gives next-step guidance
- the path from search -> import -> documents is obvious

### Candidate changes

- explicit missing-dependency notice
- helper text near the Anything area
- clearer `Continue to Documents` affordance

## Task 6. Card detail inspection

Apply the same idea to:

- knowledge candidate cards
- file organizer proposal cards
- execution log cards

### Desired outcomes

- clicking a card opens or expands detailed content
- the user can see the submitted body / proposal reason / execution detail

## Batch 3 Plan: Workflow IA / UI Direction

This batch is a design batch, not a hotfix batch.

## Task 7. Reframe top-level workflow order

User feedback indicates the app’s mental model should be:

1. 업무대화
2. 일정
3. 검색/참고자료
4. 문서작성

instead of starting from schedule as the primary entry point.

### Deliverable

- a design note or UX plan before code changes

## Task 8. Calendar-first schedule UI

### Desired outcomes

- day/week/month calendar visibility
- click a date/time cell to create schedule items
- inspect existing schedules visually

### Deliverable

- design-first plan before implementation

## Task 9. Session persistence for 업무대화

### Desired outcomes

- LLM-style conversation sessions
- saved conversation history
- optional linking from conversation -> schedule and schedule -> conversation

### Deliverable

- architecture and product-flow plan before implementation

## Verification Strategy

### After Batch 1

- re-run the affected checklist items:
  - A4
  - A5
  - A6
  - C2
  - C3
  - D2
  - D3

### After Batch 2

- re-run:
  - A3
  - B1
  - B2
  - B3
  - B4
  - C1 detail inspection
  - D1 detail inspection
  - E4 detail inspection

### After Batch 3

- run a new UX validation pass with the user

## Deferred For Later

These are explicitly not in the next immediate fix batch:

- installer/package deep validation
- full clean-account install pass
- polishing the known uninstall leftover issue when app/sidecar is still running

Those return only after the current feature blockers are resolved.

## Recommended Immediate Next Step

Start with Batch 1, in this exact order:

1. debug Content Base fetch failure
2. debug knowledge approval fetch failure
3. debug file organizer apply conflict

This order is recommended because:

- `문서작성` is the highest-value user flow
- `지식 승인` failure blocks a whole feature area
- `파일정리` apply conflict is important, but slightly less central than document creation
