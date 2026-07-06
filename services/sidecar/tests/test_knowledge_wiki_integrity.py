"""W7 P0 — 지식위키 인제스트 정합성 계약 테스트.

설계 원천: docs/design/2026-07-05-incremental-knowledge-sync-design.md
(§7 Windows 필수 방어 P0 + §5.4 enrich 증분화 + §5.8 refcount/GC + §2.2 고아 항목)
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from gongmu_sidecar.app import create_app
from gongmu_sidecar.db import now_iso


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _register_and_scan(client, source: Path, label: str = "정합성자료") -> str:
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
    defaults = {"plan.md": "# 사업계획\n\n예산편성 추진배경입니다. 개인정보보호법 준수."}
    for name, body in (files or defaults).items():
        (source / name).write_text(body, encoding="utf-8")
    return source


# ------------------------------------------------------------------ §7-3 트랜잭션


def test_interrupted_file_is_reprocessed_on_rerun(tmp_path: Path) -> None:
    """중단 시뮬레이션: 파일 처리 중 예외 → 스킵 마커 미기록 → 재실행 시 재처리."""
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    services = client.app.state.services
    wiki = services.wiki
    source_id = _register_and_scan(client, source)

    state = {"fail": True}
    original_upsert_fts = wiki._upsert_fts

    def flaky_upsert_fts(doc_id, title, body, card):
        if state["fail"]:
            raise RuntimeError("simulated crash before commit")
        return original_upsert_fts(doc_id, title, body, card)

    wiki._upsert_fts = flaky_upsert_fts

    job = _ingest(client, source_id)
    assert job["status"] == "partial"
    assert job["failed_count"] == 1

    # 트랜잭션 롤백으로 documents/wiki_docs 어느 쪽에도 흔적이 없어야 한다.
    assert services.db.fetch_one(
        "SELECT * FROM knowledge_documents WHERE source_id = ?", (source_id,)
    ) is None
    assert services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    ) is None
    # 스킵 판정 기준(file_hash+signature)이 커밋되지 않아 재실행 대상이어야 한다.
    pending, skipped = wiki._source_files_for_ingestion(source_id)
    assert len(pending) == 1
    assert skipped == 0

    state["fail"] = False
    rerun = _ingest(client, source_id)
    assert rerun["status"] == "completed"
    assert rerun["processed_count"] == 1
    search = client.get("/api/knowledge/search", params={"query": "예산편성"})
    assert search.json()["items"]


# --------------------------------------------------------------- §5.8 refcount


def test_duplicate_copies_keep_extracted_after_one_deletion(tmp_path: Path) -> None:
    """§5.6 doc_uid 1:1화: 사본마다 카드 1장, 추출본(해시명)은 공유 —
    사본 1개 삭제(소프트) 후에도 생존 사본의 카드·추출본은 남아야 한다."""
    body = "# 공유 문서\n\n동일 내용 사본입니다. 예산편성 자료."
    source = _make_source(tmp_path, {"copy1.md": body, "copy2.md": body})
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)

    docs = services.db.fetch_all(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    assert len(docs) == 2
    card_paths = {doc["card_path"] for doc in docs}
    extracted_paths = {doc["extracted_path"] for doc in docs}
    assert len(card_paths) == 2, "doc_uid 1:1화로 사본마다 카드 1장이 생긴다 (§5.6)"
    assert len(extracted_paths) == 1, "추출본(해시명)은 계속 공유한다"
    shared_extracted = Path(next(iter(extracted_paths)))
    assert shared_extracted.exists()

    (source / "copy2.md").unlink()
    _scan(client, source_id)
    _ingest(client, source_id)

    active = services.db.fetch_all(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ? AND status != ?",
        (source_id, "missing"),
    )
    assert len(active) == 1
    survivor_card = Path(str(active[0]["card_path"]))
    assert survivor_card.exists(), "생존 사본의 카드는 남아야 한다"
    assert shared_extracted.exists(), "사본 1개 삭제 후에도 공유 추출본은 남아야 한다"
    search = client.get("/api/knowledge/search", params={"query": "예산편성"})
    assert search.json()["items"]


def test_old_card_unlink_respects_refcount_on_content_change(tmp_path: Path) -> None:
    """슬러그 변경(제목 변경) 시 구 카드 unlink 지점의 refcount 계약."""
    body = "# 공유 문서\n\n동일 내용 사본입니다. 예산편성 자료."
    source = _make_source(tmp_path, {"copy1.md": body, "copy2.md": body})
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)

    docs = {
        row["relative_path"]: row
        for row in services.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
        )
    }
    copy1_card = Path(str(docs["copy1.md"]["card_path"]))
    copy2_card = Path(str(docs["copy2.md"]["card_path"]))
    assert copy1_card.exists() and copy2_card.exists()

    # copy1의 내용(제목 포함)이 바뀌면 slug(제목부)가 달라져 카드가 개명된다.
    (source / "copy1.md").write_text("# 개편 문서\n\n내용이 완전히 바뀌었습니다.", encoding="utf-8")
    _scan(client, source_id)
    _ingest(client, source_id)

    rows = {
        row["relative_path"]: row
        for row in services.db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
        )
    }
    new_copy1_card = Path(str(rows["copy1.md"]["card_path"]))
    assert "개편-문서" in new_copy1_card.name
    assert new_copy1_card.exists()
    assert not copy1_card.exists(), "참조 0이 된 구 카드는 unlink된다"
    assert copy2_card.exists(), "copy2의 카드는 남아야 한다"
    # doc_uid는 내용이 바뀌어도 불변이다 (§5.6 '내용 수정≠카드 교체').
    assert rows["copy1.md"]["doc_uid"] == docs["copy1.md"]["doc_uid"]


# ------------------------------------------------------------------- §5.8 GC


def test_job_end_gc_removes_orphans_and_keeps_id_named_files(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)

    wiki_root = tmp_path / "knowledge-wiki"
    legit_extracted = set((wiki_root / "extracted").glob("*.md"))
    assert legit_extracted

    orphan_extracted = wiki_root / "extracted" / ("a" * 64 + ".md")
    orphan_extracted.write_text("고아 추출본", encoding="utf-8")
    id_named = wiki_root / "extracted" / f"{uuid4()}.md"
    id_named.write_text("해시 부재 문서 추출본", encoding="utf-8")

    raw_dir = services.paths.knowledge_raw / "source-files" / source_id
    raw_dir.mkdir(parents=True, exist_ok=True)
    legit_raw = set(raw_dir.glob("*.txt"))
    orphan_raw = raw_dir / ("b" * 64 + ".txt")
    orphan_raw.write_text("고아 원문", encoding="utf-8")

    _ingest(client, source_id)  # 변경 없음 — 잡 말미 GC만 동작

    assert not orphan_extracted.exists(), "현행 해시 집합에 없는 추출본은 GC되어야 한다"
    assert id_named.exists(), "<document_id>.md 형식 파일은 GC에서 제외되어야 한다"
    assert not orphan_raw.exists(), "비삭제 소스 해시에 없는 raw 원문은 GC되어야 한다"
    for path in legit_extracted:
        assert path.exists(), "생존 문서의 추출본은 남아야 한다"
    for path in legit_raw:
        assert path.exists(), "생존 소스 파일의 raw 원문은 남아야 한다"

    log_text = (wiki_root / "log.md").read_text(encoding="utf-8")
    assert "gc_extracted=1" in log_text
    assert "gc_raw=1" in log_text


# --------------------------------------------------------------- 고아 태그 큐


def test_delete_wiki_doc_clears_pending_tag_queue(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)

    doc = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    assert doc is not None
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
    services.db.insert(
        "knowledge_tag_queue",
        {
            "id": str(uuid4()),
            "source_id": source_id,
            "wiki_doc_id": doc["id"],
            "doc_slug": doc["slug"],
            "status": "resolved",
            "created_at": now_iso(),
        },
    )

    (source / "plan.md").unlink()
    _scan(client, source_id)
    _ingest(client, source_id)

    rows = services.db.fetch_all(
        "SELECT * FROM knowledge_tag_queue WHERE wiki_doc_id = ?", (doc["id"],)
    )
    statuses = [row["status"] for row in rows]
    assert "pending" not in statuses, "삭제 문서의 pending 큐 항목은 정리되어야 한다"
    assert "resolved" in statuses, "사용자 확정 이력(resolved)은 남아야 한다"


# --------------------------------------------------------------- §5.4 enrich


def test_enrich_updates_fts_with_summary(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    wiki = client.app.state.services.wiki
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)

    def fake_llm(messages):
        return json.dumps(
            {"summary": "판타지아프로젝트 관련 요약입니다. 배경 설명. 계획 설명.", "topics": ["예산"]},
            ensure_ascii=False,
        )

    result = wiki.enrich(llm=fake_llm)
    assert result["status"] == "completed"

    search = client.get("/api/knowledge/search", params={"query": "판타지아프로젝트"})
    payload = search.json()
    assert payload["mode"] == "fts5"
    assert payload["items"], "LLM 요약이 전문검색(FTS)에 반영되어야 한다"


def test_reingest_content_change_resets_enrichment_but_keeps_summary(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    services = client.app.state.services
    wiki = services.wiki
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)

    def fake_llm(messages):
        return json.dumps(
            {"summary": "기존 요약 문장입니다. 둘째 문장. 셋째 문장.", "topics": ["예산"]},
            ensure_ascii=False,
        )

    wiki.enrich(llm=fake_llm)
    before = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    assert before["enriched"] == 1
    assert before["summary_stale"] == 0

    (source / "plan.md").write_text(
        "# 사업계획\n\n수정된 본문입니다. 새 예산편성 지침이 반영되었습니다.", encoding="utf-8"
    )
    _scan(client, source_id)
    _ingest(client, source_id)

    after = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    assert after["enriched"] == 0, "내용 변경 시 재보강 대상으로 리셋되어야 한다"
    assert after["summary_stale"] == 1, "낡은 요약은 summary_stale=1로 표기되어야 한다"
    assert after["summary"] == before["summary"], "기존 요약 텍스트는 유지되어야 한다"
    assert after["topics_json"] == before["topics_json"], "기존 주제는 유지되어야 한다"


def test_enrich_failure_backoff_skips_after_three_failures(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    services = client.app.state.services
    wiki = services.wiki
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)

    def broken_llm(messages):
        return "JSON이 아닌 응답"

    for attempt in range(3):
        result = wiki.enrich(llm=broken_llm)
        assert result["failed_count"] == 1, f"{attempt + 1}회차 실패가 기록되어야 한다"

    doc = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    assert doc["enrich_fail_count"] == 3
    assert doc["enrich_skip"] == 1

    fourth = wiki.enrich(llm=broken_llm)
    assert fourth["total_count"] == 0, "3회 실패 문서는 보강 대상에서 제외되어야 한다"

    # 스킵 해제 후 성공하면 카운트가 리셋된다.
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET enrich_skip = 0 WHERE id = ?", (doc["id"],)
    )

    def good_llm(messages):
        return json.dumps(
            {"summary": "성공한 요약입니다. 둘째 문장. 셋째 문장.", "topics": ["예산"]},
            ensure_ascii=False,
        )

    success = wiki.enrich(llm=good_llm)
    assert success["enriched_count"] == 1
    recovered = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (doc["id"],)
    )
    assert recovered["enriched"] == 1
    assert recovered["enrich_fail_count"] == 0
    assert recovered["enrich_skip"] == 0
    assert recovered["summary_stale"] == 0


# ------------------------------------------------------------------ §7-5 TTL


def test_stale_queued_ingestion_job_auto_cancels_and_unblocks_409(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)

    queued = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": False})
    assert queued.status_code == 201
    job_id = queued.json()["job"]["id"]

    # queued 잡이 살아 있는 동안에는 409로 차단된다.
    blocked = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})
    assert blocked.status_code == 409

    stale_time = (datetime.now(timezone.utc) - timedelta(minutes=31)).isoformat()
    services.db.execute(
        "UPDATE knowledge_ingestion_jobs SET created_at = ? WHERE id = ?", (stale_time, job_id)
    )

    retry = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})
    assert retry.status_code == 201, "TTL 초과 잡은 자동 취소되어 409가 풀려야 한다"
    canceled = services.db.fetch_one(
        "SELECT * FROM knowledge_ingestion_jobs WHERE id = ?", (job_id,)
    )
    assert canceled["status"] == "canceled"
    assert "대기 시간 초과" in str(canceled["error_message"])


def test_future_created_at_queued_job_is_immediately_stale(tmp_path: Path) -> None:
    """시계 역행 방어: created_at이 미래인 queued 잡은 즉시 stale 취소된다."""
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)

    queued = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": False})
    job_id = queued.json()["job"]["id"]
    future_time = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    services.db.execute(
        "UPDATE knowledge_ingestion_jobs SET created_at = ? WHERE id = ?", (future_time, job_id)
    )

    jobs = client.get("/api/knowledge/ingestion-jobs").json()["items"]
    row = next(item for item in jobs if item["id"] == job_id)
    assert row["status"] == "canceled"


# --------------------------------------------------------- §7-7 연속 실패 상한


def test_consecutive_parse_failures_abort_job_as_partial(tmp_path: Path, monkeypatch) -> None:
    files = {f"doc-{index:02d}.md": f"# 문서 {index}\n\n본문 {index}." for index in range(12)}
    source = _make_source(tmp_path, files)
    client = _client(tmp_path)
    source_id = _register_and_scan(client, source)

    def broken_parser(path):
        raise RuntimeError("parser crashed")

    monkeypatch.setattr("gongmu_sidecar.knowledge_wiki.parse_document", broken_parser)

    job = _ingest(client, source_id)
    assert job["status"] == "partial"
    assert job["failed_count"] == 10, "연속 실패 10건에서 잔여 파일 처리를 중단해야 한다"
    assert job["processed_count"] == 0
    assert "연속 파싱 실패" in str(job["error_message"])


# --------------------------------------------------------- lint quick/deep API


def test_lint_quick_skips_rehash_and_deep_detects_silent_change(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    wiki = client.app.state.services.wiki
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)

    # 재스캔 없이 원본만 몰래 변경 — quick은 재해시하지 않아 못 보고, deep만 잡는다.
    (source / "plan.md").write_text("# 사업계획\n\n몰래 바뀐 내용입니다.", encoding="utf-8")

    quick = wiki.lint(fix=False)
    assert quick["mode"] == "quick"
    assert quick["stale"] == [], "quick 모드는 재해시를 수행하지 않아야 한다"

    deep = wiki.lint(fix=False, deep=True)
    assert deep["mode"] == "deep"
    assert len(deep["stale"]) == 1, "deep 모드는 silent change를 재해시로 잡아야 한다"


def test_lint_api_route_runs_quick_and_logs_korean_record(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _register_and_scan(client, source)
    _ingest(client, source_id)

    response = client.post("/api/knowledge/lint", json={"fix": False, "deep": False})
    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "quick"
    assert payload["checked_count"] == 1
    assert payload["orphans"] == []

    logs = services.db.list_logs()
    entry = next(log for log in logs if log["action"] == "knowledge.wiki.lint")
    assert "지식위키 정합성 점검" in entry["outputs"]["message"]
    assert entry["outputs"]["mode"] == "quick"

    deep_response = client.post("/api/knowledge/lint", json={"fix": False, "deep": True})
    assert deep_response.status_code == 200
    assert deep_response.json()["mode"] == "deep"
