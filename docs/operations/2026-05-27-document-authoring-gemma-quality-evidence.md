# 문서작성 Gemma E2B 품질 비교 증거

## 목적

`google/gemma-4-E2B-it` 모델을 사용해도 공무 문서작성 흐름이 `Kminer2053/public-doc-to-hwpx` 원 스킬과 최대한 같은 수준의 처리 흐름과 산출 품질을 확보하는지 확인한다.

동일 문장까지 100% 보장하는 것이 목표는 아니다. LLM 응답은 모델 상태에 따라 달라질 수 있으므로, 검증 기준은 아래 품질 불변성으로 둔다.

- `WorkSessionBrief -> DocumentPlan -> 서식별 본문 구성 -> HWPX skeleton 채움` 단계를 거친다.
- `officialMemo`, `onePageReport`, `fullReport`, `email` 4개 산출 형식을 모두 생성한다.
- 업무대화 세션, 일정, 파일/지식폴더 근거, GraphRAG 검색 맥락을 산출물에 반영한다.
- Gemma 계열 응답에서 자주 생기는 Markdown 찌꺼기(`**`, `\_`, `- -`, role label 등)가 최종 HWPX에 남지 않는다.
- 내장 skeleton 기반 HWPX가 원 스킬의 `validate.py` 구조 검증을 통과한다.

## 자동 테스트

실행일: 2026-05-28

```powershell
$env:PYTHONIOENCODING='utf-8'
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_document_workflow.py -q
```

결과:

```text
32 passed in 15.01s
```

추가된 회귀 테스트:

- 이메일 서식이 업무대화, 지식폴더, GraphRAG 맥락을 제한된 본문 슬롯 안에서도 보존하는지 확인
- 문서작성 명령문 필터가 “보고서 작성 요청이 세션에 남아 있다” 같은 서술형 맥락을 잘못 제거하지 않는지 확인
- `Content Base 내용을 기준으로 정리합니다` 같은 내부 fallback 문구가 1페이지 보고서와 풀버전 보고서에 누출되지 않는지 확인

## 원 스킬 직접 비교 프로브

실행일: 2026-05-28

```powershell
$env:PYTHONIOENCODING='utf-8'
node scripts/portable-run.mjs python runtime-workspace/cache/public_doc_parity_probe_20260528.py
```

비교 방식:

- 3개 업무 예문을 사용한다.
- 같은 `content_markdown`을 공무 `hwpx_writer`와 원 스킬 `fill_skeleton.py`에 모두 넣는다.
- `officialMemo`, `onePageReport`, `fullReport`는 원 스킬의 HWPX skeleton으로 직접 재생성해 비교한다.
- `email`은 원 스킬에 HWPX skeleton 경로가 없으므로 공무 내장 email skeleton을 구조 검증하고, 본문 맥락 보존 기준으로 별도 평가한다.

예문:

- `ai_meeting`: AI 회의 후속 보고서
- `civil_complaint`: 민원 처리 현황 보고서
- `offline_llm`: 폐쇄망 로컬모델 테스트 계획 보고서

결과 요약:

```text
all_hwpx_reference_comparisons_passed: true
email_passed: true
```

산출 위치:

```text
runtime-workspace/cache/public-doc-parity-probe-20260528/
```

주요 산출물:

- `{case_id}_gongmu_officialMemo.hwpx`
- `{case_id}_reference_officialMemo.hwpx`
- `{case_id}_gongmu_onePageReport.hwpx`
- `{case_id}_reference_onePageReport.hwpx`
- `{case_id}_gongmu_fullReport.hwpx`
- `{case_id}_reference_fullReport.hwpx`
- `{case_id}_gongmu_email.hwpx`
- `parity_report.json`

확인된 사항:

- 3개 예문의 시행문, 1페이지 보고서, 풀버전 보고서는 같은 values를 기준으로 공무 산출물과 원 스킬 산출물이 모두 `validate.py`를 통과했다.
- 시행문은 원 스킬의 동적 본문 확장 방식처럼 긴 근거/조치/붙임 항목을 누락하지 않는다.
- 1페이지 보고서는 `◦`, `*` 마커 정규화와 중복 bullet 제거가 동작한다.
- 이메일은 제목/수신/요청/기한/지식폴더/프롬프트/AI 회의 맥락을 보존한다.

## 실제 Featherless Gemma E2B 호출 프로브

실행일: 2026-05-28

```powershell
$env:PYTHONIOENCODING='utf-8'
node scripts/portable-run.mjs python runtime-workspace/cache/gemma_quality_probe_20260527.py
```

환경:

- 공급자: Featherless
- 모델: `google/gemma-4-E2B-it`
- Base URL: `https://api.featherless.ai/v1`
- API key: 설정되어 있으나 문서에는 기록하지 않음

결과 요약:

```text
authoring_ok: true
llm_call_count: 2
authoring_elapsed_sec: 31.355
content_has_required_sections: true
all_outputs_passed: true
```

생성 산출물:

```text
runtime-workspace/cache/gemma-quality-probe-20260527/gemma_quality_officialMemo.hwpx
runtime-workspace/cache/gemma-quality-probe-20260527/gemma_quality_onePageReport.hwpx
runtime-workspace/cache/gemma-quality-probe-20260527/gemma_quality_fullReport.hwpx
runtime-workspace/cache/gemma-quality-probe-20260527/gemma_quality_email.hwpx
```

원 스킬 `validate.py` 검증:

```powershell
$env:PYTHONIOENCODING='utf-8'
node scripts/portable-run.mjs python runtime-workspace/cache/public-doc-to-hwpx-reference/scripts/validate.py runtime-workspace/cache/gemma-quality-probe-20260527/gemma_quality_officialMemo.hwpx
node scripts/portable-run.mjs python runtime-workspace/cache/public-doc-to-hwpx-reference/scripts/validate.py runtime-workspace/cache/gemma-quality-probe-20260527/gemma_quality_onePageReport.hwpx
node scripts/portable-run.mjs python runtime-workspace/cache/public-doc-to-hwpx-reference/scripts/validate.py runtime-workspace/cache/gemma-quality-probe-20260527/gemma_quality_fullReport.hwpx
node scripts/portable-run.mjs python runtime-workspace/cache/public-doc-to-hwpx-reference/scripts/validate.py runtime-workspace/cache/gemma-quality-probe-20260527/gemma_quality_email.hwpx
```

결과:

```text
4개 산출물 모두 mimetype STORED, secPr 존재, XML 파싱 정상, 검증 통과
```

## 실제 Featherless Gemma E2B 다중 예문 프로브

실행일: 2026-05-28

```powershell
$env:PYTHONIOENCODING='utf-8'
node scripts/portable-run.mjs python runtime-workspace/cache/gemma_multi_case_quality_probe_20260528.py
```

검증 방식:

- `ai_meeting`, `civil_complaint`, `offline_llm` 3개 예문을 사용한다.
- 각 예문마다 실제 Featherless `google/gemma-4-E2B-it` 호출로 `WorkSessionBrief`와 `DocumentPlan/content_markdown`을 생성한다.
- 예문별로 `officialMemo`, `onePageReport`, `fullReport`, `email` 4개 HWPX 파일을 생성한다.
- 각 산출물에서 업무 맥락 핵심어, 금지 잔여물, 내부 fallback 문구 누출 여부를 검사한다.

환경:

- 공급자: Featherless
- 모델: `google/gemma-4-E2B-it`
- Base URL: `https://api.featherless.ai/v1`
- API key: 설정되어 있으나 문서에는 기록하지 않음

결과 요약:

```text
llm_call_count: 6
ai_meeting: all_outputs_passed=true, authoring_elapsed_sec=29.582
civil_complaint: all_outputs_passed=true, authoring_elapsed_sec=27.679
offline_llm: all_outputs_passed=true, authoring_elapsed_sec=25.801
all_cases_passed: true
```

산출 위치:

```text
runtime-workspace/cache/gemma-multi-case-quality-probe-20260528/
```

생성 산출물:

```text
runtime-workspace/cache/gemma-multi-case-quality-probe-20260528/{case_id}_officialMemo.hwpx
runtime-workspace/cache/gemma-multi-case-quality-probe-20260528/{case_id}_onePageReport.hwpx
runtime-workspace/cache/gemma-multi-case-quality-probe-20260528/{case_id}_fullReport.hwpx
runtime-workspace/cache/gemma-multi-case-quality-probe-20260528/{case_id}_email.hwpx
```

## 이번 개선으로 해결한 문제

- 이메일 서식에서 GraphRAG/지식폴더 맥락이 좁은 슬롯 때문에 밀려나는 문제를 보완했다.
- “보고서 작성 요청이 함께 남아 있다”처럼 세션 상태를 설명하는 문장을 직접 문서작성 명령으로 오인해 제거하던 필터를 좁혔다.
- 시행문 본문 확장을 원 스킬 방식에 맞춰 보강해 긴 조치/근거/붙임 목록을 누락하지 않도록 했다.
- 수신 라벨과 수신자 입력 슬롯을 원 스킬 방식에 맞게 분리했다.
- Gemma 응답의 Markdown escape, role label, 중복 bullet, 빈 placeholder 잔여물을 제거하는 회귀 테스트를 추가했다.
- sparse 입력에서도 내부 Content Base fallback 문구 대신 수집된 업무 맥락 기반 표현을 사용하도록 수정했다.

## 남은 한계

- LLM이 생성하는 문장 자체가 원 스킬과 byte 단위로 동일하다는 보장은 불가능하다.
- 현재 보장 수준은 처리 단계, skeleton 구조, 문맥 반영, 금지 잔여물 제거, 원 스킬 구조 검증 통과다.

## 2026-05-29 후속 기준 정리

사용자 피드백에 따라 문서작성 품질 점검 문구의 허용 범위를 명확히 분리했다.

- `작성 품질 점검`, `두괄식`, `개조식` 같은 내부 작성 원칙은 Content Base 또는 검토용 Markdown에는 남을 수 있다.
- 최종 HWPX 보고서 본문에는 내부 작성 원칙, 작성 단계명, skeleton 처리 문구가 노출되면 안 된다.
- `상호 존중`처럼 모델이 의미를 유지한 채 다른 표현으로 풀어쓰는 문제는 모델 생성 품질 영역으로 보고 코드 패치워크로 강제 보정하지 않는다.
- 검증의 중심은 문장 byte 동일성이 아니라 서식 구조 보존, 핵심 맥락 반영, 최종 본문 누출 제거다.

후속 수정:

- 최종 HWPX 본문만 내부 품질 점검 문구 금지 대상으로 보는 회귀 테스트 기준으로 조정했다.
- 검토용 Markdown까지 무조건 금지하던 과도한 테스트 기대치를 제거했다.
- 4개 산출 형식에서 `작성 품질 점검`, `DocumentPlan`, `HWPX skeleton` 등 내부 작성 메타데이터가 최종 본문에 남지 않는지 재검증했다.

검증 명령 및 결과:

```powershell
$env:PYTHONIOENCODING='utf-8'
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_document_workflow.py -q
```

```text
42 passed in 17.19s
```

```powershell
$env:PYTHONIOENCODING='utf-8'
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_work_session_turn.py -q
```

```text
40 passed in 20.60s
```

```powershell
npm.cmd run sidecar:test
```

```text
278 passed in 75.51s
```

동일 예시문맥 4개 형식 산출 검증:

```powershell
$env:PYTHONIOENCODING='utf-8'
node scripts/portable-run.mjs python runtime-workspace/cache/generate_public_doc_quality_regression_20260529.py
```

```text
all_clear: true
internal_marker_hits: []
missing_required_terms: []
ordered_bullet_artifacts: []
```

산출 위치:

```text
runtime-workspace/cache/public-doc-quality-regression-20260529/
```

HWPX 구조 검증:

```powershell
$env:PYTHONIOENCODING='utf-8'
node scripts/portable-run.mjs python runtime-workspace/cache/public-doc-to-hwpx-reference/scripts/validate.py runtime-workspace/cache/public-doc-quality-regression-20260529/adolescent-dialogue-officialMemo.hwpx
node scripts/portable-run.mjs python runtime-workspace/cache/public-doc-to-hwpx-reference/scripts/validate.py runtime-workspace/cache/public-doc-quality-regression-20260529/adolescent-dialogue-onePageReport.hwpx
node scripts/portable-run.mjs python runtime-workspace/cache/public-doc-to-hwpx-reference/scripts/validate.py runtime-workspace/cache/public-doc-quality-regression-20260529/adolescent-dialogue-fullReport.hwpx
node scripts/portable-run.mjs python runtime-workspace/cache/public-doc-to-hwpx-reference/scripts/validate.py runtime-workspace/cache/public-doc-quality-regression-20260529/adolescent-dialogue-email.hwpx
```

```text
4개 산출물 모두 mimetype STORED, secPr 존재, XML 파싱 정상, 검증 통과
```
- 이메일은 원 스킬에 HWPX skeleton이 없으므로 HWPX 동등성 비교가 아니라 공무 내장 email skeleton 품질 검증으로 관리한다.
