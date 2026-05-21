import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalTicketItem, AnythingLaunchItem } from "./api";
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
    detail: "desktop runtime ready",
  },
};

const loadDesktopRuntimeStatusMock = vi.fn(async () => runtimeState.status);
const launchAnythingQueryMock = vi.fn(async (_query: string, _fallbackTarget: string) => undefined);
const openExternalTargetMock = vi.fn(async (_target: string) => undefined);
const copyTextToClipboardMock = vi.fn(async (_text: string) => undefined);

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: () => loadDesktopRuntimeStatusMock(),
  startDesktopSidecar: vi.fn(async () => runtimeState.status),
  stopDesktopSidecar: vi.fn(async () => runtimeState.status),
  restartDesktopSidecar: vi.fn(async () => runtimeState.status),
  launchAnythingQuery: (query: string, fallbackTarget: string) =>
    launchAnythingQueryMock(query, fallbackTarget),
  openExternalTarget: (target: string) => openExternalTargetMock(target),
  copyTextToClipboard: (text: string) => copyTextToClipboardMock(text),
  setDesktopZoom: vi.fn(async () => undefined),
  pickDirectory: vi.fn(async () => "/tmp/chosen-folder"),
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
  let approvalTickets: ApprovalTicketItem[] = [
    {
      id: "approval-1",
      action: "anything.launch",
      status: "approved",
      target_type: "external_launch",
      target_id: "launch-1",
      requested_at: "2026-04-20T00:00:00+09:00",
      decided_at: "2026-04-20T00:05:00+09:00",
      decision_note: "approved",
    },
  ];

  let anythingLaunches: AnythingLaunchItem[] = [
    {
      id: "launch-1",
      approval_ticket_id: "approval-1",
      query: "예산 검토",
      launch_target: "https://github.com/chrisryugj/Docufinder/releases",
      status: "pending",
      created_at: "2026-04-20T00:00:00+09:00",
      applied_at: null,
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
        "/api/schedules": { items: [] },
        "/api/work-sessions": { items: [] },
        "/api/reference-sets": { items: [] },
        "/api/templates": { items: [{ key: "report", label: "보고서형" }] },
        "/api/knowledge/candidates": { items: [] },
        "/api/knowledge/pages": { items: [] },
        "/api/file-organizer/proposals": { items: [] },
        "/api/execution-logs": { items: [] },
        "/api/tools": { items: [] },
        "/api/approval-tickets": { items: approvalTickets },
        "/api/integrations/anything/launches": { items: anythingLaunches },
      };

      if (url.endsWith("/api/integrations/anything/launch") && method === "POST") {
        const approvalId = `approval-${approvalTickets.length + 1}`;
        const launchId = `launch-${anythingLaunches.length + 1}`;
        const pendingApproval: ApprovalTicketItem = {
          id: approvalId,
          action: "anything.launch",
          status: "pending",
          target_type: "external_launch",
          target_id: launchId,
          requested_at: "2026-04-20T00:10:00+09:00",
          decided_at: null,
          decision_note: null,
        };
        const launchRequest: AnythingLaunchItem = {
          id: launchId,
          approval_ticket_id: approvalId,
          query: body.query,
          launch_target: "https://github.com/chrisryugj/Docufinder/releases",
          status: "pending",
          created_at: "2026-04-20T00:10:00+09:00",
          applied_at: null,
        };
        approvalTickets = [...approvalTickets, pendingApproval];
        anythingLaunches = [launchRequest, ...anythingLaunches];
        return jsonResponse({ approval_ticket: pendingApproval, launch_request: launchRequest }, 201);
      }

      if (url.endsWith("/api/integrations/anything/launch/approval-1/apply") && method === "POST") {
        anythingLaunches = anythingLaunches.map((launch) =>
          launch.approval_ticket_id === "approval-1"
            ? { ...launch, status: "applied", applied_at: "2026-04-20T00:05:30+09:00" }
            : launch,
        );
        return jsonResponse(
          {
            approval_ticket: approvalTickets[0],
            launch_request: anythingLaunches.find((launch) => launch.approval_ticket_id === "approval-1"),
          },
          201,
        );
      }

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
    detail: "desktop runtime ready",
  };
  vi.unstubAllGlobals();
  launchAnythingQueryMock.mockClear();
  openExternalTargetMock.mockClear();
  copyTextToClipboardMock.mockClear();
  loadDesktopRuntimeStatusMock.mockClear();
  installFetchStub();
});

describe("Anything launch flow", () => {
  async function openSearchPanel(user: ReturnType<typeof userEvent.setup>) {
    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: /^파일찾기/ }));
  }

  it("shows the install guide button when Anything is unavailable", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openSearchPanel(user);

    expect(await screen.findByRole("button", { name: "Anything 설치 안내 열기" })).toBeInTheDocument();
  });

  it("reopens the approvals pane when a new Anything request is created", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("대기 중인 승인");
    await user.click(screen.getByRole("button", { name: "승인 요청" }));
    expect(screen.queryByText("대기 중인 승인")).not.toBeInTheDocument();

    await openSearchPanel(user);
    await user.type(screen.getByPlaceholderText("예: 예산, 회의자료, 사업계획"), "회의자료");
    await user.click(screen.getByRole("button", { name: "Anything 열기 요청" }));

    expect(await screen.findByText("대기 중인 승인")).toBeInTheDocument();
  });

  it("launches a detected Anything app with clipboard handoff", async () => {
    const user = userEvent.setup();
    runtimeState.status = {
      ...runtimeState.status,
      anything_available: true,
      anything_mode: "external_app_detected",
      anything_path: "C:/Users/USER/AppData/Local/Anything/docufinder.exe",
    };

    render(<App />);
    await openSearchPanel(user);

    const openButton = await screen.findByRole("button", { name: "승인 후 Anything 열기" });
    await user.click(openButton);

    expect(copyTextToClipboardMock).toHaveBeenCalledWith("예산 검토");
    expect(launchAnythingQueryMock).toHaveBeenCalledWith(
      "예산 검토",
      "https://github.com/chrisryugj/Docufinder/releases",
    );
  });
});
