from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from .graphrag_models import StructuredDocument


@dataclass(frozen=True)
class OntologyNode:
    node_type: str
    label: str
    confidence: float = 0.7

    @property
    def node_id(self) -> str:
        return stable_node_id(self.node_type, self.label)


@dataclass(frozen=True)
class OntologyEdge:
    source_type: str
    source_label: str
    relation: str
    target_type: str
    target_label: str
    confidence: float = 0.65

    @property
    def edge_id(self) -> str:
        return stable_edge_id(
            stable_node_id(self.source_type, self.source_label),
            self.relation,
            stable_node_id(self.target_type, self.target_label),
        )


@dataclass
class OntologyExtraction:
    nodes: list[OntologyNode] = field(default_factory=list)
    edges: list[OntologyEdge] = field(default_factory=list)


FIELD_RULES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("Task", "RELATES_TO", ("업무", "과제", "task")),
    ("Project", "PART_OF", ("프로젝트", "사업", "project")),
    ("Issue", "DISCUSSES", ("이슈", "쟁점", "문제")),
    ("Policy", "REFERENCES", ("정책", "근거", "법령")),
    ("Organization", "SENT_FROM", ("기관", "조직", "발신")),
    ("Department", "SENT_TO", ("부서", "수신")),
    ("Person", "APPROVED_BY", ("담당자", "결재자")),
    ("Event", "GENERATED_FROM", ("일정", "행사", "회의")),
)


READABLE_KOREAN_FIELD_RULES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("Task", "RELATES_TO", ("업무", "과제", "작업", "세부과제", "주요업무")),
    ("Project", "PART_OF", ("프로젝트", "사업", "계획", "시책")),
    ("Issue", "DISCUSSES", ("이슈", "쟁점", "문제", "현안")),
    ("Policy", "REFERENCES", ("정책", "근거", "법령", "근거법령", "관련법령")),
    ("Budget", "HAS_BUDGET", ("예산", "금액", "소요예산", "사업비")),
    ("Organization", "SENT_FROM", ("기관", "조직", "발신", "부서")),
    ("Department", "SENT_TO", ("수신", "참조", "수신처", "참조처", "담당부서")),
    ("Person", "APPROVED_BY", ("담당자", "결재", "결재자", "승인자")),
    ("Event", "GENERATED_FROM", ("일정", "행사", "회의", "기한", "마감")),
    ("Event", "GENERATED_FROM", ("기간", "추진기간", "사업기간")),
    ("Attachment", "ATTACHED", ("붙임", "첨부", "첨부파일", "붙임문서")),
)


TABLE_HEADER_NODE_TYPES = {
    "담당자": "Person",
    "담당": "Person",
    "결재자": "Person",
    "부서": "Department",
    "담당부서": "Department",
    "수신": "Department",
    "참조": "Department",
    "업무": "Task",
    "과제": "Task",
    "작업": "Task",
    "사업": "Project",
    "프로젝트": "Project",
    "정책": "Policy",
    "법령": "Policy",
    "근거": "Policy",
    "근거법령": "Policy",
    "예산": "Budget",
    "금액": "Budget",
    "소요예산": "Budget",
    "사업비": "Budget",
    "첨부": "Attachment",
    "첨부파일": "Attachment",
    "붙임": "Attachment",
    "붙임문서": "Attachment",
    "이슈": "Issue",
    "쟁점": "Issue",
    "문제": "Issue",
    "일정": "Event",
    "기한": "Event",
    "기간": "Event",
    "추진기간": "Event",
    "사업기간": "Event",
}


def _field_rules() -> tuple[tuple[str, str, tuple[str, ...]], ...]:
    return (*FIELD_RULES, *READABLE_KOREAN_FIELD_RULES)


def extract_ontology(document: StructuredDocument) -> OntologyExtraction:
    mentions = _extract_mentions(document)
    nodes_by_key: dict[tuple[str, str], OntologyNode] = {}
    edges: list[OntologyEdge] = []

    for node_type, labels in mentions.items():
        for label in labels:
            nodes_by_key[(node_type, label)] = OntologyNode(node_type=node_type, label=label)

    for node_type, relation, _prefixes in _field_rules():
        for label in mentions.get(node_type, []):
            if node_type == "Project":
                continue
            edges.append(
                OntologyEdge(
                    source_type="Document",
                    source_label=document.title,
                    relation=relation,
                    target_type=node_type,
                    target_label=label,
                )
            )

    projects = mentions.get("Project", [])
    tasks = mentions.get("Task", [])
    if projects:
        for task in tasks:
            edges.append(
                OntologyEdge(
                    source_type="Task",
                    source_label=task,
                    relation="PART_OF",
                    target_type="Project",
                    target_label=projects[0],
                    confidence=0.7,
                )
            )
    for project in projects:
        edges.append(
            OntologyEdge(
                source_type="Document",
                source_label=document.title,
                relation="RELATES_TO",
                target_type="Project",
                target_label=project,
            )
        )

    return OntologyExtraction(nodes=list(nodes_by_key.values()), edges=_dedupe_edges(edges))


def stable_node_id(node_type: str, label: str) -> str:
    normalized = re.sub(r"\s+", " ", label.strip().lower())
    digest = hashlib.sha1(f"{node_type}:{normalized}".encode("utf-8")).hexdigest()[:16]
    return f"ontology:{node_type}:{digest}"


def stable_edge_id(source_node_id: str, relation: str, target_node_id: str) -> str:
    digest = hashlib.sha1(f"{source_node_id}:{relation}:{target_node_id}".encode("utf-8")).hexdigest()
    return f"edge:{digest[:24]}"


def _extract_mentions(document: StructuredDocument) -> dict[str, list[str]]:
    text = "\n".join(
        [
            document.title,
            *(section.text for section in document.sections),
            *(f"{key}: {value}" for key, value in document.metadata.items() if value),
        ]
    )
    mentions: dict[str, list[str]] = {}
    for node_type, _relation, prefixes in _field_rules():
        for prefix in prefixes:
            pattern = re.compile(rf"^\s*{re.escape(prefix)}\s*[:：]\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
            for match in pattern.finditer(text):
                label = _clean_label(match.group(1))
                if label:
                    mentions.setdefault(node_type, [])
                    if label not in mentions[node_type]:
                        mentions[node_type].append(label)
    if document.metadata.get("sender_org"):
        _append_unique(mentions, "Organization", _clean_label(str(document.metadata["sender_org"])))
    if document.metadata.get("receiver_org"):
        _append_unique(mentions, "Department", _clean_label(str(document.metadata["receiver_org"])))
    _extract_table_mentions(document, mentions)
    return mentions


def _extract_table_mentions(document: StructuredDocument, mentions: dict[str, list[str]]) -> None:
    for section in document.sections:
        for table in section.tables:
            normalized_headers = [_normalize_table_header(header) for header in table.headers]
            for row in table.rows:
                for index, cell in enumerate(row):
                    if index >= len(normalized_headers):
                        continue
                    node_type = TABLE_HEADER_NODE_TYPES.get(normalized_headers[index])
                    if not node_type:
                        continue
                    label = _clean_label(cell)
                    if label:
                        _append_unique(mentions, node_type, label)


def _normalize_table_header(header: str) -> str:
    return re.sub(r"[\s:：/()（）\[\]〈〉<>]+", "", header.strip())


def _append_unique(mentions: dict[str, list[str]], node_type: str, label: str) -> None:
    if not label:
        return
    mentions.setdefault(node_type, [])
    if label not in mentions[node_type]:
        mentions[node_type].append(label)


def _clean_label(value: str) -> str:
    # Preserve thousands separators such as "100,000천원" while still splitting simple lists.
    return re.split(r";|/|\||,(?!\d)", value.strip(), maxsplit=1)[0].strip()


def _dedupe_edges(edges: list[OntologyEdge]) -> list[OntologyEdge]:
    seen: set[str] = set()
    result: list[OntologyEdge] = []
    for edge in edges:
        if edge.edge_id in seen:
            continue
        seen.add(edge.edge_id)
        result.append(edge)
    return result
