from pathlib import Path


def test_pyinstaller_spec_includes_kordoc_runner_resource() -> None:
    spec_path = Path("services/sidecar/packaging/gongmu-sidecar.spec")
    spec_text = spec_path.read_text(encoding="utf-8")

    assert "KORDOC_ROOT" in spec_text
    assert "packaging/kordoc" in spec_text
    assert "kordoc_runner.js" in spec_text


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


def test_sidecar_runtime_pins_chromadb_for_offline_reproducibility() -> None:
    pyproject_path = Path("services/sidecar/pyproject.toml")
    pyproject_text = pyproject_path.read_text(encoding="utf-8")

    assert '"chromadb==1.5.9"' in pyproject_text
