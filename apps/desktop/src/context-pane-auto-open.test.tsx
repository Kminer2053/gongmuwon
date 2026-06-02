import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeState = {
  status: {
    available: true,
    mode: "tauri" as const,
    sidecar_url: "http://127.0.0.1:8765",
    anything_available: false,
    anything_mode: "install_page_fallback" as const,
    anything_path: null,
    anything_autopaste_enabled: false,
    running: true,
    managed: true,
    auto_restart_recommended: false,
    log_path: "/tmp/gongmu-workspace/logs/sidecar-runtime.log",
    detail: "managed sidecar running",
  },
};

vi.mock("./runtime", () => ({
  loadDesktopRuntimeStatus: vi.fn(async () => runtimeState.status),
  startDesktopSidecar: vi.fn(async () => runtimeState.status),
  stopDesktopSidecar: vi.fn(async () => runtimeState.status),
  restartDesktopSidecar: vi.fn(async () => runtimeState.status),
  setDesktopZoom: vi.fn(async () => undefined),
  pickDirectory: vi.fn(async () => null),
  launchAnythingQuery: vi.fn(async () => undefined),
  openExternalTarget: vi.fn(async () => undefined),
  copyTextToClipboard: vi.fn(async () => undefined),
}));

import { App } from "./app";
import { openExternalTarget } from "./runtime";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

const KOREAN = {
  openContextPane: "오른쪽 정보 패널 열기",
  collapseContextPane: "오른쪽 정보 패널 닫기",
  navigation: "주요 작업 메뉴",
  scheduleMenu: /^일정/,
  searchMenu: /^파일찾기/,
  fileOrgMenu: /^파일정리/,
  selectedReferenceSet: "선택 ReferenceSet",
  scheduleTitle: "일정 제목",
  scheduleCreate: "일정 등록",
  referenceSetSummary: "반복 사용할 자료 묶음 만들기",
  referenceSetTitle: "작업자료 묶음 제목",
  referenceSetType: "유형",
  referenceSetLabel: "라벨",
  referenceSetValue: "값",
  referenceSetCreate: "작업자료 묶음 등록",
  createdReferenceSetTitle: "예산 검토 묶음",
  fileApplyCommit: "승인 후 적용",
  logsTitle: "작업 이력 요약",
  jobsTitle: "작업 진행",
};

describe("Context pane auto open", () => {
  beforeEach(() => {
    let approvalTickets = [
      {
        id: "ticket-1",
        action: "file_org.apply",
        target_type: "proposal",
        target_id: "proposal-1",
        status: "approved",
        requested_at: "2026-04-20T00:00:00+09:00",
      },
    ];

    let proposals = [
      {
        id: "proposal-1",
        target_path: "C:/docs/source.md",
        proposal_type: "knowledge_candidate",
        proposed_destination: "C:/docs/archive/source.md",
        reason: "move into archive",
        status: "pending_approval",
        created_at: "2026-04-20T00:00:00+09:00",
      },
    ];

    let schedules = [
      {
        id: "schedule-1",
        title: "기존 일정",
        starts_at: "2026-04-20T09:00:00+09:00",
        ends_at: "2026-04-20T10:00:00+09:00",
        view: "week",
        created_at: "2026-04-20T00:00:00+09:00",
      },
    ];

    let referenceSets: Array<{
      id: string;
      title: string;
      session_id: string | null;
      created_at: string;
      items: Array<{ id: string; kind: string; label: string; value: string }>;
    }> = [];

    const logs: Array<{
      id: string;
      feature: string;
      action: string;
      status: string;
      created_at: string;
      inputs: Record<string, unknown>;
      outputs: Record<string, unknown>;
      approval_ticket_id: string | null;
    }> = [
      {
        id: "log-1",
        feature: "schedule",
        action: "schedule.created",
        status: "success",
        created_at: "2026-04-20T00:00:00+09:00",
        inputs: {},
        outputs: {},
        approval_ticket_id: null,
      },
    ];

    const workJobs: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
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

        if (url.endsWith("/api/schedules")) {
          return jsonResponse({ items: schedules });
        }

        if (url.endsWith("/api/reference-sets") && method === "POST") {
          const created = {
            id: `reference-${referenceSets.length + 1}`,
            title: body.title,
            session_id: body.session_id ?? null,
            created_at: "2026-04-25T09:05:00+09:00",
            items: [
              {
                id: "reference-item-1",
                kind: body.items?.[0]?.kind ?? "file",
                label: body.items?.[0]?.label ?? "budget",
                value: body.items?.[0]?.value ?? "C:/docs/budget.xlsx",
              },
            ],
          };
          referenceSets = [...referenceSets, created];
          return jsonResponse(created, 201);
        }

        if (url.endsWith("/api/file-organizer/proposals/proposal-1/apply/commit") && method === "POST") {
          const workJob = {
            id: "job-fileorg-apply",
            kind: "fileorg.apply",
            title: "source.md 파일정리 적용",
            status: "succeeded",
            priority: 50,
            resource_key: "file_path:C:/docs/source.md",
            resource_policy: "exclusive",
            progress_percent: 100,
            current_stage: "파일정리 적용 완료",
            cancel_requested: false,
            input: { proposal_id: "proposal-1" },
            result: { destination_path: "C:/docs/archive/source.md" },
            error_message: null,
            created_at: "2026-04-25T09:00:00+09:00",
            queued_at: "2026-04-25T09:00:00+09:00",
            started_at: "2026-04-25T09:00:00+09:00",
            completed_at: "2026-04-25T09:00:01+09:00",
          };
          workJobs.unshift(workJob);
          logs.unshift({
            id: `log-${logs.length + 1}`,
            feature: "file_org",
            action: "file_org.apply.committed",
            status: "success",
            created_at: "2026-04-25T09:00:00+09:00",
            inputs: { proposal_id: "proposal-1" },
            outputs: { destination_path: "C:/docs/archive/source.md" },
            approval_ticket_id: "ticket-1",
          });
          proposals = proposals.map((proposal) =>
            proposal.id === "proposal-1" ? { ...proposal, status: "applied" } : proposal,
          );
          return jsonResponse({
            operation: {
              id: "operation-1",
              proposal_id: "proposal-1",
              source_path: "C:/docs/source.md",
              destination_path: "C:/docs/archive/source.md",
              action: "copy",
              approval_ticket_id: "ticket-1",
              created_at: "2026-04-25T09:00:00+09:00",
            },
            work_job: workJob,
          });
        }

        if (url.includes("/api/jobs/job-fileorg-apply/events")) {
          return jsonResponse({
            items: [
              {
                id: "event-1",
                job_id: "job-fileorg-apply",
                seq: 1,
                level: "info",
                event_type: "job.created",
                message: "작업이 대기열에 등록되었습니다.",
                payload: {},
                created_at: "2026-04-25T09:00:00+09:00",
              },
              {
                id: "event-2",
                job_id: "job-fileorg-apply",
                seq: 2,
                level: "info",
                event_type: "job.succeeded",
                message: "파일정리 적용 완료",
                payload: {},
                created_at: "2026-04-25T09:00:01+09:00",
              },
            ],
          });
        }

        if (url.includes("/api/jobs?")) {
          return jsonResponse({ items: workJobs });
        }

        const collectionMap: Record<string, unknown> = {
          "/api/work-sessions": { items: [] },
          "/api/reference-sets": { items: referenceSets },
          "/api/templates": { items: [] },
          "/api/knowledge/candidates": { items: [] },
          "/api/knowledge/pages": { items: [] },
          "/api/approval-tickets": { items: approvalTickets },
          "/api/integrations/anything/launches": { items: [] },
          "/api/file-organizer/proposals": { items: proposals },
          "/api/execution-logs": { items: logs },
          "/api/jobs": { items: workJobs },
          "/api/tools": { items: [] },
        };

        const matched = Object.entries(collectionMap).find(([path]) => url.endsWith(path));
        if (matched) {
          return jsonResponse(matched[1]);
        }

        return jsonResponse({ detail: `Unhandled request: ${method} ${url}` }, 404);
      }),
    );
  });

  it("keeps schedule creation usable even when the right pane stays collapsed", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: KOREAN.collapseContextPane });
    await user.click(screen.getByRole("button", { name: KOREAN.collapseContextPane }));
    expect(await screen.findByRole("button", { name: KOREAN.openContextPane })).toBeInTheDocument();

    const navigation = screen.getByRole("navigation", { name: KOREAN.navigation });
    await user.click(within(navigation).getByRole("button", { name: KOREAN.scheduleMenu }));

    expect(screen.getByLabelText(KOREAN.scheduleTitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: KOREAN.scheduleCreate })).toBeInTheDocument();
  });

  it("keeps built-in file search free of legacy reference set creation", async () => {
    {
      const user = userEvent.setup();
      render(<App />);
      const navigation = await screen.findByRole("navigation", { name: KOREAN.navigation });
      await user.click(within(navigation).getByRole("button", { name: KOREAN.searchMenu }));
      expect(screen.queryByText(KOREAN.referenceSetSummary)).not.toBeInTheDocument();
      expect(screen.queryByText(/Reference Set/i)).not.toBeInTheDocument();
    }
    return;

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: KOREAN.collapseContextPane });
    await user.click(screen.getByRole("button", { name: KOREAN.collapseContextPane }));
    expect(await screen.findByRole("button", { name: KOREAN.openContextPane })).toBeInTheDocument();

    const navigation = screen.getByRole("navigation", { name: KOREAN.navigation });
    await user.click(within(navigation).getByRole("button", { name: KOREAN.searchMenu }));

    await user.click(screen.getByText(KOREAN.referenceSetSummary));
    await user.type(screen.getByLabelText(KOREAN.referenceSetTitle), KOREAN.createdReferenceSetTitle);
    await user.clear(screen.getByLabelText(KOREAN.referenceSetType));
    await user.type(screen.getByLabelText(KOREAN.referenceSetType), "file");
    await user.type(screen.getByLabelText(KOREAN.referenceSetLabel), "예산메모");
    await user.type(screen.getByLabelText(KOREAN.referenceSetValue), "C:/docs/budget.xlsx");
    await user.click(screen.getByRole("button", { name: KOREAN.referenceSetCreate }));

    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: KOREAN.collapseContextPane })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: KOREAN.openContextPane })).not.toBeInTheDocument();
        expect(screen.getByText(KOREAN.selectedReferenceSet)).toBeInTheDocument();
        expect(screen.getByText(KOREAN.createdReferenceSetTitle)).toBeInTheDocument();
      },
      { timeout: 10000 },
    );
  }, 15000);

  it("reopens the work jobs section after a file organizer apply commit", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText(KOREAN.jobsTitle);
    await user.click(screen.getByRole("button", { name: KOREAN.jobsTitle }));
    expect(screen.queryByText(KOREAN.jobsTitle)).not.toBeInTheDocument();

    const navigation = screen.getByRole("navigation", { name: KOREAN.navigation });
    await user.click(within(navigation).getByRole("button", { name: KOREAN.fileOrgMenu }));
    await user.click(screen.getByRole("button", { name: KOREAN.fileApplyCommit }));

    expect(await screen.findByText(KOREAN.jobsTitle)).toBeInTheDocument();
    expect(await screen.findByText("source.md 파일정리 적용")).toBeInTheDocument();
    expect(screen.getByText("파일정리 적용 완료")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "대상 열기" }));
    expect(vi.mocked(openExternalTarget)).toHaveBeenCalledWith("C:/docs/archive/source.md");
    await user.click(screen.getByRole("button", { name: "작업 로그 보기" }));
    expect(await screen.findByLabelText("source.md 파일정리 적용 작업 로그")).toBeInTheDocument();
    expect(screen.queryByText(/쨌/)).not.toBeInTheDocument();
  });
});
