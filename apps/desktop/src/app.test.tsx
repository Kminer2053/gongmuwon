import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApprovalTicketItem,
  ExecutionLogItem,
  ReferenceSetItem,
  ScheduleItem,
  WorkSessionItem,
} from "./api";
import type { DesktopRuntimeStatus } from "./runtime";

const runtimeState: { status: DesktopRuntimeStatus } = {
  status: {
    available: true,
    mode: "tauri",
    sidecar_url: "http://127.0.0.1:8765",
    anything_available: false,
    anything_mode: "install_page_fallback",
    anything_path: null,
    anything_autopaste_enabled: false,
    running: true,
    managed: true,
    auto_restart_recommended: false,
    log_path: "/tmp/gongmu-workspace/logs/sidecar-runtime.log",
    detail: "managed sidecar running",
  },
};

const loadDesktopRuntimeStatusMock = vi.fn(async () => runtimeState.status);
const startDesktopSidecarMock = vi.fn(async () => runtimeState.status);
const stopDesktopSidecarMock = vi.fn(async () => runtimeState.status);
const restartDesktopSidecarMock = vi.fn(async () => runtimeState.status);
const pickDirectoryMock = vi.fn(async () => "/tmp/chosen-folder");

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: () => loadDesktopRuntimeStatusMock(),
  startDesktopSidecar: () => startDesktopSidecarMock(),
  stopDesktopSidecar: () => stopDesktopSidecarMock(),
  restartDesktopSidecar: () => restartDesktopSidecarMock(),
  pickDirectory: () => pickDirectoryMock(),
  launchAnythingQuery: vi.fn(async () => undefined),
  openExternalTarget: vi.fn(async () => undefined),
  copyTextToClipboard: vi.fn(async () => undefined),
  setDesktopZoom: vi.fn(async (scale: number) => scale),
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
  let schedules: ScheduleItem[] = [
    {
      id: "schedule-1",
      title: "주간 보고 준비",
      starts_at: "2026-04-20T09:00:00+09:00",
      ends_at: "2026-04-20T10:00:00+09:00",
      view: "week",
      created_at: "2026-04-20T00:00:00+09:00",
    },
  ];

  let workSessions: WorkSessionItem[] = [
    {
      id: "session-1",
      title: "주간 보고 작업",
      schedule_id: "schedule-1",
      status: "open",
      created_at: "2026-04-20T00:00:00+09:00",
      messages: [
        {
          id: "message-1",
          session_id: "session-1",
          role: "assistant",
          text: "초안 구조부터 정리해보겠습니다.",
          message_type: "chat",
          status: "completed",
          created_at: "2026-04-20T00:10:00+09:00",
        },
      ],
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

  const referenceSets: ReferenceSetItem[] = [
    {
      id: "ref-1",
      title: "회의 참고자료",
      session_id: "session-1",
      created_at: "2026-04-20T00:00:00+09:00",
      items: [{ id: "ref-item-1", kind: "file", label: "draft.md", value: "/tmp/draft.md" }],
    },
  ];

  const approvalTickets: ApprovalTicketItem[] = [];
  const logs: ExecutionLogItem[] = [
    {
      id: "log-1",
      feature: "schedule",
      action: "schedule.created",
      status: "success",
      created_at: "2026-04-20T00:00:00+09:00",
      inputs: {},
      outputs: {},
      approval_ticket_id: null,
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
            llm_mode: "internal_server",
            llm_provider: "openai_compatible",
            llm_model: "gpt-4.1-mini",
            anything_launch_mode: "external_app_preferred",
            default_template_key: "meeting",
            internal_api_base_url: "http://127.0.0.1:9000",
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
        if (method === "POST") {
          const created: ScheduleItem = {
            id: `schedule-${schedules.length + 1}`,
            title: body.title,
            starts_at: body.starts_at,
            ends_at: body.ends_at,
            view: body.view,
            created_at: "2026-04-20T01:00:00+09:00",
          };
          schedules = [...schedules, created];
          return jsonResponse(created, 201);
        }
        return jsonResponse({ items: schedules });
      }

      const schedulePatchMatch = url.match(/\/api\/schedules\/([^/]+)$/);
      if (schedulePatchMatch && method === "PATCH") {
        const scheduleId = schedulePatchMatch[1];
        const updated = schedules.find((schedule) => schedule.id === scheduleId);
        if (!updated) {
          return jsonResponse({ detail: "not found" }, 404);
        }
        const next = {
          ...updated,
          title: body.title,
          starts_at: body.starts_at,
          ends_at: body.ends_at,
          view: body.view,
        };
        schedules = schedules.map((schedule) => (schedule.id === scheduleId ? next : schedule));
        return jsonResponse(next);
      }

      if (url.endsWith("/api/work-sessions")) {
        if (method === "POST") {
          const created: WorkSessionItem = {
            id: `session-${workSessions.length + 1}`,
            title: body.title,
            schedule_id: body.schedule_id ?? null,
            status: "open",
            created_at: "2026-04-20T01:00:00+09:00",
            messages: [],
          };
          workSessions = [...workSessions, created];
          return jsonResponse(created, 201);
        }
        return jsonResponse({ items: workSessions });
      }

      const sessionPatchMatch = url.match(/\/api\/work-sessions\/([^/]+)$/);
      if (sessionPatchMatch && method === "PATCH") {
        const sessionId = sessionPatchMatch[1];
        const updated = workSessions.find((session) => session.id === sessionId);
        if (!updated) {
          return jsonResponse({ detail: "not found" }, 404);
        }
        const next = { ...updated, schedule_id: body.schedule_id ?? null };
        workSessions = workSessions.map((session) => (session.id === sessionId ? next : session));
        return jsonResponse(next);
      }

      if (url.endsWith("/api/reference-sets")) {
        return jsonResponse({ items: referenceSets });
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

      const collectionMap: Record<string, unknown> = {
        "/api/knowledge/candidates": { items: [] },
        "/api/knowledge/pages": { items: [] },
        "/api/approval-tickets": { items: approvalTickets },
        "/api/integrations/anything/launches": { items: [] },
        "/api/file-organizer/proposals": { items: [] },
        "/api/execution-logs": { items: logs },
        "/api/tools": { items: [] },
      };

      const matched = Object.entries(collectionMap).find(([path]) => url.endsWith(path));
      if (matched) {
        return jsonResponse(matched[1]);
      }

      return jsonResponse({ detail: `Unhandled request: ${method} ${url}` }, 404);
    }),
  );
}

beforeEach(() => {
  runtimeState.status = {
    available: true,
    mode: "tauri",
    sidecar_url: "http://127.0.0.1:8765",
    anything_available: false,
    anything_mode: "install_page_fallback",
    anything_path: null,
    anything_autopaste_enabled: false,
    running: true,
    managed: true,
    auto_restart_recommended: false,
    log_path: "/tmp/gongmu-workspace/logs/sidecar-runtime.log",
    detail: "managed sidecar running",
  };
  vi.unstubAllGlobals();
  loadDesktopRuntimeStatusMock.mockClear();
  startDesktopSidecarMock.mockClear();
  stopDesktopSidecarMock.mockClear();
  restartDesktopSidecarMock.mockClear();
  pickDirectoryMock.mockClear();
  installFetchStub();
});

describe("App shell", () => {
  it("keeps the session rail visible when moving to another feature", async () => {
    const user = userEvent.setup();
    render(<App />);

    const sessionRail = await screen.findByTestId("session-rail");
    await within(sessionRail).findByRole("button", { name: /주간 보고 작업/ });
    expect(within(sessionRail).getByRole("button", { name: /주간 보고 작업/ })).toBeInTheDocument();

    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: "일정" }));

    expect(screen.getByTestId("session-rail")).toBeInTheDocument();
    expect(within(screen.getByTestId("session-rail")).getByRole("button", { name: /주간 보고 작업/ })).toBeInTheDocument();
  });

  it("uses only the top-right toggle when the right info pane is collapsed", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("대기 중인 승인");
    await user.click(screen.getByRole("button", { name: "오른쪽 정보 패널 닫기" }));

    expect(document.querySelector(".workspace-shell--context-collapsed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "오른쪽 정보 패널 열기" })).toBeInTheDocument();
    expect(screen.queryByLabelText("오른쪽 정보 패널 복원")).not.toBeInTheDocument();
  });

  it("opens the compact runtime popover from the top-right indicator", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId("runtime-indicator-toggle");
    await user.click(screen.getByTestId("runtime-indicator-toggle"));

    expect(screen.getByTestId("runtime-popover")).toHaveTextContent("업무 엔진 상태");
    expect(screen.getByTestId("runtime-popover")).not.toHaveTextContent("사이드카");
    expect(screen.getByTestId("runtime-popover")).not.toHaveTextContent(/sidecar/i);
  });

  it("uses bundled image icon files for compact topbar actions", async () => {
    render(<App />);

    await screen.findByTestId("shell-topbar-current");

    expect(screen.getByTestId("topbar-refresh-icon")).toHaveAttribute("src", "/icons/refresh.svg");
    expect(screen.getByTestId("topbar-context-toggle-icon")).toHaveAttribute("src", "/icons/panel-close.svg");
  });

  it("keeps the topbar compact with zoom buttons and no duplicated status pills", async () => {
    render(<App />);

    await screen.findByText("로컬 AI 업무 에이전트 워크플레이스 : 공무원");

    expect(screen.queryByTestId("workspace-header-summary")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "화면 축소" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "화면 확대" })).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("simplifies the left rail labels and removes low-value session filters", async () => {
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });

    expect(within(navigation).getByRole("button", { name: "파일찾기" })).toBeInTheDocument();
    expect(within(navigation).queryByRole("button", { name: "로컬파일/정보검색" })).not.toBeInTheDocument();
    expect(within(navigation).getByText("기타")).toBeInTheDocument();
    expect(within(navigation).getByText("환경설정")).toBeInTheDocument();
    expect(screen.queryByTestId("session-rail-filter-all")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-rail-filter-linked")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-rail-filter-independent")).not.toBeInTheDocument();
  });

  it("uses compact icon tabs in the right pane and removes the task detail panel", async () => {
    render(<App />);

    await screen.findByLabelText("현재 컨텍스트");

    expect(screen.queryByRole("button", { name: "작업 상세" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("현재 컨텍스트")).toHaveClass("is-active");
    expect(screen.getByLabelText("승인 요청")).toHaveClass("is-active");
    expect(screen.getByLabelText("최근 실행")).toHaveClass("is-active");
    expect(screen.getByLabelText("가까운 일정")).toBeDisabled();
    expect(screen.getByLabelText("미리보기")).toBeDisabled();
  });

  it("renames the schedule calendar and moves summary details out of the main calendar", async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: "일정" }));

    expect(await screen.findByRole("heading", { name: "업무일정 캘린더" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "빠른 일정 캘린더" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("schedule-summary")).not.toBeInTheDocument();
    expect(screen.getByLabelText("가까운 일정")).not.toBeDisabled();
  });

  it("keeps schedule cells compact and exposes full details as hover text", async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: /^일정/ }));

    const occupiedSlot = await screen.findByTestId("schedule-slot-1");
    const existingTitle = await screen.findByTestId("schedule-slot-existing-title-1");

    expect(occupiedSlot).toHaveAttribute("title", expect.stringContaining("주간 보고 준비"));
    expect(existingTitle).toHaveClass("schedule-slot__line");
    expect(existingTitle).toHaveAttribute("title", "주간 보고 준비");
  });

  it("clears previous schedule data when moving from existing edit to a new empty slot", async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: /^일정/ }));

    const existingTitle = await screen.findByTestId("schedule-slot-existing-title-1");
    await user.click(existingTitle.closest("button") as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByLabelText("일정 제목")).toHaveValue("주간 보고 준비");
      expect(screen.getByRole("button", { name: "연결 세션 열기" })).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("schedule-slot-0"));

    await waitFor(() => {
      expect(screen.getByLabelText("일정 제목")).toHaveValue("");
      expect(screen.queryByRole("button", { name: "연결 세션 열기" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "일정 등록" })).toBeInTheDocument();
    });
  });
});
