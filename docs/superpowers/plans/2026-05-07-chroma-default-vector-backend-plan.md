# ChromaDB 기본 벡터 백엔드 전환 계획

작성일: 2026-05-07

## 목표

GraphRAG의 벡터 검색 저장소는 기본 설치 기준에서 ChromaDB를 정상 경로로 사용한다. SQLite 기반 벡터 검색은 제거하지 않지만, 기본값이 아니라 문제가 생겼을 때 사용자가 명시적으로 선택하는 안전 폴백으로 둔다.

이번 작업은 기능 추가가 아니라 품질 게이트 강화다. 즉, ChromaDB가 “옵션으로 켜지면 동작한다” 수준이 아니라 “기본 설치에서 바로 동작한다”는 것을 코드, 테스트, 번들 스모크로 확인한다.

## 반영 원칙

- `graphrag_vector_backend`의 기본값은 `chromadb`다.
- 프론트엔드 설정 파서와 설정 화면의 기본 표시도 `chromadb`를 따른다.
- `sqlite`는 환경설정에서 명시적으로 선택할 수 있는 fallback이다.
- ChromaDB는 Gongmu가 계산한 embedding을 그대로 저장한다. Chroma 내장 embedding function은 사용하지 않는다.
- Windows 번들에는 `chromadb`와 `chromadb_rust_bindings` 네이티브 라이브러리를 포함한다.
- KuzuDB는 이번 기본 경로에 포함하지 않는다. 현재 Graph는 SQLite mirror를 유지하고, 벡터 검색 품질은 ChromaDB에 집중한다.

## 구현 범위

- sidecar 설정 기본값을 ChromaDB로 전환한다.
- 설정 저장/재로드 시 `sqlite` fallback을 유지한다.
- 실제 `ChromaVectorBackend`가 파일 기반 `PersistentClient`로 reopen/query/delete 되는지 테스트한다.
- ingestion 후 chunk의 `vector_ref`가 `chromadb:gongmu_chunks:*` 형태로 저장되는지 확인한다.
- retrieval 결과에 `score_breakdown.vector_backend_score`가 반영되는지 확인한다.
- active vector backend가 있을 때 전체 chunk scan 대신 Chroma 후보와 lexical/graph/session 후보를 합친 candidate pool만 scoring하도록 유지한다.
- deterministic fallback embedding이 의미 없는 pure-vector 후보를 과하게 살리지 않도록 guard를 둔다.
- PyInstaller spec에서 `chromadb_rust_bindings` submodule과 dynamic libs를 명시적으로 수집한다.

## 테스트 계획

필수 fresh verification:

- `node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_settings_profiles.py services/sidecar/tests/test_graphrag_backends.py services/sidecar/tests/test_graphrag_ingestion.py services/sidecar/tests/test_sidecar_packaging.py -q`
- `npm.cmd run test -- src/settings-edit.test.tsx src/api.test.ts`
- `npm.cmd run sidecar:test`
- `npm.cmd run desktop:test`
- `node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

Windows bundle verification:

- `npm.cmd run sidecar:bundle:windows`
- 새 workspace에서 settings 파일 없이 bundled sidecar를 실행한다.
- `/api/settings` 기본값이 `chromadb`인지 확인한다.
- `/api/knowledge/backend-status`의 active vector backend가 `chromadb`인지 확인한다.
- markdown fixture를 지식폴더로 등록하고 ingestion을 실행한다.
- `/api/knowledge/retrieve`가 실제 `items`를 반환하고 `vector_backend_score > 0`인지 확인한다.
- workspace의 `knowledge/graph/chroma`에 Chroma 파일이 생성되는지 확인한다.

## 완료 기준

- 기본 설정에서 ChromaDB가 활성화된다.
- 명시적으로 `sqlite`를 선택하면 fallback으로 전환된다.
- 실제 ChromaDB persistence, query, delete가 테스트로 고정된다.
- sidecar 전체 테스트와 desktop 테스트가 green이다.
- Windows bundled sidecar에서 settings 파일 없이도 ChromaDB가 활성화되는 smoke evidence가 남는다.

## 현재 진행 기록

```text
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_graphrag_ingestion.py -q -k "reprocesses_only_modified_files or default_chroma_backend or vector_backend_candidates or candidate_chunks"
4 passed

node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_settings_profiles.py services/sidecar/tests/test_graphrag_backends.py services/sidecar/tests/test_graphrag_ingestion.py services/sidecar/tests/test_sidecar_packaging.py -q
56 passed

npm.cmd run test -- src/settings-edit.test.tsx src/api.test.ts
2 files passed, 9 tests passed

npm.cmd run sidecar:test
142 passed

npm.cmd run desktop:test
18 files passed, 52 tests passed

node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
Finished dev profile

npm.cmd run sidecar:bundle:windows
Build complete: release/sidecar/windows-x64/gongmu-sidecar

npm.cmd run desktop:bundle
NSIS installer built at apps\desktop\src-tauri\target\release\bundle\nsis\Gongmu_0.1.0_x64-setup.exe

npm.cmd run desktop:smoke:nsis
health.status=ok
remaining_install_files=[]

Bundled sidecar smoke
workspace=C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\chroma-default-bundle-smoke-20260507-091209
settings_file_exists=false
health_status=ok
default_vector_backend=chromadb
active_vector_backend=chromadb
job_status=completed
processed_count=1
chunk_count=2
first_vector_ref=chromadb:gongmu_chunks:c92fd391-2cbc-49fa-9e8f-09447450d848
retrieve_count=1
first_vector_backend_score=61.73
chroma_file_count=5
```
