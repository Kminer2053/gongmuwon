import json
from pathlib import Path

import pytest

from gongmu_sidecar.app import create_app
from gongmu_sidecar.document_authoring import (
    FORMAT_SYSTEM_PROMPTS,
    GongmunItem,
    OnePageSection,
    SchemaEmail,
    SchemaFull,
    SchemaGongmun,
    SchemaOnePage,
    _sanitize_email_signature,
    extract_numeric_tokens,
    find_missing_numeric_tokens,
    register_authoring_routes,
    render_preview,
)
from gongmu_sidecar.hwpx_writer import split_summary_sentences


class StubLLM:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, messages, *, temperature=0.2):
        self.calls.append({"messages": messages, "temperature": temperature})
        if not self.responses:
            raise AssertionError("스텁 응답이 더 이상 없습니다.")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _client(tmp_path: Path, llm):
    app = create_app(tmp_path)
    register_authoring_routes(app, app.state.services, llm_complete=llm)
    return app.state.test_client_factory()


ORGANIZED_MD = """# 청사 에너지 절감 추진계획
## 추진 배경
- 2025년 청사 전력비 3.2억 원, 전년 대비 8% 증가
- 정부 에너지 절감 지침(2026.5.) 시달
## 주요 과제
- 냉난방 설정온도 자동제어 도입
- 옥상 태양광 50kW 증설
## 향후 조치
- 7월 중 자동제어 시범 적용
- 8월 예산 재배정 요구
"""

ONEPAGE_JSON = {
    "title": "청사 에너지 절감 추진계획 보고",
    "subtitle": "2026년 하반기 실행 중심",
    "summary": "전력 사용량 12% 절감을 위해 3개 과제를 하반기에 즉시 추진",
    "sections": [
        {
            "heading": "추진 배경",
            "items": ["2025년 청사 전력비 3.2억 원", "정부 에너지 절감 지침 시달"],
            "detail": "냉난방 전력이 전체의 61% 차지",
            "note": "공공기관 에너지이용 합리화 지침 근거",
        },
        {
            "heading": "향후 조치",
            "items": ["7월 중 자동제어 시범 적용", "8월 예산 재배정 요구"],
        },
    ],
}

FULL_JSON = {
    "title": "2026년 청사 에너지 절감 종합계획",
    "summary": ["전력 사용량 12% 절감 목표, 3대 과제 하반기 착수"],
    "chapters": [
        {
            "heading": "추진 배경",
            "sections": [{"heading": "현황", "items": ["2025년 전력비 3.2억 원"]}],
        },
        {
            "heading": "추진 과제",
            "sections": [
                {"heading": "설비 개선", "items": ["냉난방 자동제어 도입", "태양광 50kW 증설"]}
            ],
        },
        {
            "heading": "행정 사항",
            "sections": [{"heading": "일정·예산", "items": ["7월 시범 적용, 8월 예산 재배정"]}],
        },
    ],
    "schedule": {
        "rows": [
            {"항목": "자동제어 시범 적용", "일정": "2026.7.", "비고": "본관 우선"},
            {"항목": "태양광 증설 발주", "일정": "2026.9.", "비고": ""},
        ]
    },
}

GONGMUN_JSON = {
    "title": "청사 에너지 절감 협조 요청",
    "receiver": "각 부서장",
    "opening": "청사 에너지 절감 추진과 관련하여 아래와 같이 협조를 요청합니다.",
    "items": [
        {
            "text": "냉난방 설정온도 준수(하절기 26℃)",
            "subs": ["회의실 등 공용공간 우선 적용"],
        },
        {"text": "야간 대기전력 차단 협조"},
    ],
    "attachments": ["에너지 절감 실행계획 1부"],
    "sender": "행정지원과장",
}

EMAIL_JSON = {
    "subject": "[협조] 청사 에너지 절감 실천 안내",
    "greeting": "안녕하십니까, 행정지원과입니다.",
    "body_paragraphs": [
        "하절기 전력 수요 증가에 따라 부서별 에너지 절감 실천을 요청드립니다.",
        "냉방 설정온도 26℃ 준수와 퇴근 시 대기전력 차단을 부탁드립니다.",
    ],
    "closing": "협조에 감사드립니다.",
    "signature": "행정지원과 홍길동 주무관",
}


def _parse_sse(body: str):
    events = []
    for block in body.strip().split("\n\n"):
        event_name = None
        data = None
        for line in block.splitlines():
            if line.startswith("event: "):
                event_name = line[len("event: "):]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: "):])
        if event_name is not None:
            events.append((event_name, data))
    return events


# ---------------------------------------------------------------------------
# 양식 메타데이터
# ---------------------------------------------------------------------------


def test_formats_endpoint_lists_four_formats(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    response = client.get("/api/documents/authoring/formats")
    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["key"] for item in items] == [
        "officialMemo",
        "onePageReport",
        "fullReport",
        "email",
    ]
    assert all(item["label"] and item["description"] and item["schema_fields"] for item in items)


# ---------------------------------------------------------------------------
# 구조 생성 해피패스 (양식 4종)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("api_format", "canonical", "stage2_json", "preview_snippet"),
    [
        ("onepage", "onePageReport", ONEPAGE_JSON, "□ 추진 배경"),
        ("full", "fullReport", FULL_JSON, "Ⅰ. 추진 배경"),
        ("gongmun", "officialMemo", GONGMUN_JSON, "수신: 각 부서장"),
        ("email", "email", EMAIL_JSON, "제목: [협조] 청사 에너지 절감 실천 안내"),
    ],
)
def test_structure_happy_path_per_format(
    tmp_path: Path, api_format, canonical, stage2_json, preview_snippet
) -> None:
    stub = StubLLM([ORGANIZED_MD, json.dumps(stage2_json, ensure_ascii=False)])
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/structure",
        json={
            "format": api_format,
            "instruction": "청사 에너지 절감 문서를 작성해줘",
            "reference_texts": ["전력비 통계 자료 본문"],
            "stream": False,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["format"] == canonical
    assert payload["meta"] == {"attempts": 1, "repaired": False, "hints": []}
    assert preview_snippet in payload["preview"]
    assert payload["organized_markdown"].startswith("# 청사 에너지 절감 추진계획")
    assert [stage["stage"] for stage in payload["stages"]] == [
        "organize",
        "organize",
        "format",
        "format",
    ]

    # 1단계 프롬프트에 실패 방어 규칙과 지시·참고자료가 포함되어야 한다
    assert len(stub.calls) == 2
    organize_system = stub.calls[0]["messages"][0]["text"]
    assert "참고자료 자체를 주제로" in organize_system
    assert "비워 두지 않는다" in organize_system
    assert stub.calls[0]["temperature"] == pytest.approx(0.3)
    organize_user = stub.calls[0]["messages"][1]["text"]
    assert "청사 에너지 절감 문서를 작성해줘" in organize_user
    assert "전력비 통계 자료 본문" in organize_user
    # 2단계 프롬프트에는 완성 JSON 예시가 포함되어야 한다
    format_system = stub.calls[1]["messages"][0]["text"]
    assert '"title"' in format_system or '"subject"' in format_system


def test_structure_uses_session_transcript(tmp_path: Path) -> None:
    stub = StubLLM([ORGANIZED_MD, json.dumps(ONEPAGE_JSON, ensure_ascii=False)])
    client = _client(tmp_path, stub)

    session = client.post("/api/work-sessions", json={"title": "에너지 절감 논의"})
    session_id = session.json()["id"]
    client.post(
        f"/api/work-sessions/{session_id}/messages",
        json={"role": "user", "text": "태양광 증설 예산이 얼마였지?"},
    )

    response = client.post(
        "/api/documents/authoring/structure",
        json={"format": "onepage", "session_id": session_id, "stream": False},
    )
    assert response.status_code == 200
    organize_user = stub.calls[0]["messages"][1]["text"]
    assert "태양광 증설 예산이 얼마였지?" in organize_user
    assert "사용자:" in organize_user


def test_structure_unknown_session_returns_404(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    response = client.post(
        "/api/documents/authoring/structure",
        json={"format": "onepage", "session_id": "missing", "stream": False},
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# 검증 실패 → 한국어 힌트 재시도
# ---------------------------------------------------------------------------


def test_validation_error_triggers_korean_hint_retry(tmp_path: Path) -> None:
    invalid = {
        "title": "청사 에너지 절감 보고",
        "summary": "요약",
        "sections": [{"heading": "하나뿐인 섹션", "items": ["항목"]}],
    }
    stub = StubLLM(
        [
            ORGANIZED_MD,
            json.dumps(invalid, ensure_ascii=False),
            json.dumps(ONEPAGE_JSON, ensure_ascii=False),
        ]
    )
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/structure",
        json={"format": "onepage", "instruction": "보고서 작성", "stream": False},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["attempts"] == 2
    assert payload["meta"]["repaired"] is False
    assert any("항목 부족(최소 2개 필요)" in hint for hint in payload["meta"]["hints"])
    assert payload["structure"]["title"] == ONEPAGE_JSON["title"]

    # 재시도 프롬프트에 한국어 힌트가 실려야 한다
    retry_user = stub.calls[2]["messages"][-1]["text"]
    assert "sections" in retry_user
    assert "항목 부족(최소 2개 필요)" in retry_user
    assert "수정한 JSON" in retry_user


def test_repair_fallback_scrapes_stage1_markdown(tmp_path: Path) -> None:
    stub = StubLLM([ORGANIZED_MD, "이것은 JSON이 아닙니다.", "여전히 JSON이 아닙니다."])
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/structure",
        json={"format": "onepage", "instruction": "보고서 작성", "stream": False},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["repaired"] is True
    assert payload["meta"]["attempts"] == 2

    structure = payload["structure"]
    assert structure["title"] == "청사 에너지 절감 추진계획"
    headings = [section["heading"] for section in structure["sections"]]
    assert "추진 배경" in headings
    all_items = [item for section in structure["sections"] for item in section["items"]]
    assert "냉난방 설정온도 자동제어 도입" in all_items
    # repair 결과도 스키마를 만족해야 한다
    SchemaOnePage.model_validate(structure)


def test_repair_fallback_for_full_report_builds_three_chapters(tmp_path: Path) -> None:
    stub = StubLLM([ORGANIZED_MD, "JSON 아님", "JSON 아님"])
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/structure",
        json={"format": "full", "instruction": "보고서 작성", "stream": False},
    )
    assert response.status_code == 200
    structure = response.json()["structure"]
    validated = SchemaFull.model_validate(structure)
    assert len(validated.chapters) >= 3
    assert validated.summary


# ---------------------------------------------------------------------------
# 소형 모델 관용 정규화기
# ---------------------------------------------------------------------------


def test_normalizer_string_becomes_list() -> None:
    section = OnePageSection.model_validate(
        {"heading": "과제", "items": "냉난방 자동제어 도입"}
    )
    assert section.items == ["냉난방 자동제어 도입"]

    email = SchemaEmail.model_validate({"subject": "제목", "body_paragraphs": "본문 문단"})
    assert email.body_paragraphs == ["본문 문단"]


def test_normalizer_newline_string_splits_into_items() -> None:
    section = OnePageSection.model_validate(
        {"heading": "과제", "items": "- 첫 항목\n- 둘째 항목"}
    )
    assert section.items == ["첫 항목", "둘째 항목"]


def test_normalizer_blank_string_becomes_none() -> None:
    doc = SchemaOnePage.model_validate(
        {
            "title": "제목",
            "subtitle": "",
            "summary": "요약",
            "sections": [
                {"heading": "가", "items": ["항목"], "detail": "", "note": "  "},
                {"heading": "나", "items": ["항목"]},
            ],
        }
    )
    assert doc.subtitle is None
    assert doc.sections[0].detail is None
    assert doc.sections[0].note is None


def test_normalizer_string_becomes_text_object() -> None:
    doc = SchemaGongmun.model_validate(
        {
            "title": "제목",
            "receiver": "수신처",
            "opening": "첫 문장",
            "items": ["문자열 항목", {"text": "객체 항목", "subs": "하위 항목"}],
        }
    )
    assert doc.items[0] == GongmunItem(text="문자열 항목", subs=[])
    assert doc.items[1].subs == ["하위 항목"]


def test_normalizer_summary_truncated_to_200_chars() -> None:
    doc = SchemaOnePage.model_validate(
        {
            "title": "제목",
            "summary": "가" * 500,
            "sections": [
                {"heading": "가", "items": ["항목"]},
                {"heading": "나", "items": ["항목"]},
            ],
        }
    )
    assert len(doc.summary) == 200


# ---------------------------------------------------------------------------
# 일정표 행 필터링 (미정/추후/TBD)
# ---------------------------------------------------------------------------


def test_schedule_rows_with_pending_markers_are_filtered() -> None:
    payload = dict(FULL_JSON)
    payload["schedule"] = {
        "rows": [
            {"항목": "시범 적용", "일정": "2026.7."},
            {"항목": "발주", "일정": "2026.9."},
            {"항목": "확산", "일정": "추후 협의"},
            {"항목": "평가", "일정": "TBD"},
        ]
    }
    doc = SchemaFull.model_validate(payload)
    assert doc.schedule is not None
    assert [row.항목 for row in doc.schedule.rows] == ["시범 적용", "발주"]


def test_schedule_omitted_when_fewer_than_two_rows_remain() -> None:
    payload = dict(FULL_JSON)
    payload["schedule"] = {
        "rows": [
            {"항목": "시범 적용", "일정": "2026.7."},
            {"항목": "확산", "일정": "미정"},
        ]
    }
    doc = SchemaFull.model_validate(payload)
    assert doc.schedule is None


# ---------------------------------------------------------------------------
# 스테이지 스트리밍
# ---------------------------------------------------------------------------


def test_streaming_emits_stage_events_and_final_structure(tmp_path: Path) -> None:
    stub = StubLLM([ORGANIZED_MD, json.dumps(ONEPAGE_JSON, ensure_ascii=False)])
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/structure",
        json={"format": "onepage", "instruction": "보고서 작성", "stream": True},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse(response.text)
    names = [name for name, _ in events]
    assert names == ["stage", "stage", "stage", "stage", "done"]

    stage_payloads = [data for name, data in events if name == "stage"]
    assert stage_payloads[0] == {"stage": "organize", "status": "start"}
    assert stage_payloads[1]["stage"] == "organize"
    assert stage_payloads[1]["status"] == "done"
    assert isinstance(stage_payloads[1]["elapsed_ms"], int)
    assert stage_payloads[2] == {"stage": "format", "status": "start"}
    assert stage_payloads[3]["status"] == "done"
    assert stage_payloads[3]["repaired"] is False

    done = events[-1][1]
    assert done["done"] is True
    assert done["format"] == "onePageReport"
    assert done["structure"]["title"] == ONEPAGE_JSON["title"]
    # T2(4호): 요약은 '요약' 제목 없이 글상자(룰 라인 프레임) 안에 요지로 표기된다
    assert "□ 요약" not in done["preview"]
    assert ONEPAGE_JSON["summary"] in done["preview"]
    assert done["preview"].count("─" * 30) == 2


def test_streaming_llm_failure_emits_error_event(tmp_path: Path) -> None:
    from gongmu_sidecar.llm import LLMGenerationError

    stub = StubLLM([LLMGenerationError("서버 연결 실패")])
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/structure",
        json={"format": "onepage", "instruction": "보고서 작성", "stream": True},
    )
    events = _parse_sse(response.text)
    assert events[-1][0] == "error"
    assert "서버 연결 실패" in events[-1][1]["message"]


# ---------------------------------------------------------------------------
# 빌드 (결정적: 구조 JSON → content-base 마크다운 → 기존 finalize 흐름)
# ---------------------------------------------------------------------------


def test_build_onepage_markdown_has_hierarchy_markers(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    response = client.post(
        "/api/documents/authoring/build",
        json={"format": "onepage", "structure": ONEPAGE_JSON},
    )
    assert response.status_code == 201
    payload = response.json()
    markdown = payload["content_markdown"]
    assert markdown.startswith("# 청사 에너지 절감 추진계획 보고")
    assert "□ 추진 배경" in markdown
    assert " ◦ 2025년 청사 전력비 3.2억 원" in markdown
    assert "   - 냉난방 전력이 전체의 61% 차지" in markdown
    assert " ※ 공공기관 에너지이용 합리화 지침 근거" in markdown
    # WYSIWYG: 최종 HWPX가 그대로 사용할 구조 마커가 심어져 있어야 한다
    assert "<!--gongmu-doc-structure:" in markdown
    # 고정 목차 슬롯용 재구성 섹션은 폐지되었다(항목 중복 배치의 원인)
    assert "## 후속 조치" not in markdown

    # content-base 파일이 실제로 우리 마크다운으로 쓰여 있어야 한다
    artifact_path = Path(payload["content_base"]["artifact_path"])
    assert artifact_path.exists()
    assert artifact_path.read_text(encoding="utf-8") == markdown

    finalize = payload["finalize"]
    assert finalize["endpoint"] == "/api/documents/finalize"
    assert finalize["body"]["content_base_id"] == payload["content_base"]["id"]
    assert finalize["body"]["output_name"]


def test_build_full_report_markdown_and_schedule_filtering(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    payload = dict(FULL_JSON)
    payload["schedule"] = {
        "rows": [
            {"항목": "시범 적용", "일정": "2026.7.", "비고": "본관 우선"},
            {"항목": "발주", "일정": "2026.9."},
            {"항목": "확산", "일정": "추후 검토"},
        ]
    }
    response = client.post(
        "/api/documents/authoring/build",
        json={"format": "full", "structure": payload},
    )
    assert response.status_code == 201
    markdown = response.json()["content_markdown"]
    assert "Ⅰ. 추진 배경" in markdown
    assert "Ⅱ. 추진 과제" in markdown
    assert "□ 설비 개선" in markdown
    assert " ◦ 냉난방 자동제어 도입" in markdown
    assert "※ 추진 일정" in markdown
    assert " ◦ 시범 적용: 2026.7. (본관 우선)" in markdown
    assert "확산" not in markdown  # 미정/추후 행 제거


def test_build_full_report_omits_schedule_when_one_row_remains(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    payload = dict(FULL_JSON)
    payload["schedule"] = {
        "rows": [
            {"항목": "시범 적용", "일정": "2026.7."},
            {"항목": "확산", "일정": "미정"},
        ]
    }
    response = client.post(
        "/api/documents/authoring/build",
        json={"format": "full", "structure": payload},
    )
    assert response.status_code == 201
    assert "※ 추진 일정" not in response.json()["content_markdown"]


def test_build_gongmun_markdown_uses_ganada_hierarchy(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    response = client.post(
        "/api/documents/authoring/build",
        json={"format": "gongmun", "structure": GONGMUN_JSON},
    )
    assert response.status_code == 201
    markdown = response.json()["content_markdown"]
    assert "가. 냉난방 설정온도 준수(하절기 26℃)" in markdown
    assert "  1) 회의실 등 공용공간 우선 적용" in markdown
    assert "나. 야간 대기전력 차단 협조" in markdown
    assert "수신: 각 부서장" in markdown
    assert "붙임: 에너지 절감 실행계획 1부" in markdown


def test_build_rejects_invalid_structure_with_korean_hints(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    response = client.post(
        "/api/documents/authoring/build",
        json={
            "format": "onepage",
            "structure": {"title": "제목", "summary": "요약", "sections": []},
        },
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["message"] == "구조 JSON이 양식 스키마에 맞지 않습니다."
    assert any("항목 부족" in hint for hint in detail["hints"])


def test_build_then_finalize_apply_produces_hwpx(tmp_path: Path) -> None:
    client = _client(tmp_path, StubLLM([]))
    build = client.post(
        "/api/documents/authoring/build",
        json={"format": "onepage", "structure": ONEPAGE_JSON, "title": "energy-onepage"},
    )
    assert build.status_code == 201
    finalize_body = build.json()["finalize"]["body"]

    requested = client.post("/api/documents/finalize", json=finalize_body)
    assert requested.status_code == 202
    ticket_id = requested.json()["approval_ticket"]["id"]

    decision = client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "문서작성 개선 테스트 승인"},
    )
    assert decision.status_code == 200

    applied = client.post(f"/api/documents/finalize/{ticket_id}/apply")
    assert applied.status_code == 201
    artifact = applied.json()["artifact"]
    assert artifact["format"] == "onePageReport"
    assert Path(artifact["path"]).exists()
    rendered = Path(artifact["markdown_path"]).read_text(encoding="utf-8")
    assert "전력" in rendered


# ---------------------------------------------------------------------------
# F-12: email 서명 placeholder·창작 연락처 후처리 가드
# ---------------------------------------------------------------------------


def test_email_format_prompt_has_no_personal_contact_fewshot() -> None:
    """few-shot 예시의 개인명·내선이 산출물로 유출되던 원인(F-12) 제거 확인."""
    prompt = FORMAT_SYSTEM_PROMPTS["email"]
    assert '"signature": "행정지원과 드림"' in prompt
    assert "홍길동" not in prompt
    assert "내선 1234" not in prompt
    assert "만들지 말 것" in prompt


def test_format_prompts_include_numeric_preservation_rule() -> None:
    """F-13/F-13b: 수치 보존·창작 금지 규칙이 모든 포맷 프롬프트에 명문화됐는지 확인."""
    for key, prompt in FORMAT_SYSTEM_PROMPTS.items():
        assert "표기 그대로 보존" in prompt, key
        assert "창작하지 않는다" in prompt, key


@pytest.mark.parametrize(
    "signature",
    [
        "행정지원과 (담당자명) (내선번호)",
        "행정지원과 OOO 주무관 (내선 XXXX)",
        "행정지원과 홍길동 주무관 (내선 1234)",
        "행정지원과 담당자명 기재",
        "행정지원과 김민수 주무관 (02-123-4567)",
        "행정지원과 someone@korea.kr",
    ],
)
def test_sanitize_email_signature_replaces_placeholder_variants(signature: str) -> None:
    structure = {**EMAIL_JSON, "signature": signature}
    sanitized = _sanitize_email_signature(structure, "에너지 절감 결과보고 이메일 작성")
    assert sanitized["signature"] == "행정지원과 드림"
    # 순수 함수 — 입력 구조는 변경되지 않는다
    assert structure["signature"] == signature


def test_sanitize_email_signature_keeps_contacts_present_in_instruction() -> None:
    structure = {**EMAIL_JSON, "signature": "행정지원과 김민수 주무관 (내선 5678)"}
    instruction = "회신용 이메일 작성. 서명에 김민수 주무관, 내선 5678 표기"
    sanitized = _sanitize_email_signature(structure, instruction)
    assert sanitized["signature"] == "행정지원과 김민수 주무관 (내선 5678)"


def test_sanitize_email_signature_leaves_clean_signature_untouched() -> None:
    structure = {**EMAIL_JSON, "signature": "행정지원과 드림"}
    sanitized = _sanitize_email_signature(structure, "")
    assert sanitized["signature"] == "행정지원과 드림"
    assert sanitized is structure


def test_sanitize_email_signature_falls_back_to_generic_department() -> None:
    structure = {
        "subject": "제목",
        "greeting": None,
        "body_paragraphs": ["본문"],
        "closing": None,
        "signature": "홍길동 드림",
    }
    sanitized = _sanitize_email_signature(structure, "이메일 작성")
    assert sanitized["signature"] == "담당 부서 드림"


def test_sanitize_email_signature_ignores_empty_signature() -> None:
    structure = {**EMAIL_JSON, "signature": None}
    assert _sanitize_email_signature(structure, "이메일 작성") is structure


def test_structure_email_sanitizes_fabricated_signature(tmp_path: Path) -> None:
    fabricated = dict(EMAIL_JSON)
    fabricated["signature"] = "행정지원과 홍길동 주무관 (내선 1234)"
    stub = StubLLM([ORGANIZED_MD, json.dumps(fabricated, ensure_ascii=False)])
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/structure",
        json={"format": "email", "instruction": "청사 에너지 절감 안내 이메일 작성", "stream": False},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["structure"]["signature"] == "행정지원과 드림"
    assert "홍길동" not in payload["preview"]
    assert "내선" not in payload["preview"]


# ---------------------------------------------------------------------------
# F-13/F-13b: 지시 수치 보존 검증 — 누락 시 1회 재생성
# ---------------------------------------------------------------------------

T2_INSTRUCTION = "2026년 상반기 AI 활용 교육 실시 결과보고 — 교육 3회, 참석률 87%, 만족도 4.3/5"

_DROPPED_NUMBERS_JSON = {
    "title": "AI 활용 교육 결과보고",
    "summary": "교육 실시 결과 참석률 분석",
    "sections": [
        {"heading": "추진 개요", "items": ["AI 활용 교육 실시"]},
        {"heading": "결과", "items": ["참석률 분석 실시"]},
    ],
}

_PRESERVED_NUMBERS_JSON = {
    "title": "2026년 상반기 AI 활용 교육 결과보고",
    "summary": "교육 3회 실시, 참석률 87%, 만족도 4.3/5 달성",
    "sections": [
        {"heading": "추진 개요", "items": ["2026년 상반기 교육 3회 실시"]},
        {"heading": "결과", "items": ["참석률 87%", "만족도 4.3/5"]},
    ],
}


def test_extract_numeric_tokens_with_units() -> None:
    assert extract_numeric_tokens(T2_INSTRUCTION) == ["2026년", "3회", "87%", "4.3", "5"]
    assert extract_numeric_tokens("수치 없음") == []
    assert extract_numeric_tokens("") == []


def test_find_missing_numeric_tokens_ignores_whitespace() -> None:
    structure = {"title": "결과보고", "summary": "2026년 교육 3 회 실시, 참석률 87%, 5점"}
    missing = find_missing_numeric_tokens(T2_INSTRUCTION, structure)
    assert missing == ["4.3"]


def test_numeric_guard_retries_once_and_adopts_improved_structure(tmp_path: Path) -> None:
    stub = StubLLM(
        [
            ORGANIZED_MD,
            json.dumps(_DROPPED_NUMBERS_JSON, ensure_ascii=False),
            json.dumps(_PRESERVED_NUMBERS_JSON, ensure_ascii=False),
        ]
    )
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/structure",
        json={"format": "onepage", "instruction": T2_INSTRUCTION, "stream": False},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["numeric_retry"] is True
    assert payload["meta"]["missing_numeric_tokens"] == []
    serialized = json.dumps(payload["structure"], ensure_ascii=False)
    for token in ("3회", "87%", "4.3", "2026년"):
        assert token in serialized

    # 재생성 요청에는 누락 수치를 명시한 보강 지시가 첨부되어야 한다
    assert len(stub.calls) == 3
    retry_user = stub.calls[2]["messages"][1]["text"]
    assert "[수치 보존 지시]" in retry_user
    assert "- 87%" in retry_user
    assert "- 3회" in retry_user


def test_numeric_guard_keeps_first_result_when_retry_not_better(tmp_path: Path) -> None:
    stub = StubLLM(
        [
            ORGANIZED_MD,
            json.dumps(_DROPPED_NUMBERS_JSON, ensure_ascii=False),
            json.dumps(_DROPPED_NUMBERS_JSON, ensure_ascii=False),
        ]
    )
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/structure",
        json={"format": "onepage", "instruction": T2_INSTRUCTION, "stream": False},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["numeric_retry"] is True
    assert "87%" in payload["meta"]["missing_numeric_tokens"]
    assert payload["structure"]["title"] == _DROPPED_NUMBERS_JSON["title"]
    assert len(stub.calls) == 3


def test_numeric_guard_skips_retry_when_numbers_preserved(tmp_path: Path) -> None:
    stub = StubLLM([ORGANIZED_MD, json.dumps(_PRESERVED_NUMBERS_JSON, ensure_ascii=False)])
    client = _client(tmp_path, stub)

    response = client.post(
        "/api/documents/authoring/structure",
        json={"format": "onepage", "instruction": T2_INSTRUCTION, "stream": False},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"] == {"attempts": 1, "repaired": False, "hints": []}
    assert len(stub.calls) == 2


# ---------------------------------------------------------------------------
# F-13a: summary 다문장 → 문장 단위 ◦ 줄 렌더
# ---------------------------------------------------------------------------


def test_split_summary_sentences_rules() -> None:
    assert split_summary_sentences(
        "교육 3회를 실시함. 참석률 87%를 기록함. 만족도 4.3/5 달성."
    ) == ["교육 3회를 실시함.", "참석률 87%를 기록함.", "만족도 4.3/5 달성."]
    # 숫자 뒤 마침표(소수점·날짜)는 문장 경계가 아니다
    assert split_summary_sentences("2026. 7. 시범 적용을 개시함. 8월 확대 예정.") == [
        "2026. 7. 시범 적용을 개시함.",
        "8월 확대 예정.",
    ]
    assert split_summary_sentences("단일 문장 요약") == ["단일 문장 요약"]
    assert split_summary_sentences("") == []
    assert split_summary_sentences("   ") == []


def test_render_preview_splits_multisentence_onepage_summary() -> None:
    structure = SchemaOnePage.model_validate(
        {
            "title": "AI 활용 교육 결과보고",
            "summary": "교육 3회를 실시함. 참석률 87%를 기록함. 만족도 4.3/5 달성.",
            "sections": [
                {"heading": "개요", "items": ["항목"]},
                {"heading": "결과", "items": ["항목"]},
            ],
        }
    ).model_dump()
    lines = render_preview("onePageReport", structure).splitlines()
    assert " ◦ 교육 3회를 실시함." in lines
    assert " ◦ 참석률 87%를 기록함." in lines
    assert " ◦ 만족도 4.3/5 달성." in lines
    assert " ◦ 교육 3회를 실시함. 참석률 87%를 기록함. 만족도 4.3/5 달성." not in lines


def test_render_preview_splits_multisentence_full_summary_entry() -> None:
    payload = dict(FULL_JSON)
    payload["summary"] = ["3대 과제를 착수함. 예산 1.8억 원을 재배정함.", "하반기 완료 목표"]
    structure = SchemaFull.model_validate(payload).model_dump()
    lines = render_preview("fullReport", structure).splitlines()
    assert " ◦ 3대 과제를 착수함." in lines
    assert " ◦ 예산 1.8억 원을 재배정함." in lines
    assert " ◦ 하반기 완료 목표" in lines
