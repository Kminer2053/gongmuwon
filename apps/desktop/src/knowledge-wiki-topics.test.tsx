/**
 * 위키 UX 2026-07-12 계약 테스트:
 * ① 위키 뷰어 '← 이전' 히스토리(각주/연관 링크에서 직전 페이지 복귀)
 * ② 주제 상세화면 재분류(병합)·삭제 — confirm 후 API 계약 + 토스트 + 목차 복귀 + 트리 재조회
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const VOCAB_TOPICS = [
  { id: "budget-formulation", name: "예산편성", layer: "common", synonyms_count: 6, enabled: true },
  { id: "safety-mgmt-system", name: "안전보건경영시스템", layer: "institution", synonyms_count: 3, enabled: true },
  { id: "legacy-disabled", name: "폐지 주제", layer: "common", synonyms_count: 0, enabled: false },
];

const TOPIC_PAGE_CONTENT = [
  "---",
  "topic: 연말 정산",
  "slug: 연말-정산",
  "doc_count: 1",
  "---",
  "# 연말 정산",
  "",
  "## 관련 문서",
  "- [사업계획](../docs/plan-1.md) · 원본: C:/Docs/업무자료/plan.hwp",
  "",
].join("\n");

const DOC_PAGE_CONTENT = [
  "---",
  "title: 사업계획",
  "source_path: C:/Docs/업무자료/plan.hwp",
  "doc_type: 계획",
  "---",
  "# 사업계획",
  "",
  "## 개요",
  "지역 예산편성 사업의 추진배경입니다.",
  "",
].join("\n");

describe("wiki topic detail management and viewer back history (2026-07-12 UX)", () => {
  let wikiPages: Record<string, string>;
  let wikiTreeCalls: number;
  let lastMergeBody: Record<string, unknown> | undefined;
  let lastDeleteBody: Record<string, unknown> | undefined;

  beforeEach(() => {
    wikiPages = {
      "topics/연말-정산.md": TOPIC_PAGE_CONTENT,
      "docs/plan-1.md": DOC_PAGE_CONTENT,
    };
    wikiTreeCalls = 0;
    lastMergeBody = undefined;
    lastDeleteBody = undefined;

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

        // ---------------- 위키 UX 2026-07-12 계약 대상 엔드포인트 ----------------

        if (url.endsWith("/api/knowledge/wiki/topics/merge") && method === "POST") {
          lastMergeBody = body;
          return jsonResponse({ ok: true, retagged_docs: 1 });
        }

        if (url.endsWith("/api/knowledge/wiki/topics/delete") && method === "POST") {
          lastDeleteBody = body;
          return jsonResponse({ ok: true, retagged_docs: 1 });
        }

        if (url.includes("/api/knowledge/wiki/page")) {
          const path = new URL(url).searchParams.get("path") ?? "";
          const content = wikiPages[path];
          if (!content) {
            return jsonResponse({ detail: "wiki page not found" }, 404);
          }
          return jsonResponse({
            path: `/tmp/gongmu-workspace/knowledge-wiki/${path}`,
            relative_path: path,
            content,
          });
        }

        if (url.endsWith("/api/knowledge/wiki/tree")) {
          wikiTreeCalls += 1;
          return jsonResponse({
            topics: [
              { slug: "연말-정산", title: "연말 정산", doc_count: 1, path: "topics/연말-정산.md" },
            ],
            works: [],
            work_areas: [],
            sources: [
              {
                source_id: "source-1",
                label: "기획팀 업무자료",
                docs: [{ slug: "plan-1", title: "사업계획", path: "docs/plan-1.md" }],
              },
            ],
            counts: { docs: 1, topics: 1, works: 0, work_areas: 0 },
          });
        }

        if (url.endsWith("/api/knowledge/wiki/index")) {
          return jsonResponse({
            path: "/tmp/gongmu-workspace/knowledge-wiki/index.md",
            content: "# 지식폴더 위키\n",
          });
        }

        if (url.endsWith("/api/knowledge/vocab") && method === "GET") {
          return jsonResponse({
            layers: { common: 120, institution: null, user: 1 },
            topics: VOCAB_TOPICS,
          });
        }

        // ---------------- 기존 지식폴더 엔드포인트(최소) ----------------

        if (url.includes("/api/knowledge/vocab/candidates") && method === "GET") {
          return jsonResponse({ items: [] });
        }

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openTopicPage(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(await screen.findByRole("tab", { name: "위키" }));
    await user.click(await screen.findByRole("button", { name: /연말 정산/ }));
    return await screen.findByTestId("wiki-template-topics");
  }

  it("shows the back button only after in-page navigation and returns to the previous page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openTopicPage(user);

    // 첫 페이지: 히스토리가 비어 '← 이전'은 숨김.
    expect(screen.queryByTestId("knowledge-wiki-back")).not.toBeInTheDocument();

    // 주제 페이지의 관련 문서 카드로 이동 → 문서 페이지 + '← 이전' 노출.
    const page = screen.getByTestId("knowledge-wiki-page");
    await user.click(within(page).getByRole("button", { name: /관련 문서 사업계획/ }));
    await screen.findByTestId("wiki-template-docs");
    expect(screen.getByTestId("knowledge-wiki-breadcrumb")).toHaveTextContent("docs/plan-1.md");

    // '← 이전' → 직전(주제) 페이지 복귀 + 스택이 비어 버튼 숨김.
    await user.click(screen.getByTestId("knowledge-wiki-back"));
    await screen.findByTestId("wiki-template-topics");
    expect(screen.getByTestId("knowledge-wiki-breadcrumb")).toHaveTextContent("topics/연말-정산.md");
    expect(screen.queryByTestId("knowledge-wiki-back")).not.toBeInTheDocument();
  }, 20000);

  it("merges the topic into a selected vocab topic after confirm, then returns to the toc and refreshes the tree", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<App />);
    const topicPage = await openTopicPage(user);

    // 병합 대상 셀렉트 — enabled 어휘집 주제만 노출된다.
    const manage = within(topicPage).getByTestId("wiki-topic-manage");
    const select = within(manage).getByLabelText("연말 정산 병합 대상 주제 선택");
    expect(within(select).queryByRole("option", { name: "폐지 주제" })).not.toBeInTheDocument();
    const mergeButton = within(manage).getByRole("button", { name: "다른 주제로 병합" });
    expect(mergeButton).toBeDisabled();

    const treeCallsBefore = wikiTreeCalls;
    await user.selectOptions(select, "budget-formulation");
    await user.click(mergeButton);

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("'예산편성' 주제로 병합"));
    await waitFor(() =>
      expect(lastMergeBody).toEqual({ topic: "연말 정산", into_topic_id: "budget-formulation" }),
    );
    // 성공 토스트 + 목차 복귀 + 위키 트리 재조회.
    expect(
      await screen.findByText(/'연말 정산' 주제를 '예산편성'\(으\)로 병합했습니다 — 문서 1건 재분류/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("knowledge-wiki-page")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(wikiTreeCalls).toBeGreaterThan(treeCallsBefore));
  }, 20000);

  it("deletes the topic only after confirm and shows the removal toast", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<App />);
    const topicPage = await openTopicPage(user);
    const manage = within(topicPage).getByTestId("wiki-topic-manage");

    // confirm 취소 → API 호출 없음, 페이지 유지.
    await user.click(within(manage).getByRole("button", { name: "주제 삭제" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("'연말 정산' 주제를 삭제할까요?"));
    expect(lastDeleteBody).toBeUndefined();
    expect(screen.getByTestId("knowledge-wiki-page")).toBeInTheDocument();

    // confirm 승인 → POST {topic} + 토스트 + 목차 복귀.
    confirmSpy.mockReturnValue(true);
    await user.click(within(manage).getByRole("button", { name: "주제 삭제" }));
    await waitFor(() => expect(lastDeleteBody).toEqual({ topic: "연말 정산" }));
    expect(
      await screen.findByText(/'연말 정산' 주제를 삭제했습니다 — 문서 1건에서 제거/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("knowledge-wiki-page")).not.toBeInTheDocument(),
    );
  }, 20000);
});
