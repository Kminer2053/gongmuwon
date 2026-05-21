import json
from pathlib import Path
from typing import Any
from urllib import request

from gongmu_sidecar.llm import generate_session_reply, generate_session_reply_streaming
from gongmu_sidecar.settings import SidecarSettings


class _FakeResponse:
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


def _capture_request(monkeypatch, response_payload: dict[str, Any]) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    def fake_urlopen(req: request.Request, timeout: int = 45) -> _FakeResponse:
        captured["url"] = req.full_url
        captured["headers"] = {key.lower(): value for key, value in req.header_items()}
        captured["body"] = json.loads(req.data.decode("utf-8"))
        captured["timeout"] = timeout
        return _FakeResponse(response_payload)

    monkeypatch.setattr(request, "urlopen", fake_urlopen)
    return captured


def test_openrouter_uses_official_openai_compatible_chat_contract(monkeypatch) -> None:
    captured = _capture_request(
        monkeypatch,
        {"choices": [{"message": {"content": "openrouter ok"}}]},
    )
    settings = SidecarSettings(
        llm_mode="external_model",
        llm_provider="openrouter",
        llm_model="openai/gpt-4.1-mini",
        llm_api_key="or-key",
        internal_api_base_url="https://openrouter.ai/api/v1",
        llm_site_url="https://gongmu.local",
        llm_application_name="Gongmu Workspace",
    )

    result = generate_session_reply(settings, [{"role": "user", "text": "요약해줘"}])

    assert result.provider == "openrouter"
    assert result.model == "openai/gpt-4.1-mini"
    assert result.text == "openrouter ok"
    assert captured["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert captured["headers"]["authorization"] == "Bearer or-key"
    assert captured["headers"]["http-referer"] == "https://gongmu.local"
    assert captured["headers"]["x-title"] == "Gongmu Workspace"
    assert captured["body"]["model"] == "openai/gpt-4.1-mini"
    assert captured["body"]["messages"] == [{"role": "user", "content": "요약해줘"}]


def test_openrouter_streaming_reads_sse_delta_chunks(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_urlopen(req: request.Request, timeout: int = 45) -> _FakeSseResponse:
        captured["url"] = req.full_url
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return _FakeSseResponse(
            [
                'data: {"choices":[{"delta":{"content":"첫 "}}]}',
                'data: {"choices":[{"delta":{"content":"응답"}}]}',
                "data: [DONE]",
            ]
        )

    monkeypatch.setattr(request, "urlopen", fake_urlopen)
    settings = SidecarSettings(
        llm_mode="external_model",
        llm_provider="openrouter",
        llm_model="openai/gpt-4.1-mini",
        llm_api_key="or-key",
        internal_api_base_url="https://openrouter.ai/api/v1",
    )
    chunks: list[str] = []

    result = generate_session_reply_streaming(
        settings,
        [{"role": "user", "text": "hello"}],
        on_delta=chunks.append,
    )

    assert result.text == "첫 응답"
    assert chunks == ["첫 ", "응답"]
    assert captured["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert captured["body"]["stream"] is True


def test_openrouter_sends_image_attachments_as_data_urls(monkeypatch, tmp_path: Path) -> None:
    image_path = tmp_path / "chart.png"
    image_path.write_bytes(b"fake-chart-bytes")
    captured = _capture_request(
        monkeypatch,
        {"choices": [{"message": {"content": "image understood"}}]},
    )
    settings = SidecarSettings(
        llm_mode="external_model",
        llm_provider="openrouter",
        llm_model="google/gemma-4-31b-it",
        llm_api_key="or-key",
        internal_api_base_url="https://openrouter.ai/api/v1",
    )

    result = generate_session_reply(
        settings,
        [
            {
                "role": "user",
                "text": "What is in this image?",
                "attachments": [
                    {
                        "file_name": "chart.png",
                        "mime_type": "image/png",
                        "stored_path": str(image_path),
                        "size_bytes": image_path.stat().st_size,
                    }
                ],
            }
        ],
    )

    assert result.text == "image understood"
    assert captured["body"]["messages"] == [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "What is in this image?"},
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/png;base64,ZmFrZS1jaGFydC1ieXRlcw=="},
                },
            ],
        }
    ]


def test_anthropic_uses_messages_api_with_required_headers(monkeypatch) -> None:
    captured = _capture_request(
        monkeypatch,
        {"content": [{"type": "text", "text": "anthropic ok"}]},
    )
    settings = SidecarSettings(
        llm_mode="external_model",
        llm_provider="anthropic",
        llm_model="claude-sonnet-4-20250514",
        llm_api_key="sk-ant-test",
        internal_api_base_url="https://api.anthropic.com/v1",
    )

    result = generate_session_reply(
        settings,
        [
            {"role": "system", "text": "간결하게 답해."},
            {"role": "user", "text": "회의 내용을 정리해줘"},
        ],
    )

    assert result.provider == "anthropic"
    assert result.text == "anthropic ok"
    assert captured["url"] == "https://api.anthropic.com/v1/messages"
    assert captured["headers"]["x-api-key"] == "sk-ant-test"
    assert captured["headers"]["anthropic-version"] == "2023-06-01"
    assert captured["body"]["model"] == "claude-sonnet-4-20250514"
    assert captured["body"]["system"] == "간결하게 답해."
    assert captured["body"]["messages"] == [{"role": "user", "content": "회의 내용을 정리해줘"}]


def test_anthropic_sends_image_attachments_as_base64_blocks(monkeypatch, tmp_path: Path) -> None:
    image_path = tmp_path / "photo.jpg"
    image_path.write_bytes(b"fake-photo")
    captured = _capture_request(
        monkeypatch,
        {"content": [{"type": "text", "text": "anthropic image ok"}]},
    )
    settings = SidecarSettings(
        llm_mode="external_model",
        llm_provider="anthropic",
        llm_model="claude-sonnet-4-20250514",
        llm_api_key="sk-ant-test",
        internal_api_base_url="https://api.anthropic.com/v1",
    )

    result = generate_session_reply(
        settings,
        [
            {
                "role": "user",
                "text": "Describe this photo",
                "attachments": [
                    {
                        "file_name": "photo.jpg",
                        "mime_type": "image/jpeg",
                        "stored_path": str(image_path),
                        "size_bytes": image_path.stat().st_size,
                    }
                ],
            }
        ],
    )

    assert result.text == "anthropic image ok"
    assert captured["body"]["messages"] == [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe this photo"},
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": "ZmFrZS1waG90bw==",
                    },
                },
            ],
        }
    ]


def test_gemini_uses_generate_content_with_google_api_key(monkeypatch) -> None:
    captured = _capture_request(
        monkeypatch,
        {"candidates": [{"content": {"parts": [{"text": "gemini ok"}]}}]},
    )
    settings = SidecarSettings(
        llm_mode="external_model",
        llm_provider="gemini",
        llm_model="gemini-2.5-flash",
        llm_api_key="google-key",
        internal_api_base_url="https://generativelanguage.googleapis.com/v1beta",
    )

    result = generate_session_reply(
        settings,
        [
            {"role": "system", "text": "간결하게 답해."},
            {"role": "user", "text": "예산 메모를 요약해줘"},
            {"role": "assistant", "text": "이전 응답"},
        ],
    )

    assert result.provider == "gemini"
    assert result.text == "gemini ok"
    assert captured["url"] == (
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    )
    assert captured["headers"]["x-goog-api-key"] == "google-key"
    assert captured["body"]["system_instruction"] == {"parts": [{"text": "간결하게 답해."}]}
    assert captured["body"]["contents"] == [
        {"role": "user", "parts": [{"text": "예산 메모를 요약해줘"}]},
        {"role": "model", "parts": [{"text": "이전 응답"}]},
    ]


def test_gemini_sends_image_attachments_as_inline_data(monkeypatch, tmp_path: Path) -> None:
    image_path = tmp_path / "diagram.png"
    image_path.write_bytes(b"fake-diagram")
    captured = _capture_request(
        monkeypatch,
        {"candidates": [{"content": {"parts": [{"text": "gemini image ok"}]}}]},
    )
    settings = SidecarSettings(
        llm_mode="external_model",
        llm_provider="gemini",
        llm_model="gemini-2.5-flash",
        llm_api_key="google-key",
        internal_api_base_url="https://generativelanguage.googleapis.com/v1beta",
    )

    result = generate_session_reply(
        settings,
        [
            {
                "role": "user",
                "text": "Explain this diagram",
                "attachments": [
                    {
                        "file_name": "diagram.png",
                        "mime_type": "image/png",
                        "stored_path": str(image_path),
                        "size_bytes": image_path.stat().st_size,
                    }
                ],
            }
        ],
    )

    assert result.text == "gemini image ok"
    assert captured["body"]["contents"] == [
        {
            "role": "user",
            "parts": [
                {"text": "Explain this diagram"},
                {
                    "inline_data": {
                        "mime_type": "image/png",
                        "data": "ZmFrZS1kaWFncmFt",
                    }
                },
            ],
        }
    ]
