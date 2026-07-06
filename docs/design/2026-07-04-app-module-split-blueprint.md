# app.tsx 모듈 분리 청사진 (W1.5 — W2 병렬화의 전제)

- 목적: 단일 9천 줄 `App()` 클로저를 화면별 모듈로 분리해 W2~W4 화면 작업의 병렬화·충돌 방지.
- 원칙: **기계적 분리** — 동작·DOM·라벨·testid 불변(테스트 그린 유지가 성공 판정). 리디자인 금지(그건 W2 몫).

## 1. 목표 구조

```
apps/desktop/src/
  app.tsx                 // App 셸: 상태 소유 + 레이아웃 조립 (목표 ≤1,500줄)
  store.tsx               // AppStore: 스냅샷·선택·토스트·핸들러를 담는 context + useAppStore()
  shared/
    format.ts             // formatDateTime, relativePath, fileNameFromPath, formatDurationMs, formatLatencyBadge ...
    labels.ts             // describe* 계열 (describeStatus, APPROVAL_ACTION_LABELS ...)
    markdown.tsx          // renderMarkdownContent + 인라인 렌더러 (W1에서 재작성된 버전)
    primitives.tsx        // EmptyState, AssetIcon, SectionCard, DetailPanel, seg-control 헬퍼
  screens/
    ChatScreen.tsx
    ScheduleScreen.tsx
    DocumentsScreen.tsx
    KnowledgeScreen.tsx
    LogsScreen.tsx
    SettingsScreen.tsx
  layout/
    TopBar.tsx
    SessionRail.tsx
    ContextPane.tsx
```

## 2. 상태 전략 — Context 스토어 (props drilling 회피)

`store.tsx`에 `AppStoreProvider`(App이 감쌈) + `useAppStore()`.
스토어에 담는 것(현 App useState들을 **그대로 이동하지 말고**, App에 두되 스토어 객체로 묶어 context로 전달 — 최소 침습):
- snapshot + refreshShellSnapshot/refreshDeferredSnapshot/refreshSnapshot
- activeMenu/setActiveMenu, selectedScheduleId/SessionId(+setters)
- notice/error/pushToast/handleAction
- revealContextSection, contextPane 상태 일체
- runtimeStatus + 엔진 제어 핸들러
- sessionMessages/selectedSessionFileLinks/컴포저 상태는 **ChatScreen 내부로 이동하지 말 것**(교차 화면 참조: 문서작성 transcript·컨텍스트 패널) — 스토어에 유지
- 화면 전용 상태(지식 탭, authoring 탭/구조, 설정 폼 등)는 해당 screen 모듈 내부 useState로 **이동**

## 3. 이동 매핑 (2026-07-03 분석 기준 — 라인은 재탐색 필요)

| 모듈 | 가져갈 것 |
| --- | --- |
| ChatScreen | renderChatSection + 채팅 핸들러(submit/stream/attachment/paste/retry) + 스크롤 effect |
| ScheduleScreen | renderScheduleSection + submit/delete + openChatForSchedule |
| DocumentsScreen | renderDocumentSection + authoring 상태·핸들러 + 템플릿 로드 effect |
| KnowledgeScreen | renderKnowledgeSection + 지식 탭 상태 + 색인/검색/위키 핸들러 + 색인 폴링 effect |
| LogsScreen | renderLogsSection |
| SettingsScreen | renderSettingsSection + settingsForm/profiles 상태·핸들러 |
| TopBar | 탑바 렌더 + 줌 + 새로고침 + 런타임 팝오버 |
| SessionRail | 세션 레일 렌더 + 세션 생성/검색 |
| ContextPane | 우측 패널 전체 + 승인 결정 + 잡 로그 |

## 4. 실행 규칙

1. 한 번에 한 모듈씩 추출 → `npm run desktop:test` → 다음. (중간 커밋 없이도 테스트가 게이트)
2. import 순환 금지: screens → store/shared 단방향. screen 간 직접 import 금지(교차 이동은 스토어의 setActiveMenu+프리필 상태로).
3. testid·aria-label·클래스명 절대 불변.
4. 완료 판정: desktop:test 전체 그린 + build 그린 + app.tsx ≤1,500줄.
