from __future__ import annotations

from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _register_source(client, root: Path, label: str = "기획팀 업무자료") -> str:
    response = client.post(
        "/api/knowledge/sources",
        json={"label": label, "root_path": str(root)},
    )
    assert response.status_code == 201
    source_id = response.json()["id"]

    scan = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert scan.status_code == 200
    return source_id


def test_work_profile_can_be_saved_and_loaded(tmp_path: Path) -> None:
    client = _client(tmp_path)

    empty = client.get("/api/knowledge/work-profile")
    assert empty.status_code == 200
    assert empty.json()["org_name"] == ""
    assert empty.json()["duty_keywords"] == []

    saved = client.put(
        "/api/knowledge/work-profile",
        json={
            "org_name": "공무원",
            "department_name": "AI혁신과",
            "team_name": "업무자동화팀",
            "position": "주무관",
            "duty_keywords": ["AI", "업무자동화", "보고서"],
        },
    )

    assert saved.status_code == 200
    payload = saved.json()
    assert payload["department_name"] == "AI혁신과"
    assert payload["duty_keywords"] == ["AI", "업무자동화", "보고서"]

    loaded = client.get("/api/knowledge/work-profile")
    assert loaded.json()["team_name"] == "업무자동화팀"


def test_work_context_analysis_discovers_roles_families_and_questions(tmp_path: Path) -> None:
    root = tmp_path / "docs"
    (root / "규정").mkdir(parents=True)
    (root / "사업").mkdir()
    (root / "데이터").mkdir()
    (root / "규정" / "위임전결규정.md").write_text(
        "# 위임전결규정\n\nAI 사업 추진 시 전결 기준과 결재 절차를 따른다.",
        encoding="utf-8",
    )
    (root / "사업" / "AX플레이그라운드 계획서.md").write_text(
        "# AX플레이그라운드 계획서\n\nAI혁신과가 생산한 사업 추진계획이다.",
        encoding="utf-8",
    )
    (root / "사업" / "AX플레이그라운드 계획서_최종.md").write_text(
        "# AX플레이그라운드 계획서\n\n최종 제출본이다.",
        encoding="utf-8",
    )
    (root / "데이터" / "AX플레이그라운드 실적표.csv").write_text(
        "월,실적\n1월,10\n2월,20\n",
        encoding="utf-8",
    )

    client = _client(tmp_path)
    client.put(
        "/api/knowledge/work-profile",
        json={
            "org_name": "공무원",
            "department_name": "AI혁신과",
            "team_name": "업무자동화팀",
            "position": "주무관",
            "duty_keywords": ["AI", "AX플레이그라운드"],
        },
    )
    source_id = _register_source(client, root)

    analysis = client.post(f"/api/knowledge/sources/{source_id}/analyze-work-context")
    assert analysis.status_code == 200
    payload = analysis.json()

    assert payload["status"] == "completed"
    assert payload["summary"]["discovered_regulation_count"] == 1
    assert payload["summary"]["version_family_count"] == 1
    assert payload["summary"]["role_counts"]["policy_source"] == 1
    assert payload["summary"]["role_counts"]["work_product"] == 2
    assert payload["summary"]["role_counts"]["data_source"] == 1
    assert payload["summary"]["questions_needed"] == []
    assert any(item["family_relation"] == "final" for item in payload["classifications"])
    assert all("ranking_hint" in item for item in payload["classifications"])

    loaded = client.get(f"/api/knowledge/sources/{source_id}/analysis")
    assert loaded.status_code == 200
    assert loaded.json()["run_id"] == payload["run_id"]

    confirmed = client.post(
        f"/api/knowledge/sources/{source_id}/analysis/confirm",
        json={"run_id": payload["run_id"]},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["confirmed"] is True


def test_ingestion_embeds_work_context_in_document_metadata_and_graph(tmp_path: Path) -> None:
    root = tmp_path / "docs"
    root.mkdir()
    (root / "AI혁신과 업무분장표.md").write_text(
        "# AI혁신과 업무분장표\n\nAI혁신과는 업무자동화와 보고서 자동화를 담당한다.",
        encoding="utf-8",
    )

    client = _client(tmp_path)
    client.put(
        "/api/knowledge/work-profile",
        json={
            "org_name": "공무원",
            "department_name": "AI혁신과",
            "team_name": "업무자동화팀",
            "position": "주무관",
            "duty_keywords": ["업무자동화"],
        },
    )
    source_id = _register_source(client, root)
    client.post(f"/api/knowledge/sources/{source_id}/analyze-work-context")

    ingest = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})
    assert ingest.status_code == 201

    documents = client.get(f"/api/knowledge/documents?source_id={source_id}").json()["items"]
    assert len(documents) == 1
    metadata = documents[0]["metadata"]
    assert metadata["work_context"]["document_role"] == "org_source"
    assert metadata["work_context"]["department"] == "AI혁신과"
    assert metadata["work_context"]["needs_review"] is False

    db = client.app.state.services.db
    nodes = db.fetch_all("SELECT node_type, label FROM knowledge_graph_nodes")
    assert ("Department", "AI혁신과") in {(row["node_type"], row["label"]) for row in nodes}
    edges = db.fetch_all("SELECT relation FROM knowledge_graph_edges")
    assert "DOCUMENT_PRODUCED_BY_DEPARTMENT" in {row["relation"] for row in edges}


def test_work_aware_retrieval_prioritizes_policy_for_procedure_queries(tmp_path: Path) -> None:
    root = tmp_path / "docs"
    root.mkdir()
    (root / "계약규정.md").write_text(
        "# 계약규정\n\n계약 절차는 예산 검토, 위임전결 확인, 계약심사 순으로 처리한다.",
        encoding="utf-8",
    )
    (root / "계약 참고자료.md").write_text(
        "# 계약 참고자료\n\n계약 절차 관련 외부 참고자료와 사례를 모아 둔 문서이다.",
        encoding="utf-8",
    )

    client = _client(tmp_path)
    client.put(
        "/api/knowledge/work-profile",
        json={
            "org_name": "공무원",
            "department_name": "계약과",
            "team_name": "계약지원팀",
            "position": "주무관",
            "duty_keywords": ["계약", "전결"],
        },
    )
    source_id = _register_source(client, root)
    client.post(f"/api/knowledge/sources/{source_id}/analyze-work-context")
    client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})

    response = client.post(
        "/api/knowledge/retrieve",
        json={"query": "계약 절차와 전결 기준 알려줘", "limit": 5},
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["intent"]["key"] == "work_procedure"
    assert payload["items"][0]["document"]["metadata"]["work_context"]["document_role"] == "policy_source"
    assert payload["items"][0]["score_breakdown"]["policy_boost"] > 0
    assert "규정 문서를 우선 반영" in payload["items"][0]["ranking_explanation"]
