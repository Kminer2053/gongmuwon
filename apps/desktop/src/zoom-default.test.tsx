import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ZOOM_SCALE_STORAGE_KEY } from "./store";

const { setDesktopZoomMock, appListeners, webviewWindowListeners } = vi.hoisted(() => ({
  setDesktopZoomMock: vi.fn(async (scale: number) => scale),
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
  getCurrentWebview: () => ({ setZoom: vi.fn(async () => undefined) }),
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
  setDesktopZoom: setDesktopZoomMock,
}));

import { App } from "./app";

const TITLE = "로컬 AI에이전트 워크플레이스 : 공무원";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

beforeEach(() => {
  setDesktopZoomMock.mockClear();
  appListeners.clear();
  webviewWindowListeners.clear();
  window.localStorage.clear();

  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600, writable: true });

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
      const emptyCollections = [
        "/api/schedules",
        "/api/work-sessions",
        "/api/templates",
        "/api/knowledge/candidates",
        "/api/knowledge/pages",
        "/api/approval-tickets",
        "/api/integrations/anything/launches",
        "/api/file-organizer/proposals",
        "/api/execution-logs",
        "/api/tools",
      ];
      if (emptyCollections.some((path) => url.endsWith(path))) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ detail: `Unhandled request: GET ${url}` }, 404);
    }),
  );
});

function shellFontScale(): string {
  const shell = document.querySelector(".workspace-shell") as HTMLElement | null;
  return shell?.style.getPropertyValue("--ui-font-scale").trim() ?? "";
}

describe("기본 배율 90% + 영속화 (T1)", () => {
  it("S1: 저장값이 없으면 배지 90% + --ui-font-scale 0.9", async () => {
    render(<App />);
    await screen.findByText(TITLE);
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(shellFontScale()).toBe("0.9");
  });

  it("S1: 부팅 시 setDesktopZoom(0.9)이 호출된다", async () => {
    render(<App />);
    await screen.findByText(TITLE);
    expect(setDesktopZoomMock).toHaveBeenCalledWith(0.9);
  });

  it("S2: 저장값 1.2를 복원해 배지 120% + setDesktopZoom(1.2)", async () => {
    window.localStorage.setItem(ZOOM_SCALE_STORAGE_KEY, "1.2");
    render(<App />);
    await screen.findByText(TITLE);
    expect(screen.getByText("120%")).toBeInTheDocument();
    expect(setDesktopZoomMock).toHaveBeenCalledWith(1.2);
  });

  it("S3: zoom-scale 1.1 수신 시 localStorage에 1.1 저장 + 배지 110%", async () => {
    render(<App />);
    await screen.findByText(TITLE);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("gongmu-zoom-scale", { detail: 1.1 }));
    });

    expect(screen.getByText("110%")).toBeInTheDocument();
    expect(window.localStorage.getItem(ZOOM_SCALE_STORAGE_KEY)).toBe("1.1");
  });

  it.each([
    ["abc", "잘못된 문자열"],
    ["9", "범위 초과(>1.5)"],
    ["0.1", "범위 미만(<0.8)"],
  ])("S6-NEG: 오염 저장값 %s(%s)은 90%로 폴백", async (stored) => {
    window.localStorage.setItem(ZOOM_SCALE_STORAGE_KEY, stored);
    render(<App />);
    await screen.findByText(TITLE);
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(setDesktopZoomMock).toHaveBeenCalledWith(0.9);
  });

  it("S7-NEG: zoom-blocked 수신 시 배율 90% 유지 + 안내문 표출", async () => {
    render(<App />);
    await screen.findByText(TITLE);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("gongmu-zoom-blocked", {
          detail: "이 창 크기에서는 더 확대할 수 없습니다. 창을 넓히거나 오른쪽 정보 패널을 접어주세요.",
        }),
      );
    });

    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(
      screen.getByText("이 창 크기에서는 더 확대할 수 없습니다. 창을 넓히거나 오른쪽 정보 패널을 접어주세요."),
    ).toBeInTheDocument();
  });
});
