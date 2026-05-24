from __future__ import annotations

import hashlib
import json
import mimetypes
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

import lancedb
import networkx as nx
from networkx.readwrite import json_graph

from .db import Database, now_iso
from .embeddings import hash_embed, tokenize
from .workspace import WorkspacePaths


def slugify(value: str) -> str:
    slug = re.sub(r"[^\w가-힣\s-]", "", value, flags=re.UNICODE).strip().lower()
    slug = re.sub(r"[\s_]+", "-", slug)
    return slug or f"note-{uuid4().hex[:8]}"


class KnowledgeManager:
    TEXT_EXTENSIONS = {".md", ".markdown", ".txt", ".csv", ".json"}
    METADATA_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx", ".hwp", ".hwpx"}
    EXCLUDED_PATH_PARTS = {
        ".git",
        ".hg",
        ".svn",
        ".venv",
        "venv",
        "__pycache__",
        "node_modules",
        "dist",
        "build",
        "target",
    }

    def __init__(self, paths: WorkspacePaths, db: Database) -> None:
        self.paths = paths
        self.db = db
        self.lancedb = lancedb.connect(str(self.paths.cache / "lancedb"))
        self.graph_path = self.paths.knowledge_graph / "graph.json"
        self.graph_html_path = self.paths.knowledge_graph / "graph.html"
        self.graph_report_path = self.paths.knowledge_graph / "GRAPH_REPORT.md"

    def _table(self):
        table_listing = self.lancedb.list_tables()
        table_names = list(getattr(table_listing, "tables", table_listing))
        if "knowledge_chunks" in table_names:
            return self.lancedb.open_table("knowledge_chunks")

        bootstrap = [{"id": "bootstrap", "text": "", "vector": hash_embed(""), "page_id": ""}]
        table = self.lancedb.create_table("knowledge_chunks", data=bootstrap)
        table.delete("id = 'bootstrap'")
        return table

    def add_chunk(self, *, chunk_id: str, text: str, page_id: str) -> None:
        self._table().add(
            [{"id": chunk_id, "text": text, "vector": hash_embed(text), "page_id": page_id}]
        )

    def register_source(self, *, label: str, root_path: str) -> dict[str, Any]:
        normalized_label = label.strip()
        if not normalized_label:
            raise ValueError("knowledge source label is required")

        root = Path(root_path).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError("knowledge source root_path must be an existing directory")

        existing = self.db.fetch_one(
            "SELECT * FROM knowledge_sources WHERE root_path = ?",
            (str(root),),
        )
        if existing is not None:
            self.db.execute(
                "UPDATE knowledge_sources SET label = ?, status = ?, updated_at = ? WHERE id = ?",
                (normalized_label, "active", now_iso(), existing["id"]),
            )
            return self.db.fetch_one(
                "SELECT * FROM knowledge_sources WHERE id = ?",
                (existing["id"],),
            ) or existing

        timestamp = now_iso()
        payload = {
            "id": str(uuid4()),
            "label": normalized_label,
            "root_path": str(root),
            "status": "active",
            "last_scanned_at": None,
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        self.db.insert("knowledge_sources", payload)
        self.db.log(
            feature="knowledge",
            action="knowledge.source.registered",
            status="success",
            inputs={"label": normalized_label, "root_path": str(root)},
            outputs={"source_id": payload["id"]},
        )
        return payload

    def list_sources(self) -> list[dict[str, Any]]:
        return self.db.fetch_all("SELECT * FROM knowledge_sources ORDER BY created_at DESC")

    def list_source_files(self, source_id: str | None = None) -> list[dict[str, Any]]:
        if source_id:
            return self.db.fetch_all(
                "SELECT * FROM knowledge_source_files WHERE source_id = ? ORDER BY updated_at DESC",
                (source_id,),
            )
        return self.db.fetch_all("SELECT * FROM knowledge_source_files ORDER BY updated_at DESC")

    def scan_source(self, source_id: str) -> dict[str, Any]:
        source = self.db.fetch_one("SELECT * FROM knowledge_sources WHERE id = ?", (source_id,))
        if source is None:
            raise KeyError(source_id)

        root = Path(source["root_path"]).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            self.db.execute(
                "UPDATE knowledge_sources SET status = ?, updated_at = ? WHERE id = ?",
                ("missing", now_iso(), source_id),
            )
            raise ValueError("knowledge source root_path is no longer available")

        seen_paths: set[str] = set()
        indexed_count = 0
        metadata_count = 0
        failed_count = 0
        scanned_at = now_iso()

        for file_path in sorted(root.rglob("*")):
            if not file_path.is_file() or self._is_excluded(file_path):
                continue
            extension = file_path.suffix.lower()
            if extension not in self.TEXT_EXTENSIONS and extension not in self.METADATA_EXTENSIONS:
                continue

            try:
                file_record = self._build_file_record(source_id=source_id, root=root, file_path=file_path)
                seen_paths.add(file_record["file_path"])
                self._upsert_source_file(file_record)
                if file_record["status"] == "indexed":
                    indexed_count += 1
                else:
                    metadata_count += 1
            except OSError:
                failed_count += 1

        deleted_count = self._mark_deleted_source_files(source_id, seen_paths, scanned_at)
        self.db.execute(
            "UPDATE knowledge_sources SET status = ?, last_scanned_at = ?, updated_at = ? WHERE id = ?",
            ("active", scanned_at, scanned_at, source_id),
        )
        result = {
            "source_id": source_id,
            "status": "completed",
            "indexed_count": indexed_count,
            "metadata_count": metadata_count,
            "deleted_count": deleted_count,
            "failed_count": failed_count,
            "scanned_at": scanned_at,
        }
        self.db.log(
            feature="knowledge",
            action="knowledge.source.scanned",
            status="success",
            inputs={"source_id": source_id, "root_path": str(root)},
            outputs=result,
        )
        return result

    def create_candidate(self, *, title: str, body: str, candidate_type: str) -> dict[str, Any]:
        candidate_id = str(uuid4())
        payload = {
            "id": candidate_id,
            "title": title,
            "body": body,
            "candidate_type": candidate_type,
            "status": "pending",
            "proposed_page_slug": slugify(title),
            "proposed_page_type": candidate_type,
            "approved_page_id": None,
            "approved_page_path": None,
            "created_at": now_iso(),
            "approved_at": None,
        }
        self.db.insert("knowledge_candidates", payload)
        self.db.log(
            feature="knowledge",
            action="knowledge.candidate.created",
            status="success",
            inputs={"title": title, "candidate_type": candidate_type},
            outputs={"candidate_id": candidate_id},
        )
        return payload

    def approve_candidate(self, candidate_id: str, page_type: str) -> dict[str, Any]:
        candidate = self.db.fetch_one(
            "SELECT * FROM knowledge_candidates WHERE id = ?",
            (candidate_id,),
        )
        if candidate is None:
            raise KeyError(candidate_id)
        if candidate["status"] == "approved":
            raise ValueError("candidate already approved")

        page_id = str(uuid4())
        page_dir = self.paths.knowledge_structured / f"{page_type}s"
        page_dir.mkdir(parents=True, exist_ok=True)
        slug, page_path = self._available_page_path(page_dir, candidate["proposed_page_slug"])
        title = candidate["title"]
        body = candidate["body"].strip()
        note = (
            "---\n"
            f"id: {page_id}\n"
            f"title: {title}\n"
            f"type: {page_type}\n"
            f"source_candidate_id: {candidate_id}\n"
            "confidence: medium\n"
            f"created_at: {now_iso()}\n"
            "---\n\n"
            f"# {title}\n\n"
            "## 요약\n"
            f"{body}\n\n"
            "## 관련 노트\n"
            "[[지식 인덱스]]\n\n"
            "## 출처\n"
            f"- 반영 후보 메모: {title}\n"
        )
        page_path.write_text(note, encoding="utf-8")

        page = {
            "id": page_id,
            "slug": slug,
            "title": title,
            "page_type": page_type,
            "path": str(page_path),
            "source_candidate_id": candidate_id,
            "created_at": now_iso(),
        }
        self.db.insert("knowledge_pages", page)
        self.db.execute(
            "UPDATE knowledge_candidates SET status = ?, approved_page_id = ?, approved_page_path = ?, approved_at = ? WHERE id = ?",
            ("approved", page_id, str(page_path), now_iso(), candidate_id),
        )
        self.add_chunk(chunk_id=str(uuid4()), text=f"{title}\n{body}", page_id=page_id)
        graph = self._update_graph(page=page, body=body)
        self.db.log(
            feature="knowledge",
            action="knowledge.candidate.approved",
            status="success",
            inputs={"candidate_id": candidate_id, "page_type": page_type},
            outputs={"page_id": page_id, "path": str(page_path), "nodes": graph["node_count"]},
        )
        return {"page": page, "graph": graph}

    def search(self, query: str, limit: int = 5) -> dict[str, Any]:
        vector_hits = self._table().search(hash_embed(query)).limit(limit).to_list()
        keyword = set(tokenize(query))

        page_hits = []
        for hit in vector_hits:
            page = self.db.fetch_one("SELECT * FROM knowledge_pages WHERE id = ?", (hit["page_id"],))
            if page:
                page_hits.append(
                    {
                        "page": page,
                        "score": float(hit.get("_distance", 0.0)),
                        "keyword_overlap": len(keyword.intersection(tokenize(hit["text"]))),
                    }
                )

        graph_data = self._read_graph()
        neighbors: list[str] = []
        if graph_data["nodes"]:
            for node in graph_data["nodes"]:
                if query.lower() in node.get("label", "").lower():
                    neighbors.extend(node.get("neighbors", []))

        return {
            "query": query,
            "vector_hits": page_hits,
            "source_file_hits": self._search_source_files(query, limit=limit),
            "graph_neighbors": sorted(set(neighbors)),
        }

    def search_source_files(self, query: str, limit: int = 20) -> dict[str, Any]:
        normalized_query = query.strip().lower()
        if not normalized_query:
            return {"query": query, "items": []}

        safe_limit = max(1, min(limit, 50))
        query_tokens = set(tokenize(normalized_query))
        candidates = self.db.fetch_all(
            """
            SELECT *
            FROM knowledge_source_files
            WHERE status != ?
            ORDER BY updated_at DESC
            """,
            ("deleted",),
        )

        hits: list[dict[str, Any]] = []
        for file_record in candidates:
            score, reasons = self._score_source_file_hit(
                file_record=file_record,
                normalized_query=normalized_query,
                query_tokens=query_tokens,
            )
            if score <= 0:
                continue
            hits.append({"file": file_record, "score": score, "match_reasons": reasons})

        hits.sort(key=lambda hit: (hit["score"], hit["file"].get("updated_at") or ""), reverse=True)
        return {"query": query, "items": hits[:safe_limit]}

    def graph_summary(self) -> dict[str, Any]:
        data = self._read_graph()
        source_graph = self._source_graph_summary()
        nodes_by_id = {
            str(node.get("id")): node
            for node in [*data.get("nodes", []), *source_graph["nodes"]]
            if node.get("id")
        }
        edges = [*(data.get("edges") or data.get("links") or []), *source_graph["edges"]]
        neighbor_map: dict[str, set[str]] = {node_id: set() for node_id in nodes_by_id}
        for edge in edges:
            source = str(edge.get("source") or "")
            target = str(edge.get("target") or "")
            if source and target:
                neighbor_map.setdefault(source, set()).add(target)
                neighbor_map.setdefault(target, set()).add(source)
        nodes = []
        for node_id, node in nodes_by_id.items():
            neighbors = [
                nodes_by_id.get(neighbor, {}).get("label", neighbor)
                for neighbor in sorted(neighbor_map.get(node_id, set()))
            ]
            nodes.append({**node, "neighbors": neighbors})
        return {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "artifacts": {
                "graph_json_path": str(self.graph_path),
                "graph_html_path": str(self.graph_html_path),
                "graph_report_path": str(self.graph_report_path),
            },
            "nodes": nodes[:20],
            "edges": edges[:40],
        }

    def _read_graph(self) -> dict[str, Any]:
        if not self.graph_path.exists():
            return {"nodes": [], "edges": []}
        return json.loads(self.graph_path.read_text(encoding="utf-8"))

    def _update_graph(self, *, page: dict[str, Any], body: str) -> dict[str, Any]:
        if self.graph_path.exists():
            data = json.loads(self.graph_path.read_text(encoding="utf-8"))
            graph = json_graph.node_link_graph(data)
        else:
            graph = nx.Graph()

        page_node = page["id"]
        graph.add_node(page_node, label=page["title"], node_type=page["page_type"])
        keywords = [token for token in tokenize(body) if len(token) >= 2][:6]
        for keyword in keywords:
            concept_id = f"concept:{keyword}"
            graph.add_node(concept_id, label=keyword, node_type="concept")
            graph.add_edge(page_node, concept_id, relation="mentions")

        serializable = json_graph.node_link_data(graph)
        neighbor_map = {
            node: [graph.nodes[neighbor].get("label", neighbor) for neighbor in graph.neighbors(node)]
            for node in graph.nodes
        }
        for node in serializable["nodes"]:
            node["neighbors"] = neighbor_map.get(node["id"], [])

        self.graph_path.write_text(
            json.dumps(serializable, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self.graph_html_path.write_text(
            (
                "<!doctype html><html><head><meta charset='utf-8'><title>Gongmu Graph</title>"
                "<style>body{font-family:system-ui;padding:24px;}pre{white-space:pre-wrap;}</style>"
                "</head><body><h1>공무 지식 그래프</h1><pre>"
                + json.dumps(serializable, ensure_ascii=False, indent=2)
                + "</pre></body></html>"
            ),
            encoding="utf-8",
        )
        report = [
            "# GRAPH_REPORT",
            "",
            f"- node_count: {graph.number_of_nodes()}",
            f"- edge_count: {graph.number_of_edges()}",
            "",
            "## 주요 노드",
        ]
        for node_id, attrs in list(graph.nodes(data=True))[:10]:
            report.append(f"- {attrs.get('label', node_id)} ({attrs.get('node_type', 'unknown')})")
        self.graph_report_path.write_text("\n".join(report), encoding="utf-8")
        return {
            "node_count": graph.number_of_nodes(),
            "edge_count": graph.number_of_edges(),
            "graph_json_path": str(self.graph_path),
            "graph_html_path": str(self.graph_html_path),
            "graph_report_path": str(self.graph_report_path),
        }

    def _available_page_path(self, page_dir: Path, slug: str) -> tuple[str, Path]:
        candidate_slug = slug
        counter = 2
        while True:
            candidate_path = page_dir / f"{candidate_slug}.md"
            if not candidate_path.exists():
                return candidate_slug, candidate_path
            candidate_slug = f"{slug}-{counter}"
            counter += 1

    def _is_excluded(self, path: Path) -> bool:
        return any(part in self.EXCLUDED_PATH_PARTS or part.startswith(".") for part in path.parts)

    def _build_file_record(self, *, source_id: str, root: Path, file_path: Path) -> dict[str, Any]:
        file_hash = self._sha256(file_path)
        stat = file_path.stat()
        modified_at = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
        extension = file_path.suffix.lower()
        extracted_text_path: str | None = None
        text_excerpt: str | None = None
        title = file_path.stem
        status = "metadata_only"

        if extension in self.TEXT_EXTENSIONS:
            text = file_path.read_text(encoding="utf-8", errors="replace")
            title = self._title_from_text(text, fallback=file_path.stem)
            text_excerpt = self._excerpt(text)
            extracted_path = self.paths.knowledge_raw / "source-files" / source_id / f"{file_hash}.txt"
            extracted_path.parent.mkdir(parents=True, exist_ok=True)
            extracted_path.write_text(text, encoding="utf-8")
            extracted_text_path = str(extracted_path)
            status = "indexed"
        elif extension in self.METADATA_EXTENSIONS:
            text = self._extract_document_text(file_path, extension)
            if text.strip():
                title = self._title_from_text(text, fallback=file_path.stem)
                text_excerpt = self._excerpt(text)
                extracted_path = self.paths.knowledge_raw / "source-files" / source_id / f"{file_hash}.txt"
                extracted_path.parent.mkdir(parents=True, exist_ok=True)
                extracted_path.write_text(text, encoding="utf-8")
                extracted_text_path = str(extracted_path)
                status = "indexed"

        timestamp = now_iso()
        return {
            "id": str(uuid4()),
            "source_id": source_id,
            "file_path": str(file_path),
            "relative_path": file_path.relative_to(root).as_posix(),
            "file_hash": file_hash,
            "size_bytes": stat.st_size,
            "modified_at": modified_at,
            "status": status,
            "title": title,
            "mime_type": mimetypes.guess_type(file_path.name)[0],
            "text_excerpt": text_excerpt,
            "extracted_text_path": extracted_text_path,
            "created_at": timestamp,
            "updated_at": timestamp,
        }

    def _upsert_source_file(self, payload: dict[str, Any]) -> None:
        existing = self.db.fetch_one(
            "SELECT * FROM knowledge_source_files WHERE source_id = ? AND file_path = ?",
            (payload["source_id"], payload["file_path"]),
        )
        if existing is None:
            self.db.insert("knowledge_source_files", payload)
            return

        self.db.execute(
            """
            UPDATE knowledge_source_files
            SET relative_path = ?,
                file_hash = ?,
                size_bytes = ?,
                modified_at = ?,
                status = ?,
                title = ?,
                mime_type = ?,
                text_excerpt = ?,
                extracted_text_path = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                payload["relative_path"],
                payload["file_hash"],
                payload["size_bytes"],
                payload["modified_at"],
                payload["status"],
                payload["title"],
                payload["mime_type"],
                payload["text_excerpt"],
                payload["extracted_text_path"],
                payload["updated_at"],
                existing["id"],
            ),
        )

    def _mark_deleted_source_files(self, source_id: str, seen_paths: set[str], timestamp: str) -> int:
        existing_files = self.db.fetch_all(
            "SELECT id, file_path FROM knowledge_source_files WHERE source_id = ? AND status != ?",
            (source_id, "deleted"),
        )
        deleted_count = 0
        for row in existing_files:
            if row["file_path"] in seen_paths:
                continue
            self.db.execute(
                "UPDATE knowledge_source_files SET status = ?, updated_at = ? WHERE id = ?",
                ("deleted", timestamp, row["id"]),
            )
            deleted_count += 1
        return deleted_count

    def _sha256(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _title_from_text(self, text: str, fallback: str) -> str:
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                title = stripped.lstrip("#").strip()
                if title:
                    return title
            if stripped:
                return stripped[:80]
        return fallback

    def _excerpt(self, text: str, limit: int = 240) -> str:
        return re.sub(r"\s+", " ", text).strip()[:limit]

    def _extract_document_text(self, file_path: Path, extension: str) -> str:
        if extension == ".docx":
            return self._extract_zip_xml_text(file_path, ["word/document.xml"])
        if extension == ".xlsx":
            return self._extract_xlsx_text(file_path)
        if extension in {".pptx", ".hwpx"}:
            return self._extract_zip_xml_text(file_path, None)
        if extension == ".pdf":
            return self._extract_pdf_text(file_path)
        return ""

    def _extract_zip_xml_text(self, file_path: Path, preferred_members: list[str] | None) -> str:
        try:
            with ZipFile(file_path) as archive:
                names = preferred_members or [
                    name
                    for name in archive.namelist()
                    if name.lower().endswith(".xml") and not name.lower().endswith(".rels")
                ]
                parts: list[str] = []
                for name in names:
                    if name not in archive.namelist():
                        continue
                    parts.extend(self._xml_text_nodes(archive.read(name)))
                return "\n".join(parts)
        except (BadZipFile, KeyError, OSError, ET.ParseError, UnicodeDecodeError):
            return ""

    def _extract_xlsx_text(self, file_path: Path) -> str:
        try:
            with ZipFile(file_path) as archive:
                names = archive.namelist()
                candidates = ["xl/sharedStrings.xml"] + [
                    name
                    for name in names
                    if name.startswith("xl/worksheets/") and name.endswith(".xml")
                ]
                parts: list[str] = []
                for name in candidates:
                    if name in names:
                        parts.extend(self._xml_text_nodes(archive.read(name)))
                return "\n".join(parts)
        except (BadZipFile, KeyError, OSError, ET.ParseError, UnicodeDecodeError):
            return ""

    def _xml_text_nodes(self, raw_xml: bytes) -> list[str]:
        root = ET.fromstring(raw_xml)
        values: list[str] = []
        for element in root.iter():
            tag = element.tag.rsplit("}", 1)[-1]
            if tag in {"t", "v"} and element.text:
                text = element.text.strip()
                if text:
                    values.append(text)
        return values

    def _extract_pdf_text(self, file_path: Path) -> str:
        try:
            from pypdf import PdfReader  # type: ignore
        except Exception:
            return ""
        try:
            reader = PdfReader(str(file_path))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception:
            return ""

    def _source_graph_summary(self) -> dict[str, list[dict[str, Any]]]:
        sources = self.db.fetch_all("SELECT * FROM knowledge_sources WHERE status != ? ORDER BY created_at DESC", ("deleted",))
        files = self.db.fetch_all(
            "SELECT * FROM knowledge_source_files WHERE status != ? ORDER BY updated_at DESC",
            ("deleted",),
        )
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        seen_keywords: set[str] = set()

        for source in sources:
            source_node_id = f"source_folder:{source['id']}"
            nodes.append(
                {
                    "id": source_node_id,
                    "label": source["label"],
                    "node_type": "source_folder",
                    "path": source["root_path"],
                }
            )

        for file_record in files:
            file_node_id = f"source_file:{file_record['id']}"
            source_node_id = f"source_folder:{file_record['source_id']}"
            text = "\n".join(
                value
                for value in [
                    str(file_record.get("title") or ""),
                    str(file_record.get("relative_path") or ""),
                    str(file_record.get("text_excerpt") or ""),
                    self._read_extracted_text(file_record.get("extracted_text_path")),
                ]
                if value
            )
            nodes.append(
                {
                    "id": file_node_id,
                    "label": file_record.get("title") or file_record.get("relative_path") or file_record["file_path"],
                    "node_type": "source_file",
                    "path": file_record["file_path"],
                    "status": file_record["status"],
                }
            )
            edges.append({"source": source_node_id, "target": file_node_id, "relation": "contains"})

            for keyword in [token for token in tokenize(text) if len(token) >= 3][:8]:
                keyword_node_id = f"keyword:{keyword}"
                if keyword_node_id not in seen_keywords:
                    nodes.append({"id": keyword_node_id, "label": keyword, "node_type": "keyword"})
                    seen_keywords.add(keyword_node_id)
                edges.append({"source": file_node_id, "target": keyword_node_id, "relation": "mentions"})

        return {"nodes": nodes, "edges": edges}

    def _search_source_files(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        normalized_query = query.strip().lower()
        if not normalized_query:
            return []

        query_tokens = set(tokenize(normalized_query))
        candidates = self.db.fetch_all(
            """
            SELECT *
            FROM knowledge_source_files
            WHERE status = ?
            ORDER BY updated_at DESC
            """,
            ("indexed",),
        )

        hits: list[dict[str, Any]] = []
        for file_record in candidates:
            haystack = "\n".join(
                str(value or "")
                for value in (
                    file_record.get("title"),
                    file_record.get("relative_path"),
                    file_record.get("text_excerpt"),
                    self._read_extracted_text(file_record.get("extracted_text_path")),
                )
            ).lower()
            overlap = len(query_tokens.intersection(tokenize(haystack)))
            if normalized_query in haystack:
                overlap = max(overlap, 1)
            if overlap == 0:
                continue
            hits.append({"file": file_record, "keyword_overlap": overlap})

        hits.sort(key=lambda hit: hit["keyword_overlap"], reverse=True)
        return hits[:limit]

    def _score_source_file_hit(
        self,
        *,
        file_record: dict[str, Any],
        normalized_query: str,
        query_tokens: set[str],
    ) -> tuple[int, list[str]]:
        title = str(file_record.get("title") or "")
        relative_path = str(file_record.get("relative_path") or "")
        file_path = str(file_record.get("file_path") or "")
        file_name = Path(file_path).name
        excerpt = str(file_record.get("text_excerpt") or "")
        extracted_text = self._read_extracted_text(file_record.get("extracted_text_path"))

        score = 0
        reasons: list[str] = []

        name_haystack = "\n".join([file_name, title]).lower()
        path_haystack = "\n".join([relative_path, file_path]).lower()
        body_haystack = "\n".join([excerpt, extracted_text]).lower()

        if normalized_query in name_haystack:
            score += 120
            reasons.append("파일명")
        if normalized_query in path_haystack:
            score += 80
            reasons.append("경로")
        if body_haystack and normalized_query in body_haystack:
            score += 70
            reasons.append("본문")

        metadata_tokens = set(tokenize("\n".join([file_name, title, relative_path, file_path]).lower()))
        body_tokens = set(tokenize(body_haystack))
        metadata_overlap = len(query_tokens.intersection(metadata_tokens))
        body_overlap = len(query_tokens.intersection(body_tokens))

        if metadata_overlap:
            score += metadata_overlap * 12
            if "파일명" not in reasons and "경로" not in reasons:
                reasons.append("파일정보")
        if body_overlap:
            score += body_overlap * 10
            if "본문" not in reasons:
                reasons.append("본문")
        if score > 0 and file_record.get("status") == "indexed":
            score += 2

        return score, reasons

    def _read_extracted_text(self, path_value: Any) -> str:
        if not path_value:
            return ""
        path = Path(str(path_value))
        if not path.exists() or not path.is_file():
            return ""
        try:
            return path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
