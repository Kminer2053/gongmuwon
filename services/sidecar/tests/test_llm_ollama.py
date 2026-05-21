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


class _FakeStreamResponse:
    def __init__(self, lines: list[dict[str, Any]]) -> None:
        self._lines = lines

    def __iter__(self):
        for line in self._lines:
            yield (json.dumps(line) + "\n").encode("utf-8")

    def __enter__(self) -> "_FakeStreamResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def _capture_request(monkeypatch, response_payload: dict[str, Any]) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    def fake_urlopen(req: request.Request, timeout: int = 180) -> _FakeResponse:
        captured["url"] = req.full_url
        captured["body"] = json.loads(req.data.decode("utf-8"))
        captured["timeout"] = timeout
        return _FakeResponse(response_payload)

    monkeypatch.setattr(request, "urlopen", fake_urlopen)
    return captured


def test_ollama_uses_native_chat_api_without_browser_cors(monkeypatch) -> None:
    captured = _capture_request(
        monkeypatch,
        {"message": {"role": "assistant", "content": "ollama ok"}},
    )
    settings = SidecarSettings(
        llm_mode="local_first",
        llm_provider="ollama",
        llm_model="qwen3.6:27b",
        internal_api_base_url="http://127.0.0.1:11434",
    )

    result = generate_session_reply(settings, [{"role": "user", "text": "hello"}])

    assert result.provider == "ollama"
    assert result.model == "qwen3.6:27b"
    assert result.text == "ollama ok"
    assert captured["url"] == "http://127.0.0.1:11434/api/chat"
    assert captured["body"]["stream"] is False
    assert captured["body"]["think"] is False
    assert captured["body"]["messages"] == [{"role": "user", "content": "hello"}]


def test_ollama_streaming_yields_incremental_chat_chunks(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_urlopen(req: request.Request, timeout: int = 180) -> _FakeStreamResponse:
        captured["url"] = req.full_url
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return _FakeStreamResponse(
            [
                {"message": {"role": "assistant", "content": "첫 "}, "done": False},
                {"message": {"role": "assistant", "content": "응답"}, "done": False},
                {"done": True},
            ]
        )

    monkeypatch.setattr(request, "urlopen", fake_urlopen)
    settings = SidecarSettings(
        llm_mode="local_first",
        llm_provider="ollama",
        llm_model="qwen3.6:27b",
        internal_api_base_url="http://127.0.0.1:11434",
    )
    chunks: list[str] = []

    result = generate_session_reply_streaming(
        settings,
        [{"role": "user", "text": "hello"}],
        on_delta=chunks.append,
    )

    assert result.text == "첫 응답"
    assert chunks == ["첫 ", "응답"]
    assert captured["url"] == "http://127.0.0.1:11434/api/chat"
    assert captured["body"]["stream"] is True


def test_ollama_enables_thinking_only_for_high_reasoning(monkeypatch) -> None:
    captured = _capture_request(
        monkeypatch,
        {"message": {"role": "assistant", "content": "reasoned ok"}},
    )
    settings = SidecarSettings(
        llm_mode="local_first",
        llm_provider="ollama",
        llm_model="qwen3.6:27b",
        internal_api_base_url="http://127.0.0.1:11434",
    )

    result = generate_session_reply(
        settings,
        [{"role": "user", "text": "hello"}],
        reasoning_effort="high",
    )

    assert result.text == "reasoned ok"
    assert captured["body"]["think"] is True


def test_ollama_qwen_native_response_uses_reasoning_fallback_when_content_is_empty(monkeypatch) -> None:
    captured = _capture_request(
        monkeypatch,
        {"message": {"role": "assistant", "content": "", "reasoning_content": "qwen fallback ok"}},
    )
    settings = SidecarSettings(
        llm_mode="local_first",
        llm_provider="ollama",
        llm_model="qwen3.6:27b",
        internal_api_base_url="http://127.0.0.1:11434",
    )

    result = generate_session_reply(settings, [{"role": "user", "text": "hello"}])

    assert result.provider == "ollama"
    assert result.model == "qwen3.6:27b"
    assert result.text == "qwen fallback ok"
    assert captured["url"] == "http://127.0.0.1:11434/api/chat"


def test_ollama_falls_back_to_generate_when_chat_returns_no_text(monkeypatch) -> None:
    captured: list[dict[str, Any]] = []
    responses = [
        {"message": {"role": "assistant", "content": ""}},
        {"response": "generate fallback ok"},
    ]

    def fake_urlopen(req: request.Request, timeout: int = 180) -> _FakeResponse:
        captured.append(
            {
                "url": req.full_url,
                "body": json.loads(req.data.decode("utf-8")),
            }
        )
        return _FakeResponse(responses.pop(0))

    monkeypatch.setattr(request, "urlopen", fake_urlopen)
    settings = SidecarSettings(
        llm_mode="local_first",
        llm_provider="ollama",
        llm_model="qwen3.6:27b",
        internal_api_base_url="http://127.0.0.1:11434",
    )

    result = generate_session_reply(settings, [{"role": "user", "text": "hello"}])

    assert result.text == "generate fallback ok"
    assert [item["url"] for item in captured] == [
        "http://127.0.0.1:11434/api/chat",
        "http://127.0.0.1:11434/api/generate",
    ]
    assert captured[1]["body"]["prompt"] == "User: hello"


def test_ollama_sends_image_attachments_to_multimodal_models(monkeypatch, tmp_path: Path) -> None:
    image_path = tmp_path / "train.png"
    image_path.write_bytes(b"fake-image-bytes")
    captured = _capture_request(
        monkeypatch,
        {"message": {"role": "assistant", "content": "image ok"}},
    )
    settings = SidecarSettings(
        llm_mode="local_first",
        llm_provider="ollama",
        llm_model="gemma4:e2b",
        internal_api_base_url="http://127.0.0.1:11434",
    )

    result = generate_session_reply(
        settings,
        [
            {
                "role": "user",
                "text": "이 사진 뭐게?",
                "attachments": [
                    {
                        "file_name": "train.png",
                        "mime_type": "image/png",
                        "stored_path": str(image_path),
                        "size_bytes": image_path.stat().st_size,
                    }
                ],
            }
        ],
    )

    assert result.text == "image ok"
    assert captured["body"]["messages"] == [
        {
            "role": "user",
            "content": "이 사진 뭐게?",
            "images": ["ZmFrZS1pbWFnZS1ieXRlcw=="],
        }
    ]


def test_openai_compatible_extracts_reasoning_content_when_message_content_is_empty(monkeypatch) -> None:
    captured = _capture_request(
        monkeypatch,
        {"choices": [{"message": {"content": "", "reasoning_content": "reasoning fallback"}}]},
    )
    settings = SidecarSettings(
        llm_mode="external_model",
        llm_provider="openrouter",
        llm_model="qwen3.6:27b",
        llm_api_key="or-key",
        internal_api_base_url="https://openrouter.ai/api/v1",
    )

    result = generate_session_reply(settings, [{"role": "user", "text": "hello"}])

    assert result.text == "reasoning fallback"
    assert captured["url"] == "https://openrouter.ai/api/v1/chat/completions"
