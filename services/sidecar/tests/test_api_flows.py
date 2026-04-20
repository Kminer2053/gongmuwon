from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


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

    reference_set = client.post(
        "/api/reference-sets",
        json={
            "title": "보고 참고자료",
            "session_id": session_id,
            "items": [
                {
                    "kind": "file",
                    "label": "예산메모",
                    "value": str(tmp_path / "memo.md")
                }
            ],
        },
    )
    assert reference_set.status_code == 201
    body = reference_set.json()
    assert body["session_id"] == session_id
    assert body["items"][0]["kind"] == "file"


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


def test_content_base_generation_persists_markdown_artifact(tmp_path: Path) -> None:
    client = _client(tmp_path)

    ref_set = client.post(
        "/api/reference-sets",
        json={
            "title": "회의 참고자료",
            "items": [
                {"kind": "note", "label": "핵심 쟁점", "value": "예산 조정과 일정 확정"},
                {"kind": "note", "label": "후속 조치", "value": "부서 협의 및 보고서 초안"}
            ],
        },
    )
    assert ref_set.status_code == 201
    reference_set_id = ref_set.json()["id"]

    response = client.post(
        "/api/documents/content-bases",
        json={
            "title": "주간 보고 초안",
            "purpose": "보고서형",
            "reference_set_id": reference_set_id,
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

    ref_set = client.post(
        "/api/reference-sets",
        json={"title": "문서 참고", "items": [{"kind": "note", "label": "쟁점", "value": "예산 조정"}]},
    )
    reference_set_id = ref_set.json()["id"]

    content_base = client.post(
        "/api/documents/content-bases",
        json={
            "title": "주간 보고 초안",
            "purpose": "보고서형",
            "reference_set_id": reference_set_id,
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
    assert artifact_path.exists()
    assert artifact_path.parent.name == "outputs"

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


def test_anything_launch_creates_pending_approval_ticket(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.post(
        "/api/integrations/anything/launch",
        json={"query": "예산 검토"},
    )
    assert response.status_code == 202
    ticket_id = response.json()["id"]

    tickets = client.get("/api/approval-tickets")
    assert tickets.status_code == 200
    items = tickets.json()["items"]
    assert any(item["id"] == ticket_id and item["status"] == "pending" for item in items)

    approve = client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "사용자 승인"},
    )
    assert approve.status_code == 200
    assert approve.json()["status"] == "approved"

    logs = client.get("/api/execution-logs")
    actions = [entry["action"] for entry in logs.json()["items"]]
    assert "anything.launch.requested" in actions
    assert "approval_ticket.decided" in actions


def test_file_organization_proposals_are_persisted(tmp_path: Path) -> None:
    client = _client(tmp_path)
    target = tmp_path / "incoming"
    target.mkdir()
    (target / "회의메모.md").write_text("# 회의메모", encoding="utf-8")
    (target / "budget.xlsx").write_text("mock", encoding="utf-8")

    response = client.post(
        "/api/file-organizer/proposals",
        json={"target_path": str(target)},
    )
    assert response.status_code == 200
    payload = response.json()["items"]
    assert len(payload) == 2
    assert any(item["proposal_type"] == "knowledge_candidate" for item in payload)

    listed = client.get("/api/file-organizer/proposals")
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 2
