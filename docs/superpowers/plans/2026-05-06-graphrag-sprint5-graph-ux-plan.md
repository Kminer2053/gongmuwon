# GraphRAG Sprint 5 - Graph UX 고도화 계획

작성일: 2026-05-06

## 목표

내 지식폴더 화면을 단순 그래프 미리보기에서 탐색 가능한 업무지식 그래프 UI로 고도화한다.

사용자는 지식 검색어 또는 그래프 노드를 기준으로 다음 정보를 한 화면에서 확인할 수 있어야 한다.

- 매칭된 지식 노드
- 관계 유형
- 연결된 이웃 노드
- 관련 원천 문서
- 관련 문서의 파일 경로
- 관련 문서의 section/table 구조
- grounded answer와 출처 citation

## 구현 상태

2026-05-06 기준 1차 구현 완료.

- [x] `GET /api/knowledge/graph/query` desktop client 연결
- [x] 검색어 기반 관계 보기 결과 표시
- [x] 그래프 노드 클릭 기반 관계 보기 갱신
- [x] 관계 보기 카드에서 매칭 노드, 이웃 노드, 관계 유형, 관련 문서 분리 표시
- [x] 관련 문서 제목과 파일 경로 표시
- [x] 관련 문서의 section/table drill-down 표시
- [x] 그래프 영역 스크롤 및 많은 노드에 대한 높이 확장
- [x] legend 버튼 기반 노드 유형 필터
- [x] grounded GraphRAG answer 생성 UI
- [x] answer citation에 parser, quality, partial, evidence type, warning, relation 표시
- [x] ask 결과 summary 표시

## 현재 UI 동작

- 지식폴더 화면 최상단에 지식 그래프 미리보기를 배치한다.
- 세부 데이터는 접힌 섹션으로 두어 한 화면에서 지식체계가 먼저 보이게 한다.
- 그래프 노드를 클릭하면 해당 label 기준으로 관계 보기를 실행한다.
- 검색어로 관계 보기를 실행하면 관련 노드와 문서가 표시된다.
- 관련 문서를 선택하면 structured section과 table을 확인할 수 있다.
- 근거 답변 생성 시 citations와 retrieval summary가 함께 표시된다.

## 검증

최근 검증:

```text
npm.cmd run desktop:test -- knowledge-sources.test.tsx
9 passed

npm.cmd run desktop:test
18 test files passed, 47 tests passed

npm.cmd run sidecar:test
116 passed

node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
Finished dev profile
```

## 제외 범위

아래는 후속 UX 고도화 대상으로 남긴다.

- force-directed graph physics
- 노드 위치 저장
- 노드/관계 수동 편집
- 별칭 병합 UI
- graph traversal depth 조절
- 대형 그래프 virtualized rendering
- ChromaDB/KuzuDB production backend 번들링

## 다음 후보 작업

- 노드 클릭 후 우측 상세 inspector를 별도 패널로 분리
- 관계 유형별 색상/선 스타일 강화
- 문서 section/table viewer를 공공문서 양식에 맞게 개선
- 검색 결과에서 low-quality/partial 문서 필터 추가
- GraphRAG 답변을 LLM 합성 답변으로 확장하되 citation 계약 유지
