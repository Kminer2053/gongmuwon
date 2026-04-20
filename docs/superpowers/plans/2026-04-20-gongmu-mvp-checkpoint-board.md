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
- 문서작성 시 `ContentBase.md + preview.html` 생성
- 문서작성 최종 저장 승인 요청/적용 시 `outputs/` Markdown 산출물 생성 및 execution log / DB persist 연결
- 데스크톱 셸에서 주요 메뉴 순서와 기본 입력/조회 흐름 구현

### 2026-04-20 기준 검증 완료 증거

| 영역 | 명령 | 결과 |
| --- | --- | --- |
| Sidecar API | `npm run sidecar:test` | `9 passed` |
| Sidecar settings contract | `.venv/bin/pytest services/sidecar/tests/test_bootstrap.py::test_settings_endpoint_exposes_runtime_contract -v` | `PASS` |
| Sidecar env override | `.venv/bin/pytest services/sidecar/tests/test_bootstrap.py::test_settings_endpoint_honors_env_overrides -q` | `PASS` |
| Desktop UI | `npm --workspace apps/desktop run test` | `4 passed` |
| Desktop build | `npm --workspace apps/desktop run build` | 성공 |
| Verify bundle | `npm run verify:all` | PASS |
| Tauri shell | `source "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | 성공 |

### 아직 비어 있는 핵심 구간

- Tauri 앱이 사이드카를 직접 띄우고 상태를 감시하는 런타임 연결
- 지식 검색 결과와 그래프 요약을 데스크톱 UI에서 직접 탐색하는 패널
- 파일정리 제안의 실제 적용 / 거절 / rollback 흐름
- 정적 카드가 아닌 `Tool Manifest`, 설정 정책, 운영 런북

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
| W2 | 지식폴더 MVP | 부분 완료 | 후보 생성/승인/페이지 생성/그래프 산출 | API 테스트 통과, UI 일부 구현 |
| W3 | 검색 연계 | 부분 완료 | Anything 실행 요청과 승인 큐 등록 | API/UI 구현, 실제 외부 실행 미적용 |
| W4 | 문서작성 MVP | 완료 | ContentBase 생성/미리보기/최종 저장 승인 및 outputs 생성 가능 | API + UI + build + verify:all 통과 |
| W5 | 파일정리 + 지식화 루프 | 부분 완료 | 제안 생성/조회 가능 | API 구현, apply/rollback 미구현 |
| W6 | 그래프 보조 탐색 | 부분 완료 | graph 산출물 생성 | UI 탐색 미구현 |
| W7 | 설치/운영 안정화 | 미착수 | dev/runbook/offline 정책/패키징 | 없음 |

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

### 이슈 / 결정 로그

| 날짜 | 유형 | 내용 | 후속 액션 |
| --- | --- | --- | --- |
| 2026-04-20 | 결정 | 지식 정본은 `Obsidian-compatible Markdown Vault` 유지 | UI와 검색도 이 구조에 맞춰 확장 |
| 2026-04-20 | 결정 | 검색은 `Anything` 외부 실행 연계만 유지 | ETP/깊은 통합은 후속 단계로 보류 |
| 2026-04-20 | 이슈 | Tauri 빌드가 기본 아이콘 부재로 실패 | `src-tauri/icons/icon.png` 보강 완료 |
| 2026-04-20 | 결정 | 런타임 설정은 sidecar `/api/settings` 단일 계약으로 제공 | desktop snapshot과 settings panel이 이 계약을 소비 |
| 2026-04-20 | 결정 | `/api/settings`는 typed response model + desktop runtime guard + env override test로 hardening | contract drift를 낮추고 verification bundle에서 반복 검증 |
| 2026-04-20 | 결정 | 문서 최종 저장은 approval-ticket 기반 request/apply + outputs/ Markdown artifact로 처리 | sidecar/desktop/UI 검증 범위를 이 경로로 고정 |

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

1. 설정/런타임 계약
2. 문서 최종 저장 승인
3. 지식 검색/그래프 패널
4. 파일정리 apply/rollback
5. Tool Manifest + 운영 런북
