# Gongmu Sidecar

Python FastAPI sidecar for the Gongmu local-first workspace.

## Dev Commands

- `npm run sidecar:test`
- `npm run sidecar:serve`
- `npm run desktop:test`
- `npm run desktop:build`
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
