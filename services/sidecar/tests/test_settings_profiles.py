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
    assert payload["defaults"]["graphrag_vector_backend"] == "sqlite"
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
    # SEC-1: 응답에는 원문 키 대신 존재 플래그만. 그리고 internal 저장이 openrouter 키를
    # 지우지 않았음을(병합 보존) 저장 파일로 확인한다.
    openrouter = payload["defaults"]["profiles"]["external_model"]["providers"]["openrouter"]
    assert openrouter["api_key"] is None
    assert openrouter["api_key_set"] is True
    assert "sk-or-test" in (tmp_path / "settings.json").read_text(encoding="utf-8")
    assert (
        payload["defaults"]["profiles"]["external_model"]["providers"]["openrouter"]["site_url"]
        == "https://gongmu.example"
    )


# ---------------------------------------------------------------------------
# 보안(SEC-1): 로컬 API 가 인증 없이 열려 있으므로 응답에 원문 API 키가 실리면
# 임의 웹페이지·로컬 프로세스가 키를 훔칠 수 있다. 아래 테스트가 그 계약을 고정한다.
# ---------------------------------------------------------------------------


def _seed_external_key(tmp_path: Path, key: str = "sk-secret-featherless-123") -> None:
    """external_model/featherless 슬롯에 실제 키가 저장된 상태를 만든다."""
    client = _client(tmp_path)
    resp = client.put(
        "/api/settings",
        json={"llm_mode": "external_model", "llm_provider": "featherless", "llm_api_key": key},
    )
    assert resp.status_code == 200


def test_get_settings_never_returns_raw_api_key(tmp_path: Path) -> None:
    _seed_external_key(tmp_path)
    client = _client(tmp_path)

    payload = client.get("/api/settings").json()
    defaults = payload["defaults"]

    # 원문 키는 절대 나오지 않고, 존재 여부만 플래그로 알린다.
    assert defaults["llm_api_key"] is None
    assert defaults["llm_api_key_set"] is True
    # 프로필 어느 슬롯에도 원문 키가 없어야 한다.
    fx = defaults["profiles"]["external_model"]["providers"]["featherless"]
    assert fx["api_key"] is None
    assert fx["api_key_set"] is True
    # 응답 전체 직렬화 어디에도 원문 키 문자열이 없어야 한다.
    assert "sk-secret-featherless-123" not in str(payload)


def test_saving_other_settings_keeps_existing_api_key(tmp_path: Path) -> None:
    """마스킹 왕복 사고 방지 — 키를 건드리지 않은 저장이 키를 지우면 안 된다."""
    _seed_external_key(tmp_path)
    client = _client(tmp_path)

    # 프론트가 하듯: GET 으로 받은(키가 마스킹된) 프로필을 그대로 되돌려 저장한다.
    masked = client.get("/api/settings").json()["defaults"]["profiles"]
    resp = client.put(
        "/api/settings",
        json={"llm_mode": "external_model", "llm_provider": "featherless",
              "llm_api_key": None, "llm_profiles": masked},
    )
    assert resp.status_code == 200

    # 저장 파일에 원문 키가 그대로 살아 있어야 한다(증발 금지).
    saved = (tmp_path / "settings.json").read_text(encoding="utf-8")
    assert "sk-secret-featherless-123" in saved


def test_updating_api_key_with_new_value_replaces_it(tmp_path: Path) -> None:
    _seed_external_key(tmp_path, "sk-old-000")
    client = _client(tmp_path)

    resp = client.put(
        "/api/settings",
        json={"llm_mode": "external_model", "llm_provider": "featherless",
              "llm_api_key": "sk-new-999"},
    )
    assert resp.status_code == 200

    saved = (tmp_path / "settings.json").read_text(encoding="utf-8")
    assert "sk-new-999" in saved
    assert "sk-old-000" not in saved


def test_settings_json_has_no_derived_flag(tmp_path: Path) -> None:
    """파생 플래그(api_key_set)가 저장 파일을 오염시키지 않아야 한다."""
    _seed_external_key(tmp_path)
    saved = (tmp_path / "settings.json").read_text(encoding="utf-8")
    assert "api_key_set" not in saved


def test_cors_allows_webview_origin_only(tmp_path: Path) -> None:
    """SEC-2: 웹뷰 origin 만 브라우저에서 응답을 읽을 수 있어야 한다."""
    client = _client(tmp_path)

    ok = client.get("/api/settings", headers={"Origin": "http://tauri.localhost"})
    assert ok.headers.get("access-control-allow-origin") == "http://tauri.localhost"

    evil = client.get("/api/settings", headers={"Origin": "https://evil.example"})
    # 악성 origin 에는 허용 헤더를 돌려주지 않는다 → 브라우저가 응답 읽기를 막는다.
    assert evil.headers.get("access-control-allow-origin") != "https://evil.example"


def test_cors_origins_overridable_via_env(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("GONGMU_ALLOWED_ORIGINS", "http://127.0.0.1:9999")
    client = _client(tmp_path)

    ok = client.get("/api/settings", headers={"Origin": "http://127.0.0.1:9999"})
    assert ok.headers.get("access-control-allow-origin") == "http://127.0.0.1:9999"

    tauri = client.get("/api/settings", headers={"Origin": "http://tauri.localhost"})
    assert tauri.headers.get("access-control-allow-origin") != "http://tauri.localhost"
