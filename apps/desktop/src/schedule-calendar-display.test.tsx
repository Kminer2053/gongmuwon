import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: vi.fn(async () => ({
    available: true,
    mode: "tauri",
    sidecar_url: "http://127.0.0.1:8765",
    anything_available: false,
    anything_mode: "unavailable",
    anything_path: null,
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
  setDesktopZoom: vi.fn(async () => undefined),
}));

import { App } from "./app";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("schedule calendar display", () => {
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
              anything_launch_mode: "external_app_preferred",
              default_template_key: "report",
              internal_api_base_url: null,
            },
            paths: {
              workspace_root: "/tmp/gongmu-workspace",
              database: "/tmp/gongmu-workspace/db/gongmu.db",
              knowledge_root: "/tmp/gongmu-workspace/knowledge",
              documents_root: "/tmp/gongmu-workspace/documents",
            },
          });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": {
            items: [
              {
                id: "schedule-1",
                title: "Very long public planning meeting title that should stay in one line",
                starts_at: "2026-06-08T15:00:00+09:00",
                ends_at: "2026-06-08T16:00:00+09:00",
                view: "month",
                created_at: "2026-06-01T00:00:00+09:00",
              },
              {
                id: "schedule-2",
                title: "Budget review",
                starts_at: "2026-06-08T17:00:00+09:00",
                ends_at: "2026-06-08T18:00:00+09:00",
                view: "month",
                created_at: "2026-06-01T00:00:00+09:00",
              },
            ],
          },
          "/api/work-sessions": { items: [] },
          "/api/reference-sets": { items: [] },
          "/api/templates": { items: [] },
          "/api/documents/templates/custom": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/knowledge/sources": { items: [] },
          "/api/knowledge/source-files": { items: [] },
          "/api/knowledge/ingestion-jobs": { items: [] },
          "/api/knowledge/documents": { items: [] },
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

  it("renders schedules as compact colored bars inside calendar cells", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId("session-rail");
    await user.click(screen.getByTestId("feature-menu-schedule"));

    const firstBar = await screen.findByTestId("schedule-slot-event-bar-schedule-1");
    const secondBar = await screen.findByTestId("schedule-slot-event-bar-schedule-2");

    expect(firstBar).toHaveClass("schedule-slot__event-bar");
    expect(firstBar).toHaveTextContent("Very long public planning meeting title");
    expect(firstBar).toHaveAttribute("title", expect.stringContaining("Very long public planning meeting title"));
    expect(secondBar.getAttribute("style")).toContain("--schedule-event-bg");
  });
});
