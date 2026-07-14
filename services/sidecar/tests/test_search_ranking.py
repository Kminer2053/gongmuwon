"""3호 라운드 — ask/search 검색 랭킹·발췌 개선 계약 테스트.

2호 스코어카드(2026-07-14 G4 CONDITIONAL)에서 확정된 근본원인 3가지의 반전 검증:
1. 조사 오염: 조사 붙은 텀("출장여비에는")이 FTS에 그대로 들어가 원문("출장여비는")과
   불일치 → 정답 문서 미회수. 무관 문서가 FTS에 1건이라도 걸리면 사다리가 거기서
   끝나 LIKE(제목가중)가 실행되지 않음.
2. 2자 핵심명사 소실: 인사·규정·전보 등 2자 행정명사가 FTS ≥3자 필터에서 탈락.
3. 발췌 빈곤: FTS snippet 24토큰으로는 정답 조문이 ask LLM에 전달되지 않음.

수정 전 (a)(b)(c) 계열은 FAIL, 수정 후 전건 PASS가 이 파일의 존재 이유다.
"""

from __future__ import annotations

from pathlib import Path

from gongmu_sidecar.app import create_app
from gongmu_sidecar.knowledge_wiki import _query_terms


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _register_scan_ingest(client, source: Path, label: str = "규정자료") -> str:
    created = client.post("/api/knowledge/sources", json={"label": label, "root_path": str(source)})
    assert created.status_code == 201
    source_id = created.json()["id"]
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert (
        client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code
        == 201
    )
    return source_id


def _make_travel_expense_source(tmp_path: Path) -> Path:
    """조사 오염 재현 픽스처 — 원문은 '출장여비는'(질의는 '출장여비에는').

    distractor에는 '항목이'를 literal로 넣는다: 수정 전 FTS OR("출장여비에", "항목이")가
    distractor만 회수해 정답 문서가 결과에서 완전히 빠지는 실DB 재현(B-04)과 동형.
    """
    source = tmp_path / "source"
    source.mkdir()
    (source / "여비지급 세칙.md").write_text(
        "# 여비지급 세칙\n\n"
        "## 제5조(여비의 종류)\n\n"
        "출장여비는 다음 각 호의 항목으로 구성한다.\n\n"
        "1. 교통비\n2. 일비\n3. 숙박비\n4. 식비\n\n"
        "## 제6조(여비의 지급)\n\n"
        "여비는 실제 행한 경로에 따라 지급한다.\n",
        encoding="utf-8",
    )
    (source / "감사점검표.md").write_text(
        "# 감사점검표\n\n점검 항목이 빠짐없이 준비되었는지 확인한다.\n",
        encoding="utf-8",
    )
    return source


def _make_regulation_source(tmp_path: Path) -> Path:
    """2자 핵심명사 재현 픽스처 — 다수의 타 '규정' 문서 사이에서 '인사 규정'을 찾아야 한다.

    distractor 본문의 '이 규정에서'는 수정 전 FTS 텀 '규정에서'(조사 오염)가
    distractor만 회수하는 실DB 재현(B-01: 위임전결/회계/예산 규정이 상위)과 동형.
    """
    source = tmp_path / "source"
    source.mkdir()
    (source / "인사 규정.md").write_text(
        "# 인사 규정\n\n"
        "## 제5조(정의)\n\n"
        '1. "전보"라 함은 동일 직급 내 수평적 보직변경을 말한다.\n'
        '2. "전직"이라 함은 직종을 달리하는 임용을 말한다.\n',
        encoding="utf-8",
    )
    (source / "회계 규정.md").write_text(
        "# 회계 규정\n\n회계 처리 기준을 정한다. 이 규정에서 정하지 아니한 사항은 별도 지침을 따른다.\n",
        encoding="utf-8",
    )
    (source / "감사 규정.md").write_text(
        "# 감사 규정\n\n감사 실시 원칙을 정한다. 이 규정에서 정하지 아니한 사항은 별도 지침을 따른다.\n",
        encoding="utf-8",
    )
    (source / "보안 규정.md").write_text(
        "# 보안 규정\n\n보안 관리 원칙을 정한다. 이 규정에서 정하지 아니한 사항은 별도 지침을 따른다.\n",
        encoding="utf-8",
    )
    return source


# ---------------------------------------------------------------- (a) 조사 질의


def test_josa_query_recovers_original_body_doc_as_top1(tmp_path: Path) -> None:
    """(a) '출장여비에는 …' 질의가 원문 '출장여비는 …' 문서를 top-1으로 회수한다."""
    source = _make_travel_expense_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    response = client.get("/api/knowledge/search", params={"query": "출장여비에는 어떤 항목이 포함돼?"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"], "조사 질의가 정답 문서를 회수해야 한다"
    assert payload["items"][0]["title"] == "여비지급 세칙"
    assert payload["items"][0]["source_path"].endswith("여비지급 세칙.md")


def test_josa_query_snippet_carries_answer_keywords(tmp_path: Path) -> None:
    """(c) top-1 snippet에 정답 문장 키워드(여비 항목)가 실려 ask LLM 근거로 쓸 수 있어야 한다."""
    source = _make_travel_expense_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    payload = client.get(
        "/api/knowledge/search", params={"query": "출장여비에는 어떤 항목이 포함돼?"}
    ).json()

    assert payload["items"]
    top = payload["items"][0]
    assert top["title"] == "여비지급 세칙"
    hits = [kw for kw in ("교통비", "일비", "숙박비", "식비") if kw in top["snippet"]]
    assert len(hits) >= 2, f"발췌에 여비 항목이 실려야 한다: {top['snippet']!r}"


# ------------------------------------------------------------ (b) 2자 핵심명사


def test_two_char_noun_query_ranks_title_match_top1(tmp_path: Path) -> None:
    """(b) 2자 명사(인사·규정·전보)만 남는 질의가 제목 '인사 규정' 문서를 top-1으로 올린다."""
    source = _make_regulation_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    response = client.get("/api/knowledge/search", params={"query": "인사 규정에서 전보가 뭐야?"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"], "2자 명사 질의가 문서를 회수해야 한다"
    assert payload["items"][0]["title"] == "인사 규정"


def test_two_char_noun_query_snippet_contains_definition(tmp_path: Path) -> None:
    """(c) 정의 조문('수평적 보직변경')이 top-1 발췌에 포함되어야 한다."""
    source = _make_regulation_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    payload = client.get(
        "/api/knowledge/search", params={"query": "인사 규정에서 전보가 뭐야?"}
    ).json()

    assert payload["items"]
    top = payload["items"][0]
    assert top["title"] == "인사 규정"
    assert any(kw in top["snippet"] for kw in ("수평적", "보직변경")), (
        f"발췌에 전보 정의가 실려야 한다: {top['snippet']!r}"
    )


# ------------------------------------------------- (d) 네거티브 컨트롤(기존 유지)


def test_multi_term_precision_query_keeps_exact_doc_top1(tmp_path: Path) -> None:
    """네거티브 컨트롤: '공공안전지수 산출' 같은 다텀 정밀 질의 유형이 유지된다 (F-01)."""
    source = tmp_path / "source"
    source.mkdir()
    (source / "안전관리지침.md").write_text(
        "# 안전관리등급 지침\n\n공공안전지수를 산출하여 안전관리등급을 결정한다.\n",
        encoding="utf-8",
    )
    (source / "일반현황.md").write_text(
        "# 공공기관 일반현황\n\n공공기관 경영 정보를 정리한다.\n",
        encoding="utf-8",
    )
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    payload = client.get("/api/knowledge/search", params={"query": "공공안전지수 산출"}).json()

    assert payload["mode"] == "fts5"
    assert payload["items"]
    assert payload["items"][0]["title"] == "안전관리등급 지침"


def test_keyword_query_mode_contract_is_preserved(tmp_path: Path) -> None:
    """네거티브 컨트롤: 키워드 질의의 mode 계약(fts5) — 소비자(UI·QA 스크립트) 호환."""
    source = _make_travel_expense_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    payload = client.get("/api/knowledge/search", params={"query": "출장여비"}).json()

    assert payload["mode"] == "fts5"
    assert payload["items"][0]["title"] == "여비지급 세칙"
    # item 스키마 불변(소비자 계약)
    item = payload["items"][0]
    for key in ("doc_id", "document_id", "doc_uid", "title", "source_path", "snippet", "score", "card_path", "slug"):
        assert key in item


def test_query_terms_additive_josa_variants() -> None:
    """(A) 텀 정규화: 조사 스트립 변형은 additive — 원형 유지 + 어근 변형 추가."""
    terms = _query_terms("출장여비에는 어떤 항목이 포함돼?")
    assert "출장여비" in terms, "조사 '에는' 스트립 변형이 추가되어야 한다"
    assert "출장여비에는" in terms, "원형은 유지되어야 한다(additive)"
    assert "항목" in terms, "'이' 스트립 변형이 추가되어야 한다"

    terms = _query_terms("물품이나 용역을 구매하려면 어떤 절차를 거쳐야 해?")
    assert "물품" in terms, "조사 '이나' 스트립 변형이 추가되어야 한다"
    assert "용역" in terms
    assert "절차" in terms
    assert "구매하려면" in terms, "동사 활용 스테밍은 범위 외 — 원형 유지"
    assert all(len(term) >= 2 for term in terms)


def test_search_snippet_respects_max_chars(tmp_path: Path) -> None:
    """발췌 확장 후에도 snippet 상한(SNIPPET_MAX_CHARS=500)은 유지된다."""
    source = tmp_path / "source"
    source.mkdir()
    filler = "출장여비 지급 원칙과 정산 절차를 상세히 설명하는 문장이다. " * 60
    (source / "장문세칙.md").write_text(f"# 장문 세칙\n\n{filler}", encoding="utf-8")
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    payload = client.get("/api/knowledge/search", params={"query": "출장여비에는 어떤 항목이 포함돼?"}).json()

    assert payload["items"]
    assert len(payload["items"][0]["snippet"]) <= 500
