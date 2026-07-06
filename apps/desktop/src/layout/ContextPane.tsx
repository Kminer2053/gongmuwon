import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { BookMarked, ChevronRight } from "lucide-react";
import { loadWorkJobEvents } from "../api";
import { buildExecutionLogDisplay } from "../executionLogDisplay";
import { openExternalTarget } from "../runtime";
import {
  formatDateTime,
  friendlyArtifactLabel,
  relativePath,
  shortDisplayId,
} from "../shared/format";
import {
  describeApprovalAction,
  describeIngestionJobStatus,
  describeStatus,
  describeWorkJobStatus,
  ingestionProgressPercent,
  ingestionStageLabel,
  isActiveWorkJob,
  workJobResultTargets,
} from "../shared/labels";
import { AssetIcon, EmptyState, SectionCard } from "../shared/primitives";
import { useAppStore, type ContextPanelKey } from "../store";
import "../styles/context-pane.css";

/** C-14: 패널 상태(localStorage) 저장 키. */
export const CONTEXT_PANE_STORAGE_KEY = "gongmu.context-pane.v1";

const CONTEXT_PANE_MIN_WIDTH = 260;
const CONTEXT_PANE_MAX_WIDTH = 520;
const CONTEXT_PANE_KEY_STEP = 16;

type StoredContextPaneState = {
  width?: number;
  open?: boolean;
  visibility?: Partial<Record<ContextPanelKey, boolean>>;
};

function clampContextPaneWidth(width: number) {
  return Math.min(CONTEXT_PANE_MAX_WIDTH, Math.max(CONTEXT_PANE_MIN_WIDTH, Math.round(width)));
}

/**
 * C-14: 테스트 환경(jsdom)은 파일 단위로 localStorage를 공유하므로
 * 이전 테스트의 패널 상태가 다음 테스트로 새어 들어간다. 테스트 모드에서는
 * 영속화를 끄고, 실제 앱(dev/production)에서만 저장·복원한다.
 */
function contextPanePersistenceEnabled() {
  return typeof window !== "undefined" && import.meta.env.MODE !== "test";
}

export function readStoredContextPaneState(): StoredContextPaneState | null {
  try {
    const raw = window.localStorage.getItem(CONTEXT_PANE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as StoredContextPaneState;
  } catch {
    // 저장된 패널 상태가 깨져 있으면 기본값을 사용한다.
    return null;
  }
}

/**
 * 작업 실패 메시지 한글 요약.
 * raw "LLM request failed (404): {...}" 같은 원문 대신 상태코드 기반 요약을 먼저 보여준다.
 * (원문은 카드의 "오류 원문 보기" 접힘 영역에 유지)
 */
export function summarizeWorkJobError(message?: string | null): string {
  const raw = (message ?? "").trim();
  if (!raw) {
    return "작업이 실패했습니다.";
  }

  const codeMatch = raw.match(/\b([45]\d{2})\b/);
  const code = codeMatch ? Number(codeMatch[1]) : null;
  const isModelRequest = /llm|model|chat\/completions|completions/i.test(raw);

  if (code !== null) {
    if (code === 401 || code === 403) {
      return `모델 인증에 실패했습니다(${code}). API 키와 접근 권한을 확인해 주세요.`;
    }
    if (code === 404) {
      return isModelRequest
        ? "모델 요청이 실패했습니다(404). 모델 주소나 모델 이름을 확인해 주세요."
        : "요청한 대상을 찾지 못했습니다(404).";
    }
    if (code === 429) {
      return "요청이 너무 잦아 제한되었습니다(429). 잠시 후 다시 시도해 주세요.";
    }
    if (code >= 500) {
      return `모델 서버 오류가 발생했습니다(${code}). 잠시 후 다시 시도해 주세요.`;
    }
    return isModelRequest ? `모델 요청이 실패했습니다(${code}).` : `요청이 실패했습니다(${code}).`;
  }

  if (/timeout|timed out/i.test(raw)) {
    return "요청 시간이 초과되었습니다. 네트워크와 모델 서버 상태를 확인해 주세요.";
  }
  if (isModelRequest) {
    return "모델 요청이 실패했습니다. 모델 연결 설정을 확인해 주세요.";
  }

  // 이미 한글 요약이 앞에 붙어 있으면 첫 줄을 그대로 쓴다.
  const firstLine = raw.split(/\r?\n/, 1)[0]!.trim();
  if (/[가-힣]/.test(firstLine)) {
    return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine;
  }
  return "작업이 실패했습니다.";
}

/** C-12: 색인 상세 로그 이벤트 한글 매핑. */
const INGESTION_LOG_EVENT_LABELS: Record<string, string> = {
  "job.created": "색인 작업 생성",
  "job.started": "색인 시작",
  "file.parse.started": "문서 추출 시작",
  "file.completed": "파일 처리 완료",
  "file.failed": "파일 처리 실패",
  "job.completed": "색인 완료",
  "job.canceled": "색인 취소",
  "log.parse_error": "로그 해석 오류",
};

const INGESTION_LOG_STAGE_LABELS: Record<string, string> = {
  scan: "폴더 스캔",
  extract: "본문 추출",
  index: "FTS 색인",
  wiki: "위키 갱신",
};

export function describeIngestionLogEvent(event: unknown, fallbackIndex: number): string {
  const key = typeof event === "string" ? event : "";
  if (key && INGESTION_LOG_EVENT_LABELS[key]) {
    return INGESTION_LOG_EVENT_LABELS[key];
  }
  return key || `로그 ${fallbackIndex + 1}`;
}

export function describeIngestionLogStage(item: Record<string, unknown>): string | null {
  const stageLabel = typeof item.stage_label === "string" ? item.stage_label.trim() : "";
  if (stageLabel) {
    return stageLabel;
  }
  const stage = typeof item.stage === "string" ? item.stage.trim() : "";
  if (!stage) {
    return null;
  }
  return INGESTION_LOG_STAGE_LABELS[stage] ?? stage;
}

/** C-10: 탭별 아이콘·비활성 사유 오버라이드 (store rightPanelControls는 동결 파일이라 렌더에서 보정). */
const TAB_ICON_OVERRIDES: Partial<Record<ContextPanelKey, string>> = {
  jobs: "/icons/action/play.svg",
};

const TAB_LABEL_OVERRIDES: Partial<Record<ContextPanelKey, string>> = {
  dump: "색인 상세 로그",
};

const TAB_DISABLED_REASONS: Partial<Record<ContextPanelKey, string>> = {
  upcoming: "일정 화면에서 사용 가능",
  dump: "내 지식폴더의 설정 화면에서 사용 가능",
};

export function ContextPane() {
  const {
    activeKnowledgeIngestionJob,
    activeMenu,
    cancelGenericWorkJob,
    contextPaneOpen,
    contextPaneWidth,
    contextPanelCollapsed,
    contextPanelVisibility,
    currentFinalizeTicket,
    decideApprovalTicket,
    deferredLogs,
    expandedIngestionLogJobId,
    expandedWorkJobId,
    finalizeAlreadyApplied,
    knowledgeIngestionLogDumps,
    knowledgePanel,
    lastContentBase,
    lastFinalizeRequest,
    openKnowledgeLogDumpFolder,
    paneBadges,
    pendingApprovals,
    rightPanelControls,
    selectedResponseContext,
    selectedSchedule,
    selectedSession,
    selectedSessionContextSummary,
    selectedSessionFileLinks,
    setActiveMenu,
    setContextPaneOpen,
    setContextPaneWidth,
    setContextPanelVisibility,
    setWorkJobEvents,
    snapshot,
    startContextPaneResize,
    toggleContextSectionCollapsed,
    toggleContextSectionVisibility,
    toggleKnowledgeLogDump,
    toggleWorkJobEvents,
    upcomingContextSchedules,
    workJobEventLoadingId,
    workJobEvents,
  } = useAppStore();

  // ── C-14: 패널 상태 영속화 ─────────────────────────────────────────────
  const paneStateHydratedRef = useRef(false);

  useEffect(() => {
    if (!contextPanePersistenceEnabled()) {
      return;
    }
    const stored = readStoredContextPaneState();
    if (stored) {
      if (typeof stored.width === "number" && Number.isFinite(stored.width)) {
        setContextPaneWidth(clampContextPaneWidth(stored.width));
      }
      if (typeof stored.open === "boolean") {
        setContextPaneOpen(stored.open);
      }
      if (stored.visibility && typeof stored.visibility === "object") {
        setContextPanelVisibility((current) => {
          const next = { ...current };
          (Object.keys(current) as ContextPanelKey[]).forEach((key) => {
            const storedValue = stored.visibility?.[key];
            if (typeof storedValue === "boolean") {
              next[key] = storedValue;
            }
          });
          return next;
        });
      }
    }
    paneStateHydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회 복원
  }, []);

  useEffect(() => {
    if (!contextPanePersistenceEnabled() || !paneStateHydratedRef.current) {
      return;
    }
    try {
      window.localStorage.setItem(
        CONTEXT_PANE_STORAGE_KEY,
        JSON.stringify({
          width: contextPaneWidth,
          open: contextPaneOpen,
          visibility: contextPanelVisibility,
        }),
      );
    } catch {
      // 저장 실패(쿼터 등)는 조용히 무시한다.
    }
  }, [contextPaneWidth, contextPaneOpen, contextPanelVisibility]);

  // ── C-05: documents.finalize 승인 직후 후속 안내 ──────────────────────
  const ticketStatusRef = useRef<Record<string, string>>({});
  const [finalizeFollowUp, setFinalizeFollowUp] = useState(false);

  useEffect(() => {
    const previous = ticketStatusRef.current;
    const next: Record<string, string> = {};
    let justApprovedFinalize = false;
    for (const ticket of snapshot.approvalTickets) {
      next[ticket.id] = ticket.status;
      if (
        ticket.action === "documents.finalize" &&
        ticket.status === "approved" &&
        previous[ticket.id] === "pending"
      ) {
        justApprovedFinalize = true;
      }
    }
    ticketStatusRef.current = next;
    if (justApprovedFinalize) {
      setFinalizeFollowUp(true);
    }
  }, [snapshot.approvalTickets]);

  useEffect(() => {
    if (finalizeAlreadyApplied) {
      setFinalizeFollowUp(false);
    }
  }, [finalizeAlreadyApplied]);

  // ── C-08+M-08: 활성 작업 상단 정렬 + 카운트 모수 일치 ──────────────────
  const allWorkJobs = snapshot.workJobs ?? [];
  const orderedWorkJobs = [...allWorkJobs].sort(
    (left, right) => Number(isActiveWorkJob(right)) - Number(isActiveWorkJob(left)),
  );
  const paneWorkJobs = orderedWorkJobs.slice(0, 8);
  // "진행 중 N개"의 모수는 슬라이스 전 전체 목록 기준(failed 등 종료 상태 제외).
  const paneActiveJobCount = allWorkJobs.filter(isActiveWorkJob).length;

  // ── C-13: 펼쳐진 활성 작업 로그를 폴링 주기에 맞춰 다시 불러온다 ───────
  const expandedJob = allWorkJobs.find((job) => job.id === expandedWorkJobId) ?? null;
  const expandedJobSignature =
    expandedJob && isActiveWorkJob(expandedJob)
      ? `${expandedJob.id}:${expandedJob.status}:${expandedJob.progress_percent}:${expandedJob.current_stage ?? ""}`
      : "";

  useEffect(() => {
    if (!expandedJobSignature) {
      return;
    }
    const jobId = expandedJobSignature.split(":", 1)[0]!;
    let alive = true;
    void loadWorkJobEvents(jobId)
      .then((events) => {
        if (alive) {
          setWorkJobEvents((current) => ({ ...current, [jobId]: events.items }));
        }
      })
      .catch(() => {
        // 백그라운드 보조 갱신 실패는 조용히 무시한다(수동 "작업 로그 보기"가 에러를 안내).
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 진행률/단계 변경 시에만 재조회
  }, [expandedJobSignature]);

  // ── C-12: 색인 상세 로그 대상 = 최근 실행(완료/실패 포함) ──────────────
  const ingestionJobs = snapshot.knowledgeIngestionJobs ?? [];
  const ingestionJobTime = (job: (typeof ingestionJobs)[number]) => {
    const time = new Date(job.started_at ?? job.created_at).getTime();
    return Number.isNaN(time) ? 0 : time;
  };
  const indexLogJob =
    activeKnowledgeIngestionJob ??
    [...ingestionJobs].sort((left, right) => ingestionJobTime(right) - ingestionJobTime(left))[0] ??
    null;

  function handleResizerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setContextPaneWidth(clampContextPaneWidth(contextPaneWidth + CONTEXT_PANE_KEY_STEP));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setContextPaneWidth(clampContextPaneWidth(contextPaneWidth - CONTEXT_PANE_KEY_STEP));
    }
  }

  function renderPanelCollapseButton(section: ContextPanelKey, label: string) {
    const expanded = !contextPanelCollapsed[section];
    return (
      <button
        type="button"
        className="button-secondary context-pane__collapse-button"
        aria-label={`${label} ${expanded ? "접기" : "펼치기"}`}
        aria-expanded={expanded}
        title={`${label} ${expanded ? "접기" : "펼치기"}`}
        onClick={() => toggleContextSectionCollapsed(section)}
      >
        <AssetIcon src={expanded ? "/icons/panel-close.svg" : "/icons/panel-open.svg"} />
      </button>
    );
  }

  /** C-04: 현재 컨텍스트 카드 — 선택 세션/일정은 클릭해서 해당 화면으로 이동한다. */
  function renderCurrentContextCard() {
    return (
      <SectionCard
        eyebrow="컨텍스트"
        title="현재 컨텍스트"
        actions={renderPanelCollapseButton("context", "현재 컨텍스트")}
      >
        {!contextPanelCollapsed.context ? (
          <>
            <div className="context-current">
              <button
                type="button"
                className="context-current__row"
                onClick={() => setActiveMenu("chat")}
                disabled={!selectedSession}
                title={selectedSession ? "업무대화 화면으로 이동" : "선택된 업무대화 세션이 없습니다"}
              >
                <span className="context-current__label">선택 세션</span>
                <span className="context-current__value">{selectedSession?.title ?? "없음"}</span>
                {selectedSession ? <ChevronRight size={14} aria-hidden="true" /> : null}
              </button>
              <button
                type="button"
                className="context-current__row"
                onClick={() => setActiveMenu("schedule")}
                disabled={!selectedSchedule}
                title={selectedSchedule ? "일정 화면으로 이동" : "선택된 일정이 없습니다"}
              >
                <span className="context-current__label">선택 일정</span>
                <span className="context-current__value">{selectedSchedule?.title ?? "없음"}</span>
                {selectedSchedule ? <ChevronRight size={14} aria-hidden="true" /> : null}
              </button>
              {renderMenuContextMeta()}
            </div>
            {selectedResponseContext ? (
              <div className="detail-panel" data-testid="response-context-detail">
                <p className="settings-grid__label">최근 응답 맥락 상세</p>
                <p className="detail-panel__title">{selectedResponseContext}</p>
                <p className="subtle-text">
                  이 맥락은 마지막 업무대화 응답에서 사용된 지식위키 근거, 연결 파일, 첨부파일 수를 요약한 값입니다.
                </p>
                <div className="context-detail__grid">
                  <span>
                    지식위키{" "}
                    {selectedSessionContextSummary?.graphrag_used
                      ? `${selectedSessionContextSummary.graphrag_evidence_count}개`
                      : "대기"}
                  </span>
                  <span>연결 파일 {selectedSessionContextSummary?.linked_file_count ?? selectedSessionFileLinks.length}개</span>
                  <span>첨부 {selectedSessionContextSummary?.attachment_count ?? 0}개</span>
                  <span>{selectedSessionContextSummary?.provider ?? "제공자 미기록"}</span>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </SectionCard>
    );
  }

  /** C-04: 활성 메뉴에 맞는 요약 정보 한 줄. */
  function renderMenuContextMeta() {
    if (activeMenu === "chat") {
      const evidenceLabel = selectedSessionContextSummary?.graphrag_used
        ? `${selectedSessionContextSummary.graphrag_evidence_count}개`
        : "없음";
      return (
        <div className="context-current__meta">
          <span>마지막 응답 근거 {evidenceLabel}</span>
          <span>연결 파일 {selectedSessionFileLinks.length}개</span>
        </div>
      );
    }
    if (activeMenu === "documents") {
      const finalizeStatus =
        currentFinalizeTicket?.status ?? lastFinalizeRequest?.approval_ticket.status ?? null;
      return (
        <div className="context-current__meta">
          <span>
            {lastContentBase
              ? `작성 콘텐츠 준비됨 · ${friendlyArtifactLabel(lastContentBase.artifact.path)}`
              : "작성 콘텐츠 없음"}
          </span>
          <span>{finalizeStatus ? `최종 저장 ${describeStatus(finalizeStatus)}` : "초안 단계"}</span>
        </div>
      );
    }
    if (activeMenu === "knowledge") {
      return (
        <div className="context-current__meta">
          <span>
            최근 색인{" "}
            {indexLogJob
              ? `${describeIngestionJobStatus(indexLogJob)} · ${formatDateTime(indexLogJob.started_at ?? indexLogJob.created_at)}`
              : "기록 없음"}
          </span>
        </div>
      );
    }
    return null;
  }

  function renderContextPane() {
    return (
      <>
      {contextPaneOpen ? (
        <div
          className="context-pane-resizer"
          onMouseDown={startContextPaneResize}
          onKeyDown={handleResizerKeyDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="오른쪽 패널 크기 조절"
          aria-valuemin={CONTEXT_PANE_MIN_WIDTH}
          aria-valuemax={CONTEXT_PANE_MAX_WIDTH}
          aria-valuenow={contextPaneWidth}
          tabIndex={0}
          title="드래그 또는 좌우 방향키로 크기 조절"
        />
      ) : null}

      {contextPaneOpen ? (
        <aside className="context-pane">
        <div className="context-pane__scroll">
        <div className="context-pane__controls">
          {rightPanelControls.map((item) => {
            const label = TAB_LABEL_OVERRIDES[item.key] ?? item.label;
            const visible = item.enabled && contextPanelVisibility[item.key];
            const badgeCount = paneBadges[item.key] ?? 0;
            return (
              <button
                key={item.key}
                type="button"
                className={[
                  "button-secondary",
                  "context-pane__control-icon",
                  "context-pane__tab",
                  visible ? "is-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => toggleContextSectionVisibility(item.key)}
                disabled={!item.enabled}
                aria-label={label}
                aria-pressed={visible}
                title={
                  item.enabled
                    ? label
                    : TAB_DISABLED_REASONS[item.key] ?? `${label} — 지금은 사용할 수 없습니다`
                }
              >
                <AssetIcon src={TAB_ICON_OVERRIDES[item.key] ?? item.iconSrc} />
                {item.enabled && badgeCount > 0 ? (
                  <span className="context-pane__tab-badge" aria-hidden="true">
                    {badgeCount > 9 ? "9+" : badgeCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {contextPanelVisibility.context ? renderCurrentContextCard() : null}

        {contextPanelVisibility.approvals ? (
          <SectionCard
            eyebrow="승인 요청"
            title="대기 중인 승인"
            actions={renderPanelCollapseButton("approvals", "승인 요청")}
          >
            {!contextPanelCollapsed.approvals ? (
              <>
                {pendingApprovals.length === 0 ? (
                  <EmptyState
                    title="대기 중인 승인이 없습니다."
                    body="문서 최종 저장 같은 위험 작업은 이 영역에서 승인합니다."
                  />
                ) : (
                  <div className="item-list">
                    {pendingApprovals.map((ticket) => (
                      <article key={ticket.id} className="list-card">
                        <div className="list-card__main list-card__main--static">
                          <div>
                            <h3>{ticket.target_label?.trim() || describeApprovalAction(ticket.action)}</h3>
                            <p>
                              {describeApprovalAction(ticket.action)} · {formatDateTime(ticket.requested_at)}
                            </p>
                          </div>
                          <span className="pill">{describeStatus(ticket.status)}</span>
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
                {finalizeFollowUp && !finalizeAlreadyApplied ? (
                  <div className="context-followup" data-testid="finalize-followup-hint" role="status">
                    <p>
                      <strong>승인 완료.</strong> 문서작성에서 [최종 저장 적용]을 누르면 완료됩니다.
                    </p>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setActiveMenu("documents")}
                    >
                      문서작성으로 이동
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </SectionCard>
        ) : null}

        {contextPanelVisibility.jobs ? (
          <SectionCard
            eyebrow="작업 진행"
            title={paneActiveJobCount > 0 ? `진행 중 ${paneActiveJobCount}개` : "최근 작업"}
            actions={renderPanelCollapseButton("jobs", "작업 진행")}
          >
            {!contextPanelCollapsed.jobs ? (
              paneWorkJobs.length === 0 ? (
                <EmptyState title="진행 중인 작업이 없습니다." body="지식위키 색인, 파일명 인덱스, 문서작성 같은 긴 작업은 여기에 표시됩니다." />
              ) : (
                <div className="item-list item-list--compact">
                  {paneWorkJobs.map((job) => {
                    const progress = Math.max(0, Math.min(100, Math.round(job.progress_percent ?? 0)));
                    const resultTargets = workJobResultTargets(job);
                    return (
                      <article key={job.id} className={`list-card list-card--compact ${isActiveWorkJob(job) ? "is-running" : ""}`}>
                        <div className="list-card__main list-card__main--static">
                          <div>
                            <h3 title={shortDisplayId(job.id, "작업")}>{job.title}</h3>
                            <p>{job.current_stage || job.kind}</p>
                          </div>
                          <span className={job.status === "failed" ? "pill pill--warning" : "pill"}>
                            {describeWorkJobStatus(job)}
                          </span>
                        </div>
                        <div className="knowledge-progress" aria-label={`${job.title} 진행률 ${progress}%`}>
                          <span style={{ width: `${progress}%` }} />
                        </div>
                        <div className="document-preview__meta">
                          <span>{progress}%</span>
                        </div>
                        {job.status === "blocked" ? (
                          <p className="subtle-text">같은 자료를 사용하는 선행 작업이 끝나면 자동으로 이어서 실행됩니다.</p>
                        ) : null}
                        <div className="inline-actions">
                          <button type="button" className="button-secondary" onClick={() => void toggleWorkJobEvents(job)}>
                            {expandedWorkJobId === job.id ? "작업 로그 접기" : "작업 로그 보기"}
                          </button>
                          {resultTargets.map((target) => (
                            <button
                              key={`${job.id}-${target.label}-${target.target}`}
                              type="button"
                              className="button-secondary"
                              onClick={() => void openExternalTarget(target.target)}
                            >
                              {target.label}
                            </button>
                          ))}
                        </div>
                        {expandedWorkJobId === job.id ? (
                          <div className="dump-viewer dump-viewer--compact" aria-label={`${job.title} 작업 로그`}>
                            <p className="subtle-text">{shortDisplayId(job.id, "작업")}</p>
                            {workJobEventLoadingId === job.id ? <p>작업 로그를 불러오는 중입니다.</p> : null}
                            {!workJobEventLoadingId && (workJobEvents[job.id] ?? []).length === 0 ? (
                              <p>아직 표시할 작업 로그가 없습니다.</p>
                            ) : null}
                            {(workJobEvents[job.id] ?? []).map((event) => (
                              <article key={event.id} className="dump-viewer__entry">
                                <div className="document-preview__meta">
                                  <span>{event.seq}</span>
                                  <span>{event.event_type}</span>
                                  <span>{formatDateTime(event.created_at)}</span>
                                  <span>{event.level}</span>
                                </div>
                                <p>{event.message}</p>
                              </article>
                            ))}
                          </div>
                        ) : null}
                        {job.error_message ? (
                          <div className="job-error">
                            <p className="job-error__summary">{summarizeWorkJobError(job.error_message)}</p>
                            <details className="job-error__raw">
                              <summary>오류 원문 보기</summary>
                              <pre>{job.error_message}</pre>
                            </details>
                          </div>
                        ) : null}
                        {isActiveWorkJob(job) ? (
                          <div className="inline-actions">
                            {job.status === "cancel_requested" ? (
                              <button
                                type="button"
                                className="button-secondary"
                                disabled
                                title="취소 요청이 접수되어 처리 중입니다"
                              >
                                취소 처리 중…
                              </button>
                            ) : (
                              <button type="button" className="button-secondary" onClick={() => void cancelGenericWorkJob(job)}>
                                취소 요청
                              </button>
                            )}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )
            ) : null}
          </SectionCard>
        ) : null}

        {contextPanelVisibility.logs ? (
          <SectionCard
            eyebrow="최근 실행"
            title="작업 이력 요약"
            actions={renderPanelCollapseButton("logs", "최근 실행")}
          >
            {!contextPanelCollapsed.logs ? (
              deferredLogs.length === 0 ? (
                <EmptyState title="기록이 없습니다." body="이력은 기능 실행 직후 자동 갱신됩니다." />
              ) : (
                <div className="timeline-list">
                  {deferredLogs.slice(0, 6).map((log) => (
                    <article key={log.id} className="timeline-item">
                      <div className="timeline-item__dot" />
                      <div>
                        <strong>{buildExecutionLogDisplay(log).title}</strong>
                        <p>{buildExecutionLogDisplay(log).subtitle}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )
            ) : null}
          </SectionCard>
        ) : null}
        {activeMenu === "schedule" && contextPanelVisibility.upcoming ? (
          <SectionCard
            eyebrow="가까운 일정"
            title="다가오는 업무"
            actions={renderPanelCollapseButton("upcoming", "가까운 일정")}
          >
            {!contextPanelCollapsed.upcoming ? (
              upcomingContextSchedules.length === 0 ? (
                <EmptyState title="다가오는 일정이 없습니다." body="캘린더에서 새 일정을 등록하면 여기에 요약됩니다." />
              ) : (
                <div className="timeline-list">
                  {upcomingContextSchedules.map((schedule) => (
                    <article key={schedule.id} className="timeline-item">
                      <div className="timeline-item__dot" />
                      <div>
                        <strong>{schedule.title}</strong>
                        <p>{formatDateTime(schedule.starts_at)}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )
            ) : null}
          </SectionCard>
        ) : null}
        {activeMenu === "knowledge" && knowledgePanel === "indexing" && contextPanelVisibility.dump ? (
          <SectionCard
            eyebrow="색인 상세 로그"
            title="최근 색인 실행"
            actions={renderPanelCollapseButton("dump", "색인 상세 로그")}
          >
            {!contextPanelCollapsed.dump ? (
              indexLogJob ? (
                <div className="context-detail">
                  <div className="context-detail__hero">
                    <span className="context-detail__icon"><BookMarked size={18} /></span>
                    <div>
                      <strong>{shortDisplayId(indexLogJob.id, "색인")}</strong>
                      <p>{ingestionStageLabel(indexLogJob)}</p>
                    </div>
                  </div>
                  <div className="document-preview__meta">
                    <span>실행 {formatDateTime(indexLogJob.started_at ?? indexLogJob.created_at)}</span>
                    <span
                      className={
                        indexLogJob.status === "partial" || indexLogJob.status === "failed"
                          ? "pill pill--warning"
                          : "pill"
                      }
                    >
                      결과: {describeIngestionJobStatus(indexLogJob)}
                    </span>
                  </div>
                  <div className="context-detail__grid">
                    <span>{ingestionProgressPercent(indexLogJob)}%</span>
                    <span>실패 {indexLogJob.failed_count}</span>
                    <span>진단 {indexLogJob.diagnostic_event_count ?? 0}</span>
                  </div>
                  {indexLogJob.log_dump_path ? (
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void openKnowledgeLogDumpFolder(indexLogJob.log_dump_path ?? "")}
                      >
                        로그 폴더 열기
                      </button>
                      <button type="button" className="button-secondary" onClick={() => void toggleKnowledgeLogDump(indexLogJob)}>
                        {expandedIngestionLogJobId === indexLogJob.id ? "상세 로그 접기" : "상세 로그 보기"}
                      </button>
                    </div>
                  ) : (
                    <p className="subtle-text">아직 색인 상세 로그 파일이 없습니다.</p>
                  )}
                  {expandedIngestionLogJobId === indexLogJob.id ? (
                    <div className="knowledge-log-preview" data-testid="right-dump-viewer">
                      {knowledgeIngestionLogDumps[indexLogJob.id] ? (
                        <>
                          <div className="document-preview__meta">
                            <span className="pill">최근 로그 {knowledgeIngestionLogDumps[indexLogJob.id].items.length}개</span>
                          </div>
                          <div className="item-list item-list--compact">
                            {knowledgeIngestionLogDumps[indexLogJob.id].items.slice(0, 12).map((item, index) => (
                              <article key={`${indexLogJob.id}-panel-dump-${index}`} className="list-card list-card--compact">
                                <div className="list-card__main list-card__main--static">
                                  <div>
                                    <h3>{describeIngestionLogEvent(item.event, index)}</h3>
                                    <p>{String(item.message ?? "메시지 없음")}</p>
                                    {typeof item.event === "string" && item.event && INGESTION_LOG_EVENT_LABELS[item.event] ? (
                                      <p className="subtle-text context-log-raw-event">{item.event}</p>
                                    ) : null}
                                  </div>
                                  {describeIngestionLogStage(item) ? (
                                    <span className="pill">{describeIngestionLogStage(item)}</span>
                                  ) : null}
                                </div>
                                {item.title || item.relative_path || item.file_path ? (
                                  <p className="subtle-text">
                                    {String(item.title ?? item.relative_path ?? relativePath(String(item.file_path)))}
                                  </p>
                                ) : null}
                              </article>
                            ))}
                          </div>
                          <details className="knowledge-error-log">
                            <summary>원본 JSON 보기</summary>
                            <pre>
                              {knowledgeIngestionLogDumps[indexLogJob.id].items
                                .map((item) => JSON.stringify(item, null, 2).normalize("NFC"))
                                .join("\n")}
                            </pre>
                          </details>
                        </>
                      ) : (
                        <p className="subtle-text">색인 상세 로그를 불러오는 중입니다.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState title="색인 상세 로그가 없습니다." body="지식위키 색인을 실행하면 상세 로그가 표시됩니다." />
              )
            ) : null}
          </SectionCard>
        ) : null}
        </div>
        </aside>
      ) : null}
      </>
    );
  }

  return renderContextPane();
}
