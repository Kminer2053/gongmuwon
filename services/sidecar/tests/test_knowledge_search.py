from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_knowledge_search_and_graph_summary_are_exposed(tmp_path: Path) -> None:
    client = _client(tmp_path)

    candidate = client.post(
        "/api/knowledge/candidates/from-note",
        json={"title": "예산편성", "body": "예산편성 일정과 쟁점을 정리한다.", "candidate_type": "topic"},
    )
    candidate_id = candidate.json()["id"]
    client.post(f"/api/knowledge/candidates/{candidate_id}/approve", json={"page_type": "topic"})

    search = client.get("/api/knowledge/search", params={"query": "예산"})
    assert search.status_code == 200
    assert search.json()["vector_hits"]

    graph = client.get("/api/knowledge/graph")
    assert graph.status_code == 200
    payload = graph.json()
    assert payload["node_count"] >= 1
    assert payload["artifacts"]["graph_json_path"].endswith("graph.json")
