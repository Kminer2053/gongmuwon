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

describe("knowledge source folders", () => {
  let lastKnowledgeIngestBody: Record<string, unknown> | undefined;
  let lastKnowledgeReindexBody: Record<string, unknown> | undefined;
  let lastCanceledIngestionJobId: string | undefined;
  let nextKnowledgeIngestionStatus: string | undefined;

  beforeEach(() => {
    let knowledgeSources: Array<Record<string, unknown>> = [];
    let knowledgeSourceFiles: Array<Record<string, unknown>> = [];
    let knowledgeIngestionJobs: Array<Record<string, unknown>> = [];
    let knowledgeDocuments: Array<Record<string, unknown>> = [];
    let knowledgeWorkProfile: Record<string, unknown> = {
      id: "default",
      org_name: "",
      department_name: "",
      team_name: "",
      position: "",
      duty_keywords: [],
      created_at: null,
      updated_at: null,
    };
    let knowledgeAnalysis: Record<string, unknown> = {
      run_id: null,
      source_id: "source-1",
      status: "not_analyzed",
      confirmed: false,
      summary: {
        document_count: 0,
        discovered_regulation_count: 0,
        produced_document_count: 0,
        data_source_count: 0,
        collaboration_document_count: 0,
        duplicate_file_count: 0,
        version_family_count: 0,
        needs_review_count: 0,
        role_counts: {},
        questions_needed: [],
      },
      questions_needed: [],
      classifications: [],
    };
    lastKnowledgeIngestBody = undefined;
    lastKnowledgeReindexBody = undefined;
    lastCanceledIngestionJobId = undefined;
    nextKnowledgeIngestionStatus = undefined;

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

        if (url.endsWith("/api/knowledge/work-profile") && method === "GET") {
          return jsonResponse(knowledgeWorkProfile);
        }

        if (url.endsWith("/api/knowledge/work-profile") && method === "PUT") {
          knowledgeWorkProfile = {
            id: "default",
            ...body,
            created_at: "2026-06-15T00:00:00+09:00",
            updated_at: "2026-06-15T00:01:00+09:00",
          };
          return jsonResponse(knowledgeWorkProfile);
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
            scanned_at: "2026-04-28T00:10:00+09:00",
          });
        }

        if (url.endsWith("/api/knowledge/sources/source-1/analyze-work-context") && method === "POST") {
          knowledgeAnalysis = {
            run_id: "analysis-1",
            source_id: "source-1",
            status: "completed",
            confirmed: false,
            summary: {
              document_count: 4,
              discovered_regulation_count: 1,
              produced_document_count: 2,
              data_source_count: 1,
              collaboration_document_count: 0,
              duplicate_file_count: 2,
              version_family_count: 1,
              needs_review_count: 1,
              role_counts: {
                policy_source: 1,
                work_product: 2,
                data_source: 1,
              },
              questions_needed: [],
            },
            questions_needed: [],
            classifications: [
              {
                id: "class-1",
                source_file_id: "file-1",
                document_role: "policy_source",
                document_role_label: "규정/지침",
                family_key: "budget",
                family_relation: "base",
                confidence: 0.88,
                reasons: ["역할 단서: 예산, 규정"],
                ranking_hint: "업무절차 질의에서 규정 근거로 우선 활용",
                needs_review: false,
                confirmed: false,
                relative_path: "budget.md",
                title: "예산 검토",
              },
            ],
            created_at: "2026-06-15T00:02:00+09:00",
            completed_at: "2026-06-15T00:02:03+09:00",
          };
          return jsonResponse(knowledgeAnalysis);
        }

        if (url.endsWith("/api/knowledge/sources/source-1/analysis") && method === "GET") {
          return jsonResponse(knowledgeAnalysis);
        }

        if (url.endsWith("/api/knowledge/sources/source-1/analysis/confirm") && method === "POST") {
          knowledgeAnalysis = { ...knowledgeAnalysis, confirmed: true, confirmed_at: "2026-06-15T00:03:00+09:00" };
          return jsonResponse(knowledgeAnalysis);
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
            current_stage: isCompleted ? "검색 준비" : isRunning ? "임베딩/Chroma" : "폴더 스캔",
            current_stage_index: isCompleted ? 5 : isRunning ? 3 : 0,
            stage_count: 6,
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
              ? "GraphRAG 검색 준비 완료"
              : isRunning
                ? "임베딩/Chroma 단계 처리 중"
                : "GraphRAG ingestion 작업 생성",
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
            stage_count: 6,
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
            last_diagnostic_message: "GraphRAG ingestion 작업 생성",
            started_at: null,
            completed_at: null,
            created_at: "2026-05-06T00:14:00+09:00",
          };
          knowledgeIngestionJobs = [created];
          return jsonResponse({ job: created }, 201);
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
              { event: "job.started", stage: "scan", message: "GraphRAG ingestion 시작" },
              { event: "file.parsed", stage: "parse", title: "예산 검토", quality_score: 0.85 },
              { event: "job.completed", stage: "ready", status: "completed" },
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
          return jsonResponse({
            query: new URL(url, "http://localhost").searchParams.get("query") ?? "",
            vector_hits: [],
            source_file_hits: [],
            graph_neighbors: ["공공서비스 개선계획"],
          });
        }

        if (url.includes("/api/knowledge/graph/query")) {
          return jsonResponse({
            query: new URL(url, "http://localhost").searchParams.get("query") ?? "",
            nodes: [
              {
                id: "ontology:Policy:privacy",
                label: "개인정보보호법",
                node_type: "Policy",
                metadata: { source: "document" },
              },
            ],
            edges: [
              {
                id: "edge-1",
                source_node_id: "document:doc-1",
                target_node_id: "ontology:Policy:privacy",
                relation: "REFERENCES",
                confidence: 0.9,
              },
            ],
            neighbor_nodes: [
              {
                id: "document:doc-1",
                label: "공공서비스 개선계획",
                node_type: "Document",
                metadata: {},
              },
            ],
            related_documents: [
              {
                id: "doc-1",
                title: "공공서비스 개선계획",
                file_path: "C:/Docs/업무자료/service.md",
                document_type: "md",
              },
            ],
          });
        }

        if (url.endsWith("/api/knowledge/ask") && method === "POST") {
          return jsonResponse({
            query: body.query,
            session_id: body.session_id,
            intent: { key: "work_procedure", label: "업무절차 질의" },
            answer: "'개인정보보호법'에 대해 로컬 지식폴더에서 확인한 근거입니다.\n1. 공공서비스 개선계획: 개인정보 처리 기준을 점검합니다.",
            citations: [
              {
                document_id: "doc-1",
                title: "공공서비스 개선계획",
                file_path: "C:/Docs/업무자료/service.md",
                chunk_id: "chunk-1",
                parser_name: "gongmu-markdown",
                quality_score: 0.85,
                partial: false,
                evidence_type: "table",
                quality_warnings: ["no_structured_tables"],
                score_breakdown: {
                  text_score: 50,
                  graph_score: 12,
                  vector_score: 0,
                  session_context_boost: 0,
                  policy_boost: 80,
                  work_context_boost: 100,
                },
                ranking_explanation: "업무절차 질의라서 규정 문서를 우선 반영했습니다.",
                relations: ["REFERENCES"],
              },
            ],
            retrieval_summary: {
              source_count: 1,
              table_evidence_count: 1,
              partial_count: 0,
              low_quality_count: 0,
              relation_count: 1,
            },
            items: [],
          });
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
            vector: {
              production_backend: "chromadb",
              production_available: true,
              production_enabled: false,
              active_backend: "sqlite_fallback",
              activation_ready: true,
              activation_blockers: [],
              activation_notes: ["chromadb is installed but not enabled; SQLite fallback remains active"],
              single_writer_required: true,
              available: true,
              storage_path: "/tmp/gongmu-workspace/db/gongmu.db",
              detail: "ChromaDB PersistentClient can be enabled",
            },
            graph: {
              production_backend: "kuzudb",
              production_available: true,
              production_enabled: false,
              active_backend: "sqlite_graph_mirror",
              activation_ready: true,
              activation_blockers: [],
              activation_notes: ["kuzudb is installed but not enabled; SQLite fallback remains active"],
              single_writer_required: true,
              available: true,
              storage_path: "/tmp/gongmu-workspace/db/gongmu.db",
              detail: "KuzuDB embedded graph store can be enabled",
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

        if (url.endsWith("/api/knowledge/graph")) {
          const nodes = knowledgeSourceFiles.length
            ? [
                { id: "source_folder:source-1", label: "기획팀 업무자료", node_type: "source_folder" },
                ...Array.from({ length: 5 }, (_, index) => ({
                  id: `source_file:file-${index + 1}`,
                  label: `예산 검토 ${index + 1}`,
                  node_type: "source_file",
                })),
                ...Array.from({ length: 5 }, (_, index) => ({
                  id: `keyword:budget-${index + 1}`,
                  label: `키워드 ${index + 1}`,
                  node_type: "keyword",
                })),
              ]
            : [];
          const edges = knowledgeSourceFiles.length
            ? [
                ...Array.from({ length: 5 }, (_, index) => ({
                  source: "source_folder:source-1",
                  target: `source_file:file-${index + 1}`,
                  relation: "contains",
                })),
                ...Array.from({ length: 5 }, (_, index) => ({
                  source: `source_file:file-${index + 1}`,
                  target: `keyword:budget-${index + 1}`,
                  relation: "mentions",
                })),
              ]
            : [];
          return jsonResponse({
            node_count: nodes.length,
            edge_count: edges.length,
            artifacts: {
              graph_json_path: "/tmp/gongmu-workspace/knowledge/graph/graph.json",
              graph_html_path: "/tmp/gongmu-workspace/knowledge/graph/graph.html",
              graph_report_path: "/tmp/gongmu-workspace/knowledge/graph/GRAPH_REPORT.md",
            },
            nodes,
            edges,
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
          "/api/reference-sets": { items: [] },
          "/api/templates": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/personalization/candidates": { items: [] },
          "/api/approval-tickets": { items: [] },
          "/api/integrations/anything/launches": { items: [] },
          "/api/file-organizer/proposals": { items: [] },
          "/api/execution-logs": { items: [] },
          "/api/tools": { items: [] },
        };

        const matched = Object.entries(collectionMap).find(([path]) => url.endsWith(path));
        if (matched) {
          return jsonResponse(matched[1]);
        }

        return jsonResponse({ detail: `Unhandled request: ${method} ${url}` }, 404);
      }),
    );
  });

  it("registers and scans a local source folder from the knowledge screen", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));

    await user.click(screen.getByText("지식 소스 등록 설정"));
    await user.type(screen.getByLabelText("소스 이름"), "기획팀 업무자료");
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await waitFor(() => expect(screen.getByLabelText("폴더 경로")).toHaveValue("C:/Docs/업무자료"));

    await user.click(screen.getByRole("button", { name: "지식 소스 등록" }));
    const sourceCard = await screen.findByText("기획팀 업무자료");
    expect(sourceCard).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "색인 처리" }));
    const indexingSourceCard = await screen.findByText("기획팀 업무자료");
    await user.click(
      within(indexingSourceCard.closest("article") as HTMLElement).getByRole("button", { name: "스캔 시작" }),
    );

    await user.click(screen.getByRole("tab", { name: "설정/상태" }));
    await user.click(screen.getByText("등록된 문서 메타데이터"));
    expect(await screen.findByText("예산 검토")).toBeInTheDocument();
    expect(screen.getByText("예산 편성 회의자료를 정리한다.")).toBeInTheDocument();
    expect(screen.getByText("본문 추출됨")).toBeInTheDocument();
    expect(screen.getByText(/추출물:/)).toBeInTheDocument();
  });

  it("saves the work profile and shows work-aware source analysis before indexing", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));

    await user.click(screen.getByText("업무 프로필"));
    await user.type(screen.getByLabelText("기관명"), "공무원");
    await user.type(screen.getByLabelText("부서명"), "AI혁신과");
    await user.type(screen.getByLabelText("팀명"), "업무자동화팀");
    await user.type(screen.getByLabelText("직위"), "주무관");
    await user.type(screen.getByLabelText("담당업무 키워드"), "AI, 업무자동화, 보고서");
    await user.click(screen.getByRole("button", { name: "업무 프로필 저장" }));

    expect(await screen.findByText("AI혁신과 · 업무자동화팀 · 주무관")).toBeInTheDocument();

    await user.click(screen.getByText("지식 소스 등록 설정"));
    await user.type(screen.getByLabelText("소스 이름"), "기획팀 업무자료");
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "지식 소스 등록" }));
    await screen.findByText("기획팀 업무자료");
    await user.click(screen.getByRole("tab", { name: "색인 처리" }));

    const sourceCards = await screen.findAllByText("기획팀 업무자료");
    const sourceCard = sourceCards[sourceCards.length - 1]!;
    await user.click(within(sourceCard.closest("article") as HTMLElement).getByRole("button", { name: "업무 분석" }));

    expect(await screen.findByText("업무 맥락 분석 결과")).toBeInTheDocument();
    expect(screen.getByText("규정 1개")).toBeInTheDocument();
    expect(screen.getByText("생산문서 2개")).toBeInTheDocument();
    expect(screen.getByText("데이터 1개")).toBeInTheDocument();
    expect(screen.getByText("문서군 1개")).toBeInTheDocument();
    expect(screen.getByText("예산 검토")).toBeInTheDocument();
    expect(screen.getByText("규정/지침")).toBeInTheDocument();
    expect(screen.getByText("업무절차 질의에서 규정 근거로 우선 활용")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "분석 결과 확인" }));
    expect(await screen.findByText("사용자 확인 완료")).toBeInTheDocument();
  });

  it("starts GraphRAG ingestion from a registered knowledge source", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /\uB0B4 \uC9C0\uC2DD\uD3F4\uB354/ }));
    await user.click(screen.getByText("지식 소스 등록 설정"));
    await user.type(screen.getByLabelText("\uC18C\uC2A4 \uC774\uB984"), "Planning docs");
    await user.click(screen.getByRole("button", { name: "\uD3F4\uB354 \uC120\uD0DD" }));
    await user.click(screen.getByRole("button", { name: "\uC9C0\uC2DD \uC18C\uC2A4 \uB4F1\uB85D" }));
    await screen.findByText("Planning docs");
    await user.click(screen.getByRole("tab", { name: "색인 처리" }));
    const sourceCards = await screen.findAllByText("Planning docs");
    const sourceCard = sourceCards[sourceCards.length - 1]!;

    await user.click(
      within(sourceCard.closest("article") as HTMLElement).getByRole("button", {
        name: "GraphRAG \uC778\uB371\uC2F1",
      }),
    );

    await user.click(screen.getByText("GraphRAG ingestion \uC791\uC5C5"));
    expect(await screen.findByText("GraphRAG 작업 #job1")).toBeInTheDocument();
    expect(screen.getByText("1/1 \uCC98\uB9AC \u00B7 \uC2E4\uD328 0")).toBeInTheDocument();
    expect(screen.getByText("\uC0AD\uC81C\uB3D9\uAE30\uD654 1")).toBeInTheDocument();
    expect(screen.getByText("\uBCC0\uACBD\uC5C6\uC74C 2")).toBeInTheDocument();
    expect(screen.getByText("마지막 처리: budget.md")).toBeInTheDocument();
    expect(screen.getByText("소요 120ms · 파일당 120ms")).toBeInTheDocument();
    expect(lastKnowledgeIngestBody).toEqual({
      source_id: "source-1",
      run_now: true,
      background: true,
    });

    await user.click(screen.getByRole("button", { name: "색인완료 파일 2개" }));
    expect(await screen.findByText("\uC608\uC0B0 \uAC80\uD1A0")).toBeInTheDocument();
    expect(screen.getByText("parser gongmu-markdown")).toBeInTheDocument();
    expect(screen.getByText("\uD488\uC9C8 85%")).toBeInTheDocument();
    expect(screen.getByText("\uC139\uC158 2 · \uD45C 1")).toBeInTheDocument();
    expect(screen.getByText("chunk 3 · 표 chunk 1")).toBeInTheDocument();
    expect(screen.getByText("문단 1 · 글자 42")).toBeInTheDocument();
    expect(screen.getByText("경고 없음")).toBeInTheDocument();
    expect(screen.getByText("스캔 문서")).toBeInTheDocument();
    expect(screen.getByText("경고: 부분 추출, 본문 부족")).toBeInTheDocument();
  });

  it("opens document structure from the indexing extraction status list", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByText("지식 소스 등록 설정"));
    await user.type(screen.getByLabelText("소스 이름"), "기획팀 업무자료");
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "지식 소스 등록" }));
    await user.click(screen.getByRole("tab", { name: "색인 처리" }));

    const sourceCards = await screen.findAllByText("기획팀 업무자료");
    const sourceCard = sourceCards[sourceCards.length - 1]!;
    await user.click(
      within(sourceCard.closest("article") as HTMLElement).getByRole("button", {
        name: "GraphRAG 인덱싱",
      }),
    );

    await screen.findByText("GraphRAG 작업 #job1");
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

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByText("지식 소스 등록 설정"));
    await user.type(screen.getByLabelText("소스 이름"), "기획팀 업무자료");
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "지식 소스 등록" }));
    await user.click(screen.getByRole("tab", { name: "색인 처리" }));

    nextKnowledgeIngestionStatus = "running";
    const sourceCards = await screen.findAllByText("기획팀 업무자료");
    const sourceCard = sourceCards[sourceCards.length - 1]!;
    await user.click(
      within(sourceCard.closest("article") as HTMLElement).getByRole("button", {
        name: "GraphRAG 인덱싱",
      }),
    );

    expect(await screen.findByText(/GraphRAG 인덱싱 작업 #job1이 진행 중입니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "스캔 시작" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "GraphRAG 인덱싱" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "강제 재색인" })).toBeDisabled();

    await user.click(screen.getByRole("tab", { name: "설정/상태" }));
    expect(screen.getByLabelText("소스 이름")).toBeDisabled();
    expect(screen.getByLabelText("폴더 경로")).toBeDisabled();
    expect(screen.getByRole("button", { name: "폴더 선택" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "지식 소스 등록" })).toBeDisabled();
  });

  it("starts forced GraphRAG reindex from a registered knowledge source", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /\uB0B4 \uC9C0\uC2DD\uD3F4\uB354/ }));
    await user.click(screen.getByText("지식 소스 등록 설정"));
    await user.type(screen.getByLabelText("\uC18C\uC2A4 \uC774\uB984"), "Planning docs");
    await user.click(screen.getByRole("button", { name: "\uD3F4\uB354 \uC120\uD0DD" }));
    await user.click(screen.getByRole("button", { name: "\uC9C0\uC2DD \uC18C\uC2A4 \uB4F1\uB85D" }));
    await screen.findByText("Planning docs");
    await user.click(screen.getByRole("tab", { name: "색인 처리" }));
    const sourceCards = await screen.findAllByText("Planning docs");
    const sourceCard = sourceCards[sourceCards.length - 1]!;

    await user.click(
      within(sourceCard.closest("article") as HTMLElement).getByRole("button", {
        name: "\uAC15\uC81C \uC7AC\uC0C9\uC778",
      }),
    );

    await user.click(screen.getByText("GraphRAG ingestion \uC791\uC5C5"));
    expect(await screen.findByText("GraphRAG 작업 #jobforce")).toBeInTheDocument();
    expect(lastKnowledgeReindexBody).toEqual({
      source_id: "source-1",
      run_now: true,
      background: true,
    });
  });

  it("cancels a queued GraphRAG ingestion job from the job card", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /\uB0B4 \uC9C0\uC2DD\uD3F4\uB354/ }));
    await user.click(screen.getByText("지식 소스 등록 설정"));
    await user.type(screen.getByLabelText("\uC18C\uC2A4 \uC774\uB984"), "Planning docs");
    await user.click(screen.getByRole("button", { name: "\uD3F4\uB354 \uC120\uD0DD" }));
    await user.click(screen.getByRole("button", { name: "\uC9C0\uC2DD \uC18C\uC2A4 \uB4F1\uB85D" }));
    await screen.findByText("Planning docs");
    await user.click(screen.getByRole("tab", { name: "색인 처리" }));
    const sourceCards = await screen.findAllByText("Planning docs");
    const sourceCard = sourceCards[sourceCards.length - 1]!;

    await user.click(
      within(sourceCard.closest("article") as HTMLElement).getByRole("button", {
        name: "\uAC15\uC81C \uC7AC\uC0C9\uC778",
      }),
    );
    await user.click(screen.getByText("GraphRAG ingestion \uC791\uC5C5"));
    await user.click(await screen.findByRole("button", { name: "\uCDE8\uC18C" }));

    expect(lastCanceledIngestionJobId).toBe("job-force");
    expect(await screen.findByText("\uCDE8\uC18C\uB428")).toBeInTheDocument();
  }, 10000);

  it("shows a scrollable knowledge graph and interactive legend before detailed data", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));

    expect(screen.queryByText("수동 메모를 지식 후보로 올리기")).not.toBeInTheDocument();
    expect(screen.queryByText("반영 후보")).not.toBeInTheDocument();
    expect(screen.getByTestId("knowledge-graph-overview")).toHaveTextContent("지식 그래프");
    expect(screen.getByTestId("knowledge-graph-overview")).toHaveTextContent("인터랙티브 업무지식 지도");
    expect(screen.getByTestId("knowledge-graph-map")).toHaveTextContent("상하좌우로 스크롤");
    expect(screen.getByTestId("knowledge-graph-svg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "지식 그래프 확대" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "지식 그래프 축소" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "지식 그래프 맞춤" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "폴더" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "지식 그래프 확대" }));
    expect(screen.getByTestId("knowledge-graph-svg")).toHaveAttribute("data-zoom", "1.1");

    await user.click(screen.getByRole("button", { name: "문서" }));
    expect(screen.getByRole("button", { name: "문서" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("지식 소스 등록 설정")).toBeInTheDocument();
    expect(screen.getByText("등록된 문서 메타데이터")).toBeInTheDocument();
    expect(screen.getByText("업무대화 반영 기록")).toBeInTheDocument();
  });

  it("separates knowledge setup, indexing diagnostics, and GraphRAG search into clear workspaces", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));

    expect(screen.getByRole("tab", { name: "설정/상태" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("지식 소스 등록 설정")).toBeInTheDocument();
    expect(screen.queryByLabelText("지식 검색")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "색인 처리" }));
    expect(screen.getByText("GraphRAG 처리 흐름")).toBeInTheDocument();
    expect(screen.getByText("폴더 스캔")).toBeInTheDocument();
    expect(screen.getByText("파싱")).toBeInTheDocument();
    expect(screen.getByText("청킹")).toBeInTheDocument();
    expect(screen.getByText("임베딩/Chroma")).toBeInTheDocument();
    expect(screen.getByText("그래프 연결")).toBeInTheDocument();
    expect(screen.getByText("검색 준비")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "GraphRAG 검색" }));
    expect(screen.getByLabelText("지식 검색")).toBeInTheDocument();
    expect(screen.queryByText("지식 소스 등록 설정")).not.toBeInTheDocument();
  });

  it("shows GraphRAG full log dump and visual ingestion progress status", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByText("지식 소스 등록 설정"));
    await user.type(screen.getByLabelText("소스 이름"), "Planning docs");
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "지식 소스 등록" }));
    await screen.findByText("Planning docs");
    await user.click(screen.getByRole("tab", { name: "색인 처리" }));
    const sourceCards = await screen.findAllByText("Planning docs");
    const sourceCard = sourceCards[sourceCards.length - 1]!;

    await user.click(
      within(sourceCard.closest("article") as HTMLElement).getByRole("button", {
        name: "GraphRAG 인덱싱",
      }),
    );

    expect(await screen.findByText("풀로그 덤프")).toBeInTheDocument();
    expect(screen.getByText("/tmp/gongmu-workspace/logs/knowledge-ingestion/job-1.jsonl")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "경로 복사" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "폴더 열기" })).toBeInTheDocument();
    const dumpViewerButton = screen.getByRole("button", { name: "덤프 뷰어 열기" });
    expect(dumpViewerButton).toBeInTheDocument();
    await user.click(dumpViewerButton);
    expect(await screen.findByText("job.started")).toBeInTheDocument();
    expect(screen.getByText("GraphRAG ingestion 시작")).toBeInTheDocument();
    expect(screen.getByText("진단 이벤트 12개")).toBeInTheDocument();
    expect(screen.getByText("GraphRAG 검색 준비 완료")).toBeInTheDocument();
    expect(screen.getByTestId("knowledge-ingestion-stage-rail")).toHaveTextContent("검색 준비");
  });

  it("shows the active GraphRAG vector and graph backends", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));

    expect(await screen.findByText("Vector: sqlite_fallback")).toBeInTheDocument();
    expect(screen.getByText("Graph: sqlite_graph_mirror")).toBeInTheDocument();
    expect(screen.getByText("Vector 후보: chromadb 비활성")).toBeInTheDocument();
    expect(screen.getByText("Graph 후보: kuzudb 비활성")).toBeInTheDocument();
    expect(screen.getByText("Vector 준비: 활성화 가능")).toBeInTheDocument();
    expect(screen.getByText("Graph 준비: 활성화 가능")).toBeInTheDocument();
    expect(screen.getByText("KORdoc: 준비됨")).toBeInTheDocument();
  });

  it("expands the graph canvas height when there are many nodes", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByText("지식 소스 등록 설정"));
    await user.type(screen.getByLabelText("소스 이름"), "기획팀 업무자료");
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "지식 소스 등록" }));
    await screen.findByText("기획팀 업무자료");
    await user.click(screen.getByRole("tab", { name: "색인 처리" }));
    const sourceCard = await screen.findByText("기획팀 업무자료");
    await user.click(within(sourceCard.closest("article") as HTMLElement).getByRole("button", { name: "스캔 시작" }));

    await waitFor(() => {
      const viewBox = screen.getByTestId("knowledge-graph-svg").getAttribute("viewBox") ?? "";
      const [, , , height] = viewBox.split(" ").map(Number);
      expect(height).toBeGreaterThan(360);
    });
  });

  it("shows GraphRAG relationship drill-down from a knowledge query", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "GraphRAG 검색" }));
    await user.type(screen.getByLabelText("지식 검색"), "개인정보보호법");
    await user.click(screen.getByRole("button", { name: "검색 실행" }));

    expect(await screen.findByText("관계 보기")).toBeInTheDocument();
    expect(screen.getByText("개인정보보호법")).toBeInTheDocument();
    expect(screen.getByText("REFERENCES")).toBeInTheDocument();
    expect(screen.getAllByText("공공서비스 개선계획").length).toBeGreaterThan(0);
    expect(screen.getByText(/service\.md/)).toBeInTheDocument();
  });

  it("opens relationship drill-down when a graph node is clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByText("지식 소스 등록 설정"));
    await user.type(screen.getByLabelText("소스 이름"), "기획팀 업무자료");
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "지식 소스 등록" }));
    await screen.findByText("기획팀 업무자료");
    await user.click(screen.getByRole("tab", { name: "색인 처리" }));
    const sourceCard = await screen.findByText("기획팀 업무자료");
    await user.click(within(sourceCard.closest("article") as HTMLElement).getByRole("button", { name: "스캔 시작" }));

    await user.click(await screen.findByRole("button", { name: /관계 보기 예산 검토 1/ }));

    expect(await screen.findByTestId("knowledge-graph-query-result")).toHaveTextContent("REFERENCES");
    expect(screen.getByText(/service\.md/)).toBeInTheDocument();
  });

  it("shows section and table drill-down for a related GraphRAG document", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "GraphRAG 검색" }));
    await user.type(screen.getByLabelText("지식 검색"), "개인정보보호법");
    await user.click(screen.getByRole("button", { name: "검색 실행" }));
    const relationshipPanel = await screen.findByTestId("knowledge-graph-query-result");

    await user.click(within(relationshipPanel).getByRole("button", { name: "구조 보기" }));

    expect(await screen.findByText("문서 구조")).toBeInTheDocument();
    expect(screen.getByText("parser gongmu-markdown")).toBeInTheDocument();
    expect(screen.getByText("품질 85%")).toBeInTheDocument();
    expect(screen.getByText("chunk 3 · 표 chunk 1")).toBeInTheDocument();
    expect(screen.getByText("문단 2 · 글자 54")).toBeInTheDocument();
    expect(screen.getByText("경고 없음")).toBeInTheDocument();
    expect(screen.getByText("structured")).toBeInTheDocument();
    expect(screen.getByText("추진배경")).toBeInTheDocument();
    expect(screen.getByText("세부추진계획")).toBeInTheDocument();
    expect(screen.getByText("사업별 예산")).toBeInTheDocument();
    expect(screen.getByText("항목")).toBeInTheDocument();
    expect(screen.getByText("공공서비스 포털")).toBeInTheDocument();
  });

  it("generates a grounded GraphRAG answer with citations from the knowledge query", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /내 지식폴더/ }));
    await user.click(screen.getByRole("tab", { name: "GraphRAG 검색" }));
    await user.type(screen.getByLabelText("지식 검색"), "개인정보보호법");
    await user.click(screen.getByRole("button", { name: "근거 답변 생성" }));

    expect(await screen.findByText("근거 답변")).toBeInTheDocument();
    expect(screen.getByText(/개인정보 처리 기준을 점검합니다/)).toBeInTheDocument();
    expect(screen.getByText("세션 맥락: 민원 개선 작업")).toBeInTheDocument();
    expect(screen.getByText("출처 문서")).toBeInTheDocument();
    expect(screen.getByText("공공서비스 개선계획")).toBeInTheDocument();
    expect(screen.getByText("parser gongmu-markdown")).toBeInTheDocument();
    expect(screen.getByText("품질 85%")).toBeInTheDocument();
    expect(screen.getByText("structured")).toBeInTheDocument();
    expect(screen.getByText("표 근거")).toBeInTheDocument();
    expect(screen.getByText("경고: 표 구조 없음")).toBeInTheDocument();
    expect(screen.getByText("검색근거 1개 · 표근거 1개 · 관계 1개")).toBeInTheDocument();
    expect(screen.getByText("업무절차 질의")).toBeInTheDocument();
    expect(screen.getByText("업무절차 질의라서 규정 문서를 우선 반영했습니다.")).toBeInTheDocument();
    expect(screen.getByText("업무 boost 100점")).toBeInTheDocument();
    expect(screen.getByText("REFERENCES")).toBeInTheDocument();
  });
});
