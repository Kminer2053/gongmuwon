import type { WorkSessionMessageItem } from "./api";

const WAITING_COPY_PATTERNS = [
  /^잠시만 기다려 주세요[.!?。．]*\s*/i,
  /^응답을 준비하는 중입니다[.!?。．]*\s*/i,
];

export function getVisibleMessageText(message: WorkSessionMessageItem) {
  if (message.status === "pending" || message.status === "streaming") {
    return "응답을 준비하는 중입니다.";
  }

  if (message.role !== "assistant") {
    return message.text;
  }

  return stripStaleWaitingCopy(message.text);
}

const PROVIDER_LABELS: Record<string, string> = {
  "gongmu-skill": "공무 도구",
  "gongmu-system": "공무 알림",
};

const MODEL_LABELS: Record<string, string> = {
  "help.guide": "사용법 안내",
  "intent.plan": "여러 작업 처리",
  "schedule.confirm.request": "일정 등록 확인",
  "schedule.create": "일정 등록",
  "schedule.create.failed": "일정 등록 오류",
  "schedule.delete": "일정 삭제",
  "schedule.list": "일정 조회",
  "document.confirm.request": "문서작성 확인",
  "knowledge.confirm.request": "지식폴더 검색 확인",
  "file.confirm.request": "파일찾기 확인",
  "tool.confirm.rejected": "도구 실행 취소",
  "knowledge.search": "지식폴더 검색",
  "knowledge.search.failed": "지식폴더 검색 오류",
  "file.search": "파일찾기",
  "file.search.failed": "파일찾기 오류",
  "documents.generate": "문서작성",
  "document.create": "문서작성",
  "work_session.turn.blocked": "진행 중인 작업 안내",
};

export function getAssistantSourceLabel(message: WorkSessionMessageItem) {
  if (message.role !== "assistant") {
    return "";
  }

  const provider = message.provider?.trim() || "";
  const model = message.model?.trim() || "";
  if (!provider && !model) {
    return "";
  }

  const providerLabel = PROVIDER_LABELS[provider] ?? provider;
  const modelLabel = formatAssistantModelLabel(model);
  return [providerLabel, modelLabel].filter(Boolean).join(" / ");
}

function formatAssistantModelLabel(model: string) {
  if (!model) {
    return "";
  }

  return model
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => MODEL_LABELS[item] ?? item)
    .filter((item, index, items) => items.indexOf(item) === index)
    .join(" · ");
}

export function stripStaleWaitingCopy(text: string) {
  return WAITING_COPY_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "").trimStart(),
    text,
  );
}
