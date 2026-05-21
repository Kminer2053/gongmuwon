# 2026-04-25 LLM Chat Integration Validation

## Summary

- Scope: chat-first 업무대화 세션에 실제 LLM turn 파이프라인 연결
- Environment: Windows Codex main workspace
- Goal: `업무대화 입력 -> sidecar LLM turn -> assistant 메시지 저장 -> desktop thread 반영` 흐름을 고정

## Implemented

- sidecar에 `POST /api/work-sessions/{session_id}/turn` 추가
- sidecar에 OpenAI-compatible LLM adapter 추가
  - first try: `POST {internal_api_base_url}/responses`
  - fallback: `POST {internal_api_base_url}/chat/completions`
- assistant pending/completed/failed 상태를 세션 메시지에 저장
- settings 화면에 `LLM 연결 테스트` 버튼 추가
  - 현재 설정 저장
  - 연결 테스트 실행
  - 실행 로그 기록

## Expected Runtime Contract

### Chat turn

1. 사용자가 업무대화에 메시지를 입력한다.
2. desktop은 optimistic user/assistant pending 메시지를 먼저 보여준다.
3. sidecar turn endpoint가 user 메시지를 저장한다.
4. sidecar가 assistant pending 메시지를 저장한다.
5. LLM 호출 성공 시 assistant 메시지를 `completed`로 갱신한다.
6. LLM 호출 실패 시 assistant 메시지를 `failed`로 갱신하고 오류 문구를 남긴다.

### Settings test

1. 사용자가 설정 화면에서 provider/model/base URL을 입력한다.
2. `LLM 연결 테스트`를 누른다.
3. 현재 설정을 저장한다.
4. sidecar가 짧은 probe prompt로 연결 테스트를 수행한다.
5. 결과는 execution log에 남는다.

## Current Configuration Notes

- provider field: 자유 입력, 기본값 `openai_compatible`
- model field: 자유 입력, 기본값 `gpt-4.1-mini`
- auth:
  - `GONGMU_LLM_API_KEY` 우선
  - 없으면 `OPENAI_API_KEY`
- local server를 쓰는 경우 API key 없이도 동작 가능

## Verification Evidence

- `npm.cmd run sidecar:test` -> PASS (`35 passed`)
- `npm.cmd run desktop:test` -> PASS (`17 passed`)
- `npm.cmd run desktop:build` -> PASS
- `node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` -> PASS
- `npm.cmd run verify:all` -> PASS

## Remaining Follow-up

- 실제 사용자가 연결할 LLM endpoint preset 정리
- assistant streaming UI는 아직 미구현
- provider별 상세 에러 메시지와 retry UX는 다음 배치에서 보강 가능
