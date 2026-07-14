"""WI-3(2026-07-14): 대화→문서작성 연속성 — 주제 도출·근거 게이트 회귀 테스트.

1호 스코어카드 L-01 FAIL: "방금 내용을 1페이지 보고서로" 지시문 원문이 위키
검색어로 쓰여 무관 문서('AX포털 개선계획')가 주제로 승격됐다.
"""

from pathlib import Path

from gongmu_sidecar.app import create_app
from test_work_session_turn import authoring_aware_reply


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _services(client):
    return client.app.state.services


def _add_user_message(client, session_id: str, text: str) -> None:
    response = client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "user", "text": text},
    )
    assert response.status_code == 201


def test_topic_derived_from_previous_user_message_for_context_reference(tmp_path: Path) -> None:
    """L-01 시퀀스: '방금 내용을…' 지시는 직전 실질 user 메시지를 주제로 삼는다."""
    client = _client(tmp_path)
    session_id = client.post("/api/work-sessions", json={"title": "L-01"}).json()["id"]
    _add_user_message(client, session_id, "공공기관 안전관리등급 기준이 뭐야?")
    _add_user_message(client, session_id, "방금 내용을 1페이지 보고서로 작성해줘")

    topic_query, topic_sentence = _services(client)._derive_document_topic(
        session_id=session_id, text="방금 내용을 1페이지 보고서로 작성해줘"
    )

    assert "안전관리등급" in topic_query
    for meta in ("보고서", "페이지", "방금", "내용"):
        assert meta not in topic_query
    assert topic_sentence == "공공기관 안전관리등급 기준이 뭐야?"


def test_topic_skips_document_create_history_messages(tmp_path: Path) -> None:
    """E2E-12: 3턴째 '같은 내용으로 이메일도'는 T2(문서 지시)를 건너뛰고 T1에 도달한다."""
    client = _client(tmp_path)
    session_id = client.post("/api/work-sessions", json={"title": "E2E-12"}).json()["id"]
    _add_user_message(client, session_id, "AI업무추진계획 주요 과제 알려줘")
    _add_user_message(client, session_id, "방금 내용을 1페이지 보고서로 작성해줘")
    _add_user_message(client, session_id, "같은 내용으로 이메일도 작성해줘")

    topic_query, topic_sentence = _services(client)._derive_document_topic(
        session_id=session_id, text="같은 내용으로 이메일도 작성해줘"
    )

    assert "ai업무추진계획" in topic_query.lower() or "추진계획" in topic_query
    assert topic_sentence == "AI업무추진계획 주요 과제 알려줘"


def test_explicit_topic_in_instruction_wins_over_history(tmp_path: Path) -> None:
    """E2E-11: 지시문에 명시 주제가 있으면 직전 대화보다 지시문이 이긴다."""
    client = _client(tmp_path)
    session_id = client.post("/api/work-sessions", json={"title": "E2E-11"}).json()["id"]
    _add_user_message(client, session_id, "코레일유통 경영전략 알려줘")

    topic_query, topic_sentence = _services(client)._derive_document_topic(
        session_id=session_id, text="안전보건경영시스템 목표관리에 대해 1페이지 보고서 작성해줘"
    )

    assert "안전보건경영시스템" in topic_query
    assert "코레일유통" not in topic_query
    assert topic_sentence == ""  # 명시 주제 — 대화 주입 블록 불필요


def test_irrelevant_wiki_hits_are_gated_out_of_document_references(tmp_path: Path, monkeypatch) -> None:
    """주제-근거 게이트: 주제어가 없는 위키 히트는 인용/참고자료로 쓰이지 않는다."""
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", authoring_aware_reply)

    client = _client(tmp_path)
    services = _services(client)
    session_id = client.post("/api/work-sessions", json={"title": "게이트"}).json()["id"]
    _add_user_message(client, session_id, "공공기관 안전관리등급 기준이 뭐야?")

    def fake_retrieve(*, query: str, session_id: str, limit: int = 4):
        return {
            "items": [
                {
                    "title": "AX포털 개선계획",
                    "text": "AX포털 개선 과제와 로드맵을 정리한 문서입니다.",
                    "file_path": "C:/fake/ax-portal.md",
                }
            ]
        }

    monkeypatch.setattr(services.wiki, "retrieve", fake_retrieve)

    result = services._run_document_create_skill(
        session_id=session_id,
        session=client.get("/api/work-sessions").json()["items"][0],
        text="방금 내용을 1페이지 보고서로 작성해줘",
    )

    assert "AX포털" not in result["text"]
    assert "지식폴더 근거: 없음" in result["text"]
    assert "직전 대화 주제와 일치하는 근거 없음" in result["text"]


def test_matching_wiki_hit_passes_gate(tmp_path: Path, monkeypatch) -> None:
    """네거티브 컨트롤: 주제어가 포함된 히트는 게이트를 통과해 인용된다."""
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", authoring_aware_reply)

    client = _client(tmp_path)
    services = _services(client)
    session_id = client.post("/api/work-sessions", json={"title": "게이트통과"}).json()["id"]
    _add_user_message(client, session_id, "공공기관 안전관리등급 기준이 뭐야?")

    def fake_retrieve(*, query: str, session_id: str, limit: int = 4):
        return {
            "items": [
                {
                    "title": "공공기관 안전관리등급제 운영에 관한 지침",
                    "text": "안전관리등급은 공공안전지수를 기준으로 심사한다.",
                    "file_path": "C:/fake/safety-grade.hwp",
                }
            ]
        }

    monkeypatch.setattr(services.wiki, "retrieve", fake_retrieve)

    result = services._run_document_create_skill(
        session_id=session_id,
        session=client.get("/api/work-sessions").json()["items"][0],
        text="방금 내용을 1페이지 보고서로 작성해줘",
    )

    assert "지식폴더 근거: 공공기관 안전관리등급제 운영에 관한 지침" in result["text"]
