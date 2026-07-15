"""W6: 최종 HWPX = 미리보기의 충실한 종이 버전(WYSIWYG) 검증.

구조 JSON → build_content_base_markdown → write_public_hwpx_document 로 만든
최종 HWPX 를 kordoc 으로 재파싱해 다음을 어서션한다.

  (a) 구조의 모든 섹션 제목·항목 문자열이 존재한다 (고정 스켈레톤 재배치 금지)
  (b) 작성 가이드 문구 5종이 인쇄되지 않는다
  (c) 원 구조에 1회 등장한 항목이 2회 이상 중복 배치되지 않는다
  (d) 제목 전문이 존재한다 (절단 금지)

preview-hwpx(rhwp 양식 미리보기) 엔드포인트도 같은 writer 를 경유하는지 함께 검증한다.
"""

from __future__ import annotations

import html
import os
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import pytest

from gongmu_sidecar.app import create_app
from gongmu_sidecar.document_authoring import (
    FORMAT_SCHEMAS,
    KordocCliUnavailable,
    build_content_base_markdown,
    register_authoring_routes,
    render_preview,
    resolve_kordoc_cli,
)
from gongmu_sidecar.hwpx_writer import (
    extract_structure_marker,
    structure_to_lines,
    write_public_hwpx_document,
)

# 사용자 버그 리포트에서 실제로 유출됐던 작성 가이드 문구 5종
GUIDE_PHRASES = [
    "두괄식: 결론과 요청사항을 앞부분에 배치했습니다.",
    "개조식: 문단을 짧은 항목으로 나누어 빠르게 읽히도록 정리했습니다.",
    "한 문장 한 핵심: 긴 서술 대신 판단 단위를 분리했습니다.",
    "적/의/것/들: 불필요한 표현을 줄여 공공문서 문체로 압축했습니다.",
    "기한: 기한 미정",
]

LONG_TITLE = "인공지능 전담조직 신설 및 CEO 직속 TF 운영 계획 보고"

ONEPAGE_STRUCTURE = {
    "title": LONG_TITLE,
    "subtitle": "2026년 하반기 실행 중심",
    "summary": "AI 전담조직 신설을 위해 CEO 직속 TF를 운영하여 추진 동력을 확보",
    "sections": [
        {
            "heading": "핵심 운영 방향 설정",
            "items": ["운영 기간은 발족 후 약 1년으로 설정", "주 1회 정례 보고 체계를 구축"],
            "detail": "월간 성과 점검을 병행",
            "note": "관련 규정 개정 검토 필요",
        },
        {
            "heading": "추진 동력 확보 방안",
            "items": ["부서별 겸임 인력 5명을 지정", "예산 8천만 원을 재배정"],
        },
    ],
}

FULL_STRUCTURE = {
    "title": "2026년 인공지능 혁신 추진 종합계획 수립 보고",
    "summary": ["3대 과제를 하반기에 착수", "예산 1.8억 원을 재배정"],
    "chapters": [
        {
            "heading": "추진 배경",
            "sections": [{"heading": "현황 진단", "items": ["2025년 전력비 3.2억 원 집행"]}],
        },
        {
            "heading": "추진 과제",
            "sections": [
                {"heading": "설비 개선", "items": ["냉난방 자동제어를 도입", "태양광 50kW를 증설"]},
            ],
        },
        {
            "heading": "행정 사항",
            "sections": [{"heading": "일정 및 예산", "items": ["7월 중 시범 적용을 개시"]}],
        },
    ],
    "schedule": {
        "rows": [
            {"항목": "자동제어 시범 적용", "일정": "2026.7.", "비고": "본관 우선"},
            {"항목": "태양광 증설 발주", "일정": "2026.9.", "비고": ""},
        ]
    },
}

GONGMUN_STRUCTURE = {
    "title": "인공지능 도입 관련 부서 협조 요청 시행문 발송 계획",
    "receiver": "각 부서장",
    "opening": "인공지능 도입 추진과 관련하여 아래와 같이 협조를 요청합니다.",
    "items": [
        {"text": "냉난방 설정온도 준수 협조", "subs": ["회의실 등 공용공간 우선 적용"]},
        {"text": "야간 대기전력 차단 협조"},
    ],
    "attachments": ["에너지 절감 실행계획 1부"],
    "sender": "행정지원과장",
}

EMAIL_STRUCTURE = {
    "subject": "[협조] 인공지능 도입 실천 안내 및 회신 요청",
    "greeting": "안녕하십니까, 행정지원과입니다.",
    "body_paragraphs": [
        "부서별 인공지능 도입 실천 계획 제출을 요청드립니다.",
        "제출 양식은 내부망 공지사항을 참고해 주시기 바랍니다.",
    ],
    "closing": "협조에 감사드립니다.",
    "signature": "행정지원과 홍길동 주무관",
}

FIDELITY_CASES = [
    ("onePageReport", ONEPAGE_STRUCTURE),
    ("fullReport", FULL_STRUCTURE),
    ("officialMemo", GONGMUN_STRUCTURE),
    ("email", EMAIL_STRUCTURE),
]


def _structure_strings(format_key: str, structure: dict) -> tuple[list[str], list[str]]:
    """(반드시 존재해야 하는 문자열, 정확히 1회만 등장해야 하는 항목 문자열)"""
    required: list[str] = []
    unique_items: list[str] = []
    if format_key == "onePageReport":
        required += [structure["title"], structure["subtitle"], structure["summary"]]
        for section in structure["sections"]:
            required.append(section["heading"])
            unique_items += list(section["items"])
            if section.get("detail"):
                unique_items.append(section["detail"])
            if section.get("note"):
                unique_items.append(section["note"])
    elif format_key == "fullReport":
        required += [structure["title"], *structure["summary"]]
        for chapter in structure["chapters"]:
            required.append(chapter["heading"])
            for section in chapter["sections"]:
                required.append(section["heading"])
                unique_items += list(section["items"])
        for row in structure["schedule"]["rows"]:
            required.append(row["항목"])
    elif format_key == "officialMemo":
        required += [structure["title"], structure["receiver"], structure["opening"]]
        for item in structure["items"]:
            unique_items.append(item["text"])
            unique_items += list(item.get("subs") or [])
        required += list(structure["attachments"])
    else:  # email
        required += [structure["subject"]]
        unique_items += [structure["greeting"], *structure["body_paragraphs"], structure["closing"]]
    required += unique_items
    return required, unique_items


def _kordoc_extract_text(hwpx_path: Path, workdir: Path) -> str:
    try:
        cli = resolve_kordoc_cli()
    except KordocCliUnavailable:
        pytest.skip("kordoc CLI를 찾지 못해 재파싱 검증을 건너뜁니다.")
    node = os.environ.get("GONGMU_NODE_EXE", "node")
    output_md = workdir / f"{hwpx_path.stem}-reparsed.md"
    try:
        completed = subprocess.run(
            [node, str(cli), str(hwpx_path), "-o", str(output_md), "--silent"],
            capture_output=True,
            timeout=120,
        )
    except FileNotFoundError:
        pytest.skip("node 런타임이 없어 kordoc 재파싱 검증을 건너뜁니다.")
    assert completed.returncode == 0, (
        f"kordoc 재파싱 실패: {completed.stderr.decode('utf-8', errors='replace')[:400]}"
    )
    assert output_md.is_file(), "kordoc 재파싱 결과(md)가 생성되지 않았습니다."
    return output_md.read_text(encoding="utf-8")


def _build_final_hwpx(tmp_path: Path, format_key: str, structure: dict) -> Path:
    validated = FORMAT_SCHEMAS[format_key].model_validate(structure).model_dump()
    markdown = build_content_base_markdown(format_key, validated)
    output_path = tmp_path / f"fidelity-{format_key}.hwpx"
    result = write_public_hwpx_document(
        output_path=output_path,
        title="산출물-파일명",
        purpose="fidelity 검증",
        template_key="report",
        content_markdown=markdown,
        document_format=format_key,  # type: ignore[arg-type]
    )
    assert result["format"] == format_key
    assert result["template_source"] == "builtin"
    return output_path


def _assert_fidelity(extracted: str, format_key: str, structure: dict) -> None:
    required, unique_items = _structure_strings(format_key, structure)

    # (a) 구조의 모든 섹션 제목·항목이 존재 + (d) 제목 전문 존재(절단 없음)
    for needle in required:
        assert needle in extracted, f"[{format_key}] 구조 문자열 누락: {needle!r}"

    # (b) 작성 가이드 문구 5종 부재
    for phrase in GUIDE_PHRASES:
        assert phrase not in extracted, f"[{format_key}] 가이드 문구 유출: {phrase!r}"

    # (c) 원 구조에 1회인 항목이 고정 슬롯 매핑으로 중복 배치되지 않음
    for item in unique_items:
        count = extracted.count(item)
        assert count == 1, f"[{format_key}] 항목 중복 배치({count}회): {item!r}"


@pytest.mark.parametrize(("format_key", "structure"), FIDELITY_CASES)
def test_final_hwpx_reparsed_by_kordoc_matches_structure(
    tmp_path: Path, format_key: str, structure: dict
) -> None:
    hwpx_path = _build_final_hwpx(tmp_path, format_key, structure)
    extracted = _kordoc_extract_text(hwpx_path, tmp_path)
    _assert_fidelity(extracted, format_key, structure)


def test_final_hwpx_title_not_truncated(tmp_path: Path) -> None:
    """부제 자리에 요약이 잘려 들어가던 회귀(…CEO 직속 TF를 운영하여 추) 방지."""
    hwpx_path = _build_final_hwpx(tmp_path, "onePageReport", ONEPAGE_STRUCTURE)
    extracted = _kordoc_extract_text(hwpx_path, tmp_path)
    assert LONG_TITLE in extracted
    truncated_summary = "CEO 직속 TF를 운영하여 추"
    full_summary = ONEPAGE_STRUCTURE["summary"]
    # 요약은 온전한 문장으로 1회 존재해야 하며, 잘린 조각이 부제로 남지 않는다
    assert extracted.count(full_summary) == 1
    assert extracted.count(truncated_summary) == extracted.count(full_summary)


@pytest.mark.parametrize(("format_key", "structure"), FIDELITY_CASES)
def test_content_base_markdown_round_trips_structure(format_key: str, structure: dict) -> None:
    """빌드 마크다운은 (1) 미리보기 문단과 1:1 본문, (2) 최종 렌더링용 구조 마커를 담는다."""
    validated = FORMAT_SCHEMAS[format_key].model_validate(structure).model_dump()
    markdown = build_content_base_markdown(format_key, validated)

    marker = extract_structure_marker(markdown)
    assert marker is not None
    assert marker[0] == format_key
    assert marker[1] == validated

    preview_lines = structure_to_lines(format_key, validated)
    assert render_preview(format_key, validated) == "\n".join(preview_lines)
    title = str(validated.get("title") or validated.get("subject") or "")
    assert markdown.startswith(f"# {title}\n")
    for line in preview_lines:
        if not line.strip() or line.strip() == title:
            continue
        assert line in markdown, f"미리보기 문단이 마크다운에 없음: {line!r}"


def test_preview_hwpx_endpoint_uses_same_structured_writer(tmp_path: Path) -> None:
    """preview-hwpx(rhwp 양식 미리보기)도 같은 writer 경유 — 자동으로 함께 고쳐졌는지 검증."""
    app = create_app(tmp_path)
    register_authoring_routes(app, app.state.services)
    client = app.state.test_client_factory()

    response = client.post(
        "/api/documents/authoring/preview-hwpx",
        json={"format": "onePageReport", "structure": ONEPAGE_STRUCTURE},
    )
    assert response.status_code == 200
    assert response.content[:2] == b"PK"

    hwpx_path = tmp_path / "preview-endpoint.hwpx"
    hwpx_path.write_bytes(response.content)
    extracted = _kordoc_extract_text(hwpx_path, tmp_path)
    _assert_fidelity(extracted, "onePageReport", ONEPAGE_STRUCTURE)


# ---------------------------------------------------------------------------
# T2(4호): 1p 요약을 '요약' 제목 없는 글상자(1×1 표)로 렌더 — □ 블릿 나열 폐지.
# section0.xml 을 직접 해부해 결정적으로 판정한다(kordoc 불요, 빠름).
# ---------------------------------------------------------------------------

SUMMARY_BOX_TBL_ID = 'id="9100000001"'


def _read_section0(hwpx_path: Path) -> str:
    with zipfile.ZipFile(hwpx_path) as archive:
        return archive.read("Contents/section0.xml").decode("utf-8")


def _strip_tags(xml: str) -> str:
    return re.sub(r"<[^>]+>", "", xml)


def _tables_containing(section_xml: str, sentences: list[str]) -> list[str]:
    tables = re.findall(r"<hp:tbl\b.*?</hp:tbl>", section_xml, re.DOTALL)
    return [tbl for tbl in tables if all(s in _strip_tags(tbl) for s in sentences)]


def test_onepage_summary_rendered_as_textbox(tmp_path: Path) -> None:
    """요약 문장 전부가 단일 hp:tbl/hp:tc 안에 있고 '□ 요약' 제목·표 밖 중복이 없다."""
    from gongmu_sidecar.hwpx_writer import split_summary_sentences

    hwpx_path = _build_final_hwpx(tmp_path, "onePageReport", ONEPAGE_STRUCTURE)
    section_xml = _read_section0(hwpx_path)
    ET.fromstring(section_xml)  # well-formed 보장

    sentences = split_summary_sentences(str(ONEPAGE_STRUCTURE["summary"]))
    matching = _tables_containing(section_xml, sentences)
    assert len(matching) == 1, "요약 문장을 모두 담은 표(글상자)가 정확히 1개여야 한다"
    assert "<hp:tc" in matching[0]
    assert section_xml.count(SUMMARY_BOX_TBL_ID) == 1

    plain = _strip_tags(section_xml)
    assert "□ 요약" not in plain, "요약 제목(□ 요약)이 남아 있으면 안 된다"
    for sentence in sentences:
        assert plain.count(sentence) == 1, f"요약 문장이 표 밖에 중복 등장: {sentence!r}"
    assert "{{" not in section_xml, "미치환 placeholder가 남으면 안 된다"


def test_onepage_multi_sentence_summary_all_in_one_box(tmp_path: Path) -> None:
    """다문장 요약(3문장)이 하나의 글상자 안에 문장별 문단으로 담긴다."""
    from gongmu_sidecar.hwpx_writer import split_summary_sentences

    structure = {
        **ONEPAGE_STRUCTURE,
        "summary": "교육 3회를 실시함. 만족도 조사를 병행함. 결과를 공유함.",
    }
    hwpx_path = _build_final_hwpx(tmp_path, "onePageReport", structure)
    section_xml = _read_section0(hwpx_path)
    ET.fromstring(section_xml)

    sentences = split_summary_sentences(str(structure["summary"]))
    assert len(sentences) == 3
    matching = _tables_containing(section_xml, sentences)
    assert len(matching) == 1, "3문장 전부를 담은 표가 정확히 1개여야 한다"


def test_onepage_summary_special_chars_escaped(tmp_path: Path) -> None:
    """특수문자 요약이 XML 이스케이프되어 well-formed 이고 원문이 보존된다."""
    structure = {**ONEPAGE_STRUCTURE, "summary": "예산 <1.8억> & 만족도 87% 달성"}
    hwpx_path = _build_final_hwpx(tmp_path, "onePageReport", structure)
    section_xml = _read_section0(hwpx_path)
    ET.fromstring(section_xml)  # 이스케이프 누락 시 파싱 실패
    restored = html.unescape(_strip_tags(section_xml))
    assert "<1.8억>" in restored
    assert "87%" in restored


def test_onepage_empty_summary_has_no_textbox(tmp_path: Path) -> None:
    """[네거티브] 빈 요약이면 글상자·룰 라인·유령 블릿이 생기지 않는다."""
    from gongmu_sidecar.hwpx_writer import SUMMARY_BOX_RULE, structure_to_lines

    structure = {**ONEPAGE_STRUCTURE, "summary": ""}
    hwpx_path = _build_final_hwpx(tmp_path, "onePageReport", structure)
    section_xml = _read_section0(hwpx_path)
    assert SUMMARY_BOX_TBL_ID not in section_xml

    lines = structure_to_lines("onePageReport", structure)
    assert SUMMARY_BOX_RULE not in lines
    assert not any(line.strip() in {"◦", "◦ "} for line in lines)


def test_fullreport_summary_heading_unchanged(tmp_path: Path) -> None:
    """[네거티브] fullReport 요약은 종전대로 '□ 요약' 헤딩 — 변경이 1p 한정임을 증명."""
    from gongmu_sidecar.hwpx_writer import SUMMARY_BOX_RULE, structure_to_lines

    lines = structure_to_lines("fullReport", FULL_STRUCTURE)
    assert "□ 요약" in lines
    assert SUMMARY_BOX_RULE not in lines

    hwpx_path = _build_final_hwpx(tmp_path, "fullReport", FULL_STRUCTURE)
    section_xml = _read_section0(hwpx_path)
    assert SUMMARY_BOX_TBL_ID not in section_xml
