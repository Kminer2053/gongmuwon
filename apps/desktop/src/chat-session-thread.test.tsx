import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkSessionMessageItem } from "./api";

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

describe("Chat session thread", () => {
  beforeEach(() => {
    const messages: WorkSessionMessageItem[] = [
      {
        id: "message-1",
        session_id: "session-1",
        role: "assistant" as const,
        text: "세션 준비가 끝났습니다.",
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
                messages,
              },
            ],
          });
        }

        if (url.endsWith("/api/work-sessions/session-1/turn") && method === "POST") {
          const createdUserMessage = {
            id: `message-${messages.length + 1}`,
            session_id: "session-1",
            role: "user" as const,
            text: body.text,
            message_type: "chat" as const,
            status: "completed" as const,
            created_at: "2026-04-20T00:05:00+09:00",
          };
          const createdAssistantMessage = {
            id: `message-${messages.length + 2}`,
            session_id: "session-1",
            role: "assistant" as const,
            text: "좋습니다. 초안 구조를 정리해보겠습니다.",
            message_type: "chat" as const,
            status: "completed" as const,
            provider: "openai_compatible",
            model: "gpt-4.1-mini",
            created_at: "2026-04-20T00:05:01+09:00",
          };
          messages.push(createdUserMessage, createdAssistantMessage);
          return jsonResponse(
            {
              user_message: createdUserMessage,
              assistant_message: createdAssistantMessage,
            },
            201,
          );
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

        const matched = Object.entries(collectionMap).find(([path]) => url.endsWith(path));
        if (matched) {
          return jsonResponse(matched[1]);
        }

        return jsonResponse({ detail: `Unhandled request: ${url}` }, 404);
      }),
    );
  });

  it("appends a typed message into the selected session thread", async () => {
    const user = userEvent.setup();
    render(<App />);

    const composer = await screen.findByTestId("chat-composer-form");
    const textarea = within(composer).getByTestId("chat-composer-input");

    await user.type(textarea, "회의자료 초안부터 정리해줘");
    await user.click(within(composer).getByTestId("chat-composer-submit"));

    expect(await screen.findByText("회의자료 초안부터 정리해줘")).toBeInTheDocument();
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });
});
