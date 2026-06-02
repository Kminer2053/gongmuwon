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

describe("document authoring layout", () => {
  const generateBodies: unknown[] = [];
  let generateResponseGate: Promise<void> | null = null;

  function holdGenerateResponse() {
    let releaseGate: () => void = () => undefined;
    generateResponseGate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    return () => {
      releaseGate();
      generateResponseGate = null;
    };
  }

  beforeEach(() => {
    generateBodies.length = 0;
    generateResponseGate = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
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
              anything_launch_mode: "external_app_preferred",
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

        if (url.endsWith("/api/documents/generate") && method === "POST") {
          generateBodies.push(JSON.parse(String(init?.body ?? "{}")));
          if (generateResponseGate) {
            await generateResponseGate;
          }
          return jsonResponse(
            {
              content_base: {
                id: "content-1",
                title: "Decision Brief",
                purpose: "one page report",
                template_key: "report",
                reference_set_id: null,
                source_session_id: null,
                content_markdown: "# Decision Brief",
                content_hash: "abc123",
                source_signature: "sig",
                artifact_path: "documents/content-bases/content-1.md",
                created_at: "2026-06-02T09:30:00+09:00",
              },
              finalize: {
                id: "finalize-1",
                content_base_id: "content-1",
                approval_ticket: { id: "ticket-1", status: "approved" },
                final_document_output: {
                  id: "output-1",
                  content_base_id: "content-1",
                  output_name: "Decision Brief",
                  output_format: "hwpx",
                  artifact_path: "documents/final/decision-brief.hwpx",
                  status: "applied",
                  created_at: "2026-06-02T09:31:00+09:00",
                },
                artifact: {
                  path: "documents/final/decision-brief.hwpx",
                  markdown_path: "documents/final/decision-brief.md",
                  format: "hwpx",
                },
              },
              artifact: {
                path: "documents/final/decision-brief.hwpx",
                markdown_path: "documents/final/decision-brief.md",
                format: "hwpx",
              },
            },
            201,
          );
        }

        if (url.endsWith("/api/documents/attachments") && method === "POST") {
          return jsonResponse(
            {
              items: [
                {
                  id: "attachment-1",
                  file_name: "AI전략회의_결과.pdf",
                  stored_path: "C:/Gongmu/attachments/AI전략회의_결과.pdf",
                  size: 128,
                  created_at: "2026-06-02T09:29:00+09:00",
                },
              ],
            },
            201,
          );
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": { items: [] },
          "/api/work-sessions": { items: [] },
          "/api/reference-sets": { items: [{ id: "ref-1", title: "legacy set", items: [] }] },
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

  it("shows the simplified authoring steps without Reference Set UI and opens generated artifacts as cards", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId("session-rail");
    await user.click(screen.getByTestId("feature-menu-documents"));

    expect(await screen.findByTestId("document-authoring-flow")).toBeInTheDocument();
    expect(screen.getByTestId("document-source-step")).toBeInTheDocument();
    expect(screen.getByTestId("document-file-step")).toBeInTheDocument();
    expect(screen.getByTestId("document-format-step")).toBeInTheDocument();
    expect(screen.getByTestId("document-instruction-step")).toBeInTheDocument();
    expect(screen.queryByText(/Reference Set/i)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("document-file-step")).queryByLabelText("추가 파일 경로")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("document-file-step")).queryByPlaceholderText(
        "파일찾기에서 복사한 경로를 한 줄에 하나씩 붙여넣으세요.",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("document-file-step")).getByText(/작업 시작 시 가능한 범위에서 본문을 즉시 분석/),
    ).toBeInTheDocument();

    const sourceStep = screen.getByTestId("document-source-step");
    const fileStep = screen.getByTestId("document-file-step");
    const formatStep = screen.getByTestId("document-format-step");
    const instructionStep = screen.getByTestId("document-instruction-step");
    expect(sourceStep.compareDocumentPosition(fileStep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fileStep.compareDocumentPosition(formatStep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(formatStep.compareDocumentPosition(instructionStep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(fileStep).queryByLabelText("사용자 HWPX/HWTX 양식")).not.toBeInTheDocument();
    expect(within(formatStep).getByLabelText("사용자 HWPX/HWTX 양식")).toBeInTheDocument();

    await user.type(screen.getByTestId("document-title-input"), "Decision Brief");
    await user.type(screen.getByTestId("document-outline-input"), "Summarize the current issue as a one page report.");
    await user.click(screen.getByTestId("document-generate-submit"));

    await waitFor(() => expect(generateBodies).toHaveLength(1));
    expect(generateBodies[0]).toMatchObject({
      title: "Decision Brief",
      reference_set_id: null,
      document_format: "onePageReport",
    });
    expect(await screen.findByTestId("document-artifact-card")).toHaveTextContent("decision-brief.hwpx");
  });

  it("collects main content and usage purpose for each attached file before generating a report", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId("session-rail");
    await user.click(screen.getByTestId("feature-menu-documents"));

    const file = new File(["meeting result"], "AI전략회의_결과.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("보고서 관련 파일 첨부"), file);

    const fileCard = await screen.findByTestId("document-file-card-AI전략회의_결과.pdf");
    await user.type(within(fileCard).getByLabelText("AI전략회의_결과.pdf 주요내용"), "AI 전환 추진과제와 회의 결정사항");
    await user.type(within(fileCard).getByLabelText("AI전략회의_결과.pdf 활용목적"), "현황 및 조치계획 근거로 반영");
    await user.type(screen.getByTestId("document-title-input"), "AI 전략회의 후속조치 보고");
    await user.type(screen.getByTestId("document-outline-input"), "회의 결과를 1페이지 보고서로 정리");

    await user.click(screen.getByTestId("document-generate-submit"));

    await waitFor(() => expect(generateBodies).toHaveLength(1));
    expect(String((generateBodies[0] as Record<string, unknown>).outline)).toContain("AI전략회의_결과.pdf");
    expect(String((generateBodies[0] as Record<string, unknown>).outline)).toContain(
      "주요내용: AI 전환 추진과제와 회의 결정사항",
    );
    expect(String((generateBodies[0] as Record<string, unknown>).outline)).toContain(
      "활용목적: 현황 및 조치계획 근거로 반영",
    );
    expect((generateBodies[0] as Record<string, unknown>).direct_file_paths).toContain(
      "C:/Gongmu/attachments/AI전략회의_결과.pdf",
    );
  });

  it("shows elapsed time and concrete work stage while a report is being generated", async () => {
    const releaseGenerateResponse = holdGenerateResponse();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId("session-rail");
    await user.click(screen.getByTestId("feature-menu-documents"));
    await user.type(screen.getByTestId("document-title-input"), "AI 활용 사례보고");
    await user.type(screen.getByTestId("document-outline-input"), "AI 활용 사례를 1페이지 보고서로 정리");
    await user.click(screen.getByTestId("document-generate-submit"));

    const status = await screen.findByTestId("document-generate-status");
    expect(status).toHaveTextContent("경과");
    expect(status).toHaveTextContent("단계");
    expect(status).toHaveTextContent(/자료 수집|첨부 파일|대화 맥락|보고서 구조|HWPX 작성/);

    releaseGenerateResponse();
    expect(await screen.findByTestId("document-artifact-card")).toHaveTextContent("decision-brief.hwpx");
    expect(screen.getByTestId("document-generate-status")).toHaveTextContent("산출물 저장 완료");
  });
});
