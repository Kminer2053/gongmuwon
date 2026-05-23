# 전기능 통합테스트 및 사용자 경험 검증 결과보고

작성일: 2026-05-23
검증 목적: `2026-05-23-full-system-integration-test-scenarios.md`에 정의한 관점으로 실제 앱 흐름을 확인하고, 릴리스 전 개선방안을 도출한다.

---

## 1. 검증 방식

검증은 두 층으로 수행했다.

1. API 기반 실제 기능 실행
   - 일정 생성
   - 업무대화 세션 생성
   - 세션-파일 연결
   - 지식폴더 등록/스캔/GraphRAG 인덱싱
   - 파일찾기 검색
   - HWPX 문서작성
   - 업무대화 복합 요청 라우팅
   - 작업 큐/작업 로그 조회
2. Codex in-app Browser 기반 사용자 화면 확인
   - 앱 shell
   - 업무대화 세션 목록
   - 우측 작업 진행 패널
   - 작업 이벤트 로그
   - 일정/파일찾기/내 지식폴더/문서작성/환경설정 화면 전환

참고: 현재 인앱 브라우저의 직접 타이핑 자동화는 Browser Use virtual clipboard가 설치되지 않아 제한된다. 따라서 입력 자체는 API로 실제 업무엔진 endpoint를 호출했고, 결과가 사용자 화면에 어떻게 보이는지는 Browser로 확인했다.

---

## 2. API 검증 결과 요약

증거 파일:

- `docs/operations/2026-05-23-full-system-integration-api-evidence.json`
- `docs/operations/2026-05-23-full-system-integration-api-evidence-utf8.json`

주요 결과:

| 항목 | 결과 |
| --- | --- |
| 업무대화 세션 생성 | 성공 |
| 일정 생성 및 세션 연결 | 성공 |
| 세션-파일 연결 | 2개 파일 연결 성공 |
| 지식폴더 등록/스캔 | 성공 |
| GraphRAG 인덱싱 | `completed` |
| 파일찾기 검색 | `integration_meeting_notes.txt` 검색 성공 |
| HWPX 문서작성 | `full-system-integration-review-utf8-one-page.hwpx` 생성 성공 |
| 업무대화 복합 라우팅 | `intent.plan`, `schedule.create`, `knowledge.search` 실행 성공 |
| 작업 진행 기록 | `work_session.turn`, `documents.generate`, `knowledge.ingest`, `files.index.rebuild` 표시 |

생성된 대표 산출물:

```text
C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\documents\outputs\full-system-integration-review-utf8-one-page.hwpx
```

---

## 3. Browser 검증 결과 요약

증거 스크린샷:

- `docs/operations/assets/2026-05-23-full-system-korean-title-check.png`
- `docs/operations/assets/2026-05-23-full-system-03-job-events.png`
- `docs/operations/assets/2026-05-23-full-system-04-menu-일정.png`
- `docs/operations/assets/2026-05-23-full-system-04-menu-파일찾기.png`
- `docs/operations/assets/2026-05-23-full-system-04-menu-내-지식폴더.png`
- `docs/operations/assets/2026-05-23-full-system-04-menu-문서작성.png`
- `docs/operations/assets/2026-05-23-full-system-04-menu-기타-환경설정.png`

확인한 화면 상태:

| 화면 | 결과 |
| --- | --- |
| 상단 shell | 제품명, 설명, 현재 기능 pill, 배율 조절, 새로고침, 우측 패널, 업무엔진 신호등 표시 |
| 업무대화 | 세션 rail 유지, 연결 일정/파일 버튼 표시, 채팅 입력창 표시 |
| 우측 작업 진행 | 최근 작업, 작업 ID, 자원 키, 진행률, 완료 상태 표시 |
| 작업 이벤트 로그 | `job.created -> job.started -> job.progress -> job.succeeded` 펼쳐보기 확인 |
| 일정 | `업무일정 캘린더` 화면 전환 확인 |
| 파일찾기 | `파일찾기` 화면 전환 및 검색/인덱스 영역 확인 |
| 내 지식폴더 | `그래프RAG로 지식관리` 화면 전환 확인 |
| 문서작성 | HWPX 문서작성 화면 전환 확인 |
| 환경설정 | 외부 모델, API key, 저장 프로필 영역 확인 |

한국어 표시 확인:

- UTF-safe 방식으로 생성한 `전기능 통합검증 세션 정상표기`는 좌측 세션 목록과 중앙 제목에서 정상 표시됐다.
- PowerShell here-string을 통해 직접 한국어 literal을 주입한 일부 자동화 데이터는 `???`로 저장되어 보였다. 이는 앱 UI 입력 자체의 문제라기보다 테스트 자동화 경로의 인코딩 오염으로 판단한다.

---

## 4. 시나리오별 판정

| ID | 시나리오 | 판정 | 근거 |
| --- | --- | --- | --- |
| FS-01 | 최초 실행과 업무엔진 상태 | Pass | health OK, shell 표시, 업무엔진 신호등 표시 |
| FS-02 | 업무대화 기본 흐름 | Partial | 화면 구조는 정상. 직접 타이핑 자동화는 virtual clipboard 제약으로 API 대체 |
| FS-03 | 업무대화 도구 라우팅 | Pass | `intent.plan -> schedule.create -> knowledge.search` 성공 |
| FS-04 | 일정 캘린더 | Pass | 화면 전환, 일정 연결 세션 표시 확인 |
| FS-05 | 파일찾기와 세션 파일 연결 | Pass | API 검색/파일연결 성공, 화면 전환 확인 |
| FS-06 | 지식폴더 설정/스캔/인덱싱 | Pass | 지식 소스 등록, scan, ingest `completed` |
| FS-07 | GraphRAG 검색과 근거 답변 | Partial | 근거 답변 생성은 성공. 검색 ranking이 작은 검증 소스보다 기존 대형 지식폴더를 우선 선택하는 경향 확인 |
| FS-08 | 문서작성 HWPX 산출 | Pass | HWPX 산출물 생성 및 `documents.generate` 작업 완료 |
| FS-09 | LLM 설정 | Pass | 환경설정 화면과 provider/API key 요약 표시 확인 |
| FS-10 | 파일정리/롤백 | Not run in this pass | destructive 가능성이 있어 이번 자동 통합검증에서는 제외. 기존 테스트와 API 테스트는 존재 |
| FS-11 | 실행기록/승인/우측 패널 | Pass | 우측 승인/작업 진행/작업 로그 표시 확인 |
| FS-12 | 설치패키지/폐쇄망 배포 | Pass | `desktop:bundle`, `desktop:smoke:nsis`, `release:offline` 통과 |

---

## 5. 사용자 경험 관찰

좋았던 점:

- 좌측 세션 rail이 계속 유지되어 업무대화 중심 구조가 분명하다.
- 우측 작업 진행 패널에서 작업 ID, resource key, event log를 볼 수 있어 긴 작업의 “무슨 일이 일어나는지”를 추적할 수 있다.
- 업무대화 복합 요청이 일반 답변으로 빠지지 않고 일정 등록과 GraphRAG 검색을 순차 실행했다.
- 문서작성 결과가 HWPX 파일로 실제 산출됐다.

불편하거나 추가 개선이 필요한 점:

- 검증/운영 중 잘못 주입된 `???` 데이터가 세션 목록을 오염시킬 수 있다. 테스트 데이터 격리 또는 관리자용 정리 기능이 필요하다.
- GraphRAG 검색이 전체 지식폴더에서 강하게 매칭되는 기존 문서를 우선 반환해, 방금 만든 작은 검증 소스가 항상 우선 노출되지는 않았다.
- 파일명 인덱스 갱신은 전체 C 드라이브 기준으로 `partial`이 나올 수 있다. 사용자가 “정상 partial”과 “실패 partial”을 구분할 수 있는 설명이 더 필요하다.
- 인앱 브라우저 자동 입력 제약 때문에 완전한 “사용자 타이핑” E2E는 현재 제한된다.
- 파일정리 실제 적용/롤백은 destructive 가능성이 있어 이번 pass에서 자동 실행하지 않았다. 별도 sandbox 폴더로 반복 검증하면 좋다.

---

## 6. 구체적 개선방안

### UX-01 테스트/운영 데이터 정리 도구

- 심각도: medium
- 증상: 자동화 과정에서 잘못 주입된 세션명이 `???`로 표시되어 사용자 세션 목록을 오염시킬 수 있다.
- 개선 방향: 개발/검증 모드에서 테스트 세션, 테스트 일정, 테스트 지식소스를 삭제하는 관리 도구 또는 CLI를 제공한다.
- 검증 기준: `전기능 통합검증` prefix 데이터를 한 번에 삭제하고 UI에서 사라지는지 확인한다.

### RAG-01 검색 범위/소스 우선순위 옵션

- 심각도: medium
- 증상: 업무대화 GraphRAG 검색이 사용자가 방금 등록한 소스보다 기존 대형 지식폴더의 유사 문서를 먼저 보여줄 수 있다.
- 개선 방향: 업무대화 세션에 연결된 파일/최근 등록 지식소스/선택 지식소스를 retrieval ranking에서 가중치 처리한다.
- 검증 기준: 세션에 연결된 fixture 문서가 같은 질의에서 상위 3개 안에 표시된다.

### QA-01 Browser 직접 타이핑 검증 환경 보강

- 심각도: low
- 증상: Codex in-app Browser에서 virtual clipboard가 없어 직접 타이핑 자동화가 제한된다.
- 개선 방향: virtual clipboard 설치 또는 Tauri 앱용 Playwright/WebDriver 테스트 harness를 별도로 준비한다.
- 검증 기준: 채팅 입력창에 실제 타이핑, Enter 전송, 첨부파일 선택을 자동화한다.

### JOB-01 worker pool 정책 노출

- 심각도: medium
- 증상: `work_jobs` 상태/락은 구현됐지만 parser/io/llm pool 동시성 정책은 아직 운영 설정으로 노출되지 않았다.
- 개선 방향: 환경설정 또는 config에 `parser_pool`, `io_pool`, `llm_pool` 동시 실행 수를 추가한다.
- 검증 기준: GraphRAG 인덱싱 중 파일찾기/업무대화가 blocked 되지 않고, 같은 source 재색인만 blocked 된다.

### PKG-01 clean-account 설치 검증

- 심각도: high
- 증상: 현재 개발 PC 검증은 충분하지만 실제 폐쇄망/권한 제한 PC에서의 설치 후 업무엔진 자동시작은 별도 확인이 필요하다.
- 개선 방향: NSIS smoke 이후 clean Windows 계정 또는 VM에서 GUI 설치/실행/삭제 증거를 남긴다.
- 검증 기준: 설치 후 별도 sidecar 실행 없이 앱이 `/health` OK를 받는다.

---

## 7. 패키징 검증

실행 명령:

```powershell
npm.cmd run desktop:bundle
npm.cmd run desktop:smoke:nsis
npm.cmd run release:offline
```

결과:

| 항목 | 결과 |
| --- | --- |
| NSIS 설치파일 | `apps\desktop\src-tauri\target\release\bundle\nsis\Gongmu_0.1.0_x64-setup.exe` |
| NSIS smoke install dir | `runtime-workspace\cache\nsis-smoke-install-20260523-095857` |
| NSIS smoke workspace | `runtime-workspace\cache\nsis-smoke-workspace-20260523-095857` |
| bundled 업무엔진 health | `status=ok` |
| uninstall 잔여 파일 | `remaining_install_files: []` |
| 폐쇄망 release dir | `release\offline\Gongmu_0.1.0_windows_x64_offline_20260523_1900` |
| 폐쇄망 release zip | `release\offline\Gongmu_0.1.0_windows_x64_offline_20260523_1900.zip` |
| installer SHA-256 | `E923BCB09CD5095D45D0F3F49ABA1154C1FCFE9603440BFC83843AACD91B506A` |

## 8. 릴리스 전 결론

전 기능 통합 관점에서 핵심 업무 흐름은 동작한다.

- 업무대화 중심 구조: 확인
- 일정/파일/지식/문서작성 연결: 확인
- GraphRAG 근거 답변: 확인, ranking 개선 필요
- HWPX 산출: 확인
- 장기 작업 상태/로그: 확인
- 설치패키지 검증: NSIS bundle, smoke, offline zip 확인

따라서 다음 단계는 최종 패키징 명령과 NSIS smoke, offline release zip 생성이다.
