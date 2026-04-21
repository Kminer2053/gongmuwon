# Windows Install Validation - 2026-04-20

## Scope

Validated the current Windows desktop bundle flow from the main Codex session on:

- Workspace: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex`
- Target app: `Gongmu 0.1.0`

## Commands Run

```powershell
npm.cmd run sidecar:test
npm.cmd run desktop:test
npm.cmd run desktop:bundle
npm.cmd run desktop:smoke:nsis
```

Installer validation was then performed into workspace-local cache folders:

```powershell
msiexec.exe /a apps\desktop\src-tauri\target\release\bundle\msi\Gongmu_0.1.0_x64_en-US.msi /qn TARGETDIR=runtime-workspace\cache\windows-installer-check\msi-admin-20260420-231815
apps\desktop\src-tauri\target\release\bundle\nsis\Gongmu_0.1.0_x64-setup.exe /S /D=runtime-workspace\cache\windows-installer-check\nsis-install-20260420-231815
```

## Results

- `sidecar:test`: PASS (`14 passed`)
- `desktop:test`: PASS (`10 passed`)
- `desktop:bundle`: PASS
- `desktop:smoke:nsis`: PASS
- MSI bundle generated successfully
- NSIS bundle generated successfully
- MSI administrative extraction produced `gongmu-desktop.exe`
- NSIS silent install produced `gongmu-desktop.exe` and `uninstall.exe`
- NSIS smoke script verified:
  - silent install into `runtime-workspace\cache\nsis-smoke-install-20260421-043522`
  - bundled sidecar `/health -> status=ok`
  - external workspace root at `runtime-workspace\cache\nsis-smoke-workspace-20260421-043522`
  - uninstall cleanup with `remaining_install_files: []`

## Generated Artifacts

- `apps/desktop/src-tauri/target/release/bundle/msi/Gongmu_0.1.0_x64_en-US.msi`
- `apps/desktop/src-tauri/target/release/bundle/nsis/Gongmu_0.1.0_x64-setup.exe`

Observed file metadata during validation:

- MSI size: `2,805,760` bytes
- NSIS size: `1,857,090` bytes

## Extraction Targets

- MSI admin extract:
  - `runtime-workspace/cache/windows-installer-check/msi-admin-20260420-231815/PFiles/Gongmu/gongmu-desktop.exe`
- NSIS silent install:
  - `runtime-workspace/cache/windows-installer-check/nsis-install-20260420-231815/gongmu-desktop.exe`
  - `runtime-workspace/cache/windows-installer-check/nsis-install-20260420-231815/uninstall.exe`

## Notes

- This validation stayed inside workspace-local paths and did not rely on a full interactive installer flow.
- The root `scripts/portable-run.mjs` was updated in the same session so Windows can resolve Python 3.11 reliably even when `.venv\Scripts\python.exe` exists but has a stale launcher target.

## Remaining Follow-Up

- PyInstaller one-folder sidecar validation is closed by `docs/operations/2026-04-21-windows-sidecar-packaging-validation.md`.
- Use `npm run desktop:verify:windows:fast` for repeat smoke validation after installer-affecting changes.
- Use `npm run desktop:verify:windows` when a fresh bundle rebuild is part of the validation scope.
- Optionally run a full interactive install/uninstall pass on a clean Windows account or VM.
