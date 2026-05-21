from __future__ import annotations

import json
from pathlib import Path

from gongmu_sidecar.app import create_app
from gongmu_sidecar.embeddings import EmbeddingResult


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _register_scan_ingest(client, source: Path) -> str:
    created = client.post("/api/knowledge/sources", json={"label": "업무자료", "root_path": str(source)})
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201
    return source_id


def test_retrieval_quality_fixture_matches_expected_citation_and_relation(tmp_path: Path) -> None:
    cases = json.loads(
        (Path(__file__).parent / "fixtures" / "graphrag_eval_cases.json").read_text(encoding="utf-8")
    )
    client = _client(tmp_path)

    for case in cases:
        source = tmp_path / case["name"].replace(" ", "-")
        source.mkdir()
        for document in case["documents"]:
            (source / document["path"]).write_text(document["content"], encoding="utf-8")
        _register_scan_ingest(client, source)

        response = client.post("/api/knowledge/ask", json={"query": case["query"], "limit": 3})

        assert response.status_code == 200, case["name"]
        payload = response.json()
        citation = payload["citations"][0]
        assert citation["title"] == case["expected_title"]
        assert case["expected_relation"] in citation["relations"]
        assert citation["evidence_type"] == case["expected_evidence_type"]
        assert citation["quality_score"] >= case["min_quality_score"]
        assert payload["retrieval_summary"]["source_count"] >= 1


def test_retrieve_boosts_files_linked_to_active_work_session(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    linked = source / "linked-budget.md"
    linked.write_text("# 연결 예산 검토\n\n예산 검토 참고자료입니다.", encoding="utf-8")
    unlinked = source / "unlinked-budget.md"
    unlinked.write_text("# 일반 예산 검토\n\n예산 검토 참고자료입니다. 예산 예산 예산.", encoding="utf-8")
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    session = client.post("/api/work-sessions", json={"title": "예산 세션"}).json()
    link_response = client.post(
        f"/api/work-sessions/{session['id']}/file-links",
        json={"items": [{"file_path": str(linked), "source": "knowledge"}]},
    )
    assert link_response.status_code == 201

    response = client.post(
        "/api/knowledge/retrieve",
        json={"query": "예산 검토", "session_id": session["id"], "limit": 2},
    )

    assert response.status_code == 200
    first = response.json()["items"][0]
    assert first["document"]["file_path"] == str(linked)
    assert first["score_breakdown"]["session_context_boost"] > 0


def test_retrieve_uses_graph_terms_when_query_matches_policy_node(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "privacy.md").write_text(
        "# 민원 자동화 계획\n\n"
        "정책: 개인정보보호법\n\n"
        "## 추진내용\n\n"
        "민원 자동화 기능을 구축한다.",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    response = client.post("/api/knowledge/retrieve", json={"query": "개인정보보호법", "limit": 3})

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["document"]["title"] == "민원 자동화 계획"
    assert item["score_breakdown"]["graph_score"] > 0
    assert any(relation["relation"] == "REFERENCES" for relation in item["relations"])


def test_retrieve_uses_stored_embedding_similarity_without_text_overlap(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "alpha.md").write_text("# Alpha document\n\nBudget schedule material.", encoding="utf-8")
    (source / "beta.md").write_text("# Beta document\n\nPolicy archive material.", encoding="utf-8")
    client = _client(tmp_path)

    def fake_embedding(text: str) -> EmbeddingResult:
        normalized = text.lower()
        if "alpha" in normalized or "semantic query" in normalized:
            return EmbeddingResult(vector=[1.0, 0.0], backend="test-vector", model="fake")
        return EmbeddingResult(vector=[0.0, 1.0], backend="test-vector", model="fake")

    client.app.state.services.graphrag.embedding_provider = fake_embedding
    _register_scan_ingest(client, source)

    response = client.post("/api/knowledge/retrieve", json={"query": "semantic query", "limit": 1})

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["document"]["title"] == "Alpha document"
    assert item["score_breakdown"]["vector_score"] > 0


def test_retrieve_expands_korean_prompt_query_to_english_documents(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "prompt-guide.md").write_text(
        "# The Art of Prompt Engineering\n\n"
        "Prompt templates, system prompts, and instruction design are summarized here.",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    response = client.post("/api/knowledge/retrieve", json={"query": "프롬프트 관련 사항", "limit": 3})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"]
    assert payload["items"][0]["document"]["title"] == "The Art of Prompt Engineering"
    assert payload["items"][0]["score_breakdown"]["text_score"] > 0


def test_retrieve_demotes_low_quality_partial_documents_when_better_evidence_exists(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    low_quality = source / "low.md"
    low_quality.write_text(
        "# 스캔 실패 문서\n\n"
        "정책: 개인정보보호법\n\n"
        "개인정보보호법 관련 메타데이터만 남은 문서입니다.",
        encoding="utf-8",
    )
    good = source / "good.md"
    good.write_text(
        "# 검증된 개인정보보호법 근거\n\n"
        "개인정보보호법 준수를 위한 민원 상담 자동화 추진 근거입니다.",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    low_document = next(
        item
        for item in client.get("/api/knowledge/documents").json()["items"]
        if item["title"] == "스캔 실패 문서"
    )
    client.app.state.services.db.execute(
        "UPDATE knowledge_documents SET quality_score = ?, partial = ? WHERE id = ?",
        (0.0, 1, low_document["id"]),
    )

    response = client.post("/api/knowledge/retrieve", json={"query": "개인정보보호법", "limit": 2})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["document"]["title"] == "검증된 개인정보보호법 근거"
    low_item = next(item for item in payload["items"] if item["document"]["title"] == "스캔 실패 문서")
    assert low_item["score_breakdown"]["quality_penalty"] < 0


def test_ask_returns_grounded_answer_with_citations(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "service.md").write_text(
        "# 공공서비스 개선계획\n\n"
        "업무: 민원 상담 자동화\n"
        "정책: 개인정보보호법\n\n"
        "## 세부추진계획\n\n"
        "개인정보보호법을 준수하면서 민원 상담 자동화를 추진한다.",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    response = client.post("/api/knowledge/ask", json={"query": "민원 상담 자동화 근거", "limit": 2})

    assert response.status_code == 200
    payload = response.json()
    assert "공공서비스 개선계획" in payload["answer"]
    assert "개인정보보호법" in payload["answer"]
    assert payload["citations"][0]["title"] == "공공서비스 개선계획"
    assert payload["citations"][0]["chunk_id"]
    assert "REFERENCES" in payload["citations"][0]["relations"]
    assert payload["citations"][0]["parser_name"] == "gongmu-markdown"
    assert payload["citations"][0]["quality_score"] > 0.8
    assert payload["citations"][0]["partial"] is False


def test_ask_citation_exposes_table_evidence_and_score_breakdown(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "budget.md").write_text(
        "# Budget plan\n\n"
        "Document number: BUD-2026-01\n\n"
        "## Budget table\n\n"
        "| Item | Amount |\n"
        "| --- | --- |\n"
        "| Training | 1,000 |\n",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    response = client.post("/api/knowledge/ask", json={"query": "1,000", "limit": 1})

    assert response.status_code == 200
    payload = response.json()
    citation = payload["citations"][0]
    assert citation["evidence_type"] == "table"
    assert citation["quality_warnings"] == []
    assert citation["score_breakdown"]["text_score"] > 0
    assert payload["retrieval_summary"]["source_count"] == 1
    assert payload["retrieval_summary"]["table_evidence_count"] == 1


def test_ask_citation_exposes_low_quality_warnings(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "scan.txt").write_text("scan", encoding="utf-8")
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    response = client.post("/api/knowledge/ask", json={"query": "scan", "limit": 1})

    assert response.status_code == 200
    payload = response.json()
    citation = payload["citations"][0]
    assert citation["evidence_type"] == "section"
    assert "low_text" in citation["quality_warnings"]
    assert payload["retrieval_summary"]["low_quality_count"] == 1
