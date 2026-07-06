"""W7 P3 — 무결성 점검(verify) 잡(§6) · 분류체계 드리프트(§5.9) 계약 테스트.

설계 원천: docs/design/2026-07-05-incremental-knowledge-sync-design.md
- verify: V1~V10 자동 치유/보고, V11 deep 재해시(quick 재해시 금지), 불변식 5종,
  리포트 1행 + JSONL + 한국어 실행기록(0건이어도), GET /api/knowledge/verify/latest
- 드리프트: 신규 폴더 ≥5 / low 유입률 ≥30% / 확정 폴더 0건화 3판정,
  참고서고 오탐 없음, 재확정 시 drift_json 클리어, GET taxonomy 응답에 drift 포함
"""

from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

from gongmu_sidecar.app import create_app
from gongmu_sidecar.db import now_iso


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _make_source(tmp_path: Path, files: dict[str, str] | None = None) -> Path:
    source = tmp_path / "source"
    source.mkdir(exist_ok=True)
    defaults = {"plan.md": "# 사업계획\n\n예산편성 추진배경입니다."}
    for name, body in (files or defaults).items():
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
    return source


def _register(client, source: Path, label: str = "점검자료") -> str:
    created = client.post(
        "/api/knowledge/sources", json={"label": label, "root_path": str(source)}
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
    return response.json()["job"]


def _setup(client, tmp_path: Path, files: dict[str, str] | None = None) -> str:
    source = _make_source(tmp_path, files)
    source_id = _register(client, source)
    _scan(client, source_id)
    job = _ingest(client, source_id)
    assert job["status"] == "completed"
    return source_id


def _verify(client, *, deep: bool = False) -> dict:
    response = client.post("/api/knowledge/verify", json={"deep": deep})
    assert response.status_code == 201
    payload = response.json()
    assert payload["work_job"]["kind"] == "knowledge.verify"
    assert payload["work_job"]["status"] == "succeeded"
    return payload["report"]


def _check(report: dict, code: str) -> dict | None:
    return next((check for check in report["checks"] if check["code"] == code), None)


def _confirm(client, source_id: str, areas: list[dict]) -> dict:
    response = client.post(
        "/api/knowledge/taxonomy",
        json={
            "source_id": source_id,
            "work_areas": areas,
            "doc_roles_enabled": [],
            "family_policy": "latest_representative",
        },
    )
    assert response.status_code == 201
    return response.json()


# ---------------------------------------------------------------------------
# §6 V1 — 원본 부재 행: 자동 치유(soft delete 경유 purge 수준)
# ---------------------------------------------------------------------------


def test_verify_orphan_source_heals_via_soft_delete(tmp_path: Path) -> None:
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _setup(client, tmp_path)

    doc = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    Path(str(doc["source_path"])).unlink()  # 스캔 없이 원본만 소실 — verify가 잡아야 한다

    report = _verify(client)
    orphan = _check(report, "orphan")
    assert orphan["count"] == 1
    assert orphan["healed"] >= 1

    after = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (doc["id"],)
    )
    assert after["status"] == "missing", "purge 수준 치유는 소프트 삭제 계약(§5.5)을 따른다"
    assert after["missing_since"]
    source_file = services.db.fetch_one(
        "SELECT status FROM knowledge_source_files WHERE id = ?", (doc["source_file_id"],)
    )
    assert source_file["status"] == "deleted"
    fts = services.db.fetch_one(
        "SELECT COUNT(*) AS count FROM knowledge_fts WHERE doc_id = ?", (doc["id"],)
    )
    assert int(fts["count"]) == 0, "검색에서는 즉시 사라져야 한다"
    card_text = Path(str(doc["card_path"])).read_text(encoding="utf-8")
    assert "원본이 삭제되었거나" in card_text, "유예 보관 배너가 있어야 한다"


# ---------------------------------------------------------------------------
# §6 V2 — 카드 실종: DB 재투영(파싱 0회)
# ---------------------------------------------------------------------------


def test_verify_missing_card_reprojected_from_db(tmp_path: Path) -> None:
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _setup(client, tmp_path)

    doc = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    card_path = Path(str(doc["card_path"]))
    card_path.unlink()

    report = _verify(client)
    check = _check(report, "missing_card")
    assert check["count"] == 1
    assert check["healed"] == 1
    assert card_path.exists(), "카드가 DB에서 재투영되어야 한다"
    text = card_path.read_text(encoding="utf-8")
    assert "# 사업계획" in text
    assert "## 내 메모" in text
    after = services.db.fetch_one(
        "SELECT card_hash, card_dirty FROM knowledge_wiki_docs WHERE id = ?", (doc["id"],)
    )
    assert after["card_hash"]
    assert after["card_dirty"] == 0


# ---------------------------------------------------------------------------
# §6 V3 — 추출본 실종: 보고만(재파싱 견적) — 자동 재파싱 금지
# ---------------------------------------------------------------------------


def test_verify_missing_extracted_reports_estimate_without_reparse(tmp_path: Path) -> None:
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _setup(client, tmp_path)

    doc = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    extracted = Path(str(doc["extracted_path"]))
    extracted.unlink()

    report = _verify(client)
    check = _check(report, "missing_extracted")
    assert check["count"] == 1
    assert check["healed"] == 0, "파싱 비용이 드는 수리는 자동 실행하지 않는다"
    assert "바이트" in check["action_hint"], "재파싱 견적(건수·바이트)을 안내해야 한다"
    assert not extracted.exists(), "verify가 몰래 재파싱하면 안 된다"


# ---------------------------------------------------------------------------
# §6 V4 — 고아 산출물: 자동 삭제 + 회수량 보고 (<id>.md형 제외)
# ---------------------------------------------------------------------------


def test_verify_gc_orphan_artifacts_and_reports_reclaimed_bytes(tmp_path: Path) -> None:
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _setup(client, tmp_path)

    wiki_root = tmp_path / "knowledge-wiki"
    orphan_extracted = wiki_root / "extracted" / ("a" * 64 + ".md")
    orphan_extracted.write_text("고아 추출본", encoding="utf-8")
    id_named = wiki_root / "extracted" / f"{uuid4()}.md"
    id_named.write_text("해시 부재 문서", encoding="utf-8")
    raw_dir = services.paths.knowledge_raw / "source-files" / source_id
    raw_dir.mkdir(parents=True, exist_ok=True)
    orphan_raw = raw_dir / ("b" * 64 + ".txt")
    orphan_raw.write_text("고아 원문", encoding="utf-8")

    report = _verify(client)
    check = _check(report, "orphan_artifact")
    assert check["count"] == 2
    assert check["healed"] == 2
    assert not orphan_extracted.exists()
    assert not orphan_raw.exists()
    assert id_named.exists(), "<document_id>.md 형식은 GC에서 제외되어야 한다"
    assert report["disk_reclaimed_bytes"] > 0


# ---------------------------------------------------------------------------
# §6 V5 — FTS↔doc 불일치: 자동 재동기화 (누락 재삽입 + 잔존 삭제)
# ---------------------------------------------------------------------------


def test_verify_fts_drift_resynced(tmp_path: Path) -> None:
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _setup(client, tmp_path)

    doc = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    services.db.execute("DELETE FROM knowledge_fts WHERE doc_id = ?", (doc["id"],))
    services.db.execute(
        "INSERT INTO knowledge_fts (doc_id, title, body, card) VALUES (?, ?, ?, ?)",
        ("ghost-doc-id", "유령", "유령 본문", "유령 카드"),
    )

    report = _verify(client)
    check = _check(report, "fts_drift")
    assert check["count"] == 2, "누락 1건 + 잔존(유령) 1건"
    assert check["healed"] == 2

    restored = services.db.fetch_one(
        "SELECT COUNT(*) AS count FROM knowledge_fts WHERE doc_id = ?", (doc["id"],)
    )
    assert int(restored["count"]) == 1
    ghost = services.db.fetch_one(
        "SELECT COUNT(*) AS count FROM knowledge_fts WHERE doc_id = ?", ("ghost-doc-id",)
    )
    assert int(ghost["count"]) == 0
    search = client.get("/api/knowledge/search", params={"query": "예산편성"})
    assert search.json()["items"], "재동기화 후 전문검색이 복구되어야 한다"


# ---------------------------------------------------------------------------
# §6 V6 — 고아 pending 큐: 자동 삭제 (생존 문서 큐는 보존)
# ---------------------------------------------------------------------------


def test_verify_orphan_queue_removed_and_live_queue_kept(tmp_path: Path) -> None:
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _setup(client, tmp_path)

    doc = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    orphan_queue_id = str(uuid4())
    live_queue_id = str(uuid4())
    for queue_id, wiki_doc_id in ((orphan_queue_id, "no-such-doc"), (live_queue_id, doc["id"])):
        services.db.insert(
            "knowledge_tag_queue",
            {
                "id": queue_id,
                "source_id": source_id,
                "wiki_doc_id": wiki_doc_id,
                "doc_slug": "x",
                "status": "pending",
                "created_at": now_iso(),
            },
        )

    report = _verify(client)
    check = _check(report, "orphan_queue")
    assert check["count"] == 1
    assert check["healed"] == 1
    assert services.db.fetch_one(
        "SELECT * FROM knowledge_tag_queue WHERE id = ?", (orphan_queue_id,)
    ) is None
    assert services.db.fetch_one(
        "SELECT * FROM knowledge_tag_queue WHERE id = ?", (live_queue_id,)
    ) is not None


# ---------------------------------------------------------------------------
# §6 V7 — 미색인 변경분: 보고 + "색인 시작" 안내(자동 색인 금지)
# ---------------------------------------------------------------------------


def test_verify_stale_index_reports_only(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source = tmp_path / "source"
    source_id = _setup(client, tmp_path)

    (source / "plan.md").write_text("# 사업계획\n\n개정된 지침 반영본입니다.", encoding="utf-8")
    _scan(client, source_id)  # 스캔만 하고 색인은 하지 않는다

    report = _verify(client)
    check = _check(report, "stale_index")
    assert check["count"] == 1
    assert check["healed"] == 0
    assert "색인" in check["action_hint"]


# ---------------------------------------------------------------------------
# §6 V8 — 무태그 문서(큐에도 없음): 보고 + "분류 적용" 안내
# ---------------------------------------------------------------------------


def test_verify_untagged_reports_with_apply_hint(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source_id = _setup(
        client,
        tmp_path,
        {
            "예산/예산집행지침.md": "# 예산집행지침\n\n예산 집행 지침입니다.",
            "□참고□서고/옛자료.md": "# 옛자료\n\n참고용 자료입니다.",
        },
    )
    _confirm(client, source_id, [{"name": "예산", "folders": ["예산"], "keywords": ["예산"]}])

    report = _verify(client)
    check = _check(report, "untagged")
    assert check["count"] == 1, "참고서고 문서는 무태그 집계에서 제외되어야 한다"
    assert check["healed"] == 0
    assert "분류 적용" in check["action_hint"]


# ---------------------------------------------------------------------------
# §6 V9 — 문서 0건 topic 파일: 자동 삭제
# ---------------------------------------------------------------------------


def test_verify_orphan_topic_file_removed(tmp_path: Path) -> None:
    client = _client(tmp_path)
    _setup(client, tmp_path)

    ghost_topic = tmp_path / "knowledge-wiki" / "topics" / "ghost-topic.md"
    ghost_topic.write_text("# 유령 주제\n", encoding="utf-8")

    report = _verify(client)
    check = _check(report, "orphan_topic")
    assert check["count"] == 1
    assert check["healed"] == 1
    assert not ghost_topic.exists()


# ---------------------------------------------------------------------------
# §6 V10 — DB↔카드 front matter 불일치(card_dirty): 자동 재patch
# ---------------------------------------------------------------------------


def test_verify_card_dirty_repatched_from_db(tmp_path: Path) -> None:
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _setup(client, tmp_path)

    doc = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET work_area_slug = ?, card_dirty = 1 WHERE id = ?",
        ("budget-x", doc["id"]),
    )

    report = _verify(client)
    check = _check(report, "fm_drift")
    assert check["count"] == 1
    assert check["healed"] == 1
    card_text = Path(str(doc["card_path"])).read_text(encoding="utf-8")
    assert "work_area: budget-x" in card_text, "DB 기준으로 카드가 재patch되어야 한다"
    after = services.db.fetch_one(
        "SELECT card_dirty FROM knowledge_wiki_docs WHERE id = ?", (doc["id"],)
    )
    assert after["card_dirty"] == 0


# ---------------------------------------------------------------------------
# §6 V11 — deep 전량 재해시: quick은 재해시 금지, deep만 silent change 검출
# ---------------------------------------------------------------------------


def test_verify_quick_skips_rehash_and_deep_detects_silent_change(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source = tmp_path / "source"
    source_id = _setup(client, tmp_path)
    assert source_id

    # 스캔 없이 원본 내용만 몰래 변경 — quick은 못 보고, deep 재해시만 잡는다.
    (source / "plan.md").write_text("# 사업계획\n\n몰래 바뀐 내용입니다.", encoding="utf-8")

    quick = _verify(client)
    assert quick["mode"] == "quick"
    assert _check(quick, "silent_change") is None, "quick 모드는 재해시를 수행하지 않는다(§8)"

    deep = _verify(client, deep=True)
    assert deep["mode"] == "deep"
    check = _check(deep, "silent_change")
    assert check["count"] == 1
    assert check["healed"] == 0, "silent change는 견적·안내만 하고 자동 재색인하지 않는다"
    assert "색인" in check["action_hint"]


# ---------------------------------------------------------------------------
# §6 불변식 5종 — missing/tag_locked/card_dirty/summary_stale/enrich_skip
# ---------------------------------------------------------------------------


def test_verify_invariants_detect_five_state_violations(tmp_path: Path) -> None:
    files = {f"doc-{index}.md": f"# 문서 {index}\n\n본문 {index}." for index in range(5)}
    client = _client(tmp_path)
    services = client.app.state.services
    source_id = _setup(client, tmp_path, files)

    docs = services.db.fetch_all(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ? ORDER BY relative_path ASC",
        (source_id,),
    )
    assert len(docs) == 5
    d1, d2, d3, d4, d5 = docs
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET status = 'missing', missing_since = NULL WHERE id = ?",
        (d1["id"],),
    )
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET tag_locked = 1, work_area_slug = '' WHERE id = ?",
        (d2["id"],),
    )
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET card_dirty = 1, status = 'missing', missing_since = ? "
        "WHERE id = ?",
        (now_iso(), d3["id"]),
    )
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET summary_stale = 1, enriched = 1 WHERE id = ?",
        (d4["id"],),
    )
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET enrich_skip = 1, enrich_fail_count = 1 WHERE id = ?",
        (d5["id"],),
    )

    report = _verify(client)
    for code in (
        "inv_missing",
        "inv_tag_locked",
        "inv_card_dirty",
        "inv_summary_stale",
        "inv_enrich_skip",
    ):
        check = _check(report, code)
        assert check is not None, f"{code} 불변식 검사가 있어야 한다"
        assert check["count"] == 1, f"{code} 위반 1건이 검출되어야 한다"
        assert check["healed"] == 0, "불변식 위반은 보고만 한다(자동 치유 아님)"


# ---------------------------------------------------------------------------
# §6 산출 — 리포트 1행 + JSONL + latest API + 한국어 실행기록(0건이어도)
# ---------------------------------------------------------------------------


def test_verify_report_persisted_latest_api_and_korean_log(tmp_path: Path) -> None:
    client = _client(tmp_path)
    services = client.app.state.services
    _setup(client, tmp_path)

    report = _verify(client)
    assert report["mode"] == "quick"
    assert report["total_count"] == 0, "깨끗한 상태에서는 불일치 0건이어야 한다"
    assert report["checks"], "0건이어도 검사 항목별 결과는 기록된다"

    # 실행기록 한국어 1건 — 0건이어도 기록(§6)
    logs = services.db.list_logs()
    entry = next(log for log in logs if log["action"] == "knowledge.wiki.verify")
    assert "불일치 0건" in entry["outputs"]["message"]

    # JSONL 상세
    log_file = Path(str(report["log_path"]))
    assert log_file.exists()
    lines = [json.loads(line) for line in log_file.read_text(encoding="utf-8").splitlines()]
    assert any(line.get("code") == "summary" for line in lines)

    # DB 리포트 1행 + latest API
    latest = client.get("/api/knowledge/verify/latest").json()["report"]
    assert latest["id"] == report["id"]
    assert latest["mode"] == "quick"
    assert isinstance(latest["checks"], list) and latest["checks"]

    deep_report = _verify(client, deep=True)
    latest_after = client.get("/api/knowledge/verify/latest").json()["report"]
    assert latest_after["id"] == deep_report["id"]
    assert latest_after["mode"] == "deep"

    rows = services.db.fetch_all("SELECT * FROM knowledge_verify_reports")
    assert len(rows) == 2, "실행당 리포트 1행이 저장되어야 한다"


def test_verify_blocked_while_ingestion_active(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source_id = _setup(client, tmp_path)

    queued = client.post(
        "/api/knowledge/ingest", json={"source_id": source_id, "run_now": False}
    )
    assert queued.status_code == 201
    blocked = client.post("/api/knowledge/verify", json={"deep": False})
    assert blocked.status_code == 409, "색인 진행 중에는 verify가 상호 배제되어야 한다"


# ---------------------------------------------------------------------------
# §5.9 드리프트 — 3판정 · 참고서고 오탐 없음 · 재확정 클리어
# ---------------------------------------------------------------------------


def _drift_files() -> dict[str, str]:
    return {
        "□주요□예산/예산집행지침.md": "# 예산집행지침\n\n예산 집행 지침입니다.",
        "□주요□성과평가/성과평가 결과보고.md": "# 성과평가 결과보고\n\n성과평가 결과입니다.",
    }


DRIFT_AREAS = [
    {"name": "예산", "folders": ["□주요□예산"], "keywords": ["예산"]},
    {"name": "성과평가", "folders": ["□주요□성과평가"], "keywords": ["성과평가"]},
]


def _taxonomy_drift(client, source_id: str):
    response = client.get("/api/knowledge/taxonomy", params={"source_id": source_id})
    assert response.status_code == 200
    return response.json()["items"][0]["drift"]


def test_drift_new_folder_detected_on_scan(tmp_path: Path) -> None:
    client = _client(tmp_path)
    services = client.app.state.services
    source = _make_source(tmp_path, _drift_files())
    source_id = _register(client, source)
    _scan(client, source_id)
    _confirm(client, source_id, DRIFT_AREAS)

    for index in range(5):
        path = source / "협력사업" / f"협력계획-{index}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# 협력계획 {index}\n\n협력 사업 {index}.", encoding="utf-8")
    for index in range(4):
        path = source / "소소폴더" / f"기타-{index}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# 기타 {index}\n\n기타 {index}.", encoding="utf-8")
    _scan(client, source_id)

    drift = _taxonomy_drift(client, source_id)
    assert drift is not None, "스캔 완료 시 드리프트가 감지되어야 한다"
    folders = [entry["folder"] for entry in drift["new_folders"]]
    assert "협력사업" in folders, "파일 5건 이상 신규 폴더는 드리프트다"
    assert "소소폴더" not in folders, "파일 5건 미만 신규 폴더는 드리프트가 아니다"
    assert drift["detected_at"]

    logs = services.db.list_logs()
    entry = next(
        log for log in logs if log["action"] == "knowledge.taxonomy.drift_detected"
    )
    assert "분류체계 재정비 제안" in entry["outputs"]["message"]


def test_drift_reference_shelf_folder_is_not_false_positive(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source = _make_source(tmp_path, _drift_files())
    source_id = _register(client, source)
    _scan(client, source_id)
    _confirm(client, source_id, DRIFT_AREAS)

    for index in range(6):
        path = source / "□참고□옛자료" / f"참고-{index}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# 참고 {index}\n\n참고자료 {index}.", encoding="utf-8")
    _scan(client, source_id)

    assert _taxonomy_drift(client, source_id) is None, "참고서고 폴더는 드리프트 판정에서 제외된다(§5.9)"


def test_drift_vanished_confirmed_folder(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source = _make_source(tmp_path, _drift_files())
    source_id = _register(client, source)
    _scan(client, source_id)
    _confirm(client, source_id, DRIFT_AREAS)

    (source / "□주요□예산" / "예산집행지침.md").unlink()
    _scan(client, source_id)

    drift = _taxonomy_drift(client, source_id)
    assert drift is not None
    assert "□주요□예산" in drift["vanished_folders"], "확정 폴더 0건화는 드리프트다"


def test_drift_low_inflow_ratio_triggered(tmp_path: Path) -> None:
    files = {
        f"□주요□예산/지침-{index}.md": f"# 지침 {index}\n\n예산 지침 {index}."
        for index in range(6)
    }
    client = _client(tmp_path)
    services = client.app.state.services
    source = _make_source(tmp_path, files)
    source_id = _register(client, source)
    _scan(client, source_id)
    _ingest(client, source_id)
    _confirm(client, source_id, [{"name": "예산", "folders": ["□주요□예산"], "keywords": ["예산"]}])

    # 확정 이후 색인된 문서 5건이 low로 유입된 상황을 주입한다(30% 이상).
    rows = services.db.fetch_all(
        "SELECT id FROM knowledge_wiki_docs WHERE source_id = ? ORDER BY relative_path ASC",
        (source_id,),
    )
    for row in rows[:5]:
        services.db.execute(
            "UPDATE knowledge_wiki_docs SET tag_confidence = 'low', created_at = ? WHERE id = ?",
            (now_iso(), row["id"]),
        )

    drift = services.taxonomy.detect_drift(source_id)
    assert drift is not None
    assert drift["low_ratio"]["triggered"] is True
    assert drift["low_ratio"]["ratio"] >= 0.3
    assert _taxonomy_drift(client, source_id) is not None


def test_drift_cleared_on_reconfirm(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source = _make_source(tmp_path, _drift_files())
    source_id = _register(client, source)
    _scan(client, source_id)
    _confirm(client, source_id, DRIFT_AREAS)

    for index in range(5):
        path = source / "협력사업" / f"협력계획-{index}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# 협력계획 {index}\n\n협력 사업 {index}.", encoding="utf-8")
    _scan(client, source_id)
    assert _taxonomy_drift(client, source_id) is not None

    # 재확정(신규 폴더 편입) = 드리프트 해소 → drift_json 클리어(§5.9)
    _confirm(
        client,
        source_id,
        [*DRIFT_AREAS, {"name": "협력사업", "folders": ["협력사업"], "keywords": ["협력"]}],
    )
    assert _taxonomy_drift(client, source_id) is None

    # 재확정 이후 스캔에서도 다시 뜨지 않아야 한다(원인 해소).
    _scan(client, source_id)
    assert _taxonomy_drift(client, source_id) is None
