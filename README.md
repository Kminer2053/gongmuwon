<div align="center">

# 로컬 AI에이전트 워크플레이스 : 공무원

**인터넷 없이, 내 PC 안에서 도는 공무원 업무 AI 워크스페이스**
_대화 · 지식 · 문서가 한 몸으로 — 로컬 설치 gemma-4 E2B에 최적화_

![Windows](https://img.shields.io/badge/Windows-10%20|%2011%20·%20x64-0078D4?logo=windows)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![FastAPI](https://img.shields.io/badge/FastAPI-Python%203.11-009688?logo=fastapi&logoColor=white)
![Local-first](https://img.shields.io/badge/Local--first-폐쇄망%20대응-2E7D32)
![Offline AI](https://img.shields.io/badge/AI-Ollama%20·%20gemma--4%20E2B-5E35B1)

</div>

---

공공분야 사무업무자를 위한 **로컬 우선(local-first) 업무 AI 데스크톱 앱**입니다. 단순 챗봇이 아니라, 사용자의 업무 폴더와 대화 기록을 바탕으로 **업무 맥락을 쌓고 → 필요한 자료를 근거와 함께 찾아 → 공문·보고서 문서 산출까지** 한 흐름으로 잇는 개인 업무 기억 시스템을 지향합니다.

모든 데이터는 기본적으로 사용자 PC 안에만 저장되며, 외부 인터넷이 차단된 **폐쇄망 환경에서 AI(Ollama + gemma-4 E2B)까지 포함해 완전 오프라인으로 동작**합니다.

> 내부 코드명·설치 파일명에는 호환성을 위해 `Gongmu` 표기가 일부 남아 있습니다.

## 목차

- [한눈에 보기](#한눈에-보기)
- [주요 기능](#주요-기능)
- [빠른 시작](#빠른-시작)
- [아키텍처](#아키텍처)
- [개발](#개발)
- [문서 안내](#문서-안내)
- [라이선스](#라이선스)

## 한눈에 보기

| | |
|---|---|
| **누구를 위한 것** | 폐쇄망·보안 환경의 공공기관 사무업무자 |
| **무엇을 하나** | 업무대화로 요청 → 지식폴더에서 근거를 찾아 답 → 그 대화를 HWPX 문서로 |
| **어디서 도나** | Windows 10/11 x64 데스크톱. 인터넷 불필요(로컬 LLM 내장) |
| **AI 모델** | 로컬 Ollama의 `gemma-4 E2B`(멀티모달). 외부 API(featherless 등)도 선택 가능 |
| **데이터 저장** | 전부 로컬. 지식폴더는 사용자가 지정한 업무 폴더를 그 자리에서 색인 |

## 주요 기능

6개 메뉴가 **업무대화 세션을 중심으로** 연결됩니다.

| 메뉴 | 할 수 있는 일 |
|---|---|
| 💬 **업무대화** | 로컬/외부 LLM 연결, 파일·이미지(클립보드 붙여넣기) 첨부, 세션별 기록, **지식폴더 근거를 출처와 함께 붙인 답변**, 일정·문서작성으로 이어가기 |
| 📅 **일정** | 월/주/일 캘린더, 사전 알림, 업무대화 세션 연결, 홈 '오늘 일정' 연동 |
| 📝 **문서작성** | 대화/직접 지시 → 구조 검토 → **미리보기 그대로 HWPX 생성**(시행문·1p 보고서·풀버전·이메일), **임의형식**(내 HWPX 양식의 빈칸 자동 채움) |
| 📚 **내 지식폴더** | 업무 폴더 지정 → 색인 → **업무별 지식위키** 자동 구성(분류체계 마법사), 키워드·근거 답변 검색, **증분 동기화**(추가·수정·이동·삭제 자동 반영), 무결성 점검 |
| 🧾 **실행기록** | 언제 무엇이 실행됐는지 입력·출력과 함께 투명하게(오늘·어제·이전 그룹, 쉬운 우리말) |
| ⚙️ **환경설정** | LLM 프로필(로컬/외부) 전환, 최초 실행 튜토리얼 다시 보기, 시작 시 변경 감지 등 |

부가: **홈 '오늘의 브리핑'**(일정·이어서 하기·지식 요약·앱 이용팁), 클립보드 이미지 첨부, 최초 실행 튜토리얼.

## 빠른 시작

### 방법 1 — 폐쇄망 원클릭 AI 패키지 (권장)

AI(Ollama)와 gemma-4 E2B 모델까지 **한꺼번에 자동 설치**되는 오프라인 패키지입니다.

1. `release/ai-pack/`의 최신 zip을 대상 PC로 복사(USB/폐쇄망).
2. 압축을 풀고 **`START_INSTALL_GUI.bat` 더블클릭**.
3. 자동으로 진행됩니다(사일런트). 관리자 승인(UAC) 창이 뜨면 "예".
4. 설치가 끝나면 **앱이 자동 실행되고 튜토리얼이 안내**합니다(LLM·지식폴더 설정).
5. (선택) `VALIDATE_INSTALL.bat`으로 무결성·Ollama·모델·앱 설정을 자동 점검.

> 자세한 절차·시스템 요구사항·문제 해결은 패키지 내 `INSTALL_GUIDE_KO.md` 참고. 시스템 요구: 여유 디스크 약 12GB, RAM 16GB 권장, WebView2는 설치본에 내장.

### 방법 2 — 앱만 설치 (모델 별도)

이미 Ollama와 모델이 있거나 외부 LLM API를 쓰는 경우, 앱 설치본만 실행합니다.

```
release/offline/<최신>/Gongmu_0.1.0_x64-setup.exe
```

앱 실행 후 우측 상단 **업무 엔진 상태**가 정상인지 확인하고, 환경설정에서 LLM(로컬 Ollama 또는 외부 API)을 연결합니다. API 키는 **본인이 직접 입력**합니다.

## 아키텍처

```
┌──────────────────── Windows 데스크톱 (Tauri 2) ────────────────────┐
│                                                                    │
│  React 19 UI  ──HTTP──▶  FastAPI 사이드카(Python 3.11)  ──▶ SQLite  │
│  (업무대화·일정·           (업무 로직·색인·문서생성)          (전부 로컬) │
│   문서작성·지식폴더               │                                  │
│   ·실행기록·환경설정)             ├──▶  Ollama (gemma-4 E2B)  로컬 LLM │
│                                  ├──▶  kordoc (.hwp/.hwpx 파싱)     │
│                                  └──▶  지식위키 (md 파생 + FTS5 색인) │
└────────────────────────────────────────────────────────────────────┘
```

- **로컬 우선**: 업무 데이터·색인·설정 전부 사용자 PC(`%LOCALAPPDATA%\kr.gongmu.workspace`)에 저장.
- **지식위키**: 지정한 업무 폴더를 그 자리에서 색인해 SQLite FTS5(트라이그램, 한국어 대응)로 검색하고, 업무별 위키 md를 파생 생성. GraphRAG가 아닌 경량 LLM-wiki 방식.
- **증분 동기화**: 파일 추가·수정·이동·삭제를 감지해 색인·태그·문서 가족(버전) 대표를 자동 갱신. 이동은 재파싱 없이 승계, 삭제는 소프트 삭제(30일 보관).

## 개발

```bash
# 사이드카(Python) 테스트
npm run sidecar:test

# 데스크톱(React) 테스트 + 빌드
npm run desktop:test
npm --workspace apps/desktop run build

# 개발 서버 (Tauri dev)
npm run desktop:dev

# 설치본 빌드 (NSIS)
npm run desktop:bundle          # → apps/desktop/src-tauri/target/release/bundle/nsis/

# 폐쇄망 오프라인 릴리스 스테이징
npm run release:offline

# AI 원클릭 패키지 빌드 (Ollama + gemma 동봉)
npm run release:download:gemma4 # 온라인 PC에서 1회 모델 캐시
npm run release:ai-pack -- --include-models <캐시> --include-ollama-installer <exe> --include-python-installer <exe>
```

**스택**: Tauri 2 · React 19 · Vite · FastAPI(Python 3.11) · SQLite(FTS5) · Ollama · kordoc · @rhwp/core(HWPX 미리보기).

## 문서 안내

관심 주제별 최신 문서 진입점입니다.

| 주제 | 문서 |
|---|---|
| 앱 기능·이용팁 | [docs/manual/2026-07-05-app-tips.md](docs/manual/2026-07-05-app-tips.md) |
| 지식폴더 증분관리 설계 | [docs/design/2026-07-05-incremental-knowledge-sync-design.md](docs/design/2026-07-05-incremental-knowledge-sync-design.md) |
| 최종 개선 설계 | [docs/design/2026-07-04-final-improvement-design.md](docs/design/2026-07-04-final-improvement-design.md) |
| 통합 테스트 계획·결과 | [docs/operations/2026-07-04-core5-integration-test-plan.md](docs/operations/2026-07-04-core5-integration-test-plan.md) |
| 원클릭 AI 패키지 | [docs/operations/2026-07-06-w9-oneclick-ai-pack.md](docs/operations/2026-07-06-w9-oneclick-ai-pack.md) |
| 설치 GUI·팁 | [docs/operations/2026-07-05-windows-installer-gui-tips.md](docs/operations/2026-07-05-windows-installer-gui-tips.md) |
| 시연영상 제작 노하우 | [docs/manual/2026-07-05-cap-style-demo-video-pack.md](docs/manual/2026-07-05-cap-style-demo-video-pack.md) |

> `docs/operations/`에는 개발 이력·검증 리포트가 날짜순으로 보존돼 있습니다.

## 라이선스

### 앱 코드

⚠️ **현재 이 저장소에는 `LICENSE` 파일이 없습니다.** 공개 배포 전 앱 코드의 라이선스를 정해 `LICENSE` 파일을 추가해야 합니다(미지정 시 기본적으로 "모든 권리 유보").

### 동봉 구성요소 (오프라인 AI 패키지)

동봉 구성요소는 모두 자유로운 라이선스입니다. 전체 고지는 패키지 내 `THIRD_PARTY_NOTICES.md` 참고.

| 구성요소 | 라이선스 | 재배포 |
|---|---|---|
| Ollama · kordoc · Node · FastAPI · Pydantic 등 | MIT | ✅ 자유 |
| httpx · NumPy · ChromaDB | BSD / Apache-2.0 | ✅ 자유 |
| Python | PSF | ✅ 자유 |
| WebView2 런타임 | Microsoft 재배포 약관(비-Apache) | ✅ 약관 하에 재배포 허용 |
| **gemma-4 E2B 모델** | **Apache 2.0** | ✅ 자유(라이선스 전문 + NOTICE 동봉, 변경 사실 명시) |

> Gemma 4는 이전 세대(Gemma 1/2/3/3n의 *Gemma Terms of Use*)와 달리 **Apache 2.0**으로 배포됩니다([Google Gemma 약관](https://ai.google.dev/gemma/terms) → Gemma 4는 [Apache 2.0](https://ai.google.dev/gemma/apache_2)로 분리, 2026-03). 상업적 사용·수정·재배포·파인튜닝이 자유롭고 사용 제한(금지 사용 정책) 전가 의무가 없습니다. 다만 실제로 pull하는 Ollama/GGUF 변환본의 `LICENSE`·`NOTICE`는 업로더가 잘못 표기했을 수 있으니 번들 직전 한 번 확인하세요.
