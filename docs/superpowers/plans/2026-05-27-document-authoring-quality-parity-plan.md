# 문서작성 품질 동등성 개선 계획

## 목표

공무 문서작성 기능이 `Kminer2053/public-doc-to-hwpx` 원 스킬과 최대한 같은 품질 흐름을 갖도록 개선한다. 특히 `google/gemma-4-E2B-it` 모델을 사용할 때도 4개 산출 형식이 실제 HWPX 파일 기준으로 검증 가능해야 한다.

## 품질 기준

- 대화세션, 연결 파일, 일정, 지식폴더 GraphRAG 근거를 먼저 수집한다.
- 수집 정보는 `WorkSessionBrief`로 요약한다.
- `DocumentPlan`에서 산출 형식과 배치 전략을 정한다.
- 서식별 본문은 공공문서 작성 원칙에 맞춰 재구성한다.
- HWPX는 내장 skeleton의 placeholder를 채우는 방식으로 생성한다.
- 원 스킬의 `validate.py`로 구조 검증이 가능해야 한다.

## 구현 범위

1. 문서작성 파이프라인을 `입력 수집 -> WorkSessionBrief -> DocumentPlan -> 서식별 본문 -> HWPX 생성`으로 고정한다.
2. 직접 문서작성 API와 업무대화 도구 호출이 같은 파이프라인을 사용하게 한다.
3. 시행문, 1페이지 보고서, 풀버전 보고서, 이메일 4개 형식을 모두 지원한다.
4. 원 스킬의 skeleton 보정 방식을 공무 내장 writer에 반영한다.
5. Gemma 응답의 Markdown 잔여물과 role label을 제거한다.
6. 같은 입력값으로 공무 산출물과 원 스킬 산출물을 나란히 생성해 비교하는 프로브를 둔다.

## 검증 기준

- `services/sidecar/tests/test_document_workflow.py` 전체 통과
- 원 스킬 직접 비교 프로브 통과
- 실제 Featherless `google/gemma-4-E2B-it` 호출 기반 4개 서식 생성 통과
- 원 스킬 `validate.py` 기준 4개 HWPX 구조 검증 통과

## 현재 상태

2026-05-28 기준 아래 증거를 확보했다.

- 문서작성 테스트: `32 passed`
- 원 스킬 직접 비교: 3개 예문 기준 `all_hwpx_reference_comparisons_passed: true`
- 이메일 서식 검증: `email_passed: true`
- 실제 Gemma E2B 단일 예문 호출: `all_outputs_passed: true`
- 실제 Gemma E2B 다중 예문 호출: 3개 예문, 6회 LLM 호출, 12개 HWPX 산출물 기준 `all_cases_passed: true`
- 원 스킬 `validate.py`: 4개 산출물 모두 통과

상세 증거는 [문서작성 Gemma E2B 품질 비교 증거](../../operations/2026-05-27-document-authoring-gemma-quality-evidence.md)에 기록했다.

## 남은 주의점

- LLM 문장 자체의 완전 동일성은 보장하지 않는다.
- 품질 보장은 처리 단계, 서식 구조, 근거 반영, 금지 잔여물 제거, HWPX 구조 검증 기준으로 판단한다.
- 이메일은 원 스킬에 HWPX skeleton 경로가 없으므로 공무 내장 email skeleton 기준으로 별도 관리한다.
- LLM 출력은 매 실행마다 문장이 달라질 수 있으므로, 자동 검증은 byte 단위 동일성이 아니라 단계, 구조, 맥락 반영, 금지 잔여물 제거, HWPX 구조 유효성을 기준으로 둔다.
