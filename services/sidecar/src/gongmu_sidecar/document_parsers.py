from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from .graphrag_models import StructuredDocument, StructuredSection, StructuredTable
from .kordoc_bridge import KORdocParseError, KORdocUnavailable, parse_with_kordoc


TEXT_EXTENSIONS = {".txt", ".md", ".markdown"}
ZIP_XML_EXTENSIONS = {".docx", ".xlsx", ".pptx", ".hwpx"}
WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"


def parse_document(path: Path | str) -> StructuredDocument:
    source_path = Path(path)
    extension = source_path.suffix.lower()
    if extension in {".hwp", ".hwpx"}:
        try:
            return parse_with_kordoc(source_path)
        except (KORdocUnavailable, KORdocParseError):
            if extension == ".hwp":
                return StructuredDocument(
                    source_path=source_path,
                    title=source_path.stem,
                    document_type="hwp",
                    sections=[StructuredSection(heading=source_path.stem)],
                    metadata={},
                    parser_name="gongmu-hwp-metadata-fallback",
                    quality_score=0.1,
                    partial=True,
                )
    if extension in TEXT_EXTENSIONS:
        return _parse_markdown_like(source_path)
    if extension == ".docx":
        return _parse_docx_document(source_path)
    if extension == ".xlsx":
        return _parse_xlsx_document(source_path)
    if extension == ".pptx":
        return _parse_pptx_document(source_path)
    if extension == ".hwpx":
        return _parse_hwpx_xml_document(source_path)
    if extension in ZIP_XML_EXTENSIONS:
        return _parse_zip_xml_document(source_path)
    if extension == ".pdf":
        return _parse_pdf_document(source_path)
    return StructuredDocument(
        source_path=source_path,
        title=source_path.stem,
        document_type=extension.lstrip(".") or "file",
        sections=[StructuredSection(heading=source_path.stem)],
        metadata={},
        parser_name="gongmu-metadata-fallback",
        quality_score=0.1,
        partial=True,
    )


def _parse_markdown_like(source_path: Path) -> StructuredDocument:
    text = source_path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    sections: list[StructuredSection] = []
    current: StructuredSection | None = None
    metadata = _extract_public_metadata(text)

    index = 0
    while index < len(lines):
        line = lines[index].rstrip()
        heading = _parse_heading(line)
        if heading:
            level, title = heading
            current = StructuredSection(heading=title, level=level)
            sections.append(current)
            index += 1
            continue

        if _looks_like_markdown_table(lines, index):
            table, next_index = _parse_markdown_table(lines, index)
            if current is None:
                current = StructuredSection(heading=source_path.stem, level=1)
                sections.append(current)
            current.tables.append(table)
            index = next_index
            continue

        stripped = line.strip()
        if stripped and not _is_metadata_line(stripped):
            if current is None:
                current = StructuredSection(heading=source_path.stem, level=1)
                sections.append(current)
            current.paragraphs.append(stripped)
        index += 1

    if not sections:
        sections = [StructuredSection(heading=source_path.stem, paragraphs=[text.strip()] if text.strip() else [])]

    title = sections[0].heading if sections else source_path.stem
    return StructuredDocument(
        source_path=source_path,
        title=title,
        document_type=source_path.suffix.lower().lstrip(".") or "text",
        sections=sections,
        metadata=metadata,
        parser_name="gongmu-markdown",
        quality_score=0.85,
        partial=False,
    )


def _parse_heading(line: str) -> tuple[int, str] | None:
    match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
    if not match:
        return None
    return len(match.group(1)), match.group(2).strip()


def _looks_like_markdown_table(lines: list[str], index: int) -> bool:
    if index + 1 >= len(lines):
        return False
    header = lines[index].strip()
    separator = lines[index + 1].strip()
    if not header.startswith("|") or not header.endswith("|"):
        return False
    if not separator.startswith("|") or not separator.endswith("|"):
        return False
    cells = _split_markdown_table_row(separator)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.strip()) for cell in cells)


def _parse_markdown_table(lines: list[str], index: int) -> tuple[StructuredTable, int]:
    headers = _split_markdown_table_row(lines[index])
    rows: list[list[str]] = []
    cursor = index + 2
    while cursor < len(lines):
        line = lines[cursor].strip()
        if not line.startswith("|") or not line.endswith("|"):
            break
        row = _split_markdown_table_row(line)
        if row:
            rows.append(row)
        cursor += 1
    return StructuredTable(headers=headers, rows=rows), cursor


def _split_markdown_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _extract_public_metadata(text: str) -> dict[str, str]:
    metadata: dict[str, str] = {}
    patterns = {
        "document_number": r"문서번호\s*[:：]\s*(.+)",
        "sender_org": r"발신\s*[:：]\s*(.+)",
        "receiver_org": r"수신\s*[:：]\s*(.+)",
        "issued_date": r"시행일자\s*[:：]\s*(.+)",
        "security_level": r"보안등급\s*[:：]\s*(.+)",
    }
    for key, pattern in patterns.items():
        match = re.search(pattern, text)
        if match:
            metadata[key] = match.group(1).strip()
    return metadata


def _is_metadata_line(line: str) -> bool:
    return any(line.startswith(prefix) for prefix in ("문서번호", "발신", "수신", "시행일자", "보안등급"))


def _parse_zip_xml_document(source_path: Path) -> StructuredDocument:
    text = _extract_zip_xml_text(source_path)
    if not text.strip():
        return StructuredDocument(
            source_path=source_path,
            title=source_path.stem,
            document_type=source_path.suffix.lower().lstrip("."),
            sections=[StructuredSection(heading=source_path.stem)],
            metadata={},
            parser_name="gongmu-zip-xml",
            quality_score=0.2,
            partial=True,
        )
    section = StructuredSection(heading=source_path.stem, paragraphs=[text])
    return StructuredDocument(
        source_path=source_path,
        title=source_path.stem,
        document_type=source_path.suffix.lower().lstrip("."),
        sections=[section],
        metadata=_extract_public_metadata(text),
        parser_name="gongmu-zip-xml",
        quality_score=0.55,
        partial=False,
    )


def _parse_docx_document(source_path: Path) -> StructuredDocument:
    try:
        with ZipFile(source_path) as archive:
            document_xml = archive.read("word/document.xml")
        root = ET.fromstring(document_xml)
    except (BadZipFile, KeyError, OSError, ET.ParseError, UnicodeDecodeError):
        return _parse_zip_xml_document(source_path)

    namespace = {"w": WORD_NS}
    body = root.find("w:body", namespace)
    if body is None:
        return _parse_zip_xml_document(source_path)

    sections: list[StructuredSection] = []
    current: StructuredSection | None = None
    text_parts: list[str] = []

    for child in body:
        tag = _local_xml_name(child.tag)
        if tag == "p":
            text = _word_paragraph_text(child)
            if not text:
                continue
            text_parts.append(text)
            heading_level = _word_heading_level(child)
            if heading_level:
                current = StructuredSection(heading=text, level=heading_level)
                sections.append(current)
            elif not _is_metadata_line(text):
                if current is None:
                    current = StructuredSection(heading=source_path.stem, level=1)
                    sections.append(current)
                current.paragraphs.append(text)
        elif tag == "tbl":
            table = _word_table(child)
            if table is None:
                continue
            if current is None:
                current = StructuredSection(heading=source_path.stem, level=1)
                sections.append(current)
            current.tables.append(table)

    if not sections:
        return _parse_zip_xml_document(source_path)

    document_text = "\n".join(text_parts)
    return StructuredDocument(
        source_path=source_path,
        title=sections[0].heading if sections else source_path.stem,
        document_type="docx",
        sections=sections,
        metadata=_extract_public_metadata(document_text),
        parser_name="gongmu-docx",
        quality_score=0.75,
        partial=False,
    )


def _local_xml_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _word_paragraph_text(element: ET.Element) -> str:
    values: list[str] = []
    for text_node in element.findall(".//w:t", {"w": WORD_NS}):
        if text_node.text:
            values.append(text_node.text)
    return "".join(values).strip()


def _word_heading_level(element: ET.Element) -> int | None:
    style = element.find("w:pPr/w:pStyle", {"w": WORD_NS})
    if style is None:
        return None
    value = style.attrib.get(f"{{{WORD_NS}}}val", "").lower()
    if value == "title":
        return 1
    match = re.match(r"heading(\d+)", value)
    if match:
        return max(1, min(6, int(match.group(1))))
    return None


def _word_table(element: ET.Element) -> StructuredTable | None:
    rows: list[list[str]] = []
    for row_element in element.findall("w:tr", {"w": WORD_NS}):
        row: list[str] = []
        for cell in row_element.findall("w:tc", {"w": WORD_NS}):
            cell_texts = [
                _word_paragraph_text(paragraph)
                for paragraph in cell.findall("w:p", {"w": WORD_NS})
            ]
            row.append("\n".join(text for text in cell_texts if text).strip())
        if any(cell.strip() for cell in row):
            rows.append(row)
    if not rows:
        return None
    headers = rows[0]
    body_rows = rows[1:]
    return StructuredTable(headers=headers, rows=body_rows)


def _parse_xlsx_document(source_path: Path) -> StructuredDocument:
    try:
        with ZipFile(source_path) as archive:
            shared_strings = _xlsx_shared_strings(archive)
            sheet_names = sorted(
                name
                for name in archive.namelist()
                if name.lower().startswith("xl/worksheets/sheet") and name.lower().endswith(".xml")
            )
            sections = [
                section
                for name in sheet_names
                if (section := _xlsx_sheet_section(name, archive.read(name), shared_strings)) is not None
            ]
    except (BadZipFile, KeyError, OSError, ET.ParseError, UnicodeDecodeError):
        return _parse_zip_xml_document(source_path)

    if not sections:
        return _parse_zip_xml_document(source_path)

    table_text = "\n".join(
        "\n".join(["\t".join(table.headers), *["\t".join(row) for row in table.rows]])
        for section in sections
        for table in section.tables
    )
    return StructuredDocument(
        source_path=source_path,
        title=source_path.stem,
        document_type="xlsx",
        sections=sections,
        metadata=_extract_public_metadata(table_text),
        parser_name="gongmu-xlsx",
        quality_score=0.7,
        partial=False,
    )


def _xlsx_shared_strings(archive: ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    values: list[str] = []
    for item in root.findall(f".//{{{SPREADSHEET_NS}}}si"):
        texts = [
            text_node.text or ""
            for text_node in item.findall(f".//{{{SPREADSHEET_NS}}}t")
        ]
        values.append("".join(texts))
    return values


def _xlsx_sheet_section(
    archive_name: str,
    raw_xml: bytes,
    shared_strings: list[str],
) -> StructuredSection | None:
    root = ET.fromstring(raw_xml)
    rows: list[list[str]] = []
    for row in root.findall(f".//{{{SPREADSHEET_NS}}}row"):
        values: list[str] = []
        for cell in row.findall(f"{{{SPREADSHEET_NS}}}c"):
            values.append(_xlsx_cell_value(cell, shared_strings))
        if any(value.strip() for value in values):
            rows.append(values)
    if not rows:
        return None
    sheet_name = Path(archive_name).stem
    return StructuredSection(
        heading=sheet_name,
        level=1,
        tables=[StructuredTable(headers=rows[0], rows=rows[1:])],
    )


def _xlsx_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    value = cell.find(f"{{{SPREADSHEET_NS}}}v")
    if value is None or value.text is None:
        return ""
    raw_value = value.text.strip()
    if cell.attrib.get("t") == "s":
        try:
            return shared_strings[int(raw_value)]
        except (ValueError, IndexError):
            return raw_value
    return raw_value


def _parse_pptx_document(source_path: Path) -> StructuredDocument:
    try:
        with ZipFile(source_path) as archive:
            slide_names = sorted(
                name
                for name in archive.namelist()
                if name.lower().startswith("ppt/slides/slide") and name.lower().endswith(".xml")
            )
            sections = [
                section
                for name in slide_names
                if (section := _pptx_slide_section(name, archive.read(name))) is not None
            ]
    except (BadZipFile, KeyError, OSError, ET.ParseError, UnicodeDecodeError):
        return _parse_zip_xml_document(source_path)

    if not sections:
        return _parse_zip_xml_document(source_path)

    document_text = "\n".join(
        "\n".join([section.heading, *section.paragraphs])
        for section in sections
    )
    return StructuredDocument(
        source_path=source_path,
        title=sections[0].heading,
        document_type="pptx",
        sections=sections,
        metadata=_extract_public_metadata(document_text),
        parser_name="gongmu-pptx",
        quality_score=0.65,
        partial=False,
    )


def _pptx_slide_section(archive_name: str, raw_xml: bytes) -> StructuredSection | None:
    root = ET.fromstring(raw_xml)
    texts = [
        node.text.strip()
        for node in root.findall(f".//{{{DRAWING_NS}}}t")
        if node.text and node.text.strip()
    ]
    if not texts:
        return None
    return StructuredSection(
        heading=texts[0],
        level=1,
        paragraphs=texts[1:],
    )


def _parse_hwpx_xml_document(source_path: Path) -> StructuredDocument:
    try:
        with ZipFile(source_path) as archive:
            section_names = sorted(
                name
                for name in archive.namelist()
                if name.lower().endswith(".xml")
                and not name.lower().endswith(".rels")
                and ("section" in name.lower() or "body" in name.lower() or "contents/" in name.lower())
            )
            sections = [
                section
                for name in section_names
                if (section := _hwpx_xml_section(source_path, name, archive.read(name))) is not None
            ]
    except (BadZipFile, KeyError, OSError, ET.ParseError, UnicodeDecodeError):
        return _parse_zip_xml_document(source_path)

    if not sections:
        return _parse_zip_xml_document(source_path)

    document_text = "\n".join(
        "\n".join([section.heading, *section.paragraphs])
        for section in sections
    )
    return StructuredDocument(
        source_path=source_path,
        title=sections[0].heading,
        document_type="hwpx",
        sections=sections,
        metadata=_extract_public_metadata(document_text),
        parser_name="gongmu-hwpx-xml",
        quality_score=0.6,
        partial=False,
    )


def _hwpx_xml_section(source_path: Path, archive_name: str, raw_xml: bytes) -> StructuredSection | None:
    root = ET.fromstring(raw_xml)
    section = StructuredSection(heading=source_path.stem, level=1)
    first_paragraph: str | None = None

    for block_type, element in _hwpx_top_level_blocks(root):
        if block_type == "p":
            text = _xml_text(element)
            if not text:
                continue
            if first_paragraph is None:
                first_paragraph = text
                section.heading = text
            else:
                section.paragraphs.append(text)
        elif block_type == "tbl":
            table = _hwpx_table(element)
            if table is not None:
                section.tables.append(table)

    if first_paragraph is None and not section.tables:
        return None
    if first_paragraph is None:
        section.heading = Path(archive_name).stem
    return section


def _hwpx_top_level_blocks(element: ET.Element) -> list[tuple[str, ET.Element]]:
    blocks: list[tuple[str, ET.Element]] = []
    for child in list(element):
        local_name = _local_xml_name(child.tag)
        if local_name == "p":
            blocks.append(("p", child))
        elif local_name in {"tbl", "table"}:
            blocks.append(("tbl", child))
        else:
            blocks.extend(_hwpx_top_level_blocks(child))
    return blocks


def _hwpx_table(element: ET.Element) -> StructuredTable | None:
    rows: list[list[str]] = []
    for row_element in _descendants_by_local_name(element, "tr"):
        row: list[str] = []
        for cell in _children_or_descendants_by_local_name(row_element, "tc"):
            row.append(_xml_text(cell))
        if any(value.strip() for value in row):
            rows.append(row)
    if not rows:
        return None
    return StructuredTable(headers=rows[0], rows=rows[1:])


def _children_or_descendants_by_local_name(element: ET.Element, local_name: str) -> list[ET.Element]:
    direct_children = [child for child in list(element) if _local_xml_name(child.tag) == local_name]
    if direct_children:
        return direct_children
    return _descendants_by_local_name(element, local_name)


def _descendants_by_local_name(element: ET.Element, local_name: str) -> list[ET.Element]:
    return [child for child in element.iter() if child is not element and _local_xml_name(child.tag) == local_name]


def _xml_text(element: ET.Element) -> str:
    values: list[str] = []
    for child in element.iter():
        local_name = _local_xml_name(child.tag)
        if local_name in {"t", "text", "v"} and child.text:
            text = child.text.strip()
            if text:
                values.append(text)
    return "".join(values).strip()


def _extract_zip_xml_text(source_path: Path) -> str:
    try:
        with ZipFile(source_path) as archive:
            names = [
                name
                for name in archive.namelist()
                if name.lower().endswith(".xml") and not name.lower().endswith(".rels")
            ]
            parts: list[str] = []
            for name in names:
                parts.extend(_xml_text_nodes(archive.read(name)))
            return "\n".join(parts)
    except (BadZipFile, KeyError, OSError, ET.ParseError, UnicodeDecodeError):
        return ""


def _xml_text_nodes(raw_xml: bytes) -> list[str]:
    root = ET.fromstring(raw_xml)
    values: list[str] = []
    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag in {"t", "v"} and element.text:
            text = element.text.strip()
            if text:
                values.append(text)
    return values


def _parse_pdf_document(source_path: Path) -> StructuredDocument:
    pages: list[str] = []
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(str(source_path))
        pages = [
            page_text
            for page in reader.pages
            if (page_text := _normalize_extracted_text(page.extract_text() or ""))
        ]
    except Exception:
        pages = []
    text = "\n\n".join(pages)
    sections = _pdf_sections_from_pages(source_path, pages)
    metadata = _extract_public_metadata(text)
    if pages:
        metadata["page_count"] = len(pages)
    return StructuredDocument(
        source_path=source_path,
        title=source_path.stem,
        document_type="pdf",
        sections=sections if sections else [StructuredSection(heading=source_path.stem)],
        metadata=metadata,
        parser_name="gongmu-pdf",
        quality_score=0.6 if len(sections) > 1 else (0.45 if text.strip() else 0.1),
        partial=not bool(text.strip()),
    )


def _normalize_extracted_text(text: str) -> str:
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.replace("\r\n", "\n").replace("\r", "\n").splitlines()]
    return "\n".join(line for line in lines if line)


def _pdf_sections_from_pages(source_path: Path, pages: list[str]) -> list[StructuredSection]:
    sections: list[StructuredSection] = []
    for page_index, page_text in enumerate(pages, start=1):
        page_sections = _pdf_sections_from_text(source_path.stem, page_text, page_index)
        sections.extend(page_sections)
    return _split_oversized_sections(sections)


def _pdf_sections_from_text(title: str, text: str, page_index: int) -> list[StructuredSection]:
    sections: list[StructuredSection] = []
    current = StructuredSection(heading=f"{title} p.{page_index}", level=1)
    for block in _pdf_text_blocks(text):
        heading = _parse_pdf_heading(block)
        if heading:
            if current.paragraphs:
                sections.append(current)
            current = StructuredSection(heading=heading, level=1)
            remainder = block[len(heading) :].strip(" :-")
            if remainder:
                current.paragraphs.append(remainder)
            continue
        current.paragraphs.append(block)
    if current.paragraphs or not sections:
        sections.append(current)
    return sections


def _pdf_text_blocks(text: str) -> list[str]:
    line_blocks = [line.strip() for line in text.splitlines() if line.strip()]
    if len(line_blocks) > 1:
        return line_blocks
    compact = " ".join(text.split())
    if not compact:
        return []
    heading_split = re.split(r"(?=(?:\d{1,2}[.)]|[가-힣][.)]|[IVXLC]+[.)])\s+)", compact)
    blocks = [block.strip() for block in heading_split if block.strip()]
    return blocks if blocks else [compact]


def _parse_pdf_heading(block: str) -> str | None:
    first_line = block.splitlines()[0].strip()
    match = re.match(r"^((?:\d{1,2}[.)]|[가-힣][.)]|[IVXLC]+[.)])\s+[^:：]{2,80})", first_line, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    if first_line.startswith(("□", "■", "○", "◦")) and len(first_line) <= 90:
        return first_line.strip("□■○◦ ").strip() or first_line
    return None


def _split_oversized_sections(sections: list[StructuredSection], max_chars: int = 1800) -> list[StructuredSection]:
    sized: list[StructuredSection] = []
    for section in sections:
        if len(section.text) <= max_chars:
            sized.append(section)
            continue
        pieces = _split_long_pdf_text("\n".join(section.paragraphs), max_chars=max_chars)
        for index, piece in enumerate(pieces, start=1):
            heading = section.heading if index == 1 else f"{section.heading} 계속 {index}"
            sized.append(StructuredSection(heading=heading, level=section.level, paragraphs=[piece]))
    return sized


def _split_long_pdf_text(text: str, max_chars: int = 1800) -> list[str]:
    compact = " ".join(text.split())
    if len(compact) <= max_chars:
        return [compact] if compact else []
    sentences = [sentence.strip() for sentence in re.split(r"(?<=[.!?。다])\s+", compact) if sentence.strip()]
    if len(sentences) <= 1:
        return [compact[index : index + max_chars].strip() for index in range(0, len(compact), max_chars)]
    pieces: list[str] = []
    current = ""
    for sentence in sentences:
        if current and len(current) + len(sentence) + 1 > max_chars:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces
