# GraphRAG 품질 중심 리서치 노트

작성일: 2026-05-06

## 목적

Gongmu의 지식폴더 고도화는 “데이터를 많이 넣는 것”보다 “업무자가 신뢰할 수 있는 근거와 관계를 안정적으로 회수하는 것”이 우선이다. 따라서 ChromaDB/KuzuDB 같은 backend 확장 전에 ingestion quality, deletion sync, citation, source provenance, offline fallback 계약을 먼저 고정한다.

## 참고 프로젝트와 반영 방향

### Microsoft GraphRAG

- 참고: [Microsoft GraphRAG local search](https://microsoft.github.io/graphrag/query/local_search/), [GitHub microsoft/graphrag](https://github.com/microsoft/graphrag)
- 핵심 시사점: local search는 원문 text unit과 knowledge graph 구조 데이터를 함께 사용한다.
- Gongmu 반영: 문서 chunk, 문서 metadata, ontology relation, 업무대화 session linked file을 함께 ranking에 반영한다.
- Gongmu 차이점: 폐쇄망 공공기관 PC를 전제로 하므로 cloud LLM 의존 indexing보다 deterministic parsing/ontology와 local fallback을 먼저 강화한다.

### LightRAG

- 참고: [LightRAG](https://lightrag.github.io/)
- 핵심 시사점: graph structure를 indexing과 retrieval에 결합하되, 시스템 복잡도를 줄이는 방향이 중요하다.
- Gongmu 반영: 초기 단계에서는 무거운 LLM entity extraction보다 공공문서 alias, section-aware chunk, table evidence chunk, quality warning을 우선한다.

### Kuzu

- 참고: [Kuzu vector extension](https://docs.kuzudb.com/extensions/vector/), [Kuzu installation docs](https://docs.kuzudb.com/installation)
- 핵심 시사점: Kuzu는 embedded graph database이며 vector extension으로 graph traversal과 vector search entry point를 결합할 수 있다.
- 리스크: 기존 Kuzu GitHub 저장소는 2025-10-10 이후 archive 상태라는 공지가 있다. 기존 release는 사용 가능하지만 production backend로 고정하기 전 offline packaging 검증이 필요하다.
- Gongmu 반영: Kuzu는 현재 production 의존성에서 제외한다. graph backend는 `sqlite_graph_mirror`로 유지하고, 전용 graph database는 maintained 후보를 재평가한 뒤 별도 sprint에서 결정한다.

### Chroma

- 참고: [Chroma clients docs](https://docs.trychroma.com/docs/run-chroma/clients), [Chroma Cookbook clients](https://cookbook.chromadb.dev/core/clients/)
- 핵심 시사점: local `PersistentClient` 방식으로 embedded vector store를 구성할 수 있다.
- Gongmu 반영: `chromadb==1.5.9`를 sidecar runtime dependency로 고정하고 optional vector backend로 포함한다. 기본값은 SQLite fallback이며, 환경설정에서 ChromaDB를 선택하면 sidecar가 precomputed embedding chunk를 Chroma local store에 upsert한다.
- 구현 메모: Chroma embedded mode는 로컬 path에 저장할 수 있지만, 같은 local path에 여러 process가 동시에 write하지 않도록 운영 설계가 필요하다. Gongmu는 sidecar 단일 writer 모델을 유지한다.

## 품질 우선 원칙

1. 원본 파일 변경은 지식모델에 반영되어야 한다.
2. 삭제된 원본 파일의 문서, chunk, table, graph 관계는 검색 결과에 남지 않아야 한다.
3. 본문 추출 품질이 낮으면 숨기지 않고 warning으로 노출한다.
4. 표는 flatten하지 않고 structured table과 table-specific retrieval chunk로 보존한다.
5. 답변은 반드시 citation과 retrieval summary를 포함한다.
6. backend가 optional이어도 API 계약은 흔들리지 않아야 한다.
7. 폐쇄망 PC에서는 SQLite fallback만으로도 기본 기능이 동작해야 한다.

## 2026-05-06 반영 완료

- 삭제된 지식폴더 원본 파일에 대응하는 GraphRAG document/section/chunk/table/node/edge 삭제 동기화.
- 삭제된 문서의 이전 chunk가 retrieve 결과에 남지 않도록 회귀 테스트 추가.
- 일반 ingestion은 source file hash 기준으로 변경 파일만 처리하고, 변경 없는 파일은 `skipped_count`로 집계한다.
- parser/ontology/chunking 규칙이 바뀐 경우 같은 파일 hash라도 재처리되도록 `ingestion_signature`를 문서에 저장한다.
- `/api/knowledge/reindex`는 `force_rebuild` 작업으로 남기고 변경 여부와 관계없이 강제 재처리한다.
- retrieval evaluation fixture를 추가해 query, expected document, expected relation, expected evidence type을 회귀 기준으로 삼는다.
- table evidence query에서는 table-specific chunk가 citation 우선순위에 올라오도록 ranking boost를 보강했다.
- 대규모 폴더 ingestion을 중간에 멈출 수 있도록 cancel endpoint와 UI 취소 버튼을 추가했다.
- canceled job은 재실행해도 처리되지 않아 사용자가 의도한 중단 상태가 보존된다.
- 같은 지식 소스에 queued/running ingestion job이 이미 있으면 중복 인제스트 생성을 409로 막아 DB/CPU 부하를 줄인다.
- running ingestion job은 마지막 처리 파일을 `last_processed_path`/`last_processed_at`으로 기록하고, 지식폴더 화면에서 `마지막 처리`로 노출한다.
- ChromaDB는 optional vector backend로 adapter wiring을 완료했다. `graphrag_vector_backend=sqlite`가 기본값이고, `chromadb` 선택 시 sidecar 단일 writer가 chunk upsert/query/delete를 담당한다.
- KuzuDB는 archive 리스크 때문에 production 후보에서 내리고, graph backend는 SQLite graph mirror를 active backend로 유지한다.
- 지식폴더 상단 UI에서도 active backend와 production 후보 backend의 설치/비활성 상태를 별도 pill로 표시한다.
- `/api/knowledge/backend-status`는 production backend activation 전 점검을 위해 `activation_ready`, `activation_blockers`, `activation_notes`, `single_writer_required`를 제공한다.
- Chroma 실제 폐쇄망 설치 검증은 번들 패키징 단계에서 확인한다. Kuzu 또는 대체 graph DB 활성화는 별도 사용자 승인 지점으로 남긴다.
- ingestion runtime metrics와 backend contract를 유지한 상태로 동작 확인.

## 다음 구현 후보

1. 수정된 원본 파일에 대한 re-ingestion 품질 테스트 확대.
2. retrieval evaluation fixture 추가: query, expected document, expected relation, expected citation warning을 고정.
3. Chroma offline bundle smoke: 폐쇄망 설치 파일 안에 Chroma dependency가 포함되고 local store가 생성되는지 검증.
4. maintained graph DB 후보 재조사: Kuzu 대체 가능성, SQLite graph mirror 확장, lightweight property graph store를 비교한다.
5. 대규모 폴더용 ingestion batch checkpoint와 재개 UX 설계.
