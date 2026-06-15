# 문서작성 4종 산출 Smoke 검증

검증일: 2026-06-16 00:46 KST

## 목적

문서작성 기능이 `시행문`, `1페이지 보고서`, `풀버전 보고서`, `이메일` 4개 산출 유형에서 Content Base, 검토용 Markdown, HWPX 산출물을 일관되게 생성하는지 확인했다.

## 실행 명령

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_document_workflow.py -q
npm.cmd --workspace apps/desktop run test -- document-authoring-layout.test.tsx document-workflow-handoff.test.tsx
.\.venv\Scripts\python.exe scripts\document-format-smoke.py
```

## 회귀 테스트 결과

- `test_document_workflow.py`: 75 passed
- `document-authoring-layout.test.tsx`, `document-workflow-handoff.test.tsx`: 2 files / 4 tests passed

## 4종 산출 Smoke 결과

공통 입력 파일:

`C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\document-format-smoke-20260615\source\ai-content-guidelines.md`

검증 기준:

- HWPX 파일 존재
- HWPX ZIP entry 존재
- HWPX 내부 XML 파싱 성공
- artifact format이 요청 format과 일치
- Content Base, Markdown, HWPX 본문에 핵심 맥락이 보존됨

핵심 맥락 probe:

- `Lighting First`
- `Camera Reality`
- `Skin Texture`
- `Life Motion`
- `후속`

| 형식 | Content Base | Markdown | HWPX | XML | 핵심 맥락 |
| --- | --- | --- | --- | --- | --- |
| 시행문 | 생성됨 | 생성됨 | 생성됨 | 정상 | 보존 |
| 1페이지 보고서 | 생성됨 | 생성됨 | 생성됨 | 정상 | 보존 |
| 풀버전 보고서 | 생성됨 | 생성됨 | 생성됨 | 정상 | 보존 |
| 이메일 | 생성됨 | 생성됨 | 생성됨 | 정상 | 보존 |

## 산출 경로

- 시행문 HWPX: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\document-format-smoke-20260615\workspace\documents\outputs\format-smoke-officialMemo.hwpx`
- 1페이지 보고서 HWPX: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\document-format-smoke-20260615\workspace\documents\outputs\format-smoke-onePageReport.hwpx`
- 풀버전 보고서 HWPX: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\document-format-smoke-20260615\workspace\documents\outputs\format-smoke-fullReport.hwpx`
- 이메일 HWPX: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\document-format-smoke-20260615\workspace\documents\outputs\format-smoke-email.hwpx`

## 판정

4개 산출 유형 모두 자동 검증 기준에서 손상 없이 생성되고, 검토용 Markdown과 HWPX 본문에 핵심 맥락이 유지됐다. 따라서 문서작성 산출 파이프라인은 구조적 무결성과 기본 내용 보존 기준을 통과한 것으로 판정한다.

## 남은 주의점

- 한컴오피스 GUI에서의 최종 시각 레이아웃 확인은 사용 PC의 HWPX 뷰어/한컴 설치 상태에 의존한다.
- 보고서 품질은 입력 파일 품질과 모델 응답 품질의 영향을 받으므로, 실제 업무문서 품질 평가는 대표 fixture와 사용자 업무자료 샘플로 계속 축적한다.
