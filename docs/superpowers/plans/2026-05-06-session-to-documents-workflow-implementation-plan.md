# 업무대화 세션 기반 문서작성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업무대화 세션, 연결 일정, 연결 파일, 직접 작성 개요, 사용자 HWPX/HWTX 양식을 문서작성 Content Base와 최종 HWPX 산출 흐름에 연결한다.

**Architecture:** sidecar는 `content_bases` 메타데이터를 확장하고 세션 컨텍스트를 Markdown으로 렌더링한다. desktop은 업무대화에서 문서작성으로 이동하는 handoff 액션과, 문서작성 화면의 출발점/출력유형/양식 업로드 UI를 제공한다.

**Tech Stack:** FastAPI, SQLite, python-hwpx, React, TypeScript, Vitest, pytest.

---

## 파일 구조

- Modify: `services/sidecar/src/gongmu_sidecar/db.py`
  - `content_bases` 확장 컬럼을 추가한다.
- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
  - Content Base 생성 payload를 확장한다.
  - 사용자 양식 업로드/목록 API를 추가한다.
- Modify: `services/sidecar/src/gongmu_sidecar/documents.py`
  - 세션 컨텍스트, 직접 작성 개요, 관련 파일 경로, 출력 슬롯을 Content Base Markdown에 반영한다.
- Modify: `services/sidecar/src/gongmu_sidecar/hwpx_writer.py`
  - 명시 출력 유형과 사용자 HWPX/HWTX 양식 파일을 지원한다.
- Test: `services/sidecar/tests/test_document_workflow.py`
  - sidecar 문서작성 고도화 흐름을 검증한다.
- Modify: `apps/desktop/src/api.ts`
  - 확장된 Content Base 타입과 사용자 양식 업로드 API를 추가한다.
- Modify: `apps/desktop/src/app.tsx`
  - 업무대화의 `문서작성으로 이어가기` 액션과 문서작성 UI를 추가한다.
- Test: `apps/desktop/src/document-workflow-handoff.test.tsx`
  - 업무대화에서 문서작성으로 이어지는 UI 흐름을 검증한다.

## Task 1: sidecar 세션 기반 Content Base 테스트

- [ ] 세션, 일정, 메시지, 파일 링크를 만든 뒤 `/api/documents/content-bases`에 `source_session_id`와 작성 슬롯을 보내는 실패 테스트를 작성한다.
- [ ] 테스트가 현재 코드에서 422 또는 누락 필드 실패를 내는지 확인한다.
- [ ] DB 컬럼과 DocumentManager 입력을 확장한다.
- [ ] Content Base Markdown에 세션/일정/파일/슬롯 정보가 포함되게 구현한다.
- [ ] 테스트가 통과하는지 확인한다.

## Task 2: sidecar 직접 작성 및 사용자 양식 테스트

- [ ] `.hwpx` 업로드 성공, `.txt` 업로드 거부 테스트를 작성한다.
- [ ] 직접 작성 payload의 `outline`과 `direct_file_paths`가 Content Base에 들어가는 테스트를 작성한다.
- [ ] `/api/documents/templates/custom` 업로드/목록 API를 구현한다.
- [ ] 직접 작성 렌더링을 구현한다.
- [ ] 테스트가 통과하는지 확인한다.

## Task 3: HWPX writer 출력 유형/사용자 양식 반영

- [ ] 명시 출력 유형이 `auto`가 아닐 때 자동 선택보다 우선되는 테스트를 작성한다.
- [ ] 사용자 양식 파일이 지정되면 `HwpxDocument.open()`으로 열고 내용을 이어 붙이는 테스트를 작성한다.
- [ ] `write_public_hwpx_document()`에 `document_format`, 작성 슬롯, `user_template_path`를 추가한다.
- [ ] 최종 저장 적용 결과의 `artifact.format`이 명시 유형을 반환하게 한다.
- [ ] 테스트가 통과하는지 확인한다.

## Task 4: desktop 업무대화 -> 문서작성 handoff 테스트

- [ ] 업무대화에서 `문서작성으로 이어가기`를 누르면 문서작성 화면으로 이동하고 현재 세션이 선택되는 테스트를 작성한다.
- [ ] 문서 제목/목적/작성 개요가 세션 기반으로 자동 채워지는지 검증한다.
- [ ] 출력 유형 드롭다운에 시행문, 1페이지 보고서, 풀버전 보고서, 이메일이 보이는지 검증한다.

## Task 5: desktop 문서작성 UI/API 구현

- [ ] `api.ts`에 확장 payload와 사용자 양식 업로드 타입을 추가한다.
- [ ] `app.tsx`에 작성 출발점, 세션 선택, 바로 작성 개요, 관련 파일 경로, 출력 유형, 작성 슬롯 UI를 추가한다.
- [ ] 업무대화 툴바에 `문서작성으로 이어가기` 버튼을 추가한다.
- [ ] Content Base 생성 요청에 확장 payload를 포함한다.
- [ ] 테스트가 통과하는지 확인한다.

## Task 6: 검증

- [ ] `npm.cmd run sidecar:test -- services/sidecar/tests/test_document_workflow.py`
- [ ] `npm.cmd run desktop:test -- src/document-workflow-handoff.test.tsx`
- [ ] `npm.cmd run sidecar:test`
- [ ] `npm.cmd run desktop:test`
- [ ] `node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- [ ] 필요한 경우 dev 앱을 재실행해 수동 확인 준비 상태로 둔다.
