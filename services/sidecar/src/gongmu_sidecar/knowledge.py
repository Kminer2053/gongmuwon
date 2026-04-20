from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from uuid import uuid4

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

        page_id = str(uuid4())
        slug = candidate["proposed_page_slug"]
        page_dir = self.paths.knowledge_structured / f"{page_type}s"
        page_dir.mkdir(parents=True, exist_ok=True)
        page_path = page_dir / f"{slug}.md"
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
            "graph_neighbors": sorted(set(neighbors)),
        }

    def graph_summary(self) -> dict[str, Any]:
        data = self._read_graph()
        nodes = data.get("nodes", [])
        edges = data.get("edges") or data.get("links") or []
        return {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "artifacts": {
                "graph_json_path": str(self.graph_path),
                "graph_html_path": str(self.graph_html_path),
                "graph_report_path": str(self.graph_report_path),
            },
            "nodes": nodes[:20],
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
