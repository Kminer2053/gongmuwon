# 2026-05-18 Gongmu 목표 구현 및 검증 결과보고

> ⚠️ **정정(2026-07-06):** ChromaDB/LanceDB 벡터 백엔드는 이후 M-07로 제거되어 설치 패키지에 포함되지 않습니다(지식 검색은 SQLite FTS5).

## 목표

아래 `/goal` 항목을 Windows 메인 개발 환경 기준으로 구현/검증했다.

- 설치 후 업무 엔진 자동 시작/복구
- 폐쇄망 NSIS 패키지 의존성 감사와 설치파일 재생성
- Anything 없이 자체 인덱서 기반 파일찾기 기본화
- GraphRAG 인제스트 품질 개선
- 업무대화 GraphRAG 검색, 파일첨부, 멀티모달, 외부/로컬 LLM 흐름 연결
- `Kminer2053/public-doc-to-hwpx` 방식 참고 문서작성 업그레이드
- UI의 `사이드카` 사용자 표현 제거 및 `업무 엔진` 통일
- 지식 그래프를 인터랙티브 업무지식 지도로 고도화

## 주요 반영사항

### 업무 엔진 자동 시작/복구

- Tauri 앱 Ready 이벤트에서 내장 업무 엔진을 자동 시작하는 흐름을 유지하고, bundled cold start timeout을 60초로 확장했다.
- 설치된 `gongmu-desktop.exe`를 직접 실행해 업무 엔진이 자동으로 `/health`를 반환하는 것을 확인했다.
- 실행 중인 업무 엔진 프로세스를 강제 종료한 뒤 앱이 자동 복구해 다시 `/health status=ok`를 반환하는 것을 확인했다.
- UI에는 `sidecar`, `사이드카` 대신 `업무 엔진`만 노출되도록 사용자 문구를 정리했다.

### 폐쇄망 패키지

- NSIS 설치파일을 재생성했다.
- 설치 payload 안에 내장 업무 엔진 exe, ChromaDB, chromadb rust binding, LanceDB/PyArrow, KORdoc bridge runner 포함을 파일 수준으로 확인했다.
- NSIS silent smoke에서 설치된 payload의 업무 엔진 `/health`와 uninstall 후 잔여 설치 파일 없음이 확인됐다.
- 폐쇄망 전달용 zip을 생성했다.

산출물:

- `release/offline/Gongmu_0.1.0_windows_x64_offline_20260518_1402/Gongmu_0.1.0_x64-setup.exe`
- `release/offline/Gongmu_0.1.0_windows_x64_offline_20260518_1402.zip`
- SHA256: `2E124EC87DA2E607E4E293574ED7B87261E1B89E805C73DE756575409FEFB8E4`

### 자체 파일찾기

- 로컬 파일 검색은 지식폴더/파일명 인덱스를 우선 사용하도록 고정했다.
- 인덱스가 존재하고 결과가 있으면 PC 전체 직접 스캔으로 되돌아가지 않도록 회귀 테스트를 추가했다.
- UI 문구도 `내장 파일찾기 우선`으로 정리했다.
- Anything은 기본 검색이 아니라 보조 고급검색으로 남겨두었다.

### GraphRAG 품질

- 저품질 partial 문서가 structured 근거보다 상위에 오는 문제를 quality penalty로 완화했다.
- `UNIQUE constraint failed: knowledge_graph_nodes.id` 방지를 위해 그래프 노드/엣지 insert를 `INSERT OR IGNORE` 기반으로 보강했다.
- 인제스트 진행률, full log dump, 구조 보기, 작업 잠금, 취소 흐름을 UI 테스트로 고정했다.
- ChromaDB는 기본 vector backend 후보로 포함되고, SQLite fallback은 전환 가능한 fallback으로 유지된다.

### 업무대화 RAG/첨부/멀티모달/LLM

- 업무대화 GraphRAG 프롬프트가 nested `chunk.text`를 읽지 못하던 문제를 수정했다.
- Ollama `/api/chat`이 assistant text 없이 반환될 때 `/api/generate` fallback을 사용하도록 보강했다.
- OpenAI-compatible/OpenRouter, Anthropic, Gemini 계열에 이미지 첨부를 provider별 payload 형식으로 전송하도록 테스트와 구현을 추가했다.
- 채팅 UI는 이미지 다중 첨부, 삭제, 확대 미리보기, markdown 렌더링, 응답 소요시간 표시를 테스트로 고정했다.

### 문서작성

- 업무대화 세션의 대화내용, 연결 일정, 연결 파일, 문서 포맷/슬롯을 Content Base에 반영하는 흐름을 테스트로 고정했다.
- 사용자 지정 `.hwpx` 템플릿 업로드/목록/유효성 검사를 추가했다.
- 시행문/1페이지 보고서/풀버전 보고서/이메일 유형에 맞춰 HWPX 산출을 확장하는 기반을 반영했다.
- 구현 방향은 `public-doc-to-hwpx`의 공공문서 템플릿/슬롯 기반 생성 흐름을 참고했다.

### 인터랙티브 업무지식 지도

- 정적인 단어 나열식 그래프를 radial/orbit 기반의 인터랙티브 SVG 업무지식 지도로 바꿨다.
- 확대/축소/맞춤 버튼, 필터, 노드 클릭 관계 보기, 문서 섹션/표 drill-down 테스트를 추가했다.
- 지식폴더 화면은 `설정/상태`, `색인 처리`, `GraphRAG 검색` 탭으로 구분했다.

## 컴퓨터유즈 기반 확인

사용 가능한 컴퓨터유즈 표면은 Codex in-app browser였다. 네이티브 Tauri 창 좌표 제어 도구는 현재 세션에 없어서, Vite dev 화면을 in-app browser로 열어 직접 DOM/클릭 기반 확인을 수행했다.

확인한 내용:

- 앱 헤더에 `업무 엔진 정상`이 표시된다.
- 화면 텍스트에 사용자 노출 `사이드카`/`sidecar`가 남아 있지 않다.
- `내 지식폴더` 화면에서 `인터랙티브 업무지식 지도`가 보인다.
- 지식 그래프 확대 버튼 클릭 후 SVG `data-zoom=1.1`, UI `110%` 표시가 확인된다.
- `로컬파일/정보검색` 화면이 `내장 파일찾기 우선`, `내장 파일찾기`, `Gongmu가 직접 검색합니다` 문구를 표시한다.

제약:

- in-app browser의 virtual clipboard 미설치로 입력창 직접 타이핑 자동화는 실패했다.
- 파일검색 입력/첨부 흐름은 React/Vitest와 sidecar API 테스트로 보완 검증했다.

## 검증 명령

- `npm.cmd run sidecar:test`
  - 결과: `167 passed`
- `npm.cmd run desktop:test`
  - 결과: `20 passed`, `63 passed`
- `node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
  - 결과: `Finished dev profile`
- `npm.cmd run desktop:build`
  - 결과: Vite production build 성공
- `npm.cmd run desktop:bundle`
  - 결과: `Gongmu_0.1.0_x64-setup.exe` 생성 성공
- `npm.cmd run desktop:smoke:nsis`
  - 결과: `/health status=ok`, `remaining_install_files: []`

## 남은 리스크

- 실제 폐쇄망 PC의 Ollama 모델 파일과 endpoint 설정은 설치파일에 포함되지 않는다. 대상 PC의 로컬 모델 환경이 별도 준비되어야 한다.
- HWP/HWPX 고품질 파싱은 KORdoc bridge와 fallback chain의 실제 공공문서 샘플 품질 검증을 계속 누적해야 한다.
- 네이티브 GUI click-through 설치 검증은 이번에 silent smoke와 앱 실행 health 확인으로 대체했다.
