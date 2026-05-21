# GraphRAG Sprint 4 - Hybrid Retrieval 계획

작성일: 2026-05-06

## 목표

chunk text, embedding vector, ontology graph, 업무대화 세션 연결 파일을 결합한 로컬 우선 hybrid retrieval을 구현한다.

## 현재 상태

2026-05-06 기준 1차 구현 완료. LLM 기반 최종 합성 답변은 후속 단계이며, 현재는 deterministic extractive grounded answer를 제공한다.

## 구현 완료 범위

- [x] `/api/knowledge/retrieve`
- [x] `/api/knowledge/ask`
- [x] chunk text 포함/토큰 겹침 점수
- [x] embedding cosine similarity 점수
- [x] ontology graph term 점수
- [x] 업무대화 세션 연결 파일 boost
- [x] table evidence boost
- [x] score breakdown 반환
- [x] grounded answer 생성
- [x] citation 반환
- [x] citation의 parser/quality/partial/evidence type/warnings/relations 표시
- [x] retrieval summary 반환

## Retrieval 신호

- `text_score`
- `vector_score`
- `graph_score`
- `session_context_boost`
- `table_evidence_boost`

## Citation 계약

- document id/title/path
- chunk id
- parser name
- quality score
- partial 여부
- evidence type
- quality warnings
- score breakdown
- relation names

## 검증

최근 검증:

```text
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_graphrag_retrieval.py -q
통과

npm.cmd run sidecar:test
116 passed

npm.cmd run desktop:test
18 test files passed, 47 tests passed
```

## 후속 과제

- LLM 기반 최종 답변 생성
- citation 없는 답변 금지 정책 강화
- low-quality 문서 기반 답변 경고 강화
- reranker 도입 검토
- ChromaDB production vector adapter 적용
