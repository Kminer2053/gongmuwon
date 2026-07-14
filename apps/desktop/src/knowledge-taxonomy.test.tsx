import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// WI-2 (b): bulk-resolve는 api 모듈 함수 차원에서 mock해 호출 인자를 검증한다.
// 나머지 api 함수는 실제 구현 그대로 두고(부분 mock) fetch 스텁으로 응답한다.
const bulkResolveTaxonomyQueueMock = vi.hoisted(() => vi.fn());
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, bulkResolveTaxonomyQueue: bulkResolveTaxonomyQueueMock };
});

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: vi.fn(async () => ({
    available: true,
    mode: "tauri",
    sidecar_url: "http://127.0.0.1:8765",
    anything_available: true,
    anything_mode: "external_app_detected",
    anything_path: "C:/Users/USER/AppData/Local/Anything/docufinder.exe",
    anything_autopaste_enabled: false,
    running: true,
    managed: true,
    auto_restart_recommended: false,
    log_path: "/tmp/gongmu-workspace/logs/sidecar-runtime.log",
    detail: "managed sidecar running",
  })),
  startDesktopSidecar: vi.fn(),
  stopDesktopSidecar: vi.fn(),
  restartDesktopSidecar: vi.fn(),
  pickDirectory: vi.fn(async () => "C:/Docs/업무자료"),
  launchAnythingQuery: vi.fn(async () => undefined),
  openExternalTarget: vi.fn(async () => undefined),
  copyTextToClipboard: vi.fn(async () => undefined),
}));

import { App } from "./app";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

const KNOWLEDGE_SOURCE = {
  id: "source-1",
  label: "기획팀 업무자료",
  root_path: "C:/Docs/업무자료",
  status: "active",
  last_scanned_at: "2026-07-01T00:00:00+09:00",
  created_at: "2026-06-28T00:00:00+09:00",
  updated_at: "2026-07-01T00:00:00+09:00",
};

const TAXONOMY_PROPOSAL = {
  source_id: "source-1",
  source_label: "기획팀 업무자료",
  generated_at: "2026-07-05T00:00:00+09:00",
  work_areas: [
    { name: "예산", slug: "예산", folders: ["01. 예산"], doc_count: 12, source: "folder", confidence: "high" },
    { name: "행사", slug: "행사", folders: ["02. 행사"], doc_count: 7, source: "folder", confidence: "medium" },
    { name: "감사", slug: "감사", folders: [], doc_count: 2, source: "vocab", confidence: "low" },
  ],
  reference_shelves: [{ folder: "□참고□ 법령자료", doc_count: 5 }],
  doc_role_stats: { report: 6, plan: 4, unknown: 3 },
  families: [
    {
      family_id: "fam-1",
      title: "예산요구서",
      folder: "01. 예산",
      members: [
        { slug: "budget-v2", path: "C:/Docs/업무자료/01. 예산/예산요구서 v2.hwp", relative_path: "01. 예산/예산요구서 v2.hwp", mtime: "2026-06-20", version_signals: {} },
        { slug: "budget-v1", path: "C:/Docs/업무자료/01. 예산/예산요구서 v1.hwp", relative_path: "01. 예산/예산요구서 v1.hwp", mtime: "2026-06-01", version_signals: {} },
      ],
      latest_slug: "budget-v2",
      latest_path: "C:/Docs/업무자료/01. 예산/예산요구서 v2.hwp",
      official_slug: null,
      unclear_latest: true,
    },
  ],
  governance_docs: [
    { path: "C:/Docs/업무자료/업무분장표.hwp", relative_path: "업무분장표.hwp", kind: "업무분장" },
  ],
  conventions: { prefix_importance: true, date_prefix: false },
  interview: null,
  hints: ["인수인계 목적: 문서 가족(버전 이력)과 최신본 판정을 우선 확인하세요."],
  llm_suggestions: null,
};

const CONFIRMED_TAXONOMY = {
  source_id: "source-1",
  work_areas: [
    { name: "예산 관리", slug: "예산-관리", folders: ["01. 예산"], keywords: [] },
    { name: "행사", slug: "행사", folders: ["02. 행사"], keywords: [] },
  ],
  doc_roles_enabled: ["regulation", "manual", "plan", "report", "meeting", "official", "form", "reference"],
  family_policy: "latest_representative",
  confirmed_at: "2026-07-05T00:10:00+09:00",
};

describe("work-aware taxonomy wizard, queue, and wiki hubs (T-01)", () => {
  let lastInterviewBody: Record<string, unknown> | undefined;
  let lastConfirmBody: Record<string, unknown> | undefined;
  let lastApplyBody: Record<string, unknown> | undefined;
  let lastResolveUrl: string | undefined;
  let lastResolveBody: Record<string, unknown> | undefined;
  let savedInterview: Record<string, unknown> | null;
  let taxonomyConfigured: boolean;
  let qualityItems: Array<Record<string, unknown>>;
  let queueItems: Array<Record<string, unknown>>;
  // W7: 신설치 자동 스캔 연쇄 — proposal 페이로드 교체 + 스캔 지연 해제 훅
  let proposalPayload: Record<string, unknown>;
  let scanRequests: number;
  let releaseScan: (() => void) | null;

  beforeEach(() => {
    lastInterviewBody = undefined;
    lastConfirmBody = undefined;
    lastApplyBody = undefined;
    lastResolveUrl = undefined;
    lastResolveBody = undefined;
    savedInterview = null;
    taxonomyConfigured = false;
    qualityItems = [];
    queueItems = [];
    proposalPayload = TAXONOMY_PROPOSAL;
    scanRequests = 0;
    releaseScan = null;
    bulkResolveTaxonomyQueueMock.mockReset();
    bulkResolveTaxonomyQueueMock.mockResolvedValue({ items: [] });

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

        if (url.endsWith("/health")) {
          return jsonResponse({
            status: "ok",
            workspace_root: "/tmp/gongmu-workspace",
            database: "/tmp/gongmu-workspace/db/gongmu.db",
          });
        }

        if (url.endsWith("/api/settings")) {
          return jsonResponse({
            defaults: {
              llm_mode: "local_first",
              llm_provider: "openai_compatible",
              llm_model: "gpt-4.1-mini",
              llm_api_key: null,
              llm_site_url: null,
              llm_application_name: null,
              anything_launch_mode: "external_app_preferred",
              default_template_key: "report",
              internal_api_base_url: null,
              personalization_apply_mode: "approval_required",
              profiles: undefined,
            },
            paths: {
              workspace_root: "/tmp/gongmu-workspace",
              database: "/tmp/gongmu-workspace/db/gongmu.db",
              knowledge_root: "/tmp/gongmu-workspace/knowledge",
              documents_root: "/tmp/gongmu-workspace/documents",
              personalization_root: "/tmp/gongmu-workspace/personalization",
            },
          });
        }

        // ---------------- T-01 분류체계 엔드포인트 ----------------

        if (url.includes("/api/knowledge/taxonomy/queue/") && url.endsWith("/resolve") && method === "POST") {
          lastResolveUrl = url;
          lastResolveBody = body;
          const itemId = decodeURIComponent(
            url.split("/api/knowledge/taxonomy/queue/")[1].split("/resolve")[0],
          );
          const resolved = queueItems.find((item) => item.id === itemId);
          queueItems = queueItems.filter((item) => item.id !== itemId);
          return jsonResponse({
            item: { ...(resolved ?? { id: itemId }), status: "resolved" },
          });
        }

        if (url.includes("/api/knowledge/taxonomy/queue") && method === "GET") {
          return jsonResponse({ items: queueItems });
        }

        if (url.includes("/api/knowledge/taxonomy/quality") && method === "GET") {
          return jsonResponse({ configured: taxonomyConfigured, items: qualityItems });
        }

        if (url.includes("/api/knowledge/taxonomy/proposal") && method === "GET") {
          return jsonResponse(proposalPayload);
        }

        // W7: 폴더 스캔 — releaseScan 호출 전까지 응답을 지연시켜 진행 표시를 검증한다.
        if (url.includes("/api/knowledge/sources/") && url.endsWith("/scan") && method === "POST") {
          scanRequests += 1;
          return new Promise<Response>((resolve) => {
            releaseScan = () => {
              resolve(
                new Response(
                  JSON.stringify({
                    source_id: "source-1",
                    status: "completed",
                    indexed_count: 9,
                    metadata_count: 3,
                    deleted_count: 0,
                    failed_count: 0,
                    scanned_at: "2026-07-05T00:02:00+09:00",
                  }),
                  { status: 200, headers: { "Content-Type": "application/json" } },
                ),
              );
            };
          });
        }

        if (url.includes("/api/knowledge/taxonomy/interview")) {
          if (method === "POST") {
            lastInterviewBody = body;
            savedInterview = { ...body, updated_at: "2026-07-05T00:05:00+09:00" };
            return jsonResponse({ interview: savedInterview });
          }
          return jsonResponse({ interview: savedInterview });
        }

        if (url.endsWith("/api/knowledge/taxonomy/apply") && method === "POST") {
          lastApplyBody = body;
          qualityItems = [
            { source_id: "source-1", conflicts: 1, duplicates: 2, unclear_latest: 1, queue_count: 3, generated_at: "2026-07-05T00:20:00+09:00" },
          ];
          taxonomyConfigured = true;
          return jsonResponse(
            {
              work_job: {
                id: "job-taxonomy-apply",
                kind: "knowledge.taxonomy.apply",
                title: "기획팀 업무자료 업무 분류체계 적용",
                status: "running",
                priority: 5,
                resource_key: "knowledge_source:source-1",
                resource_policy: "exclusive",
                progress_percent: 0,
                current_stage: "tagging",
                cancel_requested: false,
                created_at: "2026-07-05T00:15:00+09:00",
                queued_at: "2026-07-05T00:15:00+09:00",
              },
            },
            201,
          );
        }

        if (url.includes("/api/knowledge/taxonomy") && method === "POST") {
          lastConfirmBody = body;
          taxonomyConfigured = true;
          return jsonResponse(
            {
              configured: true,
              source_id: "source-1",
              taxonomy: CONFIRMED_TAXONOMY,
              schema_path: "/tmp/gongmu-workspace/knowledge-wiki/SCHEMA.md",
            },
            201,
          );
        }

        if (url.includes("/api/knowledge/taxonomy") && method === "GET") {
          return jsonResponse({
            configured: taxonomyConfigured,
            items: taxonomyConfigured
              ? [
                  {
                    source_id: "source-1",
                    taxonomy: CONFIRMED_TAXONOMY,
                    schema_path: "/tmp/gongmu-workspace/knowledge-wiki/SCHEMA.md",
                    confirmed_at: CONFIRMED_TAXONOMY.confirmed_at,
                  },
                ]
              : [],
            interview: savedInterview,
          });
        }

        // ---------------- 기존 지식폴더 엔드포인트 ----------------

        if (url.endsWith("/api/knowledge/sources") && method === "GET") {
          return jsonResponse({ items: [KNOWLEDGE_SOURCE] });
        }

        if (url.endsWith("/api/knowledge/source-files")) {
          return jsonResponse({ items: [] });
        }

        if (url.endsWith("/api/knowledge/documents") && method === "GET") {
          return jsonResponse({ items: [] });
        }

        if (url.endsWith("/api/knowledge/ingestion-jobs") && method === "GET") {
          return jsonResponse({ items: [] });
        }

        if (url.endsWith("/api/knowledge/backend-status")) {
          return jsonResponse({
            engine: "wiki",
            fts5: { ok: true, tokenizer: "trigram" },
            kordoc: { available: true },
            llm_enrichment: { configured: true },
            backends: [],
            vector: {
              production_backend: "sqlite_fts5",
              production_available: true,
              production_enabled: true,
              active_backend: "sqlite_fts5",
              available: true,
              mode: "wiki",
              storage_path: "/tmp/gongmu-workspace/db/gongmu.db",
              detail: "trigram BM25",
            },
            graph: {
              production_backend: "wiki_markdown",
              production_available: true,
              production_enabled: true,
              active_backend: "wiki_markdown",
              available: true,
              mode: "wiki",
              storage_path: "/tmp/gongmu-workspace/knowledge/wiki",
              detail: "Markdown 위키",
            },
          });
        }

        if (url.endsWith("/api/knowledge/parser-status")) {
          return jsonResponse({
            kordoc: {
              available: true,
              runner_available: true,
              runner_path: "/tmp/gongmu-workspace/runtime/kordoc_runner.js",
              runner_error: null,
              node_available: true,
              node_command: "node",
              node_version: "v22.0.0",
              node_error: null,
            },
          });
        }

        if (url.endsWith("/api/knowledge/wiki/tree")) {
          return jsonResponse({
            topics: [{ slug: "budget-topic", title: "예산 주제", doc_count: 2, path: "topics/budget-topic.md" }],
            works: [],
            work_areas: [
              { slug: "예산-관리", title: "예산 관리", doc_count: 12, path: "work-areas/예산-관리.md" },
            ],
            sources: [
              {
                source_id: "source-1",
                label: "기획팀 업무자료",
                docs: [{ slug: "service", title: "공공서비스 개선계획", path: "docs/service.md", quality_score: 0.85 }],
              },
            ],
            counts: { docs: 1, topics: 1, works: 0, work_areas: 1 },
          });
        }

        if (url.endsWith("/api/knowledge/wiki/index")) {
          return jsonResponse({
            path: "/tmp/gongmu-workspace/knowledge-wiki/index.md",
            content: "# 지식폴더 위키\n",
          });
        }

        if (url.includes("/api/knowledge/wiki/page")) {
          const requestedPath = new URL(url).searchParams.get("path") ?? "";
          if (requestedPath === "work-areas/예산-관리.md") {
            return jsonResponse({
              path: "/tmp/gongmu-workspace/knowledge-wiki/work-areas/예산-관리.md",
              relative_path: "work-areas/예산-관리.md",
              content: "# 예산 관리\n\n## 개요\n- 문서 12건 (대표 10건 · 이전 버전 2건)\n",
            });
          }
          if (requestedPath === "SCHEMA.md") {
            return jsonResponse({
              path: "/tmp/gongmu-workspace/knowledge-wiki/SCHEMA.md",
              relative_path: "SCHEMA.md",
              content: "# 지식 분류체계 (SCHEMA)\n\n## 업무 정의 (폴더 매핑)\n",
            });
          }
          return jsonResponse({
            path: "/tmp/gongmu-workspace/knowledge-wiki/docs/service.md",
            relative_path: "docs/service.md",
            content: "# 공공서비스 개선계획\n\n본문\n",
          });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": { items: [] },
          "/api/work-sessions": { items: [] },
          "/api/templates": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/personalization/candidates": { items: [] },
          "/api/approval-tickets": { items: [] },
          "/api/integrations/anything/launches": { items: [] },
          "/api/file-organizer/proposals": { items: [] },
          "/api/execution-logs": { items: [] },
        };

        const matched = Object.entries(collectionMap).find(([path]) => url.endsWith(path));
        if (matched) {
          return jsonResponse(matched[1]);
        }

        return jsonResponse({ detail: `Unhandled request: ${method} ${url}` }, 404);
      }),
    );
  });

  async function openSettingsTab(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "설정" }));
  }

  it("runs the 3-step wizard: interview save → proposal review/edit → confirm payload → apply", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openSettingsTab(user);

    // 진입점(설정 ② 위키 구성 설정): 등록된 지식폴더가 있으므로 활성화
    const entry = await screen.findByTestId("knowledge-taxonomy-entry");
    const wizardButton = within(entry).getByRole("button", { name: "분류체계 설정" });
    await waitFor(() => expect(wizardButton).toBeEnabled());
    await user.click(wizardButton);

    // 단계 1: 니즈 인터뷰 4문항
    const wizard = await screen.findByTestId("taxonomy-wizard");
    await user.selectOptions(within(wizard).getByLabelText("기관 유형"), "지방자치단체");
    await user.type(within(wizard).getByLabelText("부서명"), "기획팀");
    await user.type(within(wizard).getByLabelText("담당 업무"), "예산 편성과 행사 운영");
    await user.selectOptions(within(wizard).getByLabelText("지식관리 목적"), "인수인계 대비");
    await user.click(within(wizard).getByRole("button", { name: "다음" }));

    // 단계 2: 인터뷰 저장 + 초안 렌더
    await screen.findByTestId("taxonomy-review-step");
    expect(lastInterviewBody).toEqual({
      org_type: "지방자치단체",
      department: "기획팀",
      duty: "예산 편성과 행사 운영",
      purpose: "인수인계 대비",
    });

    // governance 배너 + 참고자료 서고 + 문서 가족 요약(최신본 불명확 경고)
    expect(screen.getByTestId("taxonomy-governance-banner")).toHaveTextContent(
      "업무분장표를 발견했습니다 — 업무 범위 파악에 참고했습니다.",
    );
    expect(screen.getByTestId("taxonomy-reference-shelves")).toHaveTextContent("□참고□ 법령자료 · 문서 5건");
    const familySummary = screen.getByTestId("taxonomy-family-summary");
    expect(familySummary).toHaveTextContent("유사 문서 1묶음 감지 — 대표 카드로 정리됩니다.");
    expect(familySummary).toHaveTextContent("최신본 불명확 1묶음");

    // 이름 인라인 수정: 예산 → 예산 관리
    const nameInputs = screen.getAllByLabelText("업무 이름");
    expect(nameInputs).toHaveLength(3);
    await user.clear(nameInputs[0]);
    await user.type(nameInputs[0], "예산 관리");

    // hub-assignment (c)-4: 확신도 낮은 vocab 후보(감사)는 채택 시점에 기본 제외된다.
    const auditCard = (screen.getByDisplayValue("감사").closest("article")) as HTMLElement;
    expect(auditCard.className).toContain("is-excluded");
    expect(within(auditCard).getByTestId("taxonomy-auto-excluded-pill")).toBeInTheDocument();

    // 문서유형 8종 체크리스트: 기본 전체 on
    const roleFieldset = screen.getByText("정리할 문서 유형 (기본 전체 사용)").closest("fieldset") as HTMLElement;
    const roleChecks = within(roleFieldset).getAllByRole("checkbox");
    expect(roleChecks).toHaveLength(8);
    for (const check of roleChecks) {
      expect(check).toBeChecked();
    }

    // 확정 payload 검증 (제외된 감사 미포함, 수정된 이름 반영)
    await user.click(screen.getByRole("button", { name: "이 체계로 확정" }));
    await screen.findByTestId("taxonomy-apply-step");
    expect(lastConfirmBody).toEqual({
      source_id: "source-1",
      work_areas: [
        { name: "예산 관리", folders: ["01. 예산"], keywords: [] },
        { name: "행사", folders: ["02. 행사"], keywords: [] },
      ],
      doc_roles_enabled: ["regulation", "manual", "plan", "report", "meeting", "official", "form", "reference"],
      family_policy: "latest_representative",
    });

    // 단계 3: 지금 적용 → 백그라운드 작업 + 품질 요약 카드
    await user.click(screen.getByRole("button", { name: "지금 적용" }));
    await waitFor(() => expect(lastApplyBody).toEqual({ source_id: "source-1", background: true }));
    const qualitySummary = await screen.findByTestId("taxonomy-quality-summary");
    expect(qualitySummary).toHaveTextContent("충돌 1건");
    expect(qualitySummary).toHaveTextContent("중복 2건");
    expect(qualitySummary).toHaveTextContent("최신본 불명확 1건");
    expect(qualitySummary).toHaveTextContent("분류 대기 3건");

    // SCHEMA.md 열람: 마법사 완료 화면의 [분류 기준 보기] → 위키 뷰어
    await user.click(within(wizard).getByRole("button", { name: "분류 기준 보기" }));
    expect(screen.queryByTestId("taxonomy-wizard")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "위키" })).toHaveAttribute("aria-selected", "true");
    const wikiPage = await screen.findByTestId("knowledge-wiki-page");
    expect(wikiPage).toHaveTextContent("지식 분류체계 (SCHEMA)");
  }, 20000);

  it("resolves a pending queue item with work-area and doc-role selects", async () => {
    taxonomyConfigured = true;
    qualityItems = [
      { source_id: "source-1", conflicts: 1, duplicates: 0, unclear_latest: 1, queue_count: 1, generated_at: "2026-07-05T00:20:00+09:00" },
    ];
    queueItems = [
      {
        id: "queue-1",
        source_id: "source-1",
        wiki_doc_id: "wd-1",
        doc_slug: "cooperation",
        title: "협조전 회신",
        source_path: "C:/Docs/업무자료/협조전 회신.hwp",
        reason: "no_signal",
        status: "pending",
        candidates: {
          work_areas: [{ work_area_slug: "예산-관리", name: "예산 관리", signal: "keyword" }],
          doc_roles: ["report"],
        },
        created_at: "2026-07-05T00:21:00+09:00",
      },
    ];

    const user = userEvent.setup();
    render(<App />);

    await openSettingsTab(user);

    // 분류 대기 카드(설정 ② 위키 구성 설정) → 펼치기
    const queueCard = await screen.findByTestId("knowledge-taxonomy-queue");
    const expandButton = within(queueCard).getByRole("button", { name: "분류 대기 1건" });
    await user.click(expandButton);

    const queueItem = await screen.findByTestId("taxonomy-queue-item");
    expect(queueItem).toHaveTextContent("협조전 회신");
    expect(queueItem).toHaveTextContent("신호 없음");

    // 후보 칩 클릭 → 업무 select에 반영
    await user.click(within(queueItem).getByRole("button", { name: "예산 관리" }));
    expect(within(queueItem).getByLabelText("협조전 회신 업무 선택")).toHaveValue("예산-관리");

    // 유형 선택 후 반영
    await user.selectOptions(within(queueItem).getByLabelText("협조전 회신 유형 선택"), "report");
    await user.click(within(queueItem).getByRole("button", { name: "반영" }));

    await waitFor(() =>
      expect(lastResolveBody).toEqual({ work_area_slug: "예산-관리", doc_role: "report" }),
    );
    expect(lastResolveUrl).toContain("/api/knowledge/taxonomy/queue/queue-1/resolve");

    // 해소된 항목은 목록에서 제거 + 토스트 안내
    await waitFor(() => expect(screen.queryByTestId("taxonomy-queue-item")).not.toBeInTheDocument());
    expect(await screen.findByText(/협조전 회신 분류를 반영했습니다/)).toBeInTheDocument();
  }, 15000);

  it("shows the work-area hub section in the wiki tree and the dashboard count pill", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));

    // 대시보드 카운트 필: 업무 N (있을 때만)
    const counts = await screen.findByTestId("knowledge-wiki-counts");
    await waitFor(() => expect(counts).toHaveTextContent("업무 1"));

    await user.click(screen.getByRole("tab", { name: "위키" }));
    const browser = await screen.findByTestId("knowledge-wiki-browser");
    const workAreaGroup = await within(browser).findByTestId("wiki-tree-work-areas");
    expect(workAreaGroup).toHaveTextContent("업무 (1)");

    // 업무 허브 페이지 열기
    await user.click(within(workAreaGroup).getByRole("button", { name: /예산 관리/ }));
    const wikiPage = await screen.findByTestId("knowledge-wiki-page");
    expect(wikiPage).toHaveTextContent("예산 관리");
    expect(wikiPage).toHaveTextContent("문서 12건");
    expect(screen.getByTestId("knowledge-wiki-breadcrumb")).toHaveTextContent("목차 / work-areas/예산-관리.md");
  }, 15000);

  it("auto-runs a folder scan when the proposal reports needs_scan, then re-analyzes (W7)", async () => {
    // 신설치 상태: 스캔 이력이 없어 proposal이 needs_scan=true + 후보 0개로 응답한다.
    proposalPayload = {
      ...TAXONOMY_PROPOSAL,
      work_areas: [],
      reference_shelves: [],
      doc_role_stats: {},
      families: [],
      governance_docs: [],
      hints: [],
      scanned_file_count: 0,
      needs_scan: true,
    };

    const user = userEvent.setup();
    render(<App />);

    await openSettingsTab(user);

    const entry = await screen.findByTestId("knowledge-taxonomy-entry");
    const wizardButton = within(entry).getByRole("button", { name: "분류체계 설정" });
    await waitFor(() => expect(wizardButton).toBeEnabled());
    await user.click(wizardButton);

    await screen.findByTestId("taxonomy-wizard");
    await user.click(screen.getByRole("button", { name: "다음" }));

    // 2단계 영역: 자동 스캔 진행 표시 (스캔 응답은 releaseScan 전까지 지연)
    const autoScan = await screen.findByTestId("taxonomy-auto-scan");
    expect(autoScan).toHaveTextContent("폴더를 먼저 스캔하고 있습니다");
    expect(screen.queryByTestId("taxonomy-review-step")).not.toBeInTheDocument();
    await waitFor(() => expect(scanRequests).toBe(1));

    // 스캔 완료 → proposal 재요청 → 후보 표시
    proposalPayload = { ...TAXONOMY_PROPOSAL, scanned_file_count: 12, needs_scan: false };
    releaseScan?.();

    await screen.findByTestId("taxonomy-review-step");
    expect(screen.queryByTestId("taxonomy-auto-scan")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("업무 이름")).toHaveLength(3);
    expect(screen.queryByTestId("taxonomy-empty-candidates")).not.toBeInTheDocument();
  }, 20000);

  it("explains zero candidates and warns that apply will index first when nothing is indexed (W7)", async () => {
    // 스캔은 되어 있지만 업무 폴더 패턴을 찾지 못한 폴더 — needs_scan=false + 후보 0개.
    proposalPayload = {
      ...TAXONOMY_PROPOSAL,
      work_areas: [],
      reference_shelves: [],
      doc_role_stats: {},
      families: [],
      governance_docs: [],
      hints: [],
      scanned_file_count: 42,
      needs_scan: false,
    };

    const user = userEvent.setup();
    render(<App />);

    await openSettingsTab(user);

    const entry = await screen.findByTestId("knowledge-taxonomy-entry");
    const wizardButton = within(entry).getByRole("button", { name: "분류체계 설정" });
    await waitFor(() => expect(wizardButton).toBeEnabled());
    await user.click(wizardButton);

    await screen.findByTestId("taxonomy-wizard");
    await user.click(screen.getByRole("button", { name: "다음" }));

    // 후보 0개: 칩만 두지 않고 원인 안내를 함께 표시한다. 자동 스캔은 돌지 않는다.
    await screen.findByTestId("taxonomy-review-step");
    expect(scanRequests).toBe(0);
    expect(screen.getByTestId("taxonomy-empty-candidates")).toHaveTextContent(
      "폴더 안에서 업무 폴더 패턴을 찾지 못했습니다. 아래에서 직접 업무를 추가하세요.",
    );
    expect(screen.getByText("업무 후보 0개")).toBeInTheDocument();

    // 직접 업무를 추가하고 확정하면 3단계로 진행된다.
    await user.type(screen.getByLabelText("새 업무 이름"), "국회 협력");
    await user.click(screen.getByRole("button", { name: "업무 추가" }));
    await user.click(screen.getByRole("button", { name: "이 체계로 확정" }));

    // 미색인 상태(색인 문서 0건) — 적용 시 색인이 먼저 실행됨을 확정 버튼 근처에 안내한다.
    await screen.findByTestId("taxonomy-apply-step");
    expect(screen.getByTestId("taxonomy-apply-index-notice")).toHaveTextContent(
      "색인이 아직 안 되어 있어, 적용 시 색인을 먼저 실행합니다",
    );
    expect(screen.getByRole("button", { name: "지금 적용" })).toBeEnabled();
  }, 20000);

  // -------------------------------------------------------------------------
  // WI-2 (hub-assignment): 저확신 후보 기본 제외 + 분류 대기 큐 일괄 반영
  // -------------------------------------------------------------------------

  it("auto-excludes low/vocab candidates by default with an opt-in include button (E15)", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openSettingsTab(user);
    const entry = await screen.findByTestId("knowledge-taxonomy-entry");
    const wizardButton = within(entry).getByRole("button", { name: "분류체계 설정" });
    await waitFor(() => expect(wizardButton).toBeEnabled());
    await user.click(wizardButton);

    await screen.findByTestId("taxonomy-wizard");
    await user.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByTestId("taxonomy-review-step");

    // 기본 제외: is-excluded + '자동 제외' pill, includedAreas 카운트(업무 후보)에서 빠진다.
    const auditCard = (screen.getByDisplayValue("감사").closest("article")) as HTMLElement;
    expect(auditCard.className).toContain("is-excluded");
    expect(within(auditCard).getByTestId("taxonomy-auto-excluded-pill")).toHaveTextContent(
      "자동 제외 — 근거 약함",
    );
    expect(screen.getByText("업무 후보 2개")).toBeInTheDocument();

    // opt-in: [포함] 클릭으로 카운트에 편입되고 pill이 사라진다.
    await user.click(within(auditCard).getByRole("button", { name: "포함" }));
    expect(auditCard.className).not.toContain("is-excluded");
    expect(within(auditCard).queryByTestId("taxonomy-auto-excluded-pill")).not.toBeInTheDocument();
    expect(screen.getByText("업무 후보 3개")).toBeInTheDocument();

    // 기본(제외) 상태로 되돌려 확정하면 payload에 미포함.
    await user.click(within(auditCard).getByRole("button", { name: "제외" }));
    await user.click(screen.getByRole("button", { name: "이 체계로 확정" }));
    await screen.findByTestId("taxonomy-apply-step");
    expect(lastConfirmBody).toEqual({
      source_id: "source-1",
      work_areas: [
        { name: "예산", folders: ["01. 예산"], keywords: [] },
        { name: "행사", folders: ["02. 행사"], keywords: [] },
      ],
      doc_roles_enabled: ["regulation", "manual", "plan", "report", "meeting", "official", "form", "reference"],
      family_policy: "latest_representative",
    });
  }, 20000);

  it("groups queue items by first-level folder and pre-selects the single candidate (WI-2)", async () => {
    taxonomyConfigured = true;
    qualityItems = [
      { source_id: "source-1", conflicts: 1, duplicates: 0, unclear_latest: 0, queue_count: 2, generated_at: "2026-07-14T00:20:00+09:00" },
    ];
    queueItems = [
      {
        id: "queue-1",
        source_id: "source-1",
        wiki_doc_id: "wd-1",
        doc_slug: "budget-attachment",
        title: "붙임 예산편성안",
        source_path: "C:/Docs/업무자료/01. 예산/붙임 예산편성안.hwp",
        reason: "conflict",
        status: "pending",
        candidates: {
          work_areas: [{ work_area_slug: "예산-관리", name: "예산 관리", signal: "folder" }],
          doc_roles: [],
        },
        created_at: "2026-07-14T00:21:00+09:00",
      },
      {
        id: "queue-2",
        source_id: "source-1",
        wiki_doc_id: "wd-2",
        doc_slug: "greeting-plan",
        title: "상견례 계획",
        source_path: "C:/Docs/업무자료/상견례 계획.hwp",
        reason: "no_signal",
        status: "pending",
        candidates: {
          work_areas: [
            { work_area_slug: "예산-관리", name: "예산 관리", signal: "keyword" },
            { work_area_slug: "행사", name: "행사", signal: "keyword" },
          ],
          doc_roles: [],
        },
        created_at: "2026-07-14T00:22:00+09:00",
      },
    ];

    const user = userEvent.setup();
    render(<App />);
    await openSettingsTab(user);

    const queueCard = await screen.findByTestId("knowledge-taxonomy-queue");
    await user.click(within(queueCard).getByRole("button", { name: "분류 대기 2건" }));

    // ① 1단계 폴더별 그룹 헤더: "01. 예산" 그룹 + 루트 직속 그룹.
    const groups = await screen.findAllByTestId("taxonomy-queue-group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByTestId("taxonomy-queue-group-header")).toHaveTextContent("01. 예산");
    expect(within(groups[1]).getByTestId("taxonomy-queue-group-header")).toHaveTextContent("루트 직속");

    // ② 후보가 정확히 1개인 항목은 업무 드롭다운이 기본 선택되어 있다.
    expect(screen.getByLabelText("붙임 예산편성안 업무 선택")).toHaveValue("예산-관리");
    // 후보가 2개인 항목은 기본 선택 없음(직접 골라야 한다).
    expect(screen.getByLabelText("상견례 계획 업무 선택")).toHaveValue("");
  }, 15000);

  it("bulk-resolves every single-candidate item via the recommended button (WI-2)", async () => {
    taxonomyConfigured = true;
    qualityItems = [
      { source_id: "source-1", conflicts: 2, duplicates: 0, unclear_latest: 0, queue_count: 3, generated_at: "2026-07-14T00:20:00+09:00" },
    ];
    queueItems = [
      {
        id: "queue-1",
        source_id: "source-1",
        title: "붙임 예산편성안",
        source_path: "C:/Docs/업무자료/01. 예산/붙임 예산편성안.hwp",
        reason: "conflict",
        status: "pending",
        candidates: {
          work_areas: [{ work_area_slug: "예산-관리", name: "예산 관리", signal: "folder" }],
          doc_roles: [],
        },
      },
      {
        id: "queue-2",
        source_id: "source-1",
        title: "행사 안내문",
        source_path: "C:/Docs/업무자료/02. 행사/행사 안내문.hwp",
        reason: "conflict",
        status: "pending",
        candidates: {
          work_areas: [{ work_area_slug: "행사", name: "행사", signal: "folder" }],
          doc_roles: [],
        },
      },
      {
        id: "queue-3",
        source_id: "source-1",
        title: "상견례 계획",
        source_path: "C:/Docs/업무자료/상견례 계획.hwp",
        reason: "no_signal",
        status: "pending",
        candidates: {
          work_areas: [
            { work_area_slug: "예산-관리", name: "예산 관리", signal: "keyword" },
            { work_area_slug: "행사", name: "행사", signal: "keyword" },
          ],
          doc_roles: [],
        },
      },
    ];

    const user = userEvent.setup();
    render(<App />);
    await openSettingsTab(user);

    const queueCard = await screen.findByTestId("knowledge-taxonomy-queue");
    await user.click(within(queueCard).getByRole("button", { name: "분류 대기 3건" }));
    await screen.findAllByTestId("taxonomy-queue-item");

    // 추천 일괄 반영 — 단일 후보 항목 전건(2건)만 그 후보 업무로 확정된다.
    await user.click(screen.getByRole("button", { name: "추천 일괄 반영 (2건)" }));

    await waitFor(() =>
      expect(bulkResolveTaxonomyQueueMock).toHaveBeenCalledWith([
        { id: "queue-1", work_area_slug: "예산-관리" },
        { id: "queue-2", work_area_slug: "행사" },
      ]),
    );
    expect(bulkResolveTaxonomyQueueMock).toHaveBeenCalledTimes(1);

    // 반영된 항목은 목록에서 제거되고 다중 후보 항목만 남는다.
    await waitFor(() => expect(screen.getAllByTestId("taxonomy-queue-item")).toHaveLength(1));
    expect(await screen.findByText(/추천 업무로 2건을 일괄 반영했습니다/)).toBeInTheDocument();
  }, 15000);

  it("applies one work area to a whole folder group from the group header (WI-2)", async () => {
    taxonomyConfigured = true;
    qualityItems = [
      { source_id: "source-1", conflicts: 0, duplicates: 0, unclear_latest: 0, queue_count: 2, generated_at: "2026-07-14T00:20:00+09:00" },
    ];
    queueItems = [
      {
        id: "queue-1",
        source_id: "source-1",
        title: "행사 계획(안)",
        source_path: "C:/Docs/업무자료/02. 행사/행사 계획(안).hwp",
        reason: "no_signal",
        status: "pending",
        candidates: { work_areas: [], doc_roles: [] },
      },
      {
        id: "queue-2",
        source_id: "source-1",
        title: "행사 결과보고",
        source_path: "C:/Docs/업무자료/02. 행사/행사 결과보고.hwp",
        reason: "no_signal",
        status: "pending",
        candidates: { work_areas: [], doc_roles: [] },
      },
    ];

    const user = userEvent.setup();
    render(<App />);
    await openSettingsTab(user);

    const queueCard = await screen.findByTestId("knowledge-taxonomy-queue");
    await user.click(within(queueCard).getByRole("button", { name: "분류 대기 2건" }));

    const group = await screen.findByTestId("taxonomy-queue-group");
    const groupButton = within(group).getByRole("button", { name: "이 그룹 전체를 [선택 업무]로 반영" });
    // 그룹 업무를 고르기 전에는 비활성.
    expect(groupButton).toBeDisabled();

    await user.selectOptions(within(group).getByLabelText("02. 행사 그룹 업무 선택"), "행사");
    await user.click(groupButton);

    await waitFor(() =>
      expect(bulkResolveTaxonomyQueueMock).toHaveBeenCalledWith([
        { id: "queue-1", work_area_slug: "행사" },
        { id: "queue-2", work_area_slug: "행사" },
      ]),
    );

    // 그룹 전체가 해소되어 빈 상태 안내가 뜬다.
    await waitFor(() => expect(screen.queryByTestId("taxonomy-queue-item")).not.toBeInTheDocument());
    expect(await screen.findByText(/02\. 행사 그룹 2건을 '행사' 업무로 반영했습니다/)).toBeInTheDocument();
  }, 15000);
});
