# 2026-04-28 자체 로컬 파일찾기 구현 계획

## 목표

공무 워크스페이스의 파일찾기 기본 흐름을 외부 Anything 실행 의존에서 분리한다.

사용자는 지식폴더에 등록한 로컬 업무폴더의 파일을 파일명, 경로, 추출 본문 기준으로 빠르게 찾고, 찾은 개별 파일을 현재 업무대화 세션에 바로 연결할 수 있어야 한다. Reference Set은 반복 사용할 작업자료 묶음이 필요할 때만 쓰는 고급 기능으로 낮추고, Anything은 선택적 외부 고급검색 보조 도구로 유지한다.

## 제품 결정

- 기본 UX: `로컬 파일 검색 -> 개별 파일 선택 -> 현재 업무대화 세션에 연결`
- 보조 UX: 여러 문서작성 작업에서 같은 자료 구성을 반복할 때만 `작업자료 묶음`으로 저장
- 외부 도구: Anything/Docufinder는 코어 의존성이 아니라 선택 연계
- 구현 기준: 현재는 `knowledge_source_files`를 1차 파일 인덱스로 사용하고, 이후 대용량 업무폴더 최적화 시 FTS5/백그라운드 watch/증분 인덱싱을 추가

## 참고한 외부 패턴

- Docufinder/Anything: 로컬 오프라인 문서검색 UX와 한국어 문서 포맷 지원 방향은 참고하되, BSL 1.1 라이선스 특성상 내장 의존이 아니라 외부 선택 연계로만 둔다.
- ripgrep/ripgrep-all: 빠른 재귀 텍스트 검색, 문서 추출 어댑터, 파일 타입 필터링 아이디어를 참고한다.
- Recoll: 파일명과 본문을 함께 인덱싱하고 문서 미리보기/원본 열기를 제공하는 데스크톱 검색 모델을 참고한다.

## 완료한 작업

- [x] sidecar에 `GET /api/files/search` 추가
- [x] `KnowledgeManager.search_source_files()` 추가
- [x] 파일명, 경로, 추출 본문 기반 점수화와 `match_reasons` 반환 추가
- [x] `metadata_only` 파일도 파일명/경로 검색 결과에 포함
- [x] 삭제된 파일은 검색 결과에서 제외
- [x] desktop API에 `searchLocalFiles(query)` 추가
- [x] `로컬파일/정보검색` 화면 상단을 `내장 파일찾기`로 재구성
- [x] 검색 결과에서 바로 `세션에 연결` 가능하도록 구현
- [x] 이미 연결된 파일은 `연결됨` 상태로 표시
- [x] Reference Set 생성 UI를 고급 접힘 영역으로 이동하고 `작업자료 묶음` 용어로 정리
- [x] Anything 실행 요청 UI를 선택 연계 영역으로 이동
- [x] 회귀 테스트 추가 및 기존 테스트를 새 IA에 맞게 정렬
- [x] 체크포인트 보드에 구현/검증 결과 반영

## 검증 결과

```powershell
npm.cmd run sidecar:test -- services/sidecar/tests/test_knowledge_sources.py -q
npm.cmd --workspace apps/desktop run test -- src/local-file-search.test.tsx
npm.cmd --workspace apps/desktop run test -- src/session-file-links.test.tsx src/anything-launch.test.tsx src/local-file-search.test.tsx
npm.cmd run sidecar:test -- services/sidecar/tests/test_knowledge_sources.py services/sidecar/tests/test_session_file_links.py
npm.cmd run sidecar:test
npm.cmd run desktop:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

결과:

- `test_knowledge_sources.py`: 통과
- `local-file-search.test.tsx`: 1 test 통과
- `session-file-links + anything-launch + local-file-search`: 3 files / 5 tests 통과
- targeted sidecar search/link tests: 54 passed
- `sidecar:test`: 54 passed
- `desktop:test`: 17 files / 39 tests passed
- `cargo check`: PASS
- dev 재실행 확인: sidecar `/health` = `ok`, `gongmu-desktop.exe` 실행 중

## 남은 후속 작업

- 실제 대용량 업무폴더에서 검색 속도와 결과 품질 확인
- PDF/DOCX/HWPX/HWP 본문 추출 품질을 실제 공문서 샘플로 보강
- FTS5 또는 별도 inverted index 기반 증분 검색으로 확장
- 폴더 변경 감지 watch와 백그라운드 재색인 추가
- 검색 결과에서 미리보기, 파일 위치 열기, 관련 업무대화 추천 고도화
