# 라우팅/메타 프롬프트 및 멀티태스크 실행 개선 결과보고

작성일: 2026-05-23

## 1. 목적

`2026-05-22-chat-tool-routing-and-meta-prompt-analysis.md`와
`2026-05-22-multi-task-execution-architecture-plan.md`에서 도출한 개선사항 중,
사용자 체감 실패가 큰 장시간 작업 상태 표시, DB 동시성, 문서작성/GraphRAG/파일 인덱스의 작업 추적을 우선 구현하고 검증했다.

## 2. 완료한 개선

- SQLite 연결에 WAL, busy timeout, write lock, transaction context manager를 적용했다.
- 범용 작업 테이블 `work_jobs`, `work_job_events`, `work_job_locks`를 추가했다.
- `JobManager`를 추가해 작업 생성, 진행률 갱신, 완료/실패/취소 요청, 이벤트 조회, 재시작 시 running 작업 복구를 처리한다.
- `/api/jobs`, `/api/jobs/{job_id}`, `/api/jobs/{job_id}/events`, `/api/jobs/{job_id}/cancel` API를 추가했다.
- 파일명 인덱스 갱신을 `files.index.rebuild` 작업으로 기록한다.
- GraphRAG 인제스트/강제 재색인을 `knowledge.ingest`/`knowledge.reindex` 작업으로 기록한다.
- 문서작성 one-shot 생성과 업무대화 문서작성 스킬 실행을 `documents.generate` 작업으로 기록한다.
- 파일정리 승인 후 적용/되돌리기를 `fileorg.apply`, `fileorg.rollback` 작업으로 기록한다.
- 업무대화 turn을 `work_session.turn` 작업으로 기록하고, 같은 세션의 동시 응답은 `work_session:{session_id}` exclusive lock으로 보호한다.
- 같은 업무대화 세션에서 앞선 응답이 진행 중이면 LLM을 중복 호출하지 않고 작업 진행 패널 확인/취소 안내를 반환한다.
- 명확한 복합 요청은 경량 intent planner가 `intent.plan -> 일정/지식검색/문서작성` 순서로 실행한다.
- 우측 패널에 `작업 진행` 섹션을 추가해 작업명, 단계, 상태, 진행률, 작업 ID, 자원 키, 취소 버튼을 표시한다.
- 우측 `작업 진행` 카드에서 작업 이벤트 로그를 펼쳐볼 수 있게 했다.
- 파일 인덱스처럼 빠르게 끝나는 작업도 즉시 우측 작업 진행 패널에 반영되도록 프론트 스냅샷 갱신을 보강했다.
- 토스트 자동삭제 타이머를 언마운트 시 정리해 테스트 종료 후 unhandled timer 오류가 남지 않도록 했다.

## 3. 검증 기준과 결과

| 기준 | 결과 |
| --- | --- |
| DB 동시 write가 `cannot commit` 계열 오류 없이 처리된다 | `services/sidecar/tests/test_db_concurrency.py` 통과 |
| 범용 job API가 생성/진행률/이벤트/취소/복구를 처리한다 | `services/sidecar/tests/test_work_jobs.py` 통과 |
| 파일명 인덱스 갱신이 작업으로 기록된다 | sidecar 테스트 및 Browser 검증 통과 |
| GraphRAG 인제스트가 범용 작업 ID를 함께 반환한다 | sidecar 테스트 통과 |
| 문서작성 API와 업무대화 문서작성 스킬이 작업 상태를 남긴다 | sidecar 테스트 통과 |
| 파일정리 적용/되돌리기가 작업 상태를 남긴다 | sidecar 및 desktop 테스트 통과 |
| 같은 업무대화 세션의 동시 응답이 ordered job으로 보호된다 | sidecar 테스트 통과 |
| 다중도구 요청이 첫 번째 기능에서 멈추지 않고 순차 실행된다 | sidecar 테스트 통과 |
| 업무대화에서 일정 등록과 GraphRAG 검색이 한 요청 안에서 순차 실행되고 결과가 사용자 화면에 보인다 | Browser 검증 통과 |
| 우측 작업 진행 카드에서 상세 이벤트 로그를 펼쳐볼 수 있다 | desktop 테스트 통과 |
| 우측 패널에서 작업 진행률과 완료/부분완료 상태, `work_session`/`local_file_index` 자원 키가 보인다 | Browser 검증 통과 |
| 프론트 전체 회귀 테스트가 통과한다 | `npm.cmd run desktop:test`: 20 files, 72 tests passed |
| 프론트 production build가 통과한다 | `npm.cmd --workspace apps/desktop run build` 통과 |
| Tauri Rust 체크가 통과한다 | `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` 통과 |
| 백엔드 전체 테스트가 통과한다 | `npm.cmd run sidecar:test`: 209 passed |

## 4. 컴퓨터유즈 기반 확인

검증 URL: `http://localhost:5173`

확인 흐름:

### 4.1 파일 인덱스 작업 진행 표시

1. 앱을 열고 `파일찾기` 화면으로 이동했다.
2. `파일명 인덱스 갱신`을 눌렀다.
3. 중앙 화면에서 인덱스 진행/부분 완료 메시지가 표시되는지 확인했다.
4. 우측 `작업 진행` 패널에서 `파일명 인덱스 갱신`, `부분 완료`, `100%`, 작업 ID, `local_file_index` 자원 키가 보이는지 확인했다.

### 4.2 업무대화 다중도구 라우팅과 작업 로그

1. 업무대화 세션 `멀티태스크 라우팅 검증`에 테스트 요청을 입력했다.
   - 요청: `내일 오후 3시 라우팅 재검증 회의 일정 등록하고 지식폴더에서 안전 프롬프트 관련 자료 찾아줘`
2. 응답이 일반 LLM 답변으로 빠지지 않고 `intent.plan -> schedule.create -> knowledge.search` 순서로 처리되는지 확인했다.
3. 중앙 대화 화면에 `요청을 여러 작업으로 나누어 순서대로 처리했습니다`, `일정 등록`, `GraphRAG 검색 결과입니다`가 표시되는지 확인했다.
4. 우측 `작업 진행` 패널에서 `work_session:{session_id}` 자원 키와 `100%` 완료 상태가 보이는지 확인했다.
5. `작업 로그 보기`를 눌러 `job.created -> job.started -> job.progress -> job.succeeded` 이벤트가 펼쳐지는지 확인했다.

참고: 현재 인앱 브라우저의 직접 타이핑은 Browser Use virtual clipboard가 설치되지 않아 자동 입력 대신 API로 실제 업무대화 턴을 주입했고, 결과 표시는 인앱 브라우저에서 직접 확인했다. 앱 기능 검증에는 같은 sidecar/API 경로와 동일한 UI 렌더링을 사용했다.

증거 스크린샷:

`docs/operations/2026-05-23-work-job-panel-browser-validation.png`

`docs/operations/2026-05-23-routing-multitask-browser-validation-selected.png`

`docs/operations/2026-05-23-routing-multitask-browser-validation-job-events.png`

## 5. 남은 후속 작업

이번 작업은 계획서의 핵심 기반과 사용자 체감이 큰 파일 인덱스/GraphRAG/문서작성/파일정리/업무대화 작업 표시까지 마감했다.
다만 계획서 전체 기준으로는 아래 항목이 다음 단계로 남아 있다.

- parser/io/llm pool별 최대 동시 실행 수를 설정값으로 노출하는 운영 정책은 아직 문서 수준이다.
- blocked 작업의 자동 재개는 resource lock 해제 시 queued 전환까지 구현했지만, 모든 장기 작업을 별도 worker가 백그라운드에서 자동 실행하는 구조는 다음 단계다.
- 다중도구 intent planner는 규칙 기반으로 도입했다. 규칙에 걸리지 않는 애매한 복합 요청을 LLM classifier에 맡기는 단계는 후속 작업이다.
