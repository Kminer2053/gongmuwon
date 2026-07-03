# 로컬 AI에이전트 워크플레이스 : 공무원 현재 구현 기능 및 스펙 정리

- 작성일: 2026-05-06
- 기준 환경: Windows Codex 개발 세션
- 제품명: 로컬 AI에이전트 워크플레이스 : 공무원
- 내부 코드명: Gongmu
- 앱 식별자: `kr.gongmu.workspace`
- 버전: `0.1.0`
- 목표 사용자: 공공기관 및 사무업무 담당자

## 1. 제품 목표

로컬 AI에이전트 워크플레이스 : 공무원은 단순 로컬 LLM 챗봇이 아니라, 업무대화 세션을 중심으로 일정, 파일찾기, 지식폴더, 문서작성, 승인, 실행기록을 연결하는 로컬 우선 Windows 업무 워크스페이스다.

핵심 구조는 다음과 같다.

```text
지식폴더 -> 업무대화(세션) <- 파일찾기
업무대화(세션) -> 문서작성 / 도구 사용 / 실행기록
일정 <-> 업무대화(세션)
```

문서작성은 `Content Base(Markdown) -> Template -> 최종 산출물` 흐름을 기본 원칙으로 유지한다. 폐쇄망 PC에서도 설치와 실행이 가능하도록 업무엔진과 주요 런타임은 로컬 우선으로 동작한다.

## 2. 기술 스택

- Desktop: Tauri 2, React 19, TypeScript, Vite, Vitest, lucide-react
- Backend: Python 3.11, FastAPI, SQLite, ChromaDB optional vector store, PyInstaller 업무엔진 bundle
- Runtime: Windows NSIS installer, bundled 업무엔진, Microsoft Edge WebView2 Runtime
- 기본 업무엔진 주소: `http://127.0.0.1:8765`
- 기본 개발 루프: `sidecar:serve`, `desktop:dev`, `sidecar:test`, `desktop:test`

## 3. 현재 UI 구조

현재 UI는 Codex 스타일의 3분할 작업 환경을 지향한다.

- 상단: 제품 제목, 설명, 새로고침, 우측 패널 토글, 업무엔진 신호등, 현재 배율 표시
- 좌측: 기능 아이콘과 업무대화 세션 목록
- 중앙: 현재 선택 기능의 메인 작업 화면
- 우측: 현재 컨텍스트, 승인 요청, 최근 실행 정보 패널

우측 패널은 접기/펼치기와 폭 조절이 가능하다. 패널을 접으면 중앙 작업 영역이 오른쪽으로 확장된다. 승인 요청 등 사용자 주의가 필요한 작업이 발생하면 관련 섹션이 자연스럽게 열리도록 구성되어 있다.

## 4. 업무엔진 및 런타임 관리

- 설치 앱 최초 실행 시 bundled 업무엔진 자동 시작을 시도한다.
- release build에서는 `resources/sidecar/windows-x64/gongmu-sidecar/gongmu-sidecar.exe`를 우선 사용한다.
- 개발 모드에서는 Python 3.11 venv 기반 업무엔진 실행을 사용한다.
- 업무엔진 강제 종료 시 상태 감지 후 재시작을 시도한다.
- 상단 우측 신호등 버튼에서 업무엔진 상태, 로그 경로, 시작/재시작/종료 조작을 확인할 수 있다.

## 5. 업무대화

업무대화는 로컬 AI에이전트 워크플레이스 : 공무원의 중심 작업 단위다.

- 업무대화 세션 생성 및 선택
- 세션별 메시지 저장
- 사용자 메시지 우측 정렬, assistant 응답 문서형 출력
- Markdown 응답 렌더링
- 응답 소요시간 표시
- pending/failed/completed 상태 표시
- 이미지 및 파일 첨부
- 이미지 썸네일, 삭제, 확대 미리보기
- 세부 설정 오버레이
- 일정 연결
- 파일찾기를 통한 세션-파일 경로 연결
- 새 메시지 전송 후 및 새로고침 후 마지막 대화 위치 유지

모든 채팅 메시지를 실행기록에 과도하게 쌓는 방식은 피하고, 실패/설정/파일연결 등 추적 가치가 있는 작업 중심으로 실행기록을 남기는 방향이다.

## 6. 일정

- 일정 생성, 수정, 목록 조회
- 월/주/일 보기 전환
- 이전/오늘/다음 이동
- 캘린더 칸 클릭 기반 일정 입력
- 일정이 있는 칸의 색상 강조
- 일정과 업무대화 세션 연결
- 일정에서 연결 세션 열기 또는 신규 연결 세션 생성

일정은 업무대화 세션의 보조 맥락으로 다룬다. 좌측 세션 목록은 기능 이동 중에도 유지된다.

## 7. LLM 연결

환경설정은 `로컬`, `내부 서버`, `외부 모델` 모드를 분리해 저장한다. 외부 공급자별 프로필도 별도 저장된다.

지원 공급자:

- Ollama
- OpenAI
- OpenRouter
- Featherless API
- Anthropic Claude
- Google Gemini
- NVIDIA NIM
- OpenAI-compatible custom endpoint

로컬 Ollama 기본값은 `http://127.0.0.1:11434`를 사용한다. Ollama는 OpenAI 호환 endpoint만 가정하지 않고 native `/api/chat` 응답도 처리한다. Qwen/Gemma 계열처럼 assistant text가 reasoning 필드에 들어오는 경우를 완화하기 위해 여러 응답 필드를 fallback으로 읽는다.

## 8. 파일찾기

파일찾기는 Anything/Docufinder 의존 없이 자체 로컬 파일명/경로 인덱스를 기본 흐름으로 사용한다.

- `/api/files/search`
- `/api/files/index/rebuild`
- 지식폴더 등록 파일 검색
- 로컬 파일명 인덱스 기반 검색
- compact filename match
- 검색 결과를 업무대화 세션 파일 링크로 연결
- 연결된 파일 수 표시 및 연결 파일 목록 확인
- 검색 결과 선택 시 우측 패널 미리보기/세부정보 연계
- 검색 결과 경로 복사와 파일/폴더 열기

Reference Set은 과거 handoff 호환 레이어로 남을 수 있으나, 현재 사용자 흐름의 기본 단위는 업무대화 세션에 연결된 개별 파일 링크다.

## 9. Anything / Docufinder 연계

Anything은 `chrisryugj/Docufinder` 계열 외부 프로그램으로 보고, 라이선스 이슈를 피하기 위해 내장 통합이 아니라 외부 실행 연계 방식으로 다룬다.

현재 지원:

- 실행 요청 생성
- 승인 티켓 생성
- 승인 후 외부 프로그램 실행
- `GONGMU_ANYTHING_EXE` 환경변수로 실행 파일 경로 지정 가능
- 검색어 clipboard handoff 시도
- 실행 이력 조회
- Anything 결과 경로를 Reference Set으로 import
- import 후 문서작성 화면으로 handoff

현재 제품 방향은 파일찾기 핵심 기능을 자체 구현하는 것이다. Anything/Docufinder 연계 API는 호환성 검토용 레거시 경로로 남아 있을 수 있으나, 사용자 UI의 기본 파일찾기 흐름에서는 사용하지 않는다.

## 10. 지식폴더 및 GraphRAG

지식폴더의 목표는 사용자가 지정한 로컬 업무폴더를 스캔해 로컬 지식베이스와 업무 그래프를 구성하는 것이다.

현재 구현:

- 지식 소스 폴더 등록
- 업무 프로필 저장: 기관명, 부서명, 팀명, 직위, 담당업무 키워드
- 지식 소스별 업무 맥락 분석 실행
- Folder Recon: 파일명, 경로, 수정일, 크기, 해시, 상위 폴더명 기반 후보 추출
- Identity/Governance Discovery: 조직도, 업무분장, 직제규정, 위임전결, 문서관리, 보안, 개인정보, 계약, 예산 규정 후보 탐지
- Document Family Detection: 초안/수정/최종/제출본/PDF 변환본 등 동일 문서군 후보 묶음
- Document Role Classification: `org_source`, `policy_source`, `work_product`, `collaboration_record`, `data_source`, `template_source`, `reference_material`, `decision_record` 분류
- 업무절차/문서작성/리서치/데이터 질의 의도별 ranking boost
- 등록 폴더 스캔
- 하위 파일 메타데이터 수집
- GraphRAG ingestion job 생성/조회/실행
- background ingestion 요청
- ingestion job 처리 시간 계측: `duration_ms`, `average_ms_per_file`
- source file hash 기반 incremental ingestion
- GraphRAG pipeline signature 변경 시 자동 재인제스트
- 변경 없는 파일 skip count 표시
- 강제 재색인 요청
- 삭제된 원본 파일에 대한 document/section/chunk/table/graph 동기 삭제
- queued/running ingestion job 취소
- queued/running 중복 ingestion job 생성 방지
- 마지막 처리 파일 표시: `last_processed_path`, `last_processed_at`
- Markdown/TXT/DOCX/XLSX/PPTX/PDF/HWPX XML fallback parsing
- KORdoc runner readiness 확인
- HWP/HWPX parser endpoint
- structured document model 저장
- section-aware chunk 저장
- structured table block 저장
- table-specific retrieval chunk 생성
- 문서별 extraction quality 저장
- 문서별 parser, quality score, partial 여부, section/table/chunk count 표시
- 지식 그래프 미리보기
- 그래프 노드 클릭 기반 관계 보기
- 관계 문서의 section/table drill-down
- 자연어 기반 retrieve/ask
- grounded answer와 citations 표시

GraphRAG citation에는 다음 정보가 포함된다.

- 출처 문서 id/title/path
- chunk id
- parser name
- quality score
- partial 여부
- evidence type: `section` 또는 `table`
- quality warnings
- score breakdown
- ontology relation names

GraphRAG ask 결과에는 다음 요약이 포함된다.

- source count
- table evidence count
- partial count
- low-quality count
- relation count

Backend 상태는 ChromaDB가 설치되지 않아도 SQLite fallback으로 동작한다. `/api/knowledge/backend-status`는 active backend, storage path, offline-safe 여부, backend contract version, operations boundary를 제공한다. ChromaDB는 `chromadb==1.5.9`로 sidecar runtime dependency에 포함되며, 환경설정의 `graphrag_vector_backend`가 `chromadb`일 때 sidecar 단일 writer 프로세스가 precomputed embedding chunk를 Chroma `PersistentClient`에 upsert/query/delete할 수 있다. Chroma embedded mode는 동일 local path에 여러 process가 동시에 write하면 안 되므로 로컬 AI에이전트 워크플레이스 : 공무원은 sidecar 단일 writer 원칙을 유지한다.

Graph backend는 현재 KuzuDB를 핵심 의존성으로 삼지 않는다. Kuzu upstream archive 리스크 때문에 전용 graph database 선택은 보류하고, 현재 production graph backend는 SQLite graph mirror로 고정한다. backend status의 graph 항목은 `production_backend=sqlite_graph_mirror`, `candidate_backend=deferred_graph_database`로 보고된다.

## 11. GraphRAG 품질 게이트

2026-05-06 기준 GraphRAG 방향은 “DB 확장보다 인제스트 품질 우선”으로 수정되었다.

완료된 품질 게이트:

- extraction quality report 저장
- table-specific retrieval chunk 생성
- 공공문서 온톨로지 alias 확장
- Budget, Attachment, Event 후보 추출
- 낮은 품질 문서 warning 표시
- table evidence 우선 ranking boost
- PDF/DOCX/HWPX/Markdown fixture 회귀 테스트
- backend contract 및 offline fallback 상태 고정
- ChromaDB optional vector adapter, dependency pin, PyInstaller collection, settings UI 전환
- deletion sync, incremental ingestion, forced reindex, cancel, duplicate active job guard
- retrieval quality fixture 기반 expected citation/relation 검증

관련 계획 문서:

- `docs/superpowers/plans/2026-05-06-graphrag-ingestion-quality-gate-plan.md`

## 12. 문서작성

문서작성은 Content Base 기반 흐름을 유지하되, 사용자 입력 흐름은 `대화세션/바로 작성 선택 -> 파일등록 -> 산출보고서 선택 -> 작업지시 -> 보고서 완성`으로 단순화되어 있다.

- 대화세션 기반 작성 또는 세션 없이 바로 작성 선택
- 세션의 대화, 연결 일정, 연결 파일, 지식폴더 RAG 근거를 WorkSessionBrief로 수집
- 첨부/연결 파일별 주요 내용과 활용 목적 입력
- 파일 크기/컨텍스트 제한 안내와 부분 추출 경고
- 출력 유형 선택: 시행문, 1페이지 보고서, 풀버전 보고서, 이메일, 별도 지정
- 기본 내장 HWPX/HWTX 양식 또는 사용자 지정 양식 선택
- Content Base Markdown과 DocumentPlan 생성
- 양식별 글쓰기 규칙에 맞춘 HWPX 산출
- 결과 파일과 검토용 Markdown 경로를 카드형 링크로 제공

출력 유형은 다음 4개를 중심으로 정리되어 있다.

- 시행문
- 1페이지 보고서
- 풀버전 보고서
- 이메일

Kminer2053/public-doc-to-hwpx 계열 스킬의 입력 수집, 보고서 계획, 양식 매핑 흐름을 참고해 HWPX/HWTX 출력 품질을 고도화하고 있다.

## 13. 파일정리

파일정리는 현재 `제안 -> 승인 -> 적용 -> 롤백` 절차 안전성 검증 중심이다.

- 대상 경로 기준 제안 생성
- 제안 목록 표시
- 적용 요청
- 승인 티켓 생성
- 승인 후 적용 commit
- active operation 관리
- rollback
- 중복 적용 방지

장기 목표는 실제 파일을 적절한 폴더로 이동/정리하는 기능이다. 실제 이동 정책, 충돌 처리, 안전장치, 사용자 확인 UX는 추가 고도화 대상이다.

## 14. 개인화 학습

업무대화 세션 기록을 분석해 개인 업무 패턴과 지식 보강 후보를 생성하는 방향이 반영되어 있다.

- 개인화 저장 폴더 설정
- 승인 후 반영 / 자동 반영 옵션
- 세션 요약 후보
- 업무 패턴 후보
- entity alias 후보
- 문서 선호 후보
- extraction rule 후보

현재 기본 방향은 사용자 승인 후 반영이며, 설정에서 자동 반영을 선택할 수 있다.

## 15. 주요 API 그룹

| 그룹 | 주요 endpoint |
| --- | --- |
| Health | `GET /health` |
| Settings | `GET /api/settings`, `PUT /api/settings`, `POST /api/settings/llm-test` |
| Schedule | `GET/POST/PATCH /api/schedules` |
| Work Session | `GET/POST/PATCH /api/work-sessions` |
| Messages | `GET/POST /api/work-sessions/{session_id}/messages`, `POST /api/work-sessions/{session_id}/turn` |
| Attachments | `POST /api/work-sessions/{session_id}/attachments` |
| File Links | `GET/POST/DELETE /api/work-sessions/{session_id}/file-links` |
| Files | `POST /api/files/search`, `POST /api/files/index/rebuild` |
| Reference Set | `GET/POST /api/reference-sets` |
| Knowledge | `GET/PUT /api/knowledge/work-profile`, `GET/POST /api/knowledge/sources`, `POST /api/knowledge/sources/{source_id}/scan`, `POST /api/knowledge/sources/{source_id}/analyze-work-context`, `GET /api/knowledge/sources/{source_id}/analysis`, `POST /api/knowledge/sources/{source_id}/analysis/confirm`, `GET /api/knowledge/source-files`, `GET /api/knowledge/backend-status`, `GET /api/knowledge/parser-status`, `POST /api/knowledge/ingest`, `POST /api/knowledge/reindex`, `GET /api/knowledge/chunks`, `GET /api/knowledge/documents`, `GET /api/knowledge/document-structure`, `GET /api/knowledge/tables`, `GET /api/knowledge/graph/query`, `POST /api/knowledge/retrieve`, `POST /api/knowledge/ask`, `POST /api/knowledge/parse-hwp`, `POST /api/knowledge/parse-hwpx` |
| Personalization | `POST /api/personalization/work-sessions/{session_id}/analyze`, `GET /api/personalization/candidates`, `POST /api/personalization/candidates/{candidate_id}/decide` |
| Documents | `POST /api/documents/content-bases`, `GET/POST /api/documents/templates/custom`, `POST /api/documents/finalize`, `POST /api/documents/finalize/{ticket_id}/apply` |
| Anything | `POST /api/integrations/anything/launch`, `GET /api/integrations/anything/launches`, `POST /api/integrations/anything/launch/{ticket_id}/apply`, `POST /api/integrations/anything/launch/{ticket_id}/reference-set` |
| Approval | `GET /api/approval-tickets`, `POST /api/approval-tickets/{ticket_id}/decision` |
| File Organizer | `GET/POST /api/file-organizer/proposals`, `POST /api/file-organizer/proposals/{proposal_id}/apply`, `POST /api/file-organizer/proposals/{proposal_id}/apply/commit`, `POST /api/file-organizer/operations/{operation_id}/rollback` |
| Logs | `GET /api/execution-logs` |

## 16. 검증 상태

2026-05-06 Windows 개발 세션에서 최근 확인한 검증은 다음과 같다.

```text
npm.cmd run sidecar:test
결과: 126 passed

npm.cmd run desktop:test
결과: 18 test files passed, 49 tests passed

node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
결과: Finished dev profile
```

패키징/설치 검증은 별도 릴리스 루프에서 수행한다. 평소 개발 검증은 sidecar test, desktop test, cargo check 중심으로 유지한다.

## 17. 현재 한계 및 후속 과제

- ChromaDB vector backend는 optional로 포함되었고 기본값은 SQLite fallback이다. 환경설정에서 ChromaDB를 선택하면 sidecar가 Chroma local store에 chunk embedding을 upsert한다.
- KuzuDB는 현재 production 의존성에서 제외했다. graph backend는 SQLite graph mirror를 유지하며, 전용 graph database는 maintained 후보를 재평가한 뒤 별도 sprint에서 결정한다.
- GraphRAG 답변은 현재 extractive grounded answer 중심이며, LLM 기반 최종 종합 답변은 후속 단계다.
- KORdoc native parser와 embedded Node runtime의 실제 오프라인 패키징 검증이 더 필요하다.
- 파일찾기는 자체 파일명 검색 중심이며, Everything 수준의 USN Journal 기반 즉시 색인은 후속 과제다.
- 문서작성의 HWPX/HWTX 최종 렌더링 품질 검증이 필요하다.
- 파일정리는 절차 안전성 중심 구현이며, 실제 이동 정책과 충돌 처리 UX는 고도화 대상이다.
- 설치 패키지에서 업무엔진 자동 시작/재시작은 계속 중요한 릴리스 검증 항목이다.
