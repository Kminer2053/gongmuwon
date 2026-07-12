# 주제 어휘집 팩 표준규격 (Topic Vocabulary Pack Spec) v1

목적: 주제 생성을 개방형 창작에서 **통제어휘 기반 선택**으로 전환해 파편화(싱글턴 89%)·중복(26묶음)을
원천 차단한다. 3층 구조 — **L1 공통(내장) · L2 기관팩(사용자 입력) · L3 승인 확장(색인 중 질의)** — 의
공통 규격을 정의한다. 본 규격이 1·2·3단계 구현의 단일 계약이다.

## 1. 파일 형식

- 형식: **JSON**(UTF-8, BOM 없음), 확장자 `.gongmu-vocab.json`
- 위치:
  - L1 내장: `services/sidecar/src/gongmu_sidecar/assets/topic_vocab_common.json`
  - L2 기관팩: `<workspace>/vocab/institution-pack.json` (임포트 시 복사 저장)
  - L3 승인분: DB `vocab_user_topics` 테이블(정본) + `<workspace>/vocab/user-approved.json` 미러(이식성)

## 2. 스키마

```json
{
  "schema_version": 1,
  "pack": {
    "name": "코레일유통 AI혁신처 어휘집",
    "publisher": "AI혁신처",
    "version": "1.0.0",
    "scope": "institution",          // "common" | "institution"
    "language": "ko",
    "description": "기관 고유 업무 주제",
    "created_at": "2026-07-12"
  },
  "topics": [
    {
      "id": "safety-mgmt-system",     // 필수. 팩 내 유일. 영문 소문자·숫자·하이픈
      "name": "안전보건경영시스템",       // 필수. 정식 주제명(위키 페이지 제목)
      "synonyms": ["ISO 45001", "KOSHA-MS", "안전보건체계"],  // 결정적 매칭용 변형
      "broader": "safety",            // 선택. 상위 주제 id (계층)
      "scope_note": "구축·운영·심사·절차서 문서. 개별 사고 보고는 safety-incident 사용",
                                       // 선택. LLM 선택 프롬프트에 그대로 제공되는 사용 지침
      "work_area_hint": "안전관리",     // 선택. 분류체계(업무영역) 연동 힌트
      "enabled": true                  // 선택(기본 true). false면 비활성(삭제 대신)
    }
  ]
}
```

필드 규칙:
- `id`: `^[a-z0-9][a-z0-9-]{1,63}$`. 층 간 동일 id = 오버라이드 관계.
- `name`·`synonyms`: NFC 정규화 저장. 매칭 키 = 소문자·공백 제거·조사 제거(`normalize_topic_key` 재사용).
- 한 팩 최대 1,000 topics, synonyms 항목당 최대 20.

## 3. 층 병합 규칙 (런타임 결합)

1. 우선순위 **L3 > L2 > L1**. 동일 `id`: 상위 층이 name/scope_note를 오버라이드, `synonyms`는 **합집합**.
2. `enabled:false`는 해당 주제를 결합 결과에서 제외(하위 층 정의 포함).
3. 서로 다른 id인데 **정규화 키 충돌**(name 또는 synonym이 같은 키): 임포트 검증 오류로 반려(§5).

## 4. 매칭·선택 엔진 계약 (1단계)

문서 태깅 순서(보강 파이프라인):
1. **결정적 매칭**(비용 0): 제목+파일명+본문 상위 1,500자에서 결합 어휘집의 name/synonym 키 검색.
   매칭 스코어 = 제목/파일명 히트×2 + 본문 히트×1. 스코어순 상위 3개를 주제로 채택.
2. 결정적 매칭이 2개 미만이면 **LLM 선택**: 후보 목록(결정적 부분 매칭 상위 + 워크스페이스 빈도 상위,
   합계 k≤30, `name — scope_note` 형식) + 문서 요약을 주고 "목록에서 최대 3개 선택,
   정말 없으면 `NEW: <제안명>`" 출력을 요구. 창작 금지를 명시.
3. `NEW:` 제안은 주제로 **즉시 반영하지 않고** 후보 큐(§6)에 적재. 문서에는 선택분만 저장.
4. `topics_json`에는 항상 **정식명(name)** 만 저장(동의어로 저장 금지).

## 5. L2 기관팩 임포트 API (2단계)

- `GET  /api/knowledge/vocab` → `{ layers: {common: n, institution: {name, version, topics}|null, user: n}, topics: [{id, name, layer, synonyms_count, enabled}] }`
- `POST /api/knowledge/vocab/pack` — body `{ "path": "C:\\...\\기관팩.gongmu-vocab.json" }` 또는 `{ "content": {…팩 객체…} }`
  → 검증 후 저장. 응답 `{ ok, imported: {name, version, topics}, errors: [], warnings: [] }`
  - 검증: schema_version 지원 여부, id 형식·유일성, name 필수, 키 충돌(§3-3), 크기 상한.
    오류 시 저장하지 않고 오류 목록 전체 반환(부분 임포트 금지).
  - 임포트 성공 시 기존 문서 주제의 재평가 대상 표시(dirty) — 재보강 때 새 어휘집으로 재태깅.
- `DELETE /api/knowledge/vocab/pack` → 기관팩 제거(문서 주제는 유지, 이후 태깅에만 반영).
- **UI(분류체계 설정 연동)**: 마법사 1단계(니즈 파악) 하단 + 설정 탭 '위키 구성' 카드에
  "기관 어휘집 팩" 블록 — 파일 경로 입력(+폴더 선택 다이얼로그 재사용) → [팩 불러오기] →
  검증 결과(성공: 이름·버전·주제 수 / 실패: 오류 목록) 표시, 현재 적용 중 팩 정보·[제거] 버튼.

## 6. L3 후보 큐 (3단계 — 색인·인제스트 중 사용자 질의)

- DB `vocab_candidates`: `id, name, norm_key(UNIQUE), hit_count, sample_docs_json(최대 5), status(pending|approved|rejected|merged), merged_into_id, first_seen_at, decided_at`
- 적재 시점: 보강 중 LLM `NEW:` 제안 / (마이그레이션) 기존 자유 주제 중 어휘집 미포함분.
  동일 norm_key 재등장 시 hit_count++ + sample_docs 갱신.
- `GET  /api/knowledge/vocab/candidates?status=pending` → `{ items: [...] }`
- `POST /api/knowledge/vocab/candidates/{id}/decision` — body
  `{ "action": "approve" | "reject" | "merge", "merge_into_id": "<topic id>"?, "name_override": "..."?, "synonyms": [...]? }`
  - approve → `vocab_user_topics` 편입(+미러 파일 갱신) + 해당 sample 문서 dirty 재태깅
  - merge → 후보 name을 대상 주제의 synonym으로 추가
- **UI**: 지식폴더 설정 탭에 "주제 어휘 후보" 섹션(기존 '분류 대기 큐' 패턴 재사용) —
  후보명·등장 횟수·표본 문서 표시, [승인]/[다른 주제에 병합(선택)]/[거절].
  대시보드 위키 카드에 "주제 후보 대기 n건" 배지.

## 7. 하위 호환·마이그레이션

- 어휘집이 비어 있어도(이론상) 파이프라인은 동작: 결정적 0건 + LLM 후보 0건 → 전부 `NEW:` 후보 큐.
- 기존 자유 주제(topics_json)는 유지하되, 재보강 시 새 파이프라인으로 재태깅되어 점진 수렴.
- L1 자산 갱신은 앱 업데이트로 배포(schema_version으로 호환 관리).

## 8. 단계별 구현 매핑

| 단계 | 내용 | 산출 |
|---|---|---|
| 1단계(본인 작업) | L1 공통 어휘집 자산 제작 + §4 엔진 | assets/topic_vocab_common.json, topic_vocab.py |
| 2단계 | §5 팩 임포트 API+UI (분류체계 설정 시 입력) | app.py·KnowledgeScreen.tsx |
| 3단계 | §6 후보 큐 + 승인 처리 (색인·인제스트 연동) | db.py·app.py·KnowledgeScreen.tsx |
