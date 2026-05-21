from __future__ import annotations

import ctypes
import hashlib
import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


EXCLUDED_DIR_NAMES = {
    "$recycle.bin",
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "__pycache__",
    "node_modules",
    "system volume information",
    "windows",
}


def _env_roots() -> list[Path]:
    raw = os.getenv("GONGMU_FILE_SEARCH_ROOTS", "").strip()
    if not raw:
        return []
    return [Path(item).expanduser() for item in raw.split(os.pathsep) if item.strip()]


def _windows_fixed_drives() -> list[Path]:
    if os.name != "nt":
        return []

    drives: list[Path] = []
    bitmask = ctypes.windll.kernel32.GetLogicalDrives()
    drive_fixed = 3
    for index in range(26):
        if not bitmask & (1 << index):
            continue
        root = f"{chr(65 + index)}:\\"
        if ctypes.windll.kernel32.GetDriveTypeW(root) == drive_fixed:
            drives.append(Path(root))
    return drives


def default_search_roots() -> list[Path]:
    roots = _env_roots()
    if roots:
        return roots
    if os.getenv("PYTEST_CURRENT_TEST"):
        return []
    if os.name == "nt":
        return _windows_fixed_drives()
    return [Path.home()]


def _safe_stat(path: Path) -> os.stat_result | None:
    try:
        return path.stat()
    except OSError:
        return None


def _is_excluded_dir(path: Path) -> bool:
    return path.name.lower() in EXCLUDED_DIR_NAMES


def _build_file_payload(path: Path, root: Path, score: int, reasons: list[str]) -> dict[str, Any]:
    stat = _safe_stat(path)
    modified_at = (
        datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
        if stat
        else datetime.now(timezone.utc).isoformat()
    )
    size_bytes = stat.st_size if stat else 0
    path_text = str(path)
    root_text = str(root)
    try:
        relative_path = path.relative_to(root).as_posix()
    except ValueError:
        relative_path = path.name

    return {
        "file": {
            "id": f"local:{hashlib.sha1(path_text.encode('utf-8', errors='ignore')).hexdigest()}",
            "source_id": "local-pc",
            "file_path": path_text,
            "relative_path": relative_path,
            "file_hash": hashlib.sha1(f"{path_text}|{size_bytes}|{modified_at}".encode("utf-8")).hexdigest(),
            "size_bytes": size_bytes,
            "modified_at": modified_at,
            "status": "filename_match",
            "title": path.name,
            "mime_type": None,
            "text_excerpt": None,
            "extracted_text_path": None,
            "created_at": modified_at,
            "updated_at": modified_at,
        },
        "score": score,
        "match_reasons": reasons,
        "search_root": root_text,
    }


def _normalize_filename_text(value: str) -> str:
    return unicodedata.normalize("NFC", value).casefold()


def _compact_filename_text(value: str) -> str:
    return re.sub(r"[\W_]+", "", _normalize_filename_text(value), flags=re.UNICODE)


def compact_filename_text(value: str) -> str:
    return _compact_filename_text(value)


def _filename_terms(value: str) -> list[str]:
    return [term for term in re.split(r"[\W_]+", _normalize_filename_text(value), flags=re.UNICODE) if term]


def _display_match_reasons(score: int) -> list[str]:
    if score >= 260:
        return ["파일명 정확 일치"]
    if score == 240:
        return ["파일명 구분자 무시 일치"]
    if score == 180:
        return ["파일명 시작 일치"]
    if score == 170:
        return ["파일명 구분자 무시 시작 일치", "파일명 단어 일치"]
    if score == 120:
        return ["파일명 포함"]
    return ["파일명 단어 일치"]


def _score_filename(name: str, query: str) -> tuple[int, list[str]]:
    normalized_name = _normalize_filename_text(name)
    normalized_stem = _normalize_filename_text(Path(name).stem)
    normalized_query = _normalize_filename_text(query)
    compact_name = _compact_filename_text(normalized_name)
    compact_stem = _compact_filename_text(normalized_stem)
    compact_query = _compact_filename_text(normalized_query)
    query_terms = _filename_terms(normalized_query)

    if normalized_name == normalized_query:
        return 300, ["파일명 정확 일치"]
    if normalized_stem == normalized_query:
        return 260, ["파일명 정확 일치"]
    if compact_query and compact_stem == compact_query:
        return 240, ["파일명 구분자 무시 일치"]
    if compact_query and compact_name.startswith(compact_query):
        return 170, ["파일명 구분자 무시 시작 일치", "파일명 단어 일치"]
    if normalized_name.startswith(normalized_query):
        return 180, ["파일명 시작 일치"]
    if normalized_query in normalized_name:
        return 120, ["파일명 포함"]
    if compact_query and compact_query in compact_name:
        return 110, ["파일명 단어 일치"]
    if query_terms and all(term in compact_name for term in query_terms):
        return 95, ["파일명 단어 일치"]
    return 0, []


def score_filename(name: str, query: str) -> tuple[int, list[str]]:
    score, _reasons = _score_filename(name, query)
    return score, _display_match_reasons(score) if score > 0 else []


def scan_local_files_for_index(
    *,
    roots: list[Path] | None = None,
    max_seconds: float | None = None,
) -> dict[str, Any]:
    deadline = time.monotonic() + float(
        max_seconds if max_seconds is not None else os.getenv("GONGMU_FILE_SEARCH_MAX_SECONDS", "8")
    )
    resolved_roots = [root.resolve() for root in (roots or default_search_roots()) if root.exists()]
    items: list[dict[str, Any]] = []
    partial = False

    for root in resolved_roots:
        stack = [root]
        while stack:
            if time.monotonic() > deadline:
                partial = True
                break

            current = stack.pop()
            try:
                with os.scandir(current) as iterator:
                    entries = list(iterator)
            except OSError:
                continue

            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        entry_path = Path(entry.path)
                        if not _is_excluded_dir(entry_path):
                            stack.append(entry_path)
                        continue
                    if not entry.is_file(follow_symlinks=False):
                        continue
                except OSError:
                    continue

                items.append(_build_file_payload(Path(entry.path), root, 0, []))

        if partial:
            break

    return {
        "items": items,
        "indexed_count": len(items),
        "searched_roots": [str(root) for root in resolved_roots],
        "partial": partial,
    }


def search_local_files_by_name(
    *,
    query: str,
    limit: int = 20,
    roots: list[Path] | None = None,
    max_seconds: float | None = None,
) -> dict[str, Any]:
    normalized_query = query.strip()
    if not normalized_query:
        return {"query": query, "items": [], "scope": "local_filename", "partial": False}

    safe_limit = max(1, min(limit, 100))
    deadline = time.monotonic() + float(
        max_seconds if max_seconds is not None else os.getenv("GONGMU_FILE_SEARCH_MAX_SECONDS", "8")
    )
    resolved_roots = [root.resolve() for root in (roots or default_search_roots()) if root.exists()]
    hits: list[dict[str, Any]] = []
    partial = False

    for root in resolved_roots:
        stack = [root]
        while stack:
            if time.monotonic() > deadline:
                partial = True
                break

            current = stack.pop()
            try:
                with os.scandir(current) as iterator:
                    entries = list(iterator)
            except OSError:
                continue

            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        entry_path = Path(entry.path)
                        if not _is_excluded_dir(entry_path):
                            stack.append(entry_path)
                        continue
                    if not entry.is_file(follow_symlinks=False):
                        continue
                except OSError:
                    continue

                score, reasons = score_filename(entry.name, normalized_query)
                if score <= 0:
                    continue
                hits.append(_build_file_payload(Path(entry.path), root, score, reasons))

            if len(hits) >= safe_limit * 5:
                hits.sort(key=lambda item: (item["score"], item["file"]["updated_at"]), reverse=True)
                hits = hits[: safe_limit * 2]

        if partial:
            break

    hits.sort(key=lambda item: (item["score"], item["file"]["updated_at"]), reverse=True)
    return {
        "query": query,
        "items": hits[:safe_limit],
        "scope": "local_filename",
        "searched_roots": [str(root) for root in resolved_roots],
        "partial": partial,
    }
