import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  pickDirectory: vi.fn(async () => "C:/Docs/업무자료"),
  launchAnythingQuery: vi.fn(async () => undefined),
  openExternalTarget: vi.fn(async () => undefined),
  copyTextToClipboard: vi.fn(async () => undefined),
}));

import { App } from "./app";
import { STARTUP_DIFF_STORAGE_KEY } from "./store";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

const KNOWLEDGE_SOURCE = {
  id: "source-1",
  label: "기획팀 업무자료",
  root_path: "C:/Docs/업무자료",
  status: "active",
  last_scanned_at: "2026-07-01T00:00:00+09:00",
  created_at: "2026-06-28T00:00:00+09:00",
  updated_at: "2026-07-01T00:00:00+09:00",
};

const CONFIRMED_TAXONOMY = {
  source_id: "source-1",
  work_areas: [
    { name: "예산 관리", slug: "예산-관리", folders: ["01. 예산"], keywords: [] },
    { name: "행사", slug: "행사", folders: ["02. 행사"], keywords: [] },
  ],
  doc_roles_enabled: ["regulation", "manual", "plan", "report", "meeting", "official", "form", "reference"],
  family_policy: "latest_representative",
  confirmed_at: "2026-07-05T00:10:00+09:00",
};

/**
 * W7 P3 화면 테스트 — 무결성 점검(verify) 결과 카드, 드리프트 배지→마법사,
 * v2 앱 시작 diff(감지·배지만, 색인 자동 실행 없음)와 설정 토글.
 */
describe("knowledge incremental sync P3 (verify / drift badge / startup diff)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let lastVerifyBody: Record<string, unknown> | undefined;
  let verifyRequests: number;
  /** null이면 /verify/latest가 404(이력 없음)를 돌려준다. */
  let verifyLatestPayload: Record<string, unknown> | null;
  /** taxonomy GET 응답에 실리는 드리프트(§5.9) — null이면 필드 자체가 없다. */
  let taxonomyDriftPayload: Record<string, unknown> | null;
  let taxonomyQueueCount: number;
  let enrichPendingCount: number | undefined;
  let diffPayload: Record<string, unknown>;

  beforeEach(() => {
    window.localStorage.clear();
    lastVerifyBody = undefined;
    verifyRequests = 0;
    verifyLatestPayload = null;
    taxonomyDriftPayload = null;
    taxonomyQueueCount = 3;
    enrichPendingCount = undefined;
    diffPayload = {
      added: 2,
      modified: 1,
      moved: 0,
      deleted: 0,
      unchanged: 9,
      unstable: 0,
      rehash_estimate: { files: 3, bytes: 1024 },
      exceeds_gate: false,
    };

    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

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

      // ---------------- P3 §6 무결성 점검 ----------------

      if (url.endsWith("/api/knowledge/verify/latest") && method === "GET") {
        // 실서버 계약: 항상 200 + {report: {...}|null} 래핑.
        return jsonResponse({ report: verifyLatestPayload ?? null });
      }

      if (url.endsWith("/api/knowledge/verify") && method === "POST") {
        lastVerifyBody = body;
        verifyRequests += 1;
        return jsonResponse(
          {
            work_job: {
              id: `job-verify-${verifyRequests}`,
              kind: "knowledge.verify",
              title: "지식폴더 무결성 점검",
              // 완료 감시→latest 재조회 흐름을 타이머 없이 검증하기 위해 즉시 종결 상태로 돌려준다.
              status: "succeeded",
              priority: 5,
              resource_key: "knowledge_source:source-1",
              resource_policy: "exclusive",
              progress_percent: 100,
              current_stage: "verify",
              cancel_requested: false,
              created_at: "2026-07-06T00:00:00+09:00",
              queued_at: "2026-07-06T00:00:00+09:00",
              completed_at: "2026-07-06T00:00:05+09:00",
            },
          },
          201,
        );
      }

      // ---------------- 분류체계(드리프트 포함) ----------------

      if (url.includes("/api/knowledge/taxonomy/quality") && method === "GET") {
        return jsonResponse({
          configured: true,
          items: [
            {
              source_id: "source-1",
              conflicts: 0,
              duplicates: 0,
              unclear_latest: 0,
              queue_count: taxonomyQueueCount,
              generated_at: "2026-07-05T00:20:00+09:00",
            },
          ],
        });
      }

      if (url.includes("/api/knowledge/taxonomy/queue") && method === "GET") {
        return jsonResponse({ items: [] });
      }

      if (url.includes("/api/knowledge/taxonomy/interview")) {
        return jsonResponse({ interview: null });
      }

      if (url.includes("/api/knowledge/taxonomy") && method === "GET") {
        return jsonResponse({
          configured: true,
          items: [
            {
              source_id: "source-1",
              taxonomy: CONFIRMED_TAXONOMY,
              schema_path: "/tmp/gongmu-workspace/knowledge-wiki/SCHEMA.md",
              confirmed_at: CONFIRMED_TAXONOMY.confirmed_at,
              // 실서버 계약: drift는 소스별 items 항목 안에 실린다.
              ...(taxonomyDriftPayload ? { drift: taxonomyDriftPayload } : {}),
            },
          ],
          interview: null,
        });
      }

      // ---------------- 지식폴더 공용 ----------------

      if (url.endsWith("/api/knowledge/sources/source-1/diff") && method === "GET") {
        return jsonResponse(diffPayload);
      }

      if (url.endsWith("/api/knowledge/sources") && method === "GET") {
        return jsonResponse({ items: [KNOWLEDGE_SOURCE] });
      }

      if (url.endsWith("/api/knowledge/backend-status")) {
        return jsonResponse({
          engine: "wiki",
          fts5: { ok: true, tokenizer: "trigram" },
          kordoc: { available: true },
          llm_enrichment: {
            configured: true,
            ...(typeof enrichPendingCount === "number" ? { pending_count: enrichPendingCount } : {}),
          },
        });
      }

      if (url.endsWith("/api/knowledge/parser-status")) {
        return jsonResponse({
          kordoc: {
            available: true,
            runner_available: true,
            runner_path: "/tmp/gongmu-workspace/runtime/kordoc_runner.js",
            runner_error: null,
            node_available: true,
            node_command: "node",
            node_version: "v22.0.0",
            node_error: null,
          },
        });
      }

      if (url.endsWith("/api/knowledge/wiki/tree")) {
        return jsonResponse({ topics: [], works: [], sources: [], counts: { docs: 0, topics: 0, works: 0 } });
      }

      const collectionMap: Record<string, unknown> = {
        "/api/schedules": { items: [] },
        "/api/work-sessions": { items: [] },
        "/api/templates": { items: [] },
        "/api/knowledge/candidates": { items: [] },
        "/api/knowledge/pages": { items: [] },
        "/api/knowledge/source-files": { items: [] },
        "/api/knowledge/ingestion-jobs": { items: [] },
        "/api/knowledge/documents": { items: [] },
        "/api/personalization/candidates": { items: [] },
        "/api/approval-tickets": { items: [] },
        "/api/execution-logs": { items: [] },
      };

      const matched = Object.entries(collectionMap).find(([path]) => url.endsWith(path));
      if (matched) {
        return jsonResponse(matched[1]);
      }

      return jsonResponse({ detail: `Unhandled request: ${method} ${url}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function openKnowledgeSettingsTab(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "내 지식폴더" }));
    await user.click(screen.getByRole("tab", { name: "설정" }));
  }

  function diffCallCount() {
    return fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/api/knowledge/sources/source-1/diff"),
    ).length;
  }

  it("runs a quick integrity check and renders healed vs attention check results (P3 §6)", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openKnowledgeSettingsTab(user);
    const verifyGroup = await screen.findByTestId("knowledge-verify-group");
    // 아직 검증 이력이 없으면 결과 카드는 비어 있다.
    expect(screen.queryByTestId("knowledge-verify-result")).not.toBeInTheDocument();

    // 완료 후 latest 재조회에서 받을 결과를 준비한다.
    verifyLatestPayload = {
      ran_at: "2026-07-06T00:00:05+09:00",
      mode: "quick",
      checks: [
        { code: "orphan_artifact", label_ko: "고아 파생 파일", count: 5, healed: 5, action_hint: null },
        {
          code: "missing_extracted",
          label_ko: "본문 원본 실종",
          count: 2,
          healed: 0,
          action_hint: "강제 재색인으로 해당 파일만 다시 처리할 수 있습니다.",
        },
        { code: "fts_drift", label_ko: "검색 인덱스 불일치", count: 0, healed: 0, action_hint: null },
      ],
      disk_reclaimed_bytes: 3 * 1024 * 1024,
    };

    await user.click(within(verifyGroup).getByRole("button", { name: "무결성 점검" }));
    expect(lastVerifyBody).toEqual({ deep: false });

    // work_job이 종결되면 latest를 재조회해 결과 카드를 그린다.
    const result = await screen.findByTestId("knowledge-verify-result");
    expect(result).toHaveTextContent("빠른 점검");
    expect(result).toHaveTextContent("확인 필요 2건");
    expect(result).toHaveTextContent("자동 수리 5건");
    expect(result).toHaveTextContent("회수 공간 3MB");

    // 검사별 분기: 자동 수리(고아 파생 파일) vs 확인 필요 + 원클릭 안내(본문 원본 실종).
    const checkCards = within(result).getAllByTestId("knowledge-verify-check");
    expect(checkCards).toHaveLength(2); // 0건 검사(fts_drift)는 목록에 노출하지 않는다.
    const healedCard = checkCards.find((card) => card.textContent?.includes("고아 파생 파일"));
    expect(healedCard).toHaveTextContent("자동 수리 5건");
    const attentionCard = checkCards.find((card) => card.textContent?.includes("본문 원본 실종"));
    expect(attentionCard).toHaveTextContent("확인 필요 2건");
    expect(attentionCard).toHaveTextContent("강제 재색인으로 해당 파일만 다시 처리할 수 있습니다.");

    // 심층 모드는 접힘 보조 버튼 — deep: true로 전송된다.
    await user.click(within(verifyGroup).getByText("심층 점검 — 전체 파일 재확인"));
    await user.click(within(verifyGroup).getByRole("button", { name: "심층 — 전체 파일 재확인" }));
    await waitFor(() => expect(lastVerifyBody).toEqual({ deep: true }));
    expect(verifyRequests).toBe(2);
  }, 10000);

  it("shows the integrity status card on the dashboard and routes to the verify settings group", async () => {
    enrichPendingCount = 4;
    verifyLatestPayload = {
      ran_at: new Date().toISOString(),
      mode: "quick",
      checks: [
        { code: "orphan_artifact", label_ko: "고아 파생 파일", count: 5, healed: 5, action_hint: null },
        { code: "untagged", label_ko: "무태그 문서", count: 6, healed: 0, action_hint: "분류 적용으로 태깅할 수 있습니다." },
      ],
      disk_reclaimed_bytes: 0,
    };
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "내 지식폴더" }));

    // 정합성 카드: 마지막 검증 시점 + 확인 필요 건수.
    const verifyCard = await screen.findByTestId("knowledge-status-verify");
    await waitFor(() => expect(verifyCard).toHaveTextContent("확인 필요 6건"));
    expect(verifyCard).toHaveTextContent("마지막 검증 오늘");
    expect(verifyCard).toHaveTextContent("자동 수리 5건");

    // 위키 구성 카드: 분류 대기 + 무태그 보고.
    const taxonomyCard = screen.getByTestId("knowledge-status-taxonomy");
    await waitFor(() =>
      expect(within(taxonomyCard).getByTestId("knowledge-status-taxonomy-queue")).toHaveTextContent(
        "분류 대기 3건 · 무태그 6건",
      ),
    );

    // LLM 요약 보강 카드: 요약 대기 N건(서버 필드가 있을 때만).
    await waitFor(() =>
      expect(screen.getByTestId("knowledge-status-enrich-pending")).toHaveTextContent("요약 대기 4건"),
    );

    // 색인 카드: diff 미실행 상태에서도 "미반영 변경" 줄이 안내와 함께 보인다.
    expect(screen.getByTestId("knowledge-status-indexing-diff")).toHaveTextContent("미반영 변경 미확인");

    // [무결성 점검] → 설정 탭의 무결성 점검 그룹으로 이동.
    await user.click(within(verifyCard).getByRole("button", { name: "무결성 점검" }));
    expect(screen.getByRole("tab", { name: "설정" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("knowledge-verify-group")).toBeInTheDocument();
    // 설정 탭에서도 최근 결과 카드가 함께 보인다.
    expect(await screen.findByTestId("knowledge-verify-result")).toBeInTheDocument();
  }, 10000);

  it("shows the taxonomy drift badge and reopens the wizard from it (§5.9)", async () => {
    taxonomyDriftPayload = {
      new_folders: [
        { folder: "03. 신규사업", file_count: 8 },
        { folder: "04. 협력", file_count: 6 },
      ],
      vanished_folders: [],
      low_ratio: 0.35,
      detected_at: "2026-07-06T00:00:00+09:00",
    };
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "내 지식폴더" }));

    // 대시보드 위키 구성 카드의 제안 배지 — 자동 재구성이 아니라 배지 클릭 시 마법사 재진입.
    const badge = await screen.findByTestId("knowledge-drift-badge");
    expect(badge).toHaveTextContent("분류체계 재정비 제안 — 새 업무 폴더 2개");
    // 마법사는 등록된 지식폴더가 있어야 열린다 — 소스 로딩이 끝날 때까지 기다린다.
    await waitFor(() => expect(badge).toBeEnabled());
    await user.click(badge);

    expect(screen.getByRole("tab", { name: "설정" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("taxonomy-wizard")).toBeInTheDocument();

    // 마법사를 닫으면 설정 탭 위키 구성 그룹에도 같은 배지가 붙어 있다.
    await user.click(within(screen.getByTestId("taxonomy-wizard")).getByRole("button", { name: "닫기" }));
    expect(await screen.findByTestId("knowledge-drift-badge-settings")).toHaveTextContent(
      "분류체계 재정비 제안 — 새 업무 폴더 2개",
    );
  }, 10000);

  it("runs the startup diff once after the 10s idle delay and feeds the dashboard badge (§9 v2)", async () => {
    vi.useFakeTimers();
    render(<App />);

    // 유휴 대기 전에는 diff를 호출하지 않는다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(diffCallCount()).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(diffCallCount()).toBe(1);

    // 추가 시간이 지나도 재실행하지 않는다(세션당 1회).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(diffCallCount()).toBe(1);

    // 감지 결과는 대시보드 색인 카드의 "미반영 변경 N건"으로만 반영된다(색인 자동 실행 없음).
    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "내 지식폴더" }));
    const diffLine = await screen.findByTestId("knowledge-status-indexing-diff");
    expect(diffLine).toHaveTextContent("미반영 변경 3건");
    const ingestCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/api/knowledge/ingest"));
    expect(ingestCalls).toHaveLength(0);
  }, 15000);

  it("skips the startup diff entirely when the toggle is off", async () => {
    window.localStorage.setItem(STARTUP_DIFF_STORAGE_KEY, "off");
    vi.useFakeTimers();
    render(<App />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(diffCallCount()).toBe(0);
  });

  it("persists the startup diff preference from the settings screen toggle", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /환경설정/ }));
    const toggle = await screen.findByTestId("settings-startup-diff-toggle");
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(window.localStorage.getItem(STARTUP_DIFF_STORAGE_KEY)).toBe("off");

    await user.click(toggle);
    expect(window.localStorage.getItem(STARTUP_DIFF_STORAGE_KEY)).toBe("on");
  });
});
