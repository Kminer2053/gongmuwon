# 2026-05-20 UI/핵심 기능 개선 및 검증 보고

## 목적

`/goal` 요청에 따라 공통 레이아웃, 업무대화, 지식폴더, 로컬파일/정보검색, 문서작성 흐름을 개선하고 Windows Codex 환경에서 자동 테스트와 브라우저 기반 조작 확인을 수행했다.

## 반영한 개선사항

- 공통 레이아웃: 상단 타이틀 영역을 압축하고 제품명을 `로컬 AI에이전트 워크플레이스 : 공무원`으로 변경했다.
- 공통 레이아웃: 제품 설명을 `공공분야 사무업무자를 위한 보안 걱정 없는 로컬 우선 업무공간`으로 변경했다.
- 공통 레이아웃: 메뉴별 화면 제목/설명을 중앙 본문에서 걷어내고 상단 상태 영역에 반영되도록 했다.
- 공통 레이아웃: 중앙 업무대화 카드에는 중복 메뉴명 없이 현재 세션 제목만 보이도록 정리했다.
- 공통 레이아웃: 상단 새로고침/우측패널 버튼에 실제 이미지 아이콘 파일(`/icons/*.svg`)을 적용했다.
- 공통 레이아웃: 우측 패널에 `작업 상세` 영역을 추가해 현재 메뉴와 최근 작업의 상세 맥락을 보여주도록 확장했다.
- 공통 레이아웃: 승인 티켓, ContentBase, ingestion 작업처럼 긴 UUID가 그대로 노출되던 영역을 짧은 표시명으로 바꿨다.
- 업무대화: GraphRAG 근거 맥락을 클릭 가능한 근거 칩으로 만들고, 클릭 시 우측 작업 상세 패널이 열리도록 개선했다.
- 업무대화: 로컬/외부 모델 응답에 시스템 가드레일을 추가해 비밀번호, API 키, 토큰, 주민등록번호 형태의 민감정보를 `[보호됨]`으로 치환하도록 했다.
- 업무대화: 자연어 일정 등록 인식 범위를 넓혀 `내일 오후 4시에 ... 일정 등록` 같은 한국어 요청을 일정 생성 스킬로 처리하도록 보강했다.
- 업무대화: 문서작성 요청을 업무대화 스킬로 처리해 세션 맥락 기반 HWPX 산출까지 이어지도록 확인했다.
- 업무대화: Markdown 출력 가독성을 위해 긴 문단과 번호 목록을 읽기 쉬운 단위로 정규화했다.
- 업무대화: `/api/work-sessions/{id}/turn/stream` SSE 엔드포인트를 추가하고 프론트 제출 흐름이 해당 스트림을 우선 사용하도록 변경했다.
- 업무대화: Ollama native `/api/chat` 스트리밍과 OpenAI-compatible `chat/completions` SSE delta 파싱을 추가했다.
- 지식폴더: 스캔/GraphRAG 인덱싱 중 작업 상세 패널과 색인처리 탭이 자연스럽게 열리도록 하고, 진행 상태 카드와 애니메이션 진행 바를 추가했다.
- 지식폴더: 지식 그래프 영역을 리사이즈와 드래그 이동이 가능한 인터랙티브 업무지식 지도 형태로 개선했다.
- 로컬파일/정보검색: 검색 범위, 검색 결과, 선택 결과 미리보기를 분리한 파일탐색기형 3단 레이아웃으로 재구성했다.
- 문서작성: ContentBase 생성/최종 산출 실패가 단순 `Failed to fetch`로 보이지 않도록 API 오류 메시지를 한국어로 구체화했다.
- 개발 화면: `favicon.ico` 404가 발생하지 않도록 인라인 favicon을 추가했다.

## 브라우저 기반 확인

Codex in-app browser는 이번 세션에서 실행용 JavaScript 도구가 노출되지 않아 직접 조작 자동화가 제한됐다. 대신 Playwright CLI로 실제 브라우저를 열어 조작했다.

- URL: `http://127.0.0.1:5173/`
- 상단 제품명과 설명이 새 문구로 보임을 확인했다.
- 상단 현재 메뉴 영역에 `업무대화 / 업무 요청 라우터`가 표시됨을 확인했다.
- 중앙 업무대화 영역에는 중복 메뉴명 없이 선택 세션 제목 `목표 검증 세션`이 표시됨을 확인했다.
- 상단 새로고침과 우측 패널 토글이 `img` 요소 기반 아이콘으로 표시됨을 확인했다.
- 지식폴더 화면에서 그래프 드래그 안내, 색인처리 탭, 진행 제어 버튼이 표시됨을 확인했다.
- 로컬파일/정보검색 화면에서 파일탐색기형 레이아웃과 선택 결과 미리보기 영역이 분리됨을 확인했다.
- 문서작성 화면에서 Content Base -> Template -> 최종 산출 흐름이 유지됨을 확인했다.
- 업무대화 입력창에 `내일 오후 5시에 스트리밍 확인 회의 일정 등록해줘`를 직접 입력하고 전송했다.
- 응답으로 `일정을 등록했습니다`, `제목: 스트리밍 확인 회의`, `시간: 2026-05-21T17:00:00+09:00 ~ 2026-05-21T18:00:00+09:00`이 표시됨을 확인했다.
- 네트워크 요청에서 `POST /api/work-sessions/{id}/turn/stream`이 호출되고 `content-type: text/event-stream; charset=utf-8`로 응답함을 확인했다.
- 브라우저 콘솔 error는 0건으로 확인했다.

## 업무대화 스킬 API 검증

실행 중인 업무 엔진에 직접 요청해 업무대화 스킬 경로를 확인했다.

- `POST /api/work-sessions/{id}/turn`
- 입력: `내일 오후 4시에 목표 검증 회의 일정 등록해줘`
- 결과: `schedule.create` 실행
- 입력: `이 세션 내용을 바탕으로 1페이지 보고서 HWPX 문서작성 해줘`
- 결과: `document.create` 실행
- 산출물: `runtime-workspace/documents/outputs/목표 검증 세션 문서.hwpx`

## 문서작성 직접 API 검증

ContentBase 이후 최종 산출 endpoint를 현재 실행 서버에서 직접 확인했다.

- `POST /api/documents/content-bases`
- 입력 제목: `직접 문서작성 검증`
- `POST /api/documents/finalize`
- 승인 티켓: `265b32bc-cece-4b0f-b942-b1ee3e119942`
- `POST /api/documents/finalize/{ticket_id}/apply`
- 산출물: `runtime-workspace/documents/outputs/직접 문서작성 검증.hwpx`
- 파일 크기: `8300 bytes`

## 검증 명령

- `npm.cmd --workspace apps/desktop run test -- app.test.tsx`
- 결과: `5 passed`
- `npm.cmd run desktop:test`
- 결과: `20 passed, 66 passed`
- `npm.cmd --workspace apps/desktop run build`
- 결과: Vite production build 성공
- `npm.cmd run sidecar:test`
- 결과: `183 passed`
- `node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- 결과: cargo check 성공
- `node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_work_session_turn.py::test_work_session_turn_stream_sends_delta_events_before_done -q`
- 결과: `1 passed`
- `node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_llm_ollama.py services/sidecar/tests/test_llm_providers.py -q`
- 결과: `14 passed`
- `npm.cmd --workspace apps/desktop run test -- api.test.ts chat-turn-submit.test.tsx`
- 결과: `11 passed`

## 남은 확인/후속 보완

- 실제 로컬/외부 LLM의 장문 응답을 대상으로 토큰 단위 체감 스트리밍 품질은 추가 확인 여지가 있다. 이번 검증에서는 SSE 경로, skill route, Ollama/OpenAI-compatible delta 파싱 단위 검증, 브라우저 호출 경로까지 확인했다.
- in-app browser의 네이티브 조작 자동화를 다시 쓰려면 해당 세션에서 실행용 JavaScript 도구가 노출되어야 한다. 이번 세션에서는 Playwright CLI로 대체 검증했다.
