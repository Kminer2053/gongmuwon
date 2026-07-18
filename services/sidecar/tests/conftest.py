"""사이드카 공용 테스트 픽스처.

스캔 위생 P0(설계서 §4.2)의 '최근 수정 파일 UNSTABLE 보류' 창은 운영 기본값이
10초라서, 테스트가 방금 만든 파일이 전부 보류돼 기존 스캔 테스트가 깨진다.
테스트에서는 창을 0으로 두고, 보류 동작 자체는 test_knowledge_scan_hygiene에서
창을 명시적으로 늘려 검증한다.
"""

import pytest

from gongmu_sidecar.knowledge import KnowledgeManager


@pytest.fixture(autouse=True)
def zero_unstable_mtime_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(KnowledgeManager, "UNSTABLE_MTIME_WINDOW_SECONDS", 0.0)


@pytest.fixture(autouse=True)
def disable_secrets_vault(monkeypatch: pytest.MonkeyPatch) -> None:
    """SEC-4b: 테스트는 실제 Windows 자격증명 저장소를 건드리지 않는다(평문 경로 사용).
    vault 동작을 검증하는 테스트는 _keyring 을 직접 가짜로 monkeypatch 해 이를 우회한다."""
    monkeypatch.setenv("GONGMU_DISABLE_VAULT", "1")
