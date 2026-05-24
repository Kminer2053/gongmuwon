# Gemma 4 E2B 최적화 적용 기록

작성일: 2026-05-25
대상 브랜치: `codex/gemma4-e2b-optimization`
기준 문서: `2026-05-23-gemma-small-model-optimization-report.md`

## 적용 범위

- 신규 로컬 기본 모델을 `gemma4:e2b`로 전환했다.
- Ollama Gemma 4 계열 모델 감지 시 권장 추론 옵션을 `/api/chat` 요청에 포함한다.
- Gemma 4 thinking 출력 형식인 `<|channel>thought ... <channel|>`이 최종 답변과 스트리밍 delta에 노출되지 않도록 제거한다.
- Gemma 4에서는 `/api/chat` 응답에 최종 assistant content가 없을 때 `/api/generate` plain-text fallback을 사용하지 않는다.
- Qwen 계열 등 기존 모델의 `reasoning_content` fallback과 `/api/generate` fallback은 유지했다.
- 업무대화 시스템 가드레일을 짧고 한국어 중심으로 정리했다.

## Gemma 4 Ollama 옵션

기본 옵션:

- `num_ctx`: `32768`
- `temperature`: `1.0`
- `top_k`: `65`
- `top_p`: `0.95`
- `repeat_penalty`: `1.0`
- `stop`: `<end_of_turn>`, `<start_of_turn>`

응답 길이 및 thinking 매핑:

- `auto` / `minimal`: `think=false`, `num_predict=1024`
- `low`: `think=false`, `num_predict=1536`
- `medium`: `think=true`, `num_predict=2560`
- `high`: `think=true`, `num_predict=4096`

## 검증 기준

- Gemma 4 E2B 요청 payload에 권장 `options`가 포함되어야 한다.
- `reasoning_effort=medium/high`에서만 `think=true`가 되어야 한다.
- Gemma 4의 `thinking` 필드는 사용자 답변으로 취급하지 않아야 한다.
- `<|channel>thought` 블록은 일반 응답과 스트리밍 응답 모두에서 사용자 화면에 노출되지 않아야 한다.
- Gemma 4 `/api/chat` 무응답 시 `/api/generate` fallback을 호출하지 않아야 한다.
- 기존 Qwen/Ollama fallback 동작은 깨지지 않아야 한다.

## 검증 결과

- `node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_bootstrap.py services/sidecar/tests/test_llm_ollama.py services/sidecar/tests/test_work_session_turn.py -q`
  - 결과: `47 passed`
- `npm.cmd run sidecar:test`
  - 결과: `225 passed`
- `npm.cmd run desktop:test`
  - 결과: `73 passed`

## 후속 작업

- Gemma 4 native function calling을 이용해 일정/지식검색/문서작성 라우팅을 정규식 fallback 중심에서 tool-calling 중심으로 전환한다.
- 이미지 입력 순서, visual token budget, 오디오 30초 입력 경로는 별도 스프린트에서 다룬다.
- `/api/settings/llm-test`를 한국어 응답, 이미지, tool calling, thinking 누출 방지까지 확인하는 능력 프로빙으로 확장한다.
- Ollama keep_alive, 모델 워밍, 전역 single-flight 큐는 런타임 안정화 작업과 묶어 진행한다.
