# 로컬 AI에이전트 워크플레이스 : 공무원 Alpha Release Staging

- generated_at: 2026-04-25T16:46:21.448Z
- product: 로컬 AI에이전트 워크플레이스 : 공무원 0.1.0
- internal_codename: Gongmu
- desktop_bundle_ready: yes
- sidecar_bundle_ready: yes
- desktop_bundle_targets: msi, nsis

## Included Documents
- sidecar-README.md
- 2026-04-20-gongmu-mvp-checkpoint-board.md
- 2026-04-20-alpha-offline-packaging-runbook.md
- 2026-04-20-sidecar-packaging-strategy.md
- 2026-04-20-windows-install-validation.md
- 2026-04-20-windows-remote-validation-checklist.md
- 2026-04-21-windows-sidecar-packaging-validation.md
- 2026-04-21-windows-desktop-sidecar-integration-validation.md
- 2026-04-22-windows-interactive-install-validation.md
- 2026-04-23-anything-external-integration-validation.md
- 2026-04-23-functional-validation-results.md
- 2026-04-25-llm-chat-integration-validation.md

## Commands
- verify_all: npm run verify:all
- desktop_bundle: npm run desktop:bundle
- desktop_bundle_debug: npm run desktop:bundle:debug
- desktop_smoke_msi: npm run desktop:smoke:msi
- desktop_smoke_nsis: npm run desktop:smoke:nsis
- desktop_prepare_anything: npm run desktop:prepare:anything
- sidecar_bundle_windows: npm run sidecar:bundle:windows

## Bundle Paths
- desktop: apps\desktop\src-tauri\target\release\bundle
- sidecar: release\sidecar\windows-x64\gongmu-sidecar

## Next Checks
- Run npm run verify:all before final release sign-off.
- Run npm run desktop:bundle when installer artifacts need to be refreshed.
- Run npm run desktop:prepare:gui before a human GUI install pass on Windows.
- Run npm run desktop:prepare:anything before Anything external-integration checks.
- Run npm run desktop:smoke:msi after MSI-affecting changes on Windows.
- Run npm run desktop:smoke:nsis after NSIS-affecting changes on Windows.
- Confirm NSIS installer smoke test with bundled sidecar on the target Windows host.
- Use the Windows remote validation checklist for the manual GUI lane and close the desktop app before uninstall.
- Use MSI install-and-uninstall smoke checks instead of administrative extraction when payload proof is needed.
- Review the latest Anything-to-Documents handoff evidence in the checkpoint board.
- Review the Anything external integration validation note before release sign-off.
- Review the latest functional validation results before changing IA or workflow behavior.
