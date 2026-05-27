import assert from "node:assert/strict";

import { buildScenarioSet } from "./generate-lightweight-model-test-scenarios.mjs";
import {
  buildLightweightSmokeResultSheet,
  evaluateChatSmoke,
  evaluateDocumentSmoke,
  evaluateExecutionLogSmoke,
  evaluateRuntimePolicySmoke,
  evaluateSkillRoutingSmoke,
} from "./run-lightweight-model-smoke.mjs";
import { scoreScenarioRun } from "./score-lightweight-model-test-run.mjs";

const policy = {
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

assert.deepEqual(evaluateRuntimePolicySmoke(policy).scores, {
  functional: 4,
  ux: 3,
  modelQuality: 2,
  evidence: 1,
});

const goodChat = evaluateChatSmoke({
  status: "completed",
  provider: "featherless",
  model: "google/gemma-4-E2B-it",
  text: "안녕하세요.\n\n* 회의 안건 정리\n* 자료 검토\n* 보고서 초안 작성",
});

assert.equal(goodChat.status, "pass");
assert.equal(goodChat.scores.functional, 4);
assert.equal(goodChat.scores.ux, 3);
assert.equal(goodChat.scores.modelQuality, 2);
assert.equal(goodChat.detected.bulletCount, 3);
assert.equal(goodChat.detected.hasModelMeta, false);

const weakChat = evaluateChatSmoke({
  status: "completed",
  provider: "featherless",
  model: "google/gemma-4-E2B-it",
  text: "안녕하세요. Gemma 4입니다.\n\n요청하신 형식에 따라 답변하겠습니다.",
});

assert.equal(weakChat.status, "partial");
assert.ok(weakChat.scores.modelQuality < 2);
assert.equal(weakChat.detected.hasModelMeta, true);
assert.equal(weakChat.detected.bulletCount, 0);

assert.deepEqual(
  evaluateSkillRoutingSmoke({
    status: "completed",
    text: "일정을 등록했습니다. - 제목: AI 전략회의",
    skillActions: ["schedule.create"],
    expectedAction: "schedule.create",
    evidenceLabel: "일정 등록",
  }).scores,
  { functional: 4, ux: 3, modelQuality: 2, evidence: 1 },
);

const documentSmoke = evaluateDocumentSmoke({
  status: "completed",
  text: "HWPX 문서를 생성했습니다.\n- 파일 열기: C:/tmp/report.hwpx\n- 폴더 열기: C:/tmp",
  skillActions: ["document.create"],
  artifactPath: "C:/tmp/report.hwpx",
  markdownPath: "C:/tmp/report.md",
  workJobStatus: "succeeded",
});
assert.equal(documentSmoke.status, "pass");
assert.equal(documentSmoke.scores.functional, 4);
assert.equal(documentSmoke.detected.hasOpenLinks, true);

const executionLogSmoke = evaluateExecutionLogSmoke({
  items: [
    { action: "work_session.turn.completed", status: "success" },
    { action: "documents.generate.applied", status: "success" },
  ],
});
assert.equal(executionLogSmoke.status, "pass");
assert.equal(executionLogSmoke.scores.ux, 3);

const scenarioSet = buildScenarioSet({ model: "gemma4:e2b", perCategory: 10 });
const resultSheet = buildLightweightSmokeResultSheet({
  scenarioSet,
  runtimePolicy: policy,
  chatResult: {
    status: "completed",
    provider: "featherless",
    model: "google/gemma-4-E2B-it",
    text: "안녕하세요.\n\n- 회의 안건 정리\n- 자료 검토\n- 보고서 초안 작성",
  },
  scheduleResult: {
    status: "completed",
    text: "일정을 등록했습니다. - 제목: AI 전략회의",
    skillActions: ["schedule.create"],
  },
  documentResult: {
    status: "completed",
    text: "HWPX 문서를 생성했습니다.\n- 파일 열기: C:/tmp/report.hwpx\n- 폴더 열기: C:/tmp",
    skillActions: ["document.create"],
    artifactPath: "C:/tmp/report.hwpx",
    markdownPath: "C:/tmp/report.md",
    workJobStatus: "succeeded",
  },
  executionLogResult: {
    items: [{ action: "work_session.turn.completed", status: "success" }],
  },
  runtimeEvidence: "runtime://lightweight-smoke/settings",
  chatEvidence: "runtime://lightweight-smoke/messages",
  scheduleEvidence: "runtime://lightweight-smoke/schedule",
  documentEvidence: "runtime://lightweight-smoke/document",
  executionLogEvidence: "runtime://lightweight-smoke/logs",
});

assert.equal(resultSheet.tester, "computer-use-assisted-smoke");
assert.equal(resultSheet.scenarios.length, 7);
assert.deepEqual(
  resultSheet.scenarios.map((item) => item.id),
  ["LMUX-02-01", "LMUX-03-04", "LMUX-03-10", "LMUX-04-01", "LMUX-04-05", "LMUX-09-05", "LMUX-10-01"],
);
assert.ok(resultSheet.scenarios.every((item) => item.status === "pass"));
assert.deepEqual(resultSheet.scenarios[0].evidence, ["runtime://lightweight-smoke/settings"]);
assert.deepEqual(resultSheet.scenarios[1].evidence, ["runtime://lightweight-smoke/messages"]);
assert.deepEqual(resultSheet.scenarios[4].evidence, ["runtime://lightweight-smoke/document"]);

const summary = scoreScenarioRun({ scenarioSet, results: resultSheet });
assert.equal(summary.testedCount, 7);
assert.equal(summary.notTestedCount, 93);
assert.equal(summary.totalScore, 70);
assert.equal(summary.overallGrade, "needs-work");

console.log("lightweight model smoke checks passed");
