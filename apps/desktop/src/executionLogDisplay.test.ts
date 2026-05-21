import { describe, expect, it } from "vitest";
import type { ExecutionLogItem } from "./api";
import { buildExecutionLogDisplay } from "./executionLogDisplay";

describe("execution log display", () => {
  it("turns settings updates into readable Korean summaries", () => {
    const display = buildExecutionLogDisplay({
      id: "log-1",
      feature: "settings",
      action: "settings.updated",
      status: "success",
      created_at: "2026-05-18T00:00:00Z",
    });

    expect(display.title).toBe("환경설정 저장");
    expect(display.subtitle).toBe("환경설정이 저장되었습니다.");
    expect(display.statusLabel).toBe("성공");
  });

  it("includes LLM failure details without raw feature/action noise", () => {
    const log: ExecutionLogItem = {
      id: "log-2",
      feature: "chat",
      action: "work_session.turn.failed",
      status: "failed",
      created_at: "2026-05-18T00:00:00Z",
      outputs: { error: "LLM server returned no assistant text." },
    };

    const display = buildExecutionLogDisplay(log);

    expect(display.title).toBe("업무대화 응답 실패");
    expect(display.subtitle).toBe("LLM 응답 생성에 실패했습니다.");
    expect(display.detail).toContain("LLM server returned no assistant text.");
    expect(display.subtitle).not.toContain("chat");
  });

  it("maps GraphRAG ingestion run logs to user-facing Korean text", () => {
    const display = buildExecutionLogDisplay({
      id: "log-3",
      feature: "knowledge",
      action: "knowledge.ingest.job.run",
      status: "completed",
      created_at: "2026-05-18T00:00:00Z",
      outputs: { processed_count: 17, failed_count: 0 },
    });

    expect(display.title).toBe("GraphRAG 인덱싱 실행");
    expect(display.subtitle).toBe("GraphRAG 인덱싱 실행 작업이 완료 상태로 기록되었습니다.");
    expect(display.subtitle).not.toContain("knowledge.ingest.job.run");
  });
});
