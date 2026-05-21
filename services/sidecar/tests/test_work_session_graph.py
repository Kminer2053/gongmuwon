from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_work_session_graph_connects_session_file_links_and_source_files(tmp_path: Path) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    file_path = source / "budget.md"
    file_path.write_text("# 예산 검토\n\n예산편성 회의자료", encoding="utf-8")

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "예산 검토 세션"})
    session_id = session.json()["id"]
    client.post(
        f"/api/work-sessions/{session_id}/file-links",
        json={"items": [{"file_path": str(file_path), "label": "예산자료", "source": "manual"}]},
    )
    knowledge_source = client.post(
        "/api/knowledge/sources",
        json={"label": "업무자료", "root_path": str(source)},
    )
    client.post(f"/api/knowledge/sources/{knowledge_source.json()['id']}/scan")

    graph = client.get(f"/api/work-sessions/{session_id}/graph")
    assert graph.status_code == 200
    payload = graph.json()
    node_types = {node["node_type"] for node in payload["nodes"]}
    assert {"work_session", "linked_file", "source_file", "source_folder"}.issubset(node_types)
    assert any(edge["relation"] == "links_file" for edge in payload["edges"])
    assert any(edge["relation"] == "indexed_as" for edge in payload["edges"])
