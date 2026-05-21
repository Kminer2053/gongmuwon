from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class StructuredTable:
    headers: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)
    caption: str | None = None

    def to_text_projection(self) -> str:
        lines: list[str] = []
        if self.caption:
            lines.append(self.caption)
        if self.headers:
            lines.append(" | ".join(self.headers))
        lines.extend(" | ".join(row) for row in self.rows)
        return "\n".join(line for line in lines if line.strip())


@dataclass
class StructuredSection:
    heading: str
    level: int = 1
    paragraphs: list[str] = field(default_factory=list)
    tables: list[StructuredTable] = field(default_factory=list)

    @property
    def text(self) -> str:
        parts = [self.heading, *self.paragraphs]
        parts.extend(table.to_text_projection() for table in self.tables)
        return "\n".join(part for part in parts if part.strip())


@dataclass
class StructuredDocument:
    source_path: Path
    title: str
    document_type: str
    sections: list[StructuredSection] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    parser_name: str = "gongmu-local"
    parser_version: str = "1"
    quality_score: float = 0.5
    partial: bool = False

    @property
    def attachment_count(self) -> int:
        value = self.metadata.get("attachment_count")
        return int(value) if isinstance(value, (int, str)) and str(value).isdigit() else 0
