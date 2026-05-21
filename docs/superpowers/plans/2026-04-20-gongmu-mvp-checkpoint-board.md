# Gongmu MVP Checkpoint Board

## 1. 현재 상태 요약

2026-04-25 기준 Gongmu는 Windows 메인 개발 환경에서 다음 기준선을 만족한다.

- 핵심 기능 흐름이 모두 연결되어 있다.
  - 업무대화
  - 일정
  - 로컬검색 / Anything 외부 연계
  - Reference Set
  - 문서작성
  - 내 지식폴더
  - 파일정리
  - 승인 / 실행기록
- 기능 검증에서 막혔던 blocker 3개는 모두 해소됐다.
  - Content Base 생성 실패
  - 지식 승인 실패
  - 파일정리 적용 409
- `Anything`는 Gongmu 패키지에 번들하지 않고, 외부 설치형 연계 계약으로 정리됐다.
- Windows sidecar / desktop / installer smoke 루프는 계속 녹색이다.
- 업무대화 화면은 `상단 기능 탭 + 좌측 세션 레일 + 중앙 세션 캔버스` 구조로 재배치됐다.
- 우측 `현재 컨텍스트 / 승인 요청 / 최근 실행` 패널은 접기/펼치기와 선택적 표시가 가능하다.
- 일정 화면은 `day / week / month` 보기와 캘린더 내부 편집 패널 구조로 정리됐다.
- Anything은 기본 클립보드 handoff 외에, Windows에서 `GONGMU_ANYTHING_AUTOPASTE=1`일 때 실험적 자동 붙여넣기 시도를 지원한다.

### 2026-04-28 추가 진행 기록

- 업무대화는 코덱스형 3패널 레이아웃 기준으로 계속 다듬었다.
  - 좌측은 세션 레일과 기능 아이콘을 유지한다.
  - 중앙은 채팅 중심 화면으로 유지한다.
  - 우측은 컨텍스트 / 승인 / 실행기록 패널을 접고 펼 수 있다.
- 업무대화 채팅 입력과 출력 품질을 보강했다.
  - 사용자 메시지 라벨은 우측 정렬로 구분한다.
  - Assistant 응답은 Markdown 렌더링을 사용한다.
  - 첨부 파일, 이미지 미리보기, 세부 설정 오버레이, 응답 소요시간 표시 흐름을 반영했다.
  - 새 메시지 작성 후 채팅창이 상단으로 튀는 문제는 채팅 영역 높이 체인과 하단 스크롤 보정으로 수정했다.
- 외부 모델 연결 설정은 공급자별 프로필 저장 구조로 정리했다.
  - `local_first`, `internal_server`, `external_model` 모드별 설정을 분리한다.
  - ChatGPT/OpenAI, OpenRouter, Claude, Gemini, NVIDIA NIM, custom OpenAI-compatible 공급자 입력을 다룰 수 있게 했다.
- 지식폴더 고도화 방향을 제품 중심 구조로 재정의했다.
  - `지식폴더 -> 업무대화 세션 <- 파일찾기`
  - `업무대화 세션 -> 문서작성 / 도구 사용 / 향후 스킬 기반 콘텐츠 생성`
  - 지식폴더는 단순 메모 목록이 아니라, 복수 로컬 폴더를 감시하고 문서 정보를 체계화하는 원천 지식베이스로 본다.
  - 업무대화 기록을 주기적으로 요약해 작업 패턴, 사용자 선호, 엔티티 별칭, 문서 분류 규칙을 축적하는 개인화 학습 루프를 추가 목표로 확정했다.
  - 개인화 학습 결과는 기본값을 `승인 후 반영`으로 두고, 환경설정에서 낮은 위험 항목에 한해 `자동 반영`을 선택할 수 있게 한다.

## 2. 핵심 결정 로그

### 제품 / 구조

- 주 진입 흐름은 `업무대화 중심`으로 가져간다.
- 일정은 업무 흐름의 상위 개념이 아니라, 업무대화와 연결 가능한 보조 축으로 본다.
- `Reference Set`은 문서작성과 업무 세션을 위한 참고자료 묶음 개념으로 유지한다.
- 문서작성은 반드시 `Content Base(Markdown) -> Template -> 최종 산출물` 구조를 따른다.

### Anything 연계

- Gongmu는 `Anything` 바이너리를 재배포하지 않는다.
- 이유:
  - 사용자 요구사항상 별도 외부 프로그램으로 취급
  - [Docufinder](https://github.com/chrisryugj/Docufinder) 기반 Anything은 BSL 1.1 라이선스 계약을 고려해야 함
- Gongmu가 책임지는 범위:
  - 설치 감지
  - 설치 안내 fallback
  - 승인 후 실행
  - 결과 경로 import
  - Reference Set / 문서작성 handoff

## 3. 트랙별 상태

| ID | 트랙 | 상태 | 메모 |
| --- | --- | --- | --- |
| W0 | 플랫폼 / 계약 | 완료 | runtime-workspace, settings, approval, execution log 계약 정리 완료 |
| W1 | 일정 + 업무대화 + Reference Set | 완료 | 채팅 중심 셸, 세션 레일, calendar-first 입력 패널까지 반영 |
| W2 | 내 지식폴더 MVP | 완료 | 후보 생성/승인/검색/graph 흐름 정상 |
| W3 | 검색 / Anything 연계 | 완료 | 외부 설치형 Anything 감지, 설치 안내, launch, import, handoff 가능 |
| W4 | 문서작성 MVP | 완료 | Content Base 생성, stale 보호, 최종 저장 승인/적용 가능 |
| W5 | 파일정리 + 승인형 적용 | 완료 | 제안 생성, 승인, 적용, 롤백, 재요청 흐름 정상 |
| W6 | graph / 보조 탐색 | 완료 | 지식 검색 및 graph 요약 표시 가능 |
| W7 | Windows 운영 / 설치 루프 | 완료 | sidecar bundle, verify, MSI/NSIS smoke, GUI 검증 근거 확보 |

## 4. 최신 검증 기준선

2026-04-25 기준 최신 검증 결과:

| 영역 | 명령 | 결과 |
| --- | --- | --- |
| Sidecar | `npm.cmd run sidecar:test` | PASS (`28 passed`) |
| Desktop UI | `npm.cmd run desktop:test` | PASS (`32 passed`) |
| Desktop build | `npm.cmd run desktop:build` | PASS |
| Tauri / Rust | `node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS |
| 통합 검증 | `npm.cmd run verify:all` | PASS |
| Windows installer smoke | `npm.cmd run desktop:smoke:nsis` | PASS |

NSIS smoke 최근 검증 결과:

- install dir: `runtime-workspace\\cache\\nsis-smoke-install-20260424-002328`
- bundled sidecar `/health`: `status=ok`
- uninstall 후 `remaining_install_files: []`

## 5. 기능 검증 체크포인트

사용자 수동 점검과 이후 수정 배치를 반영한 상태 요약:

| 영역 | 최초 점검 | 현재 상태 | 메모 |
| --- | --- | --- | --- |
| 일정 생성 | pass | pass | 다음 개선은 calendar-first UI |
| 업무 세션 연결 | pass | pass | 다음 개선은 세션 중심 IA 강화 |
| 수동 Reference Set 생성 | pass | pass | 역할 설명/직접 import UX 개선 여지 |
| Content Base 생성 | fail | pass | fetch fail 수정 완료 |
| stale 보호 | fail | pass | 초안 무효화 보호 검증 완료 |
| 최종 문서 저장 | fail | pass | 승인/적용/산출물 경로 확인 가능 |
| Anything 실행 요청 | partial | pass | 외부 설치형 계약으로 정리 |
| Anything 실행 / 다시 열기 | fail | pass | 외부 설치본 감지 및 reopen 흐름 가능 |
| Anything -> Reference Set import | fail | pass | 경로 import 가능 |
| Continue to Documents handoff | 미평가 | pass | 제목/목적/요약 카드 handoff 가능 |
| 지식 후보 생성 | pass | pass | 상세보기 UX는 후속 과제 |
| 지식 페이지 승인 | fail | pass | 승인 실패 수정 완료 |
| 지식 검색 | fail | pass | 검색/graph 흐름 정상 |
| 파일정리 제안 생성 | pass | pass | 경로 선택 UX는 후속 과제 |
| 파일정리 적용 | partial | pass | 409 / 디렉터리 apply 수정 완료 |
| 파일정리 롤백 | fail | pass | 롤백 후 재요청 흐름 복구 완료 |
| managed sidecar 제어 | pass | pass | start / restart / stop 정상 |
| unmanaged sidecar 복구 | pass | pass | 자동 복구 흐름 정상 |
| 승인 큐 일관성 | pass | pass | replay safety 보강 완료 |
| 실행기록 | partial | partial | 가독성 / 상세보기는 후속 과제 |

## 6. Windows 운영 체크포인트

### Anything 외부 설치형 연계

- 로컬 설치 감지 경로:
  - `C:\Users\USER\AppData\Local\Anything\docufinder.exe`
- helper 명령:
  - `npm.cmd run desktop:prepare:anything`
- 현재 기대 모드:
  - 설치본이 있으면 `external_app_detected`
  - 없으면 설치 안내 페이지 fallback
- 실험적 자동입력:
  - 환경변수 `GONGMU_ANYTHING_AUTOPASTE=1`일 때만 Windows에서 best-effort `Ctrl+V` 자동 붙여넣기를 시도
  - 기본값은 off
  - 실패해도 기본 클립보드 handoff 계약은 유지

### GUI 설치 검증 메모

- 앱 창 표시: 확인됨
- bundled sidecar 시작 / 연결: 확인됨
- uninstall 후 `uninstall.exe`만 사라지고 잔여 폴더가 남는 경미한 follow-up이 한 번 관찰됨
- 현재 판단:
  - 기능 blocker 아님
  - `known follow-up`으로 유지

## 7. 현재 남은 과제

제품 blocker는 없고, 남은 과제는 완성도 개선 성격이 강하다.

우선순위:

1. 지식폴더 고도화: 복수 폴더 소스 등록, 파일 감시, 문서 추출, 검색/그래프 색인, 업무대화 세션 연결
2. 개인화 학습 루프: 업무대화 기록 기반 작업패턴/선호/엔티티/추출규칙 후보 생성과 승인 후 반영
3. 자유형 업무대화 자체의 메시지/스레드 모델 확장
4. 일정 칸 내부 표시 밀도와 직접 수정 UX 보강
5. 지식 후보 / 파일정리 제안 / 실행기록 카드 상세보기 패턴 공통화
6. 파일정리 목적 설명 및 경로 선택 UX 개선
7. 설치 패키지 최종 점검 재실행

## 8. 다음 배치 권장

다음 배치는 `지식폴더 중심 업무지능 고도화`로 가져간다.

### 추천 순서

1. 지식폴더 소스 등록 / 감시 / 수집 / 추출
2. 지식 파일과 업무대화 세션의 컨텍스트 연결
3. 업무대화 기록 기반 개인화 학습 저장소와 승인 정책
4. 세션 주변 그래프와 검색/추천 UI
5. 문서작성 / 도구 사용 handoff 고도화
6. 기능 점검 후 설치 패키지 재검증
## 9. 2026-04-28 지식폴더/개인화 고도화 진행 기록

사용자 정정사항을 반영해 지식폴더의 주 흐름을 “메모 후보”가 아니라 “로컬 PC 지정 폴더와 하위 문서를 스캔해 지식베이스 DB를 구성하는 방식”으로 재정의했다.

이번 배치 완료 항목:

- 지식 소스 폴더 등록/목록/스캔 API 추가
- `knowledge_source_files` 기반 파일 상태 추적, 본문 발췌, 삭제 감지 추가
- 데스크톱 지식폴더 화면을 폴더 기반 지식베이스 생성 흐름으로 변경
- 스캔된 소스 파일이 `/api/knowledge/search`의 `source_file_hits`로 검색되도록 확장
- 업무대화 세션과 파일 경로를 연결하는 `work_session_file_links` 추가
- 업무대화 화면에 연결 파일 요약/추가/삭제 UI 추가
- Anything import 결과를 선택된 업무대화 세션 파일 링크로도 남기도록 연결
- 개인화 학습 후보 저장 테이블과 세션 분석/승인/거절 API 추가
- 승인된 개인화 후보를 `personalization/session-summaries`와 `personalization/audit-log`에 기록
- 데스크톱에서 “이 세션 학습 후보 생성”과 지식폴더의 후보 승인/거절 UI 추가

검증:

```powershell
npm.cmd run sidecar:test -- services/sidecar/tests/test_knowledge_sources.py services/sidecar/tests/test_session_file_links.py services/sidecar/tests/test_personalization_learning.py
npm.cmd --workspace apps/desktop run test -- src/session-file-links.test.tsx src/knowledge-sources.test.tsx
npm.cmd run sidecar:test
npm.cmd run desktop:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

결과: PASS

남은 사용자 확인 필요:

- 실제 업무 폴더를 등록해 스캔 결과가 이해 가능한지 확인
- 업무대화의 연결 파일 UI가 자연스러운지 확인
- 개인화 학습 후보 문구와 승인 위치가 부담스럽지 않은지 확인
- PDF/DOCX/XLSX 본문 추출을 즉시 포함할지 후속 확장으로 둘지 결정

## 10. 2026-04-28 지식폴더 즉시반영/그래프 보강 진행 기록

사용자 점검 의견을 반영해 지식폴더 흐름을 다시 단순화했다. 수동 메모를 지식 후보로 올리고 승인하는 흐름은 제거하고, 지식베이스 원천을 `지식폴더`와 `업무대화`로 한정했다.

완료 항목:

- 업무대화의 별도 파일 경로 입력 UI를 제거하고 `관련 파일 연결` 버튼으로 로컬파일/정보검색 화면으로 이동하게 변경
- 로컬파일/정보검색 화면에 `현재 연결 대상 세션` 안내 추가
- 업무대화 세션 분석 결과를 후보 승인 없이 즉시 개인화 저장소에 반영
- 지식폴더 화면에서 수동 메모 후보 등록과 후보 승인 UI 제거
- DOCX/XLSX/PPTX/HWPX ZIP XML 기반 본문 추출 추가
- PDF는 `pypdf` 사용 가능 시 본문 추출, 불가 시 metadata-only 유지
- `/api/knowledge/graph`가 `source_folder`, `source_file`, `keyword` 노드를 포함하도록 보강
- 지식폴더 화면에 `지식 그래프 미리보기` 추가

검증:

```powershell
npm.cmd run sidecar:test -- services/sidecar/tests/test_personalization_learning.py services/sidecar/tests/test_knowledge_sources.py
npm.cmd --workspace apps/desktop run test -- src/session-file-links.test.tsx src/knowledge-sources.test.tsx
npm.cmd run sidecar:test
npm.cmd run desktop:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

결과: PASS

- `sidecar:test`: 53 passed
- `desktop:test`: 16 files / 37 tests passed
- `cargo check`: PASS

남은 사용자 확인 필요 항목:

- 실제 업무 폴더 스캔 결과의 제목/본문 발췌/상태 표시가 이해 가능한지 확인
- `관련 파일 연결` -> 로컬파일/정보검색 -> Anything/import 흐름이 자연스러운지 확인
- 실제 DOCX/XLSX/PPTX/PDF 업무문서의 본문 추출 품질 확인
- 지식 그래프 미리보기의 폴더/파일/키워드 관계 표현이 직관적인지 확인

## 11. 2026-04-28 지식폴더/파일연결 화면 최적화 기록

사용자 점검 의견을 반영해 지식폴더와 업무대화 파일연결 화면을 정보 우선순위 기준으로 재배치했다.

완료 항목:

- 지식폴더 화면 최상단을 `지식 그래프`로 변경
- 폴더, 문서, 키워드 관계를 단어칩 나열이 아니라 SVG 노드/엣지 맵으로 표시
- 지식 소스 등록/스캔, 등록된 문서 메타데이터, 업무대화 반영 기록을 접이식 상세 섹션으로 이동
- 문서 메타데이터 카드에 `본문 추출됨`, `메타데이터만`, 추출물 경로를 표시
- 업무대화의 연결 파일 상세 패널 제거
- 일정 연결 옆에 `파일 연결` 버튼과 `연결 파일 N개` 토글 배치
- 연결 파일 목록은 토글 클릭 시 팝오버로 표시
- 채팅 화면 행 비율을 대화 2, 입력 1에 가깝게 조정

검증:

```powershell
npm.cmd --workspace apps/desktop run test -- src/session-file-links.test.tsx src/knowledge-sources.test.tsx
npm.cmd run sidecar:test
npm.cmd run desktop:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

결과: PASS

- `sidecar:test`: 53 passed
- `desktop:test`: 16 files / 37 tests passed
- `cargo check`: PASS

남은 사용자 확인 필요 항목:

- 실제 데이터가 충분히 쌓였을 때 그래프 맵의 노드 배치가 직관적인지 확인
- 연결 파일 토글/팝오버가 채팅 작업 흐름을 방해하지 않는지 확인
- 본문 추출 상태 문구와 추출물 경로가 실제 사용자에게 충분히 이해 가능한지 확인

## 12. 2026-04-28 지식그래프 탐색성 보강 기록

사용자 점검 의견을 반영해 지식 그래프가 카드 안에서 잘리는 문제와 범례/검색 보조 기능의 의미가 불명확한 문제를 정리했다.

완료 항목:

- 지식 그래프 SVG 높이를 노드 수에 따라 동적으로 계산하도록 변경
- 그래프 컨테이너에 상하좌우 스크롤과 세로 리사이즈 지원 추가
- 그래프 하단 범례를 `전체`, `폴더`, `문서`, `키워드` 필터 버튼으로 변경
- 범례 선택 시 해당 노드 유형과 연결 관계를 강조하고 나머지는 흐리게 표시
- `지식 검색과 관계 보기`를 `키워드로 관련 문서 찾기`로 변경
- 해당 검색 기능이 전체 그래프가 아니라 검색어 기준으로 관련 문서와 연결 키워드를 좁혀보는 보조 탐색임을 화면에 설명

검증:

```powershell
npm.cmd --workspace apps/desktop run test -- src/knowledge-sources.test.tsx
npm.cmd run desktop:test
npm.cmd run sidecar:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

결과: PASS

- `knowledge-sources.test.tsx`: 3 tests passed
- `desktop:test`: 16 files / 38 tests passed
- `sidecar:test`: 53 passed
- `cargo check`: PASS

남은 사용자 확인 필요 항목:

- 실제 업무 폴더 데이터에서 스크롤/리사이즈만으로 그래프 전체 파악이 충분한지 확인
- 범례 필터 방식이 직관적인지 확인
- 다음 단계에서 드래그 팬/줌, 노드 클릭 상세보기, 관계 경로 강조가 필요한지 판단

## 13. 2026-04-28 자체 로컬 파일찾기 1차 구현 기록

사용자 결정에 따라 파일찾기 기본 흐름을 Anything 외부 실행 의존에서 분리했다. 앞으로 기본 UX는 `지식폴더에 등록된 업무폴더 스캔 -> 내장 파일찾기 -> 개별 파일을 업무대화 세션에 연결`로 둔다. Reference Set은 사용자가 반드시 이해해야 하는 핵심 개념이 아니라, 같은 자료 구성을 반복 사용할 때만 쓰는 고급 `작업자료 묶음`으로 낮췄다.

완료 항목:

- `knowledge_source_files`를 1차 로컬 파일 인덱스로 사용
- sidecar `GET /api/files/search` 추가
- 파일명, 경로, 추출 본문 기반 점수화와 `match_reasons` 반환 추가
- 본문 추출 전인 `metadata_only` 파일도 파일명/경로 검색에 포함
- 삭제된 파일은 검색 결과에서 제외
- desktop API `searchLocalFiles(query)` 추가
- `로컬파일/정보검색` 화면 상단에 `내장 파일찾기` 추가
- 검색 결과에서 현재 업무대화 세션에 개별 파일을 바로 연결하는 버튼 추가
- 이미 연결된 파일은 `연결됨` 상태로 표시
- Reference Set 생성 UI를 고급 접힘 영역으로 이동하고 `작업자료 묶음` 용어로 정리
- Anything은 `선택 연계` 영역의 외부 고급검색 보조 도구로 유지
- 기존 우측 패널 자동 열림 테스트를 새 고급 접힘 UX에 맞게 정렬

검증:

```powershell
npm.cmd run sidecar:test -- services/sidecar/tests/test_knowledge_sources.py -q
npm.cmd --workspace apps/desktop run test -- src/local-file-search.test.tsx
npm.cmd --workspace apps/desktop run test -- src/session-file-links.test.tsx src/anything-launch.test.tsx src/local-file-search.test.tsx
npm.cmd run sidecar:test -- services/sidecar/tests/test_knowledge_sources.py services/sidecar/tests/test_session_file_links.py
npm.cmd run sidecar:test
npm.cmd run desktop:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

결과: PASS

- `sidecar:test`: 54 passed
- `desktop:test`: 17 files / 39 tests passed
- `cargo check`: PASS
- dev 재실행 확인: sidecar `/health` = `ok`, `gongmu-desktop.exe` 실행 중

남은 사용자 확인 필요 항목:

- 실제 업무폴더를 지식폴더에 등록한 뒤 파일명/본문 검색 결과가 충분히 직관적인지 확인
- 세션에 개별 파일을 연결하는 흐름이 Reference Set보다 자연스러운지 확인
- 대용량 폴더에서 단순 DB scan 방식으로 충분한지, FTS5/증분 인덱싱을 바로 다음 단계에 넣을지 판단

## 14. 2026-05-05 HWPX 문서작성 산출 연계 기록

사용자가 제시한 `Kminer2053/HwpxMaker` 리포지터리를 확인하고, 공무 워크스페이스의 문서작성 최종 산출을 Markdown 복사에서 HWPX 생성으로 전환했다. 리포지터리에 명시 라이선스 파일이 없으므로 소스 코드를 그대로 복사하지 않고, 공개된 JSON 입력 구조와 `python-hwpx` 기반 산출 방식을 참고해 sidecar 내부에 호환 writer를 구현했다.

완료 항목:

- `python-hwpx==2.9.1`, `lxml==5.4.0` sidecar 의존성 추가
- `services/sidecar/src/gongmu_sidecar/hwpx_writer.py` 추가
- Content Base Markdown을 공공문서 payload로 변환하는 어댑터 추가
- `report`, `meeting`, `review` 템플릿 키와 문서 목적을 `officialMemo`, `onePageReport`, `fullReport`, `email` 형식으로 매핑
- 최종 저장 적용 시 `.hwpx` 주 산출물과 같은 이름의 검토용 `.md`를 함께 생성
- 승인 요청, 승인 후 적용, 중복 파일명 버전 관리, Windows 금지 문자 sanitizing 흐름 유지
- API 응답 `artifact`에 `path`, `markdown_path`, `format` 반환
- 문서작성 화면의 최종 저장 설명을 HWPX 산출 기준으로 보정

검증:

```powershell
npm.cmd run sidecar:test -- services/sidecar/tests/test_api_flows.py -q
npm.cmd --workspace apps/desktop run test -- src/app.test.tsx
npm.cmd run sidecar:test
npm.cmd run desktop:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

결과: PASS

- `sidecar:test`: 54 passed
- `desktop:test`: 17 files / 39 tests passed
- `cargo check`: PASS
- dev 재실행 확인: sidecar `/health` = `ok`, `gongmu-desktop.exe` 실행 중

남은 사용자 확인 필요 항목:

- 실제 문서작성 화면에서 Content Base 생성 후 최종 저장을 적용했을 때 `.hwpx`와 검토용 `.md`가 함께 보이는지 확인
- 생성된 HWPX를 한컴오피스/한글 뷰어에서 열어 문단, 한글, 목록이 정상 표시되는지 확인
- 다음 단계에서 기관 고유 `.hwpx`/`.hwtx` 템플릿 적용 UI와 결재란/붙임/수신처 레이아웃을 구체화

## 15. 2026-05-06 업무대화 세션 기반 문서작성 연결 기록

업무대화 세션을 작업의 중심 단위로 두고, 세션 대화내용, 연결 일정, 연결 파일이 문서작성 Content Base로 이어지도록 고도화했다. 문서작성 화면은 `대화세션에서 작성`과 `바로 작성` 두 흐름을 모두 지원하며, 최종 산출은 기존 원칙인 `Content Base(Markdown) -> Template -> HWPX` 구조를 유지한다.

완료 항목:

- 업무대화 툴바에 `문서작성으로 이어가기` 버튼 추가
- 버튼 클릭 시 문서작성 화면으로 이동하고 현재 업무대화 세션을 자동 선택
- 문서 제목, 문서 목적, 작성 개요를 세션명 기준으로 자동 채움
- Content Base 생성 payload에 `source_session_id`, `outline`, `document_format`, 작성 슬롯, 직접 연결 파일, 사용자 양식 경로 추가
- Content Base Markdown에 업무대화 기록, 연결 일정, 연결 파일, 바로 작성 개요, 작성 슬롯, 출력 유형 반영
- 출력 유형을 `자동 선택`, `시행문`, `1페이지 보고서`, `풀버전 보고서`, `이메일`로 정리
- `.hwpx`/`.hwtx` 사용자 양식 업로드 및 목록 API 추가
- 업로드한 사용자 양식 파일을 최종 HWPX 생성의 기본 문서로 열고 생성 내용을 이어 붙이도록 변경
- sidecar 오류 처리를 보강해 잘못된 세션/양식 경로를 명확한 HTTP 오류로 반환
- 구현 스펙과 실행계획 문서 추가
  - `docs/superpowers/specs/2026-05-06-session-to-documents-workflow-design.md`
  - `docs/superpowers/plans/2026-05-06-session-to-documents-workflow-implementation-plan.md`

검증:

```powershell
npm.cmd run sidecar:test -- services/sidecar/tests/test_document_workflow.py -q
npm.cmd run desktop:test -- src/document-workflow-handoff.test.tsx
npm.cmd run sidecar:test
npm.cmd run desktop:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check -- services/sidecar/src/gongmu_sidecar/db.py services/sidecar/src/gongmu_sidecar/app.py services/sidecar/src/gongmu_sidecar/documents.py services/sidecar/src/gongmu_sidecar/hwpx_writer.py services/sidecar/tests/test_document_workflow.py apps/desktop/src/api.ts apps/desktop/src/app.tsx apps/desktop/src/document-workflow-handoff.test.tsx docs/superpowers/specs/2026-05-06-session-to-documents-workflow-design.md docs/superpowers/plans/2026-05-06-session-to-documents-workflow-implementation-plan.md
```

결과: PASS

- `sidecar:test`: 57 passed
- `desktop:test`: 18 files / 40 tests passed
- `cargo check`: PASS
- `git diff --check`: PASS
- dev 재실행 확인: sidecar `/health` = `ok`, `gongmu-desktop.exe` 실행 중

남은 사용자 확인 필요 항목:

- 업무대화 화면에서 `문서작성으로 이어가기`를 눌렀을 때 문서작성 입력값 자동 채움이 자연스러운지 확인
- `바로 작성` 모드에서 관련 파일 경로 붙여넣기 방식이 충분한지, 이후 파일 선택/첨부 대화상자가 필요한지 판단
- 실제 기관 `.hwpx` 또는 `.hwtx` 양식을 업로드한 뒤 생성된 HWPX가 한글/한컴오피스에서 기대한 양식 기반으로 열리는지 확인
