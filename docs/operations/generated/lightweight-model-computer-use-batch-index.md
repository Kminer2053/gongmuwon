# Gemma 4 E2B 컴퓨터유즈 배치 실행 인덱스

- 모델 기준: Gemma 4 E2B (gemma4:e2b)
- 배치 수: 10
- 총 시나리오: 100

## 배치 목록

| 배치 | 시나리오 | 카테고리 | 총점 |
| --- | ---: | --- | ---: |
| computer-use-batch-01 | 10 | 앱 시작과 업무엔진 | 100 |
| computer-use-batch-02 | 10 | 모델 설정과 Gemma 4 E2B | 100 |
| computer-use-batch-03 | 10 | 업무대화 기본 UX | 100 |
| computer-use-batch-04 | 10 | 업무대화 도구 라우팅 | 100 |
| computer-use-batch-05 | 10 | 일정 캘린더 | 100 |
| computer-use-batch-06 | 10 | 파일찾기와 세션 연결 | 100 |
| computer-use-batch-07 | 10 | 지식폴더/GraphRAG 인덱싱 | 100 |
| computer-use-batch-08 | 10 | GraphRAG 검색과 출처 답변 | 100 |
| computer-use-batch-09 | 10 | 문서작성/HWPX 산출 | 100 |
| computer-use-batch-10 | 10 | 실행기록/작업진행/다중작업 | 100 |

## 사용법

- 각 배치 Markdown을 컴퓨터유즈 한 턴의 지시문으로 사용한다.
- 배치별 결과 JSON을 만든 뒤 `--merge-results`로 합산한다.
- 최종 합산 결과에 `--audit-coverage --fail-on-incomplete`를 적용해 완료 가능 여부를 판정한다.
