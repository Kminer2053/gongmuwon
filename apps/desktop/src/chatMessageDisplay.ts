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

export function stripStaleWaitingCopy(text: string) {
  return WAITING_COPY_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "").trimStart(),
    text,
  );
}
