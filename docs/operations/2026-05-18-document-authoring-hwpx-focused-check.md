# 문서작성 HWPX 집중점검 결과

작성일: 2026-05-18

## 점검 목적

업무대화, 연결 일정, 세션 연결 파일, Reference Set, 직접 연결 파일이 Content Base를 거쳐 최종 HWPX 문서까지 유지되는지 확인했다.

## 점검 범위

- 업무대화 세션 기반 Content Base 생성
- 연결 일정 반영
- 업무대화 메시지 반영
- 세션 연결 파일 반영
- Reference Set 반영
- 직접 연결 파일 반영
- 최종 저장 승인 및 HWPX 산출
- 사용자 HWPX 양식 업로드 후 본문 추가
- 시행문, 1페이지 보고서, 풀버전 보고서, 이메일 유형별 HWPX 산출

## 발견 사항

- Content Base에는 연계 데이터가 정상 포함되었다.
- 최종 HWPX 렌더링 단계에서 풀버전 보고서가 업무대화, 일정, 연결 파일, Reference Set 근거를 충분히 싣지 못했다.
- 요청 조치 값이 풀버전 보고서 최종 산출물에 누락되었다.

## 조치 사항

- 최종 HWPX payload에 `evidence` 항목을 추가했다.
- `업무대화 세션`, `업무대화 기록`, `세션 연결 파일`, `직접 연결 파일`, `참고자료`를 최종 근거 목록으로 보존하도록 수정했다.
- 시행문, 1페이지 보고서, 풀버전 보고서, 이메일 모두 `근거 및 연결자료` 섹션을 출력하도록 수정했다.
- 풀버전 보고서에는 `요청사항` 섹션을 별도로 추가해 요청 조치가 누락되지 않게 했다.

## 검증 결과

실행 명령:

```powershell
npm.cmd run sidecar:test -- services/sidecar/tests/test_document_workflow.py -q
npm.cmd --workspace apps/desktop run test -- src/document-workflow-handoff.test.tsx
```

결과:

- 전체 sidecar 테스트 통과
- 문서작성 집중 테스트 통과
- 생성된 HWPX 내부 XML 및 Preview 텍스트에서 업무대화, 일정, 연결 파일, Reference Set, 직접 연결 파일, 요청 조치가 확인됨
- 업무대화 화면에서 문서작성 폼으로 세션 맥락을 넘기는 desktop handoff 테스트 통과

## 남은 리스크

- 자동 테스트는 HWPX 압축 내부 텍스트를 기준으로 검증했다.
- 한컴오피스 또는 실제 HWPX 뷰어에서의 시각적 레이아웃 품질은 별도 수동 확인이 필요하다.
- 현재 문서 본문은 연계 데이터를 안전하게 보존하는 수준이며, 문장 품질 고도화는 LLM 기반 작성 단계와 함께 추가 개선해야 한다.
