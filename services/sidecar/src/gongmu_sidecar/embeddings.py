from __future__ import annotations

import math
import json
import os
import re
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Callable
from urllib import error, request


TOKEN_RE = re.compile(r"[\w가-힣]+", re.UNICODE)
DEFAULT_OLLAMA_EMBEDDING_BASE_URL = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_EMBEDDING_MODEL = "nomic-embed-text"


class EmbeddingProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class EmbeddingResult:
    vector: list[float]
    backend: str
    model: str


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text.lower())


def stable_token_index(token: str, dims: int) -> int:
    digest = sha256(token.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % dims


def hash_embed(text: str, dims: int = 64) -> list[float]:
    vector = [0.0 for _ in range(dims)]
    for token in tokenize(text):
        idx = stable_token_index(token, dims)
        vector[idx] += 1.0

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector

    return [value / norm for value in vector]


def _normalize_base_url(base_url: str) -> str:
    return base_url.rstrip("/")


def _post_json(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    req = request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        timeout = int(os.getenv("GONGMU_EMBEDDING_TIMEOUT_SECONDS", "60"))
        with request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise EmbeddingProviderError(f"embedding request failed ({exc.code}): {detail}") from exc
    except error.URLError as exc:
        raise EmbeddingProviderError(f"embedding server unreachable: {exc.reason}") from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise EmbeddingProviderError("embedding server returned invalid JSON.") from exc

    if not isinstance(data, dict):
        raise EmbeddingProviderError("embedding server returned an unexpected response shape.")
    return data


PostJson = Callable[[str, dict[str, str], dict[str, Any]], dict[str, Any]]


def _coerce_vector(value: Any) -> list[float]:
    if not isinstance(value, list) or not value:
        raise EmbeddingProviderError("embedding server returned an empty vector.")
    vector: list[float] = []
    for item in value:
        if not isinstance(item, int | float):
            raise EmbeddingProviderError("embedding vector contains a non-numeric value.")
        vector.append(float(item))
    return vector


def ollama_embed(
    text: str,
    *,
    model: str = DEFAULT_OLLAMA_EMBEDDING_MODEL,
    base_url: str = DEFAULT_OLLAMA_EMBEDDING_BASE_URL,
    post_json: PostJson = _post_json,
) -> EmbeddingResult:
    payload = post_json(
        f"{_normalize_base_url(base_url)}/api/embed",
        {"Content-Type": "application/json"},
        {"model": model, "input": text},
    )
    embeddings = payload.get("embeddings")
    if not isinstance(embeddings, list) or not embeddings:
        raise EmbeddingProviderError("Ollama returned no embeddings.")
    return EmbeddingResult(
        vector=_coerce_vector(embeddings[0]),
        backend="ollama",
        model=str(payload.get("model") or model),
    )


def deterministic_embed(text: str, *, backend: str = "deterministic") -> EmbeddingResult:
    return EmbeddingResult(vector=hash_embed(text), backend=backend, model="hash")


def embed_text(
    text: str,
    *,
    provider: str = "deterministic",
    model: str | None = None,
    base_url: str | None = None,
    fallback: bool = True,
    post_json: PostJson = _post_json,
) -> EmbeddingResult:
    normalized_provider = provider.strip().lower().replace("-", "_").replace(" ", "_")
    if normalized_provider in {"ollama", "ollama_native"}:
        try:
            return ollama_embed(
                text,
                model=model or DEFAULT_OLLAMA_EMBEDDING_MODEL,
                base_url=base_url or DEFAULT_OLLAMA_EMBEDDING_BASE_URL,
                post_json=post_json,
            )
        except EmbeddingProviderError:
            if not fallback:
                raise
            return deterministic_embed(text, backend="deterministic-fallback")

    return deterministic_embed(text)

