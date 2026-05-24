import assert from "node:assert/strict";

import {
  buildScenarioSet,
  renderScenarioMarkdown,
  scoreScenarioResult,
  summarizeScenarioSet,
} from "./generate-lightweight-model-test-scenarios.mjs";

const scenarioSet = buildScenarioSet({
  model: "gemma4:e2b",
  perCategory: 10,
});

assert.equal(scenarioSet.model, "gemma4:e2b");
assert.equal(scenarioSet.modelDisplayName, "Gemma 4 E2B");
assert.equal(scenarioSet.scenarios.length, 100);
assert.equal(new Set(scenarioSet.scenarios.map((item) => item.category)).size, 10);
assert.ok(scenarioSet.scenarios.every((item) => item.id.match(/^LMUX-\d{2}-\d{2}$/)));
assert.ok(scenarioSet.scenarios.every((item) => item.maxScore === 10));
assert.ok(scenarioSet.scenarios.every((item) => item.scoring.functional.max === 4));
assert.ok(scenarioSet.scenarios.every((item) => item.scoring.ux.max === 3));
assert.ok(scenarioSet.scenarios.every((item) => item.scoring.modelQuality.max === 2));
assert.ok(scenarioSet.scenarios.every((item) => item.scoring.evidence.max === 1));
assert.ok(scenarioSet.scenarios.every((item) => item.computerUse.checkpoints.length >= 3));
assert.ok(scenarioSet.scenarios.every((item) => item.steps.length >= 5));

const ids = new Set(scenarioSet.scenarios.map((item) => item.id));
assert.equal(ids.size, scenarioSet.scenarios.length);

const chatRouting = scenarioSet.scenarios.find((item) => item.id === "LMUX-04-01");
assert.ok(chatRouting);
assert.equal(chatRouting.category, "업무대화 도구 라우팅");
assert.ok(chatRouting.lightweightFocus.includes("정규식 라우팅"));
assert.ok(chatRouting.expected.some((line) => line.includes("도구")));

const markdown = renderScenarioMarkdown(scenarioSet);
assert.ok(markdown.includes("# 경량모델 UX/성능 컴퓨터유즈 테스트 시나리오"));
assert.ok(markdown.includes("Gemma 4 E2B"));
assert.ok(markdown.includes("LMUX-10-10"));
assert.ok(markdown.includes("functional 4점"));

const summary = summarizeScenarioSet(scenarioSet);
assert.equal(summary.totalScenarios, 100);
assert.equal(summary.totalMaxScore, 1000);
assert.equal(summary.categories.length, 10);
assert.ok(summary.categories.every((item) => item.count === 10));

assert.deepEqual(scoreScenarioResult({ functional: 4, ux: 3, modelQuality: 2, evidence: 1 }), {
  score: 10,
  grade: "release-ready",
});
assert.deepEqual(scoreScenarioResult({ functional: 3, ux: 2, modelQuality: 2, evidence: 1 }), {
  score: 8,
  grade: "minor polish",
});
assert.deepEqual(scoreScenarioResult({ functional: 2, ux: 2, modelQuality: 1, evidence: 1 }), {
  score: 6,
  grade: "usable but needs fix",
});
assert.deepEqual(scoreScenarioResult({ functional: 1, ux: 1, modelQuality: 1, evidence: 0 }), {
  score: 3,
  grade: "blocker",
});

console.log("lightweight model scenario generator checks passed");
