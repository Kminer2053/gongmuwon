import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeState = {
  status: {
    available: true,
    mode: "tauri" as const,
    sidecar_url: "http://127.0.0.1:8765",
    anything_available: true,
    anything_mode: "external_app_detected" as const,
    anything_path: "C:/Users/USER/AppData/Local/Anything/docufinder.exe",
    anything_autopaste_enabled: false,
    running: false,
    managed: false,
    auto_restart_recommended: false,
    log_path: "/tmp/gongmu-workspace/logs/sidecar-runtime.log",
    detail: "sidecar start required",
  },
};

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: vi.fn(async () => runtimeState.status),
  startDesktopSidecar: vi.fn(async () => runtimeState.status),
  stopDesktopSidecar: vi.fn(async () => runtimeState.status),
  restartDesktopSidecar: vi.fn(async () => runtimeState.status),
  setDesktopZoom: vi.fn(async () => undefined),
  pickDirectory: vi.fn(async () => null),
  launchAnythingQuery: vi.fn(),
  openExternalTarget: vi.fn(),
  copyTextToClipboard: vi.fn(),
}));

import { App } from "./app";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("Workflow IA", () => {
  beforeEach(() => {
    let workSessions = [
      {
        id: "session-1",
        title: "주간 보고 준비",
        schedule_id: "schedule-1",
        status: "open",
        created_at: "2026-04-20T00:00:00+09:00",
        messages: [],
      },
      {
        id: "session-2",
        title: "독립 검토 세션",
        schedule_id: null,
        status: "open",
        created_at: "2026-04-20T08:30:00+09:00",
        messages: [],
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

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
              llm_mode: "external_model",
              llm_provider: "openai_compatible",
              llm_model: "gpt-4.1",
              llm_api_key: null,
              anything_launch_mode: "external_app_preferred",
              default_template_key: "meeting",
              internal_api_base_url: "https://example-llm.local/v1",
            },
            paths: {
              workspace_root: "/tmp/gongmu-workspace",
              database: "/tmp/gongmu-workspace/db/gongmu.db",
              knowledge_root: "/tmp/gongmu-workspace/knowledge",
              documents_root: "/tmp/gongmu-workspace/documents",
            },
          });
        }

        if (url.endsWith("/api/schedules")) {
          return jsonResponse({
            items: [
              {
                id: "schedule-1",
                title: "주간 보고",
                starts_at: "2026-04-20T09:00:00+09:00",
                ends_at: "2026-04-20T10:00:00+09:00",
                view: "week",
                created_at: "2026-04-20T00:00:00+09:00",
              },
              {
                id: "schedule-2",
                title: "예산 검토",
                starts_at: "2026-04-21T14:00:00+09:00",
                ends_at: "2026-04-21T15:00:00+09:00",
                view: "week",
                created_at: "2026-04-20T00:00:00+09:00",
              },
            ],
          });
        }

        if (url.endsWith("/api/work-sessions") && method === "GET") {
          return jsonResponse({ items: workSessions });
        }

        if (url.endsWith("/api/work-sessions") && method === "POST") {
          const created = {
            id: `session-${workSessions.length + 1}`,
            title: body?.title ?? "새 업무 세션",
            schedule_id: body?.schedule_id ?? null,
            status: "open",
            created_at: "2026-04-20T09:00:00+09:00",
            messages: [],
          };
          workSessions = [created, ...workSessions];
          return jsonResponse(created, 201);
        }

        if (url.match(/\/api\/work-sessions\/[^/]+$/) && method === "PATCH") {
          const sessionId = url.split("/").at(-1);
          workSessions = workSessions.map((session) =>
            session.id === sessionId ? { ...session, schedule_id: body?.schedule_id ?? null } : session,
          );
          return jsonResponse(workSessions.find((session) => session.id === sessionId));
        }

        return jsonResponse({ items: [] });
      }),
    );
  });

  it("opens the linked chat session from the schedule editor", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });

    await user.click(within(navigation).getByRole("button", { name: "일정" }));
    const eventBlock = await screen.findByTestId("timegrid-event-schedule-1");
    await user.click(eventBlock);
    await user.click(screen.getByRole("button", { name: "연결 세션 열기" }));

    expect(await screen.findByRole("heading", { name: "주간 보고 준비" })).toBeInTheDocument();
    expect(screen.getByTestId("session-rail")).toBeInTheDocument();
  });

  it("creates a new linked chat session when a schedule has no session yet", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });

    await user.click(within(navigation).getByRole("button", { name: "일정" }));
    const eventBlock = await screen.findByTestId("timegrid-event-schedule-2");
    await user.click(eventBlock);
    await user.click(screen.getByRole("button", { name: "연결 세션 만들기" }));

    expect(await screen.findByRole("heading", { name: "예산 검토 작업" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "연결 일정 열기" })).toBeInTheDocument();
  });

  it("keeps the session rail visible while moving between chat and schedule", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });

    await user.click(within(navigation).getByRole("button", { name: "일정" }));
    expect(screen.getByTestId("session-rail")).toBeInTheDocument();
    await user.click(within(navigation).getByRole("button", { name: "업무대화" }));
    expect(screen.getByTestId("session-rail")).toBeInTheDocument();
  });
});
