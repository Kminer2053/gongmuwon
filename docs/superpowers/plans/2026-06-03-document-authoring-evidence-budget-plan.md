# 문서작성 첨부파일 근거 예산 적용 계획

> **에이전트 작업자 참고:** 이 계획은 문서작성 기능에서 큰 첨부파일을 무조건 버리지 않고, 로컬 경량 모델이 처리 가능한 근거 텍스트 예산 안에서 안전하게 활용하도록 만든 작업 기록이다.

**목표:** 문서작성 기능이 큰 첨부파일을 허용하되, Gemma4 E2B 같은 로컬 경량 모델 기준으로 약 32KB의 근거 텍스트 예산을 적용하고, 부분 분석 여부를 사용자에게 명확히 안내한다.

**설계 방향:** 파일의 물리적 크기와 LLM에 투입되는 근거 텍스트 크기를 분리한다. 직접 첨부파일은 1순위 근거, 업무대화 세션은 2순위 근거, GraphRAG는 사용자가 명시적으로 요구했거나 직접 첨부 근거가 부족할 때의 보조 근거로 다룬다. 사용자는 결과 화면에서 정상 분석, 부분 분석, 제한 분석 여부를 확인할 수 있어야 한다.

**기술 범위:** Python FastAPI 업무엔진, 기존 SQLite 문서작성 기록, React/TypeScript 데스크톱 UI, 문서작성 회귀 테스트.

---

### 작업 1: 백엔드 근거 예산 정책

**대상 파일**
- 수정: `services/sidecar/src/gongmu_sidecar/documents.py`
- 수정: `services/sidecar/src/gongmu_sidecar/app.py`
- 테스트: `services/sidecar/tests/test_document_workflow.py`

**구현 내용**
- 큰 직접 첨부파일이 조용히 무시되지 않고 `제한 분석` 경고를 반환하도록 테스트를 추가한다.
- 직접 첨부파일이 있고 사용자가 지식폴더나 GraphRAG를 명시적으로 요구하지 않은 경우, 관련 없는 GraphRAG 후보가 자동 혼입되지 않도록 테스트를 추가한다.
- 문서작성 전용 `source_analysis` 정보를 만든다.
- `source_analysis`에는 `analysis_mode`, `warnings`, `budget_bytes`, `used_bytes`, 직접 첨부파일별 분석 상태를 포함한다.
- Content Base 생성 응답과 즉시 HWPX 생성 응답에 분석 경고를 포함한다.

### 작업 2: UI 분석 범위 안내

**대상 파일**
- 수정: `apps/desktop/src/api.ts`
- 수정: `apps/desktop/src/app.tsx`
- 테스트: `apps/desktop/src/document-authoring-layout.test.tsx`

**구현 내용**
- 문서작성 결과 카드 근처에 `정상 분석`, `부분 분석`, `제한 분석` 상태를 표시한다.
- 32KB 입력 예산 중 실제 사용량을 표시한다.
- 분석이 제한된 파일명과 첫 번째 경고 메시지를 함께 보여준다.
- 사용자가 큰 파일을 첨부해도 “왜 결과 품질이 제한될 수 있는지”를 화면에서 이해할 수 있게 한다.

### 작업 3: 검증

**검증 명령**
- `npm.cmd run sidecar:test -- services/sidecar/tests/test_document_workflow.py`
- `npm.cmd run desktop:test -- src/document-authoring-layout.test.tsx`
- `npm.cmd run sidecar:test`
- `npm.cmd run desktop:test`

**완료 기준**
- 문서작성 회귀 테스트가 모두 통과한다.
- 데스크톱 UI 테스트가 모두 통과한다.
- 큰 첨부파일은 첨부 자체가 막히지 않고, 제한 분석 안내가 남는다.
- 직접 첨부파일이 있을 때 불필요한 GraphRAG 후보가 자동 혼입되지 않는다.

