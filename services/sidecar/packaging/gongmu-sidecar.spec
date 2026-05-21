# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules


REPO_ROOT = Path.cwd().resolve()
SRC_ROOT = REPO_ROOT / "services" / "sidecar" / "src"
DIST_ROOT = REPO_ROOT / "release" / "sidecar" / "windows-x64"
WORK_ROOT = REPO_ROOT / "runtime-workspace" / "cache" / "pyinstaller"
KORDOC_ROOT = REPO_ROOT / "services" / "sidecar" / "packaging" / "kordoc"


def chromadb_module_filter(module_name):
    return (
        not module_name.startswith("chromadb.server")
        and not module_name.startswith("chromadb.test")
    )

hiddenimports = sorted(
    set(
        collect_submodules("uvicorn")
        + collect_submodules("chromadb", filter=chromadb_module_filter)
        + collect_submodules("chromadb_rust_bindings")
        + collect_submodules("lancedb")
        + collect_submodules("pyarrow")
    )
)

datas = (
    collect_data_files("chromadb")
    + collect_data_files("lancedb")
    + collect_data_files("pyarrow")
)

binaries = collect_dynamic_libs("chromadb_rust_bindings")
if (KORDOC_ROOT / "kordoc_runner.js").exists():
    datas += [(str(KORDOC_ROOT), "packaging/kordoc")]

a = Analysis(
    [str(SRC_ROOT / "gongmu_sidecar" / "__main__.py")],
    pathex=[str(REPO_ROOT), str(SRC_ROOT)],
    binaries=binaries,
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
