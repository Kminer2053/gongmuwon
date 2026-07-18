"""SEC-4b: API 키 OS 자격증명 저장소 이전. 실제 Credential Manager 를 건드리지 않도록
가짜 keyring 으로 검증한다."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from gongmu_sidecar import secrets_vault
from gongmu_sidecar.secrets_vault import VAULT_SENTINEL
from gongmu_sidecar.settings import SidecarSettings


class _FakeKeyring:
    def __init__(self) -> None:
        self.store: dict[tuple[str, str], str] = {}
        self.fail_verify = False

    def set_password(self, service: str, slot: str, value: str) -> None:
        if not self.fail_verify:
            self.store[(service, slot)] = value

    def get_password(self, service: str, slot: str):
        return self.store.get((service, slot))

    def delete_password(self, service: str, slot: str) -> None:
        self.store.pop((service, slot), None)


@pytest.fixture
def fake_vault(monkeypatch):
    fake = _FakeKeyring()
    monkeypatch.setattr(secrets_vault, "_keyring", lambda: fake)
    return fake


def _write_external_key(tmp_path: Path, key: str) -> Path:
    cfg = tmp_path / "settings.json"
    settings = SidecarSettings.load(cfg)
    from gongmu_sidecar.settings import WorkspaceSettingsUpdate

    updated = settings.apply_update(
        WorkspaceSettingsUpdate(llm_mode="external_model", llm_provider="featherless", llm_api_key=key)
    )
    updated.persist(cfg)
    return cfg


def test_key_moved_to_vault_not_plaintext(tmp_path: Path, fake_vault) -> None:
    cfg = _write_external_key(tmp_path, "sk-secret-abc")

    on_disk = cfg.read_text(encoding="utf-8")
    # 파일에 원문 키가 없어야 하고, 표식이 있어야 한다.
    assert "sk-secret-abc" not in on_disk
    assert VAULT_SENTINEL in on_disk
    # 실제 키는 vault(가짜)에 있어야 한다.
    assert "sk-secret-abc" in fake_vault.store.values()


def test_key_restored_from_vault_on_load(tmp_path: Path, fake_vault) -> None:
    cfg = _write_external_key(tmp_path, "sk-secret-abc")

    reloaded = SidecarSettings.load(cfg)
    # featherless 프로필 키가 vault 에서 복원돼야 한다.
    fx = reloaded.llm_profiles.external_model.providers["featherless"]
    assert fx.api_key == "sk-secret-abc"


def test_plaintext_fallback_when_vault_unavailable(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(secrets_vault, "_keyring", lambda: None)
    cfg = _write_external_key(tmp_path, "sk-plain-xyz")

    on_disk = cfg.read_text(encoding="utf-8")
    # vault 를 못 쓰면 평문으로 저장(앱은 안 깨짐), 로드도 정상.
    assert "sk-plain-xyz" in on_disk
    reloaded = SidecarSettings.load(cfg)
    assert reloaded.llm_profiles.external_model.providers["featherless"].api_key == "sk-plain-xyz"


def test_lazy_migration_of_existing_plaintext(tmp_path: Path, fake_vault) -> None:
    """기존 평문 settings.json → load 는 평문을 읽고(작동), 다음 persist 가 vault 로 옮긴다."""
    cfg = tmp_path / "settings.json"
    cfg.write_text(
        json.dumps({
            "llm_mode": "external_model",
            "llm_provider": "featherless",
            "llm_profiles": {
                "external_model": {
                    "active_provider": "featherless",
                    "providers": {"featherless": {"provider": "featherless", "model": "m", "api_key": "sk-legacy-999"}},
                }
            },
        }),
        encoding="utf-8",
    )
    # load: 평문을 그대로 읽어 작동(키 손실 없음)
    loaded = SidecarSettings.load(cfg)
    assert loaded.llm_profiles.external_model.providers["featherless"].api_key == "sk-legacy-999"
    # 다음 저장에서 vault 로 이동
    loaded.persist(cfg)
    assert "sk-legacy-999" not in cfg.read_text(encoding="utf-8")
    assert "sk-legacy-999" in fake_vault.store.values()


def test_key_stays_plaintext_if_vault_write_unverifiable(tmp_path: Path, fake_vault) -> None:
    """vault 기록 후 재확인 실패 시 표식으로 바꾸지 않고 평문 유지(안전장치)."""
    fake_vault.fail_verify = True  # set_password 가 저장을 안 해서 get 이 불일치
    cfg = _write_external_key(tmp_path, "sk-verify-fail")

    on_disk = cfg.read_text(encoding="utf-8")
    assert "sk-verify-fail" in on_disk  # 평문 유지 — 표식으로 안 바뀜
