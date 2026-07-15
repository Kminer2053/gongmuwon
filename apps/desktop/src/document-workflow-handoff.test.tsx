import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// D-02: 미리보기/최종 탭 진입 시 rhwp WASM 선로딩이 실제 모듈을 당기지 않도록 모킹
vi.mock("@rhwp/core", () => ({
  default: vi.fn(async () => ({})),
  HwpDocument: class {
    pageCount() {
      return 1;
    }
    renderPageSvg() {
      return "<svg xmlns='http://www.w3.org/2000/svg'></svg>";
    }
    free() {}
  },
}));
vi.mock("@rhwp/core/rhwp_bg.wasm?url", () => ({ default: "/rhwp_bg.wasm" }));

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

// D-06 이후 앱은 홈(오늘의 브리핑)에서 시작한다 — 업무대화 메뉴로 이동해 시작한다.
async function openChatScreen(user: ReturnType<typeof userEvent.setup>) {
  const rail = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
  await user.click(within(rail).getByRole("button", { name: "업무대화" }));
  await screen.findByTestId("chat-workspace");
}

const sseResponse = (blocks: string[]) =>
  Promise.resolve(
    new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          blocks.forEach((block) => controller.enqueue(encoder.encode(block)));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ),
  );

describe("session to documents authoring workflow", () => {
  const structureBodies: Array<Record<string, unknown>> = [];
  const buildBodies: Array<Record<string, unknown>> = [];
  const finalizeBodies: Array<Record<string, unknown>> = [];
  let applyCalled = false;

  beforeEach(() => {
    structureBodies.length = 0;
    buildBodies.length = 0;
    finalizeBodies.length = 0;
    applyCalled = false;

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

        if (url.endsWith("/api/documents/authoring/formats")) {
          return jsonResponse({
            items: [
              {
                key: "officialMemo",
                aliases: ["gongmun"],
                label: "시행문",
                description: "수신처에 발송하는 공문",
                icon: "stamp",
                schema_fields: ["title", "receiver", "opening", "items[]"],
              },
              {
                key: "onePageReport",
                aliases: ["1p"],
                label: "1페이지 보고서",
                description: "두괄식 요약 + 섹션 2~5개",
                icon: "file-text",
                schema_fields: ["title", "summary", "sections[2..5]"],
              },
              {
                key: "fullReport",
                aliases: ["full"],
                label: "풀버전 보고서",
                description: "장·절·항목 위계의 상세 보고서",
                icon: "book-open",
                schema_fields: ["title", "summary[]", "chapters[3..6]"],
              },
              {
                key: "email",
                aliases: ["이메일"],
                label: "이메일",
                description: "업무 이메일 본문",
                icon: "mail",
                schema_fields: ["subject", "body_paragraphs[]"],
              },
            ],
          });
        }

        if (url.endsWith("/api/documents/authoring/structure") && method === "POST") {
          structureBodies.push(JSON.parse(String(init?.body ?? "{}")));
          return sseResponse([
            'event: stage\ndata: {"stage":"organize","status":"start"}\n\n',
            'event: stage\ndata: {"stage":"organize","status":"done","elapsed_ms":12300}\n\n',
            'event: stage\ndata: {"stage":"format","status":"start"}\n\n',
            'event: stage\ndata: {"stage":"format","status":"done","elapsed_ms":800,"attempts":2,"repaired":true}\n\n',
            'event: done\ndata: ' +
              JSON.stringify({
                done: true,
                format: "onePageReport",
                structure: {
                  title: "주간 보고 작업 문서",
                  subtitle: "",
                  summary: "민원 처리 지연을 해소하기 위한 주간 조치 요약",
                  sections: [
                    { heading: "추진 배경", items: ["민원 처리 지연 누적"] },
                    { heading: "조치 계획", items: ["처리 절차 간소화", "담당자 재배치"] },
                  ],
                },
                preview: "□ 추진 배경\n ◦ 민원 처리 지연 누적",
                organized_markdown: "# 주간 보고\n\n## 추진 배경\n- 민원 처리 지연 누적",
                meta: { attempts: 2, repaired: true, hints: [] },
              }) +
              "\n\n",
          ]);
        }

        if (url.endsWith("/api/documents/authoring/build") && method === "POST") {
          buildBodies.push(JSON.parse(String(init?.body ?? "{}")));
          return jsonResponse(
            {
              format: "onePageReport",
              content_base: {
                id: "content-1",
                title: "주간 보고 작업 문서",
                document_format: "onePageReport",
                artifact_path: "documents/content-bases/content-1.md",
                preview_path: "documents/content-bases/content-1.html",
              },
              content_markdown: "# 주간 보고 작업 문서",
              preview: "□ 추진 배경\n ◦ 민원 처리 지연 누적",
              finalize: {
                method: "POST",
                endpoint: "/api/documents/finalize",
                body: { content_base_id: "content-1", output_name: "주간 보고 작업 문서" },
                note: "승인 티켓 결재 후 /api/documents/finalize/{ticket_id}/apply 호출 시 HWPX 생성",
              },
            },
            201,
          );
        }

        if (url.endsWith("/api/documents/finalize") && method === "POST") {
          finalizeBodies.push(JSON.parse(String(init?.body ?? "{}")));
          return jsonResponse(
            {
              approval_ticket: {
                id: "ticket-1",
                action: "documents.finalize",
                status: "approved",
                target_type: "content_base",
                target_id: "content-1",
                requested_at: "2026-05-06T09:30:00+09:00",
                decided_at: "2026-05-06T09:30:10+09:00",
                decision_note: null,
              },
              final_document_output: {
                id: "output-1",
                content_base_id: "content-1",
                approval_ticket_id: "ticket-1",
                output_name: "주간 보고 작업 문서",
                artifact_path: null,
                status: "pending",
                created_at: "2026-05-06T09:30:00+09:00",
              },
            },
            201,
          );
        }

        if (url.endsWith("/api/documents/finalize/ticket-1/apply") && method === "POST") {
          applyCalled = true;
          return jsonResponse({
            approval_ticket: {
              id: "ticket-1",
              action: "documents.finalize",
              status: "approved",
              target_type: "content_base",
              target_id: "content-1",
              requested_at: "2026-05-06T09:30:00+09:00",
            },
            final_document_output: {
              id: "output-1",
              content_base_id: "content-1",
              approval_ticket_id: "ticket-1",
              output_name: "주간 보고 작업 문서",
              artifact_path: "documents/final/weekly-report.hwpx",
              status: "applied",
              created_at: "2026-05-06T09:30:00+09:00",
              applied_at: "2026-05-06T09:31:00+09:00",
            },
            artifact: {
              path: "documents/final/weekly-report.hwpx",
              markdown_path: "documents/final/weekly-report.md",
              format: "hwpx",
            },
          });
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

  it("moves the active chat session into the structured authoring flow", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openChatScreen(user);
    await user.click(await screen.findByRole("button", { name: "문서작성으로 이어가기" }));

    expect(await screen.findByTestId("document-authoring-workspace")).toBeInTheDocument();

    const sourceModeGroup = screen.getByTestId("document-source-mode");
    expect(within(sourceModeGroup).getByRole("button", { name: "업무대화 세션 기반" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(sourceModeGroup).getByRole("button", { name: "직접 작성" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(sourceModeGroup).queryByRole("radio")).not.toBeInTheDocument();

    const formatGroup = screen.getByRole("group", { name: "출력 유형 선택" });
    expect(within(formatGroup).getByRole("button", { name: "시행문 선택" })).toBeInTheDocument();
    expect(within(formatGroup).getByRole("button", { name: "1페이지 보고서 선택" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(formatGroup).getByRole("button", { name: "풀버전 보고서 선택" })).toBeInTheDocument();
    expect(within(formatGroup).getByRole("button", { name: "이메일 선택" })).toBeInTheDocument();
    // W5-2: 5번째 출력 유형 — 임의형식(사용자 양식)
    expect(within(formatGroup).getByRole("button", { name: "임의형식 선택" })).toBeInTheDocument();

    const referencesTab = await screen.findByTestId("authoring-references");
    expect(referencesTab).toHaveTextContent("주간 보고 작업");
    expect(referencesTab).toHaveTextContent("세션 대화 1개를 서버가 자동으로 불러와 정리합니다.");
    await waitFor(() => expect(referencesTab).toHaveTextContent("weekly-report.md"));
    expect(screen.getAllByText("세션 연결 파일 1개").length).toBeGreaterThan(0);
  });

  it("shows the return chip and goes back to the originating chat session (W5-2)", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openChatScreen(user);
    await user.click(await screen.findByRole("button", { name: "문서작성으로 이어가기" }));
    await screen.findByTestId("document-authoring-workspace");

    // 출발한 대화 제목이 담긴 복귀 칩
    const chip = screen.getByTestId("documents-chat-return-chip");
    expect(chip).toHaveTextContent("주간 보고 작업");
    expect(chip).toHaveTextContent("대화에서 이동함");

    // [대화로 돌아가기] → 업무대화 화면 + 원래 세션 복귀
    await user.click(screen.getByTestId("documents-chat-return-button"));
    expect(await screen.findByTestId("chat-workspace")).toBeInTheDocument();

    // 복귀 후에는 컨텍스트가 소거되어 문서작성에 칩이 다시 뜨지 않는다
    const rail = screen.getByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(rail).getByRole("button", { name: "문서작성" }));
    await screen.findByTestId("document-authoring-workspace");
    expect(screen.queryByTestId("documents-chat-return-chip")).not.toBeInTheDocument();
  }, 15000);

  it("toggles the authoring source mode with the segmented control", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openChatScreen(user);
    await user.click(await screen.findByRole("button", { name: "문서작성으로 이어가기" }));
    await screen.findByTestId("document-authoring-workspace");

    const sourceModeGroup = screen.getByTestId("document-source-mode");
    const sessionButton = within(sourceModeGroup).getByRole("button", { name: "업무대화 세션 기반" });
    const directButton = within(sourceModeGroup).getByRole("button", { name: "직접 작성" });
    expect(sessionButton).toHaveAttribute("aria-pressed", "true");

    await user.click(directButton);
    expect(directButton).toHaveAttribute("aria-pressed", "true");
    expect(sessionButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("지시/개요")).toBeInTheDocument();

    await user.click(sessionButton);
    expect(sessionButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("연결할 업무대화 세션")).toBeInTheDocument();
  });

  it("streams the structure stages and shows the hierarchical editor", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openChatScreen(user);
    await user.click(await screen.findByRole("button", { name: "문서작성으로 이어가기" }));
    await screen.findByTestId("document-authoring-workspace");

    await user.click(screen.getByRole("button", { name: "구조 생성 → 검토" }));

    expect(await screen.findByTestId("authoring-content")).toBeInTheDocument();
    const stageStream = await screen.findByTestId("authoring-stage-stream");
    await waitFor(() => expect(stageStream).toHaveTextContent("내용 정리"));
    await waitFor(() => expect(stageStream).toHaveTextContent("12.3초"));
    await waitFor(() => expect(stageStream).toHaveTextContent("양식 맞춤"));

    expect(await screen.findByLabelText("섹션 1 제목")).toHaveValue("추진 배경");
    expect(screen.getByLabelText("섹션 2 제목")).toHaveValue("조치 계획");
    expect(screen.getByLabelText("두괄식 요약")).toHaveValue("민원 처리 지연을 해소하기 위한 주간 조치 요약");
    expect(screen.getByText("시도 2회")).toBeInTheDocument();
    expect(screen.getByText("복구됨")).toBeInTheDocument();

    expect(structureBodies).toHaveLength(1);
    expect(structureBodies[0]).toMatchObject({
      format: "onePageReport",
      session_id: "session-1",
      stream: true,
    });

    await user.click(screen.getByRole("button", { name: "JSON" }));
    const jsonArea = screen.getByLabelText("구조 JSON") as HTMLTextAreaElement;
    expect(jsonArea.value).toContain("추진 배경");

    await user.click(screen.getByRole("tab", { name: "미리보기" }));
    expect(await screen.findByTestId("authoring-preview")).toHaveTextContent("□ 추진 배경");
  });

  it("builds the content base and wires the finalize approval flow", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openChatScreen(user);
    await user.click(await screen.findByRole("button", { name: "문서작성으로 이어가기" }));
    await screen.findByTestId("document-authoring-workspace");

    await user.click(screen.getByRole("button", { name: "구조 생성 → 검토" }));
    await screen.findByLabelText("섹션 1 제목");

    // F-09: 빌드 버튼은 미리보기 탭에 있고, 빌드 성공 시 최종 탭으로 자동 전환된다
    await user.click(screen.getByRole("tab", { name: "미리보기" }));
    await user.click(screen.getByRole("button", { name: "이대로 문서 생성" }));

    expect(await screen.findByTestId("authoring-final")).toBeInTheDocument();
    const buildResult = await screen.findByTestId("authoring-build-result");
    expect(buildResult).toHaveTextContent("작성 콘텐츠 생성됨");
    expect(buildResult).toHaveTextContent("주간 보고 작업 문서");
    expect(buildResult).toHaveTextContent(/승인 티켓 결재 후/);

    expect(buildBodies).toHaveLength(1);
    expect(buildBodies[0]).toMatchObject({
      format: "onePageReport",
      title: "주간 보고 작업 문서",
    });
    expect(buildBodies[0]).toMatchObject({
      structure: expect.objectContaining({
        title: "주간 보고 작업 문서",
        sections: [
          { heading: "추진 배경", items: ["민원 처리 지연 누적"] },
          { heading: "조치 계획", items: ["처리 절차 간소화", "담당자 재배치"] },
        ],
      }),
    });

    await user.click(screen.getByRole("button", { name: "최종 저장 요청" }));
    await waitFor(() => expect(finalizeBodies).toHaveLength(1));
    expect(finalizeBodies[0]).toMatchObject({
      content_base_id: "content-1",
      output_name: "주간 보고 작업 문서",
    });

    const applyButton = await screen.findByRole("button", { name: "최종 저장 적용" });
    await waitFor(() => expect(applyButton).toBeEnabled());
    await user.click(applyButton);

    await waitFor(() => expect(applyCalled).toBe(true));
    expect(await screen.findByTestId("document-generate-result")).toHaveTextContent(
      "documents/final/weekly-report.hwpx",
    );
  }, 15000);
});
