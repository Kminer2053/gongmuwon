# 지식폴더 2.0 아키텍처 결정서 — GraphRAG 폐기, LLM 위키 하이브리드 채택

- 작성일: 2026-07-03
- 결정자: 개발 세션 (사용자 위임: "더 좋은 방향이라고 생각하는 쪽으로 정해서 개선을 진행")
- 상태: **확정** — 본 세션에서 구현

## 1. 결정

**GraphRAG(ChromaDB 벡터 + 온톨로지 그래프) 방식을 폐기하고, "SQLite FTS5 + LLM 위키(Karpathy 방식) + 홉 제한 에이전틱 루프" 하이브리드로 전환한다.**

```
knowledge-wiki/  (워크스페이스 내, Obsidian 호환 Markdown 정본)
 ├─ index.md          # 전 문서/주제 카탈로그 + 한 줄 요약 (조회 진입점)
 ├─ docs/<slug>.md    # 문서 카드: YAML front matter(원본경로·일자·유형·품질) + 개요·섹션·표 요약
 ├─ topics/<slug>.md  # 주제 페이지 (LLM 보강, 선택적)
 └─ log.md            # ingest/질의/lint 이력 (append-only)

SQLite: documents/source_files 유지 + FTS5 가상 테이블(trigram, 추출 본문+카드 색인)
LLM: ① ingest 후 배치 보강(문서 요약·주제 페이지, 없어도 동작) ② 질의 시 합성(선택)
```

## 2. 근거 (2026-07-03 조사·진단 결과)

### 2.1 현 GraphRAG의 실체 진단
- 기본 임베딩 `deterministic` = **64차원 SHA-256 해시 bag-of-tokens** (`embeddings.py:38-48`) — 의미 벡터가 아니며, 코드 스스로 lexical/graph 근거 없으면 벡터 점수를 0으로 강제(`graphrag_ingestion.py:942-950`).
- "온톨로지 그래프" = 정규식 prefix 매칭 태그(`ontology.py:45-109`). 다중 홉 추론·엔티티 해소 없음. KuzuDB는 upstream archive로 영구 보류.
- Ollama 임베딩은 폐쇄망에 번들 불가(별도 설치+pull), 서버 죽으면 **청크 단위 silent fallback으로 768/64차원 혼재** → Chroma 차원 오류 폭탄.
- 한 코드베이스에 벡터 스토어 3개(LanceDB/Chroma/SQLite JSON), 그래프 2개(networkx/SQLite mirror) 공존.
- 17개 파일 인제스트 "37,599초" 표기 등 신뢰 훼손 이력 (2026-05-18 감사).
- 생산 코드 ~5,300줄 중 유지 가치 ~1,900줄(파서·스캐너·모델), 나머지 ~3,400줄은 부채.

### 2.2 Karpathy LLM 위키 방식의 적합성
- 원 소스: gist `llm-wiki.md` — "매 질의마다 청크 재검색이 아니라, 원본을 한 번 컴파일해 **지속 유지되는 마크다운 위키**로 만들어라. RAG는 아무것도 축적하지 않지만 위키는 복리로 쌓인다."
- 로컬 소형 LLM 제약: 24B 모델조차 자유 에이전틱 검색 지휘 시 3.2/5로 급락(전략 전환 실패). 프런티어 4.7/5. → **4~8B에게는 '컴파일된 index.md + 결정론적 FTS5'로 탐색 난도를 낮추고 홉 수를 제한**하는 형태가 현실적 최적점.
- 한국어: SQLite FTS5 기본 토크나이저는 CJK 무력 → **trigram 토크나이저** 필수. 한국어 공문서 질의는 사업명·부서명·금액 등 고유 키워드 중심이라 형태소/트라이그램 BM25가 임베딩과 대등~우위 (AutoRAG 벤치마크: 임베딩이 rank-aware 지표에서 BM25보다 유의미하게 낮은 사례 실재).
- GraphRAG 색인의 핵심(LLM 엔티티 추출)은 4~8B 한국어 환경에서 품질·비용 양면 성립 불가 (arXiv 2605.20815).

### 2.3 PRD 정합성 (계획서 원문 확인)
- 최종통합판 §4.3의 지식폴더 3층 구조 1층이 애초에 "**Obsidian 호환 Markdown Vault 정본**" — 위키 방식이 원래 기획에 더 가깝다.
- 출처(provenance) 요건: "사람이 읽는 마크다운 + 결정론적 매칭"이 벡터 유사도보다 감사 가능성에서 구조적 우월.
- 성공 지표 "10분 내 폴더 등록+10파일 인덱싱 / 3초 내 출처 답변"은 LLM 없는 결정론 경로(스캔→추출→FTS5)로만 달성 가능해야 함 → LLM 보강은 별도 배치로 분리.

## 3. 전환 원칙

1. **유지**: `document_parsers.py`(694줄, 최고 자산), `kordoc_bridge.py`, `graphrag_models.py`, scan/hash/사이드카 추출(`knowledge.py`), 섹션 청킹 로직(카드 생성에 재사용).
2. **폐기(쓰기 경로 차단)**: ChromaDB 백엔드, embeddings 벡터 파이프라인, ontology 그래프 upsert, LanceDB/networkx 레거시 위키, retrieve() 매직 상수 랭커, 6단계 진행률 연극.
3. **신규**: `knowledge_wiki.py` — extracted markdown 저장(`extracted/{hash}.md`), FTS5 색인(trigram), 결정론적 문서 카드 생성, index.md 유지, LLM 보강 배치, 홉 제한 질의 루프(ask).
4. **버그 수정**: `_is_excluded`가 root 상위 조상 경로의 점 폴더까지 검사해 전체 제외되는 문제 → root 기준 상대 부분만 검사.
5. **.hwp 의존성**: `kordoc`을 package.json 의존성에 추가(테스트 폴더 533파일 중 170개가 .hwp). 폐쇄망 번들에 포함.
6. **API 호환**: `/api/knowledge/sources|scan|ingest|search|ask|documents`는 유지(내부 재구현). graph 계열은 위키 구조 응답으로 대체.
7. **채팅 통합**: `[GraphRAG context]` 주입을 `[지식폴더 근거]`(FTS5 히트 + 문서 카드 + 원본 경로 인용)로 교체. 키워드 하이재킹(`app.py:1150-1157`) 제거 — 템플릿 답변이 LLM을 가로채지 않게.

## 4. 품질 게이트

- 결정론 경로: LLM 미설정 상태에서 스캔→추출→색인→검색→출처 표시가 전부 동작.
- AI혁신처 폴더(533파일: hwp 170, pdf 110, pptx 66, hwpx 23) 실전 인덱싱으로 검증.
- 실제 질의 평가셋(부서 업무 질의)으로 검색 회귀 테스트.
- 기존 sidecar/desktop 테스트 그린 유지(지식 계약 테스트는 새 동작 기준으로 갱신).
