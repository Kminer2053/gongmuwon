import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { App } from "./app";

const jsonResponse = (payload: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return jsonResponse({
          status: "ok",
          workspace_root: "/tmp/gongmu-workspace",
          database: "/tmp/gongmu-workspace/db/gongmu.db",
        });
      }

      if (url.includes("/api/schedules")) {
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

      if (url.includes("/api/work-sessions")) {
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

      if (url.includes("/api/reference-sets")) {
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

      if (url.includes("/api/templates")) {
        return jsonResponse({
          items: [
            { key: "report", label: "보고서형" },
            { key: "meeting", label: "회의자료형" },
            { key: "review", label: "검토메모형" },
          ],
        });
      }

      if (url.includes("/api/knowledge/candidates")) {
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

      if (url.includes("/api/knowledge/pages")) {
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

      if (url.includes("/api/approval-tickets")) {
        return jsonResponse({
          items: [
            {
              id: "approval-1",
              action: "anything.launch",
              status: "pending",
              target_type: "external_launch",
              requested_at: "2026-04-20T00:00:00+09:00",
            },
          ],
        });
      }

      if (url.includes("/api/file-organizer/proposals")) {
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

      if (url.includes("/api/execution-logs")) {
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

  it("switches to the knowledge folder view and shows pending candidates", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "주요 작업 메뉴" });

    await user.click(within(navigation).getByText("내 지식폴더"));

    expect(await screen.findByText("2026 예산편성 메모")).toBeInTheDocument();
    expect(screen.getByText("반영 승인")).toBeInTheDocument();
  });
});
