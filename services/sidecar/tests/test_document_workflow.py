import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import pytest
from hwpx import HwpxDocument

from gongmu_sidecar.app import PUBLIC_DOC_AUTHORING_GUIDE, create_app
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


def _assert_hwpx_xml_well_formed(path: Path) -> None:
    with ZipFile(path) as archive:
        assert archive.testzip() is None
        for name in archive.namelist():
            if name.lower().endswith(".xml"):
                ET.fromstring(archive.read(name))


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


def test_large_structured_authoring_attachment_returns_limited_source_analysis(tmp_path: Path) -> None:
    client = _client(tmp_path)
    large_pdf = tmp_path / "large-ai-guide.pdf"
    large_pdf.write_bytes(b"%PDF-1.4\n" + (b"large attachment evidence\n" * 900_000))

    response = client.post(
        "/api/documents/content-bases",
        json={
            "title": "Large attachment report",
            "purpose": "Summarize the directly attached source file",
            "reference_set_id": None,
            "template_key": "report",
            "source_session_id": None,
            "outline": "Use the attached file first and warn when only partial analysis is possible.",
            "document_format": "onePageReport",
            "direct_file_paths": [str(large_pdf)],
            "user_template_path": None,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    analysis = payload["source_analysis"]
    assert analysis["budget_bytes"] == 32 * 1024
    assert analysis["overall_mode"] == "limited"
    assert analysis["warnings"]
    assert analysis["direct_files"][0]["path"] == str(large_pdf)
    assert analysis["direct_files"][0]["analysis_mode"] == "limited"
    assert "large-ai-guide.pdf" in payload["content"]


def test_direct_authoring_attachment_skips_graphrag_unless_requested(tmp_path: Path, monkeypatch) -> None:
    client = _client(tmp_path)
    attached = tmp_path / "image-production-notes.md"
    attached.write_text(
        "Lighting First, Camera Reality, Skin Texture, and Life Motion are the four core AI image rules.",
        encoding="utf-8",
    )
    retrieve_calls: list[dict] = []

    def fake_retrieve(**kwargs):
        retrieve_calls.append(kwargs)
        return {
            "items": [
                {
                    "document": {"title": "Unrelated CLI policy", "file_path": "policy.md"},
                    "text": "CLI precedence and runtime policy are unrelated to image production.",
                }
            ]
        }

    monkeypatch.setattr(client.app.state.services.graphrag, "retrieve", fake_retrieve)

    response = client.post(
        "/api/documents/content-bases",
        json={
            "title": "AI image production notes",
            "purpose": "Create a one page report from the attached file",
            "reference_set_id": None,
            "template_key": "report",
            "source_session_id": None,
            "outline": "Summarize the directly attached AI image production notes.",
            "document_format": "onePageReport",
            "direct_file_paths": [str(attached)],
            "user_template_path": None,
        },
    )

    assert response.status_code == 201
    assert retrieve_calls == []
    content = response.json()["content"]
    assert "Lighting First" in content
    assert "Unrelated CLI policy" not in content


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


def test_document_generate_recovers_loose_content_markdown_json_from_llm(
    tmp_path: Path, monkeypatch
) -> None:
    call_count = 0

    def fake_generate_reply(settings, messages, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return LLMGenerationResult(
                text=json.dumps(
                    {
                        "summary": ["풀버전 보고서는 Content Base 장 구조를 유지해야 합니다."],
                        "background": ["사용자는 장 수가 늘어나는 풀버전 보고서를 요청했습니다."],
                        "current_status": ["기존 고정 슬롯 방식은 장 수 제한이 있었습니다."],
                        "issues": ["LLM이 content_markdown JSON 문자열에 raw newline을 넣을 수 있습니다."],
                        "solutions": ["느슨한 content_markdown을 복구해 HWPX 산출을 계속합니다."],
                        "expected_effects": ["사용자 화면에서 fetch fail 없이 산출물을 받을 수 있습니다."],
                        "actions": ["문서작성 결과를 회귀 테스트로 검증합니다."],
                        "requested_action": ["풀버전 보고서 가변 구조 검토"],
                        "evidence": ["컴퓨터유즈 UI 생성 시나리오"],
                        "quality_checks": ["목차와 본문 구조 일치"],
                        "confidence": 0.8,
                    },
                    ensure_ascii=False,
                ),
                provider="ollama",
                model="gemma4:e2b",
            )
        return LLMGenerationResult(
            text=(
                '{"content_markdown":"# 풀버전 가변 구조 검증\n\n'
                '## WorkSessionBrief\n'
                '- 풀버전 보고서는 장 수 제한 없이 작성되어야 합니다.\n\n'
                '## DocumentPlan\n'
                '- 동적 목차와 본문을 유지합니다.\n\n'
                '## 목차\n'
                '1. 업무 배경\n'
                '2. 개선 방향\n'
                '3. 후속 관리\n\n'
                '## 핵심 내용\n'
                '### 업무 배경\n'
                '- 사용자는 풀버전 보고서의 완전 가변 구조를 요청했습니다.\n'
                '- 기존 고정 슬롯 방식은 장 수가 늘어날 때 누락 위험이 있습니다.\n\n'
                '### 개선 방향\n'
                '- Content Base의 장 제목과 본문 항목을 그대로 유지합니다.\n'
                '- 중간 Markdown과 HWPX 구조가 일치하도록 생성합니다.\n\n'
                '### 후속 관리\n'
                '- 실제 UI 생성 흐름을 회귀 테스트로 남깁니다.\n'
                '- 경로 예시 C:\\Users\\USER\\Documents\\검증자료.pdf 도 본문에 들어갈 수 있습니다.\n\n'
                '## 수집 근거\n'
                '- 컴퓨터유즈 UI 생성 시나리오\n\n'
                '## 작성 품질 점검\n'
                '- 목차와 본문 구조 일치"}'
            ),
            provider="ollama",
            model="gemma4:e2b",
        )

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)
    client = _client(tmp_path)

    generated = client.post(
        "/api/documents/generate",
        json={
            "title": "풀버전 가변 구조 검증",
            "purpose": "컴퓨터유즈 UI 흐름에서 풀버전 보고서 생성 검증",
            "template_key": "meeting",
            "source_session_id": None,
            "outline": "풀버전 보고서를 장 수 제한 없이 작성",
            "document_format": "fullReport",
            "direct_file_paths": [],
            "user_template_path": None,
            "output_name": "loose-json-full-report",
        },
    )

    assert generated.status_code == 201
    payload = generated.json()
    content_base_text = Path(payload["content_base"]["artifact"]["path"]).read_text(encoding="utf-8")
    plain_text = _extract_hwpx_plain_text(Path(payload["artifact"]["path"]))
    assert "## WorkSessionBrief" in content_base_text
    assert "### 업무 배경" in content_base_text
    assert "경로 예시" in content_base_text
    assert "업무 배경" in plain_text
    assert "개선 방향" in plain_text
    assert "후속 관리" in plain_text


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
    dynamic_sections = full_report["__full_report_dynamic_body__"]
    assert "__EMPTY_PLACEHOLDER__" in full_report["본문_절_001"]
    assert any(section.heading == "추진배경 및 목적" for section in dynamic_sections)
    assert any("핵심 항목" in item for section in dynamic_sections for item in section.body)
    assert any("세부 항목" in item for section in dynamic_sections for item in section.body)
    assert any("주석 항목" in item for section in dynamic_sections for item in section.body)

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


def test_onepage_report_preserves_dynamic_core_sections_in_review_markdown(tmp_path: Path) -> None:
    artifact = write_public_hwpx_document(
        title="AI컨텐츠 제작 노하우 정리",
        purpose="1페이지 보고서 바로 작성",
        template_key="report",
        content_markdown="""# AI 콘텐츠 제작 핵심 노하우 정리 보고서

## WorkSessionBrief
AI 인플루언서 제작 시, 비현실적인 디테일 대신 자연스러운 질감과 미묘한 생동감을 강조하여 콘텐츠의 현실성과 몰입도를 높이는 방안을 정리함.

## DocumentPlan
1. **콘텐츠 제작 핵심 원칙**: 디테일 지양 및 빛/질감 중심의 프롬프트 전략 수립
2. **시각적 요소의 자연스러움 확보**: 조명, 카메라, 피부 질감의 중요성 강조
3. **심리학적 연출 적용**: 인물 움직임을 통한 감정 유도 기법 활용
4. **결론 및 가이드라인**: 제작 시 적용할 핵심 프롬프트 가이드라인 제시

## 1페이지 목차
1. 제작의 기본 원칙: 질감과 생동감 중심 접근
2. 시각적 완성도 제어: 빛과 질감의 우선순위
3. 심리적 몰입 유도: 움직임 연출의 과학
4. 핵심 프롬프트 가이드라인

## 핵심 내용
### 제작의 기본 원칙: 질감과 생동감 중심 접근
* AI 생성 시 과도한 디테일은 부자연스러움을 유발함.
* 성공적인 콘텐츠는 현실적인 질감과 미묘한 생명력 포착에 중점을 둠.
* 기술적 디테일보다 빛과 질감 조절 관련 이해가 필수적임.

### 시각적 완성도 제어: 빛과 질감의 우선순위
* **조명(Lighting First)**: 장면의 분위기와 현실감을 먼저 설정하는 것이 핵심.
* **피부 표현**: '완벽함'보다 '질감(Skin Texture)'을 중시하여 생동감을 부여해야 함.
* **카메라 설정**: 현실감 확보를 위해 카메라 구도를 정교하게 지정해야 함.

### 심리적 몰입 유도: 움직임 연출의 과학
* **수평 이동**: 왼쪽에서 오른쪽 이동은 자연스럽고 편안하게 인식됨.
* **수직 이동**: 위에서 아래로의 움직임은 중력에 기반하여 자연스럽고 수월하게 느껴짐.

### 핵심 프롬프트 가이드라인
* 생성 모델에 비현실적 디테일 요청을 지양하고, 빛, 질감, 카메라 구도를 최우선으로 반영하도록 지시.
* 인물의 움직임 설계 시 수평·수직 이동에 따른 심리학적 원리를 적용하여 프롬프트를 구성.

## 수집 근거
* **AI 인플루언서 제작 시 비현실적 요소 지양**: 피부의 완벽함, 과도한 색감 등은 피하고 자연스러운 질감과 미묘한 생명감을 포착해야 함.
* **빛과 질감의 중요성**: 자연스러움은 빛, 카메라, 피부 질감, 미세한 생명감에서 비롯됨.
""",
        output_path=tmp_path / "dynamic-core.hwpx",
        document_format="onePageReport",
    )

    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    assert "□ 제작의 기본 원칙" in review_markdown
    assert "□ 시각적 완성도 제어" in review_markdown
    assert "□ 심리적 몰입 유도" in review_markdown
    assert "□ 핵심 프롬프트 가이드라인" in review_markdown
    assert "조명(Lighting First)" in review_markdown
    assert "◦ 기술적 디테일보다 빛과 질감 조절" in review_markdown
    assert "수평 이동" in review_markdown
    assert "생성 모델에 비현실적 디테일 요청" in review_markdown
    assert "###" not in review_markdown
    assert "수집된 업무 맥락을 기준으로 정리합니다" not in review_markdown
    assert "후속 조치와 적용 기준을 확인" not in review_markdown


def test_onepage_report_preserves_content_base_same_level_bullets(tmp_path: Path) -> None:
    artifact = write_public_hwpx_document(
        title="AI를 활용한 콘텐츠 제작 핵심 노하우 정리",
        purpose="1페이지 보고서 바로 작성",
        template_key="report",
        content_markdown="""# AI 인플루언서 콘텐츠 제작 핵심 노하우 정리

## 목차
1. AI 인플루언서 사실성 제고를 위한 기본 원칙
2. 인물 및 디테일 묘사 강화 방안
3. 카메라 및 공간 연출의 심리학적 적용
4. 최종 제작 전략 요약

## 핵심 내용
### AI 인플루언서 사실성 제고를 위한 기본 원칙
- 빛을 우선하여 장면을 구성하는 연출 원칙 적용
- 카메라 설정을 현실적으로 고정하여 시각적 사실성 확보
- 피부 표현 시 완벽함보다 질감과 미세한 흔적을 통해 생동감 부여
- 생체 움직임(Life Motion) 디테일을 보강하여 현실감 증대

### 인물 및 디테일 묘사 강화 방안
- 과도한 대칭 및 선명한 디테일 배제
- 인물 묘사 시 질감 표현에 중점, 매끄러움 지양
- 미묘한 흔적을 활용하여 인물에 생동감 부여

### 카메라 및 공간 연출의 심리학적 적용
- 수평 이동 방향을 시청자에게 편안한 방향(좌→우)으로 설계
- 수직 이동 방향(위→아래)을 중력의 원리를 활용하여 자연스럽게 연출
- 이동 방향성을 심리학적 원리에 따라 의도적으로 설계하여 몰입 유도

### 최종 제작 전략 요약
- 기술적 디테일보다 심리적 연출 요소를 우선 고려한 프롬프트 설계
- 빛(Lighting First), 카메라(Camera Reality), 질감(Skin Texture), 움직임(Life Motion) 통합 적용

## 수집 근거
- AI 인플루언서 제작 비밀 관련 문서
""",
        output_path=tmp_path / "same-level-onepage.hwpx",
        document_format="onePageReport",
    )

    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    assert "□ AI 인플루언서 사실성 제고를 위한 기본 원칙" in review_markdown
    assert "□ AI 인플루언서 사실성 제고를 위한 기본 원\n" not in review_markdown
    assert "◦ 피부 표현 시 완벽함보다 질감과 미세한 흔적을 통해 생동감 부여" in review_markdown
    assert "◦ 생체 움직임(Life Motion) 디테일을 보강하여 현실감 증대" in review_markdown
    assert "- 피부 표현 시 완벽함보다 질감과 미세한 흔적을 통해 생동감 부여" not in review_markdown
    assert "* 생체 움직임(Life Motion) 디테일을 보강하여 현실감 증대" not in review_markdown

    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    assert "피부 표현 시 완벽함보다 질감과 미세한 흔적을 통해 생동감 부여" in plain_text
    assert "생체 움직임(Life Motion) 디테일을 보강하여 현실감 증대" in plain_text


def test_onepage_report_does_not_invent_fourth_section_for_three_part_content_base(tmp_path: Path) -> None:
    artifact = write_public_hwpx_document(
        title="인공지능을 활용한 컨텐츠 제작 노하우 정리",
        purpose="1페이지 보고서 바로 작성",
        template_key="report",
        content_markdown="""# 인공지능을 활용한 사실적인 AI 인플루언서 콘텐츠 제작 노하우 정리

## 목차
1. 핵심 원칙: 사실감 확보의 3대 축
2. 프롬프트 실전 전략: 생동감 부여 기법
3. 품질 점검 체크리스트

## 핵심 내용
### 핵심 원칙: 사실감 확보의 3대 축
- **조명 우선 원칙 (Lighting First):** 빛이 사진을 결정하며 사실감을 증진함.
- **카메라 지정 원칙 (Camera Reality):** 카메라 설정을 통해 현실적인 시점을 지정하여 사실성을 높임.
- **피부 질감 강조 (Skin Texture):** 피부는 완벽함보다 질감과 미세한 결점을 포함해야 생동감이 생김.

### 프롬프트 실전 전략: 생동감 부여 기법
- **과도한 디테일 지양:** 지나친 선명도, 과장된 포즈, 비현실적 배경 요소 사용을 지양해야 함.
- **질감 묘사 강화:** 피부 텍스처 묘사 시 '질감'과 '미세한 흔들림' 등 현실적 요소를 추가함.
- **일관성 유지:** 특정 시간대를 고정하여 결과물의 일관성을 확보함.

### 품질 점검 체크리스트
- 조명 설정이 이미지에 명확하게 반영되었는지 확인.
- 피부 표현이 과도하게 매끄럽지 않고 자연스러운 질감을 갖추었는지 점검.
- 전반적인 이미지 톤이 비현실적인 선명함이나 과장된 색감을 포함하지 않았는지 검토.

## 수집 근거
- AI 인플루언서 제작 시, 빛과 카메라 설정이 사실감을 결정한다는 원칙.
""",
        output_path=tmp_path / "three-part-onepage.hwpx",
        document_format="onePageReport",
    )

    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    assert "□ 핵심 원칙" in review_markdown
    assert "□ 프롬프트 실전 전략" in review_markdown
    assert "□ 품질 점검 체크리스트" in review_markdown
    assert "피부 질감 강조" in review_markdown
    assert "일관성 유지" in review_markdown
    assert "전반적인 이미지 톤" in review_markdown
    assert "향후계획·요청사항" not in review_markdown
    assert "후속 절차를 명확히" not in review_markdown
    assert "수집된 업무 맥락" not in review_markdown


def test_authoring_guide_requires_format_specific_document_style_contracts() -> None:
    assert "1페이지 보고서 문체" in PUBLIC_DOC_AUTHORING_GUIDE
    assert "개조체" in PUBLIC_DOC_AUTHORING_GUIDE
    assert "풀버전 보고서 문체" in PUBLIC_DOC_AUTHORING_GUIDE
    assert "시행문 문체" in PUBLIC_DOC_AUTHORING_GUIDE
    assert "이메일 문체" in PUBLIC_DOC_AUTHORING_GUIDE
    assert "짧은 문장 또는 개조식" not in PUBLIC_DOC_AUTHORING_GUIDE


def test_full_report_preserves_dynamic_content_base_sections_in_review_markdown(tmp_path: Path) -> None:
    artifact = write_public_hwpx_document(
        title="AI 콘텐츠 제작 노하우 상세 보고",
        purpose="풀버전 보고서로 작성",
        template_key="meeting",
        content_markdown="""# AI 콘텐츠 제작 노하우 상세 보고

## DocumentPlan
1. 제작 원칙: 자연스러운 질감 중심
2. 조명·카메라 운용: 사실감 확보
3. 검토 기준: 품질 점검 체계화

## 목차
1. 제작 원칙
2. 조명·카메라 운용
3. 검토 기준

## 핵심 내용
### 제작 원칙
* 비현실적 디테일보다 질감과 생동감 중심으로 정리함.
* 피부 질감과 작은 흔들림을 우선 반영함.

### 조명·카메라 운용
* Lighting First 원칙으로 장면의 사실감을 먼저 결정함.
* 카메라 앵글과 구도를 현실적으로 지정함.

### 검토 기준
* 결과물의 사실감, 질감, 움직임을 분리해 점검함.
* 반복 수정 기준을 기록해 재사용 가능하게 함.

## 수집 근거
* AI 인플루언서 제작 가이드북50
""",
        output_path=tmp_path / "dynamic-full.hwpx",
        document_format="fullReport",
    )

    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    assert "I. 제작 원칙" in review_markdown
    assert "II. 조명·카메라 운용" in review_markdown
    assert "III. 검토 기준" in review_markdown
    assert "추진배경 및 목적" not in review_markdown
    assert "현황 및 쟁점" not in review_markdown
    assert "비현실적 디테일보다 질감" in review_markdown
    assert "Lighting First" in review_markdown


def test_full_report_uses_dedicated_outline_parser_for_nested_content_base_sections(tmp_path: Path) -> None:
    content_markdown = """# AI 인플루언서 제작을 위한 시각적 연출 노하우 정리

## WorkSessionBrief
- AI 인플루언서 제작 시 비현실성을 제거하고 자연스러운 질감과 생동감을 확보하는 연출 노하우를 정리함.

## DocumentPlan
- 보고 목적: AI 인플루언서 콘텐츠의 시각적 완성도와 몰입도를 높이기 위한 제작 원칙 제시.
- 보고 구조: 현황, 핵심 원칙, 심리학 기반 연출, 프롬프트 적용, 제작 가이드라인 순으로 구성.

## 목차
1. 현황 및 문제점
    1.1. 비현실적 요소로 인한 콘텐츠 자연스러움 저해
    1.2. 핵심 이슈 분석
2. 자연스러움을 위한 4대 핵심 원칙
    2.1. 빛이 사진을 결정한다 (Lighting First)
    2.2. 카메라를 지정하면 현실성이 확보된다 (Camera Reality)
3. 심리학 기반 시각 연출 전략
    3.1. 수평 이동의 심리학
    3.2. 수직 이동의 심리학
4. 구체적 프롬프트 적용 방안
    4.1. 현실적인 질감 및 생동감 표현
    4.2. 프롬프트 구조화
5. 향후 제작 가이드라인
    5.1. 즉시 적용 가능한 체크리스트

## 핵심 내용
### 1. 현황 및 문제점
- AI 인플루언서 제작 시 과도한 선명한 디테일과 완벽한 대칭이 자연스러움을 저해함.
- 피부의 완벽함 추구는 실제와 동떨어진 결과물을 초래함.

### 2. 자연스러움을 위한 4대 핵심 원칙
- 조명 설정을 최우선 변수로 지정하여 사진의 기본적인 현실성을 확보해야 함.
- 카메라 위치와 시점을 명확히 지정하여 이미지의 현실감을 높여야 함.
- 피부 질감과 미세한 흔들림을 포함해 생동감을 구현해야 함.

### 3. 심리학 기반 시각 연출 전략
- 왼쪽에서 오른쪽으로 이동하는 장면은 편안함과 긍정적 인식을 유도함.
- 위에서 아래로 이동하는 장면은 중력을 활용해 자연스러운 흐름을 만듦.

### 4. 구체적 프롬프트 적용 방안
- Lighting, Camera, Motion 순서로 프롬프트를 구조화함.
- 피부 질감, 자연스러운 모공, 미세한 땀방울 같은 구체 표현을 포함함.

### 5. 향후 제작 가이드라인
- 조명, 카메라, 질감, 움직임 기준을 체크리스트로 관리함.
- 결과물의 사실감과 생동감을 분리해 검토함.

## 수집 근거
- AI 인플루언서 제작 가이드북50
"""
    payload = build_public_document_payload(
        title="AI 인플루언서 제작을 위한 시각적 연출 노하우 정리",
        purpose="풀버전 보고서 바로 작성",
        template_key="report",
        content_markdown=content_markdown,
        document_format="fullReport",
    )

    assert [section.heading for section in payload.report_core_sections] == [
        "현황 및 문제점",
        "자연스러움을 위한 4대 핵심 원칙",
        "심리학 기반 시각 연출 전략",
        "구체적 프롬프트 적용 방안",
        "향후 제작 가이드라인",
    ]
    assert payload.report_core_sections[2].body == [
        "왼쪽에서 오른쪽으로 이동하는 장면은 편안함과 긍정적 인식을 유도함.",
        "위에서 아래로 이동하는 장면은 중력을 활용해 자연스러운 흐름을 만듦.",
    ]

    artifact = write_public_hwpx_document(
        title="AI 인플루언서 제작을 위한 시각적 연출 노하우 정리",
        purpose="풀버전 보고서 바로 작성",
        template_key="report",
        content_markdown=content_markdown,
        output_path=tmp_path / "nested-full-report.hwpx",
        document_format="fullReport",
    )

    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    for heading in [
        "I. 현황 및 문제점",
        "II. 자연스러움을 위한 4대 핵심 원칙",
        "III. 심리학 기반 시각 연출 전략",
        "IV. 구체적 프롬프트 적용 방안",
        "V. 향후 제작 가이드라인",
    ]:
        assert heading in review_markdown
    assert "심리학 기반 시각 연출 전략" in plain_text
    assert "구체적 프롬프트 적용 방안" in plain_text
    assert "향후 제작 가이드라인" in plain_text
    assert "현실적인 질감 및 생동감 표현" not in review_markdown.split("목차", 1)[1].split("I. 현황", 1)[0]


def test_full_report_generates_variable_body_sections_beyond_builtin_skeleton_slots(tmp_path: Path) -> None:
    section_names = [
        "기초 현황",
        "핵심 문제",
        "원칙 정립",
        "실행 전략",
        "품질 관리",
        "협업 방식",
        "운영 리스크",
        "정착 방안",
    ]
    outline = "\n".join(f"{index}. {name}" for index, name in enumerate(section_names, start=1))
    core = "\n\n".join(
        f"""### {index}. {name}
- {name}의 첫 번째 핵심 내용을 정리함.
- {name}의 두 번째 실행 기준을 제시함."""
        for index, name in enumerate(section_names, start=1)
    )
    content_markdown = f"""# AI 업무체계 고도화 풀버전 보고서

## WorkSessionBrief
- 사용자는 AI 업무체계 고도화를 위한 전체 실행계획을 풀버전 보고서로 정리하기를 요청함.

## DocumentPlan
- 고정 목차가 아니라 입력 내용의 8개 장을 모두 보존해야 함.

## 목차
{outline}

## 핵심 내용
{core}

## 수집 근거
- 업무대화 세션과 연결 파일을 근거로 정리
"""

    artifact = write_public_hwpx_document(
        title="AI 업무체계 고도화 풀버전 보고서",
        purpose="풀버전 보고서 완전 가변 구조 검증",
        template_key="report",
        content_markdown=content_markdown,
        output_path=tmp_path / "variable-full-report.hwpx",
        document_format="fullReport",
    )

    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    _assert_hwpx_xml_well_formed(Path(artifact["path"]))
    for index, name in enumerate(section_names, start=1):
        roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][index - 1]
        assert f"{roman}. {name}" in review_markdown
        assert name in plain_text
        assert f"{name}의 두 번째 실행 기준을 제시함" in plain_text
    assert "장07_제목" not in plain_text
    assert "본문_절_007" not in plain_text
    assert "헤드라인M 폰트" not in plain_text
    assert "구분 일정 내용" not in plain_text
    assert "Ⅱ Ⅲ Ⅳ Ⅴ" not in plain_text


def test_document_instruction_hints_promote_audience_action_and_deadline(tmp_path: Path) -> None:
    services = _client(tmp_path).app.state.services

    enriched = services._with_document_instruction_hints(
        {},
        """시행문 형식으로 AI 활용 교육 자료 제출 협조 요청 문서를 작성한다.
수신: 각 부서장
요청사항: 2026년 6월 12일까지 부서별 AI 활용 교육 수요와 보유 자료 목록을 제출
근거: 상반기 디지털 업무역량 강화 계획
본문에는 요청 배경, 제출 방법, 기한, 문의처를 포함한다.""",
    )

    assert enriched["audience_type"] == "각 부서장"
    assert enriched["requested_action"] == "2026년 6월 12일까지 부서별 AI 활용 교육 수요와 보유 자료 목록을 제출"
    assert enriched["deadline"] == "2026년 6월 12일"


def test_full_report_preserves_all_dynamic_section_items_in_hwpx(tmp_path: Path) -> None:
    artifact = write_public_hwpx_document(
        title="AI 콘텐츠 제작 노하우 상세 보고",
        purpose="풀버전 보고서로 작성",
        template_key="meeting",
        content_markdown="""# AI 콘텐츠 제작 노하우 상세 보고

## 목차
1. 제작 원칙

## 핵심 내용
### 제작 원칙
- 조명 우선 원칙을 적용함.
- 카메라 설정을 현실적으로 지정함.
- 피부 질감 표현을 강화함.
- 생체 움직임 디테일을 보강함.

## 수집 근거
- AI 인플루언서 제작 가이드북50
""",
        output_path=tmp_path / "dynamic-full-all-items.hwpx",
        document_format="fullReport",
    )

    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    assert "생체 움직임 디테일을 보강함" in review_markdown
    assert "생체 움직임 디테일을 보강함" in plain_text


def test_email_preserves_dynamic_content_base_items_without_two_line_collapse(tmp_path: Path) -> None:
    artifact = write_public_hwpx_document(
        title="AI 콘텐츠 제작 노하우 공유",
        purpose="이메일로 작성",
        template_key="email",
        content_markdown="""# AI 콘텐츠 제작 노하우 공유

## 목차
1. 제작 원칙

## 핵심 내용
### 제작 원칙
- 조명 우선 원칙을 적용함.
- 카메라 설정을 현실적으로 지정함.
- 피부 질감 표현을 강화함.
- 생체 움직임 디테일을 보강함.

## 수집 근거
- AI 인플루언서 제작 가이드북50
""",
        output_path=tmp_path / "dynamic-email-all-items.hwpx",
        document_format="email",
    )

    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    assert "생체 움직임 디테일을 보강함" in review_markdown
    assert "생체 움직임 디테일을 보강함" in plain_text
    assert "카메라 설정을 현실적으로 지정함 / 피부 질감 표현을 강화함" not in review_markdown


def test_official_memo_user_scenario_preserves_action_evidence_and_closing(tmp_path: Path) -> None:
    artifact = write_public_hwpx_document(
        title="AI 콘텐츠 제작 기준 적용 협조 요청",
        purpose="AI 이미지 제작 시 조명·카메라·질감 기준을 적용하도록 관계부서에 협조 요청",
        template_key="official",
        content_markdown="""# AI 콘텐츠 제작 기준 적용 협조 요청

## WorkSessionBrief
- 사용자는 AI 콘텐츠 제작 노하우를 관계부서가 실무에 적용할 수 있도록 시행문 형태로 정리하기를 요청함.

## DocumentPlan
- 수신부서가 바로 조치할 수 있도록 적용 기준과 요청사항을 먼저 제시함.
- 근거자료와 후속 확인기한을 함께 남김.

## 핵심 내용
- AI 이미지 제작 시 조명 우선 원칙, 카메라 현실성, 피부 질감 표현 기준을 적용해야 함.
- 결과물 검토 시 사실감, 자연스러운 질감, 생동감을 분리해 확인해야 함.

## 조치안
- 신규 AI 이미지 제작 요청서에 조명, 카메라, 질감 입력란을 포함함.
- 시범 제작물 3건을 기준으로 적용 여부를 점검함.

## 기대효과 및 요청
- 요청사항: 2026년 6월 10일까지 부서별 적용 가능 여부를 회신 바람.

## 수집 근거
- AI 인플루언서 제작 가이드북50: Lighting First, Camera Reality, Skin Texture 기준
""",
        output_path=tmp_path / "official-user-scenario.hwpx",
        document_format="officialMemo",
        audience_type="관계부서",
        requested_action="2026년 6월 10일까지 부서별 적용 가능 여부 회신",
        deadline="2026-06-10",
        security_level="내부",
    )

    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    assert "수신" in plain_text
    assert "관계부서" in plain_text
    assert "2026년 6월 10일까지 부서별 적용 가능 여부 회신" in plain_text
    assert "AI 인플루언서 제작 가이드북50" in plain_text
    assert "끝." in plain_text
    assert "작성 품질 점검" not in plain_text
    assert "{{" not in plain_text
    assert "요청사항:" not in review_markdown


def test_email_user_scenario_preserves_request_deadline_and_evidence_without_internal_metadata(tmp_path: Path) -> None:
    artifact = write_public_hwpx_document(
        title="AI 콘텐츠 제작 기준 공유 및 검토 요청",
        purpose="회의 참석자에게 AI 콘텐츠 제작 기준과 검토 요청사항을 이메일로 공유",
        template_key="email",
        content_markdown="""# AI 콘텐츠 제작 기준 공유 및 검토 요청

## WorkSessionBrief
- 사용자는 AI 콘텐츠 제작 노하우를 회의 참석자에게 공유하고 검토 의견을 요청하고자 함.

## DocumentPlan
- 이메일 첫 문단에 요청사항과 기한을 명확히 제시함.
- 본문에는 핵심 기준과 근거자료를 짧게 정리함.

## 핵심 내용
### 공유 요지
- 조명 우선 원칙은 이미지의 사실감을 결정하는 핵심 기준임.
- 카메라 현실성은 인물과 공간의 관계를 자연스럽게 보이게 함.
- 피부 질감과 미세한 움직임은 AI 인플루언서의 생동감을 높임.

## 요청사항
- 참석자는 회의 전 기준안을 검토하고 수정 의견을 회신해야 함.

## 수집 근거
- AI 인플루언서 제작 가이드북50: Lighting First, Camera Reality, Skin Texture 기준

## 작성 품질 점검
- 내부 점검 문구는 최종 메일 본문에 노출하지 않음.
""",
        output_path=tmp_path / "email-user-scenario.hwpx",
        document_format="email",
        audience_type="회의 참석자",
        requested_action="회의 전 기준안 검토 및 수정 의견 회신",
        deadline="2026-06-10",
        security_level="내부",
    )

    plain_text = _extract_hwpx_plain_text(Path(artifact["path"]))
    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    assert "제목: AI 콘텐츠 제작 기준 공유 및 검토 요청" in plain_text
    assert "회의 전 기준안 검토 및 수정 의견 회신" in plain_text
    assert "요청 기한: 2026-06-10" in plain_text
    assert "AI 인플루언서 제작 가이드북50" in plain_text
    assert "작성 품질 점검" not in plain_text
    assert "내부 점검 문구" not in plain_text
    assert "{{" not in plain_text
    assert "조명 우선 원칙" in review_markdown
    assert "카메라 현실성" in review_markdown


def test_official_memo_mapping_does_not_reinsert_redundant_effect_labels() -> None:
    payload = build_public_document_payload(
        title="AI 콘텐츠 제작 기준 시행",
        purpose="시행문으로 작성",
        template_key="report",
        document_format="officialMemo",
        content_markdown="""# AI 콘텐츠 제작 기준 시행

## 핵심 내용
- 비현실적 디테일보다 질감과 생동감 중심으로 정리함.

## 조치안
- 제작 요청 시 조명, 카메라, 질감 기준을 함께 명시함.

## 기대효과 및 요청
- 콘텐츠 제작 품질과 재현성을 높임.

## 수집 근거
- AI 인플루언서 제작 가이드북50
""",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))
    visible_text = "\n".join(str(value) for value in values.values())
    assert "기대효과:" not in visible_text
    assert "콘텐츠 제작 품질과 재현성" in visible_text


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


def test_onepage_skeleton_values_do_not_use_internal_direct_mode_purpose_as_subtitle() -> None:
    payload = PublicDocumentPayload(
        title="AI활용 노하우 정리",
        document_purpose="1페이지 보고서 바로 작성",
        selected_format="onePageReport",
        summary=[
            "AI 인플루언서 제작과 이미지 연출 노하우를 업무 활용 관점에서 정리함",
            "조명 우선 원칙과 자연스러운 질감 구현이 핵심임",
        ],
        background=["콘텐츠 제작 과정에서 반복 수정과 검토 기준이 필요함"],
        current_status=["AI 생성 결과물의 시각 품질 편차가 발생할 수 있음"],
        issues=["비현실적 디테일과 권한 설정 혼선 가능성 존재"],
        solutions=["조명과 카메라 구성을 먼저 확정하고 디테일 수정 기준을 정함"],
        expected_effects=["콘텐츠 제작 효율과 결과물 품질 향상"],
        actions=["실무 적용 가이드라인 수립"],
        requested_action=[],
        evidence=["AI활용 노하우 자료"],
        quality_checks=[],
        related="AI활용 노하우 자료",
        recipient="관련 부서",
        sender="공무 워크스페이스",
        deadline="",
        security_level="일반",
        expected_length="1페이지",
        urgency_level="보통",
        needs_traceability="미지정",
        requires_official_form="미지정",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))

    assert _skeleton_slot_key(values["text_002"]) != "1페이지 보고서 바로 작성"


def test_onepage_skeleton_values_follow_content_based_outline_for_policy_plan() -> None:
    payload = build_public_document_payload(
        title="공공기관 AI 도입 계획 보고",
        purpose="생성형 AI 기반 행정서비스 도입을 위한 사업·정책 계획 보고",
        template_key="report",
        document_format="onePageReport",
        content_markdown="""# 공공기관 AI 도입 계획 보고

## 핵심 내용
- 생성형 AI 기반 행정서비스 도입 방향과 추진체계를 정리합니다.
- 예산, 역할분담, 추진일정을 함께 검토합니다.

## 현황 및 쟁점
- 기관별 AI 활용 역량 격차가 존재합니다.
- 개인정보와 보안 기준 정비가 병행되어야 합니다.

## 조치안
- AI 리터러시 교육과 시범서비스 구축을 병행합니다.
- 단계별 추진체계와 예산 집행 기준을 마련합니다.

## 기대효과 및 요청
- 행정 효율성과 민원 응대 품질을 높입니다.
- 단계별 추진계획 검토를 요청합니다.
""",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))

    assert values["text_004"] == "□ 추진방향"
    assert values["text_009"] == "□ 추진배경·현황"
    assert values["text_014"] == "□ 주요내용"
    assert values["text_019"] == "□ 향후계획"


def test_onepage_skeleton_values_prefer_document_plan_outline_sections() -> None:
    payload = build_public_document_payload(
        title="AI 도구 도입 검토 보고",
        purpose="도입 여부 판단을 위한 검토 보고",
        template_key="report",
        document_format="onePageReport",
        content_markdown="""# AI 도구 도입 검토 보고

## DocumentPlan
- 섹션: 검토결과 - 조건부 도입을 권고합니다.
- 섹션: 검토배경·쟁점 - 보안과 비용 쟁점을 함께 검토합니다.
- 섹션: 대안검토 - 로컬모델과 외부 API를 비교합니다.
- 섹션: 결정요청 - 시범도입 범위 승인을 요청합니다.

## 핵심 내용
- AI 도구 도입 여부를 의사결정할 수 있도록 대안을 비교합니다.

## 현황 및 쟁점
- 폐쇄망 보안과 API 비용이 핵심 쟁점입니다.

## 조치안
- 로컬모델 우선, 외부 API 보완 방식으로 검토합니다.

## 기대효과 및 요청
- 검토 결과를 바탕으로 시범도입 범위를 확정합니다.
""",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))

    assert values["text_004"] == "□ 검토결과"
    assert values["text_009"] == "□ 검토배경·쟁점"
    assert values["text_014"] == "□ 대안검토"
    assert values["text_019"] == "□ 결정요청"


def test_onepage_payload_extracts_numbered_content_outline_from_content_base() -> None:
    content_markdown = """# AI 활용 콘텐츠 제작 핵심 노하우 정리

## WorkSessionBrief
AI 이미지 제작 시 현실감과 생동감을 확보하기 위한 핵심 원칙을 정리합니다.

## DocumentPlan
- 콘텐츠 기초데이터 정리: AI 이미지 품질을 결정하는 4대 원칙을 확정합니다.

## 1페이지 목차
1. AI 이미지 품질 결정 4대 핵심 원칙
2. 비현실성 제거를 위한 프롬프트 제약 조건
3. 생동감과 질감 구현 전략
4. 결론 및 적용 방안

## 핵심 내용
- 빛과 카메라가 이미지의 현실감을 결정합니다.
- 질감과 작은 움직임이 생동감을 만듭니다.

## 수집 근거
- 슈퍼 리얼 AI 인플루언서 가이드북50
"""
    payload = build_public_document_payload(
        title="AI 활용 콘텐츠 제작 노하우 정리",
        purpose="1페이지 보고서 바로 작성",
        template_key="report",
        document_format="onePageReport",
        content_markdown=content_markdown,
    )

    assert payload.onepage_outline_headings == [
        "AI 이미지 품질 결정 4대 핵심 원칙",
        "비현실성 제거를 위한 프롬프트 제약 조건",
        "생동감과 질감 구현 전략",
        "결론 및 적용 방안",
    ]
    values = _build_skeleton_values(payload, render_public_document_lines(payload))
    assert values["text_004"] == "□ AI 이미지 품질 결정 4대 핵심 원칙"
    assert values["text_009"] == "□ 비현실성 제거를 위한 프롬프트 제약 조건"
    assert values["text_014"] == "□ 생동감과 질감 구현 전략"
    assert values["text_019"] == "□ 결론 및 적용 방안"


def test_onepage_review_markdown_matches_dynamic_skeleton_outline(tmp_path: Path) -> None:
    content_markdown = """# AI 활용 콘텐츠 제작 핵심 노하우 정리

## WorkSessionBrief
AI 이미지 제작 시 현실감과 생동감을 확보하기 위한 핵심 원칙을 정리합니다.

## DocumentPlan
- 콘텐츠 기초데이터 정리: AI 이미지 품질을 결정하는 4대 원칙을 확정합니다.

## 1페이지 목차
1. AI 이미지 품질 결정 4대 핵심 원칙
2. 비현실성 제거를 위한 프롬프트 제약 조건
3. 생동감과 질감 구현 전략
4. 결론 및 적용 방안

## 핵심 내용
- 빛과 카메라가 이미지의 현실감을 결정합니다.
- 질감과 작은 움직임이 생동감을 만듭니다.

## 수집 근거
- 슈퍼 리얼 AI 인플루언서 가이드북50
"""

    artifact = write_public_hwpx_document(
        output_path=tmp_path / "ai-content.hwpx",
        title="AI 활용 콘텐츠 제작 노하우 정리",
        purpose="1페이지 보고서 바로 작성",
        template_key="report",
        content_markdown=content_markdown,
        document_format="onePageReport",
    )

    review_markdown = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    assert "□ AI 이미지 품질 결정 4대 핵심 원칙" in review_markdown
    assert "□ 비현실성 제거를 위한 프롬프트 제약 조건" in review_markdown
    assert "□ 생동감과 질감 구현 전략" in review_markdown
    assert "□ 결론 및 적용 방안" in review_markdown
    assert "1. 개요" not in review_markdown
    assert "2. 현황 및 쟁점" not in review_markdown


def test_onepage_skeleton_values_avoid_redundant_effect_and_request_labels_from_llm() -> None:
    payload = build_public_document_payload(
        title="AI활용 노하우 정리",
        purpose="콘텐츠 제작 노하우를 실무 적용 기준으로 정리",
        template_key="report",
        document_format="onePageReport",
        content_markdown="""# AI활용 노하우 정리

## 핵심 내용
- 조명 우선 원칙과 자연스러운 질감 구현이 핵심입니다.

## 조치안
- 반복 수정은 Edit 기능 중심으로 처리합니다.

## 기대효과 및 요청
- 효과: AI를 활용하여 높은 수준의 시각적 완성도를 갖춘 콘텐츠를 효율적으로 제작 가능합니다.
- 효과: 콘텐츠 제작 과정의 효율성이 증대되고 결과물의 품질이 향상됩니다.
- 요청사항: 실제 콘텐츠 제작 프로세스에 적용할 가이드라인 수립을 요청합니다.
""",
    )

    values = _build_skeleton_values(payload, render_public_document_lines(payload))
    effect_request_text = "\n".join(str(values.get(token, "")) for token in ["text_020", "text_021", "text_022", "text_023"])

    assert "효과:" not in effect_request_text
    assert "요청사항:" not in effect_request_text
    assert "시각적 완성도" in effect_request_text
    assert "가이드라인 수립" in effect_request_text


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
            ("onePageReport", ["□ 추진방향", "□ 추진배경·현황", "폐쇄망 테스트 PC"]),
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
            ("onePageReport", "□ 보고요지"),
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
