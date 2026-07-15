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

describe("LLM profile persistence", () => {
  beforeEach(() => {
    let settings = {
      defaults: {
        llm_mode: "external_model",
        llm_provider: "openrouter",
        llm_model: "openai/gpt-5.5",
        llm_api_key: "sk-or-original",
        llm_site_url: "https://gongmu.example",
        llm_application_name: "Gongmu Workspace",
        anything_launch_mode: "external_app_preferred",
        default_template_key: "report",
        internal_api_base_url: "https://openrouter.ai/api/v1",
        personalization_apply_mode: "approval_required",
        profiles: {
          local_first: {
            provider: "openai_compatible",
            model: "local-model",
            api_key: null,
            base_url: null,
            site_url: null,
            application_name: null,
          },
          internal_server: {
            provider: "openai_compatible",
            model: "internal-model",
            api_key: null,
            base_url: "http://127.0.0.1:9000/v1",
            site_url: null,
            application_name: null,
          },
          external_model: {
            active_provider: "openrouter",
            providers: {
              openrouter: {
                provider: "openrouter",
                model: "openai/gpt-5.5",
                api_key: "sk-or-original",
                base_url: "https://openrouter.ai/api/v1",
                site_url: "https://gongmu.example",
                application_name: "Gongmu Workspace",
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
          settings = {
            ...settings,
            defaults: {
              ...settings.defaults,
              ...body,
              profiles: body.llm_profiles ?? settings.defaults.profiles,
            },
            paths: {
              ...settings.paths,
              personalization_root: body.personalization_root ?? settings.paths.personalization_root,
            },
          };
          return jsonResponse(settings);
        }

        if (url.endsWith("/api/settings/llm-test")) {
          return jsonResponse({
            status: "ok",
            provider: settings.defaults.llm_provider,
            model: settings.defaults.llm_model,
            text: "ok",
          });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": { items: [] },
          "/api/work-sessions": { items: [] },
          "/api/templates": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
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

  it("preserves values for each mode/provider while switching", async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: "환경설정" }));

    // OpenRouter는 활성 외부 공급자 카드이므로 [수정]으로 편집 폼을 연다.
    const profilesPanel = await screen.findByTestId("saved-llm-profiles");
    const openrouterCard = within(profilesPanel).getByText("OpenRouter").closest("article")!;
    await user.click(within(openrouterCard).getByRole("button", { name: "수정" }));

    await user.clear(await screen.findByLabelText("OpenRouter API Key"));
    await user.type(screen.getByLabelText("OpenRouter API Key"), "sk-or-updated");

    await user.selectOptions(screen.getByLabelText("LLM 정책"), "internal_server");
    await user.clear(screen.getByLabelText("LLM Model"));
    await user.type(screen.getByLabelText("LLM Model"), "internal-model-v2");
    await user.clear(screen.getByLabelText("모델 API Base URL"));
    await user.type(screen.getByLabelText("모델 API Base URL"), "http://127.0.0.1:9100/v1");

    await user.selectOptions(screen.getByLabelText("LLM 정책"), "external_model");

    await waitFor(() => {
      expect(screen.getByLabelText("OpenRouter API Key")).toHaveValue("sk-or-updated");
      expect(screen.getByLabelText("LLM Model")).toHaveValue("openai/gpt-5.5");
      expect(screen.getByLabelText("모델 API Base URL")).toHaveValue("https://openrouter.ai/api/v1");
    });

    await user.click(within(profilesPanel).getByRole("button", { name: "설정 저장" }));

    await waitFor(() => {
      expect(screen.getByText("환경설정을 저장했습니다.")).toBeInTheDocument();
    });
  }, 15000);
  it("shows a readable summary of saved model profiles", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "환경설정" }));

    const profilesPanel = await screen.findByTestId("saved-llm-profiles");
    expect(profilesPanel).toBeInTheDocument();
    expect(within(profilesPanel).getByText("로컬 우선")).toBeInTheDocument();
    expect(within(profilesPanel).getByText("내부 서버")).toBeInTheDocument();
    expect(within(profilesPanel).getByText("OpenRouter")).toBeInTheDocument();
    expect(within(profilesPanel).getByText("Claude / Anthropic")).toBeInTheDocument();
  });

  it("switches active profile with one click via [이 프로필 사용]", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "환경설정" }));

    const profilesPanel = await screen.findByTestId("saved-llm-profiles");
    const anthropicCard = within(profilesPanel).getByText("Claude / Anthropic").closest("article")!;
    await user.click(within(anthropicCard).getByRole("button", { name: "이 프로필 사용" }));

    await waitFor(() => {
      expect(screen.getByText("선택한 프로필을 활성화했습니다.")).toBeInTheDocument();
    });
  }, 15000);

  it("saves personalization storage and learning apply mode", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "환경설정" }));
    await user.clear(await screen.findByLabelText("개인화 학습 저장폴더"));
    await user.type(screen.getByLabelText("개인화 학습 저장폴더"), "D:/Gongmu/personalization");
    await user.selectOptions(screen.getByLabelText("학습 후보 반영 방식"), "auto_apply");
    await user.click(screen.getByRole("button", { name: "설정 저장" }));

    await waitFor(() => {
      expect(screen.getByText("환경설정을 저장했습니다.")).toBeInTheDocument();
    });
    expect(screen.getAllByText("낮은 위험 항목 자동 반영").length).toBeGreaterThan(0);
  }, 15000);
});
