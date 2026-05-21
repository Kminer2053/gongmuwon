# Gongmu Technical Overview

이 문서는 Gongmu를 처음 인수하는 개발자가 구조와 실행 흐름을 빠르게 파악할 수 있도록 정리한 기술 부속문서다. 일반 사용자를 위한 소개는 루트 `README.md`를 먼저 보면 된다.

## 1. 시스템 목표

Gongmu는 공공분야 사무업무자를 위한 로컬 우선 업무 기억 시스템이다. 핵심 단위는 업무대화 세션이며, 세션에 일정, 파일, 지식폴더, 문서작성, 실행기록을 연결한다.

```text
지식폴더 -> 업무대화 세션 <- 파일찾기
업무대화 세션 -> 문서작성 / 일정 / 도구 실행 / 실행기록
```

## 2. 런타임 구성

| 계층 | 기술 | 역할 |
| --- | --- | --- |
| Desktop | Tauri 2, React 19, TypeScript, Vite | Windows 데스크톱 UI와 native command bridge |
| 업무엔진 | Python 3.11, FastAPI | API, 데이터 저장, GraphRAG, LLM provider, 문서작성 |
| 저장소 | SQLite | 기본 작업공간, 세션, 일정, 파일 링크, 실행로그, 그래프 mirror |
| Vector | ChromaDB optional | chunk embedding 저장과 semantic retrieval |
| 패키징 | PyInstaller, Tauri NSIS | Windows x64 폐쇄망 설치패키지 |

## 3. 주요 명령

```powershell
npm.cmd run sidecar:serve
npm.cmd run desktop:dev
npm.cmd run sidecar:test
npm.cmd run desktop:test
npm.cmd run verify:all
npm.cmd run desktop:bundle
npm.cmd run desktop:smoke:nsis
npm.cmd run release:offline
```

`verify:all`은 sidecar test, desktop test, desktop build, Rust cargo check를 순서대로 실행한다. 설치파일 검증은 `desktop:bundle` 이후 `desktop:smoke:nsis`로 확인한다.

## 4. Desktop 구조

주요 파일은 다음과 같다.

| 파일 | 역할 |
| --- | --- |
| `apps/desktop/src/app.tsx` | 메인 UI, 업무대화, 일정, 지식폴더, 문서작성 화면 |
| `apps/desktop/src/api.ts` | sidecar API client와 타입 |
| `apps/desktop/src/runtime.ts` | Tauri runtime bridge와 dev fallback |
| `apps/desktop/src/styles.css` | Codex 스타일 3패널 레이아웃과 반응형 UI |
| `apps/desktop/src-tauri/src/main.rs` | 업무엔진 자동 시작/복구, native menu, zoom, 파일/폴더 열기 |

사용자 표현에서는 `sidecar` 대신 `업무엔진`을 사용한다. 코드 내부에서는 Tauri sidecar 개념이 남아 있을 수 있지만 UI 문구는 업무엔진으로 통일한다.

## 5. Sidecar 구조

주요 파일은 다음과 같다.

| 파일 | 역할 |
| --- | --- |
| `services/sidecar/src/gongmu_sidecar/app.py` | FastAPI endpoint 등록 |
| `services/sidecar/src/gongmu_sidecar/db.py` | SQLite schema와 repository 함수 |
| `services/sidecar/src/gongmu_sidecar/settings.py` | LLM, GraphRAG, 작업공간 설정 |
| `services/sidecar/src/gongmu_sidecar/llm.py` | Ollama/OpenAI/OpenRouter/Claude/Gemini/NIM provider |
| `services/sidecar/src/gongmu_sidecar/local_file_search.py` | 자체 로컬 파일명 검색 |
| `services/sidecar/src/gongmu_sidecar/document_parsers.py` | PDF/DOCX/XLSX/PPTX/TXT/MD/HWPX 파서 |
| `services/sidecar/src/gongmu_sidecar/graphrag_ingestion.py` | background ingestion, chunking, 품질 로그 |
| `services/sidecar/src/gongmu_sidecar/graphrag_backends.py` | ChromaDB optional vector backend와 SQLite fallback |
| `services/sidecar/src/gongmu_sidecar/hwpx_writer.py` | HWPX 산출 helper |

## 6. 데이터 흐름

### 업무대화

1. Desktop이 `/api/work-sessions/{id}/turn`으로 사용자 메시지와 첨부 정보를 전송한다.
2. 업무엔진이 세션 맥락, 연결 일정, 연결 파일, 지식폴더 검색 결과를 병합한다.
3. 선택된 LLM provider로 요청한다.
4. 응답, latency, 오류, 최근 맥락을 세션과 실행기록에 저장한다.

### 지식폴더 GraphRAG

1. 사용자가 로컬 폴더를 지식 소스로 등록한다.
2. 스캔 단계가 파일 메타데이터와 해시를 수집한다.
3. ingestion 단계가 파서, structured document model, section-aware chunking을 수행한다.
4. embedding backend가 활성화되어 있으면 ChromaDB에 chunk를 upsert한다.
5. SQLite graph mirror에 document, chunk, keyword, ontology relation을 저장한다.
6. 검색/질문 시 vector retrieval과 graph relation을 함께 사용하고 출처를 반환한다.

### 문서작성

1. 업무대화 세션, 연결 파일, Reference Set 또는 직접 개요를 출발점으로 한다.
2. Content Base Markdown을 생성한다.
3. 출력 유형은 시행문, 1페이지 보고서, 풀버전 보고서, 이메일을 기준으로 한다.
4. 승인 후 HWPX 또는 텍스트 산출물로 저장한다.

## 7. 폐쇄망 패키징

폐쇄망 설치패키지 생성 흐름은 다음과 같다.

```powershell
npm.cmd run desktop:bundle
npm.cmd run desktop:smoke:nsis
npm.cmd run release:offline
```

`desktop:bundle`은 PyInstaller 업무엔진 번들을 만들고 Tauri NSIS 설치파일을 생성한다. `release:offline`은 최신 NSIS 설치파일을 `release/offline/Gongmu_<version>_windows_x64_offline_<timestamp>` 폴더로 복사하고 SHA256 및 설치 안내 README를 생성한 뒤 zip으로 묶는다.

## 8. 보안과 운영 경계

- 기본 저장 위치는 로컬 작업공간이다.
- 외부 LLM provider는 사용자가 명시적으로 endpoint/API key를 설정해야 한다.
- 폐쇄망 PC의 로컬 LLM 모델 파일은 설치패키지에 포함하지 않는다.
- API key, 비밀번호, 민감정보는 업무대화 응답에서 노출하지 않도록 provider/system prompt guardrail을 유지해야 한다.
- ChromaDB embedded mode는 sidecar 단일 writer 원칙을 따른다.

## 9. 검증 기준

현재 브랜치에서 기능 완료를 주장하기 전 최소 기준은 다음과 같다.

```powershell
npm.cmd run sidecar:test
npm.cmd run desktop:test
npm.cmd run desktop:build
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

릴리스/설치 관련 변경이면 추가로 다음을 실행한다.

```powershell
npm.cmd run desktop:bundle
npm.cmd run desktop:smoke:nsis
npm.cmd run release:offline
```

## 10. 남은 운영 검증 항목

- 실제 기관 HWPX/HWTX 양식에 대한 렌더링 품질 확인
- 대규모 HWP/PDF/PPTX 폴더의 parser fallback 품질 개선
- 폐쇄망 PC별 Ollama 또는 내부 endpoint 설정 검증
- ChromaDB 활성 상태에서 장시간 ingestion 안정성 확인
- 실제 사용자 업무 폴더 기준 검색 품질과 citation 정확도 측정
