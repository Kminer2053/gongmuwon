import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// D-02: rhwp 동적 import 모킹 — 페이지 렌더 분기 확인용 (2페이지 문서)
vi.mock("@rhwp/core", () => ({
  default: vi.fn(async () => ({})),
  HwpDocument: class {
    constructor(public bytes: Uint8Array) {}
    pageCount() {
      return 2;
    }
    renderPageSvg(page: number) {
      return `<svg xmlns='http://www.w3.org/2000/svg' data-page='${page}'><text>페이지 ${page + 1}</text></svg>`;
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
import {
  normalizeAuthoringStructureForPreview,
  renderLocalAuthoringPreview,
  splitSummarySentences,
} from "./screens/DocumentsScreen";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

const bytesResponse = (bytes: Uint8Array) =>
  Promise.resolve(
    new Response(bytes.buffer as ArrayBuffer, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    }),
  );

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

const STRUCTURE_DONE_EVENT =
  "event: done\ndata: " +
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
    meta: { attempts: 1, repaired: false, hints: [] },
  }) +
  "\n\n";

const STRUCTURE_STREAM_BLOCKS = [
  'event: stage\ndata: {"stage":"organize","status":"start"}\n\n',
  'event: stage\ndata: {"stage":"organize","status":"done","elapsed_ms":1200}\n\n',
  'event: stage\ndata: {"stage":"format","status":"start"}\n\n',
  'event: stage\ndata: {"stage":"format","status":"done","elapsed_ms":300,"attempts":1,"repaired":false}\n\n',
  STRUCTURE_DONE_EVENT,
];

const STRUCTURE_ERROR_BLOCKS = [
  'event: stage\ndata: {"stage":"organize","status":"start"}\n\n',
  'event: error\ndata: {"message":"내용 정리 단계에서 LLM 호출에 실패했습니다: 연결 실패"}\n\n',
];

describe("documents authoring improvements (F-09/M-09/F-08/J-04/D-02/F-07)", () => {
  let structureCallCount = 0;
  let structureFailsFrom = Number.POSITIVE_INFINITY;
  const reviseBodies: Array<Record<string, unknown>> = [];
  const previewHwpxBodies: Array<Record<string, unknown>> = [];
  const buildBodies: Array<Record<string, unknown>> = [];
  const customDetectBodies: Array<Record<string, unknown>> = [];
  const customSuggestBodies: Array<Record<string, unknown>> = [];
  const customApplyBodies: Array<Record<string, unknown>> = [];
  const customPatchBodies: Array<Record<string, unknown>> = [];
  let reviseResponse: () => Promise<Response> = () =>
    jsonResponse({ detail: "not configured" }, 500);
  let customDetectResponse: () => Promise<Response> = () =>
    jsonResponse({ detail: "not configured" }, 500);
  // W7 §5.5: 참고자료 '원본 없음' pill 테스트용 — 세션 연결 파일과 색인 파일을 테스트별로 구성한다.
  let sessionFileLinkItems: Array<Record<string, unknown>> = [];
  let knowledgeSourceFileItems: Array<Record<string, unknown>> = [];

  const defaultSessionFileLinks = () => [
    {
      id: "link-1",
      session_id: "session-1",
      file_path: "C:/Docs/weekly-report.hwpx",
      label: null,
      source: "manual",
      created_at: "2026-05-06T09:10:00+09:00",
    },
  ];
  const defaultKnowledgeSourceFiles = () => [
    {
      id: "file-1",
      source_id: "source-1",
      file_path: "C:/Docs/weekly-report.hwpx",
      relative_path: "Docs/weekly-report.hwpx",
      file_hash: "hash-1",
      size_bytes: 1024,
      modified_at: "2026-05-01T09:00:00+09:00",
      status: "indexed",
      title: "주간 보고",
      mime_type: "application/octet-stream",
      text_excerpt: "민원 처리 지연 현황과 조치 계획을 담은 주간 보고 발췌입니다.",
      created_at: "2026-05-01T09:00:00+09:00",
      updated_at: "2026-05-01T09:00:00+09:00",
    },
  ];

  beforeEach(() => {
    structureCallCount = 0;
    structureFailsFrom = Number.POSITIVE_INFINITY;
    sessionFileLinkItems = defaultSessionFileLinks();
    knowledgeSourceFileItems = defaultKnowledgeSourceFiles();
    reviseBodies.length = 0;
    previewHwpxBodies.length = 0;
    buildBodies.length = 0;
    customDetectBodies.length = 0;
    customSuggestBodies.length = 0;
    customApplyBodies.length = 0;
    customPatchBodies.length = 0;
    reviseResponse = () => jsonResponse({ detail: "not configured" }, 500);
    customDetectResponse = () =>
      jsonResponse({
        mode: "form",
        confidence: 1,
        total_fields: 4,
        fields: [
          { label: "성명", current: "" },
          { label: "연락처", current: "" },
          { label: "신청일", current: "" },
        ],
      });

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
                key: "onePageReport",
                aliases: ["1p"],
                label: "1페이지 보고서",
                description: "두괄식 요약 + 섹션 2~5개",
                icon: "file-text",
                schema_fields: ["title", "summary", "sections[2..5]"],
              },
            ],
          });
        }

        if (url.endsWith("/api/documents/authoring/structure") && method === "POST") {
          structureCallCount += 1;
          if (structureCallCount >= structureFailsFrom) {
            return sseResponse(STRUCTURE_ERROR_BLOCKS);
          }
          return sseResponse(STRUCTURE_STREAM_BLOCKS);
        }

        if (url.endsWith("/api/documents/authoring/revise") && method === "POST") {
          reviseBodies.push(JSON.parse(String(init?.body ?? "{}")));
          return reviseResponse();
        }

        if (url.endsWith("/api/documents/authoring/custom-template") && method === "POST") {
          return jsonResponse(
            {
              item: {
                file_name: "교육신청서.hwpx",
                path: "/tmp/gongmu-workspace/documents/templates/uuid-교육신청서.hwpx",
                size_bytes: 2048,
                uploaded_at: "2026-07-05T09:00:00+09:00",
              },
            },
            201,
          );
        }

        if (url.endsWith("/api/documents/authoring/custom-detect") && method === "POST") {
          customDetectBodies.push(JSON.parse(String(init?.body ?? "{}")));
          return customDetectResponse();
        }

        if (url.endsWith("/api/documents/authoring/custom-fill-suggest") && method === "POST") {
          customSuggestBodies.push(JSON.parse(String(init?.body ?? "{}")));
          return jsonResponse({
            values: { 성명: "홍길동", 연락처: "010-1234-5678" },
            matched_count: 2,
            total_fields: 3,
          });
        }

        if (url.endsWith("/api/documents/authoring/custom-fill-apply") && method === "POST") {
          customApplyBodies.push(JSON.parse(String(init?.body ?? "{}")));
          return jsonResponse(
            {
              artifact: { path: "/tmp/gongmu-workspace/documents/outputs/교육신청서_작성.hwpx" },
              filled_count: 2,
              requested_count: 2,
              unmatched: [],
              note: "양식의 표·서식은 보존하고 빈 필드 값만 채웠습니다.",
            },
            201,
          );
        }

        if (url.endsWith("/api/documents/authoring/custom-patch") && method === "POST") {
          customPatchBodies.push(JSON.parse(String(init?.body ?? "{}")));
          return jsonResponse(
            {
              artifact: { path: "/tmp/gongmu-workspace/documents/outputs/안내문_AI수정.hwpx" },
              applied_changes: 4,
              replaced_blocks: 4,
              organized_markdown: "# 안내문",
              note: "양식의 표·로고·서식은 보존한 채 본문 문단만 교체했습니다.",
            },
            201,
          );
        }

        if (url.endsWith("/api/documents/authoring/preview-hwpx") && method === "POST") {
          previewHwpxBodies.push(JSON.parse(String(init?.body ?? "{}")));
          return bytesResponse(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]));
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
                note: "승인 후 apply 호출 시 HWPX 생성",
              },
            },
            201,
          );
        }

        if (url.endsWith("/api/work-sessions")) {
          return jsonResponse({
            items: [
              {
                id: "session-1",
                title: "주간 보고 작업",
                schedule_id: null,
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
          return jsonResponse({ items: [] });
        }

        if (url.endsWith("/api/work-sessions/session-1/file-links")) {
          return jsonResponse({ items: sessionFileLinkItems });
        }

        if (url.endsWith("/api/knowledge/source-files")) {
          return jsonResponse({ items: knowledgeSourceFileItems });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/schedules": { items: [] },
          "/api/templates": { items: [] },
          "/api/documents/templates/custom": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/knowledge/sources": { items: [] },
          "/api/knowledge/ingestion-jobs": { items: [] },
          "/api/knowledge/documents": { items: [] },
          "/api/personalization/candidates": { items: [] },
          "/api/approval-tickets": { items: [] },
          "/api/execution-logs": { items: [] },
          "/api/tools": { items: [] },
        };
        const matched = Object.entries(collectionMap).find(([path]) => url.endsWith(path));
        if (matched) {
          return jsonResponse(matched[1]);
        }
        if (url.includes("/api/jobs")) {
          return jsonResponse({ items: [] });
        }

        return jsonResponse({ detail: `Unhandled request: ${method} ${url}` }, 404);
      }),
    );
  });

  async function openDocumentsFromChat(user: ReturnType<typeof userEvent.setup>) {
    render(<App />);
    const rail = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    await user.click(within(rail).getByRole("button", { name: "업무대화" }));
    await screen.findByTestId("chat-workspace");
    await user.click(await screen.findByRole("button", { name: "문서작성으로 이어가기" }));
    await screen.findByTestId("document-authoring-workspace");
  }

  async function generateStructure(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "구조 생성 → 검토" }));
    await screen.findByLabelText("섹션 1 제목");
  }

  it("renders the reordered tabs and keeps the build button in the preview tab only (F-09)", async () => {
    const user = userEvent.setup();
    await openDocumentsFromChat(user);

    const tablist = screen.getByRole("tablist", { name: "문서작성 단계" });
    const tabLabels = within(tablist)
      .getAllByRole("tab")
      .map((tab) => tab.textContent);
    expect(tabLabels).toEqual(["참고자료", "작성 콘텐츠", "미리보기", "최종"]);

    // 미리보기 탭에 빌드 버튼이 있다 (구조 생성 후)
    await generateStructure(user);
    await user.click(screen.getByRole("tab", { name: "미리보기" }));
    expect(screen.getByRole("button", { name: "이대로 문서 생성" })).toBeInTheDocument();

    // 최종 탭은 산출물 전용 — 빌드 버튼 없음 + 1줄 빈 상태(F-11)
    await user.click(screen.getByRole("tab", { name: "최종" }));
    expect(screen.queryByRole("button", { name: "이대로 문서 생성" })).not.toBeInTheDocument();
    expect(screen.getByTestId("authoring-final-empty")).toHaveTextContent(
      "생성된 문서가 여기에 표시됩니다.",
    );
  });

  it("updates the plain-text preview immediately on edit without a server round trip (M-09)", async () => {
    const user = userEvent.setup();
    await openDocumentsFromChat(user);
    await generateStructure(user);

    const headingInput = screen.getByLabelText("섹션 1 제목");
    await user.clear(headingInput);
    await user.type(headingInput, "새 추진 배경");

    await user.click(screen.getByRole("tab", { name: "미리보기" }));
    const previewText = await screen.findByTestId("authoring-preview-text");
    expect(previewText).toHaveTextContent("□ 새 추진 배경");
    expect(previewText).toHaveTextContent("◦ 민원 처리 지연 누적");
    // 로컬 렌더만 사용 — 빌드/서버 미리보기 호출 없음
    expect(buildBodies).toHaveLength(0);
    expect(previewHwpxBodies).toHaveLength(0);
  }, 15000);

  it("applies a revise instruction via Ctrl+Enter and shows the change summary badges (F-08)", async () => {
    reviseResponse = () =>
      jsonResponse({
        format: "onePageReport",
        structure: {
          title: "주간 보고 작업 문서",
          summary: "요약은 두 문장으로 정리",
          sections: [
            { heading: "예산 섹션", items: ["예산 재배정 우선"] },
            { heading: "추진 배경", items: ["민원 처리 지연 누적"] },
          ],
        },
        preview: "□ 예산 섹션\n ◦ 예산 재배정 우선",
        meta: { attempts: 2, repaired: false, hints: ["항목 부족(최소 2개 필요)"] },
      });

    const user = userEvent.setup();
    await openDocumentsFromChat(user);
    await generateStructure(user);

    const reviseBox = screen.getByTestId("authoring-revise");
    const instructionInput = within(reviseBox).getByLabelText("수정 지시 입력");
    await user.type(instructionInput, "예산 섹션을 앞으로, 요약은 2문장으로");
    await user.keyboard("{Control>}{Enter}{/Control}");

    // 구조 교체 + 변경 요약 배지
    await waitFor(() => expect(screen.getByLabelText("섹션 1 제목")).toHaveValue("예산 섹션"));
    const summary = await screen.findByTestId("authoring-revise-summary");
    expect(summary).toHaveTextContent("지시 반영됨");
    expect(summary).toHaveTextContent("시도 2회");
    expect(summary).toHaveTextContent("항목 부족(최소 2개 필요)");

    expect(reviseBodies).toHaveLength(1);
    expect(reviseBodies[0]).toMatchObject({
      format: "onePageReport",
      instruction: "예산 섹션을 앞으로, 요약은 2문장으로",
    });
    expect(reviseBodies[0]).toMatchObject({
      structure: expect.objectContaining({ title: "주간 보고 작업 문서" }),
    });
  }, 15000);

  it("keeps the current structure and input on revise failure (F-08 + J-04)", async () => {
    reviseResponse = () => jsonResponse({ detail: "LLM 연결 실패" }, 502);

    const user = userEvent.setup();
    await openDocumentsFromChat(user);
    await generateStructure(user);

    const reviseBox = screen.getByTestId("authoring-revise");
    const instructionInput = within(reviseBox).getByLabelText("수정 지시 입력");
    await user.type(instructionInput, "요약을 더 짧게");
    await user.click(within(reviseBox).getByRole("button", { name: /지시 적용/ }));

    const inlineError = await screen.findByTestId("authoring-revise-error");
    expect(inlineError).toHaveTextContent("LLM 연결 실패");
    // 기존 구조 불변 + 입력 보존
    expect(screen.getByLabelText("섹션 1 제목")).toHaveValue("추진 배경");
    expect(instructionInput).toHaveValue("요약을 더 짧게");
  }, 15000);

  it("restores the previous structure snapshot when a re-run fails (J-04)", async () => {
    const user = userEvent.setup();
    await openDocumentsFromChat(user);
    await generateStructure(user);

    // 두 번째 구조 생성은 스트림 오류로 실패한다
    structureFailsFrom = 2;
    await user.click(screen.getByRole("button", { name: "구조 생성 → 검토" }));

    expect(await screen.findByText("이전 구조를 유지했습니다.")).toBeInTheDocument();
    expect(await screen.findByTestId("authoring-error")).toHaveTextContent(
      "LLM 호출에 실패했습니다",
    );
    // 이전 구조/미리보기 스냅샷 복원
    expect(screen.getByLabelText("섹션 1 제목")).toHaveValue("추진 배경");
    await user.click(screen.getByRole("tab", { name: "미리보기" }));
    expect(await screen.findByTestId("authoring-preview-text")).toHaveTextContent("□ 추진 배경");
  }, 15000);

  it("renders the paper preview through the mocked rhwp renderer with pagination (D-02)", async () => {
    const user = userEvent.setup();
    await openDocumentsFromChat(user);
    await generateStructure(user);

    await user.click(screen.getByRole("tab", { name: "미리보기" }));
    await user.click(screen.getByRole("button", { name: "양식 미리보기" }));

    const viewer = await screen.findByTestId("authoring-paper-preview");
    expect(viewer).toHaveTextContent("근사 미리보기 — 실제 한컴오피스 서식과 다를 수 있습니다.");

    const indicator = await screen.findByTestId("authoring-paper-preview-page-indicator");
    expect(indicator).toHaveTextContent("1 / 2");
    expect(screen.getByTestId("authoring-paper-preview-page").innerHTML).toContain("<svg");

    await user.click(screen.getByRole("button", { name: "다음 페이지" }));
    expect(indicator).toHaveTextContent("2 / 2");

    expect(previewHwpxBodies).toHaveLength(1);
    expect(previewHwpxBodies[0]).toMatchObject({ format: "onePageReport" });
  }, 15000);

  it("runs the custom form flow: upload → detect → suggest → fill (W5-2 임의형식)", async () => {
    const user = userEvent.setup();
    await openDocumentsFromChat(user);

    // 5번째 출력 유형 칩
    const formatGroup = screen.getByRole("group", { name: "출력 유형 선택" });
    await user.click(within(formatGroup).getByRole("button", { name: "임의형식 선택" }));

    // 좌측 양식 업로드 → 분석 버튼 활성화
    const detectButton = screen.getByRole("button", { name: "양식 분석" });
    expect(detectButton).toBeDisabled();
    const fileInput = screen.getByLabelText("임의형식 양식 파일 업로드");
    await user.upload(
      fileInput,
      new File(["hwpx-bytes"], "교육신청서.hwpx", { type: "application/octet-stream" }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "양식 분석" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "양식 분석" }));
    expect(await screen.findByTestId("custom-form-editor")).toBeInTheDocument();
    expect(customDetectBodies[0]).toMatchObject({
      template_path: "/tmp/gongmu-workspace/documents/templates/uuid-교육신청서.hwpx",
    });

    // 필드 검토 편집기: 감지된 라벨 + "0/3 채움" 카운터 + 빈칸 안내
    expect(screen.getByTestId("custom-fill-counter")).toHaveTextContent("0/3 채움");
    expect(screen.getByLabelText("성명 값")).toBeInTheDocument();
    expect(screen.getByLabelText("연락처 값")).toBeInTheDocument();
    expect(screen.getByLabelText("신청일 값")).toBeInTheDocument();
    expect(screen.getByTestId("custom-form-editor")).toHaveTextContent(
      "근거가 없는 칸은 추측하지 않고 빈칸으로 남깁니다.",
    );

    // 값 제안: 매칭된 값만 채우고 근거 없는 칸은 빈칸 유지
    await user.click(screen.getByRole("button", { name: "값 제안" }));
    await waitFor(() =>
      expect(screen.getByTestId("custom-fill-counter")).toHaveTextContent("2/3 채움"),
    );
    expect(screen.getByLabelText("성명 값")).toHaveValue("홍길동");
    expect(screen.getByLabelText("신청일 값")).toHaveValue("");
    expect(screen.getByTestId("custom-suggest-summary")).toHaveTextContent(
      "2/3개 값을 제안했습니다",
    );
    expect(customSuggestBodies[0]).toMatchObject({ fields: ["성명", "연락처", "신청일"] });

    // 양식에 채우기 → 빈칸은 보내지 않음 → 최종 탭 산출물
    await user.click(screen.getByRole("button", { name: "양식에 채우기" }));
    const artifactResult = await screen.findByTestId("custom-artifact-result");
    expect(artifactResult).toHaveTextContent("양식 채우기 완료");
    expect(screen.getByTestId("custom-artifact-detail")).toHaveTextContent(
      "빈 필드 2개를 채웠습니다.",
    );
    expect(customApplyBodies[0]).toMatchObject({
      template_path: "/tmp/gongmu-workspace/documents/templates/uuid-교육신청서.hwpx",
      values: { 성명: "홍길동", 연락처: "010-1234-5678" },
    });
    expect((customApplyBodies[0].values as Record<string, string>)["신청일"]).toBeUndefined();
  }, 20000);

  it("routes document-type custom templates to the patch flow (W5-2 본문 교체형)", async () => {
    customDetectResponse = () =>
      jsonResponse({ mode: "document", fields: [], confidence: 0, total_fields: 0 });

    const user = userEvent.setup();
    await openDocumentsFromChat(user);
    const formatGroup = screen.getByRole("group", { name: "출력 유형 선택" });
    await user.click(within(formatGroup).getByRole("button", { name: "임의형식 선택" }));
    await user.upload(
      screen.getByLabelText("임의형식 양식 파일 업로드"),
      new File(["hwpx-bytes"], "안내문.hwpx", { type: "application/octet-stream" }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "양식 분석" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "양식 분석" }));

    const panel = await screen.findByTestId("custom-document-panel");
    expect(panel).toHaveTextContent("본문 교체형 양식");
    await user.click(within(panel).getByRole("button", { name: "양식에 반영" }));

    const artifactResult = await screen.findByTestId("custom-artifact-result");
    expect(artifactResult).toHaveTextContent("양식 본문 반영 완료");
    expect(screen.getByTestId("custom-artifact-detail")).toHaveTextContent(
      "본문 문단 4곳을 교체했습니다.",
    );
    expect(customPatchBodies[0]).toMatchObject({
      template_path: "/tmp/gongmu-workspace/documents/templates/uuid-교육신청서.hwpx",
      session_id: "session-1",
    });
  }, 20000);

  it("shows session-linked files as typed cards with excerpt (F-07)", async () => {
    const user = userEvent.setup();
    await openDocumentsFromChat(user);

    const referencesTab = await screen.findByTestId("authoring-references");
    const card = await within(referencesTab).findByTestId("authoring-reference-card");
    expect(card).toHaveTextContent("weekly-report.hwpx");
    expect(card).toHaveTextContent("민원 처리 지연 현황과 조치 계획을 담은 주간 보고 발췌입니다.");
    const icon = card.querySelector("img.authoring-reference-card__icon");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("src", "/icons/action/doc-forward.svg");
    // 색인과 정상 조인된 참고자료에는 '원본 없음' 경고가 붙지 않는다.
    expect(within(card).queryByTestId("authoring-reference-missing")).not.toBeInTheDocument();
  });

  // W7 §5.5: 발췌 조인 실패는 조용히 숨기지 않고 '원본 없음' 경고 pill로 가시화한다.
  it("flags reference cards whose source path is missing from the knowledge index (W7 §5.5)", async () => {
    sessionFileLinkItems = [
      ...defaultSessionFileLinks(),
      {
        id: "link-2",
        session_id: "session-1",
        file_path: "C:/Docs/moved-plan.hwpx",
        label: "이동된 계획서",
        source: "knowledge",
        created_at: "2026-05-06T09:20:00+09:00",
      },
    ];

    const user = userEvent.setup();
    await openDocumentsFromChat(user);

    const referencesTab = await screen.findByTestId("authoring-references");
    const cards = await within(referencesTab).findAllByTestId("authoring-reference-card");
    expect(cards).toHaveLength(2);

    // 색인에 경로가 없는 항목에만 경고 pill이 붙는다.
    const missingPills = within(referencesTab).getAllByTestId("authoring-reference-missing");
    expect(missingPills).toHaveLength(1);
    const flaggedCard = missingPills[0].closest("[data-testid='authoring-reference-card']");
    expect(flaggedCard).toHaveTextContent("이동된 계획서");
    expect(missingPills[0]).toHaveTextContent("원본 없음 — 경로 확인 필요");
    expect(missingPills[0]).toHaveAttribute("title");
  });

  it("flags reference cards whose indexed source is soft-deleted (W7 §5.5)", async () => {
    knowledgeSourceFileItems = [
      {
        ...defaultKnowledgeSourceFiles()[0],
        status: "deleted",
      },
    ];

    const user = userEvent.setup();
    await openDocumentsFromChat(user);

    const referencesTab = await screen.findByTestId("authoring-references");
    const card = await within(referencesTab).findByTestId("authoring-reference-card");
    expect(within(card).getByTestId("authoring-reference-missing")).toHaveTextContent(
      "원본 없음 — 경로 확인 필요",
    );
  });
});

describe("renderLocalAuthoringPreview (M-09 unit)", () => {
  it("renders the onePageReport hierarchy exactly like the server renderer", () => {
    const preview = renderLocalAuthoringPreview("onePageReport", {
      title: "청사 에너지 절감 추진계획 보고",
      subtitle: "2026년 하반기",
      summary: "전력 사용량 12% 절감",
      sections: [
        {
          heading: "추진 배경",
          items: ["전력비 3.2억 원"],
          detail: "냉난방 전력 61%",
          note: "지침 근거",
        },
      ],
    });
    expect(preview).toBe(
      [
        "청사 에너지 절감 추진계획 보고",
        "- 2026년 하반기 -",
        "",
        "─".repeat(30),
        " ◦ 전력 사용량 12% 절감",
        "─".repeat(30),
        "",
        "□ 추진 배경",
        " ◦ 전력비 3.2억 원",
        "   - 냉난방 전력 61%",
        " ※ 지침 근거",
      ].join("\n"),
    );
  });

  it("renders officialMemo with ganada hierarchy and closing mark", () => {
    const preview = renderLocalAuthoringPreview("officialMemo", {
      title: "협조 요청",
      receiver: "각 부서장",
      opening: "아래와 같이 협조를 요청합니다.",
      items: [{ text: "설정온도 준수", subs: ["공용공간 우선"] }, { text: "대기전력 차단" }],
      attachments: ["실행계획 1부"],
      sender: "행정지원과장",
    });
    expect(preview).toContain("수신: 각 부서장");
    expect(preview).toContain("  가. 설정온도 준수");
    expect(preview).toContain("    1) 공용공간 우선");
    expect(preview).toContain("  나. 대기전력 차단");
    expect(preview).toContain("붙임: 실행계획 1부");
    expect(preview).toContain("끝.");
    expect(preview.endsWith("행정지원과장")).toBe(true);
  });

  it("renders fullReport chapters with roman numerals and confirmed schedule rows", () => {
    const preview = renderLocalAuthoringPreview("fullReport", {
      title: "종합계획",
      summary: ["요약 한 줄"],
      chapters: [
        { heading: "추진 배경", sections: [{ heading: "현황", items: ["전력비 증가"] }] },
        { heading: "추진 과제", sections: [{ heading: "설비", items: ["자동제어"] }] },
      ],
      schedule: { rows: [{ 항목: "시범 적용", 일정: "2026.7.", 비고: "본관" }] },
    });
    expect(preview).toContain("Ⅰ. 추진 배경");
    expect(preview).toContain("Ⅱ. 추진 과제");
    expect(preview).toContain("※ 추진 일정");
    expect(preview).toContain(" ◦ 시범 적용: 2026.7. (본관)");
  });
});

/**
 * W5-1: 서버 render_preview(document_authoring.py) 와 필드 전수 스냅샷 비교.
 * 기대 문자열은 검증(pydantic model_dump)된 구조를 서버 render_preview 에 넣어 얻은
 * 실제 출력이다 — 로컬 렌더러가 한 글자라도 어긋나면 이 테스트가 잡는다.
 */
describe("renderLocalAuthoringPreview server parity (W5-1 전 필드 스냅샷)", () => {
  it("onePageReport: title/subtitle/summary/items/detail/note 전 필드 일치", () => {
    const validated = {
      title: "청사 에너지 절감 추진계획 보고",
      subtitle: "2026년 하반기 실행 중심",
      summary: "전력 사용량 12% 절감을 위해 3개 과제를 하반기에 즉시 추진",
      sections: [
        {
          heading: "추진 배경",
          items: ["전력비 3.2억 원", "지침 시달"],
          detail: "냉난방 전력 61%",
          note: "합리화 지침 근거",
        },
        { heading: "향후 조치", items: ["7월 시범 적용"], detail: null, note: null },
      ],
    };
    const rule = "─".repeat(30);
    expect(renderLocalAuthoringPreview("onePageReport", validated)).toBe(
      `청사 에너지 절감 추진계획 보고\n- 2026년 하반기 실행 중심 -\n\n${rule}\n ◦ 전력 사용량 12% 절감을 위해 3개 과제를 하반기에 즉시 추진\n${rule}\n\n□ 추진 배경\n ◦ 전력비 3.2억 원\n ◦ 지침 시달\n   - 냉난방 전력 61%\n ※ 합리화 지침 근거\n\n□ 향후 조치\n ◦ 7월 시범 적용`,
    );
  });

  it("fullReport: summary 배열·장/절·schedule 표(비고 null 포함) 전 필드 일치", () => {
    const validated = {
      title: "2026년 종합계획",
      summary: ["요약 첫 줄", "요약 둘째 줄"],
      chapters: [
        { heading: "추진 배경", sections: [{ heading: "현황", items: ["전력비 증가"] }] },
        {
          heading: "추진 과제",
          sections: [
            { heading: "설비", items: ["자동제어", "태양광"] },
            { heading: "행태", items: ["대기전력 차단"] },
          ],
        },
        { heading: "행정 사항", sections: [{ heading: "일정·예산", items: ["7월 시범"] }] },
      ],
      schedule: {
        rows: [
          { 항목: "시범 적용", 일정: "2026.7.", 비고: "본관 우선" },
          { 항목: "발주", 일정: "2026.9.", 비고: null },
        ],
      },
    };
    expect(renderLocalAuthoringPreview("fullReport", validated)).toBe(
      "2026년 종합계획\n\n□ 요약\n ◦ 요약 첫 줄\n ◦ 요약 둘째 줄\n\nⅠ. 추진 배경\n□ 현황\n ◦ 전력비 증가\n\nⅡ. 추진 과제\n□ 설비\n ◦ 자동제어\n ◦ 태양광\n□ 행태\n ◦ 대기전력 차단\n\nⅢ. 행정 사항\n□ 일정·예산\n ◦ 7월 시범\n\n※ 추진 일정\n ◦ 시범 적용: 2026.7. (본관 우선)\n ◦ 발주: 2026.9.",
    );
  });

  it("officialMemo: items/subs/attachments/sender 전 필드 일치", () => {
    const validated = {
      title: "협조 요청",
      receiver: "각 부서장",
      opening: "아래와 같이 협조를 요청합니다.",
      items: [
        { text: "설정온도 준수", subs: ["공용공간 우선", "책임자 지정"] },
        { text: "대기전력 차단", subs: [] },
      ],
      attachments: ["실행계획 1부", "점검표 1부"],
      sender: "행정지원과장",
    };
    expect(renderLocalAuthoringPreview("officialMemo", validated)).toBe(
      "수신: 각 부서장\n제목: 협조 요청\n\n1. 아래와 같이 협조를 요청합니다.\n2. 세부 사항\n  가. 설정온도 준수\n    1) 공용공간 우선\n    2) 책임자 지정\n  나. 대기전력 차단\n붙임: 실행계획 1부\n붙임: 점검표 1부\n끝.\n\n행정지원과장",
    );
  });

  it("email: greeting/body/closing/signature 전 필드 일치", () => {
    const validated = {
      subject: "[협조] 에너지 절감 안내",
      greeting: "안녕하십니까.",
      body_paragraphs: ["첫 문단.", "둘째 문단."],
      closing: "감사합니다.",
      signature: "홍길동 주무관",
    };
    expect(renderLocalAuthoringPreview("email", validated)).toBe(
      "제목: [협조] 에너지 절감 안내\n\n안녕하십니까.\n\n첫 문단.\n\n둘째 문단.\n\n감사합니다.\n\n홍길동 주무관",
    );
  });
});

/**
 * W5-1: 미리보기와 최종 문서가 같은 구조를 읽도록 만드는 정규화.
 * 서버 검증(pydantic)이 최종 문서에서 걸러내는 값을 미리보기에서도 동일하게 걸러낸다.
 */
describe("normalizeAuthoringStructureForPreview (미리보기 = 문서 내용)", () => {
  it("fullReport: 미정/추후/TBD 일정 행은 미리보기에서도 제거된다", () => {
    const normalized = normalizeAuthoringStructureForPreview("fullReport", {
      title: "계획",
      summary: ["요약"],
      chapters: [{ heading: "장", sections: [{ heading: "절", items: ["항목"] }] }],
      schedule: {
        rows: [
          { 항목: "시범 적용", 일정: "2026.7." },
          { 항목: "발주", 일정: "2026.9." },
          { 항목: "확산", 일정: "추후 협의" },
          { 항목: "평가", 일정: "TBD" },
        ],
      },
    });
    const rows = (normalized.schedule as { rows: Array<{ 항목: string }> }).rows;
    expect(rows.map((row) => row.항목)).toEqual(["시범 적용", "발주"]);
  });

  it("fullReport: 확정 행이 2개 미만이면 일정표를 통째로 뺀다 (서버와 동일)", () => {
    const normalized = normalizeAuthoringStructureForPreview("fullReport", {
      title: "계획",
      summary: ["요약"],
      chapters: [{ heading: "장", sections: [{ heading: "절", items: ["항목"] }] }],
      schedule: {
        rows: [
          { 항목: "시범 적용", 일정: "2026.7." },
          { 항목: "확산", 일정: "미정" },
        ],
      },
    });
    expect(normalized.schedule).toBeUndefined();
    expect(renderLocalAuthoringPreview("fullReport", normalized)).not.toContain("※ 추진 일정");
  });

  it("onePageReport: 편집기에서 생긴 빈 항목 줄을 미리보기 전에 제거하고 요약을 200자로 자른다", () => {
    const normalized = normalizeAuthoringStructureForPreview("onePageReport", {
      title: "보고",
      summary: "가".repeat(240),
      sections: [
        { heading: "배경", items: ["항목 하나", "", "  ", "항목 둘"] },
        { heading: "조치", items: ["항목"] },
      ],
    });
    expect((normalized.sections as Array<{ items: string[] }>)[0].items).toEqual([
      "항목 하나",
      "항목 둘",
    ]);
    expect((normalized.summary as string).length).toBe(200);
    expect(renderLocalAuthoringPreview("onePageReport", normalized)).not.toContain(" ◦ \n");
  });
});

/**
 * F-13a: summary 다문장 한 줄 렌더 방지 — 서버 hwpx_writer.split_summary_sentences 와
 * 동일 규칙(마침표+공백 경계, 숫자 뒤 마침표 제외)으로 문장마다 별도 ◦ 줄을 만든다.
 */
describe("splitSummarySentences (F-13a 서버 동일 규칙)", () => {
  it("마침표+공백 기준으로 문장을 나눈다", () => {
    expect(
      splitSummarySentences("교육 3회를 실시함. 참석률 87%를 기록함. 만족도 4.3/5 달성."),
    ).toEqual(["교육 3회를 실시함.", "참석률 87%를 기록함.", "만족도 4.3/5 달성."]);
  });

  it("소수점·날짜 표기(숫자 뒤 마침표)는 문장 경계로 보지 않는다", () => {
    expect(splitSummarySentences("2026. 7. 시범 적용을 개시함. 8월 확대 예정.")).toEqual([
      "2026. 7. 시범 적용을 개시함.",
      "8월 확대 예정.",
    ]);
    expect(splitSummarySentences("만족도 4.3 이상 달성")).toEqual(["만족도 4.3 이상 달성"]);
  });

  it("빈 문자열은 빈 목록, 한 문장은 그대로 돌려준다", () => {
    expect(splitSummarySentences("")).toEqual([]);
    expect(splitSummarySentences("   ")).toEqual([]);
    expect(splitSummarySentences("단일 문장 요약")).toEqual(["단일 문장 요약"]);
  });
});

describe("renderLocalAuthoringPreview summary 문장 분리 렌더 (F-13a)", () => {
  it("onePageReport: 다문장 summary가 문장마다 별도 ◦ 줄로 렌더된다", () => {
    const preview = renderLocalAuthoringPreview("onePageReport", {
      title: "AI 활용 교육 결과보고",
      summary: "교육 3회를 실시함. 참석률 87%를 기록함.",
      sections: [{ heading: "개요", items: ["항목"] }],
    });
    const lines = preview.split("\n");
    expect(lines).toContain(" ◦ 교육 3회를 실시함.");
    expect(lines).toContain(" ◦ 참석률 87%를 기록함.");
    expect(lines).not.toContain(" ◦ 교육 3회를 실시함. 참석률 87%를 기록함.");
  });

  it("fullReport: summary 항목 안 다문장도 문장마다 별도 ◦ 줄로 렌더된다", () => {
    const preview = renderLocalAuthoringPreview("fullReport", {
      title: "종합계획",
      summary: ["3대 과제를 착수함. 예산 1.8억 원을 재배정함.", "하반기 완료 목표"],
      chapters: [{ heading: "장", sections: [{ heading: "절", items: ["항목"] }] }],
    });
    const lines = preview.split("\n");
    expect(lines).toContain(" ◦ 3대 과제를 착수함.");
    expect(lines).toContain(" ◦ 예산 1.8억 원을 재배정함.");
    expect(lines).toContain(" ◦ 하반기 완료 목표");
  });
});
