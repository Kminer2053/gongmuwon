import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const DEFAULT_BASE_URL = "http://127.0.0.1:8765";
const DEFAULT_OUT_DIR = path.join("docs", "operations", "generated");
const OUTPUT_BASENAME = "lightweight-model-ux-quality-measurement";

export const ROUTING_PROBE_CASES = [
  {
    id: "route-schedule-create-01",
    text: "내일 오후 2시에 AI 점검 회의 일정 등록해줘",
    expectedRoute: "tool",
    expectedActions: ["schedule.create"],
  },
  {
    id: "route-schedule-create-02",
    text: "오늘 16시에 부서 검토 미팅 캘린더에 넣어줘",
    expectedRoute: "tool",
    expectedActions: ["schedule.create"],
  },
  {
    id: "route-schedule-create-03",
    text: "2026-05-28 14:00 자료검토 회의 잡아줘",
    expectedRoute: "tool",
    expectedActions: ["schedule.create"],
  },
  {
    id: "route-schedule-list-01",
    text: "오늘 일정 보여줘",
    expectedRoute: "tool",
    expectedActions: ["schedule.list"],
  },
  {
    id: "route-schedule-list-02",
    text: "등록된 일정 확인해줘",
    expectedRoute: "tool",
    expectedActions: ["schedule.list"],
  },
  {
    id: "route-schedule-list-03",
    text: "이번 주 calendar view 보여줘",
    expectedRoute: "tool",
    expectedActions: ["schedule.list"],
  },
  {
    id: "route-schedule-delete-01",
    text: "AI 점검 회의 일정 삭제해줘",
    expectedRoute: "tool",
    expectedActions: ["schedule.delete"],
  },
  {
    id: "route-schedule-delete-02",
    text: "오늘 잡힌 검토 일정 취소해줘",
    expectedRoute: "tool",
    expectedActions: ["schedule.delete"],
  },
  {
    id: "route-knowledge-01",
    text: "지식폴더에서 AI 추진 방향 근거 찾아줘",
    expectedRoute: "tool",
    expectedActions: ["knowledge.search"],
  },
  {
    id: "route-knowledge-02",
    text: "GraphRAG로 예산 관련 출처 보여줘",
    expectedRoute: "tool",
    expectedActions: ["knowledge.search"],
  },
  {
    id: "route-knowledge-03",
    text: "내 자료에서 프롬프트 관련 문서 찾아줘",
    expectedRoute: "tool",
    expectedActions: ["knowledge.search"],
  },
  {
    id: "route-document-01",
    text: "이 세션 내용으로 1페이지 보고서 hwpx 만들어줘",
    expectedRoute: "tool",
    expectedActions: ["documents.generate"],
  },
  {
    id: "route-document-02",
    text: "첨부자료 기반으로 시행문 작성해줘",
    expectedRoute: "tool",
    expectedActions: ["documents.generate"],
  },
  {
    id: "route-document-03",
    text: "회의 결과를 이메일 문안으로 정리해줘",
    expectedRoute: "tool",
    expectedActions: ["documents.generate"],
  },
  {
    id: "route-help-01",
    text: "파일찾기 사용법 알려줘",
    expectedRoute: "tool",
    expectedActions: ["help.guide"],
  },
  {
    id: "route-help-02",
    text: "업무대화 기능 어떻게 써?",
    expectedRoute: "tool",
    expectedActions: ["help.guide"],
  },
  {
    id: "route-help-03",
    text: "지식폴더 GraphRAG 사용법 안내해줘",
    expectedRoute: "tool",
    expectedActions: ["help.guide"],
  },
  {
    id: "route-multi-01",
    text: "내일 오후 2시 회의 일정 등록하고 지식폴더에서 AI 자료 찾아줘",
    expectedRoute: "multi_intent",
    expectedActions: ["intent.plan", "schedule.create", "knowledge.search"],
  },
  {
    id: "route-multi-02",
    text: "AI 자료 근거 찾아서 1페이지 보고서로 만들어줘",
    expectedRoute: "multi_intent",
    expectedActions: ["intent.plan", "knowledge.search", "documents.generate"],
  },
  {
    id: "route-multi-03",
    text: "오늘 일정 확인하고 회의자료도 지식폴더에서 찾아줘",
    expectedRoute: "multi_intent",
    expectedActions: ["intent.plan", "schedule.list", "knowledge.search"],
  },
  {
    id: "route-general-01",
    text: "오늘은 가볍게 안부부터 이야기하자",
    expectedRoute: "llm.chat",
    expectedActions: [],
  },
  {
    id: "route-general-02",
    text: "점심 뭐 먹으면 좋을까?",
    expectedRoute: "llm.chat",
    expectedActions: [],
  },
  {
    id: "route-general-03",
    text: "한국어로 간단히 인사해줘",
    expectedRoute: "llm.chat",
    expectedActions: [],
  },
  {
    id: "route-document-04",
    text: "공문 형태의 hwp 파일로 만들어줘",
    expectedRoute: "tool",
    expectedActions: ["documents.generate"],
  },
  {
    id: "route-knowledge-04",
    text: "출처 있는 자료를 찾아서 알려줘",
    expectedRoute: "tool",
    expectedActions: ["knowledge.search"],
  },
  {
    id: "route-schedule-list-04",
    text: "schedule list를 확인해줘",
    expectedRoute: "tool",
    expectedActions: ["schedule.list"],
  },
  {
    id: "route-schedule-delete-03",
    text: "calendar에서 검토 미팅 remove 해줘",
    expectedRoute: "tool",
    expectedActions: ["schedule.delete"],
  },
  {
    id: "route-help-04",
    text: "문서작성 guide 보여줘",
    expectedRoute: "tool",
    expectedActions: ["help.guide"],
  },
  {
    id: "route-general-04",
    text: "이 문장을 더 자연스럽게 다듬어줘",
    expectedRoute: "llm.chat",
    expectedActions: [],
  },
  {
    id: "route-multi-04",
    text: "오늘 일정 조회하고 그 결과를 이메일로 정리해줘",
    expectedRoute: "multi_intent",
    expectedActions: ["intent.plan", "schedule.list", "documents.generate"],
  },
];

const LATENCY_PROBES = [
  { label: "health", method: "GET", path: "/health", thresholdMs: 500, samples: 5 },
  { label: "ready", method: "GET", path: "/ready", thresholdMs: 800, samples: 5 },
  { label: "runtime-metrics", method: "GET", path: "/api/runtime/metrics", thresholdMs: 800, samples: 5 },
  { label: "settings", method: "GET", path: "/api/settings", thresholdMs: 1000, samples: 5 },
  { label: "work-sessions", method: "GET", path: "/api/work-sessions", thresholdMs: 1000, samples: 5 },
  { label: "schedules", method: "GET", path: "/api/schedules", thresholdMs: 1000, samples: 5 },
  {
    label: "file-search-empty",
    method: "GET",
    path: "/api/files/search?query=__gongmu_latency_probe__&limit=5",
    thresholdMs: 1500,
    samples: 3,
  },
];

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function gradeFromRate(rate) {
  if (rate >= 0.95) {
    return "release-ready";
  }
  if (rate >= 0.85) {
    return "minor-polish";
  }
  if (rate >= 0.7) {
    return "usable";
  }
  return "needs-work";
}

function p95(samplesMs) {
  const samples = [...samplesMs].filter(Number.isFinite).sort((a, b) => a - b);
  if (!samples.length) {
    return null;
  }
  return samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)];
}

function average(samplesMs) {
  const samples = samplesMs.filter(Number.isFinite);
  if (!samples.length) {
    return null;
  }
  return Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
}

export function scoreLatencyProbeResults(probes) {
  const items = probes.map((probe) => {
    const p95Ms = p95(probe.samplesMs || []);
    const avgMs = average(probe.samplesMs || []);
    const status = p95Ms !== null && p95Ms <= probe.thresholdMs ? "pass" : "fail";
    return {
      label: probe.label,
      thresholdMs: probe.thresholdMs,
      samplesMs: probe.samplesMs || [],
      avgMs,
      p95Ms,
      status,
      error: probe.error || "",
    };
  });
  const passed = items.filter((item) => item.status === "pass").length;
  const total = items.length;
  const passRate = total > 0 ? round4(passed / total) : 0;
  return {
    total,
    passed,
    failed: total - passed,
    passRate,
    score: Math.round(passRate * 1000),
    grade: gradeFromRate(passRate),
    items,
  };
}

function routingCasePassed(caseResult) {
  const expectedActions = caseResult.expectedActions || [];
  const actualActions = caseResult.actualActions || [];
  const actionPass =
    expectedActions.length === 0
      ? actualActions.length === 0
      : expectedActions.every((action) => actualActions.includes(action));
  return caseResult.expectedRoute === caseResult.actualRoute && actionPass;
}

export function scoreRoutingProbeResults(cases) {
  const items = cases.map((caseResult) => {
    const passed = routingCasePassed(caseResult);
    const expectedActions = caseResult.expectedActions || [];
    const actualActions = caseResult.actualActions || [];
    const actionHits =
      expectedActions.length === 0
        ? actualActions.length === 0
          ? 1
          : 0
        : expectedActions.filter((action) => actualActions.includes(action)).length /
          expectedActions.length;
    return {
      ...caseResult,
      status: passed ? "pass" : "fail",
      actionHitRate: round4(actionHits),
    };
  });
  const total = items.length;
  const passed = items.filter((item) => item.status === "pass").length;
  const successRate = total > 0 ? round4(passed / total) : 0;
  const actionHitRate =
    total > 0 ? round4(items.reduce((sum, item) => sum + item.actionHitRate, 0) / total) : 0;
  return {
    total,
    passed,
    failed: total - passed,
    successRate,
    actionHitRate,
    score: Math.round(((successRate * 0.7 + actionHitRate * 0.3) || 0) * 1000),
    grade: gradeFromRate(successRate),
    failedCases: items.filter((item) => item.status === "fail"),
    items,
  };
}

export function buildQualityMeasurementReport({ runId, model, baseUrl, latency, routing }) {
  const latencyScore = latency.score || 0;
  const routingScore = routing.score || 0;
  const overallScore = Math.round((latencyScore + routingScore) / 2);
  const overallRate = overallScore / 1000;
  const overallGrade = gradeFromRate(overallRate);
  const generatedAt = new Date().toISOString();
  const markdown = renderQualityMeasurementMarkdown({
    runId,
    generatedAt,
    model,
    baseUrl,
    latency,
    routing,
    overallScore,
    overallGrade,
  });
  return {
    runId,
    generatedAt,
    model,
    baseUrl,
    maxScore: 1000,
    overallScore,
    overallGrade,
    latency,
    routing,
    markdown,
  };
}

function renderQualityMeasurementMarkdown({
  runId,
  generatedAt,
  model,
  baseUrl,
  latency,
  routing,
  overallScore,
  overallGrade,
}) {
  const lines = [
    "# 경량모델 UX 품질 측정 결과",
    "",
    `- 실행 ID: ${runId}`,
    `- 생성 시각: ${generatedAt}`,
    `- 기준 모델: ${model}`,
    `- 측정 대상: ${baseUrl}`,
    `- 종합 점수: ${overallScore} / 1000`,
    `- 종합 등급: ${overallGrade}`,
    "",
    "## 반응속도 점수",
    "",
    `- 통과율: ${(latency.passRate * 100).toFixed(1)}% (${latency.passed}/${latency.total})`,
    `- 점수: ${latency.score} / 1000`,
    `- 등급: ${latency.grade}`,
    "",
    "| 측정 항목 | 기준 | 평균 | p95 | 상태 |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  for (const item of latency.items) {
    lines.push(
      `| ${item.label} | ${item.thresholdMs}ms | ${item.avgMs ?? "-"}ms | ${item.p95Ms ?? "-"}ms | ${item.status} |`,
    );
  }

  lines.push(
    "",
    "## 라우팅 동작확률",
    "",
    `- 성공률: ${(routing.successRate * 100).toFixed(1)}% (${routing.passed}/${routing.total})`,
    `- 액션 적중률: ${(routing.actionHitRate * 100).toFixed(1)}%`,
    `- 점수: ${routing.score} / 1000`,
    `- 등급: ${routing.grade}`,
    "",
    "| 케이스 | 기대 경로 | 실제 경로 | 기대 액션 | 실제 액션 | 지연 | 상태 |",
    "| --- | --- | --- | --- | --- | ---: | --- |",
  );
  for (const item of routing.items) {
    lines.push(
      `| ${item.id} | ${item.expectedRoute} | ${item.actualRoute} | ${(item.expectedActions || []).join(", ") || "-"} | ${(item.actualActions || []).join(", ") || "-"} | ${item.latencyMs ?? "-"}ms | ${item.status} |`,
    );
  }

  lines.push("", "## 실패 케이스", "");
  if (!routing.failedCases.length && latency.failed === 0) {
    lines.push("- 없음");
  } else {
    for (const item of latency.items.filter((probe) => probe.status === "fail")) {
      lines.push(`- 반응속도: ${item.label} p95=${item.p95Ms ?? "측정 실패"}ms, 기준=${item.thresholdMs}ms`);
    }
    for (const item of routing.failedCases) {
      lines.push(
        `- 라우팅: ${item.id} "${item.text}" 기대=${item.expectedRoute}/${(item.expectedActions || []).join(", ")} 실제=${item.actualRoute}/${(item.actualActions || []).join(", ")}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    outDir: DEFAULT_OUT_DIR,
    model: "gemma4:e2b",
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
    }
  }
  return options;
}

async function timedFetchJson(url, options = {}) {
  const started = performance.now();
  const response = await fetch(url, options);
  const text = await response.text();
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed: ${response.status} ${text}`);
  }
  return {
    latencyMs,
    data: text ? JSON.parse(text) : null,
  };
}

async function measureLatency(baseUrl) {
  const probes = [];
  for (const probe of LATENCY_PROBES) {
    const samplesMs = [];
    let error = "";
    for (let index = 0; index < probe.samples; index += 1) {
      try {
        const { latencyMs } = await timedFetchJson(`${baseUrl}${probe.path}`, { method: probe.method });
        samplesMs.push(latencyMs);
      } catch (exc) {
        error = String(exc?.message || exc);
        break;
      }
    }
    probes.push({
      label: probe.label,
      thresholdMs: probe.thresholdMs,
      samplesMs,
      error,
    });
  }
  return scoreLatencyProbeResults(probes);
}

async function measureRouting(baseUrl) {
  const cases = [];
  for (const probe of ROUTING_PROBE_CASES) {
    try {
      const { latencyMs, data } = await timedFetchJson(`${baseUrl}/api/work-sessions/routing-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: probe.text }),
      });
      cases.push({
        ...probe,
        actualRoute: data?.route || "",
        actualActions: Array.isArray(data?.actions) ? data.actions : [],
        latencyMs,
      });
    } catch (exc) {
      cases.push({
        ...probe,
        actualRoute: "error",
        actualActions: [],
        latencyMs: null,
        error: String(exc?.message || exc),
      });
    }
  }
  return scoreRoutingProbeResults(cases);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const runId = `lightweight-ux-quality-${Date.now()}`;
  const latency = await measureLatency(baseUrl);
  const routing = await measureRouting(baseUrl);
  const report = buildQualityMeasurementReport({
    runId,
    model: options.model,
    baseUrl,
    latency,
    routing,
  });
  fs.mkdirSync(options.outDir, { recursive: true });
  const jsonPath = path.join(options.outDir, `${OUTPUT_BASENAME}.json`);
  const markdownPath = path.join(options.outDir, `${OUTPUT_BASENAME}.md`);
  writeJson(jsonPath, { ...report, markdown: undefined });
  fs.writeFileSync(markdownPath, report.markdown, "utf-8");
  console.log(jsonPath);
  console.log(markdownPath);
  console.log(`overall ${report.overallScore}/1000 ${report.overallGrade}`);
  console.log(`latency ${(latency.passRate * 100).toFixed(1)}%, routing ${(routing.successRate * 100).toFixed(1)}%`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
