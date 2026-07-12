import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

/** 규격 §5: 결합 어휘집 주제 목록 — 후보 병합 대상 셀렉트에 채워진다. */
const VOCAB_TOPICS = [
  { id: "safety-mgmt-system", name: "안전보건경영시스템", layer: "institution", synonyms_count: 3, enabled: true },
  { id: "budget", name: "예산 편성", layer: "common", synonyms_count: 2, enabled: true },
  { id: "legacy-disabled", name: "폐지 주제", layer: "common", synonyms_count: 0, enabled: false },
];

describe("topic vocabulary pack import and candidate queue (vocab spec §5·§6)", () => {
  let institutionPack: { name: string; version: string; topics: number } | null;
  let packImportResponse: Record<string, unknown>;
  let vocabCandidates: Array<Record<string, unknown>>;
  let enrichmentStatus: Record<string, unknown>;
  let lastPackBody: Record<string, unknown> | undefined;
  let packDeleteCount: number;
  let lastDecisionUrl: string | undefined;
  let lastDecisionBody: Record<string, unknown> | undefined;

  beforeEach(() => {
    institutionPack = null;
    packImportResponse = {
      ok: true,
      imported: { name: "코레일유통 AI혁신처 어휘집", version: "1.0.0", topics: 42 },
      errors: [],
      warnings: [],
    };
    vocabCandidates = [];
    enrichmentStatus = { configured: true };
    lastPackBody = undefined;
    packDeleteCount = 0;
    lastDecisionUrl = undefined;
    lastDecisionBody = undefined;

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

        // ---------------- 어휘집 규격 §5·§6 엔드포인트 ----------------

        if (url.includes("/api/knowledge/vocab/candidates/") && url.endsWith("/decision") && method === "POST") {
          lastDecisionUrl = url;
          lastDecisionBody = body;
          const candidateId = decodeURIComponent(
            url.split("/api/knowledge/vocab/candidates/")[1].split("/decision")[0],
          );
          vocabCandidates = vocabCandidates.filter((item) => item.id !== candidateId);
          return jsonResponse({ ok: true, item: { id: candidateId, status: "decided" } });
        }

        if (url.includes("/api/knowledge/vocab/candidates") && method === "GET") {
          return jsonResponse({ items: vocabCandidates });
        }

        if (url.endsWith("/api/knowledge/vocab/pack") && method === "POST") {
          lastPackBody = body;
          const imported = packImportResponse.imported as
            | { name: string; version: string; topics: number }
            | null
            | undefined;
          if (packImportResponse.ok && imported) {
            institutionPack = imported;
          }
          return jsonResponse(packImportResponse);
        }

        if (url.endsWith("/api/knowledge/vocab/pack") && method === "DELETE") {
          packDeleteCount += 1;
          institutionPack = null;
          return jsonResponse({ ok: true });
        }

        if (url.endsWith("/api/knowledge/vocab") && method === "GET") {
          return jsonResponse({
            layers: { common: 120, institution: institutionPack, user: 2 },
            topics: VOCAB_TOPICS,
          });
        }

        // ---------------- 기존 지식폴더 엔드포인트(최소) ----------------

        if (url.includes("/api/knowledge/taxonomy/queue") && method === "GET") {
          return jsonResponse({ items: [] });
        }

        if (url.includes("/api/knowledge/taxonomy/quality") && method === "GET") {
          return jsonResponse({ configured: false, items: [] });
        }

        if (url.includes("/api/knowledge/taxonomy/interview")) {
          return jsonResponse({ interview: null });
        }

        if (url.includes("/api/knowledge/taxonomy") && method === "GET") {
          return jsonResponse({ configured: false, items: [], interview: null });
        }

        if (url.endsWith("/api/knowledge/verify/latest")) {
          return jsonResponse({ report: null });
        }

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
            llm_enrichment: enrichmentStatus,
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
            topics: [],
            works: [],
            work_areas: [],
            sources: [],
            counts: { docs: 0, topics: 0, works: 0, work_areas: 0 },
          });
        }

        if (url.endsWith("/api/knowledge/wiki/index")) {
          return jsonResponse({
            path: "/tmp/gongmu-workspace/knowledge-wiki/index.md",
            content: "# 지식폴더 위키\n",
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

  it("imports an institution pack from the settings tab, shows applied info, and removes it (§5)", async () => {
    packImportResponse = {
      ok: true,
      imported: { name: "코레일유통 AI혁신처 어휘집", version: "1.0.0", topics: 42 },
      errors: [],
      warnings: ["동의어 20개 초과 항목 1건은 앞 20개만 사용합니다."],
    };

    const user = userEvent.setup();
    render(<App />);
    await openSettingsTab(user);

    // 위키 구성 카드 안의 기관 어휘집 팩 블록 — 처음에는 미적용
    const block = await screen.findByTestId("knowledge-vocab-pack");
    await waitFor(() =>
      expect(within(block).getByTestId("knowledge-vocab-pack-status")).toHaveTextContent("미적용"),
    );
    expect(within(block).queryByRole("button", { name: "팩 제거" })).not.toBeInTheDocument();

    // 경로 입력 → 팩 불러오기 → POST {path} 계약 검증
    await user.type(within(block).getByLabelText("팩 파일 경로"), "C:/Docs/기관팩.gongmu-vocab.json");
    await user.click(within(block).getByRole("button", { name: "팩 불러오기" }));
    await waitFor(() => expect(lastPackBody).toEqual({ path: "C:/Docs/기관팩.gongmu-vocab.json" }));

    // 성공: 이름·버전·주제 수 + 경고 목록 + 적용 중 상태 갱신
    expect(await within(block).findByTestId("knowledge-vocab-import-result")).toHaveTextContent(
      "불러오기 완료 — 코레일유통 AI혁신처 어휘집 v1.0.0 · 주제 42개",
    );
    expect(within(block).getByTestId("knowledge-vocab-import-warnings")).toHaveTextContent(
      "동의어 20개 초과 항목 1건은 앞 20개만 사용합니다.",
    );
    await waitFor(() =>
      expect(within(block).getByTestId("knowledge-vocab-pack-status")).toHaveTextContent(
        "코레일유통 AI혁신처 어휘집 · v1.0.0 · 주제 42개",
      ),
    );
    expect(await screen.findByText(/기관 어휘집 팩을 적용했습니다/)).toBeInTheDocument();

    // 팩 제거 → DELETE 계약 + 미적용 복귀
    await user.click(within(block).getByRole("button", { name: "팩 제거" }));
    await waitFor(() => expect(packDeleteCount).toBe(1));
    await waitFor(() =>
      expect(within(block).getByTestId("knowledge-vocab-pack-status")).toHaveTextContent("미적용"),
    );
    expect(await screen.findByText(/기관 어휘집 팩을 제거했습니다/)).toBeInTheDocument();
  }, 20000);

  it("renders the full validation error list and keeps the pack unapplied on import failure (§5)", async () => {
    packImportResponse = {
      ok: false,
      imported: null,
      errors: [
        "id 형식 오류: 'Safety Mgmt' — 영문 소문자·숫자·하이픈만 허용됩니다.",
        "정규화 키 충돌: '안전보건' (common:safety)",
      ],
      warnings: [],
    };

    const user = userEvent.setup();
    render(<App />);
    await openSettingsTab(user);

    const block = await screen.findByTestId("knowledge-vocab-pack");
    await user.type(within(block).getByLabelText("팩 파일 경로"), "C:/Docs/잘못된팩.gongmu-vocab.json");
    await user.click(within(block).getByRole("button", { name: "팩 불러오기" }));

    // 부분 임포트 금지: 오류 목록 전체 표시 + 미적용 유지
    const errorBox = await within(block).findByTestId("knowledge-vocab-import-errors");
    expect(errorBox).toHaveTextContent("id 형식 오류: 'Safety Mgmt' — 영문 소문자·숫자·하이픈만 허용됩니다.");
    expect(errorBox).toHaveTextContent("정규화 키 충돌: '안전보건' (common:safety)");
    expect(within(block).getByTestId("knowledge-vocab-pack-status")).toHaveTextContent("미적용");
    expect(await screen.findByText(/어휘집 팩 검증에 실패했습니다/)).toBeInTheDocument();
  }, 20000);

  it("approves and merges pending vocab candidates from the settings section (§6)", async () => {
    vocabCandidates = [
      {
        id: "cand-1",
        name: "스마트 안전관리",
        norm_key: "스마트안전관리",
        hit_count: 4,
        sample_docs: ["C:/Docs/업무자료/스마트안전 구축계획.hwp"],
        status: "pending",
        first_seen_at: "2026-07-10T00:00:00+09:00",
      },
      {
        id: "cand-2",
        name: "ISO 45001 인증",
        norm_key: "iso45001인증",
        hit_count: 2,
        sample_docs: [{ title: "인증 심사 결과 보고", file_path: "C:/Docs/업무자료/심사결과.hwp" }],
        status: "pending",
        first_seen_at: "2026-07-11T00:00:00+09:00",
      },
    ];

    const user = userEvent.setup();
    render(<App />);
    await openSettingsTab(user);

    const section = await screen.findByTestId("knowledge-vocab-candidates");
    const items = await within(section).findAllByTestId("vocab-candidate-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("스마트 안전관리");
    expect(items[0]).toHaveTextContent("등장 4회");
    expect(items[0]).toHaveTextContent("표본 문서");

    // 승인 — POST {action:"approve"} + 목록 제거 + 토스트
    await user.click(within(items[0]).getByRole("button", { name: "승인" }));
    await waitFor(() => expect(lastDecisionBody).toEqual({ action: "approve" }));
    expect(lastDecisionUrl).toContain("/api/knowledge/vocab/candidates/cand-1/decision");
    await waitFor(() =>
      expect(within(section).getAllByTestId("vocab-candidate-item")).toHaveLength(1),
    );
    expect(await screen.findByText(/'스마트 안전관리' 주제를 어휘집에 추가했습니다/)).toBeInTheDocument();

    // 병합 — 기존 주제 셀렉트(GET /vocab topics, enabled만)에서 대상 선택 후 merge_into_id 전달
    const remaining = within(section).getByTestId("vocab-candidate-item");
    const mergeSelect = within(remaining).getByLabelText("ISO 45001 인증 병합 대상 선택");
    expect(within(mergeSelect).queryByRole("option", { name: "폐지 주제" })).not.toBeInTheDocument();
    await user.selectOptions(mergeSelect, "safety-mgmt-system");
    await user.click(within(remaining).getByRole("button", { name: "병합" }));
    await waitFor(() =>
      expect(lastDecisionBody).toEqual({ action: "merge", merge_into_id: "safety-mgmt-system" }),
    );
    expect(lastDecisionUrl).toContain("/api/knowledge/vocab/candidates/cand-2/decision");
    await waitFor(() =>
      expect(within(section).queryByTestId("vocab-candidate-item")).not.toBeInTheDocument(),
    );
    expect(within(section).getByText("대기 중인 주제 후보가 없습니다.")).toBeInTheDocument();
  }, 20000);

  it("shows the pending-candidate badge on the dashboard enrich card and the compact pack block in wizard step 1", async () => {
    enrichmentStatus = { configured: true, vocab_candidates_pending: 3 };

    const user = userEvent.setup();
    render(<App />);

    // 대시보드 LLM 요약 보강 카드 — 주제 후보 대기 배지(>0일 때만)
    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    const badge = await screen.findByTestId("knowledge-status-vocab-pending");
    expect(badge).toHaveTextContent("주제 후보 대기 3건");

    // 분류체계 마법사 1단계 하단 — 어휘집 팩 축약 블록(경로 입력 + 불러오기 + 상태)
    await user.click(screen.getByRole("tab", { name: "설정" }));
    const entry = await screen.findByTestId("knowledge-taxonomy-entry");
    const wizardButton = within(entry).getByRole("button", { name: "분류체계 설정" });
    await waitFor(() => expect(wizardButton).toBeEnabled());
    await user.click(wizardButton);

    const wizard = await screen.findByTestId("taxonomy-wizard");
    const compact = await within(wizard).findByTestId("knowledge-vocab-pack-compact");
    expect(within(compact).getByLabelText("팩 파일 경로")).toBeInTheDocument();
    expect(within(compact).getByRole("button", { name: "팩 불러오기" })).toBeDisabled();
    await waitFor(() =>
      expect(within(compact).getByTestId("knowledge-vocab-pack-status")).toHaveTextContent("미적용"),
    );
  }, 20000);
});
