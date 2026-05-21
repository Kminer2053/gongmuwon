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

describe("work session file links", () => {
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
                title: "Budget Review Session",
                schedule_id: null,
                status: "open",
                created_at: "2026-04-28T00:00:00+09:00",
                messages: [],
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
                file_path: "C:/Docs/budget.xlsx",
                label: "budget.xlsx",
                source: "anything",
                created_at: "2026-04-28T00:00:00+09:00",
              },
            ],
          });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": { items: [] },
          "/api/reference-sets": { items: [] },
          "/api/templates": { items: [] },
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

  it("keeps file linking compact in the chat toolbar and moves linking to search", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId("chat-workspace");
    expect(screen.queryByTestId("session-file-links")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("세션 연결 파일 경로")).not.toBeInTheDocument();

    const linkCountButton = await screen.findByRole("button", { name: "연결 파일 1개" });
    expect(linkCountButton).toBeInTheDocument();
    expect(screen.queryByText("C:/Docs/budget.xlsx")).not.toBeInTheDocument();

    await user.click(linkCountButton);
    expect(screen.getByText("C:/Docs/budget.xlsx")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "파일 연결" }));

    expect(await screen.findByText("현재 연결 대상 세션")).toBeInTheDocument();
    expect(screen.getAllByText("Budget Review Session").length).toBeGreaterThan(0);
  });
});
