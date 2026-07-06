import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkSessionItem, WorkSessionMessageCitation } from "./api";

// W7 §5.5/§5.6: 인용 칩 [원본 열기]의 지식카드 폴백 3분기 검증
// ① 원본 정상 → 원본 열기 ② 원본 없음 + 카드 있음 → 카드 열기 + 안내 토스트
// ③ 원본·카드 모두 없음 → 실패 안내 토스트

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
}));

import { App } from "./app";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

// 테스트별로 by-uid 응답을 구성한다: doc_uid → 카드 조회 결과(또는 404).
let cardByUidResponses: Record<string, { payload: unknown; status?: number }> = {};
let cardByUidRequestedUids: string[] = [];

function installFetchStub(workSessions: WorkSessionItem[]) {
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

      const byUidMatch = url.match(/\/api\/knowledge\/cards\/by-uid\/([^/?#]+)$/);
      if (byUidMatch && method === "GET") {
        const docUid = decodeURIComponent(byUidMatch[1]);
        cardByUidRequestedUids.push(docUid);
        const configured = cardByUidResponses[docUid];
        if (!configured) {
          return jsonResponse({ detail: "card not found" }, 404);
        }
        return jsonResponse(configured.payload, configured.status ?? 200);
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

function citedSession(citations: WorkSessionMessageCitation[]): WorkSessionItem {
  return {
    id: "session-1",
    title: "주간 보고",
    schedule_id: null,
    status: "open",
    created_at: "2026-07-04T00:00:00+09:00",
    messages: [
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
        citations,
        created_at: "2026-07-04T00:00:02+09:00",
      },
    ],
  };
}

beforeEach(() => {
  openExternalTargetMock.mockClear();
  openExternalTargetMock.mockImplementation(async (_target: string) => undefined);
  copyTextToClipboardMock.mockClear();
  cardByUidResponses = {};
  cardByUidRequestedUids = [];
});

async function openChatFromHome() {
  const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
  fireEvent.click(within(navigation).getByRole("button", { name: "업무대화" }));
}

describe("citation chip original-open fallback (W7 §5.5/§5.6)", () => {
  it("opens the original file when the document is still active", async () => {
    cardByUidResponses["uid-budget1"] = {
      payload: {
        card_path: "/tmp/gongmu-workspace/knowledge/wiki/docs/budget-uid-budget1.md",
        exists: true,
        status: "active",
        title: "예산 지침",
      },
    };
    installFetchStub([
      citedSession([
        {
          title: "예산 지침",
          file_path: "C:/docs/budget.hwp",
          snippet: "예산 편성 기준",
          doc_uid: "uid-budget1",
        },
      ]),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    const thread = await screen.findByTestId("chat-thread-shell");
    await user.click(await within(thread).findByRole("button", { name: "예산 지침 원본 열기" }));

    await waitFor(() => {
      expect(openExternalTargetMock).toHaveBeenCalledWith("C:/docs/budget.hwp");
    });
    expect(openExternalTargetMock).toHaveBeenCalledTimes(1);
    // 정상 열림이면 폴백 안내 토스트가 없다.
    expect(screen.queryByText("원본이 이동/삭제되어 지식카드를 엽니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("원본과 지식카드를 찾을 수 없습니다.")).not.toBeInTheDocument();
  });

  it("falls back to the knowledge card with a toast when the original is missing", async () => {
    cardByUidResponses["uid-budget1"] = {
      payload: {
        card_path: "/tmp/gongmu-workspace/knowledge/wiki/docs/budget-uid-budget1.md",
        exists: true,
        status: "missing",
        title: "예산 지침",
      },
    };
    installFetchStub([
      citedSession([
        {
          title: "예산 지침",
          file_path: "C:/docs/budget.hwp",
          snippet: "예산 편성 기준",
          doc_uid: "uid-budget1",
        },
      ]),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    const thread = await screen.findByTestId("chat-thread-shell");
    await user.click(await within(thread).findByRole("button", { name: "예산 지침 원본 열기" }));

    await waitFor(() => {
      expect(openExternalTargetMock).toHaveBeenCalledWith(
        "/tmp/gongmu-workspace/knowledge/wiki/docs/budget-uid-budget1.md",
      );
    });
    // 원본(missing)은 열지 않고 카드만 연다.
    expect(openExternalTargetMock).not.toHaveBeenCalledWith("C:/docs/budget.hwp");
    expect(await screen.findByText("원본이 이동/삭제되어 지식카드를 엽니다.")).toBeInTheDocument();
  });

  it("shows a failure toast when neither the original nor the card exists", async () => {
    cardByUidResponses["uid-budget1"] = {
      payload: {
        card_path: "/tmp/gongmu-workspace/knowledge/wiki/docs/budget-uid-budget1.md",
        exists: false,
        status: "missing",
        title: "예산 지침",
      },
    };
    installFetchStub([
      citedSession([
        {
          title: "예산 지침",
          file_path: "C:/docs/budget.hwp",
          snippet: "예산 편성 기준",
          doc_uid: "uid-budget1",
        },
      ]),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    const thread = await screen.findByTestId("chat-thread-shell");
    await user.click(await within(thread).findByRole("button", { name: "예산 지침 원본 열기" }));

    expect(await screen.findByText("원본과 지식카드를 찾을 수 없습니다.")).toBeInTheDocument();
    expect(openExternalTargetMock).not.toHaveBeenCalled();
  });

  it("falls back to the card when opening the original throws even though status is active", async () => {
    cardByUidResponses["uid-budget1"] = {
      payload: {
        card_path: "/tmp/gongmu-workspace/knowledge/wiki/docs/budget-uid-budget1.md",
        exists: true,
        status: "active",
        title: "예산 지침",
      },
    };
    openExternalTargetMock.mockImplementation(async (target: string) => {
      if (target === "C:/docs/budget.hwp") {
        throw new Error("파일을 열 수 없습니다");
      }
      return undefined;
    });
    installFetchStub([
      citedSession([
        {
          title: "예산 지침",
          file_path: "C:/docs/budget.hwp",
          snippet: "예산 편성 기준",
          doc_uid: "uid-budget1",
        },
      ]),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    const thread = await screen.findByTestId("chat-thread-shell");
    await user.click(await within(thread).findByRole("button", { name: "예산 지침 원본 열기" }));

    await waitFor(() => {
      expect(openExternalTargetMock).toHaveBeenCalledWith(
        "/tmp/gongmu-workspace/knowledge/wiki/docs/budget-uid-budget1.md",
      );
    });
    expect(await screen.findByText("원본이 이동/삭제되어 지식카드를 엽니다.")).toBeInTheDocument();
  });

  it("keeps the legacy behavior (no card lookup) for citations without doc_uid", async () => {
    installFetchStub([
      citedSession([{ title: "예산 지침", file_path: "C:/docs/budget.hwp", snippet: "예산 편성 기준" }]),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    const thread = await screen.findByTestId("chat-thread-shell");
    await user.click(await within(thread).findByRole("button", { name: "예산 지침 원본 열기" }));

    await waitFor(() => {
      expect(openExternalTargetMock).toHaveBeenCalledWith("C:/docs/budget.hwp");
    });
    // doc_uid가 없으면 by-uid 조회를 하지 않는다.
    expect(cardByUidRequestedUids).toHaveLength(0);
  });
});
