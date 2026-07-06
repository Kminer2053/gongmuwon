import { describe, expect, it, vi } from "vitest";
import {
  createEmptyWorkspaceSnapshot,
  loadWorkJobsOnly,
  loadWorkspaceShellSnapshot,
  loadWorkspaceSnapshot,
  mergeWorkspaceSnapshot,
  parseWorkspaceSettings,
  runWorkSessionTurnStream,
} from "./api";

describe("parseWorkspaceSettings", () => {
  it("loads the shell snapshot without waiting for heavy knowledge documents", async () => {
    const originalFetch = global.fetch;
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/health")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            workspace_root: "/tmp/gongmu-workspace",
            database: "/tmp/gongmu-workspace/db/gongmu.db",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/api/settings")) {
        return new Response(
          JSON.stringify({
            defaults: {},
            paths: { workspace_root: "/tmp/gongmu-workspace" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (
        url.endsWith("/api/schedules") ||
        url.endsWith("/api/work-sessions") ||
        url.endsWith("/api/templates") ||
        url.endsWith("/api/approval-tickets")
      ) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected shell call: ${url}`);
    }) as typeof fetch;

    try {
      const snapshot = await loadWorkspaceShellSnapshot();
      expect(snapshot.health?.status).toBe("ok");
      expect(snapshot.settings?.paths.workspace_root).toBe("/tmp/gongmu-workspace");
      expect(calls.some((url) => url.endsWith("/api/knowledge/documents"))).toBe(false);
      expect(calls.some((url) => url.endsWith("/api/execution-logs"))).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("skips settings/templates when includeConfig is false (D-03 idle heartbeat)", async () => {
    const originalFetch = global.fetch;
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await loadWorkspaceShellSnapshot({ includeConfig: false });
      expect(calls.some((url) => url.endsWith("/api/settings"))).toBe(false);
      expect(calls.some((url) => url.endsWith("/api/templates"))).toBe(false);
      expect(calls.some((url) => url.includes("/api/jobs?limit=20"))).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("loads only the jobs list with loadWorkJobsOnly (D-03 active-jobs poll)", async () => {
    const originalFetch = global.fetch;
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "job-1",
              kind: "knowledge.ingest",
              title: "지식위키 색인",
              status: "running",
              priority: 50,
              resource_policy: "exclusive",
              progress_percent: 40,
              cancel_requested: false,
              created_at: "2026-07-04T00:00:00Z",
              queued_at: "2026-07-04T00:00:00Z",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const patch = await loadWorkJobsOnly();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("/api/jobs?limit=20");
      expect(patch.workJobs).toHaveLength(1);
      expect(Object.keys(patch)).toEqual(["workJobs"]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("no longer requests anything/file-organizer endpoints in the full snapshot (D-04)", async () => {
    const originalFetch = global.fetch;
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/settings")) {
        return new Response(
          JSON.stringify({ defaults: {}, paths: { workspace_root: "/tmp/gongmu-workspace" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const snapshot = await loadWorkspaceSnapshot();
      expect(calls.some((url) => url.includes("/api/integrations/anything"))).toBe(false);
      expect(calls.some((url) => url.includes("/api/file-organizer"))).toBe(false);
      expect(calls.some((url) => url.endsWith("/api/execution-logs"))).toBe(true);
      expect("anythingLaunches" in snapshot).toBe(false);
      expect("fileProposals" in snapshot).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("merges deferred snapshot lists into an existing shell snapshot", () => {
    const base = createEmptyWorkspaceSnapshot();
    const merged = mergeWorkspaceSnapshot(base, {
      knowledgeDocuments: [
        {
          id: "doc-1",
          source_file_id: "file-1",
          source_id: "source-1",
          title: "문서",
          file_path: "C:/a.pdf",
          relative_path: "a.pdf",
          document_type: "pdf",
          attachment_count: 0,
          parser_name: "gongmu-pdf",
          partial: false,
          quality_score: 0.8,
          created_at: "2026-05-18T00:00:00Z",
          updated_at: "2026-05-18T00:00:00Z",
        },
      ],
      logs: [
        {
          id: "log-1",
          feature: "knowledge",
          action: "knowledge.ingest.job.run",
          status: "completed",
          created_at: "2026-05-18T00:00:00Z",
          inputs: {},
          outputs: {},
          approval_ticket_id: null,
        },
      ],
    });

    expect(merged.knowledgeDocuments).toHaveLength(1);
    expect(merged.logs).toHaveLength(1);
  });

  it("fills in safe defaults when optional settings fields are missing", () => {
    const parsed = parseWorkspaceSettings({
      defaults: {},
      paths: {
        workspace_root: "/tmp/gongmu-workspace",
      },
    });

    expect(parsed.defaults).toEqual({
      llm_mode: "local_first",
      llm_provider: "openai_compatible",
      llm_model: "gpt-4.1-mini",
      llm_api_key: null,
      llm_site_url: null,
      llm_application_name: null,
      profiles: expect.objectContaining({
        local_first: expect.objectContaining({ provider: "openai_compatible" }),
        internal_server: expect.objectContaining({ base_url: "http://127.0.0.1:9000/v1" }),
        external_model: expect.objectContaining({ active_provider: "openai" }),
      }),
      anything_launch_mode: "external_app_preferred",
      default_template_key: "report",
      internal_api_base_url: null,
      personalization_apply_mode: "approval_required",
      embedding_provider: "deterministic",
      embedding_model: "nomic-embed-text",
      embedding_base_url: "http://127.0.0.1:11434",
      embedding_fallback_enabled: true,
      graphrag_vector_backend: "sqlite",
    });
    expect(parsed.paths).toEqual({
      workspace_root: "/tmp/gongmu-workspace",
      database: "/tmp/gongmu-workspace/gongmu.db",
      knowledge_root: "/tmp/gongmu-workspace/knowledge",
      documents_root: "/tmp/gongmu-workspace/documents",
      personalization_root: "/tmp/gongmu-workspace/personalization",
    });
  });

  it("rejects a completely invalid payload shape", () => {
    expect(() => parseWorkspaceSettings(null)).toThrow("invalid workspace settings payload");
  });

  it("parses provider-specific optional fields when present", () => {
    const parsed = parseWorkspaceSettings({
      defaults: {
        llm_mode: "external_model",
        llm_provider: "openrouter",
        llm_model: "openai/gpt-5.5",
        llm_api_key: "sk-or-v1-test",
        llm_site_url: "https://gongmu.local",
        llm_application_name: "Gongmu Workspace",
        internal_api_base_url: "https://openrouter.ai/api/v1",
        anything_launch_mode: "external_app_preferred",
        default_template_key: "meeting",
      },
      paths: {
        workspace_root: "/tmp/gongmu-workspace",
        database: "/tmp/gongmu-workspace/gongmu.db",
        knowledge_root: "/tmp/gongmu-workspace/knowledge",
        documents_root: "/tmp/gongmu-workspace/documents",
      },
    });

    expect(parsed.defaults.llm_provider).toBe("openrouter");
    expect(parsed.defaults.llm_site_url).toBe("https://gongmu.local");
    expect(parsed.defaults.llm_application_name).toBe("Gongmu Workspace");
  });

  it("parses GraphRAG embedding provider settings", () => {
    const parsed = parseWorkspaceSettings({
      defaults: {
        embedding_provider: "ollama",
        embedding_model: "bge-m3",
        embedding_base_url: "http://127.0.0.1:11434",
        embedding_fallback_enabled: false,
      },
      paths: {
        workspace_root: "/tmp/gongmu-workspace",
      },
    });

    expect(parsed.defaults.embedding_provider).toBe("ollama");
    expect(parsed.defaults.embedding_model).toBe("bge-m3");
    expect(parsed.defaults.embedding_base_url).toBe("http://127.0.0.1:11434");
    expect(parsed.defaults.embedding_fallback_enabled).toBe(false);
  });

  it("parses GraphRAG vector backend settings", () => {
    const parsed = parseWorkspaceSettings({
      defaults: {
        graphrag_vector_backend: "chromadb",
      },
      paths: {
        workspace_root: "/tmp/gongmu-workspace",
      },
    });

    expect(parsed.defaults.graphrag_vector_backend).toBe("chromadb");
  });

  it("keeps explicit SQLite fallback settings when present", () => {
    const parsed = parseWorkspaceSettings({
      defaults: {
        graphrag_vector_backend: "sqlite",
      },
      paths: {
        workspace_root: "/tmp/gongmu-workspace",
      },
    });

    expect(parsed.defaults.graphrag_vector_backend).toBe("sqlite");
  });

  it("parses work-session SSE turn events and exposes streamed deltas", async () => {
    const originalFetch = global.fetch;
    const encoder = new TextEncoder();
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'event: user_message',
                  'data: {"id":"user-1","session_id":"session-1","role":"user","text":"질문","message_type":"chat","status":"completed","created_at":"2026-05-20T00:00:00Z","attachments":[]}',
                  "",
                  'event: assistant_message',
                  'data: {"id":"assistant-1","session_id":"session-1","role":"assistant","text":"","message_type":"chat","status":"streaming","provider":"ollama","model":"qwen","created_at":"2026-05-20T00:00:01Z"}',
                  "",
                  'event: delta',
                  'data: {"text":"첫 "}',
                  "",
                  'event: delta',
                  'data: {"text":"응답"}',
                  "",
                  'event: done',
                  'data: {"user_message":{"id":"user-1","session_id":"session-1","role":"user","text":"질문","message_type":"chat","status":"completed","created_at":"2026-05-20T00:00:00Z","attachments":[]},"assistant_message":{"id":"assistant-1","session_id":"session-1","role":"assistant","text":"첫 응답","message_type":"chat","status":"completed","provider":"ollama","model":"qwen","latency_ms":12,"created_at":"2026-05-20T00:00:01Z"},"duration_ms":12,"context_summary":{"graphrag_used":false,"graphrag_evidence_count":0,"attachment_count":0,"linked_file_count":0,"provider":"ollama","model":"qwen"}}',
                  "",
                ].join("\n"),
              ),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    }) as typeof fetch;

    const deltas: string[] = [];
    const result = await runWorkSessionTurnStream(
      "session-1",
      { text: "질문" },
      {
        onDelta: (delta) => deltas.push(delta.text),
      },
    );

    try {
      expect(calls[0]).toContain("/api/work-sessions/session-1/turn/stream");
      expect(deltas).toEqual(["첫 ", "응답"]);
      expect(result.assistant_message.text).toBe("첫 응답");
      expect(result.context_summary?.provider).toBe("ollama");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
