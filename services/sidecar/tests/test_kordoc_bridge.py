from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from gongmu_sidecar.app import create_app
from gongmu_sidecar.document_parsers import parse_document
from gongmu_sidecar.kordoc_bridge import parse_with_kordoc


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _write_fake_runner(path: Path, payload: dict[str, object]) -> Path:
    runner = path / "fake_kordoc_runner.js"
    runner.write_text(
        "const payload = "
        + json.dumps(payload, ensure_ascii=False)
        + ";\nconsole.log(JSON.stringify(payload));\n",
        encoding="utf-8",
    )
    return runner


def test_parser_status_endpoint_reports_kordoc_runner_and_node_runtime(
    tmp_path: Path, monkeypatch
) -> None:
    runner = _write_fake_runner(tmp_path, {"success": True, "blocks": []})
    monkeypatch.setenv("GONGMU_KORDOC_RUNNER", str(runner))
    monkeypatch.setenv("GONGMU_NODE_EXE", sys.executable)
    client = _client(tmp_path)

    response = client.get("/api/knowledge/parser-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["kordoc"]["available"] is True
    assert payload["kordoc"]["runner_available"] is True
    assert payload["kordoc"]["runner_path"] == str(runner.resolve())
    assert payload["kordoc"]["node_available"] is True
    assert payload["kordoc"]["node_command"] == sys.executable


def test_parser_status_prefers_pyinstaller_meipass_kordoc_runner(tmp_path: Path, monkeypatch) -> None:
    bundled_root = tmp_path / "_internal"
    runner_dir = bundled_root / "packaging" / "kordoc"
    runner_dir.mkdir(parents=True)
    runner = runner_dir / "kordoc_runner.js"
    runner.write_text("console.log(JSON.stringify({ success: true, blocks: [] }));\n", encoding="utf-8")
    monkeypatch.setattr(sys, "_MEIPASS", str(bundled_root), raising=False)
    monkeypatch.setenv("GONGMU_NODE_EXE", sys.executable)
    client = _client(tmp_path)

    response = client.get("/api/knowledge/parser-status")

    assert response.status_code == 200
    assert response.json()["kordoc"]["runner_path"] == str(runner.resolve())


def test_kordoc_bridge_converts_runner_json_to_structured_document(
    tmp_path: Path, monkeypatch
) -> None:
    document_path = tmp_path / "sample.hwp"
    document_path.write_bytes(b"fake hwp")
    runner = _write_fake_runner(
        tmp_path,
        {
            "success": True,
            "parser": "kordoc",
            "version": "2.test",
            "metadata": {
                "title": "사업계획",
                "document_number": "ABC-123",
                "sender_org": "기획팀",
                "receiver_org": "총무팀",
            },
            "markdown": "# 사업계획\n\n## 추진배경\n본문",
            "blocks": [
                {"type": "heading", "text": "사업계획", "level": 1},
                {"type": "heading", "text": "세부추진계획", "level": 2},
                {"type": "paragraph", "text": "본문"},
                {
                    "type": "table",
                    "caption": "세부사업",
                    "headers": ["항목"],
                    "rows": [["사업 A"]],
                },
            ],
        },
    )
    monkeypatch.setenv("GONGMU_KORDOC_RUNNER", str(runner))

    document = parse_with_kordoc(document_path)

    assert document.title == "사업계획"
    assert document.parser_name == "kordoc"
    assert document.parser_version == "2.test"
    assert document.metadata["document_number"] == "ABC-123"
    assert [section.heading for section in document.sections] == ["사업계획", "세부추진계획"]
    assert document.sections[1].paragraphs == ["본문"]
    assert document.sections[1].tables[0].headers == ["항목"]
    assert document.sections[1].tables[0].rows == [["사업 A"]]


def test_parse_document_prefers_kordoc_for_hwpx(tmp_path: Path, monkeypatch) -> None:
    document_path = tmp_path / "sample.hwpx"
    document_path.write_bytes(b"fake hwpx")
    runner = _write_fake_runner(
        tmp_path,
        {
            "success": True,
            "parser": "kordoc",
            "version": "2.test",
            "metadata": {"title": "HWPX 문서"},
            "blocks": [{"type": "heading", "text": "HWPX 문서", "level": 1}],
        },
    )
    monkeypatch.setenv("GONGMU_KORDOC_RUNNER", str(runner))

    document = parse_document(document_path)

    assert document.title == "HWPX 문서"
    assert document.parser_name == "kordoc"


def test_parse_document_falls_back_when_kordoc_runner_fails(tmp_path: Path, monkeypatch) -> None:
    document_path = tmp_path / "fallback.hwpx"
    with ZipFile(document_path, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "Contents/section0.xml",
            "<?xml version='1.0' encoding='UTF-8'?><root><t>Fallback text</t></root>",
        )
    runner = _write_fake_runner(tmp_path, {"success": False, "error": "encrypted"})
    monkeypatch.setenv("GONGMU_KORDOC_RUNNER", str(runner))

    document = parse_document(document_path)

    assert document.parser_name == "gongmu-zip-xml"
    assert document.sections[0].paragraphs == ["Fallback text"]


def test_parse_hwpx_endpoint_returns_structured_document(tmp_path: Path, monkeypatch) -> None:
    document_path = tmp_path / "api.hwpx"
    document_path.write_bytes(b"fake hwpx")
    runner = _write_fake_runner(
        tmp_path,
        {
            "success": True,
            "parser": "kordoc",
            "version": "2.test",
            "metadata": {"title": "API 문서"},
            "blocks": [
                {"type": "heading", "text": "API 문서", "level": 1},
                {"type": "table", "headers": ["항목"], "rows": [["값"]]},
            ],
        },
    )
    monkeypatch.setenv("GONGMU_KORDOC_RUNNER", str(runner))
    client = _client(tmp_path)

    response = client.post("/api/knowledge/parse-hwpx", json={"file_path": str(document_path)})

    assert response.status_code == 200
    payload = response.json()
    assert payload["document"]["title"] == "API 문서"
    assert payload["document"]["parser_name"] == "kordoc"
    assert payload["sections"][0]["heading"] == "API 문서"
    assert payload["tables"][0]["headers"] == ["항목"]
