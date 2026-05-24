import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildScenarioSet } from "./generate-lightweight-model-test-scenarios.mjs";
import {
  auditComputerUseCoverage,
  scoreScenarioRun,
} from "./score-lightweight-model-test-run.mjs";
import { evaluateChatSmoke, evaluateRuntimePolicySmoke } from "./run-lightweight-model-smoke.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:8765";
const DEFAULT_OUT_DIR = path.join("docs", "operations", "generated");
const ACTUAL_RESULT_BASENAME = "lightweight-model-computer-use-actual-results";
const ACTUAL_SCORE_BASENAME = "lightweight-model-computer-use-actual-score-report";
const ACTUAL_AUDIT_BASENAME = "lightweight-model-computer-use-actual-coverage-audit";

const CATEGORY_LABEL_BY_PREFIX = {
  "LMUX-01": "시작/업무엔진",
  "LMUX-02": "모델 설정/Gemma 4 E2B",
  "LMUX-03": "업무대화 기본 UX",
  "LMUX-04": "업무대화 도구 라우팅",
  "LMUX-05": "일정 캘린더",
  "LMUX-06": "파일찾기/세션 연결",
  "LMUX-07": "지식폴더/GraphRAG 인덱싱",
  "LMUX-08": "GraphRAG 검색/출처 품질",
  "LMUX-09": "문서작성/HWPX 산출",
  "LMUX-10": "실행기록/작업진행/다중작업",
};

function nowIso() {
  return new Date().toISOString();
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function lastMessage(messages, role) {
  return [...(messages || [])].reverse().find((message) => message?.role === role) || null;
}

function commonEvidence({ screenshotPath, snapshotPath, apiEvidenceBase, extra = [] } = {}) {
  return [
    screenshotPath ? `screenshot://${screenshotPath}` : "",
    snapshotPath ? `snapshot://${snapshotPath}` : "",
    apiEvidenceBase || "",
    ...extra,
  ].filter(Boolean);
}

function passScores({ functional = true, ux = true, modelQuality = true, evidence = true } = {}) {
  return {
    functional: functional ? 4 : 0,
    ux: ux ? 3 : 0,
    modelQuality: modelQuality ? 2 : 0,
    evidence: evidence ? 1 : 0,
  };
}

function includesAll(text, markers) {
  const source = String(text || "");
  return markers.every((marker) => source.includes(marker));
}

function featureEvidence(feature) {
  return commonEvidence({
    screenshotPath: feature?.screenshotPath,
    snapshotPath: feature?.snapshotPath,
  });
}

function featureScenario({
  id,
  feature,
  required,
  uxRequired = required,
  noteLabel,
  blocker,
}) {
  const text = String(feature?.snapshotText || "");
  const functional = includesAll(text, required);
  const ux = includesAll(text, uxRequired);
  const evidence = featureEvidence(feature);
  return {
    id,
    status: functional && ux && evidence.length > 0 ? "pass" : functional ? "partial" : "fail",
    scores: passScores({
      functional,
      ux,
      modelQuality: true,
      evidence: evidence.length > 0,
    }),
    evidence,
    notes: `${noteLabel}: required=${required.join(", ")}; ux=${uxRequired.join(", ")}`,
    blocker: functional && ux ? "" : blocker,
  };
}

export function evaluateFeatureUiSnapshots({
  calendar = null,
  fileSearch = null,
  knowledge = null,
  document = null,
} = {}) {
  const results = [];
  if (calendar) {
    results.push(
      featureScenario({
        id: "LMUX-05-01",
        feature: calendar,
        required: ["업무일정", "캘린더"],
        uxRequired: ["월", "주", "일"],
        noteLabel: "calendar_ui",
        blocker: "Calendar month/week/day controls were not proven in the UI snapshot.",
      }),
    );
  }
  if (fileSearch) {
    results.push(
      featureScenario({
        id: "LMUX-06-01",
        feature: fileSearch,
        required: ["내장 파일찾기", "파일명 인덱스 갱신"],
        uxRequired: ["검색 범위", "파일 검색"],
        noteLabel: "file_search_ui",
        blocker: "File search index refresh and search UI were not proven in the UI snapshot.",
      }),
    );
  }
  if (knowledge) {
    results.push(
      featureScenario({
        id: "LMUX-07-02",
        feature: knowledge,
        required: ["내 지식폴더", "GraphRAG"],
        uxRequired: ["지식 그래프", "GraphRAG 검색"],
        noteLabel: "knowledge_ui",
        blocker: "Knowledge folder graph/indexing navigation was not proven in the UI snapshot.",
      }),
    );
  }
  if (document) {
    results.push(
      featureScenario({
        id: "LMUX-09-02",
        feature: document,
        required: ["문서작성"],
        uxRequired: ["시행문", "이메일"],
        noteLabel: "document_entry_ui",
        blocker: "Document authoring entry screen was not proven in the UI snapshot.",
      }),
      featureScenario({
        id: "LMUX-09-04",
        feature: document,
        required: ["시행문"],
        uxRequired: ["문서작성"],
        noteLabel: "document_official_template_ui",
        blocker: "Official letter output type was not proven in the UI snapshot.",
      }),
      featureScenario({
        id: "LMUX-09-05",
        feature: document,
        required: ["1페이지"],
        uxRequired: ["문서작성"],
        noteLabel: "document_one_page_template_ui",
        blocker: "One-page report output type was not proven in the UI snapshot.",
      }),
    );
  }
  return results;
}

function workflowEvidenceList(section, fallback = []) {
  const explicit = Array.isArray(section?.evidence) ? section.evidence : [];
  return [...explicit, ...fallback].filter(Boolean);
}

function workflowScenario({
  id,
  functional,
  ux = functional,
  modelQuality = true,
  evidence = [],
  notes,
  blocker,
}) {
  return {
    id,
    status: functional && ux && evidence.length > 0 ? "pass" : functional ? "partial" : "fail",
    scores: passScores({
      functional,
      ux,
      modelQuality,
      evidence: evidence.length > 0,
    }),
    evidence,
    notes,
    blocker: functional && ux ? "" : blocker,
  };
}

const OPTIONAL_WORKFLOW_SCENARIO_FIELDS = {
  "LMUX-01-04": { section: "engine", fields: ["refreshSessionRetained"] },
  "LMUX-01-06": { section: "engine", fields: ["statusPopoverShown"] },
  "LMUX-01-07": { section: "engine", fields: ["longJobRecovered"] },
  "LMUX-01-09": { section: "engine", fields: ["understandableErrorShown"] },
  "LMUX-01-10": { section: "engine", fields: ["compactToolbarShown"] },
  "LMUX-03-02": { section: "chat", fields: ["streamingObserved"] },
  "LMUX-03-05": { section: "chat", fields: ["scrollBottomPreserved"] },
  "LMUX-03-06": { section: "chat", fields: ["imageThumbnailShown"] },
  "LMUX-03-07": { section: "chat", fields: ["attachmentCancelShown", "largePreviewShown"] },
  "LMUX-03-08": { section: "chat", fields: ["detailSettingsOverlayShown"] },
  "LMUX-03-09": { section: "chat", fields: ["sensitiveInfoMasked"] },
  "LMUX-02-02": { section: "settings", fields: ["ollamaBaseUrlSaved"] },
  "LMUX-02-03": { section: "settings", fields: ["reasoningLowRecommended"] },
  "LMUX-02-04": { section: "settings", fields: ["thinkingTraceClean"] },
  "LMUX-02-05": { section: "settings", fields: ["gemmaNoResponseGuidanceShown"] },
  "LMUX-04-06": { section: "routing", fields: ["scheduleAndKnowledgeCombined"] },
  "LMUX-04-07": { section: "routing", fields: ["fileSearchGuidance"] },
  "LMUX-04-08": { section: "routing", fields: ["featureHelpGuidance"] },
  "LMUX-04-09": { section: "routing", fields: ["toolFailureRecoveryGuidance"] },
  "LMUX-04-10": { section: "routing", fields: ["generalChatSeparated"] },
  "LMUX-07-01": { section: "knowledgeIndexing", fields: ["sourceRegistered", "sourceCount"] },
  "LMUX-07-03": { section: "knowledgeIndexing", fields: ["scanProgressShown"] },
  "LMUX-07-04": { section: "knowledgeIndexing", fields: ["ingestionProgressShown", "progressPercent"] },
  "LMUX-07-05": { section: "knowledgeIndexing", fields: ["duplicateWorkLocked"] },
  "LMUX-07-06": { section: "knowledgeIndexing", fields: ["cancelObserved"] },
  "LMUX-07-07": { section: "knowledgeIndexing", fields: ["dumpViewerOpenable"] },
  "LMUX-07-08": { section: "knowledgeIndexing", fields: ["structureViewOpenable"] },
  "LMUX-07-09": { section: "knowledgeIndexing", fields: ["partialWarningShown"] },
  "LMUX-07-10": { section: "knowledgeIndexing", fields: ["completedCountDrilldown", "completedDocumentCount"] },
  "LMUX-08-05": { section: "knowledge", fields: ["lowQualityWarningShown"] },
  "LMUX-08-06": { section: "knowledge", fields: ["relationDrilldownShown"] },
  "LMUX-08-07": { section: "knowledge", fields: ["graphNodeClicked"] },
  "LMUX-08-08": { section: "knowledge", fields: ["tableEvidenceShown"] },
  "LMUX-08-09": { section: "knowledge", fields: ["sessionKnowledgeSearch"] },
  "LMUX-08-10": { section: "knowledge", fields: ["noEvidenceGraceful"] },
  "LMUX-09-01": { section: "document", fields: ["fromSessionHandoff"] },
  "LMUX-09-03": { section: "document", fields: ["linkedFileUsageCaptured"] },
  "LMUX-09-06": { section: "document", fields: ["fullReportTypeAvailable"] },
  "LMUX-09-07": { section: "document", fields: ["emailTypeAvailable"] },
  "LMUX-09-08": { section: "document", fields: ["customTemplateSelectable"] },
  "LMUX-10-04": { section: "operations", fields: ["duplicateSameSessionBlocked"] },
  "LMUX-10-06": { section: "operations", fields: ["cancelButtonShown"] },
};

function hasOwnWorkflowField(source, field) {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, field));
}

function shouldScoreWorkflowScenario(id, workflowSections) {
  const optional = OPTIONAL_WORKFLOW_SCENARIO_FIELDS[id];
  if (!optional) {
    return true;
  }
  const source = workflowSections[optional.section];
  return optional.fields.some((field) => hasOwnWorkflowField(source, field));
}

export function evaluateWorkflowEvidence({
  engine = null,
  chat = null,
  routing = null,
  schedule = null,
  knowledgeIndexing = null,
  knowledge = null,
  document = null,
  fileSearch = null,
  settings = null,
  operations = null,
} = {}) {
  const results = [];

  if (engine) {
    const evidence = workflowEvidenceList(engine);
    results.push(
      workflowScenario({
        id: "LMUX-01-04",
        functional: Boolean(engine.refreshSessionRetained),
        ux: Boolean(engine.refreshSessionRetained),
        evidence,
        notes: `refresh_session_retained=${Boolean(engine.refreshSessionRetained)}`,
        blocker: "Session state after refresh was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-01-06",
        functional: Boolean(engine.statusPopoverShown),
        ux: Boolean(engine.statusPopoverShown),
        evidence,
        notes: `status_popover=${Boolean(engine.statusPopoverShown)}`,
        blocker: "Engine status popover was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-01-07",
        functional: Boolean(engine.longJobRecovered),
        ux: Boolean(engine.longJobRecovered),
        evidence,
        notes: `long_job_recovered=${Boolean(engine.longJobRecovered)}`,
        blocker: "Engine state after long-running work was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-01-09",
        functional: Boolean(engine.understandableErrorShown),
        ux: Boolean(engine.understandableErrorShown),
        evidence,
        notes: `understandable_error=${Boolean(engine.understandableErrorShown)}`,
        blocker: "Understandable engine error guidance was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-01-10",
        functional: Boolean(engine.compactToolbarShown),
        ux: Boolean(engine.compactToolbarShown),
        evidence,
        notes: `compact_toolbar=${Boolean(engine.compactToolbarShown)}`,
        blocker: "Compact top status/toolbar controls were not proven by workflow evidence.",
      }),
    );
  }

  if (chat) {
    const evidence = workflowEvidenceList(chat);
    results.push(
      workflowScenario({
        id: "LMUX-03-02",
        functional: Boolean(chat.streamingObserved),
        ux: Boolean(chat.streamingObserved),
        evidence,
        notes: `streaming_observed=${Boolean(chat.streamingObserved)}`,
        blocker: "Streaming response display was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-03-05",
        functional: Boolean(chat.scrollBottomPreserved),
        ux: Boolean(chat.scrollBottomPreserved),
        evidence,
        notes: `scroll_bottom_preserved=${Boolean(chat.scrollBottomPreserved)}`,
        blocker: "Bottom scroll preservation after long chat was not proven.",
      }),
      workflowScenario({
        id: "LMUX-03-06",
        functional: Boolean(chat.imageThumbnailShown),
        ux: Boolean(chat.imageThumbnailShown),
        evidence,
        notes: `image_thumbnail=${Boolean(chat.imageThumbnailShown)}`,
        blocker: "Image attachment thumbnail was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-03-07",
        functional: Boolean(chat.attachmentCancelShown && chat.largePreviewShown),
        ux: Boolean(chat.attachmentCancelShown && chat.largePreviewShown),
        evidence,
        notes: `attachment_cancel=${Boolean(chat.attachmentCancelShown)}; large_preview=${Boolean(chat.largePreviewShown)}`,
        blocker: "Attachment cancel and large preview were not proven together.",
      }),
      workflowScenario({
        id: "LMUX-03-08",
        functional: Boolean(chat.detailSettingsOverlayShown),
        ux: Boolean(chat.detailSettingsOverlayShown),
        evidence,
        notes: `detail_settings_overlay=${Boolean(chat.detailSettingsOverlayShown)}`,
        blocker: "Chat detail-settings overlay was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-03-09",
        functional: Boolean(chat.sensitiveInfoMasked),
        ux: Boolean(chat.sensitiveInfoMasked),
        modelQuality: Boolean(chat.sensitiveInfoMasked),
        evidence,
        notes: `sensitive_masked=${Boolean(chat.sensitiveInfoMasked)}`,
        blocker: "Sensitive information masking was not proven by workflow evidence.",
      }),
    );
  }

  if (routing) {
    const evidence = workflowEvidenceList(routing);
    results.push(
      workflowScenario({
        id: "LMUX-04-06",
        functional: Boolean(routing.scheduleAndKnowledgeCombined),
        ux: Boolean(routing.scheduleAndKnowledgeCombined),
        evidence,
        notes: `schedule_knowledge_combined=${Boolean(routing.scheduleAndKnowledgeCombined)}`,
        blocker: "Combined schedule and knowledge-routing request was not proven.",
      }),
      workflowScenario({
        id: "LMUX-04-07",
        functional: Boolean(routing.fileSearchGuidance),
        ux: Boolean(routing.fileSearchGuidance),
        evidence,
        notes: `file_search_guidance=${Boolean(routing.fileSearchGuidance)}`,
        blocker: "File-search guidance routing was not proven.",
      }),
      workflowScenario({
        id: "LMUX-04-08",
        functional: Boolean(routing.featureHelpGuidance),
        ux: Boolean(routing.featureHelpGuidance),
        evidence,
        notes: `feature_help=${Boolean(routing.featureHelpGuidance)}`,
        blocker: "Feature help guidance routing was not proven.",
      }),
      workflowScenario({
        id: "LMUX-04-09",
        functional: Boolean(routing.toolFailureRecoveryGuidance),
        ux: Boolean(routing.toolFailureRecoveryGuidance),
        evidence,
        notes: `tool_failure_recovery=${Boolean(routing.toolFailureRecoveryGuidance)}`,
        blocker: "Tool-failure recovery guidance was not proven.",
      }),
      workflowScenario({
        id: "LMUX-04-10",
        functional: Boolean(routing.generalChatSeparated),
        ux: Boolean(routing.generalChatSeparated),
        evidence,
        notes: `general_chat_separated=${Boolean(routing.generalChatSeparated)}`,
        blocker: "General chat vs tool request separation was not proven.",
      }),
    );
  }

  if (schedule) {
    const evidence = workflowEvidenceList(schedule);
    const title = schedule.title || "untitled";
    results.push(
      workflowScenario({
        id: "LMUX-04-01",
        functional: Boolean(schedule.created),
        ux: Boolean(schedule.title),
        evidence,
        notes: `schedule_created=${Boolean(schedule.created)}; title=${title}`,
        blocker: "Schedule creation routing was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-04-02",
        functional: Boolean(schedule.listed),
        ux: Boolean(schedule.created || schedule.deleted || schedule.count > 0),
        evidence,
        notes: `schedule_listed=${Boolean(schedule.listed)}; count=${schedule.count ?? "unknown"}`,
        blocker: "Schedule list routing was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-04-03",
        functional: Boolean(schedule.deleted),
        ux: Boolean(schedule.title || schedule.deletedTitle),
        evidence,
        notes: `schedule_deleted=${Boolean(schedule.deleted)}; title=${schedule.deletedTitle || title}`,
        blocker: "Schedule deletion routing was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-05-03",
        functional: Boolean(schedule.created),
        ux: Boolean(schedule.startsAt || schedule.timeSlot || schedule.title),
        evidence,
        notes: `day_time_registration=${Boolean(schedule.created)}; starts_at=${schedule.startsAt || "unknown"}`,
        blocker: "Day-view time-slot schedule registration was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-05-02",
        functional: Boolean(schedule.weekViewShown),
        ux: Boolean(schedule.weekViewShown),
        evidence,
        notes: `week_view=${Boolean(schedule.weekViewShown)}`,
        blocker: "Week-view time grid was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-05-04",
        functional: Boolean(schedule.longTitleEllipsized),
        ux: Boolean(schedule.longTitleEllipsized),
        evidence,
        notes: `long_title_ellipsized=${Boolean(schedule.longTitleEllipsized)}`,
        blocker: "Long schedule title truncation was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-05-05",
        functional: Boolean(schedule.hoverDetailsShown),
        ux: Boolean(schedule.hoverDetailsShown),
        evidence,
        notes: `hover_details=${Boolean(schedule.hoverDetailsShown)}`,
        blocker: "Schedule hover/detail disclosure was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-05-06",
        functional: Boolean(schedule.updatedThenCreated),
        ux: Boolean(schedule.updatedThenCreated),
        evidence,
        notes: `updated_then_created=${Boolean(schedule.updatedThenCreated)}`,
        blocker: "Edit-existing then create-new schedule flow was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-05-07",
        functional: Boolean(schedule.linkedSessionOpened),
        ux: Boolean(schedule.linkedSessionOpened),
        evidence,
        notes: `linked_session_opened=${Boolean(schedule.linkedSessionOpened)}`,
        blocker: "Opening the linked work-session from a schedule was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-05-08",
        functional: Boolean(schedule.todayNavigation),
        ux: Boolean(schedule.todayNavigation),
        evidence,
        notes: `today_navigation=${Boolean(schedule.todayNavigation)}`,
        blocker: "Today navigation was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-05-09",
        functional: Boolean(schedule.periodNavigation),
        ux: Boolean(schedule.periodNavigation),
        evidence,
        notes: `period_navigation=${Boolean(schedule.periodNavigation)}`,
        blocker: "Previous/next period navigation was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-05-10",
        functional: Boolean(schedule.deleted && schedule.listed),
        ux: Boolean(schedule.deleted),
        evidence,
        notes: `delete_reflected=${Boolean(schedule.deleted && schedule.listed)}`,
        blocker: "Schedule deletion and list refresh were not proven together.",
      }),
    );
  }

  if (knowledgeIndexing) {
    const evidence = workflowEvidenceList(knowledgeIndexing);
    const sourceCount = Number(knowledgeIndexing.sourceCount || 0);
    const completedDocumentCount = Number(knowledgeIndexing.completedDocumentCount || 0);
    results.push(
      workflowScenario({
        id: "LMUX-07-01",
        functional: Boolean(knowledgeIndexing.sourceRegistered && sourceCount > 0),
        ux: Boolean(sourceCount > 0),
        evidence,
        notes: `source_registered=${Boolean(knowledgeIndexing.sourceRegistered)}; source_count=${sourceCount}`,
        blocker: "Knowledge source registration was not proven.",
      }),
      workflowScenario({
        id: "LMUX-07-03",
        functional: Boolean(knowledgeIndexing.scanProgressShown),
        ux: Boolean(knowledgeIndexing.scanProgressShown),
        evidence,
        notes: `scan_progress=${Boolean(knowledgeIndexing.scanProgressShown)}`,
        blocker: "Knowledge scan progress was not proven.",
      }),
      workflowScenario({
        id: "LMUX-07-04",
        functional: Boolean(knowledgeIndexing.ingestionProgressShown),
        ux: Boolean(knowledgeIndexing.progressPercent !== undefined),
        evidence,
        notes: `ingestion_progress=${Boolean(knowledgeIndexing.ingestionProgressShown)}; progress=${knowledgeIndexing.progressPercent ?? "unknown"}`,
        blocker: "GraphRAG ingestion progress was not proven.",
      }),
      workflowScenario({
        id: "LMUX-07-05",
        functional: Boolean(knowledgeIndexing.duplicateWorkLocked),
        ux: Boolean(knowledgeIndexing.duplicateWorkLocked),
        evidence,
        notes: `duplicate_work_locked=${Boolean(knowledgeIndexing.duplicateWorkLocked)}`,
        blocker: "Duplicate indexing lock was not proven.",
      }),
      workflowScenario({
        id: "LMUX-07-06",
        functional: Boolean(knowledgeIndexing.cancelObserved),
        ux: Boolean(knowledgeIndexing.cancelObserved),
        evidence,
        notes: `cancel_observed=${Boolean(knowledgeIndexing.cancelObserved)}`,
        blocker: "Indexing cancel behavior was not proven.",
      }),
      workflowScenario({
        id: "LMUX-07-07",
        functional: Boolean(knowledgeIndexing.dumpViewerOpenable),
        ux: Boolean(knowledgeIndexing.dumpViewerOpenable),
        evidence,
        notes: `dump_viewer=${Boolean(knowledgeIndexing.dumpViewerOpenable)}`,
        blocker: "Knowledge ingestion dump viewer was not proven.",
      }),
      workflowScenario({
        id: "LMUX-07-08",
        functional: Boolean(knowledgeIndexing.structureViewOpenable),
        ux: Boolean(knowledgeIndexing.structureViewOpenable),
        evidence,
        notes: `structure_view=${Boolean(knowledgeIndexing.structureViewOpenable)}`,
        blocker: "Knowledge document structure view was not proven.",
      }),
      workflowScenario({
        id: "LMUX-07-09",
        functional: Boolean(knowledgeIndexing.partialWarningShown),
        ux: Boolean(knowledgeIndexing.partialWarningShown),
        evidence,
        notes: `partial_warning=${Boolean(knowledgeIndexing.partialWarningShown)}`,
        blocker: "Partial extraction warning was not proven.",
      }),
      workflowScenario({
        id: "LMUX-07-10",
        functional: Boolean(knowledgeIndexing.completedCountDrilldown && completedDocumentCount > 0),
        ux: Boolean(completedDocumentCount > 0),
        evidence,
        notes: `completed_count_drilldown=${Boolean(knowledgeIndexing.completedCountDrilldown)}; completed_documents=${completedDocumentCount}`,
        blocker: "Completed file count drill-down was not proven.",
      }),
    );
  }

  if (knowledge) {
    const evidence = workflowEvidenceList(knowledge);
    const sourceDocumentCount = Number(knowledge.sourceDocumentCount || 0);
    const sourcePathCount = Number(knowledge.sourcePathCount || 0);
    const answerText = String(knowledge.answerText || "");
    results.push(
      workflowScenario({
        id: "LMUX-04-04",
        functional: Boolean(knowledge.searched),
        ux: sourceDocumentCount > 0 || answerText.length > 0,
        evidence,
        notes: `knowledge_searched=${Boolean(knowledge.searched)}; source_documents=${sourceDocumentCount}`,
        blocker: "Knowledge-search routing was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-08-01",
        functional: Boolean(knowledge.searched && sourceDocumentCount > 0),
        ux: Boolean(sourceDocumentCount > 0),
        evidence,
        notes: `search_result_count=${sourceDocumentCount}`,
        blocker: "GraphRAG search results were not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-08-02",
        functional: Boolean(knowledge.answered && answerText.length >= 20),
        ux: Boolean(answerText.length >= 20),
        evidence,
        notes: `grounded_answer_chars=${answerText.length}`,
        blocker: "Grounded answer generation was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-08-03",
        functional: sourceDocumentCount > 0,
        ux: sourceDocumentCount > 0,
        evidence,
        notes: `source_document_count=${sourceDocumentCount}`,
        blocker: "Source document names were not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-08-04",
        functional: sourcePathCount > 0,
        ux: sourcePathCount > 0,
        evidence,
        notes: `source_path_count=${sourcePathCount}`,
        blocker: "Source file paths were not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-08-05",
        functional: Boolean(knowledge.lowQualityWarningShown),
        ux: Boolean(knowledge.lowQualityWarningShown),
        evidence,
        notes: `low_quality_warning=${Boolean(knowledge.lowQualityWarningShown)}`,
        blocker: "Low-quality evidence warning was not proven.",
      }),
      workflowScenario({
        id: "LMUX-08-06",
        functional: Boolean(knowledge.relationDrilldownShown),
        ux: Boolean(knowledge.relationDrilldownShown),
        evidence,
        notes: `relation_drilldown=${Boolean(knowledge.relationDrilldownShown)}`,
        blocker: "Graph relation drill-down was not proven.",
      }),
      workflowScenario({
        id: "LMUX-08-07",
        functional: Boolean(knowledge.graphNodeClicked),
        ux: Boolean(knowledge.graphNodeClicked),
        evidence,
        notes: `graph_node_clicked=${Boolean(knowledge.graphNodeClicked)}`,
        blocker: "Graph node click interaction was not proven.",
      }),
      workflowScenario({
        id: "LMUX-08-08",
        functional: Boolean(knowledge.tableEvidenceShown),
        ux: Boolean(knowledge.tableEvidenceShown),
        evidence,
        notes: `table_evidence=${Boolean(knowledge.tableEvidenceShown)}`,
        blocker: "Table evidence display was not proven.",
      }),
      workflowScenario({
        id: "LMUX-08-09",
        functional: Boolean(knowledge.sessionKnowledgeSearch),
        ux: Boolean(knowledge.sessionKnowledgeSearch),
        evidence,
        notes: `session_knowledge_search=${Boolean(knowledge.sessionKnowledgeSearch)}`,
        blocker: "Knowledge retrieval from work-chat was not proven.",
      }),
      workflowScenario({
        id: "LMUX-08-10",
        functional: Boolean(knowledge.noEvidenceGraceful),
        ux: Boolean(knowledge.noEvidenceGraceful),
        evidence,
        notes: `no_evidence_graceful=${Boolean(knowledge.noEvidenceGraceful)}`,
        blocker: "No-evidence question handling was not proven.",
      }),
    );
  }

  if (document) {
    const evidence = workflowEvidenceList(document);
    const outputPath = String(document.outputPath || "");
    results.push(
      workflowScenario({
        id: "LMUX-04-05",
        functional: Boolean(document.routed || document.generated),
        ux: Boolean(document.format || outputPath),
        evidence,
        notes: `document_routed=${Boolean(document.routed)}; format=${document.format || "unknown"}`,
        blocker: "Document-authoring routing was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-09-09",
        functional: Boolean(document.generated && outputPath),
        ux: Boolean(outputPath.toLowerCase().endsWith(".hwpx") || outputPath.toLowerCase().endsWith(".hwp")),
        evidence,
        notes: `document_generated=${Boolean(document.generated)}; output_path=${outputPath || "missing"}`,
        blocker: "HWPX output path was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-09-10",
        functional: Boolean(document.openLink && outputPath),
        ux: Boolean(outputPath),
        evidence,
        notes: `open_link=${Boolean(document.openLink)}; output_path=${outputPath || "missing"}`,
        blocker: "Openable document output link was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-09-01",
        functional: Boolean(document.fromSessionHandoff),
        ux: Boolean(document.fromSessionHandoff),
        evidence,
        notes: `from_session_handoff=${Boolean(document.fromSessionHandoff)}`,
        blocker: "Work-chat to document-authoring handoff was not proven.",
      }),
      workflowScenario({
        id: "LMUX-09-03",
        functional: Boolean(document.linkedFileUsageCaptured),
        ux: Boolean(document.linkedFileUsageCaptured),
        evidence,
        notes: `linked_file_usage=${Boolean(document.linkedFileUsageCaptured)}`,
        blocker: "Linked-file usage instructions were not proven.",
      }),
      workflowScenario({
        id: "LMUX-09-06",
        functional: Boolean(document.fullReportTypeAvailable),
        ux: Boolean(document.fullReportTypeAvailable),
        evidence,
        notes: `full_report_type=${Boolean(document.fullReportTypeAvailable)}`,
        blocker: "Full-version report type was not proven.",
      }),
      workflowScenario({
        id: "LMUX-09-07",
        functional: Boolean(document.emailTypeAvailable),
        ux: Boolean(document.emailTypeAvailable),
        evidence,
        notes: `email_type=${Boolean(document.emailTypeAvailable)}`,
        blocker: "Email output type was not proven.",
      }),
      workflowScenario({
        id: "LMUX-09-08",
        functional: Boolean(document.customTemplateSelectable),
        ux: Boolean(document.customTemplateSelectable),
        evidence,
        notes: `custom_template=${Boolean(document.customTemplateSelectable)}`,
        blocker: "Custom report template selection was not proven.",
      }),
    );
  }

  if (fileSearch) {
    const evidence = workflowEvidenceList(fileSearch);
    const linkedFileCount = Number(fileSearch.linkedFileCount || 0);
    const resultCount = Number(fileSearch.resultCount || 0);
    results.push(
      workflowScenario({
        id: "LMUX-06-02",
        functional: Boolean(fileSearch.exactSearch && resultCount > 0),
        ux: Boolean(fileSearch.resultSelected || fileSearch.previewShown),
        evidence,
        notes: `exact_search=${Boolean(fileSearch.exactSearch)}; result_count=${resultCount}`,
        blocker: "Exact filename search was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-06-03",
        functional: Boolean(fileSearch.partialSearch && resultCount > 0),
        ux: Boolean(fileSearch.resultSelected || fileSearch.previewShown),
        evidence,
        notes: `partial_search=${Boolean(fileSearch.partialSearch)}; result_count=${resultCount}`,
        blocker: "Partial filename search was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-06-04",
        functional: Boolean(fileSearch.resultSelected),
        ux: Boolean(fileSearch.previewShown),
        evidence,
        notes: `result_selected=${Boolean(fileSearch.resultSelected)}; preview=${Boolean(fileSearch.previewShown)}`,
        blocker: "File-search result card selection was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-06-05",
        functional: Boolean(fileSearch.previewShown),
        ux: Boolean(fileSearch.resultSelected),
        evidence,
        notes: `preview_shown=${Boolean(fileSearch.previewShown)}`,
        blocker: "Right-panel file preview was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-06-06",
        functional: Boolean(fileSearch.pathCopied),
        ux: Boolean(fileSearch.pathCopied),
        evidence,
        notes: `path_copied=${Boolean(fileSearch.pathCopied)}`,
        blocker: "Copy-path feedback/toast was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-06-07",
        functional: Boolean(fileSearch.linkedToSession && linkedFileCount > 0),
        ux: Boolean(linkedFileCount > 0),
        evidence,
        notes: `linked_to_session=${Boolean(fileSearch.linkedToSession)}; linked_file_count=${linkedFileCount}`,
        blocker: "File-to-session linking was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-06-08",
        functional: linkedFileCount > 0,
        ux: linkedFileCount > 0,
        evidence,
        notes: `linked_file_count=${linkedFileCount}`,
        blocker: "Linked file count display was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-06-09",
        functional: Boolean(fileSearch.linkedListClosable),
        ux: Boolean(fileSearch.linkedListClosable),
        evidence,
        notes: `linked_list_closable=${Boolean(fileSearch.linkedListClosable)}`,
        blocker: "Linked-file list close action was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-06-10",
        functional: Boolean(fileSearch.emptyStateShown),
        ux: Boolean(fileSearch.emptyStateShown),
        evidence,
        notes: `empty_state=${Boolean(fileSearch.emptyStateShown)}`,
        blocker: "No-result guidance was not proven by workflow evidence.",
      }),
    );
  }

  if (settings) {
    const evidence = workflowEvidenceList(settings);
    const apiKeyMasked = Boolean(
      settings.apiKeyMasked || (settings.uiApiKeyMasked && settings.uiApiKeyNotVisible),
    );
    results.push(
      workflowScenario({
        id: "LMUX-02-02",
        functional: Boolean(settings.ollamaBaseUrlSaved),
        ux: Boolean(settings.ollamaBaseUrlSaved),
        evidence,
        notes: `ollama_base_url_saved=${Boolean(settings.ollamaBaseUrlSaved)}`,
        blocker: "Ollama Base URL profile persistence was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-02-03",
        functional: Boolean(settings.reasoningLowRecommended),
        ux: Boolean(settings.reasoningLowRecommended),
        modelQuality: Boolean(settings.reasoningLowRecommended),
        evidence,
        notes: `reasoning_low_recommended=${Boolean(settings.reasoningLowRecommended)}`,
        blocker: "Low-reasoning lightweight-model policy was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-02-04",
        functional: Boolean(settings.thinkingTraceClean),
        ux: Boolean(settings.thinkingTraceClean),
        modelQuality: Boolean(settings.thinkingTraceClean),
        evidence,
        notes: `thinking_trace_clean=${Boolean(settings.thinkingTraceClean)}`,
        blocker: "Thinking trace suppression was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-02-05",
        functional: Boolean(settings.gemmaNoResponseGuidanceShown),
        ux: Boolean(settings.gemmaNoResponseGuidanceShown),
        modelQuality: Boolean(settings.gemmaNoResponseGuidanceShown),
        evidence,
        notes: `gemma_no_response_guidance=${Boolean(settings.gemmaNoResponseGuidanceShown)}`,
        blocker: "Gemma 4 no-response guidance was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-02-06",
        functional: Boolean(settings.featherlessActive),
        ux: Boolean(settings.activeProviderMatchesSaved),
        evidence,
        notes: `featherless_active=${Boolean(settings.featherlessActive)}; active_matches_saved=${Boolean(settings.activeProviderMatchesSaved)}`,
        blocker: "Featherless external-provider activation was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-02-07",
        functional: Boolean(settings.openRouterProfilePreserved),
        ux: Boolean(settings.openRouterProfilePreserved),
        evidence,
        notes: `openrouter_profile_preserved=${Boolean(settings.openRouterProfilePreserved)}`,
        blocker: "OpenRouter profile preservation was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-02-08",
        functional: apiKeyMasked,
        ux: apiKeyMasked,
        modelQuality: apiKeyMasked,
        evidence,
        notes: `api_key_masked=${apiKeyMasked}; ui_masked=${Boolean(settings.uiApiKeyMasked)}; ui_key_not_visible=${Boolean(settings.uiApiKeyNotVisible)}`,
        blocker: "API key masking was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-02-09",
        functional: Boolean(settings.connectionTestCompleted),
        ux: Boolean(settings.connectionTestCompleted),
        evidence,
        notes: `connection_test_completed=${Boolean(settings.connectionTestCompleted)}`,
        blocker: "Model connection-test result was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-02-10",
        functional: Boolean(settings.activeProviderMatchesSaved),
        ux: Boolean(settings.activeProviderMatchesSaved),
        evidence,
        notes: `active_provider_matches_saved=${Boolean(settings.activeProviderMatchesSaved)}`,
        blocker: "Active provider did not match saved profile evidence.",
      }),
    );
  }

  if (operations) {
    const evidence = workflowEvidenceList(operations);
    results.push(
      workflowScenario({
        id: "LMUX-10-02",
        functional: Boolean(operations.jobDetailShown),
        ux: Boolean(operations.jobDetailShown),
        evidence,
        notes: `job_detail=${Boolean(operations.jobDetailShown)}`,
        blocker: "Work-job detail events were not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-10-03",
        functional: Boolean(operations.longJobNavigationSafe),
        ux: Boolean(operations.longJobNavigationSafe),
        evidence,
        notes: `long_job_navigation_safe=${Boolean(operations.longJobNavigationSafe)}`,
        blocker: "Navigation during long-running work was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-10-05",
        functional: Boolean(operations.parallelDifferentResources),
        ux: Boolean(operations.parallelDifferentResources),
        evidence,
        notes: `parallel_different_resources=${Boolean(operations.parallelDifferentResources)}`,
        blocker: "Parallel work on different resources was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-10-04",
        functional: Boolean(operations.duplicateSameSessionBlocked),
        ux: Boolean(operations.duplicateSameSessionBlocked),
        evidence,
        notes: `duplicate_same_session_blocked=${Boolean(operations.duplicateSameSessionBlocked)}`,
        blocker: "Same-session duplicate response blocking was not proven.",
      }),
      workflowScenario({
        id: "LMUX-10-06",
        functional: Boolean(operations.cancelButtonShown),
        ux: Boolean(operations.cancelButtonShown),
        evidence,
        notes: `cancel_button=${Boolean(operations.cancelButtonShown)}`,
        blocker: "Work cancel button was not proven.",
      }),
      workflowScenario({
        id: "LMUX-10-07",
        functional: Boolean(operations.failedJobRetryGuidance),
        ux: Boolean(operations.failedJobRetryGuidance),
        evidence,
        notes: `retry_guidance=${Boolean(operations.failedJobRetryGuidance)}`,
        blocker: "Failed-job retry guidance was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-10-08",
        functional: Boolean(operations.artifactOpenable),
        ux: Boolean(operations.artifactOpenable),
        evidence,
        notes: `artifact_openable=${Boolean(operations.artifactOpenable)}`,
        blocker: "Completed-work artifact opening was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-10-09",
        functional: Boolean(operations.logCopied),
        ux: Boolean(operations.logCopied),
        evidence,
        notes: `log_copied=${Boolean(operations.logCopied)}`,
        blocker: "Work log copy action was not proven by workflow evidence.",
      }),
      workflowScenario({
        id: "LMUX-10-10",
        functional: Boolean(operations.rightPanelStable),
        ux: Boolean(operations.rightPanelStable),
        evidence,
        notes: `right_panel_stable=${Boolean(operations.rightPanelStable)}`,
        blocker: "Right-panel state after multiple jobs was not proven by workflow evidence.",
      }),
    );
  }

  return results.filter((result) =>
    shouldScoreWorkflowScenario(result.id, {
      engine,
      chat,
      routing,
      knowledgeIndexing,
      knowledge,
      document,
      settings,
      operations,
    }),
  );
}

function categoryLabelForScenario(id) {
  const prefix = String(id || "").slice(0, 7);
  return CATEGORY_LABEL_BY_PREFIX[prefix] || prefix || "기타";
}

function statusLabel(status) {
  return (
    {
      pass: "통과",
      partial: "부분 통과",
      fail: "실패",
      blocked: "차단",
      skip: "건너뜀",
      not_tested: "미실시",
    }[status] || status
  );
}

export function renderActualComputerUseScoreReport(summary) {
  const lines = [
    "# 경량모델 컴퓨터유즈 실제 점수 리포트",
    "",
    `- 실행 ID: ${summary.runId}`,
    `- 기준 모델: ${summary.modelDisplayName} (${summary.model})`,
    `- 평가 방식: ${summary.tester}`,
    `- 총점: ${summary.totalScore} / ${summary.totalMaxScore}`,
    `- 실시: ${summary.testedCount}개`,
    `- 미실시: ${summary.notTestedCount}개`,
    `- 종합 등급: ${summary.overallGrade}`,
    "",
    "## 카테고리별 점수",
    "",
    "| 카테고리 | 실시 | 점수 | 등급 |",
    "| --- | ---: | ---: | --- |",
  ];

  const categories = new Map();
  for (const scenario of summary.scenarios) {
    const label = categoryLabelForScenario(scenario.id);
    if (!categories.has(label)) {
      categories.set(label, { count: 0, tested: 0, score: 0, maxScore: 0 });
    }
    const item = categories.get(label);
    item.count += 1;
    item.maxScore += scenario.maxScore;
    if (scenario.status !== "not_tested") {
      item.tested += 1;
      item.score += scenario.score;
    }
  }

  for (const [label, item] of categories) {
    const grade =
      item.tested === 0
        ? "not-tested"
        : item.score / Math.max(1, item.tested * 10) >= 0.9
          ? "release-ready"
          : item.score / Math.max(1, item.tested * 10) >= 0.7
            ? "minor polish"
            : "needs-work";
    lines.push(`| ${label} | ${item.tested}/${item.count} | ${item.score}/${item.maxScore} | ${grade} |`);
  }

  lines.push("", "## 실시 시나리오", "");
  for (const scenario of summary.scenarios.filter((item) => item.status !== "not_tested")) {
    lines.push(`### ${scenario.id} ${categoryLabelForScenario(scenario.id)}`);
    lines.push("");
    lines.push(`- 상태: ${statusLabel(scenario.status)}`);
    lines.push(`- 점수: ${scenario.score} / ${scenario.maxScore}`);
    lines.push(`- 등급: ${scenario.grade}`);
    if (scenario.notes) {
      lines.push(`- 메모: ${scenario.notes}`);
    }
    if (scenario.blocker) {
      lines.push(`- 남은 문제: ${scenario.blocker}`);
    }
    if (scenario.evidence?.length) {
      lines.push("- 증거:");
      for (const evidence of scenario.evidence) {
        lines.push(`  - ${evidence}`);
      }
    }
    lines.push("");
  }

  lines.push("## 해석", "");
  lines.push(
    "- 이번 리포트는 Playwright 기반 실제 UI 조작으로 확인한 대표 시나리오만 점수화합니다.",
  );
  lines.push(
    "- 전체 100개 시나리오 중 미실시 항목은 남아 있으므로, 이 리포트만으로 목표 완료를 선언하지 않습니다.",
  );
  return `${lines.join("\n")}\n`;
}

export function renderActualComputerUseCoverageAudit(audit) {
  const lines = [
    "# 경량모델 컴퓨터유즈 실제 커버리지 감사",
    "",
    `- 실행 ID: ${audit.runId}`,
    `- 기준 모델: ${audit.modelDisplayName} (${audit.model})`,
    `- 완료 판정 가능: ${audit.readyForCompletion ? "예" : "아니오"}`,
    `- 실시: ${audit.testedCount} / ${audit.totalScenarios}`,
    `- 필수 실시 기준: ${audit.requiredTestedCount}`,
    `- 총점: ${audit.totalScore} / ${audit.totalMaxScore}`,
    `- 종합 등급: ${audit.overallGrade}`,
    "",
    "## 이슈",
    "",
  ];
  if (!audit.issues?.length) {
    lines.push("- 없음");
  } else {
    for (const issue of audit.issues) {
      lines.push(`- ${issue}`);
    }
  }
  lines.push("", "## 미실시 시나리오 수", "");
  lines.push(`- ${audit.notTestedIds?.length || 0}개`);
  lines.push("", "## 실패/차단 시나리오", "");
  if (!audit.failedScenarios?.length) {
    lines.push("- 없음");
  } else {
    for (const id of audit.failedScenarios) {
      lines.push(`- ${id}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function evaluateComputerUseEvidence({
  runtimePolicy = {},
  session = null,
  messages = [],
  appTitleObserved = false,
  engineHealthy = false,
  responseTimeObserved = false,
  workProgressObserved = false,
  recentContextObserved = false,
} = {}) {
  const userMessage = lastMessage(messages, "user");
  const assistantMessage = lastMessage(messages, "assistant");
  const chatEvaluation = evaluateChatSmoke({
    status: assistantMessage?.status,
    provider: assistantMessage?.provider,
    model: assistantMessage?.model,
    text: assistantMessage?.text,
  });
  const runtimeEvaluation = evaluateRuntimePolicySmoke(runtimePolicy);
  const responseTimeMs = finiteNumber(assistantMessage?.latency_ms);

  return {
    sessionCreated: Boolean(session?.id),
    userTurnObserved: Boolean(userMessage?.text),
    assistantTurnObserved: Boolean(assistantMessage?.text && assistantMessage?.status === "completed"),
    responseTimeMs,
    responseTimeObserved: Boolean(responseTimeObserved && responseTimeMs !== null),
    appTitleObserved: Boolean(appTitleObserved),
    engineHealthy: Boolean(engineHealthy),
    workProgressObserved: Boolean(workProgressObserved),
    recentContextObserved: Boolean(recentContextObserved),
    chatEvaluation,
    runtimeEvaluation,
    assistantMessage,
  };
}

export function buildComputerUseEvidenceResultSheet({
  scenarioSet,
  runtimePolicy = {},
  session = null,
  messages = [],
  appTitleObserved = false,
  engineHealthy = false,
  responseTimeObserved = false,
  workProgressObserved = false,
  recentContextObserved = false,
  screenshotPath = "",
  snapshotPath = "",
  featureSnapshots = {},
  workflowEvidence = {},
  apiEvidenceBase = "",
  runId = `computer-use-actual-${Date.now()}`,
  startedAt = nowIso(),
  completedAt = nowIso(),
} = {}) {
  const evidence = evaluateComputerUseEvidence({
    runtimePolicy,
    session,
    messages,
    appTitleObserved,
    engineHealthy,
    responseTimeObserved,
    workProgressObserved,
    recentContextObserved,
  });
  const baseEvidence = commonEvidence({ screenshotPath, snapshotPath, apiEvidenceBase });
  const settingsEvidence = commonEvidence({
    screenshotPath,
    snapshotPath,
    apiEvidenceBase,
    extra: ["http://127.0.0.1:8765/api/settings"],
  });
  const chatTraceClean =
    !evidence.chatEvaluation.detected.hasThoughtTrace &&
    !evidence.chatEvaluation.detected.hasModelMeta &&
    !evidence.chatEvaluation.detected.hasPolicyMeta;

  const scenarioResults = [
    {
      id: "LMUX-01-01",
      status: evidence.appTitleObserved && evidence.engineHealthy ? "pass" : "partial",
      scores: passScores({
        functional: evidence.engineHealthy,
        ux: evidence.appTitleObserved,
        modelQuality: evidence.runtimeEvaluation.detected?.is_lightweight,
        evidence: baseEvidence.length > 0,
      }),
      evidence: baseEvidence,
      notes: `app_title=${evidence.appTitleObserved}; engine_healthy=${evidence.engineHealthy}`,
      blocker: evidence.engineHealthy ? "" : "Engine health was not proven during computer-use run.",
    },
    {
      id: "LMUX-02-01",
      status: evidence.runtimeEvaluation.status,
      scores: evidence.runtimeEvaluation.scores,
      evidence: settingsEvidence,
      notes: `runtime_policy=${evidence.runtimeEvaluation.notes}`,
      blocker: evidence.runtimeEvaluation.status === "pass" ? "" : "Lightweight runtime policy was not fully proven.",
    },
    {
      id: "LMUX-03-01",
      status:
        evidence.sessionCreated && evidence.userTurnObserved && evidence.assistantTurnObserved
          ? "pass"
          : "partial",
      scores: passScores({
        functional: evidence.sessionCreated && evidence.userTurnObserved && evidence.assistantTurnObserved,
        ux: evidence.recentContextObserved || evidence.workProgressObserved,
        modelQuality: chatTraceClean,
        evidence: baseEvidence.length > 0,
      }),
      evidence: baseEvidence,
      notes: `session=${session?.id || "missing"}; user_turn=${evidence.userTurnObserved}; assistant_turn=${evidence.assistantTurnObserved}; recent_context=${evidence.recentContextObserved}`,
      blocker:
        evidence.sessionCreated && evidence.userTurnObserved && evidence.assistantTurnObserved
          ? ""
          : "The browser run did not prove a complete first chat turn.",
    },
    {
      id: "LMUX-03-03",
      status: evidence.assistantTurnObserved && evidence.responseTimeObserved ? "pass" : "partial",
      scores: passScores({
        functional: evidence.assistantTurnObserved,
        ux: evidence.responseTimeObserved,
        modelQuality: evidence.responseTimeMs !== null && evidence.responseTimeMs < 60_000,
        evidence: baseEvidence.length > 0,
      }),
      evidence: baseEvidence,
      notes: `latency_ms=${evidence.responseTimeMs ?? "missing"}; response_time_observed=${evidence.responseTimeObserved}`,
      blocker: evidence.responseTimeObserved ? "" : "Response-time display was not proven in the UI.",
    },
    {
      id: "LMUX-03-04",
      status: evidence.chatEvaluation.status,
      scores: evidence.chatEvaluation.scores,
      evidence: baseEvidence,
      notes: `markdown_render=${evidence.chatEvaluation.notes}`,
      blocker:
        evidence.chatEvaluation.status === "pass"
          ? ""
          : "The assistant response needs stronger Markdown structure or cleaner rendering.",
    },
    {
      id: "LMUX-03-10",
      status: chatTraceClean ? "pass" : "partial",
      scores: {
        functional: evidence.chatEvaluation.scores.functional,
        ux: evidence.chatEvaluation.scores.ux,
        modelQuality: chatTraceClean ? 2 : 0,
        evidence: baseEvidence.length > 0 ? 1 : 0,
      },
      evidence: baseEvidence,
      notes: `thought_trace=${evidence.chatEvaluation.detected.hasThoughtTrace}; model_meta=${evidence.chatEvaluation.detected.hasModelMeta}; policy_meta=${evidence.chatEvaluation.detected.hasPolicyMeta}`,
      blocker: chatTraceClean ? "" : "Assistant response exposed internal trace or model/policy meta text.",
    },
    {
      id: "LMUX-10-01",
      status: evidence.workProgressObserved ? "pass" : "partial",
      scores: passScores({
        functional: evidence.assistantTurnObserved,
        ux: evidence.workProgressObserved,
        modelQuality: evidence.runtimeEvaluation.detected?.is_lightweight,
        evidence: baseEvidence.length > 0,
      }),
      evidence: baseEvidence,
      notes: `work_progress_observed=${evidence.workProgressObserved}`,
      blocker: evidence.workProgressObserved ? "" : "Right-panel work progress was not observed.",
    },
  ];
  const featureResults = evaluateFeatureUiSnapshots(featureSnapshots);
  const workflowResults = evaluateWorkflowEvidence(workflowEvidence);
  const existingIds = new Set(scenarioResults.map((item) => item.id));
  for (const result of [...featureResults, ...workflowResults]) {
    if (!existingIds.has(result.id)) {
      scenarioResults.splice(Math.max(0, scenarioResults.length - 1), 0, result);
      existingIds.add(result.id);
    }
  }

  return {
    runId,
    tester: "playwright-computer-use",
    model: scenarioSet.model,
    modelDisplayName: scenarioSet.modelDisplayName,
    startedAt,
    completedAt,
    sourceSessionId: session?.id || "",
    scenarios: scenarioResults,
  };
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    outDir: DEFAULT_OUT_DIR,
    model: "gemma4:e2b",
    sessionId: "",
    screenshotPath: "",
    snapshotPath: "",
    featureSnapshots: {},
    featureScreenshots: {},
    workflowEvidencePath: "",
    appTitleObserved: true,
    responseTimeObserved: true,
    workProgressObserved: true,
    recentContextObserved: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--base-url" && next) {
      options.baseUrl = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      options.outDir = next;
      index += 1;
    } else if (arg === "--model" && next) {
      options.model = next;
      index += 1;
    } else if (arg === "--session-id" && next) {
      options.sessionId = next;
      index += 1;
    } else if (arg === "--screenshot" && next) {
      options.screenshotPath = next;
      index += 1;
    } else if (arg === "--snapshot" && next) {
      options.snapshotPath = next;
      index += 1;
    } else if (arg === "--feature-snapshot" && next) {
      const [name, ...rest] = next.split("=");
      options.featureSnapshots[name] = rest.join("=");
      index += 1;
    } else if (arg === "--feature-screenshot" && next) {
      const [name, ...rest] = next.split("=");
      options.featureScreenshots[name] = rest.join("=");
      index += 1;
    } else if (arg === "--workflow-evidence" && next) {
      options.workflowEvidencePath = next;
      index += 1;
    } else if (arg === "--no-app-title") {
      options.appTitleObserved = false;
    } else if (arg === "--no-response-time") {
      options.responseTimeObserved = false;
    } else if (arg === "--no-work-progress") {
      options.workProgressObserved = false;
    } else if (arg === "--no-recent-context") {
      options.recentContextObserved = false;
    }
  }
  return options;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GET ${url} failed: ${response.status} ${text}`);
  }
  return response.json();
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readFeatureSnapshots({ snapshots = {}, screenshots = {} } = {}) {
  const features = {};
  for (const [name, snapshotPath] of Object.entries(snapshots)) {
    features[name] = {
      snapshotPath,
      screenshotPath: screenshots[name] || "",
      snapshotText: fs.readFileSync(snapshotPath, "utf-8"),
    };
  }
  return features;
}

function readWorkflowEvidence(filePath) {
  if (!filePath) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

async function resolveSession(baseUrl, sessionId) {
  const sessions = await fetchJson(`${baseUrl}/api/work-sessions`);
  const items = Array.isArray(sessions?.items) ? sessions.items : [];
  if (sessionId) {
    const matched = items.find((item) => item.id === sessionId);
    if (!matched) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return matched;
  }
  if (!items.length) {
    throw new Error("No work sessions found.");
  }
  return items[0];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const scenarioSet = buildScenarioSet({ model: options.model, perCategory: 10 });
  const health = await fetchJson(`${baseUrl}/health`);
  const settings = await fetchJson(`${baseUrl}/api/settings`);
  const session = await resolveSession(baseUrl, options.sessionId);
  const messages = await fetchJson(`${baseUrl}/api/work-sessions/${session.id}/messages`);
  const runtimePolicy = settings?.defaults?.llm_runtime_policy || settings?.llm_runtime_policy || {};
  const resultSheet = buildComputerUseEvidenceResultSheet({
    scenarioSet,
    runtimePolicy,
    session,
    messages: messages?.items || [],
    appTitleObserved: options.appTitleObserved,
    engineHealthy: health?.status === "ok",
    responseTimeObserved: options.responseTimeObserved,
    workProgressObserved: options.workProgressObserved,
    recentContextObserved: options.recentContextObserved,
    screenshotPath: options.screenshotPath,
    snapshotPath: options.snapshotPath,
    featureSnapshots: readFeatureSnapshots({
      snapshots: options.featureSnapshots,
      screenshots: options.featureScreenshots,
    }),
    workflowEvidence: readWorkflowEvidence(options.workflowEvidencePath),
    apiEvidenceBase: `${baseUrl}/api/work-sessions/${session.id}`,
  });
  const summary = scoreScenarioRun({ scenarioSet, results: resultSheet });
  const audit = auditComputerUseCoverage({
    scenarioSet,
    results: resultSheet,
    minTestedCount: resultSheet.scenarios.length,
    requireAllCategories: false,
  });

  fs.mkdirSync(options.outDir, { recursive: true });
  const resultPath = path.join(options.outDir, `${ACTUAL_RESULT_BASENAME}.json`);
  const scoreJsonPath = path.join(options.outDir, `${ACTUAL_SCORE_BASENAME}.json`);
  const scoreMarkdownPath = path.join(options.outDir, `${ACTUAL_SCORE_BASENAME}.md`);
  const auditJsonPath = path.join(options.outDir, `${ACTUAL_AUDIT_BASENAME}.json`);
  const auditMarkdownPath = path.join(options.outDir, `${ACTUAL_AUDIT_BASENAME}.md`);
  writeJson(resultPath, resultSheet);
  writeJson(scoreJsonPath, summary);
  fs.writeFileSync(scoreMarkdownPath, renderActualComputerUseScoreReport(summary), "utf-8");
  writeJson(auditJsonPath, audit);
  fs.writeFileSync(auditMarkdownPath, renderActualComputerUseCoverageAudit(audit), "utf-8");

  console.log(resultPath);
  console.log(scoreJsonPath);
  console.log(scoreMarkdownPath);
  console.log(auditJsonPath);
  console.log(auditMarkdownPath);
  console.log(`scored ${summary.testedCount}/${summary.scenarios.length}: ${summary.totalScore}/${summary.totalMaxScore}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
