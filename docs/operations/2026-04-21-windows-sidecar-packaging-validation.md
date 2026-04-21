# Windows Sidecar Packaging Validation - 2026-04-21

## Scope

Validated Windows PyInstaller one-folder packaging for the Gongmu Python sidecar from the main Codex session.

- Workspace: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex`
- Python runtime: project `.venv` backed by Windows Python 3.11
- Output root: `release/sidecar/windows-x64/gongmu-sidecar/`

## Changes Introduced

- Added frozen-aware workspace resolution in `services/sidecar/src/gongmu_sidecar/workspace.py`
- Added packaged runtime entrypoint in:
  - `services/sidecar/src/gongmu_sidecar/server.py`
  - `services/sidecar/src/gongmu_sidecar/__main__.py`
- Added packaging regression tests in `services/sidecar/tests/test_runtime_entry.py`
- Added PyInstaller spec at `services/sidecar/packaging/gongmu-sidecar.spec`
- Added build script: `npm run sidecar:bundle:windows`

## Commands Run

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_runtime_entry.py -q
npm.cmd run sidecar:test
& .\.venv\Scripts\python.exe -m pip install pyinstaller
npm.cmd run sidecar:bundle:windows
```

Packaged executable smoke test:

```powershell
release\sidecar\windows-x64\gongmu-sidecar\gongmu-sidecar.exe
```

Validated by launching with:

- `GONGMU_SIDECAR_PORT=8876`
- `GONGMU_WORKSPACE_ROOT=runtime-workspace\cache\sidecar-bundle-smoke`

and checking:

- `http://127.0.0.1:8876/health`

## Results

- Packaging regression tests: PASS (`2 passed`)
- Full sidecar test suite: PASS (`16 passed`)
- PyInstaller install into `.venv`: PASS
- Windows one-folder sidecar build: PASS
- Packaged sidecar smoke test: PASS
- `/health` response returned `status=ok`
- Bundle-created workspace directories were created successfully

## Output

- Bundle root: `release/sidecar/windows-x64/gongmu-sidecar/`
- Main executable: `release/sidecar/windows-x64/gongmu-sidecar/gongmu-sidecar.exe`
- Build work cache: `runtime-workspace/cache/pyinstaller/gongmu-sidecar/`
- Smoke workspace: `runtime-workspace/cache/sidecar-bundle-smoke/`

## Notes

- The first smoke test failure was caused by `services/sidecar/src/gongmu_sidecar/__main__.py` using a relative import when executed as the packaged top-level script. This was fixed by switching to `from gongmu_sidecar.server import main`.
- The packaged executable now honors `GONGMU_WORKSPACE_ROOT`, which is the safest option for isolated validation and future installer wiring.
- This validation confirms the current recommended Windows sidecar strategy from the packaging plan is viable.

## Remaining Follow-Up

- Decide how the desktop installer should locate or launch the sidecar bundle in an integrated release package.
- Optionally trim PyInstaller hidden imports if bundle size becomes a problem.
