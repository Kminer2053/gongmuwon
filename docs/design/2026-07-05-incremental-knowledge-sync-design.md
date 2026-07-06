# 지식폴더 증분관리(증분 색인·위키 동기화) 설계 검토서

- 작성: 2026-07-05
- 방법: 코드 정밀 매핑 4방향(색인 파이프라인 / 위키 산출물 / 분류체계·태그 큐 / UI·참조 무결성) → 렌즈별 설계 3안 → 코드 사실 기반 적대적 검증 3회. 검증에서 기각된 항목은 본서에 반영·수정됨(§8에 기각 목록 명시).
- 상태: **설계 확정 전 검토안** — 구현 착수 전 사용자 확인 필요 항목은 §9.

---

## 1. 결론 요약

**증분 색인의 골격은 이미 있다.** 스캔은 `(경로, size, mtime)` 일치 시 스킵하고, 색인(인제스트)은 `file_hash + ingestion_signature` 일치 시 스킵한다. "색인 시작" 버튼은 이미 증분이고, "강제 재색인"만 전량이다. 삭제도 "색인 시작" 1회로 반영된다(스캔 선행 + purge).

**그러나 "변경이 지식체계에 올바르게 전파되는가"에는 구멍이 많다.** 핵심 공백 6개:

1. **신규 파일 무태그 사각지대** — 분류체계 확정 후 새 파일은 색인돼도 태그가 빈 문자열로 남아 업무 허브에도, 분류 대기 큐에도 안 보인다. 태깅은 수동 "적용" 재실행뿐이고, 재실행하면 **사용자가 큐에서 확정한 결과가 휘발**된다.
2. **이동/이름변경 = 삭제+신규** — 태그·검토 이력·LLM 요약이 전부 소실되고 kordoc 파싱 전액 재비용.
3. **수정 파일의 낡은 요약 영구화** — 내용이 바뀌어도 `enriched=1`과 구버전 LLM 요약이 승계되어 재보강 대상에서도 빠진다. 또 enrich가 FTS를 갱신하지 않아 LLM 요약이 전문검색에 반영되지 않는다.
4. **패밀리 대표 교체 미자동** — 새 버전 파일이 와도 "적용" 수동 재실행 전까지 구 대표와 신 문서가 병렬 노출.
5. **고아·연쇄 결손** — 구해시 extracted/knowledge_raw 파일 무한 축적, 동일 내용 사본 1개 삭제 시 공유 카드 실종(강제 재색인 전까지 복구 불가), 삭제된 문서의 pending 큐 잔존, topics/허브의 죽은 링크.
6. **Windows 운영 취약점** — `~$*.hwp` 잠금 파일이 색인에 유입, 열려 있는 파일(공유 위반)이 "삭제됨"으로 오판될 수 있는 구조, 파일 처리에 트랜잭션이 없어 중단 시 스킵 마커가 먼저 기록돼 **영구 stale** 발생 가능, queued 색인 잡 방치 시 전 소스 색인이 무기한 409 차단.

**권고 방향: 파일 워처를 도입하지 않는다.** 폐쇄망 단일 사용자 데스크톱에서 파일을 바꾸는 주체는 사용자 자신이다. ①P0 위생 수리 → ②"변경 확인" 버튼(diff 견적 + 증분 실행) → ③색인 파이프라인에 태깅·패밀리·보강의 증분 의미론 편입 → ④검증(무결성 점검) 잡, 순으로 도입한다. 앱 시작 시 자동 diff는 그 다음 단계(옵트인), 워처는 기본 미도입.

---

## 2. 현재 동작 — 코드로 확인된 사실

### 2.1 변경 시나리오별 현재 처리

| 시나리오 | 감지 | 색인 반영 | 위키/태그 반영 | 판정 |
|---|---|---|---|---|
| **추가** | 스캔 시 신규 행 | 인제스트에서 카드·FTS 생성 | **무태그('')** — 허브·큐 모두 불가시. enrich 실행해야 요약 | ◑ 사각지대 |
| **수정(내용)** | size/mtime 변경 → 해시 확정 | in-place 갱신(중복 없음). 단 구해시 extracted/.txt 고아 축적 | 태그는 보존(옳음). **요약은 구버전 승계 + enriched=1이라 재보강 제외** | ◑ 요약 stale |
| **수정(size+mtime 보존)** | **영구 미감지** (해시는 스킵 판정에 미사용) | — | — | ✕ |
| **삭제** | 스캔 시 deleted 마킹 | 다음 인제스트에서 purge(카드·FTS·행) | topics/work-areas/work의 죽은 링크는 각자 다른 트리거까지 잔존. **동일 해시 사본 1개 삭제 시 공유 카드 실종** | ◑ |
| **이동/이름변경** | 감지 없음 → 삭제+신규 | kordoc 포함 전액 재파싱 | **태그·resolve 이력·요약 전부 소실** | ✕ |
| **새 상위 폴더(업무영역) 등장** | 감지 없음 | 색인은 됨 | apply 재실행해도 전부 low 큐 유입. 드리프트 알림 없음 | ✕ |
| **대화 인용/문서작성 참조** | citations = {title, file_path, snippet}만 — 원본 이동·삭제 시 조용히 깨짐(존재 검증·카드 폴백 없음) | | | ◑ |

### 2.2 근거 코드 (주요 지점)

- 스캔 스킵: `_find_unchanged_source_file` — size + mtime **ISO 문자열** 완전일치 ([knowledge.py:446](services/sidecar/src/gongmu_sidecar/knowledge.py:446)); 해시-stat 재호출 레이스(:461-463)
- 인제스트 스킵: `_source_files_for_ingestion` — `file_hash + 'wiki-fts5-v1'` ([knowledge_wiki.py:692](services/sidecar/src/gongmu_sidecar/knowledge_wiki.py:692))
- 삭제 purge: `_purge_deleted_source_documents`(:583) — 인제스트 시작 시에만; sections/tables/chunks 정리는 이미 수행됨
- 신규 문서 무태그: 신규 wiki doc INSERT의 row에 태그 컬럼 부재(:547); 태깅 유일 경로는 `apply_taxonomy` ([work_taxonomy.py:713](services/sidecar/src/gongmu_sidecar/work_taxonomy.py:713))
- resolve 휘발: apply 시작 시 pending 큐 전삭제(:736-739) + 규칙 재판정이 사용자 확정을 덮음
- enrich: `enriched=0`만 대상, **FTS 미갱신** (:1223, :1271-1283)
- 슬러그: `wiki_slugify(title, file_hash)` — 동일 내용 사본이 카드 1장 공유(:74); title은 **파싱 산출물**(첫 헤딩)이라 파일명과 다를 수 있음
- 트랜잭션 부재: `db.execute()`는 autocommit — 파일 처리 중단 시 스킵 마커(`_upsert_document`가 첫 단계)만 남아 재실행 시 '완료'로 오판
- 전역 409: `ensure_no_active_knowledge_ingestion` ([app.py:2820](services/sidecar/src/gongmu_sidecar/app.py:2820)); `knowledge_ingestion_jobs`에는 TTL 없음
- lint 존재하나 API 미노출(:1587) — orphan은 fix, missing_cards는 보고만; 기본 동작이 전 문서 재해시
- `_is_excluded`는 dot-prefix만 제외(:437-444) — `~$*.hwp` 통과; OSError 파일은 seen에서 빠져 deleted 오판 가능(:144-147)

---

## 3. 설계 원칙 (계약)

1. **SQLite가 단일 원천, 위키 md는 파생물.** 예외 2개만: 카드 하단 "사용자 메모" 마커 구역(사용자 소유), `work/*.md`(세션 스냅샷 — 색인이 건드리지 않음). 이 계약이 "불일치 시 DB에서 재투영" 자동 치유의 정당성 근거다.
2. **결정적 처리 우선, LLM은 보강용.** 증분 경로의 태깅·패밀리·이동감지·GC는 전부 규칙(LLM 0회). LLM은 enrich 1곳, 변경분만, 실행당 상한.
3. **고확신 자동 + 저확신 검토 큐.** 태깅 high/medium 자동, low는 큐. 파싱 비용이 드는 수리는 견적 보고 후 사용자 확인.
4. **부분 patch 금지 — 증분의 단위는 "어느 페이지를 다시 쓰나".** 선택된 파생물은 항상 DB에서 전량 재생성(멱등·자기수복). index.md는 매번 전량(수십 ms), 허브·topics는 dirty-set만.
5. **모호하면 안전한 폴백.** 이동 매칭이 1:1이 아니면 현행(삭제+신규)으로 폴백. 오매칭보다 재파싱이 싸다.

---

## 4. 변경 감지·실행 모델

### 4.1 감지 방식: 수동 "변경 확인" → 앱 시작 diff(옵트인) → 워처 미도입

| 방식 | 채택 | 근거 |
|---|---|---|
| 수동 "변경 확인" 버튼 (diff 견적 + 증분 실행) | **v1 (권장 종착점)** | 파일을 바꾸는 주체가 사용자 자신 — "내가 바꿨으니 확인 누른다" 모델로 충분 |
| 앱 시작 시 자동 diff (기동 후 유휴 10초, stat만) | v2 — 배지·알림까지 자동, 색인 자동 실행은 저비용 확정분만 옵트인 | 앱 꺼진 사이 변경이 주 시나리오. stat-only diff는 427파일 기준 1~2초 |
| 주기 폴링 (15분) | v2 옵션 (기본 off) | 켜진 동안의 변경 보완. 공유 위반 방어(§7) 선행 필수 |
| OS 파일 워처(watchdog) | **미도입** | 앱 꺼진 동안은 어차피 못 봄 → 시작 diff가 필수라면 같은 코드의 주기 실행이 워처+디바운서+overflow 복구보다 압도적으로 단순. 도입해도 "dirty 플래그→디바운스→diff 트리거" 신호로만 |

### 4.2 Diff 알고리즘 (2-pass 스테이징 — 현행 즉시-INSERT 구조 개편 필요)

> 검증 지적: 현행 스캔은 워크 중 신규 경로를 즉시 INSERT하므로, 이동 판정을 넣으려면 "판정은 메모리, 반영은 판정 후" 2-pass로 재구성해야 한다. 볼트온이 아니라 스캔 구조 변경임을 인지하고 착수할 것.

```
[0] 제외 필터 선적용: ~$*, *.tmp, .~lock*, 숨김/시스템 속성 (P0 — §7)
[1] 소스의 비삭제 행 전체를 1회 로드 → 경로(casefold 정규화) → row 딕셔너리
[2] rglob 워크: 파일별 stat (반영 없이 판정만 수집)
    - mtime이 now-10초 이내 or stat/open 실패 → UNSTABLE (seen에는 포함, 처리만 보류)
    - row 없음 → ADDED 후보
    - size==, mtime_ns== → UNCHANGED
    - 그 외 → 해시 계산(stat-해시-stat 샌드위치; 불일치 시 UNSTABLE)
        → 해시 동일: TOUCHED (메타만 UPDATE) / 해시 상이: MODIFIED
[3] DB에 있는데 seen에 없음 → DELETED 후보
[4] 이동 판정: ADDED 후보의 해시(어차피 신규는 해시 필수 — 추가 I/O 0)를
    DELETED 후보의 (size, file_hash)와 대조
    - 정확히 1:1 → MOVED (rebind, §4.3)
    - 그 외(0개, 사본 다수) → ADDED+DELETED 폴백 (현행과 동일 — 안전 우선)
[5] 잔여 DELETED → status='deleted' 마킹 (현행 유지)
[6] 결과 요약 반환: {added, modified, deleted, moved, touched, unstable,
                     rehash_estimate: {files, bytes}}
```

- **mtime 비교를 ISO 문자열에서 `mtime_ns` 정수로 이행.** 첫 릴리스는 기록만 하고 비교는 문자열 유지(과도기 오탐 방지), 다음 릴리스에서 전환.
- **견적 게이트**: 재해시 대상이 500MB 또는 100파일 초과 시 자동 진행하지 않고 "변경 X건 / 전체 Y건 — 예상 소요 Z" 확인. USB 폴더 통째 교체(전 파일 mtime 변동)의 방어이기도 하다 — 해시가 같으면 발췌 재추출까지 스킵하고 메타만 갱신하므로 실비용은 순차 읽기 수 분으로 상한.
- **알려진 한계(수용)**: size+mtime 완전 보존 변경은 미감지. 탈출구는 "무결성 점검(심층)"(§6)과 강제 재색인 2개뿐임을 설정 화면에 명시.

### 4.3 이동 rebind — 전체 전파 스펙 (검증 반영: "file_path만 UPDATE"는 불충분)

행 id 보존으로 태그·resolve 이력·enriched 요약을 승계하고 kordoc 재파싱을 0회로 만드는 것이 목적. 단, 경로가 비정규화되어 7곳에 사본이 있으므로 **전부 전파**해야 한다:

1. `knowledge_source_files.file_path` UPDATE (id 보존)
2. `knowledge_documents.file_path` UPDATE
3. `knowledge_wiki_docs.source_path` / `relative_path` UPDATE — **미갱신 시 lint fix가 rebind 문서를 orphan으로 오판해 하드삭제**하고, 태깅·가족 키(`rel.parent`)가 옛 폴더 기준으로 재판정되는 자기모순 발생
4. 카드 재투영 (front matter source_path + 본문 "원본 경로" 줄 — DB에서 `_card_markdown` 재작성, 파싱 불필요)
5. FTS delete+insert (card 컬럼에 카드 전문이 들어가므로)
6. 부모 폴더가 바뀌었으면 family 국소 재평가(§5.3) + work_area 재판정(단 `tag_locked` 문서는 태그 보존, "분류 재확인 권장" 배지)
7. 실행기록 1줄: `파일 이동 감지: <구경로> → <신경로> (재파싱 생략)`

한계 명시: 파일명 변경(rename)은 재파싱을 생략하므로 stem 폴백 title 문서(txt/pdf/파싱실패 hwp)의 카드 제목이 옛 파일명으로 남는다 → rebind 시 title이 stem 유래인 문서는 title·슬러그도 새 stem으로 갱신(파싱 없이 가능). 히스토리 스냅샷(citations_json, work/*.md의 경로 표기)은 **의도적으로 갱신하지 않는다**(시점 기록이 맞음 — §5.5의 폴백으로 보완).

---

## 5. 위키·태깅·패밀리·보강의 증분 의미론

### 5.1 신규/변경 파일 자동 태깅 (사각지대 폐쇄)

- `_ingest_source_file`에서 확정 taxonomy가 있을 때, 신규 문서(및 MODIFIED로 재판정 필요 문서)에 `_match_work_area` + doc_role 패턴 판정을 실행. **high/medium 자동 적용, low는 큐 적재**(candidates 포함, `wiki_doc_id` 기록).
- 구현 주의(검증 지적): `_match_work_area`는 WorkTaxonomyManager 소속이고 work_taxonomy→knowledge_wiki 단방향 의존이므로, 함수를 공용 모듈로 이동하거나 주입해서 **단일 구현**을 유지할 것(경로별 태그 불일치 회귀 방지). 참고서고 폴더(□참고□ 등 `is_reference_shelf`)는 태깅·드리프트 판정에서 제외.
- 수정 문서가 재판정에서 low로 떨어지는 경우도 큐 적재 대상에 포함(현 설계 공백이었음).

### 5.2 사용자 확정 보존 — `tag_locked`

- `knowledge_wiki_docs.tag_locked`(0/1) 신설. `resolve_queue_item`이 1로 설정.
- **lock 범위는 work_area_slug/doc_role에 한정** — family_id/family_role은 lock과 무관하게 재평가에 항상 참여(버전 체인 붕괴 방지; 검증 지적 반영).
- apply 전량 재실행과 증분 태깅 모두 locked 문서를 재판정·큐 재적재에서 제외. resolve 시 slug가 확정 taxonomy에 존재하는지 검증(유령 태그 차단). taxonomy 재확정 시 locked 문서의 slug 유효성 재검증(무효면 lock 해제 + 큐 재적재).
- apply의 pending 큐 처리: 시작 시 전삭제 대신 **run_id 기반 적재 후 정상 완료 시에만 구 run 삭제** — 취소 시 "미태깅인데 큐에도 없음" 부분 상태 방지.

### 5.3 패밀리 국소 재평가 (대표 교체 자동화)

family key(정규화 stem + 부모폴더)와 정렬키(final > vN > mtime > 날짜)가 결정적이므로 색인 시점에 그룹 단위 계산이 배치와 동일 결과를 보장한다:

- 신규/수정/이동 문서 색인 시: 해당 family key 그룹만 SELECT → official/latest/previous 재배정 → 배정이 바뀐 형제 카드만 front matter patch → dirty 허브 재작성.
- **삭제 시에도 실행**(검증 지적 반영): 대표 삭제 시 생존 형제 승격, 그룹이 1건이 되면 family 해제. 없으면 가족 전체가 허브에서 증발한다.
- 대표 교체 시 실행기록 1줄: `문서 패밀리 대표 교체: <stem> — <구 대표> → <신 대표>`.
- apply_taxonomy는 "전량 배치 + 품질 리포트" 용도로 존치(멱등이라 공존 안전).

### 5.4 LLM 요약 보강(enrich)의 증분화

- 내용 변경(MODIFIED) 시 `enriched=0` 리셋 + 기존 요약은 유지하되 `summary_stale=1` 표기(UI 배지로 정직하게 노출 — 즉시 재호출보다 낫다).
- enrich 완료 시 `_upsert_fts` 호출 추가(요약의 전문검색 반영).
- **실행당 상한 N건(기본 20~30, 설정값)** + **실패 백오프**: 실패 카운트 저장, 3회 실패 문서는 `enrich_skip=1` 마킹 후 대상 제외(검증 지적 — 실패 문서가 매 실행 상한을 선점해 신규 보강이 굶는 것 방지). 대시보드에 "요약 대기 N건" 카운터.
- enrich의 regex 부분수정(`_rewrite_enriched_card`)은 "DB 기준 전체 재투영 + 사용자 메모 이어붙임"으로 교체(오삽입 제거).

### 5.5 삭제 — 2단 소프트 삭제 + 인용 폴백

- **검색·index·허브는 즉시 제거, 카드는 유예 보관**: purge 시 카드 unlink 대신 front matter `status: missing` + 상단 배너(`> ⚠ 원본이 삭제되었거나 이동됨 (감지: 날짜)`). 30일(설정값) 경과 또는 사용자 수동 정리 시 하드 제거.
- **missing 필터를 모든 읽기 경로에 적용**(검증 지적): FTS뿐 아니라 `_like_search`, `retrieve`, `_cited_wiki_docs`, graph_summary/query — 하나라도 빠지면 유령 문서 잔존.
- missing 전환 시 해당 문서의 pending 큐 항목도 숨김 처리(부활 시 복원).
- **citations에 `doc_uid` 추가**(§5.6): 채팅 인용 칩 "원본 열기"는 존재 확인 → 부재 시 위키 카드로 폴백 + 안내 토스트. 문서작성 참고자료의 경로 정확일치 조인도 실패 시 "원본 없음" 상태를 가시화(조용한 실패 금지). 기존 3필드 인용과 하위호환(doc_uid 없으면 현행 동작).

### 5.6 카드 정체성 — doc_uid (슬러그 안정화, 한계 명시)

- `knowledge_wiki_docs.doc_uid`(최초 색인 시 발급, 불변 8자) 신설. 슬러그 = `slugify(title) + doc_uid` — 내용 수정 시 같은 카드에 덮어쓰기, 문서:카드 1:1 보장(동일 해시 사본의 공유 카드·삭제 연쇄 결손 소멸), 해시 부재 시 uuid 비결정 슬러그 문제 소멸.
- **한계 정직 명시**(검증 지적): title은 파싱 산출물(첫 헤딩)이라 본문 첫 헤딩 수정 시 슬러그는 여전히 바뀐다(doc_uid로 DB 추적성은 유지, 구 카드 unlink는 현행 로직). 완전한 링크 안정성이 목표가 아니라 "내용 수정≠카드 교체"가 목표.
- **UX 회귀 방지**(검증 지적): 1:1화로 동일 내용 사본이 트리·index에 중복 노출된다 — 기존 slug dedupe 의도를 계승해 **동일 file_hash 그룹은 index/tree에서 대표 1건 + "사본 N개" 접힘**으로 표시.
- **마이그레이션은 signature bump 금지**: `ingestion_signature`를 올리면 427파일 전량 kordoc 재파싱(수십 분). 대신 1회 마이그레이션 잡이 **DB에서 카드만 재투영**(`_card_markdown` 재작성 — 파싱 0회, 수 초)하며 doc_uid 발급·카드 개명.

### 5.7 사용자 수동 편집 보존

- 카드 상단 주석으로 계약 명시: `<!-- 이 문서는 자동 생성됩니다. '## 내 메모' 아래만 직접 편집하세요 -->`.
- 카드 말미 `<!-- gongmu:user-notes -->` 마커 구역 상설 — 모든 재작성 경로(인제스트·enrich·taxonomy patch)가 추출 후 재삽입(결정적).
- 기계 영역 편집 감지: 시스템이 쓴 카드의 해시를 `card_hash`에 저장(CRLF/공백 정규화 후 계산 — 작성기·감지기 규칙 공유), 재작성 전 불일치 시 `docs/.backup/<slug>-<ts>.md` 백업(파일당 최근 3개 순환) + 실행기록 1줄. 자동 병합은 하지 않는다.
- `patch_card_front_matter` OSError 무시 → `card_dirty=1` 마킹 후 다음 잡에서 재시도(조용한 DB↔카드 불일치 제거).

### 5.8 파생물 재생성 경계

| 산출물 | 전략 |
|---|---|
| index.md | 매 잡 전량 재생성 유지(수십 ms, 자기수복) |
| work-areas/*.md | dirty-set만 재작성(잡 중 태그·family·삭제 변경분). apply는 현행 전량+stale unlink |
| topics/*.md | dirty-set 재작성을 인제스트에도 편입 + 문서 0건 topic 파일 unlink |
| work/*.md | 현행 유지(세션 재반영 시에만) |
| log.md | append-only + 1MB 초과 시 `log-YYYYMM.md` 롤오버 |
| SCHEMA.md | write-only 유지. 다중 소스 시 `SCHEMA-<source>.md` 분리는 별도 과제(현재 상호 덮어쓰기 결함 존재) |
| extracted / knowledge_raw | 잡 말미 GC: 파일명 집합 − 현행 해시 집합 = 고아 삭제. **해시 부재로 `<document_id>.md`로 저장된 파일은 GC에서 제외**(오판 방지). unlink 전 refcount(동일 해시 생존 행) 확인 — `_delete_wiki_doc`와 **슬러그 변경 시 구 카드 unlink 두 지점 모두** |

### 5.9 분류체계 드리프트 — 제안만, 자동 재구성 금지

- 감지 시점: 스캔 완료 시 + apply 완료 시(이미 도는 코드에 편승). 확정 `taxonomy_json.folders` vs 현재 1단계 폴더 diff. **참고서고(□참고□류) 폴더 제외**(영구 오탐 방지).
- 판정(결정적): 신규 1단계 폴더 파일 ≥5 / 최근 색인분 low 유입률 ≥30% / 확정 폴더의 파일 0건화.
- 동작: `drift_json` 저장 + 지식폴더 화면 "분류체계 재정비 제안" 배지 → 클릭 시 마법사 재진입(기존 확정본 + 신규 폴더 후보 프리필). 확정 전까지 기존 체계로 동작(신규 폴더 파일은 low 큐 유입 — 유실 없음).

---

## 6. 무결성 점검(verify) 잡 — lint 확장·API 노출

`POST /api/knowledge/verify` (work_job, 색인과 동일 리소스 키로 상호 배제). **quick 모드 신설이 전제** — 현행 lint는 기본이 전 문서 재해시이므로, 재해시는 심층 모드로 분리해야 한다(검증 지적).

| 검사 | 판정 | 치유 |
|---|---|---|
| 원본 부재 행 | orphan | 자동: deleted 마킹+purge — **치유 스펙을 purge 수준으로 명시**(현행 lint fix는 documents/sections 행을 남김) |
| 카드 실종(공유 unlink 사고 포함) | missing_card | 자동: DB에서 카드 재투영(파싱 0회) — 현행 "보고만"에서 승격 |
| extracted 실종 | missing_extracted | 확인 후: kordoc 비용 견적 보고 → 승인 시 해당 파일만 재인제스트 |
| 고아 extracted/knowledge_raw | orphan_artifact | 자동 삭제(회수량 보고) |
| FTS↔doc 불일치 | fts_drift | 자동 재동기화 |
| 고아 pending 큐 | orphan_queue | 자동 삭제 |
| stale 해시(스캔만 하고 색인 안 함) | stale_index | 보고 + "색인 시작" 버튼 |
| 무태그 문서(큐에도 없음) | untagged | 보고 + "분류 적용" 버튼 |
| 문서 0건 topic 파일 | orphan_topic | 자동 삭제 |
| DB↔카드 front matter 불일치 | fm_drift | 자동 재patch |
| **심층(옵션)**: 전량 재해시 대조 | silent_change | 견적 게이트 후 변경분 재인제스트 — size+mtime 보존 변경의 유일한 탈출구 |

- 리포트: DB 1행 + JSONL 상세. 실행기록 한국어 1건("불일치 7건 중 5건 자동 수리, 2건 확인 필요"). 0건이어도 기록(대시보드 "마지막 검증 N일 전, 이상 없음").
- 신규 상태 5종(missing / tag_locked / card_dirty / summary_stale / enrich_skip)의 **불변식을 verify 검사에 포함**해야 자기수복 주장이 성립한다.
- 마이그레이션 직후 첫 verify는 보수 모드(치유 전 무조건 백업) — card_hash 백필 이전의 사용자 편집 보호.

---

## 7. Windows 필수 방어 (P0 — 다른 모든 것에 선행)

검증 3회가 공통으로 지적한, **증분 도입 전 반드시 고쳐야 하는** 항목:

1. **`~$*` / `*.tmp` / `.~lock*` 제외 필터** — 현행 `_is_excluded`는 dot-prefix만 거른다. `~$문서.hwp`가 스캔·해시·kordoc(실패→쓰레기 카드)까지 유입되고, 편집 세션마다 ADDED→DELETED churn을 만든다.
2. **읽기 실패 = UNSTABLE, DELETED 아님** — 현행은 OSError 파일이 seen에서 빠져 deleted로 마킹된다. 한글/Excel이 잠근 파일이 "삭제됨"→purge로 이어지면 태그·요약이 파괴된다(주기 폴링 도입 시 발생 빈도 급증). stat/open 실패와 mtime 10초 이내 파일은 **seen에는 포함하되 처리만 보류**.
3. **파일 단위 트랜잭션 + 스킵 마커 후기록** — 현행은 autocommit이고 스킵 마커(`_upsert_document`)가 파일 처리의 첫 단계라, 중단 시 재실행이 그 파일을 '완료'로 오판해 영구 stale. 파일 처리 전체를 트랜잭션으로 묶고 마커 갱신을 마지막에. 이것 없이는 "중단 후 재실행 = 자동 재개" 주장이 성립하지 않는다.
4. **stat-해시-stat 샌드위치 + 발췌 읽기 포함** — 해시-메타 불일치 레코드 저장 방지. 발췌 read_text까지 샌드위치 범위에 포함해야 "v2 내용이 v1 해시 이름으로 저장"되는 오염을 막는다. 신규 파일(복사 중 스캔)에도 적용.
5. **`knowledge_ingestion_jobs` TTL 30분** — queued 방치 잡 1건이 전 소스 색인을 무기한 409 차단하는 현행 공백. 전역 409의 소스 단위 축소는 **보류**(index.md/topics가 소스 횡단 산출물이라 동시 쓰기 경합 — finalize 직렬화 설계가 선행돼야 함. 1차는 동시 실행 1개 유지).
6. **경로 casefold 정규화** — 대소문자만 다른 rename이 행 2개(카드·extracted 공유, refcount 왜곡)를 만들지 않도록 비교 시 정규화.
7. **kordoc 연속 실패 상한**(잡당 10건) — 폭주 파서의 무한 소모 방지. 시계 역행 대비 "미래 created_at이면 즉시 stale" TTL 절.

---

## 8. 검증에서 기각·수정된 항목 (투명성 기록)

- ~~"knowledge_document_chunks 미정리 공백"~~ → purge 경로는 이미 chunks까지 삭제(수정 시 잔존 건만 유효한 지적).
- ~~"스캔 응답에 deleted_count 추가"~~ → 이미 구현됨. 신규분은 프론트 배지뿐.
- ~~"삭제 반영 2단계 지연 제거"~~ → "색인 시작"은 이미 스캔 선행+purge로 1클릭 동기화됨. 공백은 단독 스캔·무조치 방치·staleness 경고 부재.
- ~~"rebind는 file_path만 UPDATE"~~ → 비정규화 경로 7곳 전파 필수(§4.3). 스캔 2-pass 개편 동반.
- ~~"파일 단위 커밋이라 재개 로직 불필요"~~ → 트랜잭션 부재 + 마커 선기록으로 현행은 영구 stale 가능(§7-3).
- ~~"doc_uid로 카드 링크 안정성 확보"~~ → title이 파싱 산출물이라 부분 보장(§5.6에 한계 명시).
- ~~"verify에 심층 재해시 모드 추가"~~ → lint 기본이 이미 전량 재해시 — quick 모드 분리가 실제 변경.
- 15분 주기 폴링 기본 on → **기본 off로 하향** (공유 위반·임시파일 방어 P0가 선행돼야 안전).

---

## 9. 도입 로드맵과 열린 결정

### 로드맵

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **P0 위생 수리** | §7 전체 + enrich FTS 반영 + enriched 리셋 + refcount unlink(2지점) + 고아 GC + 고아 큐 정리 + lint API 노출(quick) | 사이드카 테스트 그린; 잠긴 파일이 deleted로 마킹되지 않음을 테스트로 고정 |
| **P1 "변경 확인" v1** | diff 엔드포인트(2-pass) + 견적 게이트 UI + rebind 전체 스펙 | 1파일 수정 → 확인→실행 10초 내(kordoc 1회); USB 교체 시 재파싱 0회; 이동 시 태그·요약 승계 |
| **P2 증분 의미론** | 색인 내 자동 태깅 + tag_locked + 패밀리 국소 재평가(삭제 포함) + 소프트 삭제 + citations doc_uid + doc_uid 슬러그(무파싱 마이그레이션) + 사용자 메모 구역 | 새 버전 파일 1개 추가 → 색인만으로 대표 교체·허브 갱신; resolve가 재apply에 생존 |
| **P3 운영 도구** | verify 잡 완성 + 대시보드 상태 카드(최신성/분류 공백/정합성) + 드리프트 제안 배지 + v2 앱 시작 diff(옵트인) | verify가 결손 시나리오를 자동 수리; 대시보드에서 "미반영 변경 N건" 확인 가능 |

W5-C가 재편 중인 [대시보드][위키][설정] 구조와 정합: 상태 카드·"변경 확인"·"무결성 점검"은 **설정 탭의 색인 그룹 + 대시보드 상태 카드**로 배치.

### 열린 결정 — **2026-07-05 사용자 승인 완료 (전건 제안값 채택)**

1. 소프트 삭제 카드 보관 기간: **30일** ✔
2. v2 앱 시작 자동 diff 기본값: **감지·배지 자동 on, 색인 자동 실행 off** ✔
3. enrich 실행당 LLM 상한: **20건** ✔
4. doc_uid 슬러그 전환: **P2에 포함** (무파싱 마이그레이션 잡 방식) ✔

→ P0~P3 로드맵 구현 착수 가능 상태. 후속 웨이브에 편성한다.
