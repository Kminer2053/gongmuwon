import type { MenuKey } from "../store";

/**
 * W6: 앱 이용팁 단일 원천.
 *
 * - 원본 문서: docs/manual/2026-07-05-app-tips.md (같은 팁을 사람 읽는 형태로 정리)
 * - 소비처: 홈 "앱 이용팁" 카드, 업무대화 입력 대기 안내, 온보딩, 설치 프로그램.
 * - 규칙: 코드에서 실제로 동작이 확인된 기능만 적는다. 과장 금지.
 *   회전은 반드시 dailyTipIndex(날짜 기반)로 — Math.random 금지.
 */

export type AppTipCategory =
  | "chat"
  | "schedule"
  | "documents"
  | "knowledge"
  | "logs"
  | "settings";

export type AppTip = {
  /** 문서·테스트에서 팁을 가리키는 안정 키 */
  id: string;
  category: AppTipCategory;
  /** 한 줄 실전 팁 문구 */
  text: string;
  /** [열기] 버튼으로 이동할 메뉴 */
  menu: MenuKey;
  /** 업무대화 입력창에 채워 넣을 예시 문구 — chat 카테고리 중 "말로 시키는" 팁에만 존재 */
  chatExample?: string;
};

export const APP_TIPS: readonly AppTip[] = [
  {
    id: "chat-clipboard-image",
    category: "chat",
    text: "화면을 캡처한 뒤 업무대화 입력창에 Ctrl+V를 누르면 이미지가 바로 첨부됩니다.",
    menu: "chat",
  },
  {
    id: "chat-schedule-create",
    category: "chat",
    text: "날짜·시간을 넣어 말하면 업무대화가 일정을 바로 등록합니다.",
    menu: "chat",
    chatExample: "내일 오전 10시 주간회의 일정 등록해줘",
  },
  {
    id: "chat-file-link-doc",
    category: "chat",
    text: "[파일 연결]로 자료를 세션에 묶은 뒤 보고서를 요청하면 연결한 파일이 근거로 쓰입니다.",
    menu: "chat",
    chatExample: "연결한 파일을 바탕으로 보고서 초안 작성해줘",
  },
  {
    id: "chat-knowledge-evidence",
    category: "chat",
    text: "지식폴더를 색인해 두면 업무대화 답변에 출처 칩(원본 열기·경로 복사)이 함께 붙습니다.",
    menu: "chat",
    chatExample: "지식폴더에서 예산 편성 근거 찾아줘",
  },
  {
    id: "chat-schedule-list",
    category: "chat",
    text: "등록된 일정이 궁금하면 업무대화에서 바로 물어볼 수 있습니다.",
    menu: "chat",
    chatExample: "이번 주 일정 알려줘",
  },
  {
    id: "chat-enter-send",
    category: "chat",
    text: "Enter는 전송, Shift+Enter는 줄바꿈입니다. 파일은 입력창에 드래그해 놓아도 첨부됩니다.",
    menu: "chat",
  },
  {
    id: "chat-session-knowledge",
    category: "chat",
    text: "업무대화 툴바의 [이 세션 지식 반영]을 누르면 대화 내용이 지식위키에 바로 축적됩니다.",
    menu: "chat",
  },
  {
    id: "chat-continue-to-documents",
    category: "chat",
    text: "업무대화 툴바의 [문서작성으로 이어가기]로 현재 세션 대화를 문서 입력으로 넘길 수 있습니다.",
    menu: "chat",
  },
  {
    id: "chat-document-create",
    category: "chat",
    text: "'보고서·공문·시행문·이메일' 같은 문서 종류와 '작성·정리'를 함께 말하면 업무대화가 문서작성을 실행합니다.",
    menu: "chat",
    chatExample: "회의 내용을 1페이지 보고서로 작성해줘",
  },
  {
    id: "chat-document-format",
    category: "chat",
    text: "시행문·공문·1페이지 보고서·풀버전 보고서·이메일 중 원하는 양식을 말하면 그 형식으로 만들어 줍니다.",
    menu: "chat",
    chatExample: "이 내용을 시행문으로 작성해줘",
  },
  {
    id: "chat-schedule-delete",
    category: "chat",
    text: "'일정'과 '삭제·취소'를 함께 말하면 해당 일정을 지웁니다.",
    menu: "chat",
    chatExample: "내일 주간회의 일정 삭제해줘",
  },
  {
    id: "chat-multi-intent",
    category: "chat",
    text: "한 문장에 여러 요청을 담으면 순서대로 처리합니다 — 일정 등록과 문서작성을 한 번에.",
    menu: "chat",
    chatExample: "내일 오후 2시 회의 등록하고 그 내용으로 보고서 작성해줘",
  },
  {
    id: "chat-feature-help",
    category: "chat",
    text: "'○○ 어떻게 해?'처럼 물으면 업무대화·일정·문서작성·지식폴더·실행기록·환경설정 사용법을 안내합니다.",
    menu: "chat",
    chatExample: "문서작성 어떻게 하는지 알려줘",
  },
  {
    id: "schedule-reminder",
    category: "schedule",
    text: "일정에 사전 알림(10분~하루 전)을 걸어 두면 시작 전에 홈과 일정 화면에서 알려줍니다.",
    menu: "schedule",
  },
  {
    id: "schedule-session-link",
    category: "schedule",
    text: "일정에 업무대화 세션을 연결하면 홈 '오늘 일정' 카드에서 [세션 열기]로 바로 이어집니다.",
    menu: "schedule",
  },
  {
    id: "documents-custom-form",
    category: "documents",
    text: "문서작성의 임의형식 칩에 HWPX/HWTX 양식을 올리면 표·로고·서식을 보존한 채 빈칸을 채웁니다.",
    menu: "documents",
  },
  {
    id: "documents-revise",
    category: "documents",
    text: "문서 초안이 마음에 안 들면 수정 지시에 자연어로 적어 반복 수정할 수 있습니다. 실패해도 기존 구조는 유지됩니다.",
    menu: "documents",
  },
  {
    id: "knowledge-taxonomy-wizard",
    category: "knowledge",
    text: "분류체계 마법사가 지식폴더를 분석해 업무 분류 트리를 제안합니다. 검토·편집한 뒤 적용하세요.",
    menu: "knowledge",
  },
  {
    id: "knowledge-grounded-answer",
    category: "knowledge",
    text: "내 지식폴더 위키 탭의 근거 답변은 출처와 함께 답하고, 결과를 업무대화로 이어서 검토할 수 있습니다.",
    menu: "knowledge",
  },
  {
    id: "logs-history",
    category: "logs",
    text: "실행기록에서 언제 무엇이 실행됐는지 입력·출력과 함께 확인할 수 있습니다.",
    menu: "logs",
  },
  {
    id: "settings-profiles",
    category: "settings",
    text: "환경설정에서 LLM 프로필을 여러 개 저장해 두고 상황에 맞게 전환할 수 있습니다.",
    menu: "settings",
  },
] as const;

/** 업무대화 입력 대기 안내에 쓰는 예시 문구 팁만 추린다. */
export const CHAT_EXAMPLE_TIPS: readonly AppTip[] = APP_TIPS.filter((tip) => Boolean(tip.chatExample));

/**
 * 팁별 안내 일러스트 (apps/desktop/public/illustrations — 폐쇄망용 로컬 SVG).
 * 캡션 문구가 SVG 안에 포함되어 있으므로 카드 텍스트와 중복 서술하지 않는다.
 */
const TIP_ILLUSTRATIONS: Readonly<Record<string, string>> = {
  "chat-clipboard-image": "/illustrations/tip-paste-image.svg",
  "chat-schedule-create": "/illustrations/tip-chat-schedule.svg",
  "chat-file-link-doc": "/illustrations/tip-file-link.svg",
  "chat-knowledge-evidence": "/illustrations/tip-knowledge-wiki.svg",
  "chat-continue-to-documents": "/illustrations/tip-documents-flow.svg",
  "schedule-session-link": "/illustrations/tip-chat-schedule.svg",
  "documents-custom-form": "/illustrations/tip-custom-form.svg",
  "documents-revise": "/illustrations/tip-documents-flow.svg",
  "knowledge-taxonomy-wizard": "/illustrations/tip-knowledge-wiki.svg",
  "knowledge-grounded-answer": "/illustrations/tip-knowledge-wiki.svg",
};

export function tipIllustration(tip: AppTip): string | null {
  return TIP_ILLUSTRATIONS[tip.id] ?? null;
}

/**
 * 날짜 기반 결정적 회전 인덱스. 같은 날에는 항상 같은 팁이 나오고,
 * 날이 바뀌면 다음 팁으로 넘어간다. (로컬 날짜 기준 — Math.random 금지)
 */
export function dailyTipIndex(count: number, now = new Date()): number {
  if (count <= 0) {
    return 0;
  }
  const seed = now.getFullYear() * 372 + now.getMonth() * 31 + (now.getDate() - 1);
  return ((seed % count) + count) % count;
}
