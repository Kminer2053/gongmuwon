import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeState = {
  status: {
    available: true,
    mode: "tauri" as const,
    sidecar_url: "http://127.0.0.1:8765",
    anything_available: true,
    anything_mode: "external_app_detected" as const,
    anything_path: "C:/Users/USER/AppData/Local/Anything/docufinder.exe",
    anything_autopaste_enabled: false,
    running: true,
    managed: true,
    auto_restart_recommended: false,
    log_path: "/tmp/gongmu-workspace/logs/sidecar-runtime.log",
    detail: "managed sidecar running",
  },
};

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: vi.fn(async () => runtimeState.status),
  startDesktopSidecar: vi.fn(async () => runtimeState.status),
  stopDesktopSidecar: vi.fn(async () => runtimeState.status),
  restartDesktopSidecar: vi.fn(async () => runtimeState.status),
  pickDirectory: vi.fn(async () => null),
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

let latestSettingsPayload: Record<string, unknown> | undefined;
let requestPaths: string[];

describe("환경설정 편집", () => {
  beforeEach(() => {
    latestSettingsPayload = undefined;
    requestPaths = [];

    let settings = {
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
        embedding_provider: "deterministic",
        embedding_model: "nomic-embed-text",
        embedding_base_url: null,
        embedding_fallback_enabled: true,
        graphrag_vector_backend: "chromadb",
        profiles: {
          local_first: {
            provider: "openai_compatible",
            model: "gpt-4.1-mini",
            api_key: null,
            base_url: null,
            site_url: null,
            application_name: null,
          },
          internal_server: {
            provider: "openai_compatible",
            model: "gpt-4.1-mini",
            api_key: null,
            base_url: "http://127.0.0.1:9000/v1",
            site_url: null,
            application_name: null,
          },
          external_model: {
            active_provider: "openrouter",
            providers: {
              openai: {
                provider: "openai",
                model: "gpt-5.5",
                api_key: null,
                base_url: "https://api.openai.com/v1",
                site_url: null,
                application_name: null,
              },
              openrouter: {
                provider: "openrouter",
                model: "openai/gpt-5.5",
                api_key: null,
                base_url: "https://openrouter.ai/api/v1",
                site_url: null,
                application_name: null,
              },
              featherless: {
                provider: "featherless",
                model: "google/gemma-4-E2B-it",
                api_key: null,
                base_url: "https://api.featherless.ai/v1",
                site_url: null,
                application_name: null,
              },
              anthropic: {
                provider: "anthropic",
                model: "claude-sonnet-4-20250514",
                api_key: null,
                base_url: "https://api.anthropic.com/v1",
                site_url: null,
                application_name: null,
              },
            },
          },
        },
      },
      paths: {
        workspace_root: "/tmp/gongmu-workspace",
        database: "/tmp/gongmu-workspace/db/gongmu.db",
        knowledge_root: "/tmp/gongmu-workspace/knowledge",
        documents_root: "/tmp/gongmu-workspace/documents",
        personalization_root: "/tmp/gongmu-workspace/personalization",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        requestPaths.push(`${method} ${url}`);

        if (url.endsWith("/health")) {
          return jsonResponse({
            status: "ok",
            workspace_root: "/tmp/gongmu-workspace",
            database: "/tmp/gongmu-workspace/db/gongmu.db",
          });
        }

        if (url.endsWith("/api/settings") && method === "GET") {
          return jsonResponse(settings);
        }

        if (url.endsWith("/api/settings") && method === "PUT") {
          latestSettingsPayload = body;
          settings = {
            ...settings,
            defaults: {
              ...settings.defaults,
              ...body,
              profiles: body.llm_profiles ?? settings.defaults.profiles,
            },
          };
          return jsonResponse(settings);
        }

        if (url.endsWith("/api/settings/llm-test") && method === "POST") {
          return jsonResponse({
            status: "ok",
            provider: settings.defaults.llm_provider,
            model: settings.defaults.llm_model,
            text: "LLM connection ok",
          });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": { items: [] },
          "/api/work-sessions": { items: [] },
          "/api/templates": { items: [] },
          "/api/approval-tickets": { items: [] },
          "/api/jobs?limit=20": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/knowledge/sources": { items: [] },
          "/api/knowledge/source-files": { items: [] },
          "/api/knowledge/ingestion-jobs": { items: [] },
          "/api/knowledge/documents": { items: [] },
          "/api/personalization/candidates": { items: [] },
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

  async function openSettings() {
    render(<App />);
    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await userEvent.click(within(navigation).getByRole("button", { name: "환경설정" }));
  }

  async function openNewProfileEditor() {
    await userEvent.click(await screen.findByRole("button", { name: "새 프로필" }));
    return screen.findByLabelText("LLM 정책").then((select) => select.closest("form")!);
  }

  it("Featherless preset shows official OpenAI-compatible values", async () => {
    await openSettings();
    await openNewProfileEditor();

    await userEvent.selectOptions(await screen.findByLabelText("LLM 정책"), "external_model");
    await userEvent.selectOptions(screen.getByLabelText("외부 모델 공급자"), "featherless");

    expect(screen.getByLabelText("Featherless API Key")).toBeInTheDocument();
    expect(screen.getByDisplayValue("google/gemma-4-E2B-it")).toBeInTheDocument();
    expect(screen.getByLabelText("모델 API Base URL")).toHaveValue("https://api.featherless.ai/v1");
    expect(screen.getByLabelText("Featherless API 사이트 URL (선택)")).toBeInTheDocument();
    expect(screen.getByLabelText("Featherless API 앱 이름 (선택)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "공식 연결 가이드" })).toHaveAttribute(
      "href",
      "https://featherless.ai/docs/api-overview-and-common-options",
    );
  });

  it("saves provider values and can run the connection test", async () => {
    await openSettings();
    const form = await openNewProfileEditor();

    await userEvent.selectOptions(await screen.findByLabelText("LLM 정책"), "external_model");
    await userEvent.selectOptions(screen.getByLabelText("외부 모델 공급자"), "anthropic");
    await userEvent.clear(screen.getByLabelText("LLM Model"));
    await userEvent.type(screen.getByLabelText("LLM Model"), "claude-sonnet-4-20250514");
    await userEvent.type(screen.getByLabelText("Anthropic API Key"), "sk-ant-test");
    await userEvent.click(within(form).getByRole("button", { name: "설정 저장" }));

    await waitFor(() => {
      expect(screen.getByLabelText("외부 모델 공급자")).toHaveValue("anthropic");
      expect(screen.getByDisplayValue("claude-sonnet-4-20250514")).toBeInTheDocument();
      expect(screen.getByLabelText("Anthropic API Key")).toHaveValue("sk-ant-test");
      expect(screen.getByDisplayValue("https://api.anthropic.com/v1")).toBeInTheDocument();
    });

    await userEvent.click(within(form).getByRole("button", { name: "저장 후 연결 테스트" }));
    await waitFor(() => {
      expect(screen.getByText("LLM 연결 테스트가 완료되었습니다.")).toBeInTheDocument();
    });
  }, 15000);

  it("does not wait for full knowledge document listing after settings save", async () => {
    await openSettings();
    const form = await openNewProfileEditor();
    requestPaths = [];

    await userEvent.click(within(form).getByRole("button", { name: "설정 저장" }));

    await waitFor(() => {
      expect(latestSettingsPayload).toBeDefined();
    });
    expect(requestPaths.some((path) => path.includes("/api/knowledge/documents"))).toBe(false);
  });

  it("no longer exposes GraphRAG embedding controls and does not send embedding fields", async () => {
    await openSettings();
    const form = await openNewProfileEditor();

    await screen.findByLabelText("LLM 정책");
    expect(screen.queryByText("GraphRAG 임베딩")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Embedding Provider")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Vector Store")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Embedding Model")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Embedding Base URL")).not.toBeInTheDocument();
    expect(screen.queryByText("GraphRAG Vector Store")).not.toBeInTheDocument();

    await userEvent.click(within(form).getByRole("button", { name: "설정 저장" }));

    await waitFor(() => {
      expect(latestSettingsPayload).toBeDefined();
    });
    expect(latestSettingsPayload).not.toHaveProperty("embedding_provider");
    expect(latestSettingsPayload).not.toHaveProperty("embedding_model");
    expect(latestSettingsPayload).not.toHaveProperty("graphrag_vector_backend");
  });
});
