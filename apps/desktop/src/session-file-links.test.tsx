import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// D-06: 앱 시작 화면이 홈(오늘의 브리핑)으로 바뀌어, 채팅 검증은 먼저 업무대화 메뉴로 이동한다.
async function openChatFromHome() {
  const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
  fireEvent.click(within(navigation).getByRole("button", { name: "업무대화" }));
}

describe("work session file links", () => {
  let fileLinks: Array<Record<string, unknown>>;

  beforeEach(() => {
    fileLinks = [
      {
        id: "link-1",
        session_id: "session-1",
        file_path: "C:/Docs/budget.xlsx",
        label: "budget.xlsx",
        source: "anything",
        created_at: "2026-04-28T00:00:00+09:00",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();

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

        const deleteLinkMatch = url.match(/\/api\/work-sessions\/session-1\/file-links\/([^/?]+)$/);
        if (deleteLinkMatch && method === "DELETE") {
          const linkId = deleteLinkMatch[1];
          fileLinks = fileLinks.filter((link) => link.id !== linkId);
          return jsonResponse({ id: linkId, deleted: true });
        }

        if (url.endsWith("/api/work-sessions/session-1/file-links")) {
          if (method === "POST") {
            const payload = typeof init?.body === "string" ? JSON.parse(init.body) : { items: [] };
            const createdItems = (payload.items ?? []).map(
              (item: { file_path: string; label?: string | null; source?: string }, index: number) => {
                const created = {
                  id: `link-${fileLinks.length + index + 1}`,
                  session_id: "session-1",
                  file_path: item.file_path,
                  label: item.label ?? null,
                  source: item.source ?? "manual",
                  created_at: "2026-04-28T01:00:00+09:00",
                };
                fileLinks = [...fileLinks, created];
                return created;
              },
            );
            return jsonResponse({ items: createdItems }, 201);
          }
          return jsonResponse({ items: fileLinks });
        }

        if (url.includes("/api/files/search")) {
          const query = decodeURIComponent((url.split("query=")[1] ?? "").split("&")[0]);
          // W6: 파서가 깨진 제목을 남긴 파일 — 행 제목은 displayTitleForFile로 파일명 보정된다.
          if (query.includes("발표")) {
            return jsonResponse({
              query,
              knowledge_index_count: 1,
              local_index_count: 1,
              partial: false,
              items: [
                {
                  file: {
                    id: "file-hit-2",
                    source_id: "source-1",
                    file_path: "C:/Docs/발표자료-2026.pptx",
                    relative_path: "발표자료-2026.pptx",
                    file_hash: "hash-2",
                    size_bytes: 4096,
                    modified_at: "2026-04-01T00:00:00+09:00",
                    status: "indexed",
                    title: "Click to edit Master title style",
                    mime_type: null,
                    text_excerpt: null,
                    extracted_text_path: null,
                    created_at: "2026-04-01T00:00:00+09:00",
                    updated_at: "2026-04-01T00:00:00+09:00",
                  },
                  score: 0.81,
                  match_reasons: ["file_name"],
                },
              ],
            });
          }
          return jsonResponse({
            query: "예산",
            knowledge_index_count: 1,
            local_index_count: 1,
            partial: false,
            items: [
              {
                file: {
                  id: "file-hit-1",
                  source_id: "source-1",
                  file_path: "C:/Docs/plan-2026.hwp",
                  relative_path: "plan-2026.hwp",
                  file_hash: "hash-1",
                  size_bytes: 2048,
                  modified_at: "2026-04-01T00:00:00+09:00",
                  status: "indexed",
                  title: "2026 예산 계획",
                  mime_type: null,
                  text_excerpt: "2026년 예산 편성 방향과 주요 사업 계획",
                  extracted_text_path: null,
                  created_at: "2026-04-01T00:00:00+09:00",
                  updated_at: "2026-04-01T00:00:00+09:00",
                },
                score: 0.92,
                match_reasons: ["title"],
              },
            ],
          });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": { items: [] },
          "/api/templates": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/knowledge/sources": { items: [] },
          "/api/knowledge/source-files": { items: [] },
          "/api/personalization/candidates": { items: [] },
          "/api/approval-tickets": { items: [] },
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

  it("merges file linking into a single toolbar button with a count badge (W5-3)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    await screen.findByTestId("chat-workspace");
    expect(screen.queryByTestId("session-file-links")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("세션 연결 파일 경로")).not.toBeInTheDocument();

    // 통합 버튼: [파일 연결] 하나만 남고, 배지로 연결 파일 수를 보여준다.
    const unifiedButton = await screen.findByRole("button", { name: "파일 연결" });
    await waitFor(() => expect(screen.getByTestId("chat-file-links-badge")).toHaveTextContent("1"));
    expect(screen.queryByRole("button", { name: "연결 파일 1개" })).not.toBeInTheDocument();
    expect(screen.queryByText("C:/Docs/budget.xlsx")).not.toBeInTheDocument();

    // 클릭하면 모달 상단의 "연결된 파일" 섹션에서 목록을 바로 볼 수 있다.
    await user.click(unifiedButton);
    const modal = await screen.findByTestId("chat-file-link-modal");
    expect(within(modal).getByTestId("chat-file-link-count")).toHaveTextContent("연결된 파일 1개");
    expect(within(modal).getByText("C:/Docs/budget.xlsx")).toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "budget.xlsx 열기" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("chat-file-link-modal")).not.toBeInTheDocument());
  });

  it("unlinks a session file from the modal linked list (W5-3)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    await screen.findByTestId("chat-workspace");
    await waitFor(() => expect(screen.getByTestId("chat-file-links-badge")).toHaveTextContent("1"));

    await user.click(screen.getByRole("button", { name: "파일 연결" }));
    const modal = await screen.findByTestId("chat-file-link-modal");

    // [연결 해제] → DELETE 후 목록·카운트·툴바 배지가 함께 줄어든다.
    await user.click(within(modal).getByRole("button", { name: "budget.xlsx 연결 해제" }));
    await waitFor(() =>
      expect(within(modal).getByTestId("chat-file-link-count")).toHaveTextContent("연결된 파일 0개"),
    );
    expect(within(modal).queryByText("C:/Docs/budget.xlsx")).not.toBeInTheDocument();
    expect(within(modal).getByText("아직 연결된 파일이 없습니다. 아래에서 검색해 연결하세요.")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-file-links-badge")).not.toBeInTheDocument();
  });

  it("links a searched file through the file link modal (D-04)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    await screen.findByTestId("chat-workspace");

    // 툴바 [파일 연결] → 모달이 열리고 검색 입력에 포커스가 간다.
    await user.click(screen.getByRole("button", { name: "파일 연결" }));
    const modal = await screen.findByTestId("chat-file-link-modal");
    await waitFor(() =>
      expect(within(modal).getByTestId("chat-file-link-count")).toHaveTextContent("연결된 파일 1개"),
    );

    const searchInput = within(modal).getByTestId("chat-file-link-search-input");
    expect(searchInput).toHaveFocus();

    // 검색 (Enter 실행) → 결과 목록: 제목·경로·발췌.
    await user.type(searchInput, "예산{Enter}");
    expect(await within(modal).findByText("2026 예산 계획")).toBeInTheDocument();
    expect(within(modal).getByText("C:/Docs/plan-2026.hwp")).toBeInTheDocument();
    expect(within(modal).getByText("2026년 예산 편성 방향과 주요 사업 계획")).toBeInTheDocument();

    // [연결] → 행에 "연결됨" 표시 + 연결 파일 수 갱신.
    await user.click(within(modal).getByRole("button", { name: "연결" }));
    expect(await within(modal).findByTestId("chat-file-link-linked")).toHaveTextContent("연결됨");
    await waitFor(() =>
      expect(within(modal).getByTestId("chat-file-link-count")).toHaveTextContent("연결된 파일 2개"),
    );

    // 통합 버튼 배지도 함께 올라간다.
    expect(screen.getByTestId("chat-file-links-badge")).toHaveTextContent("2");

    // Escape로 모달 닫기.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("chat-file-link-modal")).not.toBeInTheDocument());
    expect(screen.getByTestId("chat-workspace")).toBeInTheDocument();
  });

  it("replaces garbage parsed titles with the file name in modal rows (W6)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChatFromHome();

    await screen.findByTestId("chat-workspace");
    await user.click(screen.getByRole("button", { name: "파일 연결" }));
    const modal = await screen.findByTestId("chat-file-link-modal");

    const searchInput = within(modal).getByTestId("chat-file-link-search-input");
    await user.type(searchInput, "발표{Enter}");

    // PPT 마스터 보일러플레이트 제목 대신 확장자를 뗀 파일명이 행 제목으로 나온다.
    expect(await within(modal).findByText("발표자료-2026")).toBeInTheDocument();
    expect(within(modal).queryByText("Click to edit Master title style")).not.toBeInTheDocument();
    expect(within(modal).getByText("C:/Docs/발표자료-2026.pptx")).toBeInTheDocument();
  });
});
