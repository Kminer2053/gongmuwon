import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: vi.fn(async () => ({
    available: true,
    mode: "tauri",
    sidecar_url: "http://127.0.0.1:8765",
    anything_available: true,
    anything_mode: "external_app_detected",
    anything_path: "C:/Users/USER/AppData/Local/Anything/docufinder.exe",
    anything_autopaste_enabled: false,
    running: true,
    managed: true,
    auto_restart_recommended: false,
    log_path: "/tmp/gongmu-workspace/logs/sidecar-runtime.log",
    detail: "managed sidecar running",
  })),
  startDesktopSidecar: vi.fn(),
  stopDesktopSidecar: vi.fn(),
  restartDesktopSidecar: vi.fn(),
  pickDirectory: vi.fn(async () => null),
  launchAnythingQuery: vi.fn(async () => undefined),
  openExternalTarget: vi.fn(async () => undefined),
  copyTextToClipboard: vi.fn(async () => undefined),
}));

import { App } from "./app";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("session to documents workflow", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = String(input);

        if (url.endsWith("/health")) {
          return jsonResponse({
            status: "ok",
            workspace_root: "/tmp/gongmu-workspace",
            database: "/tmp/gongmu-workspace/db/gongmu.db",
          });
        }

        if (url.endsWith("/api/settings")) {
          return jsonResponse({
            defaults: {
              llm_mode: "local_first",
              llm_provider: "openai_compatible",
              llm_model: "gpt-4.1-mini",
              llm_api_key: null,
              llm_site_url: null,
              llm_application_name: null,
              anything_launch_mode: "external_app_preferred",
              default_template_key: "report",
              internal_api_base_url: null,
              personalization_apply_mode: "approval_required",
              profiles: undefined,
            },
            paths: {
              workspace_root: "/tmp/gongmu-workspace",
              database: "/tmp/gongmu-workspace/db/gongmu.db",
              knowledge_root: "/tmp/gongmu-workspace/knowledge",
              documents_root: "/tmp/gongmu-workspace/documents",
              personalization_root: "/tmp/gongmu-workspace/personalization",
            },
          });
        }

        if (url.endsWith("/api/work-sessions")) {
          return jsonResponse({
            items: [
              {
                id: "session-1",
                title: "주간 보고 작업",
                schedule_id: "schedule-1",
                status: "open",
                created_at: "2026-05-06T09:00:00+09:00",
                messages: [
                  {
                    id: "message-1",
                    session_id: "session-1",
                    role: "assistant",
                    text: "보고서 목차를 먼저 정리하겠습니다.\n- 파일 열기: C:/Docs/weekly-report.md\n- 폴더 열기: C:/Docs",
                    message_type: "chat",
                    status: "completed",
                    created_at: "2026-05-06T09:05:00+09:00",
                  },
                ],
              },
            ],
          });
        }

        if (url.endsWith("/api/work-sessions/session-1/messages")) {
          return jsonResponse({
            items: [
              {
                id: "message-1",
                session_id: "session-1",
                role: "assistant",
                text: "보고서 목차를 먼저 정리하겠습니다.\n- 파일 열기: C:/Docs/weekly-report.md\n- 폴더 열기: C:/Docs",
                message_type: "chat",
                status: "completed",
                created_at: "2026-05-06T09:05:00+09:00",
              },
            ],
          });
        }

        if (url.endsWith("/api/work-sessions/session-1/file-links")) {
          return jsonResponse({
            items: [
              {
                id: "link-1",
                session_id: "session-1",
                file_path: "C:/Docs/weekly-report.md",
                label: "weekly-report.md",
                source: "manual",
                created_at: "2026-05-06T09:10:00+09:00",
              },
            ],
          });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": {
            items: [
              {
                id: "schedule-1",
                title: "주간 보고 회의",
                starts_at: "2026-05-06T10:00:00+09:00",
                ends_at: "2026-05-06T11:00:00+09:00",
                view: "week",
                created_at: "2026-05-06T08:00:00+09:00",
              },
            ],
          },
          "/api/reference-sets": { items: [] },
          "/api/templates": { items: [] },
          "/api/documents/templates/custom": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/knowledge/sources": { items: [] },
          "/api/knowledge/source-files": { items: [] },
          "/api/personalization/candidates": { items: [] },
          "/api/approval-tickets": { items: [] },
          "/api/integrations/anything/launches": { items: [] },
          "/api/file-organizer/proposals": { items: [] },
          "/api/execution-logs": { items: [] },
          "/api/tools": { items: [] },
        };
        const matched = Object.entries(collectionMap).find(([path]) => url.endsWith(path));
        if (matched) {
          return jsonResponse(matched[1]);
        }

        return jsonResponse({ detail: `Unhandled request: ${url}` }, 404);
      }),
    );
  });

  it("moves the active chat session into the document authoring form", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId("chat-workspace");
    expect(await screen.findByRole("button", { name: /파일 열기/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /폴더 열기/ })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "문서작성으로 이어가기" }));

    expect(await screen.findByText("자료 기반 문서작성 시작")).toBeInTheDocument();
    const sourceModeGroup = screen.getByTestId("document-source-mode");
    expect(within(sourceModeGroup).getByLabelText("대화세션에서 작성")).toBeChecked();
    expect(screen.getByLabelText("문서 제목")).toHaveValue("주간 보고 작업 문서");
    expect(screen.getByLabelText("문서 목적")).toHaveValue("업무대화 세션 기반 정리");
    expect(screen.getByLabelText("작성 개요")).toHaveValue("주간 보고 작업 대화 내용을 바탕으로 문서를 작성합니다.");
    expect(screen.getAllByText("주간 보고 회의").length).toBeGreaterThan(0);
    expect(screen.getByText("대화 1개")).toBeInTheDocument();
    expect(screen.getByText("연결 파일 1개")).toBeInTheDocument();

    const formatSelect = screen.getByLabelText("출력 유형");
    expect(formatSelect).toHaveValue("auto");
    expect(within(formatSelect).getByRole("option", { name: "시행문" })).toBeInTheDocument();
    expect(within(formatSelect).getByRole("option", { name: "1페이지 보고서" })).toBeInTheDocument();
    expect(within(formatSelect).getByRole("option", { name: "풀버전 보고서" })).toBeInTheDocument();
    expect(within(formatSelect).getByRole("option", { name: "이메일" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("사용자 HWPX/HWTX 양식")).toBeInTheDocument();
    });
    expect(screen.getByTestId("document-format-guide")).toHaveTextContent("public-doc-to-hwpx 작성 원칙");
    expect(screen.getByTestId("document-format-guide")).toHaveTextContent("두괄식");
    expect(screen.getByTestId("document-format-guide")).toHaveTextContent("적/의/것/들");
  });
});
