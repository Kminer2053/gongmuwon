import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnythingLaunchItem } from "./api";

const runtimeState = {
  status: {
    available: true,
    mode: "tauri" as const,
    sidecar_url: "http://127.0.0.1:8765",
    running: true,
    managed: true,
    auto_restart_recommended: false,
    log_path: "/tmp/gongmu-workspace/logs/sidecar-runtime.log",
    detail: "desktop runtime ready",
  },
};

const loadDesktopRuntimeStatusMock = vi.fn(async () => runtimeState.status);
const startDesktopSidecarMock = vi.fn(async () => runtimeState.status);
const stopDesktopSidecarMock = vi.fn(async () => runtimeState.status);
const restartDesktopSidecarMock = vi.fn(async () => runtimeState.status);
const openExternalTargetMock = vi.fn(async (_target: string) => undefined);

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: () => loadDesktopRuntimeStatusMock(),
  startDesktopSidecar: () => startDesktopSidecarMock(),
  stopDesktopSidecar: () => stopDesktopSidecarMock(),
  restartDesktopSidecar: () => restartDesktopSidecarMock(),
  openExternalTarget: (target: string) => openExternalTargetMock(target),
}));

import { App } from "./app";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

beforeEach(() => {
  openExternalTargetMock.mockClear();
  let anythingLaunches: AnythingLaunchItem[] = [
    {
      id: "launch-1",
      approval_ticket_id: "approval-1",
      query: "예산 검토",
      launch_target: "es:%EC%98%88%EC%82%B0%20%EA%B2%80%ED%86%A0",
      status: "pending",
      created_at: "2026-04-20T00:00:00+09:00",
      applied_at: null,
    },
  ];
  let referenceSets: Array<{
    id: string;
    title: string;
    session_id?: string | null;
    created_at: string;
    items: Array<{ id: string; kind: string; label: string; value: string }>;
  }> = [];
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
            anything_launch_mode: "external_link_only",
            default_template_key: "report",
            internal_api_base_url: null,
          },
          paths: {
            workspace_root: "/tmp/gongmu-workspace",
            database: "/tmp/gongmu-workspace/db/gongmu.db",
            knowledge_root: "/tmp/gongmu-workspace/knowledge",
            documents_root: "/tmp/gongmu-workspace/documents",
          },
        });
      }

      if (url.endsWith("/api/schedules")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/work-sessions")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/reference-sets")) {
        if (method === "POST") {
          const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
          const created = {
            id: "ref-import-1",
            title: body.title,
            session_id: body.session_id ?? null,
            created_at: "2026-04-20T00:10:00+09:00",
            items: (body.items ?? []).map((item: { kind: string; label: string; value: string }, index: number) => ({
              id: `item-${index + 1}`,
              kind: item.kind,
              label: item.label,
              value: item.value,
            })),
          };
          referenceSets = [created];
          return jsonResponse(created, 201);
        }
        return jsonResponse({ items: referenceSets });
      }

      if (url.endsWith("/api/templates")) {
        return jsonResponse({
          items: [{ key: "report", label: "보고서형" }],
        });
      }

      if (url.endsWith("/api/knowledge/candidates")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/knowledge/pages")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/file-organizer/proposals")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/execution-logs")) {
        return jsonResponse({ items: [] });
      }

      if (url.endsWith("/api/approval-tickets")) {
        return jsonResponse({
          items: [
            {
              id: "approval-1",
              action: "anything.launch",
              status: "approved",
              target_type: "external_launch",
              target_id: "launch-1",
              requested_at: "2026-04-20T00:00:00+09:00",
              decided_at: "2026-04-20T00:05:00+09:00",
              decision_note: "approved",
            },
          ],
        });
      }

      if (url.endsWith("/api/integrations/anything/launches")) {
        return jsonResponse({
          items: anythingLaunches,
        });
      }

      if (url.endsWith("/api/integrations/anything/launch/approval-1/apply") && method === "POST") {
        anythingLaunches = [
          {
            ...anythingLaunches[0],
            status: "applied",
            applied_at: "2026-04-20T00:05:30+09:00",
          },
        ];
        return jsonResponse(
          {
            approval_ticket: {
              id: "approval-1",
              action: "anything.launch",
              status: "approved",
              target_type: "external_launch",
              target_id: "launch-1",
              requested_at: "2026-04-20T00:00:00+09:00",
              decided_at: "2026-04-20T00:05:00+09:00",
              decision_note: "approved",
            },
            launch_request: {
              id: "launch-1",
              approval_ticket_id: "approval-1",
              query: "예산 검토",
              launch_target: "es:%EC%98%88%EC%82%B0%20%EA%B2%80%ED%86%A0",
              status: "applied",
              created_at: "2026-04-20T00:00:00+09:00",
              applied_at: "2026-04-20T00:05:30+09:00",
            },
          },
          201,
        );
      }

      if (url.endsWith("/api/integrations/anything/launch/approval-1/reference-set") && method === "POST") {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        const created = {
          id: "ref-import-1",
          title: body.title,
          session_id: body.session_id ?? null,
          created_at: "2026-04-20T00:10:00+09:00",
          items: (body.paths ?? []).map((value: string, index: number) => ({
            id: `item-${index + 1}`,
            kind: "file",
            label: value.split(/[\\\\/]/).pop() ?? value,
            value,
          })),
        };
        referenceSets = [created];
        return jsonResponse(
          {
            launch_request: anythingLaunches[0],
            reference_set: created,
          },
          201,
        );
      }

      return jsonResponse({ items: [] });
    }),
  );
});

describe("Anything launch", () => {
  it("opens an approved Anything launch and allows reopening it", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });

    await user.click(within(navigation).getByText("로컬파일/정보검색"));
    await screen.findByRole("button", { name: "승인 후 열기" });

    await user.click(screen.getByRole("button", { name: "승인 후 열기" }));

    expect(openExternalTargetMock).toHaveBeenCalledWith(
      "es:%EC%98%88%EC%82%B0%20%EA%B2%80%ED%86%A0",
    );
    expect(await screen.findByRole("button", { name: "다시 열기" })).toBeInTheDocument();
  });

  it("imports pasted Anything result paths into a Reference Set", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });
    const fetchMock = vi.mocked(global.fetch);

    await user.click(within(navigation).getByText("로컬파일/정보검색"));
    await user.click(await screen.findByRole("button", { name: "승인 후 열기" }));

    const titleInput = await screen.findByLabelText("Import title");
    await user.clear(titleInput);
    await user.type(titleInput, "budget import");
    await user.type(
      screen.getByLabelText("Paste selected paths"),
      "C:\\docs\\budget.xlsx{enter}C:\\docs\\meeting-notes.md",
    );
    await user.click(screen.getByRole("button", { name: "Import to Reference Set" }));

    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/api/integrations/anything/launch/approval-1/reference-set"),
      ),
    ).toBe(true);
    expect(await screen.findByText("budget import")).toBeInTheDocument();
  });

  it("moves imported Anything references into the document drafting flow", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });

    await user.click(within(navigation).getByText("로컬파일/정보검색"));
    await user.click(await screen.findByRole("button", { name: "승인 후 열기" }));

    await user.type(await screen.findByLabelText("Import title"), "budget import");
    await user.type(
      screen.getByLabelText("Paste selected paths"),
      "C:\\docs\\budget.xlsx{enter}C:\\docs\\meeting-notes.md",
    );
    await user.click(screen.getByRole("button", { name: "Import to Reference Set" }));

    await user.click(await screen.findByRole("button", { name: "Continue to Documents" }));

    expect(await screen.findByRole("heading", { name: "문서 초안 생성" })).toBeInTheDocument();
    expect(screen.getByLabelText("문서 제목")).toHaveValue("budget import");
    expect(screen.getByLabelText("문서 목적")).toHaveValue("budget import 기반 정리");
    expect(screen.getByText("선택된 참고자료 묶음")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
    expect(screen.getByText("budget.xlsx")).toBeInTheDocument();
    expect(screen.getByText("meeting-notes.md")).toBeInTheDocument();
    expect(screen.getByText("C:\\docs\\budget.xlsx")).toBeInTheDocument();
  });
});
