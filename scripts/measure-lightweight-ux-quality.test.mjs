import assert from "node:assert/strict";

import {
  ROUTING_PROBE_CASES,
  buildQualityMeasurementReport,
  scoreLatencyProbeResults,
  scoreRoutingProbeResults,
} from "./measure-lightweight-ux-quality.mjs";

const latency = scoreLatencyProbeResults([
  { label: "health", thresholdMs: 500, samplesMs: [12, 18, 20, 22, 24] },
  { label: "settings", thresholdMs: 1000, samplesMs: [120, 180, 220, 260, 300] },
  { label: "slow-search", thresholdMs: 1500, samplesMs: [900, 1100, 1300, 1700, 1800] },
]);

assert.equal(latency.total, 3);
assert.equal(latency.passed, 2);
assert.equal(latency.passRate, 0.6667);
assert.equal(latency.grade, "needs-work");
assert.equal(latency.items[0].p95Ms, 24);
assert.equal(latency.items[2].status, "fail");

const routing = scoreRoutingProbeResults([
  {
    id: "route-schedule-create",
    text: "내일 오후 2시에 AI 점검 회의 일정 등록해줘",
    expectedActions: ["schedule.create"],
    expectedRoute: "tool",
    actualActions: ["schedule.create"],
    actualRoute: "tool",
    latencyMs: 32,
  },
  {
    id: "route-general-chat",
    text: "오늘은 가볍게 안부부터 이야기하자",
    expectedActions: [],
    expectedRoute: "llm.chat",
    actualActions: [],
    actualRoute: "llm.chat",
    latencyMs: 14,
  },
  {
    id: "route-document",
    text: "회의 결과를 이메일 문안으로 정리해줘",
    expectedActions: ["documents.generate"],
    expectedRoute: "tool",
    actualActions: ["knowledge.search"],
    actualRoute: "tool",
    latencyMs: 21,
  },
]);

assert.equal(routing.total, 3);
assert.equal(routing.passed, 2);
assert.equal(routing.successRate, 0.6667);
assert.equal(routing.actionHitRate, 0.6667);
assert.equal(routing.failedCases.length, 1);
assert.equal(routing.grade, "needs-work");

assert.ok(ROUTING_PROBE_CASES.length >= 25);
assert.ok(ROUTING_PROBE_CASES.some((item) => item.expectedRoute === "multi_intent"));
assert.ok(ROUTING_PROBE_CASES.some((item) => item.expectedRoute === "llm.chat"));

const report = buildQualityMeasurementReport({
  runId: "quality-measurement-test",
  model: "gemma4:e2b",
  baseUrl: "http://127.0.0.1:8765",
  latency,
  routing,
});

assert.equal(report.overallScore, 667);
assert.equal(report.maxScore, 1000);
assert.equal(report.overallGrade, "needs-work");
assert.ok(report.markdown.includes("# 경량모델 UX 품질 측정 결과"));
assert.ok(report.markdown.includes("반응속도 점수"));
assert.ok(report.markdown.includes("라우팅 동작확률"));

console.log("lightweight UX quality measurement checks passed");
