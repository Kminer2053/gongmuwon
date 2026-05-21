# ChromaDB 기본 설치 검증 노트

작성일: 2026-05-07

## 목적

GraphRAG 벡터 검색 저장소를 기본 설치 경로에서 ChromaDB로 사용하기 위한 검증 증거를 남긴다. SQLite 벡터 검색은 계속 유지하지만, 기본값이 아니라 사용자가 명시적으로 선택하는 fallback으로 둔다.

## 현재 구현 상태

- sidecar 기본 설정 `graphrag_vector_backend`는 `chromadb`다.
- desktop 설정 파서는 값이 없거나 잘못된 경우 `chromadb`로 보정한다.
- desktop 설정 화면의 초기값도 `chromadb`다.
- `sqlite`는 환경설정의 `Vector Store`에서 명시적으로 선택할 수 있다.
- ChromaDB는 Gongmu embedding pipeline이 만든 vector를 저장하고, Chroma 내장 embedding function은 사용하지 않는다.
- active vector backend가 있으면 retrieval은 전체 chunk scan이 아니라 Chroma 후보와 lexical/graph/session 후보를 합친 candidate pool을 scoring한다.
- deterministic fallback embedding만으로 나온 의미 없는 pure-vector 후보는 점수를 0으로 낮춰 stale retrieval을 방지한다.
- PyInstaller spec은 `chromadb`, `chromadb_rust_bindings`, 관련 dynamic library를 수집한다.

## Focused Verification

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
```

## Windows Bundled Smoke

```text
workspace=C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\chroma-default-bundle-smoke-20260507-091209
settings_file_exists=false
health_status=ok
default_vector_backend=chromadb
active_vector_backend=chromadb
vector_storage_path=C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\chroma-default-bundle-smoke-20260507-091209\knowledge\graph\chroma
job_status=completed
processed_count=1
skipped_count=0
chunk_count=2
first_vector_ref=chromadb:gongmu_chunks:c92fd391-2cbc-49fa-9e8f-09447450d848
retrieve_count=1
first_title=quality-gate
first_vector_backend_score=61.73
chroma_file_count=5
stdout_log=C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\chroma-default-bundle-smoke-20260507-091209\logs\sidecar.out.log
stderr_log=C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\chroma-default-bundle-smoke-20260507-091209\logs\sidecar.err.log
```

stderr에는 uvicorn startup 로그만 있었고, Chroma import/runtime error는 없었다. stdout에는 health, settings, backend-status, source create, ingest, chunks, retrieve 요청이 모두 2xx로 남았다.

## NSIS Installer Smoke

```text
nsis_path=apps\desktop\src-tauri\target\release\bundle\nsis\Gongmu_0.1.0_x64-setup.exe
install_dir=runtime-workspace\cache\nsis-smoke-install-20260507-002153
workspace_root=runtime-workspace\cache\nsis-smoke-workspace-20260507-002153
health.status=ok
health.workspace_root=C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\nsis-smoke-workspace-20260507-002153
remaining_install_files=[]
```

이 smoke는 설치 패키지 안의 sidecar payload가 실행되고 `/health`를 반환하는지 확인한다. Chroma 기본 동작 자체는 위의 bundled sidecar smoke에서 settings 파일이 없는 새 workspace 기준으로 별도 검증했다.

## 마감 점검

```text
git diff --check
passed

node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
Finished dev profile
```

NSIS smoke 이후 `apps/desktop/src-tauri/src/main.rs` 끝의 whitespace-only EOF 정리를 했고, 해당 정리 뒤 `cargo check`와 `git diff --check`를 다시 실행했다.

## Bundled Smoke에서 확인할 항목

- [x] settings 파일 없이 시작했을 때 `/api/settings.defaults.graphrag_vector_backend == "chromadb"`
- [x] `/api/knowledge/backend-status.vector.active_backend == "chromadb"`
- [x] ingestion 완료 후 chunk `vector_ref`가 `chromadb:gongmu_chunks:*` 형식인지 확인
- [x] retrieve 응답의 실제 `items` 기준으로 `score_breakdown.vector_backend_score > 0` 확인
- [x] workspace의 `knowledge/graph/chroma` 아래에 Chroma 저장 파일이 생성되는지 확인
