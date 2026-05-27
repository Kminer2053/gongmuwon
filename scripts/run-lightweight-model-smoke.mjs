import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildScenarioSet } from "./generate-lightweight-model-test-scenarios.mjs";
import { renderScoreReport, scoreScenarioRun } from "./score-lightweight-model-test-run.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:8765";
const DEFAULT_OUT_DIR = path.join("docs", "operations", "generated");
const RESULT_BASENAME = "lightweight-model-smoke-results";
const SCORE_BASENAME = "lightweight-model-smoke-score-report";

function nowIso() {
  return new Date().toISOString();
}

function scoreFromBoolean(condition, maxScore) {
  return condition ? maxScore : 0;
}

function hasAny(text, markers) {
  const source = String(text || "").toLowerCase();
  return markers.some((marker) => source.includes(marker.toLowerCase()));
}

function countMarkdownBullets(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => /^[-*+]\s+/.test(line.trim())).length;
}

function normalizeRuntimePolicy(rawPolicy) {
  const policy = rawPolicy || {};
  return {
    provider: policy.provider || "",
    model: policy.model || "",
    model_family: policy.model_family || policy.modelFamily || "",
    is_lightweight: Boolean(policy.is_lightweight ?? policy.isLightweight),
    is_gemma4: Boolean(policy.is_gemma4 ?? policy.isGemma4),
    is_gemma4_e2b: Boolean(policy.is_gemma4_e2b ?? policy.isGemma4E2b),
    recommended_reasoning_effort:
      policy.recommended_reasoning_effort || policy.recommendedReasoningEffort || "",
    streaming_required: Boolean(policy.streaming_required ?? policy.streamingRequired),
    generate_fallback_enabled: Boolean(
      policy.generate_fallback_enabled ?? policy.generateFallbackEnabled,
    ),
  };
}

export function evaluateRuntimePolicySmoke(rawPolicy) {
  const policy = normalizeRuntimePolicy(rawPolicy);
  const isGemmaE2b = policy.is_gemma4 && policy.is_gemma4_e2b && policy.is_lightweight;
  const hasLowReasoning = policy.recommended_reasoning_effort === "low";
  const hasSafeFallbackPolicy = policy.generate_fallback_enabled === false;
  const hasStreamingPolicy = policy.streaming_required === true;
  const score = {
    functional: scoreFromBoolean(isGemmaE2b, 4),
    ux: scoreFromBoolean(hasLowReasoning && hasStreamingPolicy, 3),
    modelQuality: scoreFromBoolean(hasSafeFallbackPolicy, 2),
    evidence: 1,
  };

  return {
    status: score.functional === 4 && score.ux === 3 && score.modelQuality === 2 ? "pass" : "partial",
    scores: score,
    detected: policy,
    notes: [
      `provider=${policy.provider || "unknown"}`,
      `model=${policy.model || "unknown"}`,
      `lightweight=${policy.is_lightweight}`,
      `gemma4_e2b=${policy.is_gemma4_e2b}`,
      `reasoning=${policy.recommended_reasoning_effort || "unknown"}`,
    ].join("; "),
  };
}

export function evaluateChatSmoke(chatResult) {
  const text = String(chatResult?.text || "");
  const bulletCount = countMarkdownBullets(text);
  const hasModelMeta = hasAny(text, ["Gemma 4", "Gemma4", "저는 gemma", "모델로서"]);
  const hasPolicyMeta = hasAny(text, [
    "안전 정책",
    "시스템 지침",
    "내부 체크리스트",
    "모델 이름",
    "policy:",
    "system prompt",
  ]);
  const hasThoughtTrace = hasAny(text, [
    "<think>",
    "<reasoning>",
    "<|channel>thought",
    "user says:",
    "final decision",
  ]);
  const completed = chatResult?.status === "completed" && text.trim().length > 0;
  const structured = bulletCount >= 3;
  const clean = !hasModelMeta && !hasPolicyMeta && !hasThoughtTrace;

  return {
    status: completed && structured && clean ? "pass" : completed ? "partial" : "fail",
    scores: {
      functional: completed ? 4 : 0,
      ux: structured ? 3 : completed ? 1 : 0,
      modelQuality: clean ? 2 : 0,
      evidence: 1,
    },
    detected: {
      provider: chatResult?.provider || "",
      model: chatResult?.model || "",
      bulletCount,
      hasModelMeta,
      hasPolicyMeta,
      hasThoughtTrace,
      responseLength: text.length,
    },
    notes: [
      `provider=${chatResult?.provider || "unknown"}`,
      `model=${chatResult?.model || "unknown"}`,
      `bullet_count=${bulletCount}`,
      `model_meta=${hasModelMeta}`,
      `policy_meta=${hasPolicyMeta}`,
      `thought_trace=${hasThoughtTrace}`,
    ].join("; "),
  };
}

export function evaluateSkillRoutingSmoke({
  status,
  text,
  skillActions = [],
  expectedAction,
  evidenceLabel = "도구 실행",
} = {}) {
  const responseText = String(text || "");
  const completed = status === "completed" && responseText.trim().length > 0;
  const usedExpectedAction = Array.isArray(skillActions) && skillActions.includes(expectedAction);
  const hasActionFeedback = hasAny(responseText, [evidenceLabel, "등록했습니다", "생성했습니다", "완료"]);
  const hasGenericRefusal = hasAny(responseText, ["할 수 없습니다", "기능이 없습니다", "직접 수행할 수 없습니다"]);
  return {
    status: completed && usedExpectedAction && !hasGenericRefusal ? "pass" : completed ? "partial" : "fail",
    scores: {
      functional: completed && usedExpectedAction ? 4 : completed ? 2 : 0,
      ux: hasActionFeedback ? 3 : completed ? 1 : 0,
      modelQuality: !hasGenericRefusal && usedExpectedAction ? 2 : 0,
      evidence: 1,
    },
    detected: {
      status,
      expectedAction,
      skillActions,
      hasActionFeedback,
      hasGenericRefusal,
    },
    notes: [
      `expected_action=${expectedAction}`,
      `skill_actions=${Array.isArray(skillActions) ? skillActions.join(",") : ""}`,
      `feedback=${hasActionFeedback}`,
      `generic_refusal=${hasGenericRefusal}`,
    ].join("; "),
  };
}

export function evaluateDocumentSmoke({
  status,
  text,
  skillActions = [],
  artifactPath = "",
  markdownPath = "",
  workJobStatus = "",
} = {}) {
  const base = evaluateSkillRoutingSmoke({
    status,
    text,
    skillActions,
    expectedAction: "document.create",
    evidenceLabel: "HWPX 문서",
  });
  const hasArtifact = String(artifactPath || "").toLowerCase().endsWith(".hwpx");
  const hasMarkdown = String(markdownPath || "").toLowerCase().endsWith(".md");
  const succeeded = workJobStatus === "succeeded";
  const hasOpenLinks = hasAny(text, ["파일 열기:", "폴더 열기:"]);
  const pass = base.status === "pass" && hasArtifact && hasMarkdown && succeeded && hasOpenLinks;
  return {
    status: pass ? "pass" : base.status === "fail" ? "fail" : "partial",
    scores: {
      functional: hasArtifact && succeeded ? 4 : base.scores.functional,
      ux: hasOpenLinks ? 3 : base.scores.ux,
      modelQuality: base.scores.modelQuality,
      evidence: 1,
    },
    detected: {
      ...base.detected,
      artifactPath,
      markdownPath,
      workJobStatus,
      hasArtifact,
      hasMarkdown,
      hasOpenLinks,
    },
    notes: [
      base.notes,
      `artifact=${artifactPath || "missing"}`,
      `markdown=${markdownPath || "missing"}`,
      `work_job=${workJobStatus || "unknown"}`,
      `open_links=${hasOpenLinks}`,
    ].join("; "),
  };
}

export function evaluateExecutionLogSmoke({ items = [] } = {}) {
  const logs = Array.isArray(items) ? items : [];
  const hasLogs = logs.length > 0;
  const hasReadableAction = logs.some((item) => String(item?.action || "").trim().length > 0);
  const hasSuccessfulWork = logs.some((item) =>
    ["success", "succeeded", "completed"].some((marker) =>
      String(item?.status || item?.action || "").toLowerCase().includes(marker),
    ),
  );
  return {
    status: hasLogs && hasReadableAction ? "pass" : hasLogs ? "partial" : "fail",
    scores: {
      functional: hasLogs ? 4 : 0,
      ux: hasReadableAction ? 3 : hasLogs ? 1 : 0,
      modelQuality: hasSuccessfulWork ? 2 : hasLogs ? 1 : 0,
      evidence: 1,
    },
    detected: {
      count: logs.length,
      hasReadableAction,
      hasSuccessfulWork,
    },
    notes: `log_count=${logs.length}; readable_action=${hasReadableAction}; successful_work=${hasSuccessfulWork}`,
  };
}

export function buildLightweightSmokeResultSheet({
  scenarioSet,
  runtimePolicy,
  chatResult,
  scheduleResult = null,
  documentResult = null,
  executionLogResult = null,
  evidenceBase = "runtime://lightweight-smoke",
  runtimeEvidence = null,
  chatEvidence = null,
  scheduleEvidence = null,
  documentEvidence = null,
  executionLogEvidence = null,
  runId = `lightweight-smoke-${Date.now()}`,
  startedAt = nowIso(),
  completedAt = nowIso(),
} = {}) {
  const runtimeEvaluation = evaluateRuntimePolicySmoke(runtimePolicy);
  const chatEvaluation = evaluateChatSmoke(chatResult);
  const scenarioResults = [
    {
      id: "LMUX-02-01",
      status: runtimeEvaluation.status,
      scores: runtimeEvaluation.scores,
      evidence: [runtimeEvidence || `${evidenceBase}/settings`],
      notes: `런타임 정책 감지: ${runtimeEvaluation.notes}`,
      blocker: "",
    },
    {
      id: "LMUX-03-04",
      status: chatEvaluation.status,
      scores: chatEvaluation.scores,
      evidence: [chatEvidence || `${evidenceBase}/messages`],
      notes: `Markdown 목록 스모크: ${chatEvaluation.notes}`,
      blocker: chatEvaluation.status === "pass" ? "" : "목록 구조 또는 경량모델 메타 응답 보완 필요",
    },
    {
      id: "LMUX-03-10",
      status: chatEvaluation.detected.hasThoughtTrace || chatEvaluation.detected.hasModelMeta ? "partial" : "pass",
      scores: {
        functional: chatEvaluation.scores.functional,
        ux: chatEvaluation.scores.ux,
        modelQuality: chatEvaluation.scores.modelQuality,
        evidence: chatEvaluation.scores.evidence,
      },
      evidence: [chatEvidence || `${evidenceBase}/messages`],
      notes: `내부추론/모델 메타 미노출 스모크: ${chatEvaluation.notes}`,
      blocker:
        chatEvaluation.detected.hasThoughtTrace || chatEvaluation.detected.hasModelMeta
          ? "내부추론 또는 모델 자기설명 노출"
          : "",
    },
  ];

  if (scheduleResult) {
    const scheduleEvaluation = evaluateSkillRoutingSmoke({
      ...scheduleResult,
      expectedAction: "schedule.create",
      evidenceLabel: "일정",
    });
    scenarioResults.push({
      id: "LMUX-04-01",
      status: scheduleEvaluation.status,
      scores: scheduleEvaluation.scores,
      evidence: [scheduleEvidence || `${evidenceBase}/schedule`],
      notes: `일정 등록 라우팅 스모크: ${scheduleEvaluation.notes}`,
      blocker: scheduleEvaluation.status === "pass" ? "" : "일정 도구 라우팅 보완 필요",
    });
  }

  if (documentResult) {
    const documentEvaluation = evaluateDocumentSmoke(documentResult);
    const documentScenario = {
      status: documentEvaluation.status,
      scores: documentEvaluation.scores,
      evidence: [documentEvidence || `${evidenceBase}/document`],
      notes: `문서작성/HWPX 스모크: ${documentEvaluation.notes}`,
      blocker: documentEvaluation.status === "pass" ? "" : "문서작성 도구 라우팅 또는 HWPX 산출 보완 필요",
    };
    scenarioResults.push({ id: "LMUX-04-05", ...documentScenario });
    scenarioResults.push({ id: "LMUX-09-05", ...documentScenario });
  }

  if (executionLogResult) {
    const executionLogEvaluation = evaluateExecutionLogSmoke(executionLogResult);
    scenarioResults.push({
      id: "LMUX-10-01",
      status: executionLogEvaluation.status,
      scores: executionLogEvaluation.scores,
      evidence: [executionLogEvidence || `${evidenceBase}/execution-logs`],
      notes: `실행기록 스모크: ${executionLogEvaluation.notes}`,
      blocker: executionLogEvaluation.status === "pass" ? "" : "최근 실행 기록 표시 보완 필요",
    });
  }

  return {
    runId,
    tester: "computer-use-assisted-smoke",
    model: scenarioSet.model,
    modelDisplayName: scenarioSet.modelDisplayName,
    startedAt,
    completedAt,
    scenarios: scenarioResults,
  };
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    outDir: DEFAULT_OUT_DIR,
    model: "gemma4:e2b",
    prompt: "이번 주 AI 업무 추진 준비사항을 세 가지 bullet로 정리해줘.",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") {
      options.baseUrl = argv[++index];
    } else if (item === "--out-dir") {
      options.outDir = argv[++index];
    } else if (item === "--model") {
      options.model = argv[++index];
    } else if (item === "--prompt") {
      options.prompt = argv[++index];
    }
  }
  return options;
}

async function fetchJson(url, { method = "GET", body = null } = {}) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${url} failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function runLiveSmoke(options) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const settings = await fetchJson(`${baseUrl}/api/settings`);
  const runtimePolicy = settings?.defaults?.llm_runtime_policy || {};
  const session = await fetchJson(`${baseUrl}/api/work-sessions`, {
    method: "POST",
    body: { title: "Gemma 4 E2B 경량모델 자동 스모크" },
  });
  const turn = await fetchJson(`${baseUrl}/api/work-sessions/${session.id}/turn`, {
    method: "POST",
    body: { text: options.prompt, reasoning_effort: "low" },
  });
  const scheduleSession = await fetchJson(`${baseUrl}/api/work-sessions`, {
    method: "POST",
    body: { title: "경량모델 일정 라우팅 스모크" },
  });
  const scheduleTurn = await fetchJson(`${baseUrl}/api/work-sessions/${scheduleSession.id}/turn`, {
    method: "POST",
    body: { text: "2026-05-20 15:00 AI 전략회의 일정 등록해줘" },
  });

  fs.mkdirSync(options.outDir, { recursive: true });
  const linkedFilePath = path.resolve(options.outDir, "lightweight-model-smoke-reference.md");
  fs.writeFileSync(
    linkedFilePath,
    "AI 추진 배경과 향후 조치사항을 정리했습니다.\n보안형 로컬 자동화 중심으로 AI 실행계획을 수립하고, 부서별 책임자와 추진기한을 명시해야 합니다.\n",
    "utf-8",
  );
  const documentSession = await fetchJson(`${baseUrl}/api/work-sessions`, {
    method: "POST",
    body: { title: "경량모델 문서작성 스모크" },
  });
  await fetchJson(`${baseUrl}/api/work-sessions/${documentSession.id}/messages`, {
    method: "POST",
    body: { role: "user", text: "AI 추진 배경과 향후 조치사항을 정리했습니다." },
  });
  await fetchJson(`${baseUrl}/api/work-sessions/${documentSession.id}/file-links`, {
    method: "POST",
    body: {
      items: [
        {
          file_path: linkedFilePath,
          label: "AI 실행계획 근거",
          source: "manual",
        },
      ],
    },
  });
  const documentTurn = await fetchJson(`${baseUrl}/api/work-sessions/${documentSession.id}/turn`, {
    method: "POST",
    body: { text: "이 세션 내용으로 1페이지 보고서 HWPX 문서작성 해줘" },
  });
  const documentSkillResult = documentTurn?.context_summary?.skill_results?.[0] || {};
  const executionLogs = await fetchJson(`${baseUrl}/api/execution-logs`);

  return {
    runtimePolicy,
    chatResult: {
      status: turn?.assistant_message?.status,
      provider: turn?.assistant_message?.provider,
      model: turn?.assistant_message?.model,
      text: turn?.assistant_message?.text,
    },
    scheduleResult: {
      status: scheduleTurn?.assistant_message?.status,
      text: scheduleTurn?.assistant_message?.text,
      skillActions: scheduleTurn?.context_summary?.skill_actions || [],
    },
    documentResult: {
      status: documentTurn?.assistant_message?.status,
      text: documentTurn?.assistant_message?.text,
      skillActions: documentTurn?.context_summary?.skill_actions || [],
      artifactPath: documentSkillResult.artifact_path || "",
      markdownPath: documentSkillResult.markdown_path || "",
      workJobStatus: documentSkillResult.work_job_status || "",
    },
    executionLogResult: {
      items: executionLogs?.items || [],
    },
    evidenceBase: `${baseUrl}/api/work-sessions/${session.id}`,
    runtimeEvidence: `${baseUrl}/api/settings`,
    chatEvidence: `${baseUrl}/api/work-sessions/${session.id}/messages`,
    scheduleEvidence: `${baseUrl}/api/work-sessions/${scheduleSession.id}/messages`,
    documentEvidence: `${baseUrl}/api/work-sessions/${documentSession.id}/messages`,
    executionLogEvidence: `${baseUrl}/api/execution-logs`,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenarioSet = buildScenarioSet({ model: options.model, perCategory: 10 });
  const live = await runLiveSmoke(options);
  const results = buildLightweightSmokeResultSheet({
    scenarioSet,
    ...live,
  });
  const summary = scoreScenarioRun({ scenarioSet, results });

  fs.mkdirSync(options.outDir, { recursive: true });
  const resultPath = path.join(options.outDir, `${RESULT_BASENAME}.json`);
  const scoreJsonPath = path.join(options.outDir, `${SCORE_BASENAME}.json`);
  const scoreMarkdownPath = path.join(options.outDir, `${SCORE_BASENAME}.md`);
  fs.writeFileSync(resultPath, `${JSON.stringify(results, null, 2)}\n`, "utf-8");
  fs.writeFileSync(scoreJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  fs.writeFileSync(scoreMarkdownPath, renderScoreReport(summary), "utf-8");
  console.log(resultPath);
  console.log(scoreJsonPath);
  console.log(scoreMarkdownPath);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
