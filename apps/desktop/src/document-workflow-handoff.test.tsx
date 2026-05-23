import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: vi.fn(async () => ({
    available: true,
    mode: "tauri",
    sidecar_url: "http://127.0.0.1:8765",
    anything_available: false,
    anything_mode: "unavailable",
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
}));

import { App } from "./app";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("session to documents workflow", () => {
  const generateBodies: unknown[] = [];

  beforeEach(() => {
    generateBodies.length = 0;
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

        if (url.endsWith("/api/documents/generate") && method === "POST") {
          generateBodies.push(JSON.parse(String(init?.body ?? "{}")));
          return jsonResponse(
            {
              content_base: {
                id: "content-1",
                title: "주간 보고 작업 문서",
                purpose: "업무대화 세션 기반 정리",
                template_key: "report",
                reference_set_id: null,
                source_session_id: "session-1",
                content_markdown: "# 주간 보고 작업 문서\n\n본문",
                content_hash: "abc123",
                source_signature: "sig",
                artifact_path: "documents/content-bases/content-1.md",
                created_at: "2026-05-06T09:30:00+09:00",
              },
              finalize: {
                id: "finalize-1",
                content_base_id: "content-1",
                approval_ticket: {
                  id: "ticket-1",
                  status: "approved",
                },
                final_document_output: {
                  id: "output-1",
                  content_base_id: "content-1",
                  output_name: "주간 보고 작업 문서",
                  output_format: "hwpx",
                  artifact_path: "documents/final/weekly-report.hwpx",
                  status: "applied",
                  created_at: "2026-05-06T09:31:00+09:00",
                },
                artifact: {
                  path: "documents/final/weekly-report.hwpx",
                  markdown_path: "documents/final/weekly-report.md",
                  format: "hwpx",
                },
              },
              artifact: {
                path: "documents/final/weekly-report.hwpx",
                markdown_path: "documents/final/weekly-report.md",
                format: "hwpx",
              },
            },
            201,
          );
        }

        if (url.endsWith("/api/documents/attachments") && method === "POST") {
          return jsonResponse({ items: [] }, 201);
        }

        if (url.endsWith("/api/work-sessions")) {
          return jsonResponse({
            items: [
              {
                id: "session-1",
                title: "주간 보고 작업",
                schedule_id: "schedule-1",
                status: "open",
                created_at: "2026-05-06T09:00:00+09:00",
                messages: [
                  {
                    id: "message-1",
                    session_id: "session-1",
                    role: "assistant",
                    text: "보고서 목차를 먼저 정리하겠습니다.",
                    message_type: "chat",
                    status: "completed",
                    created_at: "2026-05-06T09:05:00+09:00",
                  },
                ],
              },
            ],
          });
        }

        if (url.endsWith("/api/work-sessions/session-1/messages")) {
          return jsonResponse({
            items: [
              {
                id: "message-1",
                session_id: "session-1",
                role: "assistant",
                text: "보고서 목차를 먼저 정리하겠습니다.",
                message_type: "chat",
                status: "completed",
                created_at: "2026-05-06T09:05:00+09:00",
              },
            ],
          });
        }

        if (url.endsWith("/api/work-sessions/session-1/file-links")) {
          return jsonResponse({
            items: [
              {
                id: "link-1",
                session_id: "session-1",
                file_path: "C:/Docs/weekly-report.md",
                label: "weekly-report.md",
                source: "manual",
                created_at: "2026-05-06T09:10:00+09:00",
              },
            ],
          });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": {
            items: [
              {
                id: "schedule-1",
                title: "주간 보고 회의",
                starts_at: "2026-05-06T10:00:00+09:00",
                ends_at: "2026-05-06T11:00:00+09:00",
                view: "week",
                created_at: "2026-05-06T08:00:00+09:00",
              },
            ],
          },
          "/api/reference-sets": { items: [] },
          "/api/templates": { items: [] },
          "/api/documents/templates/custom": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/knowledge/sources": { items: [] },
          "/api/knowledge/source-files": { items: [] },
          "/api/knowledge/ingestion-jobs": { items: [] },
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

  it("moves the active chat session into the simplified HWPX authoring flow", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId("chat-workspace");
    await user.click(await screen.findByRole("button", { name: "문서작성으로 이어가기" }));

    expect(await screen.findByText("HWPX 보고서 작업 시작")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ContentBase.md 생성" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "최종 저장 요청" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "최종 저장 적용" })).not.toBeInTheDocument();

    const sourceModeGroup = screen.getByTestId("document-source-mode");
    expect(within(sourceModeGroup).getByLabelText("대화세션에서 작성")).toBeChecked();
    expect(screen.getByLabelText("문서 제목")).toHaveValue("주간 보고 작업 문서");
    expect(screen.queryByLabelText("문서 목적")).not.toBeInTheDocument();
    expect(screen.getByLabelText("작업 설명")).toHaveValue("주간 보고 작업 대화 내용을 바탕으로 문서를 작성합니다.");
    expect(screen.getByText("연결 파일 1개")).toBeInTheDocument();

    const formatSelect = screen.getByLabelText("산출보고서");
    expect(formatSelect).toHaveValue("onePageReport");
    expect(within(formatSelect).queryByRole("option", { name: "자동 선택" })).not.toBeInTheDocument();
    expect(within(formatSelect).getByRole("option", { name: "시행문" })).toBeInTheDocument();
    expect(within(formatSelect).getByRole("option", { name: "1페이지 보고서" })).toBeInTheDocument();
    expect(within(formatSelect).getByRole("option", { name: "풀버전 보고서" })).toBeInTheDocument();
    expect(within(formatSelect).getByRole("option", { name: "이메일" })).toBeInTheDocument();

    expect(screen.queryByLabelText("수신/대상")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("예상 분량")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("긴급도")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("기한")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("추적성 필요")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("공식 서식 필요")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("요청 조치")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("보안 수준")).not.toBeInTheDocument();

    expect(screen.getByText("세션 연결 파일")).toBeInTheDocument();
    expect(screen.getByText("weekly-report.md")).toBeInTheDocument();
    expect(screen.getByLabelText("weekly-report.md 활용방안")).toBeInTheDocument();
    await user.type(screen.getByLabelText("weekly-report.md 활용방안"), "주간 보고 근거로 사용");
    expect(screen.getByLabelText("추가 파일 경로")).toBeInTheDocument();
    expect(screen.getByLabelText("보고서 관련 파일 첨부")).toBeInTheDocument();
    expect(screen.getByLabelText("사용자 HWPX/HWTX 양식")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "작업 시작" }));

    await waitFor(() => expect(generateBodies).toHaveLength(1));
    expect(generateBodies[0]).toMatchObject({
      title: "주간 보고 작업 문서",
      purpose: "업무대화 세션 기반 1페이지 보고서 작성",
      source_session_id: "session-1",
      document_format: "onePageReport",
    });
    expect(generateBodies[0]).toMatchObject({
      outline: expect.stringContaining("weekly-report.md: 주간 보고 근거로 사용"),
    });
    expect(await screen.findByTestId("document-generate-result")).toHaveTextContent("documents/final/weekly-report.hwpx");
  });
});
