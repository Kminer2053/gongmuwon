import { render, screen, within } from "@testing-library/react";
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

const KOREAN = {
  openContextPane: "오른쪽 정보 패널 열기",
  collapseContextPane: "오른쪽 정보 패널 닫기",
  navigation: "주요 작업 메뉴",
  scheduleMenu: /^일정/,
  scheduleTitle: "일정 제목",
  scheduleCreate: "일정 등록",
};

describe("Context pane auto open policy (C-09)", () => {
  beforeEach(() => {
    let workSessions: Array<Record<string, unknown>> = [];

    const schedules = [
      {
        id: "schedule-1",
        title: "기존 일정",
        starts_at: "2026-04-20T09:00:00+09:00",
        ends_at: "2026-04-20T10:00:00+09:00",
        view: "week",
        created_at: "2026-04-20T00:00:00+09:00",
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
              llm_api_key: null,
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

        if (url.endsWith("/api/schedules")) {
          return jsonResponse({ items: schedules });
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

        if (url.endsWith("/api/work-sessions")) {
          return jsonResponse({ items: workSessions });
        }

        if (url.match(/\/api\/work-sessions\/[^/]+\/file-links$/)) {
          return jsonResponse({ items: [] });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/templates": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/approval-tickets": { items: [] },
          "/api/execution-logs": { items: [] },
        };

        const matched = Object.entries(collectionMap).find(([path]) => url.endsWith(path));
        if (matched) {
          return jsonResponse(matched[1]);
        }

        if (url.includes("/api/jobs")) {
          return jsonResponse({ items: [] });
        }

        return jsonResponse({ detail: `Unhandled request: ${method} ${url}` }, 404);
      }),
    );
  });

  it("keeps schedule creation usable even when the right pane stays collapsed", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: KOREAN.collapseContextPane });
    await user.click(screen.getByRole("button", { name: KOREAN.collapseContextPane }));
    expect(await screen.findByRole("button", { name: KOREAN.openContextPane })).toBeInTheDocument();

    const navigation = screen.getByRole("navigation", { name: KOREAN.navigation });
    await user.click(within(navigation).getByRole("button", { name: KOREAN.scheduleMenu }));

    expect(screen.getByLabelText(KOREAN.scheduleTitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: KOREAN.scheduleCreate })).toBeInTheDocument();
  });

  it("does not force-open the collapsed pane for non-approval reveals (C-09)", async () => {
    const user = userEvent.setup();
    render(<App />);

    // D-06: 시작 화면이 홈이므로 업무대화로 이동한 뒤 세션 생성 흐름을 검증한다.
    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: "업무대화" }));

    await screen.findByRole("button", { name: KOREAN.collapseContextPane });
    await user.click(screen.getByRole("button", { name: KOREAN.collapseContextPane }));
    expect(await screen.findByRole("button", { name: KOREAN.openContextPane })).toBeInTheDocument();

    // 새 세션 생성은 revealContextSection("context")를 호출하지만,
    // C-09 정책상 승인/실패 흐름이 아니므로 패널을 강제로 열지 않는다.
    await user.click(screen.getByRole("button", { name: "새 세션" }));
    await user.type(screen.getByLabelText("새 세션 제목"), "주간 보고 준비");
    await user.click(screen.getByRole("button", { name: "세션 만들기" }));

    expect(await screen.findByRole("heading", { name: "주간 보고 준비" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: KOREAN.openContextPane })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: KOREAN.collapseContextPane })).not.toBeInTheDocument();
  });
});
