# Gongmu Sidecar

Python FastAPI sidecar for the Gongmu local-first workspace.

## Dev Commands

- `npm run sidecar:test`
- `npm run sidecar:serve`
- `npm run desktop:test`
- `npm run desktop:build`
- `npm run desktop:bundle`
- `npm run verify:all`

## Runtime Notes

- 기본 바인딩: `127.0.0.1:8765`
- 워크스페이스 루트: `runtime-workspace/`
- 운영 DB: `runtime-workspace/db/gongmu.db`
- 지식 원본: `runtime-workspace/knowledge/raw`
- 지식 정본: `runtime-workspace/knowledge/structured`
- 그래프 산출: `runtime-workspace/knowledge/graph`
- 문서 산출: `runtime-workspace/documents/`

## MVP Service Surface

- `/health`: 워크스페이스 부트스트랩 상태 확인
- `/api/settings`: 런타임 설정 계약
- `/api/tools`: Tool Manifest
- `/api/documents/*`: ContentBase 생성, 최종 저장 승인/적용
- `/api/knowledge/*`: 반영 후보, 검색, 그래프 요약
- `/api/file-organizer/*`: 제안 생성, 적용 요청, 승인 후 적용, rollback

## Operating Rules

- 기본 동작은 로컬 우선이다.
- 위험 작업은 approval ticket을 거쳐 적용한다.
- 파일정리는 삭제 대신 copy 기반 적용을 우선한다.
- 실행기록은 사용자 작업 이력으로 남긴다.

## Offline Packaging Notes

- 데스크톱 설치형 산출물은 `npm run desktop:bundle`로 생성한다.
- Tauri 번들 산출물은 `apps/desktop/src-tauri/target/release/bundle/` 아래에 모인다.
- 내부망 배포 시에는 설치 파일만 넘기지 않고 아래를 함께 준비한다.
  - 배포 대상 버전 정보
  - `runtime-workspace/` 초기 구조 정책
  - 로그 위치와 장애 대응 메모
  - `Anything` 외부 연계 경로/실행 정책
- 상세 절차와 반입 체크리스트는 `docs/operations/2026-04-20-alpha-offline-packaging-runbook.md`를 기준으로 운영한다.
