import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  launchAnythingQuery: vi.fn(),
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

async function openMenu(label: string) {
  const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
  fireEvent.click(within(navigation).getByRole("button", { name: label }));
}

describe("chat thread focus and return chip (W5-1 / W5-2)", () => {
  // jsdom에는 Element.scrollTo가 없어 store의 scrollChatThreadToBottom이 scrollTop 대입으로
  // 폴백한다. 프로토타입 mock으로 "맨 아래로 스크롤" 호출 자체를 검증한다.
  const scrollToMock = vi.fn();

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: scrollToMock,
    });
    scrollToMock.mockClear();

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

        if (url.endsWith("/api/work-sessions")) {
          return jsonResponse({
            items: [
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
                    text: "세션 준비가 끝났습니다.",
                    created_at: "2026-04-20T00:00:00+09:00",
                  },
                ],
              },
            ],
          });
        }

        if (url.endsWith("/api/work-sessions/session-1/file-links")) {
          return jsonResponse({ items: [] });
        }

        if (url.endsWith("/api/schedules/reminders/due")) {
          return jsonResponse({ items: [], now: "2026-04-20T08:00:00+09:00" });
        }

        if (url.endsWith("/api/schedules")) {
          return jsonResponse({
            items: [
              {
                id: "schedule-1",
                title: "주간 보고 준비",
                starts_at: "2026-04-20T09:00:00+09:00",
                ends_at: "2026-04-20T10:00:00+09:00",
                view: "week",
                created_at: "2026-04-20T00:00:00+09:00",
              },
            ],
          });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/templates": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/knowledge/sources": { items: [] },
          "/api/knowledge/source-files": { items: [] },
          "/api/approval-tickets": { items: [] },
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

  afterEach(() => {
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  });

  it("scrolls the thread to the bottom when the chat menu is opened and re-opened (W5-1)", async () => {
    render(<App />);
    await openMenu("업무대화");

    await screen.findByTestId("chat-thread-shell");
    // 최초 진입: 마지막 메시지가 보이도록 맨 아래로 스크롤한다.
    await waitFor(() => expect(scrollToMock).toHaveBeenCalled());

    // 다른 메뉴에 다녀온 뒤 재진입해도 다시 맨 아래로 내려간다.
    await openMenu("일정");
    await screen.findByTestId("schedule-planner-section");
    scrollToMock.mockClear();

    await openMenu("업무대화");
    await screen.findByTestId("chat-thread-shell");
    await waitFor(() => expect(scrollToMock).toHaveBeenCalled());
  });

  it("shows a return chip on the schedule screen and jumps back to the chat session (W5-2)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openMenu("업무대화");

    await screen.findByTestId("chat-workspace");

    // 툴바 [연결 일정 열기] → 일정 화면으로 이동하면서 복귀 컨텍스트가 남는다.
    await user.click(await screen.findByTestId("open-selected-session-schedule"));

    const chip = await screen.findByTestId("schedule-chat-return-chip");
    expect(chip).toHaveTextContent("‘주간 보고 작업’ 대화에서 이동함");

    // [대화로 돌아가기] → 같은 세션의 업무대화로 복귀 + 칩 제거.
    await user.click(screen.getByTestId("schedule-chat-return-button"));
    await screen.findByTestId("chat-workspace");
    expect(screen.getByTestId("chat-panel-card")).toHaveTextContent("주간 보고 작업");

    // 복귀 후 다시 일정 메뉴를 직접 열면 칩은 사라져 있어야 한다.
    await openMenu("일정");
    await screen.findByTestId("schedule-planner-section");
    expect(screen.queryByTestId("schedule-chat-return-chip")).not.toBeInTheDocument();
  });
});
