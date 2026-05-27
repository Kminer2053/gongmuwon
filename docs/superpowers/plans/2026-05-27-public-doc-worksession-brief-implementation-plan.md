# Public Doc WorkSessionBrief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문서작성 기능이 대화세션, 연결 파일, 일정, Reference Set, GraphRAG 근거를 먼저 WorkSessionBrief로 정리하고, public-doc-to-hwpx의 작성 흐름에 맞는 DocumentPlan을 거쳐 HWPX를 생성하게 한다.

**Architecture:** sidecar 문서작성 계층에 deterministic planning 모듈을 추가한다. `DocumentManager.create_content_base()`는 원천 데이터를 수집한 뒤 `WorkSessionBrief`와 `DocumentPlan` 섹션을 Content Base Markdown에 먼저 렌더링하고, `hwpx_writer.build_public_document_payload()`는 이 섹션을 최우선으로 사용한다.

**Tech Stack:** FastAPI sidecar, SQLite, pytest, python-hwpx, public-doc-to-hwpx 내장 skeleton template.

---

## Files

- Create: `services/sidecar/src/gongmu_sidecar/document_planning.py`
- Modify: `services/sidecar/src/gongmu_sidecar/documents.py`
- Modify: `services/sidecar/src/gongmu_sidecar/hwpx_writer.py`
- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
- Modify: `services/sidecar/tests/test_document_workflow.py`
- Modify: `services/sidecar/tests/test_work_session_turn.py`

## Tasks

### Task 1: 실패 테스트로 문서작성 브리프 품질 고정

- [x] 세션 메시지, 연결 일정, 연결 파일, Reference Set, GraphRAG 유사 근거가 Content Base의 `WorkSessionBrief`, `DocumentPlan`, `수집 근거`에 들어가는 테스트를 추가한다.
- [x] 직접 문서작성 `/api/documents/generate`도 같은 브리프/플랜 경로를 사용하는 테스트를 추가한다.
- [x] 새 테스트가 기존 구현에서 실패하는 것을 확인한다.

### Task 2: Document planning 모듈 구현

- [x] `DocumentEvidence`, `DocumentBrief`, `DocumentPlan` dataclass를 만든다.
- [x] `compile_document_brief()`에서 지시문 기반으로 대화, 일정, 파일, Reference Set, GraphRAG 근거를 요약한다.
- [x] `build_document_plan()`에서 시행문/1페이지/풀버전/이메일별 섹션 목적과 작성 원칙을 생성한다.
- [x] `render_brief_markdown()`에서 Content Base에 안정적인 한국어 섹션을 출력한다.

### Task 3: Content Base 생성 경로 연결

- [x] `DocumentManager`가 optional GraphRAG retriever를 받아 문서 지시문과 목적 기반 근거를 수집한다.
- [x] 기존 원천 데이터 섹션은 유지하되 브리프/플랜 섹션을 최상단에 둔다.
- [x] 업무대화 스킬과 문서작성 화면이 모두 동일한 `create_content_base()` 경로를 사용하게 유지한다.

### Task 4: HWPX payload 매핑 보강

- [x] `hwpx_writer`가 `핵심 내용`, `현황 및 쟁점`, `조치안`, `기대효과 및 요청`, `수집 근거`, `DocumentPlan`을 우선 읽는다.
- [x] 기존 원천 섹션만 있는 Content Base도 계속 동작하게 fallback을 유지한다.
- [x] public-doc-to-hwpx 핵심 작성 원칙인 두괄식, 개조식, 한 문장 한 핵심, 불필요 표현 축약을 품질 점검에 유지한다.

### Task 5: 검증

- [x] targeted pytest로 새 RED/GREEN 테스트를 확인한다.
- [x] `npm.cmd run sidecar:test` 전체를 실행한다.
- [x] `npm.cmd run desktop:test`로 문서작성 화면 handoff 계약을 확인한다.
- [x] 가능하면 업무대화 문서작성 라우팅 테스트를 함께 실행한다.
