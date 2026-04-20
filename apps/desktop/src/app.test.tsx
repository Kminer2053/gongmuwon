import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { App } from "./app";

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

beforeEach(() => {
  let approvalTickets: Array<{
    id: string;
    action: string;
    status: "pending" | "approved" | "rejected";
    target_type: string;
    requested_at: string;
    decided_at?: string | null;
    decision_note?: string | null;
    target_id?: string;
  }> = [
    {
      id: "approval-1",
      action: "anything.launch",
      status: "pending",
      target_type: "external_launch",
      requested_at: "2026-04-20T00:00:00+09:00",
    },
  ];

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
            llm_mode: "internal_server",
            anything_launch_mode: "external_link_only",
            default_template_key: "meeting",
            internal_api_base_url: "http://127.0.0.1:9000",
          },
          paths: {
            workspace_root: "/tmp/gongmu-workspace",
            database: "/tmp/gongmu-workspace/db/gongmu.db",
            knowledge_root: "/tmp/gongmu-workspace/knowledge",
            documents_root: "/tmp/gongmu-workspace/documents",
          },
        });
      }

      if (url.endsWith("/api/documents/content-bases") && method === "POST") {
        return jsonResponse(
          {
            id: "content-base-1",
            title: body?.title ?? "주간 보고 초안",
            purpose: body?.purpose ?? "보고서형",
            template_key: body?.template_key ?? "report",
            artifact: { path: "/tmp/gongmu-workspace/documents/content-bases/content-base-1.md" },
            preview: { path: "/tmp/gongmu-workspace/documents/drafts/content-base-1.html" },
            content: "# 주간 보고 초안\n\n## 개요\n- 개요 내용을 여기에 정리합니다.\n",
          },
          201,
        );
      }

      if (url.endsWith("/api/documents/finalize") && method === "POST") {
        const ticketId = "approval-final-1";
        const ticket = {
          id: ticketId,
          action: "documents.finalize",
          status: "pending" as const,
          target_type: "document_output",
          target_id: body?.content_base_id ?? "content-base-1",
          requested_at: "2026-04-20T00:00:00+09:00",
          decided_at: null,
          decision_note: null,
        };
        approvalTickets = [...approvalTickets, ticket];
        return jsonResponse(
          {
            approval_ticket: ticket,
            final_document_output: {
              id: "final-output-1",
              content_base_id: body?.content_base_id ?? "content-base-1",
              approval_ticket_id: ticketId,
              output_name: body?.output_name ?? "주간보고-2026-04-20",
              artifact_path: null,
              status: "pending",
              created_at: "2026-04-20T00:00:00+09:00",
              applied_at: null,
            },
          },
          202,
        );
      }

      const finalizeApplyMatch = url.match(/\/api\/documents\/finalize\/([^/]+)\/apply$/);
      if (finalizeApplyMatch && method === "POST") {
        const ticketId = finalizeApplyMatch[1];
        const ticket = approvalTickets.find((item) => item.id === ticketId);
        if (!ticket || ticket.status !== "approved") {
          return jsonResponse({ detail: "approval ticket must be approved" }, 409);
        }

        return jsonResponse(
          {
            approval_ticket: ticket,
            final_document_output: {
              id: "final-output-1",
              content_base_id: "content-base-1",
              approval_ticket_id: ticketId,
              output_name: "주간보고-2026-04-20",
              artifact_path:
                "/tmp/gongmu-workspace/documents/outputs/주간보고-2026-04-20.md",
              status: "applied",
              created_at: "2026-04-20T00:00:00+09:00",
              applied_at: "2026-04-20T00:00:00+09:00",
            },
            artifact: { path: "/tmp/gongmu-workspace/documents/outputs/주간보고-2026-04-20.md" },
          },
          201,
        );
      }

      const approvalDecisionMatch = url.match(/\/api\/approval-tickets\/([^/]+)\/decision$/);
      if (approvalDecisionMatch && method === "POST") {
        const ticketId = approvalDecisionMatch[1];
        approvalTickets = approvalTickets.map((ticket) =>
          ticket.id === ticketId
            ? {
                ...ticket,
                status: body?.status ?? "approved",
                decision_note: body?.decision_note ?? null,
                decided_at: "2026-04-20T00:00:00+09:00",
              }
            : ticket,
        );
        const updated = approvalTickets.find((ticket) => ticket.id === ticketId);
        return jsonResponse(updated ?? null);
      }

      if (url.endsWith("/api/schedules")) {
        return jsonResponse({
          items: [
            {
              id: "schedule-1",
              title: "주간 보고",
              starts_at: "2026-04-20T09:00:00+09:00",
              ends_at: "2026-04-20T10:00:00+09:00",
              view: "week",
              created_at: "2026-04-20T00:00:00+09:00",
            },
          ],
        });
      }

      if (url.endsWith("/api/work-sessions")) {
        return jsonResponse({
          items: [
            {
              id: "session-1",
              title: "주간 보고 준비",
              schedule_id: "schedule-1",
              status: "open",
              created_at: "2026-04-20T00:00:00+09:00",
            },
          ],
        });
      }

      if (url.endsWith("/api/reference-sets")) {
        return jsonResponse({
          items: [
            {
              id: "ref-1",
              title: "보고 참고자료",
              session_id: "session-1",
              created_at: "2026-04-20T00:00:00+09:00",
              items: [{ id: "item-1", kind: "file", label: "예산메모", value: "memo.md" }],
            },
          ],
        });
      }

      if (url.endsWith("/api/templates")) {
        return jsonResponse({
          items: [
            { key: "report", label: "보고서형" },
            { key: "meeting", label: "회의자료형" },
            { key: "review", label: "검토메모형" },
          ],
        });
      }

      if (url.endsWith("/api/knowledge/candidates/from-note")) {
        return jsonResponse({
          id: "candidate-1",
          title: body?.title ?? "2026 예산편성 메모",
          body: body?.body ?? "예산편성과 관련된 핵심 일정과 검토 포인트를 정리한 메모",
          candidate_type: body?.candidate_type ?? "topic",
          status: "pending",
          created_at: "2026-04-20T00:00:00+09:00",
        });
      }

      if (url.endsWith("/api/knowledge/candidates")) {
        return jsonResponse({
          items: [
            {
              id: "candidate-1",
              title: "2026 예산편성 메모",
              candidate_type: "topic",
              status: "pending",
              created_at: "2026-04-20T00:00:00+09:00",
            },
          ],
        });
      }

      if (url.endsWith("/api/knowledge/pages")) {
        return jsonResponse({
          items: [
            {
              id: "page-1",
              title: "예산편성",
              page_type: "topic",
              path: "/tmp/knowledge/예산편성.md",
              created_at: "2026-04-20T00:00:00+09:00",
            },
          ],
        });
      }

      if (url.includes("/api/knowledge/search")) {
        return jsonResponse({
          query: body?.query ?? "예산",
          vector_hits: [
            {
              page: {
                id: "page-1",
                title: "예산편성",
                page_type: "topic",
                path: "/tmp/knowledge/예산편성.md",
                created_at: "2026-04-20T00:00:00+09:00",
              },
              score: 0.12,
              keyword_overlap: 1,
            },
          ],
          graph_neighbors: ["예산", "일정"],
        });
      }

      if (url.endsWith("/api/knowledge/graph")) {
        return jsonResponse({
          node_count: 2,
          edge_count: 1,
          artifacts: {
            graph_json_path: "/tmp/gongmu-workspace/knowledge/graph/graph.json",
            graph_html_path: "/tmp/gongmu-workspace/knowledge/graph/graph.html",
            graph_report_path: "/tmp/gongmu-workspace/knowledge/graph/GRAPH_REPORT.md",
          },
          nodes: [
            {
              id: "page-1",
              label: "예산편성",
              node_type: "topic",
              neighbors: ["예산"],
            },
            {
              id: "concept:예산",
              label: "예산",
              node_type: "concept",
              neighbors: ["예산편성"],
            },
          ],
        });
      }

      if (url.endsWith("/api/approval-tickets")) {
        return jsonResponse({
          items: approvalTickets,
        });
      }

      if (url.endsWith("/api/file-organizer/proposals")) {
        return jsonResponse({
          items: [
            {
              id: "proposal-1",
              target_path: "/tmp/incoming/회의메모.md",
              proposal_type: "knowledge_candidate",
              proposed_destination: "/tmp/knowledge/raw/회의메모.md",
              status: "proposed",
              reason: "최근 변경분을 지식 반영 후보로 제안합니다.",
              created_at: "2026-04-20T00:00:00+09:00",
            },
          ],
        });
      }

      if (url.endsWith("/api/execution-logs")) {
        return jsonResponse({
          items: [
            {
              id: "log-1",
              feature: "documents",
              action: "documents.content_base.created",
              status: "success",
              created_at: "2026-04-20T00:00:00+09:00",
            },
          ],
        });
      }

      return jsonResponse({ items: [] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App shell", () => {
  it("renders the primary workspace navigation and workspace health", async () => {
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });

    expect(within(navigation).getByText("일정")).toBeInTheDocument();
    expect(within(navigation).getByText("업무대화")).toBeInTheDocument();
    expect(within(navigation).getByText("로컬파일/정보검색")).toBeInTheDocument();
    expect(within(navigation).getByText("문서작성")).toBeInTheDocument();
    expect(within(navigation).getByText("내 지식폴더")).toBeInTheDocument();
    expect(within(navigation).getByText("실행기록")).toBeInTheDocument();

    expect(await screen.findByText("사이드카 연결 정상")).toBeInTheDocument();
    expect(screen.getAllByText("주간 보고").length).toBeGreaterThan(0);
    expect(screen.getByText("업무대화 열기")).toBeInTheDocument();
  });

  it("shows live settings and uses the runtime default template fallback", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });

    await user.click(within(navigation).getByText("기타 환경설정"));

    expect(await screen.findByText("internal_server")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:9000")).toBeInTheDocument();

    await user.click(within(navigation).getByText("문서작성"));

    expect(screen.getByRole("combobox", { name: "템플릿" })).toHaveValue("meeting");
  });

  it("switches to the knowledge folder view and shows pending candidates", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });

    await user.click(within(navigation).getByText("내 지식폴더"));

    expect(await screen.findByText("2026 예산편성 메모")).toBeInTheDocument();
    expect(screen.getByText("반영 승인")).toBeInTheDocument();
  });

  it("runs knowledge search and shows graph inspector details", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });

    await user.click(within(navigation).getByText("내 지식폴더"));

    expect(await screen.findByText("graph nodes: 2")).toBeInTheDocument();
    expect(screen.getByText("graph edges: 1")).toBeInTheDocument();

    await user.type(screen.getByLabelText("지식 검색"), "예산");
    await user.click(screen.getByRole("button", { name: "검색 실행" }));

    await waitFor(() => expect(screen.getAllByText("예산편성").length).toBeGreaterThan(0));
    expect(screen.getByText("예산, 일정")).toBeInTheDocument();
    expect(screen.getByText("knowledge/graph/graph.json")).toBeInTheDocument();
  });

  it("requests final document save and applies it after approval", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });
    const fetchMock = vi.mocked(global.fetch);

    await user.click(within(navigation).getByText("문서작성"));

    await user.type(screen.getByLabelText("문서 제목"), "주간 보고 초안");
    await user.click(screen.getByRole("button", { name: "ContentBase.md 생성" }));
    const outputNameInput = await screen.findByLabelText("출력 이름");
    await user.clear(outputNameInput);
    await user.type(outputNameInput, "주간보고-2026-04-20");

    await user.click(await screen.findByRole("button", { name: "최종 저장 요청" }));

    const finalizeCard = screen.getByText("documents.finalize").closest("article");
    expect(finalizeCard).not.toBeNull();
    await user.click(within(finalizeCard as HTMLElement).getByRole("button", { name: "승인" }));

    expect(await screen.findByText("승인되어 바로 적용할 수 있습니다.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "최종 저장 적용" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "최종 저장 적용" }));

    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/api/documents/finalize/approval-final-1/apply"),
      ),
    ).toBe(true);
    expect(await screen.findByText("documents/outputs/주간보고-2026-04-20.md")).toBeInTheDocument();
  });
});
