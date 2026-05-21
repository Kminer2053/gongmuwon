import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { webviewSetZoomMock, appListeners, webviewWindowListeners } = vi.hoisted(() => ({
  webviewSetZoomMock: vi.fn(async () => undefined),
  appListeners: new Map<string, (event: { payload: unknown }) => void>(),
  webviewWindowListeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (payload: { payload: unknown }) => void) => {
    appListeners.set(event, handler);
    return () => {
      appListeners.delete(event);
    };
  }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    setZoom: webviewSetZoomMock,
  }),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: async (event: string, handler: (payload: { payload: unknown }) => void) => {
      webviewWindowListeners.set(event, handler);
      return () => {
        webviewWindowListeners.delete(event);
      };
    },
  }),
}));

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
  startDesktopSidecar: vi.fn(async () => undefined),
  stopDesktopSidecar: vi.fn(async () => undefined),
  restartDesktopSidecar: vi.fn(async () => undefined),
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

beforeEach(() => {
  webviewSetZoomMock.mockClear();
  appListeners.clear();
  webviewWindowListeners.clear();

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1600,
    writable: true,
  });

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

      const emptyCollections: Record<string, unknown> = {
        "/api/schedules": { items: [] },
        "/api/work-sessions": { items: [] },
        "/api/reference-sets": { items: [] },
        "/api/templates": { items: [] },
        "/api/knowledge/candidates": { items: [] },
        "/api/knowledge/pages": { items: [] },
        "/api/approval-tickets": { items: [] },
        "/api/integrations/anything/launches": { items: [] },
        "/api/file-organizer/proposals": { items: [] },
        "/api/execution-logs": { items: [] },
        "/api/tools": { items: [] },
      };

      const matched = Object.entries(emptyCollections).find(([path]) => url.endsWith(path));
      if (matched) {
        return jsonResponse(matched[1]);
      }

      return jsonResponse({ detail: `Unhandled request: GET ${url}` }, 404);
    }),
  );
});

describe("menu zoom integration", () => {
  it("updates the zoom badge when a zoom-scale event arrives", async () => {
    render(<App />);

    await screen.findByText("로컬 AI에이전트 워크플레이스 : 공무원");
    expect(screen.getByText("100%")).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("gongmu-zoom-scale", { detail: 1.1 }));
    });

    expect(screen.getByText("110%")).toBeInTheDocument();
  });

  it("shows a notice when a zoom-blocked event arrives", async () => {
    render(<App />);

    await screen.findByText("로컬 AI에이전트 워크플레이스 : 공무원");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("gongmu-zoom-blocked", {
          detail: "이 창 크기에서는 더 확대할 수 없습니다. 창을 넓히거나 오른쪽 정보 패널을 접어주세요.",
        }),
      );
    });

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(
      screen.getByText("이 창 크기에서는 더 확대할 수 없습니다. 창을 넓히거나 오른쪽 정보 패널을 접어주세요."),
    ).toBeInTheDocument();
  });
});
