# 파일정리 Sandbox 적용/롤백 검증

검증일: 2026-06-16 00:37 KST

## 목적

파일정리 기능이 실제 사용자 파일을 직접 훼손하지 않고, 승인된 제안을 안전하게 적용한 뒤 되돌릴 수 있는지 runtime sandbox에서 확인했다.

## 검증 환경

- 저장소: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex`
- 실행 Python: `.venv\Scripts\python.exe`
- 테스트 workspace: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\file-organizer-sandbox-20260615\workspace`
- 입력 폴더: `C:\Users\USER\Agent_Gongmu\Agent_Gongmu_Codex\runtime-workspace\cache\file-organizer-sandbox-20260615\incoming`

## 실행 명령

```powershell
node scripts/portable-run.mjs python -m pytest services/sidecar/tests/test_file_organizer_apply.py -q
```

결과: `6 passed in 5.88s`

추가로 FastAPI TestClient를 사용해 아래 흐름을 runtime sandbox에서 직접 실행했다.

1. `incoming` 폴더에 `meeting-note.md`와 `evidence-assets/summary.txt` 생성
2. `POST /api/file-organizer/proposals`
3. `POST /api/file-organizer/proposals/{proposal_id}/apply`
4. `POST /api/approval-tickets/{ticket_id}/decision`
5. `POST /api/file-organizer/proposals/{proposal_id}/apply/commit`
6. `POST /api/file-organizer/operations/{operation_id}/rollback`

## 결과

- proposal 수: 2
- 적용 대상: `meeting-note.md`
- 적용 후 destination 생성: 성공
- 적용 후 원본 유지: 성공
- destination 내용과 원본 내용 일치: 성공
- rollback 후 destination 제거: 성공
- rollback 후 원본 유지: 성공
- apply work job 상태: `succeeded`
- rollback work job 상태: `succeeded`
- 작업이력 종류: `fileorg.apply`, `fileorg.rollback`

## 판정

파일정리 기능의 현재 구현은 원본을 이동하지 않고 `knowledge/raw` 쪽으로 복사한 뒤, rollback 시 복사본을 제거하는 보수적 구조다. 따라서 sandbox 기준으로 파일 손실 없이 적용/되돌리기 흐름이 동작한다.

## 남은 주의점

- 실제 업무 폴더 전체에 대한 자동 정리 품질은 별도 UX/정책 검증 대상이다.
- 현재 검증은 안전성 중심이며, “어떤 폴더로 정리하는 것이 업무적으로 적절한가”는 향후 파일정리 고도화에서 다룬다.
