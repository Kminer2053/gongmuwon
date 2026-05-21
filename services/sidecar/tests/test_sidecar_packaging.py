from pathlib import Path


def test_pyinstaller_spec_includes_kordoc_runner_resource() -> None:
    spec_path = Path("services/sidecar/packaging/gongmu-sidecar.spec")
    spec_text = spec_path.read_text(encoding="utf-8")

    assert "KORDOC_ROOT" in spec_text
    assert "packaging/kordoc" in spec_text
    assert "kordoc_runner.js" in spec_text


def test_pyinstaller_spec_collects_chromadb_for_offline_vector_search() -> None:
    spec_path = Path("services/sidecar/packaging/gongmu-sidecar.spec")
    spec_text = spec_path.read_text(encoding="utf-8")

    assert 'collect_submodules("chromadb", filter=chromadb_module_filter)' in spec_text
    assert 'collect_data_files("chromadb")' in spec_text
    assert 'collect_submodules("chromadb_rust_bindings")' in spec_text
    assert 'collect_dynamic_libs("chromadb_rust_bindings")' in spec_text


def test_pyinstaller_spec_excludes_unused_chromadb_server_and_tests() -> None:
    spec_path = Path("services/sidecar/packaging/gongmu-sidecar.spec")
    spec_text = spec_path.read_text(encoding="utf-8")

    assert "def chromadb_module_filter" in spec_text
    assert 'not module_name.startswith("chromadb.server")' in spec_text
    assert 'not module_name.startswith("chromadb.test")' in spec_text


def test_sidecar_runtime_pins_chromadb_for_offline_reproducibility() -> None:
    pyproject_path = Path("services/sidecar/pyproject.toml")
    pyproject_text = pyproject_path.read_text(encoding="utf-8")

    assert '"chromadb==1.5.9"' in pyproject_text
