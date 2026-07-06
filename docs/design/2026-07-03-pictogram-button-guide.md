# 픽토그램 버튼 가이드 (2026-07-03)

Gongmu 데스크톱 앱의 텍스트+박스 버튼을 픽토그램(아이콘) 버튼으로 전환하기 위한 1단계 산출물 가이드.
기존 Codex 스타일 시각 언어(라이트 글래스 패널, 모노톤 잉크 `#111214`, 그린 액센트 `rgba(31,107,85,*)`, radius 12–24, Segoe UI Variable/Malgun Gothic)는 그대로 유지한다.

- 아이콘 자산: `apps/desktop/public/icons/action/` (25종 × 기본/인버스 = 50개 SVG)
- CSS 시스템: `apps/desktop/src/styles.css` 하단 "Pictogram icon-button system" 블록
- 2단계(app.tsx 일괄 치환)는 별도 작업. 기존 `.topbar-icon-button`, `.context-pane__control-icon`, `.feature-rail__item`, `.chat-composer__plus-button` 클래스는 마이그레이션 전까지 그대로 둔다.

## 1. 아이콘 규격

- viewBox `0 0 24 24`, 스트로크 2px, `stroke-linecap/linejoin: round`, 단색.
- 기본색 잉크 `#111214` (기존 panel-open/close/refresh.svg의 `#171717`과 시각적으로 동일 계열).
- `<img>`로 소비되므로 `currentColor` 불가 → 어두운 배경(primary/accent)용으로 `<이름>-inverse.svg`(흰색 `#ffffff`) 별도 제공.
- `play`, `stop`, `send`는 기존 send.svg와 동일하게 면(fill) 픽토그램, 나머지는 선(stroke) 픽토그램.

## 2. 아이콘 인벤토리

| 파일 (`/icons/action/`) | 의미 | 권장 사용처 |
|---|---|---|
| `link.svg` | 파일/자료 연결 | 업무대화 "파일 연결", 세션-참고자료 연결 |
| `attach.svg` | 파일 첨부 (클립) | 채팅 컴포저 첨부, 보고서 관련 파일 첨부 |
| `doc-forward.svg` | 문서작성으로 이어가기 | 업무대화·검색결과 → 문서작성 전환 액션 |
| `knowledge.svg` | 지식 반영 | "이 세션 지식 반영", 지식 후보 승격 |
| `calendar-link.svg` | 일정 연결 | 세션-일정 연결, 연결 일정 열기 |
| `play.svg` | 작업 시작 (면형) | HWPX "작업 시작", "스캔 시작", 엔진 시작 |
| `stop.svg` | 중지 (면형) | 작업 중지, 인덱싱 취소 요청 |
| `rebuild.svg` | 재색인/재빌드 | "강제 재색인", Content Base 재생성 |
| `search.svg` | 검색 | "검색 실행", 세션/일정 검색 |
| `download.svg` | 내려받기 | 산출물 다운로드, 덤프 저장 |
| `copy.svg` | 복사 | "경로 복사", 검색어 복사, 덤프 경로 복사 |
| `edit.svg` | 편집 | 일정 편집, 세션 제목 수정, 초안 수정 |
| `check.svg` | 확인/저장 | "일정 수정 저장", 승인, 적용 완료 |
| `close.svg` | 닫기/제거 | 팝오버·미리보기 닫기, 첨부 제거 |
| `plus.svg` | 추가 | 새 세션, 새 일정 입력 전환 |
| `minus.svg` | 축소/제거(소극적) | 항목 접기, 연결 해제 |
| `folder-open.svg` | 폴더/대상 열기 | "폴더 열기", 결과 위치 열기, Anything 열기 |
| `preview.svg` | 미리보기/상세 | "상세보기", "덤프 뷰어 열기", 이미지 미리보기 |
| `sparkle.svg` | AI 생성 | Content Base 생성, 근거 답변 생성, LLM 액션 |
| `list.svg` | 구조/목록 | 문서 구조 보기, 양식(칩) 선택, 로그 목록 |
| `settings-sliders.svg` | 설정 | 설정 진입, 상세 옵션 토글 |
| `send.svg` | 보내기 (면형) | 채팅 "보내기" — 화면당 유일 accent 버튼 |
| `image.svg` | 이미지 첨부 | 이미지 첨부·이미지 미리보기 트리거 |
| `file.svg` | 파일 | "파일 열기", 파일 항목 표시 |
| `question.svg` | 사용법/도움말 | 사용법 안내, Anything 설치 안내 열기 |

각 파일은 `-inverse.svg` 흰색 변형이 있다 (예: `send-inverse.svg`). `--primary`/`--accent` 버튼에서는 반드시 인버스 변형을 사용한다.

## 3. CSS 클래스 시스템

| 클래스 | 크기/모양 | 용도 |
|---|---|---|
| `.icon-button` | 38px, radius 12, 고스트 배경 `rgba(17,18,20,.05)` → hover `.09` | 기본 아이콘 버튼 |
| `.icon-button--sm` | 30px, 아이콘 16px | 목록 행 내부, 첨부 제거 등 밀도 높은 곳 |
| `.icon-button--lg` | 46px, 아이콘 24px | 컴포저 주요 액션, 터치 우선 영역 |
| `.icon-button--primary` | 잉크 `#111214` 채움, 흰 아이콘(`-inverse`) | 화면의 확정 액션(저장/시작) |
| `.icon-button--accent` | 그린 `#1f6b55` 채움, 흰 아이콘(`-inverse`) | 화면당 1개의 대표 액션 (예: 보내기) |
| `.icon-button--danger` | 붉은 기 옅은 배경 | 되돌리기 어려운 액션의 보조 표시 (텍스트 유지 원칙 참고) |
| `.icon-button--labeled` | 세로 아이콘 22px + 라벨 10.5px, `.feature-rail__item` 톤 | 칩 그리드 (양식 선택, 기능 레일류) |
| `.icon-button__badge` | 우상단 카운트 버블 (그린) | 연결 파일 2, 첨부 개수 등 |
| `.button-with-icon` | 인라인 아이콘 18px + 텍스트 | 텍스트를 유지해야 하는 주요 CTA |
| 상태 | `:focus-visible` 2px 그린 아웃라인, `:disabled` opacity .55, `.is-active` 진한 배경 | 전 변형 공통 |

### JSX 사용 예 (AssetIcon 기준)

```tsx
// 기본: 아이콘 전용 버튼 — aria-label + title 필수
<button
  type="button"
  className="icon-button"
  aria-label="파일 연결"
  title="파일 연결"
  onClick={handleLinkFiles}
>
  <AssetIcon src="/icons/action/link.svg" />
</button>

// accent(화면당 1개) — 인버스 아이콘 사용
<button
  type="button"
  className="icon-button icon-button--lg icon-button--accent"
  aria-label="보내기"
  title="보내기 (Enter)"
  disabled={sending}
>
  <AssetIcon src="/icons/action/send-inverse.svg" />
</button>

// 카운트 배지 — 배지는 장식이므로 개수를 aria-label에 포함
<button
  type="button"
  className="icon-button"
  aria-label={`연결 파일 ${linkedFiles.length}개`}
  title={`연결 파일 ${linkedFiles.length}개`}
>
  <AssetIcon src="/icons/action/link.svg" />
  {linkedFiles.length > 0 ? (
    <span className="icon-button__badge">{linkedFiles.length}</span>
  ) : null}
</button>

// 라벨형 칩 (양식 선택 등 그리드)
<button
  type="button"
  className="icon-button--labeled is-active"
  aria-label="업로드된 양식 선택"
  title="업로드된 양식 선택"
>
  <AssetIcon src="/icons/action/list.svg" />
  <span className="icon-button__label">양식 선택</span>
</button>

// 텍스트 유지 CTA — 아이콘은 보조
<button type="button" className="button-with-icon" title="HWPX 생성 작업을 시작합니다">
  <AssetIcon src="/icons/action/play-inverse.svg" />
  작업 시작
</button>
```

## 4. Do / Don't

**Do**
- 아이콘 전용 버튼에는 **항상** `aria-label`과 `title`(툴팁)을 함께 지정한다. `AssetIcon`의 `<img>`는 `aria-hidden`이므로 버튼 자체가 이름을 가져야 한다.
- accent(그린) 버튼은 **화면당 최대 1개** — 그 화면의 대표 액션(업무대화의 "보내기", 문서작성의 "작업 시작")에만 쓴다.
- `--primary`/`--accent` 채움 버튼에서는 반드시 `-inverse.svg` 아이콘을 쓴다 (기본 잉크 아이콘은 어두운 배경에서 보이지 않음).
- 같은 의미에는 같은 아이콘을 앱 전체에서 재사용한다 (열기=folder-open, 상세=preview, 복사=copy).
- 상태 토글 버튼(패널 접기 등)은 `.is-active`와 `aria-pressed`를 함께 관리한다.

**Don't**
- **파괴적 액션(일정 삭제, 되돌리기, 적용 승인)은 아이콘 단독으로 만들지 않는다** — 텍스트를 유지하고 `.button-with-icon`(+필요시 `--danger` 톤)을 쓴다.
- 한 툴바에 서로 다른 크기 변형(sm/기본/lg)을 섞지 않는다.
- 배지 자체에 클릭 핸들러를 달지 않는다 (`pointer-events: none`).
- 기존 `.topbar-icon-button`, `.context-pane__control-icon` 등을 이번 단계에서 삭제·수정하지 않는다 (2단계 마이그레이션 대상).
- 채팅 본문 등 텍스트 흐름 안에서 아이콘 버튼을 인라인으로 끼워 넣지 않는다 — 툴바/액션 행에만 배치한다.

## 5. 현행 텍스트 버튼 → 픽토그램 매핑 (2단계 치환 후보)

`app.tsx` 라벨 grep 기준. 라인 번호는 2026-07-03 시점 참고용.

| # | 화면 | 현행 버튼 라벨 (app.tsx) | 대상 아이콘 | 권장 클래스 |
|---|---|---|---|---|
| 1 | 업무대화 | 파일 연결 (~5059) | `link.svg` | `.icon-button` + `__badge`(연결 수) |
| 2 | 업무대화 | 문서작성으로 이어가기 (~5062) | `doc-forward.svg` | `.icon-button` |
| 3 | 업무대화 | 이 세션 지식 반영 (~5081) | `knowledge.svg` | `.icon-button` |
| 4 | 업무대화 | 연결 일정 열기 / 선택 일정과 연결 (~5056) | `calendar-link.svg` | `.icon-button` |
| 5 | 업무대화 | 보내기 (~5210) | `send-inverse.svg` | `.icon-button--lg --accent` (화면 유일 accent) |
| 6 | 업무대화 | 파일 첨부 + 버튼 (~5183) | `attach.svg` | `.icon-button--lg` (기존 plus-button 대체) |
| 7 | 업무대화 | {파일} 첨부 제거 (~5162) | `close.svg` | `.icon-button--sm` |
| 8 | 업무대화 | 미리보기 닫기 (~5267) | `close.svg` | `.icon-button--sm` |
| 9 | 업무대화 | 파일 열기 (~5425) | `file.svg` | `.icon-button--sm` |
| 10 | 업무대화 | 경로 복사 (~5435) | `copy.svg` | `.icon-button--sm` |
| 11 | 일정 | 일정 등록 (~4899) | `plus.svg` | `.button-with-icon` (텍스트 유지) |
| 12 | 일정 | 일정 수정 저장 (~4794) | `check.svg` | `.button-with-icon` |
| 13 | 일정 | 새 일정 입력으로 전환 (~4806) | `plus.svg` | `.icon-button` |
| 14 | 일정 | 연결 세션 열기 / 만들기 (~4815) | `calendar-link.svg` | `.icon-button` |
| 15 | 일정 | 일정 삭제 (~4825) | `close.svg` | `.button-with-icon --danger` (파괴적 → 텍스트 유지) |
| 16 | 일정(예정 목록) | 업무대화 열기 (~4935) | `folder-open.svg` | `.icon-button--sm` |
| 17 | 일정(예정 목록) | 문서 초안 시작 (~4938) | `doc-forward.svg` | `.icon-button--sm` |
| 18 | 문서작성 | 작업 시작 (HWPX, ~6006) | `play-inverse.svg` | `.button-with-icon` (대표 CTA, 텍스트 유지) |
| 19 | 문서작성 | 업로드된 양식 선택 (~5978) | `list.svg` | `.icon-button--labeled` 칩 그리드 |
| 20 | 문서작성(산출물) | 파일 열기 (~6043) | `file.svg` | `.icon-button` |
| 21 | 문서작성(산출물) | 폴더 열기 (~6050) | `folder-open.svg` | `.icon-button` |
| 22 | 지식 > 색인 처리 | 스캔 시작 (~6654) | `play.svg` | `.icon-button` |
| 23 | 지식 > 색인 처리 | 강제 재색인 (~6670) | `rebuild.svg` | `.icon-button` |
| 24 | 지식 > 색인 처리 | 취소 / 취소 요청 (~6839, ~8333) | `stop.svg` | `.button-with-icon --danger` (텍스트 유지) |
| 25 | 지식 > 색인 처리 | 덤프 뷰어 열기/닫기 (~6797) | `preview.svg` / `close.svg` | `.icon-button` (토글, `.is-active`) |
| 26 | 지식 > GraphRAG 검색 | 검색 실행 (~6874) | `search.svg` | `.icon-button--accent` (해당 화면 대표 액션) |
| 27 | 지식 | 상세보기 (~7314, ~7415) | `preview.svg` | `.icon-button--sm` |
| 28 | 지식 | 근거 답변 생성 (~3975 인근 액션) | `sparkle.svg` | `.icon-button` |
| 29 | 문서작성 | Content Base 생성/재생성 (~3444) | `sparkle.svg` / `rebuild.svg` | `.button-with-icon` |
| 30 | 파일찾기(Anything) | Anything 열기 요청 (~5499) | `folder-open.svg` | `.button-with-icon` (승인 흐름 → 텍스트 유지) |
| 31 | 파일찾기(Anything) | 설치 안내 열기 (~5485) | `question.svg` | `.icon-button` |
| 32 | 파일찾기(Anything) | 다시 열기 / 승인 후 열기 (~5549) | `folder-open.svg` | `.icon-button--sm` |
| 33 | 상단바/런타임 | 상태 새로고침 (~1999) | `refresh.svg` (기존 자산) | `.icon-button` |
| 34 | 검색 결과 | 문서작성으로 이어가기 (~5602) | `doc-forward.svg` | `.icon-button--sm` |
| 35 | 설정 | 설정 진입/상세 옵션 | `settings-sliders.svg` | `.icon-button` |

## 6. 검증 결과

- SVG 50개 전부 XML 파서(System.Xml) 통과.
- `npm --workspace apps/desktop run build` 그린 (app.tsx 무변경, CSS append-only).
