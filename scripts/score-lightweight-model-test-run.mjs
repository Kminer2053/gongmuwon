import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scoreScenarioResult } from "./generate-lightweight-model-test-scenarios.mjs";

const DEFAULT_SCENARIO_PATH = path.join(
  "docs",
  "operations",
  "generated",
  "lightweight-model-test-scenarios.json",
);
const DEFAULT_OUT_DIR = path.join("docs", "operations", "generated");
const RESULT_TEMPLATE_BASENAME = "lightweight-model-test-results-template";
const SCORE_REPORT_BASENAME = "lightweight-model-test-score-report";
const RUN_PACK_BASENAME = "lightweight-model-computer-use-run-pack";
const COVERAGE_AUDIT_BASENAME = "lightweight-model-computer-use-coverage-audit";

const SCORE_LIMITS = {
  functional: 4,
  ux: 3,
  modelQuality: 2,
  evidence: 1,
};

function nowIso() {
  return new Date().toISOString();
}

function clampStatus(status) {
  const value = String(status || "").trim();
  if (["pass", "partial", "fail", "blocked", "skip", "not_tested"].includes(value)) {
    return value;
  }
  return "partial";
}

function validateScores(scores, scenarioId) {
  const normalized = {};
  for (const [key, max] of Object.entries(SCORE_LIMITS)) {
    const value = scores?.[key];
    if (!Number.isFinite(value) || value < 0 || value > max) {
      throw new Error(`${scenarioId}: ${key} must be between 0 and ${max}`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function gradeFromRatio(score, maxScore) {
  if (maxScore <= 0) {
    return "not-tested";
  }
  const ratio = score / maxScore;
  if (ratio >= 0.9) {
    return "release-ready";
  }
  if (ratio >= 0.7) {
    return "minor polish";
  }
  if (ratio >= 0.5) {
    return "needs-work";
  }
  return "blocker";
}

function overallGradeFromRun({ testedScore, testedMaxScore, notTestedCount }) {
  if (testedMaxScore <= 0) {
    return "not-tested";
  }
  const testedGrade = gradeFromRatio(testedScore, testedMaxScore);
  if (notTestedCount > 0) {
    return testedGrade === "blocker" ? "blocker" : "needs-work";
  }
  return testedGrade;
}

export function createBlankResultSheet(
  scenarioSet,
  { runId = `computer-use-${Date.now()}`, tester = "computer-use", startedAt = nowIso() } = {},
) {
  return {
    runId,
    tester,
    model: scenarioSet.model,
    modelDisplayName: scenarioSet.modelDisplayName,
    startedAt,
    completedAt: null,
    scoringGuide: {
      functional: "0~4점: 기능이 실제로 동작하는가",
      ux: "0~3점: 진행상태, 오류, 다음 행동이 이해 가능한가",
      modelQuality: "0~2점: 경량모델 답변이 구조화, 출처, 보안, 도구 우선 원칙을 지키는가",
      evidence: "0~1점: 스크린샷, 로그, 산출물 경로 등 검증 증거가 남는가",
    },
    scenarios: scenarioSet.scenarios.map((scenario) => ({
      id: scenario.id,
      category: scenario.category,
      title: scenario.title,
      status: "not_tested",
      scores: {
        functional: null,
        ux: null,
        modelQuality: null,
        evidence: null,
      },
      evidence: [],
      notes: "",
      blocker: "",
    })),
  };
}

export function createComputerUseRunPack(
  scenarioSet,
  { runId = `computer-use-run-${Date.now()}`, scenarioLimit = null, createdAt = nowIso() } = {},
) {
  const selectedScenarios = Number.isFinite(scenarioLimit)
    ? scenarioSet.scenarios.slice(0, Math.max(0, scenarioLimit))
    : scenarioSet.scenarios;
  const scenarios = selectedScenarios.map((scenario) => ({
    id: scenario.id,
    category: scenario.category,
    title: scenario.title,
    priority: scenario.priority,
    lightweightFocus: scenario.lightweightFocus,
    preconditions: scenario.preconditions,
    steps: scenario.steps,
    expected: scenario.expected,
    checkpoints: scenario.computerUse.checkpoints,
    scoring: scenario.scoring,
    resultSlot: {
      status: "not_tested",
      scores: {
        functional: null,
        ux: null,
        modelQuality: null,
        evidence: null,
      },
      evidence: [],
      notes: "",
      blocker: "",
    },
  }));

  return {
    runId,
    createdAt,
    model: scenarioSet.model,
    modelDisplayName: scenarioSet.modelDisplayName,
    totalScenarios: scenarios.length,
    totalMaxScore: scenarios.reduce(
      (sum, scenario) =>
        sum +
        scenario.scoring.functional.max +
        scenario.scoring.ux.max +
        scenario.scoring.modelQuality.max +
        scenario.scoring.evidence.max,
      0,
    ),
    oneTurnInstruction:
      "이 실행팩을 컴퓨터유즈 한 턴의 작업 지시로 사용한다. 각 시나리오를 순서대로 실제 앱에서 조작하고, 증거와 점수를 결과 템플릿에 기록한다.",
    scoringRule:
      "functional 0~4, ux 0~3, modelQuality 0~2, evidence 0~1 기준으로 채점한다.",
    scenarios,
  };
}

export function renderComputerUseRunPack(runPack) {
  const lines = [
    `# ${runPack.modelDisplayName} 컴퓨터유즈 1턴 실행팩`,
    "",
    `- 실행 ID: ${runPack.runId}`,
    `- 모델 기준: ${runPack.modelDisplayName} (${runPack.model})`,
    `- 시나리오 수: ${runPack.totalScenarios}`,
    `- 총점: ${runPack.totalMaxScore}`,
    "",
    "## 실행 지시",
    "",
    runPack.oneTurnInstruction,
    "",
    "## 점수 입력 규칙",
    "",
    "- functional 0~4: 기능이 실제로 동작하는가",
    "- ux 0~3: 진행상태, 오류, 다음 행동이 이해 가능한가",
    "- modelQuality 0~2: 경량모델 답변이 구조화, 출처, 보안, 도구 우선 원칙을 지키는가",
    "- evidence 0~1: 스크린샷, 로그, 산출물 경로 등 검증 증거가 남는가",
    "",
    "## 시나리오",
    "",
  ];

  for (const scenario of runPack.scenarios) {
    lines.push(`### ${scenario.id} ${scenario.title}`);
    lines.push("");
    lines.push(`- 카테고리: ${scenario.category}`);
    lines.push(`- 우선순위: ${scenario.priority}`);
    lines.push(`- 경량모델 초점: ${scenario.lightweightFocus}`);
    lines.push("");
    lines.push("#### 사전조건");
    for (const item of scenario.preconditions) {
      lines.push(`- ${item}`);
    }
    lines.push("");
    lines.push("#### 실시 절차");
    for (const item of scenario.steps) {
      lines.push(`- ${item}`);
    }
    lines.push("");
    lines.push("#### 기대 결과");
    for (const item of scenario.expected) {
      lines.push(`- ${item}`);
    }
    lines.push("");
    lines.push("#### 컴퓨터유즈 체크포인트");
    for (const item of scenario.checkpoints) {
      lines.push(`- ${item}`);
    }
    lines.push("");
    lines.push("#### 결과 기록 슬롯");
    lines.push("- status: pass / partial / fail / blocked / skip");
    lines.push("- scores: functional, ux, modelQuality, evidence");
    lines.push("- evidence: 스크린샷, 로그, 산출물 경로");
    lines.push("- notes/blocker: 사용자경험 메모 또는 블로커");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function scoreScenarioRun({ scenarioSet, results }) {
  const resultById = new Map((results.scenarios || []).map((item) => [item.id, item]));
  const categories = new Map();
  const scenarios = scenarioSet.scenarios.map((scenario) => {
    const result = resultById.get(scenario.id);
    if (!categories.has(scenario.category)) {
      categories.set(scenario.category, {
        category: scenario.category,
        count: 0,
        testedCount: 0,
        score: 0,
        maxScore: 0,
        grade: "not-tested",
      });
    }
    const category = categories.get(scenario.category);
    category.count += 1;
    category.maxScore += scenario.maxScore;

    if (!result || result.status === "not_tested") {
      return {
        id: scenario.id,
        category: scenario.category,
        title: scenario.title,
        status: "not_tested",
        score: 0,
        maxScore: scenario.maxScore,
        grade: "not-tested",
        scores: null,
        evidence: [],
        notes: "",
      };
    }

    const scores = validateScores(result.scores, scenario.id);
    const scored = scoreScenarioResult(scores);
    category.testedCount += 1;
    category.score += scored.score;
    return {
      id: scenario.id,
      category: scenario.category,
      title: scenario.title,
      status: clampStatus(result.status),
      score: scored.score,
      maxScore: scenario.maxScore,
      grade: scored.grade,
      scores,
      evidence: Array.isArray(result.evidence) ? result.evidence : [],
      notes: String(result.notes || ""),
      blocker: String(result.blocker || ""),
    };
  });

  const categorySummaries = Array.from(categories.values()).map((category) => ({
    ...category,
    grade: category.testedCount > 0 ? gradeFromRatio(category.score, category.testedCount * 10) : "not-tested",
  }));
  const totalScore = scenarios.reduce((sum, scenario) => sum + scenario.score, 0);
  const totalMaxScore = scenarios.reduce((sum, scenario) => sum + scenario.maxScore, 0);
  const testedCount = scenarios.filter((scenario) => scenario.status !== "not_tested").length;
  const testedMaxScore = testedCount * 10;
  const notTestedCount = scenarios.length - testedCount;

  return {
    runId: results.runId || `computer-use-${Date.now()}`,
    tester: results.tester || "computer-use",
    model: results.model || scenarioSet.model,
    modelDisplayName: scenarioSet.modelDisplayName,
    generatedAt: nowIso(),
    totalScore,
    totalMaxScore,
    testedCount,
    notTestedCount,
    overallGrade: overallGradeFromRun({ testedScore: totalScore, testedMaxScore, notTestedCount }),
    categories: categorySummaries,
    scenarios,
  };
}

export function auditComputerUseCoverage({
  scenarioSet,
  results,
  minTestedCount = null,
  requireAllCategories = true,
  requireEvidenceForTested = true,
} = {}) {
  const summary = scoreScenarioRun({ scenarioSet, results });
  const requiredTestedCount = Number.isFinite(minTestedCount)
    ? minTestedCount
    : summary.scenarios.length;
  const testedScenarios = summary.scenarios.filter(
    (scenario) => !["not_tested", "skip"].includes(scenario.status),
  );
  const testedIds = new Set(testedScenarios.map((scenario) => scenario.id));
  const coveredCategories = new Set(testedScenarios.map((scenario) => scenario.category));
  const categoryNames = Array.isArray(scenarioSet.categories)
    ? scenarioSet.categories.map((item) =>
        typeof item === "string" ? item : String(item?.category || ""),
      ).filter(Boolean)
    : [...new Set(scenarioSet.scenarios.map((scenario) => scenario.category))];
  const missingCategories = requireAllCategories
    ? categoryNames.filter((category) => !coveredCategories.has(category))
    : [];
  const scenariosMissingEvidence = requireEvidenceForTested
    ? testedScenarios
        .filter((scenario) => !Array.isArray(scenario.evidence) || scenario.evidence.length === 0)
        .map((scenario) => scenario.id)
    : [];
  const failedScenarios = summary.scenarios
    .filter((scenario) => ["fail", "blocked"].includes(scenario.status))
    .map((scenario) => scenario.id);
  const notTestedIds = summary.scenarios
    .filter((scenario) => !testedIds.has(scenario.id))
    .map((scenario) => scenario.id);
  const issues = [];

  if (testedScenarios.length < requiredTestedCount) {
    issues.push(
      `미실시 시나리오가 ${requiredTestedCount - testedScenarios.length}개 남았습니다.`,
    );
  }
  if (missingCategories.length > 0) {
    issues.push(`컴퓨터유즈 점검이 빠진 카테고리 ${missingCategories.length}개가 있습니다.`);
  }
  if (scenariosMissingEvidence.length > 0) {
    issues.push(`증거가 없는 실시 시나리오 ${scenariosMissingEvidence.length}개가 있습니다.`);
  }
  if (failedScenarios.length > 0) {
    issues.push(`실패 또는 차단 시나리오 ${failedScenarios.length}개가 있습니다.`);
  }
  if (summary.notTestedCount === 0 && summary.overallGrade !== "release-ready") {
    issues.push(`전체 점검 등급이 ${summary.overallGrade}입니다.`);
  }

  return {
    runId: summary.runId,
    model: summary.model,
    modelDisplayName: summary.modelDisplayName,
    generatedAt: nowIso(),
    readyForCompletion: issues.length === 0,
    totalScenarios: summary.scenarios.length,
    testedCount: testedScenarios.length,
    notTestedCount: notTestedIds.length,
    requiredTestedCount,
    categoriesCovered: coveredCategories.size,
    categoriesMissing: missingCategories.length,
    missingCategories,
    notTestedIds,
    scenariosMissingEvidence,
    failedScenarios,
    overallGrade: summary.overallGrade,
    totalScore: summary.totalScore,
    totalMaxScore: summary.totalMaxScore,
    issues,
  };
}

export function renderScoreReport(summary) {
  const lines = [
    "# 경량모델 UX/성능 컴퓨터유즈 점수 리포트",
    "",
    `- 실행 ID: ${summary.runId}`,
    `- 모델 기준: ${summary.modelDisplayName} (${summary.model})`,
    `- 평가자: ${summary.tester}`,
    `- 총점: ${summary.totalScore} / ${summary.totalMaxScore}`,
    `- 실시: ${summary.testedCount}개`,
    `- 미실시: ${summary.notTestedCount}개`,
    `- 종합 등급: ${summary.overallGrade}`,
    "",
    "## 카테고리 점수",
    "",
    "| 카테고리 | 실시 | 점수 | 등급 |",
    "| --- | ---: | ---: | --- |",
  ];

  for (const category of summary.categories) {
    lines.push(
      `| ${category.category} | ${category.testedCount}/${category.count} | ${category.score}/${category.maxScore} | ${category.grade} |`,
    );
  }

  lines.push("", "## 시나리오별 결과", "");
  for (const scenario of summary.scenarios) {
    lines.push(`### ${scenario.id} ${scenario.title}`);
    lines.push("");
    lines.push(`- 카테고리: ${scenario.category}`);
    lines.push(`- 상태: ${scenario.status}`);
    lines.push(`- 점수: ${scenario.score} / ${scenario.maxScore}`);
    lines.push(`- 등급: ${scenario.grade}`);
    if (scenario.notes) {
      lines.push(`- 메모: ${scenario.notes}`);
    }
    if (scenario.blocker) {
      lines.push(`- 블로커: ${scenario.blocker}`);
    }
    if (scenario.evidence.length > 0) {
      lines.push("- 증거:");
      for (const evidence of scenario.evidence) {
        lines.push(`  - ${evidence}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function renderComputerUseCoverageAudit(audit) {
  const lines = [
    "# 경량모델 컴퓨터유즈 커버리지 감사",
    "",
    `- 실행 ID: ${audit.runId}`,
    `- 모델 기준: ${audit.modelDisplayName} (${audit.model})`,
    `- 완료 인정 가능: ${audit.readyForCompletion ? "예" : "아니오"}`,
    `- 실시: ${audit.testedCount} / ${audit.totalScenarios}`,
    `- 필수 실시 기준: ${audit.requiredTestedCount}`,
    `- 카테고리 커버리지: ${audit.categoriesCovered}개 커버, ${audit.categoriesMissing}개 누락`,
    `- 총점: ${audit.totalScore} / ${audit.totalMaxScore}`,
    `- 종합 등급: ${audit.overallGrade}`,
    "",
    "## 이슈",
    "",
  ];

  if (audit.issues.length === 0) {
    lines.push("- 없음");
  } else {
    for (const issue of audit.issues) {
      lines.push(`- ${issue}`);
    }
  }

  const sections = [
    ["미실시 시나리오", audit.notTestedIds],
    ["증거 누락 시나리오", audit.scenariosMissingEvidence],
    ["실패/차단 시나리오", audit.failedScenarios],
    ["누락 카테고리", audit.missingCategories],
  ];
  for (const [title, items] of sections) {
    lines.push("", `## ${title}`, "");
    if (!items.length) {
      lines.push("- 없음");
    } else {
      for (const item of items) {
        lines.push(`- ${item}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = {
    scenarios: DEFAULT_SCENARIO_PATH,
    results: "",
    outDir: DEFAULT_OUT_DIR,
    createTemplate: false,
    createRunPack: false,
    auditCoverage: false,
    failOnIncomplete: false,
    minTestedCount: null,
    scenarioLimit: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--scenarios" && next) {
      options.scenarios = next;
      index += 1;
    } else if (arg === "--results" && next) {
      options.results = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      options.outDir = next;
      index += 1;
    } else if (arg === "--create-template") {
      options.createTemplate = true;
    } else if (arg === "--create-run-pack") {
      options.createRunPack = true;
    } else if (arg === "--audit-coverage") {
      options.auditCoverage = true;
    } else if (arg === "--fail-on-incomplete") {
      options.failOnIncomplete = true;
    } else if (arg === "--min-tested" && next) {
      options.minTestedCount = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--scenario-limit" && next) {
      options.scenarioLimit = Number.parseInt(next, 10);
      index += 1;
    }
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export function writeScoreArtifacts({ scenarioSet, results, outDir = DEFAULT_OUT_DIR }) {
  fs.mkdirSync(outDir, { recursive: true });
  const summary = scoreScenarioRun({ scenarioSet, results });
  const jsonPath = path.join(outDir, `${SCORE_REPORT_BASENAME}.json`);
  const markdownPath = path.join(outDir, `${SCORE_REPORT_BASENAME}.md`);
  writeJson(jsonPath, summary);
  fs.writeFileSync(markdownPath, renderScoreReport(summary), "utf-8");
  return { summary, written: [jsonPath, markdownPath] };
}

export function writeCoverageAuditArtifacts({
  scenarioSet,
  results,
  outDir = DEFAULT_OUT_DIR,
  minTestedCount = null,
}) {
  fs.mkdirSync(outDir, { recursive: true });
  const audit = auditComputerUseCoverage({ scenarioSet, results, minTestedCount });
  const jsonPath = path.join(outDir, `${COVERAGE_AUDIT_BASENAME}.json`);
  const markdownPath = path.join(outDir, `${COVERAGE_AUDIT_BASENAME}.md`);
  writeJson(jsonPath, audit);
  fs.writeFileSync(markdownPath, renderComputerUseCoverageAudit(audit), "utf-8");
  return { audit, written: [jsonPath, markdownPath] };
}

export function writeRunPackArtifacts({ scenarioSet, outDir = DEFAULT_OUT_DIR, scenarioLimit = null }) {
  fs.mkdirSync(outDir, { recursive: true });
  const runPack = createComputerUseRunPack(scenarioSet, { scenarioLimit });
  const jsonPath = path.join(outDir, `${RUN_PACK_BASENAME}.json`);
  const markdownPath = path.join(outDir, `${RUN_PACK_BASENAME}.md`);
  writeJson(jsonPath, runPack);
  fs.writeFileSync(markdownPath, renderComputerUseRunPack(runPack), "utf-8");
  return { runPack, written: [jsonPath, markdownPath] };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenarioSet = readJson(options.scenarios);
  fs.mkdirSync(options.outDir, { recursive: true });

  const shouldCreateTemplate = options.createTemplate || (!options.results && !options.createRunPack);
  if (shouldCreateTemplate) {
    const blankSheet = createBlankResultSheet(scenarioSet);
    const templatePath = path.join(options.outDir, `${RESULT_TEMPLATE_BASENAME}.json`);
    writeJson(templatePath, blankSheet);
    console.log(`created result template for ${blankSheet.scenarios.length} scenarios`);
    console.log(templatePath);
  }

  if (options.createRunPack) {
    const { runPack, written } = writeRunPackArtifacts({
      scenarioSet,
      outDir: options.outDir,
      scenarioLimit: options.scenarioLimit,
    });
    console.log(`created computer-use run pack for ${runPack.scenarios.length} scenarios`);
    for (const filePath of written) {
      console.log(filePath);
    }
  }

  if (!options.results) {
    return;
  }

  const results = readJson(options.results);
  const { summary, written } = writeScoreArtifacts({
    scenarioSet,
    results,
    outDir: options.outDir,
  });
  console.log(`scored ${summary.testedCount}/${summary.scenarios.length} scenarios`);
  console.log(`${summary.totalScore}/${summary.totalMaxScore} ${summary.overallGrade}`);
  for (const filePath of written) {
    console.log(filePath);
  }

  if (options.auditCoverage) {
    const { audit, written: auditWritten } = writeCoverageAuditArtifacts({
      scenarioSet,
      results,
      outDir: options.outDir,
      minTestedCount: options.minTestedCount,
    });
    console.log(
      `coverage audit: ${audit.testedCount}/${audit.totalScenarios} tested, ready=${audit.readyForCompletion}`,
    );
    for (const filePath of auditWritten) {
      console.log(filePath);
    }
    if (options.failOnIncomplete && !audit.readyForCompletion) {
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
