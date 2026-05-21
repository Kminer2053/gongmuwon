# 기능 검증 체크리스트 - 2026-04-23

## 목적

이 문서는 현재 구현된 Gongmu MVP 기능이 Windows 메인 환경에서 실제 업무 흐름 기준으로 충분히 동작하는지 점검하기 위한 체크리스트다.

이 체크리스트의 목적은 다음과 같다.

- 기능이 실제로 끝까지 연결되는지 확인
- 기능 간 handoff가 자연스러운지 확인
- 승인, 실행기록, 산출물 반영이 일관적인지 확인
- 수정이 필요한 항목을 한 번에 모아 다음 배치 계획으로 넘기기

중요:

- 이 문서는 `즉시 수정`용이 아니라 `문제 수집`용이다.
- 점검 중 이상을 발견해도 바로 고치지 말고 기록부터 남긴다.

## 상태 표기 규칙

각 항목은 아래 중 하나로 표기한다.

- `pass`: 기대한 대로 잘 동작함
- `partial`: 동작은 하지만 어색하거나 불안정함
- `fail`: 기대한 흐름이 끝까지 완료되지 않음
- `later`: 경미해서 나중에 고쳐도 되는 항목
- `skip`: 이번 점검에서 생략

## 사전 기준선

먼저 아래 두 가지를 기준선으로 기록한다.

- [ ] `npm.cmd run verify:all`
- [ ] `npm.cmd run desktop:smoke:nsis`

기록:

- 점검한 커밋 SHA:
- `verify:all` 결과:
- `desktop:smoke:nsis` 결과:

## A. 핵심 업무 흐름

### A1. 일정 생성

- [ ] 상태: `pass / partial / fail`

확인:

1. `일정` 화면 열기
2. 일정 1개 생성
3. 일정 카드/목록에 반영되는지 확인
4. 우측 `선택 상태`에도 반영되는지 확인

기록:

- 생성한 일정 제목:
- 이상 여부:

### A2. 업무 세션 연결

- [ ] 상태: `pass / partial / fail`

확인:

1. `업무대화` 화면 열기
2. 선택된 일정과 연결된 세션 생성 또는 열기
3. 우측 `선택 상태`의 `선택 세션`이 맞게 바뀌는지 확인

기록:

- 세션 제목:
- 이상 여부:

### A3. 수동 Reference Set 생성

- [ ] 상태: `pass / partial / fail`

확인:

1. `로컬파일/정보검색` 화면 열기
2. Reference Set 하나 생성
3. 우측 `선택 상태`에 반영되는지 확인

기록:

- Reference Set 제목:
- 넣은 항목 수:
- 이상 여부:

### A4. Content Base 생성

- [ ] 상태: `pass / partial / fail`

확인:

1. `문서작성` 화면 열기
2. 문서 제목 입력
3. 문서 목적 입력
4. 템플릿 선택
5. Reference Set 선택
6. `ContentBase.md 생성`
7. 미리보기/초안 내용이 보이는지 확인

기록:

- 문서 제목:
- 문서 목적:
- 선택 템플릿:
- 선택 Reference Set:
- 미리보기 표시 여부:
- 이상 여부:

### A5. 초안 변경 후 stale 보호

- [ ] 상태: `pass / partial / fail`

확인:

1. Content Base를 한 번 생성
2. 그 뒤 아래 중 하나를 바꿈
   - 문서 제목
   - 문서 목적
   - 템플릿
   - 선택 Reference Set
3. 기존 Content Base를 그대로 최종저장에 쓰지 못하게 막는지 확인

기대 결과:

- 기존 초안이 무효화됨
- 다시 생성하라는 흐름이 보임

기록:

- 바꾼 항목:
- 실제로 어떻게 보였는지:

### A6. 최종 문서 승인 및 적용

- [ ] 상태: `pass / partial / fail`

확인:

1. Content Base 새로 생성
2. `최종 저장 요청`
3. 승인 영역에서 승인
4. 최종 저장 적용
5. 산출물 경로가 보이는지 확인

기록:

- 출력 이름:
- 산출물 경로:
- 이상 여부:

## B. Anything / 검색 / 문서작성 연결

### B1. Anything 실행 요청

- [ ] 상태: `pass / partial / fail`

확인:

1. `로컬파일/정보검색` 화면 열기
2. Anything 검색어 입력
3. 승인 요청이 생성되는지 확인

기록:

- 검색어:
- 승인 생성 여부:

### B2. Anything 실행 및 다시 열기

- [ ] 상태: `pass / partial / fail`

확인:

1. Anything 실행 승인
2. 외부 열기 동작 확인
3. apply 후 다시 열기도 되는지 확인

기록:

- 외부 열기 성공 여부:
- 다시 열기 성공 여부:
- 이상 여부:

### B3. Anything 결과를 Reference Set으로 가져오기

- [ ] 상태: `pass / partial / fail`

확인:

1. Anything 결과 경로들을 붙여 넣기
2. 새 Reference Set으로 import
3. 생성된 Reference Set이 실제로 선택 가능한지 확인

기록:

- import 제목:
- 경로 개수:
- 이상 여부:

### B4. Continue to Documents handoff

- [ ] 상태: `pass / partial / fail`

확인:

1. `Continue to Documents` 클릭
2. `문서작성` 화면으로 이동하는지 확인
3. 방금 가져온 Reference Set이 자동 선택되는지 확인
4. 제목/목적 기본값이 이어지는지 확인
5. 요약 카드에 아래가 보이는지 확인
   - Reference Set 제목
   - item 수
   - 대표 파일명
   - 대표 경로

기록:

- 이어진 제목:
- 이어진 목적:
- 요약 카드 정상 여부:
- 이상 여부:

## C. 내 지식폴더

### C1. 지식 후보 생성

- [ ] 상태: `pass / partial / fail`

확인:

1. `내 지식폴더` 화면 열기
2. 지식 후보 1개 생성
3. pending 후보 목록에 보이는지 확인

기록:

- 후보 제목:
- 후보 타입:
- 이상 여부:

### C2. 지식 페이지 승인

- [ ] 상태: `pass / partial / fail`

확인:

1. 후보 승인
2. 실제 페이지 경로 또는 반영 결과가 보이는지 확인

기록:

- 승인한 제목:
- 생성된 페이지 경로:
- 이상 여부:

### C3. 지식 검색

- [ ] 상태: `pass / partial / fail`

확인:

1. 검색어 입력
2. 검색 결과 또는 graph 정보가 보이는지 확인

기록:

- 검색어:
- 결과 표시 여부:
- 이상 여부:

## D. 파일정리 / 승인 / 롤백

### D1. 제안 생성

- [ ] 상태: `pass / partial / fail`

확인:

1. `파일정리` 화면 열기
2. 대상 경로 기준으로 제안 생성
3. 제안 목록이 나타나는지 확인

기록:

- 대상 경로:
- 제안 수:
- 이상 여부:

### D2. 승인 후 적용

- [ ] 상태: `pass / partial / fail`

확인:

1. 적용 요청
2. 승인
3. 실제 적용
4. 결과 경로가 표시되는지 확인

기록:

- 사용한 제안:
- 결과 경로:
- 이상 여부:

### D3. 롤백

- [ ] 상태: `pass / partial / fail`

확인:

1. 적용된 작업을 되돌리기
2. active 상태에서 제거되는지 확인
3. 예상치 못한 파일 손실이 없는지 확인

기록:

- 롤백 결과:
- 남은 문제:
- 이상 여부:

## E. 런타임 / 승인 / 실행기록

### E1. managed sidecar 시작 / 재시작 / 종료

- [ ] 상태: `pass / partial / fail`

확인:

1. 앱에서 sidecar 시작
2. 재시작
3. 종료
4. 상태 chip과 버튼이 맞게 변하는지 확인

기록:

- 시작:
- 재시작:
- 종료:
- 이상 여부:

### E2. unmanaged sidecar 복구

- [ ] 상태: `pass / partial / fail / skip`

확인:

1. unmanaged sidecar 상태가 잡히면 `Recover sidecar`가 보이는지 확인
2. 눌렀을 때 사용자 입장에서 이해 가능한 피드백이 나오는지 확인

기록:

- 테스트 여부:
- 결과:

### E3. 승인 큐 일관성

- [ ] 상태: `pass / partial / fail`

확인:

1. 승인 항목이 pending -> approved/rejected로 자연스럽게 바뀌는지 확인
2. 이미 끝난 작업이 다시 적용 가능해 보이지 않는지 확인

기록:

- 점검한 액션:
- 이상 여부:

### E4. 실행기록

- [ ] 상태: `pass / partial / fail`

확인:

1. `실행기록` 화면 열기
2. 최근 작업이 실제로 남는지 확인
3. 로그만 봐도 무슨 일이 있었는지 이해 가능한지 확인

기록:

- 보인 작업:
- 이상 여부:

## F. Windows GUI / 설치 검증 재사용

아래 기존 문서를 함께 참고한다.

- [2026-04-20-windows-remote-validation-checklist.md](C:/Users/USER/Agent_Gongmu/Agent_Gongmu_Codex/docs/operations/2026-04-20-windows-remote-validation-checklist.md)
- [2026-04-22-windows-interactive-install-validation.md](C:/Users/USER/Agent_Gongmu/Agent_Gongmu_Codex/docs/operations/2026-04-22-windows-interactive-install-validation.md)

### F1. GUI 설치 확인

- [ ] 상태: `pass / partial / fail / skip`

기록:

- 사용한 installer:
- install dir:
- 창 표시 여부:
- bundled sidecar 경로 존재 여부:

### F2. GUI 실행 확인

- [ ] 상태: `pass / partial / fail / skip`

기록:

- 설치된 앱에서 sidecar 시작 성공 여부:
- 연결 상태 보였는지:
- 이상 여부:

### F3. GUI uninstall 확인

- [ ] 상태: `pass / partial / fail / later / skip`

기록:

- uninstall 전 앱 종료했는지:
- install dir 제거 여부:
- 남은 파일/폴더:
- uninstall 시 앱/sidecar가 살아 있었는지:

## 최종 요약

마지막에는 이것만 요약하면 된다.

- 총 `pass`:
- 총 `partial`:
- 총 `fail`:
- 총 `later`:
- 가장 큰 blocker 3개:
- 거슬리지만 막히진 않는 문제 3개:
- 다음에 가장 먼저 고칠 배치:

## 회신 템플릿

아래 형식으로만 보내줘도 충분하다.

```text
[기준선]
- verify:all:
- desktop:smoke:nsis:

[A. 핵심 업무 흐름]
- A1:
- A2:
- A3:
- A4:
- A5:
- A6:

[B. Anything / 검색 / 문서작성 연결]
- B1:
- B2:
- B3:
- B4:

[C. 내 지식폴더]
- C1:
- C2:
- C3:

[D. 파일정리 / 승인 / 롤백]
- D1:
- D2:
- D3:

[E. 런타임 / 승인 / 실행기록]
- E1:
- E2:
- E3:
- E4:

[F. Windows GUI / 설치]
- F1:
- F2:
- F3:

[요약]
- pass:
- partial:
- fail:
- later:
- blocker:
- non-blocking:
- fix-first batch:
```
