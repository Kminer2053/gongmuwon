from pathlib import Path

from gongmu_sidecar.app import create_app


def test_health_bootstraps_runtime_workspace(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    client = app.state.test_client_factory()

    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert (tmp_path / "db" / "gongmu.db").exists()
    assert (tmp_path / "knowledge" / "raw").exists()
    assert (tmp_path / "knowledge" / "structured").exists()
    assert (tmp_path / "documents" / "content-bases").exists()
    assert payload["workspace_root"] == str(tmp_path)


def test_settings_endpoint_exposes_runtime_contract(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    client = app.state.test_client_factory()

    response = client.get("/api/settings")

    assert response.status_code == 200
    payload = response.json()
    assert payload["defaults"]["llm_mode"] == "local_first"
    assert payload["defaults"]["anything_launch_mode"] == "external_link_only"
    assert payload["defaults"]["default_template_key"] == "report"
    assert payload["defaults"]["internal_api_base_url"] is None
    assert payload["paths"]["workspace_root"] == str(tmp_path)


def test_settings_endpoint_honors_env_overrides(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("GONGMU_LLM_MODE", "internal_server")
    monkeypatch.setenv("GONGMU_DEFAULT_TEMPLATE_KEY", "review")
    monkeypatch.setenv("GONGMU_INTERNAL_API_BASE_URL", "http://internal.example")

    app = create_app(tmp_path)
    client = app.state.test_client_factory()

    response = client.get("/api/settings")

    assert response.status_code == 200
    payload = response.json()
    assert payload["defaults"]["llm_mode"] == "internal_server"
    assert payload["defaults"]["default_template_key"] == "review"
    assert payload["defaults"]["internal_api_base_url"] == "http://internal.example"
