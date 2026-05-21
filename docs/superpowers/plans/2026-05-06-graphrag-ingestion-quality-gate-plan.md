# GraphRAG 인제스트 품질 게이트 실행계획

> **작업 규율:** 이 계획은 `superpowers:executing-plans` 흐름으로 실행한다. 기능 변경은 TDD로 진행하고, 완료 선언 전에는 fresh verification을 남긴다.

## 목표

Gongmu의 지식폴더 고도화는 단순히 SQLite에 더 많은 문서를 저장하거나 ChromaDB/KuzuDB를 빨리 붙이는 문제가 아니다. 먼저 사용자가 지정한 업무폴더의 문서가 `읽을 수 있는 지식`으로 안정적으로 변환되는지 보장해야 한다.

따라서 이번 단계의 우선순위는 아래와 같다.

1. 문서 추출 품질을 측정하고 저장한다.
2. 표, 섹션, 공공문서 메타데이터를 검색 가능한 단위로 보존한다.
3. 공공기관 문서 표현을 온톨로지 후보 노드/관계로 안정적으로 매핑한다.
4. 낮은 품질의 추출 결과를 UI와 API에서 경고한다.
5. 이후 ChromaDB/KuzuDB 확장 전에 회귀 fixture를 확보한다.

## 참고한 GraphRAG 계열 프로젝트

- [Microsoft GraphRAG](https://github.com/microsoft/graphrag): 문서 인덱싱 파이프라인, source citation, local/global query 분리 방향을 참고한다.
- [HKUDS LightRAG](https://github.com/HKUDS/LightRAG): vector retrieval과 graph retrieval 결합, offline deployment 방향을 참고한다.
- [Graphiti](https://github.com/getzep/graphiti): session/event 기반 temporal memory와 provenance 구조를 참고한다.
- [OpenSPG KAG](https://github.com/OpenSPG/KAG): 도메인 온톨로지와 reasoning path 중심 설계를 참고한다.
- [LlamaIndex Property Graph Index](https://developers.llamaindex.ai/python/framework/module_guides/indexing/lpg_index_guide/): chunk 단위 entity/relation 추출과 metadata 결합 방식을 참고한다.
- [awesome-graphrag](https://github.com/graphrag/awesome-graphrag): 이후 Sprint마다 후보 기술을 재평가하는 기준 목록으로 둔다.

## 구현 기준

문서 하나가 성공적으로 인제스트되었다고 판단하려면 최소한 아래 정보가 남아야 한다.

- parser name/version
- partial extraction 여부
- section count, paragraph count, table count, text char count
- extraction quality score와 warning list
- structured table JSON
- table-specific retrieval chunk
- 공공문서 메타데이터: 문서번호, 발신, 수신, 시행일자, 보안등급, 붙임/첨부
- 온톨로지 후보: 업무, 사업, 과제, 프로젝트, 이슈, 정책, 조직, 담당자, 예산, 기간, 첨부
- retrieval/ask 결과의 출처 문서, parser, quality, partial, relation 정보

## 작업 목록

### Task 1. 인제스트 품질 리포트 저장

**상태:** 완료

- [x] 문서별 `extraction_quality` metadata 생성
- [x] `parser_name`, `parser_version`, `score`, `section_count`, `paragraph_count`, `table_count`, `text_char_count`, `metadata_field_count`, `partial`, `warnings` 저장
- [x] 기존 고정 품질 점수를 실제 추출 신호 기반 점수로 보정
- [x] `test_ingest_stores_extraction_quality_report`로 검증

### Task 2. 표 전용 retrieval chunk 추가

**상태:** 완료

- [x] section chunk와 별도로 table chunk 생성
- [x] table chunk text를 `표: <section heading>` 형식으로 시작
- [x] table row 내용을 검색 가능한 chunk text에 포함
- [x] `test_ingest_creates_table_specific_retrieval_chunk`로 검증

### Task 3. 공공문서 온톨로지 규칙 안정화

**상태:** 완료

- [x] `사업`, `업무`, `이슈`, `정책`, `수신`, `담당자`, `일정` 기반 추출을 테스트로 고정
- [x] `문서번호`, `발신`, `수신`, `시행일자`, `보안등급` metadata 추출을 테스트로 고정
- [x] `참조`, `결재`, `부서`, `조직`, `근거법령`, `과제`, `프로젝트` alias 추가
- [x] 표 안의 담당자, 부서, 업무 필드를 ontology 후보로 승격
- [x] `붙임`, `첨부`, `예산`, `금액`, `기간` 필드를 Attachment/Budget/Event 후보로 확장
- [x] 숫자 천 단위 쉼표가 entity label 정리 과정에서 잘리지 않도록 보정

### Task 4. 품질 경고 및 chunk 상태 UI

**상태:** 완료

- [x] 지식폴더 문서 목록에 extraction quality badge 표시
- [x] `partial_extraction`, `low_text`, `no_structured_tables` warning을 한글로 표시
- [x] 문서 구조 상세에서 paragraph/text char count와 warning 표시
- [x] 문서 목록과 상세에 `chunk N · 표 chunk M` 표시
- [x] `knowledge-sources.test.tsx`로 UI 회귀 검증

### Task 5. 공공문서 fixture 회귀셋

**상태:** 완료

- [x] 시행문형 markdown fixture 추가
- [x] 1페이지 보고서형 markdown fixture 추가
- [x] 표 중심 담당자/부서/업무 fixture 포함
- [x] 텍스트가 적은 문서의 low quality warning 테스트
- [x] DOCX 문서의 표/metadata 추출 테스트
- [x] HWPX XML fallback의 표/metadata 추출 테스트
- [x] pypdf 기반 PDF 텍스트 추출 테스트

### Task 6. Retrieval 품질 평가 보강

**상태:** 완료

- [x] ask citation에 `quality_warnings`, `evidence_type`, `score_breakdown`을 포함
- [x] ask 결과에 source/table/partial/low-quality/relation count 요약을 포함
- [x] 표 안의 값으로 검색하면 table chunk가 citation 우선 근거가 되도록 ranking boost 추가
- [x] 낮은 품질 문서를 답변 근거로 쓸 때 `low_text`/`low_quality_score` 경고가 citation에 포함되도록 고정
- [x] 지식폴더 UI에서 `표 근거`, 품질 경고, 검색근거 요약을 표시

### Task 7. ChromaDB/KuzuDB 확장 전 안전 게이트

**상태:** 완료

- [x] 현재 SQLite fallback 구조에서 대량 문서 인제스트 병목을 측정할 수 있도록 job별 `duration_ms`, `average_ms_per_file` 계측 추가
- [x] ChromaDB/KuzuDB 도입 시 API 계약이 바뀌지 않도록 backend status contract version 고정
- [x] 폐쇄망 배포에서 optional backend가 빠져도 SQLite fallback이 available/offline-safe 상태로 보고되도록 검증
- [x] 지식폴더 UI의 ingestion 작업 카드에 처리 시간/파일당 처리 시간을 표시
- [x] 실제 production adapter를 붙이기 전 vector/graph write/read boundary를 `operations` 계약으로 구체화
- [x] `chromadb`/`kuzu`가 설치되어 있어도 실제 adapter wiring 전에는 active backend로 오해되지 않도록 `production_available`과 `production_enabled`를 분리
- [x] 지식폴더 상단 UI에 active backend와 production 후보 backend 비활성 상태를 함께 표시
- [x] backend status에 `activation_ready`, `activation_blockers`, `activation_notes`, `single_writer_required`를 추가해 실제 활성화 전 preflight 정보를 제공
- [x] 지식폴더 상단 UI에 `Vector 준비`, `Graph 준비` 상태를 표시하고 blocker는 tooltip으로 확인 가능하게 구성

## 검증 게이트

이번 단계에서 최소 유지해야 하는 fresh verification은 아래와 같다.

- `node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_graphrag_ingestion.py services/sidecar/tests/test_graphrag_ontology.py services/sidecar/tests/test_graphrag_retrieval.py -q`
- `npm.cmd run desktop:test -- knowledge-sources.test.tsx`
- `npm.cmd run sidecar:test`
- `npm.cmd run desktop:test`

## 완료 기준

- GraphRAG 관련 sidecar 테스트가 모두 통과한다.
- 지식폴더 UI 테스트가 chunk/표 chunk/품질 경고를 확인한다.
- PDF/DOCX/HWPX/Markdown fixture가 최소 추출 품질을 보장한다.
- 문서 품질이 낮거나 partial extraction이면 사용자가 UI/API에서 알 수 있다.
- 다음 단계인 retrieval 품질 평가 또는 ChromaDB/KuzuDB 확장을 시작해도 기존 계약이 흔들리지 않는다.

## 2026-05-06 Fresh Verification

```text
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_graphrag_ingestion.py services/sidecar/tests/test_graphrag_ontology.py services/sidecar/tests/test_graphrag_retrieval.py -q
44 passed

node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_graphrag_ingestion.py services/sidecar/tests/test_graphrag_backends.py services/sidecar/tests/test_graphrag_ontology.py services/sidecar/tests/test_graphrag_retrieval.py -q
50 passed

npm.cmd run sidecar:test
126 passed

npm.cmd run desktop:test
18 test files passed, 49 tests passed

node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
Finished dev profile
```

## 2026-05-06 추가 품질 보강

### Task 8. 폴더 상태 변화와 GraphRAG 인덱스 동기화
**상태:** 완료

- [x] 지식폴더에서 원본 파일이 삭제되면 다음 스캔에서 `knowledge_source_files.status = deleted`로 표시된다.
- [x] 삭제된 원본 파일에 대응하는 `knowledge_documents`, section, chunk, table, graph node/edge가 다음 ingestion에서 함께 제거된다.
- [x] 삭제된 문서의 이전 chunk가 `/api/knowledge/retrieve` 결과에 남지 않도록 회귀 테스트로 고정했다.
- [x] ingestion job에 `deleted_document_count`를 저장하고 UI job 카드에 삭제 동기화 수를 표시한다.
- [x] `test_ingest_source_removes_deleted_file_documents_and_chunks`로 검증했다.

### Task 9. 대규모 폴더 대비 incremental ingestion
**상태:** 완료

- [x] `knowledge_documents.file_hash`를 저장해 원본 파일 hash와 비교한다.
- [x] `knowledge_documents.ingestion_signature`를 저장해 parser/ontology/chunking pipeline이 바뀌면 파일 hash가 같아도 재처리한다.
- [x] 일반 `/api/knowledge/ingest`는 신규/수정 파일만 처리하고 변경 없는 파일은 skip한다.
- [x] `/api/knowledge/reindex`는 변경 여부와 관계없이 강제 재처리한다.
- [x] 지식 소스 카드에서 일반 `GraphRAG 인덱싱`과 `강제 재색인` 버튼을 분리한다.
- [x] ingestion job에 `skipped_count`, `force_rebuild`를 저장한다.
- [x] UI job 카드에 `변경없음 N`을 표시한다.
- [x] 수정된 파일만 재처리하고 이전 chunk가 검색에 남지 않는지 회귀 테스트로 고정했다.

검증:

- `test_ingest_source_skips_unchanged_files_after_initial_run`
- `test_ingest_source_reprocesses_unchanged_file_when_pipeline_signature_changes`
- `test_ingest_source_reprocesses_only_modified_files`
- `test_reindex_forces_unchanged_files_to_be_processed`

### Task 10. Retrieval 품질 평가 fixture
**상태:** 완료

- [x] `services/sidecar/tests/fixtures/graphrag_eval_cases.json`에 query, 기대 문서, 기대 relation, 기대 evidence type, 최소 품질 점수를 정의했다.
- [x] `/api/knowledge/ask` 결과가 기대 citation과 relation을 만족하는지 자동 검증한다.
- [x] 표 안의 담당/소유자처럼 table evidence가 핵심인 질의에서 table citation이 우선되도록 ranking boost를 보강했다.

검증:

- `test_retrieval_quality_fixture_matches_expected_citation_and_relation`

### Task 11. 대규모 ingestion 취소/재개 운영성
**상태:** 완료

- [x] ingestion job에 `cancel_requested` 상태를 저장한다.
- [x] queued job은 `/api/knowledge/ingestion-jobs/{job_id}/cancel` 호출 시 처리 없이 `canceled`가 된다.
- [x] running job은 파일 단위 처리 사이에 취소 요청을 확인하고 다음 파일부터 멈춘다.
- [x] canceled job을 다시 run해도 처리되지 않는다.
- [x] 같은 지식 소스에 queued/running ingestion job이 이미 있으면 중복 작업 생성을 409로 막는다.
- [x] 지식폴더 UI의 ingestion job 카드에서 queued/running job을 `취소`할 수 있다.
- [x] 상태 badge에 `취소됨`을 표시한다.
- [x] running job의 마지막 처리 파일을 `last_processed_path`/`last_processed_at`으로 저장하고 UI job 카드에 `마지막 처리`로 표시한다.

검증:

- `test_cancel_queued_ingestion_job_marks_canceled_without_processing`
- `test_ingest_source_rejects_duplicate_active_job_for_same_source`
- `test_running_ingestion_job_stops_after_cancel_request`
- `knowledge-sources.test.tsx`의 `cancels a queued GraphRAG ingestion job from the job card`
- `knowledge-sources.test.tsx`의 ingestion job progress 표시 검증

### Task 11. ChromaDB optional vector backend 포함
**상태:** 완료

- [x] `chromadb==1.5.9`를 sidecar runtime dependency로 고정했다.
- [x] PyInstaller sidecar spec에서 `chromadb` submodule/data collection을 포함했다.
- [x] Chroma `PersistentClient` 기반 adapter를 추가했다.
- [x] adapter는 Gongmu에서 이미 계산한 embedding을 `embedding_function=None` collection에 upsert한다.
- [x] chunk metadata에는 `chunk_id`, `document_id`, `section_id`, embedding backend/model, chunk kind를 남긴다.
- [x] Chroma query 결과는 기존 chunk retrieval 계약에 맞게 `chunk_id`, `text`, `metadata`, `distance`, `vector_ref`로 normalize한다.
- [x] 문서 삭제/재색인 시 active vector backend에서도 해당 `document_id` chunk를 삭제한다.
- [x] 환경설정에서 `graphrag_vector_backend`를 `sqlite` 또는 `chromadb`로 저장/전환할 수 있다.
- [x] 지식폴더 graph backend는 KuzuDB를 핵심 의존성으로 사용하지 않고 `sqlite_graph_mirror`로 유지한다.

### 2026-05-07 Chroma Fresh Verification

```text
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_graphrag_backends.py services/sidecar/tests/test_graphrag_ingestion.py services/sidecar/tests/test_settings_profiles.py services/sidecar/tests/test_sidecar_packaging.py -q
51 passed

npm.cmd run test -- src/api.test.ts src/settings-edit.test.tsx
8 passed

node scripts/portable-run.mjs python -m pip install chromadb==1.5.9
installed successfully in .venv

Chroma smoke
upsert/query/delete ok, active_backend=chromadb, close() releases Windows file handles

npm.cmd run sidecar:bundle:windows
completed successfully with chromadb collected into release/sidecar/windows-x64/gongmu-sidecar

Bundled Chroma smoke
workspace=runtime-workspace/cache/chroma-bundle-smoke-20260507-074536
settings_vector=chromadb, active_vector_backend=chromadb
vector_storage_path=runtime-workspace/cache/chroma-bundle-smoke-20260507-074536/knowledge/graph/chroma
job_status=completed, processed_count=1
retrieve_count=3, vector_backend_score=47.06, chroma_file_count_sample=5
retrieve response validated against actual `items` field
active vector backend candidate pool limits retrieval scoring to vector/lexical/graph/session candidates

Windows UTF-8 BOM settings regression
settings.json with UTF-8 BOM loads graphrag_vector_backend=chromadb
bundled smoke keeps chromadb active with BOM settings file

npm.cmd run sidecar:test
139 passed

npm.cmd run desktop:test
18 files / 51 tests passed

node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
Finished dev profile
```

### 조사 반영 메모

- Microsoft GraphRAG는 local search에서 그래프 구조 데이터와 원문 텍스트 단위를 함께 사용한다. Gongmu도 “문서 chunk만 검색”이 아니라 문서-업무-이슈-정책 관계를 retrieval 점수에 반영하는 방향을 유지한다.
- LightRAG는 graph 기반 indexing/retrieval을 단순하고 빠르게 가져가는 접근을 강조한다. Gongmu는 폐쇄망 업무자용이므로 복잡한 LLM entity extraction을 곧바로 확대하기보다 deterministic ontology와 품질 fixture를 먼저 강화한다.
- Kuzu는 embedded graph database이며 vector extension을 통해 graph traversal과 vector entry point를 결합할 수 있다. 다만 2025-10-10 이후 기존 Kuzu 저장소가 archive 상태라서, Gongmu는 Kuzu를 이번 production 의존성에서 제외하고 SQLite graph mirror를 유지한다.
- Chroma는 local `PersistentClient` 방식으로 embedding 검색 저장소를 구성할 수 있다. Gongmu는 Chroma를 optional vector backend로 포함하되, embedded mode의 multi-process write 제약 때문에 sidecar 단일 writer 원칙을 유지한다.

참고:

- [Microsoft GraphRAG local search](https://microsoft.github.io/graphrag/query/local_search/)
- [Microsoft GraphRAG GitHub](https://github.com/microsoft/graphrag)
- [LightRAG](https://lightrag.github.io/)
- [Kuzu vector extension](https://docs.kuzudb.com/extensions/vector/)
- [Kuzu installation docs](https://docs.kuzudb.com/installation)
- [Chroma clients docs](https://docs.trychroma.com/docs/run-chroma/clients)
