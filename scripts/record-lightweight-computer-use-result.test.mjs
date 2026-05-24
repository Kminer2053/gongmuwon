import assert from "node:assert/strict";

import { buildScenarioSet } from "./generate-lightweight-model-test-scenarios.mjs";
import {
  buildComputerUseEvidenceResultSheet,
  evaluateComputerUseEvidence,
  renderActualComputerUseCoverageAudit,
  renderActualComputerUseScoreReport,
} from "./record-lightweight-computer-use-result.mjs";
import { auditComputerUseCoverage, scoreScenarioRun } from "./score-lightweight-model-test-run.mjs";

const scenarioSet = buildScenarioSet({ model: "gemma4:e2b", perCategory: 10 });

const runtimePolicy = {
  provider: "featherless",
  model: "google/gemma-4-E2B-it",
  model_family: "gemma4",
  is_lightweight: true,
  is_gemma4: true,
  is_gemma4_e2b: true,
  recommended_reasoning_effort: "low",
  streaming_required: true,
  generate_fallback_enabled: false,
};

const goodMessages = [
  {
    role: "user",
    text: "Summarize this week's AI work preparation in three bullets.",
    status: "completed",
  },
  {
    role: "assistant",
    text: [
      "This week's AI work preparation:",
      "",
      "* Set the clear goal for this week's core work.",
      "* Collect missing files and context before drafting.",
      "* Confirm the final report format before writing.",
    ].join("\n"),
    status: "completed",
    provider: "featherless",
    model: "google/gemma-4-E2B-it",
    latency_ms: 8723,
  },
];

const evidence = evaluateComputerUseEvidence({
  scenarioSet,
  runtimePolicy,
  session: {
    id: "session-001",
    title: "Lightweight computer-use check",
    status: "open",
  },
  messages: goodMessages,
  appTitleObserved: true,
  engineHealthy: true,
  responseTimeObserved: true,
  workProgressObserved: true,
  recentContextObserved: true,
  screenshotPath: "output/playwright/gongmu-lightweight-ui-evidence.png",
  snapshotPath: ".playwright-cli/page-example.yml",
  apiEvidenceBase: "http://127.0.0.1:8765/api/work-sessions/session-001",
});

assert.equal(evidence.sessionCreated, true);
assert.equal(evidence.userTurnObserved, true);
assert.equal(evidence.assistantTurnObserved, true);
assert.equal(evidence.chatEvaluation.status, "pass");
assert.equal(evidence.runtimeEvaluation.status, "pass");
assert.equal(evidence.responseTimeMs, 8723);

const resultSheet = buildComputerUseEvidenceResultSheet({
  scenarioSet,
  runtimePolicy,
  session: {
    id: "session-001",
    title: "Lightweight computer-use check",
    status: "open",
  },
  messages: goodMessages,
  appTitleObserved: true,
  engineHealthy: true,
  responseTimeObserved: true,
  workProgressObserved: true,
  recentContextObserved: true,
  screenshotPath: "output/playwright/gongmu-lightweight-ui-evidence.png",
  snapshotPath: ".playwright-cli/page-example.yml",
  apiEvidenceBase: "http://127.0.0.1:8765/api/work-sessions/session-001",
  runId: "computer-use-actual-001",
});

assert.equal(resultSheet.runId, "computer-use-actual-001");
assert.equal(resultSheet.tester, "playwright-computer-use");
assert.deepEqual(
  resultSheet.scenarios.map((item) => item.id),
  ["LMUX-01-01", "LMUX-02-01", "LMUX-03-01", "LMUX-03-03", "LMUX-03-04", "LMUX-03-10", "LMUX-10-01"],
);
assert.ok(resultSheet.scenarios.every((item) => item.evidence.length >= 2));
assert.ok(resultSheet.scenarios.every((item) => item.status === "pass"));

const summary = scoreScenarioRun({ scenarioSet, results: resultSheet });
assert.equal(summary.testedCount, 7);
assert.equal(summary.totalScore, 70);
assert.equal(summary.overallGrade, "needs-work");

const readableReport = renderActualComputerUseScoreReport(summary);
assert.ok(readableReport.includes("# 경량모델 컴퓨터유즈 실제 점수 리포트"));
assert.ok(readableReport.includes("총점: 70 / 1000"));
assert.ok(readableReport.includes("LMUX-03-04"));
assert.ok(!readableReport.includes("寃쎈웾"));

const readableAudit = renderActualComputerUseCoverageAudit(
  auditComputerUseCoverage({
    scenarioSet,
    results: resultSheet,
    minTestedCount: resultSheet.scenarios.length,
    requireAllCategories: false,
  }),
);
assert.ok(readableAudit.includes("# 경량모델 컴퓨터유즈 실제 커버리지 감사"));
assert.ok(readableAudit.includes("완료 판정 가능"));
assert.ok(!readableAudit.includes("誘몄떎"));

const traceResultSheet = buildComputerUseEvidenceResultSheet({
  scenarioSet,
  runtimePolicy,
  session: { id: "session-002", title: "Trace leak check", status: "open" },
  messages: [
    { role: "user", text: "Keep it short.", status: "completed" },
    {
      role: "assistant",
      text: "User says: keep it short.\nFinal decision: answer briefly.\n\n* Done",
      status: "completed",
      provider: "featherless",
      model: "google/gemma-4-E2B-it",
      latency_ms: 1100,
    },
  ],
  appTitleObserved: true,
  engineHealthy: true,
  responseTimeObserved: true,
  workProgressObserved: true,
  recentContextObserved: true,
  screenshotPath: "output/playwright/trace.png",
  snapshotPath: ".playwright-cli/trace.yml",
  apiEvidenceBase: "http://127.0.0.1:8765/api/work-sessions/session-002",
});

const traceScenario = traceResultSheet.scenarios.find((item) => item.id === "LMUX-03-10");
assert.equal(traceScenario.status, "partial");
assert.equal(traceScenario.scores.modelQuality, 0);
assert.match(traceScenario.blocker, /trace/i);

console.log("lightweight computer-use evidence recorder checks passed");
