"""WI-4(2026-07-14): LLM retryable 5xx 1회 재시도 계약 테스트 (트랙 E2E-B1~B5).

mock urlopen으로 결정적으로 검증한다 — 시도 횟수, sleep 인자(백오프 2~5초 캡),
비재시도 코드(400)·URLError(ollama) 무재시도, 스트리밍 첫 바이트 전 재시도,
경과 캡(90초) 초과 시 재시도 포기.
"""

from __future__ import annotations

import email.message
import io
import json
from typing import Any
from urllib import error, request

import pytest

from gongmu_sidecar import llm as llm_module
from gongmu_sidecar.llm import (
    LLMGenerationError,
    generate_session_reply,
    generate_session_reply_streaming,
)
from gongmu_sidecar.settings import SidecarSettings

# 실측 featherless 504 본문 기반(execution_logs 8c178c2e, 2026-07-13T14:28) —
# Cloudflare 게이트웨이 JSON에 "retryable":true,"retry_after":120 명시.
_FEATHERLESS_504_BODY = (
    '{"error":{"message":"Gateway time-out","type":"server_error","param":null,'
    '"code":"gateway_timeout"},"retryable":true,"retry_after":120}'
).encode("utf-8")


class _FakeResponse:  # test_llm_providers.py 패턴 재사용
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeSseResponse:
    def __init__(self, lines: list[str]) -> None:
        self._lines = lines

    def __iter__(self):
        for line in self._lines:
            yield (line + "\n").encode("utf-8")

    def __enter__(self) -> "_FakeSseResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeClock:
    """llm.time 대역 — sleep은 인자만 기록하고, monotonic은 sleep·외부 가산만큼 전진한다."""

    def __init__(self) -> None:
        self.sleeps: list[float] = []
        self.now = 0.0

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(float(seconds))
        self.now += float(seconds)

    def monotonic(self) -> float:
        return self.now


def _http_error(
    code: int,
    body: bytes,
    url: str = "https://api.featherless.ai/v1/chat/completions",
) -> error.HTTPError:
    # 주의(트랙 risks): HTTPError.read()는 1회만 읽힌다 — 시도마다 새 예외 객체를 만든다.
    return error.HTTPError(url, code, "Gateway Time-out", email.message.Message(), io.BytesIO(body))


def _featherless_settings() -> SidecarSettings:
    return SidecarSettings(
        llm_mode="external_model",
        llm_provider="featherless",
        llm_model="google/gemma-4-E2B-it",
        llm_api_key="feather-key",
        internal_api_base_url="https://api.featherless.ai/v1",
    )


def test_featherless_504_retries_once_then_succeeds(monkeypatch) -> None:
    """E2E-B1: 1회차 504(retryable) → 2회차 200 — 재시도로 성공, retry_after 120은 5초 캡."""
    clock = _FakeClock()
    monkeypatch.setattr(llm_module, "time", clock, raising=False)
    calls: list[str] = []

    def fake_urlopen(req: request.Request, timeout: int = 180):
        calls.append(req.full_url)
        if len(calls) == 1:
            raise _http_error(504, _FEATHERLESS_504_BODY)
        return _FakeResponse({"choices": [{"message": {"content": "retry ok"}}]})

    monkeypatch.setattr(request, "urlopen", fake_urlopen)

    result = generate_session_reply(_featherless_settings(), [{"role": "user", "text": "hello"}])

    assert result.text == "retry ok"
    assert len(calls) == 2
    assert clock.sleeps == [5.0]  # retry_after 120초 → RETRY_BACKOFF_CAP_SECONDS(5.0) 캡


def test_featherless_504_without_retry_after_uses_default_backoff(monkeypatch) -> None:
    """E2E-B1 보강: 본문에 retry_after가 없으면 기본 백오프(3초, 2~5초 범위)로 재시도한다."""
    clock = _FakeClock()
    monkeypatch.setattr(llm_module, "time", clock, raising=False)
    calls: list[str] = []

    def fake_urlopen(req: request.Request, timeout: int = 180):
        calls.append(req.full_url)
        if len(calls) == 1:
            raise _http_error(502, b'{"error":{"message":"bad gateway"}}')
        return _FakeResponse({"choices": [{"message": {"content": "retry ok"}}]})

    monkeypatch.setattr(request, "urlopen", fake_urlopen)

    result = generate_session_reply(_featherless_settings(), [{"role": "user", "text": "hello"}])

    assert result.text == "retry ok"
    assert len(calls) == 2
    assert len(clock.sleeps) == 1
    assert 2.0 <= clock.sleeps[0] <= 5.0
    assert clock.sleeps[0] == 3.0  # RETRY_BACKOFF_DEFAULT_SECONDS


def test_featherless_504_exhausts_after_single_retry(monkeypatch) -> None:
    """E2E-B2: 2회 연속 504 — 한국어 안내(코드 숫자 보존), 3회째 호출 없음."""
    clock = _FakeClock()
    monkeypatch.setattr(llm_module, "time", clock, raising=False)
    calls: list[str] = []

    def fake_urlopen(req: request.Request, timeout: int = 180):
        calls.append(req.full_url)
        assert len(calls) <= 2, "재시도는 1회만 허용된다 (3회째 호출 금지)"
        raise _http_error(504, _FEATHERLESS_504_BODY)

    monkeypatch.setattr(request, "urlopen", fake_urlopen)

    with pytest.raises(LLMGenerationError) as exc_info:
        generate_session_reply(_featherless_settings(), [{"role": "user", "text": "hello"}])

    assert "504" in str(exc_info.value)
    assert "잠시 후" in str(exc_info.value)
    assert exc_info.value.status_code == 504
    assert len(calls) == 2
    assert len(clock.sleeps) == 1


def test_ollama_urlerror_fails_fast_with_korean_guidance(monkeypatch) -> None:
    """E2E-B3: 로컬 Ollama 연결 거부 — 무재시도(urlopen 1회, sleep 0회), Ollama 안내."""
    clock = _FakeClock()
    monkeypatch.setattr(llm_module, "time", clock, raising=False)
    calls: list[str] = []

    def fake_urlopen(req: request.Request, timeout: int = 180):
        calls.append(req.full_url)
        raise error.URLError(ConnectionRefusedError(10061, "connection refused"))

    monkeypatch.setattr(request, "urlopen", fake_urlopen)
    settings = SidecarSettings(
        llm_mode="local_first",
        llm_provider="ollama",
        llm_model="gemma4:e2b",
        internal_api_base_url="http://127.0.0.1:11434",
    )

    with pytest.raises(LLMGenerationError) as exc_info:
        generate_session_reply(settings, [{"role": "user", "text": "hello"}])

    assert "Ollama" in str(exc_info.value)
    assert "연결" in str(exc_info.value)
    assert len(calls) == 1
    assert clock.sleeps == []


def test_featherless_streaming_retries_before_first_byte(monkeypatch) -> None:
    """E2E-B4: 스트리밍은 urlopen 시점(첫 바이트 수신 전) 504만 재시도한다."""
    clock = _FakeClock()
    monkeypatch.setattr(llm_module, "time", clock, raising=False)
    calls: list[str] = []

    def fake_urlopen(req: request.Request, timeout: int = 180):
        calls.append(req.full_url)
        if len(calls) == 1:
            raise _http_error(504, b'{"retryable":true}')
        return _FakeSseResponse(
            [
                'data: {"choices":[{"delta":{"content":"첫 "}}]}',
                'data: {"choices":[{"delta":{"content":"응답"}}]}',
                "data: [DONE]",
            ]
        )

    monkeypatch.setattr(request, "urlopen", fake_urlopen)
    chunks: list[str] = []

    result = generate_session_reply_streaming(
        _featherless_settings(),
        [{"role": "user", "text": "hello"}],
        on_delta=chunks.append,
    )

    assert result.text == "첫 응답"
    assert chunks == ["첫 ", "응답"]
    assert len(calls) == 2
    assert len(clock.sleeps) == 1
    assert 2.0 <= clock.sleeps[0] <= 5.0  # retry_after 부재 → 기본 백오프(3초), 항상 5초 캡


def test_http_400_is_not_retried_and_preserves_message_format(monkeypatch) -> None:
    """E2E-B5: 400은 무재시도 + 기존 메시지 포맷 보존(responses→chat 폴백 계약 유지)."""
    clock = _FakeClock()
    monkeypatch.setattr(llm_module, "time", clock, raising=False)
    calls: list[str] = []

    def fake_urlopen(req: request.Request, timeout: int = 180):
        calls.append(req.full_url)
        raise _http_error(400, b'{"error":{"message":"bad request"}}')

    monkeypatch.setattr(request, "urlopen", fake_urlopen)

    with pytest.raises(LLMGenerationError) as exc_info:
        generate_session_reply(_featherless_settings(), [{"role": "user", "text": "hello"}])

    assert "400" in str(exc_info.value)
    assert str(exc_info.value).startswith("LLM request failed (400):")
    assert exc_info.value.status_code == 400
    assert len(calls) == 1
    assert clock.sleeps == []


def test_openai_responses_404_falls_back_to_chat_via_status_code(monkeypatch) -> None:
    """트랙 risks: responses→chat 폴백이 status_code 우선으로 동작(문자열 포맷 변경 내성)."""
    clock = _FakeClock()
    monkeypatch.setattr(llm_module, "time", clock, raising=False)
    calls: list[str] = []

    def fake_urlopen(req: request.Request, timeout: int = 180):
        calls.append(req.full_url)
        if req.full_url.endswith("/responses"):
            raise _http_error(404, b'{"error":{"message":"unknown endpoint"}}', url=req.full_url)
        return _FakeResponse({"choices": [{"message": {"content": "chat fallback ok"}}]})

    monkeypatch.setattr(request, "urlopen", fake_urlopen)
    settings = SidecarSettings(
        llm_mode="external_model",
        llm_provider="openai",
        llm_model="gpt-4.1-mini",
        llm_api_key="sk-test",
        internal_api_base_url="https://api.openai.com/v1",
    )

    result = generate_session_reply(settings, [{"role": "user", "text": "hello"}])

    assert result.text == "chat fallback ok"
    assert [url.rsplit("/", 1)[-1] for url in calls] == ["responses", "completions"]
    assert clock.sleeps == []  # 404는 무재시도


def test_slow_first_attempt_over_elapsed_cap_skips_retry(monkeypatch) -> None:
    """경과 캡(90초) 초과한 느린 1차 504 후에는 재시도하지 않는다(턴 예산 보호)."""
    clock = _FakeClock()
    monkeypatch.setattr(llm_module, "time", clock, raising=False)
    calls: list[str] = []

    def fake_urlopen(req: request.Request, timeout: int = 180):
        calls.append(req.full_url)
        clock.now += 120.0  # 1차 시도가 120초 걸린 것으로 시뮬레이션
        raise _http_error(504, _FEATHERLESS_504_BODY)

    monkeypatch.setattr(request, "urlopen", fake_urlopen)

    with pytest.raises(LLMGenerationError) as exc_info:
        generate_session_reply(_featherless_settings(), [{"role": "user", "text": "hello"}])

    assert exc_info.value.status_code == 504
    assert "잠시 후" in str(exc_info.value)
    assert len(calls) == 1
    assert clock.sleeps == []
