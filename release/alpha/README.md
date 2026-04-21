# Gongmu Alpha Release Staging

- generated_at: 2026-04-21T04:48:28.392Z
- product: Gongmu 0.1.0
- desktop_bundle_ready: yes
- sidecar_bundle_ready: yes
- desktop_bundle_targets: msi, nsis

## Included Documents
- README.md
- 2026-04-20-alpha-offline-packaging-runbook.md
- 2026-04-20-sidecar-packaging-strategy.md
- 2026-04-20-windows-install-validation.md
- 2026-04-21-windows-sidecar-packaging-validation.md
- 2026-04-21-windows-desktop-sidecar-integration-validation.md

## Commands
- verify_all: npm run verify:all
- desktop_bundle: npm run desktop:bundle
- desktop_bundle_debug: npm run desktop:bundle:debug
- desktop_smoke_msi: npm run desktop:smoke:msi
- desktop_smoke_nsis: npm run desktop:smoke:nsis
- sidecar_bundle_windows: npm run sidecar:bundle:windows

## Bundle Paths
- desktop: apps\desktop\src-tauri\target\release\bundle
- sidecar: release\sidecar\windows-x64\gongmu-sidecar

## Next Checks
- Run npm run verify:all before final release sign-off.
- Run npm run desktop:bundle when installer artifacts need to be refreshed.
- Run npm run desktop:smoke:msi after MSI-affecting changes on Windows.
- Run npm run desktop:smoke:nsis after NSIS-affecting changes on Windows.
- Confirm NSIS installer smoke test with bundled sidecar on the target Windows host.
- Use MSI install-and-uninstall smoke checks instead of administrative extraction when payload proof is needed.
