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


def _write_python_fake_runner(path: Path, *, selftest_success: bool = True) -> Path:
    """GONGMU_NODE_EXE=python 환경에서 실행 가능한 가짜 러너.

    kordoc_status()가 이제 `--selftest`를 실제 실행하므로, 상태 테스트용 러너는
    셀프테스트 프로토콜(성공 JSON + exit 0)에 응답해야 한다.
    """
    runner = path / "fake_kordoc_runner_py.js"
    runner.write_text(
        "import json, sys\n"
        f"ok = {selftest_success!r}\n"
        'if "--selftest" in sys.argv:\n'
        '    print(json.dumps({"success": ok, "selftest": True}))\n'
        "    sys.exit(0 if ok else 1)\n"
        'print(json.dumps({"success": True, "blocks": []}))\n',
        encoding="utf-8",
    )
    return runner


def test_parser_status_endpoint_reports_kordoc_runner_and_node_runtime(
    tmp_path: Path, monkeypatch
) -> None:
    runner = _write_python_fake_runner(tmp_path, selftest_success=True)
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
    assert payload["kordoc"]["selftest_ok"] is True


def test_parser_status_reports_unavailable_when_selftest_fails(
    tmp_path: Path, monkeypatch
) -> None:
    """러너 파일이 있고 node가 돌아도, kordoc 로드가 실패하면 available=False.

    2026-07-13 수용 테스트 사고 재발 방지: 설치본에서 '사용 가능'으로 표시된 채
    HWP 170건 전부가 무증상 metadata-fallback으로 떨어졌다.
    """
    runner = _write_python_fake_runner(tmp_path, selftest_success=False)
    monkeypatch.setenv("GONGMU_KORDOC_RUNNER", str(runner))
    monkeypatch.setenv("GONGMU_NODE_EXE", sys.executable)
    client = _client(tmp_path)

    response = client.get("/api/knowledge/parser-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["kordoc"]["runner_available"] is True
    assert payload["kordoc"]["node_available"] is True
    assert payload["kordoc"]["selftest_ok"] is False
    assert payload["kordoc"]["available"] is False


def test_resolve_node_prefers_env_then_bundled_then_path(tmp_path: Path, monkeypatch) -> None:
    from gongmu_sidecar.kordoc_bridge import _resolve_node

    runner_dir = tmp_path / "packaging" / "kordoc"
    runner_dir.mkdir(parents=True)
    runner = runner_dir / "kordoc_runner.js"
    runner.write_text("// stub\n", encoding="utf-8")

    monkeypatch.delenv("GONGMU_NODE_EXE", raising=False)
    # 동봉 node.exe가 없으면 PATH의 node
    assert _resolve_node(runner) == "node"

    # 러너 옆 동봉 런타임이 있으면 그것을 우선 사용 (폐쇄망 설치본 시나리오)
    bundled = runner_dir / ("node.exe" if os.name == "nt" else "node")
    bundled.write_bytes(b"fake node binary")
    assert _resolve_node(runner) == str(bundled)

    # 명시 환경변수가 최우선
    monkeypatch.setenv("GONGMU_NODE_EXE", sys.executable)
    assert _resolve_node(runner) == sys.executable


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
