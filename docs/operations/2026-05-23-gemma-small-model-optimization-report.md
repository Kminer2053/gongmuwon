# Google Gemma 4 E2B (2026-04 출시, 멀티모달 엣지 모델) 최적화 개선 보고서

작성일: 2026-05-23
대상 저장소: `Agent_Gongmu_Codex`
브랜치: `claude/jolly-edison-Kr4Cx`
대상 모델: **Google Gemma 4 E2B** (2026-04 출시). 모바일/노트북 등 엣지 환경 대상의 멀티모달(텍스트+이미지) 소형 변형. 본 보고서에서는 다음 특성으로 가정함.

- 약 **2B effective parameters** (E2B = "Effective 2B", per-layer embedding로 실 메모리 ~3GB대)
- **Ollama 서빙**(예: `gemma4:e2b`) 또는 OpenAI 호환 endpoint 가능
- **멀티모달 입력**(이미지 1장 권장, 256/512/768 픽셀 권장)
- **컨텍스트 윈도우 ≈8K 토큰**(Gemma 3n E2B 계보 그대로일 경우 32K까지 가능하지만 안전선 8K로 가정)
- **약한 한국어 능력 / 약한 구조화(JSON·표) 출력**(소형 멀티모달 공통 한계)
- **thinking 미지원** (Gemma 계열 native reasoning 없음)

실제 모델 능력(컨텍스트 윈도우·한국어 토크나이저·툴콜 지원 여부)이 위 가정과 다를 경우 §4.4 "모델 가정 영향도" 표대로만 보정하면 본 보고서의 개선 항목은 그대로 유효함.

---

## 0. 한 줄 요약

현재 코드베이스는 **GPT-4 / Claude / Qwen 27B 같은 대형/중형 모델을 기본 전제로 설계**되어 있어, 시스템 프롬프트·GraphRAG 컨텍스트·이중 라우팅(규칙+LLM)·`max_tokens` 일괄값·reasoning 트레이스 제거 로직이 2B급 모델에서는 비효율적이거나 품질을 무너뜨림. 핵심 개선축은 ① **컨텍스트 예산 관리**, ② **Ollama 호출 옵션 노출**, ③ **프롬프트 슬림화/한국어 few-shot**, ④ **소형 모델 전용 라우팅 프로파일**, ⑤ **멀티모달/스트리밍/세션 안정화** 다섯 가지임.

---

## 1. 프로젝트 구조·동작 파악 (1번 작업 결과)

`README.md`와 `docs/operations/2026-05-23-codebase-review-dossier.md`를 종합한 골격:

- **데스크톱 UI**: `apps/desktop/src/app.tsx` 단일 거대 파일 (≈8.4K LOC)에서 모든 섹션(업무대화·일정·파일찾기·지식폴더·문서작성·실행기록) 렌더링.
- **업무엔진**: `services/sidecar/src/gongmu_sidecar/app.py` (≈3.6K LOC). FastAPI 라우터 + 비즈니스 로직 + 의도 라우팅 + 가드레일이 한 클래스에 결합.
- **LLM 계층**: `llm.py` (≈900 LOC)가 Ollama / OpenAI / Anthropic / Gemini / OpenRouter / NIM 6개 provider 호출 통합. Ollama는 `_looks_like_ollama_native()`로 native API(`/api/chat`, `/api/generate`)와 OpenAI 호환 API 분기.
- **데이터**: SQLite WAL + write-lock + `work_jobs` 기반 작업 큐. ChromaDB는 옵션.
- **GraphRAG**: `graphrag_ingestion.py`의 `SECTION_CHUNK_MAX_CHARS = 4000`, `SECTION_CHUNK_OVERLAP_CHARS = 250`. 검색은 `_build_graphrag_prompt_block()`에서 최대 5건, chunk당 700자 컷.
- **임베딩**: `nomic-embed-text` (Ollama) 기본, 환경변수 `GONGMU_EMBEDDING_TIMEOUT_SECONDS`.
- **의도 라우팅**: `_try_run_work_session_skill()` → `_plan_work_session_intents()` → 정규식 기반(`_looks_like_*`) → fallback으로 LLM 호출. **LLM intent classifier 미구현** (도시에서 한계로 명시됨).
- **가드레일 프롬프트**: `_chat_guardrail_prompt()` 약 8줄 한국어 + GraphRAG 블록(최대 5×약 800자) → 매 턴 system에 주입.
- **추론 트레이스 제거**: `_strip_assistant_reasoning_trace()`에서 `<think>`, `<reasoning>` 태그와 영문 bullet 패턴 23종 하드코딩 제거.

---

## 2. 코드베이스 리뷰: 소형 모델 관점에서의 위험 지점 (2번 작업 결과)

| # | 위치 | 현 상태 | 소형 모델에서의 문제 |
|---|---|---|---|
| R1 | `llm.py:743-750` `_generate_anthropic_reply` | `max_tokens=1024` 고정, **Ollama/OpenAI/Gemini 경로엔 max_tokens 미설정** | gemma3n은 `num_predict` 기본값(~128) 또는 무제한으로 길게 끌고 가다 컨텍스트 초과 → 응답 잘림 또는 OOM |
| R2 | `llm.py:627-660` `_generate_ollama_reply` payload | `model`, `messages`, `stream`, `think`만 전달. `options`(num_ctx, num_predict, temperature, top_p, repeat_penalty, stop) 없음 | 기본 num_ctx=2048에서 시스템 프롬프트+GraphRAG+히스토리가 즉시 잘림. 한국어 반복(루프) 방지 불가 |
| R3 | `llm.py:640,651,677,703` `think` 파라미터 | `reasoning_effort in {medium, high}`이면 `think=True` 강제 전송 | gemma3n은 native thinking 미지원 → Ollama가 옵션 무시하거나(베타) 빈 출력. UI에서 "사고" 토글이 작동 안 함 |
| R4 | `app.py:938-950` `_chat_guardrail_prompt()` | 8줄 가드레일을 매 턴 system 메시지로 주입 | 약 350~450 token. 2B 모델 8K 컨텍스트에서 GraphRAG+히스토리 합치면 4K↑ → 실제 추론 가용분 급감, 지시사항 끝부분만 follow |
| R5 | `app.py:952-1003` `_build_graphrag_prompt_block()` | 5건 × 700자 chunk + 메타데이터 → 최대 ≈5K char (≈2K token) 추가 | 소형 모델에서는 컨텍스트 폭발의 주범. 또한 5개 chunk 비교/요약은 2B 능력 한계 초과 — 환각 발생 |
| R6 | `graphrag_ingestion.py:32-33` `SECTION_CHUNK_MAX_CHARS=4000` | 4K char(≈1.5K token) 단일 chunk | 소형 모델 retrieval-augmented 시점에서 1 chunk가 시스템 프롬프트보다 큼. 검색 정밀도 저하, 토큰 낭비 |
| R7 | `app.py:1005-1052` intent planner | 모두 **정규식**(`_looks_like_*`). 다중 의도는 `_plan_work_session_intents()`가 순차 실행 | 소형 모델 입장에선 오히려 다행. 다만 정규식이 못 잡는 경우 곧장 LLM에 떠넘김 → 소형 모델은 도구 호출 의도를 무시하고 일반 답변 |
| R8 | `app.py:888-932` `_strip_assistant_reasoning_trace()` | `<think>`, `<reasoning>` + 영문 23개 마커 bullet 제거 | gemma3n은 다른 형태 트레이스(예: `Okay, the user asked...`, `Let me think...`, 평문 단락) 출력 가능 → 거의 못 잘라냄 |
| R9 | `llm.py:172-203` `_normalize_messages` | 모든 이미지 base64 인라인. 이미지 개수/크기 제한 없음 | gemma3n은 single image at 256/512/768 토큰만 처리 권장. 다중 이미지 또는 큰 이미지 전송 시 컨텍스트 초과 또는 거절 |
| R10 | `llm.py:606-617` `_ollama_generate_prompt` fallback | role을 `User: ... Assistant: ...` plain text로 join | gemma3n은 `<start_of_turn>user...` 채팅 템플릿이 필수. `/api/generate` fallback이 발동되면 품질 급락 |
| R11 | `settings.py:53-72` Ollama 기본 모델 `qwen3.6:27b` | 기본 모델/대체 모델 가정이 27B급 | 신규 설치 PC가 27B 모델 받지 못하면 첫 사용 실패. 소형 모델 프로파일 자체가 없음 |
| R12 | `app.py:1868, 2175` `generate_session_reply` 호출부 | 히스토리 전체를 그대로 전달(메시지 누적 제한 미확인) | 세션 길어질수록 컨텍스트 폭증. 소형 모델은 4~6턴만 지나도 초기 메시지가 잘려 맥락 손상 |
| R13 | `app.py:1242` "GraphRAG 검색 결과입니다." 응답 합성 | 검색 5건을 그대로 LLM 답변과 별개로 출력 | 소형 모델이 그 위에 다시 자연어 합성하면 중복/모순 답변 발생 |
| R14 | `embeddings.py:14-15` `nomic-embed-text` 기본 | LLM(2B) + 임베딩(0.3B) 동시 로딩 가정 | 8GB RAM PC에서 모델 swap 빈발. gemma3n 멀티모달 가중치까지 합치면 메모리 압박 |
| R15 | `documents.py` HWPX 생성 호출 | LLM이 구조화된 본문 작성 | 2B 모델은 시행문/보고서 양식 구조화 출력에서 깨진 markdown, 빠진 섹션 빈발 |
| R16 | UI `app.tsx` 스트리밍 표시 | SSE delta를 그대로 누적 출력 | 트레이스 누출 시 사용자가 중간에 보게 됨(스트림 후처리 부재) |
| R17 | `llm.py:589` `_looks_like_ollama_native` | `:11434` 포트 + `/v1` 미포함만 검사 | 사용자가 OpenWebUI/리버스 프록시 통해 다른 포트로 Ollama 노출 시 native API 미사용 → `options` 전달 불가 |
| R18 | 가드레일 영문 마커 제거 | "wait", "let me", "self-correction" 등 영문 키워드만 | gemma3n 한국어 응답에서 영문 트레이스는 거의 없고 한국어 메타("생각해봅시다", "정리하자면") 형태 출력 가능 → 누출 |
| R19 | 동시 호출 보호 | 세션 단위 `work_session:{id}` exclusive lock만 | Ollama는 모델 1개를 한 번에 1요청만 처리 효율적. 세션 간 동시 호출 시 GPU swap thrashing — 소형 모델은 더 민감 |
| R20 | `/api/settings/llm-test` (`app.py:2298`) | 단순 generate_session_reply로 ping | 모델별 컨텍스트/멀티모달/툴콜 능력 프로빙 없음 → 사용자가 잘못된 모델 설정해도 OK로 표시 |

---

## 3. 개선 계획 (3번 작업 결과 — 우선순위별)

### 3.1 P0 — 즉시 적용(코드 1~2일 작업, 품질 즉효)

**① Ollama 호출 옵션 노출 + 소형 모델 기본값 (R1, R2, R6)**
- `llm.py` `_generate_ollama_reply(_streaming)`의 payload에 `options` dict 추가.
- 추천 기본값 (Gemma 4 E2B 가정):
  ```
  options = {
      "num_ctx": 8192,         # 컨텍스트 명시 (기본 2048 회피, 실제 모델이 32K 지원 확인되면 상향)
      "num_predict": 768,      # 응답 길이 상한
      "temperature": 0.3,      # 공무 응답 안정성
      "top_p": 0.9,
      "repeat_penalty": 1.15,  # 한국어 루프 방지
      "stop": ["<start_of_turn>", "<end_of_turn>", "User:", "System:"],
  }
  ```
  > Gemma 채팅 템플릿은 `<start_of_turn>user / <start_of_turn>model` 토큰을 사용하므로 stop 시퀀스에 반드시 포함.
- `SidecarSettings`에 `ollama_options: dict` 필드 추가 — 사용자가 환경설정에서 override 가능.
- Anthropic도 `max_tokens=1024`를 settings 기반 동적 값으로.

**② `think` 파라미터 모델별 가드 (R3)**
- 모델명에 `qwen3`, `deepseek-r1`, `o1`, `o3` 등 포함 시에만 `think=True` 전송.
- **gemma4/gemma3/llama/phi 계열은 무조건 제외** — Gemma 4도 native reasoning 미발표이므로 think 옵션을 Ollama가 무시하거나 빈 응답 유발 가능.

**③ GraphRAG 블록 동적 슬림화 (R5)**
- `_build_graphrag_prompt_block(...)`에 `max_chunks`, `chunk_char_budget` 인자 추가.
- 모델 프로파일이 "small"인 경우 chunks 5→2, 700자→350자.
- 메타데이터(relations, evidence_type) 라인을 1줄로 축약: `[근거 1] 제목 (path) — excerpt`.

**④ 시스템 가드레일 축약(소형 모델 프로파일) (R4)**
- 현재 8줄 → 소형용 3줄 압축 버전 추가:
  ```
  한국어 간결 답변. 민감정보(비밀번호/주민번호/API Key 등)는 [보호됨]으로 가리기.
  GraphRAG 근거 사용 시 출처 파일명 함께 제시. 추정은 "추정"으로 표기.
  내부 사고 과정 노출 금지. Markdown 짧은 문단·목록 사용.
  ```
- `_chat_guardrail_prompt(profile)` 시그니처로 변경.

**⑤ 메시지 히스토리 슬라이딩 윈도우 (R12)**
- `generate_session_reply` 호출 전, 토큰 추정으로 last N turn만 남기기(소형: last 4 user/assistant pair).
- 첫 user 메시지(세션 의도)는 별도 system 메시지로 압축 보존.

### 3.2 P1 — 1주 작업(품질·UX 큰 폭 개선)

**⑥ 소형 모델 프로파일 신설 (R11)**
- `settings.py` `_default_external_provider_profiles()`에 Gemma 4 E2B 프리셋 추가:
  ```python
  "ollama_gemma4_e2b": LlmConnectionProfile(
      provider="ollama", model="gemma4:e2b",
      base_url="http://127.0.0.1:11434",
  ),
  ```
- `apps/desktop/src/llmProviders.ts` 프리셋의 `modelPlaceholder`를 `"gemma4:e2b 또는 qwen3.6:27b"`로 갱신, `defaultModel`은 사용자 PC 사양 감지 결과(RAM ≥ 24GB → 대형, 그 외 → `gemma4:e2b`)에 따라 추천.
- UI 환경설정에 **"저사양 PC 모드 / 모바일·노트북 모드"** 토글 → 위 P0 옵션과 P1-⑧·⑩ 자동 적용.
- 첫 실행 마법사에서 사용자가 Ollama 모델을 안 받았다면 `ollama pull gemma4:e2b` 안내 + 진행률 표시(폐쇄망일 경우 패키지 zip에 포함하는 옵션 명시).

**⑦ 트레이스 제거기 강화 (R8, R18)**
- 새 매처 추가:
  - 한국어 메타: `생각해\s?(보|봐)`, `정리하(자|겠)`, `우선[,\s]`, `먼저[,\s]`, `자, 그러면`
  - 평문 영문: `^(Okay|Sure|Alright|Let me|First,)`
  - markdown checklist 형식의 "사용자 분석" 블록
- 스트리밍 경로(`generate_session_reply_streaming`)에 line-buffered 후처리 적용 — 사용자에게 트레이스 노출 차단.

**⑧ 멀티모달 가드 (R9)**
- 이미지 N장 ≤ 1로 자동 다운샘플(Gemma 4 E2B 프로파일에서). longest edge > 768px이면 768로 resize 후 base64.
- 모델명 화이트리스트로 vision capability 판정: `gemma4*`, `gemma3n*`, `llava*`, `qwen2.5-vl*`, `gpt-4o*`, `claude-*`, `gemini-*` 등. (Gemma 4 E2B는 멀티모달 변형이지만 같은 시리즈의 텍스트 전용 변형도 있을 수 있으므로 모델 ID에 `e2b`/`mm`/`vision` 같은 suffix 추가 매칭.)
- vision 미지원 모델 + 이미지 첨부 시 사용자에게 명확한 안내(현재는 silently 텍스트만 전송).

**⑨ Intent classifier LLM fallback(소형 모델 안전 버전) (R7)**
- 정규식이 못 잡고 LLM 호출 직전, 매우 짧은 분류 프롬프트(20~40 token)로 single-token 응답(`A`/`B`/`C`/`N`) 요청.
- 토큰 비용 작아서 2B 모델도 정확. 잘못 분류 시 정규식 결과 fallback.
- `app.py`에 `_classify_intent_via_llm(text) -> Optional[Intent]` 추가, dossier 8.3에서 지적한 한계 해소.

**⑩ chunk size 모델 인지 (R6)**
- `SECTION_CHUNK_MAX_CHARS`을 settings 값으로. 소형 모델 프로파일에서 1500자로.
- 단, 재인덱싱 비용이 크므로 마이그레이션 가이드 문서 추가.

### 3.3 P2 — 2~3주 작업(중장기 안정성)

**⑪ Ollama 모델 사전 워밍 + keep-alive 단일화 (R19)**
- sidecar 부팅 시 `/api/generate` ping 1회로 모델 로드 (E2B는 cold start ≈ 3~6s).
- `keep_alive: "30m"` 옵션 전달로 GPU/CPU swap 방지 (노트북 환경에서는 메모리 압박 시 `"10m"`로 단축 가능 옵션화).
- 세션 동시 호출 시 글로벌 single-flight queue (Ollama 1요청 단일 처리 정렬, 노트북 CPU/iGPU에서 특히 효과 큼).

**⑫ `/api/settings/llm-test` 능력 프로빙 (R20)**
- 모델별 ① 한국어 응답, ② JSON 출력, ③ 이미지 인식, ④ 컨텍스트 8K 처리 4개 마이크로 테스트 → 결과를 UI 신호등으로.
- `gemma4:e2b` 선택 시 자동으로 P0 옵션 권장 다이얼로그 띄우고 1-클릭 적용.

**⑬ HWPX/문서 생성 보조 prompting (R15)**
- 소형 모델용 문서작성 경로: LLM 한 번에 다 쓰는 대신, **개요 → 섹션별 채우기**의 multi-step로 분할.
- 각 단계 출력 길이 ≤ 200 토큰 — 2B 모델 안정 영역.
- HWPX 템플릿의 placeholder 위치를 미리 결정하고 LLM은 문구만 생성.

**⑭ 임베딩 모델 메모리 최적화 (R14)**
- Gemma 4 E2B와 nomic-embed-text 모두 Ollama이면 `OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_NUM_PARALLEL=1` 환경 기본화 가이드.
- 노트북/모바일 환경에서는 멀티모달 가중치까지 합쳐 RAM 압박이 커지므로, 임베딩을 onnxruntime `bge-m3-quantized` 같은 인앱 lightweight로 교체 옵션 제공.

**⑮ Ollama 감지 강화 (R17)**
- `/api/version` ping으로 native 여부 자동 판정. 포트 휴리스틱 제거.

**⑯ UI 후처리 안전망 (R16)**
- `app.tsx`에서 SSE delta 누적 시 `_strip_assistant_reasoning_trace` 대응되는 클라이언트 측 partial filter 도입.

### 3.4 P3 — 권장 운영/문서 작업

- `docs/operations`에 **"저사양 PC / 노트북 + Gemma 4 E2B 운영 가이드"** 추가: 권장 RAM 6GB↑(통합 그래픽 기준 8GB↑), `OLLAMA_*` 환경 변수, ChromaDB off, 임베딩 모델 선택, 첨부 이미지 1장 제한, 배터리 모드에서의 keep_alive 단축 권장.
- `verify:all`에 **소형 모델용 통합 시나리오** 추가: ① 단순 일정 등록, ② 지식 검색 1건, ③ HWPX 1페이지 보고서, ④ 이미지 첨부 1장 인식 — 응답 길이/지연/메모리 임계 검증.
- 회귀 방지: `test_llm_ollama.py`에 `options` 페이로드 검증, `_strip_assistant_reasoning_trace` 한국어 케이스 fixture 추가.

---

## 4. 부록

### 4.1 변경 파일 요약(작업 분량 가이드)

| 우선순위 | 파일 | 예상 변경 LOC |
|---|---|---|
| P0 | `services/sidecar/src/gongmu_sidecar/llm.py` | +120 |
| P0 | `services/sidecar/src/gongmu_sidecar/app.py` (`_chat_guardrail_prompt`, `_build_graphrag_prompt_block`, history trim) | +80 / -30 |
| P0 | `services/sidecar/src/gongmu_sidecar/settings.py` (`ollama_options`, model_profile) | +40 |
| P1 | `apps/desktop/src/llmProviders.ts`, `app.tsx` 환경설정 UI | +120 |
| P1 | `services/sidecar/src/gongmu_sidecar/graphrag_ingestion.py` (chunk size 설정화) | +20 |
| P1 | `services/sidecar/src/gongmu_sidecar/app.py` (intent LLM classifier) | +90 |
| P2 | `documents.py` (multi-step) | +150 |

### 4.2 회귀 위험

- **Ollama options 추가**: 기존 사용자 큰 모델(qwen 27B)에서 `num_ctx=8192`가 GPU OOM 유발 가능 → 옵션은 **프로파일별**로 적용, 기존 default는 보존.
- **GraphRAG 컨텍스트 축소**: 대형 모델 사용자의 답변 풍부도 감소 가능 → small 프로파일에만 적용.
- **`think` 가드**: qwen3/r1 사용자 영향 없음(여전히 활성), gemma/llama 사용자는 호환성 개선.
- **트레이스 제거기 강화**: false positive로 정상 한국어 단어("정리") 제거 위험 → 단어 단독이 아닌 **줄 시작 + 콜론/쉼표** 같이 강한 패턴만.

### 4.3 측정 지표(개선 검증용)

| 지표 | 측정 방법 | 목표 |
|---|---|---|
| 단순 채팅 응답 지연 (P50/P95) | `/api/work-sessions/.../turn` latency 로그 | P50 < 4s, P95 < 12s on i7+8GB |
| GraphRAG ask 응답 정확도 | 평가셋(공무 도메인 50문) 정답 포함률 | ≥ 75% (현 baseline 측정 필요) |
| 트레이스 누출 빈도 | 회귀 테스트 50턴 fixture | 0건 |
| HWPX 1페이지 보고서 완성도 | 사람 평가(섹션 누락/맞춤법) | 사용자 검수 통과율 ≥ 80% |
| 메모리 peak | sidecar RSS | ≤ 6GB on Gemma 4 E2B + nomic-embed |

### 4.4 모델 가정 영향도

본 보고서는 **Gemma 4 E2B(2026-04 출시, 멀티모달, ~2B effective, ~8K context 안전선)** 기준. 실제 모델 사양이 다음과 같이 다르다면 조정:

- **컨텍스트 윈도우가 32K로 확인된 경우**: P0-③(GraphRAG 슬림화)에서 chunks 5건 유지하되 chunk 당 350자는 그대로. num_ctx=16384로 상향. 메시지 슬라이딩 윈도우(P0-⑤)는 last 8 pair로 확장.
- **Gemma 4 E4B (Effective 4B)**: 모든 P0 적용은 유지하되 num_predict=1024, temperature=0.4. HWPX multi-step(P2-⑬)은 선택사항.
- **Gemma 4 12B/27B(대형, 데스크톱)**: 본 보고서의 "small profile"을 대형 모델에는 절대 적용하지 말 것. 기존 default 경로 유지.
- **텍스트 전용 Gemma 4 변형**: P1-⑧ 멀티모달 가드 영구 비활성, vision capability 화이트리스트에서 제외.
- **Gemma 4 E2B가 native tool-calling을 지원할 경우**: P1-⑨ intent LLM classifier를 tool-calling 기반으로 대체(단일 토큰 분류 대신 함수 호출). 단, 2B 규모에서 tool-calling 정확도는 검증 필요.

---

## 5. 추천 적용 순서

1. **이번 스프린트**: P0 5건 적용 → `npm.cmd run sidecar:test` + `desktop:test` 통과 → 사내 실 사용자 1명에게 `gemma4:e2b` (Ollama) 환경에서 dogfood.
2. **다음 스프린트**: P1 5건 + 4.3 측정 지표 baseline 수집 → 가이드 문서 작성.
3. **이후**: P2 6건 점진 적용 + 회귀 테스트셋 확장.
