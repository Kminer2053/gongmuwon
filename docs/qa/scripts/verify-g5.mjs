// 2호 라운드 G5(대화연계) 실LLM 배터리 — L-01/02/06 + 멀티인텐트 변형 13종
// 사용: node verify-g5.mjs [outPath]  (1회 실행; 반복은 상위에서 3회 호출)
import fs from "node:fs";
const BASE = "http://127.0.0.1:8765";
const outPath = process.argv[2] || "g5-results.json";

async function api(path, method = "GET", body = null) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: body ? JSON.stringify(body) : null,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
async function newSession(title) {
  return (await api("/api/work-sessions", "POST", { title })).json.id;
}
async function turn(sid, text) {
  const t0 = Date.now();
  const r = await api(`/api/work-sessions/${sid}/turn`, "POST", { text });
  return { ...r, ms: Date.now() - t0 };
}
const actionsOf = (r) => r.json?.context_summary?.skill_actions || [];
const textOf = (r) => String(r.json?.assistant_message?.text || "");
const resultsOf = (r) => {
  const items = r.json?.context_summary?.skill_results || [];
  return Array.isArray(items) ? items : [];
};
function mdOf(r) {
  // 산출 markdown 파일 내용 (있으면)
  for (const item of resultsOf(r)) {
    const p = item?.markdown_path;
    if (p && fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return "";
}
async function schedules() {
  return (await api("/api/schedules")).json.items || [];
}
const createdScheduleIds = [];
async function trackNewSchedules(before) {
  const after = await schedules();
  for (const s of after) if (!before.some((b) => b.id === s.id)) createdScheduleIds.push(s.id);
  return after;
}

const results = [];
function record(id, pass, detail) {
  results.push({ id, pass, detail });
  console.error(`${pass ? "PASS" : "FAIL"} ${id} ${JSON.stringify(detail).slice(0, 160)}`);
}

// ── L-01: 지식질의 → "방금 내용을 1페이지 보고서로" ──
{
  const sid = await newSession("2호 L-01");
  await turn(sid, "공공기관 안전관리등급 기준이 뭐야?");
  const t2 = await turn(sid, "방금 내용을 1페이지 보고서로 작성해줘");
  const text = textOf(t2);
  const md = mdOf(t2);
  const topicOk = text.includes("안전관리") || md.includes("안전관리");
  const noAx = !text.includes("AX포털") && !md.includes("AX포털");
  record("L-01", t2.status === 201 && text.includes("onePageReport") && topicOk && noAx, {
    topicOk, noAx, ms: t2.ms, head: text.slice(0, 100),
  });
}

// ── L-02: G5 원문 멀티인텐트 (일정+이메일) ──
{
  const before = await schedules();
  const sid = await newSession("2호 L-02");
  const t = await turn(
    sid,
    "다음주 화요일(2026년 7월 21일) 오후 3시에 AI 업무 추진 팀 회의 일정을 잡고, 그 일정 내용으로 회의 안내 이메일도 작성해줘"
  );
  const acts = actionsOf(t);
  const after = await trackNewSchedules(before);
  const sched = after.find((s) => s.starts_at === "2026-07-21T15:00:00+09:00" && s.title.includes("회의"));
  const artifact = resultsOf(t).find((x) => x?.artifact_path);
  const artifactOk = artifact && fs.existsSync(artifact.artifact_path) && artifact.format === "email";
  record("L-02", acts[0] === "intent.plan" && acts.includes("schedule.create") && acts.includes("document.create") && !!sched && !!artifactOk, {
    acts, sched: !!sched, artifactOk: !!artifactOk, ms: t.ms,
  });
}

// ── E2E-03: 순서역전 ──
{
  const before = await schedules();
  const sid = await newSession("2호 E03");
  const t = await turn(sid, "회의 안내 이메일을 작성해줘. 그리고 2026년 7월 22일 오후 2시에 국장 보고 일정도 잡아줘");
  const acts = actionsOf(t);
  const after = await trackNewSchedules(before);
  const sched = after.find((s) => s.starts_at === "2026-07-22T14:00:00+09:00");
  record("E2E-03", acts.includes("schedule.create") && acts.includes("document.create") && !!sched, { acts, sched: !!sched });
}

// ── E2E-04: 내일+분 단위+메일 ──
{
  const before = await schedules();
  const sid = await newSession("2호 E04");
  const t = await turn(sid, "내일 오전 9시 30분에 주간 업무 점검 회의 일정 추가하고 참석 안내 메일 초안도 써줘");
  const acts = actionsOf(t);
  const after = await trackNewSchedules(before);
  const sched = after.find((s) => s.title.includes("주간 업무 점검") && s.starts_at.includes("T09:30"));
  record("E2E-04", acts.includes("schedule.create") && acts.includes("document.create") && !!sched, { acts, sched: !!sched });
}

// ── E2E-05: 상대요일+공문 ──
{
  const before = await schedules();
  const sid = await newSession("2호 E05");
  const t = await turn(sid, "다음주 금요일 오후 4시에 예산 조정 협의 일정을 잡고, 그 내용을 공문으로 작성해줘");
  const acts = actionsOf(t);
  const after = await trackNewSchedules(before);
  const sched = after.find((s) => s.title.includes("예산 조정 협의") && s.starts_at.includes("T16:00"));
  record("E2E-05", acts.includes("schedule.create") && acts.includes("document.create") && !!sched, { acts, sched: !!sched });
}

// ── E2E-06: 점 표기+시행문 ──
{
  const before = await schedules();
  const sid = await newSession("2호 E06");
  const t = await turn(sid, "2026.7.28 오후 1시 감사 대응 준비 회의 일정 등록하고 관련 시행문도 생성해줘");
  const acts = actionsOf(t);
  const after = await trackNewSchedules(before);
  const sched = after.find((s) => s.starts_at === "2026-07-28T13:00:00+09:00");
  record("E2E-06", acts.includes("schedule.create") && acts.includes("document.create") && !!sched, { acts, sched: !!sched });
}

// ── E2E-07: 지식질의+일정 ──
{
  const before = await schedules();
  const sid = await newSession("2호 E07");
  const t = await turn(sid, "출장비 지급 기준이 뭔지 알려주고, 내일 오전 10시에 출장비 정산 회의 일정도 등록해줘");
  const acts = actionsOf(t);
  const after = await trackNewSchedules(before);
  const sched = after.find((s) => s.title.includes("출장비 정산") && s.starts_at.includes("T10:00"));
  record("E2E-07", acts.includes("schedule.create") && !acts.includes("help.guide") && !!sched, {
    acts, sched: !!sched, knowledge: acts.includes("knowledge.answer"),
  });
}

// ── E2E-08: 단일 일정 (문서 오발동 감시) ──
let e08ScheduleId = null;
{
  const before = await schedules();
  const sid = await newSession("2호 E08");
  const t = await turn(sid, "2026년 7월 30일 오후 5시에 반기 실적 점검 회의 일정 잡아줘");
  const acts = actionsOf(t);
  const after = await trackNewSchedules(before);
  const sched = after.find((s) => s.title.includes("반기 실적 점검"));
  e08ScheduleId = sched?.id || null;
  record("E2E-08", JSON.stringify(acts) === JSON.stringify(["schedule.create"]) && !!sched, { acts, sched: !!sched });
}

// ── E2E-09: 단일 문서 (일정 오발동 감시) ──
{
  const before = await schedules();
  const sid = await newSession("2호 E09");
  const t = await turn(sid, "AI 도입 추진 현황을 정리한 1페이지 보고서 작성해줘");
  const acts = actionsOf(t);
  const after = await schedules();
  record("E2E-09", JSON.stringify(acts) === JSON.stringify(["document.create"]) && after.length === before.length, { acts });
}

// ── E2E-11/12: 순수 도움말 (네거티브 컨트롤) ──
for (const [id, q] of [["E2E-11", "일정 기능 사용법 알려줘"], ["E2E-12", "문서작성 어떻게 해?"]]) {
  const sid = await newSession(`2호 ${id}`);
  const t = await turn(sid, q);
  const acts = actionsOf(t);
  record(id, JSON.stringify(acts) === JSON.stringify(["help.guide"]) && textOf(t).includes("Gongmu 기능 사용법입니다"), { acts, ms: t.ms });
}

// ── E2E-13: 일정 조회 무회귀 ──
{
  const sid = await newSession("2호 E13");
  const t = await turn(sid, "이번 주 일정 확인해줘");
  record("E2E-13", JSON.stringify(actionsOf(t)) === JSON.stringify(["schedule.list"]), { acts: actionsOf(t) });
}

// ── E2E-14: 일정 삭제 무회귀 (E08이 만든 일정 삭제) ──
{
  const sid = await newSession("2호 E14");
  const t = await turn(sid, "반기 실적 점검 회의 일정 삭제해줘");
  const acts = actionsOf(t);
  const after = await schedules();
  const gone = !after.some((s) => s.title.includes("반기 실적 점검"));
  record("E2E-14", acts.includes("schedule.delete") && gone, { acts, gone });
  if (gone && e08ScheduleId) createdScheduleIds.splice(createdScheduleIds.indexOf(e08ScheduleId), 1);
}

// ── L-06: 컨텍스트 초기화 ──
{
  const sid = await newSession("2호 L-06");
  await turn(sid, "감사 지적사항 처리 방법 알려줘");
  await api(`/api/work-sessions/${sid}/context/reset`, "POST");
  const t2 = await turn(sid, "다음 분기 홍보 계획의 핵심 방향을 제안해줘");
  const leaked = textOf(t2).includes("감사 지적");
  record("L-06", t2.status === 201 && !leaked, { leaked, ms: t2.ms });
}

// ── 정리: 이번 실행이 만든 일정 삭제 ──
for (const id of createdScheduleIds) {
  await api(`/api/schedules/${id}`, "DELETE");
}
console.error(`cleanup: ${createdScheduleIds.length} schedules deleted`);

const summary = { pass: results.filter((r) => r.pass).length, total: results.length };
fs.writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary));
