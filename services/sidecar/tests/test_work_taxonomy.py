"""T-01 Work-Aware 지식 분류체계 엔진 계약 테스트.

프리셋 → 니즈파악 → Folder Recon+가족감지 → 융합 초안 → 확정(SCHEMA.md)
→ 자동 태깅+저확신 큐 → Quality Report → 업무 허브 파이프라인 검증.
"""

from __future__ import annotations

import json
import os
import time
import unicodedata
from pathlib import Path

import pytest

from gongmu_sidecar.app import create_app
from gongmu_sidecar.taxonomy_rules import match_work_area
from gongmu_sidecar.work_taxonomy import (
    DEFAULT_DOC_ROLE_KEYS,
    DOC_ROLES,
    InvalidTagError,
    match_doc_role,
    normalize_family_key,
    normalize_folder_name,
    version_signals,
)


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _make_work_source(tmp_path: Path) -> Path:
    source = tmp_path / "workfolder"
    budget = source / "□주요□예산"
    budget.mkdir(parents=True)
    (budget / "2025 예산요구서 (최종).md").write_text(
        "# 예산요구서\n\n2025년 예산 요구 내용입니다.", encoding="utf-8"
    )
    (budget / "250110_예산요구서.md").write_text(
        "# 예산요구서 초안\n\n예산 요구 초안입니다.", encoding="utf-8"
    )
    (budget / "예산집행지침.md").write_text(
        "# 예산집행지침\n\n예산 집행 지침입니다.", encoding="utf-8"
    )
    perf = source / "□주요□성과평가"
    perf.mkdir()
    (perf / "성과평가 결과보고(1017).md").write_text(
        "# 성과평가 결과보고\n\n10월 성과평가 결과입니다.", encoding="utf-8"
    )
    (perf / "성과평가 결과보고(1118).md").write_text(
        "# 성과평가 결과보고\n\n11월 성과평가 결과입니다.", encoding="utf-8"
    )
    shelf = source / "■참고■자료실"
    shelf.mkdir()
    (shelf / "참고논문.md").write_text("# 참고논문\n\n외부 참고 자료입니다.", encoding="utf-8")
    (source / "업무분장표.md").write_text(
        "# 업무분장표\n\n부서 업무 분장 내역입니다.", encoding="utf-8"
    )
    (source / "메모.md").write_text("# 메모\n\n자유 메모입니다.", encoding="utf-8")
    (source / "예산 브리핑.md").write_text(
        "# 예산 브리핑\n\n예산 관련 브리핑 자료입니다.", encoding="utf-8"
    )
    old = time.time() - 86400 * 30
    os.utime(perf / "성과평가 결과보고(1017).md", (old, old))
    older = time.time() - 86400 * 60
    os.utime(budget / "250110_예산요구서.md", (older, older))
    return source


def _register_scan_ingest(client, source: Path, label: str = "업무폴더") -> str:
    created = client.post("/api/knowledge/sources", json={"label": label, "root_path": str(source)})
    assert created.status_code == 201
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert (
        client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code
        == 201
    )
    return source_id


def _confirm_taxonomy(client, source_id: str) -> dict:
    response = client.post(
        "/api/knowledge/taxonomy",
        json={
            "source_id": source_id,
            "work_areas": [
                {"name": "예산", "folders": ["□주요□예산"], "keywords": ["예산"]},
                {"name": "성과평가", "folders": ["□주요□성과평가"], "keywords": ["성과평가"]},
            ],
            "doc_roles_enabled": [],
            "family_policy": "latest_representative",
        },
    )
    assert response.status_code == 201
    return response.json()


# ------------------------------------------------------------------- 프리셋


def test_presets_cover_eight_roles_plus_shadow_and_filename_signals() -> None:
    non_shadow = [role for role in DOC_ROLES if not role["shadow"]]
    assert len(non_shadow) == 8
    assert len(DEFAULT_DOC_ROLE_KEYS) == 8
    assert any(role["shadow"] for role in DOC_ROLES)

    assert match_doc_role("예산집행지침")["key"] == "regulation"
    assert match_doc_role("성과평가 결과보고(1118)")["key"] == "report"
    assert match_doc_role("2026 사업계획(안)")["key"] == "plan"
    assert match_doc_role("정기회의 자료 (2차)")["key"] == "meeting"
    assert match_doc_role("협조 공문 발송")["key"] == "official"
    assert match_doc_role("제출 양식 v2")["key"] == "form"
    assert match_doc_role("(붙임) 증빙자료")["key"] == "reference"
    assert match_doc_role("계획서 backup")["key"] == "temp_backup"
    assert match_doc_role("아무신호없는이름") is None

    signals = version_signals("250110_보고서 v3 (최종)(2차)")
    assert signals["date_token"] == "250110"
    assert signals["version"] == 3
    assert signals["final"] is True
    assert signals["round"] == 2

    assert normalize_folder_name("□주요□예산") == "예산"
    assert normalize_folder_name("01. 2025년 성과평가") == "성과평가"
    # 2026-07-08 리뷰: "2026년도"에서 "년"만 지우고 "도"가 남던 회귀 방지.
    assert normalize_folder_name("2026년도 사업계획") == "사업계획"
    assert normalize_folder_name("□주요□2025년도 성과평가") == "성과평가"
    assert normalize_family_key("2025 예산요구서 (최종)") == normalize_family_key("250110_예산요구서")
    # 사본/번호 변형이 같은 가족으로 병합되어야 개별문서 분리 회귀가 없다.
    _fam = normalize_family_key("AI 혁신 운영계획(안)")
    assert normalize_family_key("AI 혁신 운영계획(안)(1)") == _fam
    assert normalize_family_key("AI 혁신 운영계획(안) 사본") == _fam
    assert normalize_family_key("2026년도 AI 혁신 운영계획(안)") == _fam


# ----------------------------------------------------------- 초안(proposal)


def test_proposal_detects_work_areas_families_governance(tmp_path: Path) -> None:
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)

    response = client.get("/api/knowledge/taxonomy/proposal", params={"source_id": source_id})

    assert response.status_code == 200
    proposal = response.json()

    assert proposal["needs_scan"] is False
    assert proposal["scanned_file_count"] == 9

    area_names = {area["name"] for area in proposal["work_areas"]}
    assert {"예산", "성과평가"} <= area_names
    budget_area = next(area for area in proposal["work_areas"] if area["name"] == "예산")
    assert budget_area["confidence"] == "high"
    assert budget_area["folders"] == ["□주요□예산"]
    assert budget_area["source"] == "folder"

    # 참고 접두사 폴더는 업무 후보가 아니라 참고자료 서고로 분리
    assert all(area["name"] != "자료실" for area in proposal["work_areas"])
    assert proposal["reference_shelves"] == [{"folder": "■참고■자료실", "doc_count": 1}]

    families = proposal["families"]
    assert len(families) == 2
    budget_family = next(f for f in families if "예산요구서" in f["title"])
    assert len(budget_family["members"]) == 2
    assert "최종" in Path(budget_family["latest_path"]).name
    assert budget_family["official_slug"] == budget_family["latest_slug"]
    perf_family = next(f for f in families if "성과평가" in f["title"])
    assert "(1118)" in Path(perf_family["latest_path"]).name  # (최종) 없으면 수정일 최신

    assert proposal["governance_docs"]
    assert proposal["governance_docs"][0]["kind"] == "업무분장"
    assert proposal["conventions"]["prefix_importance"] is True
    assert proposal["doc_role_stats"]["regulation"] >= 1
    assert proposal["doc_role_stats"]["report"] >= 2


def test_interview_saved_and_reflected_in_proposal(tmp_path: Path) -> None:
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)

    saved = client.post(
        "/api/knowledge/taxonomy/interview",
        json={
            "org_type": "지자체",
            "department": "기획예산과",
            "duty": "예산 편성 총괄",
            "purpose": "인수인계 대비",
        },
    )
    assert saved.status_code == 200
    assert saved.json()["interview"]["purpose"] == "인수인계 대비"

    fetched = client.get("/api/knowledge/taxonomy/interview")
    assert fetched.json()["interview"]["department"] == "기획예산과"

    proposal = client.get(
        "/api/knowledge/taxonomy/proposal", params={"source_id": source_id}
    ).json()
    assert proposal["interview"]["purpose"] == "인수인계 대비"
    assert any("인수인계" in hint for hint in proposal["hints"])


def test_llm_refine_attaches_suggestions_and_ignores_failure(tmp_path: Path) -> None:
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)
    taxonomy = client.app.state.services.taxonomy

    def fake_llm(messages):
        assert any("업무 후보" in message["text"] for message in messages)
        return json.dumps(
            {"work_areas": [{"name": "예산 관리", "merge_of": ["예산"]}], "notes": "병합 제안"},
            ensure_ascii=False,
        )

    refined = taxonomy.analyze_source(source_id, llm=fake_llm)
    assert refined["llm_suggestions"]["work_areas"][0]["name"] == "예산 관리"

    def broken_llm(messages):
        raise RuntimeError("llm unavailable")

    plain = taxonomy.analyze_source(source_id, llm=broken_llm)
    assert plain["llm_suggestions"] is None
    assert plain["work_areas"], "LLM 실패해도 결정론 초안은 유지되어야 한다"


# ------------------------------------- F-07 폴더 교차(cross-folder) 업무 후보


def _make_messy_source(tmp_path: Path) -> Path:
    """관행 폴더(받은파일/백업/인수인계)에 같은 업무 문서가 흩어진 엉킨 폴더."""
    source = tmp_path / "messy"
    received = source / "받은파일"
    received.mkdir(parents=True)
    (received / "2025년도 예산편성지침(수정).md").write_text(
        "# 예산편성지침\n\n예산 편성 기준입니다.", encoding="utf-8"
    )
    (received / "추경예산 편성 협조 요청.txt").write_text("추경 협조 요청.", encoding="utf-8")
    backup = source / "백업_2025"
    backup.mkdir()
    (backup / "예산 집행실적 보고.txt").write_text("분기 집행 실적입니다.", encoding="utf-8")
    (backup / "구내식당 운영 개선 검토.md").write_text(
        "# 검토\n\n구내식당 운영 개선.", encoding="utf-8"
    )
    handover = source / "김주무관 인수인계"
    handover.mkdir()
    (handover / "예산 전용요구서.md").write_text("# 전용요구서\n\n전용 요구.", encoding="utf-8")
    (handover / "휴직 및 복직 처리 절차.txt").write_text("휴복직 절차입니다.", encoding="utf-8")
    return source


def test_proposal_creates_cross_folder_candidates_from_vocab(tmp_path: Path) -> None:
    """F-07/F-07a: 어휘가 여러 1단계 폴더의 파일명에 반복되면 폴더 교차 후보가 생긴다."""
    source = _make_messy_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source, label="엉킨폴더")

    proposal = client.get(
        "/api/knowledge/taxonomy/proposal", params={"source_id": source_id}
    ).json()

    budget = next(area for area in proposal["work_areas"] if area["name"] == "예산")
    assert budget["source"] == "vocab-cross"
    assert budget["confidence"] == "medium"
    assert budget["keywords"] == ["예산"]
    assert budget["doc_count"] == 4
    assert set(budget["folders"]) == {"받은파일", "백업_2025", "김주무관 인수인계"}
    assert len(budget["folders"]) >= 2

    # 기존 폴더 승격 영역은 그대로 병렬 유지된다(스키마 필드 유지 + keywords 추가 필드).
    received_area = next(area for area in proposal["work_areas"] if area["name"] == "받은파일")
    assert received_area["source"] == "folder"
    assert received_area["folders"] == ["받은파일"]
    assert received_area["keywords"] == []


def test_duty_tokens_seed_cross_folder_candidates(tmp_path: Path) -> None:
    """F-07c 시드: WORK_VOCAB에 없는 duty 토큰(·/쉼표/공백 분리)도 교차 후보를 만든다."""
    source = tmp_path / "messy"
    for folder, filename in [
        ("받은파일", "물품관리 대장.md"),
        ("백업", "물품관리 점검표.md"),
        ("김주무관 인수인계", "물품관리 처리요령.md"),
    ]:
        path = source / folder / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# {filename}\n\n내용.", encoding="utf-8")
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source, label="물품폴더")

    before = client.get(
        "/api/knowledge/taxonomy/proposal", params={"source_id": source_id}
    ).json()
    assert all(area["name"] != "물품관리" for area in before["work_areas"])

    assert (
        client.post(
            "/api/knowledge/taxonomy/interview",
            json={
                "org_type": "지자체",
                "department": "총무과",
                "duty": "물품관리 · 재물조사/기록물",
                "purpose": "인수인계",
            },
        ).status_code
        == 200
    )
    after = client.get(
        "/api/knowledge/taxonomy/proposal", params={"source_id": source_id}
    ).json()
    supplies = next(area for area in after["work_areas"] if area["name"] == "물품관리")
    assert supplies["source"] == "vocab-cross"
    assert supplies["doc_count"] == 3
    assert len(supplies["folders"]) >= 2


def test_cross_folder_signal_merges_into_folder_area(tmp_path: Path) -> None:
    """F-07: 교차 후보 이름이 기존 폴더 승격 영역과 겹치면 folders/keywords만 병합."""
    source = tmp_path / "src"
    for folder, filename in [
        ("예산", "예산요구서.md"),
        ("예산", "예산편성 일정.md"),
        ("받은파일", "예산 배정 통보.md"),
        ("받은파일", "예산 협조 회신.md"),
    ]:
        path = source / folder / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# {filename}\n\n내용.", encoding="utf-8")
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source, label="예산폴더")

    proposal = client.get(
        "/api/knowledge/taxonomy/proposal", params={"source_id": source_id}
    ).json()

    budget_areas = [area for area in proposal["work_areas"] if area["name"] == "예산"]
    assert len(budget_areas) == 1, "교차 후보가 같은 이름의 영역을 중복 생성하면 안 된다"
    budget = budget_areas[0]
    assert budget["source"] == "folder"
    assert set(budget["folders"]) == {"예산", "받은파일"}
    assert "예산" in budget["keywords"]


def test_folder_vocab_match_alone_caps_confidence_at_medium(tmp_path: Path) -> None:
    """F-07c: 폴더명-어휘 우연 일치는 medium 상한, 파일 신호와 정합하면 high."""
    source = tmp_path / "src"
    outing = source / "행사출장"  # '행사' 어휘와 겹치지만 내용물은 시설 문서
    outing.mkdir(parents=True)
    (outing / "소방시설 합동점검 출장복명서.md").write_text(
        "# 복명서\n\n점검 결과.", encoding="utf-8"
    )
    (outing / "승강기 유지보수 현장확인.md").write_text(
        "# 현장확인\n\n확인 결과.", encoding="utf-8"
    )
    budget = source / "예산자료"  # '예산' 어휘 + 파일명도 예산 → 정합
    budget.mkdir()
    (budget / "예산집행지침.md").write_text("# 지침\n\n집행 지침.", encoding="utf-8")
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source, label="확신도폴더")

    proposal = client.get(
        "/api/knowledge/taxonomy/proposal", params={"source_id": source_id}
    ).json()

    outing_area = next(area for area in proposal["work_areas"] if area["name"] == "행사출장")
    assert outing_area["confidence"] == "medium", "폴더명 어휘 일치만으로 high가 되면 안 된다"
    budget_area = next(area for area in proposal["work_areas"] if area["name"] == "예산자료")
    assert budget_area["confidence"] == "high"


def test_llm_refine_receives_samples_and_duty_and_accepts_keywords(tmp_path: Path) -> None:
    """F-07b: llm_refine 입력에 영역별 대표 파일명 표본+duty, 출력 keywords 허용."""
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)
    client.post(
        "/api/knowledge/taxonomy/interview",
        json={
            "org_type": "지자체",
            "department": "기획예산과",
            "duty": "예산 편성 총괄",
            "purpose": "보고 생산성",
        },
    )
    taxonomy = client.app.state.services.taxonomy

    captured: dict = {}

    def fake_llm(messages):
        captured["messages"] = messages
        return json.dumps(
            {
                "work_areas": [
                    {"name": "예산 관리", "merge_of": ["예산"], "keywords": ["예산", "편성"]}
                ],
                "notes": "병합 제안",
            },
            ensure_ascii=False,
        )

    refined = taxonomy.analyze_source(source_id, llm=fake_llm)
    user_text = next(m["text"] for m in captured["messages"] if m["role"] == "user")
    assert "예산집행지침" in user_text, "영역별 대표 파일명 표본이 LLM 입력에 포함되어야 한다"
    assert "예산 편성 총괄" in user_text, "인터뷰 duty가 LLM 입력에 포함되어야 한다"
    assert refined["llm_suggestions"]["work_areas"][0]["keywords"] == ["예산", "편성"]

    # 관대한 파싱: keywords가 비리스트면 조용히 제거하고 나머지는 유지한다.
    def sloppy_llm(messages):
        return json.dumps(
            {"work_areas": [{"name": "예산", "keywords": "예산"}], "notes": ""},
            ensure_ascii=False,
        )

    lenient = taxonomy.analyze_source(source_id, llm=sloppy_llm)
    entry = lenient["llm_suggestions"]["work_areas"][0]
    assert entry["name"] == "예산"
    assert "keywords" not in entry


# --------------------------------------------------------- 확정 / SCHEMA.md


def test_confirm_writes_schema_md_and_taxonomy_endpoint(tmp_path: Path) -> None:
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)

    before = client.get("/api/knowledge/taxonomy")
    assert before.status_code == 200
    assert before.json()["configured"] is False

    client.post(
        "/api/knowledge/taxonomy/interview",
        json={"org_type": "지자체", "department": "기획예산과", "duty": "예산", "purpose": "인수인계 대비"},
    )
    confirmed = _confirm_taxonomy(client, source_id)
    assert confirmed["configured"] is True
    assert confirmed["taxonomy"]["family_policy"] == "latest_representative"
    assert confirmed["taxonomy"]["doc_roles_enabled"] == DEFAULT_DOC_ROLE_KEYS

    schema_path = Path(confirmed["schema_path"])
    assert schema_path == tmp_path / "knowledge-wiki" / "SCHEMA.md"
    schema_text = schema_path.read_text(encoding="utf-8")
    assert "# 지식 분류체계 (SCHEMA)" in schema_text
    assert "## 니즈 요약 (인터뷰)" in schema_text
    assert "기획예산과" in schema_text
    assert "### 예산 (`예산`)" in schema_text
    assert "□주요□예산" in schema_text
    assert "## 문서 유형 규칙" in schema_text
    assert "## 문서 가족(버전) 정책" in schema_text
    assert "latest_representative" in schema_text
    assert "(최종) > 버전번호(vN) > 수정일" in schema_text

    after = client.get("/api/knowledge/taxonomy").json()
    assert after["configured"] is True
    assert after["items"][0]["source_id"] == source_id
    assert {area["slug"] for area in after["items"][0]["taxonomy"]["work_areas"]} == {"예산", "성과평가"}

    invalid = client.post(
        "/api/knowledge/taxonomy", json={"source_id": source_id, "work_areas": []}
    )
    assert invalid.status_code == 400


# ------------------------------------------------- 태깅 + 큐 + Quality Report


def test_apply_tags_three_confidence_levels_and_fills_queue(tmp_path: Path) -> None:
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)
    _confirm_taxonomy(client, source_id)

    apply_before_confirm = client.post(
        "/api/knowledge/taxonomy/apply", json={"source_id": "missing-source"}
    )
    assert apply_before_confirm.status_code == 404

    applied = client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})
    assert applied.status_code == 201
    work_job = applied.json()["work_job"]
    assert work_job["kind"] == "knowledge.taxonomy.apply"
    assert work_job["status"] == "succeeded"
    report = work_job["result"]
    assert report["tagged_count"] == 9
    assert report["counts"] == {"high": 5, "medium": 1, "low": 2}
    assert report["family_count"] == 2
    assert report["quality"]["queue_count"] == 2
    assert applied.json()["quality"]["queue_count"] == 2

    db = client.app.state.services.db
    docs = {
        row["relative_path"]: row
        for row in db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
        )
    }
    # high: 확정 폴더 직매핑
    regulation = docs["□주요□예산/예산집행지침.md"]
    assert regulation["work_area_slug"] == "예산"
    assert regulation["doc_role"] == "regulation"
    assert regulation["tag_confidence"] == "high"
    # medium: 파일명 키워드 단독
    briefing = docs["예산 브리핑.md"]
    assert briefing["work_area_slug"] == "예산"
    assert briefing["tag_confidence"] == "medium"
    # low: 무신호 → 큐
    # 참고서고 정책(증분 경로와 통일): 참고 문서는 업무 태깅·큐 적재 대상이 아니다
    shelf_doc = docs["■참고■자료실/참고논문.md"]
    assert shelf_doc["tag_confidence"] == ""
    assert shelf_doc["work_area_slug"] == ""
    memo = docs["메모.md"]
    assert memo["tag_confidence"] == "low"
    assert memo["work_area_slug"] == ""

    # 가족: 최신본 = (최종) → official, 나머지 previous
    final_doc = docs["□주요□예산/2025 예산요구서 (최종).md"]
    previous_doc = docs["□주요□예산/250110_예산요구서.md"]
    assert final_doc["family_id"] and final_doc["family_id"] == previous_doc["family_id"]
    assert final_doc["family_role"] == "official"
    assert previous_doc["family_role"] == "previous"
    latest_report = docs["□주요□성과평가/성과평가 결과보고(1118).md"]
    assert latest_report["family_role"] == "latest"

    # 카드 front matter에 태그가 반영된다
    card_text = Path(regulation["card_path"]).read_text(encoding="utf-8")
    assert "work_area: 예산" in card_text
    assert "doc_role: regulation" in card_text
    assert "tag_confidence: high" in card_text
    final_card = Path(final_doc["card_path"]).read_text(encoding="utf-8")
    assert "family_role: official" in final_card

    queue = client.get("/api/knowledge/taxonomy/queue").json()["items"]
    assert len(queue) == 2
    assert all(item["status"] == "pending" for item in queue)
    memo_item = next(item for item in queue if item["title"] == "메모")
    assert memo_item["reason"] == "no_signal"
    assert set(memo_item["candidates"]) == {"work_areas", "doc_roles"}

    quality = client.get("/api/knowledge/taxonomy/quality").json()
    assert quality["configured"] is True
    entry = quality["items"][0]
    assert entry["source_id"] == source_id
    assert entry["conflicts"] == 0
    assert entry["duplicates"] == 0
    assert entry["unclear_latest"] == 0
    assert entry["queue_count"] == 2


def test_queue_resolve_updates_doc_card_and_status(tmp_path: Path) -> None:
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)
    _confirm_taxonomy(client, source_id)
    client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})

    queue = client.get("/api/knowledge/taxonomy/queue").json()["items"]
    memo_item = next(item for item in queue if item["title"] == "메모")

    resolved = client.post(
        f"/api/knowledge/taxonomy/queue/{memo_item['id']}/resolve",
        json={"work_area_slug": "예산", "doc_role": "reference"},
    )
    assert resolved.status_code == 200
    assert resolved.json()["item"]["status"] == "resolved"
    assert resolved.json()["item"]["resolved_work_area_slug"] == "예산"

    db = client.app.state.services.db
    doc = db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (memo_item["wiki_doc_id"],)
    )
    assert doc["work_area_slug"] == "예산"
    assert doc["doc_role"] == "reference"
    assert doc["tag_confidence"] == "high"
    card_text = Path(doc["card_path"]).read_text(encoding="utf-8")
    assert "work_area: 예산" in card_text

    pending = client.get("/api/knowledge/taxonomy/queue").json()["items"]
    assert len(pending) == 1
    assert client.get("/api/knowledge/taxonomy/quality").json()["items"][0]["queue_count"] == 1

    # 이미 해소된 항목 재해소 → 409, 존재하지 않는 항목 → 404
    again = client.post(
        f"/api/knowledge/taxonomy/queue/{memo_item['id']}/resolve",
        json={"work_area_slug": "예산", "doc_role": "reference"},
    )
    assert again.status_code == 409
    missing = client.post(
        "/api/knowledge/taxonomy/queue/no-such-item/resolve",
        json={"work_area_slug": "예산", "doc_role": "reference"},
    )
    assert missing.status_code == 404

    # 해소 결과가 업무 허브에 반영된다
    hub_text = (tmp_path / "knowledge-wiki" / "work-areas" / "예산.md").read_text(encoding="utf-8")
    assert "메모" in hub_text


# --------------------------------------------------- 허브 / index / tree


def test_hub_index_and_tree_expose_work_areas(tmp_path: Path) -> None:
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)
    _confirm_taxonomy(client, source_id)
    applied = client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})
    assert set(applied.json()["work_job"]["result"]["hub_paths"]) == {
        "work-areas/예산.md",
        "work-areas/성과평가.md",
    }

    hub_path = tmp_path / "knowledge-wiki" / "work-areas" / "예산.md"
    hub_text = hub_path.read_text(encoding="utf-8")
    assert hub_text.startswith("---")
    assert "# 예산" in hub_text
    assert "## 개요" in hub_text
    assert "유형 분포:" in hub_text
    assert "## 핵심 문서" in hub_text
    assert "[공식본]" in hub_text
    assert "## 유형별 문서" in hub_text
    assert "### 규정/지침" in hub_text
    assert "버전 이력 1건 접힘" in hub_text
    assert "## 관련 업무 기록" in hub_text
    # 대표 카드 원칙: 이전 버전 파일은 허브 목록에서 접힌다
    assert "250110_예산요구서" not in hub_text

    index_text = (tmp_path / "knowledge-wiki" / "index.md").read_text(encoding="utf-8")
    assert "## 업무" in index_text
    assert "[예산](work-areas/예산.md)" in index_text

    tree = client.get("/api/knowledge/wiki/tree").json()
    assert tree["counts"]["work_areas"] == 2
    budget_entry = next(area for area in tree["work_areas"] if area["slug"] == "예산")
    assert budget_entry["title"] == "예산"
    assert budget_entry["doc_count"] == 4
    assert budget_entry["path"] == "work-areas/예산.md"

    # 허브는 위키 페이지 API로 열람 가능해야 한다
    served = client.get("/api/knowledge/wiki/page", params={"path": "work-areas/예산.md"})
    assert served.status_code == 200
    assert "## 핵심 문서" in served.json()["content"]


def test_apply_requires_confirmed_taxonomy(tmp_path: Path) -> None:
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)

    response = client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})

    assert response.status_code == 409


# --------------------------------------- 신설치 연쇄 (스캔 → 색인 → 분류 적용)


def _register_only(client, source: Path, label: str = "업무폴더") -> str:
    created = client.post("/api/knowledge/sources", json={"label": label, "root_path": str(source)})
    assert created.status_code == 201
    return created.json()["id"]


def test_proposal_unscanned_source_returns_needs_scan_not_error(tmp_path: Path) -> None:
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_only(client, source)  # 스캔·색인 없이 바로 분석

    response = client.get("/api/knowledge/taxonomy/proposal", params={"source_id": source_id})

    assert response.status_code == 200
    proposal = response.json()
    assert proposal["needs_scan"] is True
    assert proposal["scanned_file_count"] == 0
    assert proposal["work_areas"] == []
    assert proposal["reference_shelves"] == []
    assert proposal["families"] == []
    assert proposal["governance_docs"] == []
    assert proposal["doc_role_stats"] == {}
    assert proposal["llm_suggestions"] is None


def test_apply_chains_ingest_for_scanned_but_unindexed_source(tmp_path: Path) -> None:
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_only(client, source)
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    _confirm_taxonomy(client, source_id)

    services = client.app.state.services
    stages: list[str] = []
    original_update_progress = services.jobs.update_progress

    def spy_update_progress(job_id, **kwargs):
        stages.append(str(kwargs.get("stage")))
        return original_update_progress(job_id, **kwargs)

    services.jobs.update_progress = spy_update_progress
    try:
        applied = client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})
    finally:
        services.jobs.update_progress = original_update_progress

    assert applied.status_code == 201
    work_job = applied.json()["work_job"]
    assert work_job["status"] == "succeeded"
    report = work_job["result"]
    # 잡 메타: 색인 선실행 신호
    assert report["indexed_before_apply"] is True
    assert report["indexed_count"] == 9
    assert report["ingestion_job_id"]
    # 색인 + 태깅 모두 완료: 카드 생성 + 태그 부여
    assert report["tagged_count"] == 9
    assert report["counts"] == {"high": 5, "medium": 1, "low": 2}

    db = services.db
    docs = {
        row["relative_path"]: row
        for row in db.fetch_all(
            "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
        )
    }
    assert len(docs) == 9
    regulation = docs["□주요□예산/예산집행지침.md"]
    assert regulation["work_area_slug"] == "예산"
    assert regulation["tag_confidence"] == "high"
    assert Path(regulation["card_path"]).exists()
    card_text = Path(regulation["card_path"]).read_text(encoding="utf-8")
    assert "work_area: 예산" in card_text

    # 진행 스테이지: "색인" → "분류 적용" 순으로 노출
    assert "색인" in stages
    assert "분류 적용" in stages
    assert stages.index("색인") < stages.index("분류 적용")

    # 실행기록 한국어 1건: 색인 선행 취지 반영
    applied_log = next(
        log for log in db.list_logs(limit=200) if log["action"] == "knowledge.taxonomy.applied"
    )
    assert applied_log["outputs"]["indexed_before_apply"] is True
    assert applied_log["outputs"]["indexed_count"] == 9
    assert applied_log["outputs"]["summary"] == "색인 9건 선행 후 분류 적용"


def test_apply_chains_scan_and_ingest_for_never_scanned_source(tmp_path: Path) -> None:
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_only(client, source)  # 스캔조차 하지 않은 신설치 상태
    _confirm_taxonomy(client, source_id)

    applied = client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})

    assert applied.status_code == 201
    work_job = applied.json()["work_job"]
    assert work_job["status"] == "succeeded"
    report = work_job["result"]
    assert report["indexed_before_apply"] is True
    assert report["indexed_count"] == 9
    assert report["tagged_count"] == 9

    db = client.app.state.services.db
    file_count = db.fetch_one(
        "SELECT COUNT(*) AS count FROM knowledge_source_files WHERE source_id = ? AND status != ?",
        (source_id, "deleted"),
    )
    assert int(file_count["count"]) == 9  # 스캔도 연쇄로 실행됨
    doc_count = db.fetch_one(
        "SELECT COUNT(*) AS count FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    assert int(doc_count["count"]) == 9


def test_apply_skips_reingest_for_already_indexed_source(tmp_path: Path) -> None:
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)  # 기색인 소스
    _confirm_taxonomy(client, source_id)

    jobs_before = len(client.get("/api/knowledge/ingestion-jobs").json()["items"])
    applied = client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})

    assert applied.status_code == 201
    work_job = applied.json()["work_job"]
    assert work_job["status"] == "succeeded"
    report = work_job["result"]
    assert report["indexed_before_apply"] is False
    assert report["indexed_count"] == 0
    assert report["ingestion_job_id"] is None
    assert report["tagged_count"] == 9
    assert report["counts"] == {"high": 5, "medium": 1, "low": 2}

    # 색인 잡을 새로 만들지 않는다(전건 스킵 대상이므로 재실행 없음)
    jobs_after = len(client.get("/api/knowledge/ingestion-jobs").json()["items"])
    assert jobs_after == jobs_before

    applied_log = next(
        log
        for log in client.app.state.services.db.list_logs(limit=200)
        if log["action"] == "knowledge.taxonomy.applied"
    )
    assert applied_log["outputs"]["indexed_before_apply"] is False
    assert "summary" not in applied_log["outputs"]


# --------------------------------------------------------------------------
# WI-2 (2026-07-14 hub-assignment) — 폴더 중복 claim 3단 타이브레이크
# 결함: match_work_area가 폴더 매칭 2개 이상이면 무조건 conflict/low로 추락해
# 노이즈 영역이 실폴더를 중복 claim하면 폴더 전체가 low가 됐다(high 3/414).
# --------------------------------------------------------------------------


def _dup_claim_taxonomy() -> dict:
    """실DB 노이즈 상태 재현: 'AI'/'기반'이 소유 폴더 2개를 전부 중복 claim."""
    return {
        "work_areas": [
            {
                "name": "사업계획",
                "slug": "사업계획",
                "folders": ["□주요□2026년도 사업계획"],
                "keywords": [],
            },
            {
                "name": "AI융합 상징프로젝트",
                "slug": "ai융합-상징프로젝트",
                "folders": ["□주요□AI융합 상징프로젝트"],
                "keywords": [],
            },
            {
                "name": "AI",
                "slug": "ai",
                "folders": ["□주요□2026년도 사업계획", "□주요□AI융합 상징프로젝트"],
                "keywords": ["AI"],
            },
            {
                "name": "기반",
                "slug": "기반",
                "folders": ["□주요□2026년도 사업계획", "□주요□AI융합 상징프로젝트"],
                "keywords": ["기반"],
            },
        ]
    }


def test_match_work_area_owner_tiebreak_on_duplicate_claims() -> None:
    """E04(함수 레벨): 중복 claim 폴더는 소유자(폴더명 파생 slug 일치) 영역이 high."""
    from gongmu_sidecar.taxonomy_rules import folder_owner_slug

    assert folder_owner_slug("□주요□2026년도 사업계획") == "사업계획"
    assert folder_owner_slug("□주요□AI융합 상징프로젝트") == "ai융합-상징프로젝트"

    taxonomy = _dup_claim_taxonomy()
    assert match_work_area(
        taxonomy, relative_path="□주요□2026년도 사업계획/2026년도 사업계획서 작성지침.txt"
    ) == ("사업계획", "high", [], "folder")
    assert match_work_area(
        taxonomy, relative_path="□주요□AI융합 상징프로젝트/AI융합 상징프로젝트 추진계획.txt"
    ) == ("ai융합-상징프로젝트", "high", [], "folder")


def test_match_work_area_marker_variant_and_nfd_path() -> None:
    """E05+E14(함수 레벨): ■주요■ 마커 변형과 NFD 분해 경로에도 소유자 판정이 성립."""
    taxonomy = {
        "work_areas": [
            {
                "name": "데이터 혁신",
                "slug": "데이터-혁신",
                "folders": ["■주요■데이터 혁신"],
                "keywords": [],
            },
            {
                "name": "데이터",
                "slug": "데이터",
                "folders": ["■주요■데이터 혁신", "받은파일"],
                "keywords": ["데이터"],
            },
        ]
    }
    assert match_work_area(
        taxonomy, relative_path="■주요■데이터 혁신/데이터 혁신 회의자료.txt"
    ) == ("데이터-혁신", "high", [], "folder")
    # NFD 분해형 입력도 nfc 정규화 후 같은 판정(결정적 튜플 비교) — E14.
    nfd_path = unicodedata.normalize("NFD", "■주요■데이터 혁신/2026 데이터 표준화 보고.hwp")
    assert match_work_area(taxonomy, relative_path=nfd_path) == (
        "데이터-혁신",
        "high",
        [],
        "folder",
    )


def test_match_work_area_deep_subfolder_owner_wins() -> None:
    """E06(함수 레벨): 3단 하위 경로 문서도 1단계 세그먼트 소유자가 결정적으로 high."""
    taxonomy = {
        "work_areas": [
            {
                "name": "성과평가",
                "slug": "성과평가",
                "folders": ["□주요□성과평가"],
                "keywords": [],
            },
            {
                "name": "평가",
                "slug": "평가",
                "folders": ["□주요□성과평가", "□주요□2026년도 사업계획"],
                "keywords": ["평가"],
            },
        ]
    }
    assert match_work_area(
        taxonomy, relative_path="□주요□성과평가/제출/증빙/실적 증빙자료.txt"
    ) == ("성과평가", "high", [], "folder")


def test_match_work_area_specificity_fallback_and_true_conflict() -> None:
    """타이브레이크 ③(개명 영역→최소 folders 특이도)과 ④(진짜 모호→conflict 유지)."""
    # 영역 개명으로 소유자 판정이 빗나가도, 최소 folders claim이 유일하면 그 영역.
    renamed = {
        "work_areas": [
            {
                "name": "경영평가 대응",
                "slug": "경영평가-대응",
                "folders": ["□주요□정부경평 피드백"],
                "keywords": [],
            },
            {
                "name": "평가",
                "slug": "평가",
                "folders": ["□주요□정부경평 피드백", "□주요□성과평가"],
                "keywords": [],
            },
        ]
    }
    assert match_work_area(
        renamed, relative_path="□주요□정부경평 피드백/경평 지적사항 조치계획.txt"
    ) == ("경영평가-대응", "high", [], "folder")

    # 소유자 부재 + 특이도 동률 = 진짜 모호 — 현행대로 conflict/low 큐 유지.
    ambiguous = {
        "work_areas": [
            {"name": "영역B", "slug": "영역b", "folders": ["공유폴더"], "keywords": []},
            {"name": "영역A", "slug": "영역a", "folders": ["공유폴더"], "keywords": []},
        ]
    }
    slug, confidence, candidates, reason = match_work_area(
        ambiguous, relative_path="공유폴더/모호한 문서.txt"
    )
    assert (slug, confidence, reason) == (None, "low", "conflict")
    # candidates는 특이도(folders 길이 오름차순, 동률은 slug순) 정렬로 반환된다.
    assert [item["work_area_slug"] for item in candidates] == ["영역a", "영역b"]
    assert all(item["signal"] == "folder" for item in candidates)


def _make_dup_claim_source(tmp_path: Path) -> Path:
    source = tmp_path / "dupclaim"
    plan = source / "□주요□2026년도 사업계획"
    plan.mkdir(parents=True)
    (plan / "2026년도 사업계획서 작성지침.txt").write_text("작성지침입니다.", encoding="utf-8")
    (plan / "2026년도 사업계획 초안.txt").write_text("초안입니다.", encoding="utf-8")
    (plan / "부서 의견조회 결과.txt").write_text("의견조회 결과입니다.", encoding="utf-8")
    ai = source / "□주요□AI융합 상징프로젝트"
    ai.mkdir()
    (ai / "AI융합 상징프로젝트 추진계획.txt").write_text("추진계획입니다.", encoding="utf-8")
    (ai / "AI융합 착수보고.txt").write_text("착수보고입니다.", encoding="utf-8")
    return source


def test_apply_assigns_owner_high_under_duplicate_claims(tmp_path: Path) -> None:
    """E04(픽스처 E2E): 노이즈 중복 claim 확정 후 apply — 폴더 전건 소유자 high."""
    source = _make_dup_claim_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source, label="중복claim")
    confirmed = client.post(
        "/api/knowledge/taxonomy",
        json={
            "source_id": source_id,
            "work_areas": [
                {"name": "사업계획", "folders": ["□주요□2026년도 사업계획"]},
                {"name": "AI융합 상징프로젝트", "folders": ["□주요□AI융합 상징프로젝트"]},
                {
                    "name": "AI",
                    "folders": ["□주요□2026년도 사업계획", "□주요□AI융합 상징프로젝트"],
                },
                {
                    "name": "기반",
                    "folders": ["□주요□2026년도 사업계획", "□주요□AI융합 상징프로젝트"],
                },
            ],
            "doc_roles_enabled": [],
            "family_policy": "latest_representative",
        },
    )
    assert confirmed.status_code == 201
    applied = client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})
    assert applied.status_code == 201
    assert applied.json()["work_job"]["status"] == "succeeded"

    db = client.app.state.services.db
    docs = db.fetch_all(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ?", (source_id,)
    )
    plan_docs = [d for d in docs if d["relative_path"].startswith("□주요□2026년도 사업계획/")]
    assert len(plan_docs) == 3
    assert all(d["work_area_slug"] == "사업계획" for d in plan_docs)
    assert all(d["tag_confidence"] == "high" for d in plan_docs)
    ai_docs = [d for d in docs if d["relative_path"].startswith("□주요□AI융합 상징프로젝트/")]
    assert len(ai_docs) == 2
    assert all(d["work_area_slug"] == "ai융합-상징프로젝트" for d in ai_docs)
    assert all(d["tag_confidence"] == "high" for d in ai_docs)
    # 노이즈 slug 배정 문서 0건, pending 큐 0건.
    assert all(d["work_area_slug"] not in {"ai", "기반"} for d in docs)
    assert client.get("/api/knowledge/taxonomy/queue").json()["items"] == []


# ------------------------------------- WI-2 노이즈 업무영역 생성 차단 (vocab-cross)


def _make_noise_source(tmp_path: Path) -> Path:
    """승격(□주요□=high) 폴더에 duty 단어조각이 파일명으로 반복 + 관행 폴더에 예산 문서."""
    source = tmp_path / "noisy"
    files = [
        ("□주요□2026년도 사업계획", "2026년도 사업계획서 작성지침.txt"),
        ("□주요□2026년도 사업계획", "2026년도 사업계획 초안.txt"),
        ("□주요□AI융합 상징프로젝트", "AI융합 상징프로젝트 추진계획.txt"),
        ("□주요□AI융합 상징프로젝트", "AI 도입 전략 수립 초안.txt"),
        ("□주요□AI활용 내재화 및 문화조성", "직원 AI 교육 계획.txt"),
        ("□주요□AI활용 내재화 및 문화조성", "데이터 기반 업무혁신 과제 총괄.txt"),
        ("□주요□데이터 혁신", "데이터 표준화 보고.txt"),
        # 정당한 교차 후보: 비승격 관행 폴더 2곳 + 파일명 '예산' 3건 (E07).
        ("받은파일/예산", "2027 예산요구서.txt"),
        ("받은파일", "예산 심의결과 통보.txt"),
        ("백업", "예산요구서 백업.txt"),
    ]
    for folder, filename in files:
        path = source / folder / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{filename} 내용입니다.", encoding="utf-8")
    return source


def test_proposal_blocks_noise_candidates_but_keeps_legit_cross(tmp_path: Path) -> None:
    """E07: duty 단어조각·승격폴더 부풀림 후보는 소멸, 관행 폴더 교차 후보는 생존."""
    source = _make_noise_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source, label="노이즈폴더")
    assert (
        client.post(
            "/api/knowledge/taxonomy/interview",
            json={
                "org_type": "공공기관",
                "department": "AI혁신처",
                "duty": "AI 도입·확산 전략 수립, 직원 AI 교육, 데이터 기반 업무혁신 과제 총괄",
                "purpose": "보고 생산성",
            },
        ).status_code
        == 200
    )

    proposal = client.get(
        "/api/knowledge/taxonomy/proposal", params={"source_id": source_id}
    ).json()
    work_areas = proposal["work_areas"]

    # 노이즈 후보 0건: duty 단어조각·불용어에서 파생된 이름이 존재하면 안 된다.
    noise_names = {"AI", "도입", "확산", "전략", "수립", "직원", "데이터", "기반", "과제", "총괄", "교육"}
    assert all(area["name"] not in noise_names for area in work_areas)
    # 승격 폴더만으로 구성된 vocab-cross 후보 0건 — 유일한 cross 후보는 '예산'.
    cross = [area for area in work_areas if area["source"] == "vocab-cross"]
    assert [area["name"] for area in cross] == ["예산"]
    budget = cross[0]
    assert set(budget["folders"]) == {"받은파일", "백업"}
    assert budget["keywords"] == ["예산"]
    assert budget["doc_count"] == 3
    # 폴더 승격 후보는 유지된다(실폴더와 1:1).
    folder_names = {area["name"] for area in work_areas if area["source"] == "folder"}
    assert {"사업계획", "AI융합 상징프로젝트", "AI활용 내재화 및 문화조성", "데이터 혁신"} <= folder_names


# ------------------------------- WI-2 confirm 정리 (중복 claim·빈 keywords 부여)


def test_confirm_normalizes_duplicate_claims_and_grants_keywords(tmp_path: Path) -> None:
    """confirm: 중복 claim 폴더는 소유자만 유지(비소유 keywords 강등), 빈 영역 keywords 부여."""
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)

    response = client.post(
        "/api/knowledge/taxonomy",
        json={
            "source_id": source_id,
            "work_areas": [
                {"name": "예산", "folders": ["□주요□예산"], "keywords": ["예산"]},
                {"name": "성과평가", "folders": ["□주요□성과평가"], "keywords": []},
                # 노이즈: 소유 폴더 2개를 중복 claim.
                {"name": "AI", "folders": ["□주요□예산", "□주요□성과평가"], "keywords": []},
                # 폴더·키워드 모두 빈 영역 — 매칭 불능 상태로 남으면 안 된다.
                {"name": "총무", "folders": [], "keywords": []},
            ],
            "doc_roles_enabled": [],
            "family_policy": "latest_representative",
        },
    )
    assert response.status_code == 201
    areas = {area["slug"]: area for area in response.json()["taxonomy"]["work_areas"]}

    assert areas["예산"]["folders"] == ["□주요□예산"]
    assert areas["성과평가"]["folders"] == ["□주요□성과평가"]
    # 비소유 영역은 folders에서 제거되고 이름이 keywords로 강등된다.
    assert areas["ai"]["folders"] == []
    assert "AI" in areas["ai"]["keywords"]
    # folders=[]·keywords=[] 영역은 keywords=[name] 자동 부여.
    assert areas["총무"]["keywords"] == ["총무"]

    # 정리 내역이 db.log에 남는다.
    logs = client.app.state.services.db.list_logs(limit=100)
    normalized = next(
        log for log in logs if log["action"] == "knowledge.taxonomy.confirm.normalized"
    )
    assert normalized["outputs"]["duplicate_folder_claims"]
    assert "총무" in normalized["outputs"]["keyword_granted"]

    # 정리된 체계로 apply하면 중복 claim 폴더 문서가 소유자 high로 배정된다.
    applied = client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})
    assert applied.status_code == 201
    db = client.app.state.services.db
    regulation = db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE source_id = ? AND relative_path = ?",
        (source_id, "□주요□예산/예산집행지침.md"),
    )
    assert regulation["work_area_slug"] == "예산"
    assert regulation["tag_confidence"] == "high"


# ------------------------------------------- WI-2 resolve_queue_items 일괄 해소


def test_resolve_queue_items_bulk_lock_and_single_hub_rewrite(tmp_path: Path) -> None:
    """일괄 해소: 단건과 동일 계약(tag_locked=1·유령 slug 400) + 허브 재작성 1회."""
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)
    _confirm_taxonomy(client, source_id)
    client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})
    manager = client.app.state.services.taxonomy
    db = client.app.state.services.db

    queue = manager.list_queue(source_id=source_id)
    assert len(queue) == 2
    memo_item = next(item for item in queue if item["title"] == "메모")
    chart_item = next(item for item in queue if item["title"] == "업무분장표")

    # 유령 slug가 섞이면 선검증에서 InvalidTagError — 아무것도 변경되지 않는다.
    with pytest.raises(InvalidTagError):
        manager.resolve_queue_items(
            [
                {"id": memo_item["id"], "work_area_slug": "예산"},
                {"id": chart_item["id"], "work_area_slug": "유령업무"},
            ]
        )
    assert len(manager.list_queue(source_id=source_id)) == 2
    untouched = db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (memo_item["wiki_doc_id"],)
    )
    assert int(untouched["tag_locked"] or 0) == 0

    # 허브 재작성은 배치당 1회만 수행된다.
    calls = {"count": 0}
    original_write_hubs = manager._write_hubs

    def counting_write_hubs(*args, **kwargs):
        calls["count"] += 1
        return original_write_hubs(*args, **kwargs)

    manager._write_hubs = counting_write_hubs
    try:
        result = manager.resolve_queue_items(
            [
                {"id": memo_item["id"], "work_area_slug": "예산", "doc_role": "reference"},
                {"id": chart_item["id"], "work_area_slug": "성과평가"},
            ]
        )
    finally:
        del manager._write_hubs
    assert calls["count"] == 1
    assert result["resolved_count"] == 2
    assert all(item["status"] == "resolved" for item in result["items"])

    memo_doc = db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (memo_item["wiki_doc_id"],)
    )
    assert memo_doc["work_area_slug"] == "예산"
    assert memo_doc["doc_role"] == "reference"
    assert memo_doc["tag_confidence"] == "high"
    assert memo_doc["tag_locked"] == 1
    chart_doc = db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (chart_item["wiki_doc_id"],)
    )
    assert chart_doc["work_area_slug"] == "성과평가"
    assert chart_doc["tag_locked"] == 1
    assert manager.list_queue(source_id=source_id) == []

    # 해소 결과가 허브에 1회 재작성으로 반영된다.
    hub_text = (tmp_path / "knowledge-wiki" / "work-areas" / "예산.md").read_text(
        encoding="utf-8"
    )
    assert "메모" in hub_text

    # E13: 일괄 확정(locked) 문서는 apply 재실행에서도 보존된다(재판정·큐 재적재 제외).
    applied = client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})
    assert applied.status_code == 201
    report = applied.json()["work_job"]["result"]
    assert report["locked_count"] == 2
    memo_after = db.fetch_one(
        "SELECT * FROM knowledge_wiki_docs WHERE id = ?", (memo_item["wiki_doc_id"],)
    )
    assert memo_after["tag_locked"] == 1
    assert memo_after["work_area_slug"] == "예산"
    assert memo_after["tag_confidence"] == "high"
    assert manager.list_queue(source_id=source_id) == []


def test_bulk_resolve_endpoint_contract(tmp_path: Path) -> None:
    """WI-2: POST /api/knowledge/taxonomy/queue/bulk-resolve — 200 계약 + 유령 slug 400."""
    source = _make_work_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)
    _confirm_taxonomy(client, source_id)
    client.post("/api/knowledge/taxonomy/apply", json={"source_id": source_id})

    queue = client.get(f"/api/knowledge/taxonomy/queue?source_id={source_id}").json()["items"]
    assert len(queue) == 2

    response = client.post(
        "/api/knowledge/taxonomy/queue/bulk-resolve",
        json={"items": [{"id": queue[0]["id"], "work_area_slug": "예산"}]},
    )
    assert response.status_code == 200
    assert response.json()["resolved_count"] == 1
    assert len(client.get(f"/api/knowledge/taxonomy/queue?source_id={source_id}").json()["items"]) == 1

    ghost = client.post(
        "/api/knowledge/taxonomy/queue/bulk-resolve",
        json={"items": [{"id": queue[1]["id"], "work_area_slug": "유령업무"}]},
    )
    assert ghost.status_code == 400
