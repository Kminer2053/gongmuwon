import json
from pathlib import Path
import re
from zipfile import ZipFile

import pytest
from hwpx import HwpxDocument

from gongmu_sidecar.app import create_app
from gongmu_sidecar.hwpx_writer import (
    PublicDocumentPayload,
    _build_skeleton_values,
    build_public_document_payload,
    render_public_document_lines,
    write_public_hwpx_document,
)
from gongmu_sidecar.llm import LLMGenerationResult


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


def _extract_hwpx_plain_text(path: Path) -> str:
    raw = _extract_hwpx_text(path)
    text = raw.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    text = __import__("re").sub(r"<[^>]+>", " ", text)
    text = __import__("re").sub(r"\s+", " ", text)
    return text.strip()


def _skeleton_slot_key(value: object) -> str:
    normalized = str(value or "")
    if "__EMPTY_PLACEHOLDER__" in normalized:
        return ""
    normalized = re.sub(r"^[\s\-–−—◦○◇*※]+", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def test_document_file_excerpt_parses_supported_structured_documents(tmp_path: Path) -> None:
    client = _client(tmp_path)
    source = _create_valid_hwpx(
        tmp_path / "strategy-meeting.hwpx",
        text="AI strategy meeting decisions and follow-up actions",
    )

    excerpt = client.app.state.services.documents._safe_file_excerpt(str(source))

    assert excerpt is not None
    assert "AI strategy meeting decisions" in excerpt


def _fake_document_generate_pipeline_reply(
    *,
    title: str = "문서작성 테스트 보고서",
    summary: str = "업무대화와 연결 파일을 근거로 보고서를 작성합니다.",
    current_status: str = "연결 파일과 작성 지시를 Content Base에 반영합니다.",
    action: str = "산출 문서를 검토합니다.",
    evidence: list[str] | None = None,
):
    calls: list[list[dict]] = []
    evidence_items = evidence or ["업무대화 세션 및 연결 파일"]

    def fake_generate_reply(settings, messages, **kwargs):
        calls.append(messages)
        if len(calls) == 1:
            brief = {
                "summary": [summary],
                "background": ["사용자가 공공문서 형식의 HWPX 산출을 요청했습니다."],
                "current_status": [current_status],
                "issues": ["근거가 부족한 항목은 확인 필요로 표시해야 합니다."],
                "solutions": ["핵심 근거와 후속 조치를 개조식으로 정리합니다."],
                "expected_effects": ["보고서 검토와 후속 조치 추적성을 높입니다."],
                "actions": [action],
                "evidence": evidence_items,
                "quality_checks": ["두괄식", "한 문장 한 핵심"],
                "confidence": 0.9,
            }
            return LLMGenerationResult(
                text=json.dumps(brief, ensure_ascii=False),
                provider="ollama",
                model="gemma4:e2b",
            )
        evidence_markdown = "\\n".join(f"- {item}" for item in evidence_items)
        content_markdown = f"""# {title}

## WorkSessionBrief
- 작성 지시: 공공문서 형식의 HWPX 산출
- 핵심 근거: {summary}

## DocumentPlan
- 형식: public-doc-to-hwpx 1페이지 보고서
- 전략: 두괄식 요약과 개조식 본문

## 핵심 내용
- {summary}

## 현황 및 쟁점
- {current_status}

## 조치안
- 핵심 근거와 후속 조치를 개조식으로 정리합니다.

## 기대효과 및 요청
- 보고서 검토와 후속 조치 추적성을 높입니다.
- {action}

## 수집 근거
{evidence_markdown}

## 작성 품질 점검
- 두괄식
- 한 문장 한 핵심"""
        return LLMGenerationResult(
            text=json.dumps({"content_markdown": content_markdown}, ensure_ascii=False),
            provider="ollama",
            model="gemma4:e2b",
        )

    return calls, fake_generate_reply


def test_onepage_report_payload_prioritizes_session_context_over_empty_state_text() -> None:
    markdown = """
# 오늘 대화세션 보고서

## 업무대화 세션
- 세션 제목: 업무대화 테스트
- 연결 일정: 없음

## 업무대화 기록
- 사용자: 내일 오후 2시 회의 일정 등록하고 지식폴더에서 프롬프트 관련 자료 찾아줘
- 어시스턴트: 일정을 등록했습니다. 제목: 회의 시간: 2026-05-27T14:00:00+09:00 ~ 2026-05-27T15:00:00+09:00
- 어시스턴트: GraphRAG 검색 결과입니다. The Art of Prompt Engineering_Beginner, claude-master-guide 문서를 근거로 프롬프트 작성 원칙과 사고 강도 조절 방법을 제시했습니다.
- 사용자: 업무대화랑 파일찾기 사용법 안내해줄래?
- 어시스턴트: 업무대화는 일정 등록, 지식폴더 검색, 문서작성 같은 연계 기능을 먼저 시도합니다. 파일찾기는 현재 세션에 관련 파일을 연결해 이후 대화와 문서작성 근거로 사용합니다.
- 사용자: 이번달 등록된 일정확인해줘
- 어시스턴트: 등록된 일정입니다. AI 전략회의, 목표 검증 회의 등 일정 목록을 제공했습니다.
- 어시스턴트: LLM 응답 생성에 실패했습니다. LLM request failed (403): Featherless API subscription plan does not have API access enabled.
- 어시스턴트: 현재까지의 대화 세션 내용을 요약했습니다. 일정 등록, 프롬프트 자료 검색, 기능 안내, 일정 조회를 중심으로 진행되었습니다.

## 세션 연결 파일
- 아직 연결된 파일이 없습니다.

## 참고자료
- 참고자료가 아직 연결되지 않았습니다.
"""
    payload = build_public_document_payload(
        title="오늘 대화세션 1페이지 보고서",
        purpose="업무대화 세션 맥락을 보고서로 압축",
        template_key="report",
        content_markdown=markdown,
        document_format="onePageReport",
        requested_action="프롬프트 자료 검토 및 Featherless API 권한 확인",
    )

    rendered = "\n".join(render_public_document_lines(payload))

    assert not any(item.startswith("사용자:") or item.startswith("어시스턴트:") for item in payload.summary[:3])
    assert any("지식폴더 GraphRAG" in item for item in payload.summary)
    assert any("Featherless API 권한" in item for item in payload.issues + payload.actions + payload.requested_action)
    assert "아직 연결된 파일이 없습니다" not in rendered
    assert "참고자료가 아직 연결되지 않았습니다" not in rendered
    assert "Content Base 내용을 기준으로 정리합니다" not in rendered
    assert "일정 등록" in rendered
    assert "GraphRAG" in rendered
    assert "프롬프트" in rendered
    assert "The Art of Prompt Engineering_Beginner" in rendered
    assert "claude-master-guide" in rendered
    assert "Featherless API" in rendered
    assert "회의" in rendered


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


def test_content_base_compiles_instruction_aware_worksession_brief_with_graphrag(
    tmp_path: Path, monkeypatch
) -> None:
    client = _client(tmp_path)
    schedule = client.post(
        "/api/schedules",
        json={
            "title": "프롬프트 활용 검토회의",
            "starts_at": "2026-05-28T14:00:00+09:00",
            "ends_at": "2026-05-28T15:00:00+09:00",
            "view": "month",
        },
    )
    assert schedule.status_code == 201
    session = client.post(
        "/api/work-sessions",
        json={"title": "프롬프트 자료 검토 세션", "schedule_id": schedule.json()["id"]},
    )
    assert session.status_code == 201
    session_id = session.json()["id"]

    for role, text in [
        ("user", "내일 오후 2시 회의 일정 등록하고 지식폴더에서 프롬프트 관련 자료 찾아줘"),
        (
            "assistant",
            "일정 등록을 완료했고 GraphRAG에서 The Art of Prompt Engineering_Beginner와 "
            "claude-master-guide를 근거로 찾았습니다.",
        ),
        ("user", "오늘 대화세션 내용을 1페이지 보고서로 만들어줘"),
    ]:
        posted = client.post(f"/api/work-sessions/{session_id}/messages", json={"role": role, "text": text})
        assert posted.status_code == 201

    linked_file = tmp_path / "prompt-action-plan.md"
    linked_file.write_text(
        "프롬프트 활용계획: 목적, 맥락, 제약조건, 출력형식을 명확히 적고 민감정보는 보호한다.",
        encoding="utf-8",
    )
    linked = client.post(
        f"/api/work-sessions/{session_id}/file-links",
        json={
            "items": [
                {
                    "file_path": str(linked_file),
                    "label": "프롬프트 활용계획",
                    "source": "manual",
                }
            ]
        },
    )
    assert linked.status_code == 201
    reference_set = client.post(
        "/api/reference-sets",
        json={
            "title": "프롬프트 참고자료",
            "session_id": session_id,
            "items": [
                {
                    "kind": "file",
                    "label": "The Art of Prompt Engineering_Beginner",
                    "value": r"C:\Users\USER\Documents\AI자료모음\The Art of Prompt Engineering_Beginner.pdf",
                }
            ],
        },
    )
    assert reference_set.status_code == 201

    def fake_retrieve(**kwargs):
        assert kwargs["session_id"] == session_id
        assert "프롬프트" in kwargs["query"] or "보고서" in kwargs["query"]
        return {
            "items": [
                {
                    "document": {
                        "title": "The Art of Prompt Engineering_Beginner",
                        "file_path": r"C:\Users\USER\Documents\AI자료모음\The Art of Prompt Engineering_Beginner.pdf",
                    },
                    "text": "프롬프트 품질은 맥락, 구체성, 제약조건, 원하는 출력 형식이 좌우한다.",
                    "evidence_type": "section",
                    "relations": [{"relation": "REFERENCES", "target_label": "프롬프트 작성 원칙"}],
                }
            ]
        }

    monkeypatch.setattr(client.app.state.services.graphrag, "retrieve", fake_retrieve)

    content_base = client.post(
        "/api/documents/content-bases",
        json={
            "title": "프롬프트 자료 검토 1페이지 보고",
            "purpose": "대화세션과 지식폴더 근거를 종합해 회의 보고자료 작성",
            "reference_set_id": reference_set.json()["id"],
            "template_key": "report",
            "source_session_id": session_id,
            "outline": "오늘 대화세션 내용을 1페이지 보고서로 만들어줘",
            "document_format": "onePageReport",
            "audience_type": "부서장",
            "expected_length": "1쪽",
            "requested_action": "프롬프트 활용 방향 검토",
            "direct_file_paths": [],
            "user_template_path": None,
        },
    )

    assert content_base.status_code == 201
    content = content_base.json()["content"]
    assert "## WorkSessionBrief" in content
    assert "## DocumentPlan" in content
    assert "## 핵심 내용" in content
    assert "## 현황 및 쟁점" in content
    assert "## 조치안" in content
    assert "## 수집 근거" in content
    assert "프롬프트 활용 검토회의" in content
    assert "프롬프트 활용계획" in content
    assert "프롬프트 품질은 맥락" in content
    assert "The Art of Prompt Engineering_Beginner" in content
    assert "두괄식" in content
    assert "개조식" in content


def test_document_generate_direct_request_uses_worksession_brief_and_document_plan(
    tmp_path: Path, monkeypatch
) -> None:
    client = _client(tmp_path)
    evidence_file = tmp_path / "local-ai-policy.md"
    evidence_file.write_text(
        "로컬 AI 업무환경은 폐쇄망 보안, 파일검색, GraphRAG, 문서작성 자동화를 함께 고려해야 한다.",
        encoding="utf-8",
    )
    _calls, fake_generate_reply = _fake_document_generate_pipeline_reply(
        title="로컬 AI 업무환경 검토보고",
        summary="로컬 AI 업무환경은 폐쇄망 보안, 파일검색, GraphRAG, 문서작성 자동화를 함께 고려해야 합니다.",
        current_status="첨부 자료를 근거로 폐쇄망용 로컬 AI 업무환경 도입 필요성과 조치안을 정리합니다.",
        action="도입 검토",
        evidence=[str(evidence_file), "로컬 AI 업무환경은 폐쇄망 보안, 파일검색, GraphRAG, 문서작성 자동화"],
    )
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    generated = client.post(
        "/api/documents/generate",
        json={
            "title": "로컬 AI 업무환경 검토보고",
            "purpose": "첨부 자료를 바탕으로 의사결정용 1페이지 보고서 작성",
            "template_key": "report",
            "source_session_id": None,
            "outline": "첨부 자료 기반으로 폐쇄망용 로컬 AI 업무환경 도입 필요성과 조치안을 정리해줘",
            "document_format": "onePageReport",
            "audience_type": "부서장",
            "expected_length": "1쪽",
            "requested_action": "도입 검토",
            "direct_file_paths": [str(evidence_file)],
            "user_template_path": None,
            "output_name": "local-ai-policy-report",
        },
    )

    assert generated.status_code == 201
    content = generated.json()["content_base"]["content"]
    review_text = Path(generated.json()["artifact"]["markdown_path"]).read_text(encoding="utf-8")
    assert "## WorkSessionBrief" in content
    assert "## DocumentPlan" in content
    assert "로컬 AI 업무환경은 폐쇄망 보안" in content
    assert "로컬 AI 업무환경은 폐쇄망 보안" in review_text
    assert "도입 검토" in review_text
    assert "두괄식" in content
    assert "두괄식" not in review_text


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


def test_document_generate_endpoint_creates_hwpx_without_manual_approval(tmp_path: Path, monkeypatch) -> None:
    client = _client(tmp_path)
    session = client.post("/api/work-sessions", json={"title": "AI strategy session"})
    assert session.status_code == 201
    session_id = session.json()["id"]
    message = client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "user", "text": "Summarize AI adoption direction and next actions."},
    )
    assert message.status_code == 201

    attached_file = tmp_path / "ai-direction.txt"
    attached_file.write_text("AI adoption should focus on secure local workflow automation.", encoding="utf-8")
    _calls, fake_generate_reply = _fake_document_generate_pipeline_reply(
        title="AI strategy one page report",
        summary="AI strategy session 내용을 바탕으로 secure local workflow automation 방향을 정리합니다.",
        current_status="AI adoption should focus on secure local workflow automation.",
        action="Review and decide next actions",
        evidence=["AI strategy session", str(attached_file), "AI adoption should focus on secure local workflow automation."],
    )
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    generated = client.post(
        "/api/documents/generate",
        json={
            "title": "AI strategy one page report",
            "purpose": "Create a decision-ready public sector report",
            "template_key": "report",
            "source_session_id": session_id,
            "outline": "Create a concise one-page report with background, direction, and next actions.",
            "document_format": "onePageReport",
            "audience_type": "department head",
            "expected_length": "1 page",
            "requested_action": "Review and decide next actions",
            "direct_file_paths": [str(attached_file)],
            "user_template_path": None,
            "output_name": "ai-strategy-one-page",
        },
    )

    assert generated.status_code == 201
    payload = generated.json()
    assert payload["content_base"]["id"]
    assert payload["finalize"]["approval_ticket"]["status"] == "approved"
    assert payload["work_job"]["kind"] == "documents.generate"
    assert payload["work_job"]["status"] == "succeeded"
    artifact_path = Path(payload["artifact"]["path"])
    review_path = Path(payload["artifact"]["markdown_path"])
    assert artifact_path.exists()
    assert artifact_path.suffix == ".hwpx"
    assert review_path.exists()
    review_text = review_path.read_text(encoding="utf-8")
    assert "AI strategy one page report" in review_text
    assert "AI strategy session" in review_text
    assert str(attached_file) in review_text


def test_document_generate_endpoint_uses_llm_public_doc_pipeline_for_content_quality(
    tmp_path: Path, monkeypatch
) -> None:
    llm_calls: list[list[dict]] = []

    def fake_generate_reply(settings, messages, **kwargs):
        llm_calls.append(messages)
        if len(llm_calls) == 1:
            return LLMGenerationResult(
                text=(
                    '{"summary":["민원 처리 결과는 완료 10건, 진행 2건으로 정리됩니다."],'
                    '"background":["부서장 보고용으로 민원 처리 현황과 후속 조치가 필요합니다."],'
                    '"current_status":["접수 12건 중 완료 10건, 진행 2건입니다."],'
                    '"issues":["진행 2건의 담당자와 완료기한 관리가 필요합니다."],'
                    '"solutions":["담당자별 후속 조치와 완료기한을 명시합니다."],'
                    '"expected_effects":["민원 처리 지연 위험을 낮추고 보고 추적성을 확보합니다."],'
                    '"actions":["진행 2건의 기한과 담당자를 확정합니다."],'
                    '"evidence":["민원 처리 현황 파일: 접수 12건, 완료 10건, 진행 2건"],'
                    '"quality_checks":["두괄식 요약","한 문장 한 핵심"],'
                    '"confidence":0.95}'
                ),
                provider="ollama",
                model="gemma4:e2b",
            )
        return LLMGenerationResult(
            text=(
                '{"content_markdown":"# 민원 처리 1페이지 보고서\\n\\n'
                '## WorkSessionBrief\\n'
                '- 작성 지시: 부서장 보고용 1페이지 보고서\\n'
                '- 핵심 근거: 접수 12건, 완료 10건, 진행 2건\\n\\n'
                '## DocumentPlan\\n'
                '- 형식: public-doc-to-hwpx 1페이지 보고서\\n'
                '- 전략: 완료 현황과 진행 2건 후속 조치를 앞에 배치\\n\\n'
                '## 핵심 내용\\n'
                '- 민원 처리 결과는 완료 10건, 진행 2건으로 정리됩니다.\\n\\n'
                '## 현황 및 쟁점\\n'
                '- 접수 12건 중 완료 10건, 진행 2건입니다.\\n'
                '- 진행 2건의 담당자와 완료기한 관리가 필요합니다.\\n\\n'
                '## 조치안\\n'
                '- 담당자별 후속 조치와 완료기한을 명시합니다.\\n\\n'
                '## 기대효과 및 요청\\n'
                '- 민원 처리 지연 위험을 낮추고 보고 추적성을 확보합니다.\\n\\n'
                '## 수집 근거\\n'
                '- 민원 처리 현황 파일: 접수 12건, 완료 10건, 진행 2건\\n\\n'
                '## 작성 품질 점검\\n'
                '- 두괄식 요약\\n'
                '- 한 문장 한 핵심"}'
            ),
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)
    client = _client(tmp_path)
    session_data = _seed_session_with_schedule_and_files(client, tmp_path)

    generated = client.post(
        "/api/documents/generate",
        json={
            "title": "민원 처리 1페이지 보고서",
            "purpose": "부서장 보고용 민원 처리 현황 정리",
            "template_key": "report",
            "source_session_id": session_data["session_id"],
            "outline": "민원 처리 결과를 1페이지 보고서로 작성",
            "document_format": "onePageReport",
            "audience_type": "부서장",
            "expected_length": "1쪽",
            "requested_action": "진행 2건의 기한과 담당자 확정",
            "direct_file_paths": [],
            "user_template_path": None,
            "output_name": "complaint-quality-report",
        },
    )

    assert generated.status_code == 201
    payload = generated.json()
    artifact = payload["artifact"]
    content_base_text = Path(payload["content_base"]["artifact"]["path"]).read_text(encoding="utf-8")
    review_text = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    hwpx_text = _extract_hwpx_text(Path(artifact["path"]))
    assert len(llm_calls) >= 2
    call_texts = ["\n".join(str(message.get("text", "")) for message in call) for call in llm_calls]
    assert any("WorkSessionBrief" in text for text in call_texts)
    assert any("DocumentPlan" in text and "public-doc-to-hwpx" in text for text in call_texts)
    assert "## WorkSessionBrief" in content_base_text
    assert "## DocumentPlan" in content_base_text
    assert "접수 12건, 완료 10건, 진행 2건" in review_text
    assert "담당자별 후속 조치" in review_text
    assert "Content Base 내용을 기준으로 정리합니다" not in review_text
    assert "민원 처리 결과는 완료 10건" in hwpx_text
    assert "담당자별 후속 조치" in hwpx_text


def test_document_generate_uses_builtin_public_doc_template_when_no_user_template(
    tmp_path: Path, monkeypatch
) -> None:
    client = _client(tmp_path)
    _calls, fake_generate_reply = _fake_document_generate_pipeline_reply(
        title="기본 양식 적용 보고",
        summary="내장 1페이지 보고서 양식을 기준으로 핵심 내용을 정리합니다.",
        current_status="사용자 지정 양식이 없으므로 내장 public-doc-to-hwpx skeleton을 사용합니다.",
        action="내장 표준 서식 확인",
        evidence=["내장 기본 서식"],
    )
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    generated = client.post(
        "/api/documents/generate",
        json={
            "title": "기본 양식 적용 보고",
            "purpose": "내장 표준 서식 확인",
            "template_key": "report",
            "source_session_id": None,
            "outline": "내장 1페이지 보고서 양식에 맞춰 핵심만 정리",
            "document_format": "onePageReport",
            "direct_file_paths": [],
            "user_template_path": None,
            "output_name": "builtin-template-report",
        },
    )

    assert generated.status_code == 201
    artifact = generated.json()["artifact"]
    assert artifact["format"] == "onePageReport"
    assert artifact["template_source"] == "builtin"
    assert artifact["template_path"].replace("\\", "/").endswith("public_doc_templates/format_1p/skeleton.hwpx")

    hwpx_text = _extract_hwpx_text(Path(artifact["path"]))
    assert "기본 양식 적용 보고" in hwpx_text
    assert "공무 워크스페이스 생성 내용" not in hwpx_text
    assert "{{" not in hwpx_text


def test_document_attachment_upload_can_feed_generate_endpoint(tmp_path: Path, monkeypatch) -> None:
    client = _client(tmp_path)
    uploaded = client.post(
        "/api/documents/attachments",
        files={"files": ("evidence.txt", b"secure local AI evidence", "text/plain")},
    )
    assert uploaded.status_code == 201
    item = uploaded.json()["items"][0]
    assert item["file_name"] == "evidence.txt"
    assert Path(item["stored_path"]).exists()
    _calls, fake_generate_reply = _fake_document_generate_pipeline_reply(
        title="첨부 근거 보고",
        summary="secure local AI evidence를 핵심 근거로 반영합니다.",
        current_status="첨부 파일의 내용을 보고서 근거자료로 사용합니다.",
        action="핵심 근거로 반영",
        evidence=[item["stored_path"], "secure local AI evidence", "핵심 근거로 반영"],
    )
    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)

    generated = client.post(
        "/api/documents/generate",
        json={
            "title": "첨부 근거 보고",
            "purpose": "첨부 파일 기반 보고서 작성",
            "template_key": "report",
            "source_session_id": None,
            "outline": "첨부 파일을 근거자료로 활용\n\n첨부/연결 파일 활용 계획:\n- evidence.txt: 핵심 근거로 반영",
            "document_format": "onePageReport",
            "direct_file_paths": [item["stored_path"]],
            "user_template_path": None,
            "output_name": "attachment-report",
        },
    )
    assert generated.status_code == 201
    review_text = Path(generated.json()["artifact"]["markdown_path"]).read_text(encoding="utf-8")
    assert item["stored_path"] in review_text
    assert "secure local AI evidence" in review_text
    assert "핵심 근거로 반영" in review_text


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


def test_public_document_writer_strips_markdown_markup_before_hwpx_slots(tmp_path: Path) -> None:
    output_path = tmp_path / "markdown-clean.hwpx"
    content_markdown = """# 회의 준비 보고

## WorkSessionBrief
- **회의 일정 등록**: 내일 오후 2시 회의 일정이 등록됨.

## DocumentPlan
- **전략**: 두괄식과 개조식으로 정리.

## 핵심 내용
*   **회의 일정 등록**: 회의 전 준비사항 확인 필요.
*   **프롬프트 자료 검토**: 맥락, 구체성, 제약조건을 확인해야 함.

## 현황 및 쟁점
- **진행 사항**: GraphRAG 근거와 연결 파일을 확보함.
- **현황:**
  - 회의 일정 등록 완료.

## 조치안
- **후속 조치**: 회의 전 자료 검토 및 활용방안 결정.

## 기대효과 및 요청
- **요청 사항**: 부서장 검토 요청.

## 수집 근거
- **세션 연결 파일 근거**: 프롬프트 엔지니어링 원칙 확인.

## 작성 품질 점검
- **두괄식 준수**: 결론을 앞부분에 배치.
"""

    artifact = write_public_hwpx_document(
        title="회의 준비 보고",
        purpose="회의 전 자료 검토",
        template_key="report",
        content_markdown=content_markdown,
        output_path=output_path,
        document_format="onePageReport",
        audience_type="부서장",
        expected_length="1페이지",
        requested_action="회의 전 자료 검토",
    )

    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    hwpx_text = _extract_hwpx_text(output_path)
    assert "**" not in review_markdown
    assert "**" not in hwpx_text
    assert "◦ *" not in hwpx_text
    assert "현황:</hp:t>" not in hwpx_text
    assert "회의 일정 등록: 회의 전 준비사항 확인 필요" in hwpx_text
    assert "프롬프트 자료 검토: 맥락, 구체성, 제약조건을 확인해야 함" in hwpx_text


def test_onepage_skeleton_values_follow_public_doc_marker_rules() -> None:
    payload = build_public_document_payload(
        title="마커 정규화 보고",
        purpose="public-doc 1페이지 마커 규칙 확인",
        template_key="report",
        content_markdown="""# 마커 정규화 보고

## 핵심 내용
- 첫 번째 핵심
- - 두 번째 핵심

## 현황 및 쟁점
- ○ 현황 항목
- - 자동 bullet 항목

## 조치안
- 조치 항목
- - 세부 조치

## 기대효과 및 요청
- 기대효과 항목
- 요청사항 항목

## 수집 근거
- 근거 항목

## 작성 품질 점검
- 두괄식
- - 개조식
- * 한 문장 한 핵심
""",
        document_format="onePageReport",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))
    assert values["text_004"].startswith("□ ")
    assert values["text_009"].startswith("□ ")
    assert values["text_014"].startswith("□ ")
    assert values["text_019"].startswith("□ ")
    assert values["text_005"].startswith("◦ ")
    assert values["text_006"].startswith("◦ ")
    assert values["text_010"].startswith("◦ ")
    assert values["text_015"].startswith("◦ ")
    assert values["text_024"].startswith("◦ ")
    child_notes = [
        values[token]
        for token in ["text_008", "text_013", "text_018", "text_023"]
        if "__EMPTY_PLACEHOLDER__" not in values[token]
    ]
    assert all(value.startswith(" * ") for value in child_notes)
    assert not values["text_012"].lstrip().startswith("-")
    assert not values["text_017"].lstrip().startswith("-")


def test_builtin_public_document_formats_follow_template_marker_hierarchy() -> None:
    payload = build_public_document_payload(
        title="마커 위계 점검",
        purpose="양식별 기본 마커 위계를 확인",
        template_key="report",
        content_markdown="""# 마커 위계 점검

## 핵심 내용
- 핵심 항목
- 세부 항목
- 주석 항목

## 현황 및 쟁점
- 현황 항목
- 현황 세부
- 현황 주석

## 조치안
- 조치 항목
- 조치 세부
- 조치 주석

## 기대효과 및 요청
- 기대효과 항목
- 기대효과 세부
- 기대효과 주석

## 수집 근거
- 근거 항목
- 근거 세부
- 근거 주석
""",
        document_format="onePageReport",
    )
    onepage = _build_skeleton_values(payload, render_public_document_lines(payload))
    assert onepage["text_004"].startswith("□ ")
    assert onepage["text_005"].startswith("◦ ")
    assert not onepage["text_007"].lstrip().startswith("-")
    onepage_notes = [
        onepage[token]
        for token in ["text_008", "text_013", "text_018", "text_023"]
        if "__EMPTY_PLACEHOLDER__" not in onepage[token]
    ]
    assert all(value.startswith(" * ") for value in onepage_notes)

    full_payload = build_public_document_payload(
        title="풀버전 마커 위계 점검",
        purpose="풀버전 보고서 마커 위계를 확인",
        template_key="meeting",
        content_markdown=payload.document_purpose + "\n\n" + """## 핵심 내용
- 핵심 항목
- 세부 항목
- 주석 항목

## 현황 및 쟁점
- 현황 항목
- 현황 세부
- 현황 주석
""",
        document_format="fullReport",
    )
    full_report = _build_skeleton_values(full_payload, render_public_document_lines(full_payload))
    assert full_report["본문_절_001"].startswith("□ ")
    assert not full_report["본문_항목_001"].lstrip().startswith(("◦", "○", "-"))
    assert full_report["본문_세부_001"].startswith("   - ")
    assert full_report["본문_주석_001"].startswith("       ※ ")

    official_payload = build_public_document_payload(
        title="시행문 마커 위계 점검",
        purpose="시행문 마커 위계를 확인",
        template_key="report",
        content_markdown="""# 시행문 마커 위계 점검

## 핵심 내용
- 핵심 항목

## 현황 및 쟁점
- 현황 항목

## 조치안
- 조치 항목

## 수집 근거
- 근거 항목
- 근거 세부
""",
        document_format="officialMemo",
    )
    official = _build_skeleton_values(official_payload, render_public_document_lines(official_payload))
    assert official["text_007"].startswith("1. ")
    assert official["목차_항목_001"].startswith("가. ")
    assert official["text_010"].startswith("1) ")
    assert official["text_011"].startswith("가) ")
    assert official["text_012"].startswith("(1) ")
    assert official["text_013"].startswith("① ")


def test_public_document_payload_excludes_internal_authoring_plan_from_evidence() -> None:
    payload = build_public_document_payload(
        title="사춘기 자녀 대화법",
        purpose="사춘기 자녀와 효과적으로 대화하는 방법 정리",
        template_key="report",
        content_markdown="""# 사춘기 자녀 대화법

## WorkSessionBrief
- 시험 불안을 느끼는 자녀에게 먼저 공감하고 현재 할 수 있는 일을 제안합니다.
- 말투 변화는 정체성 형성 과정으로 보고 비난하지 않습니다.

## DocumentPlan
- 콘텐츠 기초데이터 정리: 대화 전략을 추출합니다.
- 작성목적/서식 결정: onePageReport 양식을 선택합니다.
- HWPX skeleton 채움: 필수 항목을 포함합니다.

## 핵심 내용
- 차분한 목소리와 나 전달법으로 대화합니다.
- 규칙은 일관되게 적용하되 자녀 의견을 일부 반영합니다.

## 현황 및 쟁점
- 시험 불안과 말투 변화로 부모와 자녀 간 오해가 생길 수 있습니다.

## 조치안
- 감정 인정 후 현재 할 수 있는 행동을 함께 정합니다.
- 긍정 행동은 구체적으로 칭찬합니다.

## 기대효과 및 요청
- 상호 존중 기반의 안정적 대화 관계를 형성합니다.

## 수집 근거
- 대화 전략: 공감, 나 전달법, 경청, 규칙 설정

## 작성 품질 점검
- 원칙 준수: 두괄식 구성
- 형식 적합성: 공공기관 보고서 형식
""",
        document_format="onePageReport",
    )

    joined_evidence = "\n".join(payload.evidence)
    assert "대화 전략" in joined_evidence
    assert "콘텐츠 기초데이터" not in joined_evidence
    assert "작성목적/서식 결정" not in joined_evidence
    assert "HWPX skeleton" not in joined_evidence


def test_onepage_slots_use_report_content_not_internal_quality_checks() -> None:
    payload = build_public_document_payload(
        title="사춘기 자녀 대화법",
        purpose="사춘기 자녀와 효과적으로 대화하는 방법 정리",
        template_key="report",
        content_markdown="""# 사춘기 자녀 대화법

## 핵심 내용
- 차분한 목소리와 나 전달법으로 대화합니다.
- 규칙은 일관되게 적용하되 자녀 의견을 일부 반영합니다.

## 현황 및 쟁점
- 시험 불안과 말투 변화로 부모와 자녀 간 오해가 생길 수 있습니다.
- 부모가 말투 자체를 지적하면 대화가 방어적으로 바뀔 수 있습니다.

## 조치안
1. 감정 인정 후 현재 할 수 있는 행동을 함께 정합니다.
2. 긍정 행동은 구체적으로 칭찬합니다.
3. 공통 관심사로 대화 시작점을 만듭니다.

## 기대효과 및 요청
- 상호 존중 기반의 안정적 대화 관계를 형성합니다.
- 대화 원칙을 가정 내 공통 기준으로 적용합니다.

## 수집 근거
- 대화 전략: 공감, 나 전달법, 경청, 규칙 설정

## 작성 품질 점검
- 원칙 준수: 두괄식 구성
- 명확성: 조치안이 구체적 행동 지침 포함
- 형식 적합성: 공공기관 보고서 형식
- 누락/불확실: 확인 필요 사항 없음
""",
        document_format="onePageReport",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))
    visible_text = "\n".join(str(value) for value in values.values())
    assert "원칙 준수" not in visible_text
    assert "형식 적합성" not in visible_text
    assert "누락/불확실" not in visible_text
    assert "◦ 1." not in values["text_015"]
    assert not values["text_017"].startswith("3.")
    assert "나 전달법" in visible_text
    assert "공감" in visible_text


def test_onepage_skeleton_body_slots_stay_non_empty_for_viewer_compatibility() -> None:
    payload = build_public_document_payload(
        title="사춘기 자녀 대화법",
        purpose="사춘기 자녀와 효과적으로 대화하는 방법 정리",
        template_key="report",
        content_markdown="""# 사춘기 자녀 대화법

## 핵심 내용
- 차분한 목소리와 나 전달법으로 대화합니다.
- 규칙은 일관되게 적용하되 자녀 의견을 일부 반영합니다.

## 현황 및 쟁점
- 시험 불안과 말투 변화로 부모와 자녀 간 오해가 생길 수 있습니다.
- 부모가 말투 자체를 지적하면 대화가 방어적으로 바뀔 수 있습니다.

## 조치안
1. 감정 인정 후 현재 할 수 있는 행동을 함께 정합니다.
2. 긍정 행동은 구체적으로 칭찬합니다.
3. 공통 관심사로 대화 시작점을 만듭니다.

## 기대효과 및 요청
- 상호 존중 기반의 안정적 대화 관계를 형성합니다.
- 대화 원칙을 가정 내 공통 기준으로 적용합니다.

## 수집 근거
- 대화 전략: 공감, 나 전달법, 경청, 규칙 설정
- 상담 메모: 시험 불안, 말투 변화, 규칙 갈등
""",
        document_format="onePageReport",
        audience_type="보호자",
        requested_action="대화 원칙을 가정 내 공통 기준으로 적용",
        deadline="2026-06-10",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))
    viewer_sensitive_slots = ["text_012", "text_013", "text_026"]
    assert all(str(values[slot]).strip() for slot in viewer_sensitive_slots)


@pytest.mark.parametrize("document_format", ["officialMemo", "onePageReport", "fullReport", "email"])
def test_public_document_outputs_hide_internal_authoring_metadata(
    tmp_path: Path, document_format: str
) -> None:
    artifact = write_public_hwpx_document(
        title="사춘기 자녀 대화법",
        purpose="사춘기 자녀와 효과적으로 대화하는 방법 정리",
        template_key="report",
        content_markdown="""# 사춘기 자녀 대화법

## WorkSessionBrief
- 시험 불안을 느끼는 자녀에게 먼저 공감하고 현재 할 수 있는 일을 제안합니다.
- 말투 변화는 정체성 형성 과정으로 보고 비난하지 않습니다.

## DocumentPlan
- 콘텐츠 기초데이터 정리: 대화 전략을 추출합니다.
- 작성목적/서식 결정: onePageReport 양식을 선택합니다.
- 서식 슬롯에 맞춘 콘텐츠 수정: 핵심 원칙을 두괄식으로 구성합니다.
- HWPX skeleton 채움: 필수 항목을 포함합니다.

## 핵심 내용
- 차분한 목소리와 나 전달법으로 대화합니다.
- 규칙은 일관되게 적용하되 자녀 의견을 일부 반영합니다.

## 현황 및 쟁점
- 시험 불안과 말투 변화로 부모와 자녀 간 오해가 생길 수 있습니다.

## 조치안
1. 감정 인정 후 현재 할 수 있는 행동을 함께 정합니다.
2. 긍정 행동은 구체적으로 칭찬합니다.
3. 공통 관심사로 대화 시작점을 만듭니다.

## 기대효과 및 요청
- 상호 존중 기반의 안정적 대화 관계를 형성합니다.

## 수집 근거
- 대화 전략: 공감, 나 전달법, 경청, 규칙 설정

## 작성 품질 점검
- 원칙 준수: 두괄식 구성
- 형식 적합성: 공공기관 보고서 형식
""",
        output_path=tmp_path / f"clean-{document_format}.hwpx",
        document_format=document_format,
        audience_type="보호자",
        requested_action="대화 원칙을 가정 내 공통 기준으로 적용",
        deadline="2026-06-10",
    )

    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    assert "콘텐츠 기초데이터" not in plain_text
    assert "작성목적/서식 결정" not in plain_text
    assert "HWPX skeleton" not in plain_text
    assert "작성 품질 점검" not in plain_text
    assert "형식 적합성" not in plain_text
    assert "차분한 목소리" in plain_text
    assert "공감" in plain_text


@pytest.mark.parametrize("document_format", ["officialMemo", "onePageReport", "fullReport", "email"])
def test_public_document_hwpx_body_preserves_core_content_for_all_formats(
    tmp_path: Path, document_format: str
) -> None:
    artifact = write_public_hwpx_document(
        title="사춘기 자녀 대화법",
        purpose="사춘기 자녀와 효과적으로 대화하는 방법 정리",
        template_key="report",
        content_markdown="""# 사춘기 자녀 대화법

## 핵심 내용
- 차분한 목소리와 나 전달법으로 대화합니다.
- 규칙은 일관되게 적용하되 자녀 의견을 일부 반영합니다.

## 현황 및 쟁점
- 시험 불안과 말투 변화로 부모와 자녀 간 오해가 생길 수 있습니다.

## 조치안
1. 감정 인정 후 현재 할 수 있는 행동을 함께 정합니다.
2. 긍정 행동은 구체적으로 칭찬합니다.

## 기대효과 및 요청
- 상호 존중 기반의 안정적 대화 관계를 형성합니다.

## 수집 근거
- 대화 전략: 공감, 나 전달법, 경청, 규칙 설정
""",
        output_path=tmp_path / f"core-{document_format}.hwpx",
        document_format=document_format,
        audience_type="보호자",
        requested_action="대화 원칙을 가정 내 공통 기준으로 적용",
        deadline="2026-06-10",
    )

    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    assert "차분한 목소리" in plain_text
    assert "나 전달법" in plain_text
    assert "공감" in plain_text
    assert "상호 존중" in plain_text


def test_onepage_skeleton_values_avoid_repeating_same_line_in_neighbor_slots() -> None:
    payload = build_public_document_payload(
        title="중복 방지 보고",
        purpose="반복 문장 방지",
        template_key="report",
        content_markdown="""# 중복 방지 보고

## 핵심 내용
- 회의 일정 등록 완료
- 파일찾기 안내 완료

## 현황 및 쟁점
- 진행 사항: 회의 일정 등록 및 기능 안내 완료
- 확보된 근거: 프롬프트 자료 확인

## 조치안
- 일정 관리: 회의 후속 조치 계획 수립
- 자료 활용: 확보 근거를 업무에 적용

## 기대효과 및 요청
- 업무 효율성 증대
- 활용 방안 결정 요청

## 작성 품질 점검
- 두괄식
""",
        document_format="onePageReport",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))
    assert values["text_010"] != values["text_011"]
    assert values["text_011"].replace("◦ ", "").strip() != values["text_012"].strip()
    assert values["text_015"] != values["text_016"]
    assert values["text_016"].replace("◦ ", "").strip() != values["text_017"].strip()


def test_onepage_skeleton_values_remove_repeated_child_bullets() -> None:
    payload = PublicDocumentPayload(
        title="경기도 AI활용 현황 정리",
        document_purpose="1페이지 보고서 바로 작성",
        selected_format="onePageReport",
        summary=[
            "사업명: 경기교육디지털플랫폼 구축사업",
            "총 사업비: 43,289,713천 원",
        ],
        background=[
            "요약: 경기교육디지털플랫폼 구축을 통한 생성형 AI 기반 교육 행정 서비스 도입 및 운영 현황 보고",
        ],
        current_status=[
            "'24년 POC를 통해 생활기록부 및 학교생활 관련 AI 서비스 가능성 검증 완료",
            "현재 시스템 구축 단계로 사용자별 맞춤형 서비스 설계 중",
        ],
        issues=[
            "'24년 POC를 통해 생활기록부 및 학교생활 관련 AI 서비스 가능성 검증 완료",
            "현재 시스템 구축 단계로 사용자별 맞춤형 서비스 설계 중",
            "대규모 예산 투입 사업으로 철저한 사업 관리 필요",
        ],
        solutions=[
            "교육공동체포털 및 생성형 AI 대화형 서비스 구축",
            "업무협업포털 및 AI 기반 협업 서비스 도입",
            "1차 오픈: '25. 11. 14. (금)",
        ],
        expected_effects=[
            "교육 공동체 대상 개인 맞춤형 정보 제공 서비스 실현",
            "교육 공동체 대상 개인 맞춤형 정보 제공 서비스 실현",
        ],
        actions=["1차 오픈: '25. 11. 14. (금)"],
        requested_action=[],
        evidence=["경기도교육청AI시스템사례.pdf (p.3 사업개요 및 추진일정)"],
        quality_checks=[],
        related="경기도교육청AI시스템사례.pdf",
        recipient="관련 부서",
        sender="공무 워크스페이스",
        deadline="기한 미정",
        security_level="일반",
        expected_length="미지정",
        urgency_level="보통",
        needs_traceability="미지정",
        requires_official_form="미지정",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))

    repeated_groups = [
        ["text_005", "text_006", "text_007", "text_008"],
        ["text_015", "text_016", "text_017", "text_018"],
        ["text_020", "text_021", "text_022", "text_023"],
    ]
    for group in repeated_groups:
        filled = [_skeleton_slot_key(values.get(token)) for token in group]
        filled = [value for value in filled if value]
        assert len(filled) == len(set(filled))


def test_onepage_skeleton_values_do_not_emit_generic_child_fillers_for_sparse_content() -> None:
    payload = PublicDocumentPayload(
        title="공공기관 AI활용 사례보고",
        document_purpose="공공기관 AI 활용 사례를 분석하여 정책적 시사점을 도출",
        selected_format="onePageReport",
        summary=[
            "공공부문 리터러시 격차 해소와 실무 적용 역량 강화가 시급함",
            "리터러시 교육 병행 및 디지털 플랫폼 기반 AI 서비스 구축 사례 확인",
        ],
        background=[],
        current_status=[
            "공공부문 리터러시 교육 및 AI 기반 서비스 시범 운영 사례 존재",
            "기관별 AI 활용 역량 수준 격차 존재 및 기술 도입과 행정 적용 간 괴리 발생 가능성",
        ],
        issues=[
            "공공부문 리터러시 교육 및 AI 기반 서비스 시범 운영 사례 존재",
            "기관별 AI 활용 역량 수준 격차 존재 및 기술 도입과 행정 적용 간 괴리 발생 가능성",
        ],
        solutions=[
            "수준별·대상별 맞춤형 AI 리터러시 교육을 확대하여 전반적 이해도 증진",
            "실제 업무와 연결된 AI 활용 프로젝트를 의무화하여 실무 적용 역량 강화",
        ],
        expected_effects=["구성원 AI 활용 역량 향상을 통한 행정 효율성 증대 및 사용자 중심 서비스 제공"],
        actions=[],
        requested_action=[],
        evidence=["공공기관 AI활용 사례.pdf"],
        quality_checks=[],
        related="공공기관 AI활용 사례.pdf",
        recipient="관련 부서",
        sender="공무 워크스페이스",
        deadline="기한 미정",
        security_level="내부",
        expected_length="1페이지",
        urgency_level="보통",
        needs_traceability="미지정",
        requires_official_form="미지정",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))
    visible_text = "\n".join(_skeleton_slot_key(value) for value in values.values())

    forbidden_fillers = [
        "검토 배경을 간결하게 정리",
        "세부 쟁점은 후속 검토에서 보완합니다",
        "핵심 쟁점은 실행 과정에서 계속 점검합니다",
        "검토 요청",
        "기한: 기한 미정",
    ]
    for filler in forbidden_fillers:
        assert filler not in visible_text
    assert _skeleton_slot_key(values["text_022"]) == ""


def test_onepage_skeleton_values_preserve_distinct_child_notes_when_provided() -> None:
    payload = PublicDocumentPayload(
        title="공공기관 AI활용 사례보고",
        document_purpose="공공기관 AI활용 사례 검토",
        selected_format="onePageReport",
        summary=["AI 활용 사례를 검토", "정책 적용 가능성을 확인"],
        background=["AI 리터러시 교육 병행 필요", "검토 범위는 교육·행정 서비스 사례 중심"],
        current_status=["시범 운영 사례가 확인됨", "기관별 역량 격차가 존재"],
        issues=["기관별 역량 격차가 존재", "데이터 보안 기준 정비 필요", "교육과 실무 적용 간 연계 부족"],
        solutions=["수준별 리터러시 교육 확대", "실무형 AI 프로젝트 운영", "보안 가이드라인 병행"],
        expected_effects=["행정 효율성 증대", "사용자 중심 서비스 제공"],
        actions=["후속 검토회의에서 적용 범위 확정", "부서별 실행과제 도출"],
        requested_action=["정책 제언 검토 요청"],
        evidence=["공공기관 AI활용 사례.pdf", "교육 플랫폼 구축 자료.pdf"],
        quality_checks=[],
        related="공공기관 AI활용 사례.pdf",
        recipient="관련 부서",
        sender="공무 워크스페이스",
        deadline="2026-06-10",
        security_level="내부",
        expected_length="1페이지",
        urgency_level="보통",
        needs_traceability="미지정",
        requires_official_form="미지정",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))

    assert values["text_008"].startswith(" * ")
    assert "검토 범위" in values["text_008"]
    assert values["text_013"].startswith(" * ")
    assert "교육과 실무 적용" in values["text_013"]
    assert "보안 가이드라인" in values["text_017"]
    assert values["text_018"].startswith(" * ")
    assert "후속 검토회의" in values["text_018"]


def test_onepage_skeleton_values_suppress_repeated_purpose_sentence_across_sections() -> None:
    repeated_purpose = (
        "본 보고서는 공공기관의 AI 활용 사례를 분석하여 정책적 시사점을 도출하고 "
        "향후 AI 도입 로드맵 수립을 위한 구체적인 제언을 목적으로 한다."
    )
    payload = PublicDocumentPayload(
        title="공공기관 AI활용 사례보고",
        document_purpose="공공기관 AI활용 사례보고",
        selected_format="onePageReport",
        summary=[repeated_purpose, "공공부문 AI 리터러시 교육 병행 필요"],
        background=[repeated_purpose],
        current_status=["리터러시 격차와 실무 적용 역량 차이가 확인됨"],
        issues=[repeated_purpose, "기관별 AI 활용 역량 수준 격차 존재"],
        solutions=["교육 강화와 실무 연계 프로젝트 도입"],
        expected_effects=[repeated_purpose, "행정 효율성 증대"],
        actions=[],
        requested_action=[repeated_purpose],
        evidence=["공공기관 AI활용 사례.pdf"],
        quality_checks=[],
        related="공공기관 AI활용 사례.pdf",
        recipient="관련 부서",
        sender="공무 워크스페이스",
        deadline="",
        security_level="내부",
        expected_length="1페이지",
        urgency_level="보통",
        needs_traceability="미지정",
        requires_official_form="미지정",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))
    filled = [_skeleton_slot_key(value) for value in values.values()]
    repeated_count = sum(1 for value in filled if value == repeated_purpose)

    assert repeated_count == 1


def test_llm_json_parser_repairs_common_markdown_invalid_escapes(tmp_path: Path) -> None:
    client = _client(tmp_path)
    parsed = client.app.state.services._parse_llm_json_object(
        '```json\n{"content_markdown":"근거: The Art of Prompt Engineering\\_Beginner"}\n```'
    )
    assert parsed["content_markdown"] == "근거: The Art of Prompt Engineering_Beginner"


@pytest.mark.parametrize(
        ("document_format", "expected_phrases"),
        [
            ("officialMemo", ["수신", "부서장", "끝.", "협조", "폐쇄망 테스트 PC"]),
            ("onePageReport", ["□ 개요", "□ 현황 및 쟁점", "폐쇄망 테스트 PC"]),
            ("fullReport", ["목 차", "추진배경 및 목적", "근거 및 연결자료"]),
            ("email", ["제목:", "요청 기한: 2026-06-05", "폐쇄망 테스트 PC"]),
    ],
)
def test_public_document_formats_keep_quality_with_gemma_style_markdown(
    tmp_path: Path, document_format: str, expected_phrases: list[str]
) -> None:
    content_markdown = """# AI 업무 추진 보고

## WorkSessionBrief
- **목적:** 폐쇄망 로컬 AI 업무도구 도입 논의 결과를 보고.
- **핵심 내용:** 일정 등록, 파일검색, GraphRAG 지식검색, 문서작성 자동화 검토.

## DocumentPlan
1. **콘텐츠 기초데이터 정리:** 세션 내용과 연결 파일, GraphRAG 근거를 구분.
2. **작성목적/서식 결정:** 부서장 보고용 공공문서 작성.
3. **서식 슬롯에 맞춘 콘텐츠 수정:** 두괄식, 개조식, 출처 분리.

## 핵심 내용
*   **로컬 우선:** 폐쇄망에서도 업무대화와 문서작성이 가능해야 함.
*   **GraphRAG 활용:** 지식폴더의 근거를 출처와 함께 제시해야 함.

## 현황 및 쟁점
- **현황:**
  - 업무대화에서 일정 등록과 파일검색이 가능함.
  - GraphRAG 지식검색 결과를 문서작성 근거로 사용할 수 있음.
- **쟁점:** 모델 응답 품질이 낮을 경우 문서 구조와 근거가 흔들릴 수 있음.
- **확인 필요:** 부서별 업무폴더 색인 범위 확정.

## 조치안
- **품질게이트 도입:** JSON 복구, Markdown 정리, 서식 슬롯 검사를 자동화.
- **검증자료 축적:** 4개 보고서식별 샘플 산출물을 비교.

## 기대효과 및 요청
- **기대효과:** 의사결정자가 30초 안에 핵심을 파악.
- **요청사항:** 폐쇄망 테스트 PC에서 샘플 보고서 검토.

## 수집 근거
- **업무대화 근거:** 일정 등록, 파일찾기, GraphRAG 검색 결과.
- **연결 파일 근거:** AI 업무 추진계획 초안.
- **GraphRAG 근거:** 프롬프트 품질은 맥락과 제약조건에 의해 결정.

## 작성 품질 점검
- **두괄식:** 결론과 요청을 앞에 배치.
- **개조식:** 한 문장 한 핵심.
"""
    output_path = tmp_path / f"quality-{document_format}.hwpx"

    artifact = write_public_hwpx_document(
        title="AI 업무 추진 보고",
        purpose="폐쇄망 로컬 AI 업무도구 도입 검토",
        template_key="report",
        content_markdown=content_markdown,
        output_path=output_path,
        document_format=document_format,
        audience_type="부서장",
        expected_length="1페이지" if document_format == "onePageReport" else "자동",
        requested_action="폐쇄망 테스트 PC에서 샘플 보고서 검토",
        deadline="2026-06-05",
        security_level="내부",
    )

    raw_text = _extract_hwpx_text(Path(artifact["path"]))
    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    assert "{{" not in raw_text
    assert "**" not in raw_text
    assert "**" not in review_markdown
    assert "◦ *" not in raw_text
    assert "Content Base 내용을 기준으로 정리합니다" not in plain_text
    assert "현황:</hp:t>" not in raw_text
    assert "- -" not in plain_text
    for phrase in expected_phrases:
        assert phrase in plain_text
    assert "GraphRAG" in plain_text
    assert "로컬" in plain_text


def test_email_document_preserves_session_and_knowledge_context(tmp_path: Path) -> None:
    content_markdown = """# AI 회의 후속 보고서

## WorkSessionBrief
- 사용자는 회의 일정 등록 뒤 지식폴더에서 프롬프트 관련 자료를 찾도록 요청했다.
- 업무대화 세션에는 파일찾기 사용법, 일정 확인, GraphRAG 검색 결과, 보고서 작성 요청이 함께 남아 있다.

## DocumentPlan
- 회의 준비자료 검토 요청을 이메일 본문으로 정리한다.
- 지식폴더 출처와 후속 조치 기한을 함께 남긴다.

## 핵심 내용
- AI 회의 후속 보고서는 지식폴더 근거와 업무대화 흐름을 함께 반영해야 한다.

## 수집 근거
- [knowledge] The Art of Prompt Engineering_Beginner: 프롬프트는 맥락과 출력형식이 명확할수록 결과 품질이 높아진다.
- [schedule] AI 업무 회의: 2026-06-05 15:00~16:00, 다목적홀

## 작성 품질 점검
- 두괄식: 요청사항과 기한을 먼저 제시한다.
- 출처: 지식폴더 문서와 일정 정보를 근거로 남긴다.
"""
    artifact = write_public_hwpx_document(
        title="AI 회의 후속 안내 메일",
        purpose="회의 준비자료 검토와 참석자 공유 요청",
        template_key="report",
        content_markdown=content_markdown,
        output_path=tmp_path / "email-context.hwpx",
        document_format="email",
        audience_type="참석자",
        requested_action="2026년 6월 5일 회의 전 자료 확인",
        deadline="2026-06-05",
        security_level="내부",
    )

    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    assert "제목:" in plain_text
    assert "AI 회의 후속 보고서" in plain_text
    assert "지식폴더" in plain_text
    assert "GraphRAG" in plain_text
    assert "The Art of Prompt Engineering_Beginner" in plain_text
    assert "2026-06-05" in plain_text


@pytest.mark.parametrize("document_format", ["onePageReport", "fullReport"])
def test_public_document_sparse_sections_do_not_emit_content_base_placeholder(
    tmp_path: Path, document_format: str
) -> None:
    artifact = write_public_hwpx_document(
        title="민원 처리 현황 보고서",
        purpose="민원 접수 현황과 지연 건의 후속 조치 계획을 보고",
        template_key="report",
        content_markdown="""# 민원 처리 현황 보고서

## WorkSessionBrief
- 접수 12건 중 완료 10건, 진행 2건입니다.
- 지연 2건은 담당자와 완료 예정일 확인이 필요합니다.

## DocumentPlan
- 완료 현황과 지연 사유를 먼저 제시합니다.

## 수집 근거
- 민원 처리 현황 파일: 접수 12건, 완료 10건, 진행 2건
""",
        output_path=tmp_path / f"sparse-{document_format}.hwpx",
        document_format=document_format,
        audience_type="민원총괄 부서장",
        requested_action="2026년 6월 8일까지 지연 민원 담당자와 완료 예정일 확정",
        deadline="2026-06-08",
    )

    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    assert "Content Base 내용을 기준으로 정리합니다" not in plain_text
    assert "민원" in plain_text
    assert "지연" in plain_text


@pytest.mark.parametrize("document_format", ["officialMemo", "onePageReport", "fullReport", "email"])
def test_public_document_formats_clean_gemma_markdown_escapes_across_contexts(
    tmp_path: Path, document_format: str
) -> None:
    content_markdown = """# 프롬프트 자료 검토 회의 보고

## WorkSessionBrief
- 사용자: 내일 오후 2시 회의 일정 등록하고 지식폴더에서 프롬프트 관련 자료 찾아줘.
- 어시스턴트: 일정 등록 완료. GraphRAG 근거로 Prompt Engineering\\_Beginner, claude-master-guide 문서를 제시.
- 결론: 프롬프트 자료 검토 회의 후속 조치와 출처 확인이 필요.

## DocumentPlan
1. **세션 맥락 정리:** 일정 등록, 지식폴더 검색, 출처 문서 확인을 분리.
2. **자료 활용 계획:** Prompt Engineering\\_Beginner의 맥락·제약조건 원칙을 보고서 근거로 사용.
3. **보고서화:** 회의 목적, 검토 쟁점, 후속 조치를 두괄식으로 정리.

## 핵심 내용
- 프롬프트 품질은 맥락, 구체성, 제약조건에 의해 결정됨.
- GraphRAG 검색 결과는 실제 파일 출처와 함께 제시되어야 함.

## 현황 및 쟁점
- 프롬프트 자료는 지식폴더에 색인되어 있으나 보고서에는 출처와 활용방안을 분리해야 함.
- 모델 응답에 Markdown escape가 섞이면 HWPX 산출물 가독성이 떨어짐.

## 조치안
- Prompt Engineering\\_Beginner와 claude-master-guide를 검토 자료로 지정.
- 회의 일정과 지식검색 결과를 같은 업무 맥락으로 묶어 후속 검토.

## 기대효과 및 요청
- 회의 참석자가 프롬프트 작성 원칙과 출처 문서를 빠르게 확인.
- 요청사항: 2026-06-05 회의 전까지 자료 검토.

## 수집 근거
- GraphRAG 근거: Prompt Engineering\\_Beginner
- 연결 파일: C:\\Users\\USER\\Documents\\AI자료모음\\Prompt Engineering\\_Beginner.pdf
"""
    artifact = write_public_hwpx_document(
        title="프롬프트 자료 검토 회의 보고",
        purpose="GraphRAG 검색 결과와 회의 일정을 묶어 검토 자료로 정리",
        template_key="report",
        content_markdown=content_markdown,
        output_path=tmp_path / f"gemma-escape-{document_format}.hwpx",
        document_format=document_format,
        audience_type="회의 참석자",
        requested_action="2026-06-05 회의 전까지 자료 검토",
        deadline="2026-06-05",
        security_level="내부",
    )

    raw_text = _extract_hwpx_text(Path(artifact["path"]))
    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    assert "\\_" not in raw_text
    assert "\\_" not in review_markdown
    assert "Prompt Engineering_Beginner" in plain_text
    assert "GraphRAG" in plain_text
    assert "2026-06-05" in plain_text
    assert "사용자:" not in plain_text
    assert "어시스턴트:" not in plain_text


def test_official_memo_keeps_receiver_label_and_input_slot_separate(tmp_path: Path) -> None:
    artifact = write_public_hwpx_document(
        title="프롬프트 자료 검토 협조 요청",
        purpose="GraphRAG 검색 근거를 회의 전 검토하도록 협조 요청",
        template_key="report",
        content_markdown="""# 프롬프트 자료 검토 협조 요청

## 핵심 내용
- 프롬프트 자료 검토가 필요함.

## 조치안
- 회의 참석자는 2026-06-05 전까지 자료를 검토.

## 수집 근거
- Prompt Engineering_Beginner
""",
        output_path=tmp_path / "receiver-slot.hwpx",
        document_format="officialMemo",
        audience_type="회의 참석자",
        requested_action="자료 검토 협조",
        deadline="2026-06-05",
    )

    raw_text = _extract_hwpx_text(Path(artifact["path"]))
    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    assert "수신: 회의 참석자" not in plain_text
    assert "<hp:t>수신</hp:t>" in raw_text
    assert "회의 참석자" in plain_text
    assert "{{수신자}}" not in raw_text


def test_official_memo_expands_body_paragraphs_like_public_doc_skill(tmp_path: Path) -> None:
    artifact = write_public_hwpx_document(
        title="프롬프트 자료 검토 협조 요청",
        purpose="GraphRAG 검색 근거와 회의 후속 조치를 검토하도록 협조 요청",
        template_key="report",
        content_markdown="""# 프롬프트 자료 검토 협조 요청

## 핵심 내용
- 회의 전 프롬프트 자료 검토 필요.
- 파일찾기 사용법 안내 결과 반영.
- GraphRAG 검색 결과 출처 확인.

## 현황 및 쟁점
- 쟁점 A: 일정 등록은 완료되었으나 참석자별 사전 검토가 필요.
- 쟁점 B: Prompt Engineering_Beginner 자료의 활용 범위 확정 필요.
- 쟁점 C: claude-master-guide 자료의 참고 범위 확정 필요.

## 조치안
- 조치 A: 참석자에게 사전 검토 요청.
- 조치 B: 프롬프트 품질 기준을 회의 안건에 반영.
- 조치 C: 검토 결과를 업무대화 세션에 다시 기록.

## 수집 근거
- 근거 A: Prompt Engineering_Beginner
- 근거 B: claude-master-guide
- 근거 C: 프롬프트 작성 원칙 파일
- 근거 D: 업무대화 세션 요약
""",
        output_path=tmp_path / "official-dynamic-body.hwpx",
        document_format="officialMemo",
        audience_type="회의 참석자",
        requested_action="회의 전 자료 검토 협조",
        deadline="2026-06-05",
    )

    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    for phrase in [
        "쟁점 A",
        "쟁점 B",
        "쟁점 C",
        "조치 A",
        "조치 B",
        "조치 C",
        "근거 A",
        "근거 B",
        "근거 C",
        "근거 D",
    ]:
        assert phrase in plain_text


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
            ("officialMemo", "부서장"),
            ("onePageReport", "□ 개요"),
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
    if document_format == "email":
        assert artifact["template_source"] == "builtin"
        assert artifact["template_path"].replace("\\", "/").endswith("public_doc_templates/format_email/skeleton.hwpx")
    hwpx_text = _extract_hwpx_text(Path(artifact["path"]))
    assert "문서 유형 테스트" in hwpx_text
    assert expected_phrase in hwpx_text
