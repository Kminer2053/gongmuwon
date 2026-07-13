from pathlib import Path


def test_pyinstaller_spec_includes_kordoc_runner_resource() -> None:
    spec_path = Path("services/sidecar/packaging/gongmu-sidecar.spec")
    spec_text = spec_path.read_text(encoding="utf-8")

    assert "packaging/kordoc" in spec_text
    assert "kordoc_runner.js" in spec_text
    # 자립 번들 스테이징 강제: 소스 러너는 repo node_modules에 의존하므로 그대로
    # 담으면 설치본에서 HWP 전량이 무증상 폴백된다 (2026-07-13 수용 테스트 사고).
    assert "kordoc-bundle" in spec_text
    assert "bundle-kordoc-runner.mjs" in spec_text
    assert "raise SystemExit" in spec_text


def test_bundle_kordoc_runner_script_exists_and_is_chained() -> None:
    """번들 스크립트가 존재하고 sidecar 빌드에 선행 연결되어 있는지 확인."""
    assert Path("scripts/bundle-kordoc-runner.mjs").exists()
    import json

    package = json.loads(Path("package.json").read_text(encoding="utf-8"))
    bundle_script = package["scripts"]["sidecar:bundle:windows"]
    assert "bundle-kordoc-runner.mjs" in bundle_script.split("&&")[0]


def test_pyinstaller_spec_includes_topic_vocab_assets() -> None:
    """L1 내장 통제어휘 자산 번들 회귀 방지.

    2026-07-13 수용 테스트: assets/ 미등록으로 설치본의 vocab common=0 —
    통제어휘 기반 주제 태깅 전체가 조용히 비활성화되는 치명 결함이었다.
    """
    spec_path = Path("services/sidecar/packaging/gongmu-sidecar.spec")
    spec_text = spec_path.read_text(encoding="utf-8")

    assert "gongmu_sidecar/assets" in spec_text
    # 자산 파일 자체도 리포에 존재해야 한다 (spec은 exists() 가드라 파일이
    # 사라지면 조용히 빠진다).
    assert Path("services/sidecar/src/gongmu_sidecar/assets/topic_vocab_common.json").exists()


def test_pyinstaller_spec_excludes_legacy_vector_backends() -> None:
    """M-07: GraphRAG 시대 벡터 백엔드는 라이브 임포트 체인에서 제거됨.

    강제 수집이 되살아나면 번들이 수십 MB 비대해지고, 스테일 numpy DLL
    실패(2026-07-05 설치 스모크 사고)의 취약면이 다시 열린다.
    """
    spec_path = Path("services/sidecar/packaging/gongmu-sidecar.spec")
    spec_text = spec_path.read_text(encoding="utf-8")

    for legacy in ("chromadb", "lancedb", "pyarrow"):
        assert f'collect_submodules("{legacy}"' not in spec_text
        assert f'collect_data_files("{legacy}")' not in spec_text
    assert 'collect_dynamic_libs("chromadb_rust_bindings")' not in spec_text
    # 실제 필요한 uvicorn 수집은 유지되어야 한다.
    assert 'collect_submodules("uvicorn")' in spec_text
