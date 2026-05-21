# Gongmu Final Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gongmu를 Windows 로컬 우선형 개인 업무 운영 시스템으로 완성하고, `업무대화 -> 일정 -> 로컬검색/Anything 연계 -> Reference Set -> 문서작성 -> 내 지식폴더 -> 파일정리 -> 승인/실행기록`이 실제 설치 환경에서 끊기지 않고 end-to-end로 동작하도록 만든다.

**Architecture:** desktop는 Tauri + React UI 쉘로 유지하고, sidecar는 FastAPI + SQLite 중심의 로컬 오케스트레이션 엔진으로 유지한다. 외부 의존성인 Anything은 Gongmu 설치패키지에 번들하지 않고, 별도 외부 프로그램으로 설치 감지/실행 연계/결과 handoff를 담당하도록 설계한다. desktop/sidecar/install artifact/docs는 `외부 설치형 Anything 연계 계약`을 공유하도록 묶는다.

**Tech Stack:** Tauri 2, React, TypeScript, Vitest, FastAPI, Python 3.11, SQLite, PyInstaller, WiX/NSIS, Windows release tooling

---

## 0. 범위와 완료 기준

### 최종 제품 목표

- 사용자는 Gongmu 설치 후 별도 수작업 없이 앱을 열고 핵심 워크플로를 수행할 수 있어야 한다.
- `업무대화`는 일정의 하위 기능이 아니라 독립적인 주 진입점이어야 한다.
- `Anything`은 Gongmu 패키지에 직접 포함하지 않는다.
- `Anything`은 별도 외부 프로그램으로 두되, Gongmu가 설치 감지/실행 연계/설치 안내/결과 handoff를 책임진다.
- `Reference Set`은 검색 결과/로컬 파일/지식/문서작성을 연결하는 명확한 중간 개념으로 작동해야 한다.
- `문서작성`은 반드시 `Content Base(Markdown) -> Template -> 최종 산출물` 구조를 유지해야 한다.
- `내 지식폴더`는 Obsidian 호환 정본 + 구조화 레이어 + 보조 탐색 흐름으로 동작해야 한다.
- `파일정리`는 실제 파일시스템 반영이 되는 승인형 기능으로 유지하되, 사용 목적과 동작 결과가 사용자가 이해 가능한 수준으로 드러나야 한다.

### 최종 완료 기준

- [ ] 핵심 기능 배치별 manual validation이 모두 green
- [ ] `npm.cmd run verify:all` green
- [ ] `npm.cmd run desktop:smoke:nsis` green
- [ ] Windows 설치 후 `Anything 실행 연계 -> Reference Set -> Documents`가 실제로 동작
- [ ] blocker/critical UX ambiguity가 남지 않음
- [ ] 남는 이슈는 선택형 고도화 항목뿐임

## 1. 구현 원칙

- [ ] 기능 우선, 패키징/운영은 기능이 닫힌 뒤 증거를 올린다.
- [ ] blocker는 즉시 고치되, UX/IA 개편은 작은 배치로 묶는다.
- [ ] 새 기능 추가나 버그 수정은 가능한 한 TDD로 진행한다.
- [ ] manual validation 결과는 항상 운영 문서로 남긴다.
- [ ] branch/commit은 배치 단위로 끊고, 각 배치 끝에서 verification gate를 통과시킨다.
- [ ] 사용자의 추가 확인은 이 문서 승인 이후 원칙적으로 요구하지 않고, 범위 외 결정이나 숨은 파괴적 트레이드오프가 있을 때만 예외적으로 멈춘다.

## 2. 작업 트랙 개요

이 계획은 여섯 개의 트랙으로 진행한다.

1. `Track A` 핵심 blocker 마감
2. `Track B` 업무 흐름 IA 재정렬
3. `Track C` Anything 외부 설치형 연계 완성
4. `Track D` 문서/지식/파일정리 품질 완성
5. `Track E` Windows 설치/운영 출고 완성
6. `Track F` 최종 통합 검증과 release candidate 정리

각 트랙은 독립 배치로 끝낼 수 있어야 하지만, 전체적으로는 위 순서를 기본으로 한다.

## 3. 파일 구조 기준

### 주요 수정 축

- desktop UI / state / tests
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.test.tsx`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\api.ts`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\runtime.ts`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\anything-launch.test.tsx`
- desktop native/runtime bridge
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src-tauri\src\main.rs`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src-tauri\tauri.conf.json`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src-tauri\windows\main.wxs`
- sidecar domain / API / tests
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\app.py`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\documents.py`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\knowledge.py`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\file_organizer.py`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\db.py`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\tests\test_api_flows.py`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\tests\test_file_organizer_apply.py`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\tests\test_knowledge_search.py`
- packaging / scripts / docs
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\scripts\prepare-alpha-release.mjs`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\scripts\windows-gui-validation-helper.mjs`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\scripts\windows-nsis-smoke.mjs`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\package.json`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\*.md`
  - `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\superpowers\plans\*.md`

### 새로 생길 가능성이 큰 파일

- `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\2026-04-23-anything-external-integration-validation.md`
- `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\2026-04-23-final-functional-validation-results.md`
- `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\tests\test_anything_integration.py`
- `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\workflow-ia.test.tsx`

## 4. Track A - 핵심 blocker 마감

### Task A1: 문서작성 blocker를 완전히 닫기

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.test.tsx`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\app.py`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\documents.py`
- Test: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\tests\test_api_flows.py`

- [ ] `Content Base 생성 -> preview -> stale protection -> 최종 저장 요청/승인/적용`의 manual checklist를 다시 실행한다.
- [ ] 실패가 남아 있으면 sidecar 로그와 desktop runtime 로그를 같이 수집한다.
- [ ] 실패를 재현하는 회귀 테스트를 추가한다.
- [ ] 최소 수정으로 green으로 만든다.
- [ ] 체크리스트 A4/A5/A6를 다시 수동 확인한다.

**Exit Criteria**
- [ ] Content Base 생성 성공
- [ ] stale protection 확인 가능
- [ ] 최종 저장 승인/적용 성공

### Task A2: 지식 승인/검색 blocker를 완전히 닫기

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\app.py`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\knowledge.py`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Test: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\tests\test_api_flows.py`
- Test: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\tests\test_knowledge_search.py`

- [ ] `후보 생성 -> 승인 -> 페이지 반영 -> 검색`을 실제 앱 기준으로 다시 재현한다.
- [ ] 실패를 재현하는 회귀 테스트를 추가한다.
- [ ] 승인 중복/상태 전이 문제를 같이 닫는다.
- [ ] 결과 페이지 경로와 graph/search 표시까지 다시 수동 확인한다.

**Exit Criteria**
- [ ] 지식 승인 green
- [ ] 생성 페이지 확인 가능
- [ ] 검색 결과/graph summary 확인 가능

### Task A3: 파일정리 blocker와 재적용 흐름을 닫기

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\file_organizer.py`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\app.py`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.test.tsx`
- Test: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\tests\test_file_organizer_apply.py`

- [ ] `제안 생성 -> 적용 요청 -> 승인 -> 적용 -> 되돌리기 -> 다시 적용 요청`을 기준 시나리오로 고정한다.
- [ ] directory/file proposal 모두에서 apply/rollback/re-request가 회귀 없이 동작하도록 맞춘다.
- [ ] 사용자가 지금 무엇을 정리하려는지 이해할 수 있게 helper copy를 최소 보강한다.

**Exit Criteria**
- [ ] D2 green
- [ ] D3 green
- [ ] rollback 후 재요청 green

## 5. Track B - 업무 흐름 IA 재정렬

### Task B1: 주 진입 흐름을 업무대화 중심으로 재정렬

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Test: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\workflow-ia.test.tsx`
- Docs: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\2026-04-23-final-functional-validation-results.md`

- [ ] 메인 IA를 `업무대화 -> 일정 -> 검색/참고자료 -> 문서작성 -> 지식 -> 파일정리` 순서로 재배치한다.
- [ ] 일정은 업무대화의 유일한 진입점이 아니라, 독립 캘린더 도구로 재정의한다.
- [ ] 우측 `선택 상태`와 승인/실행 영역도 새 mental model에 맞춰 조정한다.

**Exit Criteria**
- [ ] 업무대화가 top-level primary workflow로 배치됨
- [ ] 일정과 세션 연결이 종속 관계가 아니라 양방향 선택 관계가 됨

### Task B2: 일정 UI를 캘린더형 구조로 확장

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.test.tsx`

- [ ] 일/주/월 캘린더 보기 구조를 설계하고, 최소한 day/week/month 전환과 cell click 진입점을 만든다.
- [ ] 기존 일정 카드/폼은 캘린더 기반 quick-create 하위로 이동시킨다.
- [ ] 기존 일정 목록 표시도 유지하되, 캘린더가 주 시각 표현이 되게 한다.

**Exit Criteria**
- [ ] 일정 화면이 calendar-first가 됨
- [ ] 클릭 기반 일정 생성 가능
- [ ] 기존 일정의 시각적 확인 가능

### Task B3: 업무대화 세션을 저장형 구조로 완성

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\db.py`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\app.py`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Test: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\tests\test_api_flows.py`

- [ ] 업무대화 세션 목록/저장/재열기 구조를 명시적으로 만든다.
- [ ] 일정과 연결되지 않은 일반 세션도 자연스럽게 생성되도록 한다.
- [ ] 세션에서 일정 생성, 일정에서 세션 열기 둘 다 가능하도록 연결 지점을 만든다.

**Exit Criteria**
- [ ] LLM-style 세션 persistence 확인
- [ ] 일정 연결은 optional relation으로 동작

## 6. Track C - Anything 외부 설치형 연계 완성

### Task C1: Anything 외부 설치 계약 확정

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src-tauri\tauri.conf.json`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src-tauri\windows\main.wxs`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\package.json`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\scripts\prepare-alpha-release.mjs`
- Docs: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\2026-04-23-anything-external-integration-validation.md`

- [ ] Anything을 Gongmu 패키지에 번들하지 않는다는 계약을 문서와 코드에 반영한다.
- [ ] desktop/runtime가 외부 설치된 Anything 실행파일을 감지할 수 있게 만든다.
- [ ] 감지 실패 시 설치 페이지 안내로 자연스럽게 fallback 하게 만든다.
- [ ] desktop/sidecar가 Anything 존재 여부와 실행 연계 방식을 같은 계약으로 본다.

**Exit Criteria**
- [ ] 번들 전제가 제거됨
- [ ] 외부 설치 감지 또는 설치 안내 fallback이 동작함

### Task C2: Anything UX를 end-to-end로 완성

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\anything-launch.test.tsx`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\src\gongmu_sidecar\app.py`
- Test: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\services\sidecar\tests\test_anything_integration.py`

- [ ] Anything 미설치/설치완료/실행실패 상태를 UI에서 명확히 구분한다.
- [ ] 승인 버튼을 눌렀을 때 사용자가 즉시 이해 가능한 피드백을 보여준다.
- [ ] 검색 결과 import와 `Continue to Documents`의 discoverability를 높인다.
- [ ] 가능하면 drag/drop 또는 더 직접적인 import UX를 붙인다.

**Exit Criteria**
- [ ] B1/B2/B3/B4 전부 manual validation 가능
- [ ] 외부 설치형 계약 안에서 Anything flow가 막히지 않음

## 7. Track D - 문서/지식/파일정리 품질 완성

### Task D1: Reference Set 의미를 제품 언어로 고정

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\anything-launch.test.tsx`

- [ ] Reference Set helper copy를 `문서작성을 위한 참고자료 묶음` 관점으로 통일한다.
- [ ] 수동 생성, Anything import, 문서 handoff 사이의 의미를 같은 언어로 맞춘다.

### Task D2: 카드 상세보기 공통 패턴 추가

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.test.tsx`

- [ ] 지식 후보 카드, 파일정리 제안 카드, 실행기록 카드에 공통 detail/expand 패턴을 추가한다.
- [ ] 사용자가 클릭해서 본문/이유/상세 작업을 볼 수 있게 만든다.

### Task D3: 파일정리 기능 설명과 입력 UX 정리

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\apps\desktop\src\app.tsx`

- [ ] 파일정리 기능의 목적을 `승인형 보관/분류/정리`로 명확히 설명한다.
- [ ] 대상 경로 입력은 브라우저 선택 UX를 검토하고, 당장 네이티브 picker가 어려우면 대체 UX를 넣는다.

## 8. Track E - Windows 설치/운영 출고 완성

### Task E1: 실제 GUI 설치 기준 final validation

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\2026-04-22-windows-interactive-install-validation.md`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\2026-04-20-windows-install-validation.md`

- [ ] 기능 흐름이 모두 green이 된 후 NSIS 기준 GUI 설치를 다시 수행한다.
- [ ] 설치 후 앱 창 표시, managed sidecar 연결, Anything flow, uninstall 결과를 다시 기록한다.
- [ ] known follow-up과 release blocker를 다시 분리한다.

### Task E2: alpha staging과 release docs를 최신화

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\scripts\prepare-alpha-release.mjs`
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\release\alpha\README.md`

- [ ] 최신 기능 검증 문서와 final validation 결과가 release/alpha에 항상 포함되게 한다.
- [ ] `Anything external integration` 계약을 release docs에 명시한다.

## 9. Track F - 최종 통합 검증과 RC 정리

### Task F1: 기능 검증 체크리스트 재실행

**Files:**
- Modify: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\2026-04-23-functional-validation-checklist.md`
- Create: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\docs\operations\2026-04-23-final-functional-validation-results.md`

- [ ] 기존 체크리스트를 final 기준으로 다시 실행한다.
- [ ] `pass / partial / fail / later`를 최종 상태로 정리한다.
- [ ] partial/fail이 남으면 blocker인지 고도화인지 분류한다.

### Task F2: 최종 verification gate

- [ ] `npm.cmd run sidecar:test`
- [ ] `npm.cmd run desktop:test`
- [ ] `npm.cmd run verify:all`
- [ ] `npm.cmd run desktop:smoke:nsis`
- [ ] 필요 시 `npm.cmd run desktop:bundle`

**Exit Criteria**
- [ ] 모든 필수 명령 green
- [ ] manual functional validation green
- [ ] 남는 이슈는 later 목록만 존재

## 10. 실행 순서

아래 순서를 기본으로 고정한다.

1. Track A
2. Track B
3. Track C
4. Track D
5. Track E
6. Track F

단, Track A 도중에 Track C의 선행 조사 없이는 blocker 원인이 풀리지 않는 경우에만 `C1`을 앞당길 수 있다.

## 11. 배치별 verification gate

### Gate 1 - blocker gate

- [ ] `npm.cmd run sidecar:test`
- [ ] `npm.cmd run desktop:test`
- [ ] blocker checklist 재실행 green

### Gate 2 - workflow gate

- [ ] 업무대화/일정/Reference Set/문서작성 manual validation green
- [ ] 지식/파일정리 detail UX green

### Gate 3 - Anything gate

- [ ] 설치 후 Anything 사용 가능
- [ ] 승인/실행/import/handoff green

### Gate 4 - ship gate

- [ ] `npm.cmd run verify:all`
- [ ] `npm.cmd run desktop:smoke:nsis`
- [ ] final validation docs updated

## 12. 리스크와 대응

- `Anything licensing/distribution` 제약 때문에 Gongmu가 바이너리를 재배포하지 않는다. 대신 설치 감지, 설치 안내, 실행 연계, 결과 handoff를 Gongmu 책임으로 둔다.
- 업무대화 IA 재정렬이 범위를 키울 수 있으므로, 먼저 저장/재열기 계약부터 고정하고 시각 배치는 단계적으로 바꾼다.
- 일정 캘린더형 UI는 대규모 프런트 변경이 될 수 있으므로, month/week/day 최소 보기부터 시작한다.
- 파일정리 UX는 “자동 정리기”로 과장하지 않고, 승인형 정리 도구로 정체성을 유지한다.

## 13. 최종 산출물

- [ ] 기능적으로 완성된 Windows desktop app
- [ ] externally integrated Anything workflow
- [ ] final functional validation results
- [ ] updated release/alpha staging
- [ ] merge-ready branch or merged main state
