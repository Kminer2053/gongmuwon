# Gongmu Sidecar

Python FastAPI sidecar for the Gongmu local-first workspace.

## Dev Commands

- `npm run sidecar:test`
- `npm run sidecar:serve`
- `npm run sidecar:bundle:windows`
- `npm run desktop:test`
- `npm run desktop:build`
- `npm run desktop:bundle`
- `npm run verify:all`

## Runtime Notes

- Default bind: `127.0.0.1:8765`
- Workspace root: `runtime-workspace/`
- Runtime DB: `runtime-workspace/db/gongmu.db`
- Knowledge raw: `runtime-workspace/knowledge/raw`
- Knowledge structured: `runtime-workspace/knowledge/structured`
- Knowledge graph: `runtime-workspace/knowledge/graph`
- Documents: `runtime-workspace/documents/`

## MVP Service Surface

- `/health`: runtime workspace and service health
- `/api/settings`: runtime settings contract
- `/api/tools`: tool manifest
- `/api/documents/*`: Content Base creation, final output request/apply
- `/api/knowledge/*`: knowledge candidate, search, graph summary
- `/api/file-organizer/*`: proposal creation, apply request, commit, rollback

## Operating Rules

- Default behavior is local-first.
- Risky actions must go through approval tickets.
- File organizer operations currently prefer copy-based application.
- Execution logs are part of the runtime audit trail.

## Offline Packaging Notes

- Desktop installers are produced with `npm run desktop:bundle`.
- The Windows sidecar one-folder bundle is produced with `npm run sidecar:bundle:windows`.
- Alpha release staging is prepared with `npm run release:alpha`.
- Tauri bundle artifacts live under `apps/desktop/src-tauri/target/release/bundle/`.
- Sidecar bundle artifacts live under `release/sidecar/windows-x64/gongmu-sidecar/`.
- Packaging guidance lives in:
  - `docs/operations/2026-04-20-alpha-offline-packaging-runbook.md`
  - `docs/operations/2026-04-20-sidecar-packaging-strategy.md`
  - `docs/operations/2026-04-20-windows-install-validation.md`
  - `docs/operations/2026-04-21-windows-sidecar-packaging-validation.md`
