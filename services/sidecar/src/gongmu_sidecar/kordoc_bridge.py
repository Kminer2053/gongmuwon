from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from .graphrag_models import StructuredDocument, StructuredSection, StructuredTable


class KORdocUnavailable(RuntimeError):
    pass


class KORdocParseError(RuntimeError):
    pass


def _resolve_node(runner: Path | None = None) -> str:
    """kordoc 실행용 Node 런타임을 찾는다.

    우선순위: 명시 환경변수 > 러너 옆에 동봉된 node.exe(폐쇄망 설치본) > PATH.
    폐쇄망 사용자 PC에는 시스템 Node가 없으므로 동봉본이 사실상의 기본이다.
    """
    env_node = os.environ.get("GONGMU_NODE_EXE")
    if env_node:
        return env_node
    if runner is None:
        try:
            runner = _resolve_runner()
        except KORdocUnavailable:
            return "node"
    bundled = runner.parent / ("node.exe" if os.name == "nt" else "node")
    if bundled.exists():
        return str(bundled)
    return "node"


def parse_with_kordoc(path: Path | str, timeout_seconds: int = 60) -> StructuredDocument:
    source_path = Path(path).expanduser().resolve()
    runner = _resolve_runner()
    node = _resolve_node(runner)
    try:
        completed = subprocess.run(
            [node, str(runner), str(source_path)],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout_seconds,
        )
    except FileNotFoundError as exc:
        raise KORdocUnavailable("Node runtime is not available for KORdoc parsing") from exc
    except subprocess.TimeoutExpired as exc:
        raise KORdocParseError("KORdoc parser timed out") from exc

    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "KORdoc runner failed"
        raise KORdocParseError(message)

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise KORdocParseError("KORdoc runner returned invalid JSON") from exc

    if not payload.get("success"):
        raise KORdocParseError(str(payload.get("error") or "KORdoc parser returned success=false"))

    return _structured_document_from_payload(source_path, payload)


def kordoc_available() -> bool:
    try:
        _resolve_runner()
    except KORdocUnavailable:
        return False
    return True


def kordoc_status(timeout_seconds: int = 5) -> dict[str, Any]:
    runner_available = False
    runner_path: str | None = None
    runner_error: str | None = None
    runner_obj: Path | None = None
    try:
        runner_obj = _resolve_runner()
        runner_available = True
        runner_path = str(runner_obj)
    except KORdocUnavailable as exc:
        runner_error = str(exc)
    node_command = _resolve_node(runner_obj)

    node_available = False
    node_version: str | None = None
    node_error: str | None = None
    try:
        completed = subprocess.run(
            [node_command, "--version"],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout_seconds,
        )
        node_available = completed.returncode == 0
        node_version = (completed.stdout.strip() or completed.stderr.strip()) or None
        if not node_available:
            node_error = node_version or f"{node_command} --version exited {completed.returncode}"
    except FileNotFoundError as exc:
        node_error = str(exc)
    except subprocess.TimeoutExpired:
        node_error = f"{node_command} --version timed out"

    # 실제 import까지 검증하는 셀프테스트 — 러너 파일 존재+node 버전만 보고
    # "사용 가능"이라 답했다가 실사용에서 전부 폴백된 사고(2026-07-13)의 재발 방지.
    selftest_ok = False
    selftest_error: str | None = None
    if runner_available and node_available:
        try:
            completed = subprocess.run(
                [node_command, str(runner_obj), "--selftest"],
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=max(timeout_seconds, 15),
            )
            try:
                payload = json.loads((completed.stdout or "").strip().splitlines()[-1])
            except (json.JSONDecodeError, IndexError):
                payload = {}
            selftest_ok = bool(payload.get("success"))
            if not selftest_ok:
                selftest_error = str(
                    payload.get("error")
                    or completed.stderr.strip()
                    or f"selftest exited {completed.returncode}"
                )
        except (OSError, subprocess.TimeoutExpired) as exc:
            selftest_error = str(exc)

    return {
        "available": runner_available and node_available and selftest_ok,
        "runner_available": runner_available,
        "runner_path": runner_path,
        "runner_error": runner_error,
        "node_available": node_available,
        "node_command": node_command,
        "node_version": node_version,
        "node_error": node_error,
        "selftest_ok": selftest_ok,
        "selftest_error": selftest_error,
    }


def _resolve_runner() -> Path:
    env_runner = os.environ.get("GONGMU_KORDOC_RUNNER")
    candidates: list[Path] = []
    if env_runner:
        candidates.append(Path(env_runner).expanduser())

    pyinstaller_root = getattr(sys, "_MEIPASS", None)
    if pyinstaller_root:
        candidates.append(Path(str(pyinstaller_root)) / "packaging" / "kordoc" / "kordoc_runner.js")

    package_runner = Path(__file__).resolve().parents[2] / "packaging" / "kordoc" / "kordoc_runner.js"
    candidates.append(package_runner)

    bundled_runner = Path(__file__).resolve().parents[1] / "packaging" / "kordoc" / "kordoc_runner.js"
    candidates.append(bundled_runner)

    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.exists() and resolved.is_file():
            return resolved
    raise KORdocUnavailable("KORdoc runner is not configured")


def _structured_document_from_payload(source_path: Path, payload: dict[str, Any]) -> StructuredDocument:
    metadata = dict(payload.get("metadata") or {})
    blocks = list(payload.get("blocks") or [])
    sections: list[StructuredSection] = []
    current: StructuredSection | None = None

    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_type = str(block.get("type") or "").lower()
        if block_type == "heading":
            text = _block_text(block)
            if not text:
                continue
            current = StructuredSection(heading=text, level=int(block.get("level") or 1))
            sections.append(current)
            continue
        if current is None:
            current = StructuredSection(heading=str(metadata.get("title") or source_path.stem), level=1)
            sections.append(current)
        if block_type == "paragraph":
            text = _block_text(block)
            if text:
                current.paragraphs.append(text)
        elif block_type == "table":
            current.tables.append(_table_from_block(block))

    if not sections:
        markdown = str(payload.get("markdown") or "").strip()
        heading = str(metadata.get("title") or source_path.stem)
        sections = [StructuredSection(heading=heading, paragraphs=[markdown] if markdown else [])]

    title = str(metadata.get("title") or sections[0].heading or source_path.stem)
    return StructuredDocument(
        source_path=source_path,
        title=title,
        document_type=source_path.suffix.lower().lstrip(".") or "hwp",
        sections=sections,
        metadata=metadata,
        parser_name=str(payload.get("parser") or "kordoc"),
        parser_version=str(payload.get("version") or ""),
        quality_score=float(payload.get("quality_score") or 0.9),
        partial=bool(payload.get("partial") or False),
    )


def _block_text(block: dict[str, Any]) -> str:
    return str(block.get("text") or block.get("content") or "").strip()


def _table_from_block(block: dict[str, Any]) -> StructuredTable:
    table = block.get("table") if isinstance(block.get("table"), dict) else block
    headers = _string_list(table.get("headers") or table.get("header") or [])
    rows = [_string_list(row) for row in list(table.get("rows") or []) if isinstance(row, list)]
    return StructuredTable(
        headers=headers,
        rows=rows,
        caption=str(table.get("caption")).strip() if table.get("caption") else None,
    )


def _string_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return [str(value).strip() for value in values]
