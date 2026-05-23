import {
  startTransition,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  CalendarDays,
  BookMarked,
  BotMessageSquare,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  FileText,
  FolderTree,
  Hammer,
  History,
  Info,
  Plus,
  RefreshCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  askKnowledge,
  cancelWorkJob,
  cancelKnowledgeIngestionJob,
  cloneWorkspaceLlmProfiles,
  createDefaultWorkspaceLlmProfiles,
  applyAnythingLaunch,
  commitFileProposalApply,
  createContentBase,
  createFileProposals,
  getLlmProfileForSelection,
  generateDocument,
  createKnowledgeSource,
  createReferenceSet,
  createWorkSessionFileLinks,
  createSchedule,
  createWorkSession,
  deleteSchedule,
  runWorkSessionTurn,
  runWorkSessionTurnStream,
  updateSchedule,
  updateWorkSession,
  decideApproval,
  deleteWorkSessionFileLink,
  importAnythingLaunchReferenceSet,
  ingestKnowledgeSource,
  reindexKnowledgeSource,
  loadKnowledgeBackendStatus,
  loadKnowledgeDocumentStructure,
  loadKnowledgeGraph,
  loadKnowledgeIngestionJobs,
  loadKnowledgeIngestionJobLog,
  loadKnowledgeParserStatus,
  loadKnowledgeTables,
  loadWorkJobEvents,
  loadCustomDocumentTemplates,
  loadTools,
  loadWorkSessionFileLinks,
  loadWorkspaceDeferredSnapshot,
  loadWorkspaceSnapshot,
  loadWorkspaceShellSnapshot,
  mergeWorkspaceSnapshot,
  requestFileProposalApply,
  requestAnythingLaunch,
  rollbackFileOperation,
  applyDocumentFinalize,
  requestDocumentFinalize,
  queryKnowledgeGraph,
  rebuildLocalFileIndex,
  searchKnowledge,
  searchLocalFiles,
  scanKnowledgeSource,
  runKnowledgeIngestionJob,
  testWorkspaceLlmConnection,
  uploadDocumentAttachments,
  uploadDocumentTemplate,
  uploadWorkSessionAttachments,
  updateWorkspaceSettings,
  type ApprovalTicketItem,
  type AnythingLaunchItem,
  type ContentBaseResult,
  type CustomDocumentTemplateItem,
  type DocumentFormat,
  type FileProposalItem,
  type FinalDocumentRequestResult,
  type KnowledgeAskResult,
  type KnowledgeBackendStatus,
  type KnowledgeDocumentStructure,
  type KnowledgeGraphQueryResult,
  type KnowledgeGraphSummary,
  type KnowledgeIngestionJobItem,
  type KnowledgeIngestionLogDump,
  type KnowledgeParserStatus,
  type KnowledgeSearchResult,
  type KnowledgeSourceItem,
  type KnowledgeTableBlock,
  type LocalFileIndexRebuildResult,
  type LocalFileSearchResult,
  type ReferenceSetItem,
  type ScheduleItem,
  type ToolManifestItem,
  type WorkspaceLlmProfiles,
  type WorkspaceDeferredGroup,
  type WorkspaceSnapshot,
  type WorkSessionAttachmentItem,
  type WorkSessionFileLinkItem,
  type WorkSessionMessageItem,
  type WorkSessionTurnResult,
  type WorkSessionTurnContextSummary,
  type WorkSessionItem,
  type WorkJobEventItem,
  type WorkJobItem,
  analyzeWorkSessionPersonalization,
} from "./api";
import { buildChatContextEvidence } from "./chatContextSummary";
import { getVisibleMessageText } from "./chatMessageDisplay";
import { buildExecutionLogDisplay } from "./executionLogDisplay";
import { LLM_PROVIDER_PRESETS, normalizeProviderKey, type LlmProviderKey } from "./llmProviders";
import {
  copyTextToClipboard,
  launchAnythingQuery,
  loadDesktopRuntimeStatus,
  openExternalTarget,
  pickDirectory,
  restartDesktopSidecar,
  setDesktopZoom,
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
  iconSrc: string;
};

type DetailCardState =
  | { kind: "knowledge"; id: string }
  | { kind: "proposal"; id: string }
  | { kind: "log"; id: string }
  | null;

type ContextPanelKey = "context" | "approvals" | "jobs" | "logs" | "upcoming" | "preview" | "dump";

type KnowledgeScanActivity = {
  sourceId: string;
  sourceLabel: string;
  startedAt: number;
} | null;

type ChatAttachmentDraft = {
  id: string;
  file: File;
};

type ChatAttachmentPreview = {
  key: string;
  attachmentId: string;
  name: string;
  url: string;
};

type ToastItem = {
  id: number;
  tone: "info" | "error";
  message: string;
};

const MENU_ITEMS: MenuItem[] = [
  { key: "chat", label: "업무대화", description: "업무 요청 라우터", icon: BotMessageSquare, iconSrc: "/icons/menu-chat.png" },
  { key: "schedule", label: "일정", description: "업무 연결 캘린더", icon: CalendarDays, iconSrc: "/icons/menu-schedule.png" },
  { key: "search", label: "파일찾기", description: "내장 파일찾기 우선", icon: FileSearch, iconSrc: "/icons/menu-search.png" },
  { key: "documents", label: "문서작성", description: "콘텐츠 베이스 -> 템플릿", icon: FileText, iconSrc: "/icons/menu-documents.png" },
  { key: "knowledge", label: "내 지식폴더", description: "그래프RAG로 지식관리", icon: BookMarked, iconSrc: "/icons/menu-knowledge.png" },
  { key: "fileorg", label: "파일정리", description: "지식화 연동 정리", icon: FolderTree, iconSrc: "/icons/menu-fileorg.png" },
  { key: "tools", label: "도구", description: "보강형 실행 레지스트리", icon: Hammer, iconSrc: "/icons/menu-tools.png" },
  { key: "logs", label: "실행기록", description: "사용자 작업 이력", icon: History, iconSrc: "/icons/menu-logs.png" },
  { key: "settings", label: "기타 환경설정", description: "로컬 우선 설정", icon: Settings2, iconSrc: "/icons/menu-settings.png" },
];
const ANYTHING_RELEASES_URL = "https://github.com/chrisryugj/Docufinder/releases";
const PROVIDER_OPTION_ORDER: LlmProviderKey[] = [
  "openai",
  "openrouter",
  "featherless",
  "anthropic",
  "gemini",
  "nvidia_nim",
  "custom_openai",
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
  knowledgeSources: [],
  knowledgeSourceFiles: [],
  knowledgeIngestionJobs: [],
  knowledgeDocuments: [],
  workJobs: [],
  personalizationCandidates: [],
  approvalTickets: [],
  anythingLaunches: [],
  fileProposals: [],
  logs: [],
};

const DOCUMENT_FORMAT_OPTIONS: Array<{
  key: DocumentFormat;
  label: string;
  description: string;
  output: string;
}> = [
  { key: "officialMemo", label: "시행문", description: "수신·발신·관련·붙임이 필요한 공식 공문 흐름에 맞춥니다.", output: "HWPX" },
  { key: "onePageReport", label: "1페이지 보고서", description: "의사결정자가 30초 안에 핵심을 읽도록 요약·쟁점·조치안을 압축합니다.", output: "HWPX" },
  { key: "fullReport", label: "풀버전 보고서", description: "표지·목차·본문·근거를 갖춘 추진계획/결과보고 구조로 확장합니다.", output: "HWPX" },
  { key: "email", label: "이메일", description: "협업자에게 바로 보낼 수 있도록 결론과 요청사항을 짧게 정리합니다.", output: "본문/HWPX" },
];

function documentFormatLabel(format: DocumentFormat) {
  return DOCUMENT_FORMAT_OPTIONS.find((option) => option.key === format)?.label ?? "보고서";
}

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

function normalizeDisplayText(value: string) {
  return value.normalize("NFC");
}

function relativePath(fullPath?: string | null) {
  if (!fullPath) {
    return "-";
  }

  const parts = normalizeDisplayText(fullPath).split(/[\\/]/);
  return parts.slice(Math.max(parts.length - 3, 0)).join("/");
}

function fileNameFromPath(fullPath?: string | null) {
  if (!fullPath) {
    return "파일";
  }
  const normalized = normalizeDisplayText(fullPath);
  return normalized.split(/[\\/]/).pop() || normalized;
}

function shortDisplayId(value?: string | null, label = "작업") {
  const normalized = value?.trim();
  if (!normalized) {
    return `${label} 없음`;
  }
  const compact = normalized.replace(/[^a-zA-Z0-9]/g, "");
  return `${label} #${(compact || normalized).slice(0, 8)}`;
}

function friendlyArtifactLabel(path?: string | null) {
  const fileName = fileNameFromPath(path);
  const match = fileName.match(/^([a-f0-9]{8})[a-f0-9-]*\.(md|hwpx|hwtx)$/i);
  if (match) {
    return `문서 산출물 #${match[1]}`;
  }
  return relativePath(path);
}

function parentPathFromPath(fullPath?: string | null) {
  const normalized = fullPath?.trim();
  if (!normalized) {
    return "";
  }
  const separatorIndex = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : normalized;
}

function createDraftAttachmentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      <p>{body}</p>
    </div>
  );
}

function AssetIcon({ src, testId, className }: { src: string; testId?: string; className?: string }) {
  return (
    <img
      className={["asset-icon", className].filter(Boolean).join(" ")}
      src={src}
      alt=""
      aria-hidden="true"
      data-testid={testId}
    />
  );
}

function SectionCard({
  eyebrow,
  title,
  children,
  actions,
  className,
  testId,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={className ? `panel-card ${className}` : "panel-card"} data-testid={testId}>
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

function DetailPanel({
  title,
  fields,
}: {
  title: string;
  fields: Array<{ label: string; value: ReactNode; code?: boolean }>;
}) {
  return (
    <div className="detail-panel">
      <p className="detail-panel__title">{title}</p>
      <dl className="detail-grid">
        {fields.map((field) => (
          <div key={field.label} className="detail-grid__row">
            <dt>{field.label}</dt>
            <dd className={field.code ? "detail-grid__value detail-grid__value--code" : "detail-grid__value"}>
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatStructuredValue(value?: Record<string, unknown>) {
  if (!value || Object.keys(value).length === 0) {
    return "없음";
  }

  return JSON.stringify(value, null, 2).normalize("NFC");
}

function describeCandidateType(value: string) {
  switch (value) {
    case "topic":
      return "주제 페이지";
    case "project":
      return "프로젝트 페이지";
    case "issue":
      return "이슈 페이지";
    case "entity":
      return "개체 페이지";
    default:
      return value;
  }
}

function describeProposalType(value: string) {
  switch (value) {
    case "knowledge_candidate":
      return "지식 반영 후보";
    case "archive":
      return "보관 후보";
    default:
      return value;
  }
}

function describeKnowledgeSourceStatus(value: string) {
  switch (value) {
    case "active":
      return "활성";
    case "missing":
      return "폴더 없음";
    case "indexed":
      return "본문 인덱스";
    case "metadata_only":
      return "메타데이터";
    case "deleted":
      return "삭제 감지";
    default:
      return value;
  }
}

function describeExtractionStatus(file: { status: string; text_excerpt?: string | null; extracted_text_path?: string | null }) {
  if (file.status === "indexed" && (file.text_excerpt || file.extracted_text_path)) {
    return "본문 추출됨";
  }
  if (file.status === "metadata_only") {
    return "메타데이터만";
  }
  if (file.status === "deleted") {
    return "삭제됨";
  }
  return describeKnowledgeSourceStatus(file.status);
}

function describeIngestionJobStatus(job: KnowledgeIngestionJobItem) {
  switch (job.status) {
    case "queued":
      return "대기";
    case "running":
      return "처리 중";
    case "completed":
      return "완료";
    case "partial":
      return "부분 완료";
    case "canceled":
      return "취소됨";
    default:
      return job.status;
  }
}

function describeWorkJobStatus(job: WorkJobItem) {
  switch (job.status) {
    case "queued":
      return "대기";
    case "blocked":
      return "대기 중";
    case "running":
      return "진행 중";
    case "waiting_approval":
      return "승인 대기";
    case "cancel_requested":
      return "취소 요청";
    case "succeeded":
      return "완료";
    case "partial":
      return "부분 완료";
    case "failed":
      return "실패";
    case "canceled":
      return "취소됨";
    default:
      return job.status;
  }
}

function isActiveWorkJob(job: WorkJobItem) {
  return ["queued", "blocked", "running", "waiting_approval", "cancel_requested"].includes(job.status);
}

function activeKnowledgeIngestionMessage(job: KnowledgeIngestionJobItem | null) {
  if (!job) {
    return "";
  }
  return `GraphRAG 인덱싱 ${shortDisplayId(job.id, "작업")}이 진행 중입니다. 작업을 완료하거나 취소한 뒤 지식폴더 설정, 스캔, 재색인을 다시 실행할 수 있습니다.`;
}

function formatDurationMs(value: number) {
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  return `${(value / 1000).toFixed(1)}초`;
}

function ingestionRuntimeLabel(job: KnowledgeIngestionJobItem) {
  if (typeof job.duration_ms !== "number") {
    return null;
  }
  const average = typeof job.average_ms_per_file === "number" ? job.average_ms_per_file : 0;
  return `소요 ${formatDurationMs(job.duration_ms)} · 파일당 ${formatDurationMs(average)}`;
}

function ingestionProgressPercent(job: KnowledgeIngestionJobItem) {
  if (typeof job.progress_percent === "number") {
    return Math.max(0, Math.min(100, Math.round(job.progress_percent)));
  }
  if (job.queued_count <= 0) {
    return job.status === "completed" ? 100 : 0;
  }
  const attempted = Math.min(job.queued_count, job.processed_count + job.failed_count);
  return Math.round((attempted / job.queued_count) * 100);
}

function ingestionStageIndex(job: KnowledgeIngestionJobItem) {
  if (typeof job.current_stage_index === "number") {
    return Math.max(0, Math.min(KNOWLEDGE_INGESTION_STAGE_LABELS.length - 1, job.current_stage_index));
  }
  if (job.status === "completed" || job.status === "partial") {
    return KNOWLEDGE_INGESTION_STAGE_LABELS.length - 1;
  }
  if (job.status === "running") {
    return 1;
  }
  return 0;
}

function ingestionStageLabel(job: KnowledgeIngestionJobItem) {
  if (job.current_stage) {
    return job.current_stage;
  }
  if (job.status === "queued") {
    return "대기 중";
  }
  if (job.status === "running") {
    return "파싱/청킹/색인 처리 중";
  }
  if (job.status === "completed") {
    return "검색 준비 완료";
  }
  if (job.status === "partial") {
    return "부분 완료 / 실패 진단 필요";
  }
  if (job.status === "canceled") {
    return "작업이 중지되었습니다.";
  }
  return job.status;
}

function splitIngestionErrors(message?: string | null) {
  if (!message) {
    return [];
  }
  const normalized = message
    .replace(/\s+(?=[□■][^:\n]+:)/g, "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return normalized;
}

function backendCandidateLabel(label: "Vector" | "Graph", backend: KnowledgeBackendStatus["vector" | "graph"]) {
  if (!backend.production_available) {
    return null;
  }
  return `${label} 후보: ${backend.production_backend} ${backend.production_enabled ? "활성" : "비활성"}`;
}

function backendActivationLabel(label: "Vector" | "Graph", backend: KnowledgeBackendStatus["vector" | "graph"]) {
  if (backend.activation_ready === undefined) {
    return null;
  }
  return `${label} 준비: ${backend.activation_ready ? "활성화 가능" : "확인 필요"}`;
}

type ExtractionQualityReport = {
  paragraph_count?: number;
  text_char_count?: number;
  warnings?: unknown;
};

function extractionQualityReport(metadata?: Record<string, unknown>) {
  const value = metadata?.extraction_quality;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as ExtractionQualityReport;
}

function extractionQualityMetricLabel(metadata?: Record<string, unknown>) {
  const report = extractionQualityReport(metadata);
  if (!report) {
    return null;
  }
  const paragraphCount = typeof report.paragraph_count === "number" ? report.paragraph_count : 0;
  const textCharCount = typeof report.text_char_count === "number" ? report.text_char_count : 0;
  return `문단 ${paragraphCount} · 글자 ${textCharCount}`;
}

function describeExtractionQualityWarning(value: string) {
  switch (value) {
    case "partial_extraction":
      return "부분 추출";
    case "low_text":
      return "본문 부족";
    case "no_sections":
      return "섹션 없음";
    case "no_structured_tables":
      return "표 구조 없음";
    default:
      return value;
  }
}

function extractionQualityWarnings(metadata?: Record<string, unknown>) {
  const report = extractionQualityReport(metadata);
  if (!Array.isArray(report?.warnings)) {
    return [];
  }
  return report.warnings.filter((warning): warning is string => typeof warning === "string");
}

function extractionQualityWarningLabel(metadata?: Record<string, unknown>) {
  const warnings = extractionQualityWarnings(metadata);
  if (warnings.length === 0) {
    return "경고 없음";
  }
  return `경고: ${warnings.map(describeExtractionQualityWarning).join(", ")}`;
}

function chunkQualityLabel(document: { chunk_count?: number; table_chunk_count?: number }) {
  if (typeof document.chunk_count !== "number" && typeof document.table_chunk_count !== "number") {
    return null;
  }
  return `chunk ${document.chunk_count ?? 0} · 표 chunk ${document.table_chunk_count ?? 0}`;
}

function citationEvidenceLabel(evidenceType?: string) {
  return evidenceType === "table" ? "표 근거" : "섹션 근거";
}

function citationWarningLabel(warnings?: string[]) {
  if (!warnings?.length) {
    return null;
  }
  return `경고: ${warnings.map(describeExtractionQualityWarning).join(", ")}`;
}

function describeExecutionFeature(value: string) {
  switch (value) {
    case "documents":
      return "문서작성";
    case "knowledge":
      return "지식폴더";
    case "fileorg":
    case "file_org":
      return "파일정리";
    case "search":
      return "로컬검색";
    case "chat":
      return "업무대화";
    case "approval":
      return "승인";
    case "schedule":
      return "일정";
    case "references":
      return "참고자료 묶음";
    case "settings":
      return "환경설정";
    default:
      return value;
  }
}

function describeExecutionAction(value: string) {
  const actionMap: Record<string, string> = {
    "documents.content_base.created": "콘텐츠 베이스 생성",
    "documents.finalize.requested": "최종 저장 요청",
    "documents.finalize.applied": "최종 저장 적용",
    "knowledge.candidate.created": "지식 후보 생성",
    "knowledge.candidate.approved": "지식 후보 승인",
    "knowledge.source.registered": "지식 소스 폴더 등록",
    "knowledge.source.scanned": "지식 소스 폴더 스캔",
    "file_org.proposals.created": "파일정리 제안 생성",
    "file_org.apply.requested": "파일정리 적용 요청",
    "file_org.apply.committed": "파일정리 적용",
    "file_org.rollback.completed": "파일정리 되돌리기",
    "anything.launch.requested": "Anything 실행 요청",
    "anything.launch.applied": "Anything 실행 적용",
    "anything.launch.imported": "Anything 결과 가져오기",
    "reference_set.created": "참고자료 묶음 생성",
    "work_session.created": "업무 세션 생성",
    "work_session.updated": "업무 세션 갱신",
    "work_session.turn.failed": "업무대화 응답 실패",
    "work_session.attachments.created": "업무대화 파일 첨부",
    "work_session.file_links.created": "세션 관련 파일 연결",
    "work_session.file_link.deleted": "세션 관련 파일 연결 해제",
    "settings.updated": "환경설정 저장",
    "settings.llm.test.completed": "LLM 연결 테스트 성공",
    "settings.llm.test.failed": "LLM 연결 테스트 실패",
    "schedule.created": "일정 생성",
    "approval_ticket.decided": "승인 결정",
  };

  return actionMap[value] ?? value;
}

function describeStatus(value: string) {
  switch (value) {
    case "pending":
      return "대기 중";
    case "approved":
      return "승인됨";
    case "rejected":
      return "반려됨";
    case "success":
      return "성공";
    case "pending_approval":
      return "승인 대기";
    case "applied":
      return "적용됨";
    case "rolled_back":
      return "되돌림 완료";
    case "proposed":
      return "제안됨";
    case "open":
      return "열림";
    default:
      return value;
  }
}

function describeMessageStatus(value?: string) {
  switch (value) {
    case "pending":
      return "응답 대기";
    case "streaming":
      return "응답 생성 중";
    case "failed":
      return "응답 실패";
    default:
      return null;
  }
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function formatDateInputValue(date: Date, hour = 9, minute = 0) {
  const local = new Date(date);
  local.setHours(hour, minute, 0, 0);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  const hours = String(local.getHours()).padStart(2, "0");
  const minutes = String(local.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function formatZoomPercent(scale: number) {
  return `${Math.round(scale * 100)}%`;
}

function formatLatencyBadge(latencyMs?: number | null) {
  if (typeof latencyMs !== "number" || latencyMs < 0) {
    return null;
  }
  if (latencyMs < 1000) {
    return `응답 ${latencyMs}ms`;
  }
  return `응답 ${(latencyMs / 1000).toFixed(1)}초`;
}

function renderInlineMarkdown(text: string, onOpenExternal?: (target: string) => void) {
  const nodes: ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const label = link[1];
      const target = link[2].trim();
      nodes.push(
        onOpenExternal ? (
          <button
            key={`${match.index}-link`}
            type="button"
            className="inline-open-target inline-open-target--link"
            onClick={() => onOpenExternal(target)}
          >
            <span>{label}</span>
          </button>
        ) : (
          <span key={`${match.index}-link`}>{label}</span>
        ),
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={`${match.index}-code`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={`${match.index}-em`}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function parseOpenTargetLine(text: string): { label: string; target: string } | null {
  const match = text.match(/^(파일 열기|폴더 열기):\s*(.+)$/);
  if (!match) {
    return null;
  }
  return { label: match[1], target: match[2].trim() };
}

function isMarkdownTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseMarkdownTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function renderMarkdownContent(markdown: string, onOpenExternal?: (target: string) => void) {
  const normalizedMarkdown = markdown
    .replace(/\r/g, "")
    .replace(/([^\n])\s+(\d+[.)])\s+/g, "$1\n$2 ")
    .replace(/([^\n])\s+(-\s+)/g, "$1\n$2");
  const lines = normalizedMarkdown.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trimEnd() ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 4) as 2 | 3 | 4;
      const title = heading[2];
      if (level === 2) {
        blocks.push(<h2 key={`block-${index}`}>{renderInlineMarkdown(title, onOpenExternal)}</h2>);
      } else if (level === 3) {
        blocks.push(<h3 key={`block-${index}`}>{renderInlineMarkdown(title, onOpenExternal)}</h3>);
      } else {
        blocks.push(<h4 key={`block-${index}`}>{renderInlineMarkdown(title, onOpenExternal)}</h4>);
      }
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index]?.trim() ?? "").startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre key={`block-${index}`} className="chat-code-block">
          {language ? <span className="chat-code-block__lang">{language}</span> : null}
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && (lines[index]?.trim() ?? "").startsWith(">")) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`block-${index}`}>
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={`quote-${index}-${quoteIndex}`}>{renderInlineMarkdown(quoteLine, onOpenExternal)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (trimmed.includes("|") && index + 1 < lines.length && isMarkdownTableDivider(lines[index + 1] ?? "")) {
      const headers = parseMarkdownTableRow(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length) {
        const row = (lines[index] ?? "").trim();
        if (!row || !row.includes("|")) {
          break;
        }
        rows.push(parseMarkdownTableRow(row));
        index += 1;
      }
      blocks.push(
        <div key={`block-${index}`} className="chat-markdown-table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((header, headerIndex) => (
                  <th key={`table-head-${index}-${headerIndex}`}>{renderInlineMarkdown(header, onOpenExternal)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`table-row-${index}-${rowIndex}`}>
                  {headers.map((_, cellIndex) => (
                    <td key={`table-cell-${index}-${rowIndex}-${cellIndex}`}>
                      {renderInlineMarkdown(row[cellIndex] ?? "", onOpenExternal)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && (lines[index]?.trim() ?? "").startsWith("- ")) {
        items.push((lines[index] ?? "").trim().slice(2));
        index += 1;
      }
      blocks.push(
        <ul key={`block-${index}`}>
          {items.map((item, itemIndex) => {
            const openTarget = parseOpenTargetLine(item);
            return (
              <li key={`item-${index}-${itemIndex}`}>
                {openTarget && onOpenExternal ? (
                  <button
                    type="button"
                    className="inline-open-target"
                    onClick={() => onOpenExternal(openTarget.target)}
                  >
                    <span>{openTarget.label}</span>
                    <code>{openTarget.target}</code>
                  </button>
                ) : (
                  renderInlineMarkdown(item, onOpenExternal)
                )}
              </li>
            );
          })}
        </ul>,
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index]?.trim() ?? "")) {
        items.push((lines[index] ?? "").trim().replace(/^\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`block-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`ordered-${index}-${itemIndex}`}>{renderInlineMarkdown(item, onOpenExternal)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = (lines[index] ?? "").trim();
      if (
        !current ||
        /^(#{1,4})\s+/.test(current) ||
        current.startsWith("- ") ||
        current.startsWith(">") ||
        current.startsWith("```") ||
        /^\d+[.)]\s+/.test(current) ||
        (current.includes("|") && index + 1 < lines.length && isMarkdownTableDivider(lines[index + 1] ?? ""))
      ) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }
    const paragraph = paragraphLines.join(" ");
    const readableParagraphs =
      paragraph.length > 180
        ? paragraph.split(/(?<=[.!?。！？])\s+(?=[가-힣A-Z0-9])/).reduce<string[]>((acc, sentence) => {
            const last = acc[acc.length - 1] ?? "";
            if (!last || `${last} ${sentence}`.length > 170) {
              acc.push(sentence);
            } else {
              acc[acc.length - 1] = `${last} ${sentence}`;
            }
            return acc;
          }, [])
        : [paragraph];
    readableParagraphs.forEach((item, itemIndex) => {
      blocks.push(<p key={`block-${index}-${itemIndex}`}>{renderInlineMarkdown(item, onOpenExternal)}</p>);
    });
  }

  return blocks;
}

function knowledgeGraphRoleLabel(nodeType?: string) {
  switch (nodeType) {
    case "source_folder":
      return "폴더";
    case "source_file":
      return "문서";
    case "keyword":
      return "키워드";
    case "session_summary_index":
      return "대화";
    default:
      return "지식";
  }
}

function knowledgeGraphRoleOrder(nodeType?: string) {
  switch (nodeType) {
    case "source_folder":
      return 0;
    case "source_file":
      return 1;
    case "keyword":
      return 2;
    default:
      return 3;
  }
}

const KNOWLEDGE_GRAPH_FILTERS = [
  { key: "all", label: "전체" },
  { key: "source_folder", label: "폴더" },
  { key: "source_file", label: "문서" },
  { key: "keyword", label: "키워드" },
] as const;

type KnowledgeGraphFilter = (typeof KNOWLEDGE_GRAPH_FILTERS)[number]["key"];

const KNOWLEDGE_WORKSPACE_PANELS = [
  { key: "sources", label: "설정/상태", description: "폴더 등록, 스캔 상태, 원천 데이터 확인", iconSrc: "/icons/panel-context.png" },
  { key: "indexing", label: "색인 처리", description: "GraphRAG 인덱싱 진행률과 진단 로그", iconSrc: "/icons/panel-dump.png" },
  { key: "search", label: "GraphRAG 검색", description: "생성된 근거와 관계 기반 검색", iconSrc: "/icons/menu-knowledge.png" },
] as const;

type KnowledgeWorkspacePanel = (typeof KNOWLEDGE_WORKSPACE_PANELS)[number]["key"];

const KNOWLEDGE_INGESTION_STAGE_LABELS = [
  "폴더 스캔",
  "문서 파싱",
  "청킹",
  "임베딩/Chroma",
  "그래프 연결",
  "검색 준비",
];

function isKnowledgeGraphNodeDimmed(nodeType: string | undefined, filter: KnowledgeGraphFilter) {
  return filter !== "all" && nodeType !== filter;
}

function buildKnowledgeGraphVisual(graph: KnowledgeGraphSummary | null, filter: KnowledgeGraphFilter = "all") {
  const fallbackNodes = [
    { id: "fallback-folder", label: "지식폴더", node_type: "source_folder" },
    { id: "fallback-file", label: "문서", node_type: "source_file" },
    { id: "fallback-keyword", label: "키워드", node_type: "keyword" },
  ];
  const sortedNodes = (graph?.nodes?.length ? graph.nodes : fallbackNodes)
    .slice()
    .sort((left, right) => knowledgeGraphRoleOrder(left.node_type) - knowledgeGraphRoleOrder(right.node_type));
  const rawNodes = sortedNodes.slice(0, 90);
  const centerX = 520;
  const centerY = 420;
  const ringRadius: Record<string, number> = {
    source_folder: 110,
    session_summary_index: 185,
    source_file: 255,
    keyword: 355,
    default: 295,
  };
  const angleOffset: Record<string, number> = {
    source_folder: -0.4,
    session_summary_index: 0.2,
    source_file: 0.95,
    keyword: 1.7,
    default: 2.3,
  };
  const typeTotals = rawNodes.reduce<Record<string, number>>((totals, node) => {
    const type = node.node_type ?? "default";
    totals[type] = (totals[type] ?? 0) + 1;
    return totals;
  }, {});
  const typeCounter: Record<string, number> = {};
  const nodes = rawNodes.map((node, index) => {
    const type = node.node_type ?? "default";
    const typeIndex = typeCounter[type] ?? 0;
    typeCounter[type] = typeIndex + 1;
    const totalForType = Math.max(1, typeTotals[type] ?? 1);
    const jitter = ((index % 5) - 2) * 10;
    const radius = (ringRadius[type] ?? ringRadius.default) + jitter;
    const angle = angleOffset[type] + (Math.PI * 2 * typeIndex) / totalForType + index * 0.017;
    return {
      ...node,
      x: Math.round(centerX + Math.cos(angle) * radius),
      y: Math.round(centerY + Math.sin(angle) * radius),
    };
  });
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph?.edges?.filter((edge) => nodesById.has(edge.source) && nodesById.has(edge.target)) ?? [];
  const visualEdges = edges.length
    ? edges
    : nodes.length >= 3
      ? [
          { source: nodes[0].id, target: nodes[1].id, relation: "contains" },
          { source: nodes[1].id, target: nodes[2].id, relation: "mentions" },
        ]
      : [];
  const height = Math.max(760, Math.max(...nodes.map((node) => node.y), 0) + 180);
  const width = Math.max(1040, Math.max(...nodes.map((node) => node.x), 0) + 220);
  const activeNodeIds = new Set(
    filter === "all"
      ? nodes.map((node) => node.id)
      : nodes.filter((node) => node.node_type === filter).map((node) => node.id),
  );
  const particles = Array.from({ length: Math.min(96, Math.max(24, nodes.length * 3)) }, (_, index) => {
    const radius = 70 + (index % 11) * 34 + Math.floor(index / 11) * 7;
    const angle = index * 2.399963229728653;
    return {
      id: `particle-${index}`,
      x: Math.round(centerX + Math.cos(angle) * radius),
      y: Math.round(centerY + Math.sin(angle) * radius),
      r: 1.5 + (index % 3) * 0.55,
    };
  });
  return { nodes, edges: visualEdges, width, height, activeNodeIds, particles, centerX, centerY };
}

function describeReasoningEffort(value: "auto" | "minimal" | "low" | "medium" | "high") {
  switch (value) {
    case "minimal":
      return "간단";
    case "low":
      return "낮음";
    case "medium":
      return "보통";
    case "high":
      return "높음";
    case "auto":
    default:
      return "자동";
  }
}

function userFacingRuntimeDetail(detail: string | null | undefined): string {
  const normalized = (detail ?? "").toLowerCase();
  if (!normalized) {
    return "업무 엔진 상태를 아직 확인하지 못했습니다.";
  }
  if (normalized.includes("exited unexpectedly") || normalized.includes("crashed")) {
    return "관리 중인 업무 엔진이 비정상 종료되었습니다. 자동 복구를 시도합니다.";
  }
  if (normalized.includes("already reachable")) {
    return "업무 엔진이 이미 실행 중입니다.";
  }
  if (normalized.includes("managed by desktop") || normalized.includes("managed sidecar running")) {
    return "데스크톱 앱이 업무 엔진을 관리하고 있습니다.";
  }
  if (normalized.includes("start available") || normalized.includes("start required")) {
    return "업무 엔진을 시작할 수 있습니다.";
  }
  if (normalized.includes("browser")) {
    return "브라우저 모드에서는 업무 엔진을 직접 제어할 수 없습니다.";
  }
  return String(detail ?? "").replace(/sidecar/gi, "업무 엔진").replace(/사이드카/g, "업무 엔진");
}

function userFacingRuntimeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(/sidecar/gi, "업무 엔진").replace(/사이드카/g, "업무 엔진");
}

export function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(EMPTY_SNAPSHOT);
  const [activeMenu, setActiveMenu] = useState<MenuKey>("chat");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [selectedReferenceSetId, setSelectedReferenceSetId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [anythingImportForms, setAnythingImportForms] = useState<
    Record<string, { title: string; paths: string }>
  >({});
  const [lastImportedAnythingReferenceSetId, setLastImportedAnythingReferenceSetId] =
    useState<string>("");
  const [lastImportedAnythingReferenceSet, setLastImportedAnythingReferenceSet] =
    useState<ReferenceSetItem | null>(null);
  const [fileOrgTargetPath, setFileOrgTargetPath] = useState("");
  const [fileOrgOperations, setFileOrgOperations] = useState<
    Record<string, { id: string; destination_path: string }>
  >({});
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
  const [chatFileLinksOpen, setChatFileLinksOpen] = useState(false);
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
    embedding_provider: "deterministic" as "deterministic" | "ollama",
    embedding_model: "nomic-embed-text",
    embedding_base_url: "http://127.0.0.1:11434",
    embedding_fallback_enabled: true,
    graphrag_vector_backend: "chromadb" as "sqlite" | "chromadb",
  });
  const [settingsProfiles, setSettingsProfiles] = useState<WorkspaceLlmProfiles>(
    createDefaultWorkspaceLlmProfiles(),
  );
  const [referenceForm, setReferenceForm] = useState({
    title: "",
    kind: "file",
    label: "",
    value: "",
  });
  const [localFileQuery, setLocalFileQuery] = useState("");
  const [localFileSearchResult, setLocalFileSearchResult] = useState<LocalFileSearchResult | null>(null);
  const [selectedLocalFileHit, setSelectedLocalFileHit] = useState<LocalFileSearchResult["items"][number] | null>(null);
  const [localFileSearchLoading, setLocalFileSearchLoading] = useState(false);
  const [localFileIndexResult, setLocalFileIndexResult] = useState<LocalFileIndexRebuildResult | null>(null);
  const [localFileIndexLoading, setLocalFileIndexLoading] = useState(false);
  const [knowledgeSourceForm, setKnowledgeSourceForm] = useState({
    label: "",
    root_path: "",
  });
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeSearchResult, setKnowledgeSearchResult] = useState<KnowledgeSearchResult | null>(null);
  const [knowledgeGraphQueryResult, setKnowledgeGraphQueryResult] = useState<KnowledgeGraphQueryResult | null>(null);
  const [knowledgeDocumentStructure, setKnowledgeDocumentStructure] = useState<KnowledgeDocumentStructure | null>(null);
  const [knowledgeDocumentTables, setKnowledgeDocumentTables] = useState<KnowledgeTableBlock[]>([]);
  const [knowledgeBackendStatus, setKnowledgeBackendStatus] = useState<KnowledgeBackendStatus | null>(null);
  const [knowledgeParserStatus, setKnowledgeParserStatus] = useState<KnowledgeParserStatus | null>(null);
  const [knowledgeAskResult, setKnowledgeAskResult] = useState<KnowledgeAskResult | null>(null);
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraphSummary | null>(null);
  const [knowledgeGraphFilter, setKnowledgeGraphFilter] = useState<KnowledgeGraphFilter>("all");
  const [knowledgeGraphZoom, setKnowledgeGraphZoom] = useState(1);
  const [knowledgePanel, setKnowledgePanel] = useState<KnowledgeWorkspacePanel>("sources");
  const [knowledgeExtractionView, setKnowledgeExtractionView] = useState(false);
  const [knowledgeScanActivity, setKnowledgeScanActivity] = useState<KnowledgeScanActivity>(null);
  const [expandedIngestionLogJobId, setExpandedIngestionLogJobId] = useState("");
  const [knowledgeIngestionLogDumps, setKnowledgeIngestionLogDumps] = useState<
    Record<string, KnowledgeIngestionLogDump>
  >({});
  const [expandedWorkJobId, setExpandedWorkJobId] = useState("");
  const [workJobEvents, setWorkJobEvents] = useState<Record<string, WorkJobEventItem[]>>({});
  const [workJobEventLoadingId, setWorkJobEventLoadingId] = useState("");
  const [knowledgeInspectorLoading, setKnowledgeInspectorLoading] = useState(false);
  const [toolManifest, setToolManifest] = useState<ToolManifestItem[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<DesktopRuntimeStatus | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeStarting, setRuntimeStarting] = useState(false);
  const autoRestartHandledRef = useRef<string | null>(null);
  const autoStartAttemptedRef = useRef(false);
  const pendingApprovalCountRef = useRef(0);
  const runtimePanelRef = useRef<HTMLDivElement | null>(null);
  const runtimeIndicatorButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const documentAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const documentTemplateInputRef = useRef<HTMLInputElement | null>(null);
  const chatDetailsPanelRef = useRef<HTMLDivElement | null>(null);
  const chatDetailsButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatThreadRef = useRef<HTMLDivElement | null>(null);
  const knowledgeGraphMapRef = useRef<HTMLDivElement | null>(null);
  const knowledgeGraphDragRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    pointerId: number;
  } | null>(null);
  const chatSessionScrollStateRef = useRef<{ sessionId: string; messageCount: number; lastMessageSignature: string }>({
    sessionId: "",
    messageCount: 0,
    lastMessageSignature: "",
  });
  const toastIdRef = useRef(0);
  const toastTimeoutsRef = useRef<number[]>([]);
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
  const [documentAttachmentDrafts, setDocumentAttachmentDrafts] = useState<
    Array<{ id: string; file: File }>
  >([]);
  const [documentFileUsageNotes, setDocumentFileUsageNotes] = useState<Record<string, string>>({});
  const [documentSourceMode, setDocumentSourceMode] = useState<"session" | "direct">("direct");
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
    preview: true,
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
    preview: false,
    dump: false,
  });
  const [deferredLoadState, setDeferredLoadState] = useState<
    Record<WorkspaceDeferredGroup, "idle" | "loading" | "loaded" | "failed">
  >({
    knowledge: "idle",
    search: "idle",
    fileOrganizer: "idle",
    logs: "idle",
  });
  const contextPaneResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [runtimePanelOpen, setRuntimePanelOpen] = useState(false);

  const deferredLogs = useDeferredValue(snapshot.logs);
  const defaultTemplateKey = snapshot.settings?.defaults.default_template_key ?? "report";
  const activeTemplateKey = documentForm.template_key || defaultTemplateKey;
  const currentContentBaseSignature = [
    documentForm.title,
    documentForm.purpose,
    activeTemplateKey,
    selectedReferenceSetId || "",
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
  const activeMenuMeta = MENU_ITEMS.find((item) => item.key === activeMenu) ?? MENU_ITEMS[0];
  const unmanagedRuntimeReachable =
    runtimeStatus?.available && runtimeStatus.running && !runtimeStatus.managed;

  function buildSettingsFormFromProfiles(
    profiles: WorkspaceLlmProfiles,
    mode: "local_first" | "internal_server" | "external_model",
    provider: string | undefined,
    defaultTemplateKey: "report" | "meeting" | "review",
    personalizationApplyMode: "approval_required" | "auto_apply" = settingsForm.personalization_apply_mode,
    personalizationRoot = settingsForm.personalization_root,
    embeddingProvider: "deterministic" | "ollama" = settingsForm.embedding_provider,
    embeddingModel = settingsForm.embedding_model,
    embeddingBaseUrl = settingsForm.embedding_base_url,
    embeddingFallbackEnabled = settingsForm.embedding_fallback_enabled,
    graphragVectorBackend: "sqlite" | "chromadb" = settingsForm.graphrag_vector_backend,
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
      embedding_provider: embeddingProvider,
      embedding_model: embeddingModel,
      embedding_base_url: embeddingBaseUrl,
      embedding_fallback_enabled: embeddingFallbackEnabled,
      graphrag_vector_backend: graphragVectorBackend,
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

  function pushToast(tone: ToastItem["tone"], message: string) {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }
    const id = ++toastIdRef.current;
    setToastItems((current) => [...current, { id, tone, message: trimmed }]);
    const timeoutId = window.setTimeout(() => {
      setToastItems((current) => current.filter((toast) => toast.id !== id));
      toastTimeoutsRef.current = toastTimeoutsRef.current.filter((storedId) => storedId !== timeoutId);
    }, tone === "error" ? 7000 : 4500);
    toastTimeoutsRef.current.push(timeoutId);
  }

  function removeToast(id: number) {
    setToastItems((current) => current.filter((toast) => toast.id !== id));
  }

  useEffect(() => {
    return () => {
      for (const timeoutId of toastTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      toastTimeoutsRef.current = [];
    };
  }, []);

  async function copyKnowledgeLogDumpPath(logDumpPath: string) {
    try {
      await copyTextToClipboard(logDumpPath);
      pushToast("info", "GraphRAG 풀로그 덤프 경로를 복사했습니다.");
    } catch (error) {
      console.warn("failed to copy GraphRAG log dump path", error);
      pushToast("error", "GraphRAG 풀로그 덤프 경로 복사에 실패했습니다.");
    }
  }

  async function openKnowledgeLogDumpFolder(logDumpPath: string) {
    const folderPath = parentPathFromPath(logDumpPath);
    if (!folderPath) {
      pushToast("error", "열 수 있는 로그 폴더 경로가 없습니다.");
      return;
    }
    try {
      await openExternalTarget(folderPath);
    } catch (error) {
      console.warn("failed to open GraphRAG log dump folder", error);
      pushToast("error", "GraphRAG 로그 폴더를 열지 못했습니다.");
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
      console.warn("failed to load GraphRAG log dump", error);
      pushToast("error", "GraphRAG 풀로그 덤프를 불러오지 못했습니다.");
    }
  }

  function appendChatAttachments(files: FileList | File[] | null) {
    if (!files || files.length === 0) {
      return;
    }
    const nextDrafts = Array.from(files).map((file) => ({
      id: createDraftAttachmentId(),
      file,
    }));
    setChatAttachments((current) => [...current, ...nextDrafts]);
    if (chatAttachmentInputRef.current) {
      chatAttachmentInputRef.current.value = "";
    }
  }

  function removeChatAttachment(attachmentId: string) {
    setChatAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    setChatAttachmentPreviews((current) => current.filter((preview) => preview.attachmentId !== attachmentId));
    if (chatImagePreviewOpen?.attachmentId === attachmentId) {
      setChatImagePreviewOpen(null);
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
    setNotice("초안 조건이 바뀌었습니다. 최종 저장 전에 Content Base를 다시 생성하세요.");
  }, [currentContentBaseSignature, lastContentBase, lastContentBaseSignature]);

  useEffect(() => {
    if (!snapshot.settings) {
      return;
    }
    setSettingsProfiles(cloneWorkspaceLlmProfiles(snapshot.settings.defaults.profiles));
    setSettingsForm(
      buildSettingsFormFromProfiles(
        snapshot.settings.defaults.profiles,
        snapshot.settings.defaults.llm_mode,
        snapshot.settings.defaults.llm_provider,
        snapshot.settings.defaults.default_template_key,
        snapshot.settings.defaults.personalization_apply_mode,
        snapshot.settings.paths.personalization_root,
        snapshot.settings.defaults.embedding_provider,
        snapshot.settings.defaults.embedding_model,
        snapshot.settings.defaults.embedding_base_url ?? "",
        snapshot.settings.defaults.embedding_fallback_enabled,
        snapshot.settings.defaults.graphrag_vector_backend,
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
      if (!options.silent) {
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
      setError(loadError instanceof Error ? loadError.message : "GraphRAG 인덱싱 상태를 불러오지 못했습니다.");
    }
  }

  async function refreshShellSnapshot(options: { silent?: boolean } = {}) {
    if (!options.silent) {
      setLoading(true);
    }
    try {
      const next = await loadWorkspaceShellSnapshot();
      startTransition(() => {
        setSnapshot((current) => mergeWorkspaceSnapshot(current, next));
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
      setError(loadError instanceof Error ? loadError.message : "워크스페이스 핵심 정보를 불러오지 못했습니다.");
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }

  async function refreshDeferredSnapshot(group: WorkspaceDeferredGroup) {
    setDeferredLoadState((current) => ({ ...current, [group]: "loading" }));
    try {
      const patch = await loadWorkspaceDeferredSnapshot(group);
      startTransition(() => {
        setSnapshot((current) => mergeWorkspaceSnapshot(current, patch));
      });
      setDeferredLoadState((current) => ({ ...current, [group]: "loaded" }));
    } catch (loadError) {
      setDeferredLoadState((current) => ({ ...current, [group]: "failed" }));
      setError(loadError instanceof Error ? loadError.message : "지연 데이터를 불러오지 못했습니다.");
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

  useEffect(() => {
    void refreshShellSnapshot();
    void refreshRuntimeStatus();
  }, []);

  useEffect(() => {
    const deferredGroupByMenu: Partial<Record<MenuKey, WorkspaceDeferredGroup>> = {
      knowledge: "knowledge",
      search: "search",
      fileorg: "fileOrganizer",
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
      void refreshRuntimeStatus();
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

    const intervalId = window.setInterval(() => {
      void refreshShellSnapshot({ silent: true });
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [snapshot.workJobs]);

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
    void Promise.allSettled([loadKnowledgeGraph(), loadKnowledgeBackendStatus(), loadKnowledgeParserStatus()])
      .then(([graphResult, backendResult, parserResult]) => {
        if (!alive) {
          return;
        }
        if (graphResult.status === "fulfilled") {
          setKnowledgeGraph(graphResult.value);
        } else {
          setError(
            graphResult.reason instanceof Error
              ? graphResult.reason.message
              : "지식 그래프 요약을 불러오지 못했습니다.",
          );
        }
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

  function revealContextSection(section: ContextPanelKey) {
    setContextPaneOpen(true);
    setContextPanelVisibility((current) => ({
      ...current,
      [section]: true,
    }));
    setContextPanelCollapsed((current) => ({
      ...current,
      [section]: false,
    }));
  }

  function openResponseContextDetail(label: string) {
    setSelectedResponseContext(label);
    revealContextSection("context");
  }

  async function handleAction<T>(
    action: () => Promise<T>,
    successMessage: string,
    options?: { revealSection?: ContextPanelKey },
  ) {
    setSubmitting(true);
    setNotice(null);
    setError(null);
    try {
      const result = await action();
      await refreshSnapshot();
      if (options?.revealSection) {
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
      { revealSection: "jobs" },
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
      await refreshSnapshot();
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
      await refreshSnapshot();
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
      await refreshSnapshot();
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

  async function submitSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const editingExistingSchedule =
      selectedPlannerSlotId.startsWith("existing-") &&
      Boolean(selectedScheduleId) &&
      snapshot.schedules.some((schedule) => schedule.id === selectedScheduleId);
    const savedSchedule = await handleAction(
      () => {
        const payload = {
          title: scheduleForm.title,
          starts_at: toIso(scheduleForm.starts_at),
          ends_at: toIso(scheduleForm.ends_at),
          view: scheduleForm.view,
        };

        return editingExistingSchedule && selectedScheduleId
          ? updateSchedule(selectedScheduleId, payload)
          : createSchedule(payload);
      },
      editingExistingSchedule ? "일정을 수정했습니다." : "일정을 등록했습니다.",
    );
    if (savedSchedule) {
      setSnapshot((current) => ({
        ...current,
        schedules: current.schedules.some((schedule) => schedule.id === savedSchedule.id)
          ? current.schedules.map((schedule) => (schedule.id === savedSchedule.id ? savedSchedule : schedule))
          : [...current.schedules, savedSchedule],
      }));
      revealContextSection("context");
      setSelectedScheduleId(savedSchedule.id);
      setSelectedPlannerSlotId(`existing-${savedSchedule.id}`);
      setScheduleForm({
        title: savedSchedule.title,
        starts_at: savedSchedule.starts_at.slice(0, 16),
        ends_at: savedSchedule.ends_at.slice(0, 16),
        view: scheduleForm.view,
      });
    }
  }

  async function deleteSelectedSchedule() {
    if (!selectedScheduleId) {
      return;
    }
    const deleted = await handleAction(
      () => deleteSchedule(selectedScheduleId),
      "일정을 삭제했습니다.",
      { revealSection: "context" },
    );
    if (deleted) {
      setSnapshot((current) => ({
        ...current,
        schedules: current.schedules.filter((schedule) => schedule.id !== deleted.id),
        workSessions: current.workSessions.map((session) =>
          session.schedule_id === deleted.id ? { ...session, schedule_id: null } : session,
        ),
      }));
      setSelectedScheduleId("");
      setSelectedPlannerSlotId("");
      setScheduleForm((current) => ({
        title: "",
        starts_at: "",
        ends_at: "",
        view: current.view,
      }));
    }
  }

  async function submitWorkSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await handleAction(
      () =>
        createWorkSession({
          title: sessionForm.title,
          schedule_id: null,
        }),
      "업무 세션을 만들었습니다.",
    );
    if (created) {
      revealContextSection("context");
      setSelectedSessionId(created.id);
      setSessionForm({ title: "" });
      setSessionCreateExpanded(false);
    }
  }

  const selectedProviderPreset = LLM_PROVIDER_PRESETS[normalizeProviderKey(settingsForm.llm_provider)];
  const selectedProviderAttributionLabel =
    selectedProviderPreset.attributionLabel ?? selectedProviderPreset.label;
  const selectedProviderSupportsAttributionHeaders =
    selectedProviderPreset.supportsAttributionHeaders ??
    selectedProviderPreset.supportsOpenRouterHeaders ??
    false;

  function applyProviderPreset(providerKey: LlmProviderKey) {
    const committedProfiles = commitSettingsFormToProfiles(settingsProfiles, settingsForm);
    const nextProfiles = cloneWorkspaceLlmProfiles(committedProfiles);
    nextProfiles.external_model.active_provider = providerKey;
    const nextForm = buildSettingsFormFromProfiles(
      nextProfiles,
      "external_model",
      providerKey,
      settingsForm.default_template_key,
    );
    setSettingsProfiles(nextProfiles);
    setSettingsForm(nextForm);
  }

  function buildSettingsPayload() {
    const nextProfiles = commitSettingsFormToProfiles(settingsProfiles, settingsForm);
    return {
      llm_mode: settingsForm.llm_mode,
      llm_provider: settingsForm.llm_provider.trim() || "openai_compatible",
      llm_model: settingsForm.llm_model.trim() || selectedProviderPreset.defaultModel,
      llm_api_key: settingsForm.llm_api_key.trim() || null,
      llm_site_url: settingsForm.llm_site_url.trim() || null,
      llm_application_name: settingsForm.llm_application_name.trim() || null,
      llm_profiles: nextProfiles,
      default_template_key: settingsForm.default_template_key,
      internal_api_base_url: settingsForm.internal_api_base_url.trim() || null,
      personalization_apply_mode: settingsForm.personalization_apply_mode,
      personalization_root: settingsForm.personalization_root.trim() || null,
      embedding_provider: settingsForm.embedding_provider,
      embedding_model: settingsForm.embedding_model.trim() || "nomic-embed-text",
      embedding_base_url: settingsForm.embedding_base_url.trim() || null,
      embedding_fallback_enabled: settingsForm.embedding_fallback_enabled,
      graphrag_vector_backend: settingsForm.graphrag_vector_backend,
    };
  }

  function renderSavedProfilesSummary() {
    const externalProviders = Object.entries(settingsProfiles.external_model.providers);
    const activeExternalProviderKey = normalizeProviderKey(
      snapshot.settings?.defaults.llm_mode === "external_model"
        ? snapshot.settings.defaults.llm_provider ?? settingsProfiles.external_model.active_provider
        : settingsProfiles.external_model.active_provider,
    );
    return (
      <div className="detail-panel" data-testid="saved-llm-profiles">
        <p className="detail-panel__title">저장된 모델 프로필</p>
        <div className="settings-profile-list">
          {([
            {
              key: "local_first",
              title: "local_first",
              profile: settingsProfiles.local_first,
              active: settingsForm.llm_mode === "local_first",
            },
            {
              key: "internal_server",
              title: "internal_server",
              profile: settingsProfiles.internal_server,
              active: settingsForm.llm_mode === "internal_server",
            },
          ] as const).map((entry) => (
            <article key={entry.key} className={`settings-profile-card ${entry.active ? "is-active" : ""}`}>
              <div className="settings-profile-card__header">
                <strong>{entry.title}</strong>
                {entry.active ? <span className="pill pill--soft">현재</span> : null}
              </div>
              <p>
                {LLM_PROVIDER_PRESETS[normalizeProviderKey(entry.profile.provider) as LlmProviderKey]?.label ??
                  entry.profile.provider}
              </p>
              <p className="detail-grid__value--code">{entry.profile.model || "미설정"}</p>
              <p className="subtle-text">{entry.profile.base_url || "Base URL 미설정"}</p>
            </article>
          ))}
          {externalProviders.map(([providerKey, profile]) => (
            <article
              key={providerKey}
              className={`settings-profile-card ${
                activeExternalProviderKey === providerKey
                  ? "is-active"
                  : ""
              }`}
            >
              <div className="settings-profile-card__header">
                <strong>{providerKey}</strong>
                {activeExternalProviderKey === providerKey ? (
                  <span className="pill pill--soft">활성 공급자</span>
                ) : null}
              </div>
              <p>
                {LLM_PROVIDER_PRESETS[normalizeProviderKey(profile.provider) as LlmProviderKey]?.label ??
                  profile.provider}
              </p>
              <p className="detail-grid__value--code">{profile.model || "미설정"}</p>
              <p className="subtle-text">{profile.base_url || "Base URL 미설정"}</p>
              <p className="subtle-text">{profile.api_key ? "API Key 저장됨" : "API Key 미설정"}</p>
            </article>
          ))}
        </div>
      </div>
    );
  }

  async function submitSettingsUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleAction(
        async () => {
          const updated = await updateWorkspaceSettings(buildSettingsPayload());
        setSnapshot((current) => ({
          ...current,
          settings: updated,
          logs: current.logs,
        }));
        await refreshSnapshot();
      },
      "환경설정을 저장했습니다.",
      { revealSection: "logs" },
    );
  }

  async function createQuickIndependentSession() {
    const created = await handleAction(
      () =>
        createWorkSession({
          title: `새 업무 세션 ${snapshot.workSessions.length + 1}`,
          schedule_id: null,
        }),
      "독립 업무 세션을 열었습니다.",
    );
    if (created) {
      setSelectedScheduleId("");
      setSelectedSessionId(created.id);
      setActiveMenu("chat");
      revealContextSection("context");
      setSessionCreateExpanded(false);
    }
  }

  async function runLlmConnectionTest() {
    await handleAction(
      async () => {
        const updated = await updateWorkspaceSettings(buildSettingsPayload());
        setSnapshot((current) => ({
          ...current,
          settings: updated,
          logs: current.logs,
        }));
        const result = await testWorkspaceLlmConnection();
        await refreshSnapshot();
        if (result.status === "failed") {
          throw new Error(result.text);
        }
        setNotice(`LLM 연결 테스트 성공: ${result.provider} / ${result.model}`);
        return result;
      },
      "LLM 연결 테스트가 완료되었습니다.",
      { revealSection: "logs" },
    );
  }

  async function streamAssistantReply(
    sessionId: string,
    assistantMessage: WorkSessionMessageItem,
    userMessage: WorkSessionMessageItem,
  ) {
    const fullText = assistantMessage.text;
    const chunkSize = Math.max(4, Math.ceil(fullText.length / 18));

    setSessionMessages((current) => ({
      ...current,
      [sessionId]: [
        ...(current[sessionId] ?? []).filter(
          (message) =>
            !message.id.startsWith(`${sessionId}-user-`) && !message.id.startsWith(`${sessionId}-assistant-`),
        ),
        userMessage,
        {
          ...assistantMessage,
          text: "",
          status: assistantMessage.status === "failed" ? "failed" : "streaming",
        },
      ],
    }));

    if (!fullText || assistantMessage.status === "failed") {
      setSessionMessages((current) => ({
        ...current,
        [sessionId]: [
          ...(current[sessionId] ?? []).filter((message) => message.id !== assistantMessage.id),
          assistantMessage,
        ],
      }));
      return;
    }

    const isJsdom =
      typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "");
    if (isJsdom) {
      setSessionMessages((current) => ({
        ...current,
        [sessionId]: (current[sessionId] ?? []).map((message) =>
          message.id === assistantMessage.id ? assistantMessage : message,
        ),
      }));
      return;
    }

    await new Promise<void>((resolve) => {
      let offset = 0;
      const tick = () => {
        offset = Math.min(fullText.length, offset + chunkSize);
        const nextText = fullText.slice(0, offset);
        setSessionMessages((current) => ({
          ...current,
          [sessionId]: (current[sessionId] ?? []).map((message) =>
            message.id === assistantMessage.id
              ? {
                  ...assistantMessage,
                  text: nextText,
                  status: offset < fullText.length ? "streaming" : assistantMessage.status,
                }
              : message,
          ),
        }));
        if (offset < fullText.length) {
          window.setTimeout(tick, 18);
          return;
        }
        resolve();
      };
      tick();
    });
  }

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

  function openRelatedFileSearch() {
    if (!selectedSession) {
      return;
    }
    setActiveMenu("search");
    setNotice(`"${selectedSession.title}" 세션에 연결할 파일을 로컬파일/정보검색에서 가져오세요.`);
    revealContextSection("context");
  }

  async function removeSessionFileLink(link: WorkSessionFileLinkItem) {
    if (!selectedSession) {
      return;
    }
    const deleted = await handleAction(
      () => deleteWorkSessionFileLink(selectedSession.id, link.id),
      "세션 연결 파일을 제거했습니다.",
      { revealSection: "context" },
    );
    if (deleted) {
      await refreshSessionFileLinks(selectedSession.id);
    }
  }

  async function analyzeSelectedSessionForLearning() {
    if (!selectedSession) {
      return;
    }
    await handleAction(
      () => analyzeWorkSessionPersonalization(selectedSession.id),
      "현재 세션을 지식베이스에 바로 반영했습니다.",
      { revealSection: "logs" },
    );
  }

  async function submitCurrentChatDraft() {
    if (!selectedSession || (!chatDraft.trim() && chatAttachments.length === 0)) {
      return;
    }

    const messageText = chatDraft.trim() || "첨부 파일 전달";
    const pendingFiles = chatAttachments.map((attachment) => attachment.file);
    const optimisticUserMessage: WorkSessionMessageItem = {
      id: `${selectedSession.id}-user-${Date.now()}`,
      session_id: selectedSession.id,
      role: "user",
      text: messageText,
      message_type: "chat",
      status: "completed",
      attachments: pendingFiles.map((file, index) => ({
        id: `${selectedSession.id}-upload-${Date.now()}-${index}`,
        session_id: selectedSession.id,
        message_id: null,
        file_name: file.name,
        mime_type: file.type || null,
        stored_path: file.name,
        size_bytes: file.size,
        text_excerpt: null,
        created_at: new Date().toISOString(),
      })),
      created_at: new Date().toISOString(),
    };
    const optimisticAssistantMessage: WorkSessionMessageItem = {
      id: `${selectedSession.id}-assistant-${Date.now()}`,
      session_id: selectedSession.id,
      role: "assistant",
      text: "응답을 준비하는 중입니다.",
      message_type: "chat",
      status: "pending",
      provider: snapshot.settings?.defaults.llm_provider ?? null,
      model: snapshot.settings?.defaults.llm_model ?? null,
      created_at: new Date().toISOString(),
    };

    setSessionMessages((current) => ({
      ...current,
      [selectedSession.id]: [
        ...(current[selectedSession.id] ?? []),
        optimisticUserMessage,
        optimisticAssistantMessage,
      ],
    }));

    setChatDraft("");
    setChatAttachments([]);
    setChatAttachmentPreviews([]);
    if (chatAttachmentInputRef.current) {
      chatAttachmentInputRef.current.value = "";
    }
    setNotice("업무대화 요청을 보내고 있습니다.");

    try {
      const uploadedItems =
        pendingFiles.length > 0
          ? (await uploadWorkSessionAttachments(selectedSession.id, pendingFiles)).items
          : [];
      let usedStreaming = false;
      let streamedAssistantId = optimisticAssistantMessage.id;
      let streamedText = "";
      let result: WorkSessionTurnResult;
      try {
        result = await runWorkSessionTurnStream(
          selectedSession.id,
          {
            text: messageText,
            attachment_ids: uploadedItems.map((item) => item.id),
            model_override: chatModelOverride.trim() || undefined,
            reasoning_effort: chatReasoningEffort,
          },
          {
            onUserMessage: (message) => {
              setSessionMessages((current) => ({
                ...current,
                [selectedSession.id]: (current[selectedSession.id] ?? []).map((item) =>
                  item.id === optimisticUserMessage.id
                    ? { ...message, attachments: message.attachments ?? uploadedItems }
                    : item,
                ),
              }));
            },
            onAssistantMessage: (message) => {
              streamedAssistantId = message.id;
              setSessionMessages((current) => ({
                ...current,
                [selectedSession.id]: (current[selectedSession.id] ?? []).map((item) =>
                  item.id === optimisticAssistantMessage.id
                    ? { ...message, text: "", status: "streaming" }
                    : item,
                ),
              }));
            },
            onDelta: (delta) => {
              streamedText += delta.text;
              setSessionMessages((current) => ({
                ...current,
                [selectedSession.id]: (current[selectedSession.id] ?? []).map((item) =>
                  item.id === streamedAssistantId || item.id === optimisticAssistantMessage.id
                    ? {
                        ...item,
                        id: streamedAssistantId,
                        text: streamedText,
                        status: "streaming",
                      }
                    : item,
                ),
              }));
            },
          },
        );
        usedStreaming = true;
      } catch (streamError) {
        if (!(streamError instanceof Error) || !streamError.message.startsWith("404")) {
          throw streamError;
        }
        result = await runWorkSessionTurn(selectedSession.id, {
          text: messageText,
          attachment_ids: uploadedItems.map((item) => item.id),
          model_override: chatModelOverride.trim() || undefined,
          reasoning_effort: chatReasoningEffort,
        });
      }
      if (result.context_summary) {
        setSessionContextSummaries((current) => ({
          ...current,
          [selectedSession.id]: result.context_summary!,
        }));
      }
      if (result.work_job) {
        revealContextSection("jobs");
        setSnapshot((current) =>
          mergeWorkspaceSnapshot(current, {
            workJobs: [result.work_job!, ...(current.workJobs ?? []).filter((job) => job.id !== result.work_job!.id)],
          }),
        );
        await refreshShellSnapshot({ silent: true });
      }
      const nextUserMessage = {
        ...result.user_message,
        attachments: result.user_message.attachments ?? uploadedItems,
      };

      if (usedStreaming) {
        setSessionMessages((current) => ({
          ...current,
          [selectedSession.id]: [
            ...(current[selectedSession.id] ?? []).filter(
              (message) =>
                ![
                  optimisticUserMessage.id,
                  optimisticAssistantMessage.id,
                  result.user_message.id,
                  result.assistant_message.id,
                ].includes(message.id),
            ),
            nextUserMessage,
            {
              ...result.assistant_message,
              latency_ms: result.assistant_message.latency_ms ?? result.duration_ms ?? null,
            },
          ],
        }));
      } else {
        await streamAssistantReply(
          selectedSession.id,
          {
            ...result.assistant_message,
            latency_ms: result.assistant_message.latency_ms ?? result.duration_ms ?? null,
          },
          nextUserMessage,
        );
      }

      if (result.assistant_message.status === "failed") {
        setNotice("LLM 응답 생성에 실패했습니다. 설정과 연결 상태를 확인해주세요.");
        revealContextSection(result.work_job ? "jobs" : "logs");
        return;
      }

      if (result.work_job?.status === "blocked") {
        setNotice("앞선 업무대화 응답이 진행 중입니다. 우측 작업 진행에서 상태를 확인해 주세요.");
      } else {
        setNotice("업무대화 응답이 세션에 기록되었습니다.");
      }
    } catch (messageError) {
      console.warn("failed to run work session turn", messageError);
      setSessionMessages((current) => ({
        ...current,
        [selectedSession.id]: (current[selectedSession.id] ?? []).map((message) =>
          message.id === optimisticAssistantMessage.id
            ? {
                ...optimisticAssistantMessage,
                status: "failed",
                text:
                  messageError instanceof Error
                    ? `응답을 완료하지 못했습니다.\n\n${messageError.message}`
                    : "응답을 완료하지 못했습니다. 연결 상태를 다시 확인해 주세요.",
              }
            : message,
        ),
      }));
      setError(messageError instanceof Error ? messageError.message : "업무대화 요청에 실패했습니다.");
      revealContextSection("logs");
    }
  }

  function submitChatDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitCurrentChatDraft();
  }

  function handleChatComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitCurrentChatDraft();
    }
  }

  async function linkSelectedSessionToSchedule() {
    if (!selectedSessionId || !selectedScheduleId) {
      return;
    }

    await handleAction(
      () =>
        updateWorkSession(selectedSessionId, {
          schedule_id: selectedScheduleId,
        }),
      "현재 세션을 일정에 연결했습니다.",
    );
  }

  async function openChatForSchedule(schedule: ScheduleItem) {
    setSelectedScheduleId(schedule.id);
    const linkedSession = snapshot.workSessions.find((session) => session.schedule_id === schedule.id);
    if (linkedSession) {
      setSelectedSessionId(linkedSession.id);
      setActiveMenu("chat");
      revealContextSection("context");
      setNotice("선택 일정에 연결된 업무 세션을 열었습니다.");
      setError(null);
      return;
    }

    setSubmitting(true);
    setNotice(null);
    setError(null);
    try {
      const created = await createWorkSession({
        title: `${schedule.title} 작업`,
        schedule_id: schedule.id,
      });
      await refreshSnapshot();
      setSelectedScheduleId(schedule.id);
      setSelectedSessionId(created.id);
      setActiveMenu("chat");
      revealContextSection("context");
      setNotice("일정에서 새 업무 세션을 열었습니다.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "일정과 연결된 업무 세션을 열지 못했습니다.");
    } finally {
      setSubmitting(false);
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
      "참고자료 묶음을 등록했습니다.",
      { revealSection: "context" },
    );
    if (created) {
      setSelectedReferenceSetId(created.id);
      setReferenceForm({ title: "", kind: "file", label: "", value: "" });
    }
  }

  async function runLocalFileSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const query = localFileQuery.trim();
    if (!query) {
      setError("검색어를 입력해 주세요.");
      return;
    }

    setLocalFileSearchLoading(true);
    setError(null);
    try {
      const result = await searchLocalFiles(query);
      setLocalFileSearchResult(result);
      setSelectedLocalFileHit(result.items[0] ?? null);
      setNotice(null);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "파일 검색에 실패했습니다.");
    } finally {
      setLocalFileSearchLoading(false);
    }
  }

  async function copyLocalFilePath(filePath: string) {
    try {
      await copyTextToClipboard(filePath);
      pushToast("info", "파일 경로를 복사했습니다.");
    } catch (copyError) {
      console.warn("failed to copy local file path", copyError);
      pushToast("error", "파일 경로 복사에 실패했습니다.");
    }
  }

  async function runLocalFileIndexRebuild() {
    setLocalFileIndexLoading(true);
    setError(null);
    try {
      const result = await rebuildLocalFileIndex();
      setLocalFileIndexResult(result);
      revealContextSection("jobs");
      if (result.work_job) {
        setSnapshot((current) =>
          mergeWorkspaceSnapshot(current, {
            workJobs: [result.work_job!, ...(current.workJobs ?? []).filter((job) => job.id !== result.work_job!.id)],
          }),
        );
        await refreshShellSnapshot({ silent: true });
      }
      setNotice(`파일명 인덱스를 갱신했습니다. ${result.indexed_count}개 파일을 기록했습니다.`);
    } catch (indexError) {
      setError(indexError instanceof Error ? indexError.message : "파일명 인덱스 갱신에 실패했습니다.");
    } finally {
      setLocalFileIndexLoading(false);
    }
  }

  function isLocalFileLinked(filePath: string) {
    return selectedSessionFileLinks.some((link) => link.file_path === filePath);
  }

  async function connectLocalFileToSession(hit: LocalFileSearchResult["items"][number]) {
    if (!selectedSessionId) {
      setError("파일을 연결할 업무대화 세션을 먼저 선택해 주세요.");
      return;
    }

    const filePath = hit.file.file_path;
    const linked = await handleAction(
      () =>
        createWorkSessionFileLinks(selectedSessionId, {
          items: [
            {
              file_path: filePath,
              label: hit.file.title || fileNameFromPath(filePath),
              source: "knowledge",
            },
          ],
        }),
      "파일을 현재 업무대화 세션에 연결했습니다.",
      { revealSection: "context" },
    );

    if (linked) {
      await refreshSessionFileLinks(selectedSessionId);
    }
  }

  async function browseKnowledgeSourcePath() {
    if (lockedKnowledgeIngestion) {
      setKnowledgePanel("indexing");
      setNotice(knowledgeIngestionLockMessage);
      return;
    }
    try {
      const selectedPath = await pickDirectory();
      if (selectedPath) {
        setKnowledgeSourceForm((current) => ({ ...current, root_path: selectedPath }));
      }
    } catch (browseError) {
      setError(browseError instanceof Error ? browseError.message : "지식 소스 폴더를 선택하지 못했습니다.");
    }
  }

  async function submitKnowledgeSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lockedKnowledgeIngestion) {
      setKnowledgePanel("indexing");
      setNotice(knowledgeIngestionLockMessage);
      return;
    }
    const created = await handleAction(
      () =>
        createKnowledgeSource({
          label: knowledgeSourceForm.label,
          root_path: knowledgeSourceForm.root_path,
        }),
      "지식 소스 폴더를 등록했습니다.",
      { revealSection: "logs" },
    );
    if (created) {
      setKnowledgeSourceForm({ label: "", root_path: "" });
    }
  }

  async function runKnowledgeSourceScan(source: KnowledgeSourceItem) {
    setKnowledgePanel("indexing");
    if (lockedKnowledgeIngestion) {
      setNotice(knowledgeIngestionLockMessage);
      return;
    }
    setKnowledgeScanActivity({
      sourceId: source.id,
      sourceLabel: source.label,
      startedAt: Date.now(),
    });
    await handleAction(
      () => scanKnowledgeSource(source.id),
      `${source.label} 폴더를 스캔했습니다.`,
      { revealSection: "logs" },
    );
    setKnowledgeScanActivity(null);
  }

  async function runKnowledgeSourceIngestion(source: KnowledgeSourceItem) {
    setKnowledgePanel("indexing");
    if (lockedKnowledgeIngestion) {
      setNotice(knowledgeIngestionLockMessage);
      return;
    }
    const started = await handleAction(
      () => ingestKnowledgeSource(source.id, true, true),
      `${source.label} GraphRAG 인덱싱 작업을 시작했습니다.`,
      { revealSection: "dump" },
    );
    if (started) {
      revealContextSection("jobs");
      if (started.work_job) {
        setSnapshot((current) =>
          mergeWorkspaceSnapshot(current, {
            workJobs: [started.work_job!, ...(current.workJobs ?? []).filter((job) => job.id !== started.work_job!.id)],
          }),
        );
        await refreshShellSnapshot({ silent: true });
      }
    }
  }

  async function runKnowledgeSourceReindex(source: KnowledgeSourceItem) {
    setKnowledgePanel("indexing");
    if (lockedKnowledgeIngestion) {
      setNotice(knowledgeIngestionLockMessage);
      return;
    }
    const started = await handleAction(
      () => reindexKnowledgeSource(source.id, true, true),
      `${source.label} GraphRAG 강제 재색인 작업을 시작했습니다.`,
      { revealSection: "dump" },
    );
    if (started) {
      revealContextSection("jobs");
      if (started.work_job) {
        setSnapshot((current) =>
          mergeWorkspaceSnapshot(current, {
            workJobs: [started.work_job!, ...(current.workJobs ?? []).filter((job) => job.id !== started.work_job!.id)],
          }),
        );
        await refreshShellSnapshot({ silent: true });
      }
    }
  }

  async function runQueuedKnowledgeIngestionJob(job: KnowledgeIngestionJobItem) {
    setKnowledgePanel("indexing");
    if (runningKnowledgeIngestion) {
      setNotice("이미 실행 중인 GraphRAG ingestion 작업이 있습니다. 현재 작업이 끝난 뒤 실행해 주세요.");
      return;
    }
    await handleAction(
      () => runKnowledgeIngestionJob(job.id),
      "GraphRAG ingestion 작업을 실행했습니다.",
      { revealSection: "dump" },
    );
  }

  async function cancelQueuedKnowledgeIngestionJob(job: KnowledgeIngestionJobItem) {
    await handleAction(
      () => cancelKnowledgeIngestionJob(job.id),
      "GraphRAG ingestion 작업 취소를 요청했습니다.",
      { revealSection: "dump" },
    );
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
          source_session_id: documentSourceMode === "session" ? documentSourceSessionId || null : null,
          outline: documentForm.outline,
          document_format: documentForm.document_format,
          audience_type: documentForm.audience_type,
          expected_length: documentForm.expected_length,
          urgency_level: documentForm.urgency_level,
          needs_traceability: documentForm.needs_traceability,
          requires_official_form: documentForm.requires_official_form,
          requested_action: documentForm.requested_action,
          deadline: documentForm.deadline,
          security_level: documentForm.security_level,
          direct_file_paths: splitDocumentFilePaths(documentForm.direct_file_paths_text),
          user_template_path: documentForm.user_template_path || null,
        }),
      "콘텐츠 베이스를 생성했습니다.",
      { revealSection: "logs" },
    );
    if (created) {
      setLastContentBase(created);
      setLastContentBaseSignature(currentContentBaseSignature);
      setFinalizeForm({ output_name: created.title });
      setLastFinalizeRequest(null);
    }
  }

  async function submitDocumentGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourceSession =
      snapshot.workSessions.find((session) => session.id === documentSourceSessionId) ??
      (documentSourceMode === "session" ? selectedSession : null);
    const title =
      documentForm.title.trim() ||
      (sourceSession ? `${sourceSession.title} 문서` : `${documentFormatLabel(documentForm.document_format)} 초안`);
    const formatLabel = documentFormatLabel(documentForm.document_format);
    const purpose =
      documentSourceMode === "session" && sourceSession
        ? `업무대화 세션 기반 ${formatLabel} 작성`
        : `${formatLabel} 바로 작성`;
    const sessionFileLinks =
      documentSourceMode === "session" && sourceSession?.id === selectedSession?.id ? selectedSessionFileLinks : [];
    const generated = await handleAction(
      async () => {
        const uploaded =
          documentAttachmentDrafts.length > 0
            ? await uploadDocumentAttachments(documentAttachmentDrafts.map((item) => item.file))
            : { items: [] };
        const uploadedPaths = uploaded.items.map((item) => item.stored_path);
        const directPaths = [...splitDocumentFilePaths(documentForm.direct_file_paths_text), ...uploadedPaths];
        const uploadedNames = uploaded.items.map((item) => item.file_name);
        const fileUsagePlan = buildDocumentFileUsagePlan(sessionFileLinks, directPaths, uploadedNames);
        const outlineParts = [
          documentForm.outline.trim() || "업무대화와 연결 자료를 바탕으로 공공문서 작성요령에 맞춰 정리합니다.",
          fileUsagePlan,
        ].filter(Boolean);
        return generateDocument({
          title,
          purpose,
          reference_set_id: selectedReferenceSetId || null,
          template_key: activeTemplateKey as "report" | "meeting" | "review",
          source_session_id: sourceSession?.id ?? null,
          outline: outlineParts.join("\n\n"),
          document_format: documentForm.document_format === "auto" ? "onePageReport" : documentForm.document_format,
          audience_type: documentForm.audience_type,
          expected_length: documentForm.expected_length,
          urgency_level: documentForm.urgency_level,
          needs_traceability: documentForm.needs_traceability,
          requires_official_form: documentForm.requires_official_form,
          requested_action: documentForm.requested_action,
          deadline: documentForm.deadline,
          security_level: documentForm.security_level,
          direct_file_paths: directPaths,
          user_template_path: documentForm.user_template_path || null,
          output_name: finalizeForm.output_name.trim() || title,
        });
      },
      "HWPX 보고서 생성을 완료했습니다.",
      { revealSection: "jobs" },
    );
    if (generated) {
      if (generated.work_job) {
        setSnapshot((current) =>
          mergeWorkspaceSnapshot(current, {
            workJobs: [
              generated.work_job!,
              ...(current.workJobs ?? []).filter((job) => job.id !== generated.work_job!.id),
            ],
          }),
        );
        await refreshShellSnapshot({ silent: true });
      }
      setDocumentAttachmentDrafts([]);
      if (documentAttachmentInputRef.current) {
        documentAttachmentInputRef.current.value = "";
      }
      setLastContentBase(generated.content_base);
      setLastContentBaseSignature(currentContentBaseSignature);
      setLastFinalizeRequest({
        ...generated.finalize,
        artifact: generated.artifact,
        final_document_output: {
          ...generated.finalize.final_document_output,
          artifact_path: generated.artifact.path,
          status: "applied",
        },
      });
      setFinalizeForm((current) => ({
        ...current,
        output_name: generated.finalize.final_document_output.output_name,
      }));
    }
  }

  async function submitDocumentFinalizeRequest() {
    if (!lastContentBase) {
      setError("Generate a fresh ContentBase before requesting final save.");
      return;
    }

    const created = await handleAction(
      () =>
        requestDocumentFinalize({
          content_base_id: lastContentBase.id,
          output_name: finalizeForm.output_name.trim() || `${lastContentBase.title}-final`,
        }),
      "최종 저장 승인 요청을 보냈습니다.",
      { revealSection: "approvals" },
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
      "최종 저장을 적용했습니다.",
      { revealSection: "logs" },
    );
    if (applied) {
      setLastFinalizeRequest(applied);
    }
  }

  async function submitAnythingLaunch() {
    await handleAction(() => requestAnythingLaunch(searchQuery), "Anything 실행 요청을 승인 대기열에 등록했습니다.", {
      revealSection: "approvals",
    });
  }

  async function launchAnything(launch: AnythingLaunchItem) {
    const result =
      launch.status === "applied"
        ? { launch_request: launch }
        : await handleAction(
            () => applyAnythingLaunch(launch.approval_ticket_id),
            "Anything를 여는 준비를 마쳤습니다.",
            { revealSection: "logs" },
          );

    if (!result) {
      return;
    }

    const query = result.launch_request.query;
    const anythingDetected = runtimeStatus?.anything_available ?? false;

    if (anythingDetected) {
      try {
        await copyTextToClipboard(query);
      } catch (clipboardError) {
        console.warn("failed to copy Anything query to clipboard", clipboardError);
      }
    }

    await launchAnythingQuery(query, result.launch_request.launch_target);
    setNotice(
      anythingDetected
        ? runtimeStatus?.anything_autopaste_enabled
          ? launch.status === "applied"
            ? `Anything를 다시 열었습니다. 검색어 "${query}" 자동 붙여넣기를 시도했고, 필요하면 앱 안에서 한번 더 붙여넣어 주세요.`
            : `Anything를 열었습니다. 검색어 "${query}" 자동 붙여넣기를 시도했고, 필요하면 앱 안에서 한번 더 붙여넣어 주세요.`
          : launch.status === "applied"
            ? `Anything를 다시 열었습니다. 검색어 "${query}"를 클립보드에 복사해 두었으니 앱 안에서 바로 붙여넣어 주세요.`
            : `Anything를 열었습니다. 검색어 "${query}"를 클립보드에 복사해 두었으니 앱 안에서 바로 붙여넣어 주세요.`
        : launch.status === "applied"
          ? "Anything 설치 안내 페이지를 다시 열었습니다."
          : "Anything 설치 안내 페이지를 열었습니다.",
    );
  }

  async function openAnythingInstallGuide() {
    await handleAction(
      () => openExternalTarget(ANYTHING_RELEASES_URL),
      "Anything 설치 안내 페이지를 열었습니다.",
    );
  }

  async function submitAnythingReferenceImport(
    event: FormEvent<HTMLFormElement>,
    launch: AnythingLaunchItem,
  ) {
    event.preventDefault();
    const form = anythingImportForms[launch.approval_ticket_id] ?? { title: "", paths: "" };
    const paths = form.paths
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);

    const imported = await handleAction(
      () =>
        importAnythingLaunchReferenceSet(launch.approval_ticket_id, {
          title: form.title.trim() || `${launch.query} import`,
          session_id: selectedSessionId || null,
          paths,
        }),
      "Anything 결과를 Reference Set으로 가져왔습니다.",
      { revealSection: "context" },
    );

    if (imported) {
      setSelectedReferenceSetId(imported.reference_set.id);
      setLastImportedAnythingReferenceSetId(imported.reference_set.id);
      setLastImportedAnythingReferenceSet(imported.reference_set);
      if (selectedSessionId && paths.length > 0) {
        await createWorkSessionFileLinks(selectedSessionId, {
          items: paths.map((filePath) => ({
            file_path: filePath,
            label: filePath.split(/[\\/]/).pop() || filePath,
            source: "anything",
          })),
        });
        await refreshSessionFileLinks(selectedSessionId);
      }
      setAnythingImportForms((current) => ({
        ...current,
        [launch.approval_ticket_id]: { title: "", paths: "" },
      }));
    }
  }

  function continueImportedAnythingToDocuments() {
    const importedReferenceSet =
      snapshot.referenceSets.find((item) => item.id === lastImportedAnythingReferenceSetId) ??
      lastImportedAnythingReferenceSet;
    if (importedReferenceSet) {
      setDocumentSourceMode(selectedSession ? "session" : "direct");
      setDocumentSourceSessionId(selectedSession?.id ?? "");
      setDocumentForm((current) => ({
        ...current,
        title: current.title.trim() ? current.title : importedReferenceSet.title,
        purpose:
          !current.purpose.trim() || current.purpose === "보고서형"
            ? `${importedReferenceSet.title} 기반 정리`
            : current.purpose,
        outline: current.outline.trim() || `${importedReferenceSet.title} 참고자료를 바탕으로 문서를 작성합니다.`,
      }));
    }
    setActiveMenu("documents");
  }

  function continueSelectedSessionToDocuments() {
    if (!selectedSession) {
      setNotice("문서작성으로 이어갈 업무대화 세션을 먼저 선택하세요.");
      return;
    }
    setDocumentSourceMode("session");
    setDocumentSourceSessionId(selectedSession.id);
    setDocumentForm((current) => ({
      ...current,
      title: `${selectedSession.title} 문서`,
      purpose: "업무대화 세션 기반 정리",
      outline: `${selectedSession.title} 대화 내용을 바탕으로 문서를 작성합니다.`,
      template_key: current.template_key || activeTemplateKey,
      document_format: "onePageReport",
    }));
    setActiveMenu("documents");
    revealContextSection("context");
    setNotice("현재 업무대화 세션을 문서작성 입력으로 연결했습니다.");
  }

  function splitDocumentFilePaths(value: string) {
    return value
      .split(/\r?\n/)
      .map((path) => path.trim())
      .filter(Boolean);
  }

  function documentFileUsageKey(filePath: string) {
    return filePath.trim().toLowerCase();
  }

  function updateDocumentFileUsage(filePath: string, value: string) {
    const key = documentFileUsageKey(filePath);
    setDocumentFileUsageNotes((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function appendDocumentAttachments(files: FileList | File[] | null) {
    if (!files || files.length === 0) {
      return;
    }
    const nextDrafts = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
    }));
    setDocumentAttachmentDrafts((current) => [...current, ...nextDrafts]);
  }

  function removeDocumentAttachment(id: string) {
    setDocumentAttachmentDrafts((current) => current.filter((item) => item.id !== id));
  }

  function buildDocumentFileUsagePlan(
    sessionFileLinks: WorkSessionFileLinkItem[],
    directPaths: string[],
    uploadedFileNames: string[],
  ) {
    const lines: string[] = [];
    for (const link of sessionFileLinks) {
      const label = link.label || link.file_path.split(/[\\/]/).pop() || link.file_path;
      const note = documentFileUsageNotes[documentFileUsageKey(link.file_path)]?.trim();
      lines.push(`- ${label}: ${note || "세션 연결자료로 검토해 필요한 근거만 반영"}`);
    }
    for (const path of directPaths) {
      const label = path.split(/[\\/]/).pop() || path;
      const note = documentFileUsageNotes[documentFileUsageKey(path)]?.trim() || documentForm.file_usage_note.trim();
      lines.push(`- ${label}: ${note || "직접 첨부/연결한 참고자료로 활용"}`);
    }
    for (const fileName of uploadedFileNames) {
      const note = documentFileUsageNotes[documentFileUsageKey(fileName)]?.trim() || documentForm.file_usage_note.trim();
      lines.push(`- ${fileName}: ${note || "업로드 첨부자료로 활용"}`);
    }
    return lines.length > 0 ? `첨부/연결 파일 활용 계획:\n${lines.join("\n")}` : "";
  }

  async function handleDocumentTemplateUpload(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }
    const uploaded = await handleAction(
      () => uploadDocumentTemplate(file),
      "사용자 HWPX/HWTX 양식을 업로드했습니다.",
      { revealSection: "context" },
    );
    if (uploaded) {
      setCustomDocumentTemplates((current) => [uploaded.item, ...current.filter((item) => item.path !== uploaded.item.path)]);
      setDocumentForm((current) => ({ ...current, user_template_path: uploaded.item.path }));
    }
    if (documentTemplateInputRef.current) {
      documentTemplateInputRef.current.value = "";
    }
  }

  async function submitFileProposals(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleAction(
      () => createFileProposals(fileOrgTargetPath),
      "파일정리 제안을 생성했습니다.",
      { revealSection: "logs" },
    );
  }

  async function requestProposalApply(proposal: FileProposalItem) {
    await handleAction(
      () => requestFileProposalApply(proposal.id),
      "파일정리 적용 승인 요청을 보냈습니다.",
      { revealSection: "approvals" },
    );
  }

  async function commitProposalApply(proposal: FileProposalItem) {
    const applied = await handleAction(
      () => commitFileProposalApply(proposal.id),
      "파일정리 적용을 완료했습니다.",
      { revealSection: "jobs" },
    );
    if (applied) {
      revealContextSection("jobs");
      if (applied.work_job) {
        setSnapshot((current) =>
          mergeWorkspaceSnapshot(current, {
            workJobs: [applied.work_job!, ...(current.workJobs ?? []).filter((job) => job.id !== applied.work_job!.id)],
          }),
        );
        await refreshShellSnapshot({ silent: true });
      }
      if (applied.operation) {
        setFileOrgOperations((current) => ({
          ...current,
          [proposal.id]: {
            id: applied.operation!.id,
            destination_path: applied.operation!.destination_path,
          },
        }));
      }
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
      { revealSection: "jobs" },
    );
    if (rolledBack) {
      revealContextSection("jobs");
      if (rolledBack.work_job) {
        setSnapshot((current) =>
          mergeWorkspaceSnapshot(current, {
            workJobs: [rolledBack.work_job!, ...(current.workJobs ?? []).filter((job) => job.id !== rolledBack.work_job!.id)],
          }),
        );
        await refreshShellSnapshot({ silent: true });
      }
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
          decision_note: status === "approved" ? "UI 확인" : "UI 거절",
        }),
      `승인 요청을 ${status === "approved" ? "승인" : "거절"}했습니다.`,
      { revealSection: "approvals" },
    );
  }

  async function runKnowledgeSearch() {
    if (!knowledgeQuery.trim()) {
      return;
    }

    setKnowledgePanel("search");
    setKnowledgeInspectorLoading(true);
    setError(null);
    try {
      const query = knowledgeQuery.trim();
      const [result, graphQueryResult] = await Promise.all([
        searchKnowledge(query),
        queryKnowledgeGraph(query),
      ]);
      setKnowledgeSearchResult(result);
      setKnowledgeGraphQueryResult(graphQueryResult);
      setKnowledgeDocumentStructure(null);
      setKnowledgeDocumentTables([]);
      setKnowledgeAskResult(null);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "지식 검색을 실행하지 못했습니다.");
    } finally {
      setKnowledgeInspectorLoading(false);
    }
  }

  async function runKnowledgeGraphQuery(query: string) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return;
    }

    setKnowledgeInspectorLoading(true);
    setError(null);
    setKnowledgeQuery(normalizedQuery);
    setKnowledgePanel("search");
    try {
      const graphQueryResult = await queryKnowledgeGraph(normalizedQuery);
      setKnowledgeGraphQueryResult(graphQueryResult);
      setKnowledgeDocumentStructure(null);
      setKnowledgeDocumentTables([]);
      setKnowledgeAskResult(null);
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : "관계 보기를 실행하지 못했습니다.");
    } finally {
      setKnowledgeInspectorLoading(false);
    }
  }

  async function openKnowledgeDocumentStructure(documentId: string) {
    setKnowledgeInspectorLoading(true);
    setError(null);
    try {
      const [structure, tables] = await Promise.all([
        loadKnowledgeDocumentStructure(documentId),
        loadKnowledgeTables(documentId),
      ]);
      setKnowledgeDocumentStructure(structure);
      setKnowledgeDocumentTables(tables.items);
    } catch (structureError) {
      setError(structureError instanceof Error ? structureError.message : "문서 구조를 불러오지 못했습니다.");
    } finally {
      setKnowledgeInspectorLoading(false);
    }
  }

  async function runKnowledgeAsk() {
    const query = knowledgeQuery.trim();
    if (!query) {
      return;
    }

    setKnowledgePanel("search");
    setKnowledgeInspectorLoading(true);
    setError(null);
    try {
      const result = await askKnowledge(query, { session_id: selectedSessionId ?? null, limit: 5 });
      setKnowledgeAskResult(result);
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : "근거 답변을 생성하지 못했습니다.");
    } finally {
      setKnowledgeInspectorLoading(false);
    }
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
    if (!selectedSession) {
      return;
    }

    const currentCount = selectedSessionMessages.length;
    const state = chatSessionScrollStateRef.current;
    const shouldScrollBottom =
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
  }, [selectedSession?.id, selectedSessionMessages.length, latestSessionMessageSignature]);

  useLayoutEffect(() => {
    if (!selectedSession) {
      return;
    }

    const timers = [0, 80, 220].map((delay) => window.setTimeout(scrollChatThreadToBottom, delay));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [loading, selectedSession?.id, selectedSessionMessages.length, latestSessionMessageSignature]);
  const selectedReferenceSet =
    snapshot.referenceSets.find((item) => item.id === selectedReferenceSetId) ?? null;

  function latestSessionPreview(session: WorkSessionItem) {
    const latestMessage = [...(sessionMessages[session.id] ?? session.messages ?? [])].sort((left, right) =>
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    ).at(-1);

    if (!latestMessage?.text) {
      return session.schedule_id ? "연결 일정 중심으로 작업을 이어갈 수 있습니다." : "새 요청을 남겨 업무대화를 시작하세요.";
    }

    return latestMessage.text.length > 52 ? `${latestMessage.text.slice(0, 52)}...` : latestMessage.text;
  }

  function latestApprovalTicketForProposal(proposalId: string) {
    return (
      snapshot.approvalTickets.find(
        (ticket) => ticket.action === "file_org.apply" && ticket.target_id === proposalId,
      ) ?? null
    );
  }

  function toggleDetailCard(next: Exclude<DetailCardState, null>) {
    setDetailCard((current) =>
      current?.kind === next.kind && current.id === next.id ? null : next,
    );
  }

  function toggleContextSectionVisibility(section: ContextPanelKey) {
    setContextPanelVisibility((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  function toggleContextSectionCollapsed(section: ContextPanelKey) {
    setContextPanelCollapsed((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  function startKnowledgeGraphDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button") || target.closest("g[role='button']")) {
      return;
    }
    const map = knowledgeGraphMapRef.current;
    if (!map) {
      return;
    }
    knowledgeGraphDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: map.scrollLeft,
      scrollTop: map.scrollTop,
      pointerId: event.pointerId,
    };
    map.setPointerCapture(event.pointerId);
    map.classList.add("is-dragging");
  }

  function moveKnowledgeGraphDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = knowledgeGraphDragRef.current;
    const map = knowledgeGraphMapRef.current;
    if (!drag || !map || drag.pointerId !== event.pointerId) {
      return;
    }
    map.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    map.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
  }

  function endKnowledgeGraphDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = knowledgeGraphDragRef.current;
    const map = knowledgeGraphMapRef.current;
    if (!drag || !map || drag.pointerId !== event.pointerId) {
      return;
    }
    knowledgeGraphDragRef.current = null;
    map.classList.remove("is-dragging");
    if (map.hasPointerCapture(event.pointerId)) {
      map.releasePointerCapture(event.pointerId);
    }
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

  function renderSessionRailItem(session: WorkSessionItem) {
    const linkedSchedule = snapshot.schedules.find((schedule) => schedule.id === session.schedule_id);
    const hasLinkedSchedule = Boolean(session.schedule_id);
    const messageCount = sessionMessages[session.id]?.length ?? session.messages?.length ?? 0;

    return (
      <button
        key={session.id}
        type="button"
        className={`session-rail__item ${selectedSessionId === session.id ? "is-selected" : ""}`}
        onClick={() => {
          setSelectedSessionId(session.id);
          setActiveMenu("chat");
        }}
      >
        <div className="session-rail__item-main">
          <div className="session-rail__title-row">
            <strong>{session.title}</strong>
            {hasLinkedSchedule ? (
              <span className="session-rail__badge" aria-label="일정 연결 세션">
                일정
              </span>
            ) : (
              <span className="session-rail__badge session-rail__badge--muted" aria-label="독립 업무 세션">
                독립
              </span>
            )}
          </div>
          <span>{linkedSchedule?.title ?? "독립 업무 세션"}</span>
          <p className="session-rail__preview">{latestSessionPreview(session)}</p>
          <p className="session-rail__meta">
            <span>{messageCount}개 메시지</span>
            {hasLinkedSchedule ? <span>일정 연결</span> : <span>독립 흐름</span>}
          </p>
        </div>
      </button>
    );
  }

  function renderCompactSessionRailList() {
    if (filteredWorkSessions.length === 0) {
      return (
        <EmptyState
          title={snapshot.workSessions.length === 0 ? "아직 업무 세션이 없습니다." : "검색 조건에 맞는 세션이 없습니다."}
          body={
            snapshot.workSessions.length === 0
              ? "새 세션을 만들고 일정 연결이 필요한 세션에만 작은 리본 배지를 붙입니다."
              : "검색어를 줄이거나 새 독립 세션을 바로 열어 흐름을 이어갈 수 있습니다."
          }
        />
      );
    }

    return (
      <div className="session-rail__list">
        {filteredWorkSessions.map((session) => renderSessionRailItem(session))}
      </div>
    );
  }

  function renderSessionRail() {
    return (
      <aside className="sidebar session-rail" data-testid="session-rail">
        <nav className="feature-rail" aria-label="주요 작업 메뉴">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`feature-rail__item ${activeMenu === item.key ? "is-active" : ""}`}
              onClick={() => setActiveMenu(item.key)}
              aria-label={item.label}
              title={item.label}
            >
              <AssetIcon src={item.iconSrc} className="feature-rail__icon" />
              {item.key === "settings" ? (
                <span className="feature-rail__label feature-rail__label--stacked">
                  <span>기타</span>
                  <span>환경설정</span>
                </span>
              ) : (
                <span className="feature-rail__label">{item.label}</span>
              )}
            </button>
          ))}
        </nav>
        <SectionCard
          eyebrow="업무대화 우선"
          title="대화 세션"
          actions={
            <div className="inline-actions">
              <span className="pill pill--soft">
                {filteredWorkSessions.length}/{snapshot.workSessions.length}개 세션
              </span>
              <button
                type="button"
                className="button-secondary"
                aria-label="새 세션"
                aria-expanded={sessionCreateExpanded}
                onClick={() => setSessionCreateExpanded((current) => !current)}
              >
                +
              </button>
            </div>
          }
        >
          <div className="session-rail__scroll">
            <div className="session-rail__summary">
              <p>왼쪽은 세션을 고르는 곳입니다. 일정 연결은 가운데 대화 화면에서 자연스럽게 이어집니다.</p>
              <label className="session-rail__search">
                세션 검색
                <input
                  data-testid="session-rail-search"
                  value={sessionRailQuery}
                  onChange={(event) => setSessionRailQuery(event.target.value)}
                  placeholder="세션 제목, 일정 제목, 최근 메시지 검색"
                />
              </label>
            </div>
            {sessionCreateExpanded ? (
              <form className="stack-form session-rail__quick-create" onSubmit={submitWorkSession}>
                <label>
                  새 세션 제목
                  <input
                    value={sessionForm.title}
                    onChange={(event) => setSessionForm({ title: event.target.value })}
                    placeholder="예: 주간 보고 준비"
                    required
                  />
                </label>
                <div className="inline-actions">
                  <button type="submit" disabled={submitting}>
                    세션 만들기
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      setSessionForm({ title: "" });
                      setSessionCreateExpanded(false);
                    }}
                  >
                    취소
                  </button>
                </div>
              </form>
            ) : null}
            {renderCompactSessionRailList()}
          </div>
        </SectionCard>
      </aside>
    );
  }

  function scheduleViewLabel(view: "month" | "week" | "day") {
    switch (view) {
      case "month":
        return "월";
      case "day":
        return "일";
      case "week":
      default:
        return "주";
    }
  }

  async function browseFileOrgTargetPath() {
    try {
      const selectedPath = await pickDirectory();
      if (selectedPath) {
        setFileOrgTargetPath(selectedPath);
      }
    } catch (browseError) {
      setError(browseError instanceof Error ? browseError.message : "대상 폴더를 고르지 못했습니다.");
    }
  }

  function buildSchedulePlannerSlots() {
    const anchor =
      plannerAnchorAt ||
      selectedSchedule?.starts_at ||
      scheduleForm.starts_at ||
      snapshot.schedules[0]?.starts_at ||
      new Date().toISOString();
    const anchorDate = new Date(anchor);
    const safeAnchorDate = Number.isNaN(anchorDate.getTime()) ? new Date() : anchorDate;

    const overlappingSchedules = (rangeStart: Date, rangeEnd: Date) =>
      snapshot.schedules.filter((schedule) => {
        const scheduleStart = new Date(schedule.starts_at).getTime();
        const scheduleEnd = new Date(schedule.ends_at).getTime();
        return scheduleStart < rangeEnd.getTime() && scheduleEnd > rangeStart.getTime();
      });
    const linkedSessionTitlesForSchedules = (schedules: ScheduleItem[]) =>
      Array.from(
        new Set(
          schedules.flatMap((schedule) =>
            snapshot.workSessions
              .filter((session) => session.schedule_id === schedule.id)
              .map((session) => session.title),
          ),
        ),
      );

    if (scheduleForm.view === "day") {
      return Array.from({ length: 10 }, (_, index) => {
        const startHour = 9 + index;
        const endHour = startHour + 1;
        const rangeStart = startOfDay(safeAnchorDate);
        rangeStart.setHours(startHour, 0, 0, 0);
        const rangeEnd = new Date(rangeStart);
        rangeEnd.setHours(endHour, 0, 0, 0);
        const schedules = overlappingSchedules(rangeStart, rangeEnd);
        const linkedSessionTitles = linkedSessionTitlesForSchedules(schedules);
        return {
          id: `day-${formatDateInputValue(rangeStart, startHour)}-${index}`,
          startValue: formatDateInputValue(rangeStart, startHour),
          endValue: formatDateInputValue(rangeStart, endHour),
          title: `${String(startHour).padStart(2, "0")}:00`,
          subtitle: `${safeAnchorDate.getMonth() + 1}월 ${safeAnchorDate.getDate()}일`,
          scheduledCount: schedules.length,
          primaryScheduleId: schedules[0]?.id ?? null,
          primaryScheduleTitle: schedules[0]?.title ?? null,
          scheduleTitles: schedules.map((schedule) => schedule.title),
          primaryLinkedSessionTitle: linkedSessionTitles[0] ?? null,
          linkedSessionTitles,
          hasLinkedSession: schedules.some((schedule) =>
            snapshot.workSessions.some((session) => session.schedule_id === schedule.id),
          ),
          ariaLabel: `${safeAnchorDate.getMonth() + 1}월 ${safeAnchorDate.getDate()}일 ${String(startHour).padStart(2, "0")}:00 일정 칸 선택`,
          dayLabel: null,
          inCurrentMonth: true,
        };
      });
    }

    if (scheduleForm.view === "week") {
      const weekStart = addDays(startOfDay(safeAnchorDate), -safeAnchorDate.getDay());
      return Array.from({ length: 7 }, (_, index) => {
        const rangeStart = addDays(weekStart, index);
        const rangeEnd = addDays(rangeStart, 1);
        const schedules = overlappingSchedules(rangeStart, rangeEnd);
        const linkedSessionTitles = linkedSessionTitlesForSchedules(schedules);
        return {
          id: `week-${formatDateInputValue(rangeStart)}`,
          startValue: formatDateInputValue(rangeStart, 9),
          endValue: formatDateInputValue(rangeStart, 10),
          title: `${rangeStart.getMonth() + 1}/${rangeStart.getDate()}`,
          subtitle: schedules[0]
            ? `${formatDateTime(schedules[0].starts_at)} - ${schedules[0].title}`
            : "등록 일정 없음",
          scheduledCount: schedules.length,
          primaryScheduleId: schedules[0]?.id ?? null,
          primaryScheduleTitle: schedules[0]?.title ?? null,
          scheduleTitles: schedules.map((schedule) => schedule.title),
          primaryLinkedSessionTitle: linkedSessionTitles[0] ?? null,
          linkedSessionTitles,
          hasLinkedSession: schedules.some((schedule) =>
            snapshot.workSessions.some((session) => session.schedule_id === schedule.id),
          ),
          ariaLabel: `${WEEKDAY_LABELS[index]}요일 일정 칸 선택`,
          dayLabel: WEEKDAY_LABELS[index],
          inCurrentMonth: true,
        };
      });
    }

    const monthStart = new Date(safeAnchorDate.getFullYear(), safeAnchorDate.getMonth(), 1);
    const gridStart = addDays(monthStart, -monthStart.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const rangeStart = addDays(gridStart, index);
      const rangeEnd = addDays(rangeStart, 1);
      const schedules = overlappingSchedules(rangeStart, rangeEnd);
      const linkedSessionTitles = linkedSessionTitlesForSchedules(schedules);
      return {
        id: `month-${formatDateInputValue(rangeStart)}`,
        startValue: formatDateInputValue(rangeStart, 9),
        endValue: formatDateInputValue(rangeStart, 10),
        title: `${rangeStart.getDate()}`,
          subtitle: schedules[0]?.title ?? "빈 일정",
        scheduledCount: schedules.length,
        primaryScheduleId: schedules[0]?.id ?? null,
        primaryScheduleTitle: schedules[0]?.title ?? null,
        scheduleTitles: schedules.map((schedule) => schedule.title),
        primaryLinkedSessionTitle: linkedSessionTitles[0] ?? null,
        linkedSessionTitles,
        hasLinkedSession: schedules.some((schedule) =>
          snapshot.workSessions.some((session) => session.schedule_id === schedule.id),
        ),
        ariaLabel: `${rangeStart.getMonth() + 1}월 ${rangeStart.getDate()}일 일정 칸 선택`,
        dayLabel: WEEKDAY_LABELS[index % 7],
        inCurrentMonth: rangeStart.getMonth() === safeAnchorDate.getMonth(),
      };
    });
  }

  function applySchedulePlannerSlot(slotId: string, startValue: string, endValue: string) {
    setSelectedPlannerSlotId(slotId);
    setSelectedScheduleId("");
    setPlannerAnchorAt(startValue);
    setScheduleForm((current) => ({
      ...current,
      title: "",
      starts_at: startValue,
      ends_at: endValue,
    }));
  }

  function beginScheduleInlineEdit(schedule: ScheduleItem) {
    setSelectedScheduleId(schedule.id);
    setSelectedPlannerSlotId(`existing-${schedule.id}`);
    setPlannerAnchorAt(schedule.starts_at);
    setScheduleForm((current) => ({
      ...current,
      title: schedule.title,
      starts_at: schedule.starts_at.slice(0, 16),
      ends_at: schedule.ends_at.slice(0, 16),
    }));
  }

  function shiftPlannerAnchor(direction: -1 | 1) {
    const anchor = new Date(
      plannerAnchorAt ||
        selectedSchedule?.starts_at ||
        scheduleForm.starts_at ||
        snapshot.schedules[0]?.starts_at ||
        new Date().toISOString(),
    );
    const safeAnchor = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
    const next = new Date(safeAnchor);
    if (scheduleForm.view === "month") {
      next.setMonth(next.getMonth() + direction);
    } else if (scheduleForm.view === "week") {
      next.setDate(next.getDate() + direction * 7);
    } else {
      next.setDate(next.getDate() + direction);
    }
    setPlannerAnchorAt(next.toISOString());
  }

  function resetPlannerAnchor() {
    setPlannerAnchorAt(new Date().toISOString());
  }

  function renderScheduleSection() {
    const plannerSlots = buildSchedulePlannerSlots();
    const currentViewLabel = scheduleViewLabel(scheduleForm.view);
    const plannerAnchor =
      plannerAnchorAt ||
      selectedSchedule?.starts_at ||
      scheduleForm.starts_at ||
      snapshot.schedules[0]?.starts_at ||
      new Date().toISOString();
    const plannerAnchorDate = new Date(plannerAnchor);
    const safePlannerAnchorDate = Number.isNaN(plannerAnchorDate.getTime()) ? new Date() : plannerAnchorDate;
    const weekStart = addDays(startOfDay(safePlannerAnchorDate), -safePlannerAnchorDate.getDay());
    const weekEnd = addDays(weekStart, 6);
    const plannerAnchorLabel =
      scheduleForm.view === "month"
        ? `${safePlannerAnchorDate.getFullYear()}년 ${safePlannerAnchorDate.getMonth() + 1}월`
        : scheduleForm.view === "week"
          ? `${weekStart.getMonth() + 1}/${weekStart.getDate()} - ${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`
          : `${safePlannerAnchorDate.getMonth() + 1}월 ${safePlannerAnchorDate.getDate()}일`;
    const editingExistingSchedule =
      selectedPlannerSlotId.startsWith("existing-") &&
      Boolean(selectedSchedule) &&
      selectedScheduleId === selectedSchedule?.id;
    const selectedScheduleLinkedSession =
      editingExistingSchedule && selectedSchedule
        ? snapshot.workSessions.find((session) => session.schedule_id === selectedSchedule.id) ?? null
        : null;
    const formatScheduleSlotTooltip = (slot: (typeof plannerSlots)[number]) => {
      if (slot.scheduledCount === 0) {
        return `${slot.ariaLabel}\n등록 일정 없음`;
      }
      const lines = [
        `${slot.title} · ${slot.subtitle}`,
        `일정 ${slot.scheduledCount}개: ${slot.scheduleTitles.join(", ")}`,
        slot.linkedSessionTitles.length ? `연결 세션: ${slot.linkedSessionTitles.join(", ")}` : "연결 세션 없음",
        slot.hasLinkedSession ? "상태: 세션 연결 일정" : "상태: 독립 일정",
      ];
      return lines.filter(Boolean).join("\n");
    };
    const plannerDayHeaders =
      scheduleForm.view === "day" ? null : WEEKDAY_LABELS.map((label) => (
        <div key={label} className="schedule-grid__header" data-testid={`schedule-grid-header-${label}`}>
          {label}
        </div>
      ));
    return (
      <>
        <SectionCard
          eyebrow="calendar-first planner"
          title="업무일정 캘린더"
          actions={
            <div className="inline-actions">
              <span className="pill pill--soft">현재 보기: {currentViewLabel}</span>
              <span className="pill pill--soft">{plannerAnchorLabel}</span>
            </div>
          }
        >
          <div className="calendar-ux" data-testid="schedule-planner-section">
            <div className="calendar-body-grid">
          <div className="schedule-planner">
            <div className="planner-toolbar">
              <div className="planner-toolbar__group planner-toolbar__group--views">
                <button
                  type="button"
                  className={scheduleForm.view === "month" ? "" : "button-secondary"}
                  onClick={() =>
                    setScheduleForm((current) => ({
                      ...current,
                      view: "month",
                    }))
                  }
                >
                  월
                </button>
                <button
                  type="button"
                  className={scheduleForm.view === "week" ? "" : "button-secondary"}
                  onClick={() =>
                    setScheduleForm((current) => ({
                      ...current,
                      view: "week",
                    }))
                  }
                >
                  주
                </button>
                <button
                  type="button"
                  className={scheduleForm.view === "day" ? "" : "button-secondary"}
                  onClick={() =>
                    setScheduleForm((current) => ({
                      ...current,
                      view: "day",
                    }))
                  }
                >
                  일
                </button>
              </div>
              <div className="planner-toolbar__group planner-toolbar__group--nav">
                <button type="button" className="button-secondary" onClick={() => shiftPlannerAnchor(-1)}>
                  <ChevronLeft size={16} aria-hidden="true" />
                  이전
                </button>
                <button type="button" className="button-secondary" onClick={() => resetPlannerAnchor()}>
                  오늘
                </button>
                <button type="button" className="button-secondary" onClick={() => shiftPlannerAnchor(1)}>
                  다음
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            <p className="subtle-text">
              등록된 일정을 보려면 시간 칸을 눌러 시작/종료 시각을 바로 채울 수 있습니다.
            </p>
            {plannerDayHeaders ? (
              <div className={`schedule-grid-headers schedule-grid-headers--${scheduleForm.view}`}>
                {plannerDayHeaders}
              </div>
            ) : null}
            <div className={`schedule-slot-grid schedule-slot-grid--${scheduleForm.view}`}>
              {plannerSlots.map((slot, index) => (
                <button
                  key={slot.id}
                  type="button"
                  className={[
                    "schedule-slot",
                    selectedPlannerSlotId === slot.id ? "schedule-slot--selected" : "",
                    slot.inCurrentMonth ? "" : "schedule-slot--muted",
                    slot.scheduledCount > 0 ? "schedule-slot--occupied" : "",
                    slot.scheduledCount > 1 ? "schedule-slot--busy" : "",
                    slot.scheduledCount > 0 && slot.hasLinkedSession ? "schedule-slot--linked" : "",
                    slot.scheduledCount > 0 && !slot.hasLinkedSession ? "schedule-slot--standalone" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-testid={`schedule-slot-${index}`}
                  aria-label={slot.ariaLabel}
                  title={formatScheduleSlotTooltip(slot)}
                  onClick={() => {
                    if (slot.primaryScheduleId) {
                      const existingSchedule = snapshot.schedules.find((schedule) => schedule.id === slot.primaryScheduleId);
                      if (existingSchedule) {
                        beginScheduleInlineEdit(existingSchedule);
                        return;
                      }
                    }
                    applySchedulePlannerSlot(slot.id, slot.startValue, slot.endValue);
                  }}
                >
                  {slot.dayLabel && scheduleForm.view === "week" ? (
                    <span className="schedule-slot__eyebrow schedule-slot__line" title={slot.dayLabel}>
                      {slot.dayLabel}
                    </span>
                  ) : null}
                  <strong className="schedule-slot__line" title={slot.title}>{slot.title}</strong>
                  <span className="schedule-slot__line" title={slot.subtitle}>{slot.subtitle}</span>
                  {slot.scheduledCount > 0 ? (
                    <>
                      <span
                        data-testid={`schedule-slot-existing-count-${index}`}
                        className="schedule-slot__meta schedule-slot__line"
                        title={`등록 일정 ${slot.scheduledCount}개`}
                      >
                        {slot.scheduledCount}
                      </span>
                      <span
                        data-testid={`schedule-slot-existing-title-${index}`}
                        className="schedule-slot__meta schedule-slot__line"
                        title={slot.primaryScheduleTitle ?? undefined}
                      >
                        {slot.primaryScheduleTitle}
                      </span>
                      {slot.primaryLinkedSessionTitle ? (
                        <span
                          data-testid={`schedule-slot-session-title-${index}`}
                          className="schedule-slot__meta schedule-slot__line"
                          title={slot.primaryLinkedSessionTitle}
                        >
                          {slot.primaryLinkedSessionTitle}
                        </span>
                      ) : null}
                      {slot.scheduleTitles.length > 1 ? (
                        <span
                          className="schedule-slot__meta schedule-slot__meta--strong schedule-slot__line"
                          title={slot.scheduleTitles.slice(1).join(", ")}
                        >
                          +{slot.scheduleTitles.length - 1}개 더
                        </span>
                      ) : null}
                      {slot.hasLinkedSession ? (
                        <span
                          className="schedule-slot__badge schedule-slot__line"
                          data-testid={`schedule-slot-link-state-${index}`}
                          title={slot.linkedSessionTitles.length ? `연결 세션: ${slot.linkedSessionTitles.join(", ")}` : "세션 연결"}
                        >
                          세션 연결
                        </span>
                      ) : (
                        <span
                          className="schedule-slot__badge schedule-slot__badge--muted schedule-slot__line"
                          data-testid={`schedule-slot-link-state-${index}`}
                          title="연결된 업무대화 세션 없음"
                        >
                          독립 일정
                        </span>
                      )}
                      {slot.primaryScheduleId ? (
                        <span className="schedule-slot__hint schedule-slot__line" title="클릭해 일정 편집">
                          클릭해 일정 편집
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </button>
              ))}
            </div>

            <div className="planner-inline-editor">
              <div className="planner-inline-editor__header">
                <strong>{editingExistingSchedule ? "기존 일정 편집" : "선택 칸 일정 입력"}</strong>
                <span className="subtle-text">
                  {scheduleForm.starts_at
                    ? `${scheduleForm.starts_at} -> ${scheduleForm.ends_at || "종료 미선택"}`
                    : "아직 선택 없음"}
                </span>
              </div>
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
                          view: event.target.value as "month" | "week" | "day",
                        }))
                      }
                    >
                      <option value="month">월</option>
                      <option value="week">주</option>
                      <option value="day">일</option>
                    </select>
                  </label>
                  <button type="submit" disabled={submitting}>
                    {editingExistingSchedule ? "일정 수정 저장" : "일정 등록"}
                  </button>
                  {editingExistingSchedule ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => {
                        setSelectedScheduleId("");
                        setSelectedPlannerSlotId("");
                        setScheduleForm({ title: "", starts_at: "", ends_at: "", view: scheduleForm.view });
                      }}
                    >
                      새 일정 입력으로 전환
                    </button>
                  ) : null}
                  {editingExistingSchedule && selectedSchedule ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void openChatForSchedule(selectedSchedule)}
                    >
                      {selectedScheduleLinkedSession ? "연결 세션 열기" : "연결 세션 만들기"}
                    </button>
                  ) : null}
                  {editingExistingSchedule ? (
                    <button
                      type="button"
                      className="button-secondary button-danger"
                      onClick={() => void deleteSelectedSchedule()}
                      disabled={submitting}
                    >
                      일정 삭제
                    </button>
                  ) : null}
                </div>
              </form>
            </div>
          </div>
          </div>
          </div>
        </SectionCard>
      </>
    );
  }

  function renderScheduleSectionLegacy() {
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
                      view: event.target.value as "month" | "week" | "day",
                    }))
                  }
                >
                  <option value="month">월</option>
                  <option value="week">주</option>
                  <option value="day">일</option>
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
                    <button type="button" onClick={() => void openChatForSchedule(schedule)}>
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
    const activeChatModel =
      chatModelOverride.trim() || snapshot.settings?.defaults.llm_model || "현재 활성 모델";
    return (
      <>
        <SectionCard
          title={selectedSession ? selectedSession.title : "세션을 선택하세요"}
          className="chat-panel-card"
          testId="chat-panel-card"
        >
          {selectedSession ? (
            <div className="chat-workspace" data-testid="chat-workspace">
              <div className="chat-thread" data-testid="chat-thread-shell" ref={chatThreadRef}>
                {selectedSessionMessages.length === 0 ? (
                  <EmptyState
                    title="아직 대화가 없습니다."
                    body="입력창에 요청이나 메모를 남기면 이 세션의 대화가 쌓입니다."
                  />
                ) : (
                  selectedSessionMessages.map((message) => (
                    <article
                      key={message.id}
                      className={`chat-message ${
                        message.role === "assistant" ? "chat-message--assistant" : "chat-message--user"
                      }`}
                      data-testid="chat-thread-message"
                    >
                      <div className="chat-message__meta">
                        {message.role === "assistant" ? (
                          <span className="chat-message__eyebrow">Assistant</span>
                        ) : null}
                        <div className="chat-message__meta-pills">
                          {describeMessageStatus(message.status) && !formatLatencyBadge(message.latency_ms) ? (
                            <span className="pill pill--soft">{describeMessageStatus(message.status)}</span>
                          ) : null}
                          {message.role === "assistant" && formatLatencyBadge(message.latency_ms) ? (
                            <span className="pill pill--soft" data-testid={`message-latency-${message.id}`}>
                              {formatLatencyBadge(message.latency_ms)}
                            </span>
                            ) : null}
                        {message.role === "user" ? <span className="chat-message__eyebrow">You</span> : null}
                      </div>
                      </div>
                      {message.role === "assistant" && (message.provider || message.model) ? (
                        <p className="subtle-text chat-message__provider">
                          {[message.provider, message.model].filter(Boolean).join(" / ")}
                        </p>
                      ) : null}
                      {message.role === "assistant" ? (
                        <div className="chat-markdown">
                          {renderMarkdownContent(getVisibleMessageText(message), (target) => {
                            void openExternalTarget(target);
                          })}
                        </div>
                      ) : (
                        <div className="chat-user-bubble">
                          <p>{getVisibleMessageText(message)}</p>
                        </div>
                      )}
                      {message.attachments?.length ? (
                        <ul className="chat-attachment-list">
                          {message.attachments.map((attachment) => (
                            <li key={attachment.id}>
                              <span>{attachment.file_name}</span>
                              <span className="subtle-text">{attachment.size_bytes} bytes</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))
                )}
              </div>

              <div className="chat-session-toolbar">
                <label className="select-field chat-session-toolbar__schedule">
                  연결 일정
                  <select value={selectedScheduleId} onChange={(event) => setSelectedScheduleId(event.target.value)}>
                    <option value="">선택 안 함</option>
                    {snapshot.schedules.map((schedule) => (
                      <option key={schedule.id} value={schedule.id}>
                        {schedule.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="button-secondary"
                  data-testid={selectedSession.schedule_id ? "open-selected-session-schedule" : undefined}
                  onClick={() => {
                    if (selectedSession.schedule_id && selectedSessionSchedule) {
                      setSelectedScheduleId(selectedSessionSchedule.id);
                      setActiveMenu("schedule");
                      return;
                    }
                    if (selectedScheduleId) {
                      void linkSelectedSessionToSchedule();
                      return;
                    }
                    setActiveMenu("schedule");
                  }}
                >
                  {selectedSession.schedule_id ? "연결 일정 열기" : selectedScheduleId ? "선택 일정과 연결" : "일정 열기"}
                </button>
                <button type="button" className="button-secondary" onClick={openRelatedFileSearch}>
                  파일 연결
                </button>
                <button type="button" className="button-secondary" onClick={continueSelectedSessionToDocuments}>
                  문서작성으로 이어가기
                </button>
                {selectedSessionFileLinks.length > 0 ? (
                  <button
                    type="button"
                    className="button-secondary chat-file-count-button"
                    aria-expanded={chatFileLinksOpen}
                    onClick={() => setChatFileLinksOpen((current) => !current)}
                  >
                    연결 파일 {selectedSessionFileLinks.length}개
                  </button>
                ) : (
                  <span className="pill pill--soft">연결 파일 0개</span>
                )}
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void analyzeSelectedSessionForLearning()}
                >
                  이 세션 지식 반영
                </button>
              </div>

              {chatFileLinksOpen && selectedSessionFileLinks.length > 0 ? (
                <div className="chat-file-popover">
                  <div className="chat-file-popover__header">
                    <strong>연결 파일</strong>
                    <button
                      type="button"
                      className="button-secondary chat-file-popover__close"
                      aria-label="연결 파일 목록 닫기"
                      onClick={() => setChatFileLinksOpen(false)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                  {selectedSessionFileLinks.slice(0, 8).map((link) => (
                    <article key={link.id} className="chat-file-popover__item">
                      <div>
                        <strong>{link.label || link.file_path.split(/[\\/]/).pop() || "연결 파일"}</strong>
                        <p>{link.file_path}</p>
                      </div>
                      <button type="button" className="button-secondary" onClick={() => void removeSessionFileLink(link)}>
                        제거
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}

              {selectedSessionContextEvidence.length > 0 ? (
                <div className="chat-context-evidence" data-testid="chat-context-evidence">
                  <span className="chat-context-evidence__label">최근 응답 맥락</span>
                  {selectedSessionContextEvidence.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="pill pill--soft chat-context-evidence__pill"
                      onClick={() => openResponseContextDetail(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ) : null}

              <form className="chat-composer" data-testid="chat-composer-form" onSubmit={submitChatDraft}>
                {chatAttachmentPreviews.length ? (
                  <div className="chat-composer__preview-strip">
                    {chatAttachmentPreviews.map((preview) => (
                      <figure key={preview.key} className="chat-composer__preview-card">
                        <button
                          type="button"
                          className="chat-composer__preview-open"
                          aria-label={`${preview.name} 크게 보기`}
                          onClick={() => setChatImagePreviewOpen(preview)}
                        >
                          <img src={preview.url} alt={`${preview.name} 미리보기`} />
                        </button>
                        <button
                          type="button"
                          className="chat-composer__preview-remove"
                          aria-label={`${preview.name} 제거`}
                          onClick={() => removeChatAttachment(preview.attachmentId)}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                        <figcaption>{preview.name}</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
                {chatAttachments.length ? (
                  <div className="chat-composer__attachment-list">
                    {chatAttachments.map((attachment) => (
                      <span key={attachment.id} className="pill pill--soft chat-composer__attachment-pill">
                        <span>{attachment.file.name}</span>
                        <button
                          type="button"
                          className="chat-composer__attachment-remove"
                          aria-label={`${attachment.file.name} 첨부 제거`}
                          onClick={() => removeChatAttachment(attachment.id)}
                        >
                          <X size={12} aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="chat-composer__box">
                  <textarea
                    aria-label="업무대화 입력"
                    data-testid="chat-composer-input"
                    rows={4}
                    value={chatDraft}
                    onChange={(event) => setChatDraft(event.target.value)}
                    onKeyDown={handleChatComposerKeyDown}
                    placeholder="코덱스처럼 자유롭게 업무 메모, 지시, 다음 액션을 적어보세요."
                  />
                  <div className="chat-composer__actions">
                    <div className="chat-composer__left-actions">
                      <label className="chat-composer__plus-button" aria-label="파일 첨부">
                        <Plus size={16} aria-hidden="true" />
                        <input
                          ref={chatAttachmentInputRef}
                          data-testid="chat-attachment-input"
                          type="file"
                          multiple
                          hidden
                          onChange={(event) => appendChatAttachments(event.target.files)}
                        />
                      </label>
                      <button
                        type="button"
                        className={`button-secondary chat-composer__detail-toggle ${chatDetailsOpen ? "is-active" : ""}`}
                        ref={chatDetailsButtonRef}
                        onClick={() => setChatDetailsOpen((current) => !current)}
                      >
                        <SlidersHorizontal size={16} aria-hidden="true" />
                        세부 설정
                      </button>
                    </div>
                    <div className="chat-composer__right-actions">
                      <button
                        type="submit"
                        data-testid="chat-composer-submit"
                        disabled={!chatDraft.trim() && chatAttachments.length === 0}
                      >
                        보내기
                      </button>
                    </div>
                  </div>
                </div>
                {chatDetailsOpen ? (
                  <div
                    ref={chatDetailsPanelRef}
                    className="chat-composer__detail-popover"
                    role="dialog"
                    aria-label="채팅 세부 설정"
                  >
                    <label>
                      이번 응답 모델
                      <input
                        value={chatModelOverride}
                        onChange={(event) => setChatModelOverride(event.target.value)}
                        placeholder={snapshot.settings?.defaults.llm_model ?? "현재 활성 모델"}
                      />
                    </label>
                    <label className="select-field">
                      리즈닝 강도
                      <select
                        value={chatReasoningEffort}
                        onChange={(event) =>
                          setChatReasoningEffort(
                            event.target.value as "auto" | "minimal" | "low" | "medium" | "high",
                          )
                        }
                      >
                        <option value="auto">자동</option>
                        <option value="minimal">간단</option>
                        <option value="low">낮음</option>
                        <option value="medium">보통</option>
                        <option value="high">높음</option>
                      </select>
                    </label>
                    <p className="subtle-text">
                      현재 모델: {activeChatModel} / 리즈닝: {describeReasoningEffort(chatReasoningEffort)}
                    </p>
                  </div>
                ) : null}
              </form>
              {chatImagePreviewOpen ? (
                <div
                  className="chat-image-dialog-backdrop"
                  onClick={() => setChatImagePreviewOpen(null)}
                >
                  <div
                    className="chat-image-dialog"
                    role="dialog"
                    aria-label={`${chatImagePreviewOpen.name} 미리보기`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="chat-image-dialog__close"
                      aria-label="미리보기 닫기"
                      onClick={() => setChatImagePreviewOpen(null)}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                    <img src={chatImagePreviewOpen.url} alt={`${chatImagePreviewOpen.name} 미리보기`} />
                    <p>{chatImagePreviewOpen.name}</p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title="아직 열린 업무 세션이 없습니다."
              body="왼쪽 상단의 + 버튼으로 새 세션을 만들고 대화를 시작하세요."
            />
          )}
        </SectionCard>
      </>
    );
  }

  function renderSearchSection() {
    return (
      <>
        <SectionCard eyebrow="로컬 우선" title="내장 파일찾기">
          <div className="local-file-explorer" data-testid="local-file-explorer">
            <section className="local-file-explorer__sidebar" data-testid="local-file-scope-panel">
              <p className="settings-grid__label">검색 범위</p>
              <div className="local-file-explorer__scope">
                <span className="pill">지식폴더 {snapshot.knowledgeSources.length}</span>
                <span className="pill pill--soft">스캔 파일 {snapshot.knowledgeSourceFiles.length}</span>
                <span className="pill pill--soft">본문 {snapshot.knowledgeSourceFiles.filter((file) => file.status === "indexed").length}</span>
              </div>
              <div className="hint-box">
                <span className="settings-grid__label">현재 연결 대상 세션</span>
                <strong>{selectedSession?.title ?? "연결 대상 세션 없음"}</strong>
                <p>
                  {selectedSession
                    ? "검색 결과의 개별 파일을 현재 업무대화 세션에 바로 연결합니다."
                    : "검색은 가능하지만 세션 연결은 왼쪽에서 업무대화를 선택한 뒤 사용할 수 있습니다."}
                </p>
              </div>
              <button
                type="button"
                className="button-secondary local-file-explorer__index-button"
                disabled={localFileIndexLoading}
                onClick={() => void runLocalFileIndexRebuild()}
              >
                <RefreshCcw size={15} />
                {localFileIndexLoading ? "인덱스 갱신 중" : "파일명 인덱스 갱신"}
              </button>
              {localFileIndexResult ? (
                <div className="document-preview__meta">
                  <span>인덱스 {localFileIndexResult.indexed_count}개</span>
                  <span>{localFileIndexResult.partial ? "부분 완료" : "완료"}</span>
                </div>
              ) : null}
            </section>

            <section className="local-file-explorer__main" data-testid="local-file-search-panel">
              <form className="local-file-search-form" onSubmit={(event) => void runLocalFileSearch(event)}>
                <label>
                  파일 검색
                  <input
                    data-testid="local-file-search-input"
                    value={localFileQuery}
                    onChange={(event) => setLocalFileQuery(event.target.value)}
                    placeholder="파일명, 경로, 문서 본문 키워드"
                  />
                </label>
                <button type="submit" disabled={localFileSearchLoading || !localFileQuery.trim()}>
                  <Search size={16} />
                  검색
                </button>
              </form>

              {localFileSearchResult ? (
                <div className="inline-actions">
                  <span className="pill pill--soft">지식폴더 {localFileSearchResult.knowledge_index_count ?? 0}</span>
                  <span className="pill pill--soft">파일명 인덱스 {localFileSearchResult.local_index_count ?? 0}</span>
                  <span className="pill">결과 {localFileSearchResult.items.length}</span>
                  {localFileSearchResult.partial ? <span className="pill pill--warning">부분 검색</span> : null}
                </div>
              ) : (
                <div className="helper-copy">
                  <p>파일 탐색기처럼 빠르게 검색하고, 필요한 파일만 현재 업무대화 세션에 연결합니다.</p>
                  <p>Anything은 보조 고급검색으로만 남기고 기본 흐름은 내장 인덱서를 우선 사용합니다.</p>
                </div>
              )}

              {localFileSearchResult ? (
                localFileSearchResult.items.length === 0 ? (
                  <EmptyState
                    title="파일 검색 결과가 없습니다."
                    body="지식폴더에 업무 폴더를 등록하고 스캔했는지 확인하거나 다른 검색어를 입력해보세요."
                  />
                ) : (
                  <div className="item-list local-file-results" aria-label="파일 검색 결과">
                    {localFileSearchResult.items.map((hit) => {
                      const linked = isLocalFileLinked(hit.file.file_path);
                      return (
                        <article
                          key={hit.file.id}
                          className={[
                            "list-card",
                            "local-file-result-card",
                            selectedLocalFileHit?.file.id === hit.file.id ? "is-selected" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          data-testid={`local-file-result-${hit.file.id}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedLocalFileHit(hit)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedLocalFileHit(hit);
                            }
                          }}
                        >
                          <div className="list-card__main list-card__main--static">
                            <div>
                              <h3>{hit.file.title || fileNameFromPath(hit.file.file_path)}</h3>
                              <p>{hit.file.relative_path} · {relativePath(hit.file.file_path)}</p>
                            </div>
                            <span className="pill">score {hit.score}</span>
                          </div>
                          <div className="inline-actions">
                            {(hit.match_reasons ?? []).map((reason) => (
                              <span key={reason} className="pill pill--soft">
                                {reason}
                              </span>
                            ))}
                          </div>
                          {hit.file.text_excerpt ? <p className="subtle-text">{hit.file.text_excerpt}</p> : null}
                          <div className="inline-actions">
                            <button
                              type="button"
                              disabled={!selectedSessionId || linked || submitting}
                              onClick={(event) => {
                                event.stopPropagation();
                                void connectLocalFileToSession(hit);
                              }}
                            >
                              <Plus size={15} />
                              {linked ? "연결됨" : "세션에 연결"}
                            </button>
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                void openExternalTarget(hit.file.file_path);
                              }}
                            >
                              <FileText size={15} />
                              파일 열기
                            </button>
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                void copyLocalFilePath(hit.file.file_path);
                              }}
                            >
                              경로 복사
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )
              ) : (
                <EmptyState
                  title="검색어를 입력하면 파일 결과가 여기에 표시됩니다."
                  body="파일명, 상대경로, 추출 제목, 본문 발췌를 함께 검색합니다."
                />
              )}
            </section>

          </div>
        </SectionCard>

        <SectionCard eyebrow="선택 연계" title="외부 고급검색">
          <details className="knowledge-detail-section">
            <summary>Anything로 더 찾아보기</summary>
            <div className="stack-form">
            {selectedSession ? (
              <div className="detail-panel">
                <p className="detail-panel__title">Anything 가져오기 대상 세션</p>
                <div className="document-preview__meta">
                  <strong>{selectedSession.title}</strong>
                  <span>가져온 파일 경로는 이 업무대화 세션에도 함께 연결됩니다.</span>
                </div>
              </div>
            ) : null}
            <div className="hint-box">
              <strong>
                {runtimeStatus?.anything_available
                  ? "외부 설치된 Anything 앱을 감지했습니다."
                  : "현재 Anything 앱이 감지되지 않았습니다."}
              </strong>
              <p>
                {runtimeStatus?.anything_available
                  ? runtimeStatus.anything_autopaste_enabled
                    ? "승인 후 열기를 누르면 감지된 Anything 앱을 실행하고 검색어 자동 붙여넣기를 시도합니다."
                    : "승인 후 열기를 누르면 감지된 Anything 앱을 실행합니다."
                  : "감지되지 않으면 Anything 설치 페이지를 열어 설치 후 다시 연계할 수 있습니다."}
              </p>
              {runtimeStatus?.anything_path ? (
                <p className="subtle-text">{runtimeStatus.anything_path}</p>
              ) : null}
              {!runtimeStatus?.anything_available ? (
                <button type="button" className="button-secondary" onClick={() => void openAnythingInstallGuide()}>
                  Anything 설치 안내 열기
                </button>
              ) : null}
            </div>
            <label>
              검색어 힌트
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
              <span className="subtle-text">외부 실행은 승인 흐름과 결과 기록에 남습니다.</span>
            </div>
            </div>
          </details>
        </SectionCard>

        <SectionCard eyebrow="Anything history" title="승인 후 다시 열기">
          <details className="knowledge-detail-section">
            <summary>Anything 실행 기록 보기</summary>
          {snapshot.anythingLaunches.length === 0 ? (
            <EmptyState
              title="아직 다시 열기 요청이 없습니다."
              body="Anything 실행 요청을 보내면 승인 상태와 다시 열기 링크가 여기에 쌓입니다."
            />
          ) : (
            <div className="item-list">
              {snapshot.anythingLaunches.map((launch) => {
                const relatedTicket = snapshot.approvalTickets.find(
                  (ticket) => ticket.id === launch.approval_ticket_id,
                );
                const canOpen = relatedTicket?.status === "approved";
                const anythingDetected = runtimeStatus?.anything_available ?? false;
                const openLabel = anythingDetected
                    ? launch.status === "applied"
                    ? "Anything 다시 열기"
                    : "승인 후 Anything 열기"
                  : launch.status === "applied"
                    ? "설치 안내 다시 열기"
                    : "승인 후 설치 안내 열기";

                return (
                  <article key={launch.id} className="list-card">
                    <div className="list-card__main list-card__main--static">
                      <div>
                        <h3>{launch.query}</h3>
                        <p>{launch.status === "applied" ? "적용 완료" : relatedTicket?.status ?? launch.status}</p>
                        <p className="subtle-text">{launch.launch_target}</p>
                        {!anythingDetected ? (
                          <p className="subtle-text">
                            Anything이 감지되지 않아 설치 안내 페이지를 먼저 엽니다.
                          </p>
                        ) : null}
                      </div>
                      <span className="pill">Anything</span>
                    </div>
                    <div className="inline-actions">
                      {canOpen ? (
                        <button type="button" aria-label={openLabel} onClick={() => void launchAnything(launch)}>
                          {launch.status === "applied" ? "다시 열기" : "승인 후 열기"}
                        </button>
                      ) : null}
                    </div>
                    {launch.status === "applied" ? (
                      <form
                        className="stack-form"
                        onSubmit={(event) => void submitAnythingReferenceImport(event, launch)}
                      >
                        <label>
                          가져올 묶음 제목
                          <input
                            value={anythingImportForms[launch.approval_ticket_id]?.title ?? ""}
                            onChange={(event) =>
                              setAnythingImportForms((current) => ({
                                ...current,
                                [launch.approval_ticket_id]: {
                                  title: event.target.value,
                                  paths: current[launch.approval_ticket_id]?.paths ?? "",
                                },
                              }))
                            }
                            placeholder="예산 검토 결과 묶음"
                            required
                          />
                        </label>
                        <label>
                          선택한 경로 붙여넣기
                          <textarea
                            value={anythingImportForms[launch.approval_ticket_id]?.paths ?? ""}
                            onChange={(event) =>
                              setAnythingImportForms((current) => ({
                                ...current,
                                [launch.approval_ticket_id]: {
                                  title: current[launch.approval_ticket_id]?.title ?? "",
                                  paths: event.target.value,
                                },
                              }))
                            }
                            placeholder={"C:\\docs\\budget.xlsx\nC:\\docs\\meeting-notes.md"}
                            rows={4}
                            required
                          />
                        </label>
                        <button type="submit" disabled={submitting}>
                          Reference Set으로 가져오기
                        </button>
                        {lastImportedAnythingReferenceSetId === selectedReferenceSetId ? (
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={continueImportedAnythingToDocuments}
                          >
                            문서작성으로 이어가기
                          </button>
                        ) : null}
                      </form>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
          </details>
        </SectionCard>

        <SectionCard eyebrow="고급" title="작업자료 묶음으로 저장">
          <details className="knowledge-detail-section">
            <summary>반복 사용할 자료 묶음 만들기</summary>
            <div className="helper-copy">
              <p>일상적인 파일찾기는 개별 파일을 세션에 바로 연결하면 충분합니다.</p>
              <p>같은 자료 구성을 여러 문서작성 작업에서 반복 사용할 때만 작업자료 묶음으로 저장하세요.</p>
            </div>
            <form className="stack-form" onSubmit={submitReferenceSet}>
              <label>
                작업자료 묶음 제목
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
                    placeholder="예산 메모"
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
                작업자료 묶음 등록
              </button>
            </form>
          </details>
        </SectionCard>
      </>
    );
  }

  function renderDocumentSection() {
    const selectedDocumentSession =
      snapshot.workSessions.find((session) => session.id === documentSourceSessionId) ??
      (documentSourceMode === "session" ? selectedSession : null);
    const selectedDocumentSessionSchedule = selectedDocumentSession?.schedule_id
      ? snapshot.schedules.find((schedule) => schedule.id === selectedDocumentSession.schedule_id) ?? null
      : null;
    const selectedDocumentSessionMessages = selectedDocumentSession
      ? sessionMessages[selectedDocumentSession.id] ?? selectedDocumentSession.messages ?? []
      : [];
    const selectedDocumentSessionFileLinks =
      selectedDocumentSession && selectedDocumentSession.id === selectedSession?.id ? selectedSessionFileLinks : [];

    return (
      <>
        <SectionCard eyebrow="작업 연결" title="자료 기반 문서작성 시작">
          <div className="stack-form">
            <div className="segmented-control" data-testid="document-source-mode">
              <label>
                <input
                  type="radio"
                  name="document-source-mode"
                  checked={documentSourceMode === "session"}
                  onChange={() => {
                    setDocumentSourceMode("session");
                    const sessionId = documentSourceSessionId || selectedSession?.id || "";
                    setDocumentSourceSessionId(sessionId);
                    if (sessionId) {
                      setSelectedSessionId(sessionId);
                    }
                  }}
                />
                대화세션에서 작성
              </label>
              <label>
                <input
                  type="radio"
                  name="document-source-mode"
                  checked={documentSourceMode === "direct"}
                  onChange={() => {
                    setDocumentSourceMode("direct");
                    setDocumentSourceSessionId("");
                  }}
                />
                바로 작성
              </label>
            </div>

            {documentSourceMode === "session" ? (
              <div className="grid-2">
                <label className="select-field">
                  연결할 대화세션
                  <select
                    value={documentSourceSessionId}
                    onChange={(event) => {
                      const nextSessionId = event.target.value;
                      const nextSession = snapshot.workSessions.find((session) => session.id === nextSessionId);
                      setDocumentSourceSessionId(nextSessionId);
                      if (nextSessionId) {
                        setSelectedSessionId(nextSessionId);
                      }
                      if (nextSession) {
                        setDocumentForm((current) => ({
                          ...current,
                          title: current.title.trim() ? current.title : `${nextSession.title} 문서`,
                          purpose:
                            !current.purpose.trim() || current.purpose === "보고서형"
                              ? "업무대화 세션 기반 정리"
                              : current.purpose,
                          outline:
                            current.outline.trim() ||
                            `${nextSession.title} 대화 내용을 바탕으로 문서를 작성합니다.`,
                        }));
                      }
                    }}
                  >
                    <option value="">선택 안 함</option>
                    {snapshot.workSessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="hint-box">
                  <strong>{selectedDocumentSession?.title ?? "선택된 세션 없음"}</strong>
                  <span>{selectedDocumentSessionSchedule?.title ?? "연결 일정 없음"}</span>
                  <span>대화 {selectedDocumentSessionMessages.length}개</span>
                  <span>연결 파일 {selectedDocumentSessionFileLinks.length}개</span>
                </div>
              </div>
            ) : (
              <div className="hint-box">
                <strong>세션 없이 바로 작성</strong>
                <span>작성 개요와 관련 파일 경로를 Content Base에 직접 남깁니다.</span>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard eyebrow="문서작성" title="HWPX 보고서 작업 시작">
          <form className="stack-form" onSubmit={submitDocumentGenerate}>
            <label>
              문서 제목
              <input
                value={documentForm.title}
                onChange={(event) => setDocumentForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="예: 주간 보고 초안"
                required
              />
            </label>
            <label>
              작업 설명
              <textarea
                value={documentForm.outline}
                onChange={(event) => setDocumentForm((current) => ({ ...current, outline: event.target.value }))}
                placeholder="문서작성 방향, 꼭 반영할 관점, 보고 대상, 강조할 결론 등을 자연어로 적습니다."
                rows={4}
              />
            </label>
            <div className="grid-2">
              <label className="select-field">
                산출보고서
                <select
                  value={documentForm.document_format}
                  onChange={(event) =>
                    setDocumentForm((current) => ({
                      ...current,
                      document_format: event.target.value as DocumentFormat,
                    }))
                  }
                >
                  {DOCUMENT_FORMAT_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="select-field">
                Reference Set
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

            <div className="document-format-guide" data-testid="document-format-guide">
              <div className="document-format-guide__intro">
                <span>public-doc-to-hwpx 작성 원칙</span>
                <strong>두괄식 · 개조식 · 한 문장 한 핵심 · 적/의/것/들 정리</strong>
                <p>보고서 작성요령을 Content Base 이후 HWPX 산출 단계에 적용해 읽히는 공공문서로 정리합니다.</p>
              </div>
              <div className="document-format-cards">
                {DOCUMENT_FORMAT_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={[
                      "document-format-card",
                      documentForm.document_format === option.key ? "document-format-card--selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() =>
                      setDocumentForm((current) => ({
                        ...current,
                        document_format: option.key,
                      }))
                    }
                  >
                    <span>{option.output}</span>
                    <strong>{option.label}</strong>
                    <p>{option.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="detail-panel">
              <div className="section-heading-row">
                <div>
                  <span className="eyebrow">FILES</span>
                  <strong>첨부/연결 파일</strong>
                </div>
                <span className="pill">
                  세션 {selectedDocumentSessionFileLinks.length}개 · 추가 {documentAttachmentDrafts.length}개
                </span>
              </div>
              {documentSourceMode === "session" ? (
                <div className="stack-list">
                  <h4>세션 연결 파일</h4>
                  {selectedDocumentSessionFileLinks.length > 0 ? (
                    selectedDocumentSessionFileLinks.map((link) => {
                      const label = link.label || link.file_path.split(/[\\/]/).pop() || "연결 파일";
                      return (
                        <article key={link.id} className="list-card list-card--compact">
                          <strong>{label}</strong>
                          <p>{link.file_path}</p>
                          <label>
                            {label} 활용방안
                            <textarea
                              value={documentFileUsageNotes[documentFileUsageKey(link.file_path)] ?? ""}
                              onChange={(event) => updateDocumentFileUsage(link.file_path, event.target.value)}
                              placeholder="예: 사실관계 근거, 통계 출처, 결재 참고자료 등"
                              rows={2}
                            />
                          </label>
                        </article>
                      );
                    })
                  ) : (
                    <div className="hint-box">선택한 대화세션에 연결된 파일이 없습니다.</div>
                  )}
                </div>
              ) : null}
              <div className="grid-2">
                <label>
                  추가 파일 경로
                  <textarea
                    value={documentForm.direct_file_paths_text}
                    onChange={(event) =>
                      setDocumentForm((current) => ({ ...current, direct_file_paths_text: event.target.value }))
                    }
                    placeholder="파일찾기에서 복사한 경로를 한 줄에 하나씩 붙여넣으세요."
                    rows={3}
                  />
                </label>
                <label>
                  추가 파일 활용방안
                  <textarea
                    value={documentForm.file_usage_note}
                    onChange={(event) =>
                      setDocumentForm((current) => ({ ...current, file_usage_note: event.target.value }))
                    }
                    placeholder="예: 회의결과 근거, 참고 통계, 결재용 양식 등"
                    rows={3}
                  />
                </label>
              </div>
              <div className="hint-box">
                <strong>보고서 관련 파일 첨부</strong>
                <input
                  ref={documentAttachmentInputRef}
                  type="file"
                  multiple
                  aria-label="보고서 관련 파일 첨부"
                  onChange={(event) => appendDocumentAttachments(event.currentTarget.files)}
                />
                {documentAttachmentDrafts.length > 0 ? (
                  <div className="chat-composer__attachment-list">
                    {documentAttachmentDrafts.map((item) => (
                      <span key={item.id} className="pill pill--soft chat-composer__attachment-pill">
                        <span>{item.file.name}</span>
                        <button
                          type="button"
                          className="chat-composer__attachment-remove"
                          aria-label={`${item.file.name} 첨부 제거`}
                          onClick={() => removeDocumentAttachment(item.id)}
                        >
                          <X size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="hint-box">
              <strong>사용자 HWPX/HWTX 양식</strong>
              <span>업로드한 양식은 최종 HWPX 생성 시 기본 문서로 열고, 선택한 보고서 유형에 맞춰 Content Base를 정리한 뒤 본문 슬롯에 반영합니다.</span>
              <input
                ref={documentTemplateInputRef}
                type="file"
                accept=".hwpx,.hwtx"
                aria-label="사용자 HWPX/HWTX 양식"
                onChange={handleDocumentTemplateUpload}
              />
              <label className="select-field">
                업로드된 양식 선택
                <select
                  value={documentForm.user_template_path}
                  onChange={(event) =>
                    setDocumentForm((current) => ({ ...current, user_template_path: event.target.value }))
                  }
                >
                  <option value="">선택 안 함</option>
                  {customDocumentTemplates.map((template) => (
                    <option key={template.path} value={template.path}>
                      {template.file_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                출력 파일 이름(선택)
                <input
                  value={finalizeForm.output_name}
                  onChange={(event) =>
                    setFinalizeForm((current) => ({ ...current, output_name: event.target.value }))
                  }
                  placeholder="비워두면 문서 제목으로 저장합니다."
                />
              </label>
            </div>

            <button type="submit" disabled={submitting}>
              작업 시작
            </button>
          </form>
          {selectedReferenceSet ? (
            <div className="hint-box">
              <strong>선택된 참고자료 묶음</strong>
              <span>{selectedReferenceSet.title}</span>
              <span>{selectedReferenceSet.items.length}개 자료</span>
              {selectedReferenceSet.items.slice(0, 2).map((item) => (
                <span key={item.id ?? item.value}>{item.label}</span>
              ))}
              {selectedReferenceSet.items[0] ? (
                <span>{selectedReferenceSet.items[0].value}</span>
              ) : null}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard eyebrow="생성 결과" title="HWPX 산출물">
          {lastFinalizeRequest?.artifact?.path ? (
            <div className="document-preview" data-testid="document-generate-result">
              <div className="document-preview__meta">
                <span className="pill">생성 완료</span>
                <span className="subtle-text">{lastFinalizeRequest.final_document_output.output_name}</span>
              </div>
              <p>{friendlyArtifactLabel(lastFinalizeRequest.artifact.path)}</p>
              {lastFinalizeRequest.artifact.markdown_path ? (
                <p className="subtle-text">
                  검토용 Markdown: {friendlyArtifactLabel(lastFinalizeRequest.artifact.markdown_path)}
                </p>
              ) : null}
              <div className="inline-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void openExternalTarget(lastFinalizeRequest.artifact?.path ?? "")}
                >
                  파일 열기
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void openExternalTarget(parentPathFromPath(lastFinalizeRequest.artifact?.path))}
                >
                  폴더 열기
                </button>
              </div>
            </div>
          ) : (
            <EmptyState
              title="아직 생성된 보고서가 없습니다."
              body="위 입력값을 채운 뒤 작업 시작을 누르면 승인 단계 없이 HWPX 보고서를 바로 생성합니다."
            />
          )}
        </SectionCard>
      </>
    );
  }

  function renderKnowledgeSection() {
    const graphVisual = buildKnowledgeGraphVisual(knowledgeGraph, knowledgeGraphFilter);
    const indexedFileCount = snapshot.knowledgeSourceFiles.filter((file) => file.status === "indexed").length;
    const metadataOnlyFileCount = snapshot.knowledgeSourceFiles.filter((file) => file.status === "metadata_only").length;
    const appliedConversationCount = snapshot.personalizationCandidates.filter(
      (candidate) => candidate.status === "applied",
    ).length;
    const selectedStructureTableCount = knowledgeDocumentTables.length;

    return (
      <>
        <SectionCard eyebrow="Knowledge Map" title="지식 그래프" className="knowledge-graph-overview" testId="knowledge-graph-overview">
          <div className="knowledge-overview-grid">
            <div className="knowledge-overview-copy">
              <p className="knowledge-overview-copy__kicker">인터랙티브 업무지식 지도</p>
              <p>
                등록된 지식폴더, 추출된 문서, 핵심 키워드가 어떻게 이어지는지 먼저 보고,
                필요한 상세 데이터는 아래 접힌 영역에서 확인합니다.
              </p>
              <div className="knowledge-overview-stats">
                <span className="pill">폴더 {snapshot.knowledgeSources.length}</span>
                <span className="pill">문서 {snapshot.knowledgeSourceFiles.length}</span>
                <span className="pill">본문 {indexedFileCount}</span>
                <span className="pill">대화기록 {appliedConversationCount}</span>
                {metadataOnlyFileCount ? <span className="pill pill--soft">메타데이터만 {metadataOnlyFileCount}</span> : null}
                {knowledgeBackendStatus ? (
                  <>
                    <span className="pill pill--soft">Vector: {knowledgeBackendStatus.vector.active_backend}</span>
                    <span className="pill pill--soft">Graph: {knowledgeBackendStatus.graph.active_backend}</span>
                    {backendCandidateLabel("Vector", knowledgeBackendStatus.vector) ? (
                      <span className="pill pill--soft">
                        {backendCandidateLabel("Vector", knowledgeBackendStatus.vector)}
                      </span>
                    ) : null}
                    {backendCandidateLabel("Graph", knowledgeBackendStatus.graph) ? (
                      <span className="pill pill--soft">
                        {backendCandidateLabel("Graph", knowledgeBackendStatus.graph)}
                      </span>
                    ) : null}
                    {backendActivationLabel("Vector", knowledgeBackendStatus.vector) ? (
                      <span
                        className={
                          knowledgeBackendStatus.vector.activation_ready ? "pill pill--soft" : "pill pill--warning"
                        }
                        title={(knowledgeBackendStatus.vector.activation_blockers ?? []).join("\n") || undefined}
                      >
                        {backendActivationLabel("Vector", knowledgeBackendStatus.vector)}
                      </span>
                    ) : null}
                    {backendActivationLabel("Graph", knowledgeBackendStatus.graph) ? (
                      <span
                        className={
                          knowledgeBackendStatus.graph.activation_ready ? "pill pill--soft" : "pill pill--warning"
                        }
                        title={(knowledgeBackendStatus.graph.activation_blockers ?? []).join("\n") || undefined}
                      >
                        {backendActivationLabel("Graph", knowledgeBackendStatus.graph)}
                      </span>
                    ) : null}
                  </>
                ) : null}
                {knowledgeParserStatus ? (
                  <span
                    className={knowledgeParserStatus.kordoc.available ? "pill pill--soft" : "pill pill--warning"}
                    title={
                      knowledgeParserStatus.kordoc.available
                        ? `runner ${knowledgeParserStatus.kordoc.runner_path ?? "unknown"}`
                        : knowledgeParserStatus.kordoc.runner_error ??
                          knowledgeParserStatus.kordoc.node_error ??
                          "KORdoc parser runtime is not ready"
                    }
                  >
                    KORdoc: {knowledgeParserStatus.kordoc.available ? "준비됨" : "미준비"}
                  </span>
                ) : null}
              </div>
            </div>
            <div
              className="knowledge-graph-map"
              data-testid="knowledge-graph-map"
              ref={knowledgeGraphMapRef}
              onPointerDown={startKnowledgeGraphDrag}
              onPointerMove={moveKnowledgeGraphDrag}
              onPointerUp={endKnowledgeGraphDrag}
              onPointerCancel={endKnowledgeGraphDrag}
            >
              <div className="knowledge-graph-map__toolbar">
                <span className="knowledge-graph-map__hint">
                  그래프를 드래그하거나 상하좌우로 스크롤해서 전체를 확인하세요.
                </span>
                <div className="knowledge-graph-map__zoom" aria-label="지식 그래프 확대 축소">
                  <button
                    type="button"
                    aria-label="지식 그래프 축소"
                    onClick={() => setKnowledgeGraphZoom((current) => Math.max(0.7, Number((current - 0.1).toFixed(1))))}
                  >
                    -
                  </button>
                  <span>{Math.round(knowledgeGraphZoom * 100)}%</span>
                  <button
                    type="button"
                    aria-label="지식 그래프 확대"
                    onClick={() => setKnowledgeGraphZoom((current) => Math.min(1.8, Number((current + 0.1).toFixed(1))))}
                  >
                    +
                  </button>
                  <button type="button" aria-label="지식 그래프 맞춤" onClick={() => setKnowledgeGraphZoom(1)}>
                    맞춤
                  </button>
                </div>
              </div>
              <svg
                data-testid="knowledge-graph-svg"
                data-zoom={knowledgeGraphZoom.toFixed(1)}
                viewBox={`0 0 ${graphVisual.width} ${graphVisual.height}`}
                width={Math.round(graphVisual.width * knowledgeGraphZoom)}
                height={Math.round(graphVisual.height * knowledgeGraphZoom)}
                role="img"
                aria-label="지식 폴더와 문서, 키워드 관계 그래프"
              >
                <defs>
                  <marker id="knowledge-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                  <radialGradient id="knowledge-node-glow" cx="50%" cy="45%" r="70%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.96)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0.24)" />
                  </radialGradient>
                </defs>
                <circle
                  className="knowledge-graph-map__orbit knowledge-graph-map__orbit--inner"
                  cx={graphVisual.centerX}
                  cy={graphVisual.centerY}
                  r="150"
                />
                <circle
                  className="knowledge-graph-map__orbit knowledge-graph-map__orbit--middle"
                  cx={graphVisual.centerX}
                  cy={graphVisual.centerY}
                  r="260"
                />
                <circle
                  className="knowledge-graph-map__orbit knowledge-graph-map__orbit--outer"
                  cx={graphVisual.centerX}
                  cy={graphVisual.centerY}
                  r="365"
                />
                {graphVisual.particles.map((particle) => (
                  <circle
                    key={particle.id}
                    className="knowledge-graph-map__particle"
                    cx={particle.x}
                    cy={particle.y}
                    r={particle.r}
                  />
                ))}
                {graphVisual.edges.map((edge, index) => {
                  const source = graphVisual.nodes.find((node) => node.id === edge.source);
                  const target = graphVisual.nodes.find((node) => node.id === edge.target);
                  if (!source || !target) {
                    return null;
                  }
                  const isDimmed =
                    knowledgeGraphFilter !== "all" &&
                    !graphVisual.activeNodeIds.has(edge.source) &&
                    !graphVisual.activeNodeIds.has(edge.target);
                  return (
                    <line
                      key={`${edge.source}-${edge.target}-${index}`}
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      className={`knowledge-graph-map__edge ${isDimmed ? "is-dimmed" : ""}`}
                      markerEnd="url(#knowledge-arrow)"
                    />
                  );
                })}
                {graphVisual.nodes.map((node) => (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    className={`knowledge-graph-map__node knowledge-graph-map__node--${node.node_type ?? "unknown"} ${
                      isKnowledgeGraphNodeDimmed(node.node_type, knowledgeGraphFilter) ? "is-dimmed" : ""
                    }`}
                    role="button"
                    tabIndex={0}
                    aria-label={`관계 보기 ${(node.label ?? node.id).slice(0, 40)}`}
                    onClick={() => void runKnowledgeGraphQuery(node.label ?? node.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void runKnowledgeGraphQuery(node.label ?? node.id);
                      }
                    }}
                  >
                    <circle className="knowledge-graph-map__halo" r="32" />
                    <circle className="knowledge-graph-map__core" r="22" />
                    <text x="0" y="-38" className="knowledge-graph-map__role">
                      {knowledgeGraphRoleLabel(node.node_type)}
                    </text>
                    <text x="0" y="46" className="knowledge-graph-map__label">
                      {(node.label ?? node.id).slice(0, 18)}
                    </text>
                  </g>
                ))}
              </svg>
              <div className="knowledge-graph-map__legend">
                {KNOWLEDGE_GRAPH_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={knowledgeGraphFilter === filter.key ? "is-active" : ""}
                    aria-pressed={knowledgeGraphFilter === filter.key}
                    onClick={() => setKnowledgeGraphFilter(filter.key)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        <div className="knowledge-workspace-tabs" role="tablist" aria-label="지식폴더 작업 화면">
          {KNOWLEDGE_WORKSPACE_PANELS.map((panel) => (
            <button
              key={panel.key}
              type="button"
              role="tab"
              aria-label={panel.label}
              aria-selected={knowledgePanel === panel.key}
              className={`knowledge-workspace-tab ${knowledgePanel === panel.key ? "is-active" : ""}`}
              onClick={() => {
                setKnowledgePanel(panel.key);
                setKnowledgeExtractionView(false);
              }}
            >
              <AssetIcon src={panel.iconSrc} className="knowledge-workspace-tab__icon" />
              <span>{panel.label}</span>
              <small>{panel.description}</small>
            </button>
          ))}
        </div>

        {knowledgePanel === "indexing" && knowledgeExtractionView ? (
          <SectionCard
            eyebrow="GraphRAG 추출 결과"
            title="색인 완료 문서"
            actions={
              <button type="button" className="button-secondary" onClick={() => setKnowledgeExtractionView(false)}>
                색인이력으로 돌아가기
              </button>
            }
          >
            {snapshot.knowledgeDocuments.length === 0 ? (
              <EmptyState
                title="아직 구조화된 GraphRAG 문서가 없습니다."
                body="지식 소스를 스캔한 뒤 GraphRAG 인덱싱을 실행하면 parser, 품질, section/table 상태가 여기에 표시됩니다."
              />
            ) : (
              <div className="item-list">
                {snapshot.knowledgeDocuments.slice(0, 25).map((document) => (
                  <article key={document.id} className="list-card">
                    <div className="list-card__main list-card__main--static">
                      <div>
                        <h3>{document.title}</h3>
                        <p>{relativePath(document.file_path)}</p>
                      </div>
                      <span className={document.partial ? "pill pill--warning" : "pill"}>
                        {document.partial ? "partial" : "structured"}
                      </span>
                    </div>
                    <div className="document-preview__meta">
                      <span>parser {document.parser_name}</span>
                      <span>품질 {Math.round((document.quality_score ?? 0) * 100)}%</span>
                      <span>섹션 {document.section_count ?? 0} · 표 {document.table_count ?? 0}</span>
                      {chunkQualityLabel(document) ? <span>{chunkQualityLabel(document)}</span> : null}
                      {extractionQualityMetricLabel(document.metadata) ? (
                        <span>{extractionQualityMetricLabel(document.metadata)}</span>
                      ) : null}
                      <span
                        className={
                          extractionQualityWarnings(document.metadata).length > 0 ? "pill pill--warning" : "pill pill--soft"
                        }
                      >
                        {extractionQualityWarningLabel(document.metadata)}
                      </span>
                    </div>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void openKnowledgeDocumentStructure(document.id)}
                      >
                        구조 보기
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {knowledgeDocumentStructure ? (
              <div className="document-preview" data-testid="knowledge-document-structure">
                <div className="document-preview__meta">
                  <span className="pill">문서 구조</span>
                  <span>{knowledgeDocumentStructure.document.title}</span>
                  <span className="subtle-text">{relativePath(knowledgeDocumentStructure.document.file_path)}</span>
                  <span
                    className={
                      knowledgeDocumentStructure.document.partial ? "pill pill--warning" : "pill pill--soft"
                    }
                  >
                    {knowledgeDocumentStructure.document.partial ? "partial" : "structured"}
                  </span>
                  {knowledgeDocumentStructure.document.parser_name ? (
                    <span>parser {knowledgeDocumentStructure.document.parser_name}</span>
                  ) : null}
                  {typeof knowledgeDocumentStructure.document.quality_score === "number" ? (
                    <span>품질 {Math.round(knowledgeDocumentStructure.document.quality_score * 100)}%</span>
                  ) : null}
                  {chunkQualityLabel(knowledgeDocumentStructure.document) ? (
                    <span>{chunkQualityLabel(knowledgeDocumentStructure.document)}</span>
                  ) : null}
                </div>
                <div className="knowledge-structure-grid">
                  {knowledgeDocumentStructure.sections.length === 0 ? (
                    <EmptyState title="섹션 정보가 없습니다." body="부분 추출 문서는 제목/메타데이터만 있을 수 있습니다." />
                  ) : (
                    knowledgeDocumentStructure.sections.map((section) => (
                      <article key={section.id} className="list-card list-card--compact">
                        <div className="list-card__main list-card__main--static">
                          <div>
                            <h3>{section.heading}</h3>
                            <p>level {section.level}</p>
                          </div>
                          <span className="pill">{section.order_index + 1}</span>
                        </div>
                        <p className="subtle-text">{section.text || "섹션 본문 미리보기 없음"}</p>
                      </article>
                    ))
                  )}
                </div>
                {knowledgeDocumentTables.length > 0 ? (
                  <details className="knowledge-detail-section">
                    <summary>표 구조 {selectedStructureTableCount}개 보기</summary>
                    <div className="item-list">
                      {knowledgeDocumentTables.map((table) => (
                        <article key={table.id} className="list-card list-card--compact">
                          <div className="list-card__main list-card__main--static">
                            <div>
                              <h3>{table.caption || "표"}</h3>
                              <p>{table.rows.length}행 · {table.headers.length}열</p>
                            </div>
                            <span className="pill">table</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}
          </SectionCard>
        ) : null}

        {knowledgePanel === "sources" ? (
          <>
        <SectionCard eyebrow="상세 데이터" title="지식베이스 세부 관리">
          <details className="knowledge-detail-section">
            <summary>지식 소스 등록 설정</summary>
            <div className="helper-copy">
              <p>특정 폴더를 지정하면 하위 문서의 본문과 메타데이터를 스캔해 개인 지식베이스 DB로 만듭니다.</p>
              <p>Markdown/TXT/CSV/JSON은 본문을 저장하고, DOCX/XLSX/PPTX/PDF 계열은 가능한 범위에서 본문 추출을 시도합니다.</p>
              <p>폴더 등록 후 실제 스캔, 중지, GraphRAG 인덱싱은 색인 처리 탭에서 진행합니다.</p>
            </div>
            {lockedKnowledgeIngestion ? (
              <div className="hint-box hint-box--warning">{knowledgeIngestionLockMessage}</div>
            ) : null}
            <form className="stack-form" onSubmit={submitKnowledgeSource}>
              <div className="grid-2">
                <label>
                  소스 이름
                  <input
                    value={knowledgeSourceForm.label}
                    onChange={(event) =>
                      setKnowledgeSourceForm((current) => ({ ...current, label: event.target.value }))
                    }
                    placeholder="예: 기획팀 업무자료"
                    disabled={lockedKnowledgeIngestion}
                    required
                  />
                </label>
                <label>
                  폴더 경로
                  <input
                    value={knowledgeSourceForm.root_path}
                    onChange={(event) =>
                      setKnowledgeSourceForm((current) => ({ ...current, root_path: event.target.value }))
                    }
                    placeholder="C:\\Users\\USER\\Documents\\업무자료"
                    disabled={lockedKnowledgeIngestion}
                    required
                  />
                </label>
              </div>
              <div className="inline-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void browseKnowledgeSourcePath()}
                  disabled={lockedKnowledgeIngestion}
                >
                  폴더 선택
                </button>
                <button type="submit" disabled={submitting || lockedKnowledgeIngestion}>
                  지식 소스 등록
                </button>
              </div>
            </form>
            <h3 className="subheading">등록된 지식 소스</h3>
            {snapshot.knowledgeSources.length === 0 ? (
              <EmptyState
                title="등록된 소스 폴더가 없습니다."
                body="업무 문서가 모여 있는 폴더를 지정하면 이곳에서 스캔하고 갱신 상태를 확인할 수 있습니다."
              />
            ) : (
              <div className="item-list">
                {snapshot.knowledgeSources.map((source) => {
                  const fileCount = snapshot.knowledgeSourceFiles.filter(
                    (file) => file.source_id === source.id && file.status !== "deleted",
                  ).length;
                  return (
                    <article key={source.id} className="list-card">
                      <div className="list-card__main list-card__main--static">
                        <div>
                          <h3>{source.label}</h3>
                          <p>{relativePath(source.root_path)}</p>
                        </div>
                        <span className="pill">{describeKnowledgeSourceStatus(source.status)}</span>
                      </div>
                      <div className="document-preview__meta">
                        <span>{fileCount}개 파일</span>
                        <span>최근 스캔: {source.last_scanned_at ? formatDateTime(source.last_scanned_at) : "아직 없음"}</span>
                      </div>
                      <div className="inline-actions">
                        <button type="button" className="button-secondary" onClick={() => setKnowledgePanel("indexing")}>
                          색인 처리로 이동
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </details>

          <details className="knowledge-detail-section">
            <summary>등록된 문서 메타데이터</summary>
            {snapshot.knowledgeSourceFiles.length === 0 ? (
              <EmptyState
                title="아직 인덱싱된 파일이 없습니다."
                body="소스 폴더를 등록한 뒤 스캔하면 문서 제목, 대표 본문, 추출 경로가 표시됩니다."
              />
            ) : (
              <div className="item-list">
                {snapshot.knowledgeSourceFiles.slice(0, 10).map((file) => (
                  <article key={file.id} className="list-card">
                    <div className="list-card__main list-card__main--static">
                      <div>
                        <h3>{file.title || file.relative_path}</h3>
                        <p>{file.relative_path}</p>
                      </div>
                      <span className="pill">{describeExtractionStatus(file)}</span>
                    </div>
                    {file.text_excerpt ? <p className="subtle-text">{file.text_excerpt}</p> : null}
                    <p className="subtle-text">{relativePath(file.file_path)}</p>
                    {file.extracted_text_path ? (
                      <p className="subtle-text">추출물: {relativePath(file.extracted_text_path)}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </details>
        </SectionCard>

        <SectionCard eyebrow="업무대화 지식화" title="업무대화 기반 지식 반영 기록">
          <details className="knowledge-detail-section">
            <summary>업무대화 반영 기록</summary>
            <div className="helper-copy">
              <p>업무대화 세션을 요약해 작업 패턴, 선호, 문서작성 힌트를 즉시 개인 지식베이스에 반영합니다.</p>
              <p>지식베이스의 원천은 업무대화와 등록된 지식폴더이며, 수동 메모 후보 승인 단계는 사용하지 않습니다.</p>
            </div>
            {snapshot.personalizationCandidates.length === 0 ? (
              <EmptyState
                title="아직 반영된 업무대화 기록이 없습니다."
                body="업무대화 화면에서 '이 세션 지식 반영'을 누르면 세션 요약이 바로 저장됩니다."
              />
            ) : (
              <div className="item-list">
                {snapshot.personalizationCandidates.map((candidate) => (
                  <article key={candidate.id} className="list-card">
                    <div className="list-card__main list-card__main--static">
                      <div>
                        <h3>{candidate.title}</h3>
                        <p>{candidate.candidate_type} · {describeStatus(candidate.status)} · risk {candidate.risk_level}</p>
                      </div>
                      <span className="pill">{formatDateTime(candidate.created_at)}</span>
                    </div>
                    <p className="subtle-text">{candidate.body}</p>
                  </article>
                ))}
              </div>
            )}
          </details>
        </SectionCard>
          </>
        ) : null}

        {knowledgePanel === "indexing" && !knowledgeExtractionView ? (
          <SectionCard eyebrow="색인 처리" title="GraphRAG ingestion 작업">
            <div className="knowledge-indexing-layout">
              <div className="document-preview">
                <div className="document-preview__meta">
                  <span className="pill">GraphRAG 처리 흐름</span>
                  <span className="subtle-text">스캔은 파일 목록/본문 원본을 만들고, GraphRAG 인덱싱은 검색용 chunk, vector, graph를 만듭니다.</span>
                </div>
                <div className="knowledge-pipeline" aria-label="GraphRAG 처리 흐름">
                  {["폴더 스캔", "파싱", "청킹", "임베딩/Chroma", "그래프 연결", "검색 준비"].map((stage, index) => (
                    <div key={stage} className="knowledge-pipeline__step">
                      <span>{index + 1}</span>
                      <strong>{stage}</strong>
                    </div>
                  ))}
                </div>
                <p className="subtle-text">
                  등록 폴더에 파일이 추가, 수정, 삭제되면 다음 스캔에서 변경 파일만 감지하고, GraphRAG 인덱싱이 해당 문서 chunk와 그래프를 갱신합니다.
                </p>
                <div className="knowledge-index-status-row">
                  <button
                    type="button"
                    className="button-secondary knowledge-index-status-button"
                    onClick={() => setKnowledgeExtractionView(true)}
                  >
                    색인완료 파일 {snapshot.knowledgeDocuments.length}개
                  </button>
                  <span className="pill pill--soft">원천 파일 {snapshot.knowledgeSourceFiles.length}개</span>
                  <span className="pill pill--soft">본문 추출 {indexedFileCount}개</span>
                </div>
              </div>

              <div className="knowledge-indexing-controls">
                <div className="document-preview__meta">
                  <span className="pill">등록 폴더 작업</span>
                  <span className="subtle-text">스캔 시작, GraphRAG 인덱싱, 강제 재색인은 여기에서 실행합니다.</span>
                </div>
                {lockedKnowledgeIngestion ? (
                  <div className="hint-box hint-box--warning">{knowledgeIngestionLockMessage}</div>
                ) : null}
                {snapshot.knowledgeSources.length === 0 ? (
                  <EmptyState
                    title="등록된 지식 소스가 없습니다."
                    body="설정/상태 탭에서 업무 폴더를 먼저 등록한 뒤 색인 처리를 시작하세요."
                  />
                ) : (
                  <div className="item-list item-list--compact">
                    {snapshot.knowledgeSources.map((source) => {
                      const fileCount = snapshot.knowledgeSourceFiles.filter(
                        (file) => file.source_id === source.id && file.status !== "deleted",
                      ).length;
                      return (
                        <article key={source.id} className="list-card list-card--compact">
                          <div className="list-card__main list-card__main--static">
                            <div>
                              <h3>{source.label}</h3>
                              <p>
                                {relativePath(source.root_path)} · {fileCount}개 파일 · 최근 스캔{" "}
                                {source.last_scanned_at ? formatDateTime(source.last_scanned_at) : "없음"}
                              </p>
                            </div>
                            <span className="pill">{describeKnowledgeSourceStatus(source.status)}</span>
                          </div>
                          <div className="inline-actions">
                            <button
                              type="button"
                              onClick={() => void runKnowledgeSourceScan(source)}
                              disabled={submitting || source.status === "missing" || lockedKnowledgeIngestion}
                            >
                              스캔 시작
                            </button>
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => void runKnowledgeSourceIngestion(source)}
                              disabled={submitting || source.status === "missing" || lockedKnowledgeIngestion}
                            >
                              GraphRAG 인덱싱
                            </button>
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => void runKnowledgeSourceReindex(source)}
                              disabled={submitting || source.status === "missing" || lockedKnowledgeIngestion}
                            >
                              강제 재색인
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              {knowledgeScanActivity ? (
                <article className="list-card knowledge-ingestion-card is-running" data-testid="knowledge-scan-activity">
                  <div className="list-card__main list-card__main--static">
                    <div>
                      <h3>{knowledgeScanActivity.sourceLabel} 폴더 스캔</h3>
                      <p>파일 목록, 수정일, 본문 추출 가능 여부를 확인하는 중입니다.</p>
                    </div>
                    <span className="pill">스캔 중</span>
                  </div>
                  <div className="knowledge-progress knowledge-progress--indeterminate" aria-label="지식폴더 스캔 진행 중">
                    <div className="knowledge-progress__bar knowledge-progress__bar--indeterminate" />
                  </div>
                  <div className="knowledge-ingestion-visual" aria-hidden="true">
                    <span className="knowledge-ingestion-visual__orb" />
                    <span className="knowledge-ingestion-visual__line" />
                    <span className="knowledge-ingestion-visual__orb" />
                    <span className="knowledge-ingestion-visual__line" />
                    <span className="knowledge-ingestion-visual__orb" />
                  </div>
                  <p className="subtle-text">
                    시작 후 {Math.max(1, Math.round((Date.now() - knowledgeScanActivity.startedAt) / 1000))}초 · 완료되면 파일 수와 최근 스캔 시간이 자동 갱신됩니다.
                  </p>
                </article>
              ) : null}

              {snapshot.knowledgeIngestionJobs.length === 0 ? (
                <EmptyState
                  title="아직 ingestion 작업이 없습니다."
                  body="지식 소스를 등록하고 GraphRAG 인덱싱을 실행하면 진행률, 소요시간, 실패 로그가 이 화면에 표시됩니다."
                />
              ) : (
                <div className="item-list">
                  {snapshot.knowledgeIngestionJobs.slice(0, 10).map((job) => {
                    const progress = ingestionProgressPercent(job);
                    const activeStageIndex = ingestionStageIndex(job);
                    const errors = splitIngestionErrors(job.error_message);
                    return (
                      <article
                        key={job.id}
                        className={`list-card knowledge-ingestion-card ${job.status === "running" ? "is-running" : ""}`}
                      >
                        <div className="list-card__main list-card__main--static">
                          <div>
                            <h3>{shortDisplayId(job.id, "GraphRAG 작업")}</h3>
                            <p>{ingestionStageLabel(job)}</p>
                          </div>
                          <span className="pill">{describeIngestionJobStatus(job)}</span>
                        </div>
                        <div
                          className="knowledge-ingestion-stage-rail"
                          data-testid="knowledge-ingestion-stage-rail"
                          aria-label={`${job.id} GraphRAG 단계`}
                        >
                          {KNOWLEDGE_INGESTION_STAGE_LABELS.map((stage, index) => (
                            <span
                              key={`${job.id}-${stage}`}
                              className={[
                                "knowledge-ingestion-stage",
                                index < activeStageIndex ? "is-complete" : "",
                                index === activeStageIndex ? "is-active" : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              <i aria-hidden="true" />
                              {stage}
                            </span>
                          ))}
                        </div>
                        <div className="knowledge-progress" aria-label={`${job.id} 진행률 ${progress}%`}>
                          <div className="knowledge-progress__bar" style={{ width: `${progress}%` }} />
                        </div>
                        <div className="knowledge-ingestion-visual" aria-hidden="true">
                          <span className="knowledge-ingestion-visual__orb" />
                          <span className="knowledge-ingestion-visual__line" />
                          <span className="knowledge-ingestion-visual__orb" />
                          <span className="knowledge-ingestion-visual__line" />
                          <span className="knowledge-ingestion-visual__orb" />
                        </div>
                        <div className="document-preview__meta">
                          <span>{progress}%</span>
                          <span>{job.processed_count}/{job.queued_count} 처리 · 실패 {job.failed_count}</span>
                          {(job.skipped_count ?? 0) > 0 ? <span>변경없음 {job.skipped_count}</span> : null}
                          {(job.deleted_document_count ?? 0) > 0 ? <span>삭제동기화 {job.deleted_document_count}</span> : null}
                          {typeof job.diagnostic_event_count === "number" ? (
                            <span>진단 이벤트 {job.diagnostic_event_count}개</span>
                          ) : null}
                          {ingestionRuntimeLabel(job) ? <span>{ingestionRuntimeLabel(job)}</span> : null}
                        </div>
                        {job.last_diagnostic_message ? (
                          <p className="subtle-text">
                            최근 진단: <strong>{job.last_diagnostic_message}</strong>
                          </p>
                        ) : null}
                        {job.log_dump_path ? (
                          <div className="knowledge-log-dump">
                            <span className="pill">풀로그 덤프</span>
                            <code>{job.log_dump_path}</code>
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => void copyKnowledgeLogDumpPath(job.log_dump_path ?? "")}
                            >
                              경로 복사
                            </button>
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => void openKnowledgeLogDumpFolder(job.log_dump_path ?? "")}
                            >
                              폴더 열기
                            </button>
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => void toggleKnowledgeLogDump(job)}
                            >
                              {expandedIngestionLogJobId === job.id ? "덤프 뷰어 닫기" : "덤프 뷰어 열기"}
                            </button>
                          </div>
                        ) : null}
                        <p className="subtle-text">
                          생성: {formatDateTime(job.created_at)}
                          {job.started_at ? ` / 시작: ${formatDateTime(job.started_at)}` : ""}
                          {job.completed_at ? ` / 완료: ${formatDateTime(job.completed_at)}` : ""}
                        </p>
                        {job.last_processed_path ? (
                          <p className="subtle-text">마지막 처리: {relativePath(job.last_processed_path)}</p>
                        ) : null}
                        {errors.length > 0 ? (
                          <details className="knowledge-error-log">
                            <summary>실패 진단 로그 {errors.length}개</summary>
                            <ol>
                              {errors.slice(0, 20).map((line, index) => (
                                <li key={`${job.id}-error-${index}`}>{line}</li>
                              ))}
                            </ol>
                            {errors.length > 20 ? <p className="subtle-text">나머지 {errors.length - 20}개는 원본 로그에 보관됩니다.</p> : null}
                          </details>
                        ) : null}
                        {job.status === "queued" || job.status === "partial" ? (
                          <div className="inline-actions">
                            <button
                              type="button"
                              disabled={submitting || runningKnowledgeIngestion}
                              onClick={() => void runQueuedKnowledgeIngestionJob(job)}
                            >
                              ingestion 실행
                            </button>
                          </div>
                        ) : null}
                        {job.status === "queued" || job.status === "running" ? (
                          <div className="inline-actions">
                            <button
                              type="button"
                              className="button-secondary"
                              disabled={submitting}
                              onClick={() => void cancelQueuedKnowledgeIngestionJob(job)}
                            >
                              취소
                            </button>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}

            </div>
          </SectionCard>
        ) : null}

        {knowledgePanel === "search" ? (
        <SectionCard eyebrow="보조 탐색" title="키워드로 관련 문서 찾기">
          <div className="stack-form">
            <div className="helper-copy">
              <p>전체 지식 그래프를 보는 영역이 아니라, 검색어와 겹치는 문서 및 연결 키워드만 좁혀보는 보조 기능입니다.</p>
              <p>예: “예산”을 입력하면 본문/파일명/키워드가 겹치는 문서와 그래프 이웃을 함께 보여줍니다.</p>
            </div>
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
              <button
                type="button"
                className="button-secondary"
                onClick={() => void runKnowledgeAsk()}
                disabled={knowledgeInspectorLoading || !knowledgeQuery.trim()}
              >
                근거 답변 생성
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

            {knowledgeAskResult ? (
              <div className="document-preview" data-testid="knowledge-ask-result">
                <div className="document-preview__meta">
                  <span className="pill">근거 답변</span>
                  <span className="subtle-text">{knowledgeAskResult.query}</span>
                  {selectedSession ? (
                    <span className="subtle-text">세션 맥락: {selectedSession.title}</span>
                  ) : null}
                  {knowledgeAskResult.retrieval_summary ? (
                    <span className="subtle-text">
                      검색근거 {knowledgeAskResult.retrieval_summary.source_count}개 · 표근거{" "}
                      {knowledgeAskResult.retrieval_summary.table_evidence_count}개 · 관계{" "}
                      {knowledgeAskResult.retrieval_summary.relation_count}개
                    </span>
                  ) : null}
                </div>
                <div className="chat-markdown">
                  {renderMarkdownContent(knowledgeAskResult.answer, (target) => {
                    void openExternalTarget(target);
                  })}
                </div>
                <h3 className="subheading">출처 문서</h3>
                {knowledgeAskResult.citations.length > 0 ? (
                  <div className="item-list">
                    {knowledgeAskResult.citations.map((citation) => (
                      <article key={`${citation.document_id}-${citation.chunk_id}`} className="list-card">
                        <div className="list-card__main list-card__main--static">
                          <div>
                            <h3>{citation.title}</h3>
                            <p>{relativePath(citation.file_path)}</p>
                          </div>
                          <span className="pill">{citation.chunk_id}</span>
                        </div>
                        <div className="document-preview__meta">
                          <span className={citation.partial ? "pill pill--warning" : "pill pill--soft"}>
                            {citation.partial ? "partial" : "structured"}
                          </span>
                          <span
                            className={citation.evidence_type === "table" ? "pill" : "pill pill--soft"}
                          >
                            {citationEvidenceLabel(citation.evidence_type)}
                          </span>
                          {citation.parser_name ? <span>parser {citation.parser_name}</span> : null}
                          {typeof citation.quality_score === "number" ? (
                            <span>품질 {Math.round(citation.quality_score * 100)}%</span>
                          ) : null}
                          {citationWarningLabel(citation.quality_warnings) ? (
                            <span className="pill pill--warning">
                              {citationWarningLabel(citation.quality_warnings)}
                            </span>
                          ) : null}
                        </div>
                        {citation.relations.length > 0 ? (
                          <div className="document-preview__meta">
                            {citation.relations.map((relation) => (
                              <span key={relation} className="pill pill--soft">
                                {relation}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="subtle-text">표시할 출처 문서가 없습니다.</p>
                )}
              </div>
            ) : null}

            {knowledgeGraphQueryResult ? (
              <div className="split-grid" data-testid="knowledge-graph-query-result">
                <div>
                  <h3 className="subheading">관계 보기</h3>
                  {knowledgeGraphQueryResult.nodes.length === 0 &&
                  knowledgeGraphQueryResult.neighbor_nodes.length === 0 ? (
                    <EmptyState
                      title="연결된 지식 노드를 찾지 못했습니다."
                      body="다른 검색어를 입력하거나 지식 소스 스캔 범위를 넓혀보세요."
                    />
                  ) : (
                    <div className="item-list">
                      {knowledgeGraphQueryResult.nodes.map((node) => (
                        <article key={node.id} className="list-card">
                          <div className="list-card__main list-card__main--static">
                            <div>
                              <h3>{node.label ?? node.id}</h3>
                              <p>{node.node_type ?? "node"}</p>
                            </div>
                            <span className="pill">match</span>
                          </div>
                        </article>
                      ))}
                      {knowledgeGraphQueryResult.neighbor_nodes.map((node) => (
                        <article key={node.id} className="list-card">
                          <div className="list-card__main list-card__main--static">
                            <div>
                              <h3>{node.label ?? node.id}</h3>
                              <p>{node.node_type ?? "neighbor"}</p>
                            </div>
                            <span className="pill pill--soft">neighbor</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="subheading">관계와 출처</h3>
                  {knowledgeGraphQueryResult.edges.length > 0 ? (
                    <div className="document-preview__meta">
                      {knowledgeGraphQueryResult.edges.map((edge) => (
                        <span key={edge.id} className="pill">
                          {edge.relation}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="subtle-text">관계 없음</p>
                  )}
                  {knowledgeGraphQueryResult.related_documents.length > 0 ? (
                    <div className="item-list">
                      {knowledgeGraphQueryResult.related_documents.map((document) => (
                        <article key={document.id} className="list-card">
                          <div className="list-card__main list-card__main--static">
                            <div>
                              <h3>{document.title}</h3>
                              <p>{relativePath(document.file_path)}</p>
                            </div>
                            <span className="pill">{document.document_type ?? "문서"}</span>
                          </div>
                          <div className="inline-actions">
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => void openKnowledgeDocumentStructure(document.id)}
                            >
                              구조 보기
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="subtle-text">연결 문서 없음</p>
                  )}
                </div>
              </div>
            ) : null}

            {knowledgeDocumentStructure ? (
              <div className="document-preview" data-testid="knowledge-document-structure">
                <div className="document-preview__meta">
                  <span className="pill">문서 구조</span>
                  <span>{knowledgeDocumentStructure.document.title}</span>
                  <span className="subtle-text">{relativePath(knowledgeDocumentStructure.document.file_path)}</span>
                  <span
                    className={
                      knowledgeDocumentStructure.document.partial ? "pill pill--warning" : "pill pill--soft"
                    }
                  >
                    {knowledgeDocumentStructure.document.partial ? "partial" : "structured"}
                  </span>
                  {knowledgeDocumentStructure.document.parser_name ? (
                    <span>parser {knowledgeDocumentStructure.document.parser_name}</span>
                  ) : null}
                  {typeof knowledgeDocumentStructure.document.quality_score === "number" ? (
                    <span>품질 {Math.round(knowledgeDocumentStructure.document.quality_score * 100)}%</span>
                  ) : null}
                  {chunkQualityLabel(knowledgeDocumentStructure.document) ? (
                    <span>{chunkQualityLabel(knowledgeDocumentStructure.document)}</span>
                  ) : null}
                  {extractionQualityMetricLabel(knowledgeDocumentStructure.document.metadata) ? (
                    <span>{extractionQualityMetricLabel(knowledgeDocumentStructure.document.metadata)}</span>
                  ) : null}
                  <span
                    className={
                      extractionQualityWarnings(knowledgeDocumentStructure.document.metadata).length > 0
                        ? "pill pill--warning"
                        : "pill pill--soft"
                    }
                  >
                    {extractionQualityWarningLabel(knowledgeDocumentStructure.document.metadata)}
                  </span>
                  <span className="pill pill--soft">표 {selectedStructureTableCount}</span>
                  {knowledgeDocumentStructure.has_more_sections ? (
                    <span className="pill pill--warning">
                      섹션 {knowledgeDocumentStructure.sections_returned ?? knowledgeDocumentStructure.sections.length}/
                      {knowledgeDocumentStructure.section_count} 미리보기
                    </span>
                  ) : null}
                </div>
                <div className="item-list">
                  {knowledgeDocumentStructure.sections.map((section) => (
                    <article key={section.id} className="list-card">
                      <div className="list-card__main list-card__main--static">
                        <div>
                          <h3>{section.heading}</h3>
                          <p>{section.text || "본문 텍스트 없음"}</p>
                        </div>
                        <span className="pill">section {section.order_index + 1}</span>
                      </div>
                      {section.tables.length > 0 ? (
                        <div className="knowledge-table-stack">
                          {section.tables.map((table) => (
                            <div key={table.id} className="knowledge-table-preview">
                              {table.caption ? <p className="subheading">{table.caption}</p> : null}
                              <table>
                                <thead>
                                  <tr>
                                    {table.headers.map((header, headerIndex) => (
                                      <th key={`${table.id}-header-${headerIndex}`}>{header}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {table.rows.map((row, rowIndex) => (
                                    <tr key={`${table.id}-row-${rowIndex}`}>
                                      {row.map((cell, cellIndex) => (
                                        <td key={`${table.id}-cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            {knowledgeSearchResult ? (
              <div className="split-grid">
                <div>
                  <h3 className="subheading">검색 결과</h3>
                  {(knowledgeSearchResult.source_file_hits ?? []).length === 0 &&
                  knowledgeSearchResult.vector_hits.length === 0 ? (
                    <EmptyState
                      title="검색 결과가 없습니다."
                      body="다른 키워드로 다시 시도하거나 지식 소스 폴더를 스캔해보세요."
                    />
                  ) : (
                    <div className="item-list">
                      {(knowledgeSearchResult.source_file_hits ?? []).map((hit) => (
                        <article key={hit.file.id} className="list-card">
                          <div className="list-card__main list-card__main--static">
                            <div>
                              <h3>{hit.file.title || hit.file.relative_path}</h3>
                              <p>{hit.file.relative_path} · {relativePath(hit.file.file_path)}</p>
                            </div>
                            <span className="pill">folder hit {hit.keyword_overlap}</span>
                          </div>
                          {hit.file.text_excerpt ? <p className="subtle-text">{hit.file.text_excerpt}</p> : null}
                        </article>
                      ))}
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
        ) : null}
      </>
    );
  }

  function renderFileOrgSection() {
    return (
      <>
        <SectionCard eyebrow="승인형 정리" title="파일정리 제안 생성">
          <div className="helper-copy">
            <p>파일을 바로 옮기지 않고, 먼저 정리 제안을 만든 뒤 승인 후 적용합니다.</p>
            <p>지식 반영 후보나 보관 후보처럼 검토가 필요한 정리를 안전하게 다룹니다.</p>
          </div>
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
            <div className="inline-actions">
              <button type="button" className="button-secondary" onClick={() => void browseFileOrgTargetPath()}>
                폴더 찾아보기
              </button>
              {snapshot.health?.workspace_root ? (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setFileOrgTargetPath(snapshot.health?.workspace_root ?? "")}
                >
                  작업공간 경로 사용
                </button>
              ) : null}
              {snapshot.settings?.paths.documents_root ? (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setFileOrgTargetPath(snapshot.settings?.paths.documents_root ?? "")}
                >
                  문서 경로 사용
                </button>
              ) : null}
              {snapshot.settings?.paths.knowledge_root ? (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setFileOrgTargetPath(snapshot.settings?.paths.knowledge_root ?? "")}
                >
                  지식 경로 사용
                </button>
              ) : null}
            </div>
            <div className="toolbar">
              <button type="submit" disabled={submitting}>
                정리 제안 만들기
              </button>
              <span className="subtle-text">실제 적용 전에는 복사/참조 수준의 제안만 만듭니다.</span>
            </div>
          </form>
        </SectionCard>

        <SectionCard eyebrow="지식화 연동" title="최근 제안 목록">
          {snapshot.fileProposals.length === 0 ? (
            <EmptyState
              title="아직 생성된 제안이 없습니다."
              body="최근 변경 파일을 지식 반영 후보나 보관 후보로 나누는 제안이 여기에 쌓입니다."
            />
          ) : (
            <div className="item-list">
              {snapshot.fileProposals.map((proposal: FileProposalItem) => (
                (() => {
                  const relatedTicket = latestApprovalTicketForProposal(proposal.id);
                  const hasAppliedOperation = Boolean(fileOrgOperations[proposal.id]);
                  const canRequestApply =
                    proposal.status === "proposed" || proposal.status === "rolled_back";
                  const canCommitApply =
                    proposal.status === "pending_approval" &&
                    relatedTicket?.status === "approved" &&
                    !hasAppliedOperation;

                  return (
                    <article key={proposal.id} className="list-card">
                      <div className="list-card__main list-card__main--static">
                        <div>
                          <h3>{relativePath(proposal.target_path)}</h3>
                          <p>{proposal.reason}</p>
                          <p className="subtle-text">상태: {describeStatus(proposal.status)}</p>
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
                        <span className="pill">{describeProposalType(proposal.proposal_type)}</span>
                      </div>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => toggleDetailCard({ kind: "proposal", id: proposal.id })}
                        >
                          상세보기
                        </button>
                        {canRequestApply ? (
                          <button type="button" onClick={() => void requestProposalApply(proposal)}>
                            적용 요청
                          </button>
                        ) : null}
                        {canCommitApply ? (
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
                      {detailCard?.kind === "proposal" && detailCard.id === proposal.id ? (
                        <DetailPanel
                          title="제안 상세"
                          fields={[
                            { label: "원본 경로", value: proposal.target_path, code: true },
                            { label: "제안 목적지", value: proposal.proposed_destination, code: true },
                            { label: "제안 유형", value: describeProposalType(proposal.proposal_type) },
                            { label: "상태", value: describeStatus(proposal.status) },
                            { label: "제안 이유", value: proposal.reason },
                            {
                              label: "최근 적용 경로",
                              value: fileOrgOperations[proposal.id]?.destination_path ?? "아직 적용하지 않음",
                              code: Boolean(fileOrgOperations[proposal.id]?.destination_path),
                            },
                          ]}
                        />
                      ) : null}
                    </article>
                  );
                })()
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
            body="업무 엔진 도구 목록이 준비되면 OCR, 요약, 엔티티 추출, 템플릿 확장 같은 보강 도구가 여기에 표시됩니다."
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
            body="문서작성, 지식 반영, 파일정리, 외부 실행 요청은 모두 이력으로 쌓입니다."
          />
        ) : (
          <div className="item-list">
            {snapshot.logs.map((log) => (
              <article key={log.id} className="list-card">
                <div className="list-card__main list-card__main--static">
                  <div>
                    <h3>{buildExecutionLogDisplay(log).title}</h3>
                    <p>{buildExecutionLogDisplay(log).subtitle}</p>
                    <p className="subtle-text">{buildExecutionLogDisplay(log).detail}</p>
                  </div>
                  <span className="pill">{buildExecutionLogDisplay(log).statusLabel}</span>
                </div>
                <p className="subtle-text">{formatDateTime(log.created_at)}</p>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => toggleDetailCard({ kind: "log", id: log.id })}
                  >
                    상세보기
                  </button>
                </div>
                {detailCard?.kind === "log" && detailCard.id === log.id ? (
                  <DetailPanel
                    title="실행 상세"
                    fields={[
                      { label: "기능", value: describeExecutionFeature(log.feature) },
                      { label: "작업", value: describeExecutionAction(log.action) },
                      { label: "상태", value: describeStatus(log.status) },
                      { label: "승인 티켓", value: log.approval_ticket_id ?? "없음" },
                      { label: "입력", value: formatStructuredValue(log.inputs), code: true },
                      { label: "출력", value: formatStructuredValue(log.outputs), code: true },
                    ]}
                  />
                ) : null}
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    );
  }

  function renderSettingsSection() {
    return (
      <SectionCard eyebrow="local-first settings" title="환경설정">
        <div className="helper-copy">
          <p>읽기 전용으로만 보이던 설정을 이제 워크스페이스 기준으로 직접 수정하고 저장할 수 있습니다.</p>
          <p>LLM 정책과 외부 또는 내부 모델 연결값을 바꾸면 이후 업무대화 워크플로에 바로 반영됩니다.</p>
          <p>
            외부 모델은 공급자별 공식 Base URL, 인증 방식, 모델 슬러그가 달라서 preset을 고르고 그 기준으로 입력하는
            방식을 사용합니다.
          </p>
        </div>
        <form className="stack-form" onSubmit={submitSettingsUpdate}>
          <div className="grid-2">
            <label className="select-field">
              LLM 정책
              <select
                value={settingsForm.llm_mode}
                onChange={(event) => {
                  const nextMode = event.target.value as "local_first" | "internal_server" | "external_model";
                  const committedProfiles = commitSettingsFormToProfiles(settingsProfiles, settingsForm);
                  const nextProfiles = cloneWorkspaceLlmProfiles(committedProfiles);
                  const nextProvider =
                    nextMode === "external_model"
                      ? nextProfiles.external_model.active_provider
                      : nextProfiles[nextMode].provider;
                  setSettingsProfiles(nextProfiles);
                  setSettingsForm(
                    buildSettingsFormFromProfiles(
                      nextProfiles,
                      nextMode,
                      nextProvider,
                      settingsForm.default_template_key,
                    ),
                  );
                }}
              >
                <option value="local_first">로컬 우선</option>
                <option value="internal_server">내부 서버</option>
                <option value="external_model">외부 모델</option>
              </select>
            </label>
            <label className="select-field">
              {settingsForm.llm_mode === "external_model" ? "외부 모델 공급자" : "연결 공급자 preset"}
              <select
                value={normalizeProviderKey(settingsForm.llm_provider)}
                onChange={(event) => applyProviderPreset(event.target.value as LlmProviderKey)}
              >
                {PROVIDER_OPTION_ORDER.filter((providerKey) =>
                  settingsForm.llm_mode === "external_model" ? providerKey !== "custom_openai" : providerKey === "custom_openai",
                ).map((providerKey) => (
                  <option key={providerKey} value={providerKey}>
                    {LLM_PROVIDER_PRESETS[providerKey].label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              LLM Model
              <input
                value={settingsForm.llm_model}
                onChange={(event) => applySettingsFormPatch({ llm_model: event.target.value })}
                placeholder={selectedProviderPreset.modelPlaceholder}
              />
            </label>
            <label>
              {selectedProviderPreset.apiKeyLabel}
              <input
                type="password"
                value={settingsForm.llm_api_key}
                onChange={(event) => applySettingsFormPatch({ llm_api_key: event.target.value })}
                placeholder={selectedProviderPreset.apiKeyPlaceholder}
              />
            </label>
          </div>
          <div className="detail-panel">
            <p className="detail-panel__title">연결 preset 요약</p>
            <dl className="detail-grid">
              <div className="detail-grid__row">
                <dt>공급자</dt>
                <dd className="detail-grid__value">{selectedProviderPreset.label}</dd>
              </div>
              <div className="detail-grid__row">
                <dt>권장 Base URL</dt>
                <dd className="detail-grid__value detail-grid__value--code">{selectedProviderPreset.defaultBaseUrl}</dd>
              </div>
              <div className="detail-grid__row">
                <dt>모델 예시</dt>
                <dd className="detail-grid__value detail-grid__value--code">{selectedProviderPreset.defaultModel}</dd>
              </div>
              <div className="detail-grid__row">
                <dt>가이드</dt>
                <dd className="detail-grid__value">
                  <a href={selectedProviderPreset.docsUrl} target="_blank" rel="noreferrer">
                    공식 연결 가이드
                  </a>
                </dd>
              </div>
            </dl>
            <ul className="helper-copy helper-copy--compact">
              {selectedProviderPreset.helperLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <label>
            모델 API Base URL
            <input
              value={settingsForm.internal_api_base_url}
              onChange={(event) => applySettingsFormPatch({ internal_api_base_url: event.target.value })}
                placeholder={selectedProviderPreset.defaultBaseUrl}
              />
            </label>
          {selectedProviderSupportsAttributionHeaders ? (
            <div className="grid-2">
              <label>
                {selectedProviderAttributionLabel} 사이트 URL (선택)
                <input
                  value={settingsForm.llm_site_url}
                  onChange={(event) => applySettingsFormPatch({ llm_site_url: event.target.value })}
                  placeholder="https://example.com"
                />
              </label>
              <label>
                {selectedProviderAttributionLabel} 앱 이름 (선택)
                <input
                  value={settingsForm.llm_application_name}
                  onChange={(event) =>
                    applySettingsFormPatch({ llm_application_name: event.target.value })
                  }
                  placeholder="Gongmu Workspace"
                />
              </label>
            </div>
          ) : null}
          <div className="detail-panel">
            <p className="detail-panel__title">GraphRAG 임베딩</p>
            <p className="subtle-text">
              지식폴더 ingestion과 자연어 검색에 사용할 벡터 생성 방식을 정합니다. 폐쇄망에서는 로컬 Ollama
              embedding 모델을 권장하고, 실패 시 deterministic fallback을 켤 수 있습니다.
            </p>
            <div className="grid-2">
              <label className="select-field">
                Embedding Provider
                <select
                  value={settingsForm.embedding_provider}
                  onChange={(event) =>
                    applySettingsFormPatch({
                      embedding_provider: event.target.value as "deterministic" | "ollama",
                    })
                  }
                >
                  <option value="deterministic">Deterministic fallback</option>
                  <option value="ollama">Ollama local embedding</option>
                </select>
              </label>
              <label className="select-field">
                Vector Store
                <select
                  value={settingsForm.graphrag_vector_backend}
                  onChange={(event) =>
                    applySettingsFormPatch({
                      graphrag_vector_backend: event.target.value as "sqlite" | "chromadb",
                    })
                  }
                >
                  <option value="sqlite">SQLite fallback</option>
                  <option value="chromadb">ChromaDB</option>
                </select>
              </label>
              <label>
                Embedding Model
                <input
                  value={settingsForm.embedding_model}
                  onChange={(event) => applySettingsFormPatch({ embedding_model: event.target.value })}
                  placeholder="nomic-embed-text 또는 bge-m3"
                />
              </label>
              <label>
                Embedding Base URL
                <input
                  value={settingsForm.embedding_base_url}
                  onChange={(event) => applySettingsFormPatch({ embedding_base_url: event.target.value })}
                  placeholder="http://127.0.0.1:11434"
                />
              </label>
              <label className="select-field">
                실패 시 fallback
                <select
                  value={settingsForm.embedding_fallback_enabled ? "enabled" : "disabled"}
                  onChange={(event) =>
                    applySettingsFormPatch({
                      embedding_fallback_enabled: event.target.value === "enabled",
                    })
                  }
                >
                  <option value="enabled">켜기</option>
                  <option value="disabled">끄기</option>
                </select>
              </label>
            </div>
          </div>
          <div className="grid-2">
            <label>
              개인화 학습 저장폴더
              <input
                value={settingsForm.personalization_root}
                onChange={(event) => applySettingsFormPatch({ personalization_root: event.target.value })}
                placeholder="runtime-workspace/personalization"
              />
            </label>
            <label className="select-field">
              학습 후보 반영 방식
              <select
                value={settingsForm.personalization_apply_mode}
                onChange={(event) =>
                  applySettingsFormPatch({
                    personalization_apply_mode: event.target.value as "approval_required" | "auto_apply",
                  })
                }
              >
                <option value="approval_required">승인 후 반영</option>
                <option value="auto_apply">낮은 위험 항목 자동 반영</option>
              </select>
            </label>
          </div>
          <div className="toolbar">
            <button type="submit" disabled={submitting}>
              설정 저장
            </button>
            <button type="button" className="button-secondary" onClick={() => void runLlmConnectionTest()} disabled={submitting}>
              LLM 연결 테스트
            </button>
            <span className="subtle-text">
              검색 연계는 {snapshot.settings?.defaults.anything_launch_mode ?? "external_app_preferred"} 기준으로 유지됩니다.
            </span>
          </div>
        </form>
        <div className="settings-grid">
          <div>
            <p className="settings-grid__label">워크스페이스 루트</p>
            <p>{snapshot.settings?.paths.workspace_root ?? snapshot.health?.workspace_root ?? "업무 엔진 연결 필요"}</p>
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
            <p className="settings-grid__label">개인화 학습 저장소</p>
            <p>{snapshot.settings?.paths.personalization_root ?? "runtime-workspace/personalization"}</p>
          </div>
          <div>
            <p className="settings-grid__label">학습 반영 방식</p>
            <p>
              {snapshot.settings?.defaults.personalization_apply_mode === "auto_apply"
                ? "낮은 위험 항목 자동 반영"
                : "승인 후 반영"}
            </p>
          </div>
          <div>
            <p className="settings-grid__label">LLM Provider</p>
            <p>{LLM_PROVIDER_PRESETS[normalizeProviderKey(snapshot.settings?.defaults.llm_provider ?? "openai_compatible")].label}</p>
          </div>
          <div>
            <p className="settings-grid__label">LLM Model</p>
            <p>{snapshot.settings?.defaults.llm_model ?? "gpt-4.1-mini"}</p>
          </div>
          <div>
            <p className="settings-grid__label">API Key</p>
            <p>{snapshot.settings?.defaults.llm_api_key ? "저장됨" : "미설정"}</p>
          </div>
          <div>
            <p className="settings-grid__label">Provider Base URL</p>
            <p>{snapshot.settings?.defaults.internal_api_base_url ?? selectedProviderPreset.defaultBaseUrl}</p>
          </div>
          <div>
            <p className="settings-grid__label">GraphRAG Embedding</p>
            <p>
              {snapshot.settings?.defaults.embedding_provider ?? "deterministic"} /{" "}
              {snapshot.settings?.defaults.embedding_model ?? "nomic-embed-text"}
            </p>
          </div>
          <div>
            <p className="settings-grid__label">GraphRAG Vector Store</p>
            <p>{snapshot.settings?.defaults.graphrag_vector_backend === "chromadb" ? "ChromaDB" : "SQLite fallback"}</p>
          </div>
          <div>
            <p className="settings-grid__label">Embedding Base URL</p>
            <p>{snapshot.settings?.defaults.embedding_base_url ?? "http://127.0.0.1:11434"}</p>
          </div>
          <div>
            <p className="settings-grid__label">Embedding Fallback</p>
            <p>{snapshot.settings?.defaults.embedding_fallback_enabled === false ? "꺼짐" : "켜짐"}</p>
          </div>
          <div>
            <p className="settings-grid__label">OpenRouter 부가 헤더</p>
            <p>
              {snapshot.settings?.defaults.llm_site_url || snapshot.settings?.defaults.llm_application_name
                ? [snapshot.settings?.defaults.llm_site_url, snapshot.settings?.defaults.llm_application_name]
                    .filter(Boolean)
                    .join(" / ")
                : "미설정"}
            </p>
          </div>
          <div>
            <p className="settings-grid__label">런타임 모드</p>
            <p>{runtimeStatus?.mode ?? "-"}</p>
          </div>
          <div>
            <p className="settings-grid__label">업무 엔진 URL</p>
            <p>{runtimeStatus?.sidecar_url ?? "http://127.0.0.1:8765"}</p>
          </div>
          <div>
            <p className="settings-grid__label">업무 엔진 로그</p>
            <p>{runtimeStatus?.log_path ? "로그 파일 준비됨" : "-"}</p>
          </div>
          <div>
            <p className="settings-grid__label">런타임 관리</p>
            <p>{runtimeStatus?.managed ? "앱이 관리 중" : "외부 또는 미연결"}</p>
          </div>
        </div>
        {renderSavedProfilesSummary()}
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

  function renderActiveDetailPanel() {
    if (activeMenu === "chat") {
      const summary = selectedSession ? sessionContextSummaries[selectedSession.id] : null;
      return (
        <div className="context-detail">
          <div className="context-detail__hero">
            <span className="context-detail__icon"><BotMessageSquare size={18} /></span>
            <div>
              <strong>{selectedSession?.title ?? "선택된 업무대화 없음"}</strong>
              <p>{selectedSession ? "현재 대화의 일정, 파일, RAG 맥락을 한 번에 봅니다." : "왼쪽 세션 목록에서 업무대화를 선택하세요."}</p>
            </div>
          </div>
          <div className="context-detail__grid">
            <span>대화 {selectedSessionMessages.length}개</span>
            <span>연결 파일 {selectedSessionFileLinks.length}개</span>
            <span>{selectedSessionSchedule?.title ?? "연결 일정 없음"}</span>
            <span>GraphRAG {summary?.graphrag_used ? `${summary.graphrag_evidence_count}개 근거` : "대기"}</span>
          </div>
          {selectedSessionContextEvidence.length > 0 ? (
            <div className="context-detail__stack">
              <p className="settings-grid__label">최근 응답 맥락</p>
              {selectedSessionContextEvidence.map((item) => (
                <button key={item} type="button" className="context-detail__row" onClick={() => openResponseContextDetail(item)}>
                  <span>{item}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    if (activeMenu === "knowledge") {
      const progress = activeKnowledgeIngestionJob ? ingestionProgressPercent(activeKnowledgeIngestionJob) : 0;
      return (
        <div className="context-detail">
          <div className="context-detail__hero">
            <span className="context-detail__icon"><BookMarked size={18} /></span>
            <div>
              <strong>{activeKnowledgeIngestionJob ? shortDisplayId(activeKnowledgeIngestionJob.id, "인덱싱") : "지식폴더 상태"}</strong>
              <p>
                {knowledgeScanActivity
                  ? `${knowledgeScanActivity.sourceLabel} 폴더 스캔 중`
                  : activeKnowledgeIngestionJob
                    ? ingestionStageLabel(activeKnowledgeIngestionJob)
                    : "등록, 스캔, GraphRAG 검색 준비 상태를 표시합니다."}
              </p>
            </div>
          </div>
          {knowledgeScanActivity ? (
            <div className="knowledge-progress knowledge-progress--indeterminate" aria-label="폴더 스캔 진행 중">
              <div className="knowledge-progress__bar knowledge-progress__bar--indeterminate" />
            </div>
          ) : activeKnowledgeIngestionJob ? (
            <div className="knowledge-progress" aria-label={`인덱싱 진행률 ${progress}%`}>
              <div className="knowledge-progress__bar" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
          <div className="context-detail__grid">
            <span>소스 {snapshot.knowledgeSources.length}</span>
            <span>문서 {snapshot.knowledgeSourceFiles.length}</span>
            <span>Graph {knowledgeGraph?.node_count ?? 0} nodes</span>
            <span>Vector {knowledgeBackendStatus?.vector.active_backend ?? "확인 전"}</span>
          </div>
          {activeKnowledgeIngestionJob?.last_diagnostic_message ? (
            <p className="subtle-text">최근 진단: {activeKnowledgeIngestionJob.last_diagnostic_message}</p>
          ) : null}
        </div>
      );
    }

    if (activeMenu === "documents") {
      return (
        <div className="context-detail">
          <div className="context-detail__hero">
            <span className="context-detail__icon"><FileText size={18} /></span>
            <div>
              <strong>{lastContentBase ? friendlyArtifactLabel(lastContentBase.artifact.path) : "문서작성 준비"}</strong>
              <p>{lastContentBase ? lastContentBase.title : "Content Base를 만든 뒤 최종 HWPX 산출까지 진행합니다."}</p>
            </div>
          </div>
          <div className="context-detail__grid">
            <span>{documentSourceMode === "session" ? "대화세션 기반" : "바로 작성"}</span>
            <span>{selectedReferenceSet?.title ?? "자료 묶음 없음"}</span>
            <span>{lastFinalizeRequest ? shortDisplayId(lastFinalizeRequest.approval_ticket.id, "승인") : "승인 대기 없음"}</span>
            <span>{currentFinalizeTicket?.status ?? lastFinalizeRequest?.approval_ticket.status ?? "초안 단계"}</span>
          </div>
          {lastFinalizeRequest?.final_document_output.artifact_path ? (
            <button
              type="button"
              className="context-detail__row"
              onClick={() => void openExternalTarget(parentPathFromPath(lastFinalizeRequest.final_document_output.artifact_path))}
            >
              <span>산출물 폴더 열기</span>
              <FolderTree size={14} />
            </button>
          ) : null}
        </div>
      );
    }

    if (activeMenu === "search") {
      const firstHit = previewFileHit;
      return (
        <div className="context-detail">
          <div className="context-detail__hero">
            <span className="context-detail__icon"><FileSearch size={18} /></span>
            <div>
              <strong>파일찾기 상세</strong>
              <p>{localFileSearchResult ? `${localFileSearchResult.items.length}개 결과` : "파일명/경로/본문을 빠르게 찾아 세션에 연결합니다."}</p>
            </div>
          </div>
          <div className="context-detail__grid">
            <span>지식폴더 {localFileSearchResult?.knowledge_index_count ?? 0}</span>
            <span>파일명 인덱스 {localFileSearchResult?.local_index_count ?? 0}</span>
            <span>{selectedSession?.title ?? "세션 미선택"}</span>
            <span>{firstHit ? `Top score ${firstHit.score}` : "결과 없음"}</span>
          </div>
          {firstHit ? (
            <button type="button" className="context-detail__row" onClick={() => void openExternalTarget(firstHit.file.file_path)}>
              <span>{firstHit.file.title || fileNameFromPath(firstHit.file.file_path)}</span>
              <FileSearch size={14} />
            </button>
          ) : null}
        </div>
      );
    }

    return (
      <div className="context-detail">
        <div className="context-detail__hero">
          <span className="context-detail__icon"><Info size={18} /></span>
          <div>
            <strong>{activeMenuMeta.label}</strong>
            <p>{activeMenuMeta.description}</p>
          </div>
        </div>
        <div className="context-detail__grid">
          <span>선택 일정 {selectedSchedule ? "있음" : "없음"}</span>
          <span>선택 세션 {selectedSession ? "있음" : "없음"}</span>
          <span>승인 대기 {pendingApprovals.length}</span>
          <span>{deferredLogs.length > 0 ? "최근 실행 있음" : "최근 실행 없음"}</span>
        </div>
      </div>
    );
  }

  const ActiveMenuIcon = activeMenuMeta.icon;
  const upcomingContextSchedules = [...snapshot.schedules]
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())
    .slice(0, 5);
  const previewFileHit = selectedLocalFileHit ?? localFileSearchResult?.items[0] ?? null;
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
    { key: "preview", label: "미리보기", iconSrc: "/icons/panel-preview.png", enabled: activeMenu === "search" },
    { key: "dump", label: "덤프 뷰어", iconSrc: "/icons/panel-dump.png", enabled: activeMenu === "knowledge" && knowledgePanel === "indexing" },
  ];

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

  return (
    <div
      className={`workspace-shell ${contextPaneOpen ? "" : "workspace-shell--context-collapsed"}`.trim()}
      style={
        {
          "--ui-font-scale": uiFontScale,
          "--context-pane-width": `${contextPaneWidth}px`,
        } as CSSProperties
      }
    >
      <header className="shell-topbar">
          <div className="brand-card shell-topbar__brand">
            <div className="brand-card__main">
              <div>
                <p className="brand-card__eyebrow">공공분야 사무업무자를 위한 보안 걱정 없는 로컬 우선 업무공간</p>
                <h1>로컬 AI에이전트 워크플레이스 : 공무원</h1>
                <p>일정에서 시작해 대화, 검색, 지식, 문서작성, 실행기록까지 한 워크플로로 묶습니다.</p>
              </div>
              <div className="shell-topbar__current" data-testid="shell-topbar-current">
                <span className="shell-topbar__current-icon"><ActiveMenuIcon size={18} /></span>
                <div>
                  <strong>{activeMenuMeta.label}</strong>
                  <span>{activeMenuMeta.description}</span>
                </div>
              </div>
            </div>
          </div>
        <div className="shell-topbar__actions" aria-label="작업 표시 도구">
          <button
            type="button"
            className="button-secondary topbar-icon-button topbar-zoom-button"
            onClick={() => void handleUiZoom(-0.1)}
            aria-label="화면 축소"
            title="화면 축소"
          >
            -
          </button>
          <span className="pill pill--soft topbar-zoom-pill" title="현재 배율">
            {formatZoomPercent(uiFontScale)}
          </span>
          <button
            type="button"
            className="button-secondary topbar-icon-button topbar-zoom-button"
            onClick={() => void handleUiZoom(0.1)}
            aria-label="화면 확대"
            title="화면 확대"
          >
            +
          </button>
          <button
            type="button"
            className="button-secondary topbar-icon-button"
            onClick={() => {
              if (lockedKnowledgeIngestion) {
                setNotice("색인 처리 중에는 전체 새로고침 대신 인덱싱 상태만 갱신합니다.");
                pushToast("info", "색인 처리 중에는 GraphRAG 상태만 갱신합니다.");
                void refreshKnowledgeIngestionJobsOnly();
                return;
              }
              void refreshSnapshot();
            }}
            aria-label="새로고침"
            title="새로고침"
          >
            <AssetIcon src="/icons/refresh.svg" testId="topbar-refresh-icon" />
          </button>
          <button
            type="button"
            className={`button-secondary topbar-icon-button ${contextPaneOpen ? "is-active" : ""}`}
            aria-expanded={contextPaneOpen}
            onClick={() => setContextPaneOpen((current) => !current)}
            aria-label={contextPaneOpen ? "오른쪽 정보 패널 닫기" : "오른쪽 정보 패널 열기"}
            title={contextPaneOpen ? "오른쪽 정보 패널 닫기" : "오른쪽 정보 패널 열기"}
          >
            <AssetIcon
              src={contextPaneOpen ? "/icons/panel-close.svg" : "/icons/panel-open.svg"}
              testId="topbar-context-toggle-icon"
            />
          </button>
          <div className="runtime-indicator-wrap">
            <button
              type="button"
              className={`runtime-indicator ${snapshot.health?.status === "ok" ? "is-ok" : "is-offline"}`}
              data-testid="runtime-indicator-toggle"
              aria-label="업무 엔진 상태"
              aria-expanded={runtimePanelOpen}
              ref={runtimeIndicatorButtonRef}
              onClick={() => setRuntimePanelOpen((current) => !current)}
            >
              <span className="runtime-indicator__light" />
            </button>
            {runtimePanelOpen ? (
              <div className="runtime-popover" data-testid="runtime-popover" ref={runtimePanelRef}>
                <p className="runtime-popover__title">업무 엔진 상태</p>
                <p>{runtimeLoading ? "업무 엔진 상태 확인 중" : userFacingRuntimeDetail(runtimeStatus?.detail)}</p>
                {runtimeStatus?.log_path ? (
                  <p className="workspace-header__hint">업무 엔진 로그 파일 준비됨</p>
                ) : null}
                <div className="runtime-popover__actions">
                  {runtimeStatus?.available && !runtimeStatus.running ? (
                    <button type="button" className="button-secondary" onClick={() => void handleStartSidecar()} disabled={runtimeStarting}>
                      {runtimeStarting ? "시작 중..." : "시작"}
                    </button>
                  ) : null}
                  {unmanagedRuntimeReachable ? (
                    <button type="button" className="button-secondary" onClick={() => void handleRecoverSidecar()} disabled={runtimeLoading}>
                      {runtimeLoading ? "복구 중..." : "복구"}
                    </button>
                  ) : null}
                  {runtimeStatus?.available && runtimeStatus.running && runtimeStatus.managed ? (
                    <button type="button" className="button-secondary" onClick={() => void handleRestartSidecar()} disabled={runtimeStarting}>
                      {runtimeStarting ? "재시작 중..." : "재시작"}
                    </button>
                  ) : null}
                  {runtimeStatus?.available && runtimeStatus.running && runtimeStatus.managed ? (
                    <button type="button" className="button-secondary" onClick={() => void handleStopSidecar()} disabled={runtimeStarting}>
                      {runtimeStarting ? "종료 중..." : "종료"}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {renderSessionRail()}

      <main className="main-pane">
        <div className={`main-pane__scroll ${activeMenu === "chat" ? "main-pane__scroll--chat" : ""}`.trim()}>
          {loading ? <div className="loading-panel">워크스페이스를 불러오는 중입니다...</div> : renderMainPanel()}
        </div>
      </main>

      {contextPaneOpen ? (
        <div
          className="context-pane-resizer"
          onMouseDown={startContextPaneResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="오른쪽 패널 크기 조절"
        />
      ) : null}

      {contextPaneOpen ? (
        <aside className="context-pane">
        <div className="context-pane__scroll">
        <div className="context-pane__controls">
          {rightPanelControls.map((item) => (
            <button
              key={item.key}
              type="button"
              className={[
                "button-secondary",
                "context-pane__control-icon",
                item.enabled && contextPanelVisibility[item.key] ? "is-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => toggleContextSectionVisibility(item.key)}
              disabled={!item.enabled}
              aria-label={item.label}
              title={item.label}
            >
              <AssetIcon src={item.iconSrc} />
            </button>
          ))}
        </div>

        {contextPanelVisibility.context ? (
          <SectionCard
            eyebrow="현재 컨텍스트"
            title="선택 상태"
            actions={renderPanelCollapseButton("context", "현재 컨텍스트")}
          >
            {!contextPanelCollapsed.context ? (
              <>
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
              {selectedResponseContext ? (
                <div className="detail-panel" data-testid="response-context-detail">
                  <p className="settings-grid__label">최근 응답 맥락 상세</p>
                  <p className="detail-panel__title">{selectedResponseContext}</p>
                  <p className="subtle-text">
                    이 맥락은 마지막 업무대화 응답에서 사용된 GraphRAG 근거, 연결 파일, 첨부파일 수를 요약한 값입니다.
                  </p>
                  <div className="context-detail__grid">
                    <span>
                      GraphRAG{" "}
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
        ) : null}

        {contextPanelVisibility.approvals ? (
          <SectionCard
            eyebrow="승인 요청"
            title="대기 중인 승인"
            actions={renderPanelCollapseButton("approvals", "승인 요청")}
          >
            {!contextPanelCollapsed.approvals ? (
              pendingApprovals.length === 0 ? (
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
              )
            ) : null}
          </SectionCard>
        ) : null}

        {contextPanelVisibility.jobs ? (
          <SectionCard
            eyebrow="작업 진행"
            title={activeWorkJobCount > 0 ? `진행 중 ${activeWorkJobCount}개` : "최근 작업"}
            actions={renderPanelCollapseButton("jobs", "작업 진행")}
          >
            {!contextPanelCollapsed.jobs ? (
              visibleWorkJobs.length === 0 ? (
                <EmptyState title="진행 중인 작업이 없습니다." body="GraphRAG 인덱싱, 파일명 인덱스, 문서작성 같은 긴 작업은 여기에 표시됩니다." />
              ) : (
                <div className="item-list item-list--compact">
                  {visibleWorkJobs.map((job) => {
                    const progress = Math.max(0, Math.min(100, Math.round(job.progress_percent ?? 0)));
                    return (
                      <article key={job.id} className={`list-card list-card--compact ${isActiveWorkJob(job) ? "is-running" : ""}`}>
                        <div className="list-card__main list-card__main--static">
                          <div>
                            <h3>{job.title}</h3>
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
                          <span>{shortDisplayId(job.id, "작업")}</span>
                          {job.resource_key ? <span>{String(job.resource_key)}</span> : null}
                        </div>
                        <div className="inline-actions">
                          <button type="button" className="button-secondary" onClick={() => void toggleWorkJobEvents(job)}>
                            {expandedWorkJobId === job.id ? "작업 로그 접기" : "작업 로그 보기"}
                          </button>
                        </div>
                        {expandedWorkJobId === job.id ? (
                          <div className="dump-viewer dump-viewer--compact" aria-label={`${job.title} 작업 로그`}>
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
                        {job.error_message ? <p className="subtle-text">{job.error_message}</p> : null}
                        {isActiveWorkJob(job) ? (
                          <div className="inline-actions">
                            <button type="button" className="button-secondary" onClick={() => void cancelGenericWorkJob(job)}>
                              취소 요청
                            </button>
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
                <EmptyState title="표시할 일정이 없습니다." body="캘린더에서 새 일정을 등록하면 여기에 요약됩니다." />
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
        {activeMenu === "search" && contextPanelVisibility.preview ? (
          <SectionCard
            eyebrow="미리보기"
            title="파일찾기 결과"
            actions={renderPanelCollapseButton("preview", "미리보기")}
          >
            {!contextPanelCollapsed.preview ? (
              previewFileHit ? (
                <div className="context-detail" data-testid="right-file-preview">
                  <div className="context-detail__hero">
                    <span className="context-detail__icon"><FileSearch size={18} /></span>
                    <div>
                      <strong>{previewFileHit.file.title || fileNameFromPath(previewFileHit.file.file_path)}</strong>
                      <p>{relativePath(previewFileHit.file.file_path)}</p>
                    </div>
                  </div>
                  <div className="context-detail__grid">
                    <span>점수 {previewFileHit.score}</span>
                    <span>{previewFileHit.match_reasons.slice(0, 2).join(", ") || "파일명 일치"}</span>
                  </div>
                  <button type="button" className="context-detail__row" onClick={() => void openExternalTarget(previewFileHit.file.file_path)}>
                    <span>파일 열기</span>
                    <FileSearch size={14} />
                  </button>
                  <button
                    type="button"
                    className="context-detail__row"
                    onClick={() => void openExternalTarget(parentPathFromPath(previewFileHit.file.file_path))}
                  >
                    <span>폴더 열기</span>
                    <FolderTree size={14} />
                  </button>
                </div>
              ) : (
                <EmptyState title="미리볼 파일이 없습니다." body="파일찾기에서 검색을 실행하면 첫 결과가 여기에 요약됩니다." />
              )
            ) : null}
          </SectionCard>
        ) : null}
        {activeMenu === "knowledge" && knowledgePanel === "indexing" && contextPanelVisibility.dump ? (
          <SectionCard
            eyebrow="덤프 뷰어"
            title="GraphRAG 로그"
            actions={renderPanelCollapseButton("dump", "덤프 뷰어")}
          >
            {!contextPanelCollapsed.dump ? (
              dumpViewerJob ? (
                <div className="context-detail">
                  <div className="context-detail__hero">
                    <span className="context-detail__icon"><BookMarked size={18} /></span>
                    <div>
                      <strong>{shortDisplayId(dumpViewerJob.id, "인덱싱")}</strong>
                      <p>{ingestionStageLabel(dumpViewerJob)}</p>
                    </div>
                  </div>
                  <div className="context-detail__grid">
                    <span>{ingestionProgressPercent(dumpViewerJob)}%</span>
                    <span>실패 {dumpViewerJob.failed_count}</span>
                    <span>진단 {dumpViewerJob.diagnostic_event_count ?? 0}</span>
                  </div>
                  {dumpViewerJob.log_dump_path ? (
                    <div className="inline-actions">
                      <button type="button" className="button-secondary" onClick={() => void openKnowledgeLogDumpFolder(dumpViewerJob.log_dump_path ?? "")}>
                        덤프 폴더 열기
                      </button>
                      <button type="button" className="button-secondary" onClick={() => void toggleKnowledgeLogDump(dumpViewerJob)}>
                        덤프 열기
                      </button>
                    </div>
                  ) : (
                    <p className="subtle-text">아직 풀로그 덤프 경로가 없습니다.</p>
                  )}
                  {expandedIngestionLogJobId === dumpViewerJob.id ? (
                    <div className="knowledge-log-preview" data-testid="right-dump-viewer">
                      {knowledgeIngestionLogDumps[dumpViewerJob.id] ? (
                        <>
                          <div className="document-preview__meta">
                            <span className="pill">최근 로그 {knowledgeIngestionLogDumps[dumpViewerJob.id].items.length}개</span>
                            <span className="subtle-text">{knowledgeIngestionLogDumps[dumpViewerJob.id].log_dump_path}</span>
                          </div>
                          <div className="item-list item-list--compact">
                            {knowledgeIngestionLogDumps[dumpViewerJob.id].items.slice(0, 12).map((item, index) => (
                              <article key={`${dumpViewerJob.id}-panel-dump-${index}`} className="list-card list-card--compact">
                                <div className="list-card__main list-card__main--static">
                                  <div>
                                    <h3>{String(item.event ?? `event-${index + 1}`)}</h3>
                                    <p>{String(item.message ?? item.stage ?? "메시지 없음")}</p>
                                  </div>
                                  {item.stage ? <span className="pill">{String(item.stage)}</span> : null}
                                </div>
                                {item.title || item.file_path ? (
                                  <p className="subtle-text">{String(item.title ?? item.file_path)}</p>
                                ) : null}
                              </article>
                            ))}
                          </div>
                          <details className="knowledge-error-log">
                            <summary>원본 JSON 보기</summary>
                            <pre>
                              {knowledgeIngestionLogDumps[dumpViewerJob.id].items
                                .map((item) => JSON.stringify(item, null, 2).normalize("NFC"))
                                .join("\n")}
                            </pre>
                          </details>
                        </>
                      ) : (
                        <p className="subtle-text">풀로그 덤프를 불러오는 중입니다.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState title="인덱싱 로그가 없습니다." body="GraphRAG 인덱싱을 실행하면 상세 로그가 표시됩니다." />
              )
            ) : null}
          </SectionCard>
        ) : null}
        </div>
        </aside>
      ) : null}
      {toastItems.length ? (
        <div className="toast-stack" data-testid="toast-stack" aria-live="polite">
          {toastItems.map((toast) => (
            <div
              key={toast.id}
              className={`toast toast--${toast.tone}`}
              role={toast.tone === "error" ? "alert" : "status"}
            >
              <p>{toast.message}</p>
              <button type="button" className="toast__close" aria-label="알림 닫기" onClick={() => removeToast(toast.id)}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
