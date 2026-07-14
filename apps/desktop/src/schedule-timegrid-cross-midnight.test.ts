import { describe, expect, it } from "vitest";
import type { ScheduleItem } from "./api";
import { buildTimegridDay } from "./screens/ScheduleScreen";

// WI-5: 자정교차 일정 중복 렌더링 회귀 배터리 (fix-tracks/timegrid-benchmark.json A-01~A-12)
// buildTimegridDay 순수 함수를 직접 호출한다 — DOM 불필요.
// 날짜는 반드시 new Date(2026,6,d,h,m) 로컬 생성자로 만든다(UTC ISO 하드코딩 금지 — 트랙 risks 3).

// 기준 주: 2026-07-12(일) ~ 2026-07-18(토)
const WEEK_DAYS = [12, 13, 14, 15, 16, 17, 18];

const localDate = (day: number, hour: number, minute = 0) =>
  new Date(2026, 6, day, hour, minute, 0, 0);
const localIso = (day: number, hour: number, minute = 0) =>
  localDate(day, hour, minute).toISOString();

function makeSchedule(
  id: string,
  title: string,
  start: [day: number, hour: number, minute?: number],
  end: [day: number, hour: number, minute?: number],
): ScheduleItem {
  return {
    id,
    title,
    starts_at: localIso(start[0], start[1], start[2] ?? 0),
    ends_at: localIso(end[0], end[1], end[2] ?? 0),
    view: "week",
    created_at: localIso(1, 0, 0),
  };
}

/** 주 7일 전체를 buildTimegridDay로 돌려 day(일자)별 결과 맵을 만든다. */
function buildWeek(schedules: ScheduleItem[]) {
  const results = new Map<number, ReturnType<typeof buildTimegridDay>>();
  for (const day of WEEK_DAYS) {
    results.set(day, buildTimegridDay(localDate(day, 0), schedules));
  }
  return results;
}

function bandTotal(results: Map<number, ReturnType<typeof buildTimegridDay>>) {
  let total = 0;
  for (const result of results.values()) {
    total += result.band.length;
  }
  return total;
}

function blocksTotal(results: Map<number, ReturnType<typeof buildTimegridDay>>) {
  let total = 0;
  for (const result of results.values()) {
    total += result.blocks.length;
  }
  return total;
}

describe("Schedule week timegrid — cross-midnight duplication (WI-5)", () => {
  it("A-01 [버그 재현→수정 검증] 23:12→익일 00:12 일정은 시작일 band에만 1회 표시된다", () => {
    const schedules = [makeSchedule("a01", "심야 배포 점검", [12, 23, 12], [13, 0, 12])];
    const results = buildWeek(schedules);

    // 7/12: band 1회 (label == '23:12 심야 배포 점검'), blocks 0
    const day12 = results.get(12)!;
    expect(day12.band).toHaveLength(1);
    expect(day12.band[0].label).toBe("23:12 심야 배포 점검");
    expect(day12.blocks).toHaveLength(0);

    // 7/13~7/18: band 0, blocks 0 (수정 전에는 7/13 band==1로 FAIL해야 함)
    for (const day of WEEK_DAYS.slice(1)) {
      expect(results.get(day)!.band, `7/${day} band`).toHaveLength(0);
      expect(results.get(day)!.blocks, `7/${day} blocks`).toHaveLength(0);
    }

    // 주 전체 band 등장 합계 정확히 1회, blocks 합계 0
    expect(bandTotal(results)).toBe(1);
    expect(blocksTotal(results)).toBe(0);
  });

  it("A-02 [네거티브 컨트롤] 자정 직전 종료(23:00→23:59)는 시작일에만 band 1회", () => {
    const schedules = [makeSchedule("a02", "심야 마감", [12, 23, 0], [12, 23, 59])];

    const day12 = buildTimegridDay(localDate(12, 0), schedules);
    expect(day12.band).toHaveLength(1);
    expect(day12.band[0].label).toBe("23:00 심야 마감");
    expect(day12.blocks).toHaveLength(0);

    const day13 = buildTimegridDay(localDate(13, 0), schedules);
    expect(day13.band).toHaveLength(0);
    expect(day13.blocks).toHaveLength(0);
  });

  it("A-03 [네거티브 컨트롤] 자정 정각(00:00) 종료 경계 — 익일에는 아무것도 없음", () => {
    const schedules = [makeSchedule("a03", "야간 정리", [12, 22, 30], [13, 0, 0])];

    const day12 = buildTimegridDay(localDate(12, 0), schedules);
    expect(day12.band).toHaveLength(1);
    expect(day12.band[0].label).toBe("22:30 야간 정리");
    expect(day12.blocks).toHaveLength(0);

    // end(00:00) <= dayStart(00:00) 이므로 겹침 필터가 차단 — 경계 등호 회귀 방지
    const day13 = buildTimegridDay(localDate(13, 0), schedules);
    expect(day13.band).toHaveLength(0);
    expect(day13.blocks).toHaveLength(0);
  });

  it("A-04 자정 정각(00:00) 시작 — start==dayStart 등호에서도 band가 유지된다", () => {
    const schedules = [makeSchedule("a04", "새벽 배치", [13, 0, 0], [13, 1, 0])];

    // 7/12: start >= dayEnd 라 아무것도 없음
    const day12 = buildTimegridDay(localDate(12, 0), schedules);
    expect(day12.band).toHaveLength(0);
    expect(day12.blocks).toHaveLength(0);

    // 7/13: 표시창(07:00) 이전이므로 band 1회 — 수정 후에도 등호 케이스가 살아있는지 확인
    const day13 = buildTimegridDay(localDate(13, 0), schedules);
    expect(day13.band).toHaveLength(1);
    expect(day13.band[0].label).toBe("00:00 새벽 배치");
    expect(day13.blocks).toHaveLength(0);
  });

  it("A-05 [네거티브 컨트롤] 표시창 이전 새벽 일정(05:00→06:00)은 당일 band 1회", () => {
    const schedules = [makeSchedule("a05", "새벽 점검", [13, 5, 0], [13, 6, 0])];
    const results = buildWeek(schedules);

    const day13 = results.get(13)!;
    expect(day13.band).toHaveLength(1);
    expect(day13.band[0].label).toBe("05:00 새벽 점검");
    expect(day13.blocks).toHaveLength(0);

    for (const day of WEEK_DAYS.filter((d) => d !== 13)) {
      expect(results.get(day)!.band, `7/${day} band`).toHaveLength(0);
      expect(results.get(day)!.blocks, `7/${day} blocks`).toHaveLength(0);
    }
  });

  it("A-06 표시창 이후 심야 일정(21:00→22:00, 자정 미교차)은 당일 band 1회", () => {
    const schedules = [makeSchedule("a06", "심야 점검", [13, 21, 0], [13, 22, 0])];

    const day13 = buildTimegridDay(localDate(13, 0), schedules);
    expect(day13.band).toHaveLength(1);
    expect(day13.band[0].label).toBe("21:00 심야 점검");
    expect(day13.blocks).toHaveLength(0);

    // 7/14: end(22:00) <= 7/14 dayStart 이므로 없음
    const day14 = buildTimegridDay(localDate(14, 0), schedules);
    expect(day14.band).toHaveLength(0);
    expect(day14.blocks).toHaveLength(0);
  });

  it("A-07 표시창 시작 경계(07:00→08:00)는 band가 아니라 timed block", () => {
    const schedules = [makeSchedule("a07", "아침 회의", [13, 7, 0], [13, 8, 0])];

    const day13 = buildTimegridDay(localDate(13, 0), schedules);
    expect(day13.band).toHaveLength(0);
    expect(day13.blocks).toHaveLength(1);
    expect(day13.blocks[0].top).toBe(0);
    expect(day13.blocks[0].height).toBe(48);
    expect(day13.blocks[0].startLabel).toBe("07:00");
  });

  it("A-08 표시창 종료 경계 — 19:00→20:00은 block, 20:00→21:00은 band", () => {
    // (a) 19:00→20:00: 마지막 시간대 블록
    const dayA = buildTimegridDay(localDate(13, 0), [
      makeSchedule("a08a", "저녁 보고", [13, 19, 0], [13, 20, 0]),
    ]);
    expect(dayA.band).toHaveLength(0);
    expect(dayA.blocks).toHaveLength(1);
    expect(dayA.blocks[0].top).toBe(576);
    expect(dayA.blocks[0].height).toBe(48);

    // (b) 20:00→21:00: visibleEnd==visibleStart==20:00 → band
    const dayB = buildTimegridDay(localDate(13, 0), [
      makeSchedule("a08b", "야근 정산", [13, 20, 0], [13, 21, 0]),
    ]);
    expect(dayB.band).toHaveLength(1);
    expect(dayB.band[0].label).toBe("20:00 야근 정산");
    expect(dayB.blocks).toHaveLength(0);
  });

  it("A-09 2일 이상 걸친 일정(7/12 10:00→7/14 11:00) — 중간일은 '종일' band, 양끝은 클립된 block", () => {
    const schedules = [makeSchedule("a09", "워크숍", [12, 10, 0], [14, 11, 0])];

    // 7/12: 10:00~20:00 클립 블록
    const day12 = buildTimegridDay(localDate(12, 0), schedules);
    expect(day12.band).toHaveLength(0);
    expect(day12.blocks).toHaveLength(1);
    expect(day12.blocks[0].top).toBe(144);
    expect(day12.blocks[0].height).toBe(480);

    // 7/13: coversWholeDay → '종일' band (현행 유지 확인)
    const day13 = buildTimegridDay(localDate(13, 0), schedules);
    expect(day13.band).toHaveLength(1);
    expect(day13.band[0].label).toBe("종일 워크숍");
    expect(day13.blocks).toHaveLength(0);

    // 7/14: 07:00~11:00 블록
    const day14 = buildTimegridDay(localDate(14, 0), schedules);
    expect(day14.band).toHaveLength(0);
    expect(day14.blocks).toHaveLength(1);
    expect(day14.blocks[0].top).toBe(0);
    expect(day14.blocks[0].height).toBe(192);
  });

  it("A-10 [네거티브 컨트롤] 종일 일정(7/13 00:00→7/14 00:00)은 당일 '종일' band 1회", () => {
    const schedules = [makeSchedule("a10", "연차", [13, 0, 0], [14, 0, 0])];

    const day13 = buildTimegridDay(localDate(13, 0), schedules);
    expect(day13.band).toHaveLength(1);
    expect(day13.band[0].label).toBe("종일 연차");
    expect(day13.blocks).toHaveLength(0);

    for (const day of [12, 14]) {
      const result = buildTimegridDay(localDate(day, 0), schedules);
      expect(result.band, `7/${day} band`).toHaveLength(0);
      expect(result.blocks, `7/${day} blocks`).toHaveLength(0);
    }
  });

  it("A-11 [준 네거티브 컨트롤] 자정 넘어 표시창 안까지 이어지는 일정(22:00→익일 09:00) — 시작일 band + 익일 실점유 block", () => {
    const schedules = [makeSchedule("a11", "야간 당직", [12, 22, 0], [13, 9, 0])];

    // 7/12: 표시창 밖 시작 → band
    const day12 = buildTimegridDay(localDate(12, 0), schedules);
    expect(day12.band).toHaveLength(1);
    expect(day12.band[0].label).toBe("22:00 야간 당직");
    expect(day12.blocks).toHaveLength(0);

    // 7/13: 07:00~09:00 실점유 블록은 유지(중복 아님 — band만 억제됨)
    const day13 = buildTimegridDay(localDate(13, 0), schedules);
    expect(day13.band).toHaveLength(0);
    expect(day13.blocks).toHaveLength(1);
    expect(day13.blocks[0].top).toBe(0);
    expect(day13.blocks[0].height).toBe(96);
  });

  it("A-12 [네거티브 컨트롤] 일반 주간 일정 2건은 각자 자기 날짜에만 block 1회", () => {
    const schedules = [
      makeSchedule("a12a", "주간보고", [14, 10, 0], [14, 11, 30]),
      makeSchedule("a12b", "팀회의", [15, 14, 0], [15, 15, 0]),
    ];
    const results = buildWeek(schedules);

    const day14 = results.get(14)!;
    expect(day14.band).toHaveLength(0);
    expect(day14.blocks).toHaveLength(1);
    expect(day14.blocks[0].top).toBe(144);
    expect(day14.blocks[0].height).toBe(72);
    expect(day14.blocks[0].schedule.title).toBe("주간보고");

    const day15 = results.get(15)!;
    expect(day15.band).toHaveLength(0);
    expect(day15.blocks).toHaveLength(1);
    expect(day15.blocks[0].top).toBe(336);
    expect(day15.blocks[0].height).toBe(48);
    expect(day15.blocks[0].schedule.title).toBe("팀회의");

    // 타 날짜 등장 0 — 주 전체 합계로 확인
    expect(bandTotal(results)).toBe(0);
    expect(blocksTotal(results)).toBe(2);
  });
});
