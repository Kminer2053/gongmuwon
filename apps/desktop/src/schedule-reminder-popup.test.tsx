import { render, screen, within } from "@testing-library/react";
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
    detail: "managed engine running",
  })),
  startDesktopSidecar: vi.fn(),
  stopDesktopSidecar: vi.fn(),
  restartDesktopSidecar: vi.fn(),
  pickDirectory: vi.fn(async () => null),
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

function installFetchStub() {
  const startsAt = new Date(Date.now() - 10_000).toISOString();
  const endsAt = new Date(Date.now() + 50 * 60_000).toISOString();

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

      if (url.endsWith("/ready")) {
        return jsonResponse({
          status: "ready",
          checks: {},
          recovered: { work_jobs: 0, knowledge_ingestion_jobs: 0 },
        });
      }

      if (url.endsWith("/api/runtime/metrics")) {
        return jsonResponse({
          jobs: { active_count: 0 },
          runner: { active_count: 0 },
          knowledge: {},
          recovered: { work_jobs: 0, knowledge_ingestion_jobs: 0 },
        });
      }

      if (url.endsWith("/api/settings")) {
        return jsonResponse({
          defaults: {
            llm_mode: "local_first",
            llm_provider: "ollama",
            llm_model: "gemma4:e2b",
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
              id: "schedule-due-1",
              title: "AI 활용 회의",
              starts_at: startsAt,
              ends_at: endsAt,
              view: "month",
              created_at: startsAt,
            },
          ],
        },
        "/api/work-sessions": { items: [] },
        "/api/reference-sets": { items: [] },
        "/api/templates": { items: [] },
        "/api/approval-tickets": { items: [] },
        "/api/jobs?limit=20": { items: [] },
      };

      const matched = Object.entries(collectionMap).find(([requestPath]) => url.endsWith(requestPath));
      if (matched) {
        return jsonResponse(matched[1]);
      }

      return jsonResponse({ detail: `Unhandled request: ${url}` }, 404);
    }),
  );
}

describe("schedule reminder popup", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    installFetchStub();
  });

  it("shows a popup when a registered schedule reaches its start time", async () => {
    render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "일정 알림" });

    expect(within(dialog).getByText("AI 활용 회의")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("등록한 일정 시간이 도래했습니다.");
  });
});
