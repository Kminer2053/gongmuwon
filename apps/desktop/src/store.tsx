import {
  startTransition,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createContext, useContext } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  CalendarDays,
  BookMarked,
  BotMessageSquare,
  FileText,
  History,
  House,
  Settings2,
} from "lucide-react";
import {
  cancelWorkJob,
  cloneWorkspaceLlmProfiles,
  createDefaultWorkspaceLlmProfiles,
  createWorkSessionFileLinks,
  diffKnowledgeSource,
  fetchAuthoringFormats,
  fetchKnowledgeSources,
  fetchWikiIndex,
  fetchWikiTree,
  getLlmProfileForSelection,
  decideApproval,
  loadKnowledgeBackendStatus,
  loadKnowledgeIngestionJobs,
  loadKnowledgeIngestionJobLog,
  loadKnowledgeParserStatus,
  loadWorkJobEvents,
  loadWorkJobsOnly,
  loadCustomDocumentTemplates,
  loadWorkSessionFileLinks,
  loadWorkspaceDeferredSnapshot,
  loadWorkspaceSnapshot,
  loadWorkspaceShellSnapshot,
  mergeWorkspaceSnapshot,
  type ApprovalTicketItem,
  type AuthoringBuildResult,
  type AuthoringFormatItem,
  type AuthoringStageEvent,
  type AuthoringStructureMeta,
  type ContentBaseResult,
  type CustomDocumentTemplateItem,
  type DocumentFormat,
  type FinalDocumentRequestResult,
  type KnowledgeAskResult,
  type KnowledgeBackendStatus,
  type KnowledgeDocumentStructure,
  type KnowledgeIngestionJobItem,
  type KnowledgeIngestionLogDump,
  type KnowledgeParserStatus,
  type KnowledgeSearchResult,
  type KnowledgeSourceDiffResult,
  type KnowledgeTableBlock,
  type LocalFileIndexRebuildResult,
  type LocalFileSearchResult,
  type WorkspaceLlmProfiles,
  type WorkspaceDeferredGroup,
  type WorkspaceSnapshot,
  type WorkSessionAttachmentItem,
  type WorkSessionFileLinkItem,
  type WorkSessionMessageItem,
  type WorkSessionTurnContextSummary,
  type WorkSessionItem,
  type WikiIndexResult,
  type WikiPageResult,
  type WikiTreeResult,
  type WorkJobEventItem,
  type WorkJobItem,
} from "./api";
import { buildChatContextEvidence } from "./chatContextSummary";
import { LLM_PROVIDER_PRESETS, normalizeProviderKey, type LlmProviderKey } from "./llmProviders";
import {
  loadDesktopRuntimeStatus,
  openExternalTarget,
  restartDesktopSidecar,
  setDesktopZoom,
  startDesktopSidecar,
  stopDesktopSidecar,
  type DesktopRuntimeStatus,
} from "./runtime";
import { AUTHORING_FORMAT_FALLBACK, type AuthoringTabKey } from "./shared/authoring";
import { fileNameFromPath, parentPathFromPath } from "./shared/format";
import { activeKnowledgeIngestionMessage, isActiveWorkJob, userFacingRuntimeError } from "./shared/labels";
export type MenuKey =
  | "home"
  | "schedule"
  | "chat"
  | "documents"
  | "knowledge"
  | "logs"
  | "settings";

export type MenuItem = {
  key: MenuKey;
  label: string;
  description: string;
  icon: typeof CalendarDays;
  iconSrc: string;
};

export type DetailCardState =
  | { kind: "knowledge"; id: string }
  | { kind: "proposal"; id: string }
  | { kind: "log"; id: string }
  | null;

export type ContextPanelKey = "context" | "approvals" | "jobs" | "logs" | "upcoming" | "dump";
export type ActionRefreshScope = "full" | "shell" | "none";
export type ActionOptions = { revealSection?: ContextPanelKey; refresh: ActionRefreshScope };

export type KnowledgeScanActivity = {
  sourceId: string;
  sourceLabel: string;
  startedAt: number;
} | null;

/**
 * W7 P1/P3: 소스별 증분 diff 견적 결과 한 건.
 * 지식폴더 설정 탭의 [변경 확인] 버튼과 앱 시작 자동 diff(§9 v2)가 같은 store 상태를
 * 갱신하고, 대시보드 색인 카드의 "미반영 변경 N건" 표기가 이를 재사용한다.
 */
export type KnowledgeDiffEntry = {
  result: KnowledgeSourceDiffResult;
  sourceLabel: string;
  checkedAt: string;
};

export type ChatAttachmentDraft = {
  id: string;
  file: File;
};

export type ChatAttachmentPreview = {
  key: string;
  attachmentId: string;
  name: string;
  url: string;
};

export type ChatTurnRetryPayload = {
  sessionId: string;
  text: string;
  attachmentDrafts: ChatAttachmentDraft[];
  uploadedItems: WorkSessionAttachmentItem[];
  optimisticUserMessageId: string;
};

export type ToastItem = {
  id: number;
  tone: "info" | "error";
  message: string;
};

// F-20: due 리마인더는 병렬 배치에서 추가 중인 api 헬퍼 대신 직접 fetch 한다
// (엔드포인트/헬퍼 부재 시에도 앱이 깨지지 않도록 런타임 가드).
const SIDECAR_BASE_URL: string = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:8765";

// D-06: 홈은 나브에는 넣지 않는다(메뉴 6개 유지) — 타이틀 클릭으로만 진입.
export const HOME_MENU_META: MenuItem = {
  key: "home",
  label: "홈",
  description: "오늘의 브리핑",
  icon: House,
  iconSrc: "/icons/panel-context.png",
};

export const MENU_ITEMS: MenuItem[] = [
  { key: "chat", label: "업무대화", description: "업무 요청 라우터", icon: BotMessageSquare, iconSrc: "/icons/menu-chat.png" },
  { key: "schedule", label: "일정", description: "업무 연결 캘린더", icon: CalendarDays, iconSrc: "/icons/menu-schedule.png" },
  { key: "documents", label: "문서작성", description: "작성 콘텐츠 -> 템플릿", icon: FileText, iconSrc: "/icons/menu-documents.png" },
  { key: "knowledge", label: "내 지식폴더", description: "LLM 위키로 지식관리", icon: BookMarked, iconSrc: "/icons/menu-knowledge.png" },
  { key: "logs", label: "실행기록", description: "사용자 작업 이력", icon: History, iconSrc: "/icons/menu-logs.png" },
  { key: "settings", label: "환경설정", description: "로컬 우선 설정", icon: Settings2, iconSrc: "/icons/menu-settings.png" },
];
export const PROVIDER_OPTION_ORDER: LlmProviderKey[] = [
  "openai",
  "openrouter",
  "featherless",
  "anthropic",
  "gemini",
  "nvidia_nim",
  "custom_openai",
];

export const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  health: null,
  runtimeReady: null,
  runtimeMetrics: null,
  settings: null,
  schedules: [],
  workSessions: [],
  templates: [],
  knowledgeCandidates: [],
  knowledgePages: [],
  knowledgeSources: [],
  knowledgeSourceFiles: [],
  knowledgeIngestionJobs: [],
  knowledgeDocuments: [],
  workJobs: [],
  personalizationCandidates: [],
  approvalTickets: [],
  logs: [],
};


export const KNOWLEDGE_WORKSPACE_PANELS = [
  { key: "dashboard", label: "대시보드", description: "지식 엔진 상태와 위키 요약", iconSrc: "/icons/panel-context.png" },
  { key: "indexing", label: "설정", description: "지식폴더 지정, 위키 구성, 색인 설정·실행", iconSrc: "/icons/panel-dump.png" },
  // "search" 키는 위키 탭으로 통합됨 — 하위호환을 위해 키만 유지(KnowledgeScreen에서 wiki로 리다이렉트)
  { key: "search", label: "위키", description: "키워드 검색과 근거 답변 (위키 탭에 통합)", iconSrc: "/icons/menu-search.png" },
  { key: "wiki", label: "위키", description: "지식위키 열람과 검색·근거 답변", iconSrc: "/icons/menu-knowledge.png" },
] as const;

export type KnowledgeWorkspacePanel = (typeof KNOWLEDGE_WORKSPACE_PANELS)[number]["key"];

/**
 * W6: 최초 실행 튜토리얼 완료 플래그 키.
 * 값이 존재하면(완료/건너뛰기 시 저장) 자동 실행하지 않는다.
 * 환경설정의 [튜토리얼 다시 보기]로는 플래그와 무관하게 재실행할 수 있다.
 */
export const TUTORIAL_DONE_STORAGE_KEY = "gongmu.tutorial.done";

function shouldAutoOpenTutorial(): boolean {
  try {
    if (window.localStorage.getItem(TUTORIAL_DONE_STORAGE_KEY)) {
      return false;
    }
  } catch {
    // localStorage 접근 불가(사파리 프라이빗 모드 등) — 매번 뜨는 것을 막기 위해 자동 실행하지 않는다.
    return false;
  }
  // vitest(jsdom) 화면 테스트는 App을 그대로 렌더링하므로, 테스트에서는
  // 명시적 opt-in(__gongmuTutorialAutoOpen) 시에만 자동 실행한다.
  if (
    import.meta.env.MODE === "test" &&
    (window as { __gongmuTutorialAutoOpen?: boolean }).__gongmuTutorialAutoOpen !== true
  ) {
    return false;
  }
  return true;
}

/**
 * W7 P3 §9(2026-07-05 승인값): v2 앱 시작 자동 diff — 감지·배지만 자동 on, 색인 자동 실행 off.
 * 토글 값은 localStorage에 유지한다. 값이 "off"일 때만 끔(기본 켬).
 */
export const STARTUP_DIFF_STORAGE_KEY = "gongmu.knowledge.startupDiff";
/** 앱 로드 후 시작 diff까지의 유휴 대기(설계 §4.1: 기동 후 유휴 10초). */
export const STARTUP_DIFF_IDLE_MS = 10_000;

function readStartupDiffEnabled(): boolean {
  try {
    return window.localStorage.getItem(STARTUP_DIFF_STORAGE_KEY) !== "off";
  } catch {
    // localStorage 접근 불가 — 기본값(켬)으로 동작한다.
    return true;
  }
}


export function useAppStoreValue() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(EMPTY_SNAPSHOT);
  // D-06: 앱 시작 화면은 홈(오늘의 브리핑)이다.
  const [activeMenu, setActiveMenu] = useState<MenuKey>("home");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [lastContentBase, setLastContentBase] = useState<ContentBaseResult | null>(null);
  const [lastContentBaseSignature, setLastContentBaseSignature] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    title: "",
    starts_at: "",
    ends_at: "",
    view: "week" as "month" | "week" | "day",
  });
  const [plannerAnchorAt, setPlannerAnchorAt] = useState("");
  const [selectedPlannerSlotId, setSelectedPlannerSlotId] = useState("");
  const [sessionForm, setSessionForm] = useState({ title: "" });
  const [sessionCreateExpanded, setSessionCreateExpanded] = useState(false);
  const [sessionRailQuery, setSessionRailQuery] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatAttachments, setChatAttachments] = useState<ChatAttachmentDraft[]>([]);
  const [chatAttachmentPreviews, setChatAttachmentPreviews] = useState<ChatAttachmentPreview[]>([]);
  const [chatRetryPayloads, setChatRetryPayloads] = useState<Record<string, ChatTurnRetryPayload>>({});
  const [chatDetailsOpen, setChatDetailsOpen] = useState(false);
  const [chatReasoningEffort, setChatReasoningEffort] = useState<"auto" | "minimal" | "low" | "medium" | "high">(
    "auto",
  );
  const [chatModelOverride, setChatModelOverride] = useState("");
  const [chatImagePreviewOpen, setChatImagePreviewOpen] = useState<ChatAttachmentPreview | null>(null);
  const [toastItems, setToastItems] = useState<ToastItem[]>([]);
  const [uiFontScale, setUiFontScale] = useState(1);
  const [sessionMessages, setSessionMessages] = useState<Record<string, WorkSessionMessageItem[]>>({});
  const [sessionContextSummaries, setSessionContextSummaries] = useState<Record<string, WorkSessionTurnContextSummary>>(
    {},
  );
  const [selectedSessionFileLinks, setSelectedSessionFileLinks] = useState<WorkSessionFileLinkItem[]>([]);
  // D-04: 파일찾기 화면 삭제 후 세션 파일 연결은 업무대화의 파일연결 모달로 이동한다.
  const [chatFileLinkModalOpen, setChatFileLinkModalOpen] = useState(false);
  // 대화→문서작성/일정 핸드오프 후 "대화로 돌아가기" 칩용 출발 컨텍스트
  const [chatReturnContext, setChatReturnContext] = useState<{
    sessionId: string;
    title: string;
    from: "documents" | "schedule";
  } | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    llm_mode: "local_first" as "local_first" | "internal_server" | "external_model",
    llm_provider: "ollama",
    llm_model: "qwen3.6:27b",
    llm_api_key: "",
    llm_site_url: "",
    llm_application_name: "",
    default_template_key: "report" as "report" | "meeting" | "review",
    internal_api_base_url: "http://127.0.0.1:11434",
    personalization_apply_mode: "approval_required" as "approval_required" | "auto_apply",
    personalization_root: "",
  });
  const [settingsProfiles, setSettingsProfiles] = useState<WorkspaceLlmProfiles>(
    createDefaultWorkspaceLlmProfiles(),
  );
  const [localFileQuery, setLocalFileQuery] = useState("");
  const [localFileSearchResult, setLocalFileSearchResult] = useState<LocalFileSearchResult | null>(null);
  const [localFileSearchLoading, setLocalFileSearchLoading] = useState(false);
  const [localFileIndexResult, setLocalFileIndexResult] = useState<LocalFileIndexRebuildResult | null>(null);
  const [localFileIndexLoading, setLocalFileIndexLoading] = useState(false);
  const [knowledgeSourceForm, setKnowledgeSourceForm] = useState({
    label: "",
    root_path: "",
  });
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeSearchResult, setKnowledgeSearchResult] = useState<KnowledgeSearchResult | null>(null);
  const [knowledgeDocumentStructure, setKnowledgeDocumentStructure] = useState<KnowledgeDocumentStructure | null>(null);
  const [knowledgeDocumentTables, setKnowledgeDocumentTables] = useState<KnowledgeTableBlock[]>([]);
  const [knowledgeBackendStatus, setKnowledgeBackendStatus] = useState<KnowledgeBackendStatus | null>(null);
  const [knowledgeParserStatus, setKnowledgeParserStatus] = useState<KnowledgeParserStatus | null>(null);
  const [knowledgeAskResult, setKnowledgeAskResult] = useState<KnowledgeAskResult | null>(null);
  const [knowledgePanel, setKnowledgePanel] = useState<KnowledgeWorkspacePanel>("dashboard");
  const [knowledgeWikiTree, setKnowledgeWikiTree] = useState<WikiTreeResult | null>(null);
  const [knowledgeWikiIndex, setKnowledgeWikiIndex] = useState<WikiIndexResult | null>(null);
  const [knowledgeWikiPage, setKnowledgeWikiPage] = useState<WikiPageResult | null>(null);
  const [knowledgeWikiLoading, setKnowledgeWikiLoading] = useState(false);
  const [knowledgeEnrichStarting, setKnowledgeEnrichStarting] = useState(false);
  const [knowledgeExtractionView, setKnowledgeExtractionView] = useState(false);
  const [knowledgeScanActivity, setKnowledgeScanActivity] = useState<KnowledgeScanActivity>(null);
  // W7 P1/P3: 소스별 diff 견적 — [변경 확인]과 시작 diff가 함께 갱신하는 공용 상태.
  const [knowledgeDiffBySource, setKnowledgeDiffBySource] = useState<Record<string, KnowledgeDiffEntry>>({});
  // W7 P3 §9: 시작 시 지식폴더 변경 감지 토글(기본 켬, localStorage 유지).
  const [startupDiffEnabled, setStartupDiffEnabledState] = useState<boolean>(() => readStartupDiffEnabled());
  // 시작 diff는 앱 세션당 1회만 실행한다(토글을 껐다 켜도 재실행하지 않음).
  const startupDiffRanRef = useRef(false);
  const [expandedIngestionLogJobId, setExpandedIngestionLogJobId] = useState("");
  const [knowledgeIngestionLogDumps, setKnowledgeIngestionLogDumps] = useState<
    Record<string, KnowledgeIngestionLogDump>
  >({});
  const [expandedWorkJobId, setExpandedWorkJobId] = useState("");
  const [workJobEvents, setWorkJobEvents] = useState<Record<string, WorkJobEventItem[]>>({});
  const [workJobEventLoadingId, setWorkJobEventLoadingId] = useState("");
  const [knowledgeInspectorLoading, setKnowledgeInspectorLoading] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<DesktopRuntimeStatus | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeStarting, setRuntimeStarting] = useState(false);
  const autoRestartHandledRef = useRef<string | null>(null);
  const autoStartAttemptedRef = useRef(false);
  const lastSettingsSyncRef = useRef<string>("");
  const pendingApprovalCountRef = useRef(0);
  const runtimePanelRef = useRef<HTMLDivElement | null>(null);
  const runtimeIndicatorButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const documentTemplateInputRef = useRef<HTMLInputElement | null>(null);
  const chatDetailsPanelRef = useRef<HTMLDivElement | null>(null);
  const chatDetailsButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatThreadRef = useRef<HTMLDivElement | null>(null);
  const chatSessionScrollStateRef = useRef<{ sessionId: string; messageCount: number; lastMessageSignature: string }>({
    sessionId: "",
    messageCount: 0,
    lastMessageSignature: "",
  });
  // W5-1: 업무대화 메뉴 재진입 감지용 — 메뉴가 chat이 되는 순간 스레드를 맨 아래로 내린다.
  const chatScrollLastMenuRef = useRef<MenuKey | null>(null);
  // F-20: 이미 토스트로 알린 due 리마인더 일정 id (중복 토스트 방지 — ack는 일정 화면 배너 담당).
  const notifiedReminderIdsRef = useRef<Set<string>>(new Set());
  // 언마운트 후 완료되는 비동기 새로고침이 setState를 호출하지 않도록 하는 가드.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const toastIdRef = useRef(0);
  const toastTimeoutsRef = useRef<Map<number, number>>(new Map());
  const toastItemsRef = useRef<ToastItem[]>([]);
  const [detailCard, setDetailCard] = useState<DetailCardState>(null);
  const [selectedResponseContext, setSelectedResponseContext] = useState<string | null>(null);
  const [documentForm, setDocumentForm] = useState({
    title: "",
    purpose: "보고서형",
    template_key: "" as "" | "report" | "meeting" | "review",
    outline: "",
    document_format: "onePageReport" as DocumentFormat,
    audience_type: "",
    expected_length: "",
    urgency_level: "",
    needs_traceability: "",
    requires_official_form: "",
    requested_action: "",
    deadline: "",
    security_level: "",
    direct_file_paths_text: "",
    file_usage_note: "",
    user_template_path: "",
  });
  const [documentSourceMode, setDocumentSourceMode] = useState<"session" | "direct">("direct");
  const [authoringFormats, setAuthoringFormats] = useState<AuthoringFormatItem[]>(AUTHORING_FORMAT_FALLBACK);
  const [authoringFormatKey, setAuthoringFormatKey] = useState("onePageReport");
  const [authoringTab, setAuthoringTab] = useState<AuthoringTabKey>("references");
  const [authoringInstruction, setAuthoringInstruction] = useState("");
  const [authoringStageEvents, setAuthoringStageEvents] = useState<AuthoringStageEvent[]>([]);
  const [authoringStreaming, setAuthoringStreaming] = useState(false);
  const [authoringStructure, setAuthoringStructure] = useState<Record<string, unknown> | null>(null);
  const [authoringStructureFormat, setAuthoringStructureFormat] = useState("");
  const [authoringPreview, setAuthoringPreview] = useState("");
  const [authoringMeta, setAuthoringMeta] = useState<AuthoringStructureMeta | null>(null);
  const [authoringEditorView, setAuthoringEditorView] = useState<"tree" | "json">("tree");
  const [authoringJsonDraft, setAuthoringJsonDraft] = useState("");
  const [authoringJsonError, setAuthoringJsonError] = useState<string | null>(null);
  const [authoringBuildResult, setAuthoringBuildResult] = useState<AuthoringBuildResult | null>(null);
  const [authoringBuildHints, setAuthoringBuildHints] = useState<string[]>([]);
  const [authoringError, setAuthoringError] = useState<string | null>(null);
  const authoringAbortRef = useRef<AbortController | null>(null);
  const [documentSourceSessionId, setDocumentSourceSessionId] = useState("");
  const [customDocumentTemplates, setCustomDocumentTemplates] = useState<CustomDocumentTemplateItem[]>([]);
  const [finalizeForm, setFinalizeForm] = useState({
    output_name: "",
  });
  const [lastFinalizeRequest, setLastFinalizeRequest] = useState<FinalDocumentRequestResult | null>(null);
  const [contextPanelVisibility, setContextPanelVisibility] = useState<Record<ContextPanelKey, boolean>>({
    context: true,
    approvals: true,
    jobs: true,
    logs: true,
    upcoming: true,
    dump: true,
  });
  const [contextPaneOpen, setContextPaneOpen] = useState(true);
  const [contextPaneWidth, setContextPaneWidth] = useState(340);
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState<Record<ContextPanelKey, boolean>>({
    context: false,
    approvals: false,
    jobs: false,
    logs: false,
    upcoming: false,
    dump: false,
  });
  // C-09: 자동 열림이 억제된 섹션의 알림 수. 렌더링(배지 UI)은 다음 배치 ContextPane 소유.
  const [paneBadges, setPaneBadges] = useState<Record<ContextPanelKey, number>>({
    context: 0,
    approvals: 0,
    jobs: 0,
    logs: 0,
    upcoming: 0,
    dump: 0,
  });
  // J-11/G-01: silent 폴링 실패는 토스트 대신 이 플래그로 상단 배너를 유지한다.
  const [engineUnreachable, setEngineUnreachable] = useState(false);
  const [deferredLoadState, setDeferredLoadState] = useState<
    Record<WorkspaceDeferredGroup, "idle" | "loading" | "loaded" | "failed">
  >({
    knowledge: "idle",
    logs: "idle",
  });
  const contextPaneResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [runtimePanelOpen, setRuntimePanelOpen] = useState(false);
  // W6: 최초 실행 튜토리얼 — 완료 플래그가 없으면 앱 로드 후 1회 자동 표시.
  const [tutorialOpen, setTutorialOpen] = useState(() => shouldAutoOpenTutorial());

  function openTutorial() {
    setTutorialOpen(true);
  }

  /** W7 P3 §9: 시작 diff 토글 변경 — localStorage에 유지하고 즉시 반영한다. */
  function setStartupDiffEnabled(next: boolean) {
    try {
      window.localStorage.setItem(STARTUP_DIFF_STORAGE_KEY, next ? "on" : "off");
    } catch {
      // 저장 실패 시에도 이번 세션에는 반영한다.
    }
    setStartupDiffEnabledState(next);
  }

  function completeTutorial() {
    try {
      window.localStorage.setItem(TUTORIAL_DONE_STORAGE_KEY, new Date().toISOString());
    } catch {
      // 저장 실패 시에도 이번 세션에서는 닫는다.
    }
    setTutorialOpen(false);
  }

  const deferredLogs = useDeferredValue(snapshot.logs);
  const defaultTemplateKey = snapshot.settings?.defaults.default_template_key ?? "report";
  const activeTemplateKey = documentForm.template_key || defaultTemplateKey;
  const currentContentBaseSignature = [
    documentForm.title,
    documentForm.purpose,
    activeTemplateKey,
    documentSourceMode,
    documentSourceSessionId || "",
    documentForm.outline,
    documentForm.document_format,
    documentForm.audience_type,
    documentForm.expected_length,
    documentForm.urgency_level,
    documentForm.needs_traceability,
    documentForm.requires_official_form,
    documentForm.requested_action,
    documentForm.deadline,
    documentForm.security_level,
    documentForm.direct_file_paths_text,
    documentForm.file_usage_note,
    documentForm.user_template_path,
  ].join("\u0001");
  const pendingApprovals = snapshot.approvalTickets.filter((ticket) => ticket.status === "pending");
  const normalizedSessionRailQuery = sessionRailQuery.trim().toLowerCase();
  const filteredWorkSessions =
    snapshot.workSessions.filter((session) => {
      if (normalizedSessionRailQuery.length === 0) {
        return true;
      }

      const linkedSchedule = snapshot.schedules.find((schedule) => schedule.id === session.schedule_id);
      const haystack = [session.title, linkedSchedule?.title ?? "", latestSessionPreview(session)]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSessionRailQuery);
    });
  const currentFinalizeTicket = lastFinalizeRequest
    ? snapshot.approvalTickets.find(
        (ticket) => ticket.id === lastFinalizeRequest.approval_ticket.id,
      ) ?? lastFinalizeRequest.approval_ticket
    : null;
  const canApplyFinalize = currentFinalizeTicket?.status === "approved";
  const finalizeAlreadyApplied = lastFinalizeRequest?.final_document_output.status === "applied";
  const activeMenuMeta =
    activeMenu === "home"
      ? HOME_MENU_META
      : MENU_ITEMS.find((item) => item.key === activeMenu) ?? MENU_ITEMS[0];
  const unmanagedRuntimeReachable =
    runtimeStatus?.available && runtimeStatus.running && !runtimeStatus.managed;

  function buildSettingsFormFromProfiles(
    profiles: WorkspaceLlmProfiles,
    mode: "local_first" | "internal_server" | "external_model",
    provider: string | undefined,
    defaultTemplateKey: "report" | "meeting" | "review",
    personalizationApplyMode: "approval_required" | "auto_apply" = settingsForm.personalization_apply_mode,
    personalizationRoot = settingsForm.personalization_root,
  ) {
    const profile = getLlmProfileForSelection(profiles, mode, provider);
    return {
      llm_mode: mode,
      llm_provider: profile.provider,
      llm_model: profile.model,
      llm_api_key: profile.api_key ?? "",
      llm_site_url: profile.site_url ?? "",
      llm_application_name: profile.application_name ?? "",
      default_template_key: defaultTemplateKey,
      internal_api_base_url: profile.base_url ?? "",
      personalization_apply_mode: personalizationApplyMode,
      personalization_root: personalizationRoot,
    };
  }

  function commitSettingsFormToProfiles(
    profiles: WorkspaceLlmProfiles,
    form: typeof settingsForm,
  ): WorkspaceLlmProfiles {
    const nextProfiles = cloneWorkspaceLlmProfiles(profiles);
    const profile = getLlmProfileForSelection(nextProfiles, form.llm_mode, form.llm_provider);
    profile.provider = form.llm_provider.trim() || profile.provider;
    profile.model = form.llm_model.trim();
    profile.api_key = form.llm_api_key.trim() || null;
    profile.base_url = form.internal_api_base_url.trim() || null;
    profile.site_url = form.llm_site_url.trim() || null;
    profile.application_name = form.llm_application_name.trim() || null;
    if (form.llm_mode === "external_model") {
      nextProfiles.external_model.active_provider = form.llm_provider.trim() || nextProfiles.external_model.active_provider;
    }
    return nextProfiles;
  }

  function applySettingsFormPatch(
    updater:
      | Partial<typeof settingsForm>
      | ((current: typeof settingsForm) => typeof settingsForm),
  ) {
    setSettingsForm((current) => {
      const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
      setSettingsProfiles((prev) => commitSettingsFormToProfiles(prev, next));
      return next;
    });
  }

  function dropToastFromState(id: number) {
    toastItemsRef.current = toastItemsRef.current.filter((toast) => toast.id !== id);
    setToastItems(toastItemsRef.current);
  }

  function scheduleToastDismiss(id: number, tone: ToastItem["tone"]) {
    const existingTimeout = toastTimeoutsRef.current.get(id);
    if (existingTimeout !== undefined) {
      window.clearTimeout(existingTimeout);
    }
    const timeoutId = window.setTimeout(() => {
      toastTimeoutsRef.current.delete(id);
      dropToastFromState(id);
    }, tone === "error" ? 7000 : 4500);
    toastTimeoutsRef.current.set(id, timeoutId);
  }

  function pushToast(tone: ToastItem["tone"], message: string) {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }
    // 같은 내용의 토스트가 떠 있으면 새로 쌓지 않고 표시 시간만 연장한다.
    const duplicate = toastItemsRef.current.find((toast) => toast.tone === tone && toast.message === trimmed);
    if (duplicate) {
      scheduleToastDismiss(duplicate.id, tone);
      return;
    }
    const id = ++toastIdRef.current;
    toastItemsRef.current = [...toastItemsRef.current, { id, tone, message: trimmed }];
    setToastItems(toastItemsRef.current);
    scheduleToastDismiss(id, tone);
  }

  function removeToast(id: number) {
    const timeoutId = toastTimeoutsRef.current.get(id);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      toastTimeoutsRef.current.delete(id);
    }
    dropToastFromState(id);
  }

  useEffect(() => {
    return () => {
      for (const timeoutId of toastTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      toastTimeoutsRef.current.clear();
    };
  }, []);

  async function openKnowledgeLogDumpFolder(logDumpPath: string) {
    const folderPath = parentPathFromPath(logDumpPath);
    if (!folderPath) {
      pushToast("error", "열 수 있는 로그 폴더 경로가 없습니다.");
      return;
    }
    try {
      await openExternalTarget(folderPath);
    } catch (error) {
      console.warn("failed to open knowledge wiki log dump folder", error);
      pushToast("error", "지식위키 로그 폴더를 열지 못했습니다.");
    }
  }

  async function toggleKnowledgeLogDump(job: KnowledgeIngestionJobItem) {
    if (expandedIngestionLogJobId === job.id) {
      setExpandedIngestionLogJobId("");
      return;
    }
    setExpandedIngestionLogJobId(job.id);
    revealContextSection("dump");
    if (knowledgeIngestionLogDumps[job.id]) {
      return;
    }
    try {
      const dump = await loadKnowledgeIngestionJobLog(job.id, 120);
      setKnowledgeIngestionLogDumps((current) => ({ ...current, [job.id]: dump }));
    } catch (error) {
      console.warn("failed to load knowledge wiki log dump", error);
      pushToast("error", "색인 상세 로그를 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    if (!lastContentBase || !lastContentBaseSignature) {
      return;
    }

    if (lastContentBaseSignature === currentContentBaseSignature) {
      return;
    }

    setLastContentBase(null);
    setLastContentBaseSignature(null);
    setLastFinalizeRequest(null);
    setFinalizeForm({ output_name: "" });
    setNotice("초안 조건이 바뀌었습니다. 최종 저장 전에 작성 콘텐츠를 다시 생성하세요.");
  }, [currentContentBaseSignature, lastContentBase, lastContentBaseSignature]);

  useEffect(() => {
    if (!snapshot.settings) {
      return;
    }
    // 셸 스냅샷은 5초 주기로 새 객체가 내려오므로, 서버 설정 값이 실제로 바뀐
    // 경우에만 편집 폼을 재초기화한다 (편집 중 초안이 폴링에 덮어써지는 것 방지).
    const settingsSignature = JSON.stringify([
      snapshot.settings.defaults,
      snapshot.settings.paths.personalization_root,
    ]);
    if (settingsSignature === lastSettingsSyncRef.current) {
      return;
    }
    lastSettingsSyncRef.current = settingsSignature;
    setSettingsProfiles(cloneWorkspaceLlmProfiles(snapshot.settings.defaults.profiles));
    setSettingsForm(
      buildSettingsFormFromProfiles(
        snapshot.settings.defaults.profiles,
        snapshot.settings.defaults.llm_mode,
        snapshot.settings.defaults.llm_provider,
        snapshot.settings.defaults.default_template_key,
        snapshot.settings.defaults.personalization_apply_mode,
        snapshot.settings.paths.personalization_root,
      ),
    );
  }, [snapshot.settings]);

  useEffect(() => {
    if (!runtimePanelOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (runtimePanelRef.current?.contains(target)) {
        return;
      }

      if (runtimeIndicatorButtonRef.current?.contains(target)) {
        return;
      }

      setRuntimePanelOpen(false);
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setRuntimePanelOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [runtimePanelOpen]);

  useEffect(() => {
    setSessionMessages(
      Object.fromEntries(
        snapshot.workSessions.map((session) => [session.id, session.messages ?? []]),
      ),
    );
  }, [snapshot.workSessions]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    pushToast("info", notice);
    setNotice(null);
  }, [notice]);

  useEffect(() => {
    if (activeMenu !== "documents") {
      return;
    }
    let cancelled = false;
    loadCustomDocumentTemplates()
      .then((response) => {
        if (!cancelled) {
          setCustomDocumentTemplates(response.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCustomDocumentTemplates([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeMenu]);

  useEffect(() => {
    if (!error) {
      return;
    }
    pushToast("error", error);
    setError(null);
  }, [error]);

  useEffect(() => {
    const imagePreviews = chatAttachments
      .filter((attachment) => attachment.file.type.startsWith("image/"))
      .map((attachment) => ({
        key: attachment.id,
        attachmentId: attachment.id,
        name: attachment.file.name,
        url: typeof URL.createObjectURL === "function" ? URL.createObjectURL(attachment.file) : "",
      }))
      .filter((preview) => preview.url);

    setChatAttachmentPreviews(imagePreviews);
    return () => {
      imagePreviews.forEach((preview) => {
        if (typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(preview.url);
        }
      });
    };
  }, [chatAttachments]);

  useEffect(() => {
    if (!chatDetailsOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (chatDetailsPanelRef.current?.contains(target)) {
        return;
      }

      if (chatDetailsButtonRef.current?.contains(target)) {
        return;
      }

      setChatDetailsOpen(false);
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setChatDetailsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [chatDetailsOpen]);

  useEffect(() => {
    if (!chatImagePreviewOpen) {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setChatImagePreviewOpen(null);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [chatImagePreviewOpen]);

  async function refreshSnapshot(options: { silent?: boolean } = {}) {
    if (!options.silent) {
      setLoading(true);
    }
    try {
      const next = await loadWorkspaceSnapshot();
      if (!isMountedRef.current) {
        return;
      }
      startTransition(() => {
        setSnapshot(next);
      });
      if (!selectedScheduleId && next.schedules[0]) {
        setSelectedScheduleId(next.schedules[0].id);
      }
      if (!selectedSessionId && next.workSessions[0]) {
        setSelectedSessionId(next.workSessions[0].id);
      }
      setEngineUnreachable(false);
      setError(null);
    } catch (loadError) {
      if (!isMountedRef.current) {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "워크스페이스를 불러오지 못했습니다.");
    } finally {
      if (!options.silent && isMountedRef.current) {
        setLoading(false);
      }
    }
  }

  async function refreshKnowledgeIngestionJobsOnly() {
    try {
      const response = await loadKnowledgeIngestionJobs();
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          knowledgeIngestionJobs: response.items,
        }));
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "지식위키 색인 상태를 불러오지 못했습니다.");
    }
  }

  function mergeKnowledgeIngestionJob(job: KnowledgeIngestionJobItem) {
    setSnapshot((current) => ({
      ...current,
      knowledgeIngestionJobs: [
        job,
        ...current.knowledgeIngestionJobs.filter((currentJob) => currentJob.id !== job.id),
      ],
    }));
  }

  async function refreshShellSnapshot(options: { silent?: boolean; includeConfig?: boolean } = {}) {
    const includeConfig = options.includeConfig ?? true;
    if (!options.silent) {
      setLoading(true);
    }
    try {
      const next = await loadWorkspaceShellSnapshot({ includeConfig });
      if (!isMountedRef.current) {
        return;
      }
      startTransition(() => {
        setSnapshot((current) =>
          mergeWorkspaceSnapshot(current, {
            // 셸 폴링은 셸 필드만 갱신한다 — 전체 스냅샷을 merge하면
            // 지연 로드된 지식/로그 데이터가 빈 기본값으로 덮어써진다.
            health: next.health,
            runtimeReady: next.runtimeReady,
            runtimeMetrics: next.runtimeMetrics,
            schedules: next.schedules,
            workSessions: next.workSessions,
            approvalTickets: next.approvalTickets,
            workJobs: next.workJobs,
            // D-03: 설정/템플릿은 초기 로드와 변경 직후에만 갱신한다.
            ...(includeConfig ? { settings: next.settings, templates: next.templates } : {}),
          }),
        );
      });
      if (!selectedScheduleId && next.schedules[0]) {
        setSelectedScheduleId(next.schedules[0].id);
      }
      if (!selectedSessionId && next.workSessions[0]) {
        setSelectedSessionId(next.workSessions[0].id);
      }
      setEngineUnreachable(false);
      setError(null);
    } catch (loadError) {
      if (!isMountedRef.current) {
        return;
      }
      const message =
        loadError instanceof Error ? loadError.message : "워크스페이스 핵심 정보를 불러오지 못했습니다.";
      if (options.silent) {
        // J-11/G-01: silent 폴링 실패는 토스트 대신 배너 플래그만 세운다.
        console.warn("silent shell snapshot refresh failed", loadError);
        setEngineUnreachable(true);
      } else {
        setError(message);
      }
    } finally {
      if (!options.silent && isMountedRef.current) {
        setLoading(false);
      }
    }
  }

  // D-03: 활성 작업 폴링은 /api/jobs?limit=20 하나만 갱신한다.
  async function refreshWorkJobsOnly() {
    try {
      const patch = await loadWorkJobsOnly();
      startTransition(() => {
        setSnapshot((current) => mergeWorkspaceSnapshot(current, patch));
      });
      setEngineUnreachable(false);
    } catch (loadError) {
      // silent 폴링 실패는 토스트 대신 배너 플래그만 세운다.
      console.warn("silent work jobs refresh failed", loadError);
      setEngineUnreachable(true);
    }
  }

  async function refreshDeferredSnapshot(group: WorkspaceDeferredGroup) {
    setDeferredLoadState((current) => ({ ...current, [group]: "loading" }));
    try {
      const patch = await loadWorkspaceDeferredSnapshot(group);
      // 언마운트 뒤 도착한 응답은 버린다 (테스트 teardown 후 setState 방지).
      if (!isMountedRef.current) return;
      startTransition(() => {
        setSnapshot((current) => mergeWorkspaceSnapshot(current, patch));
      });
      setDeferredLoadState((current) => ({ ...current, [group]: "loaded" }));
    } catch (loadError) {
      if (!isMountedRef.current) return;
      setDeferredLoadState((current) => ({ ...current, [group]: "failed" }));
      setError(loadError instanceof Error ? loadError.message : "지연 데이터를 불러오지 못했습니다.");
    }
  }

  async function refreshRuntimeStatus(options: { silent?: boolean } = {}) {
    setRuntimeLoading(true);
    try {
      const next = await loadDesktopRuntimeStatus();
      setRuntimeStatus(next);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "런타임 상태를 불러오지 못했습니다.";
      if (options.silent) {
        // J-11/G-01: silent 폴링 실패는 토스트를 띄우지 않는다 (엔진 배너가 상태를 대신 알린다).
        console.warn("silent runtime status refresh failed", loadError);
      } else {
        setError(message);
      }
    } finally {
      setRuntimeLoading(false);
    }
  }

  async function handleRecoverSidecar() {
    setRuntimeLoading(true);
    setNotice(null);
    setError(null);
    try {
      const next = await loadDesktopRuntimeStatus();
      setRuntimeStatus(next);
      setNotice(
        next.running && !next.managed
          ? "외부 업무 엔진이 아직 실행 중입니다. 외부 프로세스를 닫은 뒤 관리형 업무 엔진을 다시 시작하세요."
          : "런타임 상태를 새로고침했습니다.",
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "런타임 상태를 새로고침하지 못했습니다.");
    } finally {
      setRuntimeLoading(false);
    }
  }

  /**
   * F-20(절반): 사전 알림 창에 들어온 일정을 30초 하트비트에 얹어 폴링한다.
   * api.ts는 병렬 배치에서 수정 중이므로 requestJson 대신 직접 fetch 하고,
   * 엔드포인트 부재(404)나 네트워크 오류는 조용히 무시한다.
   * due 항목당 토스트는 1회만 띄우고(paneBadges upcoming 배지 증가),
   * ack 처리는 일정 화면 배너가 담당한다.
   */
  async function pollDueScheduleReminders() {
    try {
      const response = await fetch(`${SIDECAR_BASE_URL}/api/schedules/reminders/due`);
      if (!response || !response.ok) {
        return;
      }
      const payload = (await response.json()) as { items?: Array<{ id?: string; title?: string }> };
      if (!isMountedRef.current) {
        return;
      }
      const items = Array.isArray(payload?.items) ? payload.items : [];
      let newlyDueCount = 0;
      for (const item of items) {
        if (!item || typeof item.id !== "string" || item.id.length === 0) {
          continue;
        }
        if (notifiedReminderIdsRef.current.has(item.id)) {
          continue;
        }
        notifiedReminderIdsRef.current.add(item.id);
        newlyDueCount += 1;
        pushToast("info", `곧 시작: ${item.title ?? "제목 없는 일정"}`);
      }
      if (newlyDueCount > 0) {
        setPaneBadges((current) => ({
          ...current,
          upcoming: (current.upcoming ?? 0) + newlyDueCount,
        }));
      }
    } catch {
      // 엔진 미기동/엔드포인트 부재 — 다음 폴링에서 다시 시도한다.
    }
  }

  useEffect(() => {
    void refreshShellSnapshot();
    void refreshRuntimeStatus();
    void pollDueScheduleReminders();
  }, []);

  useEffect(() => {
    const deferredGroupByMenu: Partial<Record<MenuKey, WorkspaceDeferredGroup>> = {
      knowledge: "knowledge",
      logs: "logs",
    };
    const group = deferredGroupByMenu[activeMenu];
    if (!group || deferredLoadState[group] !== "idle") {
      return;
    }
    void refreshDeferredSnapshot(group);
  }, [activeMenu, deferredLoadState]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSelectedSessionFileLinks([]);
      return;
    }

    let alive = true;
    void loadWorkSessionFileLinks(selectedSessionId)
      .then((response) => {
        if (alive) {
          setSelectedSessionFileLinks(response.items);
        }
      })
      .catch(() => {
        if (alive) {
          setSelectedSessionFileLinks([]);
        }
      });

    return () => {
      alive = false;
    };
  }, [selectedSessionId, snapshot.workSessions.length]);

  useEffect(() => {
    if (!runtimeStatus?.available) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshRuntimeStatus({ silent: true });
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [runtimeStatus?.available]);

  useEffect(() => {
    const hasActiveKnowledgeJobs = snapshot.knowledgeIngestionJobs.some((job) =>
      ["queued", "running"].includes(job.status),
    );
    if (activeMenu !== "knowledge" || knowledgePanel !== "indexing" || !hasActiveKnowledgeJobs) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshKnowledgeIngestionJobsOnly();
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeMenu, knowledgePanel, snapshot.knowledgeIngestionJobs]);

  useEffect(() => {
    if (!(snapshot.workJobs ?? []).some(isActiveWorkJob)) {
      return;
    }

    // D-03: 활성 작업이 있는 동안에는 /api/jobs?limit=20 하나만 1.5초 주기로 폴링한다.
    const intervalId = window.setInterval(() => {
      void refreshWorkJobsOnly();
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [snapshot.workJobs]);

  useEffect(() => {
    // D-03: 활성 작업과 무관하게 30초마다 셸 스냅샷을 갱신하는 유휴 하트비트.
    // 설정/템플릿은 초기 로드와 변경 직후에만 가져온다 (includeConfig: false).
    // F-20: due 리마인더 폴링도 같은 하트비트에 얹는다.
    const intervalId = window.setInterval(() => {
      void refreshShellSnapshot({ silent: true, includeConfig: false });
      void pollDueScheduleReminders();
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    // W7 P3 §9(v2 시작 diff — 승인값: 감지·배지 자동 on, 색인 자동 실행 off):
    // 앱 로드 후 유휴 10초 뒤 1회, 첫 지식폴더의 변경 견적(stat-only diff)만 조회해
    // 대시보드 "미반영 변경 N건" 표기를 갱신한다. 색인은 절대 자동 실행하지 않으며,
    // 실패(엔진 미기동·구버전 서버·소스 없음)는 사용자에게 알리지 않고 조용히 무시한다.
    if (!startupDiffEnabled || startupDiffRanRef.current) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      startupDiffRanRef.current = true;
      void (async () => {
        try {
          const sources = await fetchKnowledgeSources();
          const primary = sources.items[0];
          if (!primary || primary.status === "missing") {
            return;
          }
          const result = await diffKnowledgeSource(primary.id);
          if (!isMountedRef.current) {
            return;
          }
          setKnowledgeDiffBySource((current) => ({
            ...current,
            [primary.id]: {
              result,
              sourceLabel: primary.label,
              checkedAt: new Date().toISOString(),
            },
          }));
        } catch {
          // §9 P3: 시작 diff 실패는 조용히 무시한다(다음 수동 [변경 확인]으로 대체).
        }
      })();
    }, STARTUP_DIFF_IDLE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [startupDiffEnabled]);

  useEffect(() => {
    // C-06: 세션이나 메뉴가 바뀌면 이전 세션의 응답 맥락 상세를 초기화한다.
    setSelectedResponseContext(null);
  }, [selectedSessionId, activeMenu]);

  useEffect(() => {
    if (!runtimeStatus?.available || runtimeStatus.running || runtimeStarting || autoStartAttemptedRef.current) {
      return;
    }

    autoStartAttemptedRef.current = true;
    void handleStartSidecar();
  }, [runtimeStarting, runtimeStatus?.available, runtimeStatus?.running]);

  useEffect(() => {
    if (!runtimeStatus?.running) {
      return;
    }

    if (snapshot.health?.status === "ok") {
      return;
    }

    void refreshSnapshot();
  }, [runtimeStatus?.running, snapshot.health?.status]);

  useEffect(() => {
    let disposed = false;
    let unlistenTauri: UnlistenFn | null = null;
    let unlistenWindowMenu: UnlistenFn | null = null;
    let unlistenWindowZoom: UnlistenFn | null = null;
    let currentWebviewWindow: ReturnType<typeof getCurrentWebviewWindow> | null = null;

    try {
      currentWebviewWindow = getCurrentWebviewWindow();
    } catch {
      currentWebviewWindow = null;
    }

    function handleMenuAction(action: string) {
      if (action === "view.refresh") {
        void refreshSnapshot();
      }
    }

    const handleBrowserMenuAction = (event: Event) => {
      const payload = (event as CustomEvent<string>).detail;
      if (typeof payload === "string") {
        handleMenuAction(payload);
      }
    };

    const handleBrowserZoomScale = (event: Event) => {
      const payload = (event as CustomEvent<number>).detail;
      if (typeof payload === "number") {
        setUiFontScale(Number(payload.toFixed(2)));
      }
    };

    const handleBrowserZoomBlocked = (event: Event) => {
      const payload = (event as CustomEvent<string>).detail;
      if (typeof payload === "string" && payload.trim()) {
        setNotice(payload);
      }
    };

    window.addEventListener("gongmu-menu-action", handleBrowserMenuAction as EventListener);
    window.addEventListener("gongmu-zoom-scale", handleBrowserZoomScale as EventListener);
    window.addEventListener("gongmu-zoom-blocked", handleBrowserZoomBlocked as EventListener);

    void listen<string>("gongmu-menu-action", (event) => {
        if (!disposed && typeof event.payload === "string") {
          handleMenuAction(event.payload);
        }
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenTauri = unlisten;
        }
      })
      .catch(() => {
        // Browser tests run without a Tauri event bridge.
      });

    if (currentWebviewWindow) {
      void currentWebviewWindow
        .listen<string>("gongmu-menu-action", (event) => {
          if (!disposed && typeof event.payload === "string") {
            handleMenuAction(event.payload);
          }
        })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlistenWindowMenu = unlisten;
          }
        })
        .catch(() => {
          // Browser tests run without a Tauri window bridge.
        });

      void currentWebviewWindow
        .listen<number>("gongmu-zoom-scale", (event) => {
          if (!disposed && typeof event.payload === "number") {
            setUiFontScale(Number(event.payload.toFixed(2)));
          }
        })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlistenWindowZoom = unlisten;
          }
        })
        .catch(() => {
          // Browser tests run without a Tauri window bridge.
        });

      void currentWebviewWindow
        .listen<string>("gongmu-zoom-blocked", (event) => {
          if (!disposed && typeof event.payload === "string" && event.payload.trim()) {
            setNotice(event.payload);
          }
        })
        .catch(() => {
          // Browser tests run without a Tauri window bridge.
        });
    }

    return () => {
      disposed = true;
      window.removeEventListener("gongmu-menu-action", handleBrowserMenuAction as EventListener);
      window.removeEventListener("gongmu-zoom-scale", handleBrowserZoomScale as EventListener);
      window.removeEventListener("gongmu-zoom-blocked", handleBrowserZoomBlocked as EventListener);
      if (unlistenTauri) {
        unlistenTauri();
      }
      if (unlistenWindowMenu) {
        unlistenWindowMenu();
      }
      if (unlistenWindowZoom) {
        unlistenWindowZoom();
      }
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!contextPaneResizeRef.current) {
        return;
      }
      const delta = contextPaneResizeRef.current.startX - event.clientX;
      const nextWidth = Math.min(520, Math.max(260, contextPaneResizeRef.current.startWidth + delta));
      setContextPaneWidth(nextWidth);
    };

    const handleMouseUp = () => {
      contextPaneResizeRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    if (pendingApprovals.length > pendingApprovalCountRef.current) {
      revealContextSection("approvals");
    }
    pendingApprovalCountRef.current = pendingApprovals.length;
  }, [pendingApprovals.length]);

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
    void Promise.allSettled([fetchWikiTree(), loadKnowledgeBackendStatus(), loadKnowledgeParserStatus()])
      .then(([treeResult, backendResult, parserResult]) => {
        if (!alive) {
          return;
        }
        // 위키 트리 엔드포인트가 아직 없거나(404) 비어 있으면 index.md 폴백을 사용한다.
        setKnowledgeWikiTree(treeResult.status === "fulfilled" ? treeResult.value : null);
        if (backendResult.status === "fulfilled") {
          setKnowledgeBackendStatus(backendResult.value);
        }
        if (parserResult.status === "fulfilled") {
          setKnowledgeParserStatus(parserResult.value);
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
  }, [activeMenu, snapshot.knowledgePages.length, snapshot.knowledgeSourceFiles.length]);

  useEffect(() => {
    if (activeMenu !== "documents") {
      return;
    }

    let alive = true;
    void fetchAuthoringFormats()
      .then((payload) => {
        if (alive && payload.items.length > 0) {
          setAuthoringFormats(payload.items);
        }
      })
      .catch(() => {
        // 양식 목록을 불러오지 못하면 정적 기본값을 유지한다.
      });

    return () => {
      alive = false;
    };
  }, [activeMenu]);

  useEffect(() => {
    if (activeMenu !== "knowledge" || knowledgePanel !== "wiki" || knowledgeWikiIndex) {
      return;
    }

    let alive = true;
    setKnowledgeWikiLoading(true);
    void fetchWikiIndex()
      .then((payload) => {
        if (alive) {
          setKnowledgeWikiIndex(payload);
        }
      })
      .catch((wikiError) => {
        if (alive) {
          setError(wikiError instanceof Error ? wikiError.message : "지식위키 목차를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (alive) {
          setKnowledgeWikiLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [activeMenu, knowledgePanel, knowledgeWikiIndex]);

  function clearPaneBadge(section: ContextPanelKey) {
    setPaneBadges((current) => (current[section] === 0 ? current : { ...current, [section]: 0 }));
  }

  /**
   * C-09: 자동 열림 정책.
   * 승인 요청(approvals)과 실패 흐름(options.force)만 패널을 강제로 연다.
   * 그 외 호출은 사용자의 패널 상태를 존중하고, 섹션이 보이지 않는 경우
   * paneBadges 카운터만 올린다 (배지 렌더링은 다음 배치 ContextPane 소유).
   */
  function revealContextSection(section: ContextPanelKey, options: { force?: boolean } = {}) {
    const shouldAutoOpen = section === "approvals" || options.force === true;

    if (!shouldAutoOpen) {
      const alreadyShown =
        contextPaneOpen && contextPanelVisibility[section] && !contextPanelCollapsed[section];
      if (!alreadyShown) {
        setPaneBadges((current) => ({ ...current, [section]: (current[section] ?? 0) + 1 }));
      }
      return;
    }

    setContextPaneOpen(true);
    setContextPanelVisibility((current) => ({
      ...current,
      [section]: true,
    }));
    setContextPanelCollapsed((current) => ({
      ...current,
      [section]: false,
    }));
    clearPaneBadge(section);
  }

  function openResponseContextDetail(label: string) {
    setSelectedResponseContext(label);
    revealContextSection("context");
  }

  async function handleAction<T>(action: () => Promise<T>, successMessage: string, options: ActionOptions) {
    setSubmitting(true);
    setNotice(null);
    setError(null);
    try {
      const result = await action();
      if (options.refresh === "shell") {
        await refreshShellSnapshot({ silent: true });
      } else if (options.refresh === "full") {
        await refreshSnapshot();
      }
      if (options.revealSection) {
        revealContextSection(options.revealSection);
      }
      setNotice(successMessage);
      return result;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "요청을 처리하지 못했습니다.");
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelGenericWorkJob(job: WorkJobItem) {
    await handleAction(
      () => cancelWorkJob(job.id),
      `${job.title} 취소를 요청했습니다.`,
      { revealSection: "jobs", refresh: "shell" },
    );
  }

  async function toggleWorkJobEvents(job: WorkJobItem) {
    if (expandedWorkJobId === job.id) {
      setExpandedWorkJobId("");
      return;
    }
    setExpandedWorkJobId(job.id);
    if (workJobEvents[job.id]) {
      return;
    }
    setWorkJobEventLoadingId(job.id);
    try {
      const events = await loadWorkJobEvents(job.id);
      setWorkJobEvents((current) => ({ ...current, [job.id]: events.items }));
    } catch (eventError) {
      setError(eventError instanceof Error ? eventError.message : "작업 로그를 불러오지 못했습니다.");
    } finally {
      setWorkJobEventLoadingId("");
    }
  }

  async function handleStartSidecar() {
    setRuntimeStarting(true);
    setNotice(null);
    setError(null);
    try {
      const next = await startDesktopSidecar();
      setRuntimeStatus(next);
      await refreshShellSnapshot({ silent: true });
      revealContextSection("context");
      setNotice("업무 엔진 실행 상태를 갱신했습니다.");
    } catch (startError) {
      setError(userFacingRuntimeError(startError, "업무 엔진을 시작하지 못했습니다."));
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
      await refreshShellSnapshot({ silent: true });
      revealContextSection("context");
      setNotice("업무 엔진 종료 상태를 갱신했습니다.");
    } catch (stopError) {
      setError(userFacingRuntimeError(stopError, "업무 엔진을 종료하지 못했습니다."));
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
      await refreshShellSnapshot({ silent: true });
      revealContextSection("context");
      setNotice(
        autoTriggered
          ? "업무 엔진 비정상 종료를 감지해 다시 시작했습니다."
          : "업무 엔진 재시작 상태를 갱신했습니다.",
      );
    } catch (restartError) {
      setError(userFacingRuntimeError(restartError, "업무 엔진을 재시작하지 못했습니다."));
    } finally {
      setRuntimeStarting(false);
    }
  }

  const selectedProviderPreset = LLM_PROVIDER_PRESETS[normalizeProviderKey(settingsForm.llm_provider)];
  const selectedProviderAttributionLabel =
    selectedProviderPreset.attributionLabel ?? selectedProviderPreset.label;
  const selectedProviderSupportsAttributionHeaders =
    selectedProviderPreset.supportsAttributionHeaders ??
    selectedProviderPreset.supportsOpenRouterHeaders ??
    false;

  async function refreshSessionFileLinks(sessionId = selectedSessionId) {
    if (!sessionId) {
      setSelectedSessionFileLinks([]);
      return;
    }
    try {
      const response = await loadWorkSessionFileLinks(sessionId);
      setSelectedSessionFileLinks(response.items);
    } catch {
      setSelectedSessionFileLinks([]);
    }
  }

  function openChatFileLinkModal() {
    setChatFileLinkModalOpen(true);
  }

  function closeChatFileLinkModal() {
    setChatFileLinkModalOpen(false);
  }

  /**
   * D-04: 파일찾기 화면에서 이전한 공용 핸들러.
   * 로컬 파일 검색 결과 항목을 업무대화 세션에 연결한다.
   * (기본은 현재 선택된 세션, 필요하면 sessionId를 지정)
   */
  async function connectLocalFileToSession(
    hit: LocalFileSearchResult["items"][number],
    sessionId = selectedSessionId,
  ) {
    if (!sessionId) {
      setError("파일을 연결할 업무대화 세션을 먼저 선택해 주세요.");
      return;
    }

    const filePath = hit.file.file_path;
    const linked = await handleAction(
      () =>
        createWorkSessionFileLinks(sessionId, {
          items: [
            {
              file_path: filePath,
              label: hit.file.title || fileNameFromPath(filePath),
              source: "knowledge",
            },
          ],
        }),
      "파일을 현재 업무대화 세션에 연결했습니다.",
      { revealSection: "context", refresh: "none" },
    );

    if (linked) {
      await refreshSessionFileLinks(sessionId);
    }
  }

  async function decideApprovalTicket(ticket: ApprovalTicketItem, status: "approved" | "rejected") {
    await handleAction(
      () =>
        decideApproval(ticket.id, {
          status,
          decision_note: status === "approved" ? "UI 확인" : "UI 거절",
      }),
      `승인 요청을 ${status === "approved" ? "승인" : "거절"}했습니다.`,
      { revealSection: "approvals", refresh: "shell" },
    );
  }

  const activeKnowledgeIngestionJob =
    snapshot.knowledgeIngestionJobs.find((job) => ["running", "queued"].includes(job.status)) ?? null;
  const runningKnowledgeIngestion = snapshot.knowledgeIngestionJobs.some((job) => job.status === "running");
  const lockedKnowledgeIngestion = activeKnowledgeIngestionJob !== null;
  const knowledgeIngestionLockMessage = activeKnowledgeIngestionMessage(activeKnowledgeIngestionJob);

  const selectedSchedule = snapshot.schedules.find((item) => item.id === selectedScheduleId) ?? null;
  const selectedSession = snapshot.workSessions.find((item) => item.id === selectedSessionId) ?? null;
  const selectedSessionSchedule = selectedSession?.schedule_id
    ? snapshot.schedules.find((item) => item.id === selectedSession.schedule_id) ?? null
    : null;
  const selectedSessionMessages = selectedSession ? sessionMessages[selectedSession.id] ?? [] : [];
  const selectedSessionContextSummary = selectedSession ? sessionContextSummaries[selectedSession.id] ?? null : null;
  const selectedSessionContextEvidence = buildChatContextEvidence(
    selectedSessionContextSummary,
  );
  const latestSessionMessageSignature =
    selectedSessionMessages.length === 0
      ? "empty"
      : selectedSessionMessages
          .slice(-1)
          .map(
            (message) =>
              `${message.id}:${message.status ?? ""}:${message.text?.length ?? 0}:${message.created_at ?? ""}:${message.role}`,
          )[0]!;

  function scrollChatThreadToBottom() {
    const thread = chatThreadRef.current;
    if (!thread) {
      return;
    }

    const nextTop = Math.max(thread.scrollHeight - thread.clientHeight, 0);
    if (typeof thread.scrollTo === "function") {
      thread.scrollTo({ top: nextTop, behavior: "auto" });
      return;
    }
    thread.scrollTop = nextTop;
  }

  useLayoutEffect(() => {
    // W5-1: "대화창을 열면 마지막 부분이 보여야 한다" — 메뉴가 chat으로 바뀌는 순간도 스크롤 트리거로 취급.
    const enteredChatMenu = activeMenu === "chat" && chatScrollLastMenuRef.current !== "chat";
    chatScrollLastMenuRef.current = activeMenu;

    if (!selectedSession || activeMenu !== "chat") {
      return;
    }

    const currentCount = selectedSessionMessages.length;
    const state = chatSessionScrollStateRef.current;
    const shouldScrollBottom =
      enteredChatMenu ||
      state.sessionId !== selectedSession.id ||
      state.messageCount !== currentCount ||
      state.lastMessageSignature !== latestSessionMessageSignature;

    state.sessionId = selectedSession.id;
    state.messageCount = currentCount;
    state.lastMessageSignature = latestSessionMessageSignature;

    if (!shouldScrollBottom) {
      return;
    }

    scrollChatThreadToBottom();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollChatThreadToBottom();
      });
    });
  }, [activeMenu, selectedSession?.id, selectedSessionMessages.length, latestSessionMessageSignature]);

  useLayoutEffect(() => {
    if (!selectedSession || activeMenu !== "chat") {
      return;
    }

    const timers = [0, 80, 220].map((delay) => window.setTimeout(scrollChatThreadToBottom, delay));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [activeMenu, loading, selectedSession?.id, selectedSessionMessages.length, latestSessionMessageSignature]);

  function latestSessionPreview(session: WorkSessionItem) {
    const latestMessage = [...(sessionMessages[session.id] ?? session.messages ?? [])].sort((left, right) =>
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    ).at(-1);

    if (!latestMessage?.text) {
      return session.schedule_id ? "연결 일정 중심으로 작업을 이어갈 수 있습니다." : "새 요청을 남겨 업무대화를 시작하세요.";
    }

    return latestMessage.text.length > 52 ? `${latestMessage.text.slice(0, 52)}...` : latestMessage.text;
  }

  function toggleDetailCard(next: Exclude<DetailCardState, null>) {
    setDetailCard((current) =>
      current?.kind === next.kind && current.id === next.id ? null : next,
    );
  }

  function toggleContextSectionVisibility(section: ContextPanelKey) {
    setContextPanelVisibility((current) => {
      const nextShown = !current[section];
      if (nextShown) {
        // C-09: 사용자가 섹션을 직접 표시하면 쌓인 배지를 지운다.
        clearPaneBadge(section);
      }
      return {
        ...current,
        [section]: nextShown,
      };
    });
  }

  function toggleContextSectionCollapsed(section: ContextPanelKey) {
    setContextPanelCollapsed((current) => {
      const nextCollapsed = !current[section];
      if (!nextCollapsed) {
        clearPaneBadge(section);
      }
      return {
        ...current,
        [section]: nextCollapsed,
      };
    });
  }

  function adjustUiFontScale(next: number) {
    setUiFontScale(Math.min(1.4, Math.max(0.8, Number(next.toFixed(2)))));
  }

  async function handleUiZoom(delta: number) {
    const nextScale = Math.min(1.4, Math.max(0.8, Number((uiFontScale + delta).toFixed(2))));
    try {
      const actualScale = await setDesktopZoom(nextScale);
      adjustUiFontScale(actualScale);
    } catch {
      adjustUiFontScale(nextScale);
    }
  }

  function startContextPaneResize(event: ReactMouseEvent<HTMLDivElement>) {
    if (!contextPaneOpen) {
      return;
    }
    contextPaneResizeRef.current = {
      startX: event.clientX,
      startWidth: contextPaneWidth,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  const ActiveMenuIcon = activeMenuMeta.icon;
  const upcomingContextSchedules = (() => {
    // 지나간 일정은 제외하고, 가까운 순으로 최대 5개만 보여준다.
    const now = Date.now();
    return [...snapshot.schedules]
      .filter((schedule) => {
        const boundary = new Date(schedule.ends_at || schedule.starts_at).getTime();
        return !Number.isNaN(boundary) && boundary >= now;
      })
      .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())
      .slice(0, 5);
  })();
  const dumpViewerJob =
    activeKnowledgeIngestionJob ??
    snapshot.knowledgeIngestionJobs.find((job) => job.log_dump_path) ??
    snapshot.knowledgeIngestionJobs[0] ??
    null;
  const visibleWorkJobs = (snapshot.workJobs ?? []).slice(0, 8);
  const activeWorkJobCount = (snapshot.workJobs ?? []).filter(isActiveWorkJob).length;
  const rightPanelControls: Array<{
    key: ContextPanelKey;
    label: string;
    iconSrc: string;
    enabled: boolean;
  }> = [
    { key: "context", label: "현재 컨텍스트", iconSrc: "/icons/panel-context.png", enabled: true },
    { key: "approvals", label: "승인 요청", iconSrc: "/icons/panel-approvals.png", enabled: true },
    { key: "jobs", label: "작업 진행", iconSrc: "/icons/panel-logs.png", enabled: true },
    { key: "logs", label: "최근 실행", iconSrc: "/icons/panel-logs.png", enabled: true },
    { key: "upcoming", label: "가까운 일정", iconSrc: "/icons/panel-upcoming.png", enabled: activeMenu === "schedule" },
    { key: "dump", label: "색인 상세 로그", iconSrc: "/icons/panel-dump.png", enabled: activeMenu === "knowledge" && knowledgePanel === "indexing" },
  ];

  // J-02: LLM 사용 가능 여부 공용 판정. 화면들은 이 값과 LlmSetupNotice로 미설정 안내를 통일한다.
  const llmDefaults = snapshot.settings?.defaults ?? null;
  const isLlmConfigured = (() => {
    if (!llmDefaults) {
      return false;
    }
    if (llmDefaults.llm_mode === "local_first") {
      // 로컬 우선 모드는 API 키 없이 동작한다.
      return Boolean(llmDefaults.llm_provider?.trim() && llmDefaults.llm_model?.trim());
    }
    if (llmDefaults.llm_mode === "internal_server") {
      return Boolean(llmDefaults.internal_api_base_url?.trim() && llmDefaults.llm_model?.trim());
    }
    return Boolean(
      llmDefaults.llm_provider?.trim() &&
        llmDefaults.llm_model?.trim() &&
        llmDefaults.llm_api_key?.trim(),
    );
  })();

  return {
    // snapshot & shell
    snapshot, setSnapshot,
    activeMenu, setActiveMenu,
    loading, setLoading,
    submitting, setSubmitting,
    notice, setNotice,
    error, setError,
    selectedScheduleId, setSelectedScheduleId,
    selectedSessionId, setSelectedSessionId,
    lastContentBase, setLastContentBase,
    lastContentBaseSignature, setLastContentBaseSignature,
    scheduleForm, setScheduleForm,
    plannerAnchorAt, setPlannerAnchorAt,
    selectedPlannerSlotId, setSelectedPlannerSlotId,
    sessionForm, setSessionForm,
    sessionCreateExpanded, setSessionCreateExpanded,
    sessionRailQuery, setSessionRailQuery,
    chatDraft, setChatDraft,
    chatAttachments, setChatAttachments,
    chatAttachmentPreviews, setChatAttachmentPreviews,
    chatRetryPayloads, setChatRetryPayloads,
    chatDetailsOpen, setChatDetailsOpen,
    chatReasoningEffort, setChatReasoningEffort,
    chatModelOverride, setChatModelOverride,
    chatImagePreviewOpen, setChatImagePreviewOpen,
    toastItems, setToastItems,
    uiFontScale, setUiFontScale,
    sessionMessages, setSessionMessages,
    sessionContextSummaries, setSessionContextSummaries,
    selectedSessionFileLinks, setSelectedSessionFileLinks,
    chatFileLinkModalOpen, setChatFileLinkModalOpen,
    chatReturnContext, setChatReturnContext,
    settingsForm, setSettingsForm,
    settingsProfiles, setSettingsProfiles,
    localFileQuery, setLocalFileQuery,
    localFileSearchResult, setLocalFileSearchResult,
    localFileSearchLoading, setLocalFileSearchLoading,
    localFileIndexResult, setLocalFileIndexResult,
    localFileIndexLoading, setLocalFileIndexLoading,
    knowledgeSourceForm, setKnowledgeSourceForm,
    knowledgeQuery, setKnowledgeQuery,
    knowledgeSearchResult, setKnowledgeSearchResult,
    knowledgeDocumentStructure, setKnowledgeDocumentStructure,
    knowledgeDocumentTables, setKnowledgeDocumentTables,
    knowledgeBackendStatus, setKnowledgeBackendStatus,
    knowledgeParserStatus, setKnowledgeParserStatus,
    knowledgeAskResult, setKnowledgeAskResult,
    knowledgePanel, setKnowledgePanel,
    knowledgeWikiTree, setKnowledgeWikiTree,
    knowledgeWikiIndex, setKnowledgeWikiIndex,
    knowledgeWikiPage, setKnowledgeWikiPage,
    knowledgeWikiLoading, setKnowledgeWikiLoading,
    knowledgeEnrichStarting, setKnowledgeEnrichStarting,
    knowledgeExtractionView, setKnowledgeExtractionView,
    knowledgeScanActivity, setKnowledgeScanActivity,
    knowledgeDiffBySource, setKnowledgeDiffBySource,
    startupDiffEnabled, setStartupDiffEnabled,
    expandedIngestionLogJobId, setExpandedIngestionLogJobId,
    knowledgeIngestionLogDumps, setKnowledgeIngestionLogDumps,
    expandedWorkJobId, setExpandedWorkJobId,
    workJobEvents, setWorkJobEvents,
    workJobEventLoadingId, setWorkJobEventLoadingId,
    knowledgeInspectorLoading, setKnowledgeInspectorLoading,
    runtimeStatus, setRuntimeStatus,
    runtimeLoading, setRuntimeLoading,
    runtimeStarting, setRuntimeStarting,
    detailCard, setDetailCard,
    selectedResponseContext, setSelectedResponseContext,
    documentForm, setDocumentForm,
    documentSourceMode, setDocumentSourceMode,
    authoringFormats, setAuthoringFormats,
    authoringFormatKey, setAuthoringFormatKey,
    authoringTab, setAuthoringTab,
    authoringInstruction, setAuthoringInstruction,
    authoringStageEvents, setAuthoringStageEvents,
    authoringStreaming, setAuthoringStreaming,
    authoringStructure, setAuthoringStructure,
    authoringStructureFormat, setAuthoringStructureFormat,
    authoringPreview, setAuthoringPreview,
    authoringMeta, setAuthoringMeta,
    authoringEditorView, setAuthoringEditorView,
    authoringJsonDraft, setAuthoringJsonDraft,
    authoringJsonError, setAuthoringJsonError,
    authoringBuildResult, setAuthoringBuildResult,
    authoringBuildHints, setAuthoringBuildHints,
    authoringError, setAuthoringError,
    documentSourceSessionId, setDocumentSourceSessionId,
    customDocumentTemplates, setCustomDocumentTemplates,
    finalizeForm, setFinalizeForm,
    lastFinalizeRequest, setLastFinalizeRequest,
    contextPanelVisibility, setContextPanelVisibility,
    contextPaneOpen, setContextPaneOpen,
    contextPaneWidth, setContextPaneWidth,
    contextPanelCollapsed, setContextPanelCollapsed,
    paneBadges, setPaneBadges,
    engineUnreachable, setEngineUnreachable,
    deferredLoadState, setDeferredLoadState,
    runtimePanelOpen, setRuntimePanelOpen,
    tutorialOpen, setTutorialOpen,
    openTutorial,
    completeTutorial,
    // refs
    runtimePanelRef,
    runtimeIndicatorButtonRef,
    chatAttachmentInputRef,
    documentTemplateInputRef,
    chatDetailsPanelRef,
    chatDetailsButtonRef,
    chatThreadRef,
    authoringAbortRef,
    // derived
    deferredLogs,
    defaultTemplateKey,
    activeTemplateKey,
    pendingApprovals,
    filteredWorkSessions,
    currentFinalizeTicket,
    canApplyFinalize,
    finalizeAlreadyApplied,
    activeMenuMeta,
    unmanagedRuntimeReachable,
    selectedProviderPreset,
    selectedProviderAttributionLabel,
    selectedProviderSupportsAttributionHeaders,
    activeKnowledgeIngestionJob,
    runningKnowledgeIngestion,
    lockedKnowledgeIngestion,
    knowledgeIngestionLockMessage,
    selectedSchedule,
    selectedSession,
    selectedSessionSchedule,
    selectedSessionMessages,
    selectedSessionContextSummary,
    selectedSessionContextEvidence,
    latestSessionMessageSignature,
    ActiveMenuIcon,
    upcomingContextSchedules,
    dumpViewerJob,
    visibleWorkJobs,
    activeWorkJobCount,
    rightPanelControls,
    isLlmConfigured,
    // shared handlers
    buildSettingsFormFromProfiles,
    commitSettingsFormToProfiles,
    applySettingsFormPatch,
    pushToast,
    removeToast,
    openKnowledgeLogDumpFolder,
    toggleKnowledgeLogDump,
    refreshSnapshot,
    refreshKnowledgeIngestionJobsOnly,
    mergeKnowledgeIngestionJob,
    refreshShellSnapshot,
    refreshWorkJobsOnly,
    refreshDeferredSnapshot,
    refreshRuntimeStatus,
    handleRecoverSidecar,
    revealContextSection,
    clearPaneBadge,
    openResponseContextDetail,
    handleAction,
    cancelGenericWorkJob,
    toggleWorkJobEvents,
    handleStartSidecar,
    handleStopSidecar,
    handleRestartSidecar,
    refreshSessionFileLinks,
    openChatFileLinkModal,
    closeChatFileLinkModal,
    connectLocalFileToSession,
    decideApprovalTicket,
    latestSessionPreview,
    scrollChatThreadToBottom,
    toggleDetailCard,
    toggleContextSectionVisibility,
    toggleContextSectionCollapsed,
    adjustUiFontScale,
    handleUiZoom,
    startContextPaneResize,
  };
}

export type AppStore = ReturnType<typeof useAppStoreValue>;

const AppStoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({ value, children }: { value: AppStore; children: ReactNode }) {
  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStore {
  const store = useContext(AppStoreContext);
  if (!store) {
    throw new Error("useAppStore must be used within AppStoreProvider");
  }
  return store;
}
