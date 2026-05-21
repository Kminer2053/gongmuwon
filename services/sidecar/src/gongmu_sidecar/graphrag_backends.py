from __future__ import annotations

import json
from importlib import import_module
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence


Importer = Callable[[str], Any]
CONTRACT_VERSION = "graphrag-backend-v1"
DEFAULT_CHROMA_COLLECTION = "gongmu_chunks"


def _default_chroma_client_factory(path: Path) -> Any:
    chromadb = import_module("chromadb")
    return chromadb.PersistentClient(path=str(path))


def _chroma_metadata_value(value: Any) -> str | int | float | bool:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _first_result_row(result: Mapping[str, Any], key: str) -> list[Any]:
    rows = result.get(key) or [[]]
    if not rows:
        return []
    first_row = rows[0]
    return first_row if isinstance(first_row, list) else []


class ChromaVectorBackend:
    """ChromaDB adapter for sidecar-owned, precomputed GraphRAG embeddings."""

    def __init__(
        self,
        path: Path,
        *,
        collection_name: str = DEFAULT_CHROMA_COLLECTION,
        client_factory: Callable[[Path], Any] | None = None,
    ) -> None:
        self.path = Path(path)
        self.collection_name = collection_name
        self._client_factory = client_factory or _default_chroma_client_factory
        self._client: Any | None = None
        self._collection: Any | None = None

    @property
    def collection(self) -> Any:
        if self._collection is None:
            self.path.mkdir(parents=True, exist_ok=True)
            self._client = self._client_factory(self.path)
            self._collection = self._client.get_or_create_collection(
                name=self.collection_name,
                embedding_function=None,
            )
        return self._collection

    def upsert_chunks(self, records: Iterable[Mapping[str, Any]]) -> list[str]:
        chunk_records = list(records)
        if not chunk_records:
            return []

        ids: list[str] = []
        documents: list[str] = []
        embeddings: list[list[float]] = []
        metadatas: list[dict[str, str | int | float | bool]] = []

        for record in chunk_records:
            chunk_id = str(record["chunk_id"])
            metadata = {
                key: _chroma_metadata_value(value)
                for key, value in dict(record.get("metadata") or {}).items()
            }
            metadata.update(
                {
                    "chunk_id": chunk_id,
                    "document_id": str(record["document_id"]),
                    "section_id": str(record["section_id"]),
                }
            )
            ids.append(chunk_id)
            documents.append(str(record["text"]))
            embeddings.append([float(value) for value in record["embedding"]])
            metadatas.append(metadata)

        self.collection.upsert(
            ids=ids,
            documents=documents,
            embeddings=embeddings,
            metadatas=metadatas,
        )
        return [self._vector_ref(chunk_id) for chunk_id in ids]

    def query_chunks(
        self,
        query_embedding: Sequence[float],
        *,
        limit: int = 10,
        where: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        result = self.collection.query(
            query_embeddings=[[float(value) for value in query_embedding]],
            n_results=limit,
            where=dict(where) if where is not None else None,
            include=["documents", "metadatas", "distances"],
        )
        ids = _first_result_row(result, "ids")
        documents = _first_result_row(result, "documents")
        metadatas = _first_result_row(result, "metadatas")
        distances = _first_result_row(result, "distances")

        normalized: list[dict[str, Any]] = []
        for index, raw_id in enumerate(ids):
            chunk_id = str(raw_id)
            metadata = metadatas[index] if index < len(metadatas) else {}
            normalized.append(
                {
                    "chunk_id": chunk_id,
                    "text": documents[index] if index < len(documents) else "",
                    "metadata": metadata if isinstance(metadata, dict) else {},
                    "distance": distances[index] if index < len(distances) else None,
                    "vector_ref": self._vector_ref(chunk_id),
                }
            )
        return normalized

    def delete_document(self, document_id: str) -> None:
        self.collection.delete(where={"document_id": str(document_id)})

    def close(self) -> None:
        if self._client is None:
            return
        close_client = getattr(self._client, "close", None)
        if callable(close_client):
            close_client()
        self._collection = None
        self._client = None

    def _vector_ref(self, chunk_id: str) -> str:
        return f"chromadb:{self.collection_name}:{chunk_id}"


def _optional_module(module_name: str, importer: Importer) -> tuple[bool, str | None]:
    try:
        importer(module_name)
    except ModuleNotFoundError as exc:
        if exc.name in {module_name, None} and str(exc).strip("'\"") == module_name:
            return False, f"{module_name} is not installed"
        if exc.name == module_name:
            return False, f"{module_name} is not installed"
        return False, str(exc)
    except Exception as exc:  # pragma: no cover - defensive for broken native wheels.
        return False, str(exc)
    return True, None


def _activation_blockers(available: bool, detail: str | None) -> list[str]:
    return [] if available else [detail or "optional backend package is not installed"]


def _activation_notes(*, active: bool, backend_name: str) -> list[str]:
    if active:
        return [f"{backend_name} is active for this sidecar process"]
    return [f"{backend_name} is installed but not enabled; SQLite fallback remains active"]


def build_backend_status(
    workspace_root: Path,
    importer: Importer = import_module,
    *,
    production_enabled: bool = False,
) -> dict[str, dict[str, Any]]:
    """Describe GraphRAG production backend readiness without making it mandatory."""

    graph_root = workspace_root / "knowledge" / "graph"
    chroma_path = graph_root / "chroma"
    sqlite_path = workspace_root / "db" / "gongmu.db"
    chroma_available, chroma_detail = _optional_module("chromadb", importer)
    chroma_active = chroma_available and production_enabled
    chroma_detail_text = (
        "ChromaDB PersistentClient can be enabled"
        if chroma_available
        else chroma_detail
    )
    chroma_blockers = _activation_blockers(chroma_available, chroma_detail)

    return {
        "vector": {
            "contract_version": CONTRACT_VERSION,
            "role": "vector",
            "production_backend": "chromadb",
            "production_available": chroma_available,
            "production_enabled": chroma_active,
            "active_backend": "chromadb" if chroma_active else "sqlite_fallback",
            "mode": "production_optional" if chroma_active else "fallback",
            "available": True,
            "offline_safe": True,
            "requires_network": False,
            "activation_ready": len(chroma_blockers) == 0,
            "activation_blockers": chroma_blockers,
            "activation_notes": _activation_notes(active=chroma_active, backend_name="chromadb")
            if chroma_available
            else [],
            "single_writer_required": True,
            "operations": ["upsert_chunks", "query_chunks", "delete_document"],
            "storage_path": str(chroma_path if chroma_active else sqlite_path),
            "detail": chroma_detail_text,
        },
        "graph": {
            "contract_version": CONTRACT_VERSION,
            "role": "graph",
            "production_backend": "sqlite_graph_mirror",
            "candidate_backend": "deferred_graph_database",
            "production_available": True,
            "production_enabled": False,
            "active_backend": "sqlite_graph_mirror",
            "mode": "local_sqlite",
            "available": True,
            "offline_safe": True,
            "requires_network": False,
            "activation_ready": True,
            "activation_blockers": [],
            "activation_notes": [
                "SQLite graph mirror remains active while a maintained dedicated graph database is evaluated."
            ],
            "deferred_reason": (
                "KuzuDB is not a core dependency in this sprint because its upstream repository "
                "is archived; graph DB selection is deferred until a maintained option is chosen."
            ),
            "single_writer_required": True,
            "operations": ["upsert_nodes_edges", "query_neighbors", "delete_document"],
            "storage_path": str(sqlite_path),
            "detail": "SQLite stores graph nodes and edges for the current local-first GraphRAG path.",
        },
    }
