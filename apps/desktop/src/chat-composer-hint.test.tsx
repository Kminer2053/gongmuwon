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
}));

import { App } from "./app";
import { CHAT_EXAMPLE_TIPS, dailyTipIndex } from "./shared/tips";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

// D-06: 앱 시작 화면이 홈이므로 채팅 검증은 먼저 업무대화 메뉴로 이동한다.
async function openChatFromHome() {
  const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
  fireEvent.click(within(navigation).getByRole("button", { name: "업무대화" }));
}

function installFetchStub({ llmConfigured = true }: { llmConfigured?: boolean } = {}) {
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
            // J-02 기준: external_model 모드에서 API 키가 없으면 LLM 미설정으로 판정된다.
            llm_mode: llmConfigured ? "local_first" : "external_model",
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

      if (url.endsWith("/api/work-sessions")) {
        return jsonResponse({
          items: [
            {
              id: "session-1",
              title: "예산 검토 세션",
              schedule_id: null,
              status: "open",
              created_at: "2026-07-01T00:00:00+09:00",
              messages: [],
            },
          ],
        });
      }

      if (url.endsWith("/api/work-sessions/session-1/file-links")) {
        return jsonResponse({ items: [] });
      }

      const emptyCollections = [
        "/api/schedules",
        "/api/templates",
        "/api/knowledge/candidates",
        "/api/knowledge/pages",
        "/api/knowledge/sources",
        "/api/knowledge/source-files",
        "/api/personalization/candidates",
        "/api/approval-tickets",
        "/api/execution-logs",
        "/api/tools",
      ];
      if (emptyCollections.some((path) => url.endsWith(path))) {
        return jsonResponse({ items: [] });
      }

      return jsonResponse({ detail: `Unhandled request: ${url}` }, 404);
    }),
  );
}

describe("chat composer idle hint (W6)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("shows today's deterministic example and fills the composer on click without sending", async () => {
    installFetchStub();
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();
    await screen.findByTestId("chat-workspace");

    // 결정적 회전: 날짜 기반 인덱스의 채팅 예시 팁이 그대로 나와야 한다.
    const expectedTip = CHAT_EXAMPLE_TIPS[dailyTipIndex(CHAT_EXAMPLE_TIPS.length)];
    const hint = await screen.findByTestId("chat-composer-hint");
    expect(hint).toHaveTextContent("이렇게 말해보세요");
    expect(hint).toHaveTextContent(expectedTip.chatExample!);

    // 예시 클릭 → 입력창에 문구만 채워지고 전송은 되지 않는다.
    await user.click(screen.getByTestId("chat-composer-hint-example"));
    expect(screen.getByTestId("chat-composer-input")).toHaveValue(expectedTip.chatExample);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(
      fetchMock.mock.calls.some(([request]) => String(request).includes("/turn")),
    ).toBe(false);
    expect(screen.queryByTestId("chat-thread-message")).not.toBeInTheDocument();

    // 입력창이 채워졌으므로 안내는 사라진다.
    expect(screen.queryByTestId("chat-composer-hint")).not.toBeInTheDocument();
  });

  it("hides the hint as soon as the user starts typing and shows it again when cleared", async () => {
    installFetchStub();
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();
    await screen.findByTestId("chat-workspace");

    await screen.findByTestId("chat-composer-hint");
    const input = screen.getByTestId("chat-composer-input");

    await user.type(input, "ㅇ");
    expect(screen.queryByTestId("chat-composer-hint")).not.toBeInTheDocument();

    await user.clear(input);
    expect(await screen.findByTestId("chat-composer-hint")).toBeInTheDocument();
  });

  it("does not stack with the J-02 LLM setup notice when the LLM is not configured", async () => {
    installFetchStub({ llmConfigured: false });
    render(<App />);
    await openChatFromHome();
    await screen.findByTestId("chat-workspace");

    await screen.findByTestId("llm-setup-notice");
    await waitFor(() => {
      expect(screen.queryByTestId("chat-composer-hint")).not.toBeInTheDocument();
    });
  });
});
