from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_knowledge_search_and_graph_summary_are_exposed(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "budget.md").write_text("# 예산편성 정리\n\n예산편성 일정과 쟁점을 정리한다.", encoding="utf-8")
    client = _client(tmp_path)
    created = client.post("/api/knowledge/sources", json={"label": "업무자료", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201

    search = client.get("/api/knowledge/search", params={"query": "예산편성"})
    assert search.status_code == 200
    payload = search.json()
    assert payload["items"]
    assert payload["items"][0]["title"] == "예산편성 정리"
    assert payload["items"][0]["source_path"].endswith("budget.md")

    graph = client.get("/api/knowledge/graph")
    assert graph.status_code == 200
    graph_payload = graph.json()
    assert graph_payload["engine"] == "wiki"
    assert graph_payload["node_count"] >= 2
    assert graph_payload["edge_count"] >= 1
    assert graph_payload["artifacts"]["graph_json_path"].endswith("graph.json")


def test_duplicate_knowledge_titles_get_distinct_canonical_paths(tmp_path: Path) -> None:
    client = _client(tmp_path)

    first_candidate = client.post(
        "/api/knowledge/candidates/from-note",
        json={"title": "Budget Topic", "body": "first body", "candidate_type": "topic"},
    )
    second_candidate = client.post(
        "/api/knowledge/candidates/from-note",
        json={"title": "Budget Topic", "body": "second body", "candidate_type": "topic"},
    )

    first_page = client.post(
        f"/api/knowledge/candidates/{first_candidate.json()['id']}/approve",
        json={"page_type": "topic"},
    )
    second_page = client.post(
        f"/api/knowledge/candidates/{second_candidate.json()['id']}/approve",
        json={"page_type": "topic"},
    )

    assert first_page.status_code == 200
    assert second_page.status_code == 200

    first_path = Path(first_page.json()["page"]["path"])
    second_path = Path(second_page.json()["page"]["path"])
    assert first_path.exists()
    assert second_path.exists()
    assert first_path != second_path
    assert first_path.read_text(encoding="utf-8") != second_path.read_text(encoding="utf-8")
