# 지식폴더 기반 개인 업무지능 고도화 실행계획

> 기준일: 2026-04-28
> 현재 상태: 로컬 폴더 스캔형 지식베이스, 업무대화 세션 파일 연결, 업무대화 즉시 지식 반영, 소스 파일 기반 그래프 미리보기와 그래프 탐색 보조 UI를 1차 구현했다.

## 1. 최종 목표

Gongmu의 지식 흐름은 다음 구조를 기준으로 한다.

```text
지식폴더(로컬 폴더 스캔 지식베이스)
  -> 업무대화 세션
파일찾기 / Anything 결과
  -> 업무대화 세션 파일 연결
업무대화 세션
  -> 문서작성 / 도구 사용 / 향후 스킬 기반 콘텐츠 생성
업무대화 기록
  -> 개인화 요약 / 작업 패턴 / 선호 / 문서작성 힌트
  -> 개인 지식베이스에 즉시 반영
```

핵심 원칙은 “수동 메모 후보 승인”이 아니라 “지정한 업무 폴더와 업무대화 기록을 원천으로 삼아 자동으로 정리되는 지식베이스”다.

## 2. 이번 배치 완료 항목

- `knowledge_sources`, `knowledge_source_files`를 통해 복수 로컬 폴더를 등록하고 하위 문서를 스캔한다.
- Markdown, TXT, CSV, JSON은 본문을 저장하고, DOCX/XLSX/PPTX/HWPX는 ZIP XML 기반으로 본문 추출을 시도한다.
- PDF는 `pypdf`가 설치되어 있으면 본문 추출을 시도하고, 불가하면 metadata-only로 유지한다.
- 스캔된 파일은 `/api/knowledge/search`의 `source_file_hits`로 검색된다.
- `/api/knowledge/graph`는 기존 지식 페이지 그래프에 더해 `source_folder`, `source_file`, `keyword` 노드를 함께 반환한다.
- 업무대화 화면의 별도 파일 경로 입력칸을 제거하고, `관련 파일 연결` 버튼으로 로컬파일/정보검색 화면으로 이동하게 했다.
- Anything import 경로는 선택된 업무대화 세션이 있으면 세션 파일 링크에도 함께 남는다.
- 업무대화 세션 분석은 후보/승인 대기 없이 즉시 `personalization/session-summaries`와 `personalization/audit-log`에 반영된다.
- 지식폴더 화면에서 수동 메모 후보 등록 UI와 후보 승인 UI를 제거했다.
- 지식폴더 화면에 `지식 그래프 미리보기` 영역을 추가했다.
- 지식폴더 화면을 그래프 우선 구조로 재배치했다. 최상단에서 폴더, 문서, 키워드 관계를 SVG 그래프 맵으로 보여주고, 지식 소스 등록/스캔, 등록된 문서 메타데이터, 업무대화 반영 기록은 접이식 상세 섹션으로 이동했다.
- 지식 그래프 맵은 데이터가 많을 때 잘리지 않도록 상하좌우 스크롤과 세로 리사이즈를 지원한다.
- 그래프 하단 범례는 단순 설명 텍스트가 아니라 `전체`, `폴더`, `문서`, `키워드` 필터 버튼으로 동작하며, 선택한 유형을 강조하고 나머지는 흐리게 표시한다.
- 기존 `지식 검색과 관계 보기` 영역은 `키워드로 관련 문서 찾기`로 명확히 바꾸고, 전체 그래프가 아니라 검색어 기준으로 관련 문서와 연결 키워드를 좁혀보는 보조 탐색 기능임을 설명한다.
- 문서 메타데이터 카드에 `본문 추출됨`, `메타데이터만`, 추출물 경로를 표시해 실제 본문 추출 여부를 확인할 수 있게 했다.
- 업무대화 화면의 연결 파일 상세 패널을 제거하고, 일정 연결 옆에 `파일 연결` 버튼과 `연결 파일 N개` 토글을 배치했다.
- 채팅 영역은 대화 2, 입력 1 비율에 가깝게 재조정하고, 연결 파일 목록은 필요할 때만 작은 팝오버로 펼친다.

## 3. 현재 사용자 확인 필요 항목

- 실제 업무 폴더를 등록하고 스캔했을 때 파일 제목, 본문 발췌, 상태 표시가 업무자가 이해하기 좋은지 확인한다.
- 업무대화의 `관련 파일 연결` 버튼으로 파일찾기 화면에 이동한 뒤, 현재 연결 대상 세션 안내와 Anything/import 흐름이 자연스러운지 확인한다.
- DOCX/XLSX/PPTX/PDF 실제 업무문서에서 본문 추출 품질이 충분한지 확인한다.
- 최상단 지식 그래프 맵에서 폴더, 파일, 키워드 관계가 직관적으로 보이고, 스크롤/리사이즈/범례 필터가 탐색에 충분한지 확인한다.
- 업무대화 `이 세션 지식 반영` 문구와 즉시 반영 방식이 사용자 입장에서 부담 없고 명확한지 확인한다.

## 4. 다음 구현 후보

1. 폴더 변경 감시 또는 주기 스캔을 추가해 지식베이스 DB를 자동 갱신한다.
2. 파일찾기 화면에서 세션 연결 대상이 있을 때 import/붙여넣기 흐름을 더 눈에 띄게 만든다.
3. 업무대화 세션의 연결 파일과 지식폴더 검색 결과를 문서작성 Content Base 입력으로 직접 handoff한다.
4. 그래프 미리보기를 현재의 정적 SVG 맵에서 드래그 팬/줌, 노드 클릭 상세보기, 관계 경로 강조까지 확장한다.
5. PDF/HWP 본문 추출 품질을 별도 라이브러리 선택과 설치 정책까지 포함해 강화한다.

## 5. 검증 기록

```powershell
npm.cmd run sidecar:test -- services/sidecar/tests/test_personalization_learning.py services/sidecar/tests/test_knowledge_sources.py
npm.cmd --workspace apps/desktop run test -- src/session-file-links.test.tsx src/knowledge-sources.test.tsx
npm.cmd run sidecar:test
npm.cmd run desktop:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

결과:

```text
PASS
- sidecar:test: 53 passed
- desktop:test: 16 files / 38 tests passed
- cargo check: PASS
```
