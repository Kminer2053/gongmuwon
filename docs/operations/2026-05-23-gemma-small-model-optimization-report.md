# Google Gemma 4 E2B 최적화 개선 보고서 (검증 v2)

작성일: 2026-05-23
대상 저장소: `Agent_Gongmu_Codex`
브랜치: `claude/jolly-edison-Kr4Cx`
대상 모델: **Google Gemma 4 E2B** (2026-04-02 출시, Apache 2.0)

> v1 노트: 처음 작성한 보고서는 사용자가 지적한 대로 Gemma 3n E2B 가정으로 잘못 추측한 부분이 다수였음. 본 v2는 Google 공식·HF·MindStudio·Aurigait·Unsloth 등 공개 자료로 모델 사양을 재검증한 뒤 다시 작성. v1과 결론이 뒤집힌 항목은 §1.2에 명시.

---

## 1. Gemma 4 E2B 모델 정확한 사양 (재조사 결과)

### 1.1 핵심 스펙

| 항목 | 값 | 출처 |
|---|---|---|
| 출시 | 2026-04-02, Apache 2.0 | Google 공식 블로그 |
| 패밀리 | E2B / E4B / 26B MoE(3.8B active) / 31B Dense | Gemma 4 발표 |
| Effective parameters | **2.3B** (총 5.1B, Per-Layer Embeddings) | HF model card |
| 4-bit 메모리 | **≈1.5 GB RAM**, Raspberry Pi 5에서 7.6 tok/s | MindStudio, Jetson AI Lab |
| **컨텍스트 윈도우** | **128K tokens** (edge), 26B/31B는 256K | Google AI Dev 문서 |
| **멀티모달 입력** | 텍스트 + 이미지(가변 종횡비/해상도, **configurable visual token budget**) + **오디오 최대 30초**(E2B/E4B 한정) + 비디오(프레임 시퀀스). interleaved 입력 지원 | HF blog, Datature |
| 입력 권장 순서 | 이미지/오디오 → 텍스트 (앞쪽 배치) | HF blog |
| **Function calling** | **Native 지원**. `apply_chat_template(tools=...)` JSON schema 또는 Python 함수 자동 파싱 | ai.google.dev/gemma function-calling |
| **Thinking mode** | **모든 사이즈 지원**. system prompt 시작에 `<|think|>` 토큰 추가로 활성, 출력은 `<|channel>thought\n...<channel|>` 채널. 최대 4000+ 토큰 CoT. 비활성 시 토큰 제거 | ai.google.dev, MachineLearningMastery |
| 권장 sampling | **temperature 1.0, top-k 65, top-p 0.95** (Google 공식 권장) | Unsloth recipe |
| repeat_penalty | 1.0~1.05 권장, 1.2 초과 금지 | smcleod.net |
| 학습 언어 | **140+ 언어 native** (한국어 포함 우수 성능 기대) | Google 발표 |
| Ollama 식별자 | `gemma4:e2b`, `gemma4:e2b-it-q4_K_M`, `gemma4:e2b-mlx` 등 | Ollama 라이브러리 |
| 추론 프레임워크 | MediaPipe, ExecuTorch, llama.cpp, Ollama, vLLM | HF, vLLM recipes |

### 1.2 v1 보고서에서 잘못 가정했고 v2에서 뒤집은 항목

| v1 가정 (오류) | v2 사실 | 영향 |
|---|---|---|
| 컨텍스트 8K | **128K** | GraphRAG/히스토리 슬림화는 *속도/메모리* 목적으로만, *맥락 손실* 우려는 불필요 |
| thinking 미지원 → `think=True` 금지 | **`<|think|>` system 토큰으로 활성**, Ollama `think` 옵션도 매핑됨 | "사고 효과" 토글이 실제로 의미 있음. 단, latency 트레이드오프 큼 |
| function calling 없음 → 정규식 라우팅 유지 | **native JSON schema function calling** | dossier 8.3 한계(LLM intent classifier 필요) 해결책이 단일 토큰 분류기가 아니라 **tool-calling 직접 사용** |
| 한국어 약함 → 가드레일 강화·검수 강화 필요 | **140+ 언어 native** | 가드레일 더 단순화 가능. 다만 공무 도메인 평가셋 검증은 여전히 필요 |
| temperature 0.3 권장 | **공식 1.0** (top-k 65, top-p 0.95) | 보수적 값은 한국어 응답이 단조롭고 반복 유도. 단 공무 응답 안정성 목적이면 0.6~0.8 절충 |
| 이미지 768px 다운샘플 강제 | **variable aspect ratio + configurable visual token budget** | 다운샘플 대신 token budget(낮음/보통/높음) 노출이 더 정확 |
| 오디오 미지원 가정 | **30초 오디오 입력 지원** | 신규 기능 기회. 회의록/메모/지시 녹음 직접 입력 가능 |
| trace 패턴: `<think>`, `<reasoning>`, 영문 bullet | **실제 패턴은 `<|think|>` 토큰 / `<|channel>thought ... <channel|>`** | 트레이스 제거 정규식을 정확히 그 토큰 기준으로 변경 |

---

## 2. 코드베이스 리뷰 (Gemma 4 E2B 정확한 스펙 기준)

### 2.1 즉시 손봐야 할 핵심 결함 7가지

| # | 위치 | 현 상태 | E2B 기준 결함 |
|---|---|---|---|
| **C1** | `llm.py:627-660,663-727` Ollama payload | `options` 객체 누락 (num_ctx/num_predict/temperature/top_k/top_p/stop 없음) | num_ctx 기본값 2048에서 동작 → 128K context 모델 의미 무력화. 권장 temperature 1.0/top-k 65/top-p 0.95 미반영 → 응답 품질 저하 |
| **C2** | `llm.py:640,651,677,703` `think` 파라미터 | `reasoning_effort in {medium, high}` → `think=True` 직접 전달 | Ollama Gemma 4 구현체는 `think` 옵션을 system prompt `<|think|>` 토큰 주입으로 매핑. **사용은 맞으나 출력의 `<|channel>thought...<channel|>` 채널이 그대로 답변에 노출** (`_strip_assistant_reasoning_trace`가 이 토큰 모름) |
| **C3** | `app.py:888-932` `_strip_assistant_reasoning_trace` | `<think>...</think>`, `<reasoning>...</reasoning>`, 영문 bullet 23종 제거 | Gemma 4는 `<|channel>thought\n...<channel|>` 형식 사용 → **실제 트레이스가 그대로 사용자 화면에 노출됨**. 가장 치명적 결함 |
| **C4** | `app.py:1005-1052` intent planner | 정규식만 사용, dossier 8.3에서 한계 명시 | Gemma 4 E2B는 **native function calling** 지원. JSON schema로 tool 등록 시 모델이 직접 `schedule.create`, `knowledge.search`, `documents.generate` 호출 가능. 정규식+LLM이중 라우팅 자체가 불필요 |
| **C5** | `llm.py:172-203` `_normalize_messages` | 이미지 N장 무제한 base64 인라인, 텍스트 → 이미지 순서, 오디오 미지원 | E2B 권장은 **이미지/오디오 → 텍스트** 순. 오디오 첨부 30초 한도 입력 경로 자체가 없음. visual token budget(`image_token_count`) 노출 미비 |
| **C6** | `llm.py:606-617` `_ollama_generate_prompt` fallback | `User: ... Assistant: ...` plain text join | Gemma 4 chat template(`<start_of_turn>user ... <start_of_turn>model`)을 깨뜨림. Ollama가 자체 template 적용해도 fallback 경로에서 깨짐 |
| **C7** | `app.py:1868,2175` `generate_session_reply` 호출 | 전체 메시지 히스토리 + 가드레일 + GraphRAG 매 턴 동봉 | 128K context 덕분에 *컨텍스트 초과*는 아님. 그러나 **PLE 구조 특성상 prefill 시간이 입력 길이에 강하게 비례** → 노트북에서 첫 토큰 지연 폭증 |

### 2.2 중요도 중간 (8~14)

| # | 위치 | 결함 |
|---|---|---|
| C8 | `settings.py:53-72` | 기본 모델 `qwen3.6:27b`. Gemma 4 E2B 프로파일 없음 |
| C9 | `llm.py:743` Anthropic만 `max_tokens=1024` | 다른 provider 미설정. E2B는 thinking 시 4000+ 토큰 가능 → num_predict 명시 필요 |
| C10 | `graphrag_ingestion.py:32` `SECTION_CHUNK_MAX_CHARS=4000` | 128K 모델엔 너무 작은 chunk 아님. 다만 retrieval precision 측면에서 1500자대가 일반적으로 우수 |
| C11 | `app.py:952` GraphRAG 5×700자 컷 | 128K에 비해 매우 보수적. 도리어 *늘려도* 무방. 다만 PLE prefill 비용 고려 시 현 수준 유지가 합리적 |
| C12 | `embeddings.py:14-15` `nomic-embed-text` | E2B(1.5GB) + nomic(0.3GB) 동시 로딩 시 노트북 통합 그래픽에서 GPU 메모리 swap |
| C13 | `app.py:938` 가드레일 8줄 | 한국어 강한 모델이라 8줄까지 필요 없음. 3~4줄로 단축해도 동일 효과 |
| C14 | `/api/settings/llm-test` (`app.py:2298`) | Gemma 4 능력 프로빙 없음 (vision/audio/function calling/thinking 각각 검증 안 함) |

### 2.3 신규 기회 (E2B 고유 강점 미활용)

| # | 활용 영역 | 현재 상태 | 개선 기회 |
|---|---|---|---|
| O1 | **Function calling** | 미사용 | 일정·지식·문서·파일정리 모든 도구를 JSON schema로 모델에 직접 노출 → 자연어 라우팅 품질 도약 |
| O2 | **Thinking mode 토글** | UI에 reasoning_effort 슬라이더 추정 존재 (`llm.py:632` 참조), 실제 효과 검증 미흡 | 복잡 도구 호출(HWPX 산출, 다중 일정 조정)에는 thinking ON, 단순 채팅 OFF |
| O3 | **오디오 입력** | 미구현 | 첨부 wav/m4a/mp3 30초 한도로 직접 입력 → 음성 메모 → 일정/지시 추출 |
| O4 | **128K 컨텍스트** | 활용 안 함 | 문서작성 시 연결 파일 전문(부분 발췌 아님) 투입 가능. RAG 미스 시 fallback으로 raw 문서 전달 |
| O5 | **Interleaved multimodal** | 텍스트만 먼저 배치 | 이미지·오디오를 첨부 순서대로 텍스트 사이에 끼워 넣기 |
| O6 | **Variable visual token budget** | 미노출 | 빠른 모드(저 budget) / 정밀 모드(고 budget) UI 옵션 |

---

## 3. 개선 계획 (v2, Gemma 4 E2B 실 사양 기준)

### 3.1 P0 — 핵심 결함 수정 (1주 이내, 사용자 즉시 체감)

**P0-① Ollama `options` payload 추가 + Gemma 4 권장값**

`llm.py:636-641, 673-678, 699-704` 의 payload에 다음 dict 추가:

```python
options = {
    "num_ctx": 32768,       # 128K 모델이지만 prefill 속도 위해 32K로 출발, 사용자 설정 가능
    "num_predict": 1024,    # thinking 비활성 기준. thinking ON이면 4096
    "temperature": 1.0,     # Google 공식 권장
    "top_k": 65,
    "top_p": 0.95,
    "repeat_penalty": 1.0,  # Gemma 4는 1.0~1.05 권장
    "stop": ["<end_of_turn>", "<start_of_turn>"],
}
```
- `SidecarSettings`에 `ollama_options: dict | None`, `ollama_options_thinking: dict | None` 필드 추가.
- 환경설정 UI에서 슬라이더 노출(num_ctx, temperature).
- `num_predict`는 `reasoning_effort`에 따라 1024 / 2048 / 4096 자동 스위치.

**P0-② Thinking 토큰/채널 출력 파싱 정확화 (가장 치명적)**

`app.py:888-932` `_strip_assistant_reasoning_trace`를 Gemma 4 채널 포맷에 맞춰 재작성:

```python
# Gemma 4 thinking output: <|channel>thought\n...<channel|> 다음에 최종 답변
CHANNEL_THOUGHT_RE = re.compile(
    r"(?is)<\|channel\|?>\s*thought.*?<\|?channel\|>", re.DOTALL
)
# 이전 호환(Qwen, R1) 패턴도 유지
LEGACY_THINK_RE = re.compile(r"(?is)<think>.*?</think>")
LEGACY_REASONING_RE = re.compile(r"(?is)<reasoning>.*?</reasoning>")
```

스트리밍 경로 (`llm.py:663-727`, `app.py:2175`)에도 partial buffer 필터 추가 — 채널 토큰 닫힘 전에는 사용자에게 흘리지 않음.

**P0-③ `think` 옵션 방향 수정**

v1 권고 "gemma 계열에서 `think` 비활성"은 **틀렸음**. 실제로는:
- `reasoning_effort="off"`: `think=False`, `num_predict=1024`
- `reasoning_effort="low"`: `think=False`, `num_predict=1536`
- `reasoning_effort="medium"`: `think=True`, `num_predict=2560`
- `reasoning_effort="high"`: `think=True`, `num_predict=4096`

Ollama 0.6+에서 Gemma 4의 `think` 파라미터는 system prompt에 `<|think|>` 자동 주입으로 매핑됨. 별도 작업 불필요. 단 P0-② 트레이스 제거가 선결.

**P0-④ Gemma 4 chat template fallback 보호**

`llm.py:606-617` `_ollama_generate_prompt`는 `/api/chat`이 비어있는 경우만 사용되지만, 만약 호출되면 Gemma 4 템플릿을 깬다. 다음 중 하나 채택:
- (안전) Gemma 4 모델 감지 시 `/api/generate` fallback 시도 자체를 막고, 명확한 에러 반환.
- (정밀) 모델별 chat template 라이브러리(예: `transformers` 토크나이저 호출) 추가.

**P0-⑤ 가드레일 단축**

`app.py:938-950` 8줄 → 4줄(Gemma 4 한국어 능력 신뢰):
```
한국어로 간결하게 답하고, 비밀번호·주민번호·API Key·토큰은 [보호됨]으로 가립니다.
GraphRAG 근거 사용 시 출처 파일명을 표기하고, 불확실한 내용은 "추정"으로 명시합니다.
일정 등록·조회·삭제, 문서작성처럼 도구로 처리 가능한 작업은 도구 호출 결과를 우선합니다.
내부 사고 채널(<|channel>thought)은 출력하지 않습니다.
```

**P0-⑥ Gemma 4 E2B 프로파일 신설**

`settings.py:_default_external_provider_profiles()`에 추가:
```python
"ollama_gemma4_e2b": LlmConnectionProfile(
    provider="ollama",
    model="gemma4:e2b-it-q4_K_M",
    base_url="http://127.0.0.1:11434",
),
```
`apps/desktop/src/llmProviders.ts`의 ollama 프리셋 `modelPlaceholder`: `"gemma4:e2b 또는 qwen3.6:27b"`. 신규 사용자 추천 default를 RAM 검출 결과로 분기.

### 3.2 P1 — 강점 활용 신기능 (2~3주, 품질 도약)

**P1-⑦ Native Function Calling으로 의도 라우팅 재설계** ⭐

- `app.py`에 도구 스키마 등록 모듈 신설:
  ```python
  GONGMU_TOOLS = [
      {"name": "schedule.create", "parameters": {...}},
      {"name": "schedule.list",   "parameters": {...}},
      {"name": "schedule.delete", "parameters": {...}},
      {"name": "knowledge.search","parameters": {...}},
      {"name": "documents.generate","parameters": {...}},
      {"name": "files.search",    "parameters": {...}},
      {"name": "files.organize",  "parameters": {...}},
  ]
  ```
- `llm.py`에 `generate_session_reply(... tools=GONGMU_TOOLS)` 인자 추가. Ollama Gemma 4 chat API의 `tools` 필드로 전달.
- 모델이 tool_call 응답 시 `_try_run_work_session_skill()`가 직접 호출 → 결과를 next-turn user 메시지로 모델에 반환.
- 정규식 라우팅(`_looks_like_*`)은 **fallback**으로만 유지. dossier 8.3 한계 해소.

**P1-⑧ 오디오 입력 경로 추가 (E2B 신기능)** ⭐

- 백엔드:
  - `work_session_attachments`에 audio MIME (`audio/wav`, `audio/mp3`, `audio/mp4`, `audio/m4a`, `audio/ogg`) 허용.
  - `llm.py`에 `_attachment_audio_base64()` 추가, 30초 초과 시 자동 trim 또는 거절.
  - Ollama Gemma 4 multimodal 입력 페이로드에 `audio` 필드 또는 첨부 url 전달 (Ollama 0.6+ Gemma 4 multimodal 지원 형식 확인 필요).
- UI: 채팅 입력창에 🎙 버튼 → MediaRecorder API로 30초 한도 녹음, base64 첨부.
- 시나리오: "방금 회의 메모예요 → 일정 자동 등록", "지시사항 받아쓰기 → 업무대화 첫 메시지로".

**P1-⑨ Interleaved multimodal + 입력 순서 정정**

`llm.py:172-203` `_normalize_messages`:
- 첨부 이미지/오디오를 **텍스트 앞**에 배치 (현재는 텍스트 먼저, 이미지가 뒤).
- 멀티 첨부 시 사용자 첨부 순서를 보존.
- OpenAI/Anthropic 경로도 동일 순서로 (provider 자체가 순서 보존).

**P1-⑩ Visual token budget 노출**

- `SidecarSettings`에 `image_token_budget: Literal["fast", "balanced", "quality"] = "balanced"`.
- Ollama Gemma 4 multimodal 옵션(현재 `num_image_tokens` 또는 유사 키, Ollama doc 확인 필요)에 매핑.
- UI에 채팅 첨부 옵션 토글.

**P1-⑪ 능력 프로빙 + 자동 옵션 적용**

`/api/settings/llm-test`를 다음 4단계로:
1. 한국어 응답 (3턴 길이/맞춤법)
2. JSON schema function calling (간단 tool 호출 성공 여부)
3. 이미지 인식 (테스트 이미지 1장 캡션)
4. 오디오 인식 (테스트 짧은 음성 → 텍스트 일치도)

모델명에 `gemma4` 포함 시 P0 옵션 자동 적용 다이얼로그.

### 3.3 P2 — 안정성·운영 (3~4주)

**P2-⑫ Ollama keep_alive + 워밍**

- 부팅 시 `/api/generate` ping (E2B cold start ≈ 2~4s).
- `keep_alive: "30m"` 옵션. 노트북 배터리 모드는 `"5m"`로 자동 단축 (`SidecarSettings.power_mode`).

**P2-⑬ Single-flight Ollama 큐**

- Ollama는 동일 모델 단일 요청 효율 최대. 글로벌 큐로 동시 요청 직렬화.
- 세션 lock(`work_session:{id}`)은 이미 존재 → 글로벌 `ollama:{model}` lock 추가.

**P2-⑭ Embedding 메모리 최적화**

- 통합그래픽/노트북 detection 시 `OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_NUM_PARALLEL=1` 환경 권장 안내.
- 옵션: onnxruntime `bge-m3-quantized` 인앱 임베딩으로 교체 (Ollama 두 모델 회피).

**P2-⑮ 문서작성에서 function call 체인**

- 현재 `documents.py`는 단발성 LLM 호출. Gemma 4 function calling으로:
  1. `outline.generate` (개요 JSON)
  2. 각 섹션마다 `section.fill(section_id)`
  3. `document.finalize` (HWPX 생성은 결정론 코드)
- 2B 모델 약점인 긴 구조화 출력 → 짧은 단계 분할로 안정화.

### 3.4 P3 — 문서/회귀

- `docs/operations/`에 **"Gemma 4 E2B 운영 가이드"** 신설: 권장 RAM(8GB↑, 통합그래픽은 12GB↑), 환경변수, thinking 토글 가이드, 오디오·이미지 한도.
- `scripts/`에 `bench-gemma4-e2b.mjs` 추가: latency P50/P95, 첫 토큰 지연, function call 정확도.
- 회귀 fixture (`test_llm_ollama.py`):
  - Ollama payload에 `options.num_ctx`, `temperature=1.0` 검증.
  - `<|channel>thought` 토큰이 사용자 응답에 포함되지 않음 검증.
  - function call JSON 파싱 검증.

---

## 4. 측정 지표

| 지표 | 측정 방법 | 목표 (E2B 4-bit, RAM 8GB 노트북) |
|---|---|---|
| 첫 토큰 지연(thinking OFF) | `/turn/stream` 첫 chunk 시점 | P50 < 2.0s, P95 < 5.0s |
| 단발 응답 latency(thinking OFF) | `/turn` 전체 | P50 < 6s, P95 < 14s |
| Thinking ON latency | `reasoning_effort=high` | P50 < 25s, P95 < 60s |
| Function call 정확도 | 50문 시나리오셋(공무 도메인) | ≥ 85% (Gemma 4 E2B 공식 벤치 기대치 부합) |
| 트레이스 누출 빈도 | thinking ON 50턴 fixture | **0건** |
| GraphRAG ask 한국어 정답 포함률 | 평가셋 50문 | ≥ 80% |
| RSS peak | sidecar + Ollama | ≤ 4.5 GB (E2B 4-bit + nomic) |
| 오디오 30초 → 일정 추출 성공률 | 20개 샘플 | ≥ 70% (신규 P1 기능 초기 목표) |

---

## 5. v1 → v2 변경 요약 (코드 변경 영향)

| v1 권고 | v2 변경 | 사유 |
|---|---|---|
| `num_ctx=8192`, temperature 0.3 | **num_ctx=32768 시작, temperature 1.0, top-k 65, top-p 0.95** | 컨텍스트 128K + Google 공식 권장 |
| gemma에서 `think=True` 제거 | **유지하되 `<|channel>thought` 채널 출력 제거 로직 추가** | thinking 실제로 강력 지원 |
| LLM intent classifier(단일 토큰) | **Native function calling으로 대체** | E2B가 JSON schema function calling 지원 |
| 이미지 768px 다운샘플 강제 | **visual token budget 노출 (fast/balanced/quality)** | variable aspect ratio·해상도 지원 |
| 오디오 미고려 | **30초 오디오 입력 신규 경로 추가** | E2B/E4B 한정 신기능 |
| 가드레일 영문 trace 23종 | **`<|channel>thought ... <channel|>` 정확 매칭 + 영문 패턴은 fallback** | Gemma 4 출력 포맷 정확화 |
| 한국어 보강 추가 few-shot | **불필요**(140+ 언어 native) | 가드레일 단축 가능 |
| 컨텍스트 폭증 우려로 GraphRAG 5→2 강제 | **유지(5건)**, chunk 길이만 settings화 | 컨텍스트는 충분, 슬림화는 PLE prefill 속도 목적만 |

---

## 6. 적용 순서 권고

1. **이번 스프린트(P0-① ~ ⑥)**: 1주. 가장 큰 효과는 P0-② 트레이스 채널 제거(즉시 UX 정상화) + P0-① options(품질·속도 동시).
2. **다음 스프린트(P1-⑦ Function calling)**: 2주. dossier 8.3 한계 해소, 의도 라우팅 정확도 도약.
3. **그 다음(P1-⑧ 오디오, ⑨ interleaved, ⑩ visual budget, ⑪ 프로빙)**: 1~2주.
4. **이후 P2/P3**: 운영 안정화 및 회귀 방어.

각 단계 종료 시 §4 측정 지표로 baseline 갱신.

---

## 출처

- [Gemma 4: Byte for byte, the most capable open models — Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)
- [Gemma 4 model overview — ai.google.dev](https://ai.google.dev/gemma/docs/core)
- [Gemma 4 model card — ai.google.dev](https://ai.google.dev/gemma/docs/core/model_card_4)
- [Function calling with Gemma 4 — ai.google.dev](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4)
- [google/gemma-4-E2B-it — Hugging Face](https://huggingface.co/google/gemma-4-E2B-it)
- [Welcome Gemma 4 — Hugging Face blog](https://huggingface.co/blog/gemma4)
- [Gemma 4 E2B vs E4B — MindStudio](https://www.mindstudio.ai/blog/gemma-4-e2b-e4b-edge-models-phone-local)
- [Gemma 4 — Aurigait](https://aurigait.com/blog/gemma-4-features-benchmarks-guide/)
- [Gemma 4 for CV engineers — Datature](https://datature.io/blog/gemma-4-what-computer-vision-engineers-actually-need-to-know)
- [Gemma 4 Usage Guide — vLLM Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html)
- [Gemma 4 — Unsloth Docs](https://unsloth.ai/docs/models/gemma-4)
- [Local-First AI with Gemma 4 E2B and Thinking Mode — DEV](https://dev.to/gde/local-first-ai-done-right-how-gemma-4-e2b-and-thinking-mode-powered-diagramflowai-3bop)
- [How to Implement Tool Calling with Gemma 4 and Python — MachineLearningMastery](https://machinelearningmastery.com/how-to-implement-tool-calling-with-gemma-4-and-python/)
