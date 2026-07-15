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

  it("shows accumulated tokens while streaming instead of the placeholder", () => {
    expect(
      getVisibleMessageText(
        message({
          status: "streaming",
          text: "지금까지 도착한",
        }),
      ),
    ).toBe("지금까지 도착한");
  });

  it("keeps the placeholder while streaming before the first token arrives", () => {
    expect(
      getVisibleMessageText(
        message({
          status: "streaming",
          text: "",
        }),
      ),
    ).toBe("응답을 준비하는 중입니다.");
  });

  it("strips stale waiting copy from streamed text", () => {
    expect(
      getVisibleMessageText(
        message({
          status: "streaming",
          text: "응답을 준비하는 중입니다.\n\n첫 문장이 도착했습니다.",
        }),
      ),
    ).toBe("첫 문장이 도착했습니다.");
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
