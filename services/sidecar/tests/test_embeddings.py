from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from gongmu_sidecar.embeddings import EmbeddingProviderError, embed_text, ollama_embed


def _embedding_with_hash_seed(seed: str) -> list[float]:
    sidecar_root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env["PYTHONHASHSEED"] = seed
    env["PYTHONPATH"] = (
        str(sidecar_root / "src")
        + os.pathsep
        + env.get("PYTHONPATH", "")
    )
    code = (
        "import json; "
        "from gongmu_sidecar.embeddings import hash_embed; "
        "print(json.dumps(hash_embed('policy budget project', dims=16)))"
    )
    output = subprocess.check_output([sys.executable, "-c", code], env=env, text=True)
    return json.loads(output)


def test_hash_embedding_is_stable_across_python_hash_seeds() -> None:
    assert _embedding_with_hash_seed("1") == _embedding_with_hash_seed("2")


def test_ollama_embed_uses_current_embed_endpoint_shape() -> None:
    calls: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def fake_post_json(
        url: str,
        headers: dict[str, str],
        payload: dict[str, object],
    ) -> dict[str, object]:
        calls.append((url, headers, payload))
        return {
            "model": "embeddinggemma",
            "embeddings": [[0.1, 0.2, 0.3]],
        }

    result = ollama_embed(
        "hello",
        model="embeddinggemma",
        base_url="http://127.0.0.1:11434",
        post_json=fake_post_json,
    )

    assert result.backend == "ollama"
    assert result.model == "embeddinggemma"
    assert result.vector == [0.1, 0.2, 0.3]
    assert calls == [
        (
            "http://127.0.0.1:11434/api/embed",
            {"Content-Type": "application/json"},
            {"model": "embeddinggemma", "input": "hello"},
        )
    ]


def test_embed_text_falls_back_to_deterministic_when_ollama_is_unavailable() -> None:
    def failing_post_json(
        url: str,
        headers: dict[str, str],
        payload: dict[str, object],
    ) -> dict[str, object]:
        raise EmbeddingProviderError("offline")

    result = embed_text(
        "offline fallback",
        provider="ollama",
        model="embeddinggemma",
        base_url="http://127.0.0.1:11434",
        post_json=failing_post_json,
    )

    assert result.backend == "deterministic-fallback"
    assert result.model == "hash"
    assert result.vector


def test_embed_text_can_require_ollama_without_fallback() -> None:
    def failing_post_json(
        url: str,
        headers: dict[str, str],
        payload: dict[str, object],
    ) -> dict[str, object]:
        raise EmbeddingProviderError("offline")

    with pytest.raises(EmbeddingProviderError, match="offline"):
        embed_text(
            "strict mode",
            provider="ollama",
            model="embeddinggemma",
            base_url="http://127.0.0.1:11434",
            fallback=False,
            post_json=failing_post_json,
        )
