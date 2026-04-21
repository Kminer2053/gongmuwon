# Windows Desktop Sidecar Integration Validation - 2026-04-21

## Scope

Validated the Windows desktop bundle flow after adding the packaged Python sidecar as a Tauri bundle resource.

- Workspace: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex`
- Desktop app: `Gongmu 0.1.0`
- Sidecar bundle: `release/sidecar/windows-x64/gongmu-sidecar/`

## Commands Run

```powershell
node scripts/sync-sidecar-bundle.mjs
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
npm.cmd run desktop:test
npm.cmd run desktop:bundle
npm.cmd run desktop:smoke:msi
npm.cmd run desktop:smoke:nsis
```

## Confirmed Results

- `sync-sidecar-bundle`: PASS
- `cargo check`: PASS
- `desktop:test`: PASS (`10 passed`)
- `desktop:bundle`: PASS
- `desktop:smoke:msi`: PASS
- `desktop:smoke:nsis`: PASS
- NSIS installer payload contains the bundled sidecar tree under:
  - `resources\sidecar\windows-x64\gongmu-sidecar\`
- The NSIS-installed sidecar executable was launched directly and returned:
  - `/health -> status=ok`
- A custom WiX per-user fallback also produced a runnable MSI installer.
- The fallback-installed sidecar executable returned:
  - `/health -> status=ok`

## MSI Investigation Notes

- Generated WiX source at `apps/desktop/src-tauri/target/release/wix/x64/main.wxs` explicitly includes:
  - `resources/sidecar/windows-x64/gongmu-sidecar/gongmu-sidecar.exe`
  - the `_internal/` runtime tree produced by PyInstaller
- Workspace-local MSI administrative extraction only surfaced `gongmu-desktop.exe`.
- Recursive file search against the admin extract did not find `gongmu-sidecar.exe`.
- A silent MSI install into a workspace-local directory failed with `1603`.
- Verbose MSI logging showed the direct cause at `InstallFinalize`:
  - `Error 1925`: the generated MSI is currently `InstallScope="perMachine"` and requires administrator privileges.
- A follow-up per-user install attempt (`ALLUSERS="" MSIINSTALLPERUSER=1`) cleared the privilege issue but still failed with:
  - `Error 1320`: path too long
- The MSI log also showed that `AppSearch` rewrote `INSTALLDIR` from the command line to the existing NSIS registry value at:
  - `HKCU\Software\gongmu\Gongmu\(Default)`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\desktop-sidecar-integration\nsis-install-20260421-122639`
- A custom WiX template at `apps/desktop/src-tauri/windows/main.wxs` moved MSI installation to:
  - `InstallScope="perUser"`
  - `LocalAppDataFolder`
  - named `InstallDir` registry search only
- Tauri's built-in WiX link step still failed on validation because the generated per-user resource tree triggered:
  - `ICE38`
  - `ICE64`
  - `ICE90`
  - `ICE91`
- Manually linking the generated `main.wixobj` with `light.exe` and suppressing those ICE checks produced a working MSI.
- The manual MSI installed successfully into:
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\manual-msi-install-20260421-130803`
- The installed desktop tree included:
  - `gongmu-desktop.exe`
  - `resources\sidecar\windows-x64\gongmu-sidecar\gongmu-sidecar.exe`
- The installed sidecar smoke test returned:
  - `http://127.0.0.1:8765/health -> {"status":"ok", ...}`
- `scripts/windows-msi-fallback-smoke.mjs` now automates:
  - MSI install into a workspace-local cache path
  - bundled sidecar health check with an external workspace root
  - MSI uninstall
  - post-uninstall leftover file scan
- The automated smoke run completed with:
  - install dir: `runtime-workspace\cache\msi-smoke-install-20260421-042659`
  - workspace root: `runtime-workspace\cache\msi-smoke-workspace-20260421-042659`
  - `/health -> status=ok`
  - `remaining_install_files: []`
- `scripts/windows-nsis-smoke.mjs` now automates:
  - NSIS silent install into a workspace-local cache path
  - bundled sidecar health check with an external workspace root
  - NSIS silent uninstall
  - post-uninstall leftover file scan after delayed self-cleanup
- The automated NSIS smoke run completed with:
  - install dir: `runtime-workspace\cache\nsis-smoke-install-20260421-043522`
  - workspace root: `runtime-workspace\cache\nsis-smoke-workspace-20260421-043522`
  - `/health -> status=ok`
  - `remaining_install_files: []`

## Current Assessment

- NSIS integration is directly verified and runnable.
- MSI inclusion is directly verified by successful manual per-user installation and sidecar execution.
- NSIS inclusion and uninstall cleanup are directly verified by the automated smoke loop.
- MSI administrative extraction is not a reliable proof method for the embedded sidecar payload in this project.
- The remaining blocker is not installer functionality but Tauri's default WiX validation policy for the per-user resource tree.
- `scripts/tauri-build-with-wix-fallback.mjs` now treats the built-in WiX failure as recoverable and finishes MSI linking with the validated suppression set.
- `scripts/windows-msi-fallback-smoke.mjs` gives the Windows main dev loop a repeatable MSI install/uninstall proof without needing an interactive installer session.
- `scripts/windows-nsis-smoke.mjs` gives the Windows main dev loop the same repeatable proof for the primary NSIS path.

## Recommended Follow-Up

- Treat NSIS smoke validation as the primary executable proof for the bundled sidecar.
- Keep the custom per-user WiX template and fallback linker path in place for the Windows main dev loop.
- Use `npm run desktop:smoke:msi` after MSI-affecting changes when installer cleanup behavior matters.
- Use `npm run desktop:smoke:nsis` after NSIS-affecting changes or when validating the primary Windows delivery path.
- If MSI policy hardening is required later, revisit whether the generated resource tree can be made WiX-ICE-clean without suppressions.
- Continue using full MSI install-and-run validation instead of administrative extraction when sidecar payload proof is needed.
