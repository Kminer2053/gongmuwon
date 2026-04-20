from __future__ import annotations

import math
import re


TOKEN_RE = re.compile(r"[\w가-힣]+", re.UNICODE)


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text.lower())


def hash_embed(text: str, dims: int = 64) -> list[float]:
    vector = [0.0 for _ in range(dims)]
    for token in tokenize(text):
        idx = hash(token) % dims
        vector[idx] += 1.0

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector

    return [value / norm for value in vector]

