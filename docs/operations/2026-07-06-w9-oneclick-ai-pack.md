# W9 — 폐쇄망 원클릭 AI 설치 패키지 (올라마 + gemma-4 E2B 동봉)

- 작성: 2026-07-06
- 산출물: `release/ai-pack/Gongmu_AI_Ollama_Gemma4_E2B_IT_Multimodal_20260706-1839/` (8.9GB) + `.zip`
- 목표(사용자): "완벽히 동작하는 원클릭 셋업(올라마+gemma까지 한꺼번에) + 누구나 쉬운 GUI 설치, 폐쇄망"

## 1. 이번 웨이브가 한 것

기존 ai-pack 인프라(7/1 빌드)는 **옛 setup.exe(6/16, W5~W8 미반영)** 를 담았고, 설치는 사용자가 NSIS·Ollama 마법사를 **수동 완료**해야 하는 반쪽 원클릭이었다. W9는 두 축으로 개선했다.

### A. 최신 바이너리 반영
- W5~W8(임의형식·튜토리얼·설치 GUI·지식폴더 증분관리 P0~P3) 반영 setup.exe(238MB)를 `release/offline/…_20260706_1817`로 스테이징 → ai-pack 빌더가 mtime 최신본을 자동 선택.
- gemma-4 E2B 모델 캐시(4 blob, ~7.16GB) + OllamaSetup.exe(Inno) + python-3.11.9 로컬 캐시에서 오프라인 재빌드.

### B. 진짜 원클릭 + 안전성 (빌더 템플릿 개선)
| 항목 | 개선 |
|---|---|
| **사일런트 설치** | Gongmu NSIS `/S`, Ollama Inno `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOICONS`, Python `/quiet` — 수동 마법사 완료 불필요. 실패 시 한국어 오류+로그 경로 |
| **앱 자동 실행** | 설치 후 `Find-GongmuExe`(레지스트리 InstallLocation → %LOCALAPPDATA%\Programs\Gongmu → %ProgramFiles% 폴백)로 실행 파일 탐지 → 자동 기동 → 최초 실행 튜토리얼 유도 |
| **모델 복사 가시성** | robocopy(수 분) 전후 `MODEL-COPY-START/DONE` 마커 + "정체는 정상" 안내 → hang 오인 방지 |
| **설정 보존** | 재실행 시 settings.json이 이미 ollama+gemma면 덮어쓰지 않음(사용자 커스터마이즈 보존) |
| **Ollama 충돌 안내** | 이미 실행 중이라 모델 미인식 시 "트레이에서 종료 후 재실행" 실행 가능한 오류 |
| **무결성 자동 대조** | validate가 SHA256SUMS.txt로 모델 blob·setup.exe 재해시 대조 → USB 복사 손상 탐지 |
| **법적 고지 정확화** | (당시) Gemma = Google Gemma Terms of Use로 표기 + kordoc(MIT)·WebView2·portable node·파이썬 의존성 추가. **→ 2026-07-06 재정정: 실제 번들 모델 Gemma 4는 Apache 2.0. 아래 §5 참조** |
| **안내 개선** | SmartScreen("추가 정보→실행")·UAC 안내, 정식명칭 "로컬 AI에이전트 워크플레이스 : 공무원", "로컬 설치 gemma-4 E2B에 최적화", 시스템 요구(디스크 12GB·RAM 16GB·WebView2 내장) |
| **manifest 강화** | package.version 1.0.0 + integrity 블록(SHA256SUMS 참조 + 구성요소 sha256 + 모델 blob 맵) |

## 2. 검증 (제작 PC)
- 빌더/테스트 문법 그린, `prepare-ollama-ai-pack.test.mjs` EXIT=0(fixture 기반 산출물·문자열 assert).
- 적대 검증 holds — 7개 관점 통과(사일런트 인자 계약 정합, 앱 경로 폴백, SHA 스트리밍, 멱등, Gemma Terms 정확, 모델명 `gemma4:e2b` 불변).
- 생성물 실검증: PS 스크립트 3종 파서 통과, **SHA256 실대조 5건 불일치 0**, 배치 런처 DRY_RUN EXIT=0(새 원클릭 안내문 확인), THIRD_PARTY/가이드/매니페스트 발췌 확인.

## 3. 사용자 최종 확인 (클린 계정)
설치는 시스템 변경이라 제작 측에서 실행하지 않음. 권장 절차:
1. 팩(폴더 또는 zip)을 대상 PC로 복사(USB/폐쇄망).
2. `START_INSTALL_GUI.bat` 더블클릭 → 자동 진행(사일런트). UAC 창이 뜨면 "예".
3. 완료 시 앱이 자동 실행되고 튜토리얼이 뜸 → LLM(ollama gemma4:e2b)·지식폴더 안내대로 진행.
4. `VALIDATE_INSTALL.bat`로 무결성·Ollama·모델·앱 설정 자동 점검.

## 4. 잔여/후속
- 모델명 `gemma4:e2b`는 제품 정체성으로 유지. 온라인 `-AllowDownload` 폴백은 설계상 미지원(폐쇄망 blob 복사가 정답) — registry에 해당 태그 없음.
- 파이썬 의존성 라이선스는 대표 5종 요약 — 전체 인벤토리 자동 추출은 향후 과제.
- 실제 클린 계정 사일런트 설치 E2E 육안 확인(사용자).

## 5. 정정 (2026-07-06) — Gemma 4 라이선스는 Apache 2.0

W9 작성 당시 "Gemma = Google Gemma Terms of Use(Apache 아님)"로 표기했으나, 1차 출처 확인 결과 **틀렸다.** 이 앱이 번들하는 **Gemma 4**(로컬 `gemma4:e2b` / 외부 `google/gemma-4-E2B-it`)는 이전 세대와 달리 **Apache 2.0**으로 배포된다.

근거(직접 조회):
- Google 공식 `ai.google.dev/gemma/terms` → "For Gemma 4 terms, see the Gemma 4 license" → `ai.google.dev/gemma/apache_2`로 분리.
- HuggingFace `google/gemma-4-E2B-it`·`google/gemma-4-E4B-it` → 라이선스 태그 `apache-2.0`, **게이팅 없음**.
- Google Open Source Blog "Gemma 4: Expanding the Gemmaverse with Apache 2.0"(2026-03). 4개 사이즈: 2B(E2B)/E4B/26B MoE/31B dense.

영향:
- **재배포 크게 단순화** — Apache 2.0 라이선스 전문 + NOTICE 동봉, 변경 사실 명시만. 금지 사용 정책 전가·약관 동의·게이팅 **불필요.**
- 세대 구분: Gemma 1/2/3/3n = Gemma Terms of Use / **Gemma 4 = Apache 2.0**.
- **후속 조치 필요:** 팩 빌더(`scripts/prepare-ollama-ai-pack.mjs`)가 생성하는 `THIRD_PARTY_NOTICES.md`를 Apache 2.0으로 갱신 후 팩 재생성. 실제 pull하는 Ollama/GGUF 변환본의 `LICENSE`·`NOTICE`는 업로더 오표기 가능성 있어 번들 직전 확인.
- 원인: 조사 시점 모델(Gemma 4)이 훈련 지식 컷오프(2026-01) 이후(2026-03) 릴리스라 초기 판단이 낡은 세대 기준이었음.
