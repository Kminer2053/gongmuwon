"""W7 P2a — 증분 태깅·tag_locked·패밀리 국소 재평가 계약 테스트.

설계 원천: docs/design/2026-07-05-incremental-knowledge-sync-design.md §5.1~5.3 + §8
- 색인 내 자동 태깅: 신규 파일 high 자동 적용 / low 큐 upsert / 참고서고 제외
- tag_locked: resolve가 잠금, 재apply·재색인·rebind에서 보존(family 재평가는 참여)
- 패밀리 국소 재평가: 새 버전 색인만으로 대표 교체, 대표 삭제 시 승격, 1건 그룹 해제
- apply 취소 시 구 pending 큐 잔존(run_id), enrich 실행당 상한·이월
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _age(path: Path, seconds: float = 7200.0) -> None:
    """mtime을 과거로 밀어 '방금 쓴 파일' UNSTABLE 보류를 우회한다."""
    past = time.time() - seconds
    os.utime(path, (past, past))


def _write_aged(path: Path, body: str, *, age_seconds: float = 7200.0) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    _age(path, age_seconds)
    return path


def _make_source(tmp_path: Path) -> Path:
    source = tmp_path / "workfolder"
    _write_aged(source / "□주요□예산" / "예산집행지침.md", "# 예산집행지침\n\n예산 집행 지침입니다.")
    _write_aged(
        source / "□주요□성과평가" / "성과평가 결과보고(1017).md",
        "# 성과평가 결과보고 10월\n\n10월 성과평가 결과입니다.",
        age_seconds=86400 * 60,
    )
    _write_aged(
        source / "□주요□성과평가" / "성과평가 결과보고(1118).md",
        "# 성과평가 결과보고 11월\n\n11월 성과평가 결과입니다.",
        age_seconds=86400 * 30,
    )
    _write_aged(source / "메모.md", "# 메모\n\n자유 메모입니다.")
    return source


def _register(client, source: Path, label: str = "업무폴더") -> str:
    created = client.post("/api/knowledge/sources", json={"label": label, "root_path": str(source)})
    assert created.status_code == 201
    return created.json()["id"]


def _scan(client, source_id: str) -> dict:
    response = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert response.status_code == 200
    return response.json()


def _ingest(client, source_id: str) -> dict:
    response = client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True})
    assert response.status_code == 201
    return response.json()["job"]


def _confirm(client, source_id: str, *, areas: list[dict] | None = None) -> dict:
    response = client.post(
        "/api/knowledge/taxonomy",
        json={
            "source_id": source_id,
            "work_areas": areas
            or [
                {"name": "예산", "folders": ["□주요□예산"], "keywords": ["예산"]},
                {"name": "성과평가", "folders": ["□주요□성과평가"], "keywords": ["성과평가"]},
            ],
            "doc_roles_enabled": [],
            "family_policy": "latest_representative",
        },
    )
    assert response.status_code == 201
    return response.json()


def _apply(client, source_id: str) -> dict:
    response = client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})
    assert response.status_code == 201
    work_job = response.json()["work_job"]
    assert work_job["status"] == "succeeded"
    return work_job["result"]


def _setup(client, tmp_path: Path) -> str:
    source = _make_source(tmp_path)
    source_id = _register(client, source)
    _scan(client, source_id)
    _ingest(client, source_id)
    _confirm(client, source_id)
    _apply(client, source_id)
    return source_id


def _docs_by_rel(db, source_id: str) -> dict[str, dict]:
    return {
        row["relative_path"]: row
        for row in db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
        )
    }


# ---------------------------------------------------------------------------
# §5.1 색인 내 자동 태깅 — 신규 파일 high 자동 / low 큐 / 참고서고 제외
# ---------------------------------------------------------------------------


def test_new_file_in_confirmed_folder_is_auto_tagged_at_ingest(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source_id = _setup(client, tmp_path)
    source = tmp_path / "workfolder"

    _write_aged(source / "□주요□예산" / "신규예산지침.md", "# 신규예산지침\n\n새 예산 집행 기준입니다.")
    _scan(client, source_id)
    _ingest(client, source_id)

    db = client.app.state.services.db
    doc = _docs_by_rel(db, source_id)["□주요□예산/신규예산지침.md"]
    assert doc["work_area_slug"] == "예산"
    assert doc["doc_role"] == "regulation"
    assert doc["tag_confidence"] == "high"

    card_text = Path(doc["card_path"]).read_text(encoding="utf-8")
    assert "work_area: 예산" in card_text
    assert "doc_role: regulation" in card_text
    assert "tag_confidence: high" in card_text

    # high 태깅 문서는 분류 대기 큐에 적재되지 않는다.
    queue = client.get("/api/knowledge/taxonomy/queue").json()["items"]
    assert all(item["wiki_doc_id"] != doc["id"] for item in queue)

    # dirty 허브 축소 재작성: 색인만으로 예산 허브에 신규 문서가 등재된다.
    hub_text = (tmp_path / "knowledge-wiki" / "work-areas" / "예산.md").read_text(encoding="utf-8")
    assert "신규예산지침" in hub_text


def test_new_low_signal_file_enqueued_and_reference_shelf_excluded(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source_id = _setup(client, tmp_path)
    source = tmp_path / "workfolder"

    _write_aged(source / "무제노트.md", "# 무제노트\n\n어디에도 해당하지 않는 내용.")
    _write_aged(source / "■참고■자료실" / "외부수집자료.md", "# 외부수집자료\n\n외부에서 수집한 자료.")
    _scan(client, source_id)
    _ingest(client, source_id)

    db = client.app.state.services.db
    docs = _docs_by_rel(db, source_id)
    low_doc = docs["무제노트.md"]
    assert low_doc["tag_confidence"] == "low"
    queue = client.get("/api/knowledge/taxonomy/queue").json()["items"]
    low_items = [item for item in queue if item["wiki_doc_id"] == low_doc["id"]]
    assert len(low_items) == 1, "low 판정 신규 문서는 큐에 1건 upsert되어야 한다"
    assert low_items[0]["status"] == "pending"
    assert set(low_items[0]["candidates"]) == {"work_areas", "doc_roles"}

    # 참고서고(■참고■) 폴더 문서는 태깅·큐 대상에서 제외된다 (§5.1).
    shelf_doc = docs["■참고■자료실/외부수집자료.md"]
    assert shelf_doc["tag_confidence"] == ""
    assert shelf_doc["work_area_slug"] == ""
    assert all(item["wiki_doc_id"] != shelf_doc["id"] for item in queue)

    # 같은 문서를 다시 색인해도(내용 변경) 큐가 중복 적재되지 않는다 — upsert.
    _write_aged(source / "무제노트.md", "# 무제노트\n\n내용이 조금 바뀌었지만 여전히 무신호.")
    _scan(client, source_id)
    _ingest(client, source_id)
    queue_after = client.get("/api/knowledge/taxonomy/queue").json()["items"]
    assert len([item for item in queue_after if item["wiki_doc_id"] == low_doc["id"]]) == 1


# ---------------------------------------------------------------------------
# §5.2 tag_locked — resolve 잠금 + 재apply·재색인·rebind 보존 + slug 검증
# ---------------------------------------------------------------------------


def test_resolve_locks_doc_and_validates_slug(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source_id = _setup(client, tmp_path)

    queue = client.get("/api/knowledge/taxonomy/queue").json()["items"]
    memo_item = next(item for item in queue if item["title"] == "메모")

    # 확정 taxonomy에 없는 유령 slug → 400 (§5.2)
    invalid = client.post(
        f"/api/knowledge/taxonomy/queue/{memo_item['id']}/resolve",
        json={"work_area_slug": "유령업무", "doc_role": "reference"},
    )
    assert invalid.status_code == 400

    resolved = client.post(
        f"/api/knowledge/taxonomy/queue/{memo_item['id']}/resolve",
        json={"work_area_slug": "예산", "doc_role": "reference"},
    )
    assert resolved.status_code == 200

    db = client.app.state.services.db
    doc = db.fetch_one("SELECT * FROM knowledge_wiki_docs WHERE id = ?", (memo_item["wiki_doc_id"],))
    assert doc["tag_locked"] == 1
    assert doc["work_area_slug"] == "예산"


def test_locked_doc_survives_reapply_reingest_and_rebind(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source_id = _setup(client, tmp_path)
    source = tmp_path / "workfolder"
    db = client.app.state.services.db

    memo_item = next(
        item
        for item in client.get("/api/knowledge/taxonomy/queue").json()["items"]
        if item["title"] == "메모"
    )
    assert (
        client.post(
            f"/api/knowledge/taxonomy/queue/{memo_item['id']}/resolve",
            json={"work_area_slug": "예산", "doc_role": "reference"},
        ).status_code
        == 200
    )
    doc_id = memo_item["wiki_doc_id"]

    # 1) 재apply: locked 문서는 재판정·큐 재적재에서 제외된다.
    report = _apply(client, source_id)
    assert report["locked_count"] == 1
    doc = db.fetch_one("SELECT * FROM knowledge_wiki_docs WHERE id = ?", (doc_id,))
    assert doc["tag_locked"] == 1
    assert doc["work_area_slug"] == "예산"
    assert doc["doc_role"] == "reference"
    assert doc["tag_confidence"] == "high"
    pending = client.get("/api/knowledge/taxonomy/queue").json()["items"]
    assert all(item["wiki_doc_id"] != doc_id for item in pending)

    # 2) 재색인(내용 변경): locked 문서는 태깅 재판정 제외 — 보존 patch만.
    _write_aged(source / "메모.md", "# 회의 메모\n\n회의 내용이 대폭 수정되었습니다.")
    _scan(client, source_id)
    _ingest(client, source_id)
    doc = db.fetch_one("SELECT * FROM knowledge_wiki_docs WHERE id = ?", (doc_id,))
    assert doc["tag_locked"] == 1
    assert doc["work_area_slug"] == "예산"
    assert doc["doc_role"] == "reference"
    card_text = Path(doc["card_path"]).read_text(encoding="utf-8")
    assert "work_area: 예산" in card_text
    assert "doc_role: reference" in card_text

    # 3) rebind(부모 폴더 변경): 태그 보존 + 실행기록에 "분류 재확인 권장" 표기.
    (source / "메모.md").rename(source / "□주요□성과평가" / "메모.md")
    payload = _scan(client, source_id)
    assert payload["moved_count"] == 1
    doc = db.fetch_one("SELECT * FROM knowledge_wiki_docs WHERE id = ?", (doc_id,))
    assert doc["relative_path"] == "□주요□성과평가/메모.md"
    assert doc["tag_locked"] == 1
    assert doc["work_area_slug"] == "예산", "locked 태그는 이동 재판정에서 보존되어야 한다"
    logs = db.list_logs(limit=200)
    kept = next(
        log for log in logs if log["action"] == "knowledge.taxonomy.rebind.locked_kept"
    )
    assert "분류 재확인 권장" in kept["outputs"]["message"]


def test_reconfirm_releases_locked_doc_with_ghost_slug(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source_id = _setup(client, tmp_path)
    db = client.app.state.services.db

    memo_item = next(
        item
        for item in client.get("/api/knowledge/taxonomy/queue").json()["items"]
        if item["title"] == "메모"
    )
    client.post(
        f"/api/knowledge/taxonomy/queue/{memo_item['id']}/resolve",
        json={"work_area_slug": "예산", "doc_role": "reference"},
    )

    # 재확정에서 '예산' 업무가 사라지면 locked slug가 무효가 된다 → lock 해제 + 큐 적재.
    reconfirmed = _confirm(
        client,
        source_id,
        areas=[{"name": "성과평가", "folders": ["□주요□성과평가"], "keywords": ["성과평가"]}],
    )
    assert reconfirmed["released_locked_count"] == 1

    doc = db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (memo_item["wiki_doc_id"],)
    )
    assert doc["tag_locked"] == 0
    assert doc["work_area_slug"] == ""
    assert doc["tag_confidence"] == "low"
    queue = client.get("/api/knowledge/taxonomy/queue").json()["items"]
    requeued = [item for item in queue if item["wiki_doc_id"] == memo_item["wiki_doc_id"]]
    assert len(requeued) == 1
    assert requeued[0]["reason"] == "locked_slug_invalidated"


# ---------------------------------------------------------------------------
# §5.3 패밀리 국소 재평가 — 대표 교체·승격·1건 그룹 해제
# ---------------------------------------------------------------------------


def test_new_version_ingest_swaps_family_representative(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source_id = _setup(client, tmp_path)
    source = tmp_path / "workfolder"
    db = client.app.state.services.db

    docs = _docs_by_rel(db, source_id)
    old_latest = docs["□주요□성과평가/성과평가 결과보고(1118).md"]
    assert old_latest["family_role"] == "latest"

    _write_aged(
        source / "□주요□성과평가" / "성과평가 결과보고 (최종).md",
        "# 성과평가 최종보고\n\n최종 확정된 성과평가 결과입니다.",
        age_seconds=3600,
    )
    _scan(client, source_id)
    _ingest(client, source_id)  # apply 재실행 없이 색인만

    docs = _docs_by_rel(db, source_id)
    new_doc = docs["□주요□성과평가/성과평가 결과보고 (최종).md"]
    demoted = docs["□주요□성과평가/성과평가 결과보고(1118).md"]
    assert new_doc["family_role"] == "official", "(최종) 신규 버전이 색인만으로 대표가 되어야 한다"
    assert new_doc["family_id"] == demoted["family_id"]
    assert demoted["family_role"] == "previous", "구 대표는 색인만으로 강등되어야 한다"

    # 강등이 카드 front matter에도 patch된다.
    demoted_card = Path(demoted["card_path"]).read_text(encoding="utf-8")
    assert "family_role: previous" in demoted_card
    new_card = Path(new_doc["card_path"]).read_text(encoding="utf-8")
    assert "family_role: official" in new_card

    # 실행기록 1줄: 문서 패밀리 대표 교체
    logs = db.list_logs(limit=200)
    swap = next(
        log for log in logs if log["action"] == "knowledge.family.representative_changed"
    )
    assert "문서 패밀리 대표 교체" in swap["outputs"]["message"]

    # dirty 허브 재작성: 성과평가 허브에 새 대표([공식본])가 노출되고 구 대표는 접힌다.
    hub_text = (tmp_path / "knowledge-wiki" / "work-areas" / "성과평가.md").read_text(
        encoding="utf-8"
    )
    assert "성과평가 최종보고" in hub_text
    assert "[공식본]" in hub_text
    assert "성과평가 결과보고 11월" not in hub_text


def test_index_folds_version_family_into_representative(tmp_path: Path) -> None:
    """⑨ 인덱스 '## 문서'가 판본 계열을 대표 1건 + '버전 이력' 링크로 접는다.

    (1017)/(1118) 두 판본은 apply 시 한 가족이 되어, 최신본만 대표로 노출되고
    이전 판은 평면 항목이 아니라 대표 아래 '버전 이력' 링크로 접혀야 한다.
    """
    client = _client(tmp_path)
    source_id = _setup(client, tmp_path)
    services = client.app.state.services

    docs = _docs_by_rel(services.db, source_id)
    representative = docs["□주요□성과평가/성과평가 결과보고(1118).md"]
    previous = docs["□주요□성과평가/성과평가 결과보고(1017).md"]
    assert representative["family_role"] == "latest", "최신 판본이 대표여야 한다"
    assert previous["family_role"] == "previous"
    assert representative["family_id"] == previous["family_id"]

    services.wiki.rebuild_index()
    index_text = (tmp_path / "knowledge-wiki" / "index.md").read_text(encoding="utf-8")

    # 대표는 요약이 붙은 평면 문서 항목으로 노출된다.
    assert f"- [{representative['title']}](docs/{representative['slug']}.md)" in index_text
    # 이전 판은 대표 아래 '버전 이력' 링크로 접힌다(클릭 가능, 죽은 텍스트 아님).
    assert (
        f"  - 버전 이력 1건: [{previous['title']}](docs/{previous['slug']}.md)"
        in index_text
    )
    # 이전 판이 대표와 동급의 평면 문서 항목(제목 — 요약)으로 다시 등장하지 않는다.
    assert f"- [{previous['title']}](docs/{previous['slug']}.md) —" not in index_text


def test_representative_deletion_promotes_sibling_then_singleton_unfamilies(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path)
    source_id = _setup(client, tmp_path)
    source = tmp_path / "workfolder"
    db = client.app.state.services.db

    # 3인 가족 구성: (최종) 대표 + (1118) + (1017)
    final_path = _write_aged(
        source / "□주요□성과평가" / "성과평가 결과보고 (최종).md",
        "# 성과평가 최종보고\n\n최종 확정본입니다.",
        age_seconds=3600,
    )
    _scan(client, source_id)
    _ingest(client, source_id)
    docs = _docs_by_rel(db, source_id)
    assert docs["□주요□성과평가/성과평가 결과보고 (최종).md"]["family_role"] == "official"

    # 대표 삭제 → 색인만으로 생존 형제(1118)가 승격된다 (§5.3 삭제 트리거).
    final_path.unlink()
    _scan(client, source_id)
    _ingest(client, source_id)
    docs = _docs_by_rel(db, source_id)
    # §5.5 소프트 삭제: 행은 missing으로 보존되고 가족 멤버에서는 제외된다.
    assert docs["□주요□성과평가/성과평가 결과보고 (최종).md"]["status"] == "missing"
    promoted = docs["□주요□성과평가/성과평가 결과보고(1118).md"]
    assert promoted["family_role"] == "latest", "대표 삭제 시 생존 형제가 승격되어야 한다"
    assert docs["□주요□성과평가/성과평가 결과보고(1017).md"]["family_role"] == "previous"
    promoted_card = Path(promoted["card_path"]).read_text(encoding="utf-8")
    assert "family_role: latest" in promoted_card

    # 형제가 1건이 되면 family가 해제된다 (§5.3 그룹 1건화).
    (source / "□주요□성과평가" / "성과평가 결과보고(1118).md").unlink()
    _scan(client, source_id)
    _ingest(client, source_id)
    docs = _docs_by_rel(db, source_id)
    survivor = docs["□주요□성과평가/성과평가 결과보고(1017).md"]
    assert survivor["family_id"] == ""
    assert survivor["family_role"] == ""
    survivor_card = Path(survivor["card_path"]).read_text(encoding="utf-8")
    assert "family_id: \n" in survivor_card or "family_id:\n" in survivor_card


# ---------------------------------------------------------------------------
# §5.2 apply 취소 부분 상태 봉합 — run_id 기반 구 큐 잔존
# ---------------------------------------------------------------------------


def test_apply_cancel_keeps_previous_pending_queue(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source_id = _setup(client, tmp_path)
    services = client.app.state.services

    before = services.taxonomy.list_queue(source_id=source_id)
    assert before, "선행 apply의 pending 큐가 있어야 한다"
    before_ids = {item["id"] for item in before}

    # 즉시 취소되는 apply — 구 pending이 전삭제로 휘발되면 안 된다 (§5.2 run_id).
    services.taxonomy.apply_taxonomy(source_id, should_cancel=lambda: True)

    after = services.taxonomy.list_queue(source_id=source_id)
    after_ids = {item["id"] for item in after}
    assert before_ids <= after_ids, "apply 취소 시 이전 run의 pending 큐가 잔존해야 한다"


# ---------------------------------------------------------------------------
# §5.4 enrich 실행당 상한(기본 20)·이월·summary_stale 우선
# ---------------------------------------------------------------------------


def test_enrich_limit_carries_over_and_prioritizes_stale(tmp_path: Path) -> None:
    source = tmp_path / "docs"
    for index in range(3):
        _write_aged(source / f"문서-{index}.md", f"# 문서 {index}\n\n본문 {index}입니다.")
    client = _client(tmp_path)
    source_id = _register(client, source, label="보강자료")
    _scan(client, source_id)
    _ingest(client, source_id)
    services = client.app.state.services
    wiki = services.wiki

    def fake_llm(messages):
        return json.dumps(
            {"summary": "요약 문장입니다. 둘째 문장. 셋째 문장.", "topics": ["예산"]},
            ensure_ascii=False,
        )

    first = wiki.enrich(llm=fake_llm, limit=2)
    assert first["status"] == "completed"
    assert first["enriched_count"] == 2
    assert first["limit"] == 2
    assert first["remaining_count"] == 1, "상한 초과분은 다음 실행으로 이월되어야 한다"

    second = wiki.enrich(llm=fake_llm)
    assert second["limit"] == 20, "기본 상한은 사용자 승인값 20건이다"
    assert second["enriched_count"] == 1
    assert second["remaining_count"] == 0

    # summary_stale=1 문서가 신규(enriched=0)보다 먼저 처리된다.
    docs = services.db.fetch_all(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ? ORDER BY relative_path",
        (source_id,),
    )
    stale_doc, fresh_doc = docs[0], docs[1]
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET enriched = 0, summary_stale = 1 WHERE id = ?",
        (stale_doc["id"],),
    )
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET enriched = 0, summary_stale = 0 WHERE id = ?",
        (fresh_doc["id"],),
    )

    third = wiki.enrich(llm=fake_llm, limit=1)
    assert third["enriched_count"] == 1
    refreshed_stale = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (stale_doc["id"],)
    )
    refreshed_fresh = services.db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (fresh_doc["id"],)
    )
    assert refreshed_stale["enriched"] == 1 and refreshed_stale["summary_stale"] == 0
    assert refreshed_fresh["enriched"] == 0, "summary_stale 문서가 우선 처리되어야 한다"
