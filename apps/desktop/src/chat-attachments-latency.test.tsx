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
const openExternalTargetMock = vi.fn(async (_target: string) => undefined);

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: vi.fn(async () => runtimeState.status),
  startDesktopSidecar: vi.fn(async () => runtimeState.status),
  stopDesktopSidecar: vi.fn(async () => runtimeState.status),
  restartDesktopSidecar: vi.fn(async () => runtimeState.status),
  pickDirectory: vi.fn(async () => null),
  launchAnythingQuery: vi.fn(),
  openExternalTarget: (target: string) => openExternalTargetMock(target),
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

describe("Chat attachments and latency", () => {
  let workSessionsGetCount = 0;

  beforeEach(() => {
    openExternalTargetMock.mockClear();
    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: vi.fn(),
    });

    let workSessions: WorkSessionItem[] = [
      {
        id: "session-1",
        title: "Weekly report",
        schedule_id: null,
        status: "open",
        created_at: "2026-04-20T00:00:00+09:00",
        messages: [],
      },
    ];
    workSessionsGetCount = 0;

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
          workSessionsGetCount += 1;
          return jsonResponse({ items: workSessions });
        }

        if (url.endsWith("/api/work-sessions/session-1/attachments") && method === "POST") {
          return jsonResponse(
            {
              items: [
                {
                  id: "attachment-1",
                  session_id: "session-1",
                  message_id: null,
                  file_name: "notes.txt",
                  mime_type: "text/plain",
                  stored_path: "/tmp/gongmu-workspace/cache/attachments/session-1/notes.txt",
                  size_bytes: 12,
                  text_excerpt: "alpha beta",
                  created_at: "2026-04-20T00:00:01+09:00",
                },
                {
                  id: "attachment-2",
                  session_id: "session-1",
                  message_id: null,
                  file_name: "diagram.png",
                  mime_type: "image/png",
                  stored_path: "/tmp/gongmu-workspace/cache/attachments/session-1/diagram.png",
                  size_bytes: 256,
                  text_excerpt: null,
                  created_at: "2026-04-20T00:00:01+09:00",
                },
              ],
            },
            201,
          );
        }

        if (url.endsWith("/api/work-sessions/session-1/turn") && method === "POST") {
          expect(body.attachment_ids).toEqual(["attachment-1", "attachment-2"]);
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
                  attachments: [
                    {
                      id: "attachment-1",
                      session_id: "session-1",
                      message_id: "message-user",
                      file_name: "notes.txt",
                      mime_type: "text/plain",
                      stored_path: "/tmp/gongmu-workspace/cache/attachments/session-1/notes.txt",
                      size_bytes: 12,
                      text_excerpt: "alpha beta",
                      created_at: "2026-04-20T00:00:01+09:00",
                    },
                    {
                      id: "attachment-2",
                      session_id: "session-1",
                      message_id: "message-user",
                      file_name: "diagram.png",
                      mime_type: "image/png",
                      stored_path: "/tmp/gongmu-workspace/cache/attachments/session-1/diagram.png",
                      size_bytes: 256,
                      text_excerpt: null,
                      created_at: "2026-04-20T00:00:01+09:00",
                    },
                  ],
                  created_at: "2026-04-20T00:00:01+09:00",
                },
                {
                  id: "message-assistant",
                  session_id: "session-1",
                  role: "assistant",
                  text: [
                    "# 검토 요약",
                    "",
                    "> 첨부 근거를 기준으로 핵심만 정리했습니다.",
                    "",
                    "- 첨부 내용을 확인했습니다.",
                    "- **초안**을 바로 이어서 작성할 수 있습니다.",
                    "- 파일 열기: C:\\tmp\\weekly-report.hwpx",
                    "",
                    "1. 검토",
                    "2. 작성",
                    "",
                    "| 항목 | 값 |",
                    "| --- | --- |",
                    "| 근거 | 첨부파일 |",
                    "",
                    "```json",
                    "{\"status\":\"ok\"}",
                    "```",
                  ].join("\n"),
                  message_type: "chat",
                  status: "completed",
                  provider: "openai_compatible",
                  model: "gpt-4.1-mini",
                  latency_ms: 1234,
                  created_at: "2026-04-20T00:00:02+09:00",
                },
              ],
            },
          ];
          return jsonResponse(
            {
              user_message: workSessions[0]!.messages![0]!,
              assistant_message: workSessions[0]!.messages![1]!,
              duration_ms: 1234,
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

  it("uploads attachments, shows image previews, renders markdown output, and shows response latency", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    const input = await screen.findByTestId("chat-composer-input");
    await user.type(input, "Please summarize the attachment");

    const file = new File(["alpha beta"], "notes.txt", { type: "text/plain" });
    const image = new File(["fake-image"], "diagram.png", { type: "image/png" });
    await user.upload(screen.getByTestId("chat-attachment-input"), [file, image]);
    expect(await screen.findByAltText("diagram.png 미리보기")).toBeInTheDocument();
    const workSessionRequestsBeforeSubmit = workSessionsGetCount;

    await user.click(screen.getByTestId("chat-composer-submit"));

    const thread = screen.getByTestId("chat-thread-shell");
    expect(await within(thread).findByText("notes.txt")).toBeInTheDocument();
    expect(within(thread).getByText("diagram.png")).toBeInTheDocument();

    await waitFor(() => {
      expect(within(thread).getByRole("heading", { name: "검토 요약" })).toBeInTheDocument();
    });
    expect(within(thread).getByText("첨부 내용을 확인했습니다.")).toBeInTheDocument();
    expect(within(thread).getByText("초안")).toBeInTheDocument();
    expect(within(thread).getByText("첨부 근거를 기준으로 핵심만 정리했습니다.")).toBeInTheDocument();
    expect(within(thread).getByText("검토")).toBeInTheDocument();
    expect(within(thread).getByText("작성")).toBeInTheDocument();
    expect(within(thread).getByRole("cell", { name: "근거" })).toBeInTheDocument();
    expect(within(thread).getByRole("cell", { name: "첨부파일" })).toBeInTheDocument();
    expect(within(thread).getByText('{"status":"ok"}')).toBeInTheDocument();
    await user.click(within(thread).getByRole("button", { name: /파일 열기/ }));
    expect(openExternalTargetMock).toHaveBeenCalledWith("C:\\tmp\\weekly-report.hwpx");
    expect(within(thread).getByText("응답 1.2초")).toBeInTheDocument();
    expect(workSessionsGetCount).toBe(workSessionRequestsBeforeSubmit);
  });
  it("accumulates image previews, lets the user remove them, and opens a larger preview dialog", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    const attachmentInput = await screen.findByTestId("chat-attachment-input");
    const imageOne = new File(["image-one"], "one.png", { type: "image/png" });
    const imageTwo = new File(["image-two"], "two.png", { type: "image/png" });

    await user.upload(attachmentInput, imageOne);
    await user.upload(attachmentInput, imageTwo);

    expect(await screen.findByAltText("one.png 미리보기")).toBeInTheDocument();
    expect(await screen.findByAltText("two.png 미리보기")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "one.png 제거" }));
    await waitFor(() => {
      expect(screen.queryByAltText("one.png 미리보기")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "two.png 크게 보기" }));
    expect(screen.getByRole("dialog", { name: "two.png 미리보기" })).toBeInTheDocument();
  });

  it("renders detail settings as an overlay and keeps schedule controls outside the chat composer", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    const composer = await screen.findByTestId("chat-composer-form");
    expect(within(composer).queryByText("연결 일정")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /세부 설정/ }));
    expect(screen.getByRole("dialog", { name: "채팅 세부 설정" })).toBeInTheDocument();
  });
});
