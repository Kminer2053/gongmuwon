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
    assert payload["defaults"]["llm_provider"] == "ollama"
    assert payload["defaults"]["llm_model"] == "qwen3.6:27b"
    assert payload["defaults"]["llm_site_url"] is None
    assert payload["defaults"]["llm_application_name"] is None
    assert payload["defaults"]["default_template_key"] == "report"
    assert payload["defaults"]["internal_api_base_url"] is None
    assert payload["paths"]["workspace_root"] == str(tmp_path)


def test_settings_endpoint_honors_env_overrides(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("GONGMU_LLM_MODE", "internal_server")
    monkeypatch.setenv("GONGMU_LLM_PROVIDER", "openai")
    monkeypatch.setenv("GONGMU_LLM_MODEL", "gpt-4.1")
    monkeypatch.setenv("GONGMU_DEFAULT_TEMPLATE_KEY", "review")
    monkeypatch.setenv("GONGMU_INTERNAL_API_BASE_URL", "http://internal.example")

    app = create_app(tmp_path)
    client = app.state.test_client_factory()

    response = client.get("/api/settings")

    assert response.status_code == 200
    payload = response.json()
    assert payload["defaults"]["llm_mode"] == "internal_server"
    assert payload["defaults"]["llm_provider"] == "openai"
    assert payload["defaults"]["llm_model"] == "gpt-4.1"
    assert payload["defaults"]["llm_site_url"] is None
    assert payload["defaults"]["llm_application_name"] is None
    assert payload["defaults"]["default_template_key"] == "review"
    assert payload["defaults"]["internal_api_base_url"] == "http://internal.example"


def test_tools_manifest_endpoint_is_exposed(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    client = app.state.test_client_factory()

    response = client.get("/api/tools")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["key"] == "ocr"
    assert payload["items"][0]["status"] in {"mvp", "later"}


def test_settings_can_be_updated_and_persisted(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    client = app.state.test_client_factory()

    update_response = client.put(
        "/api/settings",
        json={
            "llm_mode": "internal_server",
            "llm_provider": "openai",
            "llm_model": "gpt-4.1",
            "llm_site_url": "https://gongmu.example",
            "llm_application_name": "Gongmu Workspace",
            "default_template_key": "meeting",
            "internal_api_base_url": "http://127.0.0.1:9100",
        },
    )

    assert update_response.status_code == 200
    payload = update_response.json()
    assert payload["defaults"]["llm_mode"] == "internal_server"
    assert payload["defaults"]["llm_provider"] == "openai"
    assert payload["defaults"]["llm_model"] == "gpt-4.1"
    assert payload["defaults"]["llm_site_url"] == "https://gongmu.example"
    assert payload["defaults"]["llm_application_name"] == "Gongmu Workspace"
    assert payload["defaults"]["default_template_key"] == "meeting"
    assert payload["defaults"]["internal_api_base_url"] == "http://127.0.0.1:9100"
    assert (tmp_path / "settings.json").exists()

    reloaded_app = create_app(tmp_path)
    reloaded_client = reloaded_app.state.test_client_factory()
    response = reloaded_client.get("/api/settings")

    assert response.status_code == 200
    reloaded_payload = response.json()
    assert reloaded_payload["defaults"]["llm_mode"] == "internal_server"
    assert reloaded_payload["defaults"]["llm_provider"] == "openai"
    assert reloaded_payload["defaults"]["llm_model"] == "gpt-4.1"
    assert reloaded_payload["defaults"]["llm_site_url"] == "https://gongmu.example"
    assert reloaded_payload["defaults"]["llm_application_name"] == "Gongmu Workspace"
    assert reloaded_payload["defaults"]["default_template_key"] == "meeting"
    assert reloaded_payload["defaults"]["internal_api_base_url"] == "http://127.0.0.1:9100"


def test_cors_preflight_allows_desktop_origin(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    client = app.state.test_client_factory()

    response = client.options(
        "/api/settings",
        headers={
            "Origin": "tauri://localhost",
            "Access-Control-Request-Method": "GET",
        },
    )

    # SEC-2: 와일드카드(*) 대신 Tauri 웹뷰 origin 을 명시적으로 허용한다.
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "tauri://localhost"

    # 임의 웹 origin 은 허용되지 않아야 한다.
    evil = client.options(
        "/api/settings",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert evil.headers.get("access-control-allow-origin") != "https://evil.example"
