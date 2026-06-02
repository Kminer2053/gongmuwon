import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: vi.fn(async () => ({
    available: true,
    mode: "tauri",
    sidecar_url: "http://127.0.0.1:8765",
    anything_available: false,
    anything_mode: "install_page_fallback",
    anything_path: null,
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
  pickDirectory: vi.fn(async () => null),
  launchAnythingQuery: vi.fn(async () => undefined),
  openExternalTarget: vi.fn(async () => undefined),
  copyTextToClipboard: vi.fn(async () => undefined),
  setDesktopZoom: vi.fn(async () => undefined),
}));

import { App } from "./app";
import { copyTextToClipboard } from "./runtime";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("local file search", () => {
  beforeEach(() => {
    let fileLinks: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

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

        if (url.endsWith("/api/work-sessions")) {
          return jsonResponse({
            items: [
              {
                id: "session-1",
                title: "Budget Review Session",
                schedule_id: null,
                status: "open",
                created_at: "2026-04-28T00:00:00+09:00",
                messages: [],
              },
            ],
          });
        }

        if (url.endsWith("/api/work-sessions/session-1/file-links") && method === "POST") {
          fileLinks = [
            {
              id: "link-1",
              session_id: "session-1",
              file_path: "C:/Docs/budget-plan.md",
              label: "budget-plan.md",
              source: "knowledge",
              created_at: "2026-04-28T00:00:00+09:00",
            },
          ];
          return jsonResponse({ items: fileLinks }, 201);
        }

        if (url.endsWith("/api/work-sessions/session-1/file-links")) {
          return jsonResponse({ items: fileLinks });
        }

        if (url.includes("/api/files/search?")) {
          return jsonResponse({
            query: "budget",
            knowledge_index_count: 1,
            local_index_count: 42,
            items: [
              {
                file: {
                  id: "file-1",
                  source_id: "source-1",
                  file_path: "C:/Docs/budget-plan.md",
                  relative_path: "budget-plan.md",
                  file_hash: "hash",
                  size_bytes: 120,
                  modified_at: "2026-04-28T00:00:00+09:00",
                  status: "indexed",
                  title: "Budget Plan",
                  mime_type: "text/markdown",
                  text_excerpt: "Budget planning notes for the review session.",
                  extracted_text_path: "C:/cache/source-files/hash.txt",
                  created_at: "2026-04-28T00:00:00+09:00",
                  updated_at: "2026-04-28T00:00:00+09:00",
                },
                score: 92,
                match_reasons: ["filename", "body"],
              },
            ],
          });
        }

        if (url.endsWith("/api/files/index/rebuild")) {
          return jsonResponse({
            status: "completed",
            indexed_count: 42,
            searched_roots: ["C:/Docs"],
            partial: false,
            indexed_at: "2026-04-28T00:00:00+09:00",
          });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": { items: [] },
          "/api/reference-sets": { items: [] },
          "/api/templates": { items: [] },
          "/api/documents/templates/custom": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/knowledge/sources": { items: [] },
          "/api/knowledge/source-files": { items: [] },
          "/api/knowledge/ingestion-jobs": { items: [] },
          "/api/knowledge/documents": { items: [] },
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

        return jsonResponse({ detail: `Unhandled request: ${url}` }, 404);
      }),
    );
  });

  it("searches local indexed files and attaches a result to the active work session", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId("chat-workspace");
    await user.click(screen.getByTestId("feature-menu-search"));

    expect(await screen.findByTestId("local-file-explorer")).toBeInTheDocument();
    await user.type(screen.getByTestId("local-file-search-input"), "budget");
    await user.click(screen.getByTestId("local-file-search-submit"));

    expect(await screen.findByTestId("local-file-result-file-1")).toHaveTextContent("Budget Plan");
    expect(screen.getAllByText(/budget-plan\.md/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Budget planning notes for the review session.").length).toBeGreaterThan(0);

    await user.click(screen.getByTestId("local-file-link-file-1"));

    await waitFor(() => expect(screen.getByTestId("local-file-link-file-1")).toBeDisabled());
  });

  it("keeps preview details in the right panel and shows copy/index feedback", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId("chat-workspace");
    await user.click(screen.getByTestId("feature-menu-search"));

    const explorer = await screen.findByTestId("local-file-explorer");
    expect(within(explorer).queryByTestId("local-file-central-preview")).not.toBeInTheDocument();
    expect(within(explorer).getByTestId("local-file-scope-panel")).toBeInTheDocument();
    expect(within(explorer).getByTestId("local-file-search-panel")).toBeInTheDocument();

    await user.click(within(explorer).getByTestId("local-file-index-rebuild"));
    expect(await within(explorer).findByText("인덱스 42개")).toBeInTheDocument();
    expect(screen.queryByTestId("local-file-central-preview")).not.toBeInTheDocument();

    await user.type(screen.getByTestId("local-file-search-input"), "budget");
    await user.click(screen.getByTestId("local-file-search-submit"));

    const resultCard = await screen.findByTestId("local-file-result-file-1");
    await user.click(resultCard);
    expect(await screen.findByTestId("right-file-preview")).toHaveTextContent("budget-plan.md");

    await user.click(within(resultCard).getByTestId("local-file-copy-file-1"));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledWith("C:/Docs/budget-plan.md"));
    expect(await screen.findByText("파일 경로를 복사했습니다.")).toBeInTheDocument();
  });

  it("keeps built-in file search free of Anything and Reference Set handoff UI", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId("chat-workspace");
    await user.click(screen.getByTestId("feature-menu-search"));

    expect(await screen.findByTestId("local-file-explorer")).toBeInTheDocument();
    expect(screen.queryByText(/Anything/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reference Set/i)).not.toBeInTheDocument();
  });
});
