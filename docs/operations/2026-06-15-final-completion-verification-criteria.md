# 최종 완성 판정 기준

작성일: 2026-06-15  
대상: `로컬 AI에이전트 워크플레이스 : 공무원`

## 1. 목적

이 문서는 현재 프로젝트가 “거의 된 상태”인지가 아니라, 실제 출고 가능한 최종 완성 상태인지 판단하기 위한 기준이다.

완성 판정은 아래 세 가지를 모두 만족해야 한다.

1. 요구 기능이 현재 릴리스 후보 코드에 실제로 들어 있다.
2. 자동 테스트, 수동 조작, 산출물, 설치 검증의 직접 증거가 있다.
3. 미정리 변경, 부분 검증, 과거 커밋 기준 증거, 임시 우회가 남아 있지 않다.

따라서 하나라도 `partial`, `pending`, `fail`이면 최종 완성으로 선언하지 않는다.

## 2. 판정 원칙

| 원칙 | 의미 |
| --- | --- |
| 현재 상태 우선 | 기억이나 과거 기록보다 현재 파일, 현재 브랜치, 현재 명령 결과를 우선한다. |
| 직접 증거 우선 | “될 것 같다”가 아니라 실제 실행 로그, 생성 파일, 화면 증거, 검증 문서를 본다. |
| 범위 일치 | 작은 단위 테스트로 전체 사용자 흐름 완료를 주장하지 않는다. |
| 부분 통과는 미완료 | 핵심 흐름은 동작해도 일부 요구사항이나 증거가 부족하면 `partial`이다. |
| 증거 없는 pass 금지 | `pass` gate는 최소 하나 이상의 필수 증거 파일을 가져야 한다. |
| 사용자 경험 포함 | 기능이 동작해도 사용자가 이해하기 어렵거나 흐름이 끊기면 완성이 아니다. |
| 폐쇄망 Windows 기준 | 최종 배포 목표는 Windows 로컬 우선, 폐쇄망 설치패키지다. |

## 3. 최종 완성 Gate

기계 판정 기준은 [final-completion-criteria.json](/C:/Users/USER/Agent_Gongmu/Agent_Gongmu_Codex/docs/operations/final-completion-criteria.json)에 있다.

필수 gate는 다음 12개다.

1. `G01` 최종 릴리스 후보 기준 자동 회귀 검증
2. `G02` 업무대화 중심 통합 워크플로
3. `G03` 업무엔진 런타임 자동 시작, 복구, 장기 작업 관리
4. `G04` 업무일정 캘린더와 팝업 알림
5. `G05` 자체 파일찾기와 업무세션 파일 연결
6. `G06` 지식폴더 2.0 업무 이해 기반 GraphRAG
7. `G07` 공공문서 작성과 HWPX 산출 서식
8. `G08` LLM 공급자 설정, 로컬/폐쇄망 모델, 안전 가드레일
9. `G09` 사용자 경험과 화면 검증
10. `G10` 파일정리, 승인, 롤백 안전성
11. `G11` 폐쇄망 설치패키지와 clean install 증거
12. `G12` 브랜치, PR, 문서 출고 위생

## 4. 실행 명령

비차단 감사:

```powershell
npm.cmd run verify:completion:audit
```

의미:

- 현재 기준으로 미완료 gate를 보고서로 생성한다.
- 미완료가 있어도 exit code 0으로 끝난다.
- 작업 중 상태 점검용이다.

최종 완료 gate:

```powershell
npm.cmd run verify:completion
```

의미:

- 모든 required gate가 `pass`가 아니면 실패한다.
- 최종 완료 선언 직전에 반드시 통과해야 한다.

생성 보고서:

- [final-completion-verification-report.json](/C:/Users/USER/Agent_Gongmu/Agent_Gongmu_Codex/docs/operations/generated/final-completion-verification-report.json)
- [final-completion-verification-report.md](/C:/Users/USER/Agent_Gongmu/Agent_Gongmu_Codex/docs/operations/generated/final-completion-verification-report.md)
- [python-venv-report.md](/C:/Users/USER/Agent_Gongmu/Agent_Gongmu_Codex/docs/operations/generated/python-venv-report.md)

## 5. 현재 결론

2026-06-15 현재 기준으로 프로젝트는 핵심 기능이 상당 부분 구현된 릴리스 후보 단계다. 그러나 최종 완성은 아니다.

주요 미완료 사유:

- 현재 worktree에 미정리 변경이 있다.
- 지식폴더 2.0은 현재 브랜치에 있으며 최종 통합 전이다.
- 문서작성 4개 형식 전체에 대한 최신 HWPX 품질 검증이 남아 있다.
- 파일정리/롤백의 안전 시나리오가 최신 통합검증에서 미실행이다.
- clean-account 또는 VM 기준 설치, 실행, 제거 증거가 최종 릴리스 후보 기준으로 필요하다.
- Python 3.11 venv가 현재 PC에서 깨져 있어 sidecar fresh test와 `verify:all`을 완료할 수 없다.
- Python 상태는 `npm.cmd run sidecar:venv:report`로 매번 갱신하며, `python-venv-report.json`의 `ready=true`가 되기 전에는 최종완성으로 판정하지 않는다.
- 최종 completion verifier가 strict 모드로 통과해야 한다.
