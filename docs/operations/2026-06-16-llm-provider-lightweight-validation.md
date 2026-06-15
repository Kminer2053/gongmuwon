# 2026-06-16 LLM 공급자 및 경량모델 UX 검증

## 목적

G08 `LLM 공급자 설정, 로컬/폐쇄망 모델, 안전 가드레일` gate를 최신 코드 기준으로 재검증했다.

## 검증 범위

- Featherless API preset이 공식 OpenAI 호환 값으로 표시되는지 확인
- 공급자별 endpoint, API key, model, site URL, application name 저장 흐름 확인
- LLM 연결 테스트 실패가 실행기록과 UI에서 사용자가 이해 가능한 메시지로 표시되는지 확인
- Gemma 4 E2B 같은 경량모델 라우팅 성공률과 API 응답 latency를 점수화
- Gemma 4 계열의 `/api/generate` fallback 비활성화와 thinking/policy trace 제거 기준 확인

## 실행 명령

```powershell
npm.cmd run qa:test:lightweight
npm.cmd run qa:scenarios:lightweight
npm.cmd run qa:score:lightweight
npm.cmd run qa:measure:lightweight
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_llm_providers.py services/sidecar/tests/test_llm_ollama.py services/sidecar/tests/test_settings_profiles.py services/sidecar/tests/test_work_session_turn.py::test_llm_connection_test_returns_failure_result -q
npm.cmd --workspace apps/desktop run test -- settings-edit.test.tsx executionLogDisplay.test.ts
```

## 결과

- `qa:test:lightweight`: 통과
- 경량모델 UX 측정: `929/1000`, `minor-polish`
- 라우팅 측정: `30/30`, 성공률 `100.0%`
- latency 측정: `6/7` 통과, pass rate `85.7%`
- 실패한 latency 항목: 빈 로컬 파일검색 p95 `1927ms`, threshold `1500ms`
- sidecar LLM/provider/settings 테스트: `36 passed`
- desktop 설정/실행기록 테스트: `7 passed`

## 해석

- Featherless 403은 코드 문제가 아니라 공급자 구독 플랜의 API 접근 제한이며, 앱은 Featherless를 OpenAI 호환 Chat Completions 공급자로 저장/표시할 수 있다.
- LLM 연결 실패는 `settings.llm.test.failed` 실행기록과 `LLM 연결 테스트 실패` 사용자 문구로 표시된다.
- `lightweight-model-test-score-report.json`은 100개 수동 UX 시나리오용 보조 리포트라서, G08 판정은 `lightweight-model-ux-quality-measurement.json`의 routing/latency 점수를 주 근거로 삼는다.
- 빈 파일검색 latency는 전체 PC fallback이 남아 있는 일반 검색 케이스의 polish 항목이며, GraphRAG 인제스트 중 병렬작업 병목은 `2026-06-16-runtime-concurrency-validation.md`에서 별도로 해소했다.

## 산출물

- `docs/operations/generated/lightweight-model-ux-quality-measurement.json`
- `docs/operations/generated/lightweight-model-ux-quality-measurement.md`
