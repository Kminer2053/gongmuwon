import assert from "node:assert/strict";

import { buildScenarioSet } from "./generate-lightweight-model-test-scenarios.mjs";
import {
  buildComputerUseEvidenceResultSheet,
  evaluateComputerUseEvidence,
  evaluateFeatureUiSnapshots,
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
  featureSnapshots: {
    calendar: {
      snapshotText: "업무일정 캘린더 월 주 일 오늘",
      snapshotPath: "docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui-snapshot.yml",
      screenshotPath: "docs/operations/generated/lightweight-model-computer-use-evidence/calendar-ui.png",
    },
    fileSearch: {
      snapshotText: "내장 파일찾기 검색 범위 파일명 인덱스 갱신 파일 검색 현재 연결 대상 세션",
      snapshotPath: "docs/operations/generated/lightweight-model-computer-use-evidence/file-search-ui-snapshot.yml",
      screenshotPath: "docs/operations/generated/lightweight-model-computer-use-evidence/file-search-ui.png",
    },
    knowledge: {
      snapshotText: "내 지식폴더 지식 그래프 GraphRAG 설정/상태 색인처리 GraphRAG 검색",
      snapshotPath: "docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-ui-snapshot.yml",
      screenshotPath: "docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-ui.png",
    },
    document: {
      snapshotText: "문서작성 시행문 1페이지 보고서 풀버전 보고서 이메일 바로작성",
      snapshotPath: "docs/operations/generated/lightweight-model-computer-use-evidence/document-ui-snapshot.yml",
      screenshotPath: "docs/operations/generated/lightweight-model-computer-use-evidence/document-ui.png",
    },
  },
});

assert.equal(resultSheet.runId, "computer-use-actual-001");
assert.equal(resultSheet.tester, "playwright-computer-use");
assert.deepEqual(
  resultSheet.scenarios.map((item) => item.id),
  [
    "LMUX-01-01",
    "LMUX-02-01",
    "LMUX-03-01",
    "LMUX-03-03",
    "LMUX-03-04",
    "LMUX-03-10",
    "LMUX-05-01",
    "LMUX-06-01",
    "LMUX-07-02",
    "LMUX-09-02",
    "LMUX-09-04",
    "LMUX-09-05",
    "LMUX-10-01",
  ],
);
assert.ok(resultSheet.scenarios.every((item) => item.evidence.length >= 2));
assert.ok(resultSheet.scenarios.every((item) => item.status === "pass"));

const summary = scoreScenarioRun({ scenarioSet, results: resultSheet });
assert.equal(summary.testedCount, 13);
assert.equal(summary.totalScore, 130);
assert.equal(summary.overallGrade, "needs-work");

const workflowResultSheet = buildComputerUseEvidenceResultSheet({
  scenarioSet,
  runtimePolicy,
  session: {
    id: "session-workflow-001",
    title: "Lightweight functional workflow check",
    status: "open",
  },
  messages: goodMessages,
  appTitleObserved: true,
  engineHealthy: true,
  responseTimeObserved: true,
  workProgressObserved: true,
  recentContextObserved: true,
  screenshotPath: "output/playwright/workflow.png",
  snapshotPath: ".playwright-cli/workflow.yml",
  apiEvidenceBase: "http://127.0.0.1:8765/api/work-sessions/session-workflow-001",
  workflowEvidence: {
    schedule: {
      created: true,
      listed: true,
      deleted: true,
      title: "AI 업무 점검 회의",
      evidence: [
        "http://127.0.0.1:8765/api/schedules",
        "screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/calendar-workflow.png",
      ],
    },
    knowledge: {
      searched: true,
      answered: true,
      sourceDocumentCount: 2,
      sourcePathCount: 2,
      answerText: "AI 추진 방향은 현황 점검, 실행과제 정리, 후속 일정 관리가 핵심입니다.",
      evidence: [
        "http://127.0.0.1:8765/api/knowledge/ask",
        "screenshot://docs/operations/generated/lightweight-model-computer-use-evidence/knowledge-workflow.png",
      ],
    },
    document: {
      routed: true,
      generated: true,
      format: "onePageReport",
      outputPath: "runtime-workspace/documents/final/ai-work-report.hwpx",
      openLink: true,
      evidence: [
        "http://127.0.0.1:8765/api/documents/generate",
        "file://runtime-workspace/documents/final/ai-work-report.hwpx",
      ],
    },
  },
});

const workflowIds = workflowResultSheet.scenarios.map((item) => item.id);
for (const id of [
  "LMUX-04-01",
  "LMUX-04-02",
  "LMUX-04-03",
  "LMUX-04-04",
  "LMUX-04-05",
  "LMUX-05-03",
  "LMUX-05-10",
  "LMUX-08-01",
  "LMUX-08-02",
  "LMUX-08-03",
  "LMUX-08-04",
  "LMUX-09-09",
  "LMUX-09-10",
]) {
  assert.ok(workflowIds.includes(id), `${id} should be scored from workflow evidence`);
  assert.equal(workflowResultSheet.scenarios.find((item) => item.id === id).status, "pass");
}

const featureUi = evaluateFeatureUiSnapshots({
  calendar: { snapshotText: "업무일정 캘린더 월 주 일 오늘", snapshotPath: "calendar.yml" },
  fileSearch: { snapshotText: "내장 파일찾기 검색 범위 파일명 인덱스 갱신 파일 검색", snapshotPath: "file.yml" },
  knowledge: { snapshotText: "내 지식폴더 지식 그래프 GraphRAG 색인처리 GraphRAG 검색", snapshotPath: "knowledge.yml" },
  document: { snapshotText: "문서작성 시행문 1페이지 보고서 풀버전 보고서 이메일", snapshotPath: "document.yml" },
});
assert.deepEqual(
  featureUi.map((item) => item.id),
  ["LMUX-05-01", "LMUX-06-01", "LMUX-07-02", "LMUX-09-02", "LMUX-09-04", "LMUX-09-05"],
);
assert.ok(featureUi.every((item) => item.status === "pass"));

const readableReport = renderActualComputerUseScoreReport(summary);
assert.ok(readableReport.includes("# 경량모델 컴퓨터유즈 실제 점수 리포트"));
assert.ok(readableReport.includes("총점: 130 / 1000"));
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
