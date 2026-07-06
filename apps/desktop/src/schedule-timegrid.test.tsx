import { render, screen, waitFor, within } from "@testing-library/react";
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
  launchAnythingQuery: vi.fn(),
  openExternalTarget: vi.fn(),
  copyTextToClipboard: vi.fn(async () => undefined),
}));

import { App } from "./app";

// 고정 기준: 2026-07-08(수) 10:30 로컬 시각
const FIXED_NOW = new Date(2026, 6, 8, 10, 30, 0, 0);
const localIso = (day: number, hour: number, minute = 0) =>
  new Date(2026, 6, day, hour, minute, 0, 0).toISOString();
const pad = (value: number) => String(value).padStart(2, "0");

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

function installFetchStub(options: { dueReminders?: Array<Record<string, unknown>> } = {}) {
  const schedules: Array<Record<string, unknown>> = [
    {
      id: "sched-main",
      title: "AI혁신 주간보고 준비",
      starts_at: localIso(8, 10, 0),
      ends_at: localIso(8, 11, 30),
      view: "week",
      remind_before_minutes: 10,
      created_at: localIso(1, 0, 0),
    },
    {
      id: "sched-second",
      title: "감사 대응",
      starts_at: localIso(8, 10, 15),
      ends_at: localIso(8, 10, 45),
      view: "week",
      created_at: localIso(1, 0, 0),
    },
    {
      id: "sched-third",
      title: "예산 협의",
      starts_at: localIso(8, 10, 30),
      ends_at: localIso(8, 11, 0),
      view: "week",
      created_at: localIso(1, 0, 0),
    },
    {
      id: "sched-dawn",
      title: "새벽 점검",
      starts_at: localIso(8, 5, 0),
      ends_at: localIso(8, 6, 0),
      view: "week",
      created_at: localIso(1, 0, 0),
    },
  ];

  const dueReminders = options.dueReminders ?? [];

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

      if (url.endsWith("/api/schedules/reminders/due")) {
        return jsonResponse({ items: dueReminders, now: new Date().toISOString() });
      }

      const ackMatch = url.match(/\/api\/schedules\/([^/]+)\/reminders\/ack$/);
      if (ackMatch && method === "POST") {
        const scheduleId = ackMatch[1];
        const index = dueReminders.findIndex((schedule) => schedule.id === scheduleId);
        const acknowledged = {
          ...(index !== -1 ? dueReminders[index] : { id: scheduleId }),
          reminder_acknowledged_at: new Date().toISOString(),
        };
        if (index !== -1) {
          dueReminders.splice(index, 1);
        }
        return jsonResponse(acknowledged);
      }

      const patchMatch = url.match(/\/api\/schedules\/([^/]+)$/);
      if (patchMatch && method === "PATCH") {
        const scheduleId = patchMatch[1];
        const index = schedules.findIndex((schedule) => schedule.id === scheduleId);
        if (index !== -1) {
          schedules[index] = { ...schedules[index], ...body };
          return jsonResponse(schedules[index]);
        }
      }

      if (url.endsWith("/api/schedules") && method === "POST") {
        const created = {
          id: "sched-created",
          title: body?.title ?? "",
          starts_at: body?.starts_at ?? "",
          ends_at: body?.ends_at ?? "",
          view: body?.view ?? "week",
          remind_before_minutes: body?.remind_before_minutes ?? null,
          created_at: new Date().toISOString(),
        };
        schedules.push(created);
        return jsonResponse(created, 201);
      }

      if (url.endsWith("/api/schedules")) {
        return jsonResponse({ items: schedules });
      }

      return jsonResponse({ items: [] });
    }),
  );
}

async function openScheduleScreen(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
  await user.click(within(navigation).getByRole("button", { name: /^일정/ }));
  await screen.findByTestId("schedule-timegrid");
}

describe("Schedule week timegrid (F-19)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FIXED_NOW);
    vi.unstubAllGlobals();
    installFetchStub();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("positions event blocks by start time and duration with time-only labels", async () => {
    const user = userEvent.setup();
    await openScheduleScreen(user);

    // 시간축 라벨 07~19시
    expect(screen.getByText("07:00")).toBeInTheDocument();
    expect(screen.getByText("19:00")).toBeInTheDocument();

    // 10:00~11:30 이벤트 = top (10-7)*48 = 144px, height 1.5h*48 = 72px
    const mainBlock = await screen.findByTestId("timegrid-event-sched-main");
    expect(mainBlock).toHaveStyle({ top: "144px", height: "72px" });
    expect(mainBlock).toHaveAttribute("aria-label", "10:00 AI혁신 주간보고 준비");
    expect(mainBlock).toHaveTextContent("10:00 AI혁신 주간보고 준비");

    // "1" 배지·제목 반복·클릭 안내문 없음 — 그리드 안에서 제목은 정확히 1회
    expect(screen.queryByText("클릭해 일정 편집")).not.toBeInTheDocument();
    const timegrid = screen.getByTestId("schedule-timegrid");
    expect(within(timegrid).getAllByText(/AI혁신 주간보고 준비/)).toHaveLength(1);
  });

  it("renders the red now-line in today's column at the current time", async () => {
    const user = userEvent.setup();
    await openScheduleScreen(user);

    // 10:30 = (10.5 - 7) * 48 = 168px
    const nowLine = screen.getByTestId("schedule-now-line");
    expect(nowLine).toHaveStyle({ top: "168px" });

    // 오늘(수요일) 컬럼 헤더 강조
    const wednesdayIndex = FIXED_NOW.getDay();
    const todayHeader = screen.getByTestId(`timegrid-day-header-${wednesdayIndex}`);
    expect(todayHeader.className).toContain("schedule-timegrid__day-header--today");
    expect(todayHeader).toHaveTextContent(`수 7/8`);
  });

  it("splits overlapping events into two columns and collapses the rest into +N", async () => {
    const user = userEvent.setup();
    await openScheduleScreen(user);

    const mainBlock = await screen.findByTestId("timegrid-event-sched-main");
    const secondBlock = screen.getByTestId("timegrid-event-sched-second");
    expect(mainBlock.className).toContain("schedule-timegrid__event--split");
    expect(secondBlock.className).toContain("schedule-timegrid__event--split");

    // 세 번째 겹침 일정은 +1 칩으로 축약
    const dayIndex = FIXED_NOW.getDay();
    const moreChip = screen.getByTestId(`timegrid-more-${dayIndex}-0`);
    expect(moreChip).toHaveTextContent("+1");
    expect(moreChip).toHaveAttribute("title", expect.stringContaining("예산 협의"));
    expect(screen.queryByTestId("timegrid-event-sched-third")).not.toBeInTheDocument();
  });

  it("shows out-of-range schedules in the all-day band", async () => {
    const user = userEvent.setup();
    await openScheduleScreen(user);

    const dawnChip = await screen.findByTestId("timegrid-event-sched-dawn");
    expect(dawnChip).toHaveAttribute("aria-label", "05:00 새벽 점검");
    const dayIndex = FIXED_NOW.getDay();
    expect(screen.getByTestId(`timegrid-allday-${dayIndex}`)).toContainElement(dawnChip);
  });

  it("prefills start and end times when an empty slot is clicked", async () => {
    const user = userEvent.setup();
    await openScheduleScreen(user);

    // 목요일(내일) 14시 빈 칸 클릭
    const dayIndex = FIXED_NOW.getDay() + 1;
    await user.click(screen.getByTestId(`timegrid-cell-${dayIndex}-14`));

    const day = new Date(2026, 6, 9);
    const expectedStart = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T14:00`;
    const expectedEnd = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T15:00`;

    await waitFor(() => {
      expect(screen.getByLabelText("시작")).toHaveValue(expectedStart);
      expect(screen.getByLabelText("종료")).toHaveValue(expectedEnd);
      expect(screen.getByRole("button", { name: "일정 등록" })).toBeInTheDocument();
    });
  });

  it("prefills the edit form when an event block is clicked", async () => {
    const user = userEvent.setup();
    await openScheduleScreen(user);

    await user.click(await screen.findByTestId("timegrid-event-sched-main"));

    await waitFor(() => {
      expect(screen.getByLabelText("일정 제목")).toHaveValue("AI혁신 주간보고 준비");
      expect(screen.getByLabelText("시작")).toHaveValue("2026-07-08T10:00");
      expect(screen.getByRole("button", { name: "일정 수정 저장" })).toBeInTheDocument();
    });
  });

  it("shows a bell indicator with a reminder tooltip on schedules with a reminder set", async () => {
    const user = userEvent.setup();
    await openScheduleScreen(user);

    // sched-main = remind_before_minutes: 10 → 벨 표시 + "10분 전 알림" 툴팁
    const mainBlock = await screen.findByTestId("timegrid-event-sched-main");
    expect(mainBlock).toHaveAttribute("title", expect.stringContaining("10분 전 알림"));
    expect(mainBlock.textContent).toContain("🔔");

    // sched-second = 알림 없음 → 벨 미표시
    const secondBlock = screen.getByTestId("timegrid-event-sched-second");
    expect(secondBlock.textContent).not.toContain("🔔");
  });

  it("prefills the reminder select when editing a schedule that has a reminder set", async () => {
    const user = userEvent.setup();
    await openScheduleScreen(user);

    await user.click(await screen.findByTestId("timegrid-event-sched-main"));

    await waitFor(() => {
      expect(screen.getByLabelText("사전 알림")).toHaveValue("10");
    });
  });

  it("includes the selected reminder minutes in the create-schedule payload", async () => {
    const user = userEvent.setup();
    await openScheduleScreen(user);

    const dayIndex = FIXED_NOW.getDay() + 1;
    await user.click(screen.getByTestId(`timegrid-cell-${dayIndex}-14`));
    await user.type(screen.getByLabelText("일정 제목"), "새 일정 테스트");
    await user.selectOptions(screen.getByLabelText("사전 알림"), "30");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    await user.click(screen.getByRole("button", { name: "일정 등록" }));

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(([input, init]) => {
        return String(input).endsWith("/api/schedules") && (init?.method ?? "GET").toUpperCase() === "POST";
      });
      expect(createCall).toBeTruthy();
      const body = JSON.parse(String(createCall?.[1]?.body));
      expect(body.remind_before_minutes).toBe(30);
    });
  });
});

describe("Schedule due reminder banner (F-20)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FIXED_NOW);
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a due-reminder banner card and removes it after acknowledging", async () => {
    const dueSchedule = {
      id: "sched-main",
      title: "AI혁신 주간보고 준비",
      starts_at: localIso(8, 10, 0),
      ends_at: localIso(8, 11, 30),
      view: "week",
      remind_before_minutes: 10,
      created_at: localIso(1, 0, 0),
    };
    installFetchStub({ dueReminders: [dueSchedule] });

    const user = userEvent.setup();
    await openScheduleScreen(user);

    const banner = await screen.findByTestId(`schedule-reminder-card-${dueSchedule.id}`);
    expect(banner).toHaveTextContent(/곧 시작: AI혁신 주간보고 준비/);

    await user.click(within(banner).getByRole("button", { name: "확인" }));

    await waitFor(() => {
      expect(screen.queryByTestId(`schedule-reminder-card-${dueSchedule.id}`)).not.toBeInTheDocument();
    });
  });
});
