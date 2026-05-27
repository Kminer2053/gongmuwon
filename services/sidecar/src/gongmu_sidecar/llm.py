from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib import error, request

from .settings import SidecarSettings


class LLMGenerationError(RuntimeError):
    pass


@dataclass
class LLMGenerationResult:
    text: str
    provider: str
    model: str


ANTHROPIC_VERSION = "2023-06-01"

DEFAULT_PROVIDER_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "featherless": "https://api.featherless.ai/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
    "nvidia_nim": "https://integrate.api.nvidia.com/v1",
    "ollama": "http://127.0.0.1:11434",
}

PROVIDER_ENV_KEYS = {
    "openai": ("OPENAI_API_KEY",),
    "openrouter": ("OPENROUTER_API_KEY",),
    "featherless": ("FEATHERLESS_API_KEY",),
    "anthropic": ("ANTHROPIC_API_KEY",),
    "gemini": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    "nvidia_nim": ("NVIDIA_API_KEY",),
    "custom_openai": ("OPENAI_API_KEY",),
    "ollama": (),
}


def _normalize_base_url(base_url: str) -> str:
    return base_url.rstrip("/")


def _normalize_provider(settings: SidecarSettings) -> str:
    raw = settings.llm_provider.strip().lower().replace("-", "_").replace(" ", "_")
    if not raw:
        return "custom_openai" if settings.llm_mode == "internal_server" else "ollama"
    if raw in {"chatgpt", "openai_chatgpt"}:
        return "openai"
    if raw in {"claude", "anthropic_claude"}:
        return "anthropic"
    if raw in {"google", "google_gemini"}:
        return "gemini"
    if raw in {"nvidia", "nim", "nvidianim"}:
        return "nvidia_nim"
    if raw in {"ollama", "ollama_native"}:
        return "ollama"
    if raw in {"featherless", "featherless_ai", "featherlessapi"}:
        return "featherless"
    if raw == "openai_compatible":
        return "custom_openai"
    return raw


def _resolve_api_key(settings: SidecarSettings, provider: str) -> str | None:
    if settings.llm_api_key and settings.llm_api_key.strip():
        return settings.llm_api_key.strip()

    generic = os.getenv("GONGMU_LLM_API_KEY")
    if generic:
        return generic

    for env_name in PROVIDER_ENV_KEYS.get(provider, ()):
        value = os.getenv(env_name)
        if value:
            return value

    return None


def _resolve_base_url(settings: SidecarSettings, provider: str) -> str:
    if settings.internal_api_base_url and settings.internal_api_base_url.strip():
        return _normalize_base_url(settings.internal_api_base_url.strip())

    default_base_url = DEFAULT_PROVIDER_BASE_URLS.get(provider)
    if default_base_url:
        return default_base_url

    raise LLMGenerationError(
        "모델 API Base URL이 비어 있습니다. 환경설정에서 공급자별 기본값을 사용하거나 직접 입력하세요."
    )


def _post_json(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    req = request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        timeout = int(os.getenv("GONGMU_LLM_TIMEOUT_SECONDS", "180"))
        with request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise LLMGenerationError(f"LLM request failed ({exc.code}): {detail}") from exc
    except error.URLError as exc:
        raise LLMGenerationError(f"LLM server unreachable: {exc.reason}") from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise LLMGenerationError("LLM server returned invalid JSON.") from exc

    if not isinstance(data, dict):
        raise LLMGenerationError("LLM server returned an unexpected response shape.")
    return data


def _post_json_stream_lines(
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
):
    req = request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        timeout = int(os.getenv("GONGMU_LLM_TIMEOUT_SECONDS", "180"))
        with request.urlopen(req, timeout=timeout) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if line:
                    yield line
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise LLMGenerationError(f"LLM request failed ({exc.code}): {detail}") from exc
    except error.URLError as exc:
        raise LLMGenerationError(f"LLM server unreachable: {exc.reason}") from exc


def _attachment_image_base64(attachment: dict[str, Any]) -> str | None:
    mime_type = str(attachment.get("mime_type") or "").lower()
    if not mime_type.startswith("image/"):
        return None
    stored_path = str(attachment.get("stored_path") or "").strip()
    if not stored_path:
        return None
    path = Path(stored_path)
    if not path.is_file():
        return None
    try:
        return base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError:
        return None


def _attachment_image_mime_type(attachment: dict[str, Any]) -> str:
    mime_type = str(attachment.get("mime_type") or "").lower()
    return mime_type if mime_type.startswith("image/") else "image/png"


def _normalize_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in messages:
        role = item.get("role")
        if role not in {"user", "assistant", "system"}:
            continue
        content = str(item.get("text", "")).strip()
        images: list[str] = []
        image_mime_types: list[str] = []
        if role == "user":
            attachments = item.get("attachments") or []
            if isinstance(attachments, list):
                for attachment in attachments:
                    if not isinstance(attachment, dict):
                        continue
                    encoded = _attachment_image_base64(attachment)
                    if encoded:
                        images.append(encoded)
                        image_mime_types.append(_attachment_image_mime_type(attachment))
        if not content and not images:
            continue
        next_message: dict[str, Any] = {
            "role": role,
            "content": content or "첨부 이미지를 분석하세요.",
        }
        if images:
            next_message["images"] = images
            next_message["image_mime_types"] = image_mime_types
        normalized.append(next_message)
    if not normalized:
        raise LLMGenerationError("No chat messages were available to send to the LLM.")
    return normalized


def _split_system_messages(messages: list[dict[str, Any]]) -> tuple[str | None, list[dict[str, Any]]]:
    system_parts: list[str] = []
    dialog_messages: list[dict[str, Any]] = []
    for message in messages:
        if message["role"] == "system":
            system_parts.append(message["content"])
        else:
            dialog_messages.append(message)
    system_text = "\n\n".join(part for part in system_parts if part.strip()).strip() or None
    return system_text, dialog_messages


def _image_mime_type(message: dict[str, Any], index: int) -> str:
    mime_types = message.get("image_mime_types")
    if isinstance(mime_types, list) and index < len(mime_types):
        mime_type = str(mime_types[index])
        if mime_type.startswith("image/"):
            return mime_type
    return "image/png"


def _openai_data_url(message: dict[str, Any], index: int, image: str) -> str:
    return f"data:{_image_mime_type(message, index)};base64,{image}"


def _responses_content(message: dict[str, Any]) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = [{"type": "input_text", "text": message["content"]}]
    images = message.get("images") if isinstance(message.get("images"), list) else []
    for index, image in enumerate(images):
        content.append(
            {
                "type": "input_image",
                "image_url": _openai_data_url(message, index, str(image)),
            }
        )
    return content


def _anthropic_message_content(message: dict[str, Any]) -> str | list[dict[str, Any]]:
    images = message.get("images") if isinstance(message.get("images"), list) else []
    if not images:
        return message["content"]

    content: list[dict[str, Any]] = [{"type": "text", "text": message["content"]}]
    for index, image in enumerate(images):
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": _image_mime_type(message, index),
                    "data": str(image),
                },
            }
        )
    return content


def _gemini_parts(message: dict[str, Any]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = [{"text": message["content"]}]
    images = message.get("images") if isinstance(message.get("images"), list) else []
    for index, image in enumerate(images):
        parts.append(
            {
                "inline_data": {
                    "mime_type": _image_mime_type(message, index),
                    "data": str(image),
                }
            }
        )
    return parts


def _extract_response_text(payload: dict[str, Any]) -> str | None:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    output = payload.get("output")
    if not isinstance(output, list):
        return None

    chunks: list[str] = []
    for item in output:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict):
                continue
            text_value = part.get("text")
            if isinstance(text_value, str) and text_value.strip():
                chunks.append(text_value.strip())
    return "\n\n".join(chunks).strip() or None


def _extract_chat_completion_text(payload: dict[str, Any]) -> str | None:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None

    message = choices[0].get("message")
    if not isinstance(message, dict):
        return None

    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()

    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            text_value = item.get("text")
            if isinstance(text_value, str) and text_value.strip():
                chunks.append(text_value.strip())
        return "\n\n".join(chunks).strip() or None

    for key in ("reasoning_content", "reasoning", "text"):
        text_value = message.get(key)
        if isinstance(text_value, str) and text_value.strip():
            return text_value.strip()

    delta = choices[0].get("delta")
    if isinstance(delta, dict):
        for key in ("content", "reasoning_content", "reasoning", "text"):
            text_value = delta.get(key)
            if isinstance(text_value, str) and text_value.strip():
                return text_value.strip()

    choice_text = choices[0].get("text")
    if isinstance(choice_text, str) and choice_text.strip():
        return choice_text.strip()
    return None


def _extract_ollama_text(payload: dict[str, Any], *, allow_reasoning_fallback: bool = True) -> str | None:
    message = payload.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        if allow_reasoning_fallback:
            for key in ("reasoning_content", "reasoning", "thinking", "text"):
                text_value = message.get(key)
                if isinstance(text_value, str) and text_value.strip():
                    return text_value.strip()

    response = payload.get("response")
    if isinstance(response, str) and response.strip():
        return response.strip()

    if allow_reasoning_fallback:
        for key in ("reasoning_content", "reasoning", "thinking", "text"):
            text_value = payload.get(key)
            if isinstance(text_value, str) and text_value.strip():
                return text_value.strip()

    return _extract_chat_completion_text(payload) if allow_reasoning_fallback else None


def _extract_chat_completion_delta(payload: dict[str, Any]) -> str | None:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    choice = choices[0]
    if not isinstance(choice, dict):
        return None
    delta = choice.get("delta")
    if isinstance(delta, dict):
        for key in ("content", "reasoning_content", "reasoning", "text"):
            text_value = delta.get(key)
            if isinstance(text_value, str) and text_value:
                return text_value
    choice_text = choice.get("text")
    if isinstance(choice_text, str) and choice_text:
        return choice_text
    return _extract_chat_completion_text(payload)


def _extract_ollama_delta(payload: dict[str, Any], *, allow_reasoning_fallback: bool = True) -> str | None:
    message = payload.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str) and content:
            return content
        if allow_reasoning_fallback:
            for key in ("reasoning_content", "reasoning", "thinking", "text"):
                text_value = message.get(key)
                if isinstance(text_value, str) and text_value:
                    return text_value
    response = payload.get("response")
    if isinstance(response, str) and response:
        return response
    return _extract_ollama_text(payload, allow_reasoning_fallback=allow_reasoning_fallback)


def _extract_anthropic_text(payload: dict[str, Any]) -> str | None:
    content = payload.get("content")
    if not isinstance(content, list):
        return None

    chunks: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "text":
            continue
        text_value = item.get("text")
        if isinstance(text_value, str) and text_value.strip():
            chunks.append(text_value.strip())
    return "\n\n".join(chunks).strip() or None


def _extract_gemini_text(payload: dict[str, Any]) -> str | None:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return None

    content = candidates[0].get("content")
    if not isinstance(content, dict):
        return None

    parts = content.get("parts")
    if not isinstance(parts, list):
        return None

    chunks: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        text_value = part.get("text")
        if isinstance(text_value, str) and text_value.strip():
            chunks.append(text_value.strip())
    return "\n\n".join(chunks).strip() or None


def _openai_headers(api_key: str | None, provider: str, settings: SidecarSettings) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "OpenAI/Python 1.0.0 GongmuWorkspace/0.1",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if provider in {"openrouter", "featherless"}:
        if settings.llm_site_url:
            headers["HTTP-Referer"] = settings.llm_site_url
        if settings.llm_application_name:
            headers["X-Title"] = settings.llm_application_name
    return headers


def _generate_openai_family_reply(
    settings: SidecarSettings,
    provider: str,
    model: str,
    normalized_messages: list[dict[str, Any]],
    *,
    try_responses: bool,
    reasoning_effort: str | None = None,
) -> LLMGenerationResult:
    base_url = _resolve_base_url(settings, provider)
    api_key = _resolve_api_key(settings, provider)
    headers = _openai_headers(api_key, provider, settings)

    def openai_chat_content(message: dict[str, Any]) -> str | list[dict[str, Any]]:
        images = message.get("images") if isinstance(message.get("images"), list) else []
        if not images:
            return message["content"]

        content: list[dict[str, Any]] = [{"type": "text", "text": message["content"]}]
        for index, image in enumerate(images):
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": _openai_data_url(message, index, str(image))},
                }
            )
        return content

    if try_responses:
        try:
            responses_request: dict[str, Any] = {
                "model": model,
                "input": [
                    {
                        "role": message["role"],
                        "content": _responses_content(message),
                    }
                    for message in normalized_messages
                ],
            }
            if reasoning_effort and reasoning_effort != "auto":
                responses_request["reasoning"] = {"effort": reasoning_effort}
            responses_payload = _post_json(
                f"{base_url}/responses",
                headers,
                responses_request,
            )
            response_text = _extract_response_text(responses_payload)
            if response_text:
                return LLMGenerationResult(text=response_text, provider=provider, model=model)
        except LLMGenerationError as responses_error:
            if "404" not in str(responses_error) and "400" not in str(responses_error):
                raise

    chat_payload = _post_json(
        f"{base_url}/chat/completions",
        headers,
        {
            "model": model,
            "messages": [
                {"role": message["role"], "content": openai_chat_content(message)}
                for message in normalized_messages
            ],
        },
    )
    chat_text = _extract_chat_completion_text(chat_payload)
    if not chat_text:
        raise LLMGenerationError("LLM server returned no assistant text.")
    return LLMGenerationResult(text=chat_text, provider=provider, model=model)


def _generate_openai_family_reply_streaming(
    settings: SidecarSettings,
    provider: str,
    model: str,
    normalized_messages: list[dict[str, Any]],
    *,
    on_delta: Callable[[str], None],
    reasoning_effort: str | None = None,
) -> LLMGenerationResult:
    base_url = _resolve_base_url(settings, provider)
    api_key = _resolve_api_key(settings, provider)
    headers = _openai_headers(api_key, provider, settings)

    def openai_chat_content(message: dict[str, Any]) -> str | list[dict[str, Any]]:
        images = message.get("images") if isinstance(message.get("images"), list) else []
        if not images:
            return message["content"]

        content: list[dict[str, Any]] = [{"type": "text", "text": message["content"]}]
        for index, image in enumerate(images):
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": _openai_data_url(message, index, str(image))},
                }
            )
        return content

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": message["role"], "content": openai_chat_content(message)}
            for message in normalized_messages
        ],
        "stream": True,
    }
    if reasoning_effort and reasoning_effort != "auto":
        payload["reasoning_effort"] = reasoning_effort

    chunks: list[str] = []
    for line in _post_json_stream_lines(f"{base_url}/chat/completions", headers, payload):
        if line.startswith(":"):
            continue
        if not line.startswith("data:"):
            continue
        data = line.removeprefix("data:").strip()
        if data == "[DONE]":
            break
        try:
            event_payload = json.loads(data)
        except json.JSONDecodeError:
            continue
        delta_text = _extract_chat_completion_delta(event_payload)
        if delta_text:
            chunks.append(delta_text)
            on_delta(delta_text)

    text = "".join(chunks).strip()
    if not text:
        raise LLMGenerationError("LLM server returned no assistant text.")
    return LLMGenerationResult(text=text, provider=provider, model=model)


def _looks_like_ollama_native(base_url: str) -> bool:
    return "11434" in base_url and not base_url.rstrip("/").endswith("/v1")


def _is_gemma4_model(model: str) -> bool:
    normalized = model.strip().lower().replace("_", "-")
    return "gemma4" in normalized or "gemma-4" in normalized


def _ollama_think_enabled(model: str, reasoning_effort: str | None) -> bool:
    if _is_gemma4_model(model):
        return reasoning_effort in {"medium", "high"}
    return reasoning_effort in {"medium", "high"}


def _ollama_num_predict(reasoning_effort: str | None) -> int:
    return {
        "low": 1536,
        "medium": 2560,
        "high": 4096,
    }.get(reasoning_effort or "auto", 1024)


def _ollama_options(model: str, reasoning_effort: str | None) -> dict[str, Any] | None:
    if not _is_gemma4_model(model):
        return None
    return {
        "num_ctx": 32768,
        "num_predict": _ollama_num_predict(reasoning_effort),
        "temperature": 1.0,
        "top_k": 65,
        "top_p": 0.95,
        "repeat_penalty": 1.0,
        "stop": ["<end_of_turn>", "<start_of_turn>"],
    }


def describe_llm_runtime_policy(provider: str, model: str) -> dict[str, Any]:
    normalized_provider = provider.strip().lower().replace("-", "_").replace(" ", "_")
    normalized_model = model.strip().lower().replace("_", "-")
    is_gemma4 = _is_gemma4_model(model)
    model_sizes = [
        float(match.group(1))
        for match in re.finditer(r"(?<!\d)(?:e)?(\d+(?:\.\d+)?)b(?![a-z0-9])", normalized_model)
    ]
    small_name = re.search(r"(^|[^a-z0-9])(mini|small|edge|nano|flash)([^a-z0-9]|$)", normalized_model)
    is_gemma4_e2b = is_gemma4 and any(size == 2 for size in model_sizes)
    is_qwen = "qwen" in normalized_model
    is_small_name = bool(small_name or any(0 < size <= 4 for size in model_sizes))
    is_large_name = any(size >= 8 for size in model_sizes)
    model_family = "gemma4" if is_gemma4 else "qwen" if is_qwen else "generic"
    is_lightweight = bool(is_gemma4_e2b or (is_small_name and not is_large_name))
    recommended_reasoning_effort = "low" if is_lightweight else "medium" if is_gemma4 else "auto"

    return {
        "provider": normalized_provider or provider,
        "model": model,
        "model_family": model_family,
        "is_lightweight": is_lightweight,
        "is_gemma4": is_gemma4,
        "is_gemma4_e2b": is_gemma4_e2b,
        "recommended_reasoning_effort": recommended_reasoning_effort,
        "streaming_required": bool(is_lightweight or normalized_provider == "ollama"),
        "generate_fallback_enabled": not is_gemma4,
        "thinking_supported": is_gemma4,
        "vision_supported": is_gemma4 or any(marker in normalized_model for marker in ["vision", "vl", "multimodal"]),
        "recommended_options": _ollama_options(model, recommended_reasoning_effort)
        if normalized_provider in {"ollama", "ollama_native"}
        else None,
        "notes": [
            "Gemma 4 계열은 /api/chat 응답만 신뢰하고 /api/generate plain-text fallback을 사용하지 않습니다."
            if is_gemma4
            else "기존 Ollama 모델은 호환성을 위해 reasoning_content와 /api/generate fallback을 유지합니다.",
            "경량모델은 스트리밍 응답과 짧은 reasoning 기본값을 우선 사용합니다."
            if is_lightweight
            else "대형 또는 일반 모델은 현재 사용자 설정을 우선합니다.",
        ],
    }


def _apply_ollama_model_tuning(
    payload: dict[str, Any],
    *,
    model: str,
    reasoning_effort: str | None,
) -> dict[str, Any]:
    payload["think"] = _ollama_think_enabled(model, reasoning_effort)
    options = _ollama_options(model, reasoning_effort)
    if options is not None:
        payload["options"] = options
    return payload


def _ollama_chat_messages(normalized_messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for message in normalized_messages:
        next_message = {
            "role": message["role"],
            "content": message["content"],
        }
        if message.get("images"):
            next_message["images"] = message["images"]
        messages.append(next_message)
    return messages


def _ollama_generate_prompt(normalized_messages: list[dict[str, Any]]) -> str:
    role_labels = {
        "system": "System",
        "user": "User",
        "assistant": "Assistant",
    }
    parts = [
        f"{role_labels.get(message['role'], message['role'])}: {message['content']}"
        for message in normalized_messages
        if str(message.get("content") or "").strip()
    ]
    return "\n\n".join(parts).strip()


def _ollama_last_user_images(normalized_messages: list[dict[str, Any]]) -> list[str]:
    for message in reversed(normalized_messages):
        if message.get("role") == "user" and isinstance(message.get("images"), list):
            return [str(image) for image in message["images"] if str(image).strip()]
    return []


def _generate_ollama_reply(
    settings: SidecarSettings,
    model: str,
    normalized_messages: list[dict[str, Any]],
    *,
    reasoning_effort: str | None = None,
) -> LLMGenerationResult:
    base_url = _resolve_base_url(settings, "ollama")
    headers = {"Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": _ollama_chat_messages(normalized_messages),
        "stream": False,
    }
    _apply_ollama_model_tuning(payload, model=model, reasoning_effort=reasoning_effort)
    response_payload = _post_json(f"{base_url}/api/chat", headers, payload)
    response_text = _extract_ollama_text(
        response_payload,
        allow_reasoning_fallback=not _is_gemma4_model(model),
    )
    if response_text:
        return LLMGenerationResult(text=response_text, provider="ollama", model=model)
    if _is_gemma4_model(model):
        raise LLMGenerationError("Ollama Gemma 4 returned no assistant text from /api/chat; /api/generate fallback is disabled for this model.")

    generate_payload: dict[str, Any] = {
        "model": model,
        "prompt": _ollama_generate_prompt(normalized_messages),
        "stream": False,
    }
    _apply_ollama_model_tuning(generate_payload, model=model, reasoning_effort=reasoning_effort)
    images = _ollama_last_user_images(normalized_messages)
    if images:
        generate_payload["images"] = images
    generate_response = _post_json(f"{base_url}/api/generate", headers, generate_payload)
    generate_text = _extract_ollama_text(generate_response)
    if not generate_text:
        raise LLMGenerationError("Ollama server returned no assistant text.")
    return LLMGenerationResult(text=generate_text, provider="ollama", model=model)


def _generate_ollama_reply_streaming(
    settings: SidecarSettings,
    model: str,
    normalized_messages: list[dict[str, Any]],
    *,
    on_delta: Callable[[str], None],
    reasoning_effort: str | None = None,
) -> LLMGenerationResult:
    base_url = _resolve_base_url(settings, "ollama")
    headers = {"Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": _ollama_chat_messages(normalized_messages),
        "stream": True,
    }
    _apply_ollama_model_tuning(payload, model=model, reasoning_effort=reasoning_effort)

    chunks: list[str] = []
    for line in _post_json_stream_lines(f"{base_url}/api/chat", headers, payload):
        try:
            event_payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event_payload.get("error"):
            raise LLMGenerationError(str(event_payload["error"]))
        delta_text = _extract_ollama_delta(
            event_payload,
            allow_reasoning_fallback=not _is_gemma4_model(model),
        )
        if delta_text:
            chunks.append(delta_text)
            on_delta(delta_text)
        if event_payload.get("done"):
            break

    text = "".join(chunks).strip()
    if text:
        return LLMGenerationResult(text=text, provider="ollama", model=model)
    if _is_gemma4_model(model):
        raise LLMGenerationError("Ollama Gemma 4 returned no assistant text from /api/chat; /api/generate fallback is disabled for this model.")

    generate_payload: dict[str, Any] = {
        "model": model,
        "prompt": _ollama_generate_prompt(normalized_messages),
        "stream": True,
    }
    _apply_ollama_model_tuning(generate_payload, model=model, reasoning_effort=reasoning_effort)
    images = _ollama_last_user_images(normalized_messages)
    if images:
        generate_payload["images"] = images

    chunks = []
    for line in _post_json_stream_lines(f"{base_url}/api/generate", headers, generate_payload):
        try:
            event_payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event_payload.get("error"):
            raise LLMGenerationError(str(event_payload["error"]))
        delta_text = _extract_ollama_delta(event_payload)
        if delta_text:
            chunks.append(delta_text)
            on_delta(delta_text)
        if event_payload.get("done"):
            break

    text = "".join(chunks).strip()
    if not text:
        raise LLMGenerationError("Ollama server returned no assistant text.")
    return LLMGenerationResult(text=text, provider="ollama", model=model)


def _generate_anthropic_reply(
    settings: SidecarSettings,
    model: str,
    normalized_messages: list[dict[str, Any]],
) -> LLMGenerationResult:
    api_key = _resolve_api_key(settings, "anthropic")
    if not api_key:
        raise LLMGenerationError("Anthropic API Key가 비어 있습니다.")

    system_text, dialog_messages = _split_system_messages(normalized_messages)
    if not dialog_messages:
        raise LLMGenerationError("Anthropic 요청에는 user 또는 assistant 메시지가 필요합니다.")

    payload: dict[str, Any] = {
        "model": model,
        "max_tokens": 1024,
        "messages": [
            {"role": item["role"], "content": _anthropic_message_content(item)}
            for item in dialog_messages
        ],
    }
    if system_text:
        payload["system"] = system_text

    response_payload = _post_json(
        f"{_resolve_base_url(settings, 'anthropic')}/messages",
        {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
        },
        payload,
    )
    response_text = _extract_anthropic_text(response_payload)
    if not response_text:
        raise LLMGenerationError("Anthropic server returned no assistant text.")
    return LLMGenerationResult(text=response_text, provider="anthropic", model=model)


def _generate_gemini_reply(
    settings: SidecarSettings,
    model: str,
    normalized_messages: list[dict[str, Any]],
) -> LLMGenerationResult:
    api_key = _resolve_api_key(settings, "gemini")
    if not api_key:
        raise LLMGenerationError("Gemini API Key가 비어 있습니다.")

    system_text, dialog_messages = _split_system_messages(normalized_messages)
    if not dialog_messages:
        raise LLMGenerationError("Gemini 요청에는 user 또는 assistant 메시지가 필요합니다.")

    payload: dict[str, Any] = {
        "contents": [
            {
                "role": "user" if item["role"] == "user" else "model",
                "parts": _gemini_parts(item),
            }
            for item in dialog_messages
        ],
    }
    if system_text:
        payload["system_instruction"] = {"parts": [{"text": system_text}]}

    response_payload = _post_json(
        f"{_resolve_base_url(settings, 'gemini')}/models/{model}:generateContent",
        {
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        payload,
    )
    response_text = _extract_gemini_text(response_payload)
    if not response_text:
        raise LLMGenerationError("Gemini server returned no assistant text.")
    return LLMGenerationResult(text=response_text, provider="gemini", model=model)


def generate_session_reply(
    settings: SidecarSettings,
    messages: list[dict[str, Any]],
    *,
    model_override: str | None = None,
    reasoning_effort: str | None = None,
) -> LLMGenerationResult:
    provider = _normalize_provider(settings)
    model = (model_override or settings.llm_model).strip() or "gpt-4.1-mini"
    normalized_messages = _normalize_messages(messages)

    if provider == "ollama":
        return _generate_ollama_reply(
            settings,
            model,
            normalized_messages,
            reasoning_effort=reasoning_effort,
        )
    if provider in {"openai", "custom_openai"}:
        base_url = _resolve_base_url(settings, provider)
        if _looks_like_ollama_native(base_url):
            return _generate_ollama_reply(
                settings,
                model,
                normalized_messages,
                reasoning_effort=reasoning_effort,
            )
        return _generate_openai_family_reply(
            settings,
            provider,
            model,
            normalized_messages,
            try_responses=True,
            reasoning_effort=reasoning_effort,
        )
    if provider in {"openrouter", "featherless", "nvidia_nim"}:
        return _generate_openai_family_reply(
            settings,
            provider,
            model,
            normalized_messages,
            try_responses=False,
            reasoning_effort=reasoning_effort,
        )
    if provider == "anthropic":
        return _generate_anthropic_reply(settings, model, normalized_messages)
    if provider == "gemini":
        return _generate_gemini_reply(settings, model, normalized_messages)

    raise LLMGenerationError(f"지원하지 않는 LLM provider입니다: {settings.llm_provider}")


def generate_session_reply_streaming(
    settings: SidecarSettings,
    messages: list[dict[str, Any]],
    *,
    on_delta: Callable[[str], None],
    model_override: str | None = None,
    reasoning_effort: str | None = None,
) -> LLMGenerationResult:
    provider = _normalize_provider(settings)
    model = (model_override or settings.llm_model).strip() or "gpt-4.1-mini"
    normalized_messages = _normalize_messages(messages)

    if provider == "ollama":
        return _generate_ollama_reply_streaming(
            settings,
            model,
            normalized_messages,
            on_delta=on_delta,
            reasoning_effort=reasoning_effort,
        )
    if provider in {"openai", "custom_openai"}:
        base_url = _resolve_base_url(settings, provider)
        if _looks_like_ollama_native(base_url):
            return _generate_ollama_reply_streaming(
                settings,
                model,
                normalized_messages,
                on_delta=on_delta,
                reasoning_effort=reasoning_effort,
            )
        return _generate_openai_family_reply_streaming(
            settings,
            provider,
            model,
            normalized_messages,
            on_delta=on_delta,
            reasoning_effort=reasoning_effort,
        )
    if provider in {"openrouter", "featherless", "nvidia_nim"}:
        return _generate_openai_family_reply_streaming(
            settings,
            provider,
            model,
            normalized_messages,
            on_delta=on_delta,
            reasoning_effort=reasoning_effort,
        )

    result = generate_session_reply(
        settings,
        messages,
        model_override=model_override,
        reasoning_effort=reasoning_effort,
    )
    on_delta(result.text)
    return result
