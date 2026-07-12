const API_BASE_URL = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:8765";

export type LlmMode = "local_first" | "internal_server" | "external_model";
export type PersonalizationApplyMode = "approval_required" | "auto_apply";
export type EmbeddingProvider = "deterministic" | "ollama";
export type GraphRAGVectorBackend = "sqlite" | "chromadb";

export type LlmConnectionProfile = {
  provider: string;
  model: string;
  api_key?: string | null;
  base_url?: string | null;
  site_url?: string | null;
  application_name?: string | null;
};

export type ExternalModelProfiles = {
  active_provider: string;
  providers: Record<string, LlmConnectionProfile>;
};

export type WorkspaceLlmProfiles = {
  local_first: LlmConnectionProfile;
  internal_server: LlmConnectionProfile;
  external_model: ExternalModelProfiles;
};

export type ScheduleItem = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  view: "month" | "week" | "day";
  // 분 단위 사전 알림 (null = 알림 없음)
  remind_before_minutes?: number | null;
  created_at: string;
};

export type WorkSessionItem = {
  id: string;
  title: string;
  schedule_id?: string | null;
  status: string;
  created_at: string;
  messages?: WorkSessionMessageItem[];
};

export type WorkSessionMessageCitation = {
  title?: string | null;
  file_path: string;
  snippet?: string | null;
  /**
   * W7 §5.5/§5.6: 인용 시점의 문서 고유 식별자.
   * 원본이 이동/삭제됐을 때 지식카드 폴백 조회(fetchKnowledgeCardByUid)에 쓴다.
   * 구버전 인용(3필드)에는 없으며, 없으면 현행 동작(원본 바로 열기)을 유지한다.
   */
  doc_uid?: string | null;
};

export type WorkSessionMessageItem = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  text: string;
  message_type?: "chat" | "note" | "system";
  status?: "pending" | "streaming" | "completed" | "failed";
  provider?: string | null;
  model?: string | null;
  latency_ms?: number | null;
  attachments?: WorkSessionAttachmentItem[];
  citations?: WorkSessionMessageCitation[];
  created_at: string;
};

export type WorkSessionAttachmentItem = {
  id: string;
  session_id: string;
  message_id?: string | null;
  file_name: string;
  mime_type?: string | null;
  stored_path: string;
  size_bytes: number;
  text_excerpt?: string | null;
  created_at: string;
};

export type DocumentAttachmentItem = {
  id: string;
  file_name: string;
  mime_type?: string | null;
  stored_path: string;
  size_bytes: number;
  text_excerpt?: string | null;
  created_at: string;
};

export type WorkSessionFileLinkItem = {
  id: string;
  session_id: string;
  file_path: string;
  label?: string | null;
  source: "manual" | "anything" | "knowledge" | "attachment" | string;
  created_at: string;
};

export type WorkSessionTurnContextSummary = {
  graphrag_used: boolean;
  graphrag_evidence_count: number;
  attachment_count: number;
  linked_file_count: number;
  provider?: string | null;
  model?: string | null;
};

export type WorkSessionTurnResult = {
  user_message: WorkSessionMessageItem;
  assistant_message: WorkSessionMessageItem;
  duration_ms?: number;
  work_job?: WorkJobItem;
  context_summary?: WorkSessionTurnContextSummary;
};

export type WorkSessionTurnStreamDelta = {
  text: string;
};

export type WorkSessionTurnStreamHandlers = {
  onUserMessage?: (message: WorkSessionMessageItem) => void;
  onAssistantMessage?: (message: WorkSessionMessageItem) => void;
  onDelta?: (delta: WorkSessionTurnStreamDelta) => void;
  onDone?: (result: WorkSessionTurnResult) => void;
  onError?: (error: { message: string }) => void;
};

export type TemplateItem = {
  key: "report" | "meeting" | "review";
  label: string;
};

export type DocumentFormat = "auto" | "officialMemo" | "onePageReport" | "fullReport" | "email";

export type CustomDocumentTemplateItem = {
  file_name: string;
  path: string;
  size_bytes?: number;
  uploaded_at?: string;
};

export type KnowledgeCandidateItem = {
  id: string;
  title: string;
  body?: string;
  candidate_type: "topic" | "project" | "issue" | "entity";
  status: string;
  created_at: string;
};

export type KnowledgePageItem = {
  id: string;
  title: string;
  page_type: string;
  path: string;
  created_at: string;
};

export type KnowledgeSourceItem = {
  id: string;
  label: string;
  root_path: string;
  status: "active" | "missing" | string;
  last_scanned_at?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type KnowledgeSourceFileItem = {
  id: string;
  source_id: string;
  file_path: string;
  relative_path: string;
  file_hash: string;
  size_bytes: number;
  modified_at: string;
  status: "indexed" | "metadata_only" | "deleted" | string;
  title?: string | null;
  mime_type?: string | null;
  text_excerpt?: string | null;
  extracted_text_path?: string | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeSourceScanResult = {
  source_id: string;
  status: "completed" | string;
  indexed_count: number;
  metadata_count: number;
  deleted_count: number;
  failed_count: number;
  /** 잠금·쓰기 중 등으로 이번 스캔에서 처리 보류(UNSTABLE)된 파일 수 — 다음 스캔에서 처리(구버전 서버는 미제공). */
  unstable_count?: number;
  scanned_at: string;
};

/**
 * 증분 색인 "변경 확인" diff 견적(설계서 §4.2·§4.4).
 * 색인을 실행하지 않고 마지막 스캔 이후 변경 견적만 돌려준다.
 */
export type KnowledgeSourceDiffResult = {
  added: number;
  modified: number;
  moved: number;
  deleted: number;
  unchanged: number;
  /** 잠금·방금 수정 등으로 판정을 보류한 파일 수 — 다음 스캔에서 처리. */
  unstable: number;
  /** 해시 확인이 필요한 파일 견적(순차 읽기 비용 상한). */
  rehash_estimate: { files: number; bytes: number };
  /** 견적 게이트 초과 여부 — true면 자동 실행 대신 사용자 확인이 필요하다. */
  exceeds_gate: boolean;
};

export type KnowledgeIngestionJobItem = {
  id: string;
  source_id: string;
  status: "queued" | "running" | "completed" | "partial" | string;
  current_stage?: string | null;
  current_stage_index?: number | null;
  stage_count?: number | null;
  progress_percent?: number | null;
  queued_count: number;
  processed_count: number;
  failed_count: number;
  deleted_document_count?: number;
  skipped_count?: number;
  /** 스캔 단계에서 보류(UNSTABLE)된 파일 수 — 다음 스캔에서 처리(구버전 서버는 미제공). */
  unstable_count?: number;
  force_rebuild?: number;
  cancel_requested?: number;
  last_processed_path?: string | null;
  last_processed_at?: string | null;
  duration_ms?: number | null;
  average_ms_per_file?: number | null;
  error_message?: string | null;
  log_dump_path?: string | null;
  diagnostic_event_count?: number | null;
  last_diagnostic_message?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
};

export type KnowledgeIngestionLogDump = {
  job_id: string;
  log_dump_path: string;
  limit: number;
  items: Array<Record<string, unknown>>;
};

export type WorkJobItem = {
  id: string;
  kind: string;
  title: string;
  status: "queued" | "blocked" | "running" | "waiting_approval" | "cancel_requested" | "succeeded" | "partial" | "failed" | "canceled" | string;
  priority: number;
  resource_key?: string | null;
  resource_policy: string;
  progress_percent: number;
  current_stage?: string | null;
  cancel_requested: boolean;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error_message?: string | null;
  created_at: string;
  queued_at: string;
  started_at?: string | null;
  completed_at?: string | null;
};

export type WorkJobEventItem = {
  id: string;
  job_id: string;
  seq: number;
  level: "info" | "warning" | "error" | string;
  event_type: string;
  message: string;
  payload?: Record<string, unknown>;
  created_at: string;
};

export type RuntimeReady = {
  status: "ready" | "degraded" | string;
  checks: Record<string, { ok: boolean; [key: string]: unknown }>;
  recovered: {
    work_jobs: number;
    knowledge_ingestion_jobs: number;
  };
};

export type RuntimeMetrics = {
  jobs: {
    active_count: number;
    terminal_count: number;
    queued: number;
    blocked: number;
    running: number;
    waiting_approval: number;
    cancel_requested: number;
    failed: number;
    succeeded: number;
    partial: number;
    canceled: number;
  };
  runner: {
    active_count: number;
    active_job_ids: string[];
    queue_depth: number;
    submitted_count: number;
  };
  knowledge: {
    active_ingestion_job_id: string | null;
    active_ingestion_status: string | null;
  };
  recovered: {
    work_jobs: number;
    knowledge_ingestion_jobs: number;
  };
};

export type PersonalizationCandidateItem = {
  id: string;
  candidate_type: "session_summary_index" | "work_pattern" | "entity_alias" | "document_preference" | "extraction_rule" | string;
  title: string;
  body: string;
  source_session_id?: string | null;
  risk_level: "low" | "medium" | "high" | string;
  status: "pending" | "applied" | "rejected" | string;
  proposed_payload: string;
  created_at: string;
  decided_at?: string | null;
};

export type PersonalizationDecisionResult = {
  candidate: PersonalizationCandidateItem;
  application?: {
    summary_path: string;
    audit_path: string;
    applied_at: string;
  } | null;
};

export type KnowledgeSearchItem = {
  doc_id: string;
  document_id?: string | null;
  title: string;
  source_path: string;
  relative_path?: string | null;
  snippet: string;
  score?: number;
  quality_score?: number | null;
  warnings?: string[];
  card_path?: string | null;
  slug?: string | null;
};

export type KnowledgeSearchResult = {
  query: string;
  mode?: "fts5" | "like" | "empty" | string;
  items?: KnowledgeSearchItem[];
  // 구 GraphRAG 응답 호환 필드 (백엔드 전환기 동안 유지)
  vector_hits?: Array<{ page: KnowledgePageItem; score: number; keyword_overlap: number }>;
  source_file_hits?: Array<{ file: KnowledgeSourceFileItem; keyword_overlap: number }>;
  graph_neighbors?: string[];
};

export type LocalFileSearchResult = {
  query: string;
  knowledge_index_count?: number;
  local_index_count?: number;
  partial?: boolean;
  items: Array<{
    file: KnowledgeSourceFileItem;
    score: number;
    match_reasons: string[];
  }>;
};

export type LocalFileIndexRebuildResult = {
  status: "completed" | "partial" | string;
  indexed_count: number;
  searched_roots: string[];
  partial: boolean;
  indexed_at: string;
};

export type KnowledgeGraphSummary = {
  node_count: number;
  edge_count: number;
  artifacts: {
    graph_json_path: string;
    graph_html_path: string;
    graph_report_path: string;
  };
  nodes: Array<{ id: string; label?: string; node_type?: string; neighbors?: string[] }>;
  edges?: Array<{ source: string; target: string; relation?: string }>;
};

export type KnowledgeGraphQueryResult = {
  query: string;
  nodes: Array<{ id: string; label?: string; node_type?: string; metadata?: Record<string, unknown> }>;
  edges: Array<{
    id: string;
    source_node_id: string;
    target_node_id: string;
    relation: string;
    confidence?: number;
  }>;
  neighbor_nodes: Array<{ id: string; label?: string; node_type?: string; metadata?: Record<string, unknown> }>;
  related_documents: Array<{
    id: string;
    title: string;
    file_path: string;
    document_type?: string;
  }>;
};

export type KnowledgeTableBlock = {
  id: string;
  document_id: string;
  section_id?: string | null;
  order_index: number;
  caption?: string | null;
  headers: string[];
  rows: string[][];
  created_at?: string;
};

export type KnowledgeDocumentStructure = {
  document: {
    id: string;
    title: string;
    file_path: string;
    document_type: string;
    document_number?: string | null;
    parser_name?: string;
    quality_score?: number;
    partial?: boolean;
    chunk_count?: number;
    table_chunk_count?: number;
    metadata?: Record<string, unknown>;
  };
  section_count?: number;
  sections_returned?: number;
  has_more_sections?: boolean;
  sections: Array<{
    id: string;
    document_id: string;
    heading: string;
    level: number;
    order_index: number;
    text: string;
    tables: KnowledgeTableBlock[];
  }>;
};

export type KnowledgeDocumentItem = {
  id: string;
  source_file_id: string;
  source_id: string;
  file_path: string;
  relative_path?: string | null;
  title: string;
  document_type: string;
  document_number?: string | null;
  sender_org?: string | null;
  receiver_org?: string | null;
  issued_date?: string | null;
  security_level?: string | null;
  attachment_count: number;
  parser_name: string;
  parser_version?: string;
  quality_score: number;
  partial: boolean;
  metadata?: Record<string, unknown>;
  section_count?: number;
  table_count?: number;
  chunk_count?: number;
  table_chunk_count?: number;
  created_at: string;
  updated_at: string;
};

export type KnowledgeBackendEntry = {
  name: string;
  role?: string;
  available?: boolean;
  tokenizer?: string;
  storage_path?: string;
  detail?: string | null;
};

export type KnowledgeBackendStatus = {
  engine?: string;
  fts5?: { ok: boolean; tokenizer?: string };
  kordoc?: { available: boolean };
  llm_enrichment?: {
    configured: boolean;
    /** W7 P3 §5.4: 요약 보강 대기 문서 수(enrich remaining) — 구버전 서버 응답에는 없다. */
    pending_count?: number;
    /** Wave D F-11: 커버리지 "요약 보유 n/전체" — 구버전 서버 응답에는 없다. */
    enriched_count?: number;
    total_count?: number;
    /** 주제 어휘집 규격 §6: 승인 대기 중인 주제 후보 수(전체 pending) — 구버전 서버 응답에는 없다. */
    vocab_candidates_pending?: number;
    /**
     * §6 확장(자동 선별): 사람 검토(review) 추천분만 센 수 — 대시보드 "주제 후보 검토 n건"
     * 배지 근거. merge/reject 추천분은 일괄 적용 대상이라 제외된다. 구버전 서버 응답에는 없다.
     */
    vocab_candidates_review?: number;
  };
  backends?: KnowledgeBackendEntry[];
  vector?: {
    contract_version?: string;
    role?: string;
    production_backend: string;
    production_available: boolean;
    production_enabled?: boolean;
    active_backend: string;
    activation_ready?: boolean;
    activation_blockers?: string[];
    activation_notes?: string[];
    single_writer_required?: boolean;
    mode?: string;
    available: boolean;
    offline_safe?: boolean;
    requires_network?: boolean;
    operations?: string[];
    storage_path: string;
    detail?: string | null;
  };
  graph?: {
    contract_version?: string;
    role?: string;
    production_backend: string;
    production_available: boolean;
    production_enabled?: boolean;
    active_backend: string;
    activation_ready?: boolean;
    activation_blockers?: string[];
    activation_notes?: string[];
    single_writer_required?: boolean;
    mode?: string;
    available: boolean;
    offline_safe?: boolean;
    requires_network?: boolean;
    operations?: string[];
    storage_path: string;
    detail?: string | null;
  };
};

export type KnowledgeParserStatus = {
  kordoc: {
    available: boolean;
    runner_available: boolean;
    runner_path?: string | null;
    runner_error?: string | null;
    node_available: boolean;
    node_command: string;
    node_version?: string | null;
    node_error?: string | null;
  };
};

export type KnowledgeAskCitation = {
  doc_id?: string;
  document_id?: string | null;
  /** W7 §5.5/§5.6: 문서 고유 식별자 — 원본 부재 시 카드 폴백 조회용(구버전 응답에는 없음). */
  doc_uid?: string | null;
  title: string;
  source_path?: string;
  file_path: string;
  snippet?: string;
  chunk_id?: string;
  parser_name?: string | null;
  quality_score?: number | null;
  partial?: boolean;
  evidence_type?: "section" | "table" | "wiki" | string;
  quality_warnings?: string[];
  card_path?: string | null;
  score_breakdown?: {
    text_score?: number;
    graph_score?: number;
    vector_score?: number;
    session_context_boost?: number;
    table_evidence_boost?: number;
  };
  relations?: string[];
};

export type KnowledgeAskResult = {
  query: string;
  session_id?: string | null;
  answer: string;
  answer_mode?: "llm" | "extractive" | string;
  citations: KnowledgeAskCitation[];
  retrieval_summary?: {
    source_count: number;
    hit_count?: number;
    low_quality_count?: number;
    table_evidence_count?: number;
    partial_count?: number;
    relation_count?: number;
  };
  items?: unknown[];
};

export type ToolManifestItem = {
  key: string;
  label: string;
  description: string;
  status: "mvp" | "later";
};

export type ApprovalTicketItem = {
  id: string;
  action: string;
  status: "pending" | "approved" | "rejected";
  target_type: string;
  target_id?: string;
  target_label?: string | null;
  requested_at: string;
  decided_at?: string | null;
  decision_note?: string | null;
};

export type ExecutionLogItem = {
  id: string;
  feature: string;
  action: string;
  status: string;
  created_at: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  approval_ticket_id?: string | null;
};

export type WorkspaceHealth = {
  status: string;
  workspace_root: string;
  database: string;
};

export type WorkspaceSettings = {
  defaults: {
    llm_mode: LlmMode;
    llm_provider: string;
    llm_model: string;
    llm_api_key: string | null;
    llm_site_url?: string | null;
    llm_application_name?: string | null;
    anything_launch_mode: "external_app_preferred";
    default_template_key: "report" | "meeting" | "review";
    internal_api_base_url: string | null;
    personalization_apply_mode: PersonalizationApplyMode;
    embedding_provider: EmbeddingProvider;
    embedding_model: string;
    embedding_base_url: string | null;
    embedding_fallback_enabled: boolean;
    graphrag_vector_backend: GraphRAGVectorBackend;
    profiles: WorkspaceLlmProfiles;
  };
  paths: {
    workspace_root: string;
    database: string;
    knowledge_root: string;
    documents_root: string;
    personalization_root: string;
  };
};

export type WorkspaceSettingsUpdatePayload = {
  llm_mode?: LlmMode;
  llm_provider?: string;
  llm_model?: string;
  llm_api_key?: string | null;
  llm_site_url?: string | null;
  llm_application_name?: string | null;
  llm_profiles?: WorkspaceLlmProfiles;
  default_template_key?: "report" | "meeting" | "review";
  internal_api_base_url?: string | null;
  personalization_apply_mode?: PersonalizationApplyMode;
  personalization_root?: string | null;
};

export type WorkspaceLlmTestResult = {
  status: "ok" | "failed";
  provider: string;
  model: string;
  text: string;
};

const WORKSPACE_SETTINGS_VALUES = {
  llm_mode: ["local_first", "internal_server", "external_model"],
  anything_launch_mode: ["external_app_preferred"],
  default_template_key: ["report", "meeting", "review"],
  personalization_apply_mode: ["approval_required", "auto_apply"],
  embedding_provider: ["deterministic", "ollama"],
  graphrag_vector_backend: ["sqlite", "chromadb"],
} as const;

export function createDefaultWorkspaceLlmProfiles(): WorkspaceLlmProfiles {
  return {
    local_first: {
      provider: "ollama",
      model: "qwen3.6:27b",
      api_key: null,
      base_url: "http://127.0.0.1:11434",
      site_url: null,
      application_name: null,
    },
    internal_server: {
      provider: "openai_compatible",
      model: "gpt-4.1-mini",
      api_key: null,
      base_url: "http://127.0.0.1:9000/v1",
      site_url: null,
      application_name: null,
    },
    external_model: {
      active_provider: "openai",
      providers: {
        openai: {
          provider: "openai",
          model: "gpt-5.5",
          api_key: null,
          base_url: "https://api.openai.com/v1",
          site_url: null,
          application_name: null,
        },
        openrouter: {
          provider: "openrouter",
          model: "openai/gpt-5.5",
          api_key: null,
          base_url: "https://openrouter.ai/api/v1",
          site_url: null,
          application_name: null,
        },
        featherless: {
          provider: "featherless",
          model: "google/gemma-4-E2B-it",
          api_key: null,
          base_url: "https://api.featherless.ai/v1",
          site_url: null,
          application_name: null,
        },
        anthropic: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          api_key: null,
          base_url: "https://api.anthropic.com/v1",
          site_url: null,
          application_name: null,
        },
        gemini: {
          provider: "gemini",
          model: "gemini-2.5-flash",
          api_key: null,
          base_url: "https://generativelanguage.googleapis.com/v1beta",
          site_url: null,
          application_name: null,
        },
        nvidia_nim: {
          provider: "nvidia_nim",
          model: "meta/llama-3.1-8b-instruct",
          api_key: null,
          base_url: "https://integrate.api.nvidia.com/v1",
          site_url: null,
          application_name: null,
        },
        ollama: {
          provider: "ollama",
          model: "qwen3.6:27b",
          api_key: null,
          base_url: "http://127.0.0.1:11434",
          site_url: null,
          application_name: null,
        },
      },
    },
  };
}

export function cloneWorkspaceLlmProfiles(profiles: WorkspaceLlmProfiles): WorkspaceLlmProfiles {
  if (!profiles) {
    return createDefaultWorkspaceLlmProfiles();
  }
  return JSON.parse(JSON.stringify(profiles)) as WorkspaceLlmProfiles;
}

export function getLlmProfileForSelection(
  profiles: WorkspaceLlmProfiles,
  mode: LlmMode,
  provider?: string,
): LlmConnectionProfile {
  if (mode === "external_model") {
    const providerKey = provider?.trim() || profiles.external_model.active_provider || "openai";
    return (
      profiles.external_model.providers[providerKey] ??
      createDefaultWorkspaceLlmProfiles().external_model.providers.openai
    );
  }
  return profiles[mode];
}

export type ContentBaseResult = {
  id: string;
  title: string;
  purpose: string;
  template_key: string;
  source_session_id?: string | null;
  outline?: string;
  document_format?: DocumentFormat;
  direct_file_paths?: string[];
  user_template_path?: string | null;
  content: string;
  artifact: { path: string };
  preview: { path: string };
};

export type FinalDocumentOutputItem = {
  id: string;
  content_base_id: string;
  approval_ticket_id: string;
  output_name: string;
  artifact_path?: string | null;
  status: "pending" | "applied";
  created_at: string;
  applied_at?: string | null;
};

export type FinalDocumentRequestResult = {
  approval_ticket: ApprovalTicketItem;
  final_document_output: FinalDocumentOutputItem;
  artifact?: { path: string; markdown_path?: string; format?: string };
};

export type FinalDocumentApplyResult = FinalDocumentRequestResult & {
  artifact: { path: string; markdown_path?: string; format?: string };
};

export type WorkspaceSnapshot = {
  health: WorkspaceHealth | null;
  runtimeReady: RuntimeReady | null;
  runtimeMetrics: RuntimeMetrics | null;
  settings: WorkspaceSettings | null;
  schedules: ScheduleItem[];
  workSessions: WorkSessionItem[];
  templates: TemplateItem[];
  knowledgeCandidates: KnowledgeCandidateItem[];
  knowledgePages: KnowledgePageItem[];
  knowledgeSources: KnowledgeSourceItem[];
  knowledgeSourceFiles: KnowledgeSourceFileItem[];
  knowledgeIngestionJobs: KnowledgeIngestionJobItem[];
  knowledgeDocuments: KnowledgeDocumentItem[];
  workJobs: WorkJobItem[];
  personalizationCandidates: PersonalizationCandidateItem[];
  approvalTickets: ApprovalTicketItem[];
  logs: ExecutionLogItem[];
};

export type WorkspaceDeferredGroup = "knowledge" | "logs";
export type WorkspaceSnapshotPatch = Partial<WorkspaceSnapshot>;

export function createEmptyWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
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
}

export function mergeWorkspaceSnapshot(
  current: WorkspaceSnapshot,
  patch: WorkspaceSnapshotPatch,
): WorkspaceSnapshot {
  return {
    ...current,
    ...patch,
    health: patch.health !== undefined ? patch.health : current.health,
    settings: patch.settings !== undefined ? patch.settings : current.settings,
  };
}

export async function createWorkSessionMessage(
  sessionId: string,
  payload: {
    role: "user" | "assistant";
    text: string;
    message_type?: "chat" | "note" | "system";
    status?: "pending" | "streaming" | "completed" | "failed";
    provider?: string | null;
    model?: string | null;
    latency_ms?: number | null;
  },
): Promise<WorkSessionMessageItem> {
  return requestJson<WorkSessionMessageItem>(`/api/work-sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 세션에 누적된 응답 맥락(롤링 요약)을 초기화한다 (2026-07-08 리뷰). */
export async function resetWorkSessionContext(sessionId: string): Promise<void> {
  await requestJson<unknown>(`/api/work-sessions/${sessionId}/context/reset`, {
    method: "POST",
  });
}

export async function runWorkSessionTurn(
  sessionId: string,
  payload: {
    text: string;
    attachment_ids?: string[];
    model_override?: string;
    reasoning_effort?: "auto" | "minimal" | "low" | "medium" | "high";
  },
): Promise<WorkSessionTurnResult> {
  return requestJson<WorkSessionTurnResult>(`/api/work-sessions/${sessionId}/turn`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  const rawData = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(rawData) };
  } catch {
    return { event, data: rawData };
  }
}

function readStreamMessage(value: unknown): string {
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }
  return "업무대화 스트리밍 처리에 실패했습니다.";
}

export async function runWorkSessionTurnStream(
  sessionId: string,
  payload: {
    text: string;
    attachment_ids?: string[];
    model_override?: string;
    reasoning_effort?: "auto" | "minimal" | "low" | "medium" | "high";
  },
  handlers: WorkSessionTurnStreamHandlers = {},
): Promise<WorkSessionTurnResult> {
  const response = await fetch(`${API_BASE_URL}/api/work-sessions/${sessionId}/turn/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("업무대화 스트리밍 응답 본문이 비어 있습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneResult: WorkSessionTurnResult | null = null;

  const dispatchBlock = (block: string) => {
    const parsed = parseSseBlock(block);
    if (!parsed) {
      return;
    }
    if (parsed.event === "user_message" && isRecord(parsed.data)) {
      handlers.onUserMessage?.(parsed.data as WorkSessionMessageItem);
      return;
    }
    if (parsed.event === "assistant_message" && isRecord(parsed.data)) {
      handlers.onAssistantMessage?.(parsed.data as WorkSessionMessageItem);
      return;
    }
    if (parsed.event === "delta" && isRecord(parsed.data)) {
      const text = typeof parsed.data.text === "string" ? parsed.data.text : "";
      if (text) {
        handlers.onDelta?.({ text });
      }
      return;
    }
    if (parsed.event === "error") {
      const error = { message: readStreamMessage(parsed.data) };
      handlers.onError?.(error);
      return;
    }
    if (parsed.event === "done" && isRecord(parsed.data)) {
      doneResult = parsed.data as WorkSessionTurnResult;
      handlers.onDone?.(doneResult);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    blocks.forEach(dispatchBlock);
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    dispatchBlock(buffer);
  }

  if (!doneResult) {
    throw new Error("업무대화 스트리밍 완료 이벤트를 받지 못했습니다.");
  }
  return doneResult;
}

export async function uploadWorkSessionAttachments(
  sessionId: string,
  files: File[],
): Promise<{ items: WorkSessionAttachmentItem[] }> {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append("files", file);
  });
  return requestJson<{ items: WorkSessionAttachmentItem[] }>(
    `/api/work-sessions/${sessionId}/attachments`,
    {
      method: "POST",
      body: formData,
    },
  );
}

export async function loadWorkSessionFileLinks(sessionId: string) {
  return requestJson<{ items: WorkSessionFileLinkItem[] }>(
    `/api/work-sessions/${sessionId}/file-links`,
  );
}

export async function createWorkSessionFileLinks(
  sessionId: string,
  payload: {
    items: Array<{
      file_path: string;
      label?: string | null;
      source?: "manual" | "anything" | "knowledge" | "attachment";
    }>;
  },
) {
  return requestJson<{ items: WorkSessionFileLinkItem[] }>(
    `/api/work-sessions/${sessionId}/file-links`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteWorkSessionFileLink(sessionId: string, linkId: string) {
  return requestJson<{ id: string; deleted: boolean }>(
    `/api/work-sessions/${sessionId}/file-links/${linkId}`,
    {
      method: "DELETE",
    },
  );
}

export async function testWorkspaceLlmConnection(
  payload?: { prompt?: string },
): Promise<WorkspaceLlmTestResult> {
  return requestJson<WorkspaceLlmTestResult>("/api/settings/llm-test", {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers,
      ...init,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "network error";
    throw new Error(`업무 엔진 연결 실패: ${detail}`);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.clone().json()) as { detail?: unknown };
      if (typeof payload.detail === "string") {
        detail = payload.detail;
      }
    } catch {
      try {
        detail = await response.clone().text();
      } catch {
        detail = "";
      }
    }
    throw new Error(
      [`${response.status} ${response.statusText}`, detail.trim()]
        .filter(Boolean)
        .join(" - "),
    );
  }

  return (await response.json()) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAllowedValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
): value is T {
  return typeof value === "string" && allowedValues.includes(value as T);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseLlmConnectionProfile(
  value: unknown,
  fallback: LlmConnectionProfile,
): LlmConnectionProfile {
  if (!isRecord(value)) {
    return { ...fallback };
  }

  return {
    provider: readNonEmptyString(value.provider) ?? fallback.provider,
    model: readNonEmptyString(value.model) ?? fallback.model,
    api_key: typeof value.api_key === "string" || value.api_key === null ? value.api_key : fallback.api_key ?? null,
    base_url:
      typeof value.base_url === "string" || value.base_url === null ? value.base_url : fallback.base_url ?? null,
    site_url:
      typeof value.site_url === "string" || value.site_url === null ? value.site_url : fallback.site_url ?? null,
    application_name:
      typeof value.application_name === "string" || value.application_name === null
        ? value.application_name
        : fallback.application_name ?? null,
  };
}

function parseWorkspaceLlmProfiles(value: unknown): WorkspaceLlmProfiles {
  const fallback = createDefaultWorkspaceLlmProfiles();
  if (!isRecord(value)) {
    return fallback;
  }

  const externalProvidersRecord = isRecord(value.external_model) && isRecord(value.external_model.providers)
    ? value.external_model.providers
    : null;
  const externalProviders: Record<string, LlmConnectionProfile> = {};

  for (const [providerKey, providerFallback] of Object.entries(fallback.external_model.providers)) {
    externalProviders[providerKey] = parseLlmConnectionProfile(
      externalProvidersRecord?.[providerKey],
      providerFallback,
    );
  }

  if (externalProvidersRecord) {
    for (const [providerKey, rawProfile] of Object.entries(externalProvidersRecord)) {
      if (!externalProviders[providerKey]) {
        externalProviders[providerKey] = parseLlmConnectionProfile(rawProfile, {
          provider: providerKey,
          model: "",
          api_key: null,
          base_url: null,
          site_url: null,
          application_name: null,
        });
      }
    }
  }

  return {
    local_first: parseLlmConnectionProfile(value.local_first, fallback.local_first),
    internal_server: parseLlmConnectionProfile(value.internal_server, fallback.internal_server),
    external_model: {
      active_provider:
        readNonEmptyString(isRecord(value.external_model) ? value.external_model.active_provider : null) ??
        fallback.external_model.active_provider,
      providers: externalProviders,
    },
  };
}

export function parseWorkspaceSettings(value: unknown): WorkspaceSettings {
  if (!isRecord(value) || !isRecord(value.defaults) || !isRecord(value.paths)) {
    throw new Error("invalid workspace settings payload");
  }

  const { defaults, paths } = value;
  const workspaceRoot = readNonEmptyString(paths.workspace_root);

  if (!workspaceRoot) {
    throw new Error("invalid workspace settings payload");
  }

  const llmProvider =
    typeof defaults.llm_provider === "string" && defaults.llm_provider.trim().length > 0
      ? defaults.llm_provider
      : "openai_compatible";
  const llmModel =
    typeof defaults.llm_model === "string" && defaults.llm_model.trim().length > 0
      ? defaults.llm_model
      : "gpt-4.1-mini";
  const llmMode = isAllowedValue(defaults.llm_mode, WORKSPACE_SETTINGS_VALUES.llm_mode)
    ? defaults.llm_mode
    : "local_first";
  const anythingLaunchMode = isAllowedValue(
    defaults.anything_launch_mode,
    WORKSPACE_SETTINGS_VALUES.anything_launch_mode,
  )
    ? defaults.anything_launch_mode
    : "external_app_preferred";
  const defaultTemplateKey = isAllowedValue(
    defaults.default_template_key,
    WORKSPACE_SETTINGS_VALUES.default_template_key,
  )
    ? defaults.default_template_key
    : "report";
  const personalizationApplyMode = isAllowedValue(
    defaults.personalization_apply_mode,
    WORKSPACE_SETTINGS_VALUES.personalization_apply_mode,
  )
    ? defaults.personalization_apply_mode
    : "approval_required";
  const embeddingProvider = isAllowedValue(
    defaults.embedding_provider,
    WORKSPACE_SETTINGS_VALUES.embedding_provider,
  )
    ? defaults.embedding_provider
    : "deterministic";
  const embeddingModel =
    typeof defaults.embedding_model === "string" && defaults.embedding_model.trim().length > 0
      ? defaults.embedding_model
      : "nomic-embed-text";
  const embeddingBaseUrl =
    typeof defaults.embedding_base_url === "string" || defaults.embedding_base_url === null
      ? defaults.embedding_base_url
      : "http://127.0.0.1:11434";
  const embeddingFallbackEnabled =
    typeof defaults.embedding_fallback_enabled === "boolean"
      ? defaults.embedding_fallback_enabled
      : true;
  const graphragVectorBackend = isAllowedValue(
    defaults.graphrag_vector_backend,
    WORKSPACE_SETTINGS_VALUES.graphrag_vector_backend,
  )
    ? defaults.graphrag_vector_backend
    : "sqlite";
  const internalApiBaseUrl =
    typeof defaults.internal_api_base_url === "string" || defaults.internal_api_base_url === null
      ? defaults.internal_api_base_url
      : null;
    const llmApiKey =
      typeof defaults.llm_api_key === "string" || defaults.llm_api_key === null ? defaults.llm_api_key : null;
  const llmSiteUrl =
      typeof defaults.llm_site_url === "string" || defaults.llm_site_url === null ? defaults.llm_site_url : null;
  const llmApplicationName =
      typeof defaults.llm_application_name === "string" || defaults.llm_application_name === null
        ? defaults.llm_application_name
        : null;
  const profiles = parseWorkspaceLlmProfiles(defaults.profiles);
  const reconstructedProfiles = cloneWorkspaceLlmProfiles(profiles);
  const activeProfile = getLlmProfileForSelection(reconstructedProfiles, llmMode, llmProvider);
  activeProfile.provider = llmProvider.trim() || activeProfile.provider;
  activeProfile.model = llmModel;
  activeProfile.api_key = llmApiKey;
  activeProfile.base_url = internalApiBaseUrl;
  activeProfile.site_url = llmSiteUrl;
  activeProfile.application_name = llmApplicationName;
  if (llmMode === "external_model") {
    reconstructedProfiles.external_model.active_provider = llmProvider.trim() || reconstructedProfiles.external_model.active_provider;
  }
    const database = readNonEmptyString(paths.database) ?? `${workspaceRoot}/gongmu.db`;
    const knowledgeRoot = readNonEmptyString(paths.knowledge_root) ?? `${workspaceRoot}/knowledge`;
    const documentsRoot = readNonEmptyString(paths.documents_root) ?? `${workspaceRoot}/documents`;
    const personalizationRoot =
      readNonEmptyString(paths.personalization_root) ?? `${workspaceRoot}/personalization`;

  return {
    defaults: {
      llm_mode: llmMode,
      llm_provider: llmProvider,
      llm_model: llmModel,
      llm_api_key: llmApiKey,
      llm_site_url: llmSiteUrl,
      llm_application_name: llmApplicationName,
      profiles: reconstructedProfiles,
      anything_launch_mode: anythingLaunchMode,
      default_template_key: defaultTemplateKey,
      internal_api_base_url: internalApiBaseUrl,
      personalization_apply_mode: personalizationApplyMode,
      embedding_provider: embeddingProvider,
      embedding_model: embeddingModel,
      embedding_base_url: embeddingBaseUrl,
      embedding_fallback_enabled: embeddingFallbackEnabled,
      graphrag_vector_backend: graphragVectorBackend,
    },
    paths: {
      workspace_root: workspaceRoot,
      database,
      knowledge_root: knowledgeRoot,
      documents_root: documentsRoot,
      personalization_root: personalizationRoot,
    },
  };
}

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  let snapshot = await loadWorkspaceShellSnapshot();
  for (const group of ["knowledge", "logs"] as const) {
    snapshot = mergeWorkspaceSnapshot(snapshot, await loadWorkspaceDeferredSnapshot(group));
  }
  return snapshot;
}

export type WorkspaceShellSnapshotOptions = {
  /**
   * false면 설정/템플릿처럼 변경이 드문 데이터는 요청하지 않는다.
   * (D-03: 30초 유휴 하트비트는 동적 데이터만 갱신)
   */
  includeConfig?: boolean;
};

export async function loadWorkspaceShellSnapshot(
  options: WorkspaceShellSnapshotOptions = {},
): Promise<WorkspaceSnapshot> {
  const includeConfig = options.includeConfig ?? true;
  const [
    health,
    runtimeReady,
    runtimeMetrics,
    schedules,
    workSessions,
    approvalTickets,
    workJobs,
  ] = await Promise.allSettled([
    requestJson<WorkspaceHealth>("/health"),
    requestJson<RuntimeReady>("/ready"),
    requestJson<RuntimeMetrics>("/api/runtime/metrics"),
    requestJson<{ items: ScheduleItem[] }>("/api/schedules"),
    requestJson<{ items: WorkSessionItem[] }>("/api/work-sessions"),
    requestJson<{ items: ApprovalTicketItem[] }>("/api/approval-tickets"),
    requestJson<{ items: WorkJobItem[] }>("/api/jobs?limit=20"),
  ]);

  const [settings, templates] = includeConfig
    ? await Promise.allSettled([
        requestJson<unknown>("/api/settings"),
        requestJson<{ items: TemplateItem[] }>("/api/templates"),
      ])
    : [null, null];

  return mergeWorkspaceSnapshot(createEmptyWorkspaceSnapshot(), {
    health: health.status === "fulfilled" ? health.value : null,
    runtimeReady: runtimeReady.status === "fulfilled" ? runtimeReady.value : null,
    runtimeMetrics: runtimeMetrics.status === "fulfilled" ? runtimeMetrics.value : null,
    settings:
      settings && settings.status === "fulfilled" ? parseWorkspaceSettings(settings.value) : null,
    schedules: schedules.status === "fulfilled" ? schedules.value.items : [],
    workSessions: workSessions.status === "fulfilled" ? workSessions.value.items : [],
    templates:
      templates && templates.status === "fulfilled"
        ? (templates.value as { items: TemplateItem[] }).items
        : [],
    approvalTickets: approvalTickets.status === "fulfilled" ? approvalTickets.value.items : [],
    workJobs: workJobs.status === "fulfilled" ? workJobs.value.items : [],
  });
}

/**
 * D-03: 활성 작업 폴링 전용 경량 요청.
 * /api/jobs?limit=20 하나만 조회해 workJobs 패치만 돌려준다.
 */
export async function loadWorkJobsOnly(): Promise<WorkspaceSnapshotPatch> {
  const response = await requestJson<{ items: WorkJobItem[] }>("/api/jobs?limit=20");
  return { workJobs: response.items };
}

export async function loadWorkspaceDeferredSnapshot(
  group: WorkspaceDeferredGroup,
): Promise<WorkspaceSnapshotPatch> {
  if (group === "knowledge") {
    const [
      knowledgeCandidates,
      knowledgePages,
      knowledgeSources,
      knowledgeSourceFiles,
      knowledgeIngestionJobs,
      knowledgeDocuments,
      personalizationCandidates,
    ] = await Promise.allSettled([
      requestJson<{ items: KnowledgeCandidateItem[] }>("/api/knowledge/candidates"),
      requestJson<{ items: KnowledgePageItem[] }>("/api/knowledge/pages"),
      requestJson<{ items: KnowledgeSourceItem[] }>("/api/knowledge/sources"),
      requestJson<{ items: KnowledgeSourceFileItem[] }>("/api/knowledge/source-files"),
      requestJson<{ items: KnowledgeIngestionJobItem[] }>("/api/knowledge/ingestion-jobs"),
      requestJson<{ items: KnowledgeDocumentItem[] }>("/api/knowledge/documents"),
      requestJson<{ items: PersonalizationCandidateItem[] }>("/api/personalization/candidates"),
    ]);
    return {
      knowledgeCandidates:
        knowledgeCandidates.status === "fulfilled" ? knowledgeCandidates.value.items : [],
      knowledgePages: knowledgePages.status === "fulfilled" ? knowledgePages.value.items : [],
      knowledgeSources: knowledgeSources.status === "fulfilled" ? knowledgeSources.value.items : [],
      knowledgeSourceFiles:
        knowledgeSourceFiles.status === "fulfilled" ? knowledgeSourceFiles.value.items : [],
      knowledgeIngestionJobs:
        knowledgeIngestionJobs.status === "fulfilled" ? knowledgeIngestionJobs.value.items : [],
      knowledgeDocuments:
        knowledgeDocuments.status === "fulfilled" ? knowledgeDocuments.value.items : [],
      personalizationCandidates:
        personalizationCandidates.status === "fulfilled" ? personalizationCandidates.value.items : [],
    };
  }

  const [logs] = await Promise.allSettled([
    requestJson<{ items: ExecutionLogItem[] }>("/api/execution-logs"),
  ]);
  return {
    logs: logs.status === "fulfilled" ? logs.value.items : [],
  };
}

export async function createSchedule(payload: {
  title: string;
  starts_at: string;
  ends_at: string;
  view: "month" | "week" | "day";
  remind_before_minutes?: number | null;
}) {
  return requestJson<ScheduleItem>("/api/schedules", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateSchedule(
  scheduleId: string,
  payload: {
    title: string;
    starts_at: string;
    ends_at: string;
    view: "month" | "week" | "day";
    remind_before_minutes?: number | null;
  },
) {
  return requestJson<ScheduleItem>(`/api/schedules/${scheduleId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteSchedule(scheduleId: string) {
  return requestJson<{ id: string; deleted: boolean; schedule: ScheduleItem }>(`/api/schedules/${scheduleId}`, {
    method: "DELETE",
  });
}

// F-20: 사전 알림 창에 들어온 미확인 일정 목록 (30초 폴링용)
export async function fetchDueScheduleReminders() {
  return requestJson<{ items: ScheduleItem[]; now: string }>("/api/schedules/reminders/due");
}

// F-20: 알림 확인 처리 — 배너에서 목록 제거
export async function ackScheduleReminder(scheduleId: string) {
  return requestJson<ScheduleItem>(`/api/schedules/${scheduleId}/reminders/ack`, {
    method: "POST",
  });
}

export async function createWorkSession(payload: {
  title: string;
  schedule_id?: string | null;
}) {
  return requestJson<WorkSessionItem>("/api/work-sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateWorkspaceSettings(payload: WorkspaceSettingsUpdatePayload) {
  const response = await requestJson<unknown>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return parseWorkspaceSettings(response);
}

export async function updateWorkSession(
  sessionId: string,
  payload: {
    schedule_id?: string | null;
  },
) {
  return requestJson<WorkSessionItem>(`/api/work-sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function createKnowledgeCandidate(payload: {
  title: string;
  body: string;
  candidate_type: "topic" | "project" | "issue" | "entity";
}) {
  return requestJson<KnowledgeCandidateItem>("/api/knowledge/candidates/from-note", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function approveKnowledgeCandidate(candidateId: string, payload: { page_type: string }) {
  return requestJson<{ page: KnowledgePageItem }>(`/api/knowledge/candidates/${candidateId}/approve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createKnowledgeSource(payload: { label: string; root_path: string }) {
  return requestJson<KnowledgeSourceItem>("/api/knowledge/sources", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function scanKnowledgeSource(sourceId: string) {
  return requestJson<KnowledgeSourceScanResult>(`/api/knowledge/sources/${sourceId}/scan`, {
    method: "POST",
  });
}

/** W7 P3 §9: 앱 시작 diff 전용 경량 소스 목록 조회(스냅샷 전체를 다시 받지 않는다). */
export async function fetchKnowledgeSources() {
  return requestJson<{ items: KnowledgeSourceItem[] }>("/api/knowledge/sources");
}

/** 증분 색인 "변경 확인" — 색인을 실행하지 않고 변경 견적(diff)만 조회한다. */
export async function diffKnowledgeSource(sourceId: string) {
  return requestJson<KnowledgeSourceDiffResult>(`/api/knowledge/sources/${sourceId}/diff`);
}

export async function ingestKnowledgeSource(sourceId: string, runNow = true, background = false) {
  return requestJson<{ job: KnowledgeIngestionJobItem; work_job?: WorkJobItem }>("/api/knowledge/ingest", {
    method: "POST",
    body: JSON.stringify({ source_id: sourceId, run_now: runNow, background }),
  });
}

export async function reindexKnowledgeSource(sourceId: string, runNow = true, background = false) {
  return requestJson<{ job: KnowledgeIngestionJobItem; work_job?: WorkJobItem }>("/api/knowledge/reindex", {
    method: "POST",
    body: JSON.stringify({ source_id: sourceId, run_now: runNow, background }),
  });
}

export async function analyzeWorkSessionPersonalization(sessionId: string) {
  return requestJson<PersonalizationDecisionResult>(
    `/api/personalization/work-sessions/${sessionId}/analyze`,
    {
      method: "POST",
    },
  );
}

export async function decidePersonalizationCandidate(
  candidateId: string,
  status: "approved" | "rejected",
) {
  return requestJson<PersonalizationDecisionResult>(
    `/api/personalization/candidates/${candidateId}/decide`,
    {
      method: "POST",
      body: JSON.stringify({ status }),
    },
  );
}

export async function searchKnowledge(query: string) {
  return requestJson<KnowledgeSearchResult>(
    `/api/knowledge/search?query=${encodeURIComponent(query)}`,
  );
}

export async function searchLocalFiles(query: string) {
  return requestJson<LocalFileSearchResult>(
    `/api/files/search?query=${encodeURIComponent(query)}&limit=20`,
  );
}

export async function rebuildLocalFileIndex() {
  return requestJson<LocalFileIndexRebuildResult & { work_job?: WorkJobItem }>("/api/files/index/rebuild", {
    method: "POST",
  });
}

export async function cancelWorkJob(jobId: string) {
  return requestJson<WorkJobItem>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  });
}

export async function loadWorkJobEvents(jobId: string, limit = 30) {
  return requestJson<{ items: WorkJobEventItem[] }>(
    `/api/jobs/${encodeURIComponent(jobId)}/events?limit=${limit}`,
  );
}

export async function loadKnowledgeIngestionJobs() {
  return requestJson<{ items: KnowledgeIngestionJobItem[] }>("/api/knowledge/ingestion-jobs");
}

export async function runKnowledgeIngestionJob(jobId: string) {
  return requestJson<{ job: KnowledgeIngestionJobItem }>(
    `/api/knowledge/ingestion-jobs/${encodeURIComponent(jobId)}/run`,
    {
      method: "POST",
    },
  );
}

export async function cancelKnowledgeIngestionJob(jobId: string) {
  return requestJson<{ job: KnowledgeIngestionJobItem }>(
    `/api/knowledge/ingestion-jobs/${encodeURIComponent(jobId)}/cancel`,
    {
      method: "POST",
    },
  );
}

export async function loadKnowledgeIngestionJobLog(jobId: string, limit = 120) {
  return requestJson<KnowledgeIngestionLogDump>(
    `/api/knowledge/ingestion-jobs/${encodeURIComponent(jobId)}/log?limit=${limit}`,
  );
}

export async function loadKnowledgeGraph() {
  return requestJson<KnowledgeGraphSummary>("/api/knowledge/graph");
}

export async function queryKnowledgeGraph(query: string, limit = 20) {
  return requestJson<KnowledgeGraphQueryResult>(
    `/api/knowledge/graph/query?query=${encodeURIComponent(query)}&limit=${limit}`,
  );
}

export async function loadKnowledgeDocumentStructure(documentId: string) {
  return requestJson<KnowledgeDocumentStructure>(
    `/api/knowledge/document-structure?document_id=${encodeURIComponent(documentId)}`,
  );
}

export async function loadKnowledgeTables(documentId?: string) {
  const suffix = documentId ? `?document_id=${encodeURIComponent(documentId)}` : "";
  return requestJson<{ items: KnowledgeTableBlock[] }>(`/api/knowledge/tables${suffix}`);
}

export async function loadKnowledgeBackendStatus() {
  return requestJson<KnowledgeBackendStatus>("/api/knowledge/backend-status");
}

export async function loadKnowledgeParserStatus() {
  return requestJson<KnowledgeParserStatus>("/api/knowledge/parser-status");
}

export async function askKnowledge(
  query: string,
  payload?: {
    session_id?: string | null;
    limit?: number;
  },
) {
  return requestJson<KnowledgeAskResult>("/api/knowledge/ask", {
    method: "POST",
    body: JSON.stringify({
      query,
      session_id: payload?.session_id ?? null,
      limit: payload?.limit ?? 5,
    }),
  });
}

export async function loadTools() {
  return requestJson<{ items: ToolManifestItem[] }>("/api/tools");
}

export async function createContentBase(payload: {
  title: string;
  purpose: string;
  template_key: "report" | "meeting" | "review";
  source_session_id?: string | null;
  outline?: string;
  document_format?: DocumentFormat;
  audience_type?: string;
  expected_length?: string;
  urgency_level?: string;
  needs_traceability?: string;
  requires_official_form?: string;
  requested_action?: string;
  deadline?: string;
  security_level?: string;
  direct_file_paths?: string[];
  user_template_path?: string | null;
}) {
  return requestJson<ContentBaseResult>("/api/documents/content-bases", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateDocument(payload: {
  title: string;
  purpose: string;
  template_key: "report" | "meeting" | "review";
  source_session_id?: string | null;
  outline?: string;
  document_format?: DocumentFormat;
  audience_type?: string;
  expected_length?: string;
  urgency_level?: string;
  needs_traceability?: string;
  requires_official_form?: string;
  requested_action?: string;
  deadline?: string;
  security_level?: string;
  direct_file_paths?: string[];
  user_template_path?: string | null;
  output_name?: string;
}) {
  return requestJson<{
    content_base: ContentBaseResult;
    finalize: FinalDocumentRequestResult;
    artifact: { path: string; markdown_path?: string; format?: string };
    work_job?: WorkJobItem;
  }>("/api/documents/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function loadCustomDocumentTemplates() {
  return requestJson<{ items: CustomDocumentTemplateItem[] }>("/api/documents/templates/custom");
}

export async function uploadDocumentTemplate(file: File) {
  const body = new FormData();
  body.append("file", file);
  return requestJson<{ item: CustomDocumentTemplateItem }>("/api/documents/templates/custom", {
    method: "POST",
    body,
  });
}

export async function uploadDocumentAttachments(files: File[]) {
  const body = new FormData();
  files.forEach((file) => {
    body.append("files", file);
  });
  return requestJson<{ items: DocumentAttachmentItem[] }>("/api/documents/attachments", {
    method: "POST",
    body,
  });
}

export async function requestDocumentFinalize(payload: {
  content_base_id: string;
  output_name: string;
}) {
  return requestJson<FinalDocumentRequestResult>("/api/documents/finalize", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function applyDocumentFinalize(ticketId: string) {
  return requestJson<FinalDocumentApplyResult>(`/api/documents/finalize/${ticketId}/apply`, {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// 문서작성(authoring) — 2단계(내용 정리 → 양식 맞춤) 구조 생성 API
// ---------------------------------------------------------------------------

export type AuthoringFormatItem = {
  key: string;
  aliases?: string[];
  label: string;
  description: string;
  icon?: string;
  schema_fields?: string[];
};

export type AuthoringStageEvent = {
  stage: "organize" | "format" | string;
  status: "start" | "done" | string;
  elapsed_ms?: number;
  attempts?: number;
  repaired?: boolean;
};

export type AuthoringStructureMeta = {
  attempts?: number;
  repaired?: boolean;
  hints?: string[];
};

export type AuthoringStructureResult = {
  format: string;
  structure: Record<string, unknown>;
  preview: string;
  organized_markdown?: string;
  meta?: AuthoringStructureMeta;
  stages?: AuthoringStageEvent[];
};

export type AuthoringStructurePayload = {
  format: string;
  instruction?: string;
  session_id?: string | null;
  reference_texts?: string[];
  transcript?: Array<{ role: string; text: string }>;
};

export type AuthoringStreamHandlers = {
  onStage?: (event: AuthoringStageEvent) => void;
  onDone?: (result: AuthoringStructureResult) => void;
  onError?: (error: { message: string }) => void;
};

export type AuthoringBuildResult = {
  format: string;
  content_base: {
    id: string;
    title: string;
    document_format?: string;
    artifact_path: string;
    preview_path?: string;
  };
  content_markdown: string;
  preview: string;
  finalize: {
    method: string;
    endpoint: string;
    body: { content_base_id: string; output_name: string };
    note: string;
  };
};

export class AuthoringBuildValidationError extends Error {
  hints: string[];

  constructor(message: string, hints: string[]) {
    super(message);
    this.name = "AuthoringBuildValidationError";
    this.hints = hints;
  }
}

export async function fetchAuthoringFormats() {
  return requestJson<{ items: AuthoringFormatItem[] }>("/api/documents/authoring/formats");
}

export async function runAuthoringStructure(
  payload: AuthoringStructurePayload,
  handlers: AuthoringStreamHandlers = {},
  signal?: AbortSignal,
): Promise<AuthoringStructureResult> {
  const response = await fetch(`${API_BASE_URL}/api/documents/authoring/structure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("문서 구조 생성 스트리밍 응답 본문이 비어 있습니다.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneResult: AuthoringStructureResult | null = null;
  let streamError: { message: string } | null = null;

  const dispatchBlock = (block: string) => {
    const parsed = parseSseBlock(block);
    if (!parsed) {
      return;
    }
    if (parsed.event === "stage" && isRecord(parsed.data)) {
      handlers.onStage?.(parsed.data as AuthoringStageEvent);
      return;
    }
    if (parsed.event === "error") {
      streamError = {
        message: isRecord(parsed.data) && typeof parsed.data.message === "string"
          ? parsed.data.message
          : "문서 구조 생성에 실패했습니다.",
      };
      handlers.onError?.(streamError);
      return;
    }
    if (parsed.event === "done" && isRecord(parsed.data)) {
      doneResult = parsed.data as AuthoringStructureResult;
      handlers.onDone?.(doneResult);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    blocks.forEach(dispatchBlock);
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    dispatchBlock(buffer);
  }

  const finalStreamError = streamError as { message: string } | null;
  if (finalStreamError) {
    throw new Error(finalStreamError.message);
  }
  if (!doneResult) {
    throw new Error("문서 구조 생성 완료 이벤트를 받지 못했습니다.");
  }
  return doneResult;
}

export async function runAuthoringStructureSync(
  payload: AuthoringStructurePayload,
): Promise<AuthoringStructureResult> {
  return requestJson<AuthoringStructureResult>("/api/documents/authoring/structure", {
    method: "POST",
    body: JSON.stringify({ ...payload, stream: false }),
  });
}

export async function buildAuthoringDocument(payload: {
  format: string;
  structure: Record<string, unknown>;
  title?: string;
}): Promise<AuthoringBuildResult> {
  const response = await fetch(`${API_BASE_URL}/api/documents/authoring/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (response.status === 400) {
    let message = "구조 JSON이 양식 스키마에 맞지 않습니다.";
    let hints: string[] = [];
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (isRecord(body.detail)) {
        if (typeof body.detail.message === "string") {
          message = body.detail.message;
        }
        if (Array.isArray(body.detail.hints)) {
          hints = body.detail.hints.filter((hint): hint is string => typeof hint === "string");
        }
      } else if (typeof body.detail === "string") {
        message = body.detail;
      }
    } catch {
      // 본문 파싱 실패 시 기본 메시지 유지
    }
    throw new AuthoringBuildValidationError(message, hints);
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as AuthoringBuildResult;
}

// ---------------------------------------------------------------------------
// 임의형식(custom) — 사용자 HWPX/HWTX 양식 감지·값 제안·채우기·본문 반영
// ---------------------------------------------------------------------------

export type CustomTemplateDetectResult = {
  mode: "form" | "document";
  fields: Array<{ label: string; current: string }>;
  confidence?: number;
  total_fields?: number;
};

export type CustomFillSuggestResult = {
  values: Record<string, string>;
  matched_count: number;
  total_fields: number;
};

export type CustomFillApplyResult = {
  artifact: { path: string; format?: string };
  filled_count: number;
  requested_count?: number;
  unmatched?: string[];
  note?: string;
};

export type CustomPatchResult = {
  artifact: { path: string; format?: string };
  applied_changes: number;
  replaced_blocks?: number;
  organized_markdown?: string;
  note?: string;
};

export async function uploadAuthoringCustomTemplate(file: File) {
  const body = new FormData();
  body.append("file", file);
  return requestJson<{ item: CustomDocumentTemplateItem }>(
    "/api/documents/authoring/custom-template",
    { method: "POST", body },
  );
}

export async function detectAuthoringCustomTemplate(payload: { template_path: string }) {
  return requestJson<CustomTemplateDetectResult>("/api/documents/authoring/custom-detect", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function suggestAuthoringCustomFill(payload: {
  template_path?: string;
  fields: string[];
  instruction?: string;
  session_id?: string | null;
  reference_texts?: string[];
}) {
  return requestJson<CustomFillSuggestResult>("/api/documents/authoring/custom-fill-suggest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function applyAuthoringCustomFill(payload: {
  template_path: string;
  values: Record<string, string>;
  output_name?: string;
}) {
  return requestJson<CustomFillApplyResult>("/api/documents/authoring/custom-fill-apply", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function patchAuthoringCustomTemplate(payload: {
  template_path: string;
  instruction?: string;
  session_id?: string | null;
  reference_texts?: string[];
  output_name?: string;
}) {
  return requestJson<CustomPatchResult>("/api/documents/authoring/custom-patch", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type AuthoringReviseResult = {
  format: string;
  structure: Record<string, unknown>;
  preview: string;
  meta?: { attempts?: number; repaired?: boolean; hints?: string[] };
};

// F-08: 현재 구조 + 자연어 수정 지시 → 스키마 검증된 새 구조
export async function runAuthoringRevise(payload: {
  format: string;
  structure: Record<string, unknown>;
  instruction: string;
}): Promise<AuthoringReviseResult> {
  return requestJson<AuthoringReviseResult>("/api/documents/authoring/revise", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// 지식폴더 위키
// ---------------------------------------------------------------------------

export type WikiIndexResult = {
  path: string;
  content: string;
};

export type WikiPageResult = {
  path: string;
  relative_path: string;
  content: string;
};

export type WikiTreeTopicItem = {
  slug: string;
  title: string;
  doc_count: number;
  path: string;
};

export type WikiTreeWorkItem = {
  slug: string;
  title: string;
  session_id?: string | null;
  updated_at?: string | null;
  path: string;
};

export type WikiTreeSourceDocItem = {
  slug: string;
  title: string;
  path: string;
  quality_score?: number | null;
  /**
   * W7 §5.6: 동일 내용(file_hash) 사본 수 — 대표 1건만 트리에 노출되고
   * 2 이상이면 "사본 N개" 배지로 접힘 표시한다(구버전 서버 응답에는 없음).
   */
  duplicate_count?: number;
  /** W7 §5.5: 소프트 삭제 상태 — 'missing'이면 원본이 삭제/이동된 카드다(구버전 서버 응답에는 없음). */
  status?: "active" | "missing" | string;
};

export type WikiTreeSourceItem = {
  source_id: string;
  label: string;
  docs: WikiTreeSourceDocItem[];
};

/** T-01: 확정 분류체계 적용 후 생성되는 업무 허브(work-areas/<slug>.md) 항목 */
export type WikiTreeWorkAreaItem = {
  slug: string;
  title: string;
  doc_count: number;
  path: string;
};

export type WikiTreeResult = {
  topics: WikiTreeTopicItem[];
  works: WikiTreeWorkItem[];
  /** T-01: 업무 허브 목록 — 구버전 서버 응답에는 없을 수 있다. */
  work_areas?: WikiTreeWorkAreaItem[];
  sources: WikiTreeSourceItem[];
  counts: {
    docs: number;
    topics: number;
    works: number;
    /** T-01: 업무 허브 수 — 구버전 서버 응답에는 없을 수 있다. */
    work_areas?: number;
  };
};

export async function fetchWikiTree() {
  return requestJson<WikiTreeResult>("/api/knowledge/wiki/tree");
}

/**
 * W7 §5.5/§5.6: doc_uid로 지식카드 상태를 조회한 결과.
 * 인용 칩 [원본 열기]에서 원본이 사라졌을 때 카드 폴백 여부를 판단하는 데 쓴다.
 */
export type KnowledgeCardByUidResult = {
  /** 지식카드 마크다운 파일의 절대 경로. */
  card_path: string;
  /** 카드 파일이 실제로 존재하는지 여부. */
  exists: boolean;
  /** 원본 문서 상태 — 'missing'이면 원본이 삭제/이동됨(소프트 삭제 보관 중). */
  status: "active" | "missing" | string;
  title: string;
};

/** W7 §5.5/§5.6: 인용의 doc_uid로 지식카드를 조회한다(원본 부재 시 폴백 경로). */
export async function fetchKnowledgeCardByUid(docUid: string) {
  return requestJson<KnowledgeCardByUidResult>(
    `/api/knowledge/cards/by-uid/${encodeURIComponent(docUid)}`,
  );
}

export async function fetchWikiIndex() {
  return requestJson<WikiIndexResult>("/api/knowledge/wiki/index");
}

export async function fetchWikiPage(path: string) {
  return requestJson<WikiPageResult>(
    `/api/knowledge/wiki/page?path=${encodeURIComponent(path)}`,
  );
}

/** 주제 상세화면 재분류·삭제 응답(위키 UX 2026-07-12) — 재태깅된 문서 수 포함. */
export type WikiTopicActionResult = {
  ok: boolean;
  retagged_docs: number;
};

/** 주제를 대상 어휘집 주제로 병합한다 — synonym 편입 + 문서 재태깅 + 구 페이지 삭제. */
export async function mergeWikiTopic(payload: { topic: string; into_topic_id: string }) {
  return requestJson<WikiTopicActionResult>("/api/knowledge/wiki/topics/merge", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 주제를 삭제(차단)한다 — 문서에서 제거 + 페이지 삭제 + 향후 태깅/후보에서 제외. */
export async function deleteWikiTopic(payload: { topic: string }) {
  return requestJson<WikiTopicActionResult>("/api/knowledge/wiki/topics/delete", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// T-01: Work-Aware 지식 분류체계 (인터뷰 → 초안 → 확정 → 적용 → 큐/품질)
// ---------------------------------------------------------------------------

export type TaxonomyInterview = {
  org_type: string;
  department: string;
  duty: string;
  purpose: string;
  updated_at?: string;
};

/** 초안(proposal)의 업무 후보 — Folder Recon + 어휘집 매칭 결과 */
export type TaxonomyWorkAreaProposal = {
  name: string;
  slug: string;
  folders: string[];
  doc_count: number;
  source: "folder" | "vocab" | string;
  confidence: "high" | "medium" | "low" | string;
};

export type TaxonomyReferenceShelf = {
  folder: string;
  doc_count: number;
};

export type TaxonomyFamilyMember = {
  slug?: string | null;
  path?: string | null;
  relative_path?: string | null;
  mtime?: string | null;
  version_signals?: Record<string, unknown>;
};

/** 문서 가족(같은 문서의 버전 묶음) 감지 결과 */
export type TaxonomyFamily = {
  family_id: string;
  title: string;
  folder?: string;
  members: TaxonomyFamilyMember[];
  latest_slug?: string | null;
  latest_path?: string | null;
  official_slug?: string | null;
  unclear_latest: boolean;
};

export type TaxonomyGovernanceDoc = {
  path?: string | null;
  relative_path: string;
  kind: string;
};

export type TaxonomyProposalResult = {
  source_id: string;
  source_label?: string | null;
  generated_at?: string;
  work_areas: TaxonomyWorkAreaProposal[];
  reference_shelves: TaxonomyReferenceShelf[];
  doc_role_stats: Record<string, number>;
  families: TaxonomyFamily[];
  governance_docs: TaxonomyGovernanceDoc[];
  conventions?: Record<string, boolean>;
  interview?: TaxonomyInterview | null;
  hints: string[];
  llm_suggestions?: Record<string, unknown> | null;
  /** W7: 스캔된(비삭제) 파일 수 — 구버전 서버 응답에는 없을 수 있다. */
  scanned_file_count?: number;
  /** W7: 스캔된 파일이 0건이라 분석 결과가 비어 있으면 true — 마법사가 스캔을 자동 연쇄한다. */
  needs_scan?: boolean;
};

/** 확정 요청의 업무 정의(이름+폴더 매핑+키워드) */
export type TaxonomyWorkAreaInput = {
  name: string;
  folders: string[];
  keywords: string[];
};

export type ConfirmedTaxonomyArea = {
  name: string;
  slug: string;
  folders: string[];
  keywords: string[];
};

export type ConfirmedTaxonomy = {
  source_id: string;
  work_areas: ConfirmedTaxonomyArea[];
  doc_roles_enabled: string[];
  family_policy: string;
  confirmed_at: string;
};

export type TaxonomyConfirmResult = {
  configured: boolean;
  source_id: string;
  taxonomy: ConfirmedTaxonomy;
  schema_path: string;
};

/**
 * W7 P3 §5.9: 분류체계 드리프트 감지 결과 — 자동 재구성은 하지 않고
 * "분류체계 재정비 제안" 배지의 근거로만 쓴다(참고서고 폴더는 서버가 이미 제외).
 */
export type TaxonomyDriftInfo = {
  /** 확정 체계에 없는 새 1단계 업무 폴더 후보 (서버 형태: {folder, file_count}). */
  new_folders: Array<{ folder: string; file_count?: number }>;
  /** 확정 체계에 있으나 파일이 0건이 된 폴더. */
  vanished_folders: string[];
  /** 최근 색인분 low 확신 유입률(0~1). */
  low_ratio?: number;
  detected_at?: string;
};

export type TaxonomyStatusResult = {
  configured: boolean;
  items: Array<{
    source_id: string;
    taxonomy: ConfirmedTaxonomy;
    schema_path?: string | null;
    confirmed_at?: string | null;
    /** §5.9: 드리프트 감지 결과 — 서버는 소스별 items 항목에 싣는다(미감지/구버전엔 없음). */
    drift?: TaxonomyDriftInfo | null;
  }>;
  interview?: TaxonomyInterview | null;
};

export type TaxonomyApplyResult = {
  work_job: WorkJobItem;
  /** background=false 동기 실행일 때만 채워진다. */
  quality?: TaxonomyQualityItem | null;
};

export type TaxonomyQualityItem = {
  source_id: string;
  conflicts: number;
  duplicates: number;
  unclear_latest: number;
  queue_count: number;
  generated_at?: string | null;
};

export type TaxonomyQualityResult = {
  configured: boolean;
  items: TaxonomyQualityItem[];
};

export type TaxonomyQueueCandidates = {
  work_areas?: Array<{ work_area_slug: string; name: string; signal?: string }>;
  doc_roles?: string[];
};

export type TaxonomyQueueItem = {
  id: string;
  source_id: string;
  wiki_doc_id?: string;
  doc_slug?: string;
  title: string;
  source_path: string;
  reason: "conflict" | "no_signal" | string;
  status: "pending" | "resolved" | string;
  candidates?: TaxonomyQueueCandidates;
  resolved_work_area_slug?: string | null;
  resolved_doc_role?: string | null;
  created_at?: string;
  resolved_at?: string | null;
};

export async function fetchTaxonomyInterview() {
  return requestJson<{ interview: TaxonomyInterview | null }>("/api/knowledge/taxonomy/interview");
}

export async function saveTaxonomyInterview(payload: {
  org_type: string;
  department: string;
  duty: string;
  purpose: string;
}) {
  return requestJson<{ interview: TaxonomyInterview | null }>("/api/knowledge/taxonomy/interview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchTaxonomyProposal(sourceId: string, options?: { llmRefine?: boolean }) {
  const params = new URLSearchParams({
    source_id: sourceId,
    llm_refine: String(options?.llmRefine ?? false),
  });
  return requestJson<TaxonomyProposalResult>(`/api/knowledge/taxonomy/proposal?${params.toString()}`);
}

export async function confirmTaxonomy(payload: {
  source_id: string;
  work_areas: TaxonomyWorkAreaInput[];
  doc_roles_enabled: string[];
  family_policy?: string;
}) {
  return requestJson<TaxonomyConfirmResult>("/api/knowledge/taxonomy", {
    method: "POST",
    body: JSON.stringify({
      source_id: payload.source_id,
      work_areas: payload.work_areas,
      doc_roles_enabled: payload.doc_roles_enabled,
      family_policy: payload.family_policy ?? "latest_representative",
    }),
  });
}

export async function fetchTaxonomyStatus(sourceId?: string) {
  const suffix = sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : "";
  return requestJson<TaxonomyStatusResult>(`/api/knowledge/taxonomy${suffix}`);
}

export async function applyTaxonomy(payload: { source_id: string; background?: boolean }) {
  return requestJson<TaxonomyApplyResult>("/api/knowledge/taxonomy/apply", {
    method: "POST",
    body: JSON.stringify({
      source_id: payload.source_id,
      background: payload.background ?? true,
    }),
  });
}

export async function fetchTaxonomyQuality(sourceId?: string) {
  const suffix = sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : "";
  return requestJson<TaxonomyQualityResult>(`/api/knowledge/taxonomy/quality${suffix}`);
}

export async function fetchTaxonomyQueue(options?: { sourceId?: string; status?: string }) {
  const params = new URLSearchParams({ status: options?.status ?? "pending" });
  if (options?.sourceId) {
    params.set("source_id", options.sourceId);
  }
  return requestJson<{ items: TaxonomyQueueItem[] }>(`/api/knowledge/taxonomy/queue?${params.toString()}`);
}

export async function resolveTaxonomyQueueItem(
  itemId: string,
  payload: { work_area_slug?: string; doc_role?: string },
) {
  return requestJson<{ item: TaxonomyQueueItem }>(
    `/api/knowledge/taxonomy/queue/${encodeURIComponent(itemId)}/resolve`,
    {
      method: "POST",
      body: JSON.stringify({
        work_area_slug: payload.work_area_slug ?? "",
        doc_role: payload.doc_role ?? "",
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// 주제 어휘집 팩(Topic Vocabulary Pack) — 규격서 2026-07-12 §5(기관팩)·§6(후보 큐)
// ---------------------------------------------------------------------------

/** §5: 현재 적용 중인 L2 기관팩 요약(이름·버전·주제 수). 미적용이면 null. */
export type KnowledgeVocabInstitutionPack = {
  name: string;
  version: string;
  topics: number;
};

/** §5: 결합 어휘집의 주제 한 건 — 후보 병합 대상 선택 셀렉트에 쓴다. */
export type KnowledgeVocabTopicItem = {
  id: string;
  name: string;
  layer: "common" | "institution" | "user" | string;
  synonyms_count: number;
  enabled: boolean;
};

/** GET /api/knowledge/vocab 응답 — 층별 요약 + 결합 주제 목록. */
export type KnowledgeVocabSummary = {
  layers: {
    common: number;
    institution: KnowledgeVocabInstitutionPack | null;
    user: number;
  };
  topics: KnowledgeVocabTopicItem[];
};

/** POST /api/knowledge/vocab/pack 본문 — 파일 경로 또는 팩 객체 직접 전달. */
export type KnowledgeVocabPackImportPayload =
  | { path: string }
  | { content: Record<string, unknown> };

/**
 * POST /api/knowledge/vocab/pack 응답. 검증 오류 시 저장하지 않고
 * 오류 목록 전체를 반환한다(부분 임포트 금지 — 규격 §5).
 */
export type KnowledgeVocabPackImportResult = {
  ok: boolean;
  imported?: KnowledgeVocabInstitutionPack | null;
  errors: string[];
  warnings: string[];
};

/** §6: 후보 큐 한 건 — 보강 중 LLM `NEW:` 제안이 쌓인다. */
export type KnowledgeVocabCandidateItem = {
  id: string;
  name: string;
  norm_key?: string;
  hit_count: number;
  /** 표본 문서(최대 5) — 서버 직렬화 형태(문자열/객체)를 모두 허용한다. */
  sample_docs?: Array<string | { title?: string | null; file_path?: string | null }>;
  status: "pending" | "approved" | "rejected" | "merged" | string;
  merged_into_id?: string | null;
  first_seen_at?: string;
  decided_at?: string | null;
  /**
   * §6 확장(자동 선별) 추천 — merge(표기 변형)·reject(일회성 잡음)는 일괄 적용 대상,
   * review는 사람 검토. 구버전 서버 응답에는 없다(없으면 review로 취급).
   */
  recommended_action?: "merge" | "reject" | "review" | string;
  /** 추천이 merge일 때 병합 대상 주제 id. */
  recommended_target_id?: string | null;
};

/** POST /api/knowledge/vocab/candidates/{id}/decision 본문 — 규격 §6. */
export type KnowledgeVocabCandidateDecisionPayload = {
  action: "approve" | "reject" | "merge";
  merge_into_id?: string;
  name_override?: string;
  synonyms?: string[];
};

/** 현재 어휘집 요약(적용 팩·층별 주제 수·결합 주제 목록)을 조회한다. */
export async function fetchVocabSummary() {
  return requestJson<KnowledgeVocabSummary>("/api/knowledge/vocab");
}

/** L2 기관팩을 임포트한다 — 검증 실패 시 ok:false + errors 전체 목록(부분 임포트 없음). */
export async function importVocabPack(payload: KnowledgeVocabPackImportPayload) {
  return requestJson<KnowledgeVocabPackImportResult>("/api/knowledge/vocab/pack", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** L2 기관팩을 제거한다(문서 주제는 유지, 이후 태깅에만 반영 — 규격 §5). */
export async function removeVocabPack() {
  return requestJson<{ ok?: boolean; removed?: boolean }>("/api/knowledge/vocab/pack", {
    method: "DELETE",
  });
}

/** 주제 후보 큐를 조회한다(기본 pending — 규격 §6). */
export async function fetchVocabCandidates(status = "pending") {
  return requestJson<{ items: KnowledgeVocabCandidateItem[] }>(
    `/api/knowledge/vocab/candidates?status=${encodeURIComponent(status)}`,
  );
}

/** POST /api/knowledge/vocab/candidates/apply-recommended 응답 — §6 확장(자동 선별). */
export type KnowledgeVocabApplyRecommendedResult = {
  /** 표기 변형으로 병합 처리된 건수. */
  merged: number;
  /** 일회성 잡음으로 거절 처리된 건수. */
  rejected: number;
  /** 남은 pending(사람 검토 필요) 건수. */
  remaining_review: number;
};

/**
 * pending 후보 중 merge/reject 추천분을 일괄 적용한다(review 추천분은 남김) — §6 확장.
 * merge는 서버가 저장해 둔 recommended_target_id로 병합된다.
 */
export async function applyRecommendedVocabCandidates() {
  return requestJson<KnowledgeVocabApplyRecommendedResult>(
    "/api/knowledge/vocab/candidates/apply-recommended",
    { method: "POST" },
  );
}

/** 주제 후보를 승인/거절/병합 처리한다 — 규격 §6. */
export async function decideVocabCandidate(
  candidateId: string,
  payload: KnowledgeVocabCandidateDecisionPayload,
) {
  return requestJson<{ ok?: boolean; item?: KnowledgeVocabCandidateItem }>(
    `/api/knowledge/vocab/candidates/${encodeURIComponent(candidateId)}/decision`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

// ---------------------------------------------------------------------------
// W7 P3 §6: 무결성 점검(verify) 잡
// ---------------------------------------------------------------------------

/** verify 잡의 검사 항목별 결과 한 건(V1~V11 표의 한 줄). */
export type KnowledgeVerifyCheckItem = {
  /** 검사 코드(orphan / missing_card / fts_drift / untagged / silent_change 등). */
  code: string;
  /** 사용자 표기용 한국어 라벨 — 서버가 내려준 값을 그대로 표시한다. */
  label_ko: string;
  /** 발견 건수. */
  count: number;
  /** 자동 치유(파생물 재생성·고아 삭제)된 건수 — count보다 작으면 잔여분은 확인 필요. */
  healed: number;
  /** 확인 필요 항목의 원클릭 안내 문구(예: "색인 시작으로 반영") — 자동 치유 항목에는 없다. */
  action_hint?: string | null;
};

export type KnowledgeVerifyLatestResult = {
  ran_at: string;
  /** quick: 재해시 없는 빠른 점검(기본) / deep: 전량 재해시 심층 점검. */
  mode: "quick" | "deep" | string;
  checks: KnowledgeVerifyCheckItem[];
  /** 고아 파생물 정리로 회수한 디스크 용량. */
  disk_reclaimed_bytes?: number;
};

/**
 * 무결성 점검 잡 시작 — 색인과 동일 리소스 키로 상호 배제되는 work_job을 돌려준다.
 * deep=true면 전량 재해시(심층) — size+mtime 보존 변경의 유일한 탈출구(§4.2).
 */
export async function startKnowledgeVerify(payload?: { deep?: boolean }) {
  return requestJson<{ work_job: WorkJobItem }>("/api/knowledge/verify", {
    method: "POST",
    body: JSON.stringify({ deep: payload?.deep ?? false }),
  });
}

/** 가장 최근 무결성 점검 결과 — 서버는 항상 200 + {report: {...}|null}로 감싸 반환한다. */
export async function fetchKnowledgeVerifyLatest(): Promise<KnowledgeVerifyLatestResult | null> {
  const wrapped = await requestJson<{ report: KnowledgeVerifyLatestResult | null }>(
    "/api/knowledge/verify/latest",
  );
  return wrapped.report ?? null;
}

export async function startKnowledgeEnrich(payload?: {
  source_id?: string | null;
  background?: boolean;
}) {
  return requestJson<{ work_job: WorkJobItem }>("/api/knowledge/enrich", {
    method: "POST",
    body: JSON.stringify({
      source_id: payload?.source_id ?? null,
      background: payload?.background ?? true,
    }),
  });
}

export async function decideApproval(
  ticketId: string,
  payload: { status: "approved" | "rejected"; decision_note?: string },
) {
  return requestJson<ApprovalTicketItem>(`/api/approval-tickets/${ticketId}/decision`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
