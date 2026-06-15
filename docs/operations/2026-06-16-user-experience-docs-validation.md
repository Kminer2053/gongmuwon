# 사용자 경험 문서 및 화면 증거 점검

## 점검 목적

G09 `사용자 경험과 화면 검증` 게이트 중 README, 사용자 매뉴얼, 사용자 노출 용어가 현재 앱 방향과 일치하는지 확인했다.

정식 명칭은 `로컬 AI에이전트 워크플레이스 : 공무원`으로 확인했다.

## 반영한 수정

- `README.md`의 기능 설명 순서를 `업무대화, 일정, 파일찾기, 지식폴더, 문서작성, 실행기록`으로 정리했다.
- `apps/desktop/src/llmProviders.ts`의 Ollama 안내 문구에서 사용자 노출 기술 용어 `sidecar`를 `업무엔진`으로 변경했다.

## 정적 검증

다음 항목을 파일 내용 기준으로 확인했다.

- `README.md`에 정식 명칭이 포함된다.
- `README.md`에 대화 중심 기능 순서가 포함된다.
- `README.md`에 이전 명칭 `에이전트 공무 워크스페이스`가 남아 있지 않다.
- `README.md`에 이전 설명 `공공기관용 개인 업무 에이전트`가 남아 있지 않다.
- `docs/user-manual/gongmu-user-manual.html`에 정식 명칭이 포함된다.
- `docs/user-manual/assets`의 매뉴얼 이미지 9개가 모두 존재한다.
- `apps/desktop/src/llmProviders.ts`에는 사용자 안내 문구로 `sidecar`가 남아 있지 않다.

README의 `sidecar:serve` 명령과 `services/sidecar` 경로 표기는 개발자 실행 명령/저장소 경로이므로 사용자 화면 용어 잔존으로 보지 않는다.

## 브라우저 검증 한계

Codex in-app Browser로 `file:///C:/Users/USER/Agent_Gongmu/Agent_Gongmu_Codex/docs/user-manual/gongmu-user-manual.html`을 직접 열어 렌더링을 확인하려 했으나, Browser URL policy가 `file://` 접근을 차단했다. 정책상 우회하지 않고 정적 HTML/자산 검증으로 대체했다.

따라서 이 문서는 README/매뉴얼 최신성 확인 증거로 사용하되, 실제 앱 최신 화면 캡처 갱신은 별도 G09 follow-up으로 남긴다.

## 실행 검증

```powershell
npm.cmd run desktop:test
```

결과:

- Test Files: `22 passed`
- Tests: `85 passed`
- 주요 확인 범위:
  - 앱 셸, 우측 패널, 업무엔진 팝오버
  - 일정 캘린더와 알림 팝업
  - 파일찾기, 지식폴더, GraphRAG UI
  - 문서작성 레이아웃
  - 환경설정/LLM 공급자 설정
  - 업무대화 입력/첨부/렌더링

## 판정

README와 사용자 매뉴얼의 명칭/설명 최신성 점검은 완료했다. G09 전체 게이트는 최신 앱 기준 핵심 화면 evidence 갱신이 남아 있으므로 `partial`을 유지한다.
