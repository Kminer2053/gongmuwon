# 경량모델 컴퓨터유즈 점수화 운영 메모

## 목적

Gemma 4 E2B 같은 경량모델을 사용할 때도 사용자가 체감하는 품질이 떨어지지 않는지 컴퓨터유즈 기반으로 반복 측정한다.

이 문서는 시나리오 생성 이후 실제 점검자가 점수를 기록하고, 전체 완성도를 집계하는 절차를 고정한다.

## 산출물

- 시나리오 원본: `docs/operations/generated/lightweight-model-test-scenarios.json`
- 사람이 읽는 체크리스트: `docs/operations/generated/lightweight-model-test-scenarios.md`
- 컴퓨터유즈 1턴 실행팩 JSON: `docs/operations/generated/lightweight-model-computer-use-run-pack.json`
- 컴퓨터유즈 1턴 실행팩 Markdown: `docs/operations/generated/lightweight-model-computer-use-run-pack.md`
- 결과 입력 템플릿: `docs/operations/generated/lightweight-model-test-results-template.json`
- 점수 리포트 JSON: `docs/operations/generated/lightweight-model-test-score-report.json`
- 점수 리포트 Markdown: `docs/operations/generated/lightweight-model-test-score-report.md`
- 실제 경량모델 스모크 결과 JSON: `docs/operations/generated/lightweight-model-smoke-results.json`
- 실제 경량모델 스모크 점수 리포트 JSON: `docs/operations/generated/lightweight-model-smoke-score-report.json`
- 실제 경량모델 스모크 점수 리포트 Markdown: `docs/operations/generated/lightweight-model-smoke-score-report.md`

## 사용 명령

```powershell
npm.cmd run qa:scenarios:lightweight
npm.cmd run qa:score:lightweight
```

첫 번째 명령은 10개 카테고리, 카테고리별 10개, 총 100개 시나리오를 생성한다.

두 번째 명령은 컴퓨터유즈 점검자가 채울 수 있는 결과 입력 템플릿을 생성한다.

동시에 컴퓨터유즈 한 턴에 그대로 넘길 수 있는 실행팩도 생성한다.

```powershell
npm.cmd run qa:runpack:lightweight
```

실행팩은 시나리오별 사전조건, 실시 절차, 기대 결과, 체크포인트, 결과 기록 슬롯을 한 문서에 모은다.

업무엔진이 실행 중이면 현재 설정된 경량모델에 대해 핵심 스모크를 바로 점수화할 수 있다.

```powershell
npm.cmd run qa:smoke:lightweight
```

이 명령은 `/api/settings`의 런타임 정책과 실제 업무대화 1턴 응답을 확인하고, 대표 업무 흐름까지 실행해 `LMUX-02-01`, `LMUX-03-04`, `LMUX-03-10`, `LMUX-04-01`, `LMUX-04-05`, `LMUX-09-05`, `LMUX-10-01` 항목을 자동 채점한다. 전체 100개 시나리오를 대체하지는 않지만, Gemma 4 E2B 최적화 변경이 런타임 정책, Markdown 목록, 내부추론/모델 메타 노출 방지, 일정 도구 라우팅, HWPX 문서작성, 실행기록에 영향을 주는지 빠르게 확인하는 회귀 스모크다.

결과 파일을 별도로 작성한 뒤에는 아래처럼 점수 리포트를 만들 수 있다.

```powershell
node scripts/score-lightweight-model-test-run.mjs `
  --scenarios docs/operations/generated/lightweight-model-test-scenarios.json `
  --results docs/operations/generated/lightweight-model-test-results-template.json `
  --out-dir docs/operations/generated
```

## 채점 기준

각 시나리오는 10점 만점이다.

- `functional`: 0~4점, 기능이 실제로 동작하는가
- `ux`: 0~3점, 사용자가 진행상태와 다음 행동을 이해할 수 있는가
- `modelQuality`: 0~2점, 경량모델 답변이 구조화, 출처, 보안, 도구 우선 원칙을 지키는가
- `evidence`: 0~1점, 스크린샷, 로그, 산출물 경로 등 검증 증거가 남는가

시나리오별 등급은 다음 기준을 사용한다.

- 9~10점: `release-ready`
- 7~8점: `minor polish`
- 5~6점: `usable but needs fix`
- 0~4점: `blocker`

전체 실행의 종합 등급은 테스트한 항목 평균을 기준으로 하되, 미실시 항목이 남아 있으면 최대 `needs-work`로 제한한다. 즉, 일부만 점검하고 전체가 완료된 것처럼 보이는 착시를 막는다.

## 컴퓨터유즈 기록 원칙

- 각 시나리오는 가능하면 스크린샷 1개 이상 또는 로그/파일 경로 1개 이상을 `evidence`에 남긴다.
- 실패한 경우 사용자가 본 오류 문구, 버튼 상태, 마지막으로 성공한 단계, 재현 조건을 `notes` 또는 `blocker`에 남긴다.
- Gemma 4 E2B 점검에서는 응답 지연, 내부추론 노출, 도구 라우팅 실패, 출처 누락을 별도 메모한다.

## 현재 범위

현재 도구는 실행팩 생성, 점수화, 리포트 생성, 핵심 경량모델 스모크 자동 채점을 담당한다. 전체 100개 시나리오의 실제 컴퓨터유즈 조작은 Codex Browser/Playwright 또는 사용자의 수동 점검으로 수행하고, 그 결과를 결과 템플릿에 기록한다.
