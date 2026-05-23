# Multi-Task Execution Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작업지시가 길어지거나 서로 충돌해도 사용자가 기다림, 멈춤, fetch fail, 중복 실행을 겪지 않도록 Gongmu에 범용 다중작업 실행 체계를 구축한다.

**Architecture:** 현재 지식폴더 GraphRAG 인제스트에만 있는 작업 개념을 `work_jobs` 기반의 범용 작업 큐로 확장한다. 긴 작업은 즉시 `job_id`를 반환하고 백그라운드에서 실행하며, 충돌 가능한 자원은 resource lock으로 보호하고, UI는 전체 화면을 막지 않고 작업별 진행률/취소/로그를 보여준다.

**Tech Stack:** FastAPI, SQLite WAL, Python thread worker, React, TypeScript, Vitest, pytest, Tauri 2

---

## 0.1 2026-05-23 이행 현황

라우팅/메타 프롬프트 분석 문서와 본 계획에서 사용자 체감 품질에 직접 영향을 주는 항목을 우선 구현했다.

- DB WAL, busy timeout, write lock, transaction manager를 적용했다.
- `work_jobs`, `work_job_events`, `work_job_locks`와 `JobManager`를 추가했다.
- `/api/jobs`, `/api/jobs/{job_id}`, `/api/jobs/{job_id}/events`, `/api/jobs/{job_id}/cancel` API를 추가했다.
- resource lock scheduler를 추가해 같은 자원의 중복 실행을 `blocked`로 보호하고, lock 해제 시 다음 작업을 `queued`로 전환한다.
- 파일명 인덱스 갱신, GraphRAG 인제스트/재색인, 문서작성, 파일정리 적용/되돌리기, 업무대화 turn을 작업으로 기록한다.
- 업무대화 turn은 `work_session:{session_id}` exclusive lock으로 보호해 같은 세션의 동시 응답 꼬임을 막는다.
- 명확한 복합 요청은 경량 intent planner가 `intent.plan`으로 분해해 일정/지식검색/문서작성 스킬을 순차 실행한다.
- 우측 패널의 `작업 진행` 카드에서 진행률, 자원 키, 작업 ID, 이벤트 로그를 펼쳐볼 수 있게 했다.

검증 근거는 `docs/operations/2026-05-23-routing-multitask-implementation-report.md`에 기록했다.

## 0. 2026-05-22 보강 사항

이번 점검에서 확인된 핵심은 “기능은 호출되지만 긴 작업과 도구 호출의 경계가 사용자에게 충분히 보이지 않는다”는 점이다. 특히 업무대화에서 문서작성 도구를 호출할 때 HWPX 파일은 생성되지만, 사용자는 어느 단계가 실행되는지, 어떤 자료가 반영됐는지, 결과 파일을 어디서 열어야 하는지 명확히 알기 어렵다.

이번 세션에서 즉시 반영한 단기 개선은 다음과 같다.

- 문서작성 라우팅은 `보고서`, `공문`, `시행문`, `이메일`, `HWPX` 자연어 요청을 일반 LLM 답변이 아니라 `document.create` 스킬로 우선 처리한다.
- 생성된 HWPX 결과는 업무대화 답변에 `파일 열기`, `폴더 열기`, `검토용 Markdown` 경로를 명시한다.
- 문서작성 스킬은 대화세션, 연결파일, 직접 첨부파일 본문 요약, 사용자가 적은 활용계획을 보고서 본문과 근거 섹션에 반영한다.
- 보고서 본문에는 Kminer2053/public-doc-to-hwpx 레퍼런스의 핵심 작성 원칙인 두괄식, 개조식, 한 문장 한 핵심, 불필요 표현 축약을 반영한다.
- 업무대화 출력은 인용문, 번호 목록, 표, 코드블록, 파일/폴더 열기 링크를 렌더링하도록 보강한다.
- 일부 로컬/외부 모델이 내부 추론 흔적을 그대로 출력하는 문제를 막기 위해 시스템 프롬프트와 응답 후처리를 강화한다.

다만 문서작성은 아직 범용 `work_jobs`로 완전히 이전된 상태는 아니다. 현재는 단기적으로 동기 실행의 품질과 결과 안내를 개선했고, 장기적으로는 이 계획의 `4.6 문서작성 job화` 단계에서 `자료 수집 -> 콘텐츠 구조화 -> HWPX 렌더링 -> 파일 저장 -> 완료` 진행 상태를 작업센터에 노출해야 한다.

사용자 경험 관점에서 이 계획의 우선순위는 다음으로 조정한다.

1. DB write lock/WAL과 범용 job core를 먼저 적용해 `cannot commit`, `fetch fail`, 중복 실행을 줄인다.
2. GraphRAG 인제스트와 파일명 인덱스 갱신을 우선 job화해 장시간 대기와 새로고침 취약성을 줄인다.
3. 문서작성 HWPX 생성을 job화해 업무대화에서 보고서 작성 요청 후 진행 단계와 결과 파일 링크를 안정적으로 보여준다.
4. 업무대화 LLM turn을 ordered job으로 묶어 같은 세션의 연속 질문, 도구 호출, 스트리밍 응답 순서를 보장한다.

---

## 1. 코드 분석 결과

### 1.1 현재 작업 실행 구조

현재 코드는 기능별로 장기 작업 처리 방식이 다르다.

- `services/sidecar/src/gongmu_sidecar/graphrag_ingestion.py`
  - `knowledge_ingestion_jobs` 테이블과 `run_job()`, `request_cancel()`이 있어 GraphRAG 인제스트는 작업처럼 동작한다.
  - 다만 범용 작업 큐가 아니라 지식폴더 전용 구현이다.
  - `active_job()`이 queued/running 작업 1개를 전역 기준으로 찾기 때문에 다른 지식소스 작업까지 넓게 막는 구조다.
- `services/sidecar/src/gongmu_sidecar/app.py`
  - `/api/knowledge/ingest`, `/api/knowledge/reindex`는 `BackgroundTasks`로 백그라운드 실행을 지원한다.
  - `/api/files/index/rebuild`는 `services.rebuild_file_search_index()`를 요청 중 동기 실행한다.
  - `generate_document_from_request()`는 콘텐츠베이스 생성, 승인, 최종 문서 적용을 한 요청에서 동기 실행한다.
  - 업무대화 스트리밍은 별도 `Thread`와 `Queue`로 처리하지만, 범용 작업 상태와 연결되어 있지 않다.
- `services/sidecar/src/gongmu_sidecar/db.py`
  - SQLite 연결을 `check_same_thread=False`로 공유한다.
  - `insert()`와 `execute()`가 매번 즉시 commit하며, 별도 lock/transaction manager가 없다.
  - GraphRAG 인제스트, 파일 색인, 문서 생성, 업무대화가 동시에 DB를 쓰면 `cannot commit`, `cannot start a transaction` 계열 오류가 재발할 수 있다.
- `services/sidecar/src/gongmu_sidecar/local_file_search.py`
  - 파일명 인덱스 갱신은 로컬 드라이브를 탐색하므로 오래 걸릴 수 있으나, 현재 API는 동기 응답이다.
  - 기본 시간 제한 8초가 있어 partial 인덱스가 만들어질 수 있고, 진행률/취소/재시작 개념이 없다.
- `services/sidecar/src/gongmu_sidecar/file_organizer.py`
  - `commit_apply()`와 `rollback()`이 `copytree`, `copy2`, `rmtree`, `unlink`를 요청 중 동기 실행한다.
  - 큰 폴더를 다루면 앱이 멈춘 것처럼 보이고 중간 취소가 어렵다.
- `services/sidecar/src/gongmu_sidecar/documents.py`
  - `apply_final_document_output()`이 HWPX 생성과 파일 쓰기를 동기 처리한다.
  - 문서작성 요청 실패 시 어느 단계에서 실패했는지 사용자에게 보이기 어렵다.
- `services/sidecar/src/gongmu_sidecar/llm.py`
  - 일반 LLM 호출은 `urllib` 동기 호출이며 기본 timeout이 180초다.
  - 스트리밍 함수는 있지만 범용 작업 취소/작업센터와 연결되어 있지 않다.
- `apps/desktop/src/app.tsx`
  - 전역 `submitting` 상태가 여러 버튼을 동시에 막는다.
  - `handleAction()`이 대부분의 액션 후 `refreshSnapshot()`을 전체 호출한다.
  - 지식폴더 인제스트는 별도 polling이 있으나, 파일검색/문서작성/파일정리/LLM 작업에는 같은 수준의 작업 상태 UI가 없다.

### 1.2 사용자 경험을 훼손할 수 있는 상황

1. GraphRAG 인제스트 중 파일명 인덱스 갱신 또는 문서 생성이 동시에 DB를 쓰면 SQLite 공유 연결에서 transaction 충돌이 날 수 있다.
2. 지식폴더 인제스트가 오래 걸릴 때 다른 지식소스 등록/스캔이 전역 lock으로 막혀 사용자가 왜 안 되는지 답답하게 느낄 수 있다.
3. 파일명 인덱스 갱신은 요청이 끝날 때까지 기다리므로 사용자가 버튼을 여러 번 누르거나 앱이 멈췄다고 오해할 수 있다.
4. 문서작성 HWPX 생성이 실패하면 콘텐츠베이스, 승인, 최종 저장 중 어느 단계인지 구분하기 어렵다.
5. 파일정리에서 큰 폴더 복사/되돌리기 중 앱을 닫거나 새 작업을 요청하면 복구 가능한 작업 상태가 남지 않는다.
6. 비스트리밍 LLM 또는 느린 외부 모델 호출은 최대 180초 동안 사용자가 기다리게 만들 수 있다.
7. 같은 업무대화 세션에 여러 메시지를 빠르게 보내면 메시지 순서, pending assistant, 응답 저장 순서가 꼬일 수 있다.
8. 전체 `refreshSnapshot()`이 장기 작업 진행 중 자주 실행되면 화면 점프, 스크롤 흔들림, 체감 지연이 생긴다.
9. 사용자가 진행률을 못 보면 같은 작업을 반복 요청해 중복 job 또는 409/fetch fail을 만들 수 있다.
10. 현재 복구 로직은 GraphRAG running job만 다루므로 파일정리/문서작성/파일색인 도중 앱이 꺼지면 상태 복원이 어렵다.

---

## 2. 목표 설계

### 2.1 작업 분류

모든 요청을 무조건 병렬화하지 않는다. 사용자가 계속 조작할 수 있게 하되, 충돌 가능한 자원은 명시적으로 보호한다.

| 작업 분류 | 예시 | 실행 방식 | UX |
| --- | --- | --- | --- |
| Quick Read | 일정 조회, 검색 결과 조회, 설정 조회 | 즉시 응답 | 화면 차단 없음 |
| Foreground Interactive | 업무대화 스트리밍, 짧은 문서작성 미리보기 | job + 실시간 이벤트 | 현재 화면에 진행 표시, 취소 가능 |
| Background Long Job | GraphRAG 인제스트, 파일명 인덱스 갱신, 대량 파싱 | job queue | 우측 작업센터에 진행률/로그 |
| Protected Write | 파일정리 적용/롤백, 최종 HWPX 저장, 설정 저장 | resource lock job | 충돌 시 대기열 또는 명확한 안내 |
| Approval Wait | 승인 대기 중인 외부 실행/파일 작업 | waiting_approval | 승인 후 job 재개 |

### 2.2 핵심 원칙

- 긴 작업은 202/201 응답으로 `job_id`를 즉시 반환한다.
- UI는 `job_id`를 기반으로 진행률, 단계, 최근 로그, 취소 버튼을 보여준다.
- 전역 `submitting` 대신 액션별 pending 상태와 작업별 상태를 사용한다.
- 같은 자원을 쓰는 작업만 막고, 무관한 작업은 동시에 진행한다.
- SQLite 쓰기는 반드시 직렬화하거나 연결을 분리한다.
- 작업 중 앱/업무엔진이 재시작되면 running job을 복구 가능한 상태로 정리한다.
- 사용자에게는 “실행 중”, “대기 중”, “충돌로 대기”, “취소 중”, “부분 완료”, “실패 원인”이 명확히 보여야 한다.

---

## 3. 제안 아키텍처

### 3.1 신규 백엔드 구성

신규 모듈을 작게 나눈다.

- Create: `services/sidecar/src/gongmu_sidecar/jobs.py`
  - `JobManager`, `JobRunner`, `JobDefinition`, `JobProgress`, `JobResult`
  - job 생성, 상태 전환, event 기록, cancel flag 확인
- Create: `services/sidecar/src/gongmu_sidecar/job_handlers.py`
  - 기존 기능을 job handler로 감싸는 얇은 어댑터
  - `knowledge.ingest`, `files.index.rebuild`, `documents.generate`, `fileorg.apply`, `fileorg.rollback`, `personalization.analyze`
- Modify: `services/sidecar/src/gongmu_sidecar/db.py`
  - SQLite WAL, busy timeout, transaction context manager, write lock 추가
  - `work_jobs`, `work_job_events`, `work_job_locks` schema 추가
- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
  - `/api/jobs`, `/api/jobs/{job_id}`, `/api/jobs/{job_id}/events`, `/api/jobs/{job_id}/cancel` 추가
  - 기존 긴 작업 API는 job 생성 응답으로 점진 전환
- Modify: `services/sidecar/src/gongmu_sidecar/graphrag_ingestion.py`
  - 기존 `knowledge_ingestion_jobs`는 초기에는 유지하되, `work_jobs`와 동기화한다.
  - 최종적으로는 GraphRAG 전용 job 테이블을 상세 진단 테이블로 축소한다.

### 3.2 신규 DB schema

`db.py`의 `SCHEMA`에 추가한다.

```sql
CREATE TABLE IF NOT EXISTS work_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 50,
    resource_key TEXT,
    resource_policy TEXT NOT NULL DEFAULT 'none',
    progress_percent INTEGER NOT NULL DEFAULT 0,
    current_stage TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    input_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT NOT NULL DEFAULT '{}',
    error_message TEXT,
    created_at TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS work_job_events (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    level TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES work_jobs(id)
);

CREATE TABLE IF NOT EXISTS work_job_locks (
    resource_key TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    lock_type TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES work_jobs(id)
);
```

### 3.3 상태 모델

job status는 다음 값으로 통일한다.

| status | 의미 |
| --- | --- |
| `queued` | 실행 대기 |
| `blocked` | resource lock 때문에 대기 |
| `running` | 실행 중 |
| `waiting_approval` | 사용자 승인 대기 |
| `cancel_requested` | 취소 요청 접수 |
| `canceled` | 취소 완료 |
| `succeeded` | 성공 |
| `partial` | 일부 성공/일부 실패 |
| `failed` | 실패 |

### 3.4 resource lock 정책

| resource_key | 정책 | 적용 작업 |
| --- | --- | --- |
| `knowledge_source:{source_id}` | exclusive | scan, ingest, reindex |
| `knowledge_graph` | shared write serialized | graph rebuild, graph export |
| `local_file_index` | exclusive | 파일명 인덱스 갱신 |
| `document_output:{content_base_id}` | exclusive | HWPX 최종 생성 |
| `file_path:{normalized_path}` | exclusive | 파일정리 적용/롤백 |
| `work_session:{session_id}` | ordered | 같은 세션의 LLM turn 순서 보장 |
| `settings` | exclusive short | 모델/환경 설정 저장 |

### 3.5 worker pool 정책

초기 구현은 단순하고 안전하게 시작한다.

- `io_pool`: 파일 인덱스, 파일정리, 문서쓰기. 최대 동시 2개.
- `parser_pool`: GraphRAG 파싱/인제스트. 최대 동시 1개.
- `llm_pool`: 업무대화 LLM 응답. 최대 동시 1개, 이후 설정으로 2개까지 확장.
- SQLite write lock: 모든 DB write는 짧게 직렬화.

이 구조면 GraphRAG 인제스트 중에도 일정 조회, 파일검색 조회, 업무대화 UI 조작은 계속 가능하다. 다만 GraphRAG와 같은 지식소스의 재색인은 같은 자원 충돌로 대기한다.

---

## 4. 기능별 개선 계획

### 4.1 DB 안정화

**Files:**
- Modify: `services/sidecar/src/gongmu_sidecar/db.py`
- Test: `services/sidecar/tests/test_db_concurrency.py`

- [ ] `Database.__post_init__()`에서 `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`을 설정한다.
- [ ] `threading.RLock` 기반 write lock을 추가한다.
- [ ] `insert()`, `execute()`, `log()`, `create_approval_ticket()`의 write 구간을 lock으로 보호한다.
- [ ] `transaction()` context manager를 추가해 여러 DB write를 하나의 원자적 작업으로 묶을 수 있게 한다.
- [ ] pytest에서 10개 thread가 동시에 `execution_logs`에 쓰는 테스트를 추가한다.

검증 명령:

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_db_concurrency.py -q
```

### 4.2 범용 작업 큐 도입

**Files:**
- Create: `services/sidecar/src/gongmu_sidecar/jobs.py`
- Modify: `services/sidecar/src/gongmu_sidecar/db.py`
- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
- Test: `services/sidecar/tests/test_work_jobs.py`

- [ ] `work_jobs`, `work_job_events`, `work_job_locks` schema를 추가한다.
- [ ] `JobManager.create_job(kind, title, input, resource_key, resource_policy, priority)`를 구현한다.
- [ ] `JobManager.append_event(job_id, level, event_type, message, payload)`를 구현한다.
- [ ] `JobManager.request_cancel(job_id)`를 구현한다.
- [ ] `JobManager.recover_interrupted_jobs()`를 구현해 앱 재시작 시 running/cancel_requested 작업을 `failed` 또는 `queued`로 정리한다.
- [ ] `GET /api/jobs`, `GET /api/jobs/{job_id}`, `GET /api/jobs/{job_id}/events`, `POST /api/jobs/{job_id}/cancel`을 추가한다.
- [ ] 테스트에서 job 생성, 진행률 갱신, 이벤트 조회, 취소 요청을 검증한다.

검증 명령:

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_work_jobs.py -q
```

### 4.3 resource lock scheduler

**Files:**
- Modify: `services/sidecar/src/gongmu_sidecar/jobs.py`
- Test: `services/sidecar/tests/test_work_job_scheduler.py`

- [ ] 같은 `resource_key`와 `exclusive` 정책의 job은 동시에 running이 되지 않게 한다.
- [ ] 서로 다른 `resource_key`의 job은 동시에 running 가능하게 한다.
- [ ] lock 때문에 대기하는 job은 `blocked` 상태와 “선행 작업 완료 후 실행” 메시지를 남긴다.
- [ ] cancel된 queued/blocked job은 실행하지 않는다.
- [ ] parser/io/llm pool별 최대 동시 실행 수를 설정값으로 둔다.

검증 명령:

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_work_job_scheduler.py -q
```

### 4.4 GraphRAG 인제스트를 범용 job에 연결

**Files:**
- Modify: `services/sidecar/src/gongmu_sidecar/graphrag_ingestion.py`
- Modify: `services/sidecar/src/gongmu_sidecar/job_handlers.py`
- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
- Test: `services/sidecar/tests/test_graphrag_jobs.py`

- [ ] `/api/knowledge/ingest`, `/api/knowledge/reindex`가 `work_jobs` job도 함께 생성하게 한다.
- [ ] 기존 `knowledge_ingestion_jobs`의 상세 진행률은 유지하되 `work_jobs.progress_percent`와 동기화한다.
- [ ] 같은 지식소스의 scan/ingest/reindex는 `knowledge_source:{source_id}` exclusive lock으로 보호한다.
- [ ] 다른 기능의 quick read는 인제스트 중에도 정상 동작하게 테스트한다.
- [ ] cancel 요청은 `work_jobs.cancel_requested`와 `knowledge_ingestion_jobs.cancel_requested`에 모두 반영한다.

검증 명령:

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_graphrag_jobs.py services/sidecar/tests/test_graphrag_retrieval.py -q
```

### 4.5 파일명 인덱스 갱신 job화

**Files:**
- Modify: `services/sidecar/src/gongmu_sidecar/local_file_search.py`
- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
- Modify: `services/sidecar/src/gongmu_sidecar/job_handlers.py`
- Test: `services/sidecar/tests/test_local_file_index_jobs.py`

- [ ] `/api/files/index/rebuild`는 즉시 `job`을 반환한다.
- [ ] 실제 스캔은 `files.index.rebuild` job handler에서 실행한다.
- [ ] 기존 인덱스를 먼저 삭제하지 말고 임시 테이블 또는 batch marker를 사용해 성공 후 swap한다.
- [ ] 진행률은 root별/파일수별로 추정 표시한다.
- [ ] 검색 API는 인덱스 갱신 중에도 마지막 성공 인덱스를 사용한다.
- [ ] 사용자가 갱신을 또 누르면 같은 `local_file_index` resource lock으로 queued/blocked 안내를 준다.

검증 명령:

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_local_file_index_jobs.py -q
```

### 4.6 문서작성 job화

**Files:**
- Modify: `services/sidecar/src/gongmu_sidecar/documents.py`
- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
- Modify: `services/sidecar/src/gongmu_sidecar/job_handlers.py`
- Test: `services/sidecar/tests/test_document_generation_jobs.py`

- [ ] 문서작성 원샷 API는 `documents.generate` job을 반환한다.
- [ ] job stage를 `자료 수집`, `콘텐츠 구조화`, `HWPX 렌더링`, `파일 저장`, `완료`로 기록한다.
- [ ] 기존 승인 기반 flow는 유지하되, 업무대화에서 도구 호출할 때는 승인 없이 job으로 실행되도록 구분한다.
- [ ] 실패 시 content base id, ticket id, artifact path 중 어디까지 생성됐는지 result에 남긴다.
- [ ] 같은 content base/output은 `document_output:{content_base_id}` lock으로 보호한다.

검증 명령:

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_document_generation_jobs.py services/sidecar/tests/test_document_workflow.py -q
```

### 4.7 파일정리 적용/롤백 job화

**Files:**
- Modify: `services/sidecar/src/gongmu_sidecar/file_organizer.py`
- Modify: `services/sidecar/src/gongmu_sidecar/job_handlers.py`
- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
- Test: `services/sidecar/tests/test_file_organizer_jobs.py`

- [ ] 승인 후 적용은 `fileorg.apply` job으로 실행한다.
- [ ] 롤백은 `fileorg.rollback` job으로 실행한다.
- [ ] 복사/삭제 대상 경로는 `file_path:{normalized_path}` lock으로 보호한다.
- [ ] 파일 수와 바이트 기준 진행률을 가능한 범위에서 기록한다.
- [ ] 취소 요청 시 현재 파일 단위 작업 완료 후 중단하고 `partial` 또는 `canceled`로 남긴다.

검증 명령:

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_file_organizer_jobs.py -q
```

### 4.8 업무대화 LLM turn의 ordered job 정책

**Files:**
- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
- Modify: `services/sidecar/src/gongmu_sidecar/llm.py`
- Modify: `services/sidecar/src/gongmu_sidecar/job_handlers.py`
- Test: `services/sidecar/tests/test_work_session_turn_jobs.py`

- [ ] 같은 session의 메시지는 `work_session:{session_id}` ordered resource로 순서를 보장한다.
- [ ] 스트리밍 응답은 현재 SSE UX를 유지하되 내부적으로 `work_jobs` 상태를 함께 기록한다.
- [ ] 사용자가 같은 세션에서 두 번째 메시지를 보내면 “앞선 응답 완료 후 이어서 처리” 또는 “이전 응답 취소 후 새 질문” 중 하나를 선택할 수 있게 API 상태를 제공한다.
- [ ] GraphRAG 검색, 일정 등록, 문서작성 도구 호출은 LLM 일반 답변보다 먼저 skill routing으로 실행하고 job event에 남긴다.
- [ ] LLM timeout/실패는 `failed` assistant message와 job event 양쪽에 남긴다.

검증 명령:

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_work_session_turn_jobs.py services/sidecar/tests/test_work_session_turn.py -q
```

### 4.9 프론트엔드 작업센터와 부분 pending 상태

**Files:**
- Modify: `apps/desktop/src/api.ts`
- Modify: `apps/desktop/src/app.tsx`
- Create or Modify: `apps/desktop/src/job-center.test.tsx`
- Modify: `apps/desktop/src/knowledge-sources.test.tsx`
- Modify: `apps/desktop/src/local-file-search.test.tsx`

- [ ] `api.ts`에 `WorkJob`, `WorkJobEvent`, `listJobs`, `cancelJob`, `listJobEvents` 타입과 함수를 추가한다.
- [ ] `app.tsx`의 전역 `submitting` 의존을 줄이고 `pendingActions: Record<string, boolean>`로 전환한다.
- [ ] 우측 패널에 `작업 진행` 섹션을 추가한다.
- [ ] 작업 진행 섹션에는 실행 중/대기 중/실패/부분완료 job, progress bar, 최근 이벤트, 취소 버튼을 표시한다.
- [ ] 기능별 버튼은 동일 자원 충돌일 때만 비활성화한다.
- [ ] job 생성 API 응답을 받으면 즉시 작업센터를 열고, 중앙 화면은 계속 사용할 수 있게 한다.
- [ ] polling은 1초 간격으로 시작하고, 추후 SSE로 교체할 수 있게 `refreshJobsOnly()`로 분리한다.

검증 명령:

```powershell
npm.cmd run desktop:test -- --run apps/desktop/src/job-center.test.tsx apps/desktop/src/knowledge-sources.test.tsx apps/desktop/src/local-file-search.test.tsx
```

### 4.10 복구와 스트레스 테스트

**Files:**
- Create: `services/sidecar/tests/test_work_job_recovery.py`
- Create: `services/sidecar/tests/test_concurrent_user_flows.py`
- Modify: `docs/operations/2026-05-21-feedback-3-validation-report.md`

- [ ] running job이 남아 있는 DB로 앱을 시작하면 recovery 정책이 적용되는지 검증한다.
- [ ] GraphRAG 인제스트 중 파일명 검색, 일정 생성, 업무대화 quick skill이 동작하는지 검증한다.
- [ ] 파일 인덱스 갱신 중 검색 API가 마지막 성공 인덱스를 반환하는지 검증한다.
- [ ] 문서작성 job 실패 시 사용자에게 단계별 실패 원인이 보이는지 검증한다.
- [ ] 동일 session에 빠른 연속 메시지를 보내도 assistant message 순서가 보존되는지 검증한다.

검증 명령:

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_work_job_recovery.py services/sidecar/tests/test_concurrent_user_flows.py -q
```

---

## 5. UI/UX 정책

### 5.1 사용자가 보게 될 변화

- 긴 작업 버튼을 누르면 즉시 “작업이 시작되었습니다”가 보인다.
- 우측 패널에서 작업 진행률, 현재 단계, 최근 로그, 취소 버튼을 볼 수 있다.
- 충돌 작업은 fetch fail 대신 “이미 같은 지식폴더를 색인 중입니다. 대기열에 넣었습니다.”처럼 설명된다.
- 다른 메뉴로 이동해도 작업 진행은 유지된다.
- 앱 재시작 후에도 실패/중단/부분완료 상태를 확인할 수 있다.

### 5.2 버튼 비활성화 기준

전역 비활성화를 금지한다.

- 지식소스 A 인제스트 중: 지식소스 A 재스캔/재색인만 잠금
- 지식소스 A 인제스트 중: 일정, 업무대화, 파일검색 조회, 문서작성 입력은 가능
- 파일명 인덱스 갱신 중: 인덱스 갱신 버튼만 대기/취소 상태로 변경
- 문서 생성 중: 같은 문서의 최종 저장만 잠금
- 같은 업무대화 세션 응답 중: 같은 세션의 다음 메시지는 queue/cancel 선택 제공

---

## 6. 단계별 도입 순서

### Phase 1: 안정성 기반

1. DB write lock/WAL/transaction을 먼저 적용한다.
2. 범용 job schema와 job API를 추가한다.
3. frontend는 읽기 전용 작업센터부터 붙인다.

### Phase 2: 가장 긴 작업부터 이전

1. GraphRAG 인제스트를 `work_jobs`와 연결한다.
2. 파일명 인덱스 갱신을 job화한다.
3. 지식폴더/파일찾기 UI에서 전역 blocking을 제거한다.

### Phase 3: 사용자 체감 실패가 큰 작업 이전

1. 문서작성 HWPX 생성을 job화한다.
2. 파일정리 적용/롤백을 job화한다.
3. 실패 단계와 복구 정보를 우측 패널에 표시한다.

### Phase 4: 업무대화 동시성 정리

1. 같은 세션의 LLM turn 순서를 ordered job으로 보장한다.
2. GraphRAG/일정/문서작성 skill 호출을 job event로 남긴다.
3. “이전 응답 취소 후 새 질문” UX를 추가한다.

### Phase 5: 운영 검증

1. 동시작업 스트레스 테스트를 추가한다.
2. 컴퓨터유즈 기반 수동 시나리오를 갱신한다.
3. 폐쇄망 패키지 smoke 전 작업 복구/진행률 확인을 포함한다.

---

## 7. 최종 검증 게이트

기능 구현 후 아래 명령을 fresh로 통과해야 한다.

```powershell
npm.cmd run sidecar:test
npm.cmd run desktop:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
npm.cmd run desktop:build
```

대규모 작업 큐 변경이므로 배포 전에는 추가로 다음 수동/자동 시나리오를 확인한다.

- GraphRAG 인제스트 실행 중 파일검색, 일정 등록, 업무대화 화면 이동이 가능하다.
- 같은 지식소스에 재색인을 다시 요청하면 fetch fail이 아니라 대기/충돌 안내가 보인다.
- 파일명 인덱스 갱신 중 앱을 새로고침해도 작업센터에서 상태가 복구된다.
- 문서작성 job 실패 시 어느 단계에서 실패했는지 보인다.
- 같은 업무대화 세션에 연속 질문 시 응답 순서가 꼬이지 않는다.
- 업무엔진 재시작 후 running job이 정리되고 사용자가 후속 조치를 알 수 있다.

---

## 8. 실행 판단

이 개선은 기능 추가라기보다 Gongmu가 “업무 운영체계”처럼 느껴지게 만드는 기반 공사다. 특히 지식폴더 인제스트, 파일찾기 색인, 업무대화 LLM, 문서작성 HWPX, 파일정리가 모두 장기 작업을 만들 수 있으므로, 지금 시점에서 작업 큐/작업센터를 도입하는 것이 맞다.

권장 구현 순서는 `DB 안정화 -> 범용 job core -> GraphRAG/파일색인 이전 -> 문서작성/파일정리 이전 -> 업무대화 ordered job -> UI polish`다. 이렇게 가면 현재 사용 중인 기능을 한꺼번에 깨지 않고, 사용자 체감이 큰 병목부터 단계적으로 줄일 수 있다.
