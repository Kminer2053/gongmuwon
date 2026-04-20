import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  CalendarDays,
  BookMarked,
  BotMessageSquare,
  FileSearch,
  FileText,
  FolderTree,
  Hammer,
  History,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  approveKnowledgeCandidate,
  commitFileProposalApply,
  createContentBase,
  createFileProposals,
  createKnowledgeCandidate,
  createReferenceSet,
  createSchedule,
  createWorkSession,
  decideApproval,
  loadKnowledgeGraph,
  loadTools,
  loadWorkspaceSnapshot,
  requestFileProposalApply,
  requestAnythingLaunch,
  rollbackFileOperation,
  applyDocumentFinalize,
  requestDocumentFinalize,
  searchKnowledge,
  type ApprovalTicketItem,
  type ContentBaseResult,
  type FileProposalItem,
  type FinalDocumentRequestResult,
  type KnowledgeCandidateItem,
  type KnowledgeGraphSummary,
  type KnowledgePageItem,
  type KnowledgeSearchResult,
  type ReferenceSetItem,
  type ScheduleItem,
  type TemplateItem,
  type ToolManifestItem,
  type WorkspaceSnapshot,
  type WorkSessionItem,
} from "./api";
import {
  loadDesktopRuntimeStatus,
  restartDesktopSidecar,
  startDesktopSidecar,
  stopDesktopSidecar,
  type DesktopRuntimeStatus,
} from "./runtime";

type MenuKey =
  | "schedule"
  | "chat"
  | "search"
  | "documents"
  | "knowledge"
  | "fileorg"
  | "tools"
  | "logs"
  | "settings";

type MenuItem = {
  key: MenuKey;
  label: string;
  description: string;
  icon: typeof CalendarDays;
};

const MENU_ITEMS: MenuItem[] = [
  { key: "schedule", label: "일정", description: "업무 연결 캘린더", icon: CalendarDays },
  { key: "chat", label: "업무대화", description: "업무 요청 라우터", icon: BotMessageSquare },
  { key: "search", label: "로컬파일/정보검색", description: "Anything 외부 연계", icon: FileSearch },
  { key: "documents", label: "문서작성", description: "콘텐츠 베이스 -> 템플릿", icon: FileText },
  { key: "knowledge", label: "내 지식폴더", description: "Obsidian 호환 지식 정본", icon: BookMarked },
  { key: "fileorg", label: "파일정리", description: "지식화 연동 정리", icon: FolderTree },
  { key: "tools", label: "도구", description: "보강형 실행 레지스트리", icon: Hammer },
  { key: "logs", label: "실행기록", description: "사용자 작업 이력", icon: History },
  { key: "settings", label: "기타 환경설정", description: "로컬 우선 설정", icon: Settings2 },
];

const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  health: null,
  settings: null,
  schedules: [],
  workSessions: [],
  referenceSets: [],
  templates: [],
  knowledgeCandidates: [],
  knowledgePages: [],
  approvalTickets: [],
  fileProposals: [],
  logs: [],
};

const FALLBACK_TEMPLATES: TemplateItem[] = [
  { key: "report", label: "보고서형" },
  { key: "meeting", label: "회의자료형" },
  { key: "review", label: "검토메모형" },
];

function formatDateTime(value?: string | null) {
  if (!value) {
    return "미정";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toIso(value: string) {
  if (!value) {
    return new Date().toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function relativePath(fullPath?: string | null) {
  if (!fullPath) {
    return "-";
  }

  const parts = fullPath.split(/[\\/]/);
  return parts.slice(Math.max(parts.length - 3, 0)).join("/");
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      <p>{body}</p>
    </div>
  );
}

function SectionCard({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="panel-card">
      <div className="panel-card__header">
        <div>
          {eyebrow ? <p className="panel-card__eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {actions ? <div className="panel-card__actions">{actions}</div> : null}
      </div>
      <div className="panel-card__body">{children}</div>
    </section>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(EMPTY_SNAPSHOT);
  const [activeMenu, setActiveMenu] = useState<MenuKey>("schedule");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [selectedReferenceSetId, setSelectedReferenceSetId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [fileOrgTargetPath, setFileOrgTargetPath] = useState("");
  const [fileOrgOperations, setFileOrgOperations] = useState<
    Record<string, { id: string; destination_path: string }>
  >({});
  const [lastContentBase, setLastContentBase] = useState<ContentBaseResult | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    title: "",
    starts_at: "",
    ends_at: "",
    view: "week" as "month" | "week" | "list",
  });
  const [sessionForm, setSessionForm] = useState({ title: "" });
  const [referenceForm, setReferenceForm] = useState({
    title: "",
    kind: "file",
    label: "",
    value: "",
  });
  const [knowledgeForm, setKnowledgeForm] = useState({
    title: "",
    body: "",
    candidate_type: "topic" as "topic" | "project" | "issue" | "entity",
  });
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeSearchResult, setKnowledgeSearchResult] = useState<KnowledgeSearchResult | null>(null);
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraphSummary | null>(null);
  const [knowledgeInspectorLoading, setKnowledgeInspectorLoading] = useState(false);
  const [toolManifest, setToolManifest] = useState<ToolManifestItem[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<DesktopRuntimeStatus | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeStarting, setRuntimeStarting] = useState(false);
  const autoRestartHandledRef = useRef<string | null>(null);
  const [documentForm, setDocumentForm] = useState({
    title: "",
    purpose: "보고서형",
    template_key: "" as "" | "report" | "meeting" | "review",
  });
  const [finalizeForm, setFinalizeForm] = useState({
    output_name: "",
  });
  const [lastFinalizeRequest, setLastFinalizeRequest] = useState<FinalDocumentRequestResult | null>(null);

  const deferredLogs = useDeferredValue(snapshot.logs);
  const templates = snapshot.templates.length > 0 ? snapshot.templates : FALLBACK_TEMPLATES;
  const defaultTemplateKey = snapshot.settings?.defaults.default_template_key ?? "report";
  const activeTemplateKey = documentForm.template_key || defaultTemplateKey;
  const pendingApprovals = snapshot.approvalTickets.filter((ticket) => ticket.status === "pending");
  const currentFinalizeTicket = lastFinalizeRequest
    ? snapshot.approvalTickets.find(
        (ticket) => ticket.id === lastFinalizeRequest.approval_ticket.id,
      ) ?? lastFinalizeRequest.approval_ticket
    : null;
  const canApplyFinalize = currentFinalizeTicket?.status === "approved";
  const finalizeAlreadyApplied = lastFinalizeRequest?.final_document_output.status === "applied";
  const activeMenuMeta = MENU_ITEMS.find((item) => item.key === activeMenu) ?? MENU_ITEMS[0];

  async function refreshSnapshot() {
    setLoading(true);
    try {
      const next = await loadWorkspaceSnapshot();
      startTransition(() => {
        setSnapshot(next);
      });
      if (!selectedScheduleId && next.schedules[0]) {
        setSelectedScheduleId(next.schedules[0].id);
      }
      if (!selectedSessionId && next.workSessions[0]) {
        setSelectedSessionId(next.workSessions[0].id);
      }
      if (!selectedReferenceSetId && next.referenceSets[0]) {
        setSelectedReferenceSetId(next.referenceSets[0].id);
      }
      if (!fileOrgTargetPath && next.health?.workspace_root) {
        setFileOrgTargetPath(next.health.workspace_root);
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "워크스페이스를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshRuntimeStatus() {
    setRuntimeLoading(true);
    try {
      const next = await loadDesktopRuntimeStatus();
      setRuntimeStatus(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "런타임 상태를 불러오지 못했습니다.");
    } finally {
      setRuntimeLoading(false);
    }
  }

  useEffect(() => {
    void refreshSnapshot();
    void refreshRuntimeStatus();
  }, []);

  useEffect(() => {
    if (!runtimeStatus?.available) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshRuntimeStatus();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [runtimeStatus?.available]);

  useEffect(() => {
    if (!runtimeStatus?.auto_restart_recommended) {
      autoRestartHandledRef.current = null;
      return;
    }

    const incidentKey = [
      runtimeStatus.mode,
      runtimeStatus.sidecar_url,
      runtimeStatus.log_path,
      runtimeStatus.detail,
    ].join("|");

    if (runtimeStarting || autoRestartHandledRef.current === incidentKey) {
      return;
    }

    autoRestartHandledRef.current = incidentKey;
    void handleRestartSidecar(true);
  }, [
    runtimeStarting,
    runtimeStatus?.auto_restart_recommended,
    runtimeStatus?.detail,
    runtimeStatus?.log_path,
    runtimeStatus?.mode,
    runtimeStatus?.sidecar_url,
  ]);

  useEffect(() => {
    if (activeMenu !== "knowledge") {
      return;
    }

    let alive = true;
    setKnowledgeInspectorLoading(true);
    void loadKnowledgeGraph()
      .then((graph) => {
        if (alive) {
          setKnowledgeGraph(graph);
        }
      })
      .catch((loadError) => {
        if (alive) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "지식 그래프 요약을 불러오지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (alive) {
          setKnowledgeInspectorLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [activeMenu, snapshot.knowledgePages.length]);

  useEffect(() => {
    if (activeMenu !== "tools") {
      return;
    }

    let alive = true;
    setToolsLoading(true);
    void loadTools()
      .then((payload) => {
        if (alive) {
          setToolManifest(payload.items);
        }
      })
      .catch((loadError) => {
        if (alive) {
          setError(
            loadError instanceof Error ? loadError.message : "도구 목록을 불러오지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (alive) {
          setToolsLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [activeMenu]);

  async function handleAction<T>(action: () => Promise<T>, successMessage: string) {
    setSubmitting(true);
    setNotice(null);
    setError(null);
    try {
      const result = await action();
      await refreshSnapshot();
      setNotice(successMessage);
      return result;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "요청을 처리하지 못했습니다.");
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStartSidecar() {
    setRuntimeStarting(true);
    setNotice(null);
    setError(null);
    try {
      const next = await startDesktopSidecar();
      setRuntimeStatus(next);
      await refreshSnapshot();
      setNotice("사이드카 실행 상태를 갱신했습니다.");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "사이드카를 시작하지 못했습니다.");
    } finally {
      setRuntimeStarting(false);
    }
  }

  async function handleStopSidecar() {
    setRuntimeStarting(true);
    setNotice(null);
    setError(null);
    try {
      const next = await stopDesktopSidecar();
      setRuntimeStatus(next);
      await refreshSnapshot();
      setNotice("사이드카 종료 상태를 갱신했습니다.");
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "사이드카를 종료하지 못했습니다.");
    } finally {
      setRuntimeStarting(false);
    }
  }

  async function handleRestartSidecar(autoTriggered = false) {
    setRuntimeStarting(true);
    setNotice(null);
    setError(null);
    try {
      const next = await restartDesktopSidecar();
      setRuntimeStatus(next);
      await refreshSnapshot();
      setNotice(autoTriggered ? "사이드카 비정상 종료를 감지해 다시 시작했습니다." : "사이드카 재시작 상태를 갱신했습니다.");
    } catch (restartError) {
      setError(
        restartError instanceof Error ? restartError.message : "사이드카를 재시작하지 못했습니다.",
      );
    } finally {
      setRuntimeStarting(false);
    }
  }

  async function submitSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await handleAction(
      () =>
        createSchedule({
          title: scheduleForm.title,
          starts_at: toIso(scheduleForm.starts_at),
          ends_at: toIso(scheduleForm.ends_at),
          view: scheduleForm.view,
        }),
      "일정이 등록되었습니다.",
    );
    if (created) {
      setSelectedScheduleId(created.id);
      setScheduleForm({ title: "", starts_at: "", ends_at: "", view: "week" });
    }
  }

  async function submitWorkSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await handleAction(
      () =>
        createWorkSession({
          title: sessionForm.title,
          schedule_id: selectedScheduleId || null,
        }),
      "업무 세션이 열렸습니다.",
    );
    if (created) {
      setSelectedSessionId(created.id);
      setSessionForm({ title: "" });
    }
  }

  async function submitReferenceSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await handleAction(
      () =>
        createReferenceSet({
          title: referenceForm.title,
          session_id: selectedSessionId || null,
          items: [
            {
              kind: referenceForm.kind,
              label: referenceForm.label,
              value: referenceForm.value,
            },
          ],
        }),
      "참고자료 묶음을 저장했습니다.",
    );
    if (created) {
      setSelectedReferenceSetId(created.id);
      setReferenceForm({ title: "", kind: "file", label: "", value: "" });
    }
  }

  async function submitKnowledgeCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleAction(
      () =>
        createKnowledgeCandidate({
          title: knowledgeForm.title,
          body: knowledgeForm.body,
          candidate_type: knowledgeForm.candidate_type,
        }),
      "지식 반영 후보를 큐에 올렸습니다.",
    );
    setKnowledgeForm({ title: "", body: "", candidate_type: "topic" });
  }

  async function submitContentBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await handleAction(
      () =>
        createContentBase({
          title: documentForm.title,
          purpose: documentForm.purpose,
          reference_set_id: selectedReferenceSetId || null,
          template_key: activeTemplateKey as "report" | "meeting" | "review",
        }),
      "콘텐츠 베이스를 생성했습니다.",
    );
    if (created) {
      setLastContentBase(created);
      setDocumentForm({ title: "", purpose: "보고서형", template_key: "" });
      setFinalizeForm({ output_name: created.title });
      setLastFinalizeRequest(null);
    }
  }

  async function submitDocumentFinalizeRequest() {
    if (!lastContentBase) {
      return;
    }

    const created = await handleAction(
      () =>
        requestDocumentFinalize({
          content_base_id: lastContentBase.id,
          output_name: finalizeForm.output_name.trim() || `${lastContentBase.title}-final`,
        }),
      "최종 저장 승인 요청을 보냈습니다.",
    );
    if (created) {
      setLastFinalizeRequest(created);
    }
  }

  async function submitDocumentFinalizeApply() {
    if (!lastFinalizeRequest) {
      return;
    }

    const applied = await handleAction(
      () => applyDocumentFinalize(lastFinalizeRequest.approval_ticket.id),
      "최종 저장이 적용되었습니다.",
    );
    if (applied) {
      setLastFinalizeRequest(applied);
    }
  }

  async function submitAnythingLaunch() {
    await handleAction(() => requestAnythingLaunch(searchQuery), "Anything 실행 요청이 승인 큐에 등록되었습니다.");
  }

  async function submitFileProposals(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleAction(
      () => createFileProposals(fileOrgTargetPath),
      "파일정리 제안을 생성했습니다.",
    );
  }

  async function requestProposalApply(proposal: FileProposalItem) {
    await handleAction(
      () => requestFileProposalApply(proposal.id),
      "파일정리 적용 승인 요청을 보냈습니다.",
    );
  }

  async function commitProposalApply(proposal: FileProposalItem) {
    const applied = await handleAction(
      () => commitFileProposalApply(proposal.id),
      "파일정리 적용을 완료했습니다.",
    );
    if (applied) {
      setFileOrgOperations((current) => ({
        ...current,
        [proposal.id]: {
          id: applied.operation.id,
          destination_path: applied.operation.destination_path,
        },
      }));
    }
  }

  async function rollbackProposalApply(proposal: FileProposalItem) {
    const operation = fileOrgOperations[proposal.id];
    if (!operation) {
      return;
    }

    const rolledBack = await handleAction(
      () => rollbackFileOperation(operation.id),
      "파일정리 적용을 되돌렸습니다.",
    );
    if (rolledBack) {
      setFileOrgOperations((current) => {
        const next = { ...current };
        delete next[proposal.id];
        return next;
      });
    }
  }

  async function decideApprovalTicket(ticket: ApprovalTicketItem, status: "approved" | "rejected") {
    await handleAction(
      () =>
        decideApproval(ticket.id, {
          status,
          decision_note: status === "approved" ? "UI 승인" : "UI 거절",
        }),
      `승인 요청을 ${status === "approved" ? "승인" : "거절"}했습니다.`,
    );
  }

  async function approveCandidate(candidate: KnowledgeCandidateItem) {
    await handleAction(
      () => approveKnowledgeCandidate(candidate.id, { page_type: candidate.candidate_type }),
      "지식 페이지를 생성했습니다.",
    );
  }

  async function runKnowledgeSearch() {
    if (!knowledgeQuery.trim()) {
      return;
    }

    setKnowledgeInspectorLoading(true);
    setError(null);
    try {
      const result = await searchKnowledge(knowledgeQuery.trim());
      setKnowledgeSearchResult(result);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "지식 검색을 실행하지 못했습니다.");
    } finally {
      setKnowledgeInspectorLoading(false);
    }
  }

  const selectedSchedule = snapshot.schedules.find((item) => item.id === selectedScheduleId) ?? null;
  const selectedSession = snapshot.workSessions.find((item) => item.id === selectedSessionId) ?? null;
  const selectedReferenceSet =
    snapshot.referenceSets.find((item) => item.id === selectedReferenceSetId) ?? null;

  function renderScheduleSection() {
    return (
      <>
        <SectionCard
          eyebrow="오늘의 시작점"
          title="업무 연결 캘린더"
          actions={<span className="pill pill--soft">{snapshot.schedules.length}개 일정</span>}
        >
          <form className="stack-form" onSubmit={submitSchedule}>
            <label>
              일정 제목
              <input
                value={scheduleForm.title}
                onChange={(event) => setScheduleForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="예: 주간 보고"
                required
              />
            </label>
            <div className="grid-2">
              <label>
                시작
                <input
                  type="datetime-local"
                  value={scheduleForm.starts_at}
                  onChange={(event) =>
                    setScheduleForm((current) => ({ ...current, starts_at: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                종료
                <input
                  type="datetime-local"
                  value={scheduleForm.ends_at}
                  onChange={(event) =>
                    setScheduleForm((current) => ({ ...current, ends_at: event.target.value }))
                  }
                  required
                />
              </label>
            </div>
            <div className="toolbar">
              <label className="select-field">
                보기
                <select
                  value={scheduleForm.view}
                  onChange={(event) =>
                    setScheduleForm((current) => ({
                      ...current,
                      view: event.target.value as "month" | "week" | "list",
                    }))
                  }
                >
                  <option value="month">월</option>
                  <option value="week">주</option>
                  <option value="list">목록</option>
                </select>
              </label>
              <button type="submit" disabled={submitting}>
                일정 등록
              </button>
            </div>
          </form>
        </SectionCard>

        <SectionCard eyebrow="연결된 작업" title="예정 일정">
          {snapshot.schedules.length === 0 ? (
            <EmptyState
              title="아직 일정이 없습니다."
              body="일정을 만들면 업무대화, 참고자료, 문서 초안 시작점으로 이어집니다."
            />
          ) : (
            <div className="item-list">
              {snapshot.schedules.map((schedule) => (
                <article
                  key={schedule.id}
                  className={`list-card ${selectedScheduleId === schedule.id ? "is-selected" : ""}`}
                >
                  <button
                    type="button"
                    className="list-card__main"
                    onClick={() => setSelectedScheduleId(schedule.id)}
                  >
                    <div>
                      <h3>{schedule.title}</h3>
                      <p>
                        {formatDateTime(schedule.starts_at)}
                        {" -> "}
                        {formatDateTime(schedule.ends_at)}
                      </p>
                    </div>
                    <span className="pill">{schedule.view}</span>
                  </button>
                  <div className="inline-actions">
                    <button type="button" onClick={() => setActiveMenu("chat")}>
                      업무대화 열기
                    </button>
                    <button type="button" className="button-secondary" onClick={() => setActiveMenu("documents")}>
                      문서 초안 시작
                    </button>
                    <button type="button" className="button-secondary" onClick={() => setActiveMenu("search")}>
                      참고자료 준비
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionCard>
      </>
    );
  }

  function renderChatSection() {
    return (
      <>
        <SectionCard eyebrow="업무 요청 라우터" title="세션 열기">
          <form className="stack-form" onSubmit={submitWorkSession}>
            <label>
              세션 제목
              <input
                value={sessionForm.title}
                onChange={(event) => setSessionForm({ title: event.target.value })}
                placeholder="예: 주간 보고 준비"
                required
              />
            </label>
            <label className="select-field">
              연결 일정
              <select value={selectedScheduleId} onChange={(event) => setSelectedScheduleId(event.target.value)}>
                <option value="">연결 안 함</option>
                {snapshot.schedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    {schedule.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={submitting}>
              업무 세션 생성
            </button>
          </form>
        </SectionCard>

        <SectionCard eyebrow="후속 액션" title="현재 세션과 참고 범위">
          {snapshot.workSessions.length === 0 ? (
            <EmptyState
              title="대화 세션이 아직 없습니다."
              body="세션을 열면 참고자료 묶음과 문서작성, 지식 반영 액션이 연결됩니다."
            />
          ) : (
            <div className="item-list">
              {snapshot.workSessions.map((session) => (
                <article
                  key={session.id}
                  className={`list-card ${selectedSessionId === session.id ? "is-selected" : ""}`}
                >
                  <button
                    type="button"
                    className="list-card__main"
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    <div>
                      <h3>{session.title}</h3>
                      <p>상태: {session.status} · 생성: {formatDateTime(session.created_at)}</p>
                    </div>
                    <span className="pill">{session.schedule_id ? "일정 연결" : "독립 세션"}</span>
                  </button>
                  <div className="inline-actions">
                    <button type="button" onClick={() => setActiveMenu("documents")}>
                      문서로 넘기기
                    </button>
                    <button type="button" className="button-secondary" onClick={() => setActiveMenu("knowledge")}>
                      지식 반영 후보 만들기
                    </button>
                    <button type="button" className="button-secondary" onClick={() => setActiveMenu("schedule")}>
                      일정과 연결하기
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionCard>
      </>
    );
  }

  function renderSearchSection() {
    return (
      <>
        <SectionCard eyebrow="외부 연계" title="Anything 실행 진입점">
          <div className="stack-form">
            <label>
              검색 힌트
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="예: 예산, 회의자료, 사업계획"
              />
            </label>
            <div className="toolbar">
              <button type="button" onClick={submitAnythingLaunch} disabled={submitting}>
                Anything 열기 요청
              </button>
              <span className="subtle-text">외부 실행은 승인 흐름을 거쳐 기록에 남습니다.</span>
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="ReferenceSet" title="검색 결과를 작업에 묶기">
          <form className="stack-form" onSubmit={submitReferenceSet}>
            <label>
              참고자료 묶음 제목
              <input
                value={referenceForm.title}
                onChange={(event) =>
                  setReferenceForm((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="예: 보고 참고자료"
                required
              />
            </label>
            <label className="select-field">
              연결 세션
              <select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>
                <option value="">연결 안 함</option>
                {snapshot.workSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid-3">
              <label>
                유형
                <input
                  value={referenceForm.kind}
                  onChange={(event) =>
                    setReferenceForm((current) => ({ ...current, kind: event.target.value }))
                  }
                  placeholder="file / note / search-result"
                  required
                />
              </label>
              <label>
                라벨
                <input
                  value={referenceForm.label}
                  onChange={(event) =>
                    setReferenceForm((current) => ({ ...current, label: event.target.value }))
                  }
                  placeholder="예산메모"
                  required
                />
              </label>
              <label>
                값
                <input
                  value={referenceForm.value}
                  onChange={(event) =>
                    setReferenceForm((current) => ({ ...current, value: event.target.value }))
                  }
                  placeholder="파일 경로 또는 메모"
                  required
                />
              </label>
            </div>
            <button type="submit" disabled={submitting}>
              ReferenceSet 등록
            </button>
          </form>
        </SectionCard>
      </>
    );
  }

  function renderDocumentSection() {
    return (
      <>
        <SectionCard eyebrow="콘텐츠 베이스 우선" title="문서 초안 생성">
          <form className="stack-form" onSubmit={submitContentBase}>
            <label>
              문서 제목
              <input
                value={documentForm.title}
                onChange={(event) => setDocumentForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="예: 주간 보고 초안"
                required
              />
            </label>
            <div className="grid-3">
              <label>
                문서 목적
                <input
                  value={documentForm.purpose}
                  onChange={(event) =>
                    setDocumentForm((current) => ({ ...current, purpose: event.target.value }))
                  }
                  placeholder="보고서형"
                  required
                />
              </label>
              <label className="select-field">
                템플릿
                <select
                  value={activeTemplateKey}
                  onChange={(event) =>
                    setDocumentForm((current) => ({
                      ...current,
                      template_key: event.target.value as "report" | "meeting" | "review",
                    }))
                  }
                >
                  {templates.map((template) => (
                    <option key={template.key} value={template.key}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="select-field">
                참고자료 묶음
                <select
                  value={selectedReferenceSetId}
                  onChange={(event) => setSelectedReferenceSetId(event.target.value)}
                >
                  <option value="">선택 안 함</option>
                  {snapshot.referenceSets.map((referenceSet) => (
                    <option key={referenceSet.id} value={referenceSet.id}>
                      {referenceSet.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="submit" disabled={submitting}>
              ContentBase.md 생성
            </button>
          </form>
        </SectionCard>

        <SectionCard eyebrow="내부 템플릿" title="양식 선택 상태">
          <div className="template-grid">
            {templates.map((template) => (
              <article
                key={template.key}
                className={`template-card ${activeTemplateKey === template.key ? "is-selected" : ""}`}
              >
                <p className="template-card__key">{template.key}</p>
                <h3>{template.label}</h3>
                <p>콘텐츠 베이스를 선택한 양식 구조에 맞춰 정리합니다.</p>
              </article>
            ))}
          </div>
        </SectionCard>

        <SectionCard eyebrow="최근 산출물" title="양식 적합화 미리보기">
          {lastContentBase ? (
            <div className="document-preview">
              <div className="document-preview__meta">
                <span className="pill">{lastContentBase.template_key}</span>
                <span className="subtle-text">{relativePath(lastContentBase.artifact.path)}</span>
              </div>
              <pre>{lastContentBase.content}</pre>
            </div>
          ) : (
            <EmptyState
              title="아직 생성된 콘텐츠 베이스가 없습니다."
              body="참고자료를 고른 뒤 콘텐츠 베이스를 만들면 이 영역에서 초안 내용을 검토할 수 있습니다."
            />
          )}
        </SectionCard>

        <SectionCard eyebrow="최종 저장" title="승인 요청 및 적용">
          {lastContentBase ? (
            <div className="stack-form">
              <label>
                출력 이름
                <input
                  value={finalizeForm.output_name}
                  onChange={(event) =>
                    setFinalizeForm((current) => ({ ...current, output_name: event.target.value }))
                  }
                  placeholder={`${lastContentBase.title}-final`}
                />
              </label>
              <div className="toolbar">
                <p className="subtle-text">
                  ContentBase.md를 승인 큐로 넘겨 `runtime-workspace/documents/outputs`에 저장합니다.
                </p>
                <button type="button" onClick={submitDocumentFinalizeRequest} disabled={submitting || !lastContentBase}>
                  최종 저장 요청
                </button>
              </div>
              {lastFinalizeRequest ? (
                <div className="document-preview">
                  <div className="document-preview__meta">
                    <span className="pill">{currentFinalizeTicket?.status ?? lastFinalizeRequest.approval_ticket.status}</span>
                    <span className="subtle-text">{lastFinalizeRequest.final_document_output.output_name}</span>
                  </div>
                  <p>승인 티켓: {lastFinalizeRequest.approval_ticket.id}</p>
                  <p>
                    {finalizeAlreadyApplied
                      ? "최종 저장이 이미 적용되었습니다."
                      : canApplyFinalize
                        ? "승인되어 바로 적용할 수 있습니다."
                        : "승인 후 적용할 수 있습니다."}
                  </p>
                  <div className="inline-actions">
                    <button
                      type="button"
                      onClick={submitDocumentFinalizeApply}
                      disabled={submitting || !canApplyFinalize || finalizeAlreadyApplied}
                    >
                      최종 저장 적용
                    </button>
                  </div>
                  {lastFinalizeRequest.final_document_output.artifact_path ? (
                    <p className="subtle-text">
                      {relativePath(lastFinalizeRequest.final_document_output.artifact_path)}
                    </p>
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  title="아직 최종 저장 요청이 없습니다."
                  body="콘텐츠 베이스를 만든 뒤 승인 요청을 보내면 여기서 승인 상태와 적용 버튼을 볼 수 있습니다."
                />
              )}
            </div>
          ) : (
            <EmptyState
              title="콘텐츠 베이스가 먼저 필요합니다."
              body="문서 초안을 만든 뒤 최종 저장 승인 요청을 보낼 수 있습니다."
            />
          )}
        </SectionCard>
      </>
    );
  }

  function renderKnowledgeSection() {
    return (
      <>
        <SectionCard eyebrow="반영 후보" title="메모를 지식 후보로 올리기">
          <form className="stack-form" onSubmit={submitKnowledgeCandidate}>
            <label>
              제목
              <input
                value={knowledgeForm.title}
                onChange={(event) =>
                  setKnowledgeForm((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="예: 2026 예산편성 메모"
                required
              />
            </label>
            <div className="grid-2">
              <label className="select-field">
                페이지 유형
                <select
                  value={knowledgeForm.candidate_type}
                  onChange={(event) =>
                    setKnowledgeForm((current) => ({
                      ...current,
                      candidate_type: event.target.value as "topic" | "project" | "issue" | "entity",
                    }))
                  }
                >
                  <option value="topic">Topic Page</option>
                  <option value="project">Project Page</option>
                  <option value="issue">Issue Page</option>
                  <option value="entity">Entity Page</option>
                </select>
              </label>
              <div className="hint-box">
                <Sparkles size={16} />
                <span>승인/수정 이력은 다음 분류 제안에 반영됩니다.</span>
              </div>
            </div>
            <label>
              본문
              <textarea
                value={knowledgeForm.body}
                onChange={(event) =>
                  setKnowledgeForm((current) => ({ ...current, body: event.target.value }))
                }
                placeholder="핵심 일정, 주제, 검토 포인트를 요약해 적어주세요."
                rows={5}
                required
              />
            </label>
            <button type="submit" disabled={submitting}>
              반영 후보 추가
            </button>
          </form>
        </SectionCard>

        <SectionCard eyebrow="Obsidian 정본" title="대기 중인 후보와 생성된 페이지">
          <div className="split-grid">
            <div>
              <h3 className="subheading">반영 후보</h3>
              {snapshot.knowledgeCandidates.length === 0 ? (
                <EmptyState
                  title="대기 중인 후보가 없습니다."
                  body="새 메모, 파일, 검색 결과를 올리면 이곳에 반영 후보가 쌓입니다."
                />
              ) : (
                <div className="item-list">
                  {snapshot.knowledgeCandidates.map((candidate) => (
                    <article key={candidate.id} className="list-card">
                      <div className="list-card__main list-card__main--static">
                        <div>
                          <h3>{candidate.title}</h3>
                          <p>{candidate.candidate_type} · {candidate.status}</p>
                        </div>
                        <span className="pill">{formatDateTime(candidate.created_at)}</span>
                      </div>
                      {candidate.status === "pending" ? (
                        <div className="inline-actions">
                          <button type="button" onClick={() => approveCandidate(candidate)}>
                            반영 승인
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="subheading">구조화된 페이지</h3>
              {snapshot.knowledgePages.length === 0 ? (
                <EmptyState
                  title="아직 생성된 페이지가 없습니다."
                  body="승인된 후보는 structured 폴더에 Markdown 페이지로 생성됩니다."
                />
              ) : (
                <div className="item-list">
                  {snapshot.knowledgePages.map((page: KnowledgePageItem) => (
                    <article key={page.id} className="list-card">
                      <div className="list-card__main list-card__main--static">
                        <div>
                          <h3>{page.title}</h3>
                          <p>{page.page_type} · {relativePath(page.path)}</p>
                        </div>
                        <span className="pill">{formatDateTime(page.created_at)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="그래프 보조 탐색" title="지식 검색과 관계 보기">
          <div className="stack-form">
            <label>
              지식 검색
              <input
                value={knowledgeQuery}
                onChange={(event) => setKnowledgeQuery(event.target.value)}
                placeholder="예: 예산"
              />
            </label>
            <div className="toolbar">
              <button
                type="button"
                onClick={() => void runKnowledgeSearch()}
                disabled={knowledgeInspectorLoading || !knowledgeQuery.trim()}
              >
                검색 실행
              </button>
              <div className="hint-box">
                <span>graph nodes: {knowledgeGraph?.node_count ?? 0}</span>
                <span>graph edges: {knowledgeGraph?.edge_count ?? 0}</span>
              </div>
            </div>
            {knowledgeGraph ? (
              <div className="document-preview">
                <div className="document-preview__meta">
                  <span className="pill">graph.json</span>
                  <span className="subtle-text">{relativePath(knowledgeGraph.artifacts.graph_json_path)}</span>
                </div>
                <p className="subtle-text">{relativePath(knowledgeGraph.artifacts.graph_html_path)}</p>
                <p className="subtle-text">{relativePath(knowledgeGraph.artifacts.graph_report_path)}</p>
                {knowledgeGraph.nodes.length > 0 ? (
                  <div className="item-list">
                    {knowledgeGraph.nodes.slice(0, 5).map((node) => (
                      <article key={node.id} className="list-card">
                        <div className="list-card__main list-card__main--static">
                          <div>
                            <h3>{node.label ?? node.id}</h3>
                            <p>{node.node_type ?? "unknown"}</p>
                          </div>
                          <span className="pill">{(node.neighbors ?? []).length} links</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="아직 그래프 요약이 없습니다."
                    body="후보를 승인하면 graph.json, graph.html, GRAPH_REPORT가 갱신됩니다."
                  />
                )}
              </div>
            ) : (
              <EmptyState
                title="그래프를 아직 불러오지 못했습니다."
                body="지식 페이지가 하나 이상 있으면 관계 요약과 산출물 경로가 여기에 표시됩니다."
              />
            )}

            {knowledgeSearchResult ? (
              <div className="split-grid">
                <div>
                  <h3 className="subheading">검색 결과</h3>
                  {knowledgeSearchResult.vector_hits.length === 0 ? (
                    <EmptyState
                      title="검색 결과가 없습니다."
                      body="다른 키워드로 다시 시도하거나 지식 후보를 먼저 승인해보세요."
                    />
                  ) : (
                    <div className="item-list">
                      {knowledgeSearchResult.vector_hits.map((hit) => (
                        <article key={hit.page.id} className="list-card">
                          <div className="list-card__main list-card__main--static">
                            <div>
                              <h3>{hit.page.title}</h3>
                              <p>{hit.page.page_type} · {relativePath(hit.page.path)}</p>
                            </div>
                            <span className="pill">overlap {hit.keyword_overlap}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="subheading">그래프 이웃</h3>
                  <p>{knowledgeSearchResult.graph_neighbors.join(", ") || "없음"}</p>
                </div>
              </div>
            ) : null}
          </div>
        </SectionCard>
      </>
    );
  }

  function renderFileOrgSection() {
    return (
      <>
        <SectionCard eyebrow="승인형 정리" title="파일정리 제안 생성">
          <form className="stack-form" onSubmit={submitFileProposals}>
            <label>
              대상 폴더
              <input
                value={fileOrgTargetPath}
                onChange={(event) => setFileOrgTargetPath(event.target.value)}
                placeholder="/path/to/folder"
                required
              />
            </label>
            <div className="toolbar">
              <button type="submit" disabled={submitting}>
                정리 제안 만들기
              </button>
              <span className="subtle-text">삭제 대신 복사/참조 중심으로 제안합니다.</span>
            </div>
          </form>
        </SectionCard>

        <SectionCard eyebrow="지식화 연동" title="최근 제안 목록">
          {snapshot.fileProposals.length === 0 ? (
            <EmptyState
              title="아직 생성된 제안이 없습니다."
              body="최근 변경분을 지식 반영 후보 또는 보관 후보로 나눠 제안합니다."
            />
          ) : (
            <div className="item-list">
              {snapshot.fileProposals.map((proposal: FileProposalItem) => (
                <article key={proposal.id} className="list-card">
                  <div className="list-card__main list-card__main--static">
                    <div>
                      <h3>{relativePath(proposal.target_path)}</h3>
                      <p>{proposal.reason}</p>
                      <p className="subtle-text">상태: {proposal.status}</p>
                      <p className="subtle-text">
                        {"-> "}
                        {relativePath(proposal.proposed_destination)}
                      </p>
                      {fileOrgOperations[proposal.id] ? (
                        <p className="subtle-text">
                          적용됨: {relativePath(fileOrgOperations[proposal.id].destination_path)}
                        </p>
                      ) : null}
                    </div>
                    <span className="pill">{proposal.proposal_type}</span>
                  </div>
                  <div className="inline-actions">
                    {!snapshot.approvalTickets.some(
                      (ticket) => ticket.action === "file_org.apply" && ticket.target_id === proposal.id,
                    ) ? (
                      <button type="button" onClick={() => void requestProposalApply(proposal)}>
                        적용 요청
                      </button>
                    ) : null}
                    {snapshot.approvalTickets.some(
                      (ticket) =>
                        ticket.action === "file_org.apply" &&
                        ticket.target_id === proposal.id &&
                        ticket.status === "approved",
                    ) && !fileOrgOperations[proposal.id] ? (
                      <button type="button" onClick={() => void commitProposalApply(proposal)}>
                        승인 후 적용
                      </button>
                    ) : null}
                    {fileOrgOperations[proposal.id] ? (
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void rollbackProposalApply(proposal)}
                      >
                        되돌리기
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionCard>
      </>
    );
  }

  function renderToolsSection() {
    return (
      <SectionCard eyebrow="보강형 도구" title="도구 레지스트리">
        {toolsLoading ? <p>도구 레지스트리를 불러오는 중입니다.</p> : null}
        {!toolsLoading && toolManifest.length === 0 ? (
          <EmptyState
            title="도구 레지스트리가 아직 비어 있습니다."
            body="사이드카의 Tool Manifest가 준비되면 OCR, 요약, 엔티티 추출, 템플릿 점검을 여기서 제어합니다."
          />
        ) : (
          <div className="template-grid">
            {toolManifest.map((tool) => (
              <article key={tool.key} className="template-card">
                <p className="template-card__key">{tool.status}</p>
                <h3>{tool.label}</h3>
                <p>{tool.description}</p>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    );
  }

  function renderLogsSection() {
    return (
      <SectionCard eyebrow="사용자 작업 이력" title="실행기록">
        {snapshot.logs.length === 0 ? (
          <EmptyState
            title="실행기록이 없습니다."
            body="문서작성, 지식 반영, 파일정리, 외부 실행 요청이 모두 이력으로 쌓입니다."
          />
        ) : (
          <div className="item-list">
            {snapshot.logs.map((log) => (
              <article key={log.id} className="list-card">
                <div className="list-card__main list-card__main--static">
                  <div>
                    <h3>{log.action}</h3>
                    <p>{log.feature} · {log.status}</p>
                  </div>
                  <span className="pill">{formatDateTime(log.created_at)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    );
  }

  function renderSettingsSection() {
    return (
      <SectionCard eyebrow="로컬 우선 설정" title="기본 환경">
        <div className="settings-grid">
          <div>
            <p className="settings-grid__label">워크스페이스 루트</p>
            <p>{snapshot.settings?.paths.workspace_root ?? snapshot.health?.workspace_root ?? "사이드카 연결 전"}</p>
          </div>
          <div>
            <p className="settings-grid__label">SQLite</p>
            <p>{snapshot.settings?.paths.database ?? snapshot.health?.database ?? "-"}</p>
          </div>
          <div>
            <p className="settings-grid__label">지식 정본</p>
            <p>{snapshot.settings?.paths.knowledge_root ?? "Obsidian-compatible Markdown Vault"}</p>
          </div>
          <div>
            <p className="settings-grid__label">문서 루트</p>
            <p>{snapshot.settings?.paths.documents_root ?? "-"}</p>
          </div>
          <div>
            <p className="settings-grid__label">LLM 정책</p>
            <p>{snapshot.settings?.defaults.llm_mode ?? "local_first"}</p>
          </div>
          <div>
            <p className="settings-grid__label">검색 연계</p>
            <p>{snapshot.settings?.defaults.anything_launch_mode ?? "external_link_only"}</p>
          </div>
          <div>
            <p className="settings-grid__label">기본 템플릿</p>
            <p>{snapshot.settings?.defaults.default_template_key ?? "report"}</p>
          </div>
          <div>
            <p className="settings-grid__label">내부 API</p>
            <p>{snapshot.settings?.defaults.internal_api_base_url ?? "-"}</p>
          </div>
          <div>
            <p className="settings-grid__label">런타임 모드</p>
            <p>{runtimeStatus?.mode ?? "-"}</p>
          </div>
          <div>
            <p className="settings-grid__label">사이드카 URL</p>
            <p>{runtimeStatus?.sidecar_url ?? "http://127.0.0.1:8765"}</p>
          </div>
          <div>
            <p className="settings-grid__label">사이드카 로그</p>
            <p>{relativePath(runtimeStatus?.log_path)}</p>
          </div>
          <div>
            <p className="settings-grid__label">런타임 관리</p>
            <p>{runtimeStatus?.managed ? "앱이 관리 중" : "외부 또는 미연결"}</p>
          </div>
        </div>
      </SectionCard>
    );
  }

  function renderMainPanel() {
    switch (activeMenu) {
      case "schedule":
        return renderScheduleSection();
      case "chat":
        return renderChatSection();
      case "search":
        return renderSearchSection();
      case "documents":
        return renderDocumentSection();
      case "knowledge":
        return renderKnowledgeSection();
      case "fileorg":
        return renderFileOrgSection();
      case "tools":
        return renderToolsSection();
      case "logs":
        return renderLogsSection();
      case "settings":
        return renderSettingsSection();
      default:
        return null;
    }
  }

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <p className="brand-card__eyebrow">공공기관용 개인 업무 에이전트</p>
          <h1>공무</h1>
          <p>일정에서 시작해 대화, 검색, 지식, 문서작성, 실행기록까지 한 워크플로로 묶습니다.</p>
        </div>

        <nav className="menu-list" aria-label="주요 작업 메뉴">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className={`menu-item ${activeMenu === item.key ? "is-active" : ""}`}
                onClick={() => setActiveMenu(item.key)}
              >
                <Icon size={18} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="main-pane">
        <header className="workspace-header">
          <div>
            <p className="workspace-header__eyebrow">현재 작업 공간</p>
            <h2>{activeMenuMeta.label}</h2>
            <p>{activeMenuMeta.description}</p>
          </div>
          <div className="workspace-header__status">
            <div className={`health-chip ${snapshot.health?.status === "ok" ? "is-ok" : "is-offline"}`}>
              <ShieldCheck size={16} />
              <span>{snapshot.health?.status === "ok" ? "사이드카 연결 정상" : "사이드카 미연결"}</span>
            </div>
            <div className={`health-chip ${runtimeStatus?.running ? "is-ok" : "is-offline"}`}>
              <Sparkles size={16} />
              <span>
                {runtimeLoading
                  ? "런타임 상태 확인 중"
                  : runtimeStatus?.detail ?? "런타임 상태 미확인"}
              </span>
            </div>
            {runtimeStatus?.available && !runtimeStatus.running ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => void handleStartSidecar()}
                disabled={runtimeStarting}
              >
                {runtimeStarting ? "사이드카 시작 중..." : "사이드카 시작"}
              </button>
            ) : null}
            {runtimeStatus?.available && runtimeStatus.running && runtimeStatus.managed ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => void handleRestartSidecar()}
                disabled={runtimeStarting}
              >
                {runtimeStarting ? "사이드카 재시작 중..." : "사이드카 재시작"}
              </button>
            ) : null}
            {runtimeStatus?.available && runtimeStatus.running && runtimeStatus.managed ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => void handleStopSidecar()}
                disabled={runtimeStarting}
              >
                {runtimeStarting ? "사이드카 종료 중..." : "사이드카 종료"}
              </button>
            ) : null}
            <button type="button" className="button-secondary" onClick={() => void refreshSnapshot()}>
              새로고침
            </button>
            {runtimeStatus?.log_path ? (
              <span className="workspace-header__hint">{relativePath(runtimeStatus.log_path)}</span>
            ) : null}
          </div>
        </header>

        {notice ? <div className="notice-banner">{notice}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}

        {loading ? <div className="loading-panel">워크스페이스를 불러오는 중입니다...</div> : renderMainPanel()}
      </main>

      <aside className="context-pane">
        <SectionCard eyebrow="현재 컨텍스트" title="선택 상태">
          <div className="context-list">
            <div>
              <p className="settings-grid__label">선택 일정</p>
              <p>{selectedSchedule?.title ?? "없음"}</p>
            </div>
            <div>
              <p className="settings-grid__label">선택 세션</p>
              <p>{selectedSession?.title ?? "없음"}</p>
            </div>
            <div>
              <p className="settings-grid__label">선택 ReferenceSet</p>
              <p>{selectedReferenceSet?.title ?? "없음"}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="승인 요청" title="대기 중인 승인">
          {pendingApprovals.length === 0 ? (
            <EmptyState
              title="대기 중인 승인이 없습니다."
              body="외부 실행, 파일 변경, 최종 저장 같은 위험 작업은 이 영역에서 승인합니다."
            />
          ) : (
            <div className="item-list">
              {pendingApprovals.map((ticket) => (
                <article key={ticket.id} className="list-card">
                  <div className="list-card__main list-card__main--static">
                    <div>
                      <h3>{ticket.action}</h3>
                      <p>{ticket.target_type} · {formatDateTime(ticket.requested_at)}</p>
                    </div>
                    <span className="pill">pending</span>
                  </div>
                  <div className="inline-actions">
                    <button type="button" onClick={() => decideApprovalTicket(ticket, "approved")}>
                      승인
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => decideApprovalTicket(ticket, "rejected")}
                    >
                      거절
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard eyebrow="최근 실행" title="작업 이력 요약">
          {deferredLogs.length === 0 ? (
            <EmptyState title="기록이 없습니다." body="이력은 기능 실행 직후 자동 갱신됩니다." />
          ) : (
            <div className="timeline-list">
              {deferredLogs.slice(0, 6).map((log) => (
                <article key={log.id} className="timeline-item">
                  <div className="timeline-item__dot" />
                  <div>
                    <strong>{log.action}</strong>
                    <p>{log.feature} · {log.status}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionCard>
      </aside>
    </div>
  );
}
