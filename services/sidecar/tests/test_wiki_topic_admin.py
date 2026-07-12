"""주제 상세화면 재분류·삭제 계약 테스트 (위키 UX 2026-07-12).

- POST /api/knowledge/wiki/topics/merge: synonym 편입 + 문서 재태깅 + 구 페이지 삭제
- POST /api/knowledge/wiki/topics/delete: 차단(enabled:false/blocklist) + 재태깅 + 재발 방지
"""

from __future__ import annotations

import json
from pathlib import Path


from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _make_source(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    (source / "plan.md").write_text(
        "# 사업계획\n\n## 추진배경\n\n지역 예산편성 사업의 추진배경입니다.\n",
        encoding="utf-8",
    )
    (source / "memo.txt").write_text("회의록: 민원 상담 자동화 회의 결과 정리.", encoding="utf-8")
    return source


def _register_scan_ingest(client, source: Path, label: str = "업무자료") -> str:
    created = client.post("/api/knowledge/sources", json={"label": label, "root_path": str(source)})
    assert created.status_code == 201
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert (
        client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code
        == 201
    )
    return source_id


def _assign_topics(wiki, title: str, topics: list[str], *, exclude_title: str | None = None) -> dict:
    """문서에 주제를 직접 배정하고 주제 페이지를 생성한다(보강 LLM 경로 대체).

    exclude_title을 주면 '그 제목이 아닌 문서'를 고른다(파서 유래 제목 변동 회피).
    """
    if exclude_title is None:
        doc = wiki.db.fetch_one("SELECT * FROM knowledge_wiki_docs WHERE title = ?", (title,))
    else:
        doc = wiki.db.fetch_one(
            "SELECT * FROM knowledge_wiki_docs WHERE title != ?", (exclude_title,)
        )
    assert doc is not None
    wiki.db.execute(
        "UPDATE knowledge_wiki_docs SET topics_json = ?, enriched = 1 WHERE id = ?",
        (json.dumps(topics, ensure_ascii=False), doc["id"]),
    )
    wiki._write_topic_pages()
    return wiki.db.fetch_one("SELECT * FROM knowledge_wiki_docs WHERE id = ?", (doc["id"],))


def _execution_log_actions(client) -> list[str]:
    return [item["action"] for item in client.get("/api/execution-logs").json()["items"]]


# ---------------------------------------------------------------------------
# merge — synonym 편입 · 재태깅 · 페이지 정리
# ---------------------------------------------------------------------------


def test_merge_topic_retags_docs_absorbs_synonym_and_removes_old_page(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _register_scan_ingest(client, _make_source(tmp_path))
    services = client.app.state.services
    wiki = services.wiki
    doc = _assign_topics(wiki, "사업계획", ["연말 정산"])
    old_page = tmp_path / "knowledge-wiki" / "topics" / "연말-정산.md"
    assert old_page.exists()

    response = client.post(
        "/api/knowledge/wiki/topics/merge",
        json={"topic": "연말 정산", "into_topic_id": "budget-formulation"},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "retagged_docs": 1}
    # 문서 재태깅 — 대상 정식명으로 치환(중복 제거)
    refreshed = wiki.db.fetch_one("SELECT * FROM knowledge_wiki_docs WHERE id = ?", (doc["id"],))
    assert json.loads(refreshed["topics_json"]) == ["예산편성"]
    # synonym 편입 — user layer가 '연말 정산'을 budget-formulation의 동의어로 흡수
    merged = {entry["id"]: entry for entry in services.vocab.merged_topics()}
    assert "연말 정산" in merged["budget-formulation"]["synonyms"]
    # 구 주제 페이지 삭제 + 대상 주제 페이지 생성
    assert not old_page.exists()
    assert (tmp_path / "knowledge-wiki" / "topics" / "예산편성.md").exists()
    # 카드도 재투영 — 삭제된 주제로 가는 죽은 링크가 남지 않는다
    card_text = Path(refreshed["card_path"]).read_text(encoding="utf-8")
    assert "예산편성" in card_text
    assert "연말 정산" not in card_text
    # execution log 1줄
    assert "knowledge.wiki.topic.merged" in _execution_log_actions(client)


def test_merge_topic_rejects_unknown_topic_and_unknown_target(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _register_scan_ingest(client, _make_source(tmp_path))
    wiki = client.app.state.services.wiki
    _assign_topics(wiki, "사업계획", ["연말 정산"])

    missing_topic = client.post(
        "/api/knowledge/wiki/topics/merge",
        json={"topic": "존재하지 않는 주제", "into_topic_id": "budget-formulation"},
    )
    assert missing_topic.status_code == 404

    missing_target = client.post(
        "/api/knowledge/wiki/topics/merge",
        json={"topic": "연말 정산", "into_topic_id": "ghost-topic"},
    )
    assert missing_target.status_code == 400
    # 실패 시 문서는 원래 주제를 유지한다
    doc = wiki.db.fetch_one("SELECT topics_json FROM knowledge_wiki_docs WHERE title = ?", ("사업계획",))
    assert json.loads(doc["topics_json"]) == ["연말 정산"]


# ---------------------------------------------------------------------------
# delete — 차단 등재 · 재태깅 · 재발 방지
# ---------------------------------------------------------------------------


def test_delete_free_topic_blocks_future_tagging_and_candidates(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _register_scan_ingest(client, _make_source(tmp_path))
    services = client.app.state.services
    wiki = services.wiki
    doc = _assign_topics(wiki, "사업계획", ["떡볶이 축제"])
    page = tmp_path / "knowledge-wiki" / "topics" / "떡볶이-축제.md"
    assert page.exists()
    # 같은 이름의 pending 후보도 있는 상태를 만든다 — 삭제 시 함께 거절되어야 한다.
    assert services.vocab.enqueue_candidate("떡볶이 축제") is not None

    response = client.post("/api/knowledge/wiki/topics/delete", json={"topic": "떡볶이 축제"})

    assert response.status_code == 200
    assert response.json() == {"ok": True, "retagged_docs": 1}
    refreshed = wiki.db.fetch_one("SELECT * FROM knowledge_wiki_docs WHERE id = ?", (doc["id"],))
    assert json.loads(refreshed["topics_json"]) == []
    assert not page.exists()
    index_text = (tmp_path / "knowledge-wiki" / "index.md").read_text(encoding="utf-8")
    assert "떡볶이" not in index_text
    # blocklist가 user-approved.json 미러 구조에 저장된다
    mirror = json.loads(services.vocab.user_mirror_path.read_text(encoding="utf-8"))
    assert any(item["name"] == "떡볶이 축제" for item in mirror["blocked_topics"])
    # 재발 방지 — 이후 태깅(NEW 제안·레거시 재유입)에서 후보로 적재되지 않는다
    assert services.vocab.enqueue_candidate("떡볶이 축제") is None
    candidates = services.vocab.list_candidates(status="all")
    assert candidates and all(item["status"] == "rejected" for item in candidates)
    assert "knowledge.wiki.topic.deleted" in _execution_log_actions(client)


def test_delete_vocab_topic_disables_override_and_clears_synonym_labels(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _register_scan_ingest(client, _make_source(tmp_path))
    services = client.app.state.services
    wiki = services.wiki
    # 정식명(예산편성)과 동의어 표기(예산요구)로 태깅된 문서 2건
    _assign_topics(wiki, "사업계획", ["예산편성"])
    _assign_topics(wiki, "", ["예산요구"], exclude_title="사업계획")

    response = client.post("/api/knowledge/wiki/topics/delete", json={"topic": "예산편성"})

    assert response.status_code == 200
    assert response.json() == {"ok": True, "retagged_docs": 2}
    for row in wiki.db.fetch_all("SELECT topics_json FROM knowledge_wiki_docs"):
        assert json.loads(row["topics_json"]) == []
    # 어휘집 주제는 enabled:false 오버라이드 — 결합 어휘집·매칭에서 제외된다
    merged_ids = {entry["id"] for entry in services.vocab.merged_topics()}
    assert "budget-formulation" not in merged_ids
    listing = {entry["id"]: entry for entry in services.vocab.merged_topics(include_disabled=True)}
    assert listing["budget-formulation"]["enabled"] is False
    assert not services.vocab.match_document(title="예산편성 지침", file_name="a.md", body="")
    # 동의어 키까지 차단 — key_index에서 빠진 키가 후보 큐로 재유입되지 않는다
    assert services.vocab.enqueue_candidate("예산요구") is None


def test_delete_unknown_topic_returns_404(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _register_scan_ingest(client, _make_source(tmp_path))

    response = client.post("/api/knowledge/wiki/topics/delete", json={"topic": "없는 주제"})

    assert response.status_code == 404
