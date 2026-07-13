# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules


REPO_ROOT = Path.cwd().resolve()
SRC_ROOT = REPO_ROOT / "services" / "sidecar" / "src"
DIST_ROOT = REPO_ROOT / "release" / "sidecar" / "windows-x64"
WORK_ROOT = REPO_ROOT / "runtime-workspace" / "cache" / "pyinstaller"
KORDOC_ROOT = REPO_ROOT / "services" / "sidecar" / "packaging" / "kordoc"


# M-07: GraphRAG 시대 벡터 백엔드(chromadb/lancedb/pyarrow)는 라이브 임포트 체인에서
# 제거됨 — 강제 수집하지 않는다 (번들 비대 + numpy DLL 취약성의 원인이었음).
hiddenimports = sorted(set(collect_submodules("uvicorn")))

datas = []

binaries = []
# kordoc은 반드시 '자립 번들 스테이징'을 수집한다. 소스 러너(KORDOC_ROOT)는
# repo node_modules에 의존하므로 그대로 담으면 설치본에서 조용히 폴백된다
# (2026-07-13 수용 테스트: HWP 170건 전부 metadata-fallback 사고).
# 스테이징은 scripts/bundle-kordoc-runner.mjs가 생성한다(번들 JS + node.exe).
KORDOC_BUNDLE = REPO_ROOT / "runtime-workspace" / "cache" / "kordoc-bundle"
if not (KORDOC_BUNDLE / "kordoc_runner.js").exists():
    raise SystemExit(
        "kordoc bundle staging is missing. Run `node scripts/bundle-kordoc-runner.mjs` "
        "before PyInstaller (npm run sidecar:bundle:windows does this automatically)."
    )
datas += [(str(KORDOC_BUNDLE), "packaging/kordoc")]
if (SRC_ROOT / "gongmu_sidecar" / "public_doc_templates").exists():
    datas += [
        (
            str(SRC_ROOT / "gongmu_sidecar" / "public_doc_templates"),
            "gongmu_sidecar/public_doc_templates",
        )
    ]
# L1 내장 통제어휘(topic_vocab_common.json) — 누락 시 설치본에서 통제어휘 전체가
# 조용히 비활성화된다(2026-07-13 수용 테스트에서 실제 발생, vocab common=0).
if (SRC_ROOT / "gongmu_sidecar" / "assets").exists():
    datas += [
        (
            str(SRC_ROOT / "gongmu_sidecar" / "assets"),
            "gongmu_sidecar/assets",
        )
    ]

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
