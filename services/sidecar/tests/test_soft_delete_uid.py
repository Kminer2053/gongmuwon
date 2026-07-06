"""W7 P2b — 소프트 삭제(§5.5) · doc_uid(§5.6) · 사용자 메모 구역(§5.7) 계약 테스트.

설계 원천: docs/design/2026-07-05-incremental-knowledge-sync-design.md
- 소프트 삭제: 검색/트리/허브/그래프 즉시 제외 + 카드 배너 유예 보관(30일) + 부활 복원
- doc_uid: 슬러그 안정화(내용 수정≠카드 교체), 무파싱 마이그레이션, 사본 duplicate_count
- 인용 doc_uid + cards/by-uid 폴백 라우트
- 사용자 메모 구역: 전 재작성 경로 보존 + 기계 영역 편집 백업(3개 순환)
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from gongmu_sidecar.app import create_app
from gongmu_sidecar.db import now_iso
from gongmu_sidecar.knowledge_wiki import (
    MISSING_BANNER_PREFIX,
    USER_NOTES_MARKER,
)


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _register_and_scan(client, source: Path, label: str = "P2b자료") -> str:
    created = client.post("/api/knowledge/sources", json={"label": label, "root_path": str(source)})
    assert created.status_code == 201
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    return source_id


def _scan(client, source_id: str) -> None:
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200


def _ingest(client, source_id: str) -> dict:
    response = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})
    assert response.status_code == 201
    return response.json()["job"]


def _make_source(tmp_path: Path, files: dict[str, str] | None = None) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    defaults = {
        "plan.md": "# 사업계획\n\n예산편성 추진배경입니다. 개인정보보호법 준수.",
        "memo.md": "# 회의메모\n\n민원 자동화 회의 결과 정리.",
    }
    for name, body in (files or defaults).items():
        (source / name).write_text(body, encoding="utf-8")
    return source


def _doc_by_rel(db, source_id: str, relative_path: str) -> dict:
    row = db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ? AND relative_path = ?",
        (source_id, relative_path),
    )
    assert row is not None, f"wiki doc not found: {relative_path}"
    return row


# ----------------------------------------------------------- §5.5 소프트 삭제


def test_soft_delete_hides_doc_everywhere_but_keeps_banner_card(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)

    doc = _doc_by_rel(services.db, source_id, "plan.md")
    # 분류 대기 큐 pending 항목을 만들어 숨김 처리를 검증한다.
    services.db.insert(
        "knowledge_tag_queue",
        {
            "id": str(uuid4()),
            "source_id": source_id,
            "wiki_doc_id": doc["id"],
            "doc_slug": doc["slug"],
            "status": "pending",
            "created_at": now_iso(),
        },
    )

    (source / "plan.md").unlink()
    _scan(client, source_id)
    _ingest(client, source_id)

    after = _doc_by_rel(services.db, source_id, "plan.md")
    assert after["status"] == "missing"
    assert after["missing_since"]

    # 검색(FTS)·LIKE·retrieve에서 즉시 제외.
    search = client.get("/api/knowledge/search", params={"query": "예산편성"}).json()
    assert all(item["title"] != "사업계획" for item in search["items"])
    like = client.get("/api/knowledge/search", params={"query": "예산"}).json()
    assert all(item["title"] != "사업계획" for item in like["items"])
    retrieve = client.post("/api/knowledge/retrieve", json={"query": "예산편성"}).json()
    assert all(item["title"] != "사업계획" for item in retrieve["items"])

    # index.md·그래프에서 제외. 트리에는 status='missing'으로 포함된다 —
    # 프론트가 "원본 없는 카드" 그룹으로 분리 표시하고 유예 보관 카드를 열람한다.
    index_text = (tmp_path / "knowledge-wiki" / "index.md").read_text(encoding="utf-8")
    assert f"docs/{after['slug']}.md" not in index_text
    tree = client.get("/api/knowledge/wiki/tree").json()
    tree_docs = {d["slug"]: d for s in tree["sources"] for d in s["docs"]}
    assert after["slug"] in tree_docs
    assert tree_docs[after["slug"]]["status"] == "missing"
    active_slugs = {slug for slug, d in tree_docs.items() if d.get("status") != "missing"}
    assert after["slug"] not in active_slugs
    assert tree["counts"]["docs"] == 1
    graph = client.get("/api/knowledge/graph").json()
    assert all(node.get("label") != "사업계획" for node in graph["nodes"])
    graph_query = client.get("/api/knowledge/graph/query", params={"query": "사업계획"}).json()
    assert graph_query["nodes"] == []

    # 인용 후보(_cited_wiki_docs)에서도 제외.
    cited = services.wiki._cited_wiki_docs([{"text": "사업계획 기준으로 정리"}], [])
    assert all(row["id"] != doc["id"] for row in cited)

    # enrich 대상에서 제외 (memo.md 1건만 대상).
    def fake_llm(messages):
        return json.dumps({"summary": "요약. 요약. 요약.", "topics": ["예산"]}, ensure_ascii=False)

    enriched = services.wiki.enrich(llm=fake_llm)
    assert enriched["total_count"] == 1

    # 카드는 유예 보관: 배너 + front matter status.
    card_text = Path(str(after["card_path"])).read_text(encoding="utf-8")
    assert MISSING_BANNER_PREFIX in card_text
    assert "status: missing" in card_text
    assert "missing_since:" in card_text

    # pending 큐는 suspended로 숨겨진다(삭제 아님 — 부활 시 복원).
    queue_rows = services.db.fetch_all(
        "SELECT * FROM knowledge_tag_queue WHERE wiki_doc_id = ?", (doc["id"],)
    )
    assert [row["status"] for row in queue_rows] == ["suspended"]

    # lint는 missing을 orphan과 구분해 하드삭제하지 않는다.
    report = services.wiki.lint(fix=True)
    assert report["orphans"] == []
    assert len(report["missing_docs"]) == 1
    still = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (doc["id"],)
    )
    assert still is not None and still["status"] == "missing"


def test_revival_restores_doc_without_reparse(tmp_path: Path, monkeypatch) -> None:
    body = "# 사업계획\n\n예산편성 추진배경입니다. 개인정보보호법 준수."
    source = _make_source(tmp_path, {"plan.md": body})
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)
    doc = _doc_by_rel(services.db, source_id, "plan.md")

    (source / "plan.md").unlink()
    _scan(client, source_id)
    _ingest(client, source_id)
    assert _doc_by_rel(services.db, source_id, "plan.md")["status"] == "missing"
    # suspended 큐 복원 검증용.
    services.db.insert(
        "knowledge_tag_queue",
        {
            "id": str(uuid4()),
            "source_id": source_id,
            "wiki_doc_id": doc["id"],
            "doc_slug": doc["slug"],
            "status": "suspended",
            "created_at": now_iso(),
        },
    )

    # 같은 경로·같은 내용 재등장 — 재파싱 0회로 복원되어야 한다.
    (source / "plan.md").write_text(body, encoding="utf-8")
    _scan(client, source_id)

    def forbidden_parse(path):
        raise AssertionError(f"revival must not reparse: {path}")

    monkeypatch.setattr("gongmu_sidecar.knowledge_wiki.parse_document", forbidden_parse)
    _ingest(client, source_id)

    restored = _doc_by_rel(services.db, source_id, "plan.md")
    assert restored["status"] == "active"
    assert restored["missing_since"] is None
    assert restored["id"] == doc["id"], "행이 재사용(승계)되어야 한다"
    card_text = Path(str(restored["card_path"])).read_text(encoding="utf-8")
    assert MISSING_BANNER_PREFIX not in card_text
    assert "status: active" in card_text
    # FTS 복원.
    search = client.get("/api/knowledge/search", params={"query": "예산편성"}).json()
    assert any(item["title"] == "사업계획" for item in search["items"])
    # suspended 큐가 pending으로 복원된다.
    queue_rows = services.db.fetch_all(
        "SELECT status FROM knowledge_tag_queue WHERE wiki_doc_id = ?", (doc["id"],)
    )
    assert [row["status"] for row in queue_rows] == ["pending"]


def test_missing_docs_hard_deleted_after_retention(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)
    doc = _doc_by_rel(services.db, source_id, "plan.md")
    card_path = Path(str(doc["card_path"]))
    extracted_path = Path(str(doc["extracted_path"]))

    (source / "plan.md").unlink()
    _scan(client, source_id)
    _ingest(client, source_id)

    # 유예 기간 내에는 남아 있다.
    assert _doc_by_rel(services.db, source_id, "plan.md")["status"] == "missing"
    assert card_path.exists()

    # 31일 경과 시뮬레이션 → 다음 색인 잡 말미에 하드 정리.
    expired = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET missing_since = ? WHERE id = ?", (expired, doc["id"])
    )
    _ingest(client, source_id)

    assert services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (doc["id"],)
    ) is None
    assert not card_path.exists(), "참조 0이 된 카드는 하드 정리된다"
    assert not extracted_path.exists(), "추출본도 함께 정리된다(GC 포함)"
    assert services.db.fetch_one(
        "SELECT * FROM knowledge_documents WHERE source_file_id = ?",
        (doc["source_file_id"],),
    ) is None, "보존해 두었던 documents 행도 하드 정리 시 삭제된다"


# ------------------------------------------------------------- §5.6 doc_uid


def test_doc_uid_issued_and_slug_stable_across_content_change(tmp_path: Path) -> None:
    source = _make_source(tmp_path, {"plan.md": "# 사업계획\n\n예산편성 v1."})
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)

    doc = _doc_by_rel(services.db, source_id, "plan.md")
    assert re.fullmatch(r"[0-9a-f]{8}", doc["doc_uid"])
    assert doc["slug"].endswith(doc["doc_uid"])

    # 내용 수정(제목 유지) → 같은 카드에 덮어쓰기 (내용 수정≠카드 교체).
    (source / "plan.md").write_text("# 사업계획\n\n예산편성 v2 갱신본.", encoding="utf-8")
    _scan(client, source_id)
    _ingest(client, source_id)
    after = _doc_by_rel(services.db, source_id, "plan.md")
    assert after["doc_uid"] == doc["doc_uid"]
    assert after["slug"] == doc["slug"]
    assert after["card_path"] == doc["card_path"]


def test_duplicate_copies_fold_into_representative_with_count(tmp_path: Path) -> None:
    body = "# 공유 문서\n\n동일 내용 사본입니다. 예산편성 자료."
    source = _make_source(tmp_path, {"copy1.md": body, "copy2.md": body})
    client = _client(tmp_path)
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)

    tree = client.get("/api/knowledge/wiki/tree").json()
    source_entry = next(s for s in tree["sources"] if s["source_id"] == source_id)
    assert len(source_entry["docs"]) == 1, "동일 해시 사본은 트리에 대표 1건만 노출"
    assert source_entry["docs"][0]["duplicate_count"] == 2
    assert tree["counts"]["docs"] == 2

    index_text = (tmp_path / "knowledge-wiki" / "index.md").read_text(encoding="utf-8")
    assert "(사본 2개)" in index_text


def test_migrate_doc_uid_renames_cards_without_parsing(tmp_path: Path, monkeypatch) -> None:
    source = _make_source(tmp_path, {"plan.md": "# 사업계획\n\n예산편성 추진배경입니다."})
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)
    doc = _doc_by_rel(services.db, source_id, "plan.md")
    old_card = Path(str(doc["card_path"]))

    # 레거시 상태 시뮬레이션: uid 미발급 + 사용자 메모 존재.
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET doc_uid = '' WHERE id = ?", (doc["id"],)
    )
    text = old_card.read_text(encoding="utf-8")
    old_card.write_text(text + "여기는 내 메모입니다.\n", encoding="utf-8")

    def forbidden_parse(path):
        raise AssertionError("migration must not parse documents")

    monkeypatch.setattr("gongmu_sidecar.knowledge_wiki.parse_document", forbidden_parse)

    response = client.post("/api/knowledge/migrate-doc-uid", json={"source_id": source_id})
    assert response.status_code == 200
    assert response.json()["migrated_count"] == 1

    migrated = _doc_by_rel(services.db, source_id, "plan.md")
    assert re.fullmatch(r"[0-9a-f]{8}", migrated["doc_uid"])
    new_card = Path(str(migrated["card_path"]))
    assert new_card.exists()
    assert migrated["slug"].endswith(migrated["doc_uid"])
    assert not old_card.exists(), "참조 0이 된 구 카드는 unlink된다"
    new_text = new_card.read_text(encoding="utf-8")
    assert f"doc_uid: {migrated['doc_uid']}" in new_text
    assert "여기는 내 메모입니다." in new_text, "마이그레이션 재투영도 메모를 보존한다"
    # 링크 안정: index.md가 새 슬러그를 가리키고, FTS 재삽입으로 검색이 살아 있다.
    index_text = (tmp_path / "knowledge-wiki" / "index.md").read_text(encoding="utf-8")
    assert f"docs/{migrated['slug']}.md" in index_text
    search = client.get("/api/knowledge/search", params={"query": "예산편성"}).json()
    assert any(item["slug"] == migrated["slug"] for item in search["items"])

    # 멱등: 재실행 시 대상 0건.
    second = client.post("/api/knowledge/migrate-doc-uid", json={"source_id": source_id})
    assert second.json()["migrated_count"] == 0


def test_citations_carry_doc_uid_and_by_uid_route_falls_back(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)
    doc = _doc_by_rel(services.db, source_id, "plan.md")

    ask = client.post("/api/knowledge/ask", json={"query": "예산편성 추진배경"}).json()
    assert ask["citations"]
    cited = next(c for c in ask["citations"] if c["title"] == "사업계획")
    assert cited["doc_uid"] == doc["doc_uid"]
    # 하위호환 필드 유지.
    assert cited["source_path"] and cited["title"] and "snippet" in cited

    found = client.get(f"/api/knowledge/cards/by-uid/{doc['doc_uid']}")
    assert found.status_code == 200
    payload = found.json()
    assert payload["card_path"] == doc["card_path"]
    assert payload["exists"] is True
    assert payload["status"] == "active"
    assert payload["title"] == "사업계획"

    assert client.get("/api/knowledge/cards/by-uid/ffffffff").status_code == 404

    # 원본 삭제(소프트) 후에도 by-uid 폴백은 카드 상태를 알려준다.
    (source / "plan.md").unlink()
    _scan(client, source_id)
    _ingest(client, source_id)
    fallback = client.get(f"/api/knowledge/cards/by-uid/{doc['doc_uid']}").json()
    assert fallback["status"] == "missing"
    assert fallback["exists"] is True, "유예 보관 중 카드 폴백이 가능해야 한다"


# ------------------------------------------------------ §5.7 사용자 메모 구역


def _append_note(card_path: Path, note: str) -> None:
    text = card_path.read_text(encoding="utf-8")
    assert USER_NOTES_MARKER in text, "신규 카드에 메모 구역이 상설되어야 한다"
    card_path.write_text(text.rstrip("\n") + f"\n{note}\n", encoding="utf-8")


def test_user_notes_survive_reingest_and_enrich(tmp_path: Path) -> None:
    source = _make_source(tmp_path, {"plan.md": "# 사업계획\n\n예산편성 추진배경입니다."})
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)
    doc = _doc_by_rel(services.db, source_id, "plan.md")
    card_path = Path(str(doc["card_path"]))
    _append_note(card_path, "결재 전에 국장님 보고 필요.")

    # 재작성 경로 ① 내용 변경 재인제스트.
    (source / "plan.md").write_text("# 사업계획\n\n수정된 예산편성 본문.", encoding="utf-8")
    _scan(client, source_id)
    _ingest(client, source_id)
    text = card_path.read_text(encoding="utf-8")
    assert "결재 전에 국장님 보고 필요." in text
    assert text.count(USER_NOTES_MARKER) == 1
    assert "수정된 예산편성 본문" in text

    # 재작성 경로 ② enrich(DB 재투영 + 메모 이어붙임).
    def fake_llm(messages):
        return json.dumps(
            {"summary": "요약 첫 문장. 둘째 문장. 셋째 문장.", "topics": ["예산"]},
            ensure_ascii=False,
        )

    result = services.wiki.enrich(llm=fake_llm)
    assert result["enriched_count"] >= 1
    text = card_path.read_text(encoding="utf-8")
    assert "결재 전에 국장님 보고 필요." in text
    assert "## LLM 요약" in text
    assert "요약 첫 문장." in text
    assert "## 섹션 아웃라인" in text, "재투영이 섹션 아웃라인을 유지해야 한다"
    assert text.count("## LLM 요약") == 1

    # 메모 편집만으로는 백업이 생기지 않는다(기계 영역 해시만 감시).
    backup_dir = tmp_path / "knowledge-wiki" / "docs" / ".backup"
    assert not backup_dir.exists() or not list(backup_dir.glob("*.md"))


def test_machine_region_edit_triggers_rotating_backup(tmp_path: Path) -> None:
    source = _make_source(tmp_path, {"plan.md": "# 사업계획\n\n예산편성 추진배경입니다."})
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)
    doc = _doc_by_rel(services.db, source_id, "plan.md")
    card_path = Path(str(doc["card_path"]))

    def tamper_and_reingest(marker: str) -> None:
        text = card_path.read_text(encoding="utf-8")
        card_path.write_text(text.replace("## 개요", f"## 개요 {marker}", 1), encoding="utf-8")
        response = client.post(
            "/api/knowledge/reindex", json={"source_id": source_id, "run_now": True}
        )
        assert response.status_code == 201

    backup_dir = tmp_path / "knowledge-wiki" / "docs" / ".backup"
    for index in range(4):
        tamper_and_reingest(f"수동편집{index}")
    backups = sorted(backup_dir.glob(f"{doc['slug']}-*.md"))
    assert len(backups) == 3, "파일당 백업은 최근 3개 순환"
    assert any("수동편집3" in path.read_text(encoding="utf-8") for path in backups)

    logs = services.db.list_logs(limit=200)
    assert any(log["action"] == "knowledge.wiki.card_backup" for log in logs)


def test_patch_card_failure_marks_dirty_and_next_job_repairs(tmp_path: Path) -> None:
    source = _make_source(tmp_path, {"plan.md": "# 사업계획\n\n예산편성 추진배경입니다."})
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)
    doc = _doc_by_rel(services.db, source_id, "plan.md")
    card_path = Path(str(doc["card_path"]))
    _append_note(card_path, "지켜야 할 메모.")

    # patch 실패 시뮬레이션: 카드가 사라진 상태에서 patch → card_dirty=1.
    card_path.unlink()
    ok = services.wiki.patch_card(str(doc["id"]), card_path, {"work_area": "예산"})
    assert ok is False
    marked = services.db.fetch_one(
        "SELECT card_dirty FROM knowledge_wiki_docs WHERE id = ?", (doc["id"],)
    )
    assert marked["card_dirty"] == 1

    # 다음 색인 잡이 DB 재투영으로 카드를 수복한다.
    _ingest(client, source_id)
    repaired = services.db.fetch_one(
        "SELECT card_dirty FROM knowledge_wiki_docs WHERE id = ?", (doc["id"],)
    )
    assert repaired["card_dirty"] == 0
    assert card_path.exists()
    text = card_path.read_text(encoding="utf-8")
    assert "## 섹션 아웃라인" in text
    assert USER_NOTES_MARKER in text
