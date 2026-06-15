# 2026-06-16 업무엔진 병렬작업 검증

## 목적

GraphRAG 인덱싱 같은 장기 작업이 실행 중일 때도 사용자가 파일검색과 업무대화를 계속 사용할 수 있는지 확인했다.

## 확인한 문제

- 로컬 파일명 인덱스가 비어 있는 초기 환경에서는 지식폴더 검색 결과가 이미 있어도 파일찾기가 전체 드라이브 파일명 스캔으로 폴백했다.
- 이 폴백은 기본 최대 8초까지 실행되어, 인제스트 중 파일찾기가 멈춘 것처럼 보일 수 있었다.
- 원인은 GraphRAG DB 락이 아니라 `search_files()`의 전체 PC 파일명 스캔 폴백 조건이었다.

## 수정 내용

- 지식폴더 또는 로컬 인덱스 결과가 이미 있는 상태에서 GraphRAG 인제스트가 실행 중이면 전체 드라이브 파일명 스캔을 건너뛴다.
- 이 경우 응답에는 `partial=true`, `fallback_skipped=true`, `fallback_skip_reason`을 남겨 UI와 로그에서 이유를 확인할 수 있게 했다.
- 지식폴더 파일검색과 로컬 파일명 인덱스 조회는 readonly DB 연결을 사용하도록 조정했다.

## 검증 명령

```powershell
.venv\Scripts\python.exe scripts\runtime-concurrency-smoke.py
node scripts\portable-run.mjs python -m pytest services/sidecar/tests/test_local_file_search.py services/sidecar/tests/test_graphrag_ingestion.py -q
npm.cmd run verify:completion:audit
```

## 결과

- GraphRAG 인제스트는 일부러 파일당 1초 지연되도록 만든 상태에서 실행했다.
- 파일검색은 인제스트 실행 중 `137.25ms`에 응답했다.
- 업무대화 turn 생성은 인제스트 실행 중 `29.73ms`에 응답했다.
- 인제스트 최종 상태는 `completed`였다.
- 관련 sidecar 회귀 테스트는 `54 passed`였다.
- completion audit은 G03의 병렬작업 블로커를 제거할 수 있는 상태임을 확인했다.

## 남은 범위

- G03 전체 완료에는 clean-account 또는 VM 기준 설치, 실행, 종료, 복구 증거가 아직 필요하다.
