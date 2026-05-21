from pathlib import Path
from zipfile import ZipFile

import pytest
from hwpx import HwpxDocument

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def _create_valid_hwpx(path: Path, text: str = "사용자 양식 머리말") -> Path:
    document = HwpxDocument.new()
    document.add_paragraph(text)
    document.save_to_path(path)
    return path


def _extract_hwpx_text(path: Path) -> str:
    chunks: list[str] = []
    with ZipFile(path) as archive:
        for name in archive.namelist():
            if name.lower().endswith(".xml") or name == "Preview/PrvText.txt":
                chunks.append(archive.read(name).decode("utf-8", errors="ignore"))
    return "\n".join(chunks)


def _seed_session_with_schedule_and_files(client, tmp_path: Path) -> dict[str, str]:
    schedule = client.post(
        "/api/schedules",
        json={
            "title": "민원 처리 평가 회의",
            "starts_at": "2026-05-06T09:00:00+09:00",
            "ends_at": "2026-05-06T10:00:00+09:00",
            "view": "week",
        },
    )
    assert schedule.status_code == 201
    schedule_id = schedule.json()["id"]

    session = client.post(
        "/api/work-sessions",
        json={"title": "민원 처리 보고 작업", "schedule_id": schedule_id},
    )
    assert session.status_code == 201
    session_id = session.json()["id"]

    user_message = client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "user", "text": "민원 처리 결과를 부서장 보고용으로 정리해줘."},
    )
    assert user_message.status_code == 201

    assistant_message = client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "assistant", "text": "쟁점, 조치계획, 기한 중심으로 정리하겠습니다."},
    )
    assert assistant_message.status_code == 201

    linked_file = tmp_path / "complaint-status.md"
    linked_file.write_text("민원 처리 현황: 접수 12건, 완료 10건, 진행 2건", encoding="utf-8")
    linked = client.post(
        f"/api/work-sessions/{session_id}/file-links",
        json={
            "items": [
                {
                    "file_path": str(linked_file),
                    "label": "민원 처리 현황",
                    "source": "manual",
                }
            ]
        },
    )
    assert linked.status_code == 201

    reference_file = tmp_path / "reference-summary.xlsx"
    reference_file.write_text("분기별 민원 처리 추이", encoding="utf-8")
    reference_set = client.post(
        "/api/reference-sets",
        json={
            "title": "민원 처리 참고자료",
            "session_id": session_id,
            "items": [
                {
                    "kind": "file",
                    "label": "처리 현황표",
                    "value": str(reference_file),
                }
            ],
        },
    )
    assert reference_set.status_code == 201

    direct_file = tmp_path / "direct-attachment.pdf"
    direct_file.write_text("직접 연결한 보충자료", encoding="utf-8")

    return {
        "schedule_id": schedule_id,
        "session_id": session_id,
        "linked_file": str(linked_file),
        "reference_set_id": reference_set.json()["id"],
        "reference_file": str(reference_file),
        "direct_file": str(direct_file),
    }


def test_content_base_uses_work_session_schedule_files_and_reference_set(tmp_path: Path) -> None:
    client = _client(tmp_path)
    seeded = _seed_session_with_schedule_and_files(client, tmp_path)

    content_base = client.post(
        "/api/documents/content-bases",
        json={
            "title": "민원 처리 결과 보고",
            "purpose": "업무대화와 연결자료를 기반으로 보고서 작성",
            "reference_set_id": seeded["reference_set_id"],
            "template_key": "report",
            "source_session_id": seeded["session_id"],
            "outline": "민원 처리 결과와 후속 조치를 보고서로 정리",
            "document_format": "fullReport",
            "audience_type": "부서장",
            "expected_length": "풀버전",
            "urgency_level": "보통",
            "needs_traceability": "필요",
            "requires_official_form": "아니오",
            "requested_action": "후속 회의 일정 확정",
            "deadline": "2026-05-10",
            "security_level": "내부",
            "direct_file_paths": [seeded["direct_file"]],
            "user_template_path": None,
        },
    )

    assert content_base.status_code == 201
    content = content_base.json()["content"]
    assert "## 업무대화 세션" in content
    assert "세션 제목: 민원 처리 보고 작업" in content
    assert "연결 일정: 민원 처리 평가 회의" in content
    assert "사용자: 민원 처리 결과를 부서장 보고용으로 정리해줘." in content
    assert "어시스턴트: 쟁점, 조치계획, 기한 중심으로 정리하겠습니다." in content
    assert "민원 처리 현황" in content
    assert seeded["linked_file"] in content
    assert "처리 현황표" in content
    assert seeded["reference_file"] in content
    assert seeded["direct_file"] in content
    assert "풀버전 보고서 (fullReport)" in content
    assert "수신/대상: 부서장" in content
    assert "요청 조치: 후속 회의 일정 확정" in content


def test_final_hwpx_contains_session_and_file_context(tmp_path: Path) -> None:
    client = _client(tmp_path)
    seeded = _seed_session_with_schedule_and_files(client, tmp_path)

    content_base = client.post(
        "/api/documents/content-bases",
        json={
            "title": "민원 처리 결과 보고",
            "purpose": "업무대화와 연결자료를 기반으로 보고서 작성",
            "reference_set_id": seeded["reference_set_id"],
            "template_key": "report",
            "source_session_id": seeded["session_id"],
            "outline": "민원 처리 결과와 후속 조치를 보고서로 정리",
            "document_format": "fullReport",
            "audience_type": "부서장",
            "expected_length": "풀버전",
            "urgency_level": "보통",
            "needs_traceability": "필요",
            "requires_official_form": "아니오",
            "requested_action": "후속 회의 일정 확정",
            "deadline": "2026-05-10",
            "security_level": "내부",
            "direct_file_paths": [seeded["direct_file"]],
            "user_template_path": None,
        },
    )
    assert content_base.status_code == 201

    requested = client.post(
        "/api/documents/finalize",
        json={"content_base_id": content_base.json()["id"], "output_name": "complaint-report"},
    )
    assert requested.status_code == 202
    ticket_id = requested.json()["approval_ticket"]["id"]

    decision = client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "문서작성 통합 테스트 승인"},
    )
    assert decision.status_code == 200

    applied = client.post(f"/api/documents/finalize/{ticket_id}/apply")
    assert applied.status_code == 201
    artifact = applied.json()["artifact"]
    assert artifact["format"] == "fullReport"

    hwpx_path = Path(artifact["path"])
    markdown_path = Path(artifact["markdown_path"])
    assert hwpx_path.exists()
    assert markdown_path.exists()

    review_markdown = markdown_path.read_text(encoding="utf-8")
    assert "민원 처리 결과 보고" in review_markdown
    assert "목차" in review_markdown
    assert "민원 처리 평가 회의" in review_markdown
    assert "민원 처리 결과를 부서장 보고용으로 정리해줘." in review_markdown
    assert "민원 처리 현황" in review_markdown
    assert "처리 현황표" in review_markdown
    assert seeded["direct_file"] in review_markdown
    assert "후속 회의 일정 확정" in review_markdown

    hwpx_text = _extract_hwpx_text(hwpx_path)
    assert "민원 처리 결과 보고" in hwpx_text
    assert "민원 처리 평가 회의" in hwpx_text
    assert "민원 처리 현황" in hwpx_text
    assert "처리 현황표" in hwpx_text
    assert "후속 회의 일정 확정" in hwpx_text


def test_public_document_writer_applies_public_document_style_rules(tmp_path: Path) -> None:
    client = _client(tmp_path)
    content_base = client.post(
        "/api/documents/content-bases",
        json={
            "title": "AI 도입 방향 보고",
            "purpose": "의사결정자용 1페이지 보고",
            "reference_set_id": None,
            "template_key": "report",
            "source_session_id": None,
            "outline": "AI 도입과 관련된 많은 사항들이 있을 것으로 보입니다. 빠른 판단이 필요한 것으로 판단됩니다.",
            "document_format": "onePageReport",
            "audience_type": "부서장",
            "expected_length": "1쪽",
            "urgency_level": "높음",
            "needs_traceability": "필요",
            "requires_official_form": "필요",
            "requested_action": "추진방향 검토",
            "deadline": "2026-05-20",
            "security_level": "내부",
            "direct_file_paths": [],
            "user_template_path": None,
        },
    )
    assert content_base.status_code == 201

    requested = client.post(
        "/api/documents/finalize",
        json={"content_base_id": content_base.json()["id"], "output_name": "style-rule-report"},
    )
    assert requested.status_code == 202
    ticket_id = requested.json()["approval_ticket"]["id"]
    decision = client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "작성 원칙 테스트 승인"},
    )
    assert decision.status_code == 200
    applied = client.post(f"/api/documents/finalize/{ticket_id}/apply")
    assert applied.status_code == 201

    artifact = applied.json()["artifact"]
    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    assert "AI 도입 관련" in review_markdown
    assert "사항들이" not in review_markdown
    assert "것으로 보입니다" not in review_markdown
    assert "작성 품질 점검" in review_markdown
    assert "두괄식" in review_markdown
    assert "적/의/것/들" in review_markdown


def test_custom_hwpx_template_is_preserved_and_appended(tmp_path: Path) -> None:
    client = _client(tmp_path)
    template_path = _create_valid_hwpx(tmp_path / "email-template.hwpx", text="기관 이메일 양식")

    uploaded = client.post(
        "/api/documents/templates/custom",
        files={"file": ("email-template.hwpx", template_path.read_bytes(), "application/vnd.hancom.hwpx")},
    )
    assert uploaded.status_code == 201
    template_item = uploaded.json()["item"]

    content_base = client.post(
        "/api/documents/content-bases",
        json={
            "title": "후속 자료 제출 안내",
            "purpose": "이메일로 요청사항 전달",
            "reference_set_id": None,
            "template_key": "report",
            "source_session_id": None,
            "outline": "자료 제출 기한과 제출 대상을 간단히 안내",
            "document_format": "email",
            "audience_type": "참석자",
            "expected_length": "짧게",
            "urgency_level": "높음",
            "needs_traceability": "필요",
            "requires_official_form": "아니오",
            "requested_action": "자료 제출",
            "deadline": "2026-05-09",
            "security_level": "일반",
            "direct_file_paths": [],
            "user_template_path": template_item["path"],
        },
    )
    assert content_base.status_code == 201

    requested = client.post(
        "/api/documents/finalize",
        json={"content_base_id": content_base.json()["id"], "output_name": "follow-up-email"},
    )
    assert requested.status_code == 202
    ticket_id = requested.json()["approval_ticket"]["id"]
    decision = client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "테스트 승인"},
    )
    assert decision.status_code == 200

    applied = client.post(f"/api/documents/finalize/{ticket_id}/apply")
    assert applied.status_code == 201
    artifact = applied.json()["artifact"]
    assert artifact["format"] == "email"

    hwpx_text = _extract_hwpx_text(Path(artifact["path"]))
    assert "기관 이메일 양식" in hwpx_text
    assert "공무 워크스페이스 생성 내용" in hwpx_text
    assert "제목: 후속 자료 제출 안내" in hwpx_text
    assert "수신: 참석자" in hwpx_text
    assert "요청 기한: 2026-05-09" in hwpx_text


@pytest.mark.parametrize(
    ("document_format", "expected_phrase"),
    [
        ("officialMemo", "수신: 부서장"),
        ("onePageReport", "1. 개요"),
        ("fullReport", "목차"),
        ("email", "제목: 문서 유형 테스트"),
    ],
)
def test_all_public_document_formats_generate_readable_hwpx(
    tmp_path: Path, document_format: str, expected_phrase: str
) -> None:
    client = _client(tmp_path)
    content_base = client.post(
        "/api/documents/content-bases",
        json={
            "title": "문서 유형 테스트",
            "purpose": "출력 유형별 HWPX 산출 확인",
            "reference_set_id": None,
            "template_key": "report",
            "source_session_id": None,
            "outline": "업무 내용을 공공문서 형식으로 정리",
            "document_format": document_format,
            "audience_type": "부서장",
            "expected_length": "1쪽",
            "urgency_level": "보통",
            "needs_traceability": "필요",
            "requires_official_form": "필요",
            "requested_action": "검토 요청",
            "deadline": "2026-05-18",
            "security_level": "내부",
            "direct_file_paths": [],
            "user_template_path": None,
        },
    )
    assert content_base.status_code == 201
    requested = client.post(
        "/api/documents/finalize",
        json={"content_base_id": content_base.json()["id"], "output_name": f"format-{document_format}"},
    )
    assert requested.status_code == 202
    ticket_id = requested.json()["approval_ticket"]["id"]
    decision = client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "유형 테스트 승인"},
    )
    assert decision.status_code == 200
    applied = client.post(f"/api/documents/finalize/{ticket_id}/apply")
    assert applied.status_code == 201

    artifact = applied.json()["artifact"]
    assert artifact["format"] == document_format
    hwpx_text = _extract_hwpx_text(Path(artifact["path"]))
    assert "문서 유형 테스트" in hwpx_text
    assert expected_phrase in hwpx_text
