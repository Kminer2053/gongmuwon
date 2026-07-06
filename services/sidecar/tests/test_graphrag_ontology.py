from __future__ import annotations

from pathlib import Path

from gongmu_sidecar.document_parsers import parse_document
from gongmu_sidecar.ontology import extract_ontology


def test_ontology_mapper_extracts_readable_korean_public_sector_entities(tmp_path: Path) -> None:
    document_path = tmp_path / "readable-public-plan.md"
    document_path.write_text(
        "# 민원 자동화 개선계획\n\n"
        "사업: 디지털 민원 고도화\n"
        "업무: 민원 상담 자동화\n"
        "이슈: 개인정보 마스킹 필요\n"
        "정책: 개인정보보호법\n"
        "수신: 총무과\n"
        "담당자: 홍길동\n"
        "일정: 2026년 상반기\n",
        encoding="utf-8",
    )

    extraction = extract_ontology(parse_document(document_path))

    nodes = {(node.node_type, node.label) for node in extraction.nodes}
    assert ("Project", "디지털 민원 고도화") in nodes
    assert ("Task", "민원 상담 자동화") in nodes
    assert ("Issue", "개인정보 마스킹 필요") in nodes
    assert ("Policy", "개인정보보호법") in nodes
    assert ("Department", "총무과") in nodes
    assert ("Person", "홍길동") in nodes
    assert ("Event", "2026년 상반기") in nodes


def test_ontology_mapper_extracts_public_document_aliases(tmp_path: Path) -> None:
    document_path = tmp_path / "alias-public-plan.md"
    document_path.write_text(
        "# 공공서비스 개선 보고서\n\n"
        "프로젝트: 통합 민원 플랫폼\n"
        "과제: 상담 이력 자동 요약\n"
        "근거법령: 개인정보보호법\n"
        "참조: 정보화담당관\n"
        "결재: 김부장\n"
        "부서: 디지털정책과\n",
        encoding="utf-8",
    )

    extraction = extract_ontology(parse_document(document_path))

    nodes = {(node.node_type, node.label) for node in extraction.nodes}
    assert ("Project", "통합 민원 플랫폼") in nodes
    assert ("Task", "상담 이력 자동 요약") in nodes
    assert ("Policy", "개인정보보호법") in nodes
    assert ("Department", "정보화담당관") in nodes
    assert ("Person", "김부장") in nodes
    assert ("Organization", "디지털정책과") in nodes


def test_ontology_mapper_extracts_people_and_departments_from_tables(tmp_path: Path) -> None:
    document_path = tmp_path / "table-public-plan.md"
    document_path.write_text(
        "# 담당자 현황\n\n"
        "## 추진체계\n\n"
        "| 담당자 | 부서 | 업무 |\n"
        "| --- | --- | --- |\n"
        "| 홍길동 | 총무과 | 민원 자동화 |\n",
        encoding="utf-8",
    )

    extraction = extract_ontology(parse_document(document_path))

    nodes = {(node.node_type, node.label) for node in extraction.nodes}
    assert ("Person", "홍길동") in nodes
    assert ("Department", "총무과") in nodes
    assert ("Task", "민원 자동화") in nodes


def test_ontology_mapper_extracts_attachment_budget_and_period_fields(tmp_path: Path) -> None:
    document_path = tmp_path / "budget-attachment-plan.md"
    document_path.write_text(
        "# 예산 검토 보고서\n\n"
        "붙임: 세부 산출내역.xlsx\n"
        "첨부: 회의록.pdf\n"
        "예산: 100,000천원\n"
        "금액: 20,000천원\n"
        "기간: 2026년 5월부터 2026년 7월까지\n\n"
        "## 세부내역\n\n"
        "| 첨부 | 예산 | 기간 |\n"
        "| --- | --- | --- |\n"
        "| 견적서.pdf | 50,000천원 | 2026년 6월 |\n",
        encoding="utf-8",
    )

    extraction = extract_ontology(parse_document(document_path))

    nodes = {(node.node_type, node.label) for node in extraction.nodes}
    assert ("Attachment", "세부 산출내역.xlsx") in nodes
    assert ("Attachment", "회의록.pdf") in nodes
    assert ("Attachment", "견적서.pdf") in nodes
    assert ("Budget", "100,000천원") in nodes
    assert ("Budget", "20,000천원") in nodes
    assert ("Budget", "50,000천원") in nodes
    assert ("Event", "2026년 5월부터 2026년 7월까지") in nodes
    assert ("Event", "2026년 6월") in nodes
    assert {"ATTACHED", "HAS_BUDGET", "GENERATED_FROM"}.issubset({edge.relation for edge in extraction.edges})


def test_ontology_mapper_extracts_public_sector_entities(tmp_path: Path) -> None:
    document_path = tmp_path / "public-plan.md"
    document_path.write_text(
        "# 공공서비스 개선계획\n\n"
        "사업: 디지털 민원 고도화\n"
        "업무: 민원 상담 자동화\n"
        "이슈: 개인정보 마스킹 필요\n"
        "정책: 개인정보보호법\n"
        "수신: 총무과\n"
        "담당자: 홍길동\n",
        encoding="utf-8",
    )

    extraction = extract_ontology(parse_document(document_path))

    nodes = {(node.node_type, node.label) for node in extraction.nodes}
    assert ("Project", "디지털 민원 고도화") in nodes
    assert ("Task", "민원 상담 자동화") in nodes
    assert ("Issue", "개인정보 마스킹 필요") in nodes
    assert ("Policy", "개인정보보호법") in nodes
    assert ("Department", "총무과") in nodes
    assert ("Person", "홍길동") in nodes
    assert ("Task", "민원 상담 자동화", "PART_OF", "Project", "디지털 민원 고도화") in {
        (edge.source_type, edge.source_label, edge.relation, edge.target_type, edge.target_label)
        for edge in extraction.edges
    }
