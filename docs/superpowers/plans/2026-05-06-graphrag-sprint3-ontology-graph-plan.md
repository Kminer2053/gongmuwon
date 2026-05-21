# GraphRAG Sprint 3 - Ontology Graph 계획

작성일: 2026-05-06

## 목표

인제스트된 문서를 공공기관 업무 문맥의 ontology node/edge로 변환하고, SQLite graph mirror에 저장한다.

## 현재 상태

2026-05-06 기준 1차 구현 완료. 이후 LLM 기반 entity extraction은 rule 기반 품질이 안정된 뒤 추가한다.

## 구현 완료 범위

- [x] `ontology.py` 추가
- [x] deterministic ontology mapper
- [x] stable node id / edge id
- [x] Document/Chunk graph mirror 저장
- [x] Project/Task/Issue/Policy/Department/Person/Event/Attachment/Budget 후보 추출
- [x] `RELATES_TO`, `REFERENCES`, `SENT_TO`, `APPROVED_BY`, `ATTACHED`, `HAS_BUDGET` 등 관계 저장
- [x] 재인제스트 시 document 하위 graph child 정리
- [x] `GET /api/knowledge/graph/query`
- [x] retrieval 결과에 ontology relation 포함
- [x] 공공문서 alias 확장
- [x] 표 내부 담당자/부서/업무/예산/기간/첨부 필드 추출

## 현재 ontology alias 예

- 사업, 사업명
- 업무, 업무명
- 이슈, 현안
- 정책, 근거법령
- 담당자, 담당
- 부서, 소관부서
- 예산, 금액, 소요예산, 사업비
- 기간, 추진기간, 사업기간
- 붙임, 첨부, 첨부파일

## 검증

최근 검증:

```text
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_graphrag_ontology.py -q
통과

npm.cmd run sidecar:test
116 passed
```

## 후속 과제

- 사용자가 ontology alias를 수정하는 UI
- 동의어/기관별 용어 사전
- node merge/split
- LLM 기반 entity extraction 평가
- KuzuDB adapter 실제 적용
