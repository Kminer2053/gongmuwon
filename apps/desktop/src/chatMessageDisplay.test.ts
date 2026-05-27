import { describe, expect, it } from "vitest";
import { getAssistantSourceLabel, getVisibleMessageText } from "./chatMessageDisplay";
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

describe("getAssistantSourceLabel", () => {
  it("shows user-friendly tool names instead of internal skill ids", () => {
    expect(
      getAssistantSourceLabel(
        message({
          provider: "gongmu-skill",
          model: "schedule.create",
        }),
      ),
    ).toBe("공무 도구 / 일정 등록");
  });

  it("shows a readable pending schedule confirmation label", () => {
    expect(
      getAssistantSourceLabel(
        message({
          provider: "gongmu-skill",
          model: "schedule.confirm.request",
        }),
      ),
    ).toBe("공무 도구 / 일정 등록 확인");
  });

  it("shows readable pending labels for document, knowledge, and file tools", () => {
    expect(
      getAssistantSourceLabel(
        message({
          provider: "gongmu-skill",
          model: "document.confirm.request, knowledge.confirm.request, file.confirm.request",
        }),
      ),
    ).toBe("공무 도구 / 문서작성 확인 · 지식폴더 검색 확인 · 파일찾기 확인");
  });

  it("summarizes multi-step tool execution without exposing route ids", () => {
    expect(
      getAssistantSourceLabel(
        message({
          provider: "gongmu-skill",
          model: "intent.plan, schedule.create, knowledge.search",
        }),
      ),
    ).toBe("공무 도구 / 여러 작업 처리 · 일정 등록 · 지식폴더 검색");
  });
});
