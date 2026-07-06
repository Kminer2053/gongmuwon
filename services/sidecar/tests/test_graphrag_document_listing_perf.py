from __future__ import annotations

import json
import time
from pathlib import Path

from gongmu_sidecar.app import create_app
from gongmu_sidecar.db import now_iso


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_document_listing_aggregates_without_join_explosion(tmp_path: Path) -> None:
    client = _client(tmp_path)
    db = client.app.state.services.db
    created_at = now_iso()
    source_id = "source-1"
    db.insert(
        "knowledge_sources",
        {
            "id": source_id,
            "label": "work-docs",
            "root_path": str(tmp_path),
            "status": "active",
            "last_scanned_at": created_at,
            "created_at": created_at,
            "updated_at": created_at,
        },
    )

    with db.transaction():
        for doc_index in range(8):
            file_id = f"file-{doc_index}"
            document_id = f"document-{doc_index}"
            db.insert(
                "knowledge_source_files",
                {
                    "id": file_id,
                    "source_id": source_id,
                    "file_path": str(tmp_path / f"doc-{doc_index}.txt"),
                    "relative_path": f"doc-{doc_index}.txt",
                    "file_hash": f"hash-{doc_index}",
                    "size_bytes": 10,
                    "modified_at": created_at,
                    "status": "indexed",
                    "title": f"Document {doc_index}",
                    "mime_type": "text/plain",
                    "text_excerpt": "",
                    "extracted_text_path": None,
                    "created_at": created_at,
                    "updated_at": created_at,
                },
            )
            db.insert(
                "knowledge_documents",
                {
                    "id": document_id,
                    "source_file_id": file_id,
                    "source_id": source_id,
                    "file_path": str(tmp_path / f"doc-{doc_index}.txt"),
                    "file_hash": f"hash-{doc_index}",
                    "ingestion_signature": f"sig-{doc_index}",
                    "title": f"Document {doc_index}",
                    "document_type": "txt",
                    "document_number": None,
                    "sender_org": None,
                    "receiver_org": None,
                    "issued_date": None,
                    "security_level": None,
                    "attachment_count": 0,
                    "parser_name": "test",
                    "parser_version": "1",
                    "quality_score": 1.0,
                    "partial": 0,
                    "metadata_json": json.dumps({}),
                    "created_at": created_at,
                    "updated_at": created_at,
                },
            )
            for section_index in range(50):
                section_id = f"section-{doc_index}-{section_index}"
                db.insert(
                    "knowledge_document_sections",
                    {
                        "id": section_id,
                        "document_id": document_id,
                        "heading": f"Section {section_index}",
                        "level": 1,
                        "order_index": section_index,
                        "text": "Body",
                        "created_at": created_at,
                    },
                )
            for chunk_index in range(100):
                db.insert(
                    "knowledge_document_chunks",
                    {
                        "id": f"chunk-{doc_index}-{chunk_index}",
                        "document_id": document_id,
                        "section_id": f"section-{doc_index}-{chunk_index % 50}",
                        "chunk_index": chunk_index,
                        "text": "표: table chunk" if chunk_index % 5 == 0 else "body chunk",
                        "token_count": 1,
                        "embedding_backend": "deterministic",
                        "embedding_model": "hash",
                        "embedding_json": "[]",
                        "vector_ref": None,
                        "created_at": created_at,
                    },
                )
            for table_index in range(20):
                db.insert(
                    "knowledge_table_blocks",
                    {
                        "id": f"table-{doc_index}-{table_index}",
                        "document_id": document_id,
                        "section_id": f"section-{doc_index}-{table_index % 50}",
                        "order_index": table_index,
                        "caption": "",
                        "headers_json": "[]",
                        "rows_json": "[]",
                        "created_at": created_at,
                    },
                )

    started_at = time.perf_counter()
    documents = client.app.state.services.wiki.list_documents()
    elapsed = time.perf_counter() - started_at

    assert len(documents) == 8
    assert documents[0]["section_count"] == 50
    assert documents[0]["chunk_count"] == 100
    assert documents[0]["table_count"] == 20
    assert documents[0]["table_chunk_count"] == 20
    assert elapsed < 1.0
