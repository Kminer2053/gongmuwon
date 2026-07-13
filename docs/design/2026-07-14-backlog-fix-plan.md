# 2026-07-14 백로그 수정 계획 (수용 2호 라운드)

입력: `docs/qa/scorecards/2026-07-13.md` 백로그 8건 (우선순위순).
조사: 5개 병렬 트랙이 코드·실DB·실서버로 근본원인을 특정 완료 — **상세 전문은 `docs/design/2026-07-14-fix-tracks/*.json`** (root_cause / fix_design / files_to_change / verification_criteria / e2e_scenarios / risks). 본 문서는 실행 순서·프로토콜·판정 요약이며, **구현 시 반드시 해당 트랙 JSON을 열어 설계 전문을 따른다.**

## 0. 실행 원칙 (사용자 지시 반영)

1. **검증기준 사전 수립**: 각 작업항목(WI)의 PASS 기준은 트랙 JSON `verification_criteria`에 이미 정량 확정 — 구현 중 기준 변경 금지(불가피하면 사유를 스코어카드에 기록).
2. **버그 재현 우선**: 수정 **전에** 재현 시나리오(각 트랙의 "수정 전 FAIL" 케이스)를 실행해 FAIL을 확인하고, 네거티브 컨트롤("수정 전에도 PASS" 케이스)이 PASS임을 확인한 뒤 구현에 착수한다. 수정 후 둘 다 재실행.
3. **반복 검증**: 시나리오 배터리는 트랙당 12~20개(사용자 기준 '최소 5, 되도록 10+' 충족). LLM 변동성이 있는 실LLM 시나리오는 **3회 반복**(수용계획 §0), 결정적(pytest/vitest/API 계약) 시나리오는 1회로 족함.
4. **경제적 실행**: 라우팅·파싱류는 pytest 몽키패치(가짜 LLM)로 전 배터리를 결정적으로 돌리고, 실LLM E2E는 수용 게이트 재실행(G5·G4·W)에서 수행. 실LLM은 앱에 등록된 외부 서비스(featherless) 그대로 사용, **settings.json 열람·출력 금지**.
5. **DB 보호**: 허브 배정 실DB 시나리오(hub-assignment E08~E12)는 실행 전 `gongmu.db`를 백업(`copy ...\db\gongmu.db ...\db\gongmu.db.bak-2호`)하고, DB 직접 쓰기는 금지(모든 변경은 API 경유).
6. **스트림 경로 스모크**: 업무대화 수정(WI-1·3·4)은 비스트림 `/turn`으로 배터리를 돌리되, 최소 1케이스는 `/turn/stream`으로도 확인(데스크톱 실사용 경로).

## 1. 작업항목·실행 순서

app.py 스킬 구역을 WI-1→WI-3 순서로 먼저 완결(같은 파일·상호작용 있음), 나머지는 독립.

### WI-1. 멀티인텐트 라우팅 (백로그 1위, G5) — `fix-tracks/L02-multi-intent.json`
- **원인(3중)**: ① `_looks_like_feature_usage_request`(app.py:1505-1517)의 "안내"+"일정" 부분문자열 AND가 복합지시를 help.guide로 선점 ② 일정동사 목록에 "잡고" 활용형 부재(app.py:1554)로 F-17 플랜 불발 ③ `_parse_schedule_request`(app.py:1721-1785)가 상대요일("다음주 화요일") 미지원 + 복합문 제목 오염.
- **수정**: P0-1 도움말 술어 정밀화(강마커+날짜파싱 오버라이드, "안내"·"설명" 제거), P0-2 "잡-" 활용형 정규식, P0-3 상대요일 파싱·절분리 제목추출, P1-1 knowledge.answer 인텐트, P1-2 LLM 플랜 폴백(엄격 enum 검증+무해 폴스루). 제안 로직은 조사 단계에서 14문장 프로토타입 검증 완료(14/14).
- **판정**: V1~V8 (트랙 JSON). 핵심 = G5 원문에서 intent.plan + schedule.create + document.create 모두 실행, 일정 2026-07-21T15:00 KST 정확 등록, 이메일 artifact 생성. 네거티브: 순수 도움말 2건 help.guide 유지(LLM 미호출), 단일 일정/문서/조회/삭제 무회귀.
- **시나리오**: E2E-01~14 (pytest 몽키패치 주축 + 실LLM은 G5 재실행에서).

### WI-2. 업무 허브 배정 + 노이즈 영역 (백로그 2위+6위, F-01) — `fix-tracks/hub-assignment.json`
- **원인**: ① taxonomy_rules.py:256-270 `match_work_area`가 폴더 매칭 2개 이상이면 무조건 conflict/low — 노이즈 영역들이 실폴더 13개를 전부 중복 claim해서 118건짜리 폴더 전체가 low로 추락(high 3/414의 직접 원인, 오프라인 재현 = 실측 일치) ② work_taxonomy.py:292-327 vocab-cross가 duty 시드 토큰("AI","도입"…)을 경로 전체에 substring 매칭해 노이즈 영역 양산 ③ 빈 confidence 127건은 참고서고(■참고■) 설계상 제외 — **결함 아님**(UI 안내만 추가).
- **수정**: (a) 3단 타이브레이크(세그먼트 깊이→folder_owner_slug 소유자→최소 folders 특이도), (b) vocab-cross 파일명 한정+승격폴더 제외+DUTY_STOPWORDS, (c) confirm 시 중복 claim 소유자 정리+빈 keywords 부여, (d) bulk-resolve API+큐 그룹 UX, (e) 마법사 저확신 후보 기본 제외. **마이그레이션 = apply 1회 재실행**(시뮬레이션: high 3→294, 큐 296→5).
- **판정**: 실DB 재적용 후 high ≥294(비율 ≥0.95), 큐 ≤5, 참고서고 127 불변, 멱등성, 노이즈 후보 0. 
- **시나리오**: E01~E15 (픽스처 pytest + 실DB API — 실DB 건은 백업 선행).

### WI-3. 대화→문서작성 연속성 (백로그 3위, G5/L-01) — `fix-tracks/doc-continuity.json`
- **원인(3중)**: ① app.py:1849 위키 검색 쿼리가 지시문 원문("방금 내용을…") → 메타어만 남아 무관 문서(AX포털) top-1 (실서버 재현) ② organize 프롬프트(:398)가 "모호하면 참고자료를 주제로" — 무관 근거가 주제로 승격 ③ F-06 가드가 `reference_texts` 비어있지 않으면 침묵. 세션 요약에는 올바른 주제가 있었음(활용 안 된 것이 본질).
- **수정**: `_references_session_context`+`_derive_document_topic` 결정적 헬퍼(스킬 로컬 `_DOC_META_STOPWORDS` — 전역 QUERY_STOPWORDS 절대 무수정), 주제 기반 retrieve + 주제-근거 일치 게이트, `[문서 주제 — 직전 대화에서 도출]` 지시 주입, organize 프롬프트 additive 개정. LLM 추가 호출 없음. 정제 쿼리로 정답 문서 top-1 회수됨을 실측 완료.
- **판정**: topic 도출 단위테스트 4건, 'AX포털' 출현 0회 불변식, E2E ≥11/12 (E2E-01 필수 PASS, 네거티브 07·08 수정 전에도 PASS).
- **시나리오**: E2E-01~12 (실LLM — 문서 파이프라인이라 pytest 스텁 + 실LLM 병행).

### WI-4. 무근거 citations 억제 + LLM 재시도 (백로그 5위+8위) — `fix-tracks/citations-retry.json`
- **원인**: ① knowledge_wiki.py:3014-3073 ask()가 retrieve 결과를 무조건 citations로 확정, 무근거 판정 로직 전무(업무대화 경로 app.py:2248/2615 동일) ② llm.py:103-152 단일 시도 urlopen, 재시도·Retry-After 처리 0.
- **수정**: `is_no_evidence_answer()` 결정적 정규식(머리 200자 + "(출처: 없음)" 규약, 실측 2건 기반) → ask/turn/stream 3경로 citations 억제 + `no_evidence` 플래그; llm.py `_urlopen_with_retry`(5xx 1회 재시도, 백오프 2~5초 캡, 경과 90초 캡, ollama URLError는 무재시도+한국어 안내), LLMGenerationError.status_code 구조화(400/404 문자열 검사 대체 — openai 폴백 계약 보존).
- **주의**: HTTPError.read()는 1회만 읽힘(트랙 risks 참조). 프런트 무수정(빈 citations는 기존 렌더가 처리).
- **판정**: 신규 pytest ≥13개(재시도 시도횟수·sleep 인자 정밀 검증), 실LLM 무근거 10문 불변식 위반 0건 + 유근거 5문 회귀 0건.
- **시나리오**: E2E-A1~A7, B1~B5, NC1~3.

### WI-5. 캘린더 자정교차 + G4 질의셋 (백로그 7위+4위) — `fix-tracks/timegrid-benchmark.json`
- **원인**: ScheduleScreen.tsx:155-157 band 폴백에 "시작일 소속" 검사 부재 → 익일 꼬리 칸에도 push.
- **수정**: `start >= dayStart` 가드 1줄 + 신규 vitest 파일(A-01~A-12, buildTimegridDay 순수함수 테스트 — A-01은 수정 전 FAIL 확인 필수). coversWholeDay·timed 분기 무변경.
- **G4 질의셋**: FAIL 4문 폐기 → 신규 4문(전보·전직 정의 / 위험성평가 구분 / AI혁신추진단 회의 업체 / 출장여비 항목 — **전부 DB 원문으로 정답 존재 증명 완료**, 판정 키워드+기대 출처 고정). 유지 4문과 함께 `docs/qa/release-acceptance-plan.md`에 표로 명문화. B-08 기대 출처는 실존 3문서로 재고정(스코어카드에 비회귀 명기).
- **판정**: vitest 12/12, 기존 timegrid 테스트 무수정 통과, 신질의 4문 3회 반복 12회 중 ≥11회 PASS.

### WI-6. W-03 재검 (백로그 5위 연계)
WI-4 배포 후 W-03(무근거 정직) 재실행 — citations==0 확인. 별도 코드 없음.

## 2. 검증·게이트 재실행 (구현 완료 후)

1. **회귀(G8)**: sidecar pytest 전체(기준선 427+신규) + desktop vitest 전체(기준선 234+신규) — 실패 0.
2. **G5 재실행**: L-01·L-02·L-06 + 미실행분 L-03·L-04·L-05 — 각 3회 반복(실LLM). 기준: 수용계획 §3-B.
3. **G4 재실행**: 신질의셋 8문 × 3회 — ask ≥7/8. 키워드 8문 1회(2연속 안정 시 축소 규칙).
4. **W-01~03**: 고정 8문+무근거 1문 × 3회.
5. **허브 배정**: 실DB apply 재실행(마이그레이션) → E09~E12 판정.
6. **스코어카드 2호** 작성: `docs/qa/scorecards/2026-07-14.md` — 게이트표, 직전 대비 증감, 백로그 처리 결과, 신규 발견.
7. **패키징**: 버전 0.1.4 범프 → `npm run desktop:bundle && npm run release:offline && node scripts/prepare-ollama-ai-pack.mjs --include-models runtime-workspace/cache/ollama-models/gemma4-e2b --include-ollama-installer runtime-workspace/cache/ollama/OllamaSetup.exe --include-python-installer runtime-workspace/cache/python/python-3.11.9-amd64.exe` → NSIS 직접 설치로 교체 → 설치본에서 핵심 스모크(멀티인텐트 1건·허브 집계·kordoc 셀프테스트) → 구버전 산출물 삭제.

## 3. 커밋 규율

- WI 단위 커밋(수정+테스트 동봉), 메시지에 근본원인 요약. WI-4의 app.py 중복 update 호출 정리는 별도 커밋(트랙 risks).
- 각 WI 완료 시 해당 트랙의 "수정 전 FAIL" 시나리오가 PASS로 뒤집혔음을 커밋 메시지 또는 스코어카드에 기록.

## 4. 알려진 정책 결정 (구현자가 바꾸지 말 것)

- 재시도는 "실패 노출"보다 "느린 성공" — G5 턴 시간기준 초과 가능성을 스코어카드에 명기.
- 자정교차 일정은 시작일 1회 표시(꼬리 정보 소실은 매뉴얼에 규칙 명기).
- 참고서고 127건 빈 confidence는 설계 의도 — UI 안내 문구만.
- 도움말 마커에서 "안내" 제거로 일부 진성 도움말이 LLM 대화로 흘러가는 것 허용(트랙 risks 1).
