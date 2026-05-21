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
                  title: "예산 검토",
                  mime_type: "text/markdown",
                  text_excerpt: "예산편성 회의자료를 정리한다.",
                  extracted_text_path: "C:/cache/source-files/hash.txt",
                  created_at: "2026-04-28T00:00:00+09:00",
                  updated_at: "2026-04-28T00:00:00+09:00",
                },
                score: 92,
                match_reasons: ["파일명", "본문"],
              },
            ],
          });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": { items: [] },
          "/api/reference-sets": { items: [] },
          "/api/templates": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/knowledge/sources": { items: [] },
          "/api/knowledge/source-files": { items: [] },
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
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: /^파일찾기/ }));

    expect(await screen.findByText("내장 파일찾기")).toBeInTheDocument();
    await user.type(screen.getByLabelText("파일 검색"), "budget");
    await user.click(screen.getByRole("button", { name: "검색" }));

    expect((await screen.findAllByText("예산 검토")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/budget-plan\.md/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("예산편성 회의자료를 정리한다.").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "세션에 연결" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "연결됨" })).toBeDisabled());
  });
});
