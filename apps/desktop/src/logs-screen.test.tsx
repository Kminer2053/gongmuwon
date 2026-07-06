import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionLogItem } from "./api";

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
  launchAnythingQuery: vi.fn(async () => undefined),
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

function isoAt(date: Date, hour: number) {
  const next = new Date(date);
  next.setHours(hour, 0, 0, 0);
  return next.toISOString();
}

describe("실행기록 화면", () => {
  let logs: ExecutionLogItem[];

  beforeEach(() => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const older = new Date(now);
    older.setDate(older.getDate() - 5);

    logs = [
      {
        id: "log-schedule-today",
        feature: "schedule",
        action: "schedule.created",
        status: "success",
        created_at: isoAt(now, 9),
        inputs: { title: "주간 보고" },
        outputs: {},
        approval_ticket_id: null,
      },
      {
        id: "log-chat-failed-today",
        feature: "chat",
        action: "work_session.turn.failed",
        status: "failed",
        created_at: isoAt(now, 10),
        inputs: {},
        outputs: { error: "LLM server returned no assistant text." },
        approval_ticket_id: null,
      },
      {
        id: "log-knowledge-yesterday",
        feature: "knowledge",
        action: "knowledge.ingest.job.run",
        status: "completed",
        created_at: isoAt(yesterday, 14),
        inputs: {},
        outputs: { processed_count: 12 },
        approval_ticket_id: null,
      },
      {
        id: "log-settings-older",
        feature: "settings",
        action: "settings.updated",
        status: "success",
        created_at: isoAt(older, 8),
        inputs: {},
        outputs: {},
        approval_ticket_id: null,
      },
      {
        id: "log-unmapped-today",
        feature: "knowledge",
        action: "knowledge.some_future_action.done",
        status: "some_future_status",
        created_at: isoAt(now, 11),
        inputs: {},
        outputs: {},
        approval_ticket_id: null,
      },
    ];

    const settings = {
      defaults: {
        llm_mode: "local_first",
        llm_provider: "ollama",
        llm_model: "qwen3.6:27b",
        llm_api_key: null,
        llm_site_url: null,
        llm_application_name: null,
        anything_launch_mode: "external_app_preferred",
        default_template_key: "report",
        internal_api_base_url: "http://127.0.0.1:11434",
        personalization_apply_mode: "approval_required",
        profiles: {
          local_first: {
            provider: "ollama",
            model: "qwen3.6:27b",
            api_key: null,
            base_url: "http://127.0.0.1:11434",
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
        personalization_root: "/tmp/gongmu-workspace/personalization",
      },
    };

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

        if (url.endsWith("/api/settings") && method === "GET") {
          return jsonResponse(settings);
        }

        if (url.endsWith("/api/execution-logs")) {
          return jsonResponse({ items: logs });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": { items: [] },
          "/api/work-sessions": { items: [] },
          "/api/templates": { items: [] },
          "/api/approval-tickets": { items: [] },
          "/api/jobs?limit=20": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/knowledge/sources": { items: [] },
          "/api/knowledge/source-files": { items: [] },
          "/api/knowledge/ingestion-jobs": { items: [] },
          "/api/knowledge/documents": { items: [] },
          "/api/personalization/candidates": { items: [] },
          "/api/integrations/anything/launches": { items: [] },
          "/api/file-organizer/proposals": { items: [] },
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

  async function openLogs() {
    render(<App />);
    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await userEvent.click(within(navigation).getByRole("button", { name: "실행기록" }));
    return screen.findByTestId("logs-screen");
  }

  it("groups rows under 오늘/어제/이전 headings", async () => {
    const panel = await openLogs();

    expect(await within(panel).findByText("오늘")).toBeInTheDocument();
    expect(within(panel).getByText("어제")).toBeInTheDocument();
    expect(within(panel).getByText("이전")).toBeInTheDocument();
    expect(within(panel).getByText("일정 생성")).toBeInTheDocument();
    expect(within(panel).getByText("지식위키 색인 실행")).toBeInTheDocument();
    expect(within(panel).getByText("환경설정 저장")).toBeInTheDocument();
  });

  it("highlights failed rows and keeps developer JSON collapsed under 개발자 정보", async () => {
    const panel = await openLogs();

    const failedTitle = await within(panel).findByText("업무대화 응답 실패");
    const failedRow = failedTitle.closest(".logs-row") as HTMLElement;
    expect(failedRow.className).toContain("logs-row--failed");
    expect(within(failedRow).queryByText(/LLM server returned no assistant text\./)).not.toBeInTheDocument();

    await userEvent.click(within(failedRow).getByRole("button"));
    const devInfoDetails = within(failedRow).getByText("개발자 정보").closest("details") as HTMLElement;
    expect(devInfoDetails).not.toHaveAttribute("open");
    expect(within(failedRow).getByText(/LLM 응답 생성에 실패했습니다\./)).toBeInTheDocument();

    await userEvent.click(within(failedRow).getByText("개발자 정보"));
    expect(devInfoDetails).toHaveAttribute("open");
    expect(within(devInfoDetails).getByText(/LLM server returned no assistant text\./)).toBeInTheDocument();
  });

  it("filters rows by category chip", async () => {
    const panel = await openLogs();

    await within(panel).findByText("일정 생성");
    await userEvent.click(within(panel).getByRole("button", { name: "지식" }));

    expect(within(panel).getByText("지식위키 색인 실행")).toBeInTheDocument();
    expect(within(panel).queryByText("일정 생성")).not.toBeInTheDocument();
    expect(within(panel).queryByText("업무대화 응답 실패")).not.toBeInTheDocument();
  });

  it("filters to failed rows only", async () => {
    const panel = await openLogs();

    await within(panel).findByText("일정 생성");
    await userEvent.click(within(panel).getByRole("button", { name: "실패" }));

    expect(within(panel).getByText("업무대화 응답 실패")).toBeInTheDocument();
    expect(within(panel).queryByText("일정 생성")).not.toBeInTheDocument();
    expect(within(panel).queryByText("지식위키 색인 실행")).not.toBeInTheDocument();
  });

  it("shows an unmapped future action as a Korean fallback label, never the raw English id", async () => {
    const panel = await openLogs();

    const fallbackTitle = await within(panel).findByText("기타 작업(지식폴더)");
    expect(within(panel).queryByText("knowledge.some_future_action.done")).not.toBeInTheDocument();

    const fallbackRow = fallbackTitle.closest(".logs-row") as HTMLElement;
    expect(within(fallbackRow).getByText("기타 상태")).toBeInTheDocument();
    expect(within(fallbackRow).queryByText("some_future_status")).not.toBeInTheDocument();

    await userEvent.click(within(fallbackRow).getByRole("button"));
    await userEvent.click(within(fallbackRow).getByText("개발자 정보"));
    const devInfoDetails = within(fallbackRow).getByText("개발자 정보").closest("details") as HTMLElement;
    expect(within(devInfoDetails).queryByText("knowledge.some_future_action.done")).not.toBeInTheDocument();
    expect(within(devInfoDetails).queryByText("some_future_status")).not.toBeInTheDocument();
    expect(within(devInfoDetails).getByText("기타 작업")).toBeInTheDocument();
    expect(within(devInfoDetails).getByText("기타 상태")).toBeInTheDocument();
  });

  it("does not reference removed file-organizer/external-launch features in the empty state", async () => {
    logs = [];
    const panel = await openLogs();

    expect(await within(panel).findByText("실행기록이 없습니다.")).toBeInTheDocument();
    expect(within(panel).queryByText(/파일정리/)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/외부 실행/)).not.toBeInTheDocument();
  });
});
