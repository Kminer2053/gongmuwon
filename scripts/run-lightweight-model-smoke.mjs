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

export function buildLightweightSmokeResultSheet({
  scenarioSet,
  runtimePolicy,
  chatResult,
  evidenceBase = "runtime://lightweight-smoke",
  runtimeEvidence = null,
  chatEvidence = null,
  runId = `lightweight-smoke-${Date.now()}`,
  startedAt = nowIso(),
  completedAt = nowIso(),
} = {}) {
  const runtimeEvaluation = evaluateRuntimePolicySmoke(runtimePolicy);
  const chatEvaluation = evaluateChatSmoke(chatResult);

  return {
    runId,
    tester: "computer-use-assisted-smoke",
    model: scenarioSet.model,
    modelDisplayName: scenarioSet.modelDisplayName,
    startedAt,
    completedAt,
    scenarios: [
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
    ],
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
  return {
    runtimePolicy,
    chatResult: {
      status: turn?.assistant_message?.status,
      provider: turn?.assistant_message?.provider,
      model: turn?.assistant_message?.model,
      text: turn?.assistant_message?.text,
    },
    evidenceBase: `${baseUrl}/api/work-sessions/${session.id}`,
    runtimeEvidence: `${baseUrl}/api/settings`,
    chatEvidence: `${baseUrl}/api/work-sessions/${session.id}/messages`,
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
