# 경량모델 컴퓨터유즈 실제 점수 리포트

- 실행 ID: computer-use-actual-1779647897673
- 기준 모델: Gemma 4 E2B (gemma4:e2b)
- 평가 방식: playwright-computer-use
- 총점: 130 / 1000
- 실시: 13개
- 미실시: 87개
- 종합 등급: needs-work

## 카테고리별 점수

| 카테고리 | 실시 | 점수 | 등급 |
| --- | ---: | ---: | --- |
| 시작/업무엔진 | 1/10 | 10/100 | release-ready |
| 모델 설정/Gemma 4 E2B | 1/10 | 10/100 | release-ready |
| 업무대화 기본 UX | 4/10 | 40/100 | release-ready |
| 업무대화 도구 라우팅 | 0/10 | 0/100 | not-tested |
| 일정 캘린더 | 1/10 | 10/100 | release-ready |
| 파일찾기/세션 연결 | 1/10 | 10/100 | release-ready |
| 지식폴더/GraphRAG 인덱싱 | 1/10 | 10/100 | release-ready |
| GraphRAG 검색/출처 품질 | 0/10 | 0/100 | not-tested |
| 문서작성/HWPX 산출 | 3/10 | 30/100 | release-ready |
| 실행기록/작업진행/다중작업 | 1/10 | 10/100 | release-ready |

## 실시 시나리오

### LMUX-01-01 시작/업무엔진

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: app_title=true; engine_healthy=true
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-evidence.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-snapshot.yml
  - http://127.0.0.1:8765/api/work-sessions/b4f4771a-9528-4b21-8663-d1cf645a50b5

### LMUX-02-01 모델 설정/Gemma 4 E2B

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: runtime_policy=provider=featherless; model=google/gemma-4-E2B-it; lightweight=true; gemma4_e2b=true; reasoning=low
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-evidence.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-snapshot.yml
  - http://127.0.0.1:8765/api/work-sessions/b4f4771a-9528-4b21-8663-d1cf645a50b5
  - http://127.0.0.1:8765/api/settings

### LMUX-03-01 업무대화 기본 UX

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: session=b4f4771a-9528-4b21-8663-d1cf645a50b5; user_turn=true; assistant_turn=true; recent_context=true
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-evidence.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-snapshot.yml
  - http://127.0.0.1:8765/api/work-sessions/b4f4771a-9528-4b21-8663-d1cf645a50b5

### LMUX-03-03 업무대화 기본 UX

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: latency_ms=8723; response_time_observed=true
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-evidence.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-snapshot.yml
  - http://127.0.0.1:8765/api/work-sessions/b4f4771a-9528-4b21-8663-d1cf645a50b5

### LMUX-03-04 업무대화 기본 UX

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: markdown_render=provider=featherless; model=google/gemma-4-E2B-it; bullet_count=3; model_meta=false; policy_meta=false; thought_trace=false
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-evidence.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-snapshot.yml
  - http://127.0.0.1:8765/api/work-sessions/b4f4771a-9528-4b21-8663-d1cf645a50b5

### LMUX-03-10 업무대화 기본 UX

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: thought_trace=false; model_meta=false; policy_meta=false
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-evidence.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-snapshot.yml
  - http://127.0.0.1:8765/api/work-sessions/b4f4771a-9528-4b21-8663-d1cf645a50b5

### LMUX-05-01 일정 캘린더

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: calendar_ui: required=업무일정, 캘린더; ux=월, 주, 일
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml

### LMUX-06-01 파일찾기/세션 연결

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: file_search_ui: required=내장 파일찾기, 파일명 인덱스 갱신; ux=검색 범위, 파일 검색
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/file-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/file-search-ui-snapshot.yml

### LMUX-07-02 지식폴더/GraphRAG 인덱싱

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: knowledge_ui: required=내 지식폴더, GraphRAG; ux=지식 그래프, GraphRAG 검색
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-ui-snapshot.yml

### LMUX-09-02 문서작성/HWPX 산출

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: document_entry_ui: required=문서작성; ux=시행문, 이메일
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml

### LMUX-09-04 문서작성/HWPX 산출

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: document_official_template_ui: required=시행문; ux=문서작성
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml

### LMUX-09-05 문서작성/HWPX 산출

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: document_one_page_template_ui: required=1페이지; ux=문서작성
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml

### LMUX-10-01 실행기록/작업진행/다중작업

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: work_progress_observed=true
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-evidence.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-snapshot.yml
  - http://127.0.0.1:8765/api/work-sessions/b4f4771a-9528-4b21-8663-d1cf645a50b5

## 해석

- 이번 리포트는 Playwright 기반 실제 UI 조작으로 확인한 대표 시나리오만 점수화합니다.
- 전체 100개 시나리오 중 미실시 항목은 남아 있으므로, 이 리포트만으로 목표 완료를 선언하지 않습니다.
