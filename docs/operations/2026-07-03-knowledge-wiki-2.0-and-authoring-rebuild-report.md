# 2026-07-03 지식폴더 2.0 전환 · 문서작성 재구축 · 픽토그램 UI 개편 결과보고

## 1. 요약

세 갈래 개편을 한 세션에서 완료하고 실전 데이터(문서폴더 `2026_AI혁신처`, 533파일/4GB)로 검증했다.

1. **지식폴더 2.0**: GraphRAG(ChromaDB 벡터 + 정규식 온톨로지) 폐기 → **Karpathy식 LLM 위키 + SQLite FTS5(trigram) 하이브리드** 전환. 결정 근거는 [아키텍처 결정서](../superpowers/specs/2026-07-03-knowledge-wiki-2.0-architecture-decision.md).
2. **문서작성**: ax-playground(AX Portal)의 검증된 패턴 이식 — 2단계 생성(내용 정리→양식 맞춤) + pydantic 검증/한국어 힌트 재시도/복구 + **구조 검토 게이트**(LLM은 구조 JSON까지만, 최종 렌더는 결정적 코드) + 단계 스트리밍 + 좌입력/우4탭 분할 워크스페이스.
3. **디자인**: Codex 스타일(라이트 글래스·잉크·그린 액센트) 유지한 채 **픽토그램 버튼 시스템** 도입 — SVG 아이콘 50종 + `.icon-button` 체계, 전 화면 스윕. 접근성 규칙(aria-label+title 필수, accent 화면당 1개, 파괴적 액션은 텍스트 유지) 적용.

## 2. 실전 검증 결과 (2026_AI혁신처 폴더)

| 항목 | 결과 |
| --- | --- |
| 스캔 | 427파일 등록 (본문 추출 231 + 메타 196), 최초 307초 → 재스캔 0.2초 (mtime+size 불변 시 재해시 생략 최적화) |
| 위키 인덱싱 | **427/427 성공, 실패 0, 총 417초 (파일당 0.98초)** — 구 GraphRAG 기록(파일당 2,211초) 대비 압도적 개선 |
| .hwp 파싱 | kordoc 경유 170개 .hwp 정상 (제목·조항 구조 보존 마크다운) — kordoc 패키지가 의존성에 누락되어 있던 것을 발견·수정 |
| FTS5 검색 | '안전관리등급제', '청년창업', 'AI혁신 아이디어', '예산편성', '프롬프트' 전부 정확 매칭 (hwp/hwpx/pdf/pptx/txt/xlsx 혼합) |
| 근거 답변(ask) | 발췌(extractive) 모드로 인용(원본 경로+발췌) 포함 답변 확인. LLM 설정 시 합성 모드, 실패 시 자동 폴백 |
| 채팅 통합 | 업무대화 턴에 `[지식폴더 근거]` 5건 주입 확인 (`graphrag_used: true`). 키워드 하이재킹(근거/출처/자료 → 템플릿 답변) 제거 |
| 위키 산출물 | `knowledge-wiki/` 에 index.md(문서별 키워드+원본 경로), 문서 카드 421개, extracted 마크다운, log.md |
| UI 검증 | dev 모드(5174)에서 지식폴더 4탭(대시보드/색인/검색/위키), 검색 결과+품질 배지, 위키 뷰어, 문서작성 분할 워크스페이스 실동작 확인 |

## 3. 테스트/빌드

- sidecar: **231 passed** (지식위키 17종 신규 + 문서작성 파이프라인 25종 신규 포함, 레거시 graphrag 테스트는 새 계약으로 이식/정리)
- desktop: **76 passed** (73→76, 지식폴더/문서작성 계약 테스트 재작성)
- desktop build (tsc+vite): green

## 4. 주요 변경 파일

- 신규: `services/sidecar/src/gongmu_sidecar/knowledge_wiki.py` (~1,300줄), `document_authoring.py` (~1,200줄), `apps/desktop/public/icons/action/` (SVG 50종)
- 수정: `app.py`(지식 엔드포인트 재배선·채팅 근거 블록·authoring 라우트), `db.py`(FTS5), `knowledge.py`(_is_excluded 버그 수정·재스캔 최적화), `settings.py`, `apps/desktop/src/app.tsx`(문서작성·지식폴더 재구축+픽토그램 스윕), `api.ts`, `styles.css`, `package.json`(kordoc 의존성)
- 버그 수정: ① `_is_excluded`가 루트 상위 점 폴더까지 검사해 스캔 0건이 되는 문제 ② 발췌에 YAML front matter 누출 ③ authoring 라우트 재등록 시 스텁 미적용

## 5. 남은 운영 항목

- **LLM 합성/보강 실검증**: 이 dev 환경에는 로컬 LLM(Ollama)이 미기동이라 ask LLM 합성·enrich(위키 요약 보강)·문서작성 구조 생성의 실 LLM 경로는 스텁 테스트로만 검증됨. 실제 PC에서 Ollama 기동 후 확인 필요.
- 폐쇄망 패키징: kordoc(node_modules)을 오프라인 번들에 포함하는 절차를 release 파이프라인에 반영해야 함 (kordoc_runner.js는 이미 PyInstaller 수집 대상).
- 셸 폴링(health/settings 등 10요청 ×5초)은 기존 동작 유지 — 추후 간격/조건 최적화 후보.
- 레거시 모듈(graphrag_ingestion/backends, ontology, embeddings, chunks/graph 테이블)은 파일·데이터 보존 상태로 언와이어됨 — 다음 릴리스에서 제거 판단.
