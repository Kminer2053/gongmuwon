import assert from "node:assert/strict";

import { buildScenarioSet } from "./generate-lightweight-model-test-scenarios.mjs";
import {
  auditComputerUseCoverage,
  createComputerUseBatchRunPacks,
  createComputerUseRunPack,
  createBlankResultSheet,
  mergeComputerUseResultSheets,
  renderComputerUseBatchIndex,
  renderComputerUseRunPack,
  renderScoreReport,
  scoreScenarioRun,
} from "./score-lightweight-model-test-run.mjs";

const scenarioSet = buildScenarioSet({
  model: "gemma4:e2b",
  perCategory: 1,
});

const blankSheet = createBlankResultSheet(scenarioSet, {
  runId: "manual-computer-use-001",
  tester: "computer-use",
});

assert.equal(blankSheet.runId, "manual-computer-use-001");
assert.equal(blankSheet.tester, "computer-use");
assert.equal(blankSheet.scenarios.length, 10);
assert.equal(blankSheet.scenarios[0].id, "LMUX-01-01");
assert.deepEqual(blankSheet.scenarios[0].scores, {
  functional: null,
  ux: null,
  modelQuality: null,
  evidence: null,
});

const runPack = createComputerUseRunPack(scenarioSet, {
  runId: "computer-use-one-turn-001",
  scenarioLimit: 3,
});

assert.equal(runPack.runId, "computer-use-one-turn-001");
assert.equal(runPack.scenarios.length, 3);
assert.equal(runPack.totalMaxScore, 30);
assert.ok(runPack.oneTurnInstruction.includes("한 턴"));
assert.ok(runPack.oneTurnInstruction.includes("컴퓨터유즈"));
assert.equal(runPack.scenarios[0].id, "LMUX-01-01");
assert.equal(runPack.scenarios[0].scoring.functional.max, 4);
assert.ok(runPack.scenarios[0].checkpoints.length >= 3);

const runPackMarkdown = renderComputerUseRunPack(runPack);
assert.ok(runPackMarkdown.includes("# Gemma 4 E2B 컴퓨터유즈 1턴 실행팩"));
assert.ok(runPackMarkdown.includes("LMUX-01-01"));
assert.ok(runPackMarkdown.includes("점수 입력 규칙"));
assert.ok(runPackMarkdown.includes("functional 0~4"));

const batchPacks = createComputerUseBatchRunPacks(scenarioSet, {
  runIdPrefix: "computer-use-batch",
  by: "category",
});

assert.equal(batchPacks.length, 10);
assert.equal(batchPacks[0].runId, "computer-use-batch-01");
assert.equal(batchPacks[0].totalScenarios, 1);
assert.equal(batchPacks[0].scenarios[0].category, "앱 시작과 업무엔진");
assert.equal(batchPacks[9].runId, "computer-use-batch-10");
assert.equal(batchPacks[9].scenarios[0].category, "실행기록/작업진행/다중작업");

const batchIndexMarkdown = renderComputerUseBatchIndex({
  modelDisplayName: scenarioSet.modelDisplayName,
  model: scenarioSet.model,
  batches: batchPacks,
});
assert.ok(batchIndexMarkdown.includes("# Gemma 4 E2B 컴퓨터유즈 배치 실행 인덱스"));
assert.ok(batchIndexMarkdown.includes("computer-use-batch-01"));
assert.ok(batchIndexMarkdown.includes("앱 시작과 업무엔진"));

const mergedResults = mergeComputerUseResultSheets({
  scenarioSet,
  sheets: [
    {
      runId: "batch-01-result",
      tester: "computer-use",
      scenarios: [
        {
          id: "LMUX-01-01",
          status: "pass",
          scores: { functional: 4, ux: 3, modelQuality: 2, evidence: 1 },
          evidence: ["screenshot://01.png"],
          notes: "첫 배치 성공",
        },
      ],
    },
    {
      runId: "batch-02-result",
      tester: "computer-use",
      scenarios: [
        {
          id: "LMUX-02-01",
          status: "partial",
          scores: { functional: 3, ux: 2, modelQuality: 1, evidence: 1 },
          evidence: ["screenshot://02.png"],
          notes: "두 번째 배치 일부 보완 필요",
        },
      ],
    },
  ],
});

assert.equal(mergedResults.runId, "computer-use-merged");
assert.equal(mergedResults.scenarios.length, 10);
assert.equal(mergedResults.scenarios[0].status, "pass");
assert.equal(mergedResults.scenarios[1].status, "partial");
assert.equal(mergedResults.scenarios[2].status, "not_tested");
assert.equal(mergedResults.sourceRuns.length, 2);

const summary = scoreScenarioRun({
  scenarioSet,
  results: {
    runId: "manual-computer-use-001",
    tester: "computer-use",
    model: "gemma4:e2b",
    scenarios: [
      {
        id: "LMUX-01-01",
        status: "pass",
        scores: { functional: 4, ux: 3, modelQuality: 2, evidence: 1 },
        evidence: ["screenshot://01_engine_green.png"],
        notes: "업무엔진 정상 연결 확인",
      },
      {
        id: "LMUX-02-01",
        status: "partial",
        scores: { functional: 3, ux: 2, modelQuality: 1, evidence: 1 },
        evidence: ["screenshot://02_model_profile.png"],
        notes: "연결은 정상이나 안내 문구 보완 필요",
      },
    ],
  },
});

assert.equal(summary.totalScore, 17);
assert.equal(summary.totalMaxScore, 100);
assert.equal(summary.testedCount, 2);
assert.equal(summary.notTestedCount, 8);
assert.equal(summary.overallGrade, "needs-work");
assert.equal(summary.categories[0].score, 10);
assert.equal(summary.categories[0].grade, "release-ready");
assert.equal(summary.categories[1].score, 7);
assert.equal(summary.categories[1].grade, "minor polish");
assert.equal(summary.scenarios[0].grade, "release-ready");
assert.equal(summary.scenarios[1].grade, "minor polish");
assert.equal(summary.scenarios[2].status, "not_tested");

const report = renderScoreReport(summary);
assert.ok(report.includes("# 경량모델 UX/성능 컴퓨터유즈 점수 리포트"));
assert.ok(report.includes("총점: 17 / 100"));
assert.ok(report.includes("미실시: 8개"));
assert.ok(report.includes("LMUX-01-01"));
assert.ok(report.includes("screenshot://01_engine_green.png"));

const incompleteAudit = auditComputerUseCoverage({
  scenarioSet,
  results: {
    runId: "manual-computer-use-001",
    tester: "computer-use",
    scenarios: [
      {
        id: "LMUX-01-01",
        status: "pass",
        scores: { functional: 4, ux: 3, modelQuality: 2, evidence: 1 },
        evidence: ["screenshot://01_engine_green.png"],
      },
      {
        id: "LMUX-02-01",
        status: "pass",
        scores: { functional: 4, ux: 3, modelQuality: 2, evidence: 1 },
        evidence: [],
      },
    ],
  },
});

assert.equal(incompleteAudit.readyForCompletion, false);
assert.equal(incompleteAudit.totalScenarios, 10);
assert.equal(incompleteAudit.testedCount, 2);
assert.equal(incompleteAudit.notTestedCount, 8);
assert.equal(incompleteAudit.categoriesCovered, 2);
assert.equal(incompleteAudit.categoriesMissing, 8);
assert.deepEqual(incompleteAudit.scenariosMissingEvidence, ["LMUX-02-01"]);
assert.ok(incompleteAudit.issues.some((issue) => issue.includes("미실시")));
assert.ok(incompleteAudit.issues.some((issue) => issue.includes("증거")));

assert.throws(
  () =>
    scoreScenarioRun({
      scenarioSet,
      results: {
        scenarios: [
          {
            id: "LMUX-01-01",
            scores: { functional: 5, ux: 3, modelQuality: 2, evidence: 1 },
          },
        ],
      },
    }),
  /functional must be between 0 and 4/,
);

console.log("lightweight model scoring checks passed");
