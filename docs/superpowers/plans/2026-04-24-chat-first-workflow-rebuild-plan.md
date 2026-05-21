# Chat-First Workflow Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gongmu의 주요 사용 흐름을 `채팅 중심 IA + 직접 편집형 캘린더 + 접이식 우측 보조 패널 + Anything 외부 실행 handoff` 구조로 재구성한다.

**Architecture:** desktop의 단일 `App` 상태를 유지하되, 레이아웃과 상호작용 모델을 `채팅 세션 중심`으로 다시 배치한다. 일정은 별도 정형 입력 폼 중심이 아니라 월/주/일 캘린더 셀에서 선택/생성/편집하는 흐름으로 바꾸고, Anything은 외부 프로그램 API 부재를 전제로 기본 handoff와 실험적 자동입력 옵션을 분리한다.

**Tech Stack:** React, TypeScript, Vitest, Tauri 2, desktop runtime bridge

---

## 0. Scope

- [x] 좌측 네비게이션을 상단 탭 바로 아래 `세션 목록` 영역으로 재배치한다.
- [x] 중앙 주 작업영역의 기본 진입을 `자유형 업무대화`로 고정한다.
- [x] 우측 `현재 컨텍스트 / 승인 요청 / 최근 실행` 패널을 접기/펼치기 가능한 구조로 바꾼다.
- [x] 일정 화면을 월/주/일 표 기반 플래너로 재구성하고, 각 칸에서 생성/수정 플로우를 연다.
- [x] Anything은 기본적으로 `실행 + 검색어 클립보드 handoff`를 제공하고, 자동입력은 실험적 옵션으로 분리한다.
- [x] 기존 수동 검증에서 문제된 `일정 저장/연결 가시성`과 `Anything 검색어 반영 기대치`를 테스트와 UI 카피로 정리한다.

## 1. File Structure

### Primary implementation files

- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
  - 전체 IA, 상태 전이, 상호작용 흐름
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\styles.css`
  - 채팅 중심 레이아웃, 캘린더 표, 접이식 우측 패널
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\runtime.ts`
  - Anything 자동입력 옵션 브리지 추가 시 노출 함수 정리
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src-tauri\src\main.rs`
  - 실험적 Windows 자동입력 bridge 추가 시 native command 구현

### Test files

- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.test.tsx`
  - 채팅 중심 셸과 캘린더 편집 흐름 회귀
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\workflow-ia.test.tsx`
  - 일정↔세션 handoff 회귀
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\anything-launch.test.tsx`
  - 기본 handoff와 실험적 자동입력 옵션 표기 회귀

### Docs

- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\2026-04-23-functional-validation-results.md`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\superpowers\plans\2026-04-23-gongmu-final-implementation-plan.md`

## 2. Task Breakdown

### Task 1: Chat-first shell layout

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\styles.css`
- Test: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.test.tsx`

- [x] 기존 사이드바 역할을 `상단 기능 탭 + 좌측 세션 목록 + 중앙 대화 영역`으로 재배치하는 실패 테스트를 먼저 작성한다.
- [x] `업무대화`가 기본 진입이고, 좌측에서 세션을 선택/생성하며 중앙이 대화 스레드처럼 보이는 최소 구현을 만든다.
- [x] 현재 `새 업무 세션 열기` 폼을 자유형 대화 입력 아래 보조 생성 동작으로 축소하거나, 세션 생성 CTA로 재배치한다.
- [x] 테스트를 다시 돌려 기본 레이아웃과 세션 선택 흐름이 green인지 확인한다.

### Task 2: Collapsible right-side context panels

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\styles.css`
- Test: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.test.tsx`

- [x] `현재 컨텍스트 / 승인 요청 / 최근 실행` 각 섹션이 개별 접기/펼치기 상태를 가지는 실패 테스트를 쓴다.
- [x] 각 섹션 헤더에 토글 버튼을 두고, 접힘 상태에서는 제목과 개수만 남도록 구현한다.
- [x] 필요한 정보만 보이도록 기본 open/closed 정책을 정하고 테스트를 green으로 만든다.

### Task 3: Direct-edit calendar planner

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\styles.css`
- Test: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.test.tsx`
- Test: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\workflow-ia.test.tsx`

- [x] 월/주/일 뷰에서 일정이 칸 안에 보이고, 칸 클릭 시 편집 패널이 열리는 실패 테스트를 추가한다.
- [x] 월 뷰는 7열 달력, 주 뷰는 일~토 7열 표, 일 뷰는 시간 슬롯 표로 렌더링하도록 구현한다.
- [x] 별도 정형 입력 폼을 `선택된 칸 편집 패널`로 바꾸고, 생성/수정/선택 상태가 캘린더에 즉시 반영되게 한다.
- [x] 일정 카드와 연결 세션 정보는 캘린더 보조 리스트로 유지하되, 주 표현은 캘린더가 우선이 되게 한다.

### Task 4: Anything handoff and experimental auto-fill option

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\runtime.ts`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src-tauri\src\main.rs`
- Test: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\anything-launch.test.tsx`

- [x] 현재 기본 handoff(`실행 + 클립보드 복사`)를 명시적으로 설명하는 테스트를 유지/보강한다.
- [x] `실험적 자동입력` 토글/상태 문구를 추가하는 실패 테스트를 작성한다.
- [x] Windows native bridge가 가능하면 `Docufinder 실행 후 Ctrl+V 시도`를 넣되, 실패 시 즉시 안전한 클립보드 handoff로 fallback 하게 구현한다.
- [x] 자동입력이 불가능하거나 불안정한 환경에서는 명확히 `한계`를 표시하도록 UI 카피를 정리한다.

### Task 5: Verification and docs sync

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\2026-04-23-functional-validation-results.md`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\superpowers\plans\2026-04-23-gongmu-final-implementation-plan.md`

- [x] `npm.cmd run desktop:test`
- [x] `npm.cmd run desktop:build`
- [x] `npm.cmd run verify:all`
- [ ] 문서에 `Anything 자동입력은 실험적 옵션`이라는 운영 계약을 반영한다.
- [ ] 마지막에 사용자 수동 확인이 필요한 항목만 짧게 정리한다.

## 3. Acceptance Criteria

- [x] 업무대화 화면이 자유형 채팅 중심으로 보이고, 세션 관리가 좌측 리스트에서 이뤄진다.
- [x] 우측 패널은 접기/펼치기가 가능하고 필요한 정보만 선택적으로 본다.
- [x] 일정은 월/주/일 표 구조에서 직접 클릭해 등록/수정하는 흐름으로 작동한다.
- [x] 연결 세션 가시성이 일정과 세션 양쪽에서 명확하다.
- [x] Anything은 기본 handoff가 명확하고, 자동입력은 실험적 옵션으로 분리되어 기대치가 관리된다.
- [x] desktop test/build/verify:all 모두 green이다.
