import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PER_CATEGORY = 10;
const DEFAULT_OUT_DIR = path.join("docs", "operations", "generated");
const OUTPUT_BASENAME = "lightweight-model-test-scenarios";

const CATEGORY_BLUEPRINTS = [
  {
    category: "앱 시작과 업무엔진",
    focus: "콜드스타트, 자동복구, 상태 피드백",
    titles: [
      "최초 실행 후 업무엔진 정상 연결",
      "업무엔진 오프라인 상태 안내",
      "업무엔진 수동 재시작",
      "새로고침 후 세션 유지",
      "작은 창에서 기본 레이아웃 유지",
      "업무엔진 상태 팝오버 확인",
      "긴 작업 후 상태 복귀",
      "앱 재실행 후 최근 세션 복구",
      "업무엔진 오류 메시지 이해 가능성",
      "상단 상태 버튼 밀집도 확인",
    ],
  },
  {
    category: "모델 설정과 Gemma 4 E2B",
    focus: "Gemma 4 E2B 최적화, 경량모델 정책, 연결 테스트",
    titles: [
      "Gemma 4 E2B 로컬 기본 프로필 확인",
      "Ollama Base URL 저장",
      "reasoning 낮음 설정 응답속도 확인",
      "reasoning 중간 설정 thinking 누출 방지",
      "Gemma 4 무응답 오류 안내",
      "Featherless 외부 모델 전환",
      "OpenRouter 프로필 보존",
      "API Key 저장 상태 마스킹",
      "모델 연결 테스트 결과 표시",
      "프로필 전환 후 활성 공급자 일치",
    ],
  },
  {
    category: "업무대화 기본 UX",
    focus: "스트리밍, Markdown, 첨부, 스크롤, 응답시간",
    titles: [
      "새 세션 생성과 첫 질문",
      "응답 스트리밍 표시",
      "응답 소요시간 표시",
      "Markdown 목록 렌더링",
      "긴 답변 후 마지막 위치 유지",
      "이미지 첨부 썸네일 표시",
      "첨부 취소와 큰 미리보기",
      "세부설정 오버레이 표시",
      "민감정보 마스킹",
      "내부추론 채널 미노출",
    ],
  },
  {
    category: "업무대화 도구 라우팅",
    focus: "정규식 라우팅, 도구 우선 실행, 경량모델 환각 방지",
    titles: [
      "일정 등록 요청 라우팅",
      "일정 조회 요청 라우팅",
      "일정 삭제 요청 라우팅",
      "지식폴더 검색 요청 라우팅",
      "문서작성 요청 라우팅",
      "일정과 지식검색 복합 요청",
      "파일찾기 안내 요청",
      "기능 사용법 안내 요청",
      "도구 실패 시 복구 안내",
      "일반 대화와 도구 요청 구분",
    ],
  },
  {
    category: "일정 캘린더",
    focus: "월/주/일 보기, 셀 압축, 연결 세션",
    titles: [
      "월 보기 일정 색상 구분",
      "주 보기 시간대 표기",
      "일 보기 시간 단위 등록",
      "긴 일정명 말줄임",
      "일정 hover 상세 확인",
      "기존 일정 수정 후 신규 일정 생성",
      "연결 업무대화 세션 열기",
      "오늘 버튼 이동",
      "이전/다음 기간 이동",
      "일정 삭제 후 목록 반영",
    ],
  },
  {
    category: "파일찾기와 세션 연결",
    focus: "Anything 없는 자체 인덱서, 우측 미리보기, 세션 파일 연결",
    titles: [
      "파일명 인덱스 갱신",
      "정확한 파일명 검색",
      "부분 파일명 검색",
      "검색결과 카드 선택",
      "우측 미리보기 표시",
      "경로 복사 토스트",
      "현재 세션에 파일 연결",
      "연결 파일 수 표시",
      "연결 파일 목록 닫기",
      "검색결과 없음 안내",
    ],
  },
  {
    category: "지식폴더/GraphRAG 인덱싱",
    focus: "스캔/인제스트 진행률, 로그, 취소, 품질 진단",
    titles: [
      "지식폴더 등록",
      "색인처리 탭 이동 안내",
      "스캔 진행률 표시",
      "GraphRAG 인덱싱 진행률 표시",
      "진행 중 중복작업 잠금",
      "인덱싱 취소",
      "덤프뷰어 열기",
      "구조보기 열기",
      "부분 추출 경고 표시",
      "완료 파일 수 상세 이동",
    ],
  },
  {
    category: "GraphRAG 검색과 출처 답변",
    focus: "근거 검색, citation, 관계보기, 경량모델 grounded 답변",
    titles: [
      "지식검색 결과 표시",
      "근거 답변 생성",
      "출처 문서명 표시",
      "파일 경로 표시",
      "품질 낮은 근거 경고",
      "관계 보기 drill-down",
      "그래프 노드 클릭",
      "표 근거 표시",
      "업무대화에서 지식검색 반영",
      "검색근거 없는 질문 처리",
    ],
  },
  {
    category: "문서작성/HWPX 산출",
    focus: "세션/파일 컨텍스트, 4개 보고서 유형, 산출 링크",
    titles: [
      "업무대화에서 문서작성 이동",
      "바로작성 시작",
      "연결 파일 활용방안 입력",
      "시행문 유형 선택",
      "1페이지 보고서 유형 선택",
      "풀버전 보고서 유형 선택",
      "이메일 유형 선택",
      "사용자 지정 양식 선택",
      "HWPX 산출 경로 표시",
      "산출 파일 열기 링크",
    ],
  },
  {
    category: "실행기록/작업진행/다중작업",
    focus: "작업 큐, 진행 이벤트, 최근실행, 병렬 사용자 경험",
    titles: [
      "최근실행 한글 표시",
      "작업상세 이벤트 확인",
      "긴 작업 중 다른 메뉴 이동",
      "같은 세션 중복 응답 차단",
      "다른 리소스 작업 병렬 진행",
      "작업 취소 버튼",
      "실패 작업 재시도 안내",
      "완료 작업 산출물 열기",
      "작업 로그 복사",
      "다중작업 후 우측패널 상태",
    ],
  },
];

function modelDisplayName(model) {
  const normalized = String(model || "").toLowerCase();
  if (normalized.includes("gemma4:e2b") || normalized.includes("gemma-4-e2b")) {
    return "Gemma 4 E2B";
  }
  if (normalized.includes("gemma4") || normalized.includes("gemma-4")) {
    return "Gemma 4";
  }
  return model || "현재 활성 경량모델";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function buildSteps(categoryIndex, itemIndex, title, category) {
  const base = [
    "앱을 실행하고 업무엔진 상태가 사용자에게 이해 가능한지 확인한다.",
    `좌측 메뉴에서 '${category}' 관련 화면 또는 업무대화 흐름으로 이동한다.`,
    `'${title}'에 해당하는 사용자 입력 또는 클릭 동작을 수행한다.`,
    "중앙 작업화면과 우측 정보패널이 동시에 필요한 정보를 보여주는지 확인한다.",
    "작업 완료 후 최근실행 또는 작업진행에서 결과를 추적한다.",
  ];
  if (categoryIndex === 2 || categoryIndex === 3) {
    base.splice(3, 0, "응답 중 내부추론, 정책 점검 문구, 불필요한 영어 trace가 노출되지 않는지 확인한다.");
  }
  if (categoryIndex === 7) {
    base.splice(3, 0, "답변에 출처 문서명, 파일 경로, 추정 여부가 포함되는지 확인한다.");
  }
  if (categoryIndex === 8) {
    base.splice(4, 0, "생성된 HWPX 또는 검토용 Markdown 산출물의 경로를 클릭 가능한 형태로 확인한다.");
  }
  return base.map((step, index) => `${index + 1}. ${step}`);
}

function buildExpected(categoryIndex, title) {
  const common = [
    "fetch fail 같은 일반 오류만 남기지 않고 원인과 다음 행동이 보인다.",
    "작업 결과는 중앙 화면 또는 우측 패널에서 사용자가 이해할 수 있다.",
    "최근실행/작업진행에 한글 설명과 성공/실패 상태가 남는다.",
  ];
  if (categoryIndex === 1) {
    return [
      "Gemma 4 E2B 또는 선택 모델의 활성 공급자/모델명이 설정값과 일치한다.",
      "경량모델 설정에서도 응답시간, reasoning, 내부추론 노출 방지가 확인된다.",
      ...common,
    ];
  }
  if (categoryIndex === 3) {
    return [
      "일반 조언 대신 가능한 경우 일정/지식검색/문서작성 도구 실행 결과가 우선 표시된다.",
      "도구 실행 실패 시 실패 원인과 재시도 또는 수동 대안이 안내된다.",
      ...common,
    ];
  }
  if (categoryIndex === 7) {
    return [
      "답변에 출처 문서와 파일 경로가 포함된다.",
      "근거가 약하면 추정 또는 경고가 명확히 표시된다.",
      ...common,
    ];
  }
  if (categoryIndex === 8) {
    return [
      "지정한 보고서 유형에 맞는 산출 흐름이 시작된다.",
      "산출 파일 또는 작업 결과 링크가 사용자가 클릭할 수 있는 형태로 보인다.",
      ...common,
    ];
  }
  return [`'${title}' 결과가 화면에 즉시 반영된다.`, ...common];
}

function buildComputerUse(category, title) {
  return {
    surface: "Codex in-app Browser 또는 Tauri 창",
    performanceThresholds: {
      feedbackMs: 1000,
      navigationMs: 1500,
      completionMs: category.includes("문서작성") || category.includes("GraphRAG") ? 10000 : 3000,
      routingPreviewMs: 500,
    },
    checkpoints: [
      "화면 전환 또는 버튼 클릭 후 1초 이내 사용자가 다음 상태를 이해할 수 있는가",
      "반응속도 측정: 첫 피드백, 화면 전환, 완료 응답을 각각 기록하고 기준 이내인지 확인한다.",
      "라우팅 측정: 다양한 업무대화 문장이 일정/지식/문서/도움말/일반대화 중 의도한 경로로 분기되는지 확인한다.",
      "우측 패널 또는 작업진행에서 상세 증거를 열 수 있는가",
      "오류가 발생해도 사용자가 같은 흐름을 계속할 수 있는가",
    ],
    evidenceToCapture: [
      `${category} - ${title} 화면 스크린샷`,
      "작업진행/최근실행 상태",
      "필요 시 생성된 파일 경로 또는 로그 경로",
    ],
  };
}

function buildScenario(categoryIndex, itemIndex, blueprint, model) {
  const title = blueprint.titles[itemIndex % blueprint.titles.length];
  return {
    id: `LMUX-${pad2(categoryIndex + 1)}-${pad2(itemIndex + 1)}`,
    title,
    category: blueprint.category,
    model,
    modelDisplayName: modelDisplayName(model),
    priority: itemIndex < 3 ? "P0" : itemIndex < 7 ? "P1" : "P2",
    lightweightFocus: blueprint.focus,
    maxScore: 10,
    preconditions: [
      "Windows 개발 또는 설치 실행 환경에서 앱을 시작한다.",
      "업무엔진이 실행 가능하며 테스트용 더미 업무 데이터만 사용한다.",
      "가능하면 로컬 모델은 gemma4:e2b를 사용하고, 외부 모델은 비교 목적으로만 사용한다.",
    ],
    steps: buildSteps(categoryIndex, itemIndex, title, blueprint.category),
    expected: buildExpected(categoryIndex, title),
    scoring: {
      functional: {
        max: 4,
        guide: "기능이 요구한 데이터를 생성/조회/연결/저장하면 4점, 부분 동작은 1~3점",
      },
      ux: {
        max: 3,
        guide: "사용자가 진행상태와 다음 행동을 즉시 이해하면 3점, 혼란이 있으면 감점",
      },
      modelQuality: {
        max: 2,
        guide: "경량모델 답변이 짧고 구조화되며 출처/보안/도구 우선 원칙을 지키면 2점",
      },
      evidence: {
        max: 1,
        guide: "스크린샷, 로그, 산출물 경로 등 검증 증거를 남기기 쉬우면 1점",
      },
    },
    computerUse: buildComputerUse(blueprint.category, title),
  };
}

export function buildScenarioSet({ model = "gemma4:e2b", perCategory = DEFAULT_PER_CATEGORY } = {}) {
  const safePerCategory = Math.max(1, Number.parseInt(String(perCategory), 10) || DEFAULT_PER_CATEGORY);
  const scenarios = CATEGORY_BLUEPRINTS.flatMap((blueprint, categoryIndex) =>
    Array.from({ length: safePerCategory }, (_unused, itemIndex) =>
      buildScenario(categoryIndex, itemIndex, blueprint, model),
    ),
  );
  return {
    generatedAt: new Date().toISOString(),
    purpose: "경량모델을 사용하는 경우에도 성능과 사용경험이 떨어지지 않는지 컴퓨터유즈 기반으로 점수화한다.",
    model,
    modelDisplayName: modelDisplayName(model),
    perCategory: safePerCategory,
    scoringScale: {
      releaseReady: "9~10",
      minorPolish: "7~8",
      usableButNeedsFix: "5~6",
      blocker: "0~4",
    },
    categories: CATEGORY_BLUEPRINTS.map((item) => item.category),
    scenarios,
  };
}

export function summarizeScenarioSet(scenarioSet) {
  const categories = scenarioSet.categories.map((category) => {
    const scenarios = scenarioSet.scenarios.filter((item) => item.category === category);
    return {
      category,
      count: scenarios.length,
      maxScore: scenarios.reduce((sum, item) => sum + item.maxScore, 0),
    };
  });
  return {
    model: scenarioSet.model,
    totalScenarios: scenarioSet.scenarios.length,
    totalMaxScore: scenarioSet.scenarios.reduce((sum, item) => sum + item.maxScore, 0),
    categories,
  };
}

export function scoreScenarioResult(scores) {
  const score = Math.max(
    0,
    Math.min(
      10,
      Number(scores.functional || 0) +
        Number(scores.ux || 0) +
        Number(scores.modelQuality || 0) +
        Number(scores.evidence || 0),
    ),
  );
  let grade = "blocker";
  if (score >= 9) {
    grade = "release-ready";
  } else if (score >= 7) {
    grade = "minor polish";
  } else if (score >= 5) {
    grade = "usable but needs fix";
  }
  return { score, grade };
}

export function renderScenarioMarkdown(scenarioSet) {
  const summary = summarizeScenarioSet(scenarioSet);
  const lines = [
    "# 경량모델 UX/성능 컴퓨터유즈 테스트 시나리오",
    "",
    `생성 모델 기준: ${scenarioSet.modelDisplayName} (${scenarioSet.model})`,
    `총 시나리오: ${summary.totalScenarios}개`,
    `총점: ${summary.totalMaxScore}점`,
    "",
    "## 채점 방식",
    "",
    "- functional 4점: 기능이 실제로 동작하는가",
    "- ux 3점: 사용자가 진행상태와 다음 행동을 이해하는가",
    "- modelQuality 2점: 경량모델 답변이 구조화, 출처, 보안, 도구 우선 원칙을 지키는가",
    "- evidence 1점: 컴퓨터유즈 증거를 남기기 쉬운가",
    "",
    "## 카테고리 요약",
    "",
    "| 카테고리 | 시나리오 수 | 최대 점수 |",
    "| --- | ---: | ---: |",
    ...summary.categories.map((item) => `| ${item.category} | ${item.count} | ${item.maxScore} |`),
    "",
  ];

  for (const scenario of scenarioSet.scenarios) {
    lines.push(`## ${scenario.id} ${scenario.title}`);
    lines.push("");
    lines.push(`- 카테고리: ${scenario.category}`);
    lines.push(`- 우선순위: ${scenario.priority}`);
    lines.push(`- 경량모델 초점: ${scenario.lightweightFocus}`);
    lines.push(`- 최대 점수: ${scenario.maxScore}`);
    lines.push("");
    lines.push("### 사전조건");
    lines.push(...scenario.preconditions.map((item) => `- ${item}`));
    lines.push("");
    lines.push("### 실시 절차");
    lines.push(...scenario.steps.map((item) => `- ${item}`));
    lines.push("");
    lines.push("### 기대 결과");
    lines.push(...scenario.expected.map((item) => `- ${item}`));
    lines.push("");
    lines.push("### 컴퓨터유즈 체크포인트");
    lines.push(...scenario.computerUse.checkpoints.map((item) => `- ${item}`));
    lines.push("");
    lines.push("### 증거");
    lines.push(...scenario.computerUse.evidenceToCapture.map((item) => `- ${item}`));
    lines.push("");
    lines.push("### 점수 기록");
    lines.push("");
    lines.push("| 항목 | 최대 | 점수 | 메모 |");
    lines.push("| --- | ---: | ---: | --- |");
    lines.push("| functional | 4 |  |  |");
    lines.push("| ux | 3 |  |  |");
    lines.push("| modelQuality | 2 |  |  |");
    lines.push("| evidence | 1 |  |  |");
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function parseArgs(argv) {
  const options = {
    model: "gemma4:e2b",
    perCategory: DEFAULT_PER_CATEGORY,
    outDir: DEFAULT_OUT_DIR,
    format: "both",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--model" && next) {
      options.model = next;
      index += 1;
    } else if (arg === "--per-category" && next) {
      options.perCategory = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--out-dir" && next) {
      options.outDir = next;
      index += 1;
    } else if (arg === "--format" && next) {
      options.format = next;
      index += 1;
    }
  }
  return options;
}

export function writeScenarioArtifacts({ scenarioSet, outDir = DEFAULT_OUT_DIR, format = "both" }) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  if (format === "both" || format === "json") {
    const jsonPath = path.join(outDir, `${OUTPUT_BASENAME}.json`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(scenarioSet, null, 2)}\n`, "utf-8");
    written.push(jsonPath);
  }
  if (format === "both" || format === "md" || format === "markdown") {
    const markdownPath = path.join(outDir, `${OUTPUT_BASENAME}.md`);
    fs.writeFileSync(markdownPath, renderScenarioMarkdown(scenarioSet), "utf-8");
    written.push(markdownPath);
  }
  return written;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenarioSet = buildScenarioSet({
    model: options.model,
    perCategory: options.perCategory,
  });
  const written = writeScenarioArtifacts({
    scenarioSet,
    outDir: options.outDir,
    format: options.format,
  });
  const summary = summarizeScenarioSet(scenarioSet);
  console.log(
    `generated ${summary.totalScenarios} lightweight model scenarios (${summary.totalMaxScore} points)`,
  );
  for (const filePath of written) {
    console.log(filePath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
