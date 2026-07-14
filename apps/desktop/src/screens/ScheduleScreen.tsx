import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  ackScheduleReminder,
  createSchedule,
  createWorkSession,
  deleteSchedule,
  fetchDueScheduleReminders,
  updateSchedule,
  type ScheduleItem,
} from "../api";
import {
  addDays,
  formatDateInputValue,
  startOfDay,
  toIso,
  WEEKDAY_LABELS,
} from "../shared/format";
import { AssetIcon, SectionCard } from "../shared/primitives";
import { useAppStore } from "../store";
import "../styles/schedule-screen.css";

const GRID_START_HOUR = 7;
const GRID_END_HOUR = 20;
const HOUR_HEIGHT = 48;
const MIN_BLOCK_HEIGHT = 28;
const GRID_HOURS = Array.from(
  { length: GRID_END_HOUR - GRID_START_HOUR },
  (_, index) => GRID_START_HOUR + index,
);
const GRID_TOTAL_HEIGHT = GRID_HOURS.length * HOUR_HEIGHT;

function padTwo(value: number) {
  return String(value).padStart(2, "0");
}

function formatClock(date: Date) {
  return `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

// F-20: 사전 알림 select 옵션 — 없음/10분 전/30분 전/1시간 전/하루 전
const REMINDER_OPTIONS: Array<{ value: string; minutes: number | null; label: string }> = [
  { value: "none", minutes: null, label: "없음" },
  { value: "10", minutes: 10, label: "10분 전" },
  { value: "30", minutes: 30, label: "30분 전" },
  { value: "60", minutes: 60, label: "1시간 전" },
  { value: "1440", minutes: 1440, label: "하루 전" },
];

function reminderMinutesToSelectValue(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) {
    return "none";
  }
  const match = REMINDER_OPTIONS.find((option) => option.minutes === minutes);
  return match ? match.value : "none";
}

function reminderSelectValueToMinutes(value: string): number | null {
  const match = REMINDER_OPTIONS.find((option) => option.value === value);
  return match ? match.minutes : null;
}

function reminderMinutesLabel(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) {
    return null;
  }
  const match = REMINDER_OPTIONS.find((option) => option.minutes === minutes);
  return match ? match.label : null;
}

function scheduleHasReminder(schedule: ScheduleItem) {
  return typeof schedule.remind_before_minutes === "number" && schedule.remind_before_minutes >= 0;
}

function scheduleReminderTitle(schedule: ScheduleItem) {
  const label = reminderMinutesLabel(schedule.remind_before_minutes);
  return label ? `${label} 알림` : null;
}

function minutesUntil(iso: string, now: Date) {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) {
    return null;
  }
  return Math.max(0, Math.round((target - now.getTime()) / 60_000));
}

function toLocalInputValue(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso.slice(0, 16);
  }
  return formatDateInputValue(date, date.getHours(), date.getMinutes());
}

type TimegridBlock = {
  schedule: ScheduleItem;
  top: number;
  height: number;
  col: 0 | 1;
  cols: 1 | 2;
  startLabel: string;
  endLabel: string;
};

type TimegridMoreCluster = {
  top: number;
  items: Array<{ schedule: ScheduleItem; startLabel: string }>;
};

type TimegridBandItem = {
  schedule: ScheduleItem;
  label: string;
};

export function buildTimegridDay(day: Date, schedules: ScheduleItem[]) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const windowStart = new Date(dayStart);
  windowStart.setHours(GRID_START_HOUR, 0, 0, 0);
  const windowEnd = new Date(dayStart);
  windowEnd.setHours(GRID_END_HOUR, 0, 0, 0);

  const band: TimegridBandItem[] = [];
  const timed: Array<{
    schedule: ScheduleItem;
    startMs: number;
    endMs: number;
    startLabel: string;
    endLabel: string;
  }> = [];

  for (const schedule of schedules) {
    const start = new Date(schedule.starts_at);
    const end = new Date(schedule.ends_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      continue;
    }
    if (end.getTime() <= dayStart.getTime() || start.getTime() >= dayEnd.getTime()) {
      continue;
    }
    const coversWholeDay = start.getTime() <= dayStart.getTime() && end.getTime() >= dayEnd.getTime();
    if (coversWholeDay) {
      band.push({ schedule, label: `종일 ${schedule.title}` });
      continue;
    }
    const visibleStart = Math.max(start.getTime(), windowStart.getTime());
    const visibleEnd = Math.min(end.getTime(), windowEnd.getTime());
    if (visibleEnd <= visibleStart) {
      // 표시창 밖 일정은 '시작 시각이 속한 날'의 band에만 1회 표시.
      // 자정 이후 꼬리만 걸친 날(전일 시작)은 표시하지 않는다.
      if (start.getTime() >= dayStart.getTime()) {
        band.push({ schedule, label: `${formatClock(start)} ${schedule.title}` });
      }
      continue;
    }
    timed.push({
      schedule,
      startMs: visibleStart,
      endMs: visibleEnd,
      startLabel: formatClock(start),
      endLabel: formatClock(end),
    });
  }

  timed.sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);

  const msToOffset = (ms: number) => ((ms - windowStart.getTime()) / 3_600_000) * HOUR_HEIGHT;

  const blocks: TimegridBlock[] = [];
  const moreClusters: TimegridMoreCluster[] = [];

  let cluster: typeof timed = [];
  let clusterEndMs = Number.NEGATIVE_INFINITY;
  const flushCluster = () => {
    if (!cluster.length) {
      return;
    }
    const columnEnds = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const visible: Array<{ item: (typeof timed)[number]; col: 0 | 1 }> = [];
    const hidden: typeof timed = [];
    for (const item of cluster) {
      const colIndex = columnEnds.findIndex((endMs) => endMs <= item.startMs);
      if (colIndex === -1) {
        hidden.push(item);
        continue;
      }
      columnEnds[colIndex] = item.endMs;
      visible.push({ item, col: colIndex as 0 | 1 });
    }
    const cols: 1 | 2 = visible.some((entry) => entry.col === 1) ? 2 : 1;
    for (const entry of visible) {
      const top = msToOffset(entry.item.startMs);
      const height = Math.max(msToOffset(entry.item.endMs) - top, MIN_BLOCK_HEIGHT);
      blocks.push({
        schedule: entry.item.schedule,
        top: Math.max(Math.min(top, GRID_TOTAL_HEIGHT - height), 0),
        height,
        col: entry.col,
        cols,
        startLabel: entry.item.startLabel,
        endLabel: entry.item.endLabel,
      });
    }
    if (hidden.length) {
      moreClusters.push({
        top: Math.max(Math.min(...hidden.map((item) => msToOffset(item.startMs))), 0),
        items: hidden.map((item) => ({ schedule: item.schedule, startLabel: item.startLabel })),
      });
    }
    cluster = [];
    clusterEndMs = Number.NEGATIVE_INFINITY;
  };

  for (const item of timed) {
    if (item.startMs >= clusterEndMs) {
      flushCluster();
      cluster = [item];
      clusterEndMs = item.endMs;
    } else {
      cluster.push(item);
      clusterEndMs = Math.max(clusterEndMs, item.endMs);
    }
  }
  flushCluster();

  return { band, blocks, moreClusters };
}

export function ScheduleScreen() {
  const {
    chatReturnContext,
    handleAction,
    plannerAnchorAt,
    revealContextSection,
    scheduleForm,
    selectedPlannerSlotId,
    selectedSchedule,
    selectedScheduleId,
    setActiveMenu,
    setChatReturnContext,
    setError,
    setNotice,
    setPlannerAnchorAt,
    setScheduleForm,
    setSelectedPlannerSlotId,
    setSelectedScheduleId,
    setSelectedSessionId,
    setSnapshot,
    setSubmitting,
    snapshot,
    submitting,
  } = useAppStore();

  // F-20: scheduleForm은 동결(store.tsx) 대상이라 사전 알림 선택값은 화면 로컬 상태로 관리한다.
  const [reminderSelectValue, setReminderSelectValue] = useState("none");
  const [dueReminders, setDueReminders] = useState<ScheduleItem[]>([]);
  const [reminderAckPendingId, setReminderAckPendingId] = useState<string | null>(null);
  const dueReminderPollRef = useRef<number | null>(null);

  async function pollDueScheduleReminders() {
    try {
      const response = await fetchDueScheduleReminders();
      setDueReminders(response.items);
    } catch {
      // D-03: 조용한 폴링 실패 — 토스트 없이 다음 주기에 재시도
    }
  }

  useEffect(() => {
    void pollDueScheduleReminders();
    dueReminderPollRef.current = window.setInterval(() => {
      void pollDueScheduleReminders();
    }, 30_000);
    return () => {
      if (dueReminderPollRef.current !== null) {
        window.clearInterval(dueReminderPollRef.current);
        dueReminderPollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function acknowledgeDueReminder(schedule: ScheduleItem) {
    setReminderAckPendingId(schedule.id);
    try {
      await ackScheduleReminder(schedule.id);
      setDueReminders((current) => current.filter((item) => item.id !== schedule.id));
      setSnapshot((current) => ({
        ...current,
        schedules: current.schedules.map((item) =>
          item.id === schedule.id ? { ...item, reminder_acknowledged_at: new Date().toISOString() } : item,
        ),
      }));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "알림을 확인 처리하지 못했습니다.");
    } finally {
      setReminderAckPendingId(null);
    }
  }

  // 배너 [세션 열기]는 연결 세션이 있을 때만 활성화되므로 새 세션 생성 없이 이동만 한다.
  function openSessionForDueReminder(schedule: ScheduleItem) {
    const linkedSession = snapshot.workSessions.find((session) => session.schedule_id === schedule.id);
    if (!linkedSession) {
      return;
    }
    setSelectedScheduleId(schedule.id);
    setSelectedSessionId(linkedSession.id);
    setActiveMenu("chat");
    revealContextSection("context");
    setNotice("선택 일정에 연결된 업무대화 세션을 열었습니다.");
    setError(null);
  }

  async function submitSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const editingExistingSchedule =
      selectedPlannerSlotId.startsWith("existing-") &&
      Boolean(selectedScheduleId) &&
      snapshot.schedules.some((schedule) => schedule.id === selectedScheduleId);
    const remindBeforeMinutes = reminderSelectValueToMinutes(reminderSelectValue);
    const savedSchedule = await handleAction(
      () => {
        const payload = {
          title: scheduleForm.title,
          starts_at: toIso(scheduleForm.starts_at),
          ends_at: toIso(scheduleForm.ends_at),
          view: scheduleForm.view,
          remind_before_minutes: remindBeforeMinutes,
        };

        return editingExistingSchedule && selectedScheduleId
          ? updateSchedule(selectedScheduleId, payload)
          : createSchedule(payload);
      },
      editingExistingSchedule ? "일정을 수정했습니다." : "일정을 등록했습니다.",
      { refresh: "none" },
    );
    if (savedSchedule) {
      setSnapshot((current) => ({
        ...current,
        schedules: current.schedules.some((schedule) => schedule.id === savedSchedule.id)
          ? current.schedules.map((schedule) => (schedule.id === savedSchedule.id ? savedSchedule : schedule))
          : [...current.schedules, savedSchedule],
      }));
      revealContextSection("context");
      setSelectedScheduleId(savedSchedule.id);
      setSelectedPlannerSlotId(`existing-${savedSchedule.id}`);
      setScheduleForm({
        title: savedSchedule.title,
        starts_at: toLocalInputValue(savedSchedule.starts_at),
        ends_at: toLocalInputValue(savedSchedule.ends_at),
        view: scheduleForm.view,
      });
      setReminderSelectValue(reminderMinutesToSelectValue(savedSchedule.remind_before_minutes));
    }
  }

  async function deleteSelectedSchedule() {
    if (!selectedScheduleId) {
      return;
    }
    const deleted = await handleAction(
      () => deleteSchedule(selectedScheduleId),
      "일정을 삭제했습니다.",
      { revealSection: "context", refresh: "none" },
    );
    if (deleted) {
      setSnapshot((current) => ({
        ...current,
        schedules: current.schedules.filter((schedule) => schedule.id !== deleted.id),
        workSessions: current.workSessions.map((session) =>
          session.schedule_id === deleted.id ? { ...session, schedule_id: null } : session,
        ),
      }));
      setSelectedScheduleId("");
      setSelectedPlannerSlotId("");
      setScheduleForm((current) => ({
        title: "",
        starts_at: "",
        ends_at: "",
        view: current.view,
      }));
      setReminderSelectValue("none");
    }
  }

  async function openChatForSchedule(schedule: ScheduleItem) {
    setSelectedScheduleId(schedule.id);
    const linkedSession = snapshot.workSessions.find((session) => session.schedule_id === schedule.id);
    if (linkedSession) {
      setSelectedSessionId(linkedSession.id);
      setActiveMenu("chat");
      revealContextSection("context");
      setNotice("선택 일정에 연결된 업무대화 세션을 열었습니다.");
      setError(null);
      return;
    }

    setSubmitting(true);
    setNotice(null);
    setError(null);
    try {
      const created = await createWorkSession({
        title: `${schedule.title} 작업`,
        schedule_id: schedule.id,
      });
      setSnapshot((current) => ({
        ...current,
        workSessions: [created, ...current.workSessions.filter((session) => session.id !== created.id)],
      }));
      setSelectedScheduleId(schedule.id);
      setSelectedSessionId(created.id);
      setActiveMenu("chat");
      revealContextSection("context");
      setNotice("일정에서 새 업무대화 세션을 열었습니다.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "일정과 연결된 업무대화 세션을 열지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  function scheduleViewLabel(view: "month" | "week" | "day") {
    switch (view) {
      case "month":
        return "월";
      case "day":
        return "일";
      case "week":
      default:
        return "주";
    }
  }

  function scheduleHasLinkedSession(scheduleId: string) {
    return snapshot.workSessions.some((session) => session.schedule_id === scheduleId);
  }

  function linkedSessionTitlesFor(scheduleId: string) {
    return snapshot.workSessions
      .filter((session) => session.schedule_id === scheduleId)
      .map((session) => session.title);
  }

  function buildSchedulePlannerSlots() {
    const anchor =
      plannerAnchorAt ||
      selectedSchedule?.starts_at ||
      scheduleForm.starts_at ||
      snapshot.schedules[0]?.starts_at ||
      new Date().toISOString();
    const anchorDate = new Date(anchor);
    const safeAnchorDate = Number.isNaN(anchorDate.getTime()) ? new Date() : anchorDate;

    const overlappingSchedules = (rangeStart: Date, rangeEnd: Date) =>
      snapshot.schedules.filter((schedule) => {
        const scheduleStart = new Date(schedule.starts_at).getTime();
        const scheduleEnd = new Date(schedule.ends_at).getTime();
        return scheduleStart < rangeEnd.getTime() && scheduleEnd > rangeStart.getTime();
      });
    const linkedSessionTitlesForSchedules = (schedules: ScheduleItem[]) =>
      Array.from(new Set(schedules.flatMap((schedule) => linkedSessionTitlesFor(schedule.id))));

    if (scheduleForm.view === "day") {
      return Array.from({ length: 10 }, (_, index) => {
        const startHour = 9 + index;
        const endHour = startHour + 1;
        const rangeStart = startOfDay(safeAnchorDate);
        rangeStart.setHours(startHour, 0, 0, 0);
        const rangeEnd = new Date(rangeStart);
        rangeEnd.setHours(endHour, 0, 0, 0);
        const schedules = overlappingSchedules(rangeStart, rangeEnd);
        const linkedSessionTitles = linkedSessionTitlesForSchedules(schedules);
        return {
          id: `day-${formatDateInputValue(rangeStart, startHour)}-${index}`,
          startValue: formatDateInputValue(rangeStart, startHour),
          endValue: formatDateInputValue(rangeStart, endHour),
          title: `${String(startHour).padStart(2, "0")}:00`,
          subtitle: `${safeAnchorDate.getMonth() + 1}월 ${safeAnchorDate.getDate()}일` as string | null,
          scheduledCount: schedules.length,
          primaryScheduleId: schedules[0]?.id ?? null,
          primaryScheduleTitle: schedules[0]?.title ?? null,
          primaryStartLabel: schedules[0] ? formatClock(new Date(schedules[0].starts_at)) : null,
          primaryScheduleReminderTitle: schedules[0] ? scheduleReminderTitle(schedules[0]) : null,
          scheduleTitles: schedules.map((schedule) => schedule.title),
          linkedSessionTitles,
          hasLinkedSession: schedules.some((schedule) => scheduleHasLinkedSession(schedule.id)),
          ariaLabel: `${safeAnchorDate.getMonth() + 1}월 ${safeAnchorDate.getDate()}일 ${String(startHour).padStart(2, "0")}:00 일정 칸 선택`,
          inCurrentMonth: true,
        };
      });
    }

    const monthStart = new Date(safeAnchorDate.getFullYear(), safeAnchorDate.getMonth(), 1);
    const gridStart = addDays(monthStart, -monthStart.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const rangeStart = addDays(gridStart, index);
      const rangeEnd = addDays(rangeStart, 1);
      const schedules = overlappingSchedules(rangeStart, rangeEnd);
      const linkedSessionTitles = linkedSessionTitlesForSchedules(schedules);
      return {
        id: `month-${formatDateInputValue(rangeStart)}`,
        startValue: formatDateInputValue(rangeStart, 9),
        endValue: formatDateInputValue(rangeStart, 10),
        title: `${rangeStart.getDate()}`,
        subtitle: (schedules[0] ? null : "빈 일정") as string | null,
        scheduledCount: schedules.length,
        primaryScheduleId: schedules[0]?.id ?? null,
        primaryScheduleTitle: schedules[0]?.title ?? null,
        primaryStartLabel: schedules[0] ? formatClock(new Date(schedules[0].starts_at)) : null,
        primaryScheduleReminderTitle: schedules[0] ? scheduleReminderTitle(schedules[0]) : null,
        scheduleTitles: schedules.map((schedule) => schedule.title),
        linkedSessionTitles,
        hasLinkedSession: schedules.some((schedule) => scheduleHasLinkedSession(schedule.id)),
        ariaLabel: `${rangeStart.getMonth() + 1}월 ${rangeStart.getDate()}일 일정 칸 선택`,
        inCurrentMonth: rangeStart.getMonth() === safeAnchorDate.getMonth(),
      };
    });
  }

  function applySchedulePlannerSlot(slotId: string, startValue: string, endValue: string) {
    setSelectedPlannerSlotId(slotId);
    setSelectedScheduleId("");
    setPlannerAnchorAt(startValue);
    setScheduleForm((current) => ({
      ...current,
      title: "",
      starts_at: startValue,
      ends_at: endValue,
    }));
    setReminderSelectValue("none");
  }

  function beginScheduleInlineEdit(schedule: ScheduleItem) {
    setSelectedScheduleId(schedule.id);
    setSelectedPlannerSlotId(`existing-${schedule.id}`);
    setPlannerAnchorAt(schedule.starts_at);
    setScheduleForm((current) => ({
      ...current,
      title: schedule.title,
      starts_at: toLocalInputValue(schedule.starts_at),
      ends_at: toLocalInputValue(schedule.ends_at),
    }));
    setReminderSelectValue(reminderMinutesToSelectValue(schedule.remind_before_minutes ?? null));
  }

  function shiftPlannerAnchor(direction: -1 | 1) {
    const anchor = new Date(
      plannerAnchorAt ||
        selectedSchedule?.starts_at ||
        scheduleForm.starts_at ||
        snapshot.schedules[0]?.starts_at ||
        new Date().toISOString(),
    );
    const safeAnchor = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
    const next = new Date(safeAnchor);
    if (scheduleForm.view === "month") {
      next.setMonth(next.getMonth() + direction);
    } else if (scheduleForm.view === "week") {
      next.setDate(next.getDate() + direction * 7);
    } else {
      next.setDate(next.getDate() + direction);
    }
    setPlannerAnchorAt(next.toISOString());
  }

  function resetPlannerAnchor() {
    setPlannerAnchorAt(new Date().toISOString());
  }

  function formatTimegridBlockTooltip(block: TimegridBlock) {
    const linkedTitles = linkedSessionTitlesFor(block.schedule.id);
    const reminderTitle = scheduleReminderTitle(block.schedule);
    return [
      `${block.startLabel}~${block.endLabel} ${block.schedule.title}`,
      linkedTitles.length ? `연결 세션: ${linkedTitles.join(", ")}` : "연결된 업무대화 세션 없음",
      reminderTitle ? reminderTitle : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  function renderWeekTimegrid(weekStart: Date) {
    const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const timegridDays = weekDays.map((day) => buildTimegridDay(day, snapshot.schedules));
    const now = new Date();
    const nowTop = (now.getHours() + now.getMinutes() / 60 - GRID_START_HOUR) * HOUR_HEIGHT;
    const nowInRange = nowTop >= 0 && nowTop <= GRID_TOTAL_HEIGHT;

    return (
      <div className="schedule-timegrid" data-testid="schedule-timegrid">
        <div className="schedule-timegrid__row schedule-timegrid__row--header">
          <div className="schedule-timegrid__gutter" aria-hidden="true" />
          {weekDays.map((day, index) => {
            const isToday = isSameDay(day, now);
            return (
              <div
                key={`header-${index}`}
                className={
                  "schedule-timegrid__day-header" + (isToday ? " schedule-timegrid__day-header--today" : "")
                }
                data-testid={`timegrid-day-header-${index}`}
              >
                <span className="schedule-timegrid__day-name">
                  {WEEKDAY_LABELS[day.getDay()]} {day.getMonth() + 1}/{day.getDate()}
                </span>
                {isToday ? <span className="schedule-timegrid__today-chip">오늘</span> : null}
              </div>
            );
          })}
        </div>
        <div className="schedule-timegrid__row schedule-timegrid__row--allday">
          <div className="schedule-timegrid__gutter schedule-timegrid__allday-title">종일·시간외</div>
          {weekDays.map((day, dayIndex) => (
            <div
              key={`allday-${dayIndex}`}
              className="schedule-timegrid__allday-cell"
              data-testid={`timegrid-allday-${dayIndex}`}
            >
              {timegridDays[dayIndex].band.map((item) => {
                const bandReminderTitle = scheduleReminderTitle(item.schedule);
                return (
                  <button
                    key={`band-${item.schedule.id}`}
                    type="button"
                    className={
                      "schedule-timegrid__band-event" +
                      (selectedScheduleId === item.schedule.id ? " is-selected" : "") +
                      (scheduleHasLinkedSession(item.schedule.id) ? " schedule-timegrid__band-event--linked" : "")
                    }
                    data-testid={`timegrid-event-${item.schedule.id}`}
                    aria-label={item.label}
                    title={bandReminderTitle ? `${item.label}\n${bandReminderTitle}` : item.label}
                    onClick={() => beginScheduleInlineEdit(item.schedule)}
                  >
                    <span className="schedule-timegrid__event-text">
                      {bandReminderTitle ? (
                        <span
                          className="schedule-timegrid__reminder-bell"
                          aria-hidden="true"
                          title={bandReminderTitle}
                        >
                          🔔{" "}
                        </span>
                      ) : null}
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="schedule-timegrid__row schedule-timegrid__row--body">
          <div className="schedule-timegrid__gutter schedule-timegrid__times" aria-hidden="true">
            {GRID_HOURS.map((hour) => (
              <div key={`time-${hour}`} className="schedule-timegrid__time-label">
                {padTwo(hour)}:00
              </div>
            ))}
          </div>
          {weekDays.map((day, dayIndex) => {
            const { blocks, moreClusters } = timegridDays[dayIndex];
            const isToday = isSameDay(day, now);
            return (
              <div
                key={`col-${dayIndex}`}
                className={
                  "schedule-timegrid__day-col" + (isToday ? " schedule-timegrid__day-col--today" : "")
                }
                data-testid={`timegrid-day-col-${dayIndex}`}
              >
                {GRID_HOURS.map((hour) => {
                  const slotId = `timegrid-${formatDateInputValue(day, hour)}`;
                  return (
                    <button
                      key={`cell-${dayIndex}-${hour}`}
                      type="button"
                      className={
                        "schedule-timegrid__cell" + (selectedPlannerSlotId === slotId ? " is-selected" : "")
                      }
                      data-testid={`timegrid-cell-${dayIndex}-${hour}`}
                      aria-label={`${day.getMonth() + 1}월 ${day.getDate()}일 ${padTwo(hour)}:00 일정 칸 선택`}
                      title={`${day.getMonth() + 1}월 ${day.getDate()}일 ${padTwo(hour)}:00 — 누르면 시작·종료 시각이 입력됩니다`}
                      onClick={() =>
                        applySchedulePlannerSlot(
                          slotId,
                          formatDateInputValue(day, hour),
                          formatDateInputValue(day, hour + 1),
                        )
                      }
                    />
                  );
                })}
                {blocks.map((block) => {
                  const style: CSSProperties = {
                    top: block.top,
                    height: block.height,
                    left: block.cols === 2 && block.col === 1 ? "calc(50% + 1px)" : "2px",
                    width: block.cols === 2 ? "calc(50% - 3px)" : "calc(100% - 4px)",
                  };
                  const blockReminderTitle = scheduleReminderTitle(block.schedule);
                  return (
                    <button
                      key={`event-${block.schedule.id}-${block.top}`}
                      type="button"
                      className={[
                        "schedule-timegrid__event",
                        block.cols === 2 ? "schedule-timegrid__event--split" : "",
                        scheduleHasLinkedSession(block.schedule.id) ? "schedule-timegrid__event--linked" : "",
                        selectedScheduleId === block.schedule.id ? "is-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={style}
                      data-testid={`timegrid-event-${block.schedule.id}`}
                      aria-label={`${block.startLabel} ${block.schedule.title}`}
                      title={formatTimegridBlockTooltip(block)}
                      onClick={() => beginScheduleInlineEdit(block.schedule)}
                    >
                      <span className="schedule-timegrid__event-text">
                        {blockReminderTitle ? (
                          <span
                            className="schedule-timegrid__reminder-bell"
                            aria-hidden="true"
                            title={blockReminderTitle}
                          >
                            🔔{" "}
                          </span>
                        ) : null}
                        {block.startLabel} {block.schedule.title}
                      </span>
                    </button>
                  );
                })}
                {moreClusters.map((clusterItem, clusterIndex) => (
                  <button
                    key={`more-${dayIndex}-${clusterIndex}`}
                    type="button"
                    className="schedule-timegrid__more"
                    style={{ top: clusterItem.top }}
                    data-testid={`timegrid-more-${dayIndex}-${clusterIndex}`}
                    aria-label={`표시되지 않은 일정 ${clusterItem.items.length}개 — 첫 일정 편집 열기`}
                    title={clusterItem.items
                      .map((item) => `${item.startLabel} ${item.schedule.title}`)
                      .join("\n")}
                    onClick={() => beginScheduleInlineEdit(clusterItem.items[0].schedule)}
                  >
                    +{clusterItem.items.length}
                  </button>
                ))}
                {isToday && nowInRange ? (
                  <div
                    className="schedule-timegrid__now-line"
                    data-testid="schedule-now-line"
                    style={{ top: nowTop }}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderScheduleSection() {
    const currentViewLabel = scheduleViewLabel(scheduleForm.view);
    const plannerAnchor =
      plannerAnchorAt ||
      selectedSchedule?.starts_at ||
      scheduleForm.starts_at ||
      snapshot.schedules[0]?.starts_at ||
      new Date().toISOString();
    const plannerAnchorDate = new Date(plannerAnchor);
    const safePlannerAnchorDate = Number.isNaN(plannerAnchorDate.getTime()) ? new Date() : plannerAnchorDate;
    const weekStart = addDays(startOfDay(safePlannerAnchorDate), -safePlannerAnchorDate.getDay());
    const weekEnd = addDays(weekStart, 6);
    const plannerAnchorLabel =
      scheduleForm.view === "month"
        ? `${safePlannerAnchorDate.getFullYear()}년 ${safePlannerAnchorDate.getMonth() + 1}월`
        : scheduleForm.view === "week"
          ? `${weekStart.getMonth() + 1}/${weekStart.getDate()} - ${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`
          : `${safePlannerAnchorDate.getMonth() + 1}월 ${safePlannerAnchorDate.getDate()}일`;
    const editingExistingSchedule =
      selectedPlannerSlotId.startsWith("existing-") &&
      Boolean(selectedSchedule) &&
      selectedScheduleId === selectedSchedule?.id;
    const selectedScheduleLinkedSession =
      editingExistingSchedule && selectedSchedule
        ? snapshot.workSessions.find((session) => session.schedule_id === selectedSchedule.id) ?? null
        : null;
    const plannerSlots = scheduleForm.view === "week" ? [] : buildSchedulePlannerSlots();
    const formatScheduleSlotTooltip = (slot: (typeof plannerSlots)[number]) => {
      if (slot.scheduledCount === 0) {
        return `${slot.ariaLabel}\n등록 일정 없음`;
      }
      const lines = [
        [slot.title, slot.subtitle].filter(Boolean).join(" · "),
        `일정 ${slot.scheduledCount}개: ${slot.scheduleTitles.join(", ")}`,
        slot.linkedSessionTitles.length ? `연결 세션: ${slot.linkedSessionTitles.join(", ")}` : "연결 세션 없음",
        slot.hasLinkedSession ? "상태: 세션 연결 일정" : "상태: 독립 일정",
        slot.primaryScheduleReminderTitle ?? null,
      ];
      return lines.filter(Boolean).join("\n");
    };
    const plannerDayHeaders =
      scheduleForm.view === "month"
        ? WEEKDAY_LABELS.map((label) => (
            <div key={label} className="schedule-grid__header" data-testid={`schedule-grid-header-${label}`}>
              {label}
            </div>
          ))
        : null;
    const dueReminderNow = new Date();
    return (
      <>
        {/* W5-2: 업무대화에서 일정으로 넘어온 경우 — 원래 대화로 한 번에 복귀하는 칩 */}
        {chatReturnContext?.from === "schedule" ? (
          <div className="chat-return-banner" data-testid="schedule-chat-return-chip">
            <p className="chat-return-banner__text">
              <strong>&lsquo;{chatReturnContext.title}&rsquo;</strong> 대화에서 이동함
            </p>
            <button
              type="button"
              className="button-secondary"
              data-testid="schedule-chat-return-button"
              title="이동하기 전에 보던 업무대화로 돌아갑니다"
              onClick={() => {
                setSelectedSessionId(chatReturnContext.sessionId);
                setActiveMenu("chat");
                setChatReturnContext(null);
              }}
            >
              대화로 돌아가기
            </button>
          </div>
        ) : null}
        {dueReminders.length ? (
          <div className="schedule-reminder-banner" data-testid="schedule-reminder-banner">
            {dueReminders.map((schedule) => {
              const minutesRemaining = minutesUntil(schedule.starts_at, dueReminderNow);
              const linkedSession = snapshot.workSessions.find(
                (session) => session.schedule_id === schedule.id,
              );
              return (
                <div
                  key={schedule.id}
                  className="schedule-reminder-card"
                  data-testid={`schedule-reminder-card-${schedule.id}`}
                >
                  <span className="schedule-reminder-card__text">
                    곧 시작: {schedule.title} ({minutesRemaining ?? 0}분 후)
                  </span>
                  <div className="schedule-reminder-card__actions">
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={reminderAckPendingId === schedule.id}
                      onClick={() => void acknowledgeDueReminder(schedule)}
                    >
                      확인
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      title={linkedSession ? "연결 세션 열기" : "연결된 업무대화 세션 없음"}
                      disabled={!linkedSession}
                      onClick={() => openSessionForDueReminder(schedule)}
                    >
                      세션 열기
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        <SectionCard
          eyebrow="calendar-first planner"
          title="업무일정 캘린더"
          actions={
            <div className="inline-actions">
              <span className="pill pill--soft">현재 보기: {currentViewLabel}</span>
              <span className="pill pill--soft">{plannerAnchorLabel}</span>
            </div>
          }
        >
          <div className="calendar-ux" data-testid="schedule-planner-section">
            <div className="calendar-body-grid">
          <div className="schedule-planner">
            <div className="planner-toolbar">
              <div className="planner-toolbar__group planner-toolbar__group--views">
                <button
                  type="button"
                  className={scheduleForm.view === "month" ? "" : "button-secondary"}
                  onClick={() =>
                    setScheduleForm((current) => ({
                      ...current,
                      view: "month",
                    }))
                  }
                >
                  월
                </button>
                <button
                  type="button"
                  className={scheduleForm.view === "week" ? "" : "button-secondary"}
                  onClick={() =>
                    setScheduleForm((current) => ({
                      ...current,
                      view: "week",
                    }))
                  }
                >
                  주
                </button>
                <button
                  type="button"
                  className={scheduleForm.view === "day" ? "" : "button-secondary"}
                  onClick={() =>
                    setScheduleForm((current) => ({
                      ...current,
                      view: "day",
                    }))
                  }
                >
                  일
                </button>
              </div>
              <div className="planner-toolbar__group planner-toolbar__group--nav">
                <button type="button" className="button-secondary" onClick={() => shiftPlannerAnchor(-1)}>
                  <ChevronLeft size={16} aria-hidden="true" />
                  이전
                </button>
                <button type="button" className="button-secondary" onClick={() => resetPlannerAnchor()}>
                  오늘
                </button>
                <button type="button" className="button-secondary" onClick={() => shiftPlannerAnchor(1)}>
                  다음
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            <p className="subtle-text">
              빈 시간 칸을 누르면 시작·종료 시각이 채워지고, 일정 블록을 누르면 편집할 수 있습니다.
            </p>
            {scheduleForm.view === "week" ? (
              renderWeekTimegrid(weekStart)
            ) : (
              <>
                {plannerDayHeaders ? (
                  <div className={`schedule-grid-headers schedule-grid-headers--${scheduleForm.view}`}>
                    {plannerDayHeaders}
                  </div>
                ) : null}
                <div className={`schedule-slot-grid schedule-slot-grid--${scheduleForm.view}`}>
                  {plannerSlots.map((slot, index) => (
                    <button
                      key={slot.id}
                      type="button"
                      className={[
                        "schedule-slot",
                        selectedPlannerSlotId === slot.id ? "schedule-slot--selected" : "",
                        slot.inCurrentMonth ? "" : "schedule-slot--muted",
                        slot.scheduledCount > 0 ? "schedule-slot--occupied" : "",
                        slot.scheduledCount > 1 ? "schedule-slot--busy" : "",
                        slot.scheduledCount > 0 && slot.hasLinkedSession ? "schedule-slot--linked" : "",
                        slot.scheduledCount > 0 && !slot.hasLinkedSession ? "schedule-slot--standalone" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-testid={`schedule-slot-${index}`}
                      aria-label={slot.ariaLabel}
                      title={formatScheduleSlotTooltip(slot)}
                      onClick={() => {
                        if (slot.primaryScheduleId) {
                          const existingSchedule = snapshot.schedules.find(
                            (schedule) => schedule.id === slot.primaryScheduleId,
                          );
                          if (existingSchedule) {
                            beginScheduleInlineEdit(existingSchedule);
                            return;
                          }
                        }
                        applySchedulePlannerSlot(slot.id, slot.startValue, slot.endValue);
                      }}
                    >
                      <strong className="schedule-slot__line" title={slot.title}>{slot.title}</strong>
                      {slot.subtitle ? (
                        <span className="schedule-slot__line" title={slot.subtitle}>
                          {slot.subtitle}
                        </span>
                      ) : null}
                      {slot.scheduledCount > 0 && slot.primaryScheduleTitle ? (
                        <>
                          <span
                            data-testid={`schedule-slot-existing-title-${index}`}
                            className="schedule-slot__meta schedule-slot__line"
                            title={
                              slot.primaryScheduleReminderTitle
                                ? `${slot.primaryStartLabel ?? ""} ${slot.primaryScheduleTitle}\n${slot.primaryScheduleReminderTitle}`.trim()
                                : `${slot.primaryStartLabel ?? ""} ${slot.primaryScheduleTitle}`.trim()
                            }
                          >
                            {slot.primaryScheduleReminderTitle ? "🔔 " : ""}
                            {slot.primaryStartLabel} {slot.primaryScheduleTitle}
                          </span>
                          {slot.scheduleTitles.length > 1 ? (
                            <span
                              className="schedule-slot__meta schedule-slot__meta--strong schedule-slot__line"
                              title={slot.scheduleTitles.slice(1).join(", ")}
                            >
                              +{slot.scheduleTitles.length - 1}개 더
                            </span>
                          ) : null}
                          {slot.hasLinkedSession ? (
                            <span
                              className="schedule-slot__badge schedule-slot__line"
                              data-testid={`schedule-slot-link-state-${index}`}
                              title={
                                slot.linkedSessionTitles.length
                                  ? `연결 세션: ${slot.linkedSessionTitles.join(", ")}`
                                  : "세션 연결"
                              }
                            >
                              세션 연결
                            </span>
                          ) : (
                            <span
                              className="schedule-slot__badge schedule-slot__badge--muted schedule-slot__line"
                              data-testid={`schedule-slot-link-state-${index}`}
                              title="연결된 업무대화 세션 없음"
                            >
                              독립 일정
                            </span>
                          )}
                        </>
                      ) : null}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="planner-inline-editor">
              <div className="planner-inline-editor__header">
                <strong>{editingExistingSchedule ? "기존 일정 편집" : "선택 칸 일정 입력"}</strong>
                <span className="subtle-text">
                  {scheduleForm.starts_at
                    ? `${scheduleForm.starts_at} -> ${scheduleForm.ends_at || "종료 미선택"}`
                    : "아직 선택 없음"}
                </span>
              </div>
              <form className="stack-form" onSubmit={submitSchedule}>
                <label>
                  일정 제목
                  <input
                    value={scheduleForm.title}
                    onChange={(event) => setScheduleForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="예: 주간 보고"
                    required
                  />
                </label>
                <div className="grid-2">
                  <label>
                    시작
                    <input
                      type="datetime-local"
                      value={scheduleForm.starts_at}
                      onChange={(event) =>
                        setScheduleForm((current) => ({ ...current, starts_at: event.target.value }))
                      }
                      required
                    />
                  </label>
                  <label>
                    종료
                    <input
                      type="datetime-local"
                      value={scheduleForm.ends_at}
                      onChange={(event) =>
                        setScheduleForm((current) => ({ ...current, ends_at: event.target.value }))
                      }
                      required
                    />
                  </label>
                </div>
                <label>
                  사전 알림
                  <select
                    value={reminderSelectValue}
                    onChange={(event) => setReminderSelectValue(event.target.value)}
                    aria-label="사전 알림"
                  >
                    {REMINDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="toolbar">
                  <button type="submit" className="button-with-icon" disabled={submitting}>
                    <AssetIcon
                      src={editingExistingSchedule ? "/icons/action/check-inverse.svg" : "/icons/action/plus-inverse.svg"}
                    />
                    {editingExistingSchedule ? "일정 수정 저장" : "일정 등록"}
                  </button>
                  {editingExistingSchedule ? (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="새 일정 입력으로 전환"
                      title="새 일정 입력으로 전환"
                      onClick={() => {
                        setSelectedScheduleId("");
                        setSelectedPlannerSlotId("");
                        setScheduleForm({ title: "", starts_at: "", ends_at: "", view: scheduleForm.view });
                        setReminderSelectValue("none");
                      }}
                    >
                      <AssetIcon src="/icons/action/plus.svg" />
                    </button>
                  ) : null}
                  {editingExistingSchedule && selectedSchedule ? (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={selectedScheduleLinkedSession ? "연결 세션 열기" : "연결 세션 만들기"}
                      title={selectedScheduleLinkedSession ? "연결 세션 열기" : "연결 세션 만들기"}
                      onClick={() => void openChatForSchedule(selectedSchedule)}
                    >
                      <AssetIcon src="/icons/action/calendar-link.svg" />
                    </button>
                  ) : null}
                  {editingExistingSchedule ? (
                    <button
                      type="button"
                      className="button-secondary button-danger button-with-icon"
                      onClick={() => void deleteSelectedSchedule()}
                      disabled={submitting}
                      title="이 일정을 삭제합니다 (되돌릴 수 없음)"
                    >
                      <AssetIcon src="/icons/action/close.svg" />
                      일정 삭제
                    </button>
                  ) : null}
                </div>
              </form>
            </div>
          </div>
          </div>
          </div>
        </SectionCard>
      </>
    );
  }

  return renderScheduleSection();
}
