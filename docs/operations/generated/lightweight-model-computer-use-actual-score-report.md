# 경량모델 컴퓨터유즈 실제 점수 리포트

- 실행 ID: computer-use-actual-1779652698873
- 기준 모델: Gemma 4 E2B (gemma4:e2b)
- 평가 방식: playwright-computer-use
- 총점: 900 / 1000
- 실시: 90개
- 미실시: 10개
- 종합 등급: needs-work

## 카테고리별 점수

| 카테고리 | 실시 | 점수 | 등급 |
| --- | ---: | ---: | --- |
| 시작/업무엔진 | 6/10 | 60/100 | release-ready |
| 모델 설정/Gemma 4 E2B | 9/10 | 90/100 | release-ready |
| 업무대화 기본 UX | 9/10 | 90/100 | release-ready |
| 업무대화 도구 라우팅 | 8/10 | 80/100 | release-ready |
| 일정 캘린더 | 10/10 | 100/100 | release-ready |
| 파일찾기/세션 연결 | 10/10 | 100/100 | release-ready |
| 지식폴더/GraphRAG 인덱싱 | 10/10 | 100/100 | release-ready |
| GraphRAG 검색/출처 품질 | 10/10 | 100/100 | release-ready |
| 문서작성/HWPX 산출 | 10/10 | 100/100 | release-ready |
| 실행기록/작업진행/다중작업 | 8/10 | 80/100 | release-ready |

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

### LMUX-01-04 시작/업무엔진

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: refresh_session_retained=true
- 증거:
  - http://127.0.0.1:8765/health#status=ok
  - http://127.0.0.1:8765/api/jobs?limit=30
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/engine-popover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/engine-popover-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui.png

### LMUX-01-06 시작/업무엔진

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: status_popover=true
- 증거:
  - http://127.0.0.1:8765/health#status=ok
  - http://127.0.0.1:8765/api/jobs?limit=30
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/engine-popover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/engine-popover-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui.png

### LMUX-01-07 시작/업무엔진

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: long_job_recovered=true
- 증거:
  - http://127.0.0.1:8765/health#status=ok
  - http://127.0.0.1:8765/api/jobs?limit=30
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/engine-popover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/engine-popover-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui.png

### LMUX-01-09 시작/업무엔진

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: understandable_error=true
- 증거:
  - http://127.0.0.1:8765/health#status=ok
  - http://127.0.0.1:8765/api/jobs?limit=30
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/engine-popover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/engine-popover-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui.png

### LMUX-01-10 시작/업무엔진

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: compact_toolbar=true
- 증거:
  - http://127.0.0.1:8765/health#status=ok
  - http://127.0.0.1:8765/api/jobs?limit=30
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/engine-popover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/engine-popover-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui.png

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

### LMUX-02-02 모델 설정/Gemma 4 E2B

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: ollama_base_url_saved=true
- 증거:
  - http://127.0.0.1:8765/api/settings
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui.png
  - http://127.0.0.1:8765/api/settings#ollama-base-url-and-runtime-policy
  - docs/operations/generated/lightweight-model-computer-use-actual-score-report.json#LMUX-03-10
  - http://127.0.0.1:8765/api/settings/llm-test#status=200

### LMUX-02-03 모델 설정/Gemma 4 E2B

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: reasoning_low_recommended=true
- 증거:
  - http://127.0.0.1:8765/api/settings
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui.png
  - http://127.0.0.1:8765/api/settings#ollama-base-url-and-runtime-policy
  - docs/operations/generated/lightweight-model-computer-use-actual-score-report.json#LMUX-03-10
  - http://127.0.0.1:8765/api/settings/llm-test#status=200

### LMUX-02-04 모델 설정/Gemma 4 E2B

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: thinking_trace_clean=true
- 증거:
  - http://127.0.0.1:8765/api/settings
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui.png
  - http://127.0.0.1:8765/api/settings#ollama-base-url-and-runtime-policy
  - docs/operations/generated/lightweight-model-computer-use-actual-score-report.json#LMUX-03-10
  - http://127.0.0.1:8765/api/settings/llm-test#status=200

### LMUX-02-06 모델 설정/Gemma 4 E2B

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: featherless_active=true; active_matches_saved=true
- 증거:
  - http://127.0.0.1:8765/api/settings
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui.png
  - http://127.0.0.1:8765/api/settings#ollama-base-url-and-runtime-policy
  - docs/operations/generated/lightweight-model-computer-use-actual-score-report.json#LMUX-03-10
  - http://127.0.0.1:8765/api/settings/llm-test#status=200

### LMUX-02-07 모델 설정/Gemma 4 E2B

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: openrouter_profile_preserved=true
- 증거:
  - http://127.0.0.1:8765/api/settings
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui.png
  - http://127.0.0.1:8765/api/settings#ollama-base-url-and-runtime-policy
  - docs/operations/generated/lightweight-model-computer-use-actual-score-report.json#LMUX-03-10
  - http://127.0.0.1:8765/api/settings/llm-test#status=200

### LMUX-02-08 모델 설정/Gemma 4 E2B

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: api_key_masked=true; ui_masked=true; ui_key_not_visible=true
- 증거:
  - http://127.0.0.1:8765/api/settings
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui.png
  - http://127.0.0.1:8765/api/settings#ollama-base-url-and-runtime-policy
  - docs/operations/generated/lightweight-model-computer-use-actual-score-report.json#LMUX-03-10
  - http://127.0.0.1:8765/api/settings/llm-test#status=200

### LMUX-02-09 모델 설정/Gemma 4 E2B

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: connection_test_completed=true
- 증거:
  - http://127.0.0.1:8765/api/settings
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui.png
  - http://127.0.0.1:8765/api/settings#ollama-base-url-and-runtime-policy
  - docs/operations/generated/lightweight-model-computer-use-actual-score-report.json#LMUX-03-10
  - http://127.0.0.1:8765/api/settings/llm-test#status=200

### LMUX-02-10 모델 설정/Gemma 4 E2B

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: active_provider_matches_saved=true
- 증거:
  - http://127.0.0.1:8765/api/settings
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/settings-ui.png
  - http://127.0.0.1:8765/api/settings#ollama-base-url-and-runtime-policy
  - docs/operations/generated/lightweight-model-computer-use-actual-score-report.json#LMUX-03-10
  - http://127.0.0.1:8765/api/settings/llm-test#status=200

### LMUX-03-01 업무대화 기본 UX

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: session=b4f4771a-9528-4b21-8663-d1cf645a50b5; user_turn=true; assistant_turn=true; recent_context=true
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-evidence.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-snapshot.yml
  - http://127.0.0.1:8765/api/work-sessions/b4f4771a-9528-4b21-8663-d1cf645a50b5

### LMUX-03-02 업무대화 기본 UX

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: streaming_observed=true
- 증거:
  - http://127.0.0.1:8765/api/work-sessions/*/turn/stream
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-current-ui-snapshot.yml
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-settings-overlay-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-settings-overlay-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-attachment-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-attachment-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-image-preview-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-image-preview-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui-snapshot.yml

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

### LMUX-03-05 업무대화 기본 UX

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: scroll_bottom_preserved=true
- 증거:
  - http://127.0.0.1:8765/api/work-sessions/*/turn/stream
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-current-ui-snapshot.yml
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-settings-overlay-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-settings-overlay-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-attachment-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-attachment-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-image-preview-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-image-preview-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui-snapshot.yml

### LMUX-03-06 업무대화 기본 UX

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: image_thumbnail=true
- 증거:
  - http://127.0.0.1:8765/api/work-sessions/*/turn/stream
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-current-ui-snapshot.yml
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-settings-overlay-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-settings-overlay-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-attachment-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-attachment-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-image-preview-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-image-preview-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui-snapshot.yml

### LMUX-03-07 업무대화 기본 UX

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: attachment_cancel=true; large_preview=true
- 증거:
  - http://127.0.0.1:8765/api/work-sessions/*/turn/stream
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-current-ui-snapshot.yml
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-settings-overlay-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-settings-overlay-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-attachment-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-attachment-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-image-preview-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-image-preview-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui-snapshot.yml

### LMUX-03-08 업무대화 기본 UX

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: detail_settings_overlay=true
- 증거:
  - http://127.0.0.1:8765/api/work-sessions/*/turn/stream
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-current-ui-snapshot.yml
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-settings-overlay-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-settings-overlay-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-attachment-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-attachment-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-image-preview-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/chat-image-preview-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/reload-session-retained-ui-snapshot.yml

### LMUX-03-10 업무대화 기본 UX

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: thought_trace=false; model_meta=false; policy_meta=false
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-evidence.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-snapshot.yml
  - http://127.0.0.1:8765/api/work-sessions/b4f4771a-9528-4b21-8663-d1cf645a50b5

### LMUX-04-01 업무대화 도구 라우팅

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: schedule_created=true; title=AI ?? ?? ?? 1779648418544
- 증거:
  - http://127.0.0.1:8765/api/schedules#create=1c5711fb-a7a4-4c65-9d59-82f7f9f76244
  - http://127.0.0.1:8765/api/schedules#listed=true
  - http://127.0.0.1:8765/api/schedules/1c5711fb-a7a4-4c65-9d59-82f7f9f76244#deleted=true
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui.png

### LMUX-04-02 업무대화 도구 라우팅

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: schedule_listed=true; count=23
- 증거:
  - http://127.0.0.1:8765/api/schedules#create=1c5711fb-a7a4-4c65-9d59-82f7f9f76244
  - http://127.0.0.1:8765/api/schedules#listed=true
  - http://127.0.0.1:8765/api/schedules/1c5711fb-a7a4-4c65-9d59-82f7f9f76244#deleted=true
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui.png

### LMUX-04-03 업무대화 도구 라우팅

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: schedule_deleted=true; title=AI ?? ?? ?? 1779648418544
- 증거:
  - http://127.0.0.1:8765/api/schedules#create=1c5711fb-a7a4-4c65-9d59-82f7f9f76244
  - http://127.0.0.1:8765/api/schedules#listed=true
  - http://127.0.0.1:8765/api/schedules/1c5711fb-a7a4-4c65-9d59-82f7f9f76244#deleted=true
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui.png

### LMUX-04-04 업무대화 도구 라우팅

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: knowledge_searched=true; source_documents=5
- 증거:
  - http://127.0.0.1:8765/api/knowledge/ask
  - citations:5
  - source_paths:5
  - http://127.0.0.1:8765/api/knowledge/documents#partial-and-table-evidence
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png
  - http://127.0.0.1:8765/api/knowledge/ask#no-evidence-citations=0

### LMUX-04-05 업무대화 도구 라우팅

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: document_routed=true; format=onePageReport
- 증거:
  - http://127.0.0.1:8765/api/documents/generate
  - file://C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\documents\outputs\ai-work-report-1779648424867.hwpx
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png

### LMUX-04-06 업무대화 도구 라우팅

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: schedule_knowledge_combined=true
- 증거:
  - http://127.0.0.1:8765/api/work-sessions/e82374ff-a853-4f7e-b11a-dd837f54caf7/turn#actions=intent.plan,schedule.create,knowledge.search
  - http://127.0.0.1:8765/api/work-sessions/e82374ff-a853-4f7e-b11a-dd837f54caf7/turn#help.guide
  - actual-input://내일 오후 2시 회의 일정 등록하고 지식폴더에서 프롬프트 관련 자료 찾아줘
  - actual-input://업무대화랑 파일찾기 사용법 안내해줄래?
  - actual-input://파일찾기는 어떻게 써?

### LMUX-04-07 업무대화 도구 라우팅

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: file_search_guidance=true
- 증거:
  - http://127.0.0.1:8765/api/work-sessions/e82374ff-a853-4f7e-b11a-dd837f54caf7/turn#actions=intent.plan,schedule.create,knowledge.search
  - http://127.0.0.1:8765/api/work-sessions/e82374ff-a853-4f7e-b11a-dd837f54caf7/turn#help.guide
  - actual-input://내일 오후 2시 회의 일정 등록하고 지식폴더에서 프롬프트 관련 자료 찾아줘
  - actual-input://업무대화랑 파일찾기 사용법 안내해줄래?
  - actual-input://파일찾기는 어떻게 써?

### LMUX-04-08 업무대화 도구 라우팅

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: feature_help=true
- 증거:
  - http://127.0.0.1:8765/api/work-sessions/e82374ff-a853-4f7e-b11a-dd837f54caf7/turn#actions=intent.plan,schedule.create,knowledge.search
  - http://127.0.0.1:8765/api/work-sessions/e82374ff-a853-4f7e-b11a-dd837f54caf7/turn#help.guide
  - actual-input://내일 오후 2시 회의 일정 등록하고 지식폴더에서 프롬프트 관련 자료 찾아줘
  - actual-input://업무대화랑 파일찾기 사용법 안내해줄래?
  - actual-input://파일찾기는 어떻게 써?

### LMUX-05-01 일정 캘린더

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: calendar_ui: required=업무일정, 캘린더; ux=월, 주, 일
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml

### LMUX-05-02 일정 캘린더

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: week_view=true
- 증거:
  - http://127.0.0.1:8765/api/schedules#create=1c5711fb-a7a4-4c65-9d59-82f7f9f76244
  - http://127.0.0.1:8765/api/schedules#listed=true
  - http://127.0.0.1:8765/api/schedules/1c5711fb-a7a4-4c65-9d59-82f7f9f76244#deleted=true
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui.png

### LMUX-05-03 일정 캘린더

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: day_time_registration=true; starts_at=2026-05-26T01:00:00.000Z
- 증거:
  - http://127.0.0.1:8765/api/schedules#create=1c5711fb-a7a4-4c65-9d59-82f7f9f76244
  - http://127.0.0.1:8765/api/schedules#listed=true
  - http://127.0.0.1:8765/api/schedules/1c5711fb-a7a4-4c65-9d59-82f7f9f76244#deleted=true
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui.png

### LMUX-05-04 일정 캘린더

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: long_title_ellipsized=true
- 증거:
  - http://127.0.0.1:8765/api/schedules#create=1c5711fb-a7a4-4c65-9d59-82f7f9f76244
  - http://127.0.0.1:8765/api/schedules#listed=true
  - http://127.0.0.1:8765/api/schedules/1c5711fb-a7a4-4c65-9d59-82f7f9f76244#deleted=true
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui.png

### LMUX-05-05 일정 캘린더

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: hover_details=true
- 증거:
  - http://127.0.0.1:8765/api/schedules#create=1c5711fb-a7a4-4c65-9d59-82f7f9f76244
  - http://127.0.0.1:8765/api/schedules#listed=true
  - http://127.0.0.1:8765/api/schedules/1c5711fb-a7a4-4c65-9d59-82f7f9f76244#deleted=true
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui.png

### LMUX-05-06 일정 캘린더

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: updated_then_created=true
- 증거:
  - http://127.0.0.1:8765/api/schedules#create=1c5711fb-a7a4-4c65-9d59-82f7f9f76244
  - http://127.0.0.1:8765/api/schedules#listed=true
  - http://127.0.0.1:8765/api/schedules/1c5711fb-a7a4-4c65-9d59-82f7f9f76244#deleted=true
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui.png

### LMUX-05-07 일정 캘린더

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: linked_session_opened=true
- 증거:
  - http://127.0.0.1:8765/api/schedules#create=1c5711fb-a7a4-4c65-9d59-82f7f9f76244
  - http://127.0.0.1:8765/api/schedules#listed=true
  - http://127.0.0.1:8765/api/schedules/1c5711fb-a7a4-4c65-9d59-82f7f9f76244#deleted=true
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui.png

### LMUX-05-08 일정 캘린더

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: today_navigation=true
- 증거:
  - http://127.0.0.1:8765/api/schedules#create=1c5711fb-a7a4-4c65-9d59-82f7f9f76244
  - http://127.0.0.1:8765/api/schedules#listed=true
  - http://127.0.0.1:8765/api/schedules/1c5711fb-a7a4-4c65-9d59-82f7f9f76244#deleted=true
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui.png

### LMUX-05-09 일정 캘린더

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: period_navigation=true
- 증거:
  - http://127.0.0.1:8765/api/schedules#create=1c5711fb-a7a4-4c65-9d59-82f7f9f76244
  - http://127.0.0.1:8765/api/schedules#listed=true
  - http://127.0.0.1:8765/api/schedules/1c5711fb-a7a4-4c65-9d59-82f7f9f76244#deleted=true
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui.png

### LMUX-05-10 일정 캘린더

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: delete_reflected=true
- 증거:
  - http://127.0.0.1:8765/api/schedules#create=1c5711fb-a7a4-4c65-9d59-82f7f9f76244
  - http://127.0.0.1:8765/api/schedules#listed=true
  - http://127.0.0.1:8765/api/schedules/1c5711fb-a7a4-4c65-9d59-82f7f9f76244#deleted=true
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-hover-ui.png

### LMUX-06-01 파일찾기/세션 연결

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: file_search_ui: required=내장 파일찾기, 파일명 인덱스 갱신; ux=검색 범위, 파일 검색
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/file-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/file-search-ui-snapshot.yml

### LMUX-06-02 파일찾기/세션 연결

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: exact_search=true; result_count=5
- 증거:
  - http://127.0.0.1:8766/api/files/search?query=gongmu
  - http://127.0.0.1:8766/api/files/search?query=read
  - http://127.0.0.1:8766/api/files/search?query=zzzzzznotfound_1779649064097
  - http://127.0.0.1:8766/api/work-sessions/*/file-links

### LMUX-06-03 파일찾기/세션 연결

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: partial_search=true; result_count=5
- 증거:
  - http://127.0.0.1:8766/api/files/search?query=gongmu
  - http://127.0.0.1:8766/api/files/search?query=read
  - http://127.0.0.1:8766/api/files/search?query=zzzzzznotfound_1779649064097
  - http://127.0.0.1:8766/api/work-sessions/*/file-links

### LMUX-06-04 파일찾기/세션 연결

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: result_selected=true; preview=true
- 증거:
  - http://127.0.0.1:8766/api/files/search?query=gongmu
  - http://127.0.0.1:8766/api/files/search?query=read
  - http://127.0.0.1:8766/api/files/search?query=zzzzzznotfound_1779649064097
  - http://127.0.0.1:8766/api/work-sessions/*/file-links

### LMUX-06-05 파일찾기/세션 연결

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: preview_shown=true
- 증거:
  - http://127.0.0.1:8766/api/files/search?query=gongmu
  - http://127.0.0.1:8766/api/files/search?query=read
  - http://127.0.0.1:8766/api/files/search?query=zzzzzznotfound_1779649064097
  - http://127.0.0.1:8766/api/work-sessions/*/file-links

### LMUX-06-06 파일찾기/세션 연결

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: path_copied=true
- 증거:
  - http://127.0.0.1:8766/api/files/search?query=gongmu
  - http://127.0.0.1:8766/api/files/search?query=read
  - http://127.0.0.1:8766/api/files/search?query=zzzzzznotfound_1779649064097
  - http://127.0.0.1:8766/api/work-sessions/*/file-links

### LMUX-06-07 파일찾기/세션 연결

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: linked_to_session=true; linked_file_count=1
- 증거:
  - http://127.0.0.1:8766/api/files/search?query=gongmu
  - http://127.0.0.1:8766/api/files/search?query=read
  - http://127.0.0.1:8766/api/files/search?query=zzzzzznotfound_1779649064097
  - http://127.0.0.1:8766/api/work-sessions/*/file-links

### LMUX-06-08 파일찾기/세션 연결

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: linked_file_count=1
- 증거:
  - http://127.0.0.1:8766/api/files/search?query=gongmu
  - http://127.0.0.1:8766/api/files/search?query=read
  - http://127.0.0.1:8766/api/files/search?query=zzzzzznotfound_1779649064097
  - http://127.0.0.1:8766/api/work-sessions/*/file-links

### LMUX-06-09 파일찾기/세션 연결

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: linked_list_closable=true
- 증거:
  - http://127.0.0.1:8766/api/files/search?query=gongmu
  - http://127.0.0.1:8766/api/files/search?query=read
  - http://127.0.0.1:8766/api/files/search?query=zzzzzznotfound_1779649064097
  - http://127.0.0.1:8766/api/work-sessions/*/file-links

### LMUX-06-10 파일찾기/세션 연결

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: empty_state=true
- 증거:
  - http://127.0.0.1:8766/api/files/search?query=gongmu
  - http://127.0.0.1:8766/api/files/search?query=read
  - http://127.0.0.1:8766/api/files/search?query=zzzzzznotfound_1779649064097
  - http://127.0.0.1:8766/api/work-sessions/*/file-links

### LMUX-07-01 지식폴더/GraphRAG 인덱싱

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: source_registered=true; source_count=4
- 증거:
  - http://127.0.0.1:8765/api/knowledge/sources#count=4
  - http://127.0.0.1:8765/api/knowledge/ingestion-jobs#completed-and-canceled
  - http://127.0.0.1:8765/api/knowledge/documents#count=23
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png

### LMUX-07-02 지식폴더/GraphRAG 인덱싱

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: knowledge_ui: required=내 지식폴더, GraphRAG; ux=지식 그래프, GraphRAG 검색
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-ui-snapshot.yml

### LMUX-07-03 지식폴더/GraphRAG 인덱싱

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: scan_progress=true
- 증거:
  - http://127.0.0.1:8765/api/knowledge/sources#count=4
  - http://127.0.0.1:8765/api/knowledge/ingestion-jobs#completed-and-canceled
  - http://127.0.0.1:8765/api/knowledge/documents#count=23
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png

### LMUX-07-04 지식폴더/GraphRAG 인덱싱

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: ingestion_progress=true; progress=100
- 증거:
  - http://127.0.0.1:8765/api/knowledge/sources#count=4
  - http://127.0.0.1:8765/api/knowledge/ingestion-jobs#completed-and-canceled
  - http://127.0.0.1:8765/api/knowledge/documents#count=23
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png

### LMUX-07-05 지식폴더/GraphRAG 인덱싱

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: duplicate_work_locked=true
- 증거:
  - http://127.0.0.1:8765/api/knowledge/sources#count=4
  - http://127.0.0.1:8765/api/knowledge/ingestion-jobs#completed-and-canceled
  - http://127.0.0.1:8765/api/knowledge/documents#count=23
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png

### LMUX-07-06 지식폴더/GraphRAG 인덱싱

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: cancel_observed=true
- 증거:
  - http://127.0.0.1:8765/api/knowledge/sources#count=4
  - http://127.0.0.1:8765/api/knowledge/ingestion-jobs#completed-and-canceled
  - http://127.0.0.1:8765/api/knowledge/documents#count=23
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png

### LMUX-07-07 지식폴더/GraphRAG 인덱싱

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: dump_viewer=true
- 증거:
  - http://127.0.0.1:8765/api/knowledge/sources#count=4
  - http://127.0.0.1:8765/api/knowledge/ingestion-jobs#completed-and-canceled
  - http://127.0.0.1:8765/api/knowledge/documents#count=23
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png

### LMUX-07-08 지식폴더/GraphRAG 인덱싱

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: structure_view=true
- 증거:
  - http://127.0.0.1:8765/api/knowledge/sources#count=4
  - http://127.0.0.1:8765/api/knowledge/ingestion-jobs#completed-and-canceled
  - http://127.0.0.1:8765/api/knowledge/documents#count=23
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png

### LMUX-07-09 지식폴더/GraphRAG 인덱싱

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: partial_warning=true
- 증거:
  - http://127.0.0.1:8765/api/knowledge/sources#count=4
  - http://127.0.0.1:8765/api/knowledge/ingestion-jobs#completed-and-canceled
  - http://127.0.0.1:8765/api/knowledge/documents#count=23
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png

### LMUX-07-10 지식폴더/GraphRAG 인덱싱

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: completed_count_drilldown=true; completed_documents=23
- 증거:
  - http://127.0.0.1:8765/api/knowledge/sources#count=4
  - http://127.0.0.1:8765/api/knowledge/ingestion-jobs#completed-and-canceled
  - http://127.0.0.1:8765/api/knowledge/documents#count=23
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-status-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-indexing-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-dump-viewer-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-documents-detail-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png

### LMUX-08-01 GraphRAG 검색/출처 품질

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: search_result_count=5
- 증거:
  - http://127.0.0.1:8765/api/knowledge/ask
  - citations:5
  - source_paths:5
  - http://127.0.0.1:8765/api/knowledge/documents#partial-and-table-evidence
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png
  - http://127.0.0.1:8765/api/knowledge/ask#no-evidence-citations=0

### LMUX-08-02 GraphRAG 검색/출처 품질

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: grounded_answer_chars=674
- 증거:
  - http://127.0.0.1:8765/api/knowledge/ask
  - citations:5
  - source_paths:5
  - http://127.0.0.1:8765/api/knowledge/documents#partial-and-table-evidence
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png
  - http://127.0.0.1:8765/api/knowledge/ask#no-evidence-citations=0

### LMUX-08-03 GraphRAG 검색/출처 품질

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: source_document_count=5
- 증거:
  - http://127.0.0.1:8765/api/knowledge/ask
  - citations:5
  - source_paths:5
  - http://127.0.0.1:8765/api/knowledge/documents#partial-and-table-evidence
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png
  - http://127.0.0.1:8765/api/knowledge/ask#no-evidence-citations=0

### LMUX-08-04 GraphRAG 검색/출처 품질

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: source_path_count=5
- 증거:
  - http://127.0.0.1:8765/api/knowledge/ask
  - citations:5
  - source_paths:5
  - http://127.0.0.1:8765/api/knowledge/documents#partial-and-table-evidence
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png
  - http://127.0.0.1:8765/api/knowledge/ask#no-evidence-citations=0

### LMUX-08-05 GraphRAG 검색/출처 품질

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: low_quality_warning=true
- 증거:
  - http://127.0.0.1:8765/api/knowledge/ask
  - citations:5
  - source_paths:5
  - http://127.0.0.1:8765/api/knowledge/documents#partial-and-table-evidence
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png
  - http://127.0.0.1:8765/api/knowledge/ask#no-evidence-citations=0

### LMUX-08-06 GraphRAG 검색/출처 품질

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: relation_drilldown=true
- 증거:
  - http://127.0.0.1:8765/api/knowledge/ask
  - citations:5
  - source_paths:5
  - http://127.0.0.1:8765/api/knowledge/documents#partial-and-table-evidence
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png
  - http://127.0.0.1:8765/api/knowledge/ask#no-evidence-citations=0

### LMUX-08-07 GraphRAG 검색/출처 품질

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: graph_node_clicked=true
- 증거:
  - http://127.0.0.1:8765/api/knowledge/ask
  - citations:5
  - source_paths:5
  - http://127.0.0.1:8765/api/knowledge/documents#partial-and-table-evidence
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png
  - http://127.0.0.1:8765/api/knowledge/ask#no-evidence-citations=0

### LMUX-08-08 GraphRAG 검색/출처 품질

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: table_evidence=true
- 증거:
  - http://127.0.0.1:8765/api/knowledge/ask
  - citations:5
  - source_paths:5
  - http://127.0.0.1:8765/api/knowledge/documents#partial-and-table-evidence
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png
  - http://127.0.0.1:8765/api/knowledge/ask#no-evidence-citations=0

### LMUX-08-09 GraphRAG 검색/출처 품질

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: session_knowledge_search=true
- 증거:
  - http://127.0.0.1:8765/api/knowledge/ask
  - citations:5
  - source_paths:5
  - http://127.0.0.1:8765/api/knowledge/documents#partial-and-table-evidence
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png
  - http://127.0.0.1:8765/api/knowledge/ask#no-evidence-citations=0

### LMUX-08-10 GraphRAG 검색/출처 품질

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: no_evidence_graceful=true
- 증거:
  - http://127.0.0.1:8765/api/knowledge/ask
  - citations:5
  - source_paths:5
  - http://127.0.0.1:8765/api/knowledge/documents#partial-and-table-evidence
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-graph-node-click-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-search-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-structure-view-ui.png
  - http://127.0.0.1:8765/api/knowledge/ask#no-evidence-citations=0

### LMUX-09-01 문서작성/HWPX 산출

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: from_session_handoff=true
- 증거:
  - http://127.0.0.1:8765/api/documents/generate
  - file://C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\documents\outputs\ai-work-report-1779648424867.hwpx
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png

### LMUX-09-02 문서작성/HWPX 산출

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: document_entry_ui: required=문서작성; ux=시행문, 이메일
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml

### LMUX-09-03 문서작성/HWPX 산출

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: linked_file_usage=true
- 증거:
  - http://127.0.0.1:8765/api/documents/generate
  - file://C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\documents\outputs\ai-work-report-1779648424867.hwpx
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png

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

### LMUX-09-06 문서작성/HWPX 산출

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: full_report_type=true
- 증거:
  - http://127.0.0.1:8765/api/documents/generate
  - file://C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\documents\outputs\ai-work-report-1779648424867.hwpx
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png

### LMUX-09-07 문서작성/HWPX 산출

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: email_type=true
- 증거:
  - http://127.0.0.1:8765/api/documents/generate
  - file://C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\documents\outputs\ai-work-report-1779648424867.hwpx
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png

### LMUX-09-08 문서작성/HWPX 산출

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: custom_template=true
- 증거:
  - http://127.0.0.1:8765/api/documents/generate
  - file://C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\documents\outputs\ai-work-report-1779648424867.hwpx
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png

### LMUX-09-09 문서작성/HWPX 산출

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: document_generated=true; output_path=C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\documents\outputs\ai-work-report-1779648424867.hwpx
- 증거:
  - http://127.0.0.1:8765/api/documents/generate
  - file://C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\documents\outputs\ai-work-report-1779648424867.hwpx
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png

### LMUX-09-10 문서작성/HWPX 산출

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: open_link=true; output_path=C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\documents\outputs\ai-work-report-1779648424867.hwpx
- 증거:
  - http://127.0.0.1:8765/api/documents/generate
  - file://C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\documents\outputs\ai-work-report-1779648424867.hwpx
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png

### LMUX-10-01 실행기록/작업진행/다중작업

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: work_progress_observed=true
- 증거:
  - screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-evidence.png
  - snapshot://docs/operations/generated/lightweight-model-computer-use-evidence/gongmu-lightweight-ui-snapshot.yml
  - http://127.0.0.1:8765/api/work-sessions/b4f4771a-9528-4b21-8663-d1cf645a50b5

### LMUX-10-02 실행기록/작업진행/다중작업

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: job_detail=true
- 증거:
  - http://127.0.0.1:8765/api/jobs?limit=30
  - http://127.0.0.1:8765/api/jobs/d0a93a5d-bc5a-473b-8c85-af02f679eb79/events
  - http://127.0.0.1:8765/api/execution-logs?limit=20

### LMUX-10-03 실행기록/작업진행/다중작업

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: long_job_navigation_safe=true
- 증거:
  - http://127.0.0.1:8765/api/jobs?limit=30
  - http://127.0.0.1:8765/api/jobs/d0a93a5d-bc5a-473b-8c85-af02f679eb79/events
  - http://127.0.0.1:8765/api/execution-logs?limit=20

### LMUX-10-05 실행기록/작업진행/다중작업

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: parallel_different_resources=true
- 증거:
  - http://127.0.0.1:8765/api/jobs?limit=30
  - http://127.0.0.1:8765/api/jobs/d0a93a5d-bc5a-473b-8c85-af02f679eb79/events
  - http://127.0.0.1:8765/api/execution-logs?limit=20

### LMUX-10-07 실행기록/작업진행/다중작업

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: retry_guidance=true
- 증거:
  - http://127.0.0.1:8765/api/jobs?limit=30
  - http://127.0.0.1:8765/api/jobs/d0a93a5d-bc5a-473b-8c85-af02f679eb79/events
  - http://127.0.0.1:8765/api/execution-logs?limit=20

### LMUX-10-08 실행기록/작업진행/다중작업

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: artifact_openable=true
- 증거:
  - http://127.0.0.1:8765/api/jobs?limit=30
  - http://127.0.0.1:8765/api/jobs/d0a93a5d-bc5a-473b-8c85-af02f679eb79/events
  - http://127.0.0.1:8765/api/execution-logs?limit=20

### LMUX-10-09 실행기록/작업진행/다중작업

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: log_copied=true
- 증거:
  - http://127.0.0.1:8765/api/jobs?limit=30
  - http://127.0.0.1:8765/api/jobs/d0a93a5d-bc5a-473b-8c85-af02f679eb79/events
  - http://127.0.0.1:8765/api/execution-logs?limit=20

### LMUX-10-10 실행기록/작업진행/다중작업

- 상태: 통과
- 점수: 10 / 10
- 등급: release-ready
- 메모: right_panel_stable=true
- 증거:
  - http://127.0.0.1:8765/api/jobs?limit=30
  - http://127.0.0.1:8765/api/jobs/d0a93a5d-bc5a-473b-8c85-af02f679eb79/events
  - http://127.0.0.1:8765/api/execution-logs?limit=20

## 해석

- 이번 리포트는 Playwright 기반 실제 UI 조작으로 확인한 대표 시나리오만 점수화합니다.
- 전체 100개 시나리오 중 미실시 항목은 남아 있으므로, 이 리포트만으로 목표 완료를 선언하지 않습니다.
