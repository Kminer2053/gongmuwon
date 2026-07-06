"""F-20 일정 알림 테스트: due 계산 경계, ack 흐름, 알림 미설정 일정 제외."""

from datetime import datetime, timedelta
from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _iso_in(minutes: float) -> str:
    return (datetime.now().astimezone() + timedelta(minutes=minutes)).isoformat()


def _create_schedule(client, *, title: str, starts_in_minutes: float, remind_before_minutes=None):
    payload = {
        "title": title,
        "starts_at": _iso_in(starts_in_minutes),
        "ends_at": _iso_in(starts_in_minutes + 60),
        "view": "day",
    }
    if remind_before_minutes is not None:
        payload["remind_before_minutes"] = remind_before_minutes
    response = client.post("/api/schedules", json=payload)
    assert response.status_code == 201
    return response.json()


def test_schedule_create_accepts_and_returns_remind_before_minutes(tmp_path: Path) -> None:
    client = _client(tmp_path)
    created = _create_schedule(client, title="알림 일정", starts_in_minutes=120, remind_before_minutes=30)
    assert created["remind_before_minutes"] == 30
    assert created["reminder_acknowledged_at"] is None

    listed = client.get("/api/schedules").json()["items"]
    assert listed[0]["remind_before_minutes"] == 30

    no_remind = _create_schedule(client, title="알림 없는 일정", starts_in_minutes=120)
    assert no_remind["remind_before_minutes"] is None


def test_due_reminders_window_boundaries(tmp_path: Path) -> None:
    client = _client(tmp_path)
    # 알림 창 안: 10분 뒤 시작, 30분 전 알림 → 지금이 창 안
    inside = _create_schedule(client, title="곧 시작", starts_in_minutes=10, remind_before_minutes=30)
    # 알림 창 밖(아직): 2시간 뒤 시작, 30분 전 알림
    not_yet = _create_schedule(client, title="아직 멀었음", starts_in_minutes=120, remind_before_minutes=30)
    # 이미 시작함(now >= starts_at): 알림 대상 아님
    already_started = _create_schedule(client, title="이미 시작", starts_in_minutes=-5, remind_before_minutes=30)
    # 알림 미설정: 창 안이라도 제외
    no_remind = _create_schedule(client, title="알림 미설정", starts_in_minutes=10)

    due = client.get("/api/schedules/reminders/due")
    assert due.status_code == 200
    due_ids = [item["id"] for item in due.json()["items"]]
    assert inside["id"] in due_ids
    assert not_yet["id"] not in due_ids
    assert already_started["id"] not in due_ids
    assert no_remind["id"] not in due_ids


def test_due_reminder_logs_trigger_once_and_ack_flow(tmp_path: Path) -> None:
    client = _client(tmp_path)
    schedule = _create_schedule(client, title="알림 확인 회의", starts_in_minutes=10, remind_before_minutes=30)

    first = client.get("/api/schedules/reminders/due").json()["items"]
    assert [item["id"] for item in first] == [schedule["id"]]
    assert first[0]["reminder_notified_at"] is not None

    # 두 번째 폴링에도 due 에는 남지만(미확인) 실행기록은 1회만 남는다
    second = client.get("/api/schedules/reminders/due").json()["items"]
    assert [item["id"] for item in second] == [schedule["id"]]
    logs = client.get("/api/execution-logs").json()["items"]
    triggered = [entry for entry in logs if entry["action"] == "schedule.reminder.triggered"]
    assert len(triggered) == 1
    assert triggered[0]["inputs"]["schedule_id"] == schedule["id"]

    # ack 하면 due 목록에서 사라진다
    ack = client.post(f"/api/schedules/{schedule['id']}/reminders/ack")
    assert ack.status_code == 200
    assert ack.json()["reminder_acknowledged_at"] is not None

    after_ack = client.get("/api/schedules/reminders/due").json()["items"]
    assert after_ack == []

    ack_logs = [
        entry
        for entry in client.get("/api/execution-logs").json()["items"]
        if entry["action"] == "schedule.reminder.acknowledged"
    ]
    assert len(ack_logs) == 1


def test_ack_unknown_schedule_returns_404(tmp_path: Path) -> None:
    client = _client(tmp_path)
    response = client.post("/api/schedules/unknown-id/reminders/ack")
    assert response.status_code == 404


def test_schedule_update_resets_reminder_state(tmp_path: Path) -> None:
    client = _client(tmp_path)
    schedule = _create_schedule(client, title="변경될 회의", starts_in_minutes=10, remind_before_minutes=30)

    # 알림 발생 + 확인 처리
    assert client.get("/api/schedules/reminders/due").json()["items"]
    assert client.post(f"/api/schedules/{schedule['id']}/reminders/ack").status_code == 200
    assert client.get("/api/schedules/reminders/due").json()["items"] == []

    # 일정 수정 → 알림 상태 초기화 → 다시 due
    updated = client.patch(
        f"/api/schedules/{schedule['id']}",
        json={
            "title": "변경된 회의",
            "starts_at": _iso_in(15),
            "ends_at": _iso_in(75),
            "view": "day",
            "remind_before_minutes": 30,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["remind_before_minutes"] == 30
    assert updated.json()["reminder_acknowledged_at"] is None

    due_ids = [item["id"] for item in client.get("/api/schedules/reminders/due").json()["items"]]
    assert schedule["id"] in due_ids
