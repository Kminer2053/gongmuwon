import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  setDesktopZoom: vi.fn(async () => undefined),
  pickDirectory: vi.fn(async () => null),
  launchAnythingQuery: vi.fn(async () => undefined),
  openExternalTarget: vi.fn(async () => undefined),
  copyTextToClipboard: vi.fn(async () => undefined),
}));

import { App } from "./app";
import {
  CONTEXT_PANE_STORAGE_KEY,
  describeIngestionLogEvent,
  describeIngestionLogStage,
  summarizeWorkJobError,
} from "./layout/ContextPane";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

type StubOptions = {
  approvalTickets?: Array<Record<string, unknown>>;
  workJobs?: Array<Record<string, unknown>>;
};

function makeWorkJob(overrides: Record<string, unknown>) {
  return {
    id: "job-x",
    kind: "knowledge.ingest",
    title: "이름 없는 작업",
    status: "succeeded",
    priority: 5,
    resource_key: null,
    resource_policy: "exclusive",
    progress_percent: 100,
    current_stage: null,
    cancel_requested: false,
    input: {},
    result: {},
    error_message: null,
    created_at: "2026-07-01T09:00:00+09:00",
    queued_at: "2026-07-01T09:00:00+09:00",
    started_at: "2026-07-01T09:00:01+09:00",
    completed_at: "2026-07-01T09:10:00+09:00",
    ...overrides,
  };
}

function installFetchStub(options: StubOptions = {}) {
  const approvalTickets = options.approvalTickets ?? [];
  const workJobs = options.workJobs ?? [];

  const schedules = [
    {
      id: "schedule-1",
      title: "주간 업무 보고",
      starts_at: "2099-04-20T09:00:00+09:00",
      ends_at: "2099-04-20T10:00:00+09:00",
      view: "week",
      created_at: "2026-04-20T00:00:00+09:00",
    },
  ];

  const workSessions = [
    {
      id: "session-1",
      title: "주간 보고 작업",
      schedule_id: "schedule-1",
      status: "open",
      created_at: "2026-04-20T09:00:00+09:00",
      messages: [],
    },
  ];

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
            llm_mode: "local_first",
            llm_provider: "openai_compatible",
            llm_model: "gpt-4.1-mini",
            llm_api_key: null,
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

      if (url.endsWith("/api/schedules")) {
        return jsonResponse({ items: schedules });
      }

      if (url.endsWith("/api/work-sessions")) {
        return jsonResponse({ items: workSessions });
      }

      if (url.match(/\/api\/work-sessions\/[^/]+\/file-links$/)) {
        return jsonResponse({ items: [] });
      }

      const decisionMatch = url.match(/\/api\/approval-tickets\/([^/]+)\/decision$/);
      if (decisionMatch && method === "POST") {
        const ticket = approvalTickets.find((item) => item.id === decisionMatch[1]);
        if (ticket) {
          const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
          ticket.status = body.status ?? "approved";
          ticket.decided_at = "2026-07-04T10:00:00+09:00";
          return jsonResponse(ticket);
        }
        return jsonResponse({ detail: "ticket not found" }, 404);
      }

      if (url.endsWith("/api/approval-tickets")) {
        return jsonResponse({ items: approvalTickets });
      }

      if (url.match(/\/api\/jobs\/[^/]+\/events/)) {
        return jsonResponse({ items: [] });
      }

      if (url.includes("/api/jobs")) {
        return jsonResponse({ items: workJobs });
      }

      const collectionMap: Record<string, unknown> = {
        "/api/templates": { items: [] },
        "/api/knowledge/candidates": { items: [] },
        "/api/knowledge/pages": { items: [] },
        "/api/execution-logs": { items: [] },
      };

      const matched = Object.entries(collectionMap).find(([path]) => url.endsWith(path));
      if (matched) {
        return jsonResponse(matched[1]);
      }

      return jsonResponse({ detail: `Unhandled request: ${method} ${url}` }, 404);
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("summarizeWorkJobError (raw 오류 한글 요약)", () => {
  it("maps LLM 404 responses to a Korean summary", () => {
    expect(summarizeWorkJobError('LLM request failed (404): {"error":{"message":"model not found"}}')).toBe(
      "모델 요청이 실패했습니다(404). 모델 주소나 모델 이름을 확인해 주세요.",
    );
  });

  it("maps auth and server errors by status code", () => {
    expect(summarizeWorkJobError("LLM request failed (401): unauthorized")).toContain("모델 인증에 실패했습니다(401)");
    expect(summarizeWorkJobError("LLM request failed (429): too many requests")).toContain("429");
    expect(summarizeWorkJobError("LLM request failed (500): internal error")).toContain("모델 서버 오류가 발생했습니다(500)");
  });

  it("falls back to a generic Korean message", () => {
    expect(summarizeWorkJobError(undefined)).toBe("작업이 실패했습니다.");
    expect(summarizeWorkJobError("")).toBe("작업이 실패했습니다.");
    expect(summarizeWorkJobError("something went wrong")).toBe("작업이 실패했습니다.");
  });

  it("keeps an existing Korean first line as the summary", () => {
    expect(summarizeWorkJobError("파일을 읽지 못했습니다.\ntraceback...")).toBe("파일을 읽지 못했습니다.");
  });
});

describe("색인 상세 로그 라벨 매핑 (C-12)", () => {
  it("maps known ingestion log events to Korean", () => {
    expect(describeIngestionLogEvent("file.failed", 0)).toBe("파일 처리 실패");
    expect(describeIngestionLogEvent("job.completed", 0)).toBe("색인 완료");
    expect(describeIngestionLogEvent(undefined, 2)).toBe("로그 3");
  });

  it("prefers stage_label and falls back to the stage key mapping", () => {
    expect(describeIngestionLogStage({ stage_label: "본문 추출" })).toBe("본문 추출");
    expect(describeIngestionLogStage({ stage: "scan" })).toBe("폴더 스캔");
    expect(describeIngestionLogStage({})).toBeNull();
  });
});

describe("작업 진행 패널 (C-08 + M-08)", () => {
  it("sorts active jobs to the top, counts over the full list, and disables cancel for cancel_requested", async () => {
    const finishedJobs = Array.from({ length: 8 }, (_, index) =>
      makeWorkJob({
        id: `job-done-${index + 1}`,
        title: `완료 작업 ${index + 1}`,
        status: index === 0 ? "failed" : "succeeded",
        error_message:
          index === 0 ? 'LLM request failed (404): {"error":{"message":"model not found"}}' : null,
      }),
    );
    const activeJobs = [
      makeWorkJob({
        id: "job-running",
        title: "진행 중 색인",
        status: "running",
        progress_percent: 40,
        completed_at: null,
      }),
      makeWorkJob({
        id: "job-cancel",
        title: "취소 요청된 작업",
        status: "cancel_requested",
        progress_percent: 60,
        cancel_requested: true,
        completed_at: null,
      }),
    ];
    // 활성 작업을 목록 끝에 두어 정렬(상단 고정)을 검증한다.
    installFetchStub({ workJobs: [...finishedJobs, ...activeJobs] });

    render(<App />);

    const jobsHeading = await screen.findByRole("heading", { name: "진행 중 2개" });
    const jobsCard = jobsHeading.closest("section");
    expect(jobsCard).not.toBeNull();

    const titles = within(jobsCard as HTMLElement)
      .getAllByRole("heading", { level: 3 })
      .map((node) => node.textContent);
    expect(titles[0]).toBe("진행 중 색인");
    expect(titles[1]).toBe("취소 요청된 작업");

    const cancelPending = within(jobsCard as HTMLElement).getByRole("button", { name: "취소 처리 중…" });
    expect(cancelPending).toBeDisabled();
    expect(cancelPending).toHaveAttribute("title", "취소 요청이 접수되어 처리 중입니다");
    expect(within(jobsCard as HTMLElement).getByRole("button", { name: "취소 요청" })).toBeEnabled();

    // raw 오류 원문 대신 한글 요약이 먼저 보이고, 원문은 접힘 영역에 남는다.
    expect(
      within(jobsCard as HTMLElement).getByText("모델 요청이 실패했습니다(404). 모델 주소나 모델 이름을 확인해 주세요."),
    ).toBeInTheDocument();
    expect(within(jobsCard as HTMLElement).getByText("오류 원문 보기")).toBeInTheDocument();
  });
});

describe("현재 컨텍스트 카드 (C-04)", () => {
  it("navigates via clickable selection rows and shows chat-relevant info", async () => {
    const user = userEvent.setup();
    installFetchStub();
    render(<App />);

    // D-06: 시작 화면이 홈이므로 업무대화 메뉴 기준 정보를 보려면 먼저 이동한다.
    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: "업무대화" }));

    const contextHeading = await screen.findByRole("heading", { name: "현재 컨텍스트" });
    const contextCard = contextHeading.closest("section") as HTMLElement;

    const sessionRow = await within(contextCard).findByTitle("업무대화 화면으로 이동");
    expect(sessionRow).toHaveTextContent("주간 보고 작업");

    // 업무대화 메뉴 기준 정보: 마지막 응답 근거 수 + 연결 파일 수
    expect(within(contextCard).getByText("마지막 응답 근거 없음")).toBeInTheDocument();
    expect(within(contextCard).getByText("연결 파일 0개")).toBeInTheDocument();

    const scheduleRow = within(contextCard).getByTitle("일정 화면으로 이동");
    expect(scheduleRow).toHaveTextContent("주간 업무 보고");
    await user.click(scheduleRow);

    expect(screen.getByTestId("shell-topbar-current")).toHaveTextContent("일정");
  });
});

describe("승인 후 다음 단계 안내 (C-05)", () => {
  it("shows the finalize follow-up hint after approving a documents.finalize ticket", async () => {
    const user = userEvent.setup();
    installFetchStub({
      approvalTickets: [
        {
          id: "ticket-1",
          action: "documents.finalize",
          status: "pending",
          target_type: "content_base",
          target_id: "cb-1",
          target_label: "주간 보고 최종본",
          requested_at: "2026-07-04T09:30:00+09:00",
          decided_at: null,
          decision_note: null,
        },
      ],
    });
    render(<App />);

    const approveButton = await screen.findByRole("button", { name: "승인" });
    await user.click(approveButton);

    const hint = await screen.findByTestId("finalize-followup-hint");
    expect(hint).toHaveTextContent("문서작성에서 [최종 저장 적용]을 누르면 완료됩니다");

    await user.click(within(hint).getByRole("button", { name: "문서작성으로 이동" }));
    expect(screen.getByTestId("shell-topbar-current")).toHaveTextContent("문서작성");
  });
});

describe("우측 패널 탭 (C-10)", () => {
  it("gives 작업 진행 its own icon, aria-pressed, and disabled reasons", async () => {
    installFetchStub();
    render(<App />);

    const jobsTab = await screen.findByLabelText("작업 진행");
    expect(jobsTab).toHaveAttribute("aria-pressed", "true");
    expect(jobsTab.querySelector("img")).toHaveAttribute("src", "/icons/action/play.svg");

    const logsTab = screen.getByLabelText("최근 실행");
    expect(logsTab.querySelector("img")).toHaveAttribute("src", "/icons/panel-logs.png");

    const upcomingTab = screen.getByLabelText("가까운 일정");
    expect(upcomingTab).toBeDisabled();
    expect(upcomingTab).toHaveAttribute("title", "일정 화면에서 사용 가능");
    expect(upcomingTab).toHaveAttribute("aria-pressed", "false");

    const dumpTab = screen.getByLabelText("색인 상세 로그");
    expect(dumpTab).toBeDisabled();
    expect(dumpTab).toHaveAttribute("title", "내 지식폴더의 설정 화면에서 사용 가능");
  });
});

describe("패널 상태 영속화 + 키보드 리사이즈 (C-14)", () => {
  it("restores stored width and adjusts it with arrow keys", async () => {
    vi.stubEnv("MODE", "development");
    window.localStorage.setItem(
      CONTEXT_PANE_STORAGE_KEY,
      JSON.stringify({ width: 400, open: true, visibility: { logs: false } }),
    );
    installFetchStub();
    render(<App />);

    await screen.findByRole("heading", { name: "현재 컨텍스트" });

    const shell = document.querySelector(".workspace-shell") as HTMLElement;
    await waitFor(() => {
      expect(shell.style.getPropertyValue("--context-pane-width")).toBe("400px");
    });
    // visibility 복원: 최근 실행 섹션은 숨김으로 시작한다.
    expect(screen.queryByRole("heading", { name: "작업 이력 요약" })).not.toBeInTheDocument();

    const resizer = screen.getByRole("separator", { name: "오른쪽 패널 크기 조절" });
    expect(resizer).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(resizer, { key: "ArrowLeft" });

    await waitFor(() => {
      expect(shell.style.getPropertyValue("--context-pane-width")).toBe("416px");
    });
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(CONTEXT_PANE_STORAGE_KEY) ?? "{}");
      expect(stored.width).toBe(416);
    });
  });

  it("keeps persistence disabled in test mode so pane state cannot leak between tests", async () => {
    installFetchStub();
    render(<App />);

    await screen.findByRole("heading", { name: "현재 컨텍스트" });
    expect(window.localStorage.getItem(CONTEXT_PANE_STORAGE_KEY)).toBeNull();
  });
});
