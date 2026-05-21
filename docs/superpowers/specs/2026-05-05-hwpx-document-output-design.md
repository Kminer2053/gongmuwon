# 2026-05-05 HWPX 문서작성 산출 설계

## 배경

공무 워크스페이스의 문서작성 원칙은 `Content Base(Markdown) -> Template -> 최종 산출`이다. 현재 구현은 Content Base를 만든 뒤 최종 저장 단계에서 Markdown 파일을 그대로 `documents/outputs`에 복사한다. 사용자는 공공기관 실무 문서의 최종 산출물이 HWPX가 되기를 원하며, 참고 리포지터리로 `Kminer2053/HwpxMaker`를 제시했다.

HwpxMaker는 JSON 입력을 받아 `officialMemo`, `onePageReport`, `fullReport`, `email` 중 하나를 선택하고 `python-hwpx`로 HWPX와 검토용 Markdown을 함께 만든다. 다만 리포지터리에 명시 라이선스 파일이 없으므로, 코드를 그대로 복사해 내장하지 않고 공개된 입출력 구조와 문서작성 흐름을 참고해 공무 sidecar 내부에 호환 어댑터를 구현한다.

참고:

- `https://github.com/Kminer2053/HwpxMaker`
- `skills/korean-public-doc-writer/generate_hwpx_report.py`
- `skills/korean-public-doc-writer/SKILL.md`

## 목표

- 최종 저장 적용 결과가 `.hwpx`가 되도록 변경한다.
- 같은 이름의 검토용 `.md`를 함께 생성한다.
- Content Base Markdown은 계속 초안 정본으로 유지한다.
- 기존 승인 요청, 승인 후 적용, 중복 파일명 버전 관리, Windows 금지 문자 sanitizing 흐름은 유지한다.

## 아키텍처

새 파일 `services/sidecar/src/gongmu_sidecar/hwpx_writer.py`를 추가한다.

역할:

- Content Base Markdown과 메타데이터를 HwpxMaker 호환 입력 dict로 변환한다.
- `report`, `meeting`, `review` 템플릿 키와 사용자가 입력한 목적 문구를 `officialMemo`, `onePageReport`, `fullReport`, `email` 중 하나로 매핑한다.
- `python-hwpx`의 `HwpxDocument`를 사용해 문단 단위 HWPX를 생성한다.
- 같은 내용의 검토용 Markdown을 함께 쓴다.

`DocumentManager.apply_final_document_output()`은 기존 Markdown 복사 대신 `write_public_hwpx_document()`를 호출한다. DB에는 최종 HWPX 경로만 `artifact_path`로 저장하고, API 응답의 `artifact`에는 주 산출물 경로와 보조 Markdown 경로를 같이 담는다.

## 문서 포맷 매핑

- `purpose` 또는 제목에 `시행`, `공문`, `지시`, `협조요청`이 있으면 `officialMemo`
- `purpose` 또는 제목에 `이메일`, `메일`, `회신`이 있으면 `email`
- `template_key == meeting`이면 `fullReport`
- `template_key == review`이면 `onePageReport`
- 기본 `report`는 `onePageReport`

## 오류 처리

- `python-hwpx` import 또는 HWPX 생성 실패 시 최종 적용은 실패해야 한다.
- 실패한 적용 요청은 `pending` 상태로 남겨 사용자가 의존성/환경을 고친 뒤 다시 적용할 수 있게 한다.
- 기존 승인 티켓 상태는 되돌리지 않는다.

## 테스트 기준

- 최종 저장 적용 후 `.hwpx` 파일이 생성된다.
- 같은 이름의 `.md` 검토본이 생성된다.
- HWPX 파일 크기가 0보다 크다.
- Windows 금지 문자는 제거되고 확장자는 `.hwpx`가 된다.
- 동일 출력 이름은 `name.hwpx`, `name-2.hwpx`로 버전 관리된다.
- API 응답에 `artifact.markdown_path`가 포함된다.
- 기존 sidecar 전체 테스트가 통과한다.

## 후속 범위

- 기관 고유 `.hwpx`/`.hwtx` 템플릿 업로드 및 적용
- 표, 결재란, 수신/참조, 붙임 목록의 정교한 HWPX 레이아웃
- 문서작성 화면에서 공문/보고서/이메일 포맷을 직접 선택하는 UI
- LLM 기반 Content Base 품질 개선과 문장 교정
