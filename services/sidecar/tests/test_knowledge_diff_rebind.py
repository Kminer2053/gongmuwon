"""W7 P1 — 2-pass diff·MOVED rebind·casefold 수렴 회귀 테스트 (설계서 §4.2/§4.3/§7-6/§9).

1. 이동(내용 동일·다른 폴더): kordoc/파서 재파싱 0회 + 태그·enriched 승계 +
   lint quick orphan 미검출 + FTS 검색에 새 경로
2. 대소문자만 다른 rename: 행 2개가 아니라 같은 행의 file_path 갱신으로 수렴
3. 동일 해시 사본 2개 동시 이동: 1:1이 아니므로 ADDED+DELETED 폴백
4. diff 견적 엔드포인트: 읽기 전용(연속 2회 동일·DB 무변경) + 분해 카운트
5. stem 유래 title 문서 rename: title·슬러그 갱신 + 구 카드 refcount unlink
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

import gongmu_sidecar.knowledge_wiki as knowledge_wiki_module
from gongmu_sidecar.app import create_app


def _make_app(tmp_path: Path):
    app = create_app(tmp_path)
    return app, app.state.test_client_factory()


def _register(client, source: Path, label: str = "업무자료") -> str:
    created = client.post(
        "/api/knowledge/sources",
        json={"label": label, "root_path": str(source)},
    )
    assert created.status_code == 201
    return created.json()["id"]


def _scan(client, source_id: str) -> dict:
    response = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert response.status_code == 200
    return response.json()


def _ingest(client, source_id: str) -> dict:
    response = client.post(
        "/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}
    )
    assert response.status_code == 201
    return response.json()


def _age(path: Path, seconds: float = 7200.0) -> None:
    """mtime을 과거로 밀어 '방금 쓴 파일' 보류·mtime 동률 플레이크를 제거한다."""
    past = time.time() - seconds
    os.utime(path, (past, past))


def _count_parse_calls(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """knowledge_wiki.parse_document 호출을 기록한다 — 재파싱 0회 검증용."""
    calls: list[str] = []
    real_parse = knowledge_wiki_module.parse_document

    def counting(path):
        calls.append(str(path))
        return real_parse(path)

    monkeypatch.setattr(knowledge_wiki_module, "parse_document", counting)
    return calls


# ---------------------------------------------------------------------------
# 1. 이동 rebind — 재파싱 0회 + 태그·요약 승계 + lint/FTS 정합 (§4.3)
# ---------------------------------------------------------------------------


def test_move_rebinds_without_reparse_and_preserves_tags(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source"
    source.mkdir()
    plan = source / "plan.md"
    plan.write_text(
        "# 사업계획\n\n## 추진배경\n\n지역 예산편성 사업의 추진배경입니다.\n",
        encoding="utf-8",
    )
    _age(plan)

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)
    _scan(client, source_id)
    _ingest(client, source_id)

    db = app.state.services.db
    doc_before = db.fetch_one("SELECT * FROM knowledge_wiki_docs")
    assert doc_before is not None
    # T-01 태깅·enrich 결과 시뮬레이션 — rebind가 이 값을 승계해야 한다.
    db.execute(
        "UPDATE knowledge_wiki_docs SET work_area_slug = ?, doc_role = ?, enriched = 1, summary = ? "
        "WHERE id = ?",
        ("예산", "보고서", "기존 LLM 요약", doc_before["id"]),
    )

    archive = source / "정리보관"
    archive.mkdir()
    new_path = archive / "plan.md"
    plan.rename(new_path)

    calls = _count_parse_calls(monkeypatch)

    payload = _scan(client, source_id)
    assert payload["moved_count"] == 1
    assert payload["added_count"] == 0
    assert payload["deleted_count"] == 0
    assert payload["moved"] == [{"from": str(plan), "to": str(new_path)}]

    # 색인을 다시 돌려도 해시+시그니처 일치로 스킵된다 — kordoc 재파싱 0회.
    ingest = _ingest(client, source_id)
    assert calls == []
    assert ingest["job"]["skipped_count"] == 1

    doc_after = db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (doc_before["id"],)
    )
    assert doc_after is not None, "rebind는 행 id를 보존해야 한다"
    assert doc_after["source_path"] == str(new_path)
    assert doc_after["relative_path"] == "정리보관/plan.md"
    assert doc_after["work_area_slug"] == "예산"
    assert doc_after["doc_role"] == "보고서"
    assert doc_after["enriched"] == 1
    assert doc_after["summary"] == "기존 LLM 요약"

    document = db.fetch_one("SELECT * FROM knowledge_documents")
    assert document["file_path"] == str(new_path)

    card_text = Path(doc_after["card_path"]).read_text(encoding="utf-8")
    assert f"source_path: {new_path}" in card_text
    assert f"- 원본 경로: {new_path}" in card_text
    assert str(plan) not in card_text

    # lint quick(fix=True)가 rebind 문서를 orphan으로 오판해 삭제하지 않는다 (§8 자기모순 봉합).
    lint = client.post("/api/knowledge/lint", json={"fix": True})
    assert lint.status_code == 200
    report = lint.json()
    assert report["orphans"] == []
    assert report["fixed"]["orphans_removed"] == 0
    assert db.fetch_one(
        "SELECT id FROM knowledge_wiki_docs WHERE id = ?", (doc_before["id"],)
    ) is not None

    # FTS 검색: 카드 전문 재색인으로 새 폴더명이 검색되고, 결과 경로도 새 경로다.
    search = client.get("/api/knowledge/search", params={"query": "정리보관"})
    assert search.status_code == 200
    items = search.json()["items"]
    assert items
    assert items[0]["source_path"] == str(new_path)


# ---------------------------------------------------------------------------
# 2. 대소문자 rename 단일 행 수렴 (§7-6)
# ---------------------------------------------------------------------------


def test_case_only_rename_converges_to_single_row(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    doc = source / "Budget-Plan.md"
    doc.write_text("# 예산 계획\n\n예산편성 본문입니다.\n", encoding="utf-8")
    _age(doc)

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)
    _scan(client, source_id)
    _ingest(client, source_id)

    renamed = source / "budget-plan.md"
    doc.rename(renamed)

    payload = _scan(client, source_id)
    assert payload["moved_count"] == 1
    assert payload["added_count"] == 0
    assert payload["deleted_count"] == 0

    db = app.state.services.db
    rows = db.fetch_all("SELECT * FROM knowledge_source_files")
    assert len(rows) == 1, "대소문자 rename이 행 2개(ADDED+DELETED)를 만들면 안 된다"
    assert rows[0]["status"] != "deleted"
    # DB 저장은 원문(새 표기) 유지 — 비교만 casefold.
    assert rows[0]["file_path"] == str(renamed)
    assert rows[0]["relative_path"] == "budget-plan.md"

    wiki_doc = db.fetch_one("SELECT * FROM knowledge_wiki_docs")
    assert wiki_doc["source_path"] == str(renamed)


# ---------------------------------------------------------------------------
# 3. 동일 해시 사본 2개 동시 이동 — 1:1이 아니면 폴백 (§4.2 [4])
# ---------------------------------------------------------------------------


def test_duplicate_copies_moved_together_fall_back_to_added_deleted(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    content = "# 동일 내용\n\n같은 본문입니다.\n"
    first = source / "dup-a.md"
    second = source / "dup-b.md"
    first.write_text(content, encoding="utf-8")
    second.write_text(content, encoding="utf-8")
    _age(first)
    _age(second)

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)
    _scan(client, source_id)

    moved_dir = source / "moved"
    moved_dir.mkdir()
    first.rename(moved_dir / "dup-a.md")
    second.rename(moved_dir / "dup-b.md")

    payload = _scan(client, source_id)
    # (size, hash)가 2:2라 오매칭 위험 — 안전 폴백(ADDED+DELETED)이어야 한다.
    assert payload["moved_count"] == 0
    assert payload["added_count"] == 2
    assert payload["deleted_count"] == 2


# ---------------------------------------------------------------------------
# 4. diff 견적 — 읽기 전용·연속 호출 동일·분해 카운트 (§9 P1)
# ---------------------------------------------------------------------------


def test_diff_endpoint_is_read_only_and_stable(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    keep = source / "keep.md"
    modify = source / "modify.md"
    delete = source / "delete.md"
    move = source / "move.md"
    keep.write_text("# 유지 문서\n\n그대로 두는 본문.\n", encoding="utf-8")
    modify.write_text("# 수정 문서\n\n구버전 본문.\n", encoding="utf-8")
    delete.write_text("# 삭제 문서\n\n지워질 본문.\n", encoding="utf-8")
    move.write_text("# 이동 문서\n\n옮겨질 본문.\n", encoding="utf-8")
    for path in (keep, modify, delete, move):
        _age(path)

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)
    _scan(client, source_id)

    (source / "new.md").write_text("# 신규 문서\n\n새로 생긴 본문.\n", encoding="utf-8")
    modify.write_text("# 수정 문서\n\n신버전 본문으로 교체.\n", encoding="utf-8")
    delete.unlink()
    sub = source / "sub"
    sub.mkdir()
    moved_to = sub / "move.md"
    move.rename(moved_to)

    db = app.state.services.db
    rows_before = db.fetch_all("SELECT * FROM knowledge_source_files ORDER BY id")
    logs_before = db.fetch_one("SELECT COUNT(*) AS count FROM execution_logs")["count"]

    first = client.get(f"/api/knowledge/sources/{source_id}/diff")
    assert first.status_code == 200
    second = client.get(f"/api/knowledge/sources/{source_id}/diff")
    assert second.status_code == 200
    assert first.json() == second.json(), "읽기 전용 diff는 연속 호출 결과가 같아야 한다"

    payload = first.json()
    assert payload["added"] == 1
    assert payload["modified"] == 1
    assert payload["moved"] == 1
    assert payload["deleted"] == 1
    assert payload["unchanged"] == 1
    assert payload["unstable"] == 0
    assert payload["moved_items"] == [{"from": str(move), "to": str(moved_to)}]
    # 재해시 대상: 신규 1 + 수정 1 + 이동 후보(신규 경로) 1
    assert payload["rehash_estimate"]["files"] == 3
    assert payload["rehash_estimate"]["bytes"] > 0
    assert payload["exceeds_gate"] is False

    rows_after = db.fetch_all("SELECT * FROM knowledge_source_files ORDER BY id")
    logs_after = db.fetch_one("SELECT COUNT(*) AS count FROM execution_logs")["count"]
    assert rows_after == rows_before, "diff는 knowledge_source_files를 갱신하면 안 된다"
    assert logs_after == logs_before, "diff는 실행기록도 남기지 않는다"

    # 실제 스캔은 견적과 동일한 분해로 반영된다.
    scan_payload = _scan(client, source_id)
    assert scan_payload["added_count"] == 1
    assert scan_payload["modified_count"] == 1
    assert scan_payload["moved_count"] == 1
    assert scan_payload["deleted_count"] == 1
    assert scan_payload["unchanged_count"] == 1


def test_diff_gate_flag_reflects_thresholds(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "source"
    source.mkdir()
    fresh = source / "big.md"
    fresh.write_text("# 큰 문서\n\n본문입니다.\n", encoding="utf-8")
    _age(fresh)

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)

    from gongmu_sidecar.knowledge import KnowledgeManager

    monkeypatch.setattr(KnowledgeManager, "DIFF_REHASH_GATE_BYTES", 1)
    response = client.get(f"/api/knowledge/sources/{source_id}/diff")
    assert response.status_code == 200
    payload = response.json()
    assert payload["added"] == 1
    assert payload["exceeds_gate"] is True


# ---------------------------------------------------------------------------
# 5. stem 유래 title 문서 rename — title·슬러그 갱신 + 구 카드 unlink (§4.3-⑥)
# ---------------------------------------------------------------------------


def test_stem_title_rename_updates_title_slug_and_unlinks_old_card(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source"
    source.mkdir()
    old_file = source / "구계획안.txt"
    # txt 파서는 title을 파일명 stem으로 폴백한다 — rename 시 제목 잔존을 검증할 표본.
    old_file.write_text("예산 개편 관련 정리 내용입니다.", encoding="utf-8")
    _age(old_file)

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)
    _scan(client, source_id)
    _ingest(client, source_id)

    db = app.state.services.db
    wiki_before = db.fetch_one("SELECT * FROM knowledge_wiki_docs")
    assert wiki_before["title"] == "구계획안"
    old_card = Path(wiki_before["card_path"])
    assert old_card.exists()

    new_file = source / "신계획안.txt"
    old_file.rename(new_file)

    calls = _count_parse_calls(monkeypatch)
    payload = _scan(client, source_id)
    assert payload["moved_count"] == 1

    wiki_after = db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (wiki_before["id"],)
    )
    assert wiki_after["title"] == "신계획안"
    assert wiki_after["slug"] != wiki_before["slug"]
    assert "신계획안" in wiki_after["slug"]
    assert wiki_after["source_path"] == str(new_file)

    new_card = Path(wiki_after["card_path"])
    assert new_card.exists()
    assert new_card != old_card
    assert not old_card.exists(), "참조 0인 구 카드는 refcount 확인 후 unlink된다"

    card_text = new_card.read_text(encoding="utf-8")
    assert "# 신계획안" in card_text
    assert f"- 원본 경로: {new_file}" in card_text

    # rename도 재파싱 없이 승계된다.
    ingest = _ingest(client, source_id)
    assert calls == []
    assert ingest["job"]["skipped_count"] == 1

    search = client.get("/api/knowledge/search", params={"query": "신계획안"})
    assert search.status_code == 200
    items = search.json()["items"]
    assert items
    assert items[0]["title"] == "신계획안"
    assert items[0]["source_path"] == str(new_file)
