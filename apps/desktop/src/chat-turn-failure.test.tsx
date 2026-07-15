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
const copyTextToClipboardMock = vi.fn(async (_text: string) => undefined);

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: vi.fn(async () => runtimeState.status),
  startDesktopSidecar: vi.fn(async () => runtimeState.status),
  stopDesktopSidecar: vi.fn(async () => runtimeState.status),
  restartDesktopSidecar: vi.fn(async () => runtimeState.status),
  pickDirectory: vi.fn(async () => null),
  launchAnythingQuery: vi.fn(),
  openExternalTarget: (target: string) => openExternalTargetMock(target),
  copyTextToClipboard: (text: string) => copyTextToClipboardMock(text),
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

let turnFailuresRemaining = 0;
let turnPostCount = 0;

function installFetchStub(workSessions: WorkSessionItem[]) {
  turnPostCount = 0;

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

      if (url.endsWith("/api/work-sessions/session-1/turn") && method === "POST") {
        turnPostCount += 1;
        if (turnFailuresRemaining > 0) {
          turnFailuresRemaining -= 1;
          return jsonResponse({ detail: "LLM 서버 오류" }, 500);
        }
        return jsonResponse(
          {
            user_message: {
              id: `message-user-${turnPostCount}`,
              session_id: "session-1",
              role: "user",
              text: body.text,
              message_type: "chat",
              status: "completed",
              attachments: [],
              created_at: "2026-07-04T00:00:01+09:00",
            },
            assistant_message: {
              id: `message-assistant-${turnPostCount}`,
              session_id: "session-1",
              role: "assistant",
              text: "재시도 응답입니다.",
              message_type: "chat",
              status: "completed",
              provider: "openai_compatible",
              model: "gpt-4.1-mini",
              latency_ms: 200,
              created_at: "2026-07-04T00:00:02+09:00",
            },
            duration_ms: 200,
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
}

function baseSession(messages: WorkSessionItem["messages"] = []): WorkSessionItem {
  return {
    id: "session-1",
    title: "주간 보고",
    schedule_id: null,
    status: "open",
    created_at: "2026-07-04T00:00:00+09:00",
    messages,
  };
}

beforeEach(() => {
  openExternalTargetMock.mockClear();
  copyTextToClipboardMock.mockClear();
  turnFailuresRemaining = 0;
  Object.defineProperty(URL, "createObjectURL", {
    writable: true,
    value: vi.fn((file: File) => `blob:${file.name}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    writable: true,
    value: vi.fn(),
  });
});

// D-06: 앱 시작 화면이 홈(오늘의 브리핑)으로 바뀌어, 채팅 검증은 먼저 업무대화 메뉴로 이동한다.
async function openChatFromHome() {
  const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
  fireEvent.click(within(navigation).getByRole("button", { name: "업무대화" }));
}

describe("failed chat turns", () => {
  it("marks the failed turn, restores the draft, and retries with the same payload", async () => {
    turnFailuresRemaining = 1;
    installFetchStub([baseSession()]);
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    const input = await screen.findByTestId("chat-composer-input");
    await user.type(input, "보고서를 요약해줘");
    await user.click(screen.getByTestId("chat-composer-submit"));

    const thread = screen.getByTestId("chat-thread-shell");
    expect(await within(thread).findByText("응답을 완료하지 못했습니다.")).toBeInTheDocument();
    // 실패 pill로 표기하고 응답 시간 pill은 보여주지 않는다.
    expect(within(thread).getByText("실패")).toBeInTheDocument();
    expect(within(thread).queryByText(/^응답 \d/)).not.toBeInTheDocument();
    // 원문 오류는 접힌 상세 정보로 제공한다.
    expect(within(thread).getByText("상세 정보")).toBeInTheDocument();
    expect(within(thread).getByText(/LLM 서버 오류/)).toBeInTheDocument();
    expect(within(thread).getByRole("button", { name: "환경설정으로 이동" })).toBeInTheDocument();

    // J-03: 실패해도 입력창에 초안이 복원된다.
    expect(input).toHaveValue("보고서를 요약해줘");

    await user.click(within(thread).getByRole("button", { name: "다시 시도" }));

    expect(await within(thread).findByText("재시도 응답입니다.")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(thread).queryByText("응답을 완료하지 못했습니다.")).not.toBeInTheDocument();
    });
    expect(turnPostCount).toBe(2);
    // 재시도로 소진된 초안은 입력창에서 비워진다.
    expect(screen.getByTestId("chat-composer-input")).toHaveValue("");
  });
});

describe("assistant citations", () => {
  it("renders source chips with open and copy actions", async () => {
    installFetchStub([
      baseSession([
        {
          id: "message-assistant-cited",
          session_id: "session-1",
          role: "assistant",
          text: "예산 검토 근거를 정리했습니다.",
          message_type: "chat",
          status: "completed",
          provider: "openai_compatible",
          model: "gpt-4.1-mini",
          latency_ms: 800,
          citations: [
            { title: "예산 지침", file_path: "C:/docs/budget.hwp", snippet: "예산 편성 기준" },
            { title: "", file_path: "C:/docs/plan.md" },
          ],
          created_at: "2026-07-04T00:00:02+09:00",
        },
      ]),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    const thread = await screen.findByTestId("chat-thread-shell");
    expect(await within(thread).findByText("출처")).toBeInTheDocument();
    expect(within(thread).getByText("예산 지침")).toBeInTheDocument();
    // 제목이 없으면 파일명(확장자 제외)으로 대신 표기한다 — displayTitleForFile 규칙과 일치.
    expect(within(thread).getByText("plan")).toBeInTheDocument();

    await user.click(within(thread).getByRole("button", { name: "예산 지침 원본 열기" }));
    expect(openExternalTargetMock).toHaveBeenCalledWith("C:/docs/budget.hwp");

    await user.click(within(thread).getByRole("button", { name: "예산 지침 경로 복사" }));
    expect(copyTextToClipboardMock).toHaveBeenCalledWith("C:/docs/budget.hwp");
  });

  it("renders nothing for legacy messages without citations", async () => {
    installFetchStub([
      baseSession([
        {
          id: "message-assistant-plain",
          session_id: "session-1",
          role: "assistant",
          text: "출처 없이 답변합니다.",
          message_type: "chat",
          status: "completed",
          created_at: "2026-07-04T00:00:02+09:00",
        },
      ]),
    ]);
    render(<App />);
    await openChatFromHome();

    const thread = await screen.findByTestId("chat-thread-shell");
    await within(thread).findByText("출처 없이 답변합니다.");
    expect(within(thread).queryByText("출처")).not.toBeInTheDocument();
  });
});

describe("composer attachments", () => {
  it("adds a pasted clipboard image as a timestamped attachment draft", async () => {
    installFetchStub([baseSession()]);
    render(<App />);
    await openChatFromHome();

    const input = await screen.findByTestId("chat-composer-input");
    const image = new File(["fake-image"], "raw.png", { type: "image/png" });
    fireEvent.paste(input, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => image }],
      },
    });

    const namedNodes = await screen.findAllByText(/^클립보드-\d{8}-\d{6}\.png$/);
    expect(namedNodes.length).toBeGreaterThan(0);
  });

  it("adds dropped files to the attachment drafts", async () => {
    installFetchStub([baseSession()]);
    render(<App />);
    await openChatFromHome();

    const composer = await screen.findByTestId("chat-composer-form");
    const dropped = new File(["dropped"], "dropped.txt", { type: "text/plain" });
    fireEvent.drop(composer, {
      dataTransfer: {
        types: ["Files"],
        files: [dropped],
      },
    });

    expect(await screen.findByText("dropped.txt")).toBeInTheDocument();
  });

  it("exposes the attachment trigger as a real keyboard-accessible button", async () => {
    installFetchStub([baseSession()]);
    render(<App />);
    await openChatFromHome();

    const trigger = await screen.findByTestId("chat-attachment-trigger");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAccessibleName("파일 첨부");
  });
});
