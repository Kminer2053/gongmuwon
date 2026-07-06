import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkSessionItem } from "./api";

const runtimeState = {
  status: {
    available: true,
    mode: "tauri" as const,
    sidecar_url: "http://127.0.0.1:8765",
    anything_available: true,
    anything_mode: "external_app_detected" as const,
    anything_path: "C:/Users/USER/AppData/Local/Anything/docufinder.exe",
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

// D-06: 앱 시작 화면이 홈(오늘의 브리핑)으로 바뀌어, 채팅 검증은 먼저 업무대화 메뉴로 이동한다.
async function openChatFromHome() {
  const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
  fireEvent.click(within(navigation).getByRole("button", { name: "업무대화" }));
}

describe("Chat turn submit", () => {
  beforeEach(() => {
    let workSessions: WorkSessionItem[] = [
      {
        id: "session-1",
        title: "Weekly report session",
        schedule_id: null,
        status: "open",
        created_at: "2026-04-20T00:00:00+09:00",
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
              llm_mode: "internal_server",
              llm_provider: "openai_compatible",
              llm_model: "gpt-4.1-mini",
              llm_api_key: null,
              llm_site_url: null,
              llm_application_name: null,
              anything_launch_mode: "external_app_preferred",
              default_template_key: "report",
              internal_api_base_url: "http://127.0.0.1:9000/v1",
              profiles: {
                local_first: {
                  provider: "openai_compatible",
                  model: "gpt-4.1-mini",
                  api_key: null,
                  base_url: null,
                  site_url: null,
                  application_name: null,
                },
                internal_server: {
                  provider: "openai_compatible",
                  model: "gpt-4.1-mini",
                  api_key: null,
                  base_url: "http://127.0.0.1:9000/v1",
                  site_url: null,
                  application_name: null,
                },
                external_model: {
                  active_provider: "openai",
                  providers: {
                    openai: {
                      provider: "openai",
                      model: "gpt-5.5",
                      api_key: null,
                      base_url: "https://api.openai.com/v1",
                      site_url: null,
                      application_name: null,
                    },
                  },
                },
              },
            },
            paths: {
              workspace_root: "/tmp/gongmu-workspace",
              database: "/tmp/gongmu-workspace/db/gongmu.db",
              knowledge_root: "/tmp/gongmu-workspace/knowledge",
              documents_root: "/tmp/gongmu-workspace/documents",
            },
          });
        }

        if (url.endsWith("/api/work-sessions") && method === "GET") {
          return jsonResponse({ items: workSessions });
        }

        if (url.endsWith("/api/work-sessions/session-1/turn/stream") && method === "POST") {
          const userMessage = {
            id: "message-user",
            session_id: "session-1",
            role: "user" as const,
            text: body.text,
            message_type: "chat" as const,
            status: "completed" as const,
            created_at: "2026-04-20T00:00:01+09:00",
            attachments: [],
          };
          const assistantMessage = {
            id: "message-assistant",
            session_id: "session-1",
            role: "assistant" as const,
            text: "I will start by outlining the weekly report draft.",
            message_type: "chat" as const,
            status: "completed" as const,
            provider: "openai_compatible",
            model: "gpt-4.1-mini",
            latency_ms: 840,
            created_at: "2026-04-20T00:00:02+09:00",
          };
          workSessions = [{ ...workSessions[0], messages: [userMessage, assistantMessage] }];
          const encoder = new TextEncoder();
          const result = {
            user_message: userMessage,
            assistant_message: assistantMessage,
            duration_ms: 840,
            context_summary: {
              graphrag_used: true,
              graphrag_evidence_count: 3,
              attachment_count: 0,
              linked_file_count: 2,
              provider: "openai_compatible",
              model: "gpt-4.1-mini",
            },
          };
          return Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    encoder.encode(
                      [
                        `event: user_message\ndata: ${JSON.stringify(userMessage)}\n`,
                        `event: assistant_message\ndata: ${JSON.stringify({ ...assistantMessage, text: "", status: "streaming" })}\n`,
                        'event: delta\ndata: {"text":"I will start by "}\n',
                        'event: delta\ndata: {"text":"outlining the weekly report draft."}\n',
                        `event: done\ndata: ${JSON.stringify(result)}\n`,
                      ].join("\n"),
                    ),
                  );
                  controller.close();
                },
              }),
              { status: 200, headers: { "Content-Type": "text/event-stream" } },
            ),
          );
        }

        if (url.endsWith("/api/work-sessions/session-1/turn") && method === "POST") {
          workSessions = [
            {
              ...workSessions[0],
              messages: [
                {
                  id: "message-user",
                  session_id: "session-1",
                  role: "user",
                  text: body.text,
                  message_type: "chat",
                  status: "completed",
                  created_at: "2026-04-20T00:00:01+09:00",
                },
                {
                  id: "message-assistant",
                  session_id: "session-1",
                  role: "assistant",
                  text: "I will start by outlining the weekly report draft.",
                  message_type: "chat",
                  status: "completed",
                  provider: "openai_compatible",
                  model: "gpt-4.1-mini",
                  latency_ms: 840,
                  created_at: "2026-04-20T00:00:02+09:00",
                },
              ],
            },
          ];
          return jsonResponse(
            {
              user_message: workSessions[0]!.messages![0]!,
              assistant_message: workSessions[0]!.messages![1]!,
              duration_ms: 840,
              context_summary: {
                graphrag_used: true,
                graphrag_evidence_count: 3,
                attachment_count: 0,
                linked_file_count: 2,
                provider: "openai_compatible",
                model: "gpt-4.1-mini",
              },
            },
            201,
          );
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": { items: [] },
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

        return jsonResponse({ detail: `Unhandled request: ${method} ${url}` }, 404);
      }),
    );
  });

  it("submits a chat turn and renders the assistant reply in the session thread", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    const composer = await screen.findByTestId("chat-composer-input");
    await user.type(composer, "Please outline the weekly report");
    await user.click(screen.getByTestId("chat-composer-submit"));

    const chatThread = screen.getByTestId("chat-thread-shell");
    await waitFor(() => {
      expect(within(chatThread).getByText("I will start by outlining the weekly report draft.")).toBeInTheDocument();
    });
    expect(within(chatThread).getByText("응답 840ms")).toBeInTheDocument();
    expect(screen.getByTestId("chat-context-evidence")).toHaveTextContent("지식위키 근거 3개");
    expect(screen.getByTestId("chat-context-evidence")).toHaveTextContent("연결 파일 2개");
  });

  it("submits the chat turn when Enter is pressed without Shift", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    const composer = await screen.findByTestId("chat-composer-input");
    await user.type(composer, "Please outline the weekly report{enter}");

    await waitFor(() => {
      expect(
        within(screen.getByTestId("chat-thread-shell")).getByText(
          "I will start by outlining the weekly report draft.",
        ),
      ).toBeInTheDocument();
    });
  });
});
