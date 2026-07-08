# 공무원 리뷰 버그 개선 계획 (2026-07-08)

원클릭 설치본 실사용 리뷰(스레드 반응 후 테스트) `공무원 리뷰.zip`(리뷰 txt + 스샷 9)의 지적사항을 근본원인 조사(7개 클러스터, 코드 근거 확정) 후 정리한 개선 계획.

## 관통 원칙

거의 모든 품질 문제가 **"이미 좋은 코드가 있는데 약한 경로/렌더가 그걸 우회한다"** 는 구조다. 수정 방향은 전부 **코드-가이드 결정적 방식**(경량 gemma-4 E2B에 산출 위임 금지, 규격을 코드가 가이드). 참고 메모리: `lightweight-model-assist-assets`.

## 지적사항 → 계획 매핑 (전수)

| 원 지적 | 계획 | 우선순위 |
|---|---|---|
| (업무대화) 응답맥락 초기화 버튼 | ⑥ chat-ux | P1 |
| (업무대화) 무관 문서 언급(검색오류) | ③ chat-retrieval | P1 |
| (업무대화) 응답 파싱(숫자·동그라미) 가독성 | ④ chat-render | P1 |
| (업무대화) 문서작성 발화조건 확인 | ⑥ chat-ux | P1 |
| (업무대화) 문서작성 품질 엉망 + 내부코드 일치 + ax-playground 이상 + E2E 검증 | ① doc-authoring | **P0** |
| (문서작성) 내부 로직 ax-playground 동일 통일 | ① | **P0** |
| (문서작성) 업무대화 발화 시 동일 로직 | ① | **P0** |
| (지식폴더) 핵심문서 미리보기(포커스→모달/글박스) | ⑥ chat-ux | P1 |
| (지식폴더) 버전이력 기준 + 접힘 펼침 | ⑨ version | P2 |
| (지식폴더) 주제별 카드 vs 텍스트 불일치 | ⑤ wiki-render | P1 |
| (지식폴더) 주제별 백과사전(나무위키) 품질 | ⑤ wiki-render | P1 |
| (공통) 경량모델 → 코드-가이드 결정적 | 관통원칙(전 항목) | — |
| (스샷) 400 invalid wiki page path | ② wiki-404 | **P0** |
| (스샷) "도 사업계획" 정규화 버그 | ⑦ normalize | P1(즉효 S) |
| (스샷) 마법사 레이아웃/`□주요□` | ⑧ wizard-layout | P1 |

## 근본원인 & 수정안 (코드 근거)

### ① 문서작성 통일 (P0)
- 근본: 업무대화 스킬 `_run_document_create_skill`(app.py:1686)이 **LLM 미호출** → `documents.create_content_base`의 골격 마크다운(프롬프트 에코 documents.py:386/390, 리터럴 플레이스홀더 :406, "아직 연결된 파일이 없습니다" :469/357)을 구조마커 없이 그대로 `write_public_hwpx_document`(hwpx_writer.py:306) fallback 렌더 → 쓰레기. 전용 UI 경로 `document_authoring.py`(organize→format→schema→embed_structure_marker→결정적 렌더)는 고품질(docstring: ax-playground 패턴 이식 = canonical).
- 수정: `_run_document_create_skill`을 `document_authoring` 파이프라인으로 통일 — 대화 transcript를 `assemble_transcript_context`로 주입 + `run_authoring_stages`로 검증된 structure 획득 + `build_content_base_markdown`로 구조마커 심어 결정적 HWPX. 반환 dict 스키마(actions/results/text) 유지.

### ② 400 위키 링크 (P0)
- 근본: 허브 문서 링크가 `../docs/{slug}.md` 상대경로(work_taxonomy.py:1199/1222/1236, knowledge_wiki.py:3013)인데 프론트가 verbatim 전달(KnowledgeScreen.tsx:2337), 백엔드 `read_page`(knowledge_wiki.py:3937)가 wiki_root 기준으로만 join+startswith 가드 → `..` 이탈 → PermissionError → 400(app.py:3696). 상위 index.md 링크는 `..` 없어 동작 → 간헐적으로 보임.
- 수정: 프론트에서 **현재 열린 페이지 디렉터리 기준으로 링크 resolve**(작은 순수함수) 후 fetch. 백엔드 가드를 `Path.is_relative_to`로 강화.

### ⑦ "도" 정규화 (P1, S)
- 근본: `normalize_folder_name`의 연도 제거 정규식 `(19|20)\d{2}년?`(taxonomy_rules.py:146)가 "2026년도 사업계획"에서 "2026년"만 지우고 **"도" 잔존** → "도 사업계획".
- 수정: 정규식이 "년도"까지 소거(`(19|20)\d{2}\s*년도?` 등). folders 원문은 매칭키로 보존, 표시명만 정규화.

### ③ 문서검색 관련성 (P1)
- 근본: 질의 정규화 없음(app.py:2009가 payload.text 전체 전달), `_tokenize`(knowledge_wiki.py:88)가 "AI로컬동행관련"을 통짜 토큰 → trigram 통짜 매칭 실패(옳은 문서 미스). OR 결합(2582)+관련성 임계 부재(2569/2658/1207)로 일반어("문서") 하나 걸린 무관 문서가 authoritative 근거 주입. STOPWORDS(80) 질의 경로 미적용.
- 수정: 결정적 질의 정규화(명령어/조사 제거·한글↔ASCII 경계 분할·n-gram 후보) + `_fts_match_expression` 커버리지 요구 + bm25 필드가중 + 절대 임계(미달 시 근거 0건). `_score_source_file_hit`(knowledge.py:1147) 커버리지 게이트.

### ④ 마크다운 렌더 (P1)
- 근본: 손수 파서 markdown.tsx — (a) 번호 미보존(parseMarkdownListLine 81-89 digit 폐기)+빈줄에 목록 끊김(252-273) → 전부 "1.", (b) 전각/원문자 숫자 미정규화(140-147).
- 수정: 번호 보존(ol start/li value)+빈줄 넘어 목록 병합+전각/원문자 정규화. 회귀 테스트.

### ⑤ 위키 렌더 통일 + 주제 백과사전 (P1)
- 근본: 생성(py)·렌더(React) 별개 계약. `inferWikiPageKind`(KnowledgeScreen.tsx:370)가 work-areas/ 미인식→raw폴백(텍스트) vs topics/→카드 → 불일치. Obsidian `[[..]]` 링크(knowledge_wiki.py:2108/2415)를 파서 미인식. `_write_topic_pages`(2982) 골격 없음.
- 수정: front-matter page_kind + 섹션 role 마커 → 제네릭 SectionRenderer 단일 렌더. 링크 문법 표준화(`- [t](../topics/slug.md)`). 주제 페이지를 나무위키식 고정 골격(정의/핵심문서[역할별·가족대표]/타임라인/연관)으로 코드가 결정적 생성. 업무허브도 동일 렌더.

### ⑥ 맥락초기화·발화조건·미리보기 (P1)
- (1) 초기화: `work_sessions.context_summary_text` 롤링요약 리셋 API(POST .../context:reset) + "최근 응답 맥락"(ChatScreen.tsx:1219) 옆 버튼.
- (2) 발화조건: `_looks_like_document_create_request`(app.py:1509) 결정적 게이트 명확화(강마커 시행문/공문/hwpx는 동사 없이 인정) + 라벨 노출(app.py:1412) + 예시 팁.
- (3) 미리보기: 파싱본문 이미 DB(knowledge_wiki_docs.summary/norm_body, 카드 마크다운 fetchWikiPage 서빙). 위키 트리 문서행에 미리보기 버튼→기존 API 재사용→renderMarkdownContent 인플레이스 모달.

### ⑧ 마법사 레이아웃/마커 (P1)
- 근본: importance `□주요□` 마커가 표시라벨 노출 + 카드 CSS(체크박스 부유·제외버튼 잘림, KnowledgeScreen.tsx:1240-1256, knowledge-screen.css:296/306).
- 수정: 표시라벨만 마커 제거(folders 원문 보존) + CSS 정렬.

### ⑨ 버전이력 가족판정 + 펼침 (P2)
- 근본: `normalize_family_key`(taxonomy_rules.py:174)가 사본 `(1)`/번호 미정규화 → 가족 분리(개별문서화). `_write_hub`(work_taxonomy.py:1220) 접힌 이전버전이 **죽은 텍스트**("N건 접힘")라 클릭 무반응. wiki_tree는 해시 dedupe만.
- 수정: 사본/버전 마커 정규화로 가족 병합 + 이전버전을 실제 클릭 링크로 emit + 트리도 가족 병합.

## 구현 웨이브

- **W1 (P0)**: ① 문서작성 통일 · ② 400 위키 링크 · ⑦ "도" 정규식
- **W2 (대화품질)**: ③ 검색 관련성 · ④ 마크다운 렌더 · ⑥ 맥락초기화/발화조건
- **W3 (지식폴더)**: ⑤ 위키 렌더 통일+주제 백과사전 · ⑥ 핵심문서 미리보기 · ⑧ 마법사 레이아웃
- **W4 (폴리시)**: ⑨ 버전이력 가족판정+펼침 · 검색 성능(파일검색 O(N×IO) 완화)

## 검증 기준 (사용자 요청 반영)

각 웨이브:
1. **회귀 테스트**: 사이드카 pytest + 데스크톱 vitest 그린 유지, 신규 케이스 추가.
   - 문서작성: 산출 마크다운/HWPX에 플레이스홀더·프롬프트에코·"연결된 파일 없음" 부재.
   - 마크다운: 빈줄 사이 번호목록이 하나의 증가 ol, 전각/원문자 정규화.
   - 정규화: "2026년도 사업계획"→"사업계획", family 사본 병합.
   - 위키 링크: `../docs/x.md`가 열린 페이지 기준 정상 resolve.
2. **E2E (내가 직접, 실 gemma)**: 문서작성을 (a) 문서작성 UI, (b) 업무대화 발화 두 경로 모두에서 실행 → 산출 HWPX 품질·섹션위계(□◦-)·미리보기 일치 육안 확인. 검색·위키 렌더·미리보기도 실행 확인.
3. **빌드**: `npm --workspace apps/desktop run build` + `cargo check` 그린.

최종: 사이드카/데스크톱 전체 테스트 + 빌드 그린 + E2E 통과 후 커밋·푸시.
