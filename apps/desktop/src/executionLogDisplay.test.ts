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

  it("maps knowledge wiki ingestion run logs to user-facing Korean text", () => {
    const display = buildExecutionLogDisplay({
      id: "log-3",
      feature: "knowledge",
      action: "knowledge.ingest.job.run",
      status: "completed",
      created_at: "2026-05-18T00:00:00Z",
      outputs: { processed_count: 17, failed_count: 0 },
    });

    expect(display.title).toBe("지식위키 색인 실행");
    expect(display.subtitle).toBe("처리 결과: 완료");
    expect(display.subtitle).not.toContain("knowledge.ingest.job.run");
  });

  it("maps every sidecar-logged action to a Korean title (no raw action id leaks)", () => {
    const actionsAndFeatures: Array<[string, string]> = [
      ["documents.content_base.created", "documents"],
      ["documents.template.uploaded", "documents"],
      ["documents.finalize.requested", "documents"],
      ["documents.finalize.applied", "documents"],
      ["documents.attachments.created", "documents"],
      ["documents.authoring.custom_detect", "documents"],
      ["documents.authoring.custom_fill_applied", "documents"],
      ["documents.authoring.custom_patch_applied", "documents"],
      ["knowledge.source.registered", "knowledge"],
      ["knowledge.source.scanned", "knowledge"],
      ["knowledge.candidate.created", "knowledge"],
      ["knowledge.candidate.approved", "knowledge"],
      ["knowledge.ingest.job.run", "knowledge"],
      ["knowledge.ingest.completed", "knowledge"],
      ["knowledge.wiki.ingest.completed", "knowledge"],
      ["knowledge.wiki.work_page.updated", "knowledge"],
      ["knowledge.wiki.work_page.failed", "knowledge"],
      ["knowledge.taxonomy.interview.saved", "knowledge"],
      ["knowledge.taxonomy.confirmed", "knowledge"],
      ["knowledge.taxonomy.applied", "knowledge"],
      ["knowledge.taxonomy.queue.resolved", "knowledge"],
      ["file_org.apply.requested", "fileorg"],
      ["file_org.apply.committed", "fileorg"],
      ["file_org.rollback.completed", "fileorg"],
      ["work_session.created", "chat"],
      ["work_session.updated", "chat"],
      ["work_session.attachments.created", "chat"],
      ["work_session.file_links.created", "chat"],
      ["work_session.file_link.deleted", "chat"],
      ["work_session.knowledge_context.failed", "chat"],
      ["work_session.turn.failed", "chat"],
      ["settings.updated", "settings"],
      ["settings.llm.test.completed", "settings"],
      ["settings.llm.test.failed", "settings"],
      ["schedule.created", "schedule"],
      ["schedule.updated", "schedule"],
      ["schedule.deleted", "schedule"],
      ["schedule.reminder.triggered", "schedule"],
      ["schedule.reminder.acknowledged", "schedule"],
      ["approval_ticket.decided", "approval"],
      ["files.index.rebuilt", "files"],
      ["job.stale_queued.canceled", "jobs"],
      ["personalization.session_summary.created", "personalization"],
      ["personalization.session_summary.applied", "personalization"],
    ];

    for (const [action, feature] of actionsAndFeatures) {
      const display = buildExecutionLogDisplay({
        id: `log-${action}`,
        feature,
        action,
        status: "success",
        created_at: "2026-05-18T00:00:00Z",
      });

      expect(display.title).not.toBe(action);
      expect(display.title).not.toMatch(/^[a-z_.]+$/);
      expect(/[가-힣]/.test(display.title)).toBe(true);
    }
  });

  it("falls back to a Korean '기타 작업' label with feature name instead of a raw English action id", () => {
    const display = buildExecutionLogDisplay({
      id: "log-unmapped",
      feature: "knowledge",
      action: "knowledge.some_future_action.done",
      status: "success",
      created_at: "2026-05-18T00:00:00Z",
    });

    expect(display.title).toBe("기타 작업(지식폴더)");
    expect(display.title).not.toContain("knowledge.some_future_action.done");
  });

  it("falls back to a Korean '기타 상태' label instead of a raw English status", () => {
    const display = buildExecutionLogDisplay({
      id: "log-unmapped-status",
      feature: "settings",
      action: "settings.updated",
      status: "some_future_status",
      created_at: "2026-05-18T00:00:00Z",
    });

    expect(display.statusLabel).toBe("기타 상태");
    expect(display.statusLabel).not.toBe("some_future_status");
  });

  it("renders succeeded/canceled/partial statuses in Korean for jobs and ingestion logs", () => {
    expect(
      buildExecutionLogDisplay({
        id: "log-succeeded",
        feature: "documents",
        action: "documents.content_base.created",
        status: "succeeded",
        created_at: "2026-05-18T00:00:00Z",
      }).statusLabel,
    ).toBe("성공");

    expect(
      buildExecutionLogDisplay({
        id: "log-canceled",
        feature: "jobs",
        action: "job.stale_queued.canceled",
        status: "canceled",
        created_at: "2026-05-18T00:00:00Z",
      }).statusLabel,
    ).toBe("취소됨");

    expect(
      buildExecutionLogDisplay({
        id: "log-partial",
        feature: "knowledge",
        action: "knowledge.ingest.completed",
        status: "partial",
        created_at: "2026-05-18T00:00:00Z",
      }).statusLabel,
    ).toBe("부분 완료");
  });
});
