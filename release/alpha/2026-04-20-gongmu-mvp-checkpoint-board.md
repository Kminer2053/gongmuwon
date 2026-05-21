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

1. 자유형 업무대화 자체의 메시지/스레드 모델 확장
2. 일정 칸 내부 표시 밀도와 직접 수정 UX 보강
3. 지식 후보 / 파일정리 제안 / 실행기록 카드 상세보기 패턴 공통화
4. 파일정리 목적 설명 및 경로 선택 UX 개선
5. 설치 패키지 최종 점검 재실행

## 8. 다음 배치 권장

다음 배치는 `기능 완성도 개선` 중심으로 가져간다.

### 추천 순서

1. 업무대화 세션 구조 강화
2. 일정 calendar-first UI
3. 실행기록 / 제안 카드 상세보기
4. 파일정리 UX 보강
5. 기능 점검 후 설치 패키지 재검증
