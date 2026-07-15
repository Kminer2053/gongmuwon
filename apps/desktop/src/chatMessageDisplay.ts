import type { WorkSessionMessageItem } from "./api";

const WAITING_COPY_PATTERNS = [
  /^잠시만 기다려 주세요[.!?。．]*\s*/i,
  /^응답을 준비하는 중입니다[.!?。．]*\s*/i,
];

export function getVisibleMessageText(message: WorkSessionMessageItem) {
  if (message.status === "streaming") {
    // 스트리밍 중에는 지금까지 도착한 토큰을 즉시 노출한다.
    // 첫 토큰이 아직 없을 때만 안내 문구를 보여 준다.
    const streamed = stripStaleWaitingCopy(message.text);
    return streamed.length > 0 ? streamed : "응답을 준비하는 중입니다.";
  }

  if (message.status === "pending") {
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
