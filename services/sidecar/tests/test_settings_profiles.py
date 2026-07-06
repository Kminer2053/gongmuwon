from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_workspace_settings_include_personalization_defaults(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.get("/api/settings")

    assert response.status_code == 200
    payload = response.json()
    assert payload["defaults"]["personalization_apply_mode"] == "approval_required"
    assert payload["paths"]["personalization_root"].endswith("personalization")
    assert (tmp_path / "personalization" / "session-summaries").exists()
    assert (tmp_path / "personalization" / "audit-log").exists()
    assert payload["defaults"]["graphrag_vector_backend"] == "chromadb"
    assert payload["defaults"]["knowledge_engine"] == "wiki"


def test_workspace_settings_can_explicitly_select_sqlite_vector_fallback(tmp_path: Path) -> None:
    (tmp_path / "settings.json").write_text(
        '{"graphrag_vector_backend":"sqlite"}',
        encoding="utf-8",
    )

    client = _client(tmp_path)
    response = client.get("/api/settings")

    assert response.status_code == 200
    assert response.json()["defaults"]["graphrag_vector_backend"] == "sqlite"
    assert response.json()["defaults"]["knowledge_engine"] == "wiki"


def test_workspace_settings_can_persist_personalization_options(tmp_path: Path) -> None:
    client = _client(tmp_path)
    custom_root = tmp_path / "custom-personalization"

    update = client.put(
        "/api/settings",
        json={
            "personalization_apply_mode": "auto_apply",
            "personalization_root": str(custom_root),
        },
    )

    assert update.status_code == 200
    payload = update.json()
    assert payload["defaults"]["personalization_apply_mode"] == "auto_apply"
    assert payload["paths"]["personalization_root"] == str(custom_root.resolve())
    assert (custom_root / "work-patterns").exists()
    assert (custom_root / "feedback-signals").exists()


def test_workspace_settings_can_persist_embedding_options(tmp_path: Path) -> None:
    client = _client(tmp_path)

    update = client.put(
        "/api/settings",
        json={
            "embedding_provider": "ollama",
            "embedding_model": "bge-m3",
            "embedding_base_url": "http://127.0.0.1:11434",
            "embedding_fallback_enabled": False,
        },
    )

    assert update.status_code == 200
    payload = update.json()
    assert payload["defaults"]["embedding_provider"] == "ollama"
    assert payload["defaults"]["embedding_model"] == "bge-m3"
    assert payload["defaults"]["embedding_base_url"] == "http://127.0.0.1:11434"
    assert payload["defaults"]["embedding_fallback_enabled"] is False

    reloaded_client = _client(tmp_path)
    response = reloaded_client.get("/api/settings")
    assert response.status_code == 200
    reloaded = response.json()
    assert reloaded["defaults"]["embedding_provider"] == "ollama"
    assert reloaded["defaults"]["embedding_model"] == "bge-m3"
    assert reloaded["defaults"]["embedding_fallback_enabled"] is False


def test_workspace_settings_can_persist_graphrag_vector_backend(tmp_path: Path) -> None:
    client = _client(tmp_path)

    update = client.put(
        "/api/settings",
        json={
            "graphrag_vector_backend": "sqlite",
        },
    )

    assert update.status_code == 200
    payload = update.json()
    assert payload["defaults"]["graphrag_vector_backend"] == "sqlite"

    reloaded_client = _client(tmp_path)
    response = reloaded_client.get("/api/settings")
    assert response.status_code == 200
    assert response.json()["defaults"]["graphrag_vector_backend"] == "sqlite"


def test_workspace_settings_loads_windows_utf8_bom_file(tmp_path: Path) -> None:
    (tmp_path / "settings.json").write_bytes(
        b'\xef\xbb\xbf{"graphrag_vector_backend":"chromadb","embedding_provider":"deterministic"}'
    )

    client = _client(tmp_path)
    response = client.get("/api/settings")

    assert response.status_code == 200
    assert response.json()["defaults"]["graphrag_vector_backend"] == "chromadb"
    assert response.json()["defaults"]["knowledge_engine"] == "wiki"


def test_settings_persist_mode_specific_profiles(tmp_path: Path) -> None:
    client = _client(tmp_path)

    update_external = client.put(
        "/api/settings",
        json={
            "llm_mode": "external_model",
            "llm_provider": "openrouter",
            "llm_model": "openai/gpt-5.5",
            "llm_api_key": "sk-or-test",
            "llm_site_url": "https://gongmu.example",
            "llm_application_name": "Gongmu Workspace",
            "default_template_key": "meeting",
            "internal_api_base_url": "https://openrouter.ai/api/v1",
            "llm_profiles": {
                "local_first": {
                    "provider": "openai_compatible",
                    "model": "local-model",
                    "api_key": None,
                    "base_url": None,
                    "site_url": None,
                    "application_name": None,
                },
                "internal_server": {
                    "provider": "openai_compatible",
                    "model": "internal-model",
                    "api_key": None,
                    "base_url": "http://127.0.0.1:9001/v1",
                    "site_url": None,
                    "application_name": None,
                },
                "external_model": {
                    "active_provider": "openrouter",
                    "providers": {
                        "openrouter": {
                            "provider": "openrouter",
                            "model": "openai/gpt-5.5",
                            "api_key": "sk-or-test",
                            "base_url": "https://openrouter.ai/api/v1",
                            "site_url": "https://gongmu.example",
                            "application_name": "Gongmu Workspace",
                        }
                    },
                },
            },
        },
    )
    assert update_external.status_code == 200

    update_internal = client.put(
        "/api/settings",
        json={
            "llm_mode": "internal_server",
            "llm_provider": "openai_compatible",
            "llm_model": "internal-model-v2",
            "internal_api_base_url": "http://127.0.0.1:9002/v1",
        },
    )
    assert update_internal.status_code == 200

    response = client.get("/api/settings")
    assert response.status_code == 200
    payload = response.json()

    assert payload["defaults"]["llm_mode"] == "internal_server"
    assert payload["defaults"]["llm_model"] == "internal-model-v2"
    assert payload["defaults"]["profiles"]["internal_server"]["base_url"] == "http://127.0.0.1:9002/v1"
    assert payload["defaults"]["profiles"]["external_model"]["active_provider"] == "openrouter"
    assert (
        payload["defaults"]["profiles"]["external_model"]["providers"]["openrouter"]["api_key"]
        == "sk-or-test"
    )
    assert (
        payload["defaults"]["profiles"]["external_model"]["providers"]["openrouter"]["site_url"]
        == "https://gongmu.example"
    )
