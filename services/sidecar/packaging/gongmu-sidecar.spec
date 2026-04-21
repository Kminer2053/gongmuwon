# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


REPO_ROOT = Path.cwd().resolve()
SRC_ROOT = REPO_ROOT / "services" / "sidecar" / "src"
DIST_ROOT = REPO_ROOT / "release" / "sidecar" / "windows-x64"
WORK_ROOT = REPO_ROOT / "runtime-workspace" / "cache" / "pyinstaller"

hiddenimports = sorted(
    set(
        collect_submodules("uvicorn")
        + collect_submodules("lancedb")
        + collect_submodules("pyarrow")
    )
)

datas = collect_data_files("lancedb") + collect_data_files("pyarrow")

a = Analysis(
    [str(SRC_ROOT / "gongmu_sidecar" / "__main__.py")],
    pathex=[str(REPO_ROOT), str(SRC_ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="gongmu-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="gongmu-sidecar",
)
