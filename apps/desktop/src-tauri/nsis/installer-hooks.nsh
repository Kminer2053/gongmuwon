; ==========================================================================
; '공무원'(로컬 AI에이전트 워크플레이스, 내부명 Gongmu) NSIS 설치 프로그램 훅.
;
; tauri.conf.json > bundle.windows.nsis.installerHooks 로 연결되며,
; Tauri 기본 installer.nsi 템플릿이 페이지 정의(!insertmacro MUI_PAGE_*)보다
; 먼저 이 파일을 include 하므로 MUI_WELCOMEPAGE_* / MUI_FINISHPAGE_* define과
; NSIS_HOOK_PREINSTALL / NSIS_HOOK_POSTINSTALL 매크로를 여기서 정의할 수 있다.
;
; 팁 문구 원천: apps/desktop/src/shared/tips.ts (단일 원천).
; 아래 생성 구간은 scripts/generate-nsis-tips.mjs 가 tips.ts에서 추출해 채운다.
; 폐쇄망 오프라인 설치 전제 — 외부 URL을 절대 넣지 않는다.
; ==========================================================================

; --- BEGIN GENERATED TIPS (generate-nsis-tips.mjs) ---
; 자동 생성 구간 — 직접 수정 금지. 문구를 바꾸려면
; apps/desktop/src/shared/tips.ts 를 고치고 `node scripts/generate-nsis-tips.mjs` 실행.
!define GONGMU_TIP_COUNT 7
!define GONGMU_TIP_1 "날짜·시간을 넣어 말하면 업무대화가 일정을 바로 등록합니다."
!define GONGMU_TIP_2 "'보고서·공문·시행문·이메일' 같은 문서 종류와 '작성·정리'를 함께 말하면 업무대화가 문서작성을 실행합니다."
!define GONGMU_TIP_3 "한 문장에 여러 요청을 담으면 순서대로 처리합니다 — 일정 등록과 문서작성을 한 번에."
!define GONGMU_TIP_4 "지식폴더를 색인해 두면 업무대화 답변에 출처 칩(원본 열기·경로 복사)이 함께 붙습니다."
!define GONGMU_TIP_5 "문서작성의 임의형식 칩에 HWPX/HWTX 양식을 올리면 표·로고·서식을 보존한 채 빈칸을 채웁니다."
!define GONGMU_TIP_6 "분류체계 마법사가 지식폴더를 분석해 업무 분류 트리를 제안합니다. 검토·편집한 뒤 적용하세요."
!define GONGMU_TIP_7 "환경설정에서 LLM 프로필을 여러 개 저장해 두고 상황에 맞게 전환할 수 있습니다."
; --- END GENERATED TIPS ---

; --------------------------------------------------------------------------
; 1. 환영 페이지 — 앱 소개 + 핵심 기능
; --------------------------------------------------------------------------
!define MUI_WELCOMEPAGE_TITLE "'공무원' 설치를 시작합니다"
!define MUI_WELCOMEPAGE_TITLE_3LINES
; 환영 상자 폭이 좁아 문장이 어절 중간에서 꺾이지 않도록 항목을 한 줄 길이로 유지한다.
!define MUI_WELCOMEPAGE_TEXT "'공무원'은 인터넷 연결 없이 내 PC 안에서만 동작하는$\r$\n공무원 업무 보조 프로그램입니다.$\r$\n$\r$\n주요 기능$\r$\n$\r$\n  • 업무대화 — 말로 일정·검색·초안까지$\r$\n  • 문서작성 — HWPX 서식 보존 생성$\r$\n  • 내 지식폴더 — 색인·출처 있는 답변$\r$\n  • 일정 — 사전 알림·대화 연결$\r$\n  • 실행기록 — 실행 내역 투명 기록$\r$\n$\r$\n계속하려면 [다음]을 누르세요."

; --------------------------------------------------------------------------
; 2. 설치(InstFiles) 진행 중 이용팁 표출
;
; 한계: Tauri 템플릿의 Install 섹션에는 훅 지점이 PREINSTALL/POSTINSTALL
; 두 곳뿐이라 파일 복사 도중 타이머 회전은 불가능하다. 대신
;  - 훅 지점마다 페이지 헤더(부제)의 팁을 교체하고
;  - 상세 로그(DetailPrint)에 팁 전체를 출력하며
;  - 마침 페이지에서 팁 확인 경로를 다시 안내한다.
; --------------------------------------------------------------------------
!macro NSIS_HOOK_PREINSTALL
  !insertmacro MUI_HEADER_TEXT "설치를 진행하고 있습니다" "이용팁: ${GONGMU_TIP_1}"
  SetDetailsPrint both
  DetailPrint "────────────────────────────────"
  DetailPrint "잠깐! 설치되는 동안 이용팁을 확인해 보세요."
  DetailPrint "팁 1. ${GONGMU_TIP_1}"
  DetailPrint "팁 2. ${GONGMU_TIP_2}"
  DetailPrint "팁 3. ${GONGMU_TIP_3}"
  DetailPrint "────────────────────────────────"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro MUI_HEADER_TEXT "설치를 마무리하고 있습니다" "이용팁: ${GONGMU_TIP_4}"
  DetailPrint "────────────────────────────────"
  DetailPrint "팁 4. ${GONGMU_TIP_4}"
  DetailPrint "팁 5. ${GONGMU_TIP_5}"
  DetailPrint "팁 6. ${GONGMU_TIP_6}"
  DetailPrint "이용팁은 설치 후 앱 홈 화면의 '앱 이용팁' 카드에서 다시 볼 수 있습니다."
  DetailPrint "────────────────────────────────"
!macroend

; --------------------------------------------------------------------------
; 3. 마침 페이지 — 튜토리얼 안내 (실행 체크박스는 Tauri 템플릿이 기본 제공)
; --------------------------------------------------------------------------
!define MUI_FINISHPAGE_TITLE "설치가 완료되었습니다"
!define MUI_FINISHPAGE_TEXT "'공무원'을 처음 실행하면 화면 튜토리얼이 주요 기능을 차례로 안내합니다.$\r$\n$\r$\n이용팁 전체는 앱 홈 화면의 '앱 이용팁' 카드에서 언제든 다시 볼 수 있습니다."
