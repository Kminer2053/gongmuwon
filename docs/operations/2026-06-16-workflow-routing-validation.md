# 업무대화 중심 라우팅/연계 검증

검증일: 2026-06-16 00:50 KST

## 목적

업무대화에서 자연어 요청이 일정, 파일연결, 지식검색, 문서작성 도구로 안전하게 라우팅되고, 데스크톱 UI에서 세션 중심 작업 흐름이 유지되는지 확인했다.

## 실행 명령

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_work_session_turn.py services/sidecar/tests/test_work_session_routing_preview.py -q
npm.cmd --workspace apps/desktop run test -- chat-turn-submit.test.tsx chat-session-thread.test.tsx chat-attachments-latency.test.tsx session-file-links.test.tsx document-workflow-handoff.test.tsx
```

## 결과

- sidecar 업무대화/라우팅 테스트: 41 passed
- desktop 업무대화/세션/첨부/파일연결/문서작성 handoff 테스트: 5 files, 8 tests passed

## 확인 범위

- 업무대화 입력이 세션 thread에 추가됨
- Enter 입력으로 메시지 전송 가능
- 첨부파일 업로드, 이미지 미리보기, 큰 이미지 보기, 첨부 제거 가능
- 응답 latency 표시와 Markdown 출력 렌더링 동작
- 세부 설정이 채팅창 아래를 밀지 않고 overlay로 표시
- 일정 연결 컨트롤이 채팅 입력창과 분리되어 유지됨
- 파일연결은 별도 입력창 대신 파일찾기 흐름으로 이동
- 업무대화 세션에서 문서작성 화면으로 handoff 가능
- 문서작성 handoff 시 연결 파일별 주요내용/활용목적이 문서작성 payload에 반영됨
- sidecar 라우팅 preview와 work session turn 경로가 도구 호출/일반 응답을 구분

## 판정

업무대화 중심 통합 워크플로는 자동 테스트 기준으로 pass다. 실제 사용자 화면 캡처와 장시간 조작감 평가는 UX 게이트(G09)에서 계속 관리한다.
