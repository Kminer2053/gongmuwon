# Windows Anything External Integration Validation

## Date

- 2026-04-23

## Goal

Confirm that Gongmu treats `Anything` as an externally installed companion app rather than a bundled installer payload, and that the search-to-reference-to-documents workflow still closes cleanly.

## Contract

- Gongmu does not redistribute `Anything` inside the NSIS/MSI bundle.
- Gongmu detects an external `Anything` executable from common Windows install paths or `GONGMU_ANYTHING_EXE`.
- If detection succeeds, approved launch requests open the external app.
- If detection fails, approved launch requests open the official Docufinder releases page:
  - `https://github.com/chrisryugj/Docufinder/releases`
- Users can still import selected paths into a `Reference Set` and continue into `문서작성`.

## Detection Paths

Runtime and helper scripts check these paths in order:

1. `GONGMU_ANYTHING_EXE`
2. `%LOCALAPPDATA%\\Anything\\docufinder.exe`
3. `%LOCALAPPDATA%\\Programs\\Anything\\Anything.exe`
4. `%LOCALAPPDATA%\\Programs\\Docufinder\\Anything.exe`
5. `%ProgramFiles%\\Anything\\Anything.exe`
6. `%ProgramFiles%\\Docufinder\\Anything.exe`
7. `%ProgramFiles%\\Anything\\docufinder.exe`
8. `%ProgramFiles%\\Docufinder\\docufinder.exe`
9. `%ProgramFiles(x86)%\\Anything\\Anything.exe`
10. `%ProgramFiles(x86)%\\Docufinder\\Anything.exe`
11. `%ProgramFiles(x86)%\\Anything\\docufinder.exe`
12. `%ProgramFiles(x86)%\\Docufinder\\docufinder.exe`

## Validation Evidence

Fresh verification on 2026-04-23:

- `npm.cmd run sidecar:test` -> PASS (`27 passed`)
- `npm.cmd run desktop:test` -> PASS (`18 passed`)
- `node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` -> PASS
- `node scripts/windows-anything-validation-helper.test.mjs` -> PASS
- `npm.cmd run desktop:prepare:anything` -> PASS
  - `mode: external_app_detected`
  - `detected_path: C:\\Users\\USER\\AppData\\Local\\Anything\\docufinder.exe`

UI/runtime behaviors covered by tests:

- Missing external app shows install-guide action text.
- Detected external app shows direct `Anything` open action text.
- Approved launch can open and later reopen.
- Imported paths become a `Reference Set`.
- Imported references continue into `문서작성` with carried title/purpose/reference summary.

## Operator Commands

Run these on Windows when validating the external integration lane:

```powershell
npm.cmd run desktop:prepare:anything
npm.cmd run desktop:test
```

Observed local install on 2026-04-23:

- installer asset: `Anything_2.5.13_x64-setup.exe`
- silent install: `/S`
- installed executable: `C:\Users\USER\AppData\Local\Anything\docufinder.exe`

Optional GUI follow-up:

```powershell
npm.cmd run desktop:prepare:gui
```

## Release Note

This external-integration approach is intentional. Gongmu depends on `Anything` as a separately installed companion app and only owns:

- install detection
- install guidance fallback
- approved launch integration
- path import into `Reference Set`
- handoff into `문서작성`
