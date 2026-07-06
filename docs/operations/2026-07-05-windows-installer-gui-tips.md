# Windows GUI 설치 프로그램 — 환영·이용팁·마침 페이지 커스터마이즈

- 작성일: 2026-07-05
- 대상: `Gongmu_<버전>_x64-setup.exe` (Tauri 2 NSIS 번들)
- 전제: 폐쇄망 오프라인 설치. 설치 프로그램 어디에도 외부 URL이 없다.

## 1. 무엇이 바뀌었나

일반적인 Windows 설치 프로그램처럼, 설치 마법사가 앱을 소개하고 설치가
진행되는 동안 이용팁을 보여준다.

| 단계 | 내용 |
| --- | --- |
| 환영 페이지 | 앱 소개 1문장 + 핵심 기능 5줄(업무대화·문서작성·내 지식폴더·일정·실행기록) |
| 설치 진행(InstFiles) | 페이지 헤더 부제에 이용팁 표시(파일 복사 전/후 2회 교체) + 상세 로그에 팁 6개 전체 출력 |
| 마침 페이지 | "처음 실행하면 화면 튜토리얼이 안내" 문구 + 실행 체크박스(Tauri 기본 제공) |

설치 프로그램 UI 언어는 한국어(`languages: ["Korean"]`)로 고정했다.

## 2. 구현 위치

| 파일 | 역할 |
| --- | --- |
| `apps/desktop/src-tauri/nsis/installer-hooks.nsh` | 환영/마침 페이지 define + `NSIS_HOOK_PREINSTALL`/`NSIS_HOOK_POSTINSTALL` 매크로 |
| `apps/desktop/src-tauri/tauri.conf.json` | `bundle.windows.nsis.installerHooks` 연결, 한국어 설정 |
| `scripts/generate-nsis-tips.mjs` | 팁 단일 원천 `apps/desktop/src/shared/tips.ts`에서 설치용 팁 6개를 추출해 훅 파일의 생성 구간을 갱신 (`--check`로 동기화 검사) |
| `scripts/tauri-build-with-wix-fallback.mjs` | 번들 빌드 시작 시 팁 추출을 자동 실행 → 빌드마다 tips.ts 최신 문구 반영 |
| `scripts/windows-nsis-hooks-smoke.mjs` | makensis로 훅 파일 컴파일을 검증하는 스모크 |

Tauri의 기본 `installer.nsi` 템플릿은 훅 파일을 **페이지 정의보다 먼저**
include 하므로, 템플릿을 통째로 교체하지 않고도 `MUI_WELCOMEPAGE_*` /
`MUI_FINISHPAGE_*` define을 훅 파일에서 주입할 수 있다(템플릿 교체 대비
Tauri CLI 버전 업그레이드에 안전).

## 3. 팁 문구 관리 규칙

- 단일 원천은 `apps/desktop/src/shared/tips.ts` (`APP_TIPS`).
- 설치 프로그램에 넣을 팁 id 목록은 `scripts/generate-nsis-tips.mjs`의
  `INSTALLER_TIP_IDS` (현재 6개, 카테고리 고르게 선정).
- 문구 수정 절차: tips.ts 수정 → `node scripts/generate-nsis-tips.mjs` 실행
  → `installer-hooks.nsh` 생성 구간이 갱신됨. 번들 빌드
  (`npm run desktop:bundle`) 시에도 자동 갱신된다.
- 생성 구간을 직접 수정하면 안 된다(다음 빌드에서 덮어써짐).

## 4. 설치 중 팁 "회전"의 한계 (정직 고지)

조사 결과, Tauri 기본 템플릿의 Install 섹션에는 훅 지점이
`PREINSTALL`/`POSTINSTALL` 두 곳뿐이고, InstFiles 페이지에서는
nsDialogs 타이머(`${NSD_CreateTimer}`)를 쓸 수 없다(타이머는 custom
page 콜백 컨텍스트에서만 동작). Banner 플러그인은 별도 창을 띄워
진행률을 가리는 데다 역시 훅 지점에서만 문구를 바꿀 수 있어 이득이 없다.

따라서 시간 기반 완전 회전 대신 다음 절충안을 적용했다.

- 파일 복사 시작 전: 헤더 부제 = 팁 1, 상세 로그에 팁 1~3 출력
- 파일 복사 완료 후: 헤더 부제 = 팁 4, 상세 로그에 팁 4~6 출력
- 마침 페이지: 튜토리얼 안내 + 홈 화면 '앱 이용팁' 카드 재안내

사이드카(PyInstaller 산출물) 복사가 설치 시간의 대부분을 차지하므로,
사용자는 복사 내내 팁 1(헤더)과 팁 1~3(로그)을 보게 된다. 완전 회전이
필요해지면 템플릿 전체 교체(파일 복사를 여러 구간으로 쪼개 구간마다
헤더 갱신)로 확장할 수 있으나, Tauri CLI 버전과의 동기화 부담이 생긴다.

## 5. 검증 방법

```powershell
# 1) 팁 동기화 + 훅 컴파일 스모크 (수 초)
node scripts/generate-nsis-tips.mjs --check
node scripts/windows-nsis-hooks-smoke.mjs

# 2) 실제 번들 (프론트 빌드 + cargo + NSIS)
npm run desktop:bundle

# 3) 설치 파일 무인 설치/제거 스모크
npm run desktop:smoke:nsis
```

`windows-nsis-hooks-smoke.mjs`는 Tauri 템플릿과 같은 순서(훅 include →
MUI 페이지 → Install 섹션 훅 삽입)를 재현한 드라이버 스크립트를
`%LOCALAPPDATA%\tauri\NSIS\Bin\makensis.exe`로 컴파일해 훅 문법·한국어
문구·define 충돌 여부를 확인한다.

## 6. GUI 육안 확인 체크리스트

무인(silent) 스모크로는 페이지 문구가 보이지 않으므로, 산출된
`..._x64-setup.exe`를 더블클릭해 아래를 확인한다.

- [ ] 환영 페이지: 제목·소개·기능 5줄이 잘리지 않고 표시되는가
- [ ] 설치 진행 페이지: 헤더 부제에 "이용팁: …"이 보이는가, 상세 로그에 팁 6개가 찍히는가
- [ ] 파일 복사 완료 시점에 헤더 팁이 팁 4로 바뀌는가
- [ ] 마침 페이지: 튜토리얼 안내 문구 + "공무 업무 에이전트 실행" 체크박스가 보이는가
- [ ] 설치 프로그램 전체가 한국어로 표시되는가
