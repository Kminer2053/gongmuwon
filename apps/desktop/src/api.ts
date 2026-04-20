const API_BASE_URL = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:8765";

export type ScheduleItem = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  view: "month" | "week" | "list";
  created_at: string;
};

export type WorkSessionItem = {
  id: string;
  title: string;
  schedule_id?: string | null;
  status: string;
  created_at: string;
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

export type KnowledgeSearchResult = {
  query: string;
  vector_hits: Array<{ page: KnowledgePageItem; score: number; keyword_overlap: number }>;
  graph_neighbors: string[];
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

export type FileProposalItem = {
  id: string;
  target_path: string;
  proposal_type: string;
  proposed_destination: string;
  reason: string;
  status: string;
  created_at: string;
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
    llm_mode: "local_first" | "internal_server";
    anything_launch_mode: "external_link_only";
    default_template_key: "report" | "meeting" | "review";
    internal_api_base_url: string | null;
  };
  paths: {
    workspace_root: string;
    database: string;
    knowledge_root: string;
    documents_root: string;
  };
};

const WORKSPACE_SETTINGS_VALUES = {
  llm_mode: ["local_first", "internal_server"],
  anything_launch_mode: ["external_link_only"],
  default_template_key: ["report", "meeting", "review"],
} as const;

export type ContentBaseResult = {
  id: string;
  title: string;
  purpose: string;
  template_key: string;
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
};

export type FinalDocumentApplyResult = FinalDocumentRequestResult & {
  artifact: { path: string };
};

export type WorkspaceSnapshot = {
  health: WorkspaceHealth | null;
  settings: WorkspaceSettings | null;
  schedules: ScheduleItem[];
  workSessions: WorkSessionItem[];
  referenceSets: ReferenceSetItem[];
  templates: TemplateItem[];
  knowledgeCandidates: KnowledgeCandidateItem[];
  knowledgePages: KnowledgePageItem[];
  approvalTickets: ApprovalTicketItem[];
  fileProposals: FileProposalItem[];
  logs: ExecutionLogItem[];
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
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

function parseWorkspaceSettings(value: unknown): WorkspaceSettings {
  if (!isRecord(value) || !isRecord(value.defaults) || !isRecord(value.paths)) {
    throw new Error("invalid workspace settings payload");
  }

  const { defaults, paths } = value;
  if (
    !isAllowedValue(defaults.llm_mode, WORKSPACE_SETTINGS_VALUES.llm_mode) ||
    !isAllowedValue(defaults.anything_launch_mode, WORKSPACE_SETTINGS_VALUES.anything_launch_mode) ||
    !isAllowedValue(defaults.default_template_key, WORKSPACE_SETTINGS_VALUES.default_template_key) ||
    !(
      typeof defaults.internal_api_base_url === "string" ||
      defaults.internal_api_base_url === null
    ) ||
    typeof paths.workspace_root !== "string" ||
    typeof paths.database !== "string" ||
    typeof paths.knowledge_root !== "string" ||
    typeof paths.documents_root !== "string"
  ) {
    throw new Error("invalid workspace settings payload");
  }

  return {
    defaults: {
      llm_mode: defaults.llm_mode,
      anything_launch_mode: defaults.anything_launch_mode,
      default_template_key: defaults.default_template_key,
      internal_api_base_url: defaults.internal_api_base_url,
    },
    paths: {
      workspace_root: paths.workspace_root,
      database: paths.database,
      knowledge_root: paths.knowledge_root,
      documents_root: paths.documents_root,
    },
  };
}

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const [
    health,
    settings,
    schedules,
    workSessions,
    referenceSets,
    templates,
    knowledgeCandidates,
    knowledgePages,
    approvalTickets,
    fileProposals,
    logs,
  ] = await Promise.allSettled([
    requestJson<WorkspaceHealth>("/health"),
    requestJson<unknown>("/api/settings"),
    requestJson<{ items: ScheduleItem[] }>("/api/schedules"),
    requestJson<{ items: WorkSessionItem[] }>("/api/work-sessions"),
    requestJson<{ items: ReferenceSetItem[] }>("/api/reference-sets"),
    requestJson<{ items: TemplateItem[] }>("/api/templates"),
    requestJson<{ items: KnowledgeCandidateItem[] }>("/api/knowledge/candidates"),
    requestJson<{ items: KnowledgePageItem[] }>("/api/knowledge/pages"),
    requestJson<{ items: ApprovalTicketItem[] }>("/api/approval-tickets"),
    requestJson<{ items: FileProposalItem[] }>("/api/file-organizer/proposals"),
    requestJson<{ items: ExecutionLogItem[] }>("/api/execution-logs"),
  ]);

  return {
    health: health.status === "fulfilled" ? health.value : null,
    settings: settings.status === "fulfilled" ? parseWorkspaceSettings(settings.value) : null,
    schedules: schedules.status === "fulfilled" ? schedules.value.items : [],
    workSessions: workSessions.status === "fulfilled" ? workSessions.value.items : [],
    referenceSets: referenceSets.status === "fulfilled" ? referenceSets.value.items : [],
    templates: templates.status === "fulfilled" ? templates.value.items : [],
    knowledgeCandidates:
      knowledgeCandidates.status === "fulfilled" ? knowledgeCandidates.value.items : [],
    knowledgePages: knowledgePages.status === "fulfilled" ? knowledgePages.value.items : [],
    approvalTickets: approvalTickets.status === "fulfilled" ? approvalTickets.value.items : [],
    fileProposals: fileProposals.status === "fulfilled" ? fileProposals.value.items : [],
    logs: logs.status === "fulfilled" ? logs.value.items : [],
  };
}

export async function createSchedule(payload: {
  title: string;
  starts_at: string;
  ends_at: string;
  view: "month" | "week" | "list";
}) {
  return requestJson<ScheduleItem>("/api/schedules", {
    method: "POST",
    body: JSON.stringify(payload),
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

export async function searchKnowledge(query: string) {
  return requestJson<KnowledgeSearchResult>(
    `/api/knowledge/search?query=${encodeURIComponent(query)}`,
  );
}

export async function loadKnowledgeGraph() {
  return requestJson<KnowledgeGraphSummary>("/api/knowledge/graph");
}

export async function createContentBase(payload: {
  title: string;
  purpose: string;
  reference_set_id?: string | null;
  template_key: "report" | "meeting" | "review";
}) {
  return requestJson<ContentBaseResult>("/api/documents/content-bases", {
    method: "POST",
    body: JSON.stringify(payload),
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
  return requestJson<ApprovalTicketItem>("/api/integrations/anything/launch", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}

export async function createFileProposals(targetPath: string) {
  return requestJson<{ items: FileProposalItem[] }>("/api/file-organizer/proposals", {
    method: "POST",
    body: JSON.stringify({ target_path: targetPath }),
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
