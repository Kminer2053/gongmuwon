import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildAuthoringDocument,
  runAuthoringRevise,
  runAuthoringStructure,
  runAuthoringStructureSync,
  AuthoringBuildValidationError,
  applyDocumentFinalize,
  applyAuthoringCustomFill,
  detectAuthoringCustomTemplate,
  patchAuthoringCustomTemplate,
  requestDocumentFinalize,
  suggestAuthoringCustomFill,
  uploadAuthoringCustomTemplate,
  type AuthoringStructureMeta,
  type CustomTemplateDetectResult,
} from "../api";
import { openExternalTarget } from "../runtime";
import {
  AUTHORING_STAGE_LABELS,
  type AuthoringTabKey,
  authoringFormatIconSrc,
  authoringFormatLabel,
  cloneAuthoringStructure,
  joinAuthoringLines,
  readStructureList,
  readStructureText,
  sanitizeAuthoringStructure,
  splitAuthoringLines,
} from "../shared/authoring";
import "../styles/documents-screen.css";
import {
  describeExcerptForDisplay,
  displayTitleForFile,
  fileNameFromPath,
  formatDurationMs,
  friendlyArtifactLabel,
  parentPathFromPath,
  relativePath,
  shortDisplayId,
} from "../shared/format";
import { describeStatus } from "../shared/labels";
import { AssetIcon, EmptyState, SectionCard } from "../shared/primitives";
import { useAppStore } from "../store";

const SIDECAR_BASE_URL = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:8765";

// F-09: 탭 재정렬 — 참고자료 → 작성 콘텐츠(편집·수정지시) → 미리보기(확인+생성) → 최종(산출물·승인·다운로드 전용)
const DOCUMENT_AUTHORING_TABS: Array<{ key: AuthoringTabKey; label: string }> = [
  { key: "references", label: "참고자료" },
  { key: "content", label: "작성 콘텐츠" },
  { key: "preview", label: "미리보기" },
  { key: "final", label: "최종" },
];

const LOCAL_ROMAN_NUMERALS = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ"];
const LOCAL_GANADA = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하"];

// W5-2: 임의형식 — 서버 4종 양식과 별개로 클라이언트에서 5번째 칩으로 노출한다
const CUSTOM_FORMAT_KEY = "custom";
const CUSTOM_FORMAT_ITEM = {
  key: CUSTOM_FORMAT_KEY,
  label: "임의형식",
  description:
    "가지고 있는 HWPX/HWTX 양식을 올려 빈칸(서식)을 채우거나 본문만 교체합니다. 표·로고·서식은 보존됩니다.",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordText(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function recordList(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

/**
 * F-13a: 서버 hwpx_writer.split_summary_sentences 와 동일 규칙의 문장 분리기.
 * 마침표(.!?)+공백을 문장 경계로 보되, 숫자 사이 마침표(소수점·"2026. 7." 날짜)는 제외한다.
 * 다문장 요약이 한 ◦줄로 뭉치는 '한 문장 한 줄' 위반을 서버·클라 동일하게 막는다.
 */
export function splitSummarySentences(text: string): string[] {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return [];
  }
  const parts: string[] = [];
  let start = 0;
  const boundary = /(?<=[.!?])\s+/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(raw)) !== null) {
    const punct = match.index >= 1 ? raw[match.index - 1] : "";
    const before = match.index >= 2 ? raw[match.index - 2] : "";
    const afterIndex = match.index + match[0].length;
    if (punct === "." && /\d/.test(before)) {
      continue; // 소수점·"2026. 7." 날짜 등 숫자 뒤 마침표는 문장 경계가 아니다
    }
    const segment = raw.slice(start, match.index).trim();
    if (segment) {
      parts.push(segment);
    }
    start = afterIndex;
  }
  const tail = raw.slice(start).trim();
  if (tail) {
    parts.push(tail);
  }
  return parts.length > 0 ? parts : [raw];
}

/**
 * M-09: 사이드카 render_preview 와 동일 규칙의 클라이언트 로컬 렌더러.
 * 구조 편집이 서버 왕복 없이 □/◦ 개조식 평문 미리보기에 즉시 반영된다.
 */
export function renderLocalAuthoringPreview(
  formatKey: string,
  structure: Record<string, unknown>,
): string {
  if (formatKey === "onePageReport") {
    const lines: string[] = [readStructureText(structure, "title")];
    const subtitle = readStructureText(structure, "subtitle");
    if (subtitle) {
      lines.push(`- ${subtitle} -`);
    }
    lines.push("", "□ 요약");
    // F-13a: 다문장 요약은 문장마다 별도 ◦ 줄로 렌더한다 (서버 structure_to_lines 와 동일)
    const summarySentences = splitSummarySentences(readStructureText(structure, "summary"));
    for (const sentence of summarySentences.length > 0 ? summarySentences : [""]) {
      lines.push(` ◦ ${sentence}`);
    }
    for (const section of readStructureList(structure, "sections")) {
      const record = asRecord(section);
      lines.push("", `□ ${recordText(record, "heading")}`);
      for (const item of recordList(record, "items")) {
        lines.push(` ◦ ${String(item ?? "")}`);
      }
      const detail = recordText(record, "detail");
      if (detail) {
        lines.push(`   - ${detail}`);
      }
      const note = recordText(record, "note");
      if (note) {
        lines.push(` ※ ${note}`);
      }
    }
    return lines.join("\n");
  }

  if (formatKey === "fullReport") {
    const lines: string[] = [readStructureText(structure, "title"), "", "□ 요약"];
    for (const summaryLine of readStructureList(structure, "summary")) {
      // F-13a: 항목 안 다문장도 문장마다 별도 ◦ 줄로 렌더한다 (서버 structure_to_lines 와 동일)
      const sentences = splitSummarySentences(String(summaryLine ?? ""));
      for (const sentence of sentences.length > 0 ? sentences : [String(summaryLine ?? "")]) {
        lines.push(` ◦ ${sentence}`);
      }
    }
    readStructureList(structure, "chapters").forEach((chapter, index) => {
      const chapterRecord = asRecord(chapter);
      const numeral = LOCAL_ROMAN_NUMERALS[Math.min(index, LOCAL_ROMAN_NUMERALS.length - 1)];
      lines.push("", `${numeral}. ${recordText(chapterRecord, "heading")}`);
      for (const section of recordList(chapterRecord, "sections")) {
        const sectionRecord = asRecord(section);
        lines.push(`□ ${recordText(sectionRecord, "heading")}`);
        for (const item of recordList(sectionRecord, "items")) {
          lines.push(` ◦ ${String(item ?? "")}`);
        }
      }
    });
    const rows = recordList(asRecord(structure.schedule), "rows");
    if (rows.length > 0) {
      lines.push("", "※ 추진 일정");
      for (const row of rows) {
        const rowRecord = asRecord(row);
        const note = recordText(rowRecord, "비고");
        const suffix = note ? ` (${note})` : "";
        lines.push(` ◦ ${recordText(rowRecord, "항목")}: ${recordText(rowRecord, "일정")}${suffix}`);
      }
    }
    return lines.join("\n");
  }

  if (formatKey === "officialMemo") {
    const lines: string[] = [
      `수신: ${readStructureText(structure, "receiver")}`,
      `제목: ${readStructureText(structure, "title")}`,
      "",
      `1. ${readStructureText(structure, "opening")}`,
      "2. 세부 사항",
    ];
    readStructureList(structure, "items").forEach((item, index) => {
      const record = asRecord(item);
      const marker = LOCAL_GANADA[Math.min(index, LOCAL_GANADA.length - 1)];
      lines.push(`  ${marker}. ${recordText(record, "text")}`);
      recordList(record, "subs").forEach((sub, subIndex) => {
        lines.push(`    ${subIndex + 1}) ${String(sub ?? "")}`);
      });
    });
    for (const attachment of readStructureList(structure, "attachments")) {
      lines.push(`붙임: ${String(attachment ?? "")}`);
    }
    lines.push("끝.");
    const sender = readStructureText(structure, "sender");
    if (sender) {
      lines.push("", sender);
    }
    return lines.join("\n");
  }

  if (formatKey === "email") {
    const lines: string[] = [`제목: ${readStructureText(structure, "subject")}`];
    const greeting = readStructureText(structure, "greeting");
    if (greeting) {
      lines.push("", greeting);
    }
    for (const paragraph of readStructureList(structure, "body_paragraphs")) {
      lines.push("", String(paragraph ?? ""));
    }
    const closing = readStructureText(structure, "closing");
    if (closing) {
      lines.push("", closing);
    }
    const signature = readStructureText(structure, "signature");
    if (signature) {
      lines.push("", signature);
    }
    return lines.join("\n");
  }

  return "";
}

// 서버 SchemaFull._filter_schedule 과 동일 규칙 — 미정/추후/TBD 행은 최종 문서에서 빠진다
const LOCAL_SCHEDULE_PENDING_PATTERN = /미정|추후|TBD/i;

/**
 * W5-1: 미리보기·빌드에 쓰는 구조를 서버 검증(pydantic)과 같은 규칙으로 정규화한다.
 * 편집기에서 입력한 원본 그대로 미리보기를 그리면 서버가 최종 문서에서 걸러내는
 * 값(빈 항목 줄, 미정 일정 행, 200자 초과 요약)이 미리보기에만 남아
 * "미리보기와 생성 문서 내용이 다른" 불일치가 생긴다. 항상 이 함수를 거친다.
 */
export function normalizeAuthoringStructureForPreview(
  formatKey: string,
  structure: Record<string, unknown>,
): Record<string, unknown> {
  const draft = sanitizeAuthoringStructure(formatKey, structure);
  if (formatKey === "onePageReport") {
    const summary = readStructureText(draft, "summary");
    if (summary.length > 200) {
      draft.summary = summary.trim().slice(0, 200);
    }
  }
  if (formatKey === "fullReport") {
    const schedule = asRecord(draft.schedule);
    const rows = recordList(schedule, "rows").filter((row) => {
      const record = asRecord(row);
      const haystack = ["항목", "일정", "비고"]
        .map((key) => recordText(record, key))
        .join(" ");
      return !LOCAL_SCHEDULE_PENDING_PATTERN.test(haystack);
    });
    if (rows.length >= 2) {
      draft.schedule = { rows };
    } else {
      delete draft.schedule;
    }
  }
  return draft;
}

// ---------------------------------------------------------------------------
// D-02: rhwp WASM 로더 + HWPX 종이 미리보기
// ---------------------------------------------------------------------------

type RhwpDocumentInstance = {
  pageCount(): number;
  renderPageSvg(page: number): string;
  free?: () => void;
};

type RhwpModule = {
  default: (options?: { module_or_path?: string }) => Promise<unknown>;
  HwpDocument: new (data: Uint8Array) => RhwpDocumentInstance;
};

let rhwpModulePromise: Promise<RhwpModule> | null = null;

function ensureMeasureTextWidth() {
  const holder = globalThis as {
    measureTextWidth?: (font: string, text: string) => number;
  };
  if (holder.measureTextWidth) {
    return;
  }
  let ctx: CanvasRenderingContext2D | null = null;
  let lastFont = "";
  holder.measureTextWidth = (font: string, text: string) => {
    if (!ctx) {
      ctx = document.createElement("canvas").getContext("2d");
    }
    if (!ctx) {
      return text.length * 12;
    }
    if (font !== lastFont) {
      ctx.font = font;
      lastFont = font;
    }
    return ctx.measureText(text).width;
  };
}

function loadRhwpModule(): Promise<RhwpModule> {
  if (!rhwpModulePromise) {
    rhwpModulePromise = (async () => {
      ensureMeasureTextWidth();
      const [mod, wasmAsset] = await Promise.all([
        import("@rhwp/core"),
        import("@rhwp/core/rhwp_bg.wasm?url"),
      ]);
      const rhwp = mod as unknown as RhwpModule;
      await rhwp.default({ module_or_path: (wasmAsset as { default: string }).default });
      return rhwp;
    })().catch((error) => {
      // 실패 시 다음 시도에서 재로딩할 수 있게 캐시를 비운다
      rhwpModulePromise = null;
      throw error;
    });
  }
  return rhwpModulePromise;
}

async function renderHwpxBytesToSvgPages(bytes: Uint8Array): Promise<string[]> {
  const rhwp = await loadRhwpModule();
  const doc = new rhwp.HwpDocument(bytes);
  try {
    const total = doc.pageCount();
    const pages: string[] = [];
    for (let page = 0; page < total; page += 1) {
      pages.push(doc.renderPageSvg(page));
    }
    return pages;
  } finally {
    doc.free?.();
  }
}

/**
 * HWPX 바이트를 rhwp 로 페이지별 SVG 렌더(흰 종이+그림자, ‹ N/총 › 페이지네이션).
 * 로딩·렌더 실패 시 오류 1줄 + fallback(텍스트 미리보기)으로 계속 사용 가능하다.
 */
function HwpxPaperViewer({
  refreshKey,
  fetchBytes,
  fallback,
  testId,
}: {
  refreshKey: string;
  fetchBytes: () => Promise<Uint8Array>;
  fallback: ReactNode;
  testId: string;
}) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const fetchBytesRef = useRef(fetchBytes);
  fetchBytesRef.current = fetchBytes;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRenderError(null);
    setPages(null);
    setPageIndex(0);
    (async () => {
      const bytes = await fetchBytesRef.current();
      const rendered = await renderHwpxBytesToSvgPages(bytes);
      if (alive) {
        setPages(rendered);
      }
    })()
      .catch((error) => {
        if (alive) {
          setRenderError(
            error instanceof Error ? error.message : "양식 미리보기 렌더링에 실패했습니다.",
          );
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const safePageIndex = pages ? Math.min(pageIndex, pages.length - 1) : 0;

  return (
    <div className="hwpx-paper-viewer" data-testid={testId}>
      <p className="hwpx-paper-viewer__note">
        근사 미리보기 — 실제 한컴오피스 서식과 다를 수 있습니다.
      </p>
      {renderError ? (
        <>
          <p className="hwpx-paper-viewer__error" data-testid={`${testId}-error`}>
            양식 미리보기를 표시하지 못했습니다: {renderError}
          </p>
          {fallback}
        </>
      ) : loading ? (
        <p className="subtle-text">양식 미리보기 준비 중…</p>
      ) : pages && pages.length > 0 ? (
        <>
          <div
            className="hwpx-paper"
            data-testid={`${testId}-page`}
            // rhwp 가 반환하는 신뢰된 SVG 문자열 렌더
            dangerouslySetInnerHTML={{ __html: pages[safePageIndex] }}
          />
          <div className="hwpx-paper-viewer__pagination">
            <button
              type="button"
              className="icon-button icon-button--sm"
              aria-label="이전 페이지"
              title={safePageIndex === 0 ? "첫 페이지입니다." : "이전 페이지"}
              disabled={safePageIndex === 0}
              onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            >
              ‹
            </button>
            <span data-testid={`${testId}-page-indicator`}>
              {safePageIndex + 1} / {pages.length}
            </span>
            <button
              type="button"
              className="icon-button icon-button--sm"
              aria-label="다음 페이지"
              title={safePageIndex >= pages.length - 1 ? "마지막 페이지입니다." : "다음 페이지"}
              disabled={safePageIndex >= pages.length - 1}
              onClick={() => setPageIndex((current) => Math.min(pages.length - 1, current + 1))}
            >
              ›
            </button>
          </div>
        </>
      ) : (
        <p className="subtle-text">표시할 페이지가 없습니다.</p>
      )}
    </div>
  );
}

// F-07: 참고자료 카드 — 파일 유형별 아이콘
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const HWP_EXTENSIONS = new Set(["hwp", "hwpx", "hwtx"]);
const TEXT_EXTENSIONS = new Set(["md", "txt", "csv", "log"]);

function referenceIconSrc(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
  if (IMAGE_EXTENSIONS.has(ext)) {
    return "/icons/action/image.svg";
  }
  if (HWP_EXTENSIONS.has(ext)) {
    return "/icons/action/doc-forward.svg";
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return "/icons/action/list.svg";
  }
  return "/icons/action/file.svg";
}

export function DocumentsScreen() {
  const {
    authoringAbortRef,
    authoringBuildHints,
    authoringBuildResult,
    authoringEditorView,
    authoringError,
    authoringFormatKey,
    authoringFormats,
    authoringInstruction,
    authoringJsonDraft,
    authoringJsonError,
    authoringMeta,
    authoringPreview,
    authoringStageEvents,
    authoringStreaming,
    authoringStructure,
    authoringStructureFormat,
    authoringTab,
    canApplyFinalize,
    chatReturnContext,
    currentFinalizeTicket,
    customDocumentTemplates,
    documentForm,
    documentSourceMode,
    documentSourceSessionId,
    documentTemplateInputRef,
    error,
    finalizeAlreadyApplied,
    finalizeForm,
    handleAction,
    lastContentBase,
    lastFinalizeRequest,
    selectedSession,
    selectedSessionFileLinks,
    sessionMessages,
    setAuthoringBuildHints,
    setAuthoringBuildResult,
    setAuthoringEditorView,
    setAuthoringError,
    setAuthoringFormatKey,
    setAuthoringInstruction,
    setAuthoringJsonDraft,
    setAuthoringJsonError,
    setAuthoringMeta,
    setAuthoringPreview,
    setAuthoringStageEvents,
    setAuthoringStreaming,
    setActiveMenu,
    setAuthoringStructure,
    setAuthoringStructureFormat,
    setAuthoringTab,
    setChatReturnContext,
    setCustomDocumentTemplates,
    setDocumentForm,
    setDocumentSourceMode,
    setDocumentSourceSessionId,
    setError,
    setFinalizeForm,
    setLastFinalizeRequest,
    setNotice,
    setSelectedSessionId,
    setSubmitting,
    snapshot,
    submitting,
  } = useAppStore();

  // F-08: 수정 지시 (반복 지시 가능, 실패는 인라인 오류 + 기존 구조 불변)
  const [reviseInstruction, setReviseInstruction] = useState("");
  const [reviseBusy, setReviseBusy] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);
  const [reviseSummary, setReviseSummary] = useState<AuthoringStructureMeta | null>(null);
  // D-02: 양식(종이) 미리보기 토글 — 미리보기 탭 / 최종 탭 각각
  const [paperPreviewEnabled, setPaperPreviewEnabled] = useState(false);
  const [finalPaperEnabled, setFinalPaperEnabled] = useState(false);

  // D-02: WASM 큰 로딩은 미리보기·최종 탭 진입 시 선로딩한다 (실패는 조용히 무시 — 토글 시 재시도)
  useEffect(() => {
    if (authoringTab === "preview" || authoringTab === "final") {
      void loadRhwpModule().catch(() => undefined);
    }
  }, [authoringTab]);

  const structureFormatKey = authoringStructureFormat || authoringFormatKey;
  // M-09 + W5-1: 편집 즉시 반영되는 클라이언트 로컬 미리보기.
  // 반드시 서버 검증과 같은 정규화를 거친 구조를 그린다 — 미리보기 = 생성될 문서 내용.
  const localPreviewText = useMemo(
    () =>
      authoringStructure
        ? renderLocalAuthoringPreview(
            structureFormatKey,
            normalizeAuthoringStructureForPreview(structureFormatKey, authoringStructure),
          )
        : "",
    [authoringStructure, structureFormatKey],
  );

  // W5-2: 임의형식(custom) 흐름 상태 — 화면 로컬 상태로 관리한다
  const isCustomFormat = authoringFormatKey === CUSTOM_FORMAT_KEY;
  const customTemplatePath = documentForm.user_template_path;
  const [customDetect, setCustomDetect] = useState<CustomTemplateDetectResult | null>(null);
  const [customFields, setCustomFields] = useState<Array<{ label: string; value: string }>>([]);
  const [customBusy, setCustomBusy] = useState<null | "detect" | "suggest" | "apply" | "patch">(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [customSuggestSummary, setCustomSuggestSummary] = useState<string | null>(null);
  const [customArtifact, setCustomArtifact] = useState<{
    path: string;
    kind: "fill" | "patch";
    note?: string;
    detail?: string;
  } | null>(null);
  const [customPaperEnabled, setCustomPaperEnabled] = useState(false);
  const customFilledCount = customFields.filter((field) => field.value.trim()).length;

  function applyAuthoringStructureResult(result: {
    format: string;
    structure: Record<string, unknown>;
    preview: string;
    meta?: AuthoringStructureMeta;
  }) {
    const structure = (result.structure ?? {}) as Record<string, unknown>;
    setAuthoringStructure(structure);
    setAuthoringStructureFormat(result.format);
    setAuthoringPreview(result.preview ?? "");
    setAuthoringMeta(result.meta ?? null);
    setAuthoringJsonDraft(JSON.stringify(structure, null, 2));
    setAuthoringJsonError(null);
  }

  async function startAuthoringStructure() {
    const sessionId =
      documentSourceMode === "session" ? documentSourceSessionId || selectedSession?.id || "" : "";
    if (documentSourceMode === "session" && !sessionId) {
      setAuthoringError("업무대화 세션 기반 작성은 세션을 먼저 선택하세요.");
      return;
    }
    const instruction = authoringInstruction.trim() || documentForm.outline.trim();
    if (documentSourceMode === "direct" && !instruction) {
      setAuthoringError("직접 작성 모드에서는 지시/개요를 먼저 입력하세요.");
      return;
    }

    const payload = {
      format: authoringFormatKey,
      instruction,
      session_id: documentSourceMode === "session" ? sessionId : null,
      reference_texts: [],
    };

    // J-04: 재실행·중단·실패 시 복원할 이전 구조/미리보기 스냅샷
    const previousSnapshot = authoringStructure
      ? {
          structure: authoringStructure,
          structureFormat: authoringStructureFormat,
          preview: authoringPreview,
          meta: authoringMeta,
          buildResult: authoringBuildResult,
          buildHints: authoringBuildHints,
        }
      : null;
    const restorePreviousSnapshot = () => {
      if (!previousSnapshot) {
        return;
      }
      setAuthoringStructure(previousSnapshot.structure);
      setAuthoringStructureFormat(previousSnapshot.structureFormat);
      setAuthoringPreview(previousSnapshot.preview);
      setAuthoringMeta(previousSnapshot.meta);
      setAuthoringJsonDraft(JSON.stringify(previousSnapshot.structure, null, 2));
      setAuthoringJsonError(null);
      setAuthoringBuildResult(previousSnapshot.buildResult);
      setAuthoringBuildHints(previousSnapshot.buildHints);
      setNotice("이전 구조를 유지했습니다.");
    };

    authoringAbortRef.current?.abort();
    const controller = new AbortController();
    authoringAbortRef.current = controller;
    setAuthoringStreaming(true);
    setAuthoringError(null);
    setAuthoringStageEvents([]);
    setAuthoringStructure(null);
    setAuthoringStructureFormat("");
    setAuthoringPreview("");
    setAuthoringMeta(null);
    setAuthoringBuildResult(null);
    setAuthoringBuildHints([]);
    setAuthoringEditorView("tree");
    setAuthoringTab("content");

    try {
      const result = await runAuthoringStructure(
        payload,
        {
          onStage: (event) => {
            setAuthoringStageEvents((current) => {
              const next =
                event.status === "done"
                  ? current.filter((item) => !(item.stage === event.stage && item.status === "start"))
                  : current;
              return [...next, event];
            });
          },
        },
        controller.signal,
      );
      applyAuthoringStructureResult(result);
      setNotice("문서 구조 초안을 생성했습니다. 작성 콘텐츠에서 검토하세요.");
    } catch (structureError) {
      if (controller.signal.aborted) {
        setAuthoringError("구조 생성을 중단했습니다.");
        restorePreviousSnapshot();
      } else {
        const message =
          structureError instanceof Error ? structureError.message : "문서 구조 생성에 실패했습니다.";
        if (message.includes("본문이 비어") || message.includes("완료 이벤트")) {
          try {
            const fallback = await runAuthoringStructureSync(payload);
            applyAuthoringStructureResult(fallback);
            setNotice("문서 구조 초안을 생성했습니다. 작성 콘텐츠에서 검토하세요.");
          } catch (fallbackError) {
            setAuthoringError(
              fallbackError instanceof Error ? fallbackError.message : "문서 구조 생성에 실패했습니다.",
            );
            restorePreviousSnapshot();
          }
        } else {
          setAuthoringError(message);
          restorePreviousSnapshot();
        }
      }
    } finally {
      setAuthoringStreaming(false);
      if (authoringAbortRef.current === controller) {
        authoringAbortRef.current = null;
      }
    }
  }

  function stopAuthoringStructure() {
    authoringAbortRef.current?.abort();
  }

  function updateAuthoringStructure(mutator: (draft: Record<string, unknown>) => void) {
    if (!authoringStructure) {
      return;
    }
    const draft = cloneAuthoringStructure(authoringStructure);
    mutator(draft);
    setAuthoringStructure(draft);
    setAuthoringJsonDraft(JSON.stringify(draft, null, 2));
    setAuthoringJsonError(null);
  }

  function applyAuthoringJsonDraft(value: string) {
    setAuthoringJsonDraft(value);
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setAuthoringStructure(parsed as Record<string, unknown>);
        setAuthoringJsonError(null);
      } else {
        setAuthoringJsonError("JSON 객체(object) 형태여야 합니다.");
      }
    } catch (parseError) {
      setAuthoringJsonError(parseError instanceof Error ? parseError.message : "JSON 구문 오류");
    }
  }

  async function submitAuthoringBuild() {
    if (!authoringStructure) {
      setAuthoringError("먼저 [구조 생성 → 검토]로 작성 콘텐츠를 만들어 주세요.");
      return;
    }
    const formatKey = authoringStructureFormat || authoringFormatKey;
    // W5-1: 미리보기와 동일한 정규화 구조를 그대로 빌드에 보낸다(미리보기 = 문서 내용)
    const sanitized = normalizeAuthoringStructureForPreview(formatKey, authoringStructure);
    const title =
      readStructureText(sanitized, "title") ||
      readStructureText(sanitized, "subject") ||
      documentForm.title.trim();
    setAuthoringBuildHints([]);
    setAuthoringError(null);
    setSubmitting(true);
    setNotice(null);
    setError(null);
    try {
      const built = await buildAuthoringDocument({
        format: formatKey,
        structure: sanitized,
        title: title || undefined,
      });
      setAuthoringBuildResult(built);
      if (built.preview) {
        setAuthoringPreview(built.preview);
      }
      setFinalizeForm({ output_name: built.finalize.body.output_name || built.content_base.title });
      setLastFinalizeRequest(null);
      setAuthoringTab("final");
      setNotice("작성 콘텐츠를 저장했습니다. 최종 탭에서 저장을 요청하세요.");
    } catch (buildError) {
      if (buildError instanceof AuthoringBuildValidationError) {
        setAuthoringBuildHints(buildError.hints);
        setAuthoringError(buildError.message);
      } else {
        setAuthoringError(buildError instanceof Error ? buildError.message : "문서 생성에 실패했습니다.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // F-08: 자연어 수정 지시 → 검증된 새 구조로 교체. 실패 시 기존 구조 불변(J-04).
  async function submitAuthoringRevise() {
    if (!authoringStructure || reviseBusy) {
      return;
    }
    const instruction = reviseInstruction.trim();
    if (!instruction) {
      setReviseError("반영할 수정 지시를 입력하세요.");
      return;
    }
    const formatKey = authoringStructureFormat || authoringFormatKey;
    setReviseBusy(true);
    setReviseError(null);
    try {
      const result = await runAuthoringRevise({
        format: formatKey,
        structure: normalizeAuthoringStructureForPreview(formatKey, authoringStructure),
        instruction,
      });
      applyAuthoringStructureResult(result);
      setReviseSummary(result.meta ?? {});
      setReviseInstruction("");
      setNotice("수정 지시를 반영했습니다. 미리보기에서 확인하세요.");
    } catch (reviseFailure) {
      // 실패 시 구조·미리보기는 그대로 유지하고 입력도 보존한다
      setReviseError(
        reviseFailure instanceof Error ? reviseFailure.message : "수정 지시 적용에 실패했습니다.",
      );
    } finally {
      setReviseBusy(false);
    }
  }

  // J-12: Ctrl+Enter 로 [지시 적용] 실행
  function handleReviseKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void submitAuthoringRevise();
    }
  }

  // D-02: 미리보기 탭 — 현재 구조를 임시 HWPX 바이트로 렌더
  async function fetchPreviewHwpxBytes(): Promise<Uint8Array> {
    const formatKey = authoringStructureFormat || authoringFormatKey;
    const response = await fetch(`${SIDECAR_BASE_URL}/api/documents/authoring/preview-hwpx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: formatKey,
        structure: normalizeAuthoringStructureForPreview(formatKey, authoringStructure ?? {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`양식 미리보기 생성에 실패했습니다. (${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  // D-02: 최종 탭 — 생성된 HWPX 산출물 파일을 서빙받아 렌더
  async function fetchFinalHwpxBytes(artifactPath: string): Promise<Uint8Array> {
    const response = await fetch(
      `${SIDECAR_BASE_URL}/api/documents/outputs/file?path=${encodeURIComponent(artifactPath)}`,
    );
    if (!response.ok) {
      throw new Error(`생성된 문서를 불러오지 못했습니다. (${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async function submitDocumentFinalizeRequest() {
    const contentBaseId = authoringBuildResult?.content_base.id ?? lastContentBase?.id;
    const contentBaseTitle = authoringBuildResult?.content_base.title ?? lastContentBase?.title ?? "문서";
    if (!contentBaseId) {
      setError("먼저 [이대로 문서 생성]으로 작성 콘텐츠를 저장해 주세요.");
      return;
    }

    const created = await handleAction(
      () =>
        requestDocumentFinalize({
          content_base_id: contentBaseId,
          output_name: finalizeForm.output_name.trim() || contentBaseTitle,
        }),
      "최종 저장 승인 요청을 보냈습니다.",
      { revealSection: "approvals", refresh: "shell" },
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
      { revealSection: "logs", refresh: "none" },
    );
    if (applied) {
      setLastFinalizeRequest(applied);
    }
  }

  // ---------------------------------------------------------------------
  // W5-2: 임의형식 — 업로드 → 양식 분석 → (폼) 값 제안·채우기 / (문서) 본문 반영
  // ---------------------------------------------------------------------

  function resetCustomFlow() {
    setCustomDetect(null);
    setCustomFields([]);
    setCustomError(null);
    setCustomSuggestSummary(null);
    setCustomArtifact(null);
    setCustomPaperEnabled(false);
  }

  async function handleCustomTemplateUpload(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }
    const uploaded = await handleAction(
      () => uploadAuthoringCustomTemplate(file),
      "임의형식 양식을 업로드했습니다. [양식 분석]으로 채울 항목을 확인하세요.",
      { revealSection: "context", refresh: "none" },
    );
    if (uploaded) {
      setCustomDocumentTemplates((current) => [
        uploaded.item,
        ...current.filter((item) => item.path !== uploaded.item.path),
      ]);
      setDocumentForm((current) => ({ ...current, user_template_path: uploaded.item.path }));
      resetCustomFlow();
    }
    if (documentTemplateInputRef.current) {
      documentTemplateInputRef.current.value = "";
    }
  }

  async function runCustomDetect() {
    if (!customTemplatePath || customBusy) {
      return;
    }
    setCustomBusy("detect");
    setCustomError(null);
    setCustomSuggestSummary(null);
    setCustomArtifact(null);
    try {
      const result = await detectAuthoringCustomTemplate({ template_path: customTemplatePath });
      setCustomDetect(result);
      setCustomFields(result.fields.map((field) => ({ label: field.label, value: field.current ?? "" })));
      setAuthoringTab("content");
      setNotice(
        result.mode === "form"
          ? `서식 필드 ${result.fields.length}개를 감지했습니다. 값을 검토·입력한 뒤 [양식에 채우기]를 누르세요.`
          : "본문 교체형 양식입니다. 지시/개요나 업무대화 내용을 입력한 뒤 [양식에 반영]을 누르세요.",
      );
    } catch (detectError) {
      setCustomError(detectError instanceof Error ? detectError.message : "양식 분석에 실패했습니다.");
    } finally {
      setCustomBusy(null);
    }
  }

  // ax buildFormFillPrompt 흐름: 라벨을 질문으로 바꿔 지시·대화에서 값을 찾고, 근거 없으면 비워 둔다
  async function runCustomFillSuggest() {
    if (customBusy || customFields.length === 0) {
      return;
    }
    setCustomBusy("suggest");
    setCustomError(null);
    try {
      const result = await suggestAuthoringCustomFill({
        template_path: customTemplatePath || undefined,
        fields: customFields.map((field) => field.label),
        instruction: authoringInstruction.trim() || documentForm.outline.trim(),
        session_id:
          documentSourceMode === "session"
            ? documentSourceSessionId || selectedSession?.id || null
            : null,
      });
      setCustomFields((current) =>
        current.map((field) =>
          result.values[field.label] ? { ...field, value: result.values[field.label] } : field,
        ),
      );
      setCustomSuggestSummary(
        `${result.matched_count}/${result.total_fields}개 값을 제안했습니다. 근거가 없는 칸은 채우지 않았습니다.`,
      );
    } catch (suggestError) {
      setCustomError(suggestError instanceof Error ? suggestError.message : "값 제안에 실패했습니다.");
    } finally {
      setCustomBusy(null);
    }
  }

  async function runCustomFillApply() {
    if (customBusy || !customTemplatePath) {
      return;
    }
    const values: Record<string, string> = {};
    for (const field of customFields) {
      if (field.value.trim()) {
        values[field.label] = field.value.trim();
      }
    }
    if (Object.keys(values).length === 0) {
      setCustomError("채울 값이 없습니다. 필드 값을 입력하거나 [값 제안]을 먼저 실행하세요.");
      return;
    }
    setCustomBusy("apply");
    setCustomError(null);
    try {
      const result = await applyAuthoringCustomFill({
        template_path: customTemplatePath,
        values,
        output_name: finalizeForm.output_name.trim() || undefined,
      });
      setCustomArtifact({
        path: result.artifact.path,
        kind: "fill",
        note: result.note,
        detail:
          `빈 필드 ${result.filled_count}개를 채웠습니다.` +
          (result.unmatched && result.unmatched.length > 0
            ? ` (매칭 실패: ${result.unmatched.join(", ")})`
            : ""),
      });
      setAuthoringTab("final");
      setNotice("양식 채우기가 끝났습니다. 최종 탭에서 산출물을 확인하세요.");
    } catch (applyError) {
      setCustomError(applyError instanceof Error ? applyError.message : "양식 채우기에 실패했습니다.");
    } finally {
      setCustomBusy(null);
    }
  }

  async function runCustomPatch() {
    if (customBusy || !customTemplatePath) {
      return;
    }
    const instruction = authoringInstruction.trim() || documentForm.outline.trim();
    const sessionId =
      documentSourceMode === "session" ? documentSourceSessionId || selectedSession?.id || "" : "";
    if (!instruction && !sessionId) {
      setCustomError("반영할 내용이 없습니다. 지시/개요를 입력하거나 업무대화 세션을 연결하세요.");
      return;
    }
    setCustomBusy("patch");
    setCustomError(null);
    try {
      const result = await patchAuthoringCustomTemplate({
        template_path: customTemplatePath,
        instruction,
        session_id: sessionId || null,
        output_name: finalizeForm.output_name.trim() || undefined,
      });
      setCustomArtifact({
        path: result.artifact.path,
        kind: "patch",
        note: result.note,
        detail: `본문 문단 ${result.applied_changes}곳을 교체했습니다.`,
      });
      setAuthoringTab("final");
      setNotice("양식 본문 반영이 끝났습니다. 최종 탭에서 산출물을 확인하세요.");
    } catch (patchError) {
      setCustomError(patchError instanceof Error ? patchError.message : "양식 반영에 실패했습니다.");
    } finally {
      setCustomBusy(null);
    }
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
    // W5-2: 서버 4종 + 임의형식(클라이언트 전용 칩)
    const selectableAuthoringFormats = [...authoringFormats, CUSTOM_FORMAT_ITEM];
    const activeAuthoringFormat =
      selectableAuthoringFormats.find((format) => format.key === authoringFormatKey) ?? null;

    const moveListItem = (list: unknown[], index: number, delta: number) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) {
        return list;
      }
      const next = [...list];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    };

    const renderListControls = (
      label: string,
      index: number,
      total: number,
      minCount: number,
      onMove: (delta: number) => void,
      onRemove: () => void,
    ) => (
      <div className="inline-actions authoring-node__controls">
        <button
          type="button"
          className="icon-button icon-button--sm"
          aria-label={`${label} 위로 이동`}
          title="위로 이동"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="icon-button icon-button--sm"
          aria-label={`${label} 아래로 이동`}
          title="아래로 이동"
          disabled={index >= total - 1}
          onClick={() => onMove(1)}
        >
          ↓
        </button>
        <button
          type="button"
          className="icon-button icon-button--sm"
          aria-label={`${label} 삭제`}
          title="삭제"
          disabled={total <= minCount}
          onClick={onRemove}
        >
          <AssetIcon src="/icons/action/close.svg" />
        </button>
      </div>
    );

    const renderOnePageEditor = (structure: Record<string, unknown>) => {
      const sections = readStructureList(structure, "sections");
      return (
        <div className="stack-form" data-testid="authoring-editor-onepage">
          <label>
            제목
            <input
              value={readStructureText(structure, "title")}
              onChange={(event) =>
                updateAuthoringStructure((draft) => {
                  draft.title = event.target.value;
                })
              }
            />
          </label>
          <label>
            부제(선택)
            <input
              value={readStructureText(structure, "subtitle")}
              onChange={(event) =>
                updateAuthoringStructure((draft) => {
                  draft.subtitle = event.target.value;
                })
              }
            />
          </label>
          <label>
            두괄식 요약
            <textarea
              rows={2}
              value={readStructureText(structure, "summary")}
              onChange={(event) =>
                updateAuthoringStructure((draft) => {
                  draft.summary = event.target.value;
                })
              }
            />
          </label>
          <div className="stack-list">
            {sections.map((section, index) => {
              const record = (section ?? {}) as Record<string, unknown>;
              return (
                <article key={`onepage-section-${index}`} className="list-card list-card--compact authoring-node">
                  <div className="authoring-node__head">
                    <label>
                      섹션 {index + 1} 제목
                      <input
                        value={typeof record.heading === "string" ? record.heading : ""}
                        onChange={(event) =>
                          updateAuthoringStructure((draft) => {
                            (readStructureList(draft, "sections")[index] as Record<string, unknown>).heading =
                              event.target.value;
                          })
                        }
                      />
                    </label>
                    {renderListControls(
                      `섹션 ${index + 1}`,
                      index,
                      sections.length,
                      2,
                      (delta) =>
                        updateAuthoringStructure((draft) => {
                          draft.sections = moveListItem(readStructureList(draft, "sections"), index, delta);
                        }),
                      () =>
                        updateAuthoringStructure((draft) => {
                          draft.sections = readStructureList(draft, "sections").filter(
                            (_, itemIndex) => itemIndex !== index,
                          );
                        }),
                    )}
                  </div>
                  <label>
                    항목(한 줄에 하나)
                    <textarea
                      rows={3}
                      value={joinAuthoringLines(record.items)}
                      onChange={(event) =>
                        updateAuthoringStructure((draft) => {
                          (readStructureList(draft, "sections")[index] as Record<string, unknown>).items =
                            splitAuthoringLines(event.target.value);
                        })
                      }
                    />
                  </label>
                </article>
              );
            })}
          </div>
          <button
            type="button"
            className="button-secondary button-with-icon"
            disabled={sections.length >= 5}
            onClick={() =>
              updateAuthoringStructure((draft) => {
                draft.sections = [...readStructureList(draft, "sections"), { heading: "새 섹션", items: [""] }];
              })
            }
          >
            <AssetIcon src="/icons/action/plus.svg" />
            섹션 추가 (2~5개)
          </button>
        </div>
      );
    };

    const renderFullReportEditor = (structure: Record<string, unknown>) => {
      const chapters = readStructureList(structure, "chapters");
      return (
        <div className="stack-form" data-testid="authoring-editor-full">
          <label>
            제목
            <input
              value={readStructureText(structure, "title")}
              onChange={(event) =>
                updateAuthoringStructure((draft) => {
                  draft.title = event.target.value;
                })
              }
            />
          </label>
          <label>
            요약(한 줄에 하나)
            <textarea
              rows={3}
              value={joinAuthoringLines(structure.summary)}
              onChange={(event) =>
                updateAuthoringStructure((draft) => {
                  draft.summary = splitAuthoringLines(event.target.value);
                })
              }
            />
          </label>
          <div className="stack-list">
            {chapters.map((chapter, chapterIndex) => {
              const chapterRecord = (chapter ?? {}) as Record<string, unknown>;
              const chapterSections = Array.isArray(chapterRecord.sections) ? chapterRecord.sections : [];
              return (
                <article key={`full-chapter-${chapterIndex}`} className="list-card list-card--compact authoring-node">
                  <div className="authoring-node__head">
                    <label>
                      장 {chapterIndex + 1} 제목
                      <input
                        value={typeof chapterRecord.heading === "string" ? chapterRecord.heading : ""}
                        onChange={(event) =>
                          updateAuthoringStructure((draft) => {
                            (readStructureList(draft, "chapters")[chapterIndex] as Record<string, unknown>).heading =
                              event.target.value;
                          })
                        }
                      />
                    </label>
                    {renderListControls(
                      `장 ${chapterIndex + 1}`,
                      chapterIndex,
                      chapters.length,
                      3,
                      (delta) =>
                        updateAuthoringStructure((draft) => {
                          draft.chapters = moveListItem(readStructureList(draft, "chapters"), chapterIndex, delta);
                        }),
                      () =>
                        updateAuthoringStructure((draft) => {
                          draft.chapters = readStructureList(draft, "chapters").filter(
                            (_, itemIndex) => itemIndex !== chapterIndex,
                          );
                        }),
                    )}
                  </div>
                  {chapterSections.map((section, sectionIndex) => {
                    const sectionRecord = (section ?? {}) as Record<string, unknown>;
                    return (
                      <div key={`full-section-${chapterIndex}-${sectionIndex}`} className="authoring-subnode">
                        <div className="authoring-node__head">
                          <label>
                            절 제목
                            <input
                              value={typeof sectionRecord.heading === "string" ? sectionRecord.heading : ""}
                              onChange={(event) =>
                                updateAuthoringStructure((draft) => {
                                  const chapterDraft = readStructureList(draft, "chapters")[chapterIndex] as Record<
                                    string,
                                    unknown
                                  >;
                                  const sectionsDraft = Array.isArray(chapterDraft.sections)
                                    ? chapterDraft.sections
                                    : [];
                                  (sectionsDraft[sectionIndex] as Record<string, unknown>).heading =
                                    event.target.value;
                                })
                              }
                            />
                          </label>
                          {renderListControls(
                            `장 ${chapterIndex + 1} 절 ${sectionIndex + 1}`,
                            sectionIndex,
                            chapterSections.length,
                            1,
                            (delta) =>
                              updateAuthoringStructure((draft) => {
                                const chapterDraft = readStructureList(draft, "chapters")[chapterIndex] as Record<
                                  string,
                                  unknown
                                >;
                                chapterDraft.sections = moveListItem(
                                  Array.isArray(chapterDraft.sections) ? chapterDraft.sections : [],
                                  sectionIndex,
                                  delta,
                                );
                              }),
                            () =>
                              updateAuthoringStructure((draft) => {
                                const chapterDraft = readStructureList(draft, "chapters")[chapterIndex] as Record<
                                  string,
                                  unknown
                                >;
                                chapterDraft.sections = (Array.isArray(chapterDraft.sections)
                                  ? chapterDraft.sections
                                  : []
                                ).filter((_, itemIndex) => itemIndex !== sectionIndex);
                              }),
                          )}
                        </div>
                        <label>
                          항목(한 줄에 하나)
                          <textarea
                            rows={2}
                            value={joinAuthoringLines(sectionRecord.items)}
                            onChange={(event) =>
                              updateAuthoringStructure((draft) => {
                                const chapterDraft = readStructureList(draft, "chapters")[chapterIndex] as Record<
                                  string,
                                  unknown
                                >;
                                const sectionsDraft = Array.isArray(chapterDraft.sections)
                                  ? chapterDraft.sections
                                  : [];
                                (sectionsDraft[sectionIndex] as Record<string, unknown>).items =
                                  splitAuthoringLines(event.target.value);
                              })
                            }
                          />
                        </label>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="button-secondary button-with-icon"
                    onClick={() =>
                      updateAuthoringStructure((draft) => {
                        const chapterDraft = readStructureList(draft, "chapters")[chapterIndex] as Record<
                          string,
                          unknown
                        >;
                        chapterDraft.sections = [
                          ...(Array.isArray(chapterDraft.sections) ? chapterDraft.sections : []),
                          { heading: "새 절", items: [""] },
                        ];
                      })
                    }
                  >
                    <AssetIcon src="/icons/action/plus.svg" />
                    절 추가
                  </button>
                </article>
              );
            })}
          </div>
          <button
            type="button"
            className="button-secondary button-with-icon"
            disabled={chapters.length >= 6}
            onClick={() =>
              updateAuthoringStructure((draft) => {
                draft.chapters = [
                  ...readStructureList(draft, "chapters"),
                  { heading: "새 장", sections: [{ heading: "새 절", items: [""] }] },
                ];
              })
            }
          >
            <AssetIcon src="/icons/action/plus.svg" />
            장 추가 (3~6개)
          </button>
        </div>
      );
    };

    const renderOfficialMemoEditor = (structure: Record<string, unknown>) => {
      const items = readStructureList(structure, "items");
      return (
        <div className="stack-form" data-testid="authoring-editor-memo">
          <label>
            제목
            <input
              value={readStructureText(structure, "title")}
              onChange={(event) =>
                updateAuthoringStructure((draft) => {
                  draft.title = event.target.value;
                })
              }
            />
          </label>
          <div className="grid-2">
            <label>
              수신
              <input
                value={readStructureText(structure, "receiver")}
                onChange={(event) =>
                  updateAuthoringStructure((draft) => {
                    draft.receiver = event.target.value;
                  })
                }
              />
            </label>
            <label>
              발신 명의(선택)
              <input
                value={readStructureText(structure, "sender")}
                onChange={(event) =>
                  updateAuthoringStructure((draft) => {
                    draft.sender = event.target.value;
                  })
                }
              />
            </label>
          </div>
          <label>
            첫 문장(관련 근거)
            <textarea
              rows={2}
              value={readStructureText(structure, "opening")}
              onChange={(event) =>
                updateAuthoringStructure((draft) => {
                  draft.opening = event.target.value;
                })
              }
            />
          </label>
          <div className="stack-list">
            {items.map((item, index) => {
              const record = (item ?? {}) as Record<string, unknown>;
              return (
                <article key={`memo-item-${index}`} className="list-card list-card--compact authoring-node">
                  <div className="authoring-node__head">
                    <label>
                      항목 {index + 1}
                      <input
                        value={typeof record.text === "string" ? record.text : ""}
                        onChange={(event) =>
                          updateAuthoringStructure((draft) => {
                            (readStructureList(draft, "items")[index] as Record<string, unknown>).text =
                              event.target.value;
                          })
                        }
                      />
                    </label>
                    {renderListControls(
                      `공문 항목 ${index + 1}`,
                      index,
                      items.length,
                      1,
                      (delta) =>
                        updateAuthoringStructure((draft) => {
                          draft.items = moveListItem(readStructureList(draft, "items"), index, delta);
                        }),
                      () =>
                        updateAuthoringStructure((draft) => {
                          draft.items = readStructureList(draft, "items").filter(
                            (_, itemIndex) => itemIndex !== index,
                          );
                        }),
                    )}
                  </div>
                  <label>
                    세부 항목(한 줄에 하나, 선택)
                    <textarea
                      rows={2}
                      value={joinAuthoringLines(record.subs)}
                      onChange={(event) =>
                        updateAuthoringStructure((draft) => {
                          (readStructureList(draft, "items")[index] as Record<string, unknown>).subs =
                            splitAuthoringLines(event.target.value);
                        })
                      }
                    />
                  </label>
                </article>
              );
            })}
          </div>
          <button
            type="button"
            className="button-secondary button-with-icon"
            onClick={() =>
              updateAuthoringStructure((draft) => {
                draft.items = [...readStructureList(draft, "items"), { text: "" }];
              })
            }
          >
            <AssetIcon src="/icons/action/plus.svg" />
            항목 추가
          </button>
          <label>
            붙임(한 줄에 하나, 선택)
            <textarea
              rows={2}
              value={joinAuthoringLines(structure.attachments)}
              onChange={(event) =>
                updateAuthoringStructure((draft) => {
                  draft.attachments = splitAuthoringLines(event.target.value);
                })
              }
            />
          </label>
        </div>
      );
    };

    const renderEmailEditor = (structure: Record<string, unknown>) => (
      <div className="stack-form" data-testid="authoring-editor-email">
        <label>
          제목(subject)
          <input
            value={readStructureText(structure, "subject")}
            onChange={(event) =>
              updateAuthoringStructure((draft) => {
                draft.subject = event.target.value;
              })
            }
          />
        </label>
        <label>
          첫인사(선택)
          <input
            value={readStructureText(structure, "greeting")}
            onChange={(event) =>
              updateAuthoringStructure((draft) => {
                draft.greeting = event.target.value;
              })
            }
          />
        </label>
        <label>
          본문 문단(한 줄에 하나)
          <textarea
            rows={6}
            value={joinAuthoringLines(structure.body_paragraphs)}
            onChange={(event) =>
              updateAuthoringStructure((draft) => {
                draft.body_paragraphs = splitAuthoringLines(event.target.value);
              })
            }
          />
        </label>
        <div className="grid-2">
          <label>
            맺음말(선택)
            <input
              value={readStructureText(structure, "closing")}
              onChange={(event) =>
                updateAuthoringStructure((draft) => {
                  draft.closing = event.target.value;
                })
              }
            />
          </label>
          <label>
            서명(선택)
            <input
              value={readStructureText(structure, "signature")}
              onChange={(event) =>
                updateAuthoringStructure((draft) => {
                  draft.signature = event.target.value;
                })
              }
            />
          </label>
        </div>
      </div>
    );

    const renderStructureEditor = () => {
      if (!authoringStructure) {
        return null;
      }
      if (structureFormatKey === "onePageReport") {
        return renderOnePageEditor(authoringStructure);
      }
      if (structureFormatKey === "fullReport") {
        return renderFullReportEditor(authoringStructure);
      }
      if (structureFormatKey === "officialMemo") {
        return renderOfficialMemoEditor(authoringStructure);
      }
      if (structureFormatKey === "email") {
        return renderEmailEditor(authoringStructure);
      }
      return (
        <p className="subtle-text">이 양식은 위계형 편집을 지원하지 않습니다. JSON 보기에서 수정하세요.</p>
      );
    };

    return (
      <SectionCard eyebrow="문서작성" title="구조 기반 HWPX 문서작성" testId="document-authoring-workspace">
        {/* W5-2: 업무대화에서 문서작성으로 넘어온 경우 — 원래 대화로 한 번에 복귀하는 칩 */}
        {chatReturnContext?.from === "documents" ? (
          <div className="chat-return-banner" data-testid="documents-chat-return-chip">
            <p className="chat-return-banner__text">
              <strong>&lsquo;{chatReturnContext.title}&rsquo;</strong> 대화에서 이동함
            </p>
            <button
              type="button"
              className="button-secondary"
              data-testid="documents-chat-return-button"
              title="이동하기 전에 보던 업무대화로 돌아갑니다"
              onClick={() => {
                setSelectedSessionId(chatReturnContext.sessionId);
                setActiveMenu("chat");
                setChatReturnContext(null);
              }}
            >
              대화로 돌아가기
            </button>
          </div>
        ) : null}
        <div className="authoring-workspace">
          <div className="authoring-side">
            <div className="authoring-side__block">
              <span className="eyebrow">출력 유형</span>
              <div className="authoring-format-grid" role="group" aria-label="출력 유형 선택">
                {selectableAuthoringFormats.map((format) => {
                  const active = authoringFormatKey === format.key;
                  return (
                    <button
                      key={format.key}
                      type="button"
                      className={`icon-button--labeled ${active ? "is-active" : ""}`}
                      aria-label={`${format.label} 선택`}
                      aria-pressed={active}
                      title={format.description}
                      onClick={() => setAuthoringFormatKey(format.key)}
                    >
                      <AssetIcon src={authoringFormatIconSrc(format.key, active)} />
                      <span className="icon-button__label">{format.label}</span>
                    </button>
                  );
                })}
              </div>
              {activeAuthoringFormat ? (
                <p className="subtle-text">{activeAuthoringFormat.description}</p>
              ) : null}
            </div>

            <div className="authoring-side__block">
              <span className="eyebrow">작성 방법</span>
              <div className="seg-control" role="group" aria-label="작성 방법 선택" data-testid="document-source-mode">
                <button
                  type="button"
                  className={`seg-control__option ${documentSourceMode === "session" ? "is-active" : ""}`}
                  aria-pressed={documentSourceMode === "session"}
                  onClick={() => {
                    setDocumentSourceMode("session");
                    const sessionId = documentSourceSessionId || selectedSession?.id || "";
                    setDocumentSourceSessionId(sessionId);
                    if (sessionId) {
                      setSelectedSessionId(sessionId);
                    }
                  }}
                >
                  업무대화 세션 기반
                </button>
                <button
                  type="button"
                  className={`seg-control__option ${documentSourceMode === "direct" ? "is-active" : ""}`}
                  aria-pressed={documentSourceMode === "direct"}
                  onClick={() => {
                    setDocumentSourceMode("direct");
                    setDocumentSourceSessionId("");
                  }}
                >
                  직접 작성
                </button>
              </div>
              {documentSourceMode === "session" ? (
                <>
                  <label className="select-field">
                    연결할 업무대화 세션
                    <select
                      value={documentSourceSessionId}
                      onChange={(event) => {
                        const nextSessionId = event.target.value;
                        setDocumentSourceSessionId(nextSessionId);
                        if (nextSessionId) {
                          setSelectedSessionId(nextSessionId);
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
                    <span>세션 대화 기록은 구조 생성 시 자동으로 불러옵니다.</span>
                  </div>
                  <label>
                    추가 지시(선택)
                    <textarea
                      rows={3}
                      maxLength={4000}
                      value={authoringInstruction}
                      onChange={(event) => setAuthoringInstruction(event.target.value)}
                      placeholder="세션 내용 외에 강조할 결론, 보고 대상 등을 적습니다."
                    />
                  </label>
                </>
              ) : (
                <label>
                  지시/개요
                  <textarea
                    rows={6}
                    maxLength={4000}
                    value={authoringInstruction}
                    onChange={(event) => setAuthoringInstruction(event.target.value)}
                    placeholder="작성 방향, 꼭 반영할 내용, 보고 대상, 강조할 결론 등을 적습니다. (최대 4000자)"
                  />
                </label>
              )}
            </div>

            <div className="authoring-side__block">
              <span className="eyebrow">참고자료</span>
              <div className="hint-box">
                <span>세션 연결 파일 {selectedDocumentSessionFileLinks.length}개</span>
                <span>
                  {documentSourceMode === "session"
                    ? "선택한 업무대화 세션에 연결된 파일을 구조 생성에 함께 사용합니다."
                    : "직접 작성 모드에서는 지시/개요 내용을 기준으로 구조를 만듭니다."}
                </span>
              </div>
            </div>

            {isCustomFormat ? (
              <div className="authoring-side__block" data-testid="custom-template-block">
                <span className="eyebrow">양식 파일</span>
                <div className="custom-template-dropzone">
                  <span className="subtle-text">
                    채울 HWPX/HWTX 양식을 올리세요. 표·로고·서식은 그대로 보존됩니다.
                  </span>
                  <input
                    ref={documentTemplateInputRef}
                    type="file"
                    accept=".hwpx,.hwtx"
                    aria-label="임의형식 양식 파일 업로드"
                    onChange={handleCustomTemplateUpload}
                  />
                </div>
                <label className="select-field">
                  업로드된 양식 선택
                  <select
                    aria-label="업로드된 양식 선택"
                    value={customTemplatePath}
                    onChange={(event) => {
                      setDocumentForm((current) => ({
                        ...current,
                        user_template_path: event.target.value,
                      }));
                      resetCustomFlow();
                    }}
                  >
                    <option value="">선택 안 함</option>
                    {customDocumentTemplates.map((template) => (
                      <option key={template.path} value={template.path}>
                        {template.file_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            <div className="authoring-side__actions">
              {isCustomFormat ? (
                <button
                  type="button"
                  className="button-with-icon"
                  onClick={() => void runCustomDetect()}
                  disabled={!customTemplatePath || customBusy !== null}
                  title={
                    !customTemplatePath
                      ? "먼저 양식 파일을 업로드하거나 선택하세요."
                      : customBusy === "detect"
                        ? "양식을 분석하는 중입니다."
                        : "양식의 빈 서식 필드를 감지해 채우기/본문 반영 흐름을 정합니다."
                  }
                >
                  <AssetIcon src="/icons/action/sparkle-inverse.svg" />
                  {customBusy === "detect" ? "분석 중…" : "양식 분석"}
                </button>
              ) : (
                <button
                  type="button"
                  className="button-with-icon"
                  onClick={() => void startAuthoringStructure()}
                  disabled={authoringStreaming || submitting}
                  title="선택한 자료를 정리해 양식 구조 초안을 만듭니다."
                >
                  <AssetIcon src="/icons/action/sparkle-inverse.svg" />
                  구조 생성 → 검토
                </button>
              )}
              {authoringStreaming ? (
                <button
                  type="button"
                  className="button-secondary button-with-icon"
                  onClick={stopAuthoringStructure}
                  title="구조 생성을 중단합니다."
                >
                  <AssetIcon src="/icons/action/stop.svg" />
                  중단
                </button>
              ) : null}
            </div>
            {authoringError ? (
              <div className="hint-box hint-box--warning" data-testid="authoring-error">
                {authoringError}
              </div>
            ) : null}
            {isCustomFormat && customError ? (
              <div className="hint-box hint-box--warning" data-testid="custom-error">
                {customError}
              </div>
            ) : null}
          </div>

          <div className="authoring-main">
            <div className="authoring-tabs" role="tablist" aria-label="문서작성 단계">
              {DOCUMENT_AUTHORING_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={authoringTab === tab.key}
                  className={`authoring-tab ${authoringTab === tab.key ? "is-active" : ""}`}
                  onClick={() => setAuthoringTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {authoringTab === "references" ? (
              <div className="stack-form" data-testid="authoring-references">
                <div className="detail-panel">
                  <p className="detail-panel__title">구조 생성 시 전송되는 자료</p>
                  {documentSourceMode === "session" ? (
                    <div className="hint-box">
                      <strong>{selectedDocumentSession?.title ?? "선택된 세션 없음"}</strong>
                      <span>
                        세션 대화 {selectedDocumentSessionMessages.length}개를 서버가 자동으로 불러와 정리합니다.
                      </span>
                    </div>
                  ) : (
                    <div className="hint-box">
                      <strong>직접 작성 지시</strong>
                      <span>{authoringInstruction.trim() || "아직 입력한 지시/개요가 없습니다."}</span>
                    </div>
                  )}
                  <h4 className="subheading">세션 연결 파일 {selectedDocumentSessionFileLinks.length}개</h4>
                  {selectedDocumentSessionFileLinks.length > 0 ? (
                    <div className="authoring-reference-cards" data-testid="authoring-reference-cards">
                      {selectedDocumentSessionFileLinks.map((link) => {
                        const fileName = fileNameFromPath(link.file_path);
                        const sourceFile =
                          snapshot.knowledgeSourceFiles.find(
                            (file) => file.file_path === link.file_path,
                          ) ?? null;
                        const excerpt = sourceFile?.text_excerpt ?? null;
                        // W7 §5.5: 발췌 조인 실패(색인에 경로 없음 또는 삭제/원본 없음 상태)는
                        // 조용히 숨기지 않고 "원본 없음" 경고 pill로 가시화한다.
                        const sourceMissing =
                          !sourceFile ||
                          sourceFile.status === "deleted" ||
                          sourceFile.status === "missing";
                        // 파싱 위계 보정: 표 첫 행/서식 보일러플레이트 제목은 파일명으로,
                        // 표 셀 나열 발췌는 "표 데이터 N행" 요약 + 접힘 원문으로 표시한다.
                        const cardTitle = displayTitleForFile(link.label, link.file_path) || fileName;
                        const excerptDisplay = describeExcerptForDisplay(excerpt);
                        return (
                          <article
                            key={link.id}
                            className="authoring-reference-card"
                            data-testid="authoring-reference-card"
                          >
                            <AssetIcon
                              src={referenceIconSrc(fileName)}
                              className="authoring-reference-card__icon"
                            />
                            <div className="authoring-reference-card__body">
                              <p className="authoring-reference-card__title">{cardTitle}</p>
                              <p className="authoring-reference-card__path">
                                {relativePath(link.file_path)}
                              </p>
                              {sourceMissing ? (
                                <span
                                  className="pill pill--warning authoring-reference-card__missing"
                                  data-testid="authoring-reference-missing"
                                  role="status"
                                  title="지식폴더 색인에서 이 경로를 찾지 못했습니다. 파일이 이동/삭제되지 않았는지 확인하세요."
                                >
                                  원본 없음 — 경로 확인 필요
                                </span>
                              ) : null}
                              {excerptDisplay ? (
                                excerptDisplay.kind === "table" ? (
                                  <details className="authoring-reference-card__excerpt authoring-reference-card__excerpt--table">
                                    <summary>
                                      표 데이터 {excerptDisplay.rowCount}행 — 첫 행: {excerptDisplay.firstRowPreview}
                                    </summary>
                                    <pre className="authoring-reference-card__excerpt-raw">{excerptDisplay.raw}</pre>
                                  </details>
                                ) : (
                                  <p className="authoring-reference-card__excerpt">{excerptDisplay.text}</p>
                                )
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="subtle-text">선택한 업무대화 세션에 연결된 파일이 없습니다.</p>
                  )}
                </div>
              </div>
            ) : null}

            {authoringTab === "content" && isCustomFormat ? (
              <div className="stack-form" data-testid="custom-content">
                {!customDetect ? (
                  <EmptyState
                    title="아직 분석한 양식이 없습니다."
                    body="왼쪽에서 HWPX/HWTX 양식을 업로드한 뒤 [양식 분석]을 실행하세요. 빈 서식 필드가 있으면 채우기, 없으면 본문 교체 흐름으로 이어집니다."
                  />
                ) : customDetect.mode === "form" ? (
                  <div className="stack-form" data-testid="custom-form-editor">
                    <div className="document-preview__meta">
                      <span className="pill">서식(폼) 양식</span>
                      <span className="pill pill--soft" data-testid="custom-fill-counter">
                        {customFilledCount}/{customFields.length} 채움
                      </span>
                    </div>
                    <p className="subtle-text">
                      각 칸에 들어갈 값을 검토·수정하세요. [값 제안]은 작성 지시와 업무대화에서 값을
                      찾아 채우며, 근거가 없는 칸은 추측하지 않고 빈칸으로 남깁니다.
                    </p>
                    {customSuggestSummary ? (
                      <div className="hint-box" data-testid="custom-suggest-summary">
                        {customSuggestSummary}
                      </div>
                    ) : null}
                    <div className="custom-field-list" data-testid="custom-field-list">
                      {customFields.map((field, index) => (
                        <label key={`${field.label}-${index}`} className="custom-field-row">
                          <span className="custom-field-row__label">{field.label}</span>
                          <input
                            aria-label={`${field.label} 값`}
                            value={field.value}
                            placeholder="비워 두면 채우지 않습니다."
                            onChange={(event) =>
                              setCustomFields((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, value: event.target.value } : item,
                                ),
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button-secondary button-with-icon"
                        onClick={() => void runCustomFillSuggest()}
                        disabled={customBusy !== null}
                        title={
                          customBusy === "suggest"
                            ? "값을 찾는 중입니다."
                            : "작성 지시·업무대화·참고자료에서 각 칸의 값을 찾아 제안합니다."
                        }
                      >
                        <AssetIcon src="/icons/action/sparkle.svg" />
                        {customBusy === "suggest" ? "제안 중…" : "값 제안"}
                      </button>
                      <button
                        type="button"
                        className="button-with-icon"
                        onClick={() => void runCustomFillApply()}
                        disabled={customBusy !== null || customFilledCount === 0}
                        title={
                          customFilledCount === 0
                            ? "채울 값을 먼저 입력하거나 [값 제안]을 실행하세요."
                            : customBusy === "apply"
                              ? "양식을 채우는 중입니다."
                              : "검토한 값으로 양식 빈칸을 채운 HWPX를 생성합니다(서식 보존)."
                        }
                      >
                        <AssetIcon src="/icons/action/check-inverse.svg" />
                        {customBusy === "apply" ? "채우는 중…" : "양식에 채우기"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="stack-form" data-testid="custom-document-panel">
                    <div className="document-preview__meta">
                      <span className="pill">본문 교체형 양식</span>
                    </div>
                    <p className="subtle-text">
                      이 양식에는 채울 서식 필드가 없습니다. 왼쪽의 지시/개요와 업무대화 내용을
                      정리해 본문 문단만 교체합니다. 표·이미지·서명란·확인문은 원본 그대로 보존됩니다.
                    </p>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button-with-icon"
                        onClick={() => void runCustomPatch()}
                        disabled={customBusy !== null}
                        title={
                          customBusy === "patch"
                            ? "본문을 반영하는 중입니다."
                            : "지시/개요와 업무대화 내용을 정리해 양식 본문에 반영합니다."
                        }
                      >
                        <AssetIcon src="/icons/action/check-inverse.svg" />
                        {customBusy === "patch" ? "반영 중…" : "양식에 반영"}
                      </button>
                    </div>
                  </div>
                )}
                {customError ? (
                  <div className="hint-box hint-box--warning" data-testid="custom-content-error">
                    {customError}
                  </div>
                ) : null}
              </div>
            ) : null}

            {authoringTab === "content" && !isCustomFormat ? (
              <div className="stack-form" data-testid="authoring-content">
                {authoringStreaming || authoringStageEvents.length > 0 ? (
                  <div className="document-preview" data-testid="authoring-stage-stream">
                    {authoringStageEvents.map((event, index) => (
                      <p key={`stage-${event.stage}-${event.status}-${index}`} className="authoring-stage-line">
                        <strong>{AUTHORING_STAGE_LABELS[event.stage] ?? event.stage}</strong>{" "}
                        {event.status === "done"
                          ? `✓ ${formatDurationMs(event.elapsed_ms ?? 0)}`
                          : "…"}
                        {event.status === "done" && typeof event.attempts === "number"
                          ? ` · 시도 ${event.attempts}회`
                          : ""}
                        {event.status === "done" && event.repaired ? " · 복구됨" : ""}
                      </p>
                    ))}
                    {authoringStreaming ? <p className="subtle-text">구조 생성 중…</p> : null}
                  </div>
                ) : null}

                {authoringStructure ? (
                  <>
                    <div className="document-preview__meta">
                      <span className="pill">{authoringFormatLabel(authoringFormats, structureFormatKey)}</span>
                      {typeof authoringMeta?.attempts === "number" ? (
                        <span className="pill pill--soft">시도 {authoringMeta.attempts}회</span>
                      ) : null}
                      {authoringMeta?.repaired ? <span className="pill pill--warning">복구됨</span> : null}
                      {(authoringMeta?.hints ?? []).map((hint) => (
                        <span key={hint} className="pill pill--warning">
                          {hint}
                        </span>
                      ))}
                    </div>
                    <div className="inline-actions" role="group" aria-label="구조 편집 보기 전환">
                      <button
                        type="button"
                        className={authoringEditorView === "tree" ? "" : "button-secondary"}
                        aria-pressed={authoringEditorView === "tree"}
                        onClick={() => setAuthoringEditorView("tree")}
                      >
                        위계형
                      </button>
                      <button
                        type="button"
                        className={authoringEditorView === "json" ? "" : "button-secondary"}
                        aria-pressed={authoringEditorView === "json"}
                        onClick={() => {
                          setAuthoringJsonDraft(JSON.stringify(authoringStructure, null, 2));
                          setAuthoringJsonError(null);
                          setAuthoringEditorView("json");
                        }}
                      >
                        JSON
                      </button>
                    </div>
                    {authoringEditorView === "tree" ? (
                      renderStructureEditor()
                    ) : (
                      <div className="stack-form">
                        {authoringJsonError ? (
                          <span className="pill pill--warning" data-testid="authoring-json-error">
                            JSON 오류: {authoringJsonError}
                          </span>
                        ) : null}
                        <label>
                          구조 JSON
                          <textarea
                            rows={16}
                            value={authoringJsonDraft}
                            onChange={(event) => applyAuthoringJsonDraft(event.target.value)}
                          />
                        </label>
                      </div>
                    )}
                    <div className="authoring-revise" data-testid="authoring-revise">
                      <span className="eyebrow">수정 지시</span>
                      {reviseSummary ? (
                        <div
                          className="document-preview__meta"
                          data-testid="authoring-revise-summary"
                        >
                          <span className="pill">지시 반영됨</span>
                          {typeof reviseSummary.attempts === "number" ? (
                            <span className="pill pill--soft">시도 {reviseSummary.attempts}회</span>
                          ) : null}
                          {reviseSummary.repaired ? (
                            <span className="pill pill--warning">기존 구조 유지</span>
                          ) : null}
                          {(reviseSummary.hints ?? []).map((hint) => (
                            <span key={hint} className="pill pill--warning">
                              {hint}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <label>
                        수정 지시 입력
                        <textarea
                          rows={2}
                          maxLength={2000}
                          value={reviseInstruction}
                          onChange={(event) => setReviseInstruction(event.target.value)}
                          onKeyDown={handleReviseKeyDown}
                          placeholder='예: "예산 섹션을 앞으로, 요약은 2문장으로"'
                        />
                      </label>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="button-with-icon"
                          disabled={reviseBusy || !reviseInstruction.trim()}
                          title={
                            reviseBusy
                              ? "수정 지시를 적용하는 중입니다."
                              : !reviseInstruction.trim()
                                ? "반영할 수정 지시를 먼저 입력하세요."
                                : "현재 구조에 수정 지시를 반영합니다. (Ctrl+Enter)"
                          }
                          onClick={() => void submitAuthoringRevise()}
                        >
                          <AssetIcon src="/icons/action/sparkle-inverse.svg" />
                          {reviseBusy ? "적용 중…" : "지시 적용"}
                        </button>
                        <span className="subtle-text">Ctrl+Enter로 바로 적용됩니다. 반복 지시할 수 있습니다.</span>
                      </div>
                      {reviseError ? (
                        <div className="hint-box hint-box--warning" data-testid="authoring-revise-error">
                          {reviseError}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : !authoringStreaming && authoringStageEvents.length === 0 ? (
                  <EmptyState
                    title="아직 작성 콘텐츠가 없습니다."
                    body="왼쪽에서 출력 유형과 작성 방법을 고른 뒤 [구조 생성 → 검토]를 실행하세요."
                  />
                ) : null}
              </div>
            ) : null}

            {authoringTab === "preview" && isCustomFormat ? (
              <div className="stack-form" data-testid="custom-preview-hint">
                <EmptyState
                  title="임의형식은 텍스트 미리보기 대신 원본 양식을 그대로 사용합니다."
                  body="작성 콘텐츠 탭에서 [양식에 채우기] 또는 [양식에 반영]을 실행하면 최종 탭에서 산출물(종이 미리보기)을 확인할 수 있습니다."
                />
              </div>
            ) : null}

            {authoringTab === "preview" && !isCustomFormat ? (
              <div className="stack-form" data-testid="authoring-preview">
                {authoringStructure || authoringPreview ? (
                  <>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button-with-icon"
                        onClick={() => void submitAuthoringBuild()}
                        disabled={submitting || !authoringStructure}
                        title={
                          !authoringStructure
                            ? "먼저 [구조 생성 → 검토]로 작성 콘텐츠를 만들어 주세요."
                            : submitting
                              ? "처리 중입니다."
                              : "검토한 구조 그대로 작성 콘텐츠 문서를 생성합니다."
                        }
                      >
                        <AssetIcon src="/icons/action/check-inverse.svg" />
                        이대로 문서 생성
                      </button>
                      <button
                        type="button"
                        className={`button-secondary button-with-icon ${paperPreviewEnabled ? "is-active" : ""}`}
                        aria-pressed={paperPreviewEnabled}
                        disabled={!authoringStructure}
                        title={
                          !authoringStructure
                            ? "구조 생성이 끝나면 양식 미리보기를 사용할 수 있습니다."
                            : paperPreviewEnabled
                              ? "텍스트 미리보기로 전환합니다."
                              : "HWPX 양식(종이) 미리보기로 전환합니다."
                        }
                        onClick={() => setPaperPreviewEnabled((current) => !current)}
                      >
                        <AssetIcon src="/icons/action/preview.svg" />
                        양식 미리보기
                      </button>
                    </div>
                    {authoringBuildHints.length > 0 ? (
                      <div className="hint-box hint-box--warning" data-testid="authoring-build-hints">
                        <strong>양식 스키마 확인 필요</strong>
                        {authoringBuildHints.map((hint) => (
                          <span key={hint}>{hint}</span>
                        ))}
                      </div>
                    ) : null}
                    {paperPreviewEnabled && authoringStructure ? (
                      <HwpxPaperViewer
                        testId="authoring-paper-preview"
                        refreshKey={`preview:${structureFormatKey}:${localPreviewText}`}
                        fetchBytes={fetchPreviewHwpxBytes}
                        fallback={
                          <pre className="authoring-preview-pre" data-testid="authoring-preview-text">
                            {localPreviewText || authoringPreview}
                          </pre>
                        }
                      />
                    ) : (
                      <pre className="authoring-preview-pre" data-testid="authoring-preview-text">
                        {localPreviewText || authoringBuildResult?.preview || authoringPreview}
                      </pre>
                    )}
                    {authoringBuildResult && localPreviewText && authoringBuildResult.preview !== localPreviewText ? (
                      <p className="subtle-text">
                        문서 생성 이후 구조가 수정되었습니다. [이대로 문서 생성]으로 다시 확정하세요.
                      </p>
                    ) : (
                      <p className="subtle-text">
                        편집 내용이 즉시 반영됩니다. 확인이 끝나면 [이대로 문서 생성]으로 확정하세요.
                      </p>
                    )}
                  </>
                ) : (
                  <EmptyState
                    title="미리보기가 없습니다."
                    body="[구조 생성 → 검토]로 작성 콘텐츠를 만들면 □/◦ 위계의 평문 미리보기가 즉시 표시됩니다."
                  />
                )}
              </div>
            ) : null}

            {authoringTab === "final" ? (
              <div className="stack-form" data-testid="authoring-final">
                {authoringBuildResult ? (
                  <div className="document-preview" data-testid="authoring-build-result">
                    <div className="document-preview__meta">
                      <span className="pill">작성 콘텐츠 생성됨</span>
                      <span>{authoringBuildResult.content_base.title}</span>
                      <span className="subtle-text">
                        {friendlyArtifactLabel(authoringBuildResult.content_base.artifact_path)}
                      </span>
                    </div>
                    <p className="subtle-text">{authoringBuildResult.finalize.note}</p>
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
                    <div className="inline-actions">
                      <button
                        type="button"
                        onClick={() => void submitDocumentFinalizeRequest()}
                        disabled={submitting}
                      >
                        최종 저장 요청
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void submitDocumentFinalizeApply()}
                        disabled={submitting || !canApplyFinalize || finalizeAlreadyApplied}
                      >
                        최종 저장 적용
                      </button>
                    </div>
                    {currentFinalizeTicket ? (
                      <p className="subtle-text">
                        승인 {shortDisplayId(currentFinalizeTicket.id, "티켓")} ·{" "}
                        {describeStatus(currentFinalizeTicket.status)} · 승인 완료 후 [최종 저장 적용]을 누르면
                        HWPX가 생성됩니다.
                      </p>
                    ) : null}
                    {lastFinalizeRequest?.artifact?.path ? (
                      <>
                        <div className="document-preview__meta" data-testid="document-generate-result">
                          <span className="pill">HWPX 생성 완료</span>
                          <span>{friendlyArtifactLabel(lastFinalizeRequest.artifact.path)}</span>
                          <button
                            type="button"
                            className="icon-button icon-button--sm"
                            aria-label="산출물 파일 열기"
                            title="파일 열기"
                            onClick={() => void openExternalTarget(lastFinalizeRequest.artifact?.path ?? "")}
                          >
                            <AssetIcon src="/icons/action/file.svg" />
                          </button>
                          <button
                            type="button"
                            className="icon-button icon-button--sm"
                            aria-label="산출물 폴더 열기"
                            title="폴더 열기"
                            onClick={() =>
                              void openExternalTarget(parentPathFromPath(lastFinalizeRequest.artifact?.path))
                            }
                          >
                            <AssetIcon src="/icons/action/folder-open.svg" />
                          </button>
                          <button
                            type="button"
                            className={`button-secondary button-with-icon ${finalPaperEnabled ? "is-active" : ""}`}
                            aria-pressed={finalPaperEnabled}
                            title={
                              finalPaperEnabled
                                ? "양식 미리보기를 닫습니다."
                                : "생성된 HWPX를 양식(종이) 미리보기로 확인합니다."
                            }
                            onClick={() => setFinalPaperEnabled((current) => !current)}
                          >
                            <AssetIcon src="/icons/action/preview.svg" />
                            양식 미리보기
                          </button>
                        </div>
                        {finalPaperEnabled ? (
                          <HwpxPaperViewer
                            testId="final-paper-preview"
                            refreshKey={`final:${lastFinalizeRequest.artifact.path}`}
                            fetchBytes={() =>
                              fetchFinalHwpxBytes(lastFinalizeRequest.artifact?.path ?? "")
                            }
                            fallback={
                              <p className="subtle-text">
                                [파일 열기]로 한컴오피스에서 직접 확인할 수 있습니다.
                              </p>
                            }
                          />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
                {customArtifact ? (
                  <div className="document-preview" data-testid="custom-artifact-result">
                    <div className="document-preview__meta">
                      <span className="pill">
                        {customArtifact.kind === "fill" ? "양식 채우기 완료" : "양식 본문 반영 완료"}
                      </span>
                      <span>{friendlyArtifactLabel(customArtifact.path)}</span>
                      <button
                        type="button"
                        className="icon-button icon-button--sm"
                        aria-label="산출물 파일 열기"
                        title="파일 열기"
                        onClick={() => void openExternalTarget(customArtifact.path)}
                      >
                        <AssetIcon src="/icons/action/file.svg" />
                      </button>
                      <button
                        type="button"
                        className="icon-button icon-button--sm"
                        aria-label="산출물 폴더 열기"
                        title="폴더 열기"
                        onClick={() => void openExternalTarget(parentPathFromPath(customArtifact.path))}
                      >
                        <AssetIcon src="/icons/action/folder-open.svg" />
                      </button>
                      <button
                        type="button"
                        className={`button-secondary button-with-icon ${customPaperEnabled ? "is-active" : ""}`}
                        aria-pressed={customPaperEnabled}
                        title={
                          customPaperEnabled
                            ? "양식 미리보기를 닫습니다."
                            : "생성된 HWPX를 양식(종이) 미리보기로 확인합니다."
                        }
                        onClick={() => setCustomPaperEnabled((current) => !current)}
                      >
                        <AssetIcon src="/icons/action/preview.svg" />
                        양식 미리보기
                      </button>
                    </div>
                    {customArtifact.detail ? (
                      <p className="subtle-text" data-testid="custom-artifact-detail">
                        {customArtifact.detail}
                      </p>
                    ) : null}
                    {customArtifact.note ? <p className="subtle-text">{customArtifact.note}</p> : null}
                    {customPaperEnabled ? (
                      <HwpxPaperViewer
                        testId="custom-paper-preview"
                        refreshKey={`custom:${customArtifact.path}`}
                        fetchBytes={() => fetchFinalHwpxBytes(customArtifact.path)}
                        fallback={
                          <p className="subtle-text">
                            [파일 열기]로 한컴오피스에서 직접 확인할 수 있습니다.
                          </p>
                        }
                      />
                    ) : null}
                  </div>
                ) : null}
                {!authoringBuildResult && !customArtifact ? (
                  <p className="subtle-text" data-testid="authoring-final-empty">
                    생성된 문서가 여기에 표시됩니다.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </SectionCard>
    );
  }

  return renderDocumentSection();
}
