# 공무 MVP Checkpoint Board

## 1. 현재 상태 요약

### 현재까지 완료된 것

- `apps/desktop`: `Tauri 2 + React + TypeScript` 기반 데스크톱 셸 생성
- `services/sidecar`: `FastAPI + SQLite + LanceDB + NetworkX` 기반 사이드카 생성
- `runtime-workspace` 기본 구조 자동 생성
- `services/sidecar`: `/api/settings` runtime settings contract 추가
- `services/sidecar`: `/api/settings` typed response model + env override verification 추가
- `apps/desktop`: live settings snapshot 로딩 및 settings panel 표시 연결
- `apps/desktop`: runtime parser/guard for `WorkspaceSettings` 추가
- 일정 / 업무세션 / 참고자료 묶음 / 지식 반영 후보 / 콘텐츠 베이스 / 승인 요청 / 파일정리 제안 API 골격 구현
- 지식 반영 시 `Markdown page + graph.json + graph.html + GRAPH_REPORT.md` 생성
- 지식 검색과 그래프 요약을 sidecar API + desktop 패널에서 직접 탐색 가능
- 문서작성 시 `ContentBase.md + preview.html` 생성
- 문서작성 최종 저장 승인 요청/적용 시 `outputs/` Markdown 산출물 생성 및 execution log / DB persist 연결
- 문서작성 최종 저장 UI의 `요청 -> 승인 -> 적용` 흐름 테스트 보강 완료
- Windows 대상 최종 산출물 파일명 안전화 및 회귀 테스트 추가
- 파일정리 제안의 승인 요청, 적용, rollback API와 데스크톱 액션 연결 완료
- `services/sidecar`: `/api/tools` Tool Manifest와 `services/sidecar/README.md` 운영 런북 추가
- `apps/desktop`: 도구 화면이 하드코딩 카드 대신 Tool Manifest 응답을 표시하도록 전환
- `apps/desktop/src-tauri`: sidecar runtime status 조회 + 수동 시작 command 추가
- `apps/desktop`: 헤더 runtime badge, `사이드카 시작` 버튼, log path hint 추가
- 데스크톱 셸에서 주요 메뉴 순서와 기본 입력/조회 흐름 구현

### 2026-04-20 기준 검증 완료 증거

| 영역 | 명령 | 결과 |
| --- | --- | --- |
| Sidecar API | `npm run sidecar:test` | `13 passed` |
| Sidecar settings contract | `.venv/bin/pytest services/sidecar/tests/test_bootstrap.py::test_settings_endpoint_exposes_runtime_contract -v` | `PASS` |
| Sidecar env override | `.venv/bin/pytest services/sidecar/tests/test_bootstrap.py::test_settings_endpoint_honors_env_overrides -q` | `PASS` |
| Desktop UI | `npm --workspace apps/desktop run test` | `7 passed` |
| Desktop build | `npm --workspace apps/desktop run build` | 성공 |
| Verify bundle | `npm run verify:all` | PASS |
| Tauri shell | `source "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | 성공 |

### 아직 비어 있는 핵심 구간

- sidecar 종료/재시작을 포함한 lifecycle 관리
- 오프라인 설치 패키징과 운영 정책 문서화

---

## 2. 현재 산출물 지도

| 분류 | 파일 | 역할 | 상태 |
| --- | --- | --- | --- |
| 운영 규칙 | `/Users/hoonsbook/Agent_Gongmu_Codex/AGENTS.md` | 에이전트 작업 모델과 도구 선택 기준 | 활성 |
| 제품 마스터 플랜 | `/Users/hoonsbook/Agent_Gongmu_Codex/docs/superpowers/plans/2026-04-19-gongmu-agent-workspace-master-plan.md` | 장기 제품 구조와 아키텍처 기준 | 기준 문서 |
| 통합 제품 계획 | `/Users/hoonsbook/Agent_Gongmu_Codex/계획서/공무_개발계획서_최종통합판_v2.md` | 제품 전략과 기술 선택 통합안 | 기준 문서 |
| 체크포인트 보드 | `/Users/hoonsbook/Agent_Gongmu_Codex/docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md` | 진행 상황, 검증 증거, 중간 점검 기준 | 신규 |
| 남은 구현 계획 | `/Users/hoonsbook/Agent_Gongmu_Codex/docs/superpowers/plans/2026-04-20-gongmu-mvp-remaining-implementation-plan.md` | 남은 MVP 작업의 실행 소스 오브 트루스 | 신규 |

---

## 3. 워크스트림 보드

| ID | 워크스트림 | 상태 | 종료 기준 | 증거 |
| --- | --- | --- | --- | --- |
| W0 | 플랫폼 골격 | 완료 | 셸/DB/로그/승인 구조가 뜬다 | 테스트 + 빌드 통과 |
| W1 | 일정 + 업무대화 + 참고자료 | 완료 | 일정, 세션, ReferenceSet 생성/조회 가능 | API 테스트 통과 |
| W2 | 지식폴더 MVP | 완료 | 후보 생성/승인/페이지 생성/그래프 산출 | API + UI + search/graph inspector 검증 통과 |
| W3 | 검색 연계 | 부분 완료 | Anything 실행 요청과 승인 큐 등록 | API/UI 구현, 실제 외부 실행 미적용 |
| W4 | 문서작성 MVP | 완료 | ContentBase 생성/미리보기/최종 저장 승인 및 outputs 생성 가능 | API + UI + spec/quality review + targeted verification 통과 |
| W5 | 파일정리 + 지식화 루프 | 완료 | 제안 생성/조회/적용/rollback 가능 | sidecar workflow test + desktop action 연결 완료 |
| W6 | 그래프 보조 탐색 | 완료 | graph 산출물 생성 + search/graph inspector UI 동작 | sidecar + desktop 테스트 통과 |
| W7 | 설치/운영 안정화 | 부분 완료 | runtime badge/manual start, dev/runbook/tool manifest 정리 | README + /api/tools + Tauri command |

---

## 4. 다음 구현 게이트

### Gate A — Alpha 운영 연결

- 목표: 데스크톱 셸에서 사이드카 설정, 상태, 툴 목록, 승인 큐가 일관되게 보인다.
- 포함:
  - `/api/settings`
  - Tool Manifest API
  - Desktop 설정 패널 실데이터 연결
  - 전체 검증 스크립트

### Gate B — 문서 산출 닫기

- 목표: `ContentBase -> 최종 저장 요청 -> 승인 -> outputs/` 생성까지 닫힌다.
- 포함:
  - 최종 출력물 저장 승인
  - 출력물 metadata/log 기록
  - 문서작성 UI의 최종 저장 액션
  - 완료: sidecar request/apply route, DB persist, desktop request/apply UI, verify bundle 통과

### Gate C — 지식/파일 정리 실사용화

- 목표: 지식 검색/그래프 보기와 파일정리 apply/rollback이 실제로 동작한다.
- 포함:
  - 지식 검색/그래프 엔드포인트 보강
  - 파일정리 제안 적용/되돌리기
  - 승인/실행기록 연결

---

## 5. 중간 점검 규칙

### 각 Task 종료 시 반드시 갱신할 항목

1. 이 문서의 `워크스트림 보드` 상태
2. 아래 `최근 검증 결과`
3. `이슈/결정 로그`

### 최근 검증 결과

| 날짜 | 범위 | 명령 | 결과 | 메모 |
| --- | --- | --- | --- | --- |
| 2026-04-20 | baseline | `npm run sidecar:test` | PASS | `8 passed` |
| 2026-04-20 | task1 | `.venv/bin/pytest services/sidecar/tests/test_bootstrap.py::test_settings_endpoint_exposes_runtime_contract -v` | PASS | `/api/settings` runtime contract verified |
| 2026-04-20 | task1 | `.venv/bin/pytest services/sidecar/tests/test_bootstrap.py::test_settings_endpoint_honors_env_overrides -q` | PASS | `GONGMU_*` overrides verified |
| 2026-04-20 | baseline | `npm --workspace apps/desktop run test` | PASS | `3 passed` |
| 2026-04-20 | baseline | `npm --workspace apps/desktop run build` | PASS | Vite build 성공 |
| 2026-04-20 | task1 | `npm run verify:all` | PASS | sidecar, desktop, build, cargo check 일괄 통과 |
| 2026-04-20 | baseline | `source "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS | 아이콘 자산 보정 후 통과 |
| 2026-04-20 | task2 | `.venv/bin/pytest services/sidecar/tests/test_api_flows.py::test_document_finalize_requires_approval_and_creates_output -v` | PASS | finalize/apply sidecar flow verified |
| 2026-04-20 | task2 | `.venv/bin/pytest services/sidecar/tests -q` | PASS | `9 passed` |
| 2026-04-20 | task2 | `npm --workspace apps/desktop run test` | PASS | `4 passed` |
| 2026-04-20 | task2 | `npm --workspace apps/desktop run build` | PASS | desktop bundle rebuilt successfully |
| 2026-04-20 | task2 | `npm run verify:all` | PASS | sidecar, desktop, build, cargo check 일괄 통과 |
| 2026-04-20 | task2-review | `npm --workspace apps/desktop run test -- src/app.test.tsx` | PASS | finalize request/approval/apply UI flow exercised |
| 2026-04-20 | task2-review | `.venv/bin/pytest services/sidecar/tests/test_api_flows.py::test_document_finalize_sanitizes_windows_invalid_output_name -q` | PASS | Windows invalid filename regression fixed |
| 2026-04-20 | task2-review | `.venv/bin/pytest services/sidecar/tests -q` | PASS | `10 passed` |
| 2026-04-20 | task2-review | `git diff --check 321eb20..f682654` | PASS | whitespace / conflict marker issues 없음 |
| 2026-04-20 | task3 | `.venv/bin/pytest services/sidecar/tests/test_knowledge_search.py -q` | PASS | knowledge search + graph summary endpoint verified |
| 2026-04-20 | task3 | `.venv/bin/pytest services/sidecar/tests -q` | PASS | `11 passed` |
| 2026-04-20 | task3 | `npm --workspace apps/desktop run test -- src/app.test.tsx` | PASS | knowledge inspector UI + existing shell flows verified |
| 2026-04-20 | task3 | `npm --workspace apps/desktop run test` | PASS | `5 passed` |
| 2026-04-20 | task3 | `npm --workspace apps/desktop run build` | PASS | desktop bundle rebuilt with graph inspector panel |
| 2026-04-20 | task4 | `.venv/bin/pytest services/sidecar/tests/test_file_organizer_apply.py -q` | PASS | file organizer request/apply/rollback workflow verified |
| 2026-04-20 | task4 | `.venv/bin/pytest services/sidecar/tests -q` | PASS | `12 passed` |
| 2026-04-20 | task4 | `npm --workspace apps/desktop run test` | PASS | `5 passed` |
| 2026-04-20 | task4 | `npm --workspace apps/desktop run build` | PASS | desktop bundle rebuilt with file organizer actions |
| 2026-04-20 | task3-review | `.venv/bin/pytest services/sidecar/tests/test_knowledge_search.py -q` | PASS | graph summary edge/artifact contract tightened |
| 2026-04-20 | task3-review | `.venv/bin/pytest services/sidecar/tests -q` | PASS | `12 passed` after graph summary fix |
| 2026-04-20 | verification | `npm run verify:all` | PASS | sidecar, desktop, build, cargo check 일괄 재검증 완료 |
| 2026-04-20 | task5 | `.venv/bin/pytest services/sidecar/tests/test_bootstrap.py::test_tools_manifest_endpoint_is_exposed -q` | PASS | `/api/tools` Tool Manifest contract verified |
| 2026-04-20 | task5 | `npm --workspace apps/desktop run test -- src/app.test.tsx` | PASS | 도구 메뉴가 manifest 기반 데이터를 렌더링함 |
| 2026-04-20 | task5 | `npm run verify:all` | PASS | sidecar `13 passed`, desktop `6 passed`, build + cargo check 포함 |
| 2026-04-20 | runtime-bridge | `npm --workspace apps/desktop run test -- src/app.test.tsx` | PASS | runtime badge + manual sidecar start UI flow verified |
| 2026-04-20 | runtime-bridge | `npm run verify:all` | PASS | sidecar `13 passed`, desktop `7 passed`, build + cargo check 포함 |

### 이슈 / 결정 로그

| 날짜 | 유형 | 내용 | 후속 액션 |
| --- | --- | --- | --- |
| 2026-04-20 | 결정 | 지식 정본은 `Obsidian-compatible Markdown Vault` 유지 | UI와 검색도 이 구조에 맞춰 확장 |
| 2026-04-20 | 결정 | 검색은 `Anything` 외부 실행 연계만 유지 | ETP/깊은 통합은 후속 단계로 보류 |
| 2026-04-20 | 이슈 | Tauri 빌드가 기본 아이콘 부재로 실패 | `src-tauri/icons/icon.png` 보강 완료 |
| 2026-04-20 | 결정 | 런타임 설정은 sidecar `/api/settings` 단일 계약으로 제공 | desktop snapshot과 settings panel이 이 계약을 소비 |
| 2026-04-20 | 결정 | `/api/settings`는 typed response model + desktop runtime guard + env override test로 hardening | contract drift를 낮추고 verification bundle에서 반복 검증 |
| 2026-04-20 | 결정 | 문서 최종 저장은 approval-ticket 기반 request/apply + outputs/ Markdown artifact로 처리 | sidecar/desktop/UI 검증 범위를 이 경로로 고정 |
| 2026-04-20 | 이슈 | 문서 최종 저장 UI 테스트가 승인 이후 apply 호출까지 닿지 않음 | `f4dbe84`에서 apply 버튼 클릭/endpoint/assertion으로 보강 완료 |
| 2026-04-20 | 이슈 | Windows에서 금지 문자가 포함된 출력 이름은 최종 저장 실패 가능 | `f682654`에서 파일명 안전화 + 회귀 테스트 추가 완료 |
| 2026-04-20 | 이슈 | `KnowledgeManager._table()`가 LanceDB `list_tables()` 응답 객체를 plain list처럼 검사해 기존 테이블을 다시 생성하려고 함 | `.tables` 기준으로 확인하도록 수정하고 Task 3 search/graph 테스트로 회귀 방지 |
| 2026-04-20 | 이슈 | `graph.json`은 `edges`를 쓰는데 graph summary는 `links`만 읽어 `edge_count`를 0으로 보고함 | `edges` 우선, `links` fallback으로 수정하고 artifact contract assertion으로 회귀 방지 |
| 2026-04-20 | 결정 | 파일정리는 자동 실행이 아니라 `적용 요청 -> 승인 -> 적용 -> rollback`의 보수적 흐름으로 유지 | 삭제 대신 copy 기반 operation 로그를 남기고 되돌리기를 허용 |
| 2026-04-20 | 결정 | 도구 화면은 하드코딩 카드 대신 sidecar Tool Manifest를 단일 진실원천으로 사용 | README 런북과 `/api/tools`를 함께 갱신하는 방식으로 운영 |
| 2026-04-20 | 결정 | Tauri-sidecar 1차 연결은 `상태 감지 + 수동 시작 + 로그 경로 노출`까지만 구현 | 자동 시작보다 디버깅과 내부망 운영 추적을 우선하고 lifecycle 관리는 다음 단계로 분리 |

---

## 6. 작업 리듬 제안

### 하루 단위

- 오전: 1개 Task 구현
- 오후: 검증, 체크포인트 보드 갱신, 다음 Task 착수 여부 결정

### Task 단위

- 테스트 작성
- 실패 확인
- 최소 구현
- 테스트/빌드 재검증
- 체크포인트 보드 갱신

### 다음 우선순위

1. sidecar lifecycle 정리와 재시작 정책
2. 오프라인 패키징/운영 정책 정리
