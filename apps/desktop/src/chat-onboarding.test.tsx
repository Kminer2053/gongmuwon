import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: vi.fn(async () => ({
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
  })),
  startDesktopSidecar: vi.fn(),
  stopDesktopSidecar: vi.fn(),
  restartDesktopSidecar: vi.fn(),
  pickDirectory: vi.fn(async () => null),
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

function stubFetch(options: { llmConfigured: boolean; initialSessions: Array<Record<string, unknown>> }) {
  let workSessions = [...options.initialSessions];

  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

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
            llm_mode: options.llmConfigured ? "local_first" : "external_model",
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

      if (url.endsWith("/api/work-sessions") && method === "POST") {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        const created = {
          id: `session-${workSessions.length + 1}`,
          title: body?.title ?? "새 업무 세션",
          schedule_id: body?.schedule_id ?? null,
          status: "open",
          created_at: "2026-07-04T09:00:00+09:00",
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
        "/api/schedules": { items: [] },
        "/api/templates": { items: [] },
        "/api/knowledge/candidates": { items: [] },
        "/api/knowledge/pages": { items: [] },
        "/api/knowledge/sources": { items: [] },
        "/api/knowledge/source-files": { items: [] },
        "/api/personalization/candidates": { items: [] },
        "/api/approval-tickets": { items: [] },
        "/api/execution-logs": { items: [] },
        "/api/tools": { items: [] },
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
}

// D-06: 앱 시작 화면이 홈(오늘의 브리핑)으로 바뀌어, 채팅 검증은 먼저 업무대화 메뉴로 이동한다.
async function openChatFromHome() {
  const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
  fireEvent.click(within(navigation).getByRole("button", { name: "업무대화" }));
}

describe("chat onboarding (J-01 / J-02)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a session straight from the empty-state CTA (J-01)", async () => {
    stubFetch({ llmConfigured: true, initialSessions: [] });
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    await screen.findByTestId("chat-create-session-cta");
    await waitFor(() => {
      const emptyState = screen.getByTestId("chat-empty-cta");
      expect(emptyState).toHaveTextContent("아직 열린 업무대화 세션이 없습니다.");
      // J-01: 다른 위치의 버튼을 안내하는 문구 대신 실제 버튼을 제공한다.
      expect(emptyState).not.toHaveTextContent("왼쪽 상단");
    });

    await user.click(screen.getByTestId("chat-create-session-cta"));

    expect(await screen.findByTestId("chat-workspace")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "새 업무 세션" })).toBeInTheDocument();
  });

  it("shows the LLM setup notice above the composer when LLM is not configured (J-02)", async () => {
    stubFetch({
      llmConfigured: false,
      initialSessions: [
        {
          id: "session-1",
          title: "주간 보고 준비",
          schedule_id: null,
          status: "open",
          created_at: "2026-07-04T09:00:00+09:00",
          messages: [],
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    await screen.findByTestId("chat-workspace");
    const notice = await screen.findByTestId("llm-setup-notice");
    expect(notice).toHaveTextContent("LLM 연결이 아직 설정되지 않았습니다");

    await user.click(screen.getByRole("button", { name: "환경설정으로 이동" }));
    await waitFor(() => expect(screen.queryByTestId("chat-workspace")).not.toBeInTheDocument());
  });

  it("keeps the notice hidden when LLM is configured (J-02)", async () => {
    stubFetch({
      llmConfigured: true,
      initialSessions: [
        {
          id: "session-1",
          title: "주간 보고 준비",
          schedule_id: null,
          status: "open",
          created_at: "2026-07-04T09:00:00+09:00",
          messages: [],
        },
      ],
    });
    render(<App />);
    await openChatFromHome();

    await screen.findByTestId("chat-workspace");
    expect(screen.queryByTestId("llm-setup-notice")).not.toBeInTheDocument();
  });
});
