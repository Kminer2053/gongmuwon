from __future__ import annotations

from pathlib import Path

from gongmu_sidecar.app import create_app
import gongmu_sidecar.graphrag_backends as graphrag_backends
from gongmu_sidecar.graphrag_backends import build_backend_status


class FakeChromaCollection:
    def __init__(self) -> None:
        self.upserts: list[dict[str, object]] = []
        self.queries: list[dict[str, object]] = []
        self.deletes: list[dict[str, object]] = []
        self.next_query_result: dict[str, object] = {
            "ids": [[]],
            "documents": [[]],
            "metadatas": [[]],
            "distances": [[]],
        }

    def upsert(self, **kwargs: object) -> None:
        self.upserts.append(kwargs)

    def query(self, **kwargs: object) -> dict[str, object]:
        self.queries.append(kwargs)
        return self.next_query_result

    def delete(self, **kwargs: object) -> None:
        self.deletes.append(kwargs)


class FakeChromaClient:
    def __init__(self) -> None:
        self.collection = FakeChromaCollection()
        self.collection_names: list[str] = []
        self.closed = False

    def get_or_create_collection(self, *, name: str, embedding_function: object | None = None):
        self.collection_names.append(name)
        assert embedding_function is None
        return self.collection

    def close(self) -> None:
        self.closed = True


def test_chroma_vector_backend_upserts_precomputed_embeddings_and_returns_vector_refs(tmp_path: Path) -> None:
    backend_cls = getattr(graphrag_backends, "ChromaVectorBackend", None)
    assert backend_cls is not None
    fake_client = FakeChromaClient()
    backend = backend_cls(
        tmp_path / "chroma",
        collection_name="gongmu_test_chunks",
        client_factory=lambda path: fake_client,
    )

    refs = backend.upsert_chunks(
        [
            {
                "chunk_id": "chunk-1",
                "document_id": "doc-1",
                "section_id": "section-1",
                "text": "본문 조각",
                "embedding": [0.1, 0.2, 0.3],
                "metadata": {"source_path": tmp_path / "report.hwpx", "tags": ["공문", "보고"]},
            }
        ]
    )

    assert refs == ["chromadb:gongmu_test_chunks:chunk-1"]
    assert fake_client.collection_names == ["gongmu_test_chunks"]
    assert fake_client.collection.upserts == [
        {
            "ids": ["chunk-1"],
            "documents": ["본문 조각"],
            "embeddings": [[0.1, 0.2, 0.3]],
            "metadatas": [
                {
                    "chunk_id": "chunk-1",
                    "document_id": "doc-1",
                    "section_id": "section-1",
                    "source_path": str(tmp_path / "report.hwpx"),
                    "tags": '["공문", "보고"]',
                }
            ],
        }
    ]


def test_chroma_vector_backend_query_normalizes_results(tmp_path: Path) -> None:
    backend_cls = getattr(graphrag_backends, "ChromaVectorBackend", None)
    assert backend_cls is not None
    fake_client = FakeChromaClient()
    fake_client.collection.next_query_result = {
        "ids": [["chunk-1", "chunk-2"]],
        "documents": [["첫 번째 근거", "두 번째 근거"]],
        "metadatas": [[{"document_id": "doc-1"}, {"document_id": "doc-2"}]],
        "distances": [[0.12, 0.34]],
    }
    backend = backend_cls(tmp_path / "chroma", client_factory=lambda path: fake_client)

    results = backend.query_chunks([0.3, 0.2, 0.1], limit=2, where={"document_id": "doc-1"})

    assert fake_client.collection.queries == [
        {
            "query_embeddings": [[0.3, 0.2, 0.1]],
            "n_results": 2,
            "where": {"document_id": "doc-1"},
            "include": ["documents", "metadatas", "distances"],
        }
    ]
    assert results == [
        {
            "chunk_id": "chunk-1",
            "text": "첫 번째 근거",
            "metadata": {"document_id": "doc-1"},
            "distance": 0.12,
            "vector_ref": "chromadb:gongmu_chunks:chunk-1",
        },
        {
            "chunk_id": "chunk-2",
            "text": "두 번째 근거",
            "metadata": {"document_id": "doc-2"},
            "distance": 0.34,
            "vector_ref": "chromadb:gongmu_chunks:chunk-2",
        },
    ]


def test_chroma_vector_backend_delete_document_uses_document_metadata_filter(tmp_path: Path) -> None:
    backend_cls = getattr(graphrag_backends, "ChromaVectorBackend", None)
    assert backend_cls is not None
    fake_client = FakeChromaClient()
    backend = backend_cls(tmp_path / "chroma", client_factory=lambda path: fake_client)

    backend.delete_document("doc-1")

    assert fake_client.collection.deletes == [{"where": {"document_id": "doc-1"}}]


def test_chroma_vector_backend_close_releases_persistent_client(tmp_path: Path) -> None:
    backend_cls = getattr(graphrag_backends, "ChromaVectorBackend", None)
    assert backend_cls is not None
    fake_client = FakeChromaClient()
    backend = backend_cls(tmp_path / "chroma", client_factory=lambda path: fake_client)
    backend.upsert_chunks(
        [
            {
                "chunk_id": "chunk-1",
                "document_id": "doc-1",
                "section_id": "section-1",
                "text": "본문 조각",
                "embedding": [0.1, 0.2, 0.3],
            }
        ]
    )

    backend.close()

    assert fake_client.closed is True
    assert backend.collection is fake_client.collection


def test_chroma_vector_backend_persists_across_client_reopen(tmp_path: Path) -> None:
    backend_cls = getattr(graphrag_backends, "ChromaVectorBackend", None)
    assert backend_cls is not None
    chroma_path = tmp_path / "chroma"
    first_backend = backend_cls(chroma_path, collection_name="gongmu_test_chunks")
    refs = first_backend.upsert_chunks(
        [
            {
                "chunk_id": "chunk-persisted",
                "document_id": "doc-persisted",
                "section_id": "section-persisted",
                "text": "Persistent Chroma evidence",
                "embedding": [1.0, 0.0, 0.0],
                "metadata": {"chunk_kind": "section"},
            }
        ]
    )
    first_backend.close()

    reopened_backend = backend_cls(chroma_path, collection_name="gongmu_test_chunks")
    results = reopened_backend.query_chunks([1.0, 0.0, 0.0], limit=1)
    reopened_backend.delete_document("doc-persisted")
    deleted_results = reopened_backend.query_chunks([1.0, 0.0, 0.0], limit=1)
    reopened_backend.close()

    assert refs == ["chromadb:gongmu_test_chunks:chunk-persisted"]
    assert results[0]["chunk_id"] == "chunk-persisted"
    assert results[0]["metadata"]["document_id"] == "doc-persisted"
    assert deleted_results == []


def test_optional_backend_status_falls_back_when_modules_are_missing(tmp_path: Path) -> None:
    def missing_importer(module_name: str):
        raise ModuleNotFoundError(module_name)

    status = build_backend_status(tmp_path, importer=missing_importer)

    assert status["vector"]["production_backend"] == "chromadb"
    assert status["vector"]["active_backend"] == "sqlite_fallback"
    assert status["vector"]["available"] is True
    assert status["vector"]["production_available"] is False
    assert status["vector"]["contract_version"] == "graphrag-backend-v1"
    assert status["vector"]["mode"] == "fallback"
    assert status["vector"]["offline_safe"] is True
    assert status["vector"]["requires_network"] is False
    assert status["vector"]["activation_ready"] is False
    assert status["vector"]["activation_blockers"] == ["chromadb is not installed"]
    assert status["vector"]["single_writer_required"] is True
    assert status["vector"]["operations"] == ["upsert_chunks", "query_chunks", "delete_document"]
    assert status["graph"]["production_backend"] == "sqlite_graph_mirror"
    assert status["graph"]["candidate_backend"] == "deferred_graph_database"
    assert status["graph"]["active_backend"] == "sqlite_graph_mirror"
    assert status["graph"]["available"] is True
    assert status["graph"]["production_available"] is True
    assert status["graph"]["contract_version"] == "graphrag-backend-v1"
    assert status["graph"]["mode"] == "local_sqlite"
    assert status["graph"]["offline_safe"] is True
    assert status["graph"]["requires_network"] is False
    assert status["graph"]["activation_ready"] is True
    assert status["graph"]["activation_blockers"] == []
    assert status["graph"]["deferred_reason"]
    assert status["graph"]["single_writer_required"] is True
    assert status["graph"]["operations"] == ["upsert_nodes_edges", "query_neighbors", "delete_document"]


def test_optional_backend_status_reports_installed_modules_without_activating_them(tmp_path: Path) -> None:
    class FakeModule:
        pass

    def fake_importer(module_name: str):
        if module_name == "chromadb":
            return FakeModule()
        raise ModuleNotFoundError(module_name)

    status = build_backend_status(tmp_path, importer=fake_importer)

    assert status["vector"]["production_available"] is True
    assert status["vector"]["production_enabled"] is False
    assert status["vector"]["active_backend"] == "sqlite_fallback"
    assert status["vector"]["mode"] == "fallback"
    assert status["vector"]["activation_ready"] is True
    assert status["vector"]["activation_blockers"] == []
    assert "not enabled" in status["vector"]["activation_notes"][0]
    assert status["vector"]["offline_safe"] is True
    assert status["graph"]["production_backend"] == "sqlite_graph_mirror"
    assert status["graph"]["candidate_backend"] == "deferred_graph_database"
    assert status["graph"]["production_available"] is True
    assert status["graph"]["production_enabled"] is False
    assert status["graph"]["active_backend"] == "sqlite_graph_mirror"
    assert status["graph"]["mode"] == "local_sqlite"
    assert status["graph"]["activation_ready"] is True
    assert status["graph"]["activation_blockers"] == []
    assert "SQLite graph mirror" in status["graph"]["activation_notes"][0]
    assert status["graph"]["offline_safe"] is True


def test_optional_backend_status_activates_modules_only_when_explicitly_enabled(tmp_path: Path) -> None:
    class FakeModule:
        pass

    def fake_importer(module_name: str):
        if module_name == "chromadb":
            return FakeModule()
        raise ModuleNotFoundError(module_name)

    status = build_backend_status(tmp_path, importer=fake_importer, production_enabled=True)

    assert status["vector"]["active_backend"] == "chromadb"
    assert status["vector"]["production_available"] is True
    assert status["vector"]["production_enabled"] is True
    assert status["vector"]["mode"] == "production_optional"
    assert status["vector"]["activation_ready"] is True
    assert status["vector"]["activation_blockers"] == []
    assert status["graph"]["active_backend"] == "sqlite_graph_mirror"
    assert status["graph"]["candidate_backend"] == "deferred_graph_database"
    assert status["graph"]["production_available"] is True
    assert status["graph"]["production_enabled"] is False
    assert status["graph"]["mode"] == "local_sqlite"
    assert status["graph"]["activation_ready"] is True
    assert status["graph"]["activation_blockers"] == []


def test_backend_status_endpoint_exposes_vector_and_graph_boundaries(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    client = app.state.test_client_factory()

    response = client.get("/api/knowledge/backend-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["vector"]["production_backend"] == "chromadb"
    assert payload["vector"]["production_enabled"] is True
    assert payload["vector"]["active_backend"] == "chromadb"
    assert payload["graph"]["production_backend"] == "sqlite_graph_mirror"
    assert payload["graph"]["candidate_backend"] == "deferred_graph_database"
    assert payload["graph"]["active_backend"]
