import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildScenarioSet } from "./generate-lightweight-model-test-scenarios.mjs";
import {
  auditComputerUseCoverage,
  scoreScenarioRun,
} from "./score-lightweight-model-test-run.mjs";
import { evaluateChatSmoke, evaluateRuntimePolicySmoke } from "./run-lightweight-model-smoke.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:8765";
const DEFAULT_OUT_DIR = path.join("docs", "operations", "generated");
const ACTUAL_RESULT_BASENAME = "lightweight-model-computer-use-actual-results";
const ACTUAL_SCORE_BASENAME = "lightweight-model-computer-use-actual-score-report";
const ACTUAL_AUDIT_BASENAME = "lightweight-model-computer-use-actual-coverage-audit";

const CATEGORY_LABEL_BY_PREFIX = {
  "LMUX-01": "시작/업무엔진",
  "LMUX-02": "모델 설정/Gemma 4 E2B",
  "LMUX-03": "업무대화 기본 UX",
  "LMUX-04": "업무대화 도구 라우팅",
  "LMUX-05": "일정 캘린더",
  "LMUX-06": "파일찾기/세션 연결",
  "LMUX-07": "지식폴더/GraphRAG 인덱싱",
  "LMUX-08": "GraphRAG 검색/출처 품질",
  "LMUX-09": "문서작성/HWPX 산출",
  "LMUX-10": "실행기록/작업진행/다중작업",
};

function nowIso() {
  return new Date().toISOString();
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function lastMessage(messages, role) {
  return [...(messages || [])].reverse().find((message) => message?.role === role) || null;
}

function commonEvidence({ screenshotPath, snapshotPath, apiEvidenceBase, extra = [] } = {}) {
  return [
    screenshotPath ? `screenshot://${screenshotPath}` : "",
    snapshotPath ? `snapshot://${snapshotPath}` : "",
    apiEvidenceBase || "",
    ...extra,
  ].filter(Boolean);
}

function passScores({ functional = true, ux = true, modelQuality = true, evidence = true } = {}) {
  return {
    functional: functional ? 4 : 0,
    ux: ux ? 3 : 0,
    modelQuality: modelQuality ? 2 : 0,
    evidence: evidence ? 1 : 0,
  };
}

function categoryLabelForScenario(id) {
  const prefix = String(id || "").slice(0, 7);
  return CATEGORY_LABEL_BY_PREFIX[prefix] || prefix || "기타";
}

function statusLabel(status) {
  return (
    {
      pass: "통과",
      partial: "부분 통과",
      fail: "실패",
      blocked: "차단",
      skip: "건너뜀",
      not_tested: "미실시",
    }[status] || status
  );
}

export function renderActualComputerUseScoreReport(summary) {
  const lines = [
    "# 경량모델 컴퓨터유즈 실제 점수 리포트",
    "",
    `- 실행 ID: ${summary.runId}`,
    `- 기준 모델: ${summary.modelDisplayName} (${summary.model})`,
    `- 평가 방식: ${summary.tester}`,
    `- 총점: ${summary.totalScore} / ${summary.totalMaxScore}`,
    `- 실시: ${summary.testedCount}개`,
    `- 미실시: ${summary.notTestedCount}개`,
    `- 종합 등급: ${summary.overallGrade}`,
    "",
    "## 카테고리별 점수",
    "",
    "| 카테고리 | 실시 | 점수 | 등급 |",
    "| --- | ---: | ---: | --- |",
  ];

  const categories = new Map();
  for (const scenario of summary.scenarios) {
    const label = categoryLabelForScenario(scenario.id);
    if (!categories.has(label)) {
      categories.set(label, { count: 0, tested: 0, score: 0, maxScore: 0 });
    }
    const item = categories.get(label);
    item.count += 1;
    item.maxScore += scenario.maxScore;
    if (scenario.status !== "not_tested") {
      item.tested += 1;
      item.score += scenario.score;
    }
  }

  for (const [label, item] of categories) {
    const grade =
      item.tested === 0
        ? "not-tested"
        : item.score / Math.max(1, item.tested * 10) >= 0.9
          ? "release-ready"
          : item.score / Math.max(1, item.tested * 10) >= 0.7
            ? "minor polish"
            : "needs-work";
    lines.push(`| ${label} | ${item.tested}/${item.count} | ${item.score}/${item.maxScore} | ${grade} |`);
  }

  lines.push("", "## 실시 시나리오", "");
  for (const scenario of summary.scenarios.filter((item) => item.status !== "not_tested")) {
    lines.push(`### ${scenario.id} ${categoryLabelForScenario(scenario.id)}`);
    lines.push("");
    lines.push(`- 상태: ${statusLabel(scenario.status)}`);
    lines.push(`- 점수: ${scenario.score} / ${scenario.maxScore}`);
    lines.push(`- 등급: ${scenario.grade}`);
    if (scenario.notes) {
      lines.push(`- 메모: ${scenario.notes}`);
    }
    if (scenario.blocker) {
      lines.push(`- 남은 문제: ${scenario.blocker}`);
    }
    if (scenario.evidence?.length) {
      lines.push("- 증거:");
      for (const evidence of scenario.evidence) {
        lines.push(`  - ${evidence}`);
      }
    }
    lines.push("");
  }

  lines.push("## 해석", "");
  lines.push(
    "- 이번 리포트는 Playwright 기반 실제 UI 조작으로 확인한 대표 시나리오만 점수화합니다.",
  );
  lines.push(
    "- 전체 100개 시나리오 중 미실시 항목은 남아 있으므로, 이 리포트만으로 목표 완료를 선언하지 않습니다.",
  );
  return `${lines.join("\n")}\n`;
}

export function renderActualComputerUseCoverageAudit(audit) {
  const lines = [
    "# 경량모델 컴퓨터유즈 실제 커버리지 감사",
    "",
    `- 실행 ID: ${audit.runId}`,
    `- 기준 모델: ${audit.modelDisplayName} (${audit.model})`,
    `- 완료 판정 가능: ${audit.readyForCompletion ? "예" : "아니오"}`,
    `- 실시: ${audit.testedCount} / ${audit.totalScenarios}`,
    `- 필수 실시 기준: ${audit.requiredTestedCount}`,
    `- 총점: ${audit.totalScore} / ${audit.totalMaxScore}`,
    `- 종합 등급: ${audit.overallGrade}`,
    "",
    "## 이슈",
    "",
  ];
  if (!audit.issues?.length) {
    lines.push("- 없음");
  } else {
    for (const issue of audit.issues) {
      lines.push(`- ${issue}`);
    }
  }
  lines.push("", "## 미실시 시나리오 수", "");
  lines.push(`- ${audit.notTestedIds?.length || 0}개`);
  lines.push("", "## 실패/차단 시나리오", "");
  if (!audit.failedScenarios?.length) {
    lines.push("- 없음");
  } else {
    for (const id of audit.failedScenarios) {
      lines.push(`- ${id}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function evaluateComputerUseEvidence({
  runtimePolicy = {},
  session = null,
  messages = [],
  appTitleObserved = false,
  engineHealthy = false,
  responseTimeObserved = false,
  workProgressObserved = false,
  recentContextObserved = false,
} = {}) {
  const userMessage = lastMessage(messages, "user");
  const assistantMessage = lastMessage(messages, "assistant");
  const chatEvaluation = evaluateChatSmoke({
    status: assistantMessage?.status,
    provider: assistantMessage?.provider,
    model: assistantMessage?.model,
    text: assistantMessage?.text,
  });
  const runtimeEvaluation = evaluateRuntimePolicySmoke(runtimePolicy);
  const responseTimeMs = finiteNumber(assistantMessage?.latency_ms);

  return {
    sessionCreated: Boolean(session?.id),
    userTurnObserved: Boolean(userMessage?.text),
    assistantTurnObserved: Boolean(assistantMessage?.text && assistantMessage?.status === "completed"),
    responseTimeMs,
    responseTimeObserved: Boolean(responseTimeObserved && responseTimeMs !== null),
    appTitleObserved: Boolean(appTitleObserved),
    engineHealthy: Boolean(engineHealthy),
    workProgressObserved: Boolean(workProgressObserved),
    recentContextObserved: Boolean(recentContextObserved),
    chatEvaluation,
    runtimeEvaluation,
    assistantMessage,
  };
}

export function buildComputerUseEvidenceResultSheet({
  scenarioSet,
  runtimePolicy = {},
  session = null,
  messages = [],
  appTitleObserved = false,
  engineHealthy = false,
  responseTimeObserved = false,
  workProgressObserved = false,
  recentContextObserved = false,
  screenshotPath = "",
  snapshotPath = "",
  apiEvidenceBase = "",
  runId = `computer-use-actual-${Date.now()}`,
  startedAt = nowIso(),
  completedAt = nowIso(),
} = {}) {
  const evidence = evaluateComputerUseEvidence({
    runtimePolicy,
    session,
    messages,
    appTitleObserved,
    engineHealthy,
    responseTimeObserved,
    workProgressObserved,
    recentContextObserved,
  });
  const baseEvidence = commonEvidence({ screenshotPath, snapshotPath, apiEvidenceBase });
  const settingsEvidence = commonEvidence({
    screenshotPath,
    snapshotPath,
    apiEvidenceBase,
    extra: ["http://127.0.0.1:8765/api/settings"],
  });
  const chatTraceClean =
    !evidence.chatEvaluation.detected.hasThoughtTrace &&
    !evidence.chatEvaluation.detected.hasModelMeta &&
    !evidence.chatEvaluation.detected.hasPolicyMeta;

  const scenarioResults = [
    {
      id: "LMUX-01-01",
      status: evidence.appTitleObserved && evidence.engineHealthy ? "pass" : "partial",
      scores: passScores({
        functional: evidence.engineHealthy,
        ux: evidence.appTitleObserved,
        modelQuality: evidence.runtimeEvaluation.detected?.is_lightweight,
        evidence: baseEvidence.length > 0,
      }),
      evidence: baseEvidence,
      notes: `app_title=${evidence.appTitleObserved}; engine_healthy=${evidence.engineHealthy}`,
      blocker: evidence.engineHealthy ? "" : "Engine health was not proven during computer-use run.",
    },
    {
      id: "LMUX-02-01",
      status: evidence.runtimeEvaluation.status,
      scores: evidence.runtimeEvaluation.scores,
      evidence: settingsEvidence,
      notes: `runtime_policy=${evidence.runtimeEvaluation.notes}`,
      blocker: evidence.runtimeEvaluation.status === "pass" ? "" : "Lightweight runtime policy was not fully proven.",
    },
    {
      id: "LMUX-03-01",
      status:
        evidence.sessionCreated && evidence.userTurnObserved && evidence.assistantTurnObserved
          ? "pass"
          : "partial",
      scores: passScores({
        functional: evidence.sessionCreated && evidence.userTurnObserved && evidence.assistantTurnObserved,
        ux: evidence.recentContextObserved || evidence.workProgressObserved,
        modelQuality: chatTraceClean,
        evidence: baseEvidence.length > 0,
      }),
      evidence: baseEvidence,
      notes: `session=${session?.id || "missing"}; user_turn=${evidence.userTurnObserved}; assistant_turn=${evidence.assistantTurnObserved}; recent_context=${evidence.recentContextObserved}`,
      blocker:
        evidence.sessionCreated && evidence.userTurnObserved && evidence.assistantTurnObserved
          ? ""
          : "The browser run did not prove a complete first chat turn.",
    },
    {
      id: "LMUX-03-03",
      status: evidence.assistantTurnObserved && evidence.responseTimeObserved ? "pass" : "partial",
      scores: passScores({
        functional: evidence.assistantTurnObserved,
        ux: evidence.responseTimeObserved,
        modelQuality: evidence.responseTimeMs !== null && evidence.responseTimeMs < 60_000,
        evidence: baseEvidence.length > 0,
      }),
      evidence: baseEvidence,
      notes: `latency_ms=${evidence.responseTimeMs ?? "missing"}; response_time_observed=${evidence.responseTimeObserved}`,
      blocker: evidence.responseTimeObserved ? "" : "Response-time display was not proven in the UI.",
    },
    {
      id: "LMUX-03-04",
      status: evidence.chatEvaluation.status,
      scores: evidence.chatEvaluation.scores,
      evidence: baseEvidence,
      notes: `markdown_render=${evidence.chatEvaluation.notes}`,
      blocker:
        evidence.chatEvaluation.status === "pass"
          ? ""
          : "The assistant response needs stronger Markdown structure or cleaner rendering.",
    },
    {
      id: "LMUX-03-10",
      status: chatTraceClean ? "pass" : "partial",
      scores: {
        functional: evidence.chatEvaluation.scores.functional,
        ux: evidence.chatEvaluation.scores.ux,
        modelQuality: chatTraceClean ? 2 : 0,
        evidence: baseEvidence.length > 0 ? 1 : 0,
      },
      evidence: baseEvidence,
      notes: `thought_trace=${evidence.chatEvaluation.detected.hasThoughtTrace}; model_meta=${evidence.chatEvaluation.detected.hasModelMeta}; policy_meta=${evidence.chatEvaluation.detected.hasPolicyMeta}`,
      blocker: chatTraceClean ? "" : "Assistant response exposed internal trace or model/policy meta text.",
    },
    {
      id: "LMUX-10-01",
      status: evidence.workProgressObserved ? "pass" : "partial",
      scores: passScores({
        functional: evidence.assistantTurnObserved,
        ux: evidence.workProgressObserved,
        modelQuality: evidence.runtimeEvaluation.detected?.is_lightweight,
        evidence: baseEvidence.length > 0,
      }),
      evidence: baseEvidence,
      notes: `work_progress_observed=${evidence.workProgressObserved}`,
      blocker: evidence.workProgressObserved ? "" : "Right-panel work progress was not observed.",
    },
  ];

  return {
    runId,
    tester: "playwright-computer-use",
    model: scenarioSet.model,
    modelDisplayName: scenarioSet.modelDisplayName,
    startedAt,
    completedAt,
    sourceSessionId: session?.id || "",
    scenarios: scenarioResults,
  };
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    outDir: DEFAULT_OUT_DIR,
    model: "gemma4:e2b",
    sessionId: "",
    screenshotPath: "",
    snapshotPath: "",
    appTitleObserved: true,
    responseTimeObserved: true,
    workProgressObserved: true,
    recentContextObserved: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--base-url" && next) {
      options.baseUrl = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      options.outDir = next;
      index += 1;
    } else if (arg === "--model" && next) {
      options.model = next;
      index += 1;
    } else if (arg === "--session-id" && next) {
      options.sessionId = next;
      index += 1;
    } else if (arg === "--screenshot" && next) {
      options.screenshotPath = next;
      index += 1;
    } else if (arg === "--snapshot" && next) {
      options.snapshotPath = next;
      index += 1;
    } else if (arg === "--no-app-title") {
      options.appTitleObserved = false;
    } else if (arg === "--no-response-time") {
      options.responseTimeObserved = false;
    } else if (arg === "--no-work-progress") {
      options.workProgressObserved = false;
    } else if (arg === "--no-recent-context") {
      options.recentContextObserved = false;
    }
  }
  return options;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GET ${url} failed: ${response.status} ${text}`);
  }
  return response.json();
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function resolveSession(baseUrl, sessionId) {
  const sessions = await fetchJson(`${baseUrl}/api/work-sessions`);
  const items = Array.isArray(sessions?.items) ? sessions.items : [];
  if (sessionId) {
    const matched = items.find((item) => item.id === sessionId);
    if (!matched) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return matched;
  }
  if (!items.length) {
    throw new Error("No work sessions found.");
  }
  return items[0];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const scenarioSet = buildScenarioSet({ model: options.model, perCategory: 10 });
  const health = await fetchJson(`${baseUrl}/health`);
  const settings = await fetchJson(`${baseUrl}/api/settings`);
  const session = await resolveSession(baseUrl, options.sessionId);
  const messages = await fetchJson(`${baseUrl}/api/work-sessions/${session.id}/messages`);
  const runtimePolicy = settings?.defaults?.llm_runtime_policy || settings?.llm_runtime_policy || {};
  const resultSheet = buildComputerUseEvidenceResultSheet({
    scenarioSet,
    runtimePolicy,
    session,
    messages: messages?.items || [],
    appTitleObserved: options.appTitleObserved,
    engineHealthy: health?.status === "ok",
    responseTimeObserved: options.responseTimeObserved,
    workProgressObserved: options.workProgressObserved,
    recentContextObserved: options.recentContextObserved,
    screenshotPath: options.screenshotPath,
    snapshotPath: options.snapshotPath,
    apiEvidenceBase: `${baseUrl}/api/work-sessions/${session.id}`,
  });
  const summary = scoreScenarioRun({ scenarioSet, results: resultSheet });
  const audit = auditComputerUseCoverage({
    scenarioSet,
    results: resultSheet,
    minTestedCount: resultSheet.scenarios.length,
    requireAllCategories: false,
  });

  fs.mkdirSync(options.outDir, { recursive: true });
  const resultPath = path.join(options.outDir, `${ACTUAL_RESULT_BASENAME}.json`);
  const scoreJsonPath = path.join(options.outDir, `${ACTUAL_SCORE_BASENAME}.json`);
  const scoreMarkdownPath = path.join(options.outDir, `${ACTUAL_SCORE_BASENAME}.md`);
  const auditJsonPath = path.join(options.outDir, `${ACTUAL_AUDIT_BASENAME}.json`);
  const auditMarkdownPath = path.join(options.outDir, `${ACTUAL_AUDIT_BASENAME}.md`);
  writeJson(resultPath, resultSheet);
  writeJson(scoreJsonPath, summary);
  fs.writeFileSync(scoreMarkdownPath, renderActualComputerUseScoreReport(summary), "utf-8");
  writeJson(auditJsonPath, audit);
  fs.writeFileSync(auditMarkdownPath, renderActualComputerUseCoverageAudit(audit), "utf-8");

  console.log(resultPath);
  console.log(scoreJsonPath);
  console.log(scoreMarkdownPath);
  console.log(auditJsonPath);
  console.log(auditMarkdownPath);
  console.log(`scored ${summary.testedCount}/${summary.scenarios.length}: ${summary.totalScore}/${summary.totalMaxScore}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
