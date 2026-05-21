import { describe, expect, it } from "vitest";
import { parseWorkspaceSettings } from "./api";

describe("parseWorkspaceSettings profiles", () => {
  it("parses nested mode and provider profiles", () => {
    const parsed = parseWorkspaceSettings({
      defaults: {
        llm_mode: "external_model",
        llm_provider: "openrouter",
        llm_model: "openai/gpt-5.5",
        llm_api_key: "sk-or-test",
        llm_site_url: "https://gongmu.example",
        llm_application_name: "Gongmu Workspace",
        internal_api_base_url: "https://openrouter.ai/api/v1",
        anything_launch_mode: "external_app_preferred",
        default_template_key: "meeting",
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
                api_key: "sk-or-test",
                base_url: "https://openrouter.ai/api/v1",
                site_url: "https://gongmu.example",
                application_name: "Gongmu Workspace",
              },
            },
          },
        },
      },
      paths: {
        workspace_root: "/tmp/gongmu-workspace",
      },
    });

    expect(parsed.defaults.profiles.internal_server.base_url).toBe("http://127.0.0.1:9000/v1");
    expect(parsed.defaults.profiles.external_model.active_provider).toBe("openrouter");
    expect(parsed.defaults.profiles.external_model.providers.openrouter.api_key).toBe("sk-or-test");
  });

  it("reconstructs external provider profiles from legacy settings payloads", () => {
    const parsed = parseWorkspaceSettings({
      defaults: {
        llm_mode: "external_model",
        llm_provider: "openrouter",
        llm_model: "google/gemma-4-31b-it",
        llm_api_key: "sk-or-legacy",
        internal_api_base_url: "https://openrouter.ai/api/v1",
        anything_launch_mode: "external_app_preferred",
        default_template_key: "report",
      },
      paths: {
        workspace_root: "/tmp/gongmu-workspace",
      },
    });

    expect(parsed.defaults.profiles.external_model.active_provider).toBe("openrouter");
    expect(parsed.defaults.profiles.external_model.providers.openrouter.provider).toBe("openrouter");
    expect(parsed.defaults.profiles.external_model.providers.openrouter.model).toBe("google/gemma-4-31b-it");
    expect(parsed.defaults.profiles.external_model.providers.openrouter.api_key).toBe("sk-or-legacy");
    expect(parsed.defaults.profiles.external_model.providers.openrouter.base_url).toBe(
      "https://openrouter.ai/api/v1",
    );
  });
});
