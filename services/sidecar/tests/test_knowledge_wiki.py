"""지식폴더 2.0 (LLM 위키 + FTS5) 계약 테스트."""

from __future__ import annotations

import json
import sys
import unicodedata
from pathlib import Path

import pytest

from gongmu_sidecar.app import create_app
from gongmu_sidecar.kordoc_bridge import kordoc_status
from gongmu_sidecar.llm import LLMGenerationResult


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _register_scan_ingest(client, source: Path, label: str = "업무자료") -> str:
    created = client.post("/api/knowledge/sources", json={"label": label, "root_path": str(source)})
    assert created.status_code == 201
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code == 201
    return source_id


def _make_source(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    (source / "plan.md").write_text(
        "# 사업계획\n\n"
        "## 추진배경\n\n"
        "지역 예산편성 사업의 추진배경입니다. 개인정보보호법을 준수합니다.\n\n"
        "## 세부추진계획\n\n"
        "| 항목 | 예산 |\n"
        "| --- | --- |\n"
        "| 민원 자동화 | 100 |\n",
        encoding="utf-8",
    )
    (source / "memo.txt").write_text("회의록: 민원 상담 자동화 회의 결과 정리.", encoding="utf-8")
    return source


def test_ingest_creates_wiki_artifacts_with_front_matter(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    wiki_root = tmp_path / "knowledge-wiki"
    assert (wiki_root / "index.md").exists()
    assert (wiki_root / "log.md").exists()

    cards = sorted((wiki_root / "docs").glob("*.md"))
    assert len(cards) == 2
    card_text = next(card for card in cards if "사업계획" in card.name).read_text(encoding="utf-8")
    assert card_text.startswith("---")
    assert "source_path:" in card_text
    assert "quality_score:" in card_text
    assert "## 개요" in card_text
    assert "## 섹션 아웃라인" in card_text
    assert "## 표 요약" in card_text
    assert "## 키워드" in card_text
    assert "원본 경로:" in card_text

    extracted = sorted((wiki_root / "extracted").glob("*.md"))
    assert len(extracted) == 2
    extracted_text = extracted[0].read_text(encoding="utf-8")
    assert extracted_text.startswith("---")
    assert "source_path:" in extracted_text

    index_text = (wiki_root / "index.md").read_text(encoding="utf-8")
    assert "[사업계획](docs/" in index_text
    assert "원본:" in index_text

    log_text = (wiki_root / "log.md").read_text(encoding="utf-8")
    assert "ingest source=" in log_text


def test_fts5_search_hits_korean_query_of_three_or_more_chars(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    response = client.get("/api/knowledge/search", params={"query": "예산편성"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "fts5"
    assert payload["items"]
    first = payload["items"][0]
    assert first["title"] == "사업계획"
    assert first["source_path"].endswith("plan.md")
    assert first["snippet"]
    assert first["quality_score"] is not None
    assert first["card_path"]


def test_short_query_falls_back_to_like_search(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    response = client.get("/api/knowledge/search", params={"query": "예산"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "like"
    assert payload["items"]
    assert payload["items"][0]["title"] == "사업계획"


def test_search_normalizes_nfc_and_nfd_variants(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    decomposed_body = unicodedata.normalize("NFD", "# 예산편성 검토\n\n예산편성 세부 지침입니다.")
    (source / "nfd.md").write_text(decomposed_body, encoding="utf-8")
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    composed_query = client.get("/api/knowledge/search", params={"query": "예산편성"})
    decomposed_query = client.get(
        "/api/knowledge/search", params={"query": unicodedata.normalize("NFD", "예산편성")}
    )

    assert composed_query.json()["items"], "NFC 질의가 NFD 원문과 매칭되어야 한다"
    assert decomposed_query.json()["items"], "NFD 질의도 NFC 정규화되어 매칭되어야 한다"


def test_ask_always_returns_citations_with_source_path(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    response = client.post("/api/knowledge/ask", json={"query": "추진배경 근거 알려줘"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["citations"]
    for citation in payload["citations"]:
        assert citation["source_path"]
        assert citation["title"]
        assert "snippet" in citation
    assert payload["answer"]
    assert payload["retrieval_summary"]["source_count"] >= 1


def test_ask_synthesizes_with_llm_and_falls_back_on_failure(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    wiki = client.app.state.services.wiki

    captured: list[list[dict]] = []

    def fake_llm(messages):
        captured.append(messages)
        return "예산편성은 사업계획에 따라 진행됩니다. (출처: 사업계획)"

    result = wiki.ask(query="예산편성 어떻게 되나", llm=fake_llm)
    assert result["answer_mode"] == "llm"
    assert "(출처: 사업계획)" in result["answer"]
    assert result["citations"][0]["source_path"].endswith("plan.md")
    assert any("[지식폴더 근거]" in message["text"] for message in captured[0])

    def broken_llm(messages):
        raise RuntimeError("llm unavailable")

    fallback = wiki.ask(query="예산편성 어떻게 되나", llm=broken_llm)
    assert fallback["answer_mode"] == "extractive"
    assert fallback["citations"]


def test_ask_suppresses_citations_for_no_evidence_llm_answer(tmp_path: Path) -> None:
    """WI-4(2026-07-14): LLM이 무근거를 선언하면 검색 히트가 있어도 citations를 비운다.

    실측(QA W-03, DB 4d84b9f3): "...확인할 수 없습니다. (출처: 없음)" 답변에
    무관 citations 1963B가 그대로 붙었다 — 수정 전 FAIL 재현 케이스.
    """
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    wiki = client.app.state.services.wiki

    def fake_llm(messages):
        return "요청하신 회식 규정 정보는 지식폴더에서 찾을 수 없습니다."

    result = wiki.ask(query="예산편성 어떻게 되나", llm=fake_llm)

    assert result["answer_mode"] == "llm"
    assert result["citations"] == []
    assert result["no_evidence"] is True
    # retrieval_summary는 QA 스크립트 호환을 위해 억제와 무관하게 불변
    assert result["retrieval_summary"]["hit_count"] >= 1


def test_ask_suppresses_citations_for_no_source_mark_only_answer(tmp_path: Path) -> None:
    """WI-4: "(출처: 없음)"만 있고 실출처 인용이 하나도 없는 답변도 억제한다."""
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    wiki = client.app.state.services.wiki

    def fake_llm(messages):
        return "회식 규정은 부서 자율 운영입니다. (출처: 없음)"

    result = wiki.ask(query="예산편성 어떻게 되나", llm=fake_llm)

    assert result["answer_mode"] == "llm"
    assert result["citations"] == []
    assert result["no_evidence"] is True


def test_ask_keeps_citations_for_answer_with_real_source_mark(tmp_path: Path) -> None:
    """WI-4 네거티브 컨트롤: 실출처 인용 답변은 citations를 유지한다(억제 미발동)."""
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    wiki = client.app.state.services.wiki

    def fake_llm(messages):
        return "예산편성은 사업계획 문서에 따라 상반기에 확정됩니다. (출처: 사업계획)"

    result = wiki.ask(query="예산편성 어떻게 되나", llm=fake_llm)

    assert result["answer_mode"] == "llm"
    assert result["citations"]
    assert result["citations"][0]["source_path"]
    assert result["no_evidence"] is False


def test_is_excluded_allows_source_root_under_dotted_ancestor(tmp_path: Path) -> None:
    # 회귀: 지식폴더 루트가 점(.) 디렉터리 아래에 있어도 스캔되어야 한다.
    dotted_root = tmp_path / ".hidden-worktree" / "workspace" / "knowledge-data"
    dotted_root.mkdir(parents=True)
    (dotted_root / "plan.md").write_text("# 숨김 폴더 계획\n\n점 폴더 아래 문서입니다.", encoding="utf-8")
    inner_dot = dotted_root / ".git"
    inner_dot.mkdir()
    (inner_dot / "ignored.md").write_text("# 무시 대상", encoding="utf-8")
    excluded_dir = dotted_root / "node_modules"
    excluded_dir.mkdir()
    (excluded_dir / "ignored-too.md").write_text("# 무시 대상 2", encoding="utf-8")

    client = _client(tmp_path)
    created = client.post(
        "/api/knowledge/sources", json={"label": "점 폴더", "root_path": str(dotted_root)}
    )
    source_id = created.json()["id"]
    scan = client.post(f"/api/knowledge/sources/{source_id}/scan")

    assert scan.status_code == 200
    assert scan.json()["indexed_count"] == 1
    files = client.get(f"/api/knowledge/source-files?source_id={source_id}").json()["items"]
    assert [item["relative_path"] for item in files] == ["plan.md"]


def test_chat_turn_injects_knowledge_block_when_wiki_has_hits(tmp_path: Path, monkeypatch) -> None:
    captured_messages: list[dict] = []

    def fake_generate_reply(settings, messages, **kwargs):
        captured_messages.extend(messages)
        return LLMGenerationResult(text="근거를 반영한 답변입니다.", provider="ollama", model="gemma4:e2b")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    session = client.post("/api/work-sessions", json={"title": "지식 근거 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "예산편성 추진배경 설명해줘"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["context_summary"]["graphrag_used"] is True
    assert payload["context_summary"]["graphrag_evidence_count"] >= 1
    block = next(message for message in captured_messages if "[지식폴더 근거]" in message["text"])
    assert block["role"] == "system"
    assert "사업계획" in block["text"]
    assert "원본:" in block["text"]
    assert "발췌:" in block["text"]


def test_keyword_queries_no_longer_hijack_the_llm_turn(tmp_path: Path, monkeypatch) -> None:
    # 회귀: '근거/출처/자료' 키워드가 템플릿 답변으로 가로채지 않고 LLM으로 전달돼야 한다.
    llm_called: list[bool] = []

    def fake_generate_reply(settings, messages, **kwargs):
        llm_called.append(True)
        return LLMGenerationResult(text="LLM이 직접 답변합니다.", provider="ollama", model="gemma4:e2b")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "하이재킹 제거 테스트"})
    session_id = session.json()["id"]

    response = client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "이 사업의 근거와 출처 자료 찾아줘"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert llm_called, "키워드 질의도 LLM 턴으로 이어져야 한다"
    assert payload["assistant_message"]["provider"] != "gongmu-skill"
    assert payload["assistant_message"]["text"] == "LLM이 직접 답변합니다."


def test_hwp_ingest_via_kordoc_runner(tmp_path: Path, monkeypatch) -> None:
    if not kordoc_status()["node_available"]:
        pytest.skip("node runtime is not available for kordoc")
    runner = tmp_path / "fake_kordoc_runner.js"
    payload = {
        "success": True,
        "parser": "kordoc",
        "version": "2.test",
        "metadata": {"title": "HWP 사업보고"},
        "blocks": [
            {"type": "heading", "text": "HWP 사업보고", "level": 1},
            {"type": "paragraph", "text": "한글 문서 예산편성 내용입니다."},
        ],
    }
    runner.write_text(
        "const payload = " + json.dumps(payload, ensure_ascii=False) + ";\n"
        "console.log(JSON.stringify(payload));\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("GONGMU_KORDOC_RUNNER", str(runner))

    source = tmp_path / "source"
    source.mkdir()
    (source / "report.hwp").write_bytes(b"fake hwp binary")
    client = _client(tmp_path)
    _register_scan_ingest(client, source, label="한글 자료")

    documents = client.get("/api/knowledge/documents").json()["items"]
    assert documents[0]["title"] == "HWP 사업보고"
    assert documents[0]["parser_name"] == "kordoc"
    search = client.get("/api/knowledge/search", params={"query": "예산편성"})
    assert search.json()["items"][0]["title"] == "HWP 사업보고"


def test_lint_detects_and_fixes_orphan_cards(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    wiki = client.app.state.services.wiki

    (source / "plan.md").unlink()
    report = wiki.lint()

    assert report["checked_count"] == 2
    assert len(report["orphans"]) == 1
    assert report["orphans"][0]["title"] == "사업계획"
    assert report["fixed"]["orphans_removed"] == 1
    search = client.get("/api/knowledge/search", params={"query": "예산편성"})
    assert all(item["title"] != "사업계획" for item in search.json()["items"])


def test_enrich_writes_summary_topics_and_topic_pages(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    wiki = client.app.state.services.wiki

    def fake_llm(messages):
        return json.dumps(
            {"summary": "예산편성 사업 추진 문서입니다. 배경과 계획을 담고 있습니다. 표에 예산이 있습니다.", "topics": ["예산", "민원 자동화"]},
            ensure_ascii=False,
        )

    result = wiki.enrich(llm=fake_llm)

    assert result["status"] == "completed"
    assert result["enriched_count"] == 2
    topic_pages = list((tmp_path / "knowledge-wiki" / "topics").glob("*.md"))
    assert topic_pages
    topic_text = topic_pages[0].read_text(encoding="utf-8")
    assert "## 관련 문서" in topic_text
    index_text = (tmp_path / "knowledge-wiki" / "index.md").read_text(encoding="utf-8")
    assert "## 주제" in index_text
    assert "예산편성 사업 추진 문서입니다" in index_text

    cards = list((tmp_path / "knowledge-wiki" / "docs").glob("*.md"))
    assert any("## LLM 요약" in card.read_text(encoding="utf-8") for card in cards)

    # 재실행 시 이미 보강된 카드는 건너뛴다 (재개 가능성)
    second = wiki.enrich(llm=fake_llm)
    assert second["total_count"] == 0


def test_enrich_endpoint_creates_cancellable_work_job(tmp_path: Path, monkeypatch) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text=json.dumps({"summary": "요약 문장입니다. 배경 설명입니다. 계획 설명입니다.", "topics": ["예산"]}, ensure_ascii=False),
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    response = client.post("/api/knowledge/enrich", json={"background": False})

    assert response.status_code == 201
    work_job = response.json()["work_job"]
    assert work_job["kind"] == "knowledge.enrich"
    assert work_job["status"] == "succeeded"
    assert work_job["result"]["enriched_count"] == 2


def test_wiki_index_and_page_endpoints_are_path_safe(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    index = client.get("/api/knowledge/wiki/index")
    assert index.status_code == 200
    assert "지식폴더 위키 인덱스" in index.json()["content"]

    slug = client.get("/api/knowledge/search", params={"query": "예산편성"}).json()["items"][0]["slug"]
    page = client.get("/api/knowledge/wiki/page", params={"path": f"docs/{slug}.md"})
    assert page.status_code == 200
    assert "## 개요" in page.json()["content"]

    assert client.get("/api/knowledge/wiki/page", params={"path": "../settings.json"}).status_code == 400
    assert client.get("/api/knowledge/wiki/page", params={"path": "docs/없는문서.md"}).status_code == 404


def test_session_analyze_writes_work_page_and_backlinks(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    wiki = client.app.state.services.wiki

    def fake_llm(messages):
        return json.dumps({"summary": "요약. 요약. 요약.", "topics": ["예산"]}, ensure_ascii=False)

    wiki.enrich(llm=fake_llm)

    session = client.post("/api/work-sessions", json={"title": "예산 검토 세션"})
    session_id = session.json()["id"]
    client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "user", "text": "사업계획 문서 기준으로 예산 조정안을 정리해줘."},
    )
    client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "assistant", "text": "결정 사항: 예산 10% 조정. 후속 조치: 부서 협의. (출처: 사업계획)"},
    )
    linked_file = source / "plan.md"
    client.post(
        f"/api/work-sessions/{session_id}/file-links",
        json={"items": [{"file_path": str(linked_file), "source": "knowledge"}]},
    )

    analyzed = client.post(f"/api/personalization/work-sessions/{session_id}/analyze")
    assert analyzed.status_code == 201
    work_page = analyzed.json()["wiki_work_page"]
    assert work_page is not None
    assert work_page["session_id"] == session_id
    assert work_page["relative_path"].startswith("work/")
    assert work_page["cited_doc_slugs"], "사업계획 문서가 인용 문서로 잡혀야 한다"

    page_path = Path(work_page["path"])
    assert page_path.exists()
    page_text = page_path.read_text(encoding="utf-8")
    assert page_text.startswith("---")
    assert f"session_id: {session_id}" in page_text
    assert "## 세션 요약" in page_text
    assert "## 주요 결정/후속 액션" in page_text
    assert "## 인용된 지식 문서" in page_text
    assert "](../docs/" in page_text
    assert "## 연결 파일" in page_text

    index_text = (tmp_path / "knowledge-wiki" / "index.md").read_text(encoding="utf-8")
    assert "## 업무 기록" in index_text
    assert "[예산 검토 세션](work/" in index_text
    assert "## 주제" in index_text
    assert "## 문서" in index_text

    # 주제 페이지에 업무 기록 백링크가 생겨야 한다
    topic_pages = list((tmp_path / "knowledge-wiki" / "topics").glob("*.md"))
    assert any("## 관련 업무 기록" in page.read_text(encoding="utf-8") for page in topic_pages)

    # work/ 페이지는 wiki/page 엔드포인트로 열람 가능해야 한다
    served = client.get("/api/knowledge/wiki/page", params={"path": work_page["relative_path"]})
    assert served.status_code == 200
    assert "## 세션 요약" in served.json()["content"]


def test_wiki_tree_endpoint_returns_topics_works_sources(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    wiki = client.app.state.services.wiki

    def fake_llm(messages):
        return json.dumps({"summary": "요약. 요약. 요약.", "topics": ["예산"]}, ensure_ascii=False)

    wiki.enrich(llm=fake_llm)

    session = client.post("/api/work-sessions", json={"title": "트리 세션"})
    session_id = session.json()["id"]
    client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "user", "text": "사업계획 예산 정리"},
    )
    assert client.post(f"/api/personalization/work-sessions/{session_id}/analyze").status_code == 201

    response = client.get("/api/knowledge/wiki/tree")

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"topics", "works", "work_areas", "sources", "counts"}
    assert payload["counts"] == {
        "docs": 2,
        "topics": len(payload["topics"]),
        "works": 1,
        "work_areas": 0,
    }
    assert payload["work_areas"] == []
    topic = payload["topics"][0]
    assert {"slug", "title", "doc_count", "path"} <= set(topic)
    assert topic["path"].startswith("topics/") and topic["path"].endswith(".md")
    work = payload["works"][0]
    assert {"slug", "title", "session_id", "updated_at", "path"} <= set(work)
    assert work["session_id"] == session_id
    assert work["path"].startswith("work/")
    source_entry = payload["sources"][0]
    assert {"source_id", "label", "docs"} <= set(source_entry)
    assert source_entry["label"] == "업무자료"
    doc = source_entry["docs"][0]
    assert {"slug", "title", "path", "quality_score"} <= set(doc)
    assert doc["path"] == f"docs/{doc['slug']}.md"


def test_backend_status_reports_wiki_engine(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.get("/api/knowledge/backend-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["engine"] == "wiki"
    assert payload["fts5"]["ok"] is True
    assert payload["fts5"]["tokenizer"] == "trigram"
    assert "available" in payload["kordoc"]
    assert "configured" in payload["llm_enrichment"]
    assert isinstance(payload["backends"], list) and payload["backends"]
    # 데스크톱 렌더 호환 키
    assert payload["vector"]["active_backend"] == "sqlite_fts5"
    assert payload["graph"]["active_backend"] == "wiki_markdown"
    assert "chroma" not in json.dumps(payload)


def test_graph_endpoints_expose_wiki_structure(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    wiki = client.app.state.services.wiki

    def fake_llm(messages):
        return json.dumps({"summary": "요약. 요약. 요약.", "topics": ["예산"]}, ensure_ascii=False)

    wiki.enrich(llm=fake_llm)

    graph = client.get("/api/knowledge/graph")
    assert graph.status_code == 200
    payload = graph.json()
    assert payload["engine"] == "wiki"
    assert payload["node_count"] >= 3
    node_types = {node["node_type"] for node in payload["nodes"]}
    assert {"source_folder", "document", "topic"}.issubset(node_types)
    assert {"graph_json_path", "graph_html_path", "graph_report_path"} <= set(payload["artifacts"])

    query = client.get("/api/knowledge/graph/query", params={"query": "예산"})
    assert query.status_code == 200
    query_payload = query.json()
    assert {"query", "nodes", "edges", "neighbor_nodes", "related_documents"} <= set(query_payload)
    assert any(node["node_type"] == "topic" for node in query_payload["nodes"])


def test_retrieve_boosts_session_linked_files(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    linked = source / "linked-budget.md"
    linked.write_text("# 연결 예산 검토\n\n예산 검토 참고자료입니다.", encoding="utf-8")
    unlinked = source / "unlinked-budget.md"
    unlinked.write_text("# 일반 예산 검토\n\n예산 검토 참고자료입니다. 예산 검토 예산 검토.", encoding="utf-8")
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
    assert first["session_context_boost"] > 0


def test_force_reindex_succeeds_for_documents_with_table_blocks(tmp_path: Path) -> None:
    """강제 재색인 FK 순서 회귀 방지 (2026-07-13 수용 테스트 발견).

    chunks/table_blocks가 sections(id)를 FK 참조하므로 sections를 먼저 지우면
    표 블록 보유 문서(xlsx/docx/표 있는 md)가 전량 'FOREIGN KEY constraint
    failed'로 실패하고 잡이 partial로 끝난다.
    """
    import sqlite3

    source = _make_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)

    db = sqlite3.connect(tmp_path / "db" / "gongmu.db")
    table_blocks = db.execute("SELECT COUNT(*) FROM knowledge_table_blocks").fetchone()[0]
    db.close()
    assert table_blocks > 0, "픽스처가 표 블록을 만들지 않으면 이 회귀 테스트는 무의미하다"

    response = client.post(
        "/api/knowledge/reindex", json={"source_id": source_id, "run_now": True}
    )
    assert response.status_code == 201

    latest = client.get("/api/knowledge/ingestion-jobs").json()["items"][0]
    assert latest["failed_count"] == 0, latest.get("error_message")
    assert latest["status"] in ("completed", "succeeded")


def test_force_reindex_marks_summary_stale_when_extraction_changes(tmp_path: Path) -> None:
    """추출본 변화 = 요약 신선도 기준 (2026-07-13 수용 테스트 발견).

    신선도가 원본 file_hash에만 걸려 있으면, 파서가 개선돼(예: kordoc 정상화)
    추출본이 완전히 달라져도 제목 기반 낡은 요약이 '완료'로 남는다.
    """
    import sqlite3

    source = _make_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)

    db = sqlite3.connect(tmp_path / "db" / "gongmu.db")
    db.execute(
        "UPDATE knowledge_wiki_docs SET norm_body = '구파서 추출본', "
        "enriched = 1, summary_stale = 0, summary = '낡은 요약'"
    )
    db.commit()
    db.close()

    response = client.post(
        "/api/knowledge/reindex", json={"source_id": source_id, "run_now": True}
    )
    assert response.status_code == 201

    db = sqlite3.connect(tmp_path / "db" / "gongmu.db")
    rows = db.execute(
        "SELECT summary_stale, enriched, summary FROM knowledge_wiki_docs"
    ).fetchall()
    db.close()
    assert rows and all(row[0] == 1 and row[1] == 0 for row in rows), rows
    # 기존 요약 자체는 지우지 않고 보존한다 (stale 표기가 정직성 계약)
    assert all(row[2] == "낡은 요약" for row in rows)
