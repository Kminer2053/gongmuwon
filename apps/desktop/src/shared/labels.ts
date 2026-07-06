import type {
  KnowledgeBackendStatus,
  KnowledgeIngestionJobItem,
  WorkJobItem,
} from "../api";
import { formatDurationMs, shortDisplayId } from "./format";

export function describeCandidateType(value: string) {
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

export function describeProposalType(value: string) {
  switch (value) {
    case "knowledge_candidate":
      return "지식 반영 후보";
    case "archive":
      return "보관 후보";
    default:
      return value;
  }
}

export function describeKnowledgeSourceStatus(value: string) {
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

export function describeExtractionStatus(file: { status: string; text_excerpt?: string | null; extracted_text_path?: string | null }) {
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

export function describeIngestionJobStatus(job: KnowledgeIngestionJobItem) {
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

export function describeWorkJobStatus(job: WorkJobItem) {
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

export function isActiveWorkJob(job: WorkJobItem) {
  return ["queued", "blocked", "running", "waiting_approval", "cancel_requested"].includes(job.status);
}

export function workJobResultTargets(job: WorkJobItem) {
  const result = job.result ?? {};
  const candidates: Array<[string, unknown]> = [
    ["결과 열기", result.artifact_path],
    ["Markdown 열기", result.markdown_path],
    ["대상 열기", result.destination_path],
    ["복원 위치 열기", result.restored_path],
    ["로그 열기", result.log_dump_path],
  ];
  return candidates
    .filter((candidate): candidate is [string, string] => typeof candidate[1] === "string" && candidate[1].trim().length > 0)
    .map(([label, target]) => ({ label, target }));
}

export function activeKnowledgeIngestionMessage(job: KnowledgeIngestionJobItem | null) {
  if (!job) {
    return "";
  }
  return `색인 ${shortDisplayId(job.id, "작업")}이 진행 중입니다. 작업을 완료하거나 취소한 뒤 지식폴더 설정, 스캔, 재색인을 다시 실행할 수 있습니다.`;
}
export function ingestionRuntimeLabel(job: KnowledgeIngestionJobItem) {
  if (typeof job.duration_ms !== "number") {
    return null;
  }
  const average = typeof job.average_ms_per_file === "number" ? job.average_ms_per_file : 0;
  return `소요 ${formatDurationMs(job.duration_ms)} · 파일당 ${formatDurationMs(average)}`;
}

export function ingestionProgressPercent(job: KnowledgeIngestionJobItem) {
  if (typeof job.progress_percent === "number") {
    return Math.max(0, Math.min(100, Math.round(job.progress_percent)));
  }
  if (job.queued_count <= 0) {
    return job.status === "completed" ? 100 : 0;
  }
  const attempted = Math.min(job.queued_count, job.processed_count + job.failed_count);
  return Math.round((attempted / job.queued_count) * 100);
}

export function ingestionStageIndex(job: KnowledgeIngestionJobItem) {
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

export function ingestionStageLabel(job: KnowledgeIngestionJobItem) {
  if (job.current_stage) {
    return job.current_stage;
  }
  if (job.status === "queued") {
    return "대기 중";
  }
  if (job.status === "running") {
    return "본문 추출/색인 처리 중";
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

export function splitIngestionErrors(message?: string | null) {
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

export function describeKnowledgeSearchEngine(status: KnowledgeBackendStatus | null) {
  if (!status) {
    return { label: "상태 확인 중", tone: "soft" as const, detail: null as string | null };
  }
  if (status.fts5?.ok) {
    const tokenizer = status.fts5.tokenizer === "trigram" ? "트라이그램" : status.fts5.tokenizer ?? "";
    return {
      label: tokenizer ? `키워드 검색(FTS5) 정상 · ${tokenizer}` : "키워드 검색(FTS5) 정상",
      tone: "soft" as const,
      detail: status.backends?.find((backend) => backend.name === "sqlite_fts5")?.detail ?? null,
    };
  }
  return {
    label: "키워드 검색: 부분 일치만 사용 가능",
    tone: "warning" as const,
    detail: "FTS5를 사용할 수 없어 부분 일치(LIKE) 검색으로 동작합니다.",
  };
}

export type ExtractionQualityReport = {
  paragraph_count?: number;
  text_char_count?: number;
  warnings?: unknown;
};

export function extractionQualityReport(metadata?: Record<string, unknown>) {
  const value = metadata?.extraction_quality;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as ExtractionQualityReport;
}

export function extractionQualityMetricLabel(metadata?: Record<string, unknown>) {
  const report = extractionQualityReport(metadata);
  if (!report) {
    return null;
  }
  const paragraphCount = typeof report.paragraph_count === "number" ? report.paragraph_count : 0;
  const textCharCount = typeof report.text_char_count === "number" ? report.text_char_count : 0;
  return `문단 ${paragraphCount} · 글자 ${textCharCount}`;
}

export function describeExtractionQualityWarning(value: string) {
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

export function extractionQualityWarnings(metadata?: Record<string, unknown>) {
  const report = extractionQualityReport(metadata);
  if (!Array.isArray(report?.warnings)) {
    return [];
  }
  return report.warnings.filter((warning): warning is string => typeof warning === "string");
}

export function extractionQualityWarningLabel(metadata?: Record<string, unknown>) {
  const warnings = extractionQualityWarnings(metadata);
  if (warnings.length === 0) {
    return "경고 없음";
  }
  return `경고: ${warnings.map(describeExtractionQualityWarning).join(", ")}`;
}

export function chunkQualityLabel(document: { chunk_count?: number; table_chunk_count?: number }) {
  if (typeof document.chunk_count !== "number" && typeof document.table_chunk_count !== "number") {
    return null;
  }
  return `chunk ${document.chunk_count ?? 0} · 표 chunk ${document.table_chunk_count ?? 0}`;
}

export function citationEvidenceLabel(evidenceType?: string) {
  return evidenceType === "table" ? "표 근거" : "섹션 근거";
}

export function citationWarningLabel(warnings?: string[]) {
  if (!warnings?.length) {
    return null;
  }
  return `경고: ${warnings.map(describeExtractionQualityWarning).join(", ")}`;
}

export function describeExecutionFeature(value: string) {
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
    case "files":
      return "파일 색인";
    case "jobs":
      return "백그라운드 작업";
    case "personalization":
      return "개인화";
    default:
      return "기타";
  }
}

// 실행기록 화면(LogsScreen)의 요약 제목과 "개발자 정보" 상세 패널이 같은 라벨을 쓰도록
// 여기 한 곳에서만 관리한다(누락 시 두 화면 중 하나만 한국어로 남는 사고를 방지).
export const EXECUTION_ACTION_LABELS: Record<string, string> = {
  "documents.content_base.created": "작성 콘텐츠 생성",
  "documents.template.uploaded": "문서 양식 업로드",
  "documents.finalize.requested": "최종 저장 요청",
  "documents.finalize.applied": "최종 저장 적용",
  "documents.attachments.created": "문서 첨부파일 등록",
  "documents.authoring.custom_detect": "맞춤 양식 빈 항목 감지",
  "documents.authoring.custom_fill_applied": "맞춤 양식 값 채우기 적용",
  "documents.authoring.custom_patch_applied": "맞춤 양식 본문 수정 적용",
  "knowledge.candidate.created": "지식 후보 생성",
  "knowledge.candidate.approved": "지식 후보 승인",
  "knowledge.source.registered": "지식 소스 폴더 등록",
  "knowledge.source.scanned": "지식 소스 폴더 스캔",
  "knowledge.ingest.job.run": "지식위키 색인 실행",
  "knowledge.ingest.completed": "지식위키 색인 완료",
  "knowledge.wiki.ingest.completed": "지식위키 색인 완료",
  "knowledge.wiki.work_page.updated": "지식위키 업무 페이지 갱신",
  "knowledge.wiki.work_page.failed": "지식위키 업무 페이지 갱신 실패",
  "knowledge.taxonomy.interview.saved": "분류체계 인터뷰 저장",
  "knowledge.taxonomy.confirmed": "분류체계 확정",
  "knowledge.taxonomy.applied": "분류체계 적용",
  "knowledge.taxonomy.queue.resolved": "분류 대기 항목 처리",
  "file_org.proposals.created": "파일정리 제안 생성",
  "file_org.apply.requested": "파일정리 적용 요청",
  "file_org.apply.committed": "파일정리 적용",
  "file_org.rollback.completed": "파일정리 되돌리기",
  "anything.launch.requested": "Anything 실행 요청",
  "anything.launch.applied": "Anything 실행 적용",
  "anything.launch.imported": "Anything 결과 가져오기",
  "reference_set.created": "참고자료 묶음 생성",
  "work_session.created": "업무대화 세션 생성",
  "work_session.updated": "업무대화 세션 갱신",
  "work_session.turn.failed": "업무대화 응답 실패",
  "work_session.attachments.created": "업무대화 파일 첨부",
  "work_session.file_links.created": "세션 관련 파일 연결",
  "work_session.file_link.deleted": "세션 관련 파일 연결 해제",
  "work_session.knowledge_context.failed": "업무대화 지식 근거 조회 실패",
  "settings.updated": "환경설정 저장",
  "settings.llm.test.completed": "LLM 연결 테스트 성공",
  "settings.llm.test.failed": "LLM 연결 테스트 실패",
  "schedule.created": "일정 생성",
  "schedule.updated": "일정 수정",
  "schedule.deleted": "일정 삭제",
  "schedule.reminder.triggered": "일정 알림 발생",
  "schedule.reminder.acknowledged": "일정 알림 확인",
  "approval_ticket.decided": "승인 결정",
  "files.index.rebuilt": "파일명 색인 갱신",
  "job.stale_queued.canceled": "오래된 대기 작업 자동 취소",
  "personalization.session_summary.created": "개인화 요약 생성",
  "personalization.session_summary.applied": "개인화 요약 반영",
};

export function describeExecutionAction(value: string) {
  return EXECUTION_ACTION_LABELS[value] ?? "기타 작업";
}

export function describeStatus(value: string) {
  switch (value) {
    case "pending":
      return "대기 중";
    case "approved":
      return "승인됨";
    case "rejected":
      return "반려됨";
    case "success":
    case "succeeded":
      return "성공";
    case "completed":
      return "완료";
    case "failed":
      return "실패";
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
    case "canceled":
      return "취소됨";
    case "partial":
      return "부분 완료";
    default:
      return "기타 상태";
  }
}

export function describeMessageStatus(value?: string) {
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

export function splitFailedAssistantMessage(text: string): { summary: string; detail: string } {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return { summary: "응답을 완료하지 못했습니다.", detail: "" };
  }
  const lines = trimmed.split(/\r?\n/);
  const firstLine = (lines[0] ?? "").trim();
  const rest = lines.slice(1).join("\n").trim();
  if (/[가-힣]/.test(firstLine)) {
    return { summary: firstLine, detail: rest };
  }
  return { summary: "응답을 완료하지 못했습니다.", detail: trimmed };
}

export const APPROVAL_ACTION_LABELS: Record<string, string> = {
  "documents.finalize": "문서 최종 저장",
  "file_org.apply": "파일정리 적용",
  "file_org.rollback": "파일정리 되돌리기",
  "anything.launch": "외부 검색 실행",
  "knowledge.candidate.approve": "지식위키 반영",
  "personalization.apply": "개인화 반영",
};

export function describeApprovalAction(action: string) {
  return APPROVAL_ACTION_LABELS[action] ?? action;
}

export const KNOWLEDGE_INGESTION_STAGE_LABELS = ["스캔", "추출", "색인", "위키"];

export function describeReasoningEffort(value: "auto" | "minimal" | "low" | "medium" | "high") {
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

export function userFacingRuntimeDetail(detail: string | null | undefined): string {
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

export function userFacingRuntimeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(/sidecar/gi, "업무 엔진").replace(/사이드카/g, "업무 엔진");
}
