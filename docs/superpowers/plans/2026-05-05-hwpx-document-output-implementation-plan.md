# HWPX Document Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change document finalization from Markdown copy output to HWPX generation using a HwpxMaker-compatible JSON-to-HWPX adapter.

**Architecture:** Keep Content Base Markdown as the source of truth. Add a focused sidecar `hwpx_writer.py` that maps Content Base metadata and Markdown into public-document sections, writes `.hwpx` with `python-hwpx`, and writes a sibling review `.md`. Update `DocumentManager` finalization to call this writer while preserving approval and duplicate-name behavior.

**Tech Stack:** Python 3.11, FastAPI sidecar, SQLite, `python-hwpx`, `lxml`, pytest, React/TypeScript desktop UI, Vitest.

---

## Files

- Create: `services/sidecar/src/gongmu_sidecar/hwpx_writer.py`
- Modify: `services/sidecar/src/gongmu_sidecar/documents.py`
- Modify: `services/sidecar/tests/test_api_flows.py`
- Modify: `services/sidecar/pyproject.toml`
- Modify: `apps/desktop/src/api.ts`
- Modify: `apps/desktop/src/app.tsx`
- Modify: `docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md`

## Task 1: Failing Sidecar Tests

- [x] Update document finalization tests so approved final save expects `.hwpx`.
- [x] Assert a sibling `.md` review file exists.
- [x] Assert `artifact.markdown_path` is returned by the apply API.
- [x] Assert Windows-invalid names are sanitized to `.hwpx`.
- [x] Assert duplicate output names are versioned as separate HWPX files.
- [x] Run `npm.cmd run sidecar:test -- services/sidecar/tests/test_api_flows.py -q`.
- [x] Expected result before implementation: tests fail because current output suffix is `.md`.

## Task 2: HWPX Writer

- [x] Add `python-hwpx==2.9.1` and `lxml==5.4.0` to `services/sidecar/pyproject.toml`.
- [x] Install sidecar dependencies in the existing Windows venv.
- [x] Create `hwpx_writer.py` with:
  - `PublicDocumentPayload`
  - `build_public_document_payload(...)`
  - `render_public_document_lines(...)`
  - `write_public_hwpx_document(...)`
- [x] Use `HwpxDocument.new()`, `add_paragraph(...)`, and `save_to_path(...)`.
- [x] Run the failing sidecar tests again and confirm the new writer is exercised.

## Task 3: DocumentManager Integration

- [x] Import `write_public_hwpx_document` in `documents.py`.
- [x] Change `_final_output_filename()` to normalize `.md`, `.hwpx`, and extensionless names into `.hwpx`.
- [x] Change `apply_final_document_output()` to read the Content Base Markdown and call the writer.
- [x] Return `artifact: { path, markdown_path, format }` from successful apply.
- [x] Preserve existing idempotent apply behavior for already-applied outputs.
- [x] Run `npm.cmd run sidecar:test -- services/sidecar/tests/test_api_flows.py -q`.

## Task 4: Desktop Contract Text

- [x] Extend `FinalDocumentApplyResult.artifact` with optional `markdown_path` and `format`.
- [x] Update the final-save helper copy to say HWPX is generated under `documents/outputs`.
- [x] Show `검토용 Markdown` path when `artifact_path` has a sibling `.md` only if it is available in the last apply response.
- [x] Run `npm.cmd --workspace apps/desktop run test -- src/app.test.tsx`.

## Task 5: Verification And Docs

- [x] Run `npm.cmd run sidecar:test`.
- [x] Run `npm.cmd run desktop:test`.
- [x] Run `node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`.
- [x] Run `git diff --check` on touched files.
- [x] Update the checkpoint board with HWPX generation evidence and remaining follow-ups.
- [x] Restart dev sidecar and Tauri app for manual checking.

## Current Evidence

- Red test: `npm.cmd run sidecar:test -- services/sidecar/tests/test_api_flows.py -q` failed with missing `artifact.markdown_path`.
- Targeted green: `npm.cmd run sidecar:test -- services/sidecar/tests/test_api_flows.py -q` passed after HWPX writer integration.
- Targeted desktop: `npm.cmd --workspace apps/desktop run test -- src/app.test.tsx` passed.
- Full sidecar: `npm.cmd run sidecar:test` -> 54 passed.
- Full desktop: `npm.cmd run desktop:test` -> 17 files / 39 tests passed.
- Rust check: `node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` -> PASS.
- Diff whitespace: `git diff --check` -> PASS.
- Dev restart: sidecar `/health` -> `ok`, `gongmu-desktop.exe` running.
