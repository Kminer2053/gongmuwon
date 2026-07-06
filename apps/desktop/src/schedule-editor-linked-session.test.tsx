import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeState = {
  status: {
    available: true,
    mode: "tauri" as const,
    sidecar_url: "http://127.0.0.1:8765",
    anything_available: false,
    anything_mode: "install_page_fallback" as const,
    anything_path: null,
    anything_autopaste_enabled: false,
    running: true,
    managed: true,
    auto_restart_recommended: false,
    log_path: "/tmp/gongmu-workspace/logs/sidecar-runtime.log",
    detail: "managed sidecar running",
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

function installFetchStub(options: { withLinkedSession: boolean }) {
  let schedules = [
    {
      id: "schedule-1",
      title: "주간 보고 준비",
      starts_at: "2026-04-20T09:00:00+09:00",
      ends_at: "2026-04-20T10:00:00+09:00",
      view: "week",
      created_at: "2026-04-20T00:00:00+09:00",
    },
  ];

  let workSessions: Array<{
    id: string;
    title: string;
    schedule_id: string | null;
    status: string;
    created_at: string;
    messages: unknown[];
  }> = options.withLinkedSession
    ? [
        {
          id: "session-1",
          title: "주간 보고 세션",
          schedule_id: "schedule-1",
          status: "open",
          created_at: "2026-04-20T00:00:00+09:00",
          messages: [],
        },
      ]
    : [];

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
            llm_mode: "local_first",
            llm_provider: "openai_compatible",
            llm_model: "gpt-4.1-mini",
            anything_launch_mode: "external_app_preferred",
            default_template_key: "report",
            internal_api_base_url: null,
          },
          paths: {
            workspace_root: "/tmp/gongmu-workspace",
            database: "/tmp/gongmu-workspace/gongmu.db",
            knowledge_root: "/tmp/gongmu-workspace/knowledge",
            documents_root: "/tmp/gongmu-workspace/documents",
          },
        });
      }

      if (url.endsWith("/api/schedules/schedule-1") && method === "DELETE") {
        const deleted = schedules[0];
        schedules = schedules.filter((schedule) => schedule.id !== "schedule-1");
        workSessions = workSessions.map((session) =>
          session.schedule_id === "schedule-1" ? { ...session, schedule_id: null } : session,
        );
        return jsonResponse({ id: "schedule-1", deleted: true, schedule: deleted });
      }

      if (url.endsWith("/api/schedules")) {
        return jsonResponse({ items: schedules });
      }

      if (url.endsWith("/api/work-sessions")) {
        if (method === "POST") {
          const created = {
            id: "session-created",
            title: body?.title ?? "새 업무 세션",
            schedule_id: body?.schedule_id ?? null,
            status: "open",
            created_at: "2026-04-20T01:00:00+09:00",
            messages: [],
          };
          workSessions = [...workSessions, created];
          return jsonResponse(created, 201);
        }
        return jsonResponse({ items: workSessions });
      }

      if (url.endsWith("/api/reference-sets")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/templates")) {
        return jsonResponse({
          items: [
            { key: "report", label: "보고서형" },
            { key: "meeting", label: "회의자료형" },
            { key: "review", label: "검토메모형" },
          ],
        });
      }

      if (url.endsWith("/api/knowledge/candidates")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/knowledge/pages")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/approval-tickets")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/integrations/anything/launches")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/file-organizer/proposals")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/execution-logs")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/tools")) {
        return jsonResponse({ items: [] });
      }

      return jsonResponse({ detail: `Unhandled request: ${method} ${url}` }, 404);
    }),
  );
}

describe("Schedule editor linked session", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the linked chat session directly from the existing schedule editor", async () => {
    installFetchStub({ withLinkedSession: true });
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: /^일정/ }));

    const eventBlock = await screen.findByTestId("timegrid-event-schedule-1");
    await user.click(eventBlock);
    await user.click(screen.getByRole("button", { name: "연결 세션 열기" }));

    expect(await screen.findByRole("heading", { name: "주간 보고 세션" })).toBeInTheDocument();
  });

  it("creates a linked chat session from the existing schedule editor when none exists", async () => {
    installFetchStub({ withLinkedSession: false });
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: /^일정/ }));

    const eventBlock = await screen.findByTestId("timegrid-event-schedule-1");
    await user.click(eventBlock);
    await user.click(screen.getByRole("button", { name: "연결 세션 만들기" }));

    expect(await screen.findByRole("heading", { name: "주간 보고 준비 작업" })).toBeInTheDocument();
  });

  it("summarizes calendar state and deletes a selected schedule from the inline editor", async () => {
    installFetchStub({ withLinkedSession: true });
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: /^일정/ }));

    expect(await screen.findByRole("heading", { name: "업무일정 캘린더" })).toBeInTheDocument();
    expect(screen.getByLabelText("가까운 일정")).not.toBeDisabled();
    expect(screen.getAllByText(/주간 보고 준비/).length).toBeGreaterThan(0);

    const eventBlock = await screen.findByTestId("timegrid-event-schedule-1");
    await user.click(eventBlock);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    await user.click(screen.getByRole("button", { name: "일정 삭제" }));

    await waitFor(() => {
      expect(screen.queryByText(/주간 보고 준비/)).not.toBeInTheDocument();
    });
    const requestPaths = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requestPaths.some((path) => path.includes("/api/knowledge/documents"))).toBe(false);
    expect(requestPaths.some((path) => path.includes("/api/execution-logs"))).toBe(false);
  });
});
