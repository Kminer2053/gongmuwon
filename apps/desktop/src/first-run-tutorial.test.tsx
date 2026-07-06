import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}));

import { App } from "./app";
import { TUTORIAL_DONE_STORAGE_KEY } from "./store";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

function stubFetch(options: { llmConfigured?: boolean; knowledgeSources?: Array<Record<string, unknown>> } = {}) {
  const llmConfigured = options.llmConfigured ?? true;
  const knowledgeSources = options.knowledgeSources ?? [];

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
            llm_mode: llmConfigured ? "local_first" : "external_model",
            llm_provider: llmConfigured ? "ollama" : "openai",
            llm_model: llmConfigured ? "qwen3.6:27b" : "gpt-4.1-mini",
            llm_api_key: null,
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

      if (url.endsWith("/api/knowledge/sources")) {
        return jsonResponse({ items: knowledgeSources });
      }

      const collectionMap: Record<string, unknown> = {
        "/api/schedules": { items: [] },
        "/api/templates": { items: [] },
        "/api/work-sessions": { items: [] },
        "/api/knowledge/candidates": { items: [] },
        "/api/knowledge/pages": { items: [] },
        "/api/knowledge/source-files": { items: [] },
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
}

type TutorialTestWindow = Window & { __gongmuTutorialAutoOpen?: boolean };

describe("first-run tutorial (W6)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    // 테스트에서는 opt-in 시에만 자동 실행되므로, 최초 실행 시나리오는 명시적으로 켠다.
    (window as TutorialTestWindow).__gongmuTutorialAutoOpen = true;
  });

  afterEach(() => {
    delete (window as TutorialTestWindow).__gongmuTutorialAutoOpen;
  });

  it("shows the tutorial once on first run when the done flag is absent", async () => {
    stubFetch();
    render(<App />);

    const dialog = await screen.findByTestId("first-run-tutorial");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      within(dialog).getByRole("heading", { name: "'공무원' 워크스페이스에 오신 것을 환영합니다" }),
    ).toBeInTheDocument();
    // 6개 메뉴 요약이 보인다.
    expect(within(dialog).getByText("업무대화")).toBeInTheDocument();
    expect(within(dialog).getByText("LLM 위키로 지식관리")).toBeInTheDocument();
    expect(within(dialog).getByText("로컬 우선 설정")).toBeInTheDocument();
  });

  it("does not auto-open when the done flag is already stored", async () => {
    window.localStorage.setItem(TUTORIAL_DONE_STORAGE_KEY, "2026-07-05T09:00:00+09:00");
    stubFetch();
    render(<App />);

    await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    expect(screen.queryByTestId("first-run-tutorial")).not.toBeInTheDocument();
  });

  it("persists the done flag when the user skips", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByTestId("first-run-tutorial");
    await user.click(screen.getByTestId("tutorial-skip"));

    await waitFor(() => expect(screen.queryByTestId("first-run-tutorial")).not.toBeInTheDocument());
    expect(window.localStorage.getItem(TUTORIAL_DONE_STORAGE_KEY)).toBeTruthy();
  });

  it("walks through all four steps and stores the flag on finish", async () => {
    stubFetch({ llmConfigured: true, knowledgeSources: [{ id: "src-1", label: "2026_AI혁신처", root_path: "C:/docs" }] });
    const user = userEvent.setup();
    render(<App />);

    const dialog = await screen.findByTestId("first-run-tutorial");
    await user.click(within(dialog).getByTestId("tutorial-next"));

    // ② LLM 상태: 설정 완료로 표시되고 이동 버튼은 없다.
    expect(within(dialog).getByTestId("tutorial-llm-status")).toHaveTextContent("설정 완료");
    expect(within(dialog).queryByTestId("tutorial-goto-settings")).not.toBeInTheDocument();
    await user.click(within(dialog).getByTestId("tutorial-next"));

    // ③ 지식폴더 상태: 등록 폴더가 표시된다.
    await waitFor(() =>
      expect(within(dialog).getByTestId("tutorial-knowledge-status")).toHaveTextContent("2026_AI혁신처"),
    );
    await user.click(within(dialog).getByTestId("tutorial-next"));

    // ④ 마무리: 이용팁 인용이 보이고 [시작하기]로 플래그가 저장된다.
    expect(within(dialog).getByTestId("tutorial-tip-quote").textContent?.length).toBeGreaterThan(0);
    await user.click(within(dialog).getByTestId("tutorial-finish"));

    await waitFor(() => expect(screen.queryByTestId("first-run-tutorial")).not.toBeInTheDocument());
    expect(window.localStorage.getItem(TUTORIAL_DONE_STORAGE_KEY)).toBeTruthy();
  });

  it("minimizes while navigating to settings from the LLM step and resumes from the chip", async () => {
    stubFetch({ llmConfigured: false });
    const user = userEvent.setup();
    render(<App />);

    const dialog = await screen.findByTestId("first-run-tutorial");
    await user.click(within(dialog).getByTestId("tutorial-next"));
    expect(within(dialog).getByTestId("tutorial-llm-status")).toHaveTextContent("설정 필요");

    // API 키 대행 금지 안내 문구가 보인다.
    expect(dialog).toHaveTextContent("API 키는 보안을 위해 사용자가 직접 입력");

    await user.click(within(dialog).getByTestId("tutorial-goto-settings"));

    // 환경설정 화면으로 이동하고, 튜토리얼은 최소화 칩으로 대기한다.
    expect(await screen.findByTestId("settings-tutorial-replay")).toBeInTheDocument();
    expect(screen.queryByTestId("first-run-tutorial")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("tutorial-minimized-chip"));
    const restored = await screen.findByTestId("first-run-tutorial");
    // 이동으로 LLM 스텝은 완료 처리되어 다음 단계(내 지식폴더)로 복귀한다.
    expect(within(restored).getByRole("heading", { name: "내 지식폴더를 준비하세요" })).toBeInTheDocument();
  });

  it("re-opens the tutorial from the settings entry point even after completion", async () => {
    delete (window as TutorialTestWindow).__gongmuTutorialAutoOpen;
    window.localStorage.setItem(TUTORIAL_DONE_STORAGE_KEY, "2026-07-05T09:00:00+09:00");
    stubFetch();
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "주요 작업 메뉴" });
    fireEvent.click(within(navigation).getByRole("button", { name: "환경설정" }));

    await user.click(await screen.findByTestId("settings-tutorial-replay"));

    const dialog = await screen.findByTestId("first-run-tutorial");
    expect(
      within(dialog).getByRole("heading", { name: "'공무원' 워크스페이스에 오신 것을 환영합니다" }),
    ).toBeInTheDocument();
  });
});
