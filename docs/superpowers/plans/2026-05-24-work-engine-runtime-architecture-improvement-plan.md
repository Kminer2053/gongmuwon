# 업무엔진 런타임/사용자경험 구조개선 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 특정 지연 현상 하나를 막는 임시 수정이 아니라, 로컬 AI 업무 에이전트 워크플레이스 : 공무원의 업무엔진이 장기 작업, 즉시 작업, 보호 쓰기 작업을 일관되게 처리하도록 구조를 재정의한다.

**Architecture:** 업무엔진은 사용자 요청을 `즉시 읽기`, `짧은 보호 쓰기`, `상호작용형 스트리밍`, `백그라운드 장기 작업`, `승인 대기 작업`으로 분류한다. 프론트엔드는 모든 액션 뒤 전체 스냅샷을 다시 불러오지 않고, 액션별로 필요한 read model만 갱신한다.

**Tech Stack:** Tauri 2, React, TypeScript, FastAPI, SQLite WAL, Python worker/job manager, pytest, Vitest

---

## 1. 배경

환경설정 저장 지연은 단순히 Featherless 설정 저장이 느린 문제가 아니었다. 실제 원인은 다음 두 가지가 겹친 구조 문제였다.

- 프론트의 공통 `handleAction()`이 대부분의 액션 후 `refreshSnapshot()`을 호출하면서 지식폴더, 파일정리, 실행기록 같은 무거운 deferred data까지 함께 불러왔다.
- `/api/knowledge/documents`가 문서, 섹션, 표, 청크를 한 번에 조인하면서 데이터가 늘어날수록 `sections × tables × chunks` 곱셈 폭발이 발생했다.

이번에 반영한 수정은 이 현상의 직접 병목을 줄였지만, 이것만으로는 충분하지 않다. 같은 패턴은 문서작성, 파일 인덱싱, GraphRAG 색인, 실행기록, LLM 연결 테스트에서도 반복될 수 있다.

## 2. 현재 구조 진단

### 이미 좋은 방향으로 들어간 부분

- `work_jobs`, `work_job_events`, `work_job_locks`가 존재한다.
- GraphRAG ingestion, 파일명 인덱싱, 문서 생성, 파일정리, 업무대화 turn 일부가 job으로 기록된다.
- resource lock 개념이 존재해 같은 세션/파일/지식소스에 대한 중복 작업을 막을 수 있다.
- 프론트에는 shell snapshot과 deferred snapshot 개념이 있다.
- 업무엔진 상태를 Tauri에서 시작/중지/재시작하는 기본 감독 기능이 있다.

### 아직 구조적으로 미흡한 부분

- `handleAction()`의 기본값이 여전히 전체 새로고침이다. 새 액션이 추가될 때마다 무거운 조회가 다시 붙을 위험이 있다.
- job 체계가 “상태 기록”에 가깝고, 실제 worker queue/pool의 실행 계약은 아직 약하다.
- `BackgroundTasks`와 동기 실행이 섞여 있어 장기 작업의 일관된 취소, 재시작 복구, 진행률 표기가 어렵다.
- FastAPI 요청 처리 스레드 안에서 문서 파싱, 파일 스캔, HWPX 생성, 외부 LLM 테스트 같은 느린 작업이 직접 실행되는 경로가 남아 있다.
- SQLite 연결이 하나의 공유 connection과 lock 중심이라, 긴 읽기/쓰기 중 다른 짧은 작업이 체감상 같이 밀릴 수 있다.
- 실행기록, 지식문서, 메시지 같은 목록 API에 기본 limit/page 계약이 부족하다.
- 업무엔진 재시작 후 실행 중이던 job의 복구 정책이 기능별로 다르다.
- 사용자에게는 “지금 무엇이 막혔는지, 어떤 작업은 계속 진행 중인지, 내가 다른 작업을 해도 되는지”가 충분히 분리되어 보이지 않는다.

## 3. 목표 사용자경험

사용자는 GraphRAG 색인, 파일 인덱싱, 문서 생성이 오래 걸려도 앱이 멈췄다고 느끼면 안 된다.

- 설정 저장, 일정 등록, 세션 생성, 파일 검색 결과 선택은 0.5초 안팎으로 반응한다.
- 1초 이상 걸릴 가능성이 있는 작업은 진행 상태가 표시된다.
- 3초 이상 걸릴 가능성이 있는 작업은 job으로 전환되어 우측 패널의 작업 진행에 남는다.
- 동일 자원 충돌은 `fetch fail`이나 무응답이 아니라 “앞 작업 완료 후 자동 진행” 또는 “현재 작업 때문에 대기 중”으로 표시된다.
- 업무엔진이 재시작되면 중단된 장기 작업은 `failed/recoverable` 또는 `queued`로 명확히 정리된다.
- 사용자는 장기 작업 중에도 대화, 일정 확인, 파일 검색 같은 무관한 작업을 계속할 수 있다.

## 4. 업무엔진 요청 분류 계약

| 분류 | 예시 | 서버 계약 | UI 계약 |
| --- | --- | --- | --- |
| 즉시 읽기 | 일정 목록, 현재 설정, 파일검색 결과, job 상태 | 200ms~500ms 목표, pagination/limit 필수 | 버튼 잠금 없음, 화면 일부만 갱신 |
| 짧은 보호 쓰기 | 설정 저장, 일정 생성, 세션명 변경, 파일 연결 | 1초 이내 목표, 짧은 DB transaction | 해당 버튼만 pending, 성공 즉시 로컬 상태 반영 |
| 상호작용형 스트리밍 | 업무대화 LLM 응답, GraphRAG 근거 답변 | SSE/stream 우선, session resource ordering | 채팅 입력은 세션 단위로만 순서 제어 |
| 백그라운드 장기 작업 | GraphRAG ingestion, 파일명 인덱스 갱신, 대량 파싱 | 202 + `work_job_id`, worker queue 실행 | 우측 작업 진행에서 진행률/로그/취소 제공 |
| 승인 대기 작업 | 외부 실행, 파일 이동, 최종 산출물 적용 | approval ticket + job 연결 | 승인요청과 job 상태를 함께 표시 |

## 5. 핵심 설계 원칙

### 5.1 전체 스냅샷 금지 원칙

액션 후 기본 동작은 전체 refresh가 아니다. 모든 액션은 아래 중 하나를 명시해야 한다.

- `refresh: none`: 응답 payload로 로컬 상태만 갱신한다.
- `refresh: shell`: health/settings/schedules/sessions/jobs 같은 가벼운 shell만 갱신한다.
- `refresh: deferred:<group>`: 필요한 그룹만 갱신한다.
- `refresh: full`: 사용자가 명시적으로 새로고침을 눌렀을 때만 사용한다.

검증 기준:

- 설정 저장 후 `/api/knowledge/documents`가 호출되지 않는다.
- 일정 저장 후 GraphRAG/파일정리 API가 호출되지 않는다.
- 파일검색 결과 선택 후 지식폴더 전체 목록이 호출되지 않는다.

### 5.2 모든 목록 API의 limit/page 계약

목록 API는 무제한 전체 반환을 기본값으로 삼지 않는다.

우선 대상:

- `/api/execution-logs`
- `/api/knowledge/documents`
- `/api/knowledge/source-files`
- `/api/knowledge/chunks`
- `/api/work-sessions/{session_id}/messages`

검증 기준:

- 기본 limit은 50~200개 범위다.
- 전체 개수가 필요한 화면은 `total_count`를 별도 집계로 받는다.
- 1만 개 수준 데이터에서도 기본 목록 응답은 500ms 이내를 목표로 한다.

### 5.3 job runner 정식화

현재 `JobManager`는 DB 상태 기록 중심이다. 다음 단계에서는 실제 실행 queue를 명확히 분리한다.

권장 구조:

- `job_registry.py`: job kind와 handler 매핑
- `job_runner.py`: queue, worker, resource lock, cancel check
- `job_handlers/knowledge.py`: GraphRAG scan/ingest/reindex
- `job_handlers/files.py`: 파일명 인덱싱
- `job_handlers/documents.py`: HWPX 문서 생성
- `job_handlers/fileorg.py`: 파일정리 apply/rollback
- `job_handlers/chat.py`: 세션 turn 순서 보장

검증 기준:

- 장기 작업 API는 1초 안에 `work_job_id`를 반환한다.
- job event는 최소 `created`, `started`, `progress`, `succeeded/failed/canceled`를 남긴다.
- 같은 `resource_key`의 exclusive 작업은 동시에 실행되지 않는다.
- 다른 `resource_key`의 작업은 동시에 진행 가능하다.

### 5.4 DB 접근 안정화

SQLite는 계속 사용 가능하지만, 공유 connection 하나로 모든 작업을 처리하는 방식은 줄인다.

권장 구조:

- 짧은 쓰기 전용 transaction helper를 둔다.
- 긴 읽기는 별도 read connection 또는 read-only snapshot 방식으로 분리한다.
- 모든 쓰기는 `write_lock`을 통해 직렬화한다.
- 장기 작업은 파일 파싱/LLM 호출/템플릿 렌더링을 DB transaction 밖에서 수행한다.
- DB transaction 안에서는 insert/update/delete만 짧게 수행한다.

검증 기준:

- 장기 GraphRAG 색인 중 설정 저장이 1초 이내에 끝난다.
- 파일 인덱싱 중 일정 조회/저장이 정상 동작한다.
- `cannot commit`, `cannot start a transaction`, `no transaction is active` 계열 오류가 회귀 테스트에서 재현되지 않는다.

### 5.5 업무엔진 감독/복구

Tauri의 업무엔진 supervisor는 단순 시작/중지가 아니라 사용자 입장에서 “앱이 살아 있다”는 신뢰를 줘야 한다.

개선 방향:

- `/health`: 프로세스 생존 확인
- `/ready`: DB, settings, 필수 폴더, job manager 준비 상태 확인
- `/api/runtime/metrics`: 최근 slow request, active jobs, queue depth
- 비정상 종료 후 자동 재시작 시 running job 복구 요약 표시
- 수동 재시작 시 진행 중 작업이 있으면 먼저 안내

검증 기준:

- 업무엔진 강제 종료 후 앱이 자동 재시작하거나, 실패 시 명확한 복구 버튼/로그를 제공한다.
- 재시작 후 `running` job이 무한 running으로 남지 않는다.
- 사용자는 “업무엔진 미연결” 상태에서 어떤 기능이 제한되는지 알 수 있다.

### 5.6 사용자 표현 통일

내부 코드에서는 `sidecar`라는 기술명을 유지할 수 있다. UI와 문서에서 사용자에게 보이는 명칭은 `업무엔진`으로 통일한다.

검증 기준:

- 앱 UI에 `sidecar`가 직접 노출되지 않는다.
- 로그 파일이나 개발자용 문서에는 `sidecar/internal work engine` 병기 가능하다.

## 6. 단계별 실행 계획

### Phase 0. 이미 반영된 기초 조치

- [x] Featherless 연결 실패 원인인 User-Agent/Accept 헤더 문제 수정
- [x] 설정 저장 후 전체 스냅샷을 기다리지 않도록 환경설정 저장 흐름 수정
- [x] GraphRAG 문서 목록 집계 쿼리 최적화
- [x] 관련 SQLite 인덱스 추가
- [x] 설정 저장 후 지식문서 전체 조회가 발생하지 않는 회귀 테스트 추가
- [x] GraphRAG 문서 목록 조인 폭발 방지 성능 테스트 추가

검증 결과:

- `PUT /api/settings`: 약 0.01초
- `GET /api/knowledge/documents`: 기존 약 60초대에서 약 0.027초로 개선
- `npm.cmd run verify:all`: 통과

### Phase 1. Refresh 정책 전면 정리

- [ ] `handleAction()` 호출부 전체를 조사해 액션별 refresh scope를 명시한다.
- [ ] full refresh가 필요한 호출과 필요 없는 호출을 표로 분류한다.
- [ ] 설정, 일정, 세션, 파일연결, 파일검색, 문서작성, 파일정리, 지식폴더 액션별 테스트를 추가한다.
- [ ] 사용자가 누르는 일반 액션 후 불필요한 deferred API 호출이 없음을 검증한다.

주요 파일:

- `apps/desktop/src/app.tsx`
- `apps/desktop/src/api.ts`
- `apps/desktop/src/*test.tsx`

### Phase 2. 목록 API pagination/read model 정리

- [ ] 실행기록 API에 `limit`, `offset` 또는 cursor를 추가한다.
- [ ] 지식문서/소스파일/청크 목록 API에 기본 limit을 둔다.
- [ ] 프론트는 목록 전체 대신 현재 화면에 필요한 항목만 요청한다.
- [ ] 우측 패널의 실행기록/덤프뷰어/미리보기는 별도 read model로 분리한다.

주요 파일:

- `services/sidecar/src/gongmu_sidecar/db.py`
- `services/sidecar/src/gongmu_sidecar/graphrag_ingestion.py`
- `services/sidecar/src/gongmu_sidecar/app.py`
- `apps/desktop/src/api.ts`
- `apps/desktop/src/app.tsx`

### Phase 3. Job runner 정식화

- [ ] `JobManager`에서 상태 저장과 실행 orchestration 책임을 분리한다.
- [ ] `JobRunner`를 추가해 worker thread, resource lock, cancel check를 담당하게 한다.
- [ ] `BackgroundTasks`에 직접 의존하는 GraphRAG ingestion을 `JobRunner` 기반으로 이전한다.
- [ ] 파일명 인덱싱, 문서 생성, 파일정리 apply/rollback을 job handler로 이전한다.
- [ ] 같은 자원의 작업은 대기하고 다른 자원의 작업은 병렬 처리되는 테스트를 추가한다.

주요 파일:

- `services/sidecar/src/gongmu_sidecar/jobs.py`
- `services/sidecar/src/gongmu_sidecar/job_runner.py`
- `services/sidecar/src/gongmu_sidecar/job_handlers/*.py`
- `services/sidecar/src/gongmu_sidecar/app.py`

### Phase 4. DB 접근 계층 안정화

- [ ] shared connection 사용 지점을 점검한다.
- [ ] read connection과 write transaction helper를 분리한다.
- [ ] 장기 작업 중 DB transaction을 잡고 있는 구간을 제거한다.
- [ ] `cannot commit` 계열 회귀 테스트를 추가한다.

주요 파일:

- `services/sidecar/src/gongmu_sidecar/db.py`
- `services/sidecar/src/gongmu_sidecar/graphrag_ingestion.py`
- `services/sidecar/tests/test_database_concurrency.py`

### Phase 5. 업무엔진 supervisor/복구 UX

- [ ] `/ready`와 runtime metrics API를 추가한다.
- [ ] Tauri supervisor에서 health/ready를 구분한다.
- [ ] 업무엔진 재시작 후 중단 job 복구 결과를 우측 패널에 표시한다.
- [ ] 강제 종료/자동 재시작/수동 재시작 시나리오를 테스트한다.

주요 파일:

- `services/sidecar/src/gongmu_sidecar/app.py`
- `apps/desktop/src-tauri/src/main.rs`
- `apps/desktop/src/runtime.ts`
- `apps/desktop/src/app.tsx`

### Phase 6. 사용자 작업 진행 UI 통합

- [ ] 우측 패널의 “최근 실행”과 “작업 진행”을 job 중심으로 재정리한다.
- [ ] 장기 작업 카드는 진행률, 현재 단계, 최근 로그, 취소 버튼, 결과 열기를 갖는다.
- [ ] 충돌/대기 상태는 `blocked`로 명확히 표시한다.
- [ ] 사용자는 장기 작업 중에도 무관한 기능을 계속 조작할 수 있어야 한다.

주요 파일:

- `apps/desktop/src/app.tsx`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/*job*.test.tsx`

## 7. 검증 시나리오

### 구조 검증

- [ ] GraphRAG ingestion 실행 중 환경설정 저장이 1초 이내 완료된다.
- [ ] GraphRAG ingestion 실행 중 일정 생성/수정/삭제가 정상 동작한다.
- [ ] 파일명 인덱싱 중 업무대화 세션 전환과 파일검색 조회가 가능하다.
- [ ] HWPX 문서 생성 중 다른 세션에서 대화를 시작할 수 있다.
- [ ] 같은 세션에 연속 대화를 보내면 순서가 보장되거나 명확히 대기 상태가 표시된다.
- [ ] 같은 파일/폴더 대상 파일정리 작업은 동시에 실행되지 않는다.

### UX 검증

- [ ] 장기 작업을 시작하면 1초 이내 우측 패널에 작업 카드가 생긴다.
- [ ] 진행률이 0%에서 100%로 한 번에 뛰지 않고 단계별로 갱신된다.
- [ ] 작업 실패 시 실패 단계와 원인이 사용자 언어로 보인다.
- [ ] 작업 성공 시 결과 파일/폴더/상세 로그를 열 수 있다.
- [ ] 업무엔진 재시작 후 중단 작업이 무한 진행 상태로 남지 않는다.

### 성능 기준

- [ ] `/api/settings` PUT: 일반 상황 500ms 이하, 장기 작업 중 1초 이하
- [ ] `/api/knowledge/documents` 기본 목록: 500ms 이하
- [ ] `/api/execution-logs` 기본 목록: 300ms 이하
- [ ] full refresh는 수동 새로고침 외 일반 액션에서 사용하지 않는다.

## 8. 우선순위

1. **Phase 1 Refresh 정책 정리**
   - 사용자 체감 지연과 화면 흔들림을 가장 빨리 줄인다.
2. **Phase 2 목록 API pagination/read model**
   - 데이터가 늘수록 앱이 느려지는 문제를 구조적으로 막는다.
3. **Phase 3 Job runner 정식화**
   - GraphRAG, 문서작성, 파일정리, 파일 인덱싱의 장기 작업 UX를 통일한다.
4. **Phase 4 DB 접근 안정화**
   - 장기적으로 SQLite 기반 로컬 우선 구조를 안정화한다.
5. **Phase 5~6 supervisor/UI**
   - 사용자가 업무엔진과 작업 상태를 신뢰할 수 있게 만든다.

## 9. 개발 원칙

- 현상 하나를 막기 위한 예외 분기를 늘리지 않는다.
- 액션이 어떤 작업 분류에 속하는지 먼저 정하고 구현한다.
- 새로운 장기 작업 API는 반드시 `work_job_id`와 진행 상태를 제공한다.
- 새로운 목록 API는 반드시 limit/page 정책을 가진다.
- 새로운 프론트 액션은 반드시 refresh scope를 명시한다.
- 완료 주장은 `pytest`, `vitest`, `build`, 실제 로컬 API timing 증거로만 한다.

## 10. 2026-05-24 실행 체크포인트

### 반영 완료

- Phase 1 refresh 정책을 코드 수준에서 강제했다.
  - `handleAction` 호출 시 `refresh: "none" | "shell" | "full"`을 반드시 명시하도록 변경했다.
  - 일반 저장/일정/세션/파일연결/문서작성 액션은 기본적으로 full refresh를 타지 않게 정리했다.
  - 업무엔진 시작/종료/재시작은 전체 스냅샷 대신 shell snapshot만 갱신한다.
- 환경설정 저장은 즉시 응답 후 필요한 shell/log 갱신만 비동기로 수행한다.
- Phase 2 read model 1차 조치로 `/api/execution-logs` 기본 조회 limit을 추가했다.
  - 기본 50개, 최소 1개, 최대 500개로 제한한다.
- 지식문서 목록 성능은 join 폭증을 피하는 pre-aggregated count 방식으로 유지한다.

### 검증 증거

- `npm.cmd --workspace apps/desktop run test -- src/schedule-editor-linked-session.test.tsx src/settings-edit.test.tsx`
  - 7 passed
- `node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_api_flows.py::test_execution_logs_are_limited_for_runtime_read_model -q`
  - 1 passed
- `npm.cmd run desktop:build`
  - TypeScript build 및 Vite build 성공
- `node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_api_flows.py services/sidecar/tests/test_graphrag_document_listing_perf.py -q`
  - 19 passed
- `runtime-workspace` 기준 API timing
  - `GET /api/knowledge/documents`: 0.0306s
  - `GET /api/execution-logs`: 0.0091s
  - `GET /api/execution-logs?limit=10`: 0.0074s
  - `PUT /api/settings`: 0.0115s
- 최종 게이트 `npm.cmd run verify:all`
  - sidecar: 212 passed
  - desktop: 73 passed
  - desktop build 성공
  - cargo check 성공

### 다음 단계

- Phase 3에서는 GraphRAG, 문서작성, 파일정리, 파일명 인덱싱을 동일한 job runner 계약으로 더 강하게 묶는다.
- Phase 4에서는 장시간 인제스트 중 SQLite write contention을 별도 회귀 테스트로 고정한다.
- Phase 5~6에서는 업무엔진 ready/metrics와 우측 작업 진행 UI를 job 중심으로 통합한다.

## 11. 2026-05-24 Phase 3~6 실행 체크포인트

### 반영 완료

- Phase 3 job runner 계약을 추가했다.
  - `JobRunner`가 별도 파일로 분리되어 worker thread, active job metrics, resource lock 대기, 예외 시 실패 처리 책임을 맡는다.
  - `JobManager`는 DB 상태 저장과 event 기록의 source of truth로 유지했다.
  - GraphRAG background ingestion은 FastAPI `BackgroundTasks` 직접 의존 대신 `JobRunner.submit_existing()` 경로로 연결했다.
  - 문서 생성 job은 `start_job_with_lock()`을 사용해 같은 산출 경로 작업이 동시에 실행되지 않도록 보강했다.
- Phase 4 DB 접근 안정성을 보강했다.
  - `Database.read_connection()`, `fetch_all_readonly()`, `fetch_one_readonly()`를 추가해 긴 write transaction 중에도 read-only snapshot 조회가 가능하게 했다.
  - 실행기록 목록과 job status 집계는 read-only snapshot 경로를 사용한다.
  - 긴 write transaction 중 read-only 조회가 0.5초 이내 반환되는 회귀 테스트를 추가했다.
- Phase 5 업무엔진 준비도/메트릭 API를 추가했다.
  - `/ready`는 workspace, database, job manager 준비 상태와 재시작 복구 job 수를 반환한다.
  - `/api/runtime/metrics`는 work job 상태별 count, runner active jobs, GraphRAG active ingestion 상태를 반환한다.
  - 프론트 shell snapshot이 `/ready`, `/api/runtime/metrics`를 함께 읽도록 확장했다.
  - 상단 업무엔진 팝오버에서 준비도, 진행 작업 수, runner active 수, 재시작 복구 요약을 표시한다.
- Phase 6 작업 진행 UI를 job 중심으로 보강했다.
  - blocked 작업은 "선행 작업 완료 후 자동 이어서 실행" 안내를 표시한다.
  - 완료된 작업은 `artifact_path`, `markdown_path`, `destination_path`, `restored_path`, `log_dump_path` 결과 링크를 우측 작업 카드에서 바로 열 수 있다.
  - 작업 카드의 로그 보기, 취소 요청, 결과 열기 흐름을 기존 우측 패널 안에 통합했다.

### 검증 증거

- `node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_job_runner.py services/sidecar/tests/test_runtime_readiness.py services/sidecar/tests/test_db_concurrency.py services/sidecar/tests/test_work_job_scheduler.py services/sidecar/tests/test_work_jobs.py -q`
  - 14 passed
- `npm.cmd --workspace apps/desktop run test -- src/app.test.tsx src/context-pane-auto-open.test.tsx`
  - 13 passed
- `npm.cmd run verify:all`
  - sidecar: 219 passed
  - desktop: 73 passed
  - desktop build: passed
  - cargo check: passed

### 남은 판단

- File search indexing, file organizer apply/rollback은 이미 work job과 resource lock을 사용하므로 이번 단계에서는 handler 파일 분리까지 강제하지 않았다.
- 문서 생성은 API 응답 계약을 유지하기 위해 동기 실행을 유지하되 lock을 적용했다. 장시간 문서 생성이 실제 사용자 환경에서 문제로 확인되면 다음 단계에서 `JobRunner.submit()` 기반 202 응답형 작업으로 전환한다.
