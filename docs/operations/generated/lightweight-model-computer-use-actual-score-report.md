# 경량모델 컴퓨터유즈 실제 점수 리포트

- 실행 ID: computer-use-actual-1779647340572
- 기준 모델: Gemma 4 E2B (gemma4:e2b)
- 평가 방식: playwright-computer-use
- 총점: 70 / 1000
- 실시: 7개
- 미실시: 93개
- 종합 등급: needs-work

## 카테고리별 점수

| 카테고리 | 실시 | 점수 | 등급 |
| --- | ---: | ---: | --- |
| 시작/업무엔진 | 1/10 | 10/100 | release-ready |
| 모델 설정/Gemma 4 E2B | 1/10 | 10/100 | release-ready |
| 업무대화 기본 UX | 4/10 | 40/100 | release-ready |
| 업무대화 도구 라우팅 | 0/10 | 0/100 | not-tested |
| 일정 캘린더 | 0/10 | 0/100 | not-tested |
| 파일찾기/세션 연결 | 0/10 | 0/100 | not-tested |
| 지식폴더/GraphRAG 인덱싱 | 0/10 | 0/100 | not-tested |
| GraphRAG 검색/출처 품질 | 0/10 | 0/100 | not-tested |
| 문서작성/HWPX 산출 | 0/10 | 0/100 | not-tested |
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
