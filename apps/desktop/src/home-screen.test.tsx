import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApprovalTicketItem,
  ExecutionLogItem,
  ScheduleItem,
  WorkSessionItem,
} from "./api";
import type { DesktopRuntimeStatus } from "./runtime";

const runtimeStatus: DesktopRuntimeStatus = {
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
};

vi.mock("./runtime", () => ({
  // 런타임 상태를 헬스 스냅샷보다 늦게 도착시켜, 스토어가 두 번째 전체
  // 새로고침(refreshSnapshot)으로 홈 화면을 재마운트하는 레이스를 제거한다.
  loadDesktopRuntimeStatus: vi.fn(
    async () => new Promise<DesktopRuntimeStatus>((resolve) => setTimeout(() => resolve(runtimeStatus), 30)),
  ),
  startDesktopSidecar: vi.fn(async () => runtimeStatus),
  stopDesktopSidecar: vi.fn(async () => runtimeStatus),
  restartDesktopSidecar: vi.fn(async () => runtimeStatus),
  pickDirectory: vi.fn(async () => "/tmp/chosen-folder"),
  launchAnythingQuery: vi.fn(async () => undefined),
  openExternalTarget: vi.fn(async () => undefined),
  copyTextToClipboard: vi.fn(async () => undefined),
  setDesktopZoom: vi.fn(async (scale: number) => scale),
}));

import { App } from "./app";
import { upcomingSchedulesWithin24h } from "./screens/HomeScreen";
import { APP_TIPS, dailyTipIndex } from "./shared/tips";
import { MENU_ITEMS } from "./store";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

const HOUR = 60 * 60 * 1000;

function upcomingSchedule(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: "schedule-1",
    title: "주간 보고 준비",
    starts_at: new Date(Date.now() + 2 * HOUR).toISOString(),
    ends_at: new Date(Date.now() + 3 * HOUR).toISOString(),
    view: "week",
    created_at: new Date(Date.now() - 24 * HOUR).toISOString(),
    ...overrides,
  };
}

function openSession(overrides: Partial<WorkSessionItem> = {}): WorkSessionItem {
  return {
    id: "session-1",
    title: "주간 보고 작업",
    schedule_id: "schedule-1",
    status: "open",
    created_at: new Date(Date.now() - 20 * HOUR).toISOString(),
    messages: [
      {
        id: "message-1",
        session_id: "session-1",
        role: "assistant",
        text: "초안 구조부터 정리해보겠습니다.",
        message_type: "chat",
        status: "completed",
        created_at: new Date(Date.now() - 19 * HOUR).toISOString(),
      },
    ],
    ...overrides,
  };
}

type StubOptions = {
  schedules?: ScheduleItem[];
  workSessions?: WorkSessionItem[];
  approvalTickets?: ApprovalTicketItem[];
  logs?: ExecutionLogItem[];
  knowledgeSearchItems?: Array<Record<string, unknown>>;
  wikiTree?: Record<string, unknown> | null;
  dueReminders?: ScheduleItem[];
};

const searchCalls: string[] = [];

function installFetchStub(options: StubOptions = {}) {
  const schedules = options.schedules ?? [];
  const workSessions = options.workSessions ?? [];
  const approvalTickets = options.approvalTickets ?? [];
  const logs = options.logs ?? [];
  const knowledgeSearchItems = options.knowledgeSearchItems ?? [];
  const wikiTree = options.wikiTree ?? null;
  const dueReminders = options.dueReminders ?? [];

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

      if (url.endsWith("/ready")) {
        return jsonResponse({
          status: "ready",
          checks: {
            workspace: { ok: true, path: "/tmp/gongmu-workspace" },
            database: { ok: true, path: "/tmp/gongmu-workspace/db/gongmu.db" },
            jobs: { ok: true, active_count: 0, runner_active_count: 0 },
          },
          recovered: { work_jobs: 0, knowledge_ingestion_jobs: 0 },
        });
      }

      if (url.endsWith("/api/settings")) {
        return jsonResponse({
          defaults: {
            llm_mode: "internal_server",
            llm_provider: "openai_compatible",
            llm_model: "gpt-4.1-mini",
            anything_launch_mode: "external_app_preferred",
            default_template_key: "report",
            internal_api_base_url: "http://127.0.0.1:9000",
          },
          paths: {
            workspace_root: "/tmp/gongmu-workspace",
            database: "/tmp/gongmu-workspace/db/gongmu.db",
            knowledge_root: "/tmp/gongmu-workspace/knowledge",
            documents_root: "/tmp/gongmu-workspace/documents",
          },
        });
      }

      if (url.endsWith("/api/schedules/reminders/due")) {
        return jsonResponse({ items: dueReminders, now: new Date().toISOString() });
      }

      if (url.endsWith("/api/schedules")) {
        return jsonResponse({ items: schedules });
      }

      if (url.endsWith("/api/work-sessions")) {
        return jsonResponse({ items: workSessions });
      }

      if (url.endsWith("/api/templates")) {
        return jsonResponse({
          items: [
            { key: "report", label: "보고서형" },
            { key: "meeting", label: "회의자료형" },
            { key: "review", label: "검토메모형" },
          ],
        });
      }

      if (url.includes("/api/knowledge/search?query=")) {
        const query = decodeURIComponent(url.split("query=")[1] ?? "");
        searchCalls.push(query);
        return jsonResponse({ query, mode: "fts5", items: knowledgeSearchItems });
      }

      if (url.endsWith("/api/knowledge/wiki/tree")) {
        if (!wikiTree) {
          return jsonResponse({ detail: "not found" }, 404);
        }
        return jsonResponse(wikiTree);
      }

      const emptyCollections = [
        "/api/approval-tickets",
        "/api/knowledge/candidates",
        "/api/knowledge/pages",
        "/api/knowledge/sources",
        "/api/knowledge/source-files",
        "/api/knowledge/ingestion-jobs",
        "/api/knowledge/documents",
        "/api/personalization/candidates",
        "/api/execution-logs",
      ];

      if (url.endsWith("/api/approval-tickets")) {
        return jsonResponse({ items: approvalTickets });
      }
      if (url.endsWith("/api/execution-logs")) {
        return jsonResponse({ items: logs });
      }
      if (emptyCollections.some((path) => url.endsWith(path))) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/jobs")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/api/runtime/metrics")) {
        return jsonResponse({
          jobs: {
            active_count: 0,
            terminal_count: 0,
            queued: 0,
            blocked: 0,
            running: 0,
            waiting_approval: 0,
            cancel_requested: 0,
            failed: 0,
            succeeded: 0,
            partial: 0,
            canceled: 0,
          },
          runner: { active_count: 0, active_job_ids: [], queue_depth: 0, submitted_count: 0 },
          knowledge: { active_ingestion_job_id: null, active_ingestion_status: null },
          recovered: { work_jobs: 0, knowledge_ingestion_jobs: 0 },
        });
      }

      return jsonResponse({ detail: `Unhandled request: ${url}` }, 404);
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  searchCalls.length = 0;
  window.localStorage.clear();
});

describe("HomeScreen briefing cards (D-06)", () => {
  it("renders the briefing cards with schedule, continue, and knowledge summaries", async () => {
    installFetchStub({
      schedules: [upcomingSchedule()],
      workSessions: [openSession()],
      approvalTickets: [
        {
          id: "ticket-1",
          action: "document.finalize",
          status: "pending",
          target_type: "document",
          target_label: "주간 보고",
          requested_at: new Date().toISOString(),
        },
      ],
      wikiTree: {
        topics: [],
        works: [],
        sources: [],
        counts: { docs: 12, topics: 4, works: 3 },
      },
    });
    render(<App />);

    const scheduleCard = await screen.findByTestId("home-card-schedule");
    expect(scheduleCard).toHaveTextContent("주간 보고 준비");
    expect(within(scheduleCard).getByRole("button", { name: "세션 열기" })).toBeInTheDocument();

    const continueCard = screen.getByTestId("home-card-continue");
    expect(continueCard).toHaveTextContent("주간 보고 작업");
    expect(continueCard).toHaveTextContent("초안 구조부터 정리해보겠습니다.");
    expect(within(continueCard).getByRole("button", { name: "이어서 대화" })).toBeInTheDocument();
    expect(screen.getByTestId("home-approvals-notice")).toHaveTextContent("승인 대기 1건");

    const knowledgeCard = screen.getByTestId("home-card-knowledge");
    await waitFor(() => {
      expect(knowledgeCard).toHaveTextContent("12");
    });
    expect(knowledgeCard).toHaveTextContent("문서");
    expect(knowledgeCard).toHaveTextContent("주제");
    expect(knowledgeCard).toHaveTextContent("업무 기록");
  });

  it("switches to the onboarding guide when there is no schedule or session data (J-06)", async () => {
    installFetchStub({ schedules: [], workSessions: [] });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByTestId("home-onboarding")).toBeInTheDocument();
    expect(screen.queryByTestId("home-card-schedule")).not.toBeInTheDocument();

    // internal_server 프로필이 설정돼 있으므로 LLM 단계는 완료+비활성.
    // (스냅샷은 startTransition으로 늦게 커밋되므로 완료 상태를 기다린다.)
    await waitFor(() => {
      expect(screen.getByTestId("home-onboarding-step-llm")).toHaveTextContent("완료");
    });
    const llmStep = screen.getByTestId("home-onboarding-step-llm");
    expect(within(llmStep).getByRole("button", { name: "환경설정 열기" })).toBeDisabled();

    // 지식폴더·세션 단계는 미완료라 진입 버튼이 활성화된다.
    const knowledgeStep = screen.getByTestId("home-onboarding-step-knowledge");
    expect(within(knowledgeStep).getByRole("button", { name: "내 지식폴더 열기" })).not.toBeDisabled();

    const sessionStep = screen.getByTestId("home-onboarding-step-session");
    await user.click(within(sessionStep).getByRole("button", { name: "업무대화 시작" }));
    expect(screen.getByTestId("shell-topbar-current")).toHaveTextContent("업무대화");
  });

  it("suggests a document draft from deterministic schedule-knowledge matching", async () => {
    installFetchStub({
      schedules: [upcomingSchedule({ title: "AI 혁신 계획 점검" })],
      workSessions: [openSession()],
      knowledgeSearchItems: [
        { doc_id: "doc-1", title: "AI 혁신 계획", source_path: "/k/a.md", snippet: "..." },
        { doc_id: "doc-2", title: "혁신 점검 회의", source_path: "/k/b.md", snippet: "..." },
      ],
    });
    const user = userEvent.setup();
    render(<App />);

    const suggestionCard = await screen.findByTestId("home-card-suggestion");
    expect(suggestionCard).toHaveTextContent("‘AI 혁신 계획 점검’ 관련 문서 2건");
    expect(searchCalls).toContain("AI 혁신 계획 점검");

    await user.click(within(suggestionCard).getByRole("button", { name: "문서작성 시작" }));
    expect(screen.getByTestId("shell-topbar-current")).toHaveTextContent("문서작성");
  });

  it("hides the suggestion card when the knowledge search has no hits", async () => {
    installFetchStub({
      schedules: [upcomingSchedule()],
      workSessions: [openSession()],
      knowledgeSearchItems: [],
    });
    render(<App />);

    await screen.findByTestId("home-card-schedule");
    await waitFor(() => {
      expect(searchCalls.length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("home-card-suggestion")).not.toBeInTheDocument();
  });

  it("snoozes the feature hook card for the rest of the day", async () => {
    installFetchStub({
      schedules: [upcomingSchedule()],
      workSessions: [openSession()],
      logs: [
        {
          id: "log-1",
          feature: "schedule",
          action: "schedule.created",
          status: "success",
          created_at: new Date().toISOString(),
          inputs: {},
          outputs: {},
          approval_ticket_id: null,
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);

    // schedule 기능만 사용 이력이 있으므로 첫 후보(knowledge) 후크가 노출된다.
    const hookCard = await screen.findByTestId("home-card-hook");
    expect(hookCard).toHaveTextContent("대화를 지식으로 축적해 보세요");

    await user.click(within(hookCard).getByRole("button", { name: "오늘 하루 숨기기" }));

    expect(screen.queryByTestId("home-card-hook")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("gongmu.home.feature-hook.snoozed-on")).toBeTruthy();
  });

  it("rotates the app tips card deterministically and navigates to the tip's menu (W6)", async () => {
    installFetchStub({
      schedules: [upcomingSchedule()],
      workSessions: [openSession()],
    });
    const user = userEvent.setup();
    render(<App />);

    // 오늘의 팁은 날짜 기반 결정적 인덱스 — 컴포넌트와 같은 함수로 기대값을 계산한다.
    const baseIndex = dailyTipIndex(APP_TIPS.length);
    const todayTip = APP_TIPS[baseIndex];
    const tipsCard = await screen.findByTestId("home-card-tips");
    expect(within(tipsCard).getByTestId("home-tip-text")).toHaveTextContent(todayTip.text);

    // [다음 팁] → 다음 인덱스의 팁으로 넘어간다 (Math.random 없이 결정적).
    await user.click(within(tipsCard).getByTestId("home-tip-next"));
    const nextTip = APP_TIPS[(baseIndex + 1) % APP_TIPS.length];
    expect(within(tipsCard).getByTestId("home-tip-text")).toHaveTextContent(nextTip.text);

    // 이동 버튼은 팁이 가리키는 메뉴 화면으로 간다.
    const nextMenuLabel = MENU_ITEMS.find((item) => item.key === nextTip.menu)!.label;
    const openButton = within(tipsCard).getByTestId("home-tip-open-menu");
    expect(openButton).toHaveTextContent(`${nextMenuLabel} 열기`);
    await user.click(openButton);
    expect(screen.getByTestId("shell-topbar-current")).toHaveTextContent(nextMenuLabel);
  });

  it("shows a one-time toast and upcoming badge for due schedule reminders (F-20)", async () => {
    installFetchStub({
      schedules: [upcomingSchedule()],
      workSessions: [openSession()],
      dueReminders: [upcomingSchedule({ id: "schedule-due", title: "부서 회의" })],
    });
    render(<App />);

    expect(await screen.findByText("곧 시작: 부서 회의")).toBeInTheDocument();
    expect(screen.getAllByText("곧 시작: 부서 회의")).toHaveLength(1);
  });
});

describe("upcomingSchedulesWithin24h", () => {
  const base = Date.parse("2026-07-04T09:00:00+09:00");

  function schedule(id: string, startOffsetHours: number, endOffsetHours: number): ScheduleItem {
    return {
      id,
      title: id,
      starts_at: new Date(base + startOffsetHours * HOUR).toISOString(),
      ends_at: new Date(base + endOffsetHours * HOUR).toISOString(),
      view: "week",
      created_at: new Date(base - 48 * HOUR).toISOString(),
    };
  }

  it("keeps only schedules that are not over yet and start within 24 hours, sorted by start", () => {
    const result = upcomingSchedulesWithin24h(
      [
        schedule("past", -30, -29),
        schedule("later-first", 8, 9),
        schedule("soon", 1, 2),
        schedule("ongoing", -1, 1),
        schedule("beyond-24h", 30, 31),
      ],
      base,
    );

    expect(result.map((item) => item.id)).toEqual(["ongoing", "soon", "later-first"]);
  });
});
