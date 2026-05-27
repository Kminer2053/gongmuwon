# 경량모델 UX 품질 측정 결과

- 실행 ID: lightweight-ux-quality-1779694297940
- 생성 시각: 2026-05-25T07:31:39.450Z
- 기준 모델: gemma4:e2b
- 측정 대상: http://127.0.0.1:8766
- 종합 점수: 1000 / 1000
- 종합 등급: release-ready

## 반응속도 점수

- 통과율: 100.0% (7/7)
- 점수: 1000 / 1000
- 등급: release-ready

| 측정 항목 | 기준 | 평균 | p95 | 상태 |
| --- | ---: | ---: | ---: | --- |
| health | 500ms | 13ms | 51ms | pass |
| ready | 800ms | 5ms | 6ms | pass |
| runtime-metrics | 800ms | 4ms | 5ms | pass |
| settings | 1000ms | 3ms | 5ms | pass |
| work-sessions | 1000ms | 11ms | 13ms | pass |
| schedules | 1000ms | 2ms | 3ms | pass |
| file-search-empty | 1500ms | 406ms | 523ms | pass |

## 라우팅 동작확률

- 성공률: 100.0% (30/30)
- 액션 적중률: 100.0%
- 점수: 1000 / 1000
- 등급: release-ready

| 케이스 | 기대 경로 | 실제 경로 | 기대 액션 | 실제 액션 | 지연 | 상태 |
| --- | --- | --- | --- | --- | ---: | --- |
| route-schedule-create-01 | tool | tool | schedule.create | schedule.create | 7ms | pass |
| route-schedule-create-02 | tool | tool | schedule.create | schedule.create | 3ms | pass |
| route-schedule-create-03 | tool | tool | schedule.create | schedule.create | 3ms | pass |
| route-schedule-list-01 | tool | tool | schedule.list | schedule.list | 3ms | pass |
| route-schedule-list-02 | tool | tool | schedule.list | schedule.list | 3ms | pass |
| route-schedule-list-03 | tool | tool | schedule.list | schedule.list | 3ms | pass |
| route-schedule-delete-01 | tool | tool | schedule.delete | schedule.delete | 3ms | pass |
| route-schedule-delete-02 | tool | tool | schedule.delete | schedule.delete | 3ms | pass |
| route-knowledge-01 | tool | tool | knowledge.search | knowledge.search | 3ms | pass |
| route-knowledge-02 | tool | tool | knowledge.search | knowledge.search | 3ms | pass |
| route-knowledge-03 | tool | tool | knowledge.search | knowledge.search | 2ms | pass |
| route-document-01 | tool | tool | documents.generate | documents.generate | 2ms | pass |
| route-document-02 | tool | tool | documents.generate | documents.generate | 3ms | pass |
| route-document-03 | tool | tool | documents.generate | documents.generate | 3ms | pass |
| route-help-01 | tool | tool | help.guide | help.guide | 2ms | pass |
| route-help-02 | tool | tool | help.guide | help.guide | 2ms | pass |
| route-help-03 | tool | tool | help.guide | help.guide | 2ms | pass |
| route-multi-01 | multi_intent | multi_intent | intent.plan, schedule.create, knowledge.search | intent.plan, schedule.create, knowledge.search | 3ms | pass |
| route-multi-02 | multi_intent | multi_intent | intent.plan, knowledge.search, documents.generate | intent.plan, knowledge.search, documents.generate | 3ms | pass |
| route-multi-03 | multi_intent | multi_intent | intent.plan, schedule.list, knowledge.search | intent.plan, schedule.list, knowledge.search | 3ms | pass |
| route-general-01 | llm.chat | llm.chat | - | - | 3ms | pass |
| route-general-02 | llm.chat | llm.chat | - | - | 2ms | pass |
| route-general-03 | llm.chat | llm.chat | - | - | 3ms | pass |
| route-document-04 | tool | tool | documents.generate | documents.generate | 3ms | pass |
| route-knowledge-04 | tool | tool | knowledge.search | knowledge.search | 2ms | pass |
| route-schedule-list-04 | tool | tool | schedule.list | schedule.list | 3ms | pass |
| route-schedule-delete-03 | tool | tool | schedule.delete | schedule.delete | 3ms | pass |
| route-help-04 | tool | tool | help.guide | help.guide | 2ms | pass |
| route-general-04 | llm.chat | llm.chat | - | - | 2ms | pass |
| route-multi-04 | multi_intent | multi_intent | intent.plan, schedule.list, documents.generate | intent.plan, schedule.list, documents.generate | 3ms | pass |

## 실패 케이스

- 없음
