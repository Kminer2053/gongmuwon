"""Wave D — 위키 백과사전화 계약 테스트 (F-08 정규화/슬러그, F-09 종합, F-02 제목, F-11 체이닝).

설계 원천: docs/design/2026-07-11-wiki-encyclopedia-redesign.md
LLM은 전부 스텁 — 실LLM 검증은 별도 수동 절차(사양서 §수용 기준)로 수행한다.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from gongmu_sidecar.app import create_app
from gongmu_sidecar.knowledge_wiki import (
    is_low_quality_title,
    normalize_topic_key,
    resolve_document_title,
    topic_slugify,
)
from gongmu_sidecar.llm import LLMGenerationResult
from gongmu_sidecar.topic_synthesis import (
    build_synthesis_messages,
    render_topic_synthesis_lines,
    synthesize_topic,
)


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


def _make_budget_source(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    (source / "예산편성지침.md").write_text(
        "# 예산 편성 지침\n\n2026년도 예산 편성 기준과 절차를 규정합니다.", encoding="utf-8"
    )
    (source / "예산심의결과.md").write_text(
        "# 예산 심의 결과\n\n2026-01-13 예산 심의 회의 결과를 정리합니다.", encoding="utf-8"
    )
    return source


SYNTHESIS_PAYLOAD = {
    "definition": "예산 편성은 연간 예산을 계획·확정하는 업무이다.",
    "overview": "예산 편성은 부서 예산 요구를 취합해 연간 계획을 확정하는 업무다. 지침과 심의 결과 문서가 절차와 결정을 담고 있다.",
    "key_points": [
        {
            "subtopic": "편성 절차",
            "narrative": "요구 취합 후 심의를 거쳐 확정한다.",
            "evidence": [1, 2],
        }
    ],
    "timeline": [{"date": "2026-01-13", "event": "예산 심의 회의", "evidence": [2]}],
    "doc_points": [{"title": "예산 편성 지침", "point": "편성 기준을 규정한다.", "evidence": [1]}],
    "related_topics": ["성과평가"],
}


def _dispatching_llm(*, topics: list[str] | None = None, synthesis: dict | None = None):
    """문서 요약 호출과 주제 종합 호출을 구분해 응답하는 스텁."""
    calls: list[str] = []

    def llm(messages):
        system_text = str(messages[0]["text"])
        if "백과사전" in system_text:
            calls.append("synthesis")
            if synthesis is None:
                return "말도 안 되는 출력"
            return json.dumps(synthesis, ensure_ascii=False)
        calls.append("enrich")
        return json.dumps(
            {
                "summary": "예산 관련 문서 요약입니다. 절차 설명입니다. 결과 정리입니다.",
                "topics": topics or ["예산 편성"],
            },
            ensure_ascii=False,
        )

    llm.calls = calls  # type: ignore[attr-defined]
    return llm


# ---------------------------------------------------------------------------
# F-08 주제 슬러그 버그 수정 + 정규화 키
# ---------------------------------------------------------------------------


def test_topic_slugify_does_not_duplicate_name_or_leave_trailing_space() -> None:
    slug = topic_slugify("공공부문 AI 도입")
    assert slug == "공공부문-ai-도입"
    # 회귀: 기존 wiki_slugify(topic, topic)는 '공공부문-ai-도입-공공부문 AI ' 형태를 만들었다.
    assert " " not in slug
    assert not slug.endswith("-")
    assert "공공부문 AI" not in slug


def test_topic_slugify_falls_back_to_digest_for_symbol_only_topics() -> None:
    slug = topic_slugify("###")
    assert slug.startswith("topic-")
    assert " " not in slug
    assert slug == topic_slugify("###"), "결정적이어야 한다"


def test_normalize_topic_key_merges_spacing_case_and_josa_variants() -> None:
    assert normalize_topic_key("예산 편성") == normalize_topic_key("예산편성")
    assert normalize_topic_key("예산편성의") == normalize_topic_key("예산편성")
    assert normalize_topic_key("AI 교육") == normalize_topic_key("ai교육")
    assert normalize_topic_key("  성과  평가  ") == normalize_topic_key("성과평가")


# ---------------------------------------------------------------------------
# F-02 저품질 본문유래 제목 → 파일명(stem) 폴백
# ---------------------------------------------------------------------------


def test_low_quality_title_detection() -> None:
    assert is_low_quality_title("1.")
    assert is_low_quality_title("개요")  # ≤3자
    assert is_low_quality_title("2026-01-13")
    assert is_low_quality_title("2026년 1월 13일")
    assert is_low_quality_title("Part 3")
    assert is_low_quality_title("---===---")
    assert not is_low_quality_title("성과평가 결과보고")
    assert not is_low_quality_title("2026년도 예산 편성 지침")


def test_resolve_document_title_prefers_filename_for_low_quality_body_title() -> None:
    assert (
        resolve_document_title("1.", "폴더/2026년도 성과평가 추진계획.md")
        == "2026년도 성과평가 추진계획"
    )
    assert resolve_document_title("", "폴더/회의자료.md") == "회의자료"
    assert (
        resolve_document_title("성과평가 결과보고", "폴더/temp1234.md") == "성과평가 결과보고"
    )


def test_ingest_uses_filename_when_body_title_is_low_quality(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "2026년도 성과평가 추진계획.md").write_text(
        "# 1.\n\n올해 성과평가 추진 방향을 설명합니다.", encoding="utf-8"
    )
    client = _client(tmp_path)
    _register_scan_ingest(client, source)

    docs = client.app.state.services.db.fetch_all("SELECT title, slug FROM knowledge_wiki_docs")
    assert docs[0]["title"] == "2026년도 성과평가 추진계획"
    assert "2026년도-성과평가-추진계획" in docs[0]["slug"]


# ---------------------------------------------------------------------------
# F-08 보강 시 주제 재사용·저장 전 병합
# ---------------------------------------------------------------------------


def test_enrich_normalizes_topic_variants_into_one_topic(tmp_path: Path) -> None:
    source = _make_budget_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    wiki = client.app.state.services.wiki

    variants = iter([["예산 편성"], ["예산편성의"]])

    def llm(messages):
        system_text = str(messages[0]["text"])
        if "백과사전" in system_text:
            return None
        return json.dumps(
            {"summary": "요약. 요약. 요약.", "topics": next(variants, ["예산 편성"])},
            ensure_ascii=False,
        )

    result = wiki.enrich(llm=llm)

    assert result["enriched_count"] == 2
    topics = {
        topic
        for doc in client.app.state.services.db.fetch_all("SELECT topics_json FROM knowledge_wiki_docs")
        for topic in json.loads(doc["topics_json"])
    }
    assert topics == {"예산 편성"}, "정규화 키가 같은 변형 표기는 기존 표기로 병합되어야 한다"
    topic_pages = list((tmp_path / "knowledge-wiki" / "topics").glob("*.md"))
    assert [page.name for page in topic_pages] == ["예산-편성.md"]


def test_enrich_prompt_offers_existing_topics_for_reuse(tmp_path: Path) -> None:
    source = _make_budget_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    services = client.app.state.services
    wiki = services.wiki

    wiki.enrich(llm=_dispatching_llm())

    # 두 번째 실행: 문서 하나를 재보강 대상으로 되돌리고 프롬프트를 캡처한다.
    doc = services.db.fetch_all("SELECT id FROM knowledge_wiki_docs")[0]
    services.db.execute(
        "UPDATE knowledge_wiki_docs SET enriched = 0, summary_stale = 1 WHERE id = ?",
        (doc["id"],),
    )
    captured: list[str] = []

    def capturing_llm(messages):
        system_text = str(messages[0]["text"])
        if "백과사전" not in system_text:
            captured.append(system_text)
        return json.dumps({"summary": "요약. 요약. 요약.", "topics": ["예산 편성"]}, ensure_ascii=False)

    wiki.enrich(llm=capturing_llm)

    assert captured, "보강 프롬프트가 호출되어야 한다"
    assert "기존 주제 목록" in captured[0]
    assert "예산 편성" in captured[0]


# ---------------------------------------------------------------------------
# F-09 백과사전 종합 — 골격 렌더·실패 폴백·싱글턴 생략·증분 dirty
# ---------------------------------------------------------------------------


def test_enrich_synthesizes_encyclopedia_skeleton_for_multi_doc_topic(tmp_path: Path) -> None:
    source = _make_budget_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    services = client.app.state.services
    wiki = services.wiki

    result = wiki.enrich(llm=_dispatching_llm(synthesis=SYNTHESIS_PAYLOAD))

    assert result["status"] == "completed"
    assert result["synthesized_count"] == 1
    page_path = tmp_path / "knowledge-wiki" / "topics" / "예산-편성.md"
    text = page_path.read_text(encoding="utf-8")
    assert "synthesized: true" in text
    assert "synthesized_at:" in text
    assert "> 예산 편성은 연간 예산을 계획·확정하는 업무이다." in text
    assert "## 개요" in text
    assert "## 핵심 내용" in text
    assert "### 편성 절차" in text
    assert "[1][2]" in text, "핵심 내용 서술에 근거 번호 각주가 붙어야 한다"
    assert "## 경과" in text
    assert "2026-01-13 — 예산 심의 회의 [2]" in text
    assert "## 문서별 요점" in text
    assert "**예산 편성 지침** — 편성 기준을 규정한다. [1]" in text
    assert "## 연관 주제" in text
    assert "[[성과평가]]" in text
    assert "## 근거 문서" in text
    assert "[1] [" in text and "](../docs/" in text
    assert "## 관련 문서" in text, "종합본이 있어도 문서 카드 링크 목록은 유지된다"
    row = services.db.fetch_one("SELECT * FROM topic_synthesis WHERE topic_key = ?", ("예산편성",))
    assert row is not None and row["dirty"] == 0


def test_synthesis_failure_keeps_link_list_and_dirty_for_retry(tmp_path: Path) -> None:
    source = _make_budget_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    services = client.app.state.services
    wiki = services.wiki

    result = wiki.enrich(llm=_dispatching_llm(synthesis=None))

    assert result["status"] == "completed", "종합 실패는 잡 실패로 승격되면 안 된다"
    assert result["synthesized_count"] == 0
    assert result["synthesis_failed_count"] == 1
    text = (tmp_path / "knowledge-wiki" / "topics" / "예산-편성.md").read_text(encoding="utf-8")
    assert "synthesized: false" in text
    assert "## 관련 문서" in text
    assert "## 개요" not in text
    row = services.db.fetch_one("SELECT * FROM topic_synthesis WHERE topic_key = ?", ("예산편성",))
    assert row is not None and row["dirty"] == 1, "실패 주제는 다음 보강에서 재시도해야 한다"


def test_singleton_topic_skips_synthesis_quietly(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "단일문서.md").write_text("# 단일 문서\n\n혼자 있는 문서입니다.", encoding="utf-8")
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    services = client.app.state.services

    synthesis_calls: list[int] = []

    def llm(messages):
        if "백과사전" in str(messages[0]["text"]):
            synthesis_calls.append(1)
            return json.dumps(SYNTHESIS_PAYLOAD, ensure_ascii=False)
        return json.dumps({"summary": "요약. 요약. 요약.", "topics": ["단일주제"]}, ensure_ascii=False)

    result = services.wiki.enrich(llm=llm)

    assert not synthesis_calls, "문서 1건 주제는 LLM 종합을 호출하지 않아야 한다"
    assert result["synthesized_count"] == 0
    row = services.db.fetch_one("SELECT * FROM topic_synthesis WHERE topic_key = ?", ("단일주제",))
    assert row is not None and row["dirty"] == 0 and row["payload_json"] == ""
    text = (tmp_path / "knowledge-wiki" / "topics" / "단일주제.md").read_text(encoding="utf-8")
    assert "## 관련 문서" in text


def test_content_change_marks_topic_dirty_for_incremental_resynthesis(tmp_path: Path) -> None:
    source = _make_budget_source(tmp_path)
    client = _client(tmp_path)
    source_id = _register_scan_ingest(client, source)
    services = client.app.state.services

    services.wiki.enrich(llm=_dispatching_llm(synthesis=SYNTHESIS_PAYLOAD))
    row = services.db.fetch_one("SELECT dirty FROM topic_synthesis WHERE topic_key = ?", ("예산편성",))
    assert row is not None and row["dirty"] == 0

    # 문서 내용 변경 → 재스캔·재색인 시 소속 주제가 dirty로 마킹되어야 한다.
    (source / "예산편성지침.md").write_text(
        "# 예산 편성 지침\n\n개정된 예산 편성 기준입니다.", encoding="utf-8"
    )
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert (
        client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": True}).status_code
        == 201
    )

    row = services.db.fetch_one("SELECT dirty FROM topic_synthesis WHERE topic_key = ?", ("예산편성",))
    assert row is not None and row["dirty"] == 1


def test_render_topic_synthesis_drops_invalid_evidence_numbers() -> None:
    sources = [
        {"index": 1, "title": "지침", "slug": "지침-slug", "date": "2026-01-01", "source_name": "지침.md"},
        {"index": 2, "title": "결과", "slug": "결과-slug", "date": "", "source_name": "결과.md"},
    ]
    synthesis = {
        "definition": "",
        "overview": "개요 문장이다. 추가 문장이다.",
        "key_points": [{"subtopic": "소주제", "narrative": "서술", "evidence": [1, 9, "x"]}],
        "timeline": [],
        "doc_points": [],
        "related_topics": [],
    }
    lines = render_topic_synthesis_lines(synthesis, sources)
    text = "\n".join(lines)
    assert "> 개요 문장이다." in text, "정의 부재 시 개요 첫 문장이 한 줄 정의가 된다"
    assert "서술 [1]" in text, "유효하지 않은 근거 번호는 각주에서 걸러야 한다"
    assert "[9]" not in text
    assert "[1] [지침](../docs/지침-slug.md) · 지침.md" in text


def test_build_synthesis_messages_respects_input_budget() -> None:
    sources = [
        {
            "index": index,
            "title": f"문서{index}",
            "slug": f"doc-{index}",
            "date": "2026-01-01",
            "source_name": f"문서{index}.md",
            "excerpt": "가" * 500,
        }
        for index in range(1, 11)
    ]
    messages = build_synthesis_messages("예산", sources)
    system_text = messages[0]["text"]
    assert "[8] 문서8" in system_text, "최대 8건까지 포함한다"
    assert "[9]" not in system_text
    assert system_text.count("가") <= 2500, "발췌 총량은 2.5k자 예산 내로 절단되어야 한다"


def test_synthesize_topic_repairs_once_then_gives_up() -> None:
    responses = iter(["이건 JSON이 아님", json.dumps(SYNTHESIS_PAYLOAD, ensure_ascii=False)])
    call_count = {"count": 0}

    def llm(messages):
        call_count["count"] += 1
        return next(responses)

    sources = [
        {"index": 1, "title": "지침", "slug": "s1", "date": "", "source_name": "a.md", "excerpt": "본문"},
        {"index": 2, "title": "결과", "slug": "s2", "date": "", "source_name": "b.md", "excerpt": "본문"},
    ]
    payload = synthesize_topic(topic="예산", sources=sources, llm=llm)
    assert payload is not None and payload["overview"].startswith("예산 편성은")
    assert call_count["count"] == 2, "검증 실패 시 정확히 1회 repair 후 성공해야 한다"

    def always_bad(messages):
        return "JSON 없음"

    assert synthesize_topic(topic="예산", sources=sources, llm=always_bad) is None


# ---------------------------------------------------------------------------
# F-11 자동 연속 보강 체이닝 + 커버리지
# ---------------------------------------------------------------------------


def test_enrich_job_chains_next_batch_until_remaining_zero(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "source"
    source.mkdir()
    for index in range(3):
        (source / f"문서-{index}.md").write_text(
            f"# 문서 {index}\n\n본문 {index}입니다.", encoding="utf-8"
        )
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    services = client.app.state.services

    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(
            text=json.dumps(
                {"summary": "요약. 요약. 요약.", "topics": ["예산"]}, ensure_ascii=False
            ),
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    response = client.post("/api/knowledge/enrich", json={"background": False, "limit": 2})

    assert response.status_code == 201
    first_job = response.json()["work_job"]
    assert first_job["status"] == "succeeded"
    assert first_job["result"]["remaining_count"] == 1
    chained_id = first_job["result"].get("chained_work_job_id")
    assert chained_id, "이월분이 남으면 다음 배치 잡이 자동 체이닝되어야 한다"

    deadline = time.time() + 10
    chained = services.jobs.get_job(chained_id)
    while chained and chained["status"] not in {"succeeded", "failed", "canceled", "partial"}:
        if time.time() > deadline:
            raise AssertionError(f"chained job did not finish: {chained['status']}")
        time.sleep(0.05)
        chained = services.jobs.get_job(chained_id)
    assert chained is not None
    assert chained["kind"] == "knowledge.enrich"
    assert chained["status"] == "succeeded"
    assert chained["result"]["remaining_count"] == 0
    assert "chained_work_job_id" not in chained["result"], "이월분 소진 시 체이닝이 멈춰야 한다"
    assert chained["input"]["chained_from"] == first_job["id"]


def test_backend_status_reports_enrichment_coverage(tmp_path: Path) -> None:
    source = _make_budget_source(tmp_path)
    client = _client(tmp_path)
    _register_scan_ingest(client, source)
    services = client.app.state.services

    before = client.get("/api/knowledge/backend-status").json()["llm_enrichment"]
    assert before["total_count"] == 2
    assert before["enriched_count"] == 0
    assert before["pending_count"] == 2

    services.wiki.enrich(llm=_dispatching_llm())

    after = client.get("/api/knowledge/backend-status").json()["llm_enrichment"]
    assert after["total_count"] == 2
    assert after["enriched_count"] == 2
    assert after["pending_count"] == 0
