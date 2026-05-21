# GraphRAG Sprint 1 - Ingestion Foundation 계획

작성일: 2026-05-06

## 목표

지식폴더에 등록된 로컬 폴더의 파일을 GraphRAG용 구조화 문서로 변환하고, SQLite에 안정적으로 저장하는 ingestion 기반을 만든다.

## 현재 상태

2026-05-06 기준 1차 구현 완료.

## 구현 완료 범위

- [x] GraphRAG metadata schema 추가
- [x] `knowledge_ingestion_jobs`
- [x] `knowledge_documents`
- [x] `knowledge_document_sections`
- [x] `knowledge_document_chunks`
- [x] `knowledge_table_blocks`
- [x] `knowledge_graph_nodes`
- [x] `knowledge_graph_edges`
- [x] structured document model 추가
- [x] Markdown/TXT parser
- [x] DOCX parser
- [x] XLSX parser
- [x] PPTX parser
- [x] PDF parser
- [x] HWPX XML fallback parser
- [x] section-aware chunk 저장
- [x] structured table block 저장
- [x] table-specific retrieval chunk 저장
- [x] ingestion job queue/list/run API
- [x] background ingestion 요청
- [x] ingestion 전 source rescan
- [x] ingestion runtime metrics: `duration_ms`, `average_ms_per_file`
- [x] document structure API
- [x] chunks/tables/documents API
- [x] deterministic retrieval API

## API

- `POST /api/knowledge/ingest`
- `POST /api/knowledge/reindex`
- `GET /api/knowledge/ingestion-jobs`
- `POST /api/knowledge/ingestion-jobs/{job_id}/run`
- `GET /api/knowledge/documents`
- `GET /api/knowledge/chunks`
- `GET /api/knowledge/document-structure`
- `GET /api/knowledge/tables`
- `POST /api/knowledge/retrieve`

## 검증

최근 검증:

```text
npm.cmd run sidecar:test
116 passed
```

## 후속 과제

- 대량 폴더 ingestion 성능 측정
- incremental scan 자동화
- parser별 품질 비교 리포트
- production vector/graph backend adapter 실제 구현
