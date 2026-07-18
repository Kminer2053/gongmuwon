"""SEC-4b: API 키를 평문 settings.json 대신 OS 자격증명 저장소(Windows Credential
Manager)에 보관한다.

설계 원칙(안전 최우선):
- keyring 을 못 쓰면(백엔드 없음·번들 누락 등) **평문 동작으로 조용히 폴백**한다.
  보안 이득은 잃지만 앱은 절대 깨지지 않는다.
- 저장(persist) 시에만 키를 vault 로 옮기고 파일에는 표식만 남긴다. 불러오기(load)는
  파일을 재작성하지 않는다 — 마이그레이션은 다음 저장에서 자연스럽게 일어난다(키 손실 위험 0).
- vault 에 쓴 직후 읽어 확인되지 않으면 표식으로 바꾸지 않고 평문을 유지한다.
"""

from __future__ import annotations

import logging
import os

_SERVICE = "kr.gongmu.workspace"
# settings.json 에 실제 키 대신 남기는 표식. 이 값이면 진짜 키는 OS vault 에 있다.
VAULT_SENTINEL = "__gongmu_vault__"

_log = logging.getLogger("gongmu.vault")

# vault 로 옮길 키 슬롯 — (설정 dict 경로, 슬롯 id) 매핑을 walker 가 사용한다.
_ACTIVE_SLOT = "llm:_active"


def _keyring():
    """사용 가능한 keyring 모듈을 돌려준다(Windows 백엔드 확인). 불가하면 None."""
    # 킬스위치: 테스트·특수 배포에서 vault 를 끄고 평문으로 동작하게 한다.
    if os.environ.get("GONGMU_DISABLE_VAULT"):
        return None
    try:
        import keyring
        from keyring.backends import Windows

        if not Windows.WinVaultKeyring.viable:
            return None
        return keyring
    except Exception as exc:  # pragma: no cover - 환경 의존
        _log.warning("자격증명 저장소를 쓸 수 없어 평문으로 폴백합니다: %s", exc)
        return None


def vault_available() -> bool:
    return _keyring() is not None


def store_secret(slot: str, value: str) -> bool:
    """vault 에 저장하고, 즉시 읽어 확인되면 True. 실패하면 False(평문 유지 신호)."""
    keyring = _keyring()
    if keyring is None:
        return False
    try:
        keyring.set_password(_SERVICE, slot, value)
        return keyring.get_password(_SERVICE, slot) == value
    except Exception as exc:  # pragma: no cover - 환경 의존
        _log.warning("자격증명 저장 실패(%s): %s", slot, exc)
        return False


def load_secret(slot: str) -> str | None:
    keyring = _keyring()
    if keyring is None:
        return None
    try:
        return keyring.get_password(_SERVICE, slot)
    except Exception:  # pragma: no cover - 환경 의존
        return None


def _profile_slots(profiles: dict) -> list[tuple[dict, str]]:
    """설정 dict 안에서 api_key 를 지닌 모든 (프로필dict, 슬롯id) 목록."""
    out: list[tuple[dict, str]] = []
    if not isinstance(profiles, dict):
        return out
    for name in ("local_first", "internal_server"):
        slot = profiles.get(name)
        if isinstance(slot, dict):
            out.append((slot, f"llm:{name}"))
    providers = profiles.get("external_model", {})
    providers = providers.get("providers", {}) if isinstance(providers, dict) else {}
    if isinstance(providers, dict):
        for provider_key, prof in providers.items():
            if isinstance(prof, dict):
                out.append((prof, f"llm:external:{provider_key}"))
    return out


def vaultize_settings(data: dict) -> dict:
    """저장 직전: 실제 키를 vault 로 옮기고 파일에는 표식을 남긴다.

    vault 를 못 쓰면 data 를 그대로 둔다(평문). 특정 키만 저장 실패해도 그 키는 평문 유지.
    """
    if not vault_available():
        return data

    def move(container: dict, json_key: str, slot: str) -> None:
        value = container.get(json_key)
        if isinstance(value, str) and value and value != VAULT_SENTINEL:
            if store_secret(slot, value):
                container[json_key] = VAULT_SENTINEL

    move(data, "llm_api_key", _ACTIVE_SLOT)
    for prof, slot in _profile_slots(data.get("llm_profiles", {})):
        move(prof, "api_key", slot)
    return data


def devaultize_settings(data: dict) -> dict:
    """불러오기 직후: 표식이면 vault 에서 실제 키를 복원한다.

    표식이 아닌 평문 키는 건드리지 않는다(다음 저장에서 vault 로 이동 = 지연 마이그레이션).
    파일을 재작성하지 않으므로 키 손실 위험이 없다.
    """
    def restore(container: dict, json_key: str, slot: str) -> None:
        if container.get(json_key) == VAULT_SENTINEL:
            container[json_key] = load_secret(slot)

    restore(data, "llm_api_key", _ACTIVE_SLOT)
    for prof, slot in _profile_slots(data.get("llm_profiles", {})):
        restore(prof, "api_key", slot)
    return data
