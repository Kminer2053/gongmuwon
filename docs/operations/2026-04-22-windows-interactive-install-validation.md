# Windows Interactive Install Validation - 2026-04-22

## Scope

Captured a fresh Windows install/run/uninstall proof after the `Anything -> Reference Set -> Documents` handoff work was bundled on the Windows main Codex session.

- Date: `2026-04-22`
- Workspace: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex`
- Windows account condition: same logged-in Windows account as the main Codex session
- Validation mode: isolated install path with fresh bundle artifacts

This is not a clean-account GUI click-through capture. The current Codex session cannot reliably drive an interactive NSIS wizard, so this pass uses a same-account isolated NSIS install/uninstall run and records that limitation explicitly.

## Commands Run

```powershell
npm.cmd run sidecar:test
npm.cmd run desktop:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
npm.cmd run desktop:bundle
npm.cmd run desktop:smoke:nsis
```

## Verification Results

- `sidecar:test`: PASS (`17 passed`)
- `desktop:test`: PASS (`13 passed`)
- `cargo check`: PASS
- `desktop:bundle`: PASS
- `desktop:smoke:nsis`: PASS

## Installer Artifact

- NSIS artifact path:
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src-tauri\target\release\bundle\nsis\Gongmu_0.1.0_x64-setup.exe`

## Install And Runtime Evidence

- Isolated install path:
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\nsis-smoke-install-20260422-150154`
- Isolated workspace root used for the installed payload:
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\nsis-smoke-workspace-20260422-150154`
- Installed desktop executable confirmed at:
  - `runtime-workspace\cache\nsis-smoke-install-20260422-150154\gongmu-desktop.exe`
- Installed uninstaller confirmed at:
  - `runtime-workspace\cache\nsis-smoke-install-20260422-150154\uninstall.exe`
- Installed bundled sidecar confirmed at:
  - `runtime-workspace\cache\nsis-smoke-install-20260422-150154\resources\sidecar\windows-x64\gongmu-sidecar\gongmu-sidecar.exe`

## Launch Confirmation Method

The proof path used the bundled sidecar health check from the installed NSIS payload.

- Health endpoint:
  - `http://127.0.0.1:59716/health`
- Returned payload:

```json
{
  "status": "ok",
  "workspace_root": "C:\\Users\\USER\\Agent_Gongmu\\Agent_Gongmu_Codex\\runtime-workspace\\cache\\nsis-smoke-workspace-20260422-150154",
  "database": "C:\\Users\\USER\\Agent_Gongmu\\Agent_Gongmu_Codex\\runtime-workspace\\cache\\nsis-smoke-workspace-20260422-150154\\db\\gongmu.db"
}
```

- Installed sidecar stdout log:
  - `runtime-workspace\cache\nsis-smoke-sidecar-20260422-150154.out.log`
- Installed sidecar stderr log:
  - `runtime-workspace\cache\nsis-smoke-sidecar-20260422-150154.err.log`
- Relevant runtime lines:
  - `Uvicorn running on http://127.0.0.1:59716`
  - `GET /health HTTP/1.1" 200 OK`

## Uninstall Confirmation Method

- Uninstall path used:
  - `runtime-workspace\cache\nsis-smoke-install-20260422-150154\uninstall.exe /S`
- Result:
  - install directory removed successfully
  - `remaining_install_files: []`

## Leftover Files

- Leftover install files after uninstall: none

## Sidecar And Bundled Resource Confirmation

- The installed NSIS tree contained the bundled sidecar under:
  - `resources\sidecar\windows-x64\gongmu-sidecar\`
- The installed sidecar executable responded successfully from the installed tree, proving the desktop bundle carried the packaged Python runtime and resource subtree.

## Limitations And Follow-Up

- This pass does not replace a future clean-account or VM-based GUI click-through install.
- It does close the release hygiene requirement for a fresh, isolated, same-account Windows install/run/uninstall proof on the main development machine.
- Existing MSI proof remains the automated smoke/fallback path documented in:
  - `docs/operations/2026-04-21-windows-desktop-sidecar-integration-validation.md`

## Later Follow-Up From GUI Click-Through

On April 23, 2026, a human GUI pass on the Windows main machine additionally confirmed:

- the installed desktop window became visible
- the bundled sidecar could be started from the installed app and reached the connected state
- the bundled sidecar tree existed under `resources\sidecar\windows-x64\gongmu-sidecar\`

That same GUI pass also observed one minor follow-up:

- uninstall removed `uninstall.exe` but left the install directory behind when the desktop app / bundled sidecar were still running

Current interpretation:

- this is recorded as a known follow-up, not a release blocker for the current batch
- operators should close the desktop app and allow the bundled sidecar to exit before uninstalling in manual GUI validation

## Failure Reproduction Notes

- If this flow fails in a future run, start by re-running:
  - `npm.cmd run desktop:bundle`
  - `npm.cmd run desktop:smoke:nsis`
- If the health check fails, inspect:
  - `runtime-workspace\cache\nsis-smoke-sidecar-*.out.log`
  - `runtime-workspace\cache\nsis-smoke-sidecar-*.err.log`
- If uninstall leaves files behind, compare the remaining tree against the installed `resources\sidecar\windows-x64\gongmu-sidecar\` subtree first.
