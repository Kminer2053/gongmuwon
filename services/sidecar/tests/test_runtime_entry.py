from pathlib import Path

from gongmu_sidecar.server import resolve_server_options
from gongmu_sidecar.workspace import resolve_workspace_root


def test_resolve_workspace_root_uses_executable_dir_when_frozen(
    monkeypatch, tmp_path: Path
) -> None:
    fake_executable = tmp_path / "gongmu-sidecar.exe"
    fake_executable.write_text("stub", encoding="utf-8")

    monkeypatch.setattr("gongmu_sidecar.workspace.sys.frozen", True, raising=False)
    monkeypatch.setattr(
        "gongmu_sidecar.workspace.sys.executable",
        str(fake_executable),
        raising=False,
    )

    workspace_root = resolve_workspace_root(None)

    assert workspace_root == (tmp_path / "runtime-workspace").resolve()


def test_resolve_server_options_honors_env_overrides(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GONGMU_SIDECAR_HOST", "0.0.0.0")
    monkeypatch.setenv("GONGMU_SIDECAR_PORT", "9876")
    monkeypatch.setenv("GONGMU_WORKSPACE_ROOT", str(tmp_path))

    options = resolve_server_options()

    assert options.host == "0.0.0.0"
    assert options.port == 9876
    assert options.workspace_root == tmp_path.resolve()
