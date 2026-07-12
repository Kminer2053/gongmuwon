"""주제 어휘집 팩 계약 테스트 — 병합(§3)·매칭/선택(§4)·임포트 API(§5)·후보 큐(§6).

규격: docs/design/2026-07-12-topic-vocab-pack-spec.md
LLM은 전부 스텁 — 실LLM 검증은 별도 수동 절차로 수행한다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from gongmu_sidecar.app import create_app
from gongmu_sidecar.db import Database
from gongmu_sidecar.topic_vocab import (
    TopicVocabManager,
    VocabValidationError,
    validate_pack,
)
from gongmu_sidecar.workspace import ensure_workspace


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


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


def _manager(tmp_path: Path) -> TopicVocabManager:
    paths = ensure_workspace(tmp_path)
    return TopicVocabManager(paths, Database(paths))


def _write_institution_pack(manager: TopicVocabManager, topics: list[dict]) -> None:
    manager.vocab_dir.mkdir(parents=True, exist_ok=True)
    manager.institution_pack_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "pack": {"name": "테스트 기관팩", "version": "1.0.0", "scope": "institution"},
                "topics": topics,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    manager.invalidate()


def _insert_user_topic(manager: TopicVocabManager, **overrides) -> None:
    payload = {
        "id": "user-abc",
        "name": "",
        "synonyms_json": "[]",
        "broader": None,
        "scope_note": "",
        "work_area_hint": "",
        "enabled": 1,
        "source_candidate_id": None,
        "created_at": "2026-07-12T00:00:00+00:00",
        "updated_at": "2026-07-12T00:00:00+00:00",
    }
    payload.update(overrides)
    manager.db.insert("vocab_user_topics", payload)
    manager.invalidate()


# ---------------------------------------------------------------------------
# §3 층 병합 규칙
# ---------------------------------------------------------------------------


def test_merge_layers_override_and_synonym_union(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    # L2가 L1의 budget-formulation을 오버라이드(name/scope_note) + synonyms 합집합.
    _write_institution_pack(
        manager,
        [
            {
                "id": "budget-formulation",
                "name": "예산편성(기관)",
                "synonyms": ["예산총괄"],
                "scope_note": "기관 지침",
            }
        ],
    )
    merged = {entry["id"]: entry for entry in manager.merged_topics()}
    entry = merged["budget-formulation"]
    assert entry["name"] == "예산편성(기관)", "상위 층(L2)이 name을 오버라이드해야 한다"
    assert entry["scope_note"] == "기관 지침"
    assert "예산총괄" in entry["synonyms"], "L2 synonym이 합집합에 포함되어야 한다"
    assert "예산요구" in entry["synonyms"], "L1 synonym도 합집합에 유지되어야 한다"
    assert entry["layer"] == "institution"


def test_merge_user_layer_wins_over_institution(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    _write_institution_pack(
        manager, [{"id": "budget-formulation", "name": "예산편성(기관)"}]
    )
    _insert_user_topic(
        manager, id="budget-formulation", name="예산편성(사용자)", synonyms_json='["예산워킹그룹"]'
    )
    merged = {entry["id"]: entry for entry in manager.merged_topics()}
    entry = merged["budget-formulation"]
    assert entry["name"] == "예산편성(사용자)", "L3 > L2 우선순위"
    assert "예산워킹그룹" in entry["synonyms"]
    assert entry["layer"] == "user"


def test_merge_enabled_false_excludes_topic_from_lower_layers(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    _insert_user_topic(manager, id="budget-formulation", name="", enabled=0)
    merged_ids = {entry["id"] for entry in manager.merged_topics()}
    assert "budget-formulation" not in merged_ids, "enabled:false는 하위 층 정의까지 제외한다"
    assert not manager.contains("예산편성")
    # 결정적 매칭에서도 사라져야 한다.
    matches = manager.match_document(title="예산편성 지침", file_name="a.md", body="")
    assert all(entry["id"] != "budget-formulation" for entry in matches)
    # 목록(include_disabled)에는 enabled=false로 노출된다.
    listing = {entry["id"]: entry for entry in manager.merged_topics(include_disabled=True)}
    assert listing["budget-formulation"]["enabled"] is False


def test_merge_synonym_only_user_row_keeps_lower_name(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    # 병합 승인으로 생기는 synonym-only 행(name='')은 하위 층 name을 유지한다.
    _insert_user_topic(manager, id="recruitment", name="", synonyms_json='["수시채용"]')
    merged = {entry["id"]: entry for entry in manager.merged_topics()}
    assert merged["recruitment"]["name"] == "채용"
    assert "수시채용" in merged["recruitment"]["synonyms"]


# ---------------------------------------------------------------------------
# §5 팩 검증기 — 오류 전체 목록, 부분 임포트 금지
# ---------------------------------------------------------------------------


def test_validate_pack_collects_all_errors_at_once(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    existing = manager.merged_topics()
    content = {
        "schema_version": 99,
        "pack": {"name": "불량팩"},
        "topics": [
            {"id": "Bad_ID!", "name": "형식오류"},
            {"id": "dup", "name": "중복1"},
            {"id": "dup", "name": "중복2"},
            {"id": "no-name", "synonyms": ["이름없음"]},
            {"id": "too-many", "name": "동의어과다", "synonyms": [f"동의어{i}" for i in range(21)]},
            {"id": "collide-internal", "name": "중복1"},  # 팩 내 키 충돌 (dup의 name과)
            {"id": "collide-common", "name": "예산편성"},  # L1과 키 충돌 (§3-3)
        ],
    }
    errors, _warnings = validate_pack(content, existing_topics=existing)
    text = "\n".join(errors)
    assert "schema_version" in text
    assert "Bad_ID!" in text, "id 형식 오류"
    assert "중복됩니다" in text, "팩 내 id 유일성"
    assert "name이 없습니다" in text
    assert "최대 20" in text, "synonyms 상한"
    assert "팩 내 다른 주제" in text, "팩 내부 정규화 키 충돌"
    assert "기존 어휘집 주제" in text, "기존 층과의 정규화 키 충돌"
    assert len(errors) >= 6, "오류는 중단 없이 전체 목록으로 반환되어야 한다"


def test_validate_pack_allows_same_id_override_and_topic_count_cap(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    existing = manager.merged_topics()
    override = {
        "schema_version": 1,
        "pack": {"name": "오버라이드팩"},
        "topics": [{"id": "budget-formulation", "name": "예산편성", "synonyms": ["예산총괄"]}],
    }
    errors, _ = validate_pack(override, existing_topics=existing)
    assert errors == [], "동일 id는 오버라이드 관계 — 키 공유가 허용된다"

    oversized = {
        "schema_version": 1,
        "pack": {"name": "과다팩"},
        "topics": [{"id": f"t-{i:04d}", "name": f"주제{i:04d}"} for i in range(1001)],
    }
    errors, _ = validate_pack(oversized)
    assert any("상한" in error for error in errors)


# ---------------------------------------------------------------------------
# §4-1 결정적 매칭 — 제목/파일명×2 가중, 본문 1,500자, 상위 3
# ---------------------------------------------------------------------------


def test_match_document_weights_title_and_filename_double(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    matches = manager.match_document(
        title="안전점검 실시 계획",
        file_name="계획서.hwp",
        body="예산편성 협의 내용이 본문에 있습니다.",
    )
    names = [entry["name"] for entry in matches]
    assert names[0] == "안전점검", "제목 히트(×2)가 본문 히트(×1)보다 앞서야 한다"
    assert "예산편성" in names
    safety = next(entry for entry in matches if entry["name"] == "안전점검")
    budget = next(entry for entry in matches if entry["name"] == "예산편성")
    assert safety["score"] > budget["score"]


def test_match_document_caps_at_top_three_and_1500_chars(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    body = "예산편성 채용계획 안전점검 회의결과 감사계획 " + ("무" * 1500) + " 개인정보보호"
    matches = manager.match_document(title="", file_name="자료.md", body=body)
    assert len(matches) == 3, "스코어순 상위 3개만 채택한다"
    beyond = manager.match_document(title="", file_name="a.md", body=("무" * 1500) + "예산편성")
    assert beyond == [], "본문 상위 1,500자 밖의 히트는 무시된다"


def test_synonym_hits_map_to_canonical_name(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    matches = manager.match_document(
        title="KOSHA-MS 인증 추진", file_name="추진안.md", body="ISO 45001 심사 대비"
    )
    assert matches and matches[0]["name"] == "안전보건경영시스템", "동의어 히트는 정식명으로 환원된다"


# ---------------------------------------------------------------------------
# §4-2·3 LLM 선택 — 후보 목록·창작 금지·NEW 후보 큐 (스텁)
# ---------------------------------------------------------------------------


def test_resolve_selection_splits_names_and_new_proposals(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    selected, proposals = manager.resolve_selection(
        ["예산 편성", "NEW: 우주 감자 재배", "창작된주제명", "채용계획"]
    )
    assert selected == ["예산편성", "채용"], "어휘집 키 매칭분은 정식명으로 — 동의어도 환원된다"
    assert "우주 감자 재배" in proposals
    assert "창작된주제명" in proposals, "창작 금지 위반(목록 밖 이름)은 저장하지 않고 제안으로 돌린다"


def test_resolve_selection_strips_candidate_line_echo(tmp_path: Path) -> None:
    # 2026-07-12 실측: 실LLM(gemma)이 후보 줄을 scope_note까지 통째로 복사한다.
    manager = _manager(tmp_path)
    selected, proposals = manager.resolve_selection(
        [
            "- 예산편성 — 차년도 예산 요구·편성·심의 단계 문서",
            "회의운영 — 회의 개최·안건·결과. 발표자료 포함",
            "NEW: 로컬동행 — 지역 상생 협력 사업",
        ]
    )
    assert selected == ["예산편성", "회의운영"], "scope_note 복사 출력도 정식명으로 환원되어야 한다"
    assert proposals == ["로컬동행"]


def test_enrich_deterministic_two_plus_skips_llm_selection(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "안전점검결과.md").write_text(
        "# 안전점검 결과보고\n\n시설물 점검 결과와 조치 사항입니다.", encoding="utf-8"
    )
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    services = client.app.state.services

    captured: list[str] = []

    def llm(messages):
        system_text = str(messages[0]["text"])
        if "백과사전" in system_text:
            return None
        captured.append(system_text)
        # 결정적 확정 문서 — LLM이 topics를 내보내도 무시되어야 한다.
        return json.dumps(
            {"summary": "요약. 요약. 요약.", "topics": ["창작주제"]}, ensure_ascii=False
        )

    result = services.wiki.enrich(llm=llm)

    assert result["enriched_count"] == 1
    assert "[주제 후보]" not in captured[0], "결정적 매칭 2개 이상이면 LLM 선택을 걸지 않는다"
    doc = services.db.fetch_one("SELECT topics_json FROM knowledge_wiki_docs")
    topics = json.loads(doc["topics_json"])
    assert "안전점검" in topics
    assert "창작주제" not in topics, "topics_json에는 어휘집 정식명만 저장된다 (§4-4)"


def test_enrich_new_proposal_goes_to_candidate_queue_not_topics(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "특이문서.md").write_text(
        "# 우주 감자 재배 일지\n\n감자 텃밭 관찰 기록입니다.", encoding="utf-8"
    )
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    services = client.app.state.services

    def llm(messages):
        if "백과사전" in str(messages[0]["text"]):
            return None
        return json.dumps(
            {"summary": "요약. 요약. 요약.", "topics": ["NEW: 우주 감자 재배", "회의운영"]},
            ensure_ascii=False,
        )

    result = services.wiki.enrich(llm=llm)

    assert result["vocab_candidates_pending"] == 1
    doc = services.db.fetch_one("SELECT * FROM knowledge_wiki_docs")
    assert json.loads(doc["topics_json"]) == ["회의운영"], "선택분만 저장, NEW는 즉시 반영 금지 (§4-3)"
    candidates = client.get("/api/knowledge/vocab/candidates", params={"status": "pending"}).json()["items"]
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["name"] == "우주 감자 재배"
    assert candidate["hit_count"] == 1
    assert candidate["sample_docs"][0]["doc_id"] == doc["id"]


def test_enrich_migrates_legacy_free_topics_to_candidate_queue(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "메모.md").write_text("# 메모\n\n일반 메모입니다.", encoding="utf-8")
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    services = client.app.state.services
    # 구버전이 만든 자유 주제(어휘집 미포함)를 재보강 대상으로 되돌린다.
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET topics_json = ?, enriched = 0, summary_stale = 1",
        (json.dumps(["레거시자유주제"], ensure_ascii=False),),
    )

    def llm(messages):
        if "백과사전" in str(messages[0]["text"]):
            return None
        return json.dumps({"summary": "요약. 요약. 요약.", "topics": []}, ensure_ascii=False)

    services.wiki.enrich(llm=llm)

    candidates = services.vocab.list_candidates(status="pending")
    assert any(item["name"] == "레거시자유주제" for item in candidates), (
        "기존 자유 주제 중 어휘집 미포함분은 재보강 시 후보 큐로 (§6·§7)"
    )


# ---------------------------------------------------------------------------
# §5 임포트 API 계약
# ---------------------------------------------------------------------------


def test_vocab_overview_and_pack_import_roundtrip(tmp_path: Path) -> None:
    client = _client(tmp_path)
    before = client.get("/api/knowledge/vocab").json()
    assert before["layers"]["common"] == 65
    assert before["layers"]["institution"] is None
    assert before["layers"]["user"] == 0
    sample = before["topics"][0]
    assert {"id", "name", "layer", "synonyms_count", "enabled"} <= set(sample)

    pack = {
        "schema_version": 1,
        "pack": {"name": "코레일유통 AI혁신처 어휘집", "version": "1.0.0", "scope": "institution"},
        "topics": [
            {"id": "local-donghaeng", "name": "로컬동행", "synonyms": ["로컬 동행 사업"]},
            {"id": "station-store", "name": "역사 매장 운영", "synonyms": ["스토리웨이"]},
        ],
    }
    imported = client.post("/api/knowledge/vocab/pack", json={"content": pack})
    assert imported.status_code == 200
    payload = imported.json()
    assert payload["ok"] is True
    assert payload["imported"] == {"name": "코레일유통 AI혁신처 어휘집", "version": "1.0.0", "topics": 2}
    assert payload["errors"] == []

    after = client.get("/api/knowledge/vocab").json()
    assert after["layers"]["institution"] == {
        "name": "코레일유통 AI혁신처 어휘집",
        "version": "1.0.0",
        "topics": 2,
    }
    layers = {topic["id"]: topic["layer"] for topic in after["topics"]}
    assert layers["local-donghaeng"] == "institution"

    removed = client.delete("/api/knowledge/vocab/pack")
    assert removed.status_code == 200
    assert removed.json() == {"ok": True, "removed": True}
    assert client.get("/api/knowledge/vocab").json()["layers"]["institution"] is None


def test_pack_import_rejects_invalid_pack_without_partial_save(tmp_path: Path) -> None:
    client = _client(tmp_path)
    bad = {
        "schema_version": 1,
        "pack": {"name": "불량"},
        "topics": [
            {"id": "ok-topic", "name": "정상주제"},
            {"id": "BAD id", "name": "형식오류"},
        ],
    }
    response = client.post("/api/knowledge/vocab/pack", json={"content": bad})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["imported"] is None
    assert payload["errors"], "오류 전체 목록이 반환되어야 한다"
    # 부분 임포트 금지 — 정상 topic 1건도 저장되면 안 된다.
    assert client.get("/api/knowledge/vocab").json()["layers"]["institution"] is None
    # path·content 둘 다 없으면 400.
    assert client.post("/api/knowledge/vocab/pack", json={}).status_code == 400


def test_pack_import_from_path_marks_docs_dirty(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "문서.md").write_text("# 문서\n\n본문입니다.", encoding="utf-8")
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    services = client.app.state.services

    def llm(messages):
        if "백과사전" in str(messages[0]["text"]):
            return None
        return json.dumps({"summary": "요약. 요약. 요약.", "topics": []}, ensure_ascii=False)

    services.wiki.enrich(llm=llm)
    doc = services.db.fetch_one("SELECT * FROM knowledge_wiki_docs")
    assert doc["enriched"] == 1 and doc["summary_stale"] == 0

    pack_file = tmp_path / "기관팩.gongmu-vocab.json"
    pack_file.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "pack": {"name": "경로팩", "version": "0.1.0"},
                "topics": [{"id": "path-topic", "name": "경로주제"}],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    response = client.post("/api/knowledge/vocab/pack", json={"path": str(pack_file)})
    assert response.json()["ok"] is True
    refreshed = services.db.fetch_one("SELECT * FROM knowledge_wiki_docs")
    assert refreshed["summary_stale"] == 1, "임포트 성공 시 기존 문서가 재평가 대상(dirty)이 된다"


# ---------------------------------------------------------------------------
# §6 후보 큐 — 승인/병합/거절
# ---------------------------------------------------------------------------


def test_candidate_approve_joins_user_layer_and_marks_samples_dirty(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "특이.md").write_text("# 특이 업무\n\n로컬동행 관련 기록.", encoding="utf-8")
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    services = client.app.state.services
    doc = services.db.fetch_one("SELECT * FROM knowledge_wiki_docs")
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET enriched = 1, summary_stale = 0 WHERE id = ?", (doc["id"],)
    )
    candidate = services.vocab.enqueue_candidate("로컬동행", doc=doc)
    assert candidate is not None

    decided = client.post(
        f"/api/knowledge/vocab/candidates/{candidate['id']}/decision",
        json={"action": "approve", "synonyms": ["로컬 동행 사업"]},
    )
    assert decided.status_code == 200
    payload = decided.json()
    assert payload["candidate"]["status"] == "approved"
    assert payload["topic"]["layer"] == "user"

    # user layer 편입 + 매칭 가능.
    assert client.get("/api/knowledge/vocab").json()["layers"]["user"] == 1
    assert services.vocab.contains("로컬 동행 사업")
    matches = services.vocab.match_document(title="로컬동행 실적", file_name="a.md", body="")
    assert matches and matches[0]["name"] == "로컬동행"
    # 미러 파일 갱신.
    mirror = json.loads((tmp_path / "vocab" / "user-approved.json").read_text(encoding="utf-8"))
    assert any(topic["name"] == "로컬동행" for topic in mirror["topics"])
    # 표본 문서 dirty 재태깅 대상.
    refreshed = services.db.fetch_one("SELECT * FROM knowledge_wiki_docs WHERE id = ?", (doc["id"],))
    assert refreshed["summary_stale"] == 1


def test_candidate_merge_adds_synonym_to_target_topic(tmp_path: Path) -> None:
    client = _client(tmp_path)
    services = client.app.state.services
    candidate = services.vocab.enqueue_candidate("예산 시즌 대응")
    decided = client.post(
        f"/api/knowledge/vocab/candidates/{candidate['id']}/decision",
        json={"action": "merge", "merge_into_id": "budget-formulation"},
    )
    assert decided.status_code == 200
    payload = decided.json()
    assert payload["candidate"]["status"] == "merged"
    assert payload["candidate"]["merged_into_id"] == "budget-formulation"
    merged = {entry["id"]: entry for entry in services.vocab.merged_topics()}
    assert "예산 시즌 대응" in merged["budget-formulation"]["synonyms"]
    assert merged["budget-formulation"]["name"] == "예산편성", "병합은 name을 바꾸지 않는다"
    # 이후 매칭에서 병합 synonym이 정식명으로 환원된다.
    selected, proposals = services.vocab.resolve_selection(["예산 시즌 대응"])
    assert selected == ["예산편성"] and proposals == []


def test_candidate_reject_and_double_decision_conflict(tmp_path: Path) -> None:
    client = _client(tmp_path)
    services = client.app.state.services
    candidate = services.vocab.enqueue_candidate("거절될 주제")
    rejected = client.post(
        f"/api/knowledge/vocab/candidates/{candidate['id']}/decision", json={"action": "reject"}
    )
    assert rejected.status_code == 200
    assert rejected.json()["candidate"]["status"] == "rejected"
    again = client.post(
        f"/api/knowledge/vocab/candidates/{candidate['id']}/decision", json={"action": "approve"}
    )
    assert again.status_code == 409, "이미 결정된 후보 재결정은 409"
    missing = client.post(
        "/api/knowledge/vocab/candidates/does-not-exist/decision", json={"action": "reject"}
    )
    assert missing.status_code == 404
    bad_merge = services.vocab.enqueue_candidate("병합 대상 없음")
    response = client.post(
        f"/api/knowledge/vocab/candidates/{bad_merge['id']}/decision",
        json={"action": "merge", "merge_into_id": "no-such-topic"},
    )
    assert response.status_code == 400


def test_candidate_dedupes_by_norm_key_and_counts_hits(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    first = manager.enqueue_candidate("우주 감자", doc={"id": "d1", "slug": "s1", "title": "문서1"})
    second = manager.enqueue_candidate("우주감자", doc={"id": "d2", "slug": "s2", "title": "문서2"})
    assert first is not None and second is not None
    assert second["id"] == first["id"], "정규화 키가 같으면 같은 후보로 접힌다"
    assert second["hit_count"] == 2
    samples = json.loads(second["sample_docs_json"])
    assert [sample["doc_id"] for sample in samples] == ["d2", "d1"]
    assert manager.enqueue_candidate("예산편성") is None, "이미 어휘집에 있는 키는 적재하지 않는다"


def test_candidate_approve_collision_with_vocab_key_is_rejected(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    candidate = manager.enqueue_candidate("완전히 새로운 주제")
    with pytest.raises(VocabValidationError):
        manager.decide_candidate(candidate["id"], action="approve", name_override="예산편성")


# ---------------------------------------------------------------------------
# 프론트 계약 — backend_status.llm_enrichment.vocab_candidates_pending
# ---------------------------------------------------------------------------


def test_backend_status_exposes_pending_vocab_candidates(tmp_path: Path) -> None:
    client = _client(tmp_path)
    services = client.app.state.services
    before = client.get("/api/knowledge/backend-status").json()
    assert before["llm_enrichment"]["vocab_candidates_pending"] == 0
    services.vocab.enqueue_candidate("대기 후보 1")
    services.vocab.enqueue_candidate("대기 후보 2")
    after = client.get("/api/knowledge/backend-status").json()
    assert after["llm_enrichment"]["vocab_candidates_pending"] == 2
