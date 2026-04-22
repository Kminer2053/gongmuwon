# Windows Remote Validation Checklist

## Goal

Use this checklist when a human operator needs to perform one real GUI click-through validation pass on a Windows machine after the automated smoke loops are already green.

This checklist is the manual complement to:

- `npm.cmd run desktop:smoke:nsis`
- `npm.cmd run desktop:smoke:msi`
- `npm.cmd run desktop:verify:windows`

## Preconditions

- The repo is up to date on the target Windows machine.
- `npm.cmd run verify:all` has already passed on the current commit.
- `npm.cmd run desktop:bundle` has already produced fresh installer artifacts.

## Preparation

Run:

```powershell
npm.cmd run desktop:prepare:gui
```

Record the printed values:

- `installer_path`
- `suggested_install_dir`
- `suggested_workspace_root`
- `desktop_exe`
- `bundled_sidecar_exe`

## GUI Install Pass

1. Open the installer from `installer_path`.
2. Complete the NSIS wizard with the printed `suggested_install_dir`.
3. Confirm the installed tree contains:
   - `gongmu-desktop.exe`
   - `resources\sidecar\windows-x64\gongmu-sidecar\gongmu-sidecar.exe`
4. Launch the installed desktop app.
5. Confirm the desktop window becomes visible.
6. Confirm the app can reach the bundled sidecar or at minimum does not fail immediately on startup.

## Uninstall Pass

1. Run the installed uninstaller.
2. Confirm the install directory is removed.
3. If files remain, record the exact remaining paths.

## What To Report Back

- Windows version
- commit SHA
- installer path used
- install directory used
- whether the desktop window appeared
- whether the bundled sidecar tree existed
- whether uninstall removed the install directory cleanly
- any screenshots or logs

## Fast Notes

- Automated smoke already proves `silent install -> bundled sidecar health -> uninstall cleanup`.
- The value of this checklist is the human-visible GUI proof:
  - installer wizard renders
  - desktop app window appears
  - uninstall behaves normally from a real click-through flow
