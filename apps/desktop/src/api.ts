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

export type ReferenceItem = {
  id?: string;
  kind: string;
  label: string;
  value: string;
};

export type ReferenceSetItem = {
  id: string;
  title: string;
  session_id?: string | null;
  items: ReferenceItem[];
  created_at: string;
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
  scanned_at: string;
};

export type KnowledgeWorkProfile = {
  id: string;
  org_name: string;
  department_name: string;
  team_name: string;
  position: string;
  duty_keywords: string[];
  created_at?: string | null;
  updated_at?: string | null;
};

export type KnowledgeWorkAnalysisClassification = {
  id: string;
  run_id: string;
  source_id: string;
  source_file_id: string;
  document_id?: string | null;
  document_role: string;
  document_role_label: string;
  family_key: string;
  family_relation: string;
  confidence: number;
  reasons: string[];
  ranking_hint: string;
  needs_review: boolean;
  confirmed: boolean;
  metadata?: Record<string, unknown>;
  relative_path?: string | null;
  file_path?: string | null;
  title?: string | null;
};

export type KnowledgeWorkAnalysis = {
  run_id?: string | null;
  source_id: string;
  status: "not_analyzed" | "completed" | string;
  confirmed: boolean;
  summary: {
    document_count: number;
    discovered_regulation_count: number;
    produced_document_count: number;
    data_source_count: number;
    collaboration_document_count: number;
    duplicate_file_count: number;
    version_family_count: number;
    needs_review_count: number;
    role_counts?: Record<string, number>;
    questions_needed?: string[];
    profile?: Record<string, unknown>;
  };
  questions_needed: string[];
  classifications: KnowledgeWorkAnalysisClassification[];
  created_at?: string | null;
  completed_at?: string | null;
  confirmed_at?: string | null;
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

export type KnowledgeSearchResult = {
  query: string;
  vector_hits: Array<{ page: KnowledgePageItem; score: number; keyword_overlap: number }>;
  source_file_hits?: Array<{ file: KnowledgeSourceFileItem; keyword_overlap: number }>;
  graph_neighbors: string[];
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

export type KnowledgeBackendStatus = {
  vector: {
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
  graph: {
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

export type KnowledgeAskResult = {
  query: string;
  session_id?: string | null;
  intent?: {
    key: string;
    label: string;
  };
  answer: string;
  citations: Array<{
    document_id: string;
    title: string;
    file_path: string;
    chunk_id: string;
    parser_name?: string | null;
    quality_score?: number | null;
    partial?: boolean;
    evidence_type?: "section" | "table" | string;
    quality_warnings?: string[];
    score_breakdown?: {
      text_score?: number;
      graph_score?: number;
      vector_score?: number;
      session_context_boost?: number;
      table_evidence_boost?: number;
      work_context_boost?: number;
      policy_boost?: number;
      work_product_boost?: number;
      data_boost?: number;
      department_boost?: number;
      reference_penalty?: number;
    };
    ranking_explanation?: string;
    relations: string[];
  }>;
  retrieval_summary?: {
    source_count: number;
    table_evidence_count: number;
    partial_count: number;
    low_quality_count: number;
    relation_count: number;
  };
  items: unknown[];
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
  requested_at: string;
  decided_at?: string | null;
  decision_note?: string | null;
};

export type AnythingLaunchItem = {
  id: string;
  approval_ticket_id: string;
  query: string;
  launch_target: string;
  status: "pending" | "applied";
  created_at: string;
  applied_at?: string | null;
};

export type AnythingLaunchRequestResult = {
  approval_ticket: ApprovalTicketItem;
  launch_request: AnythingLaunchItem;
};

export type AnythingLaunchImportResult = {
  launch_request: AnythingLaunchItem;
  reference_set: ReferenceSetItem;
};

export type FileProposalItem = {
  id: string;
  target_path: string;
  proposal_type: string;
  proposed_destination: string;
  reason: string;
  status: string;
  created_at: string;
};

export type FileOperationResult = {
  operation?: {
    id: string;
    proposal_id: string;
    source_path: string;
    destination_path: string;
    action: string;
    approval_ticket_id: string;
    created_at: string;
    rolled_back_at?: string | null;
  };
  status?: string;
  work_job?: WorkJobItem;
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

export type WorkspaceLlmRuntimePolicy = {
  provider: string;
  model: string;
  model_family: string;
  is_lightweight: boolean;
  is_gemma4?: boolean;
  is_gemma4_e2b: boolean;
  recommended_reasoning_effort: string;
  streaming_required: boolean;
  generate_fallback_enabled: boolean;
  thinking_supported: boolean;
  vision_supported: boolean;
  recommended_options: Record<string, unknown> | null;
  notes: string[];
};

export type WorkspaceSettings = {
  defaults: {
    llm_mode: LlmMode;
    llm_provider: string;
    llm_model: string;
    llm_runtime_policy?: WorkspaceLlmRuntimePolicy;
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
  embedding_provider?: EmbeddingProvider;
  embedding_model?: string;
  embedding_base_url?: string | null;
  embedding_fallback_enabled?: boolean;
  graphrag_vector_backend?: GraphRAGVectorBackend;
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
      model: "gemma4:e2b",
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
          model: "gemma4:e2b",
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
  reference_set_id?: string | null;
  source_session_id?: string | null;
  outline?: string;
  document_format?: DocumentFormat;
  direct_file_paths?: string[];
  user_template_path?: string | null;
  content: string;
  artifact: { path: string };
  preview: { path: string };
  source_analysis?: DocumentSourceAnalysis;
};

export type DocumentSourceAnalysisMode = "none" | "normal" | "partial" | "limited";

export type DocumentSourceAnalysisFile = {
  path: string;
  file_name: string;
  size_bytes?: number | null;
  analysis_mode: DocumentSourceAnalysisMode;
  excerpt?: string;
  warnings?: string[];
};

export type DocumentSourceAnalysis = {
  budget_bytes: number;
  used_bytes: number;
  overall_mode: DocumentSourceAnalysisMode;
  direct_files: DocumentSourceAnalysisFile[];
  warnings: string[];
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
  referenceSets: ReferenceSetItem[];
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
  anythingLaunches: AnythingLaunchItem[];
  fileProposals: FileProposalItem[];
  logs: ExecutionLogItem[];
};

export type WorkspaceDeferredGroup = "knowledge" | "search" | "fileOrganizer" | "logs";
export type WorkspaceSnapshotPatch = Partial<WorkspaceSnapshot>;

export function createEmptyWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    health: null,
    runtimeReady: null,
    runtimeMetrics: null,
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
    : "chromadb";
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
  for (const group of ["knowledge", "search", "fileOrganizer", "logs"] as const) {
    snapshot = mergeWorkspaceSnapshot(snapshot, await loadWorkspaceDeferredSnapshot(group));
  }
  return snapshot;
}

export async function loadWorkspaceShellSnapshot(): Promise<WorkspaceSnapshot> {
  const [
    health,
    runtimeReady,
    runtimeMetrics,
    settings,
    schedules,
    workSessions,
    referenceSets,
    templates,
    approvalTickets,
    workJobs,
  ] = await Promise.allSettled([
    requestJson<WorkspaceHealth>("/health"),
    requestJson<RuntimeReady>("/ready"),
    requestJson<RuntimeMetrics>("/api/runtime/metrics"),
    requestJson<unknown>("/api/settings"),
    requestJson<{ items: ScheduleItem[] }>("/api/schedules"),
    requestJson<{ items: WorkSessionItem[] }>("/api/work-sessions"),
    requestJson<{ items: ReferenceSetItem[] }>("/api/reference-sets"),
    requestJson<{ items: TemplateItem[] }>("/api/templates"),
    requestJson<{ items: ApprovalTicketItem[] }>("/api/approval-tickets"),
    requestJson<{ items: WorkJobItem[] }>("/api/jobs?limit=20"),
  ]);

  return mergeWorkspaceSnapshot(createEmptyWorkspaceSnapshot(), {
    health: health.status === "fulfilled" ? health.value : null,
    runtimeReady: runtimeReady.status === "fulfilled" ? runtimeReady.value : null,
    runtimeMetrics: runtimeMetrics.status === "fulfilled" ? runtimeMetrics.value : null,
    settings: settings.status === "fulfilled" ? parseWorkspaceSettings(settings.value) : null,
    schedules: schedules.status === "fulfilled" ? schedules.value.items : [],
    workSessions: workSessions.status === "fulfilled" ? workSessions.value.items : [],
    referenceSets: referenceSets.status === "fulfilled" ? referenceSets.value.items : [],
    templates: templates.status === "fulfilled" ? templates.value.items : [],
    approvalTickets: approvalTickets.status === "fulfilled" ? approvalTickets.value.items : [],
    workJobs: workJobs.status === "fulfilled" ? workJobs.value.items : [],
  });
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

  if (group === "search") {
    const [anythingLaunches] = await Promise.allSettled([
      requestJson<{ items: AnythingLaunchItem[] }>("/api/integrations/anything/launches"),
    ]);
    return {
      anythingLaunches:
        anythingLaunches.status === "fulfilled" ? anythingLaunches.value.items : [],
    };
  }

  if (group === "fileOrganizer") {
    const [fileProposals] = await Promise.allSettled([
      requestJson<{ items: FileProposalItem[] }>("/api/file-organizer/proposals"),
    ]);
    return {
      fileProposals: fileProposals.status === "fulfilled" ? fileProposals.value.items : [],
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

export async function createReferenceSet(payload: {
  title: string;
  session_id?: string | null;
  items: ReferenceItem[];
}) {
  return requestJson<ReferenceSetItem>("/api/reference-sets", {
    method: "POST",
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

export async function loadKnowledgeWorkProfile() {
  return requestJson<KnowledgeWorkProfile>("/api/knowledge/work-profile");
}

export async function saveKnowledgeWorkProfile(payload: {
  org_name: string;
  department_name: string;
  team_name: string;
  position: string;
  duty_keywords: string[];
}) {
  return requestJson<KnowledgeWorkProfile>("/api/knowledge/work-profile", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function analyzeKnowledgeSourceWorkContext(sourceId: string) {
  return requestJson<KnowledgeWorkAnalysis>(`/api/knowledge/sources/${sourceId}/analyze-work-context`, {
    method: "POST",
  });
}

export async function loadKnowledgeSourceWorkAnalysis(sourceId: string) {
  return requestJson<KnowledgeWorkAnalysis>(`/api/knowledge/sources/${sourceId}/analysis`);
}

export async function confirmKnowledgeSourceWorkAnalysis(sourceId: string, runId?: string | null) {
  return requestJson<KnowledgeWorkAnalysis>(`/api/knowledge/sources/${sourceId}/analysis/confirm`, {
    method: "POST",
    body: JSON.stringify({ run_id: runId ?? null }),
  });
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
  reference_set_id?: string | null;
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
  reference_set_id?: string | null;
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

export async function requestAnythingLaunch(query: string) {
  return requestJson<AnythingLaunchRequestResult>("/api/integrations/anything/launch", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}

export async function applyAnythingLaunch(ticketId: string) {
  return requestJson<AnythingLaunchRequestResult>(
    `/api/integrations/anything/launch/${ticketId}/apply`,
    {
      method: "POST",
    },
  );
}

export async function importAnythingLaunchReferenceSet(
  ticketId: string,
  payload: {
    title: string;
    session_id?: string | null;
    paths: string[];
  },
) {
  return requestJson<AnythingLaunchImportResult>(
    `/api/integrations/anything/launch/${ticketId}/reference-set`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function createFileProposals(targetPath: string) {
  return requestJson<{ items: FileProposalItem[] }>("/api/file-organizer/proposals", {
    method: "POST",
    body: JSON.stringify({ target_path: targetPath }),
  });
}

export async function requestFileProposalApply(proposalId: string) {
  return requestJson<{ approval_ticket: ApprovalTicketItem; proposal: FileProposalItem }>(
    `/api/file-organizer/proposals/${proposalId}/apply`,
    { method: "POST" },
  );
}

export async function commitFileProposalApply(proposalId: string) {
  return requestJson<FileOperationResult>(
    `/api/file-organizer/proposals/${proposalId}/apply/commit`,
    { method: "POST" },
  );
}

export async function rollbackFileOperation(operationId: string) {
  return requestJson<{ restored_path?: string; operation_id?: string; status?: string; work_job?: WorkJobItem }>(
    `/api/file-organizer/operations/${operationId}/rollback`,
    { method: "POST" },
  );
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
