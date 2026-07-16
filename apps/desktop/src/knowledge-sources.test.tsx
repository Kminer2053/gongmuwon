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
  setDesktopZoom: vi.fn(async (scale: number) => scale),
}));

import { App } from "./app";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

async function openSettingsTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
  await user.click(screen.getByRole("tab", { name: "설정" }));
}

// T5(4호): 설정 탭 3분할 서브내비 — 분류·어휘/유지관리 항목은 해당 서브섹션을 먼저 선택해야 렌더된다.
async function openSettingsSection(
  user: ReturnType<typeof userEvent.setup>,
  section: "folders" | "taxonomy" | "maintenance",
) {
  await openSettingsTab(user);
  await user.click(screen.getByTestId(`knowledge-settings-nav-${section}`));
}

async function registerSource(user: ReturnType<typeof userEvent.setup>, label: string) {
  await openSettingsTab(user);
  await user.click(screen.getByText("지식 소스 등록 설정"));
  await user.type(screen.getByLabelText("소스 이름"), label);
  await user.click(screen.getByRole("button", { name: "폴더 선택" }));
  await user.click(screen.getByRole("button", { name: "지식 소스 등록" }));
  await screen.findAllByText(label);
}

describe("knowledge source folders", () => {
  let lastKnowledgeIngestBody: Record<string, unknown> | undefined;
  let lastKnowledgeReindexBody: Record<string, unknown> | undefined;
  let lastKnowledgeEnrichBody: Record<string, unknown> | undefined;
  let lastCanceledIngestionJobId: string | undefined;
  let lastFileLinkBody: Record<string, unknown> | undefined;
  let nextKnowledgeIngestionStatus: string | undefined;
  let llmEnrichmentConfigured: boolean;
  let wikiTreeAvailable: boolean;
  let wikiIndexAvailable: boolean;
  let searchResultsAvailable: boolean;
  // P1 변경 확인(diff) 응답 — 테스트별로 변경 0/변경 있음/게이트 초과를 구성한다.
  let knowledgeDiffPayload: Record<string, unknown>;
  // P0 후속: 스캔 응답의 보류(unstable) 파일 수.
  let scanUnstableCount: number;
  // W7 §5.5/§5.6: 위키 트리 응답 — 사본 배지·원본 없는 카드 그룹 테스트에서 재구성한다.
  let wikiTreePayload: Record<string, unknown>;

  beforeEach(() => {
    let knowledgeSources: Array<Record<string, unknown>> = [];
    let knowledgeSourceFiles: Array<Record<string, unknown>> = [];
    let knowledgeIngestionJobs: Array<Record<string, unknown>> = [];
    let knowledgeDocuments: Array<Record<string, unknown>> = [];
    lastKnowledgeIngestBody = undefined;
    lastKnowledgeReindexBody = undefined;
    lastKnowledgeEnrichBody = undefined;
    lastCanceledIngestionJobId = undefined;
    lastFileLinkBody = undefined;
    nextKnowledgeIngestionStatus = undefined;
    llmEnrichmentConfigured = true;
    wikiTreeAvailable = true;
    wikiIndexAvailable = true;
    searchResultsAvailable = true;
    knowledgeDiffPayload = {
      added: 0,
      modified: 0,
      moved: 0,
      deleted: 0,
      unchanged: 12,
      unstable: 0,
      rehash_estimate: { files: 0, bytes: 0 },
      exceeds_gate: false,
    };
    scanUnstableCount = 0;
    wikiTreePayload = {
      topics: [{ slug: "budget-topic", title: "예산", doc_count: 2, path: "topics/budget-topic.md" }],
      works: [
        {
          slug: "work-minwon",
          title: "민원 개선 작업 기록",
          session_id: "session-1",
          updated_at: "2026-05-06T00:00:00+09:00",
          path: "works/work-minwon.md",
        },
      ],
      sources: [
        {
          source_id: "source-1",
          label: "기획팀 업무자료",
          docs: [
            { slug: "service", title: "공공서비스 개선계획", path: "docs/service.md", quality_score: 0.85 },
            { slug: "budget", title: "예산 검토", path: "docs/budget.md", quality_score: 0.9 },
          ],
        },
      ],
      counts: { docs: 2, topics: 1, works: 1 },
    };

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

        if (url.endsWith("/api/knowledge/sources") && method === "GET") {
          return jsonResponse({ items: knowledgeSources });
        }

        if (url.endsWith("/api/knowledge/sources") && method === "POST") {
          const created = {
            id: "source-1",
            label: body.label,
            root_path: body.root_path,
            status: "active",
            last_scanned_at: null,
            created_at: "2026-04-28T00:00:00+09:00",
            updated_at: "2026-04-28T00:00:00+09:00",
          };
          knowledgeSources = [created];
          return jsonResponse(created, 201);
        }

        if (url.endsWith("/api/knowledge/sources/source-1/scan") && method === "POST") {
          knowledgeSources = [
            {
              ...knowledgeSources[0],
              last_scanned_at: "2026-04-28T00:10:00+09:00",
            },
          ];
          knowledgeSourceFiles = [
            {
              id: "file-1",
              source_id: "source-1",
              file_path: "C:/Docs/업무자료/budget.md",
              relative_path: "budget.md",
              file_hash: "abc",
              size_bytes: 120,
              modified_at: "2026-04-28T00:00:00+09:00",
              status: "indexed",
              title: "예산 검토",
              mime_type: "text/markdown",
              text_excerpt: "예산 편성 회의자료를 정리한다.",
              extracted_text_path: "/tmp/gongmu-workspace/knowledge/raw/source-files/source-1/abc.txt",
              created_at: "2026-04-28T00:00:00+09:00",
              updated_at: "2026-04-28T00:10:00+09:00",
            },
          ];
          return jsonResponse({
            source_id: "source-1",
            status: "completed",
            indexed_count: 1,
            metadata_count: 0,
            deleted_count: 0,
            failed_count: 0,
            unstable_count: scanUnstableCount,
            scanned_at: "2026-04-28T00:10:00+09:00",
          });
        }

        if (url.endsWith("/api/knowledge/sources/source-1/diff") && method === "GET") {
          return jsonResponse(knowledgeDiffPayload);
        }

        if (url.endsWith("/api/knowledge/ingest") && method === "POST") {
          lastKnowledgeIngestBody = body;
          const status = nextKnowledgeIngestionStatus ?? (body.run_now ? "completed" : "queued");
          const isCompleted = status === "completed";
          const isRunning = status === "running";
          const created = {
            id: "job-1",
            source_id: body.source_id,
            status,
            current_stage: isCompleted ? "위키 갱신" : isRunning ? "FTS 색인" : "폴더 스캔",
            current_stage_index: isCompleted ? 3 : isRunning ? 2 : 0,
            stage_count: 4,
            progress_percent: isCompleted ? 100 : isRunning ? 45 : 0,
            queued_count: 1,
            processed_count: isCompleted ? 1 : 0,
            failed_count: 0,
            deleted_document_count: isCompleted ? 1 : 0,
            skipped_count: isCompleted ? 2 : 0,
            force_rebuild: 0,
            cancel_requested: 0,
            last_processed_path: isCompleted ? "budget.md" : null,
            last_processed_at: isCompleted ? "2026-05-06T00:12:40+09:00" : null,
            duration_ms: isCompleted ? 120 : null,
            average_ms_per_file: isCompleted ? 120 : null,
            error_message: null,
            log_dump_path: "/tmp/gongmu-workspace/logs/knowledge-ingestion/job-1.jsonl",
            diagnostic_event_count: isCompleted ? 12 : isRunning ? 6 : 1,
            last_diagnostic_message: isCompleted
              ? "지식 위키 갱신 완료"
              : isRunning
                ? "FTS 색인 단계 처리 중"
                : "색인 작업 생성",
            started_at: isCompleted || isRunning ? "2026-05-06T00:12:00+09:00" : null,
            completed_at: isCompleted ? "2026-05-06T00:13:00+09:00" : null,
            created_at: "2026-05-06T00:12:00+09:00",
          };
          knowledgeIngestionJobs = [created];
          knowledgeDocuments = [
            {
              id: "doc-1",
              source_file_id: "file-1",
              source_id: body.source_id,
              file_path: "C:/Docs/업무자료/budget.md",
              title: "예산 검토",
              document_type: "md",
              document_number: null,
              sender_org: null,
              receiver_org: null,
              issued_date: null,
              security_level: null,
              attachment_count: 0,
              parser_name: "gongmu-markdown",
              parser_version: "",
              quality_score: 0.85,
              partial: false,
              metadata: {
                extraction_quality: {
                  parser_name: "gongmu-markdown",
                  parser_version: "",
                  score: 0.85,
                  section_count: 2,
                  paragraph_count: 1,
                  table_count: 1,
                  text_char_count: 42,
                  metadata_field_count: 1,
                  partial: false,
                  warnings: [],
                },
              },
              section_count: 2,
              table_count: 1,
              chunk_count: 3,
              table_chunk_count: 1,
              created_at: "2026-05-06T00:12:00+09:00",
              updated_at: "2026-05-06T00:13:00+09:00",
            },
            {
              id: "doc-2",
              source_file_id: "file-2",
              source_id: body.source_id,
              file_path: "C:/Docs/업무자료/scanned.pdf",
              title: "스캔 문서",
              document_type: "pdf",
              document_number: null,
              sender_org: null,
              receiver_org: null,
              issued_date: null,
              security_level: null,
              attachment_count: 0,
              parser_name: "gongmu-pdf",
              parser_version: "",
              quality_score: 0.2,
              partial: true,
              metadata: {
                extraction_quality: {
                  parser_name: "gongmu-pdf",
                  parser_version: "",
                  score: 0.2,
                  section_count: 1,
                  paragraph_count: 0,
                  table_count: 0,
                  text_char_count: 8,
                  metadata_field_count: 0,
                  partial: true,
                  warnings: ["partial_extraction", "low_text"],
                },
              },
              section_count: 1,
              table_count: 0,
              chunk_count: 1,
              table_chunk_count: 0,
              created_at: "2026-05-06T00:12:00+09:00",
              updated_at: "2026-05-06T00:13:00+09:00",
            },
          ];
          return jsonResponse({ job: created }, 201);
        }

        if (url.endsWith("/api/knowledge/reindex") && method === "POST") {
          lastKnowledgeReindexBody = body;
          const created = {
            id: "job-force",
            source_id: body.source_id,
            status: "queued",
            current_stage: "폴더 스캔",
            current_stage_index: 0,
            stage_count: 4,
            progress_percent: 0,
            queued_count: 1,
            processed_count: 0,
            failed_count: 0,
            deleted_document_count: 0,
            skipped_count: 0,
            force_rebuild: 1,
            duration_ms: null,
            average_ms_per_file: null,
            error_message: null,
            log_dump_path: "/tmp/gongmu-workspace/logs/knowledge-ingestion/job-force.jsonl",
            diagnostic_event_count: 1,
            last_diagnostic_message: "색인 작업 생성",
            started_at: null,
            completed_at: null,
            created_at: "2026-05-06T00:14:00+09:00",
          };
          knowledgeIngestionJobs = [created];
          return jsonResponse({ job: created }, 201);
        }

        if (url.endsWith("/api/knowledge/enrich") && method === "POST") {
          lastKnowledgeEnrichBody = body;
          return jsonResponse(
            {
              work_job: {
                id: "job-enrich",
                kind: "knowledge.enrich",
                title: "지식위키 LLM 보강",
                status: "running",
                priority: 5,
                resource_key: "knowledge_wiki:enrich",
                resource_policy: "exclusive",
                progress_percent: 0,
                current_stage: "enrich",
                cancel_requested: false,
                created_at: "2026-05-06T00:15:00+09:00",
                queued_at: "2026-05-06T00:15:00+09:00",
              },
            },
            201,
          );
        }

        if (url.endsWith("/api/knowledge/ingestion-jobs") && method === "GET") {
          return jsonResponse({ items: knowledgeIngestionJobs });
        }

        if (url.includes("/api/knowledge/ingestion-jobs/") && url.includes("/log") && method === "GET") {
          return jsonResponse({
            job_id: "job-1",
            log_dump_path: "/tmp/gongmu-workspace/logs/knowledge-ingestion/job-1.jsonl",
            limit: 120,
            items: [
              { event: "job.started", stage: "scan", message: "지식폴더 색인 시작" },
              { event: "file.parsed", stage: "extract", title: "예산 검토", quality_score: 0.85 },
              { event: "job.completed", stage: "wiki", status: "completed" },
            ],
          });
        }

        if (url.includes("/api/knowledge/ingestion-jobs/") && url.endsWith("/cancel") && method === "POST") {
          const jobId = url.split("/api/knowledge/ingestion-jobs/")[1].split("/cancel")[0];
          lastCanceledIngestionJobId = decodeURIComponent(jobId);
          knowledgeIngestionJobs = knowledgeIngestionJobs.map((job) =>
            job.id === lastCanceledIngestionJobId ? { ...job, status: "canceled", cancel_requested: 1 } : job,
          );
          return jsonResponse({ job: knowledgeIngestionJobs[0] });
        }

        if (url.endsWith("/api/knowledge/documents") && method === "GET") {
          return jsonResponse({ items: knowledgeDocuments });
        }

        if (url.endsWith("/api/knowledge/source-files")) {
          return jsonResponse({ items: knowledgeSourceFiles });
        }

        if (url.includes("/api/knowledge/search?")) {
          if (!searchResultsAvailable) {
            return jsonResponse({
              query: new URL(url, "http://localhost").searchParams.get("query") ?? "",
              mode: "fts5",
              items: [],
            });
          }
          return jsonResponse({
            query: new URL(url, "http://localhost").searchParams.get("query") ?? "",
            mode: "fts5",
            items: [
              {
                doc_id: "wiki-1",
                document_id: "doc-1",
                title: "공공서비스 개선계획",
                source_path: "C:/Docs/업무자료/service.md",
                relative_path: "service.md",
                snippet: "개인정보 처리 기준을 점검한다",
                score: 1.42,
                quality_score: 0.85,
                warnings: ["low_text"],
                card_path: "/tmp/gongmu-workspace/knowledge/wiki/docs/service.md",
                slug: "service",
              },
            ],
          });
        }

        // 지연 생성: body가 없는 GET 요청이 이 줄에 닿아도 터지지 않도록 함수로 감싼다.
        const buildAskPayload = () => ({
          query: body.query,
          session_id: body.session_id,
          answer:
            "'개인정보보호법'에 대해 로컬 지식폴더에서 확인한 근거입니다.\n1. 공공서비스 개선계획: 개인정보 처리 기준을 점검합니다.",
          answer_mode: "llm",
          citations: [
            {
              doc_id: "wiki-1",
              document_id: "doc-1",
              title: "공공서비스 개선계획",
              source_path: "C:/Docs/업무자료/service.md",
              file_path: "C:/Docs/업무자료/service.md",
              snippet: "개인정보 처리 기준을 점검합니다.",
              quality_score: 0.85,
              quality_warnings: ["partial_extraction"],
              card_path: "/tmp/gongmu-workspace/knowledge/wiki/docs/service.md",
              evidence_type: "wiki",
              relations: [],
            },
          ],
          retrieval_summary: { source_count: 1, hit_count: 1, low_quality_count: 0 },
          items: [],
        });

        if (url.endsWith("/api/knowledge/ask/stream") && method === "POST") {
          const askPayload = buildAskPayload();
          const encoder = new TextEncoder();
          return Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    encoder.encode(
                      [
                        `event: meta\ndata: ${JSON.stringify({ query: body.query, has_items: true })}\n`,
                        `event: delta\ndata: ${JSON.stringify({ text: "'개인정보보호법'에 대해 로컬 지식폴더에서 확인한 근거입니다.\n1. 공공서비스 개선계획: " })}\n`,
                        `event: delta\ndata: ${JSON.stringify({ text: "개인정보 처리 기준을 점검합니다." })}\n`,
                        `event: done\ndata: ${JSON.stringify(askPayload)}\n`,
                      ].join("\n"),
                    ),
                  );
                  controller.close();
                },
              }),
              { status: 200, headers: { "Content-Type": "text/event-stream" } },
            ),
          );
        }

        if (url.endsWith("/api/knowledge/ask") && method === "POST") {
          return jsonResponse(buildAskPayload());
        }

        if (url.includes("/api/knowledge/document-structure")) {
          return jsonResponse({
            document: {
              id: "doc-1",
              title: "공공서비스 개선계획",
              file_path: "C:/Docs/업무자료/service.md",
              document_type: "md",
              parser_name: "gongmu-markdown",
              quality_score: 0.85,
              partial: false,
              chunk_count: 3,
              table_chunk_count: 1,
              metadata: {
                document_number: "GONGMU-2026-01",
                extraction_quality: {
                  parser_name: "gongmu-markdown",
                  parser_version: "",
                  score: 0.85,
                  section_count: 2,
                  paragraph_count: 2,
                  table_count: 1,
                  text_char_count: 54,
                  metadata_field_count: 1,
                  partial: false,
                  warnings: [],
                },
              },
            },
            sections: [
              {
                id: "section-1",
                document_id: "doc-1",
                heading: "추진배경",
                level: 2,
                order_index: 0,
                text: "민원 처리 시간을 줄이기 위한 배경을 정리한다.",
                tables: [],
              },
              {
                id: "section-2",
                document_id: "doc-1",
                heading: "세부추진계획",
                level: 2,
                order_index: 1,
                text: "서비스 개선 과제를 단계별로 실행한다.",
                tables: [
                  {
                    id: "table-1",
                    document_id: "doc-1",
                    section_id: "section-2",
                    order_index: 0,
                    caption: "사업별 예산",
                    headers: ["항목", "예산"],
                    rows: [["공공서비스 포털", "100"]],
                    created_at: "2026-05-06T00:00:00+09:00",
                  },
                ],
              },
            ],
          });
        }

        if (url.includes("/api/knowledge/tables")) {
          return jsonResponse({
            items: [
              {
                id: "table-1",
                document_id: "doc-1",
                section_id: "section-2",
                order_index: 0,
                caption: "사업별 예산",
                headers: ["항목", "예산"],
                rows: [["공공서비스 포털", "100"]],
                created_at: "2026-05-06T00:00:00+09:00",
              },
            ],
          });
        }

        if (url.endsWith("/api/knowledge/backend-status")) {
          return jsonResponse({
            engine: "wiki",
            fts5: { ok: true, tokenizer: "trigram" },
            kordoc: { available: true },
            llm_enrichment: { configured: llmEnrichmentConfigured },
            backends: [
              {
                name: "wiki_markdown",
                role: "knowledge_store",
                available: true,
                storage_path: "/tmp/gongmu-workspace/knowledge/wiki",
                detail: "Obsidian 호환 Markdown 위키",
              },
              {
                name: "sqlite_fts5",
                role: "search",
                available: true,
                tokenizer: "trigram",
                storage_path: "/tmp/gongmu-workspace/db/gongmu.db",
                detail: "3자 이상 trigram BM25, 미만은 LIKE 폴백",
              },
            ],
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
          if (!wikiTreeAvailable) {
            return jsonResponse({ detail: "not found" }, 404);
          }
          return jsonResponse(wikiTreePayload);
        }

        if (url.includes("/api/work-sessions/") && url.endsWith("/file-links")) {
          if (method === "POST") {
            lastFileLinkBody = body;
            return jsonResponse(
              {
                items: [
                  {
                    id: "link-1",
                    session_id: "session-1",
                    file_path: (body?.items as Array<Record<string, unknown>>)[0]?.file_path,
                    label: (body?.items as Array<Record<string, unknown>>)[0]?.label,
                    source: "knowledge",
                    created_at: "2026-07-04T00:00:00+09:00",
                  },
                ],
              },
              201,
            );
          }
          return jsonResponse({ items: [] });
        }

        if (url.endsWith("/api/knowledge/wiki/index")) {
          if (!wikiIndexAvailable) {
            return jsonResponse({ detail: "not found" }, 404);
          }
          return jsonResponse({
            path: "/tmp/gongmu-workspace/knowledge/wiki/index.md",
            content:
              "# 지식폴더 위키\n\n## 문서\n\n- [공공서비스 개선계획](docs/service.md)\n- [예산 검토](docs/budget.md)\n",
          });
        }

        if (url.includes("/api/knowledge/wiki/page")) {
          const requestedPath = new URL(url).searchParams.get("path") ?? "";
          if (requestedPath === "docs/budget.md") {
            return jsonResponse({
              path: "/tmp/gongmu-workspace/knowledge/wiki/docs/budget.md",
              relative_path: "docs/budget.md",
              content: [
                "---",
                "slug: budget",
                'title: 예산 검토',
                "source_path: C:/Docs/업무자료/budget.hwpx",
                "doc_type: 보고서",
                "mtime: 2026-06-01T00:00:00+09:00",
                "parser: kordoc",
                "quality_score: 0.9",
                'warnings: []',
                "hash: abc123",
                'topics: ["예산"]',
                "enriched: false",
                "---",
                "",
                "# 예산 검토",
                "",
                "## 개요",
                "다음 분기 예산 편성안을 검토하고 주요 변경점을 정리한다.",
                "",
                "## 섹션 아웃라인",
                "- 편성 배경",
                "- 세부 항목",
                "",
                "## 키워드",
                "예산, 편성, 검토",
                "",
                "## 주제",
                "- [[예산]](../topics/budget-topic.md)",
                "",
                "## 원본",
                "- 원본 경로: C:/Docs/업무자료/budget.hwpx",
              ].join("\n"),
            });
          }
          if (requestedPath === "topics/budget-topic.md") {
            return jsonResponse({
              path: "/tmp/gongmu-workspace/knowledge/wiki/topics/budget-topic.md",
              relative_path: "topics/budget-topic.md",
              content: [
                "---",
                "topic: 예산",
                "slug: budget-topic",
                "doc_count: 1",
                "work_count: 0",
                "updated_at: 2026-06-01T00:00:00+09:00",
                "---",
                "",
                "# 예산",
                "",
                "## 관련 문서",
                "- [예산 검토](../docs/budget.md) · 원본: C:/Docs/업무자료/budget.hwpx",
              ].join("\n"),
            });
          }
          return jsonResponse({
            path: "/tmp/gongmu-workspace/knowledge/wiki/docs/service.md",
            relative_path: "docs/service.md",
            content: "# 공공서비스 개선계획\n\n민원 처리 시간을 줄이기 위한 개선 과제를 정리한다.\n",
          });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": { items: [] },
          "/api/work-sessions": {
            items: [
              {
                id: "session-1",
                title: "민원 개선 작업",
                schedule_id: null,
                status: "open",
                created_at: "2026-05-06T00:00:00+09:00",
                messages: [],
              },
            ],
          },
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

  it("registers and scans a local source folder from the settings tab", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openSettingsTab(user);
    await user.click(screen.getByText("지식 소스 등록 설정"));
    await user.type(screen.getByLabelText("소스 이름"), "기획팀 업무자료");
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await waitFor(() => expect(screen.getByLabelText("폴더 경로")).toHaveValue("C:/Docs/업무자료"));

    await user.click(screen.getByRole("button", { name: "지식 소스 등록" }));
    const sourceCards = await screen.findAllByText("기획팀 업무자료");
    expect(sourceCards.length).toBeGreaterThan(0);

    // 스캔은 설정 ① 지식폴더 지정 그룹의 폴더 카드에서 실행한다.
    await user.click(screen.getByRole("button", { name: "스캔 시작" }));

    // 스캔 결과는 폴더 카드의 파일 수·최근 스캔 갱신으로 확인한다.
    await waitFor(() => expect(screen.getByText(/1개 파일/)).toBeInTheDocument());

    // 사용자 피드백: "진단·상세 데이터" 그룹(색인 흐름 안내/문서 메타데이터/업무대화 반영 기록)은 제거됐다.
    expect(screen.queryByText("진단·상세 데이터")).not.toBeInTheDocument();
    expect(screen.queryByText("등록된 문서 메타데이터")).not.toBeInTheDocument();
    expect(screen.queryByText("업무대화 반영 기록")).not.toBeInTheDocument();
    expect(screen.queryByText("색인 처리 흐름 안내")).not.toBeInTheDocument();
  });

  it("starts indexing from a registered knowledge source", async () => {
    const user = userEvent.setup();
    render(<App />);

    await registerSource(user, "Planning docs");

    // 색인 실행은 설정 ③ 색인 설정·실행 그룹에서 시작한다.
    await user.click(screen.getByRole("button", { name: "색인 시작" }));

    expect(await screen.findByText("색인 작업 #job1")).toBeInTheDocument();
    expect(screen.getByText("1/1 처리 · 실패 0")).toBeInTheDocument();
    expect(screen.getByText("삭제동기화 1")).toBeInTheDocument();
    expect(screen.getByText("변경없음 2")).toBeInTheDocument();
    expect(screen.getByText("마지막 처리: budget.md")).toBeInTheDocument();
    expect(screen.getByText("소요 120ms · 파일당 120ms")).toBeInTheDocument();
    expect(lastKnowledgeIngestBody).toEqual({
      source_id: "source-1",
      run_now: true,
      background: true,
    });

    await user.click(await screen.findByRole("button", { name: "색인완료 파일 2개" }));
    expect(await screen.findByText("예산 검토")).toBeInTheDocument();
    expect(screen.getByText("파서 gongmu-markdown")).toBeInTheDocument();
    // 내부 상태값(partial/structured) 원문 노출 금지 — 한국어 라벨로 표시
    expect(screen.queryByText("structured")).not.toBeInTheDocument();
    expect(screen.queryByText("partial")).not.toBeInTheDocument();
    expect(screen.getAllByText("전체 추출").length).toBeGreaterThan(0);
    expect(screen.getByText("품질 85%")).toBeInTheDocument();
    expect(screen.getByText("섹션 2 · 표 1")).toBeInTheDocument();
    expect(screen.getByText("chunk 3 · 표 chunk 1")).toBeInTheDocument();
    expect(screen.getByText("문단 1 · 글자 42")).toBeInTheDocument();
    expect(screen.getByText("경고 없음")).toBeInTheDocument();
    expect(screen.getByText("스캔 문서")).toBeInTheDocument();
    expect(screen.getByText("경고: 부분 추출, 본문 부족")).toBeInTheDocument();
  });

  it("opens document structure from the indexing extraction status list", async () => {
    const user = userEvent.setup();
    render(<App />);

    await registerSource(user, "기획팀 업무자료");
    await user.click(screen.getByRole("button", { name: "색인 시작" }));

    await screen.findByText("색인 작업 #job1");
    await user.click(await screen.findByRole("button", { name: "색인완료 파일 2개" }));
    const documentCard = (await screen.findByText("예산 검토")).closest("article") as HTMLElement;
    await user.click(within(documentCard).getByRole("button", { name: "구조 보기" }));

    expect(await screen.findByTestId("knowledge-document-structure")).toBeInTheDocument();
    expect(screen.getByText("추진배경")).toBeInTheDocument();
    expect(screen.getByText("사업별 예산")).toBeInTheDocument();
  });

  it("locks knowledge source setup and new indexing actions while ingestion is active", async () => {
    const user = userEvent.setup();
    render(<App />);

    await registerSource(user, "기획팀 업무자료");

    nextKnowledgeIngestionStatus = "running";
    await user.click(screen.getByRole("button", { name: "색인 시작" }));

    expect((await screen.findAllByText(/색인 작업 #job1이 진행 중입니다/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "스캔 시작" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "색인 시작" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "강제 재색인" })).toBeDisabled();

    expect(screen.getByLabelText("소스 이름")).toBeDisabled();
    expect(screen.getByLabelText("폴더 경로")).toBeDisabled();
    expect(screen.getByRole("button", { name: "폴더 선택" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "지식 소스 등록" })).toBeDisabled();
  });

  it("shows the diff estimate card and runs incremental indexing from it (P1 변경 확인)", async () => {
    knowledgeDiffPayload = {
      added: 2,
      modified: 1,
      moved: 1,
      deleted: 1,
      unchanged: 10,
      unstable: 1,
      rehash_estimate: { files: 4, bytes: 2 * 1024 * 1024 },
      exceeds_gate: false,
    };
    const user = userEvent.setup();
    render(<App />);

    await registerSource(user, "기획팀 업무자료");

    // [변경 확인]은 색인을 실행하지 않고 견적 카드만 띄운다.
    await user.click(screen.getByRole("button", { name: "변경 확인" }));

    const estimate = await screen.findByTestId("knowledge-diff-estimate");
    expect(estimate).toHaveTextContent("추가 2 · 수정 1 · 이동 1 · 삭제 1 · 변경없음 10 (보류 1)");
    expect(estimate).toHaveTextContent("확인 필요 4개 파일 · 2MB");
    expect(lastKnowledgeIngestBody).toBeUndefined();
    // 게이트 미초과 — 경고 없이 [증분 색인 실행]이 견적 카드 안에 보인다.
    expect(screen.queryByTestId("knowledge-diff-gate")).not.toBeInTheDocument();
    expect(within(estimate).queryByRole("button", { name: "그래도 실행" })).not.toBeInTheDocument();

    // 대시보드 색인 상태 카드에 "미반영 변경 N건" 한 줄이 뜬다(store 공용 diff 상태 재사용 — P3 §4.4).
    await user.click(screen.getByRole("tab", { name: "대시보드" }));
    const dashboardDiffLine = await screen.findByTestId("knowledge-status-indexing-diff");
    expect(dashboardDiffLine).toHaveTextContent("미반영 변경 5건");
    expect(dashboardDiffLine).toHaveTextContent("추가 2 · 수정 1 · 이동 1 · 삭제 1");

    // 설정 탭으로 돌아와 견적 카드의 [증분 색인 실행] — 기존 색인 시작 흐름을 재사용한다.
    await user.click(screen.getByRole("tab", { name: "설정" }));
    const estimateAgain = await screen.findByTestId("knowledge-diff-estimate");
    await user.click(within(estimateAgain).getByRole("button", { name: "증분 색인 실행" }));

    expect(await screen.findByText("색인 작업 #job1")).toBeInTheDocument();
    expect(lastKnowledgeIngestBody).toEqual({
      source_id: "source-1",
      run_now: true,
      background: true,
    });
  }, 10000);

  it("reports an up-to-date index when the diff finds no changes (변경 0)", async () => {
    knowledgeDiffPayload = {
      added: 0,
      modified: 0,
      moved: 0,
      deleted: 0,
      unchanged: 42,
      unstable: 0,
      rehash_estimate: { files: 0, bytes: 0 },
      exceeds_gate: false,
    };
    const user = userEvent.setup();
    render(<App />);

    await registerSource(user, "기획팀 업무자료");
    await user.click(screen.getByRole("button", { name: "변경 확인" }));

    const estimate = await screen.findByTestId("knowledge-diff-estimate");
    expect(within(estimate).getByTestId("knowledge-diff-empty")).toHaveTextContent(
      "변경된 파일이 없습니다 — 색인이 최신입니다.",
    );
    // 변경 0 — 실행 버튼을 견적 카드에 노출하지 않는다.
    expect(within(estimate).queryByRole("button", { name: "증분 색인 실행" })).not.toBeInTheDocument();
    expect(within(estimate).queryByRole("button", { name: "그래도 실행" })).not.toBeInTheDocument();
    expect(lastKnowledgeIngestBody).toBeUndefined();
  });

  it("gates incremental indexing behind an explicit confirmation when the estimate exceeds the gate", async () => {
    knowledgeDiffPayload = {
      added: 80,
      modified: 40,
      moved: 0,
      deleted: 3,
      unchanged: 5,
      unstable: 0,
      rehash_estimate: { files: 120, bytes: 600 * 1024 * 1024 },
      exceeds_gate: true,
    };
    const user = userEvent.setup();
    render(<App />);

    await registerSource(user, "기획팀 업무자료");
    await user.click(screen.getByRole("button", { name: "변경 확인" }));

    const estimate = await screen.findByTestId("knowledge-diff-estimate");
    expect(within(estimate).getByTestId("knowledge-diff-gate")).toHaveTextContent(
      "전체 파일의 상당수가 변경되어 확인에 수 분이 걸릴 수 있습니다.",
    );
    expect(estimate).toHaveTextContent("확인 필요 120개 파일 · 600MB");
    // 게이트 초과 — 기본 실행 버튼 대신 [그래도 실행]만 노출한다.
    expect(within(estimate).queryByRole("button", { name: "증분 색인 실행" })).not.toBeInTheDocument();
    await user.click(within(estimate).getByRole("button", { name: "그래도 실행" }));

    expect(await screen.findByText("색인 작업 #job1")).toBeInTheDocument();
    expect(lastKnowledgeIngestBody).toEqual({
      source_id: "source-1",
      run_now: true,
      background: true,
    });
  });

  it("surfaces the scan unstable hold badge only when files were deferred (P0 followup)", async () => {
    scanUnstableCount = 2;
    const user = userEvent.setup();
    render(<App />);

    await registerSource(user, "기획팀 업무자료");
    expect(screen.queryByTestId("knowledge-scan-unstable")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "스캔 시작" }));

    const badge = await screen.findByTestId("knowledge-scan-unstable");
    expect(badge).toHaveTextContent("보류 2건 — 다음 스캔에서 처리");
  });

  it("starts forced reindex from a registered knowledge source", async () => {
    const user = userEvent.setup();
    render(<App />);

    await registerSource(user, "Planning docs");

    await user.click(screen.getByRole("button", { name: "강제 재색인" }));

    expect(await screen.findByText("색인 작업 #jobforce")).toBeInTheDocument();
    expect(lastKnowledgeReindexBody).toEqual({
      source_id: "source-1",
      run_now: true,
      background: true,
    });
  });

  it("cancels a queued ingestion job from the job card", async () => {
    const user = userEvent.setup();
    render(<App />);

    await registerSource(user, "Planning docs");

    await user.click(screen.getByRole("button", { name: "강제 재색인" }));
    await screen.findByText("색인 작업 #jobforce");
    await user.click(await screen.findByRole("button", { name: "취소" }));

    expect(lastCanceledIngestionJobId).toBe("job-force");
    expect(await screen.findByText("취소됨")).toBeInTheDocument();
  }, 10000);

  it("shows type-grouped status cards on the dashboard and delegates actions to settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));

    expect(screen.getByRole("tab", { name: "대시보드" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("knowledge-dashboard")).toBeInTheDocument();

    const counts = screen.getByTestId("knowledge-wiki-counts");
    await waitFor(() => expect(counts).toHaveTextContent("문서 2"));
    expect(counts).toHaveTextContent("주제 1");
    expect(counts).toHaveTextContent("업무 기록 1");

    // 상태 카드 4종: 지식폴더 / 위키 구성 / 색인 / LLM 보강
    const sourcesCard = screen.getByTestId("knowledge-status-sources");
    expect(sourcesCard).toHaveTextContent("미등록");
    const taxonomyCard = screen.getByTestId("knowledge-status-taxonomy");
    await waitFor(() => expect(taxonomyCard).toHaveTextContent("미구성"));
    const indexingCard = screen.getByTestId("knowledge-status-indexing");
    expect(indexingCard).toHaveTextContent("아직 색인 작업이 없습니다.");
    expect(screen.getByTestId("knowledge-status-enrich")).toBeInTheDocument();

    // 실행 버튼(다시 색인·보강 시작)은 대시보드에서 제거 — 설정 탭으로 위임
    expect(screen.queryByRole("button", { name: "다시 색인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "보강 시작" })).not.toBeInTheDocument();

    // [설정으로] → 설정 탭 이동
    await user.click(within(sourcesCard).getByRole("button", { name: "설정으로" }));
    expect(screen.getByRole("tab", { name: "설정" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("지식 소스 등록 설정")).toBeInTheDocument();

    // 설정 탭에는 [← 대시보드로] 복귀 버튼
    await user.click(screen.getByRole("button", { name: "← 대시보드로" }));
    expect(screen.getByRole("tab", { name: "대시보드" })).toHaveAttribute("aria-selected", "true");
  });

  it("guides LLM setup from the dashboard enrichment card when unconfigured", async () => {
    llmEnrichmentConfigured = false;
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));

    const enrichCard = await screen.findByTestId("knowledge-status-enrich");
    await waitFor(() => expect(enrichCard).toHaveTextContent("미설정"));
    expect(within(enrichCard).queryByRole("button", { name: "보강 시작" })).not.toBeInTheDocument();
    expect(within(enrichCard).getByTestId("llm-setup-notice")).toBeInTheDocument();

    // 설정 탭의 실행 버튼은 disabled + 사유 title (G-07)
    await user.click(within(enrichCard).getByRole("button", { name: "설정으로" }));
    const enrichButton = await screen.findByRole("button", { name: "LLM 요약 보강 시작" });
    expect(enrichButton).toBeDisabled();
    expect(enrichButton).toHaveAttribute("title", "환경설정에서 LLM 연결을 구성하면 사용할 수 있습니다.");
  });

  it("shows plain-language engine status cards on the dashboard", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));

    expect(await screen.findByText("키워드 검색(FTS5) 정상 · 트라이그램")).toBeInTheDocument();
    const indexingCard = screen.getByTestId("knowledge-status-indexing");
    await waitFor(() => expect(indexingCard).toHaveTextContent("한국어 문서 파서 사용 가능"));
    expect(screen.getByTestId("knowledge-status-enrich")).toHaveTextContent("설정됨");
    expect(screen.queryByText(/sqlite_graph_mirror/)).not.toBeInTheDocument();
    expect(screen.getByText(/등록 폴더 0/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("knowledge-wiki-counts")).toHaveTextContent("주제 1"));
  });

  it("uses the three-tab layout: dashboard, wiki with search, and grouped settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));

    // 최종 탭 구성: [대시보드] [위키] [설정] 3개
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "대시보드" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "위키" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "설정" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "검색" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "색인 처리" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("지식 검색")).not.toBeInTheDocument();

    // T5(4호): 설정 탭 3분할 서브내비 — role=tab 이 아니라 seg-control(role=group)이므로 탭 3개 불변
    await user.click(screen.getByRole("tab", { name: "설정" }));
    expect(screen.getAllByRole("tab")).toHaveLength(3); // 서브내비가 tab 시맨틱을 오염시키지 않는다
    expect(screen.getByTestId("knowledge-settings-nav-folders")).toBeInTheDocument();
    expect(screen.getByTestId("knowledge-settings-nav-taxonomy")).toBeInTheDocument();
    expect(screen.getByTestId("knowledge-settings-nav-maintenance")).toBeInTheDocument();

    // 기본 서브섹션(폴더·색인): 지식폴더 지정 + 색인 설정·실행 표시, 위키 구성 설정은 숨김
    expect(screen.getByText("지식폴더 지정")).toBeInTheDocument();
    expect(screen.getByText("지식 소스 등록 설정")).toBeInTheDocument();
    expect(screen.getByText("색인 설정·실행")).toBeInTheDocument();
    expect(screen.queryByTestId("knowledge-taxonomy-entry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("knowledge-verify-group")).not.toBeInTheDocument();

    // 분류·어휘 서브섹션으로 전환하면 위키 구성 설정이 보인다
    await user.click(screen.getByTestId("knowledge-settings-nav-taxonomy"));
    expect(screen.getByText("위키 구성 설정")).toBeInTheDocument();
    expect(screen.queryByText("지식폴더 지정")).not.toBeInTheDocument();

    // 위키 탭: 상단 검색 바 + 2컬럼 브라우저
    await user.click(screen.getByRole("tab", { name: "위키" }));
    expect(screen.getByTestId("knowledge-wiki-search")).toBeInTheDocument();
    expect(screen.getByLabelText("지식 검색")).toBeInTheDocument();
    expect(await screen.findByTestId("knowledge-wiki-browser")).toBeInTheDocument();
    expect(screen.queryByText("지식 소스 등록 설정")).not.toBeInTheDocument();
  });

  it("T5: each setting section shows 무엇/언제/결과 help and never triggers work on nav switch", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSettingsTab(user);

    // 폴더·색인 서브섹션: 소스·색인·진행 상태 설명 3요소
    for (const id of ["settings-help-sources", "settings-help-indexing", "settings-help-progress"]) {
      const help = screen.getByTestId(id);
      expect(help).toHaveTextContent("무엇:");
      expect(help).toHaveTextContent("언제:");
      expect(help).toHaveTextContent("결과:");
    }

    // 네거티브: 서브내비를 순회 클릭해도 role=tab 은 3개 불변, POST/PUT/DELETE 0건
    const mutatingBefore = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, init]) => init && init.method && init.method !== "GET",
    ).length;
    await user.click(screen.getByTestId("knowledge-settings-nav-taxonomy"));
    expect(screen.getByTestId("settings-help-taxonomy")).toHaveTextContent("결과:");
    expect(screen.getByTestId("settings-help-vocab-pack")).toHaveTextContent("무엇:");
    await user.click(screen.getByTestId("knowledge-settings-nav-maintenance"));
    expect(screen.getByTestId("settings-help-enrich")).toHaveTextContent("언제:");
    expect(screen.getByTestId("settings-help-verify")).toHaveTextContent("결과:");
    await user.click(screen.getByTestId("knowledge-settings-nav-folders"));

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    const mutatingAfter = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, init]) => init && init.method && init.method !== "GET",
    ).length;
    expect(mutatingAfter).toBe(mutatingBefore); // 섹션 전환은 조회성 GET만 허용
  });

  it("shows full log dump and visual ingestion progress status", async () => {
    const user = userEvent.setup();
    render(<App />);

    await registerSource(user, "Planning docs");

    await user.click(screen.getByRole("button", { name: "색인 시작" }));

    expect((await screen.findAllByText("색인 상세 로그")).length).toBeGreaterThan(0);
    expect(screen.getByText("/tmp/gongmu-workspace/logs/knowledge-ingestion/job-1.jsonl")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "경로 복사" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "폴더 열기" })).toBeInTheDocument();
    const dumpViewerButton = screen.getByRole("button", { name: "색인 상세 로그 열기" });
    expect(dumpViewerButton).toBeInTheDocument();
    await user.click(dumpViewerButton);
    expect(await screen.findByText("job.started")).toBeInTheDocument();
    expect(screen.getByText("지식폴더 색인 시작")).toBeInTheDocument();
    expect(screen.getByText("진단 이벤트 12개")).toBeInTheDocument();
    expect(screen.getByText("지식 위키 갱신 완료")).toBeInTheDocument();
    expect(screen.getByTestId("knowledge-ingestion-stage-rail")).toHaveTextContent("위키");
  });

  it("starts an LLM enrichment job from the settings tab", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openSettingsSection(user, "maintenance"); // T5: LLM 요약 보강은 유지관리 서브섹션
    const enrichButton = await screen.findByRole("button", { name: "LLM 요약 보강 시작" });
    await waitFor(() => expect(enrichButton).toBeEnabled());
    await user.click(enrichButton);

    await waitFor(() =>
      expect(lastKnowledgeEnrichBody).toEqual({
        source_id: null,
        background: true,
      }),
    );
    expect(
      await screen.findByText(/LLM 요약 보강 작업을 시작했습니다/),
    ).toBeInTheDocument();
  });

  it("P1: shows keyword and detail search side by side without a keyword run button", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));

    // P1: 좌우 2단 — 키워드(지식 검색)와 상세검색이 함께 존재한다.
    const searchBar = screen.getByTestId("knowledge-wiki-search");
    expect(within(searchBar).getByLabelText("지식 검색")).toBeInTheDocument();
    expect(within(searchBar).getByTestId("knowledge-detail-search")).toBeInTheDocument();
    // P2: 키워드는 버튼 없는 라이브 — 실행 버튼이 없다.
    expect(
      within(searchBar).queryByRole("button", { name: "키워드 검색 실행" }),
    ).not.toBeInTheDocument();
    // 위키 브라우저(트리)가 검색 아래 바로 보인다.
    expect(await screen.findByTestId("knowledge-wiki-browser")).toBeInTheDocument();
  });

  it("P2: typing a keyword live-focuses the matching wiki tree node (no results pane)", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));
    await screen.findByTestId("knowledge-wiki-browser");

    await user.type(screen.getByLabelText("지식 검색"), "예산");

    // 트리의 '예산' 주제 노드가 하이라이트된다(버튼·결과 패널 없이).
    await waitFor(() => {
      const focused = document.querySelector('.wiki-tree__item--focused[data-wiki-key="예산"]');
      expect(focused).not.toBeNull();
      expect(focused).toHaveTextContent("예산");
    });
    expect(screen.queryByTestId("knowledge-search-results")).not.toBeInTheDocument();
    expect(screen.getByTestId("knowledge-keyword-hint")).toHaveTextContent("해당 항목으로 이동");
  });

  it("P2: clicking the focused tree node opens its wiki page", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));
    await screen.findByTestId("knowledge-wiki-browser");
    await user.type(screen.getByLabelText("지식 검색"), "예산");

    const focused = await waitFor(() => {
      const el = document.querySelector('.wiki-tree__item--focused[data-wiki-key="예산"]');
      if (!el) {
        throw new Error("not focused yet");
      }
      return el as HTMLElement;
    });
    await user.click(focused);
    expect(await screen.findByTestId("knowledge-wiki-page")).toBeInTheDocument();
    expect(screen.queryByTestId("knowledge-search-results")).not.toBeInTheDocument();
  });

  it("#3: typing a keyword auto-loads the matching topic content in the right viewer (no click)", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));
    await screen.findByTestId("knowledge-wiki-browser");

    // 클릭 없이 키워드 입력만으로 우측 뷰어에 해당 위키 페이지가 로딩된다.
    await user.type(screen.getByLabelText("지식 검색"), "예산");
    expect(await screen.findByTestId("knowledge-wiki-page")).toBeInTheDocument();
    expect(screen.queryByTestId("knowledge-search-results")).not.toBeInTheDocument();
  });

  it("generates a grounded answer with citations and follow-up actions", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));

    // T3(4호): 상세검색은 자체 입력창+버튼을 가진 별도 섹션(토글 없음)
    const detailSearch = screen.getByTestId("knowledge-detail-search");
    await user.type(within(detailSearch).getByLabelText("상세검색 질문"), "개인정보보호법");
    await user.click(within(detailSearch).getByRole("button", { name: "상세검색 실행" }));

    const askResult = await screen.findByTestId("knowledge-ask-result");
    // S1: 상세검색은 스트리밍 엔드포인트를 우선 사용한다(비스트리밍 폴백 아님)
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([requestUrl]) =>
        String(requestUrl).endsWith("/api/knowledge/ask/stream"),
      ),
    ).toBe(true);
    // 세션 자동 선택은 스냅샷 로드(비동기)에 달려 있어 스트리밍 done보다 늦을 수 있다 — findBy로 대기
    expect(await within(askResult).findByText("세션 맥락: 민원 개선 작업")).toBeInTheDocument();
    expect(screen.getByTestId("knowledge-answer-mode")).toHaveTextContent("LLM 합성");
    expect(within(askResult).getAllByText(/개인정보 처리 기준을 점검합니다/).length).toBeGreaterThan(0);
    expect(within(askResult).getByText("출처 문서")).toBeInTheDocument();
    expect(within(askResult).getByText("공공서비스 개선계획")).toBeInTheDocument();
    expect(within(askResult).getByText(/원본:.*service\.md/)).toBeInTheDocument();
    expect(within(askResult).getByText(/발췌: 개인정보 처리 기준을 점검합니다\./)).toBeInTheDocument();
    expect(within(askResult).getByText("검색근거 1개")).toBeInTheDocument();
    expect(within(askResult).getByText("경고: 부분 추출")).toBeInTheDocument();

    // J-08: 답변 복사
    const { copyTextToClipboard } = await import("./runtime");
    await user.click(screen.getByRole("button", { name: "답변 복사" }));
    await waitFor(() =>
      expect(vi.mocked(copyTextToClipboard)).toHaveBeenCalledWith(
        expect.stringContaining("'개인정보보호법'에 대해 로컬 지식폴더에서 확인한 근거입니다."),
      ),
    );

    // J-08: 업무대화로 이어가기 — 컴포저 프리필 + 화면 전환
    await user.click(screen.getByRole("button", { name: "업무대화로 이어가기" }));
    const composer = await screen.findByTestId("chat-composer-input");
    expect((composer as HTMLTextAreaElement).value).toContain("질문: 개인정보보호법");
    expect((composer as HTMLTextAreaElement).value).toContain("지식폴더 상세검색 답변");
  });

  it("P2/P3: keyword focuses the tree while detail search answers, and history re-runs detail search", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));
    await screen.findByTestId("knowledge-wiki-browser");

    // 키워드: 트리 포커스만, 상세검색 답변은 생기지 않는다.
    await user.type(screen.getByLabelText("지식 검색"), "예산");
    await waitFor(() =>
      expect(document.querySelector(".wiki-tree__item--focused")).not.toBeNull(),
    );
    expect(screen.queryByTestId("knowledge-ask-result")).not.toBeInTheDocument();

    // 상세검색: 별도 입력창 Enter → 근거 답변.
    const detailSearch = screen.getByTestId("knowledge-detail-search");
    await user.type(within(detailSearch).getByLabelText("상세검색 질문"), "개인정보보호법{enter}");
    expect(await screen.findByTestId("knowledge-ask-result")).toBeInTheDocument();

    // 최근 질의 칩 = 상세검색 질의 → 클릭 시 상세검색을 재실행한다.
    const history = screen.getByTestId("knowledge-query-history");
    await user.click(within(history).getByRole("button", { name: "개인정보보호법" }));
    expect(await screen.findByTestId("knowledge-ask-result")).toBeInTheDocument();
  });

  it("P2: a keyword matching no work/topic name focuses nothing and shows a hint", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));
    await screen.findByTestId("knowledge-wiki-browser");

    await user.type(screen.getByLabelText("지식 검색"), "존재하지않는주제어");
    await waitFor(() =>
      expect(screen.getByTestId("knowledge-keyword-hint")).toHaveTextContent(
        "일치하는 목차 항목이 없습니다",
      ),
    );
    expect(document.querySelector(".wiki-tree__item--focused")).toBeNull();
  });

  it("T4: groups similar topics under broader headers with an 기타 tail", async () => {
    wikiTreePayload = {
      ...wikiTreePayload,
      topics: [
        { slug: "s1", title: "안전점검", doc_count: 3, path: "topics/s1.md", group_id: "safety", group_label: "안전관리" },
        { slug: "s2", title: "위험성평가", doc_count: 2, path: "topics/s2.md", group_id: "safety", group_label: "안전관리" },
        { slug: "a1", title: "AI 정책", doc_count: 1, path: "topics/a1.md", group_id: "ai", group_label: "AI 도입" },
        { slug: "a2", title: "AX 전략", doc_count: 1, path: "topics/a2.md", group_id: "ai", group_label: "AI 도입" },
        { slug: "solo", title: "감사 지적", doc_count: 1, path: "topics/solo.md", group_id: "audit", group_label: "감사" },
        { slug: "free", title: "자유주제", doc_count: 1, path: "topics/free.md", group_id: null, group_label: null },
      ],
      counts: { docs: 2, topics: 6, works: 1, work_areas: 0 },
    };
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));
    await screen.findByTestId("knowledge-wiki-browser");

    // ≥2 그룹 2개(안전관리·AI 도입) + 말미 '기타' 1개 = 3
    const groups = await screen.findAllByTestId("wiki-tree-topic-group");
    expect(groups).toHaveLength(3);
    const labels = groups.map((group) => group.querySelector("summary")?.textContent ?? "");
    expect(labels.some((label) => label.includes("안전관리 (2)"))).toBe(true);
    expect(labels.some((label) => label.includes("AI 도입 (2)"))).toBe(true);
    // 단독(감사 지적)+미매칭(자유주제)이 '기타 (2)'로 합류
    expect(labels.some((label) => label.includes("기타 (2)"))).toBe(true);
    expect(labels.some((label) => label.includes("감사 ("))).toBe(false);

    // 그룹 내 주제 클릭 → 기존 openKnowledgeWikiTarget 경로로 이동(위키 페이지 fetch)
    await user.click(screen.getByRole("button", { name: /위험성평가/ }));
    expect(await screen.findByTestId("knowledge-wiki-page")).toBeInTheDocument();
  });

  it("T4: falls back to a flat topic list when no group has 2+ topics (negative / 구버전 서버)", async () => {
    wikiTreePayload = {
      ...wikiTreePayload,
      // group_label 부재(구버전 서버) → 평면 폴백
      topics: [
        { slug: "t1", title: "주제하나", doc_count: 1, path: "topics/t1.md" },
        { slug: "t2", title: "주제둘", doc_count: 1, path: "topics/t2.md" },
      ],
      counts: { docs: 2, topics: 2, works: 1, work_areas: 0 },
    };
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));
    await screen.findByTestId("knowledge-wiki-browser");

    expect(screen.queryByTestId("wiki-tree-topic-group")).not.toBeInTheDocument();
    expect(screen.getByText("주제 (2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /주제하나/ })).toBeInTheDocument();
  });

  it("shows the empty-index guidance in the wiki tree and search view (J-07)", async () => {
    wikiTreeAvailable = false;
    wikiIndexAvailable = false;
    searchResultsAvailable = false;
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));

    // 위키 트리 빈 상태 → 설정으로 이동
    const wikiEmpty = await screen.findByTestId("knowledge-wiki-empty");
    expect(wikiEmpty).toHaveTextContent("색인된 문서가 없습니다.");
    await user.click(within(wikiEmpty).getByRole("button", { name: "설정으로 이동" }));
    expect(screen.getByRole("tab", { name: "설정" })).toHaveAttribute("aria-selected", "true");
  });

  it("offers a retry reindex action on failed ingestion jobs (J-10)", async () => {
    const user = userEvent.setup();
    render(<App />);

    await registerSource(user, "Planning docs");

    nextKnowledgeIngestionStatus = "failed";
    await user.click(screen.getByRole("button", { name: "색인 시작" }));

    expect(await screen.findByText("실패")).toBeInTheDocument();
    const retryButton = await screen.findByRole("button", { name: "다시 색인" });
    expect(retryButton).toBeEnabled();
    await user.click(retryButton);

    expect(await screen.findByText("색인 작업 #jobforce")).toBeInTheDocument();
    expect(lastKnowledgeReindexBody).toEqual({
      source_id: "source-1",
      run_now: true,
      background: true,
    });
  });

  it("shows the taxonomy entry card and requires a registered source to open the wizard", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openSettingsSection(user, "taxonomy"); // T5: 위키 구성 설정은 분류·어휘 서브섹션

    const entry = await screen.findByTestId("knowledge-taxonomy-entry");
    expect(entry).toHaveTextContent("위키 구성 설정");
    const wizardButton = within(entry).getByRole("button", { name: "분류체계 설정" });
    // 등록된 지식폴더가 없으면 마법사 진입이 막힌다.
    expect(wizardButton).toBeDisabled();
    expect(wizardButton).toHaveAttribute("title", "지식폴더를 먼저 등록하면 분류체계를 설정할 수 있습니다.");
    expect(within(entry).getByRole("button", { name: "분류 기준 보기" })).toBeInTheDocument();
  });

  it("renders the wiki tree browser and opens a page from the tree", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));

    const browser = await screen.findByTestId("knowledge-wiki-browser");
    await waitFor(() => expect(browser).toHaveTextContent("주제 (1)"));
    expect(browser).toHaveTextContent("업무 기록 (1)");
    expect(browser).toHaveTextContent("폴더별 문서 (2)");
    expect(browser).toHaveTextContent("기획팀 업무자료 (2)");
    expect(within(browser).getByRole("button", { name: /민원 개선 작업 기록/ })).toBeInTheDocument();
    expect(browser).toHaveTextContent("왼쪽 목차에서 문서를 선택하세요.");

    await user.click(within(browser).getByRole("button", { name: /공공서비스 개선계획/ }));

    const wikiPage = await screen.findByTestId("knowledge-wiki-page");
    expect(wikiPage).toHaveTextContent("민원 처리 시간을 줄이기 위한 개선 과제를 정리한다.");
    expect(screen.getByTestId("knowledge-wiki-breadcrumb")).toHaveTextContent("목차 / docs/service.md");

    await user.click(screen.getByRole("button", { name: /목차/ }));
    expect(screen.queryByTestId("knowledge-wiki-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("knowledge-wiki-browser")).toBeInTheDocument();
  });

  it("previews a doc card in an in-place modal without replacing the viewer (⑥)", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));

    const browser = await screen.findByTestId("knowledge-wiki-browser");
    await waitFor(() => expect(browser).toHaveTextContent("폴더별 문서 (2)"));

    // '예산 검토' 문서행의 미리보기 버튼만 눌러 인플레이스 모달을 연다(본문 버튼과 구분).
    const docButton = within(browser).getByRole("button", { name: /예산 검토/ });
    const row = docButton.closest("li");
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByTestId("wiki-tree-preview-button"));

    const modal = await screen.findByTestId("wiki-preview-modal");
    expect(modal).toHaveTextContent("예산 검토");
    expect(modal).toHaveTextContent("다음 분기 예산 편성안을 검토하고 주요 변경점을 정리한다.");
    // 미리보기는 우측 뷰어(전체 페이지)를 대체하지 않는다.
    expect(screen.queryByTestId("knowledge-wiki-page")).not.toBeInTheDocument();

    await user.click(within(modal).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.queryByTestId("wiki-preview-modal")).not.toBeInTheDocument());
  });

  it("shows a duplicate-copy badge and separates missing-original cards in the tree (W7 §5.5/§5.6)", async () => {
    wikiTreePayload = {
      topics: [],
      works: [],
      sources: [
        {
          source_id: "source-1",
          label: "기획팀 업무자료",
          docs: [
            // §5.6: 동일 해시 사본 그룹의 대표 1건 — duplicate_count로 사본 수를 알린다.
            {
              slug: "service",
              title: "공공서비스 개선계획",
              path: "docs/service.md",
              quality_score: 0.85,
              duplicate_count: 3,
              status: "active",
            },
            { slug: "budget", title: "예산 검토", path: "docs/budget.md", quality_score: 0.9, status: "active" },
            // §5.5: 원본이 삭제된 소프트 삭제 카드 — 폴더 목록이 아닌 하단 그룹으로 분리된다.
            {
              slug: "old-guideline",
              title: "구 지침",
              path: "docs/old-guideline.md",
              status: "missing",
            },
          ],
        },
      ],
      counts: { docs: 3, topics: 0, works: 0 },
    };

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));

    const browser = await screen.findByTestId("knowledge-wiki-browser");
    // 폴더 목록에는 missing을 제외한 활성 문서만 계산된다.
    await waitFor(() => expect(browser).toHaveTextContent("폴더별 문서 (2)"));
    expect(browser).toHaveTextContent("기획팀 업무자료 (2)");

    // 사본 배지: duplicate_count > 1 인 대표 문서에만 붙는다.
    const duplicateBadges = within(browser).getAllByTestId("wiki-tree-duplicate-badge");
    expect(duplicateBadges).toHaveLength(1);
    expect(duplicateBadges[0]).toHaveTextContent("사본 3개");
    expect(duplicateBadges[0]).toHaveAttribute("title");

    // 원본 없는 카드 그룹: 트리 하단에 분리 + "원본 삭제됨" 배지.
    const missingGroup = within(browser).getByTestId("wiki-tree-missing-docs");
    expect(missingGroup).toHaveTextContent("원본 없는 카드 (1)");
    expect(missingGroup).toHaveTextContent("구 지침");
    expect(missingGroup).toHaveTextContent("원본 삭제됨");
    // 활성 문서 목록에는 missing 문서가 보이지 않는다.
    const folderGroup = within(browser).getByText("기획팀 업무자료 (2)").closest("details");
    expect(folderGroup).not.toHaveTextContent("구 지침");

    // missing 카드도 클릭하면 카드 본문은 계속 열어볼 수 있다(보관 기간 내 열람 보장).
    await user.click(within(missingGroup).getByRole("button", { name: /구 지침/ }));
    expect(await screen.findByTestId("knowledge-wiki-page")).toBeInTheDocument();
  });

  it("renders the F-18 docs page template with meta header, overview box, and J-09 actions", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));

    const browser = await screen.findByTestId("knowledge-wiki-browser");
    await waitFor(() => expect(browser).toHaveTextContent("기획팀 업무자료 (2)"));
    await user.click(within(browser).getByRole("button", { name: /예산 검토/ }));

    const docsTemplate = await screen.findByTestId("wiki-template-docs");
    expect(within(docsTemplate).getByRole("heading", { name: "예산 검토" })).toBeInTheDocument();
    expect(within(docsTemplate).getByText("보고서")).toBeInTheDocument();
    expect(within(docsTemplate).getByText("일자 2026-06-01")).toBeInTheDocument();
    expect(within(docsTemplate).getByText("품질 90%")).toBeInTheDocument();

    const overview = screen.getByTestId("wiki-template-overview");
    expect(overview).toHaveTextContent("다음 분기 예산 편성안을 검토하고 주요 변경점을 정리한다.");

    // 섹션 아웃라인은 접이식(details)
    const outlineToggle = within(docsTemplate).getByText("섹션 아웃라인 2개");
    expect(outlineToggle.closest("details")).not.toHaveAttribute("open");
    await user.click(outlineToggle);
    expect(within(docsTemplate).getByText("편성 배경")).toBeInTheDocument();

    // 키워드 칩
    expect(within(docsTemplate).getByText("예산")).toBeInTheDocument();
    expect(within(docsTemplate).getByText("검토")).toBeInTheDocument();

    // 원본 열기 / 경로 복사 아이콘 버튼 (front matter source_path 사용)
    const { openExternalTarget, copyTextToClipboard } = await import("./runtime");
    await user.click(within(docsTemplate).getByRole("button", { name: "예산 검토 원본 열기" }));
    expect(vi.mocked(openExternalTarget)).toHaveBeenCalledWith("C:/Docs/업무자료/budget.hwpx");
    await user.click(within(docsTemplate).getByRole("button", { name: "예산 검토 경로 복사" }));
    expect(vi.mocked(copyTextToClipboard)).toHaveBeenCalledWith("C:/Docs/업무자료/budget.hwpx");

    // J-09: 이 문서로 질문하기 — 업무대화 컴포저 프리필 + 화면 전환
    await user.click(within(docsTemplate).getByRole("button", { name: "이 문서로 질문하기" }));
    const composer = await screen.findByTestId("chat-composer-input");
    expect((composer as HTMLTextAreaElement).value).toBe("『예산 검토』 문서에서 ");
  });

  it("fills the keyword bar from the J-09 관련 검색 header action (live tree focus, no results pane)", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));

    const browser = await screen.findByTestId("knowledge-wiki-browser");
    await waitFor(() => expect(browser).toHaveTextContent("기획팀 업무자료 (2)"));
    await user.click(within(browser).getByRole("button", { name: /예산 검토/ }));

    const docsTemplate = await screen.findByTestId("wiki-template-docs");
    await user.click(within(docsTemplate).getByRole("button", { name: "관련 검색" }));

    // P2: 위키 탭에 머문 채 키워드 바에 제목이 채워지고, 결과 패널로 전환되지 않는다.
    expect(screen.getByRole("tab", { name: "위키" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("지식 검색")).toHaveValue("예산 검토");
    expect(screen.queryByTestId("knowledge-search-results")).not.toBeInTheDocument();
    // 보던 위키 문서는 그대로 유지된다.
    expect(screen.getByTestId("knowledge-wiki-page")).toBeInTheDocument();
  });

  it("renders the F-18 topics page template with a doc-count badge and related card grid", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));

    const browser = await screen.findByTestId("knowledge-wiki-browser");
    await waitFor(() => expect(browser).toHaveTextContent("주제 (1)"));
    const topicsGroup = within(browser).getByText("주제 (1)").closest("details") as HTMLElement;
    await user.click(within(topicsGroup).getByRole("button", { name: /^예산/ }));

    const topicsTemplate = await screen.findByTestId("wiki-template-topics");
    expect(within(topicsTemplate).getByRole("heading", { name: "예산" })).toBeInTheDocument();
    expect(within(topicsTemplate).getByText("문서 1건")).toBeInTheDocument();
    expect(within(topicsTemplate).getByRole("button", { name: /예산 검토/ })).toBeInTheDocument();
  });

  it("falls back to plain markdown rendering for a docs page missing front matter/overview (irregular page)", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));

    const browser = await screen.findByTestId("knowledge-wiki-browser");
    await waitFor(() => expect(browser).toHaveTextContent("기획팀 업무자료 (2)"));
    await user.click(within(browser).getByRole("button", { name: /공공서비스 개선계획/ }));

    // 비정형 페이지(front matter/개요 없음) — 템플릿 대신 기존 마크다운 폴백, 오류 미노출
    expect(screen.queryByTestId("wiki-template-docs")).not.toBeInTheDocument();
    const wikiPage = await screen.findByTestId("knowledge-wiki-page");
    expect(wikiPage).toHaveTextContent("민원 처리 시간을 줄이기 위한 개선 과제를 정리한다.");
    expect(screen.queryByText(/실패했습니다|오류/)).not.toBeInTheDocument();
  });

  it("falls back to index.md rendering when the wiki tree endpoint is unavailable", async () => {
    wikiTreeAvailable = false;
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "위키" }));

    const wikiIndex = await screen.findByTestId("knowledge-wiki-index");
    expect(wikiIndex).toHaveTextContent("지식폴더 위키");

    await user.click(within(wikiIndex).getByRole("button", { name: "공공서비스 개선계획" }));

    const wikiPage = await screen.findByTestId("knowledge-wiki-page");
    expect(wikiPage).toHaveTextContent("민원 처리 시간을 줄이기 위한 개선 과제를 정리한다.");
  });
});
