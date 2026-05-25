from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_work_session_routing_preview_scores_diverse_chat_utterances(tmp_path: Path) -> None:
    client = _client(tmp_path)
    cases = [
        ("내일 오후 2시에 AI 점검 회의 일정 등록해줘", ["schedule.create"], "tool"),
        ("오늘 16시에 부서 검토 미팅 캘린더에 넣어줘", ["schedule.create"], "tool"),
        ("오늘 일정 보여줘", ["schedule.list"], "tool"),
        ("AI 점검 회의 일정 삭제해줘", ["schedule.delete"], "tool"),
        ("지식폴더에서 AI 추진 방향 근거 찾아줘", ["knowledge.search"], "tool"),
        ("GraphRAG로 예산 관련 출처 보여줘", ["knowledge.search"], "tool"),
        ("이 세션 내용으로 1페이지 보고서 hwpx 만들어줘", ["documents.generate"], "tool"),
        ("회의 결과를 이메일 문안으로 정리해줘", ["documents.generate"], "tool"),
        ("파일찾기 사용법 알려줘", ["help.guide"], "tool"),
        (
            "내일 오후 2시 회의 일정 등록하고 지식폴더에서 AI 자료 찾아줘",
            ["intent.plan", "schedule.create", "knowledge.search"],
            "multi_intent",
        ),
        (
            "AI 자료 근거 찾아서 1페이지 보고서로 만들어줘",
            ["intent.plan", "knowledge.search", "documents.generate"],
            "multi_intent",
        ),
        ("오늘은 가볍게 안부부터 이야기하자", [], "llm.chat"),
    ]

    passed = 0
    for text, expected_actions, expected_route in cases:
        response = client.post("/api/work-sessions/routing-preview", json={"text": text})
        assert response.status_code == 200
        payload = response.json()
        assert payload["route"] == expected_route
        assert all(action in payload["actions"] for action in expected_actions), text
        if expected_route == "llm.chat":
            assert payload["actions"] == []
        passed += 1

    assert passed / len(cases) >= 0.95
