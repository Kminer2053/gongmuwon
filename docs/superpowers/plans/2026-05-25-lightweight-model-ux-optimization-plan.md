# Lightweight Model UX Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경량 모델을 사용할 때도 로컬 AI에이전트 워크플레이스 : 공무원의 응답 품질, 도구 라우팅, 진행 피드백, 컴퓨터유즈 검증 가능성이 유지되도록 Gemma 4 E2B 중심 최적화와 점수화 테스트 체계를 구축한다.

**Architecture:** 모델별 런타임 정책은 sidecar의 LLM 호출 계층에서 결정하고, 사용자 경험 검증은 별도 시나리오 생성기가 JSON/Markdown 산출물로 제공한다. 앱 기능 자체는 기존 업무대화-일정-파일찾기-지식폴더-문서작성-실행기록 흐름을 유지하되, 경량모델에서 취약한 긴 추론, 도구선택, 환각, 내부추론 노출을 테스트와 가드레일로 고정한다.

**Tech Stack:** Python FastAPI sidecar, React/Tauri desktop, Node.js scenario generator, Vitest/pytest/Node assert tests, Codex in-app Browser computer-use validation.

---

## 1. 현재 완료된 기반

- Gemma 4 계열 모델 감지 함수가 추가됐다: `services/sidecar/src/gongmu_sidecar/llm.py`.
- Gemma 4 Ollama 요청에 `num_ctx=32768`, `temperature=1.0`, `top_k=65`, `top_p=0.95`, `repeat_penalty=1.0`, stop token이 적용된다.
- Gemma 4 thinking 출력인 `<|channel>thought ... <channel|>`가 일반 응답과 스트리밍 delta에서 제거된다.
- Gemma 4에서는 `/api/chat` 무응답 시 `/api/generate` plain-text fallback을 막는다.
- 로컬 기본 모델은 `gemma4:e2b`로 전환됐다.
- 검증 기록은 `docs/operations/2026-05-25-gemma4-e2b-optimization-implementation.md`에 남겼다.

## 2. 남은 핵심 보완 방향

1. **경량모델 정책 표면화**
   - 현재 정책은 `llm.py` 내부에 숨어 있다.
   - 후속 작업에서는 `/api/settings` 또는 별도 `/api/settings/llm-policy` 응답에 현재 모델의 권장 reasoning, fallback, multimodal, context, streaming 정책을 노출한다.

2. **도구 라우팅 품질 강화**
   - 현재 업무대화 도구 실행은 규칙 기반 intent routing과 일부 fallback에 의존한다.
   - Gemma 4 function calling 전환 전까지는 테스트 시나리오로 일정/지식검색/문서작성 라우팅 실패를 점수화한다.

3. **경량모델 답변 품질 방어**
   - 짧고 구조화된 Markdown, 출처 표시, 민감정보 마스킹, 내부추론 누출 방지를 시나리오 채점 항목으로 고정한다.

4. **컴퓨터유즈 기반 회귀 측정**
   - 단순 “통과/실패”가 아니라 기능별 점수와 UX 점수를 합산한다.
   - 사람이 수동 확인하거나 브라우저 자동화가 확인할 수 있도록 selector/hint/checkpoint를 함께 생성한다.

## 3. 파일 구조

- Create: `scripts/generate-lightweight-model-test-scenarios.mjs`
  - 경량모델/Gemma 4 E2B 기준 사용자 검증 시나리오를 생성한다.
  - JSON과 Markdown을 모두 출력한다.
  - 기본값은 10개 카테고리 × 카테고리별 10개 = 100개 시나리오다.

- Create: `scripts/generate-lightweight-model-test-scenarios.test.mjs`
  - 생성기 함수와 CLI 옵션을 Node assert로 검증한다.

- Modify: `package.json`
  - `qa:scenarios:lightweight` 스크립트를 추가해 생성기를 실행할 수 있게 한다.

- Create: `docs/operations/generated/lightweight-model-test-scenarios.json`
  - 생성된 컴퓨터유즈 테스트 시나리오 원본 데이터다.

- Create: `docs/operations/generated/lightweight-model-test-scenarios.md`
  - 사람이 읽고 직접 점검할 수 있는 Markdown 체크리스트다.

## 4. 채점 모델

각 시나리오는 10점 만점이다.

- `functional`: 기능 결과가 맞는가, 4점
- `ux`: 진행상태, 에러 메시지, 레이아웃, 조작감이 좋은가, 3점
- `modelQuality`: 경량모델 답변이 구조화되고 출처/도구/보안 원칙을 지키는가, 2점
- `evidence`: 컴퓨터유즈나 수동 점검에서 증거를 남기기 쉬운가, 1점

판정 기준:

- 9~10점: release-ready
- 7~8점: minor polish
- 5~6점: usable but needs fix
- 0~4점: blocker

## 5. 생성 시나리오 카테고리

1. 앱 시작과 업무엔진
2. 모델 설정과 Gemma 4 E2B
3. 업무대화 기본 UX
4. 업무대화 도구 라우팅
5. 일정 캘린더
6. 파일찾기와 세션 연결
7. 지식폴더/GraphRAG 인덱싱
8. GraphRAG 검색과 출처 답변
9. 문서작성/HWPX 산출
10. 실행기록/작업진행/다중작업

## 6. Task 1: 시나리오 생성기 TDD

**Files:**
- Create: `scripts/generate-lightweight-model-test-scenarios.test.mjs`
- Create: `scripts/generate-lightweight-model-test-scenarios.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from "node:assert/strict";
import { buildScenarioSet, renderScenarioMarkdown, scoreScenarioResult } from "./generate-lightweight-model-test-scenarios.mjs";

const scenarioSet = buildScenarioSet({ model: "gemma4:e2b", perCategory: 10 });

assert.equal(scenarioSet.scenarios.length, 100);
assert.equal(new Set(scenarioSet.scenarios.map((item) => item.category)).size, 10);
assert.ok(scenarioSet.scenarios.every((item) => item.maxScore === 10));
assert.ok(scenarioSet.scenarios.every((item) => item.computerUse.checkpoints.length >= 3));
assert.ok(renderScenarioMarkdown(scenarioSet).includes("Gemma 4 E2B"));
assert.equal(scoreScenarioResult({ functional: 4, ux: 3, modelQuality: 2, evidence: 1 }).score, 10);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node scripts/generate-lightweight-model-test-scenarios.test.mjs
```

Expected: FAIL with module not found or missing export.

- [ ] **Step 3: Write minimal implementation**

Implement:

- `buildScenarioSet({ model, perCategory })`
- `renderScenarioMarkdown(scenarioSet)`
- `scoreScenarioResult(scores)`
- CLI arguments:
  - `--model gemma4:e2b`
  - `--per-category 10`
  - `--out-dir docs/operations/generated`
  - `--format both`

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node scripts/generate-lightweight-model-test-scenarios.test.mjs
```

Expected: PASS and prints `lightweight model scenario generator checks passed`.

- [ ] **Step 5: Generate artifacts**

Run:

```powershell
node scripts/generate-lightweight-model-test-scenarios.mjs --model gemma4:e2b --per-category 10 --out-dir docs/operations/generated --format both
```

Expected:

- `docs/operations/generated/lightweight-model-test-scenarios.json`
- `docs/operations/generated/lightweight-model-test-scenarios.md`

## 7. Task 2: Package Script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add script**

```json
"qa:scenarios:lightweight": "node scripts/generate-lightweight-model-test-scenarios.mjs --model gemma4:e2b --per-category 10 --out-dir docs/operations/generated --format both"
```

- [ ] **Step 2: Verify script**

Run:

```powershell
npm.cmd run qa:scenarios:lightweight
```

Expected: generated JSON/Markdown paths are printed.

## 8. Task 3: Gemma 4 후속 코드 보완 후보

**Files:**
- Modify: `services/sidecar/src/gongmu_sidecar/llm.py`
- Modify: `services/sidecar/src/gongmu_sidecar/settings.py`
- Modify: `services/sidecar/tests/test_llm_ollama.py`

- [ ] **Step 1: Add failing tests for runtime policy**

Tests should prove:

- Gemma 4 E2B is classified as lightweight.
- Gemma 4 31B is classified as Gemma 4 but not E2B.
- Non-Gemma Ollama models keep legacy fallback.
- Current model policy includes `recommended_reasoning_effort`, `streaming_required`, `generate_fallback_enabled`.

- [ ] **Step 2: Implement model policy helper**

Add a small helper that returns model policy metadata without changing current runtime behavior.

- [ ] **Step 3: Expose policy in settings response**

Only expose read-only metadata; do not add new user-facing settings until UI design is confirmed.

## 9. 검증 게이트

Minimum verification for this phase:

```powershell
node scripts/generate-lightweight-model-test-scenarios.test.mjs
npm.cmd run qa:scenarios:lightweight
npm.cmd run sidecar:test
npm.cmd run desktop:test
```

Full release gate:

```powershell
npm.cmd run verify:all
```

## 10. 완료 기준

- 계획 문서가 저장되어 있다.
- 생성기 테스트가 RED → GREEN으로 검증되어 있다.
- 기본 생성 결과가 100개 이상의 구체적 시나리오를 포함한다.
- 각 시나리오가 컴퓨터유즈 점검 포인트와 10점 만점 채점 기준을 가진다.
- `qa:scenarios:lightweight`로 언제든 산출물을 재생성할 수 있다.
- Gemma 4 E2B 관련 기존 테스트가 계속 통과한다.
