# 안내·팁 일러스트 세트

앱 내 사용안내 콘텐츠(홈 이용팁 카드, 최초 실행 튜토리얼, 이용팁 문서, 설치 프로그램)에 쓰는 로컬 SVG 일러스트. 폐쇄망 전제이므로 외부 리소스 참조 금지 — 전부 이 폴더에 번들한다.

## 스타일 토큰 (신규 제작 시 준수)

- viewBox: `0 0 320 200` (팁/튜토리얼 공통), 하단 2줄 캡션 포함
- 패널: fill `#f6f8f5` / stroke `#e3e8e0` 1.5px, radius 10–16
- 잉크(주 선): `#2b2f2a` 2px round
- 포인트: 녹색 `#3d7a4f` (진행·확정·성공), 앰버 `#d9a441` (폴더·원본·주의)
- 보조: `#b7c0b6`(soft line), `#8a948a`(sub text)
- 텍스트: 본문 11px / 보조 10px, `'Malgun Gothic','Apple SD Gothic Neo',sans-serif`
- 각 SVG는 `role="img"` + 한국어 `aria-label` 필수

## 파일 목록

| 파일 | 용도 | 연결 팁/단계 |
|---|---|---|
| tip-chat-schedule.svg | 대화에서 일정 등록 | 업무대화·일정 팁 |
| tip-paste-image.svg | 클립보드 이미지 붙여넣기 | 업무대화 팁 |
| tip-file-link.svg | 파일 연결로 근거 있는 대화 | 업무대화 팁 |
| tip-documents-flow.svg | 대화→구조→미리보기→HWPX | 문서작성 팁 |
| tip-custom-form.svg | 임의형식 양식 빈칸 채움 | 문서작성 팁 |
| tip-knowledge-wiki.svg | 폴더 지정→위키→근거 답변 | 지식폴더 팁 |
| tutorial-welcome.svg | 튜토리얼 1단계 (6개 메뉴) | FirstRunTutorial |
| tutorial-llm.svg | 튜토리얼 2단계 (LLM 설정) | FirstRunTutorial |
| tutorial-knowledge.svg | 튜토리얼 3단계 (지식폴더) | FirstRunTutorial |
| tutorial-done.svg | 튜토리얼 4단계 (완료) | FirstRunTutorial |

사용 예: `<img src="/illustrations/tip-custom-form.svg" alt="" aria-hidden="true" />` (캡션은 SVG 안에 포함되어 있으므로 카드 텍스트와 중복 금지 — 카드에서는 그림만 쓰고 문구는 tips.ts 원천 사용).

설치 프로그램(NSIS)용 BMP는 이 SVG에서 파생 제작한다 — `scripts/` 쪽 변환 스크립트 참고.
