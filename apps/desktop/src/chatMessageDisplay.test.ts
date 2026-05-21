import { describe, expect, it } from "vitest";
import { getVisibleMessageText } from "./chatMessageDisplay";
import type { WorkSessionMessageItem } from "./api";

function message(overrides: Partial<WorkSessionMessageItem>): WorkSessionMessageItem {
  return {
    id: "message-1",
    session_id: "session-1",
    role: "assistant",
    text: "",
    message_type: "chat",
    status: "completed",
    created_at: "2026-05-18T00:00:00Z",
    ...overrides,
  };
}

describe("getVisibleMessageText", () => {
  it("renders pending messages from status instead of persisted text", () => {
    expect(
      getVisibleMessageText(
        message({
          status: "pending",
          text: "잠시만 기다려 주세요.",
        }),
      ),
    ).toBe("응답을 준비하는 중입니다.");
  });

  it("removes stale waiting copy from completed assistant messages", () => {
    expect(
      getVisibleMessageText(
        message({
          status: "completed",
          text: "잠시만 기다려 주세요.\n\n최종 답변입니다.",
        }),
      ),
    ).toBe("최종 답변입니다.");
  });
});
