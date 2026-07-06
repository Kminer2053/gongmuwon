from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_execution_logs_are_limited_for_runtime_read_model(tmp_path: Path) -> None:
    client = _client(tmp_path)

    for index in range(6):
        response = client.post(
            "/api/schedules",
            json={
                "title": f"log schedule {index}",
                "starts_at": "2026-04-20T09:00:00+09:00",
                "ends_at": "2026-04-20T10:00:00+09:00",
                "view": "week",
            },
        )
        assert response.status_code == 201

    logs = client.get("/api/execution-logs?limit=3")

    assert logs.status_code == 200
    assert len(logs.json()["items"]) == 3
    assert all(entry["action"] == "schedule.created" for entry in logs.json()["items"])


def test_schedule_session_reference_flow(tmp_path: Path) -> None:
    client = _client(tmp_path)

    schedule = client.post(
        "/api/schedules",
        json={
            "title": "주간 보고",
            "starts_at": "2026-04-20T09:00:00+09:00",
            "ends_at": "2026-04-20T10:00:00+09:00",
            "view": "week"
        },
    )
    assert schedule.status_code == 201
    schedule_id = schedule.json()["id"]

    session = client.post(
        "/api/work-sessions",
        json={"title": "주간 보고 준비", "schedule_id": schedule_id},
    )
    assert session.status_code == 201
    session_id = session.json()["id"]

    linked = client.post(
        f"/api/work-sessions/{session_id}/file-links",
        json={
            "items": [
                {
                    "file_path": str(tmp_path / "memo.md"),
                    "label": "예산메모",
                    "source": "manual",
                }
            ]
        },
    )
    assert linked.status_code == 201

    links = client.get(f"/api/work-sessions/{session_id}/file-links")
    assert links.status_code == 200
    assert links.json()["items"][0]["label"] == "예산메모"


def test_reference_set_endpoints_are_removed(tmp_path: Path) -> None:
    client = _client(tmp_path)

    assert client.get("/api/reference-sets").status_code == 404
    assert (
        client.post("/api/reference-sets", json={"title": "제거된 기능", "items": []}).status_code
        == 404
    )


def test_work_session_can_be_linked_to_schedule_later(tmp_path: Path) -> None:
    client = _client(tmp_path)

    schedule = client.post(
        "/api/schedules",
        json={
            "title": "예산 점검",
            "starts_at": "2026-04-21T14:00:00+09:00",
            "ends_at": "2026-04-21T15:00:00+09:00",
            "view": "week",
        },
    )
    assert schedule.status_code == 201
    schedule_id = schedule.json()["id"]

    session = client.post(
        "/api/work-sessions",
        json={"title": "독립 검토 세션"},
    )
    assert session.status_code == 201
    session_id = session.json()["id"]
    assert session.json()["schedule_id"] is None

    linked = client.patch(
        f"/api/work-sessions/{session_id}",
        json={"schedule_id": schedule_id},
    )
    assert linked.status_code == 200
    assert linked.json()["schedule_id"] == schedule_id

    sessions = client.get("/api/work-sessions")
    assert sessions.status_code == 200
    assert any(
        item["id"] == session_id and item["schedule_id"] == schedule_id
        for item in sessions.json()["items"]
    )

    logs = client.get("/api/execution-logs")
    actions = [entry["action"] for entry in logs.json()["items"]]
    assert "work_session.updated" in actions


def test_schedule_can_be_updated_after_creation(tmp_path: Path) -> None:
    client = _client(tmp_path)

    schedule = client.post(
        "/api/schedules",
        json={
            "title": "초기 일정",
            "starts_at": "2026-04-21T14:00:00+09:00",
            "ends_at": "2026-04-21T15:00:00+09:00",
            "view": "week",
        },
    )
    assert schedule.status_code == 201
    schedule_id = schedule.json()["id"]

    updated = client.patch(
        f"/api/schedules/{schedule_id}",
        json={
            "title": "수정된 일정",
            "starts_at": "2026-04-21T15:00:00+09:00",
            "ends_at": "2026-04-21T16:00:00+09:00",
            "view": "day",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "수정된 일정"
    assert updated.json()["starts_at"] == "2026-04-21T15:00:00+09:00"
    assert updated.json()["view"] == "day"

    schedules = client.get("/api/schedules")
    assert schedules.status_code == 200
    assert any(
        item["id"] == schedule_id and item["title"] == "수정된 일정" and item["view"] == "day"
        for item in schedules.json()["items"]
    )

    logs = client.get("/api/execution-logs")
    actions = [entry["action"] for entry in logs.json()["items"]]
    assert "schedule.updated" in actions


def test_schedule_can_be_deleted_and_unlinks_work_sessions(tmp_path: Path) -> None:
    client = _client(tmp_path)

    schedule = client.post(
        "/api/schedules",
        json={
            "title": "삭제 대상 일정",
            "starts_at": "2026-04-22T10:00:00+09:00",
            "ends_at": "2026-04-22T11:00:00+09:00",
            "view": "week",
        },
    )
    assert schedule.status_code == 201
    schedule_id = schedule.json()["id"]

    session = client.post(
        "/api/work-sessions",
        json={"title": "연결 세션", "schedule_id": schedule_id},
    )
    assert session.status_code == 201
    session_id = session.json()["id"]

    deleted = client.delete(f"/api/schedules/{schedule_id}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True

    schedules = client.get("/api/schedules")
    assert all(item["id"] != schedule_id for item in schedules.json()["items"])

    sessions = client.get("/api/work-sessions")
    assert any(
        item["id"] == session_id and item["schedule_id"] is None
        for item in sessions.json()["items"]
    )

    logs = client.get("/api/execution-logs")
    actions = [entry["action"] for entry in logs.json()["items"]]
    assert "schedule.deleted" in actions


def test_work_session_message_flow_persists_messages(tmp_path: Path) -> None:
    client = _client(tmp_path)

    session = client.post(
        "/api/work-sessions",
        json={"title": "주간 보고 작업"},
    )
    assert session.status_code == 201
    session_id = session.json()["id"]

    created = client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "user", "text": "회의자료 초안부터 정리해줘"},
    )
    assert created.status_code == 201
    payload = created.json()
    assert payload["session_id"] == session_id
    assert payload["role"] == "user"
    assert payload["text"] == "회의자료 초안부터 정리해줘"

    messages = client.get(f"/api/work-sessions/{session_id}/messages")
    assert messages.status_code == 200
    items = messages.json()["items"]
    assert len(items) == 1
    assert items[0]["text"] == "회의자료 초안부터 정리해줘"

    logs = client.get("/api/execution-logs")
    actions = [entry["action"] for entry in logs.json()["items"]]
    assert "work_session.message.created" not in actions


def test_knowledge_candidate_approval_creates_topic_page_and_log(tmp_path: Path) -> None:
    client = _client(tmp_path)

    candidate = client.post(
        "/api/knowledge/candidates/from-note",
        json={
            "title": "2026 예산편성 메모",
            "body": "예산편성과 관련된 핵심 일정과 검토 포인트를 정리한 메모",
            "candidate_type": "topic"
        },
    )
    assert candidate.status_code == 201
    candidate_id = candidate.json()["id"]

    approved = client.post(
        f"/api/knowledge/candidates/{candidate_id}/approve",
        json={"page_type": "topic"},
    )
    assert approved.status_code == 200
    payload = approved.json()
    page_path = Path(payload["page"]["path"])
    assert page_path.exists()
    content = page_path.read_text(encoding="utf-8")
    assert "---" in content
    assert "[[" in content

    logs = client.get("/api/execution-logs")
    assert logs.status_code == 200
    actions = [entry["action"] for entry in logs.json()["items"]]
    assert "knowledge.candidate.approved" in actions


def test_knowledge_candidate_cannot_be_approved_twice(tmp_path: Path) -> None:
    client = _client(tmp_path)

    candidate = client.post(
        "/api/knowledge/candidates/from-note",
        json={
            "title": "duplicate approval guard",
            "body": "same candidate should not create multiple pages",
            "candidate_type": "topic",
        },
    )
    assert candidate.status_code == 201
    candidate_id = candidate.json()["id"]

    first_approval = client.post(
        f"/api/knowledge/candidates/{candidate_id}/approve",
        json={"page_type": "topic"},
    )
    assert first_approval.status_code == 200

    second_approval = client.post(
        f"/api/knowledge/candidates/{candidate_id}/approve",
        json={"page_type": "topic"},
    )
    assert second_approval.status_code == 409
    assert second_approval.json()["detail"] == "candidate already approved"


def test_content_base_generation_persists_markdown_artifact(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.post(
        "/api/documents/content-bases",
        json={
            "title": "주간 보고 초안",
            "purpose": "보고서형",
            "template_key": "report"
        },
    )
    assert response.status_code == 201
    payload = response.json()
    artifact = Path(payload["artifact"]["path"])
    assert artifact.exists()
    text = artifact.read_text(encoding="utf-8")
    assert "# 주간 보고 초안" in text
    assert "## 개요" in text
    assert "## 참고자료" in text


def test_document_finalize_requires_approval_and_creates_output(tmp_path: Path) -> None:
    client = _client(tmp_path)

    content_base = client.post(
        "/api/documents/content-bases",
        json={
            "title": "주간 보고 초안",
            "purpose": "보고서형",
            "template_key": "report",
        },
    )
    content_base_id = content_base.json()["id"]

    finalize = client.post(
        "/api/documents/finalize",
        json={"content_base_id": content_base_id, "output_name": "주간보고-2026-04-20"},
    )
    assert finalize.status_code == 202
    ticket_id = finalize.json()["approval_ticket"]["id"]

    decision = client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "최종 저장 승인"},
    )
    assert decision.status_code == 200

    apply = client.post(f"/api/documents/finalize/{ticket_id}/apply")
    assert apply.status_code == 201
    artifact_path = Path(apply.json()["artifact"]["path"])
    review_path = Path(apply.json()["artifact"]["markdown_path"])
    assert artifact_path.exists()
    assert review_path.exists()
    assert artifact_path.stat().st_size > 0
    assert artifact_path.parent.name == "outputs"
    assert artifact_path.suffix == ".hwpx"
    assert review_path.suffix == ".md"

    stored_output = client.app.state.services.db.fetch_one(
        "SELECT * FROM final_document_outputs WHERE approval_ticket_id = ?",
        (ticket_id,),
    )
    assert stored_output is not None
    assert stored_output["status"] == "applied"
    assert stored_output["artifact_path"] == str(artifact_path)

    logs = client.get("/api/execution-logs")
    actions = [entry["action"] for entry in logs.json()["items"]]
    assert "documents.finalize.requested" in actions
    assert "documents.finalize.applied" in actions


def test_document_finalize_sanitizes_windows_invalid_output_name(tmp_path: Path) -> None:
    client = _client(tmp_path)

    content_base = client.post(
        "/api/documents/content-bases",
        json={
            "title": "주간 보고 초안",
            "purpose": "보고서형",
            "template_key": "report",
        },
    )
    content_base_id = content_base.json()["id"]

    finalize = client.post(
        "/api/documents/finalize",
        json={"content_base_id": content_base_id, "output_name": '주간:보고*?"<>|2026'},
    )
    assert finalize.status_code == 202
    ticket_id = finalize.json()["approval_ticket"]["id"]

    decision = client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "최종 저장 승인"},
    )
    assert decision.status_code == 200

    apply = client.post(f"/api/documents/finalize/{ticket_id}/apply")
    assert apply.status_code == 201
    artifact_path = Path(apply.json()["artifact"]["path"])
    review_path = Path(apply.json()["artifact"]["markdown_path"])
    assert artifact_path.exists()
    assert review_path.exists()
    assert artifact_path.stat().st_size > 0
    assert artifact_path.parent.name == "outputs"
    assert all(ch not in artifact_path.name for ch in ':*?"<>|')
    assert artifact_path.suffix == ".hwpx"
    assert review_path.suffix == ".md"


def test_document_finalize_versions_duplicate_output_names(tmp_path: Path) -> None:
    client = _client(tmp_path)

    first_content_base = client.post(
        "/api/documents/content-bases",
        json={
            "title": "First draft",
            "purpose": "report",
            "template_key": "report",
        },
    )
    second_content_base = client.post(
        "/api/documents/content-bases",
        json={
            "title": "Second draft",
            "purpose": "report",
            "template_key": "report",
        },
    )

    first_finalize = client.post(
        "/api/documents/finalize",
        json={"content_base_id": first_content_base.json()["id"], "output_name": "shared-output"},
    )
    second_finalize = client.post(
        "/api/documents/finalize",
        json={"content_base_id": second_content_base.json()["id"], "output_name": "shared-output"},
    )

    first_ticket_id = first_finalize.json()["approval_ticket"]["id"]
    second_ticket_id = second_finalize.json()["approval_ticket"]["id"]

    client.post(
        f"/api/approval-tickets/{first_ticket_id}/decision",
        json={"status": "approved", "decision_note": "approved"},
    )
    client.post(
        f"/api/approval-tickets/{second_ticket_id}/decision",
        json={"status": "approved", "decision_note": "approved"},
    )

    first_apply = client.post(f"/api/documents/finalize/{first_ticket_id}/apply")
    second_apply = client.post(f"/api/documents/finalize/{second_ticket_id}/apply")

    assert first_apply.status_code == 201
    assert second_apply.status_code == 201

    first_path = Path(first_apply.json()["artifact"]["path"])
    second_path = Path(second_apply.json()["artifact"]["path"])
    first_review_path = Path(first_apply.json()["artifact"]["markdown_path"])
    second_review_path = Path(second_apply.json()["artifact"]["markdown_path"])
    assert first_path.exists()
    assert second_path.exists()
    assert first_review_path.exists()
    assert second_review_path.exists()
    assert first_path.stat().st_size > 0
    assert second_path.stat().st_size > 0
    assert first_path != second_path
    assert first_path.suffix == ".hwpx"
    assert second_path.suffix == ".hwpx"
    assert first_review_path.read_text(encoding="utf-8") != second_review_path.read_text(encoding="utf-8")

