import { useEffect, useState, type FormEvent } from "react";
import {
  applyTaxonomy,
  askKnowledge,
  bulkResolveTaxonomyQueue,
  cancelKnowledgeIngestionJob,
  confirmTaxonomy,
  fetchTaxonomyInterview,
  fetchTaxonomyProposal,
  fetchTaxonomyQuality,
  fetchTaxonomyQueue,
  fetchTaxonomyStatus,
  applyRecommendedVocabCandidates,
  decideVocabCandidate,
  fetchVocabCandidates,
  fetchVocabSummary,
  importVocabPack,
  removeVocabPack,
  createWorkSession,
  deleteWikiTopic,
  fetchWikiPage,
  fetchWikiTree,
  fetchKnowledgeVerifyLatest,
  mergeWikiTopic,
  resolveTaxonomyQueueItem,
  saveTaxonomyInterview,
  startKnowledgeEnrich,
  startKnowledgeVerify,
  createKnowledgeSource,
  diffKnowledgeSource,
  ingestKnowledgeSource,
  reindexKnowledgeSource,
  loadKnowledgeDocumentStructure,
  loadKnowledgeTables,
  mergeWorkspaceSnapshot,
  searchKnowledge,
  scanKnowledgeSource,
  runKnowledgeIngestionJob,
  type ConfirmedTaxonomyArea,
  type KnowledgeIngestionJobItem,
  type KnowledgeSearchItem,
  type KnowledgeSourceDiffResult,
  type KnowledgeSourceItem,
  type KnowledgeSourceScanResult,
  type KnowledgeVerifyCheckItem,
  type KnowledgeVerifyLatestResult,
  type KnowledgeVocabCandidateDecisionPayload,
  type KnowledgeVocabCandidateItem,
  type KnowledgeVocabPackImportResult,
  type KnowledgeVocabSummary,
  type KnowledgeVocabTopicItem,
  type LocalFileSearchResult,
  type TaxonomyConfirmResult,
  type TaxonomyProposalResult,
  type TaxonomyQualityItem,
  type TaxonomyQualityResult,
  type TaxonomyQueueItem,
  type TaxonomyStatusResult,
  type WorkJobItem,
} from "../api";
import { copyTextToClipboard, openExternalTarget, pickDirectory } from "../runtime";
import {
  describeExcerptForDisplay,
  displayTitleForFile,
  formatDateTime,
  hasOutlineHierarchy,
  relativePath,
  shortDisplayId,
  splitOutlineDisplayLines,
} from "../shared/format";
import {
  chunkQualityLabel,
  describeExtractionQualityWarning,
  describeIngestionJobStatus,
  describeKnowledgeSearchEngine,
  describeKnowledgeSourceStatus,
  extractionQualityMetricLabel,
  extractionQualityWarningLabel,
  extractionQualityWarnings,
  ingestionProgressPercent,
  ingestionRuntimeLabel,
  ingestionStageIndex,
  ingestionStageLabel,
  KNOWLEDGE_INGESTION_STAGE_LABELS,
  splitIngestionErrors,
} from "../shared/labels";
import { renderMarkdownContent } from "../shared/markdown";
import { AssetIcon, EmptyState, LlmSetupNotice, SectionCard } from "../shared/primitives";
import { useAppStore, type KnowledgeWorkspacePanel } from "../store";
import "../styles/knowledge-screen.css";

type KnowledgeSearchMode = "keyword" | "ask";

const KNOWLEDGE_QUERY_HISTORY_LIMIT = 8;

/**
 * 사용자 피드백(2026-07) 탭 3개 체계 — [대시보드] [위키] [설정].
 * store의 knowledgePanel 키는 다른 파일(store 색인 자동 갱신, ContextPane 색인 상세 로그 탭)에서
 * 참조되므로 키는 그대로 두고 라벨만 바꾼다: "indexing" → 설정, "wiki" → 위키(검색 통합).
 * 구 "search" 키는 위키 탭으로 정규화한다(호환 리다이렉트).
 */
const KNOWLEDGE_SCREEN_TABS: ReadonlyArray<{
  key: KnowledgeWorkspacePanel;
  label: string;
  description: string;
  iconSrc: string;
}> = [
  { key: "dashboard", label: "대시보드", description: "설정 상태를 유형별로 한눈에", iconSrc: "/icons/panel-context.png" },
  { key: "wiki", label: "위키", description: "지식 검색과 지식위키 열람", iconSrc: "/icons/menu-knowledge.png" },
  { key: "indexing", label: "설정", description: "지식폴더 지정, 위키 구성, 색인 실행", iconSrc: "/icons/panel-dump.png" },
];

/** 설정 탭 안의 그룹 앵커 id — 대시보드 [설정으로] 버튼이 해당 그룹으로 스크롤한다. */
const KNOWLEDGE_SETTINGS_ANCHORS = {
  sources: "knowledge-settings-sources",
  taxonomy: "knowledge-settings-taxonomy",
  indexing: "knowledge-settings-indexing",
  enrich: "knowledge-settings-enrich",
  verify: "knowledge-settings-verify",
} as const;

/** diff 견적의 변경 합계(추가+수정+이동+삭제). 0이면 "색인이 최신" 분기. */
function diffChangedTotal(result: KnowledgeSourceDiffResult): number {
  return result.added + result.modified + result.moved + result.deleted;
}

/** 견적 카드 요약 한 줄: "추가 N · 수정 N · 이동 N · 삭제 N · 변경없음 N (보류 N)" — 보류 0이면 괄호 생략. */
function diffSummaryLine(result: KnowledgeSourceDiffResult): string {
  const base = `추가 ${result.added} · 수정 ${result.modified} · 이동 ${result.moved} · 삭제 ${result.deleted} · 변경없음 ${result.unchanged}`;
  return result.unstable > 0 ? `${base} (보류 ${result.unstable})` : base;
}

/** rehash 견적 바이트를 사용자 표기용 MB 문자열로 바꾼다(1MB 미만은 소수 첫째 자리). */
function formatRehashMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb > 0 && mb < 0.1) {
    return "0.1MB 미만";
  }
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10}MB`;
}

// ---------------------------------------------------------------------------
// P3 §6: 무결성 점검(verify) 결과 표시 헬퍼
// ---------------------------------------------------------------------------

/** 검사 한 건의 잔여(확인 필요) 건수 — 자동 치유되지 못한 분량. */
function verifyCheckRemaining(check: KnowledgeVerifyCheckItem): number {
  return Math.max(0, check.count - check.healed);
}

/** 확인 필요 총 건수(자동 수리로 해소되지 않은 잔여분 합계). */
function verifyAttentionTotal(result: KnowledgeVerifyLatestResult): number {
  return result.checks.reduce((sum, check) => sum + verifyCheckRemaining(check), 0);
}

/** 자동 수리 총 건수. */
function verifyHealedTotal(result: KnowledgeVerifyLatestResult): number {
  return result.checks.reduce((sum, check) => sum + Math.max(0, check.healed), 0);
}

/** "오늘"/"N일 전" 표기 — 대시보드 정합성 카드용. 파싱 실패 시 null. */
function verifyDaysAgoLabel(ranAt: string): string | null {
  const ranAtMs = new Date(ranAt).getTime();
  if (Number.isNaN(ranAtMs)) {
    return null;
  }
  const days = Math.floor((Date.now() - ranAtMs) / (24 * 60 * 60 * 1000));
  if (days <= 0) {
    return "오늘";
  }
  return `${days}일 전`;
}

/** 내부 상태값(raw) 노출 금지: shared 헬퍼가 다루지 않는 실패 상태를 한국어로 보정한다. */
function ingestionJobStatusLabel(job: KnowledgeIngestionJobItem) {
  if (job.status === "failed") {
    return "실패";
  }
  return describeIngestionJobStatus(job);
}

/**
 * 파싱 발췌 표시 보정 — 표 셀 나열 원문("판매금액 (-) 판매금액 (-) …")은
 * "표 데이터 N행 — 첫 행: …" 요약 + 접힘 원문으로, 개조식/마크다운 위계(□ ◦ - , ###)는
 * 줄 단위 들여쓰기로 렌더한다. 일반 한 줄 문장은 기존과 동일하게 그대로 표시한다.
 */
function ParsedExcerpt({ text, label }: { text?: string | null; label?: string }) {
  const display = describeExcerptForDisplay(text);
  if (!display) {
    return null;
  }
  if (display.kind === "table") {
    return (
      <details className="parsed-excerpt parsed-excerpt--table">
        <summary>
          {label ? `${label}: ` : ""}표 데이터 {display.rowCount}행 — 첫 행: {display.firstRowPreview}
        </summary>
        <pre className="parsed-excerpt__raw">{display.raw}</pre>
      </details>
    );
  }
  const lines = splitOutlineDisplayLines(display.text);
  if (!hasOutlineHierarchy(lines)) {
    return (
      <p className="subtle-text">
        {label ? `${label}: ` : ""}
        {display.text}
      </p>
    );
  }
  return (
    <div className="parsed-excerpt">
      {label ? <span className="parsed-excerpt__label">{label}</span> : null}
      {lines.map((line, index) => (
        <p
          key={`${index}-${line.text.slice(0, 12)}`}
          className={[
            "parsed-excerpt__line",
            `parsed-excerpt__line--d${line.depth}`,
            line.kind === "heading" ? "parsed-excerpt__line--heading" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// F-18: 위키 페이지 가독성 템플릿 — front matter 파싱 + 페이지 유형별 섹션 분해
// ---------------------------------------------------------------------------

type WikiFrontMatterValue = string | number | boolean | string[];

type WikiParsedPage = {
  meta: Record<string, WikiFrontMatterValue>;
  /** front matter 블록을 제거한 본문(마크다운) */
  body: string;
};

/** front matter(--- 블록)를 파싱해 본문에서 숨긴다. 블록이 없으면 meta={}, body는 원문 그대로. */
function parseWikiFrontMatter(content: string): WikiParsedPage {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { meta: {}, body: normalized };
  }
  const meta: Record<string, WikiFrontMatterValue> = {};
  for (const line of match[1].split("\n")) {
    const fieldMatch = line.match(/^([A-Za-z0-9_]+):\s?(.*)$/);
    if (!fieldMatch) {
      continue;
    }
    const key = fieldMatch[1];
    const rawValue = fieldMatch[2].trim();
    if (rawValue.startsWith("[")) {
      try {
        const parsed = JSON.parse(rawValue);
        meta[key] = Array.isArray(parsed) ? parsed.map(String) : rawValue;
        continue;
      } catch {
        meta[key] = rawValue;
        continue;
      }
    }
    if (rawValue === "true" || rawValue === "false") {
      meta[key] = rawValue === "true";
      continue;
    }
    if (rawValue !== "" && !Number.isNaN(Number(rawValue))) {
      meta[key] = Number(rawValue);
      continue;
    }
    meta[key] = rawValue;
  }
  return { meta, body: normalized.slice(match[0].length) };
}

function wikiMetaString(meta: Record<string, WikiFrontMatterValue>, key: string): string | null {
  const value = meta[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function wikiMetaList(meta: Record<string, WikiFrontMatterValue>, key: string): string[] {
  const value = meta[key];
  return Array.isArray(value) ? value.filter((item) => item.trim().length > 0) : [];
}

type WikiPageSection = {
  heading: string;
  level: number;
  lines: string[];
};

type WikiParsedBody = {
  /** 본문 최상단 "# 제목" 라인(있다면) */
  title: string | null;
  /** "## 섹션" 단위로 분해한 목록(순서 보존) */
  sections: WikiPageSection[];
};

/** 본문 텍스트를 "# 제목" + "## 섹션" 단위로 분해한다. 헤딩이 전혀 없으면 sections가 비어 있다. */
function parseWikiBodySections(body: string): WikiParsedBody {
  const lines = body.split("\n");
  let title: string | null = null;
  const sections: WikiPageSection[] = [];
  let current: WikiPageSection | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1 && title === null) {
      title = h1[1].trim();
      continue;
    }
    const heading = line.match(/^(##{1,3})\s+(.*)$/);
    if (heading) {
      current = { heading: heading[2].trim(), level: heading[1].length, lines: [] };
      sections.push(current);
      continue;
    }
    if (current) {
      current.lines.push(rawLine);
    }
  }

  return { title, sections };
}

function findWikiSection(sections: WikiPageSection[], heading: string): WikiPageSection | null {
  return sections.find((section) => section.heading === heading) ?? null;
}

function wikiSectionText(section: WikiPageSection | null): string {
  if (!section) {
    return "";
  }
  return section.lines.join("\n").trim();
}

/** "- [제목](경로) — 설명 · 원본: 경로" / "- [제목](경로) · 원본: 경로" 형태의 목록 줄에서 링크 카드를 추출한다. */
function parseWikiLinkItems(section: WikiPageSection | null): Array<{ label: string; target: string; detail: string }> {
  if (!section) {
    return [];
  }
  const items: Array<{ label: string; target: string; detail: string }> = [];
  for (const rawLine of section.lines) {
    const line = rawLine.trim();
    const linkMatch = line.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)\s*(.*)$/);
    if (!linkMatch) {
      continue;
    }
    items.push({
      label: linkMatch[1].trim(),
      target: linkMatch[2].trim(),
      detail: linkMatch[3].replace(/^[—·-]\s*/, "").trim(),
    });
  }
  return items;
}

/** Wave D F-09: 레벨2 섹션과 그 하위(### 소주제) 섹션을 하나의 마크다운으로 재조립한다.
 * parseWikiBody가 ###도 독립 섹션으로 쪼개므로, '핵심 내용' 같은 종합 섹션을
 * 통째로 renderMarkdownContent에 넘기려면 다음 레벨2 헤딩 전까지 이어붙여야 한다. */
function collectWikiSectionMarkdown(sections: WikiPageSection[], heading: string): string {
  const start = sections.findIndex((section) => section.heading === heading && section.level === 2);
  if (start < 0) {
    return "";
  }
  const parts: string[] = [...sections[start].lines];
  for (let index = start + 1; index < sections.length; index += 1) {
    const section = sections[index];
    if (section.level <= 2) {
      break;
    }
    parts.push(`${"#".repeat(section.level)} ${section.heading}`, ...section.lines);
  }
  return parts.join("\n").trim();
}

/** 섹션 아웃라인("- 제목" 목록, 들여쓰기로 레벨 표현)을 트리 없이 평탄한 목록으로 추출한다. */
function parseWikiOutlineItems(section: WikiPageSection | null): string[] {
  if (!section) {
    return [];
  }
  return section.lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter((line) => line && line !== "(섹션 없음)");
}

/** 마법사 표시용: 폴더명 앞의 중요도 마커(□주요□/★ 등)를 떼어 원문 노출을 막는다.
 * 매칭·저장은 원문 폴더명을 그대로 쓰고 표시만 정리한다 (2026-07-08 리뷰). */
function cleanFolderLabel(folder: string): string {
  const cleaned = folder
    .replace(/^[\s□■▣◆◇★☆▶▷·]*(?:주요|중요|참고|기타)[\s□■▣◆◇★☆·]*/u, "")
    .trim();
  return cleaned || folder;
}

type WikiPageKind = "docs" | "topics" | "work" | null;

/** 경로 접두사로 페이지 유형을 추정한다(문서 카드/주제/업무 기록). index나 그 외 경로는 null(기존 트리/폴백 유지). */
function inferWikiPageKind(relativePathValue: string): WikiPageKind {
  const normalized = relativePathValue.replace(/\\/g, "/").replace(/^\.\//, "");
  if (/^docs\//.test(normalized)) {
    return "docs";
  }
  if (/^topics\//.test(normalized)) {
    return "topics";
  }
  if (/^works?\//.test(normalized)) {
    return "work";
  }
  return null;
}

/**
 * F-18 템플릿 컴포넌트에 필요한 콜백 묶음.
 * 컴포넌트를 모듈 최상단(KnowledgeScreen 밖)에 두어 매 렌더마다 새 컴포넌트 타입으로
 * 재생성되어 하위 트리가 통째로 리마운트되는 것을 막는다(불필요한 DOM 교체·포커스 유실 방지).
 */
type WikiTemplateActions = {
  openWikiTarget: (target: string) => void;
  askAboutPage: (title: string) => void;
  searchRelated: (title: string) => void;
  openSource: (sourcePath: string) => void;
  copySource: (sourcePath: string) => void;
  /** 주제 상세 관리(2026-07-12 UX): 다른 어휘집 주제로 병합. 미제공 시 관리 UI 숨김. */
  mergeTopic?: (topic: string, intoTopicId: string, intoTopicName: string) => void;
  /** 주제 상세 관리(2026-07-12 UX): 주제 삭제(차단). 미제공 시 관리 UI 숨김. */
  deleteTopic?: (topic: string) => void;
};

type WikiTemplateProps = {
  meta: Record<string, WikiFrontMatterValue>;
  parsedBody: WikiParsedBody;
  fallbackContent: string;
  actions: WikiTemplateActions;
};

/** F-18: 위키 문서 헤더 공통 액션 — 원본 열기/경로 복사 + J-09 질문하기/관련 검색. */
function WikiPageHeaderActions({
  title,
  sourcePath,
  actions,
}: {
  title: string;
  sourcePath: string | null;
  actions: WikiTemplateActions;
}) {
  return (
    <div className="inline-actions wiki-template__header-actions">
      <button
        type="button"
        className="icon-button icon-button--sm"
        aria-label={`${title} 원본 열기`}
        title={sourcePath ? "원본 열기" : "원본 경로 정보가 없습니다."}
        disabled={!sourcePath}
        onClick={() => sourcePath && actions.openSource(sourcePath)}
      >
        <AssetIcon src="/icons/action/folder-open.svg" />
      </button>
      <button
        type="button"
        className="icon-button icon-button--sm"
        aria-label={`${title} 경로 복사`}
        title={sourcePath ? "경로 복사" : "원본 경로 정보가 없습니다."}
        disabled={!sourcePath}
        onClick={() => sourcePath && actions.copySource(sourcePath)}
      >
        <AssetIcon src="/icons/action/copy.svg" />
      </button>
      <button type="button" className="button-secondary button-with-icon" onClick={() => actions.askAboutPage(title)}>
        <AssetIcon src="/icons/action/question.svg" />
        이 문서로 질문하기
      </button>
      <button
        type="button"
        className="button-secondary button-with-icon"
        onClick={() => actions.searchRelated(title)}
      >
        <AssetIcon src="/icons/action/search.svg" />
        관련 검색
      </button>
    </div>
  );
}

/** F-18: docs/ 문서 카드 페이지 템플릿 — 메타 헤더 → 개요 하이라이트 → 접이식 섹션 아웃라인 → 키워드 칩 → 관련 카드 그리드. */
function DocsWikiTemplate({ meta, parsedBody, fallbackContent, actions }: WikiTemplateProps) {
  const title = wikiMetaString(meta, "title") ?? parsedBody.title;
  const overviewSection = findWikiSection(parsedBody.sections, "개요");
  if (!title || !overviewSection) {
    // 비정형 문서 카드(메타/개요 파싱 실패) — 오류 노출 없이 기존 마크다운 렌더로 폴백한다.
    return <div className="chat-markdown">{renderMarkdownContent(fallbackContent, actions.openWikiTarget)}</div>;
  }
  const sourcePath = wikiMetaString(meta, "source_path");
  const docType = wikiMetaString(meta, "doc_type");
  const mtime = wikiMetaString(meta, "mtime");
  const qualityScoreRaw = meta.quality_score;
  const qualityScore = typeof qualityScoreRaw === "number" ? qualityScoreRaw : null;
  const keywordsSection = findWikiSection(parsedBody.sections, "키워드");
  const keywords = keywordsSection
    ? wikiSectionText(keywordsSection)
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean)
    : [];
  const outlineItems = parseWikiOutlineItems(findWikiSection(parsedBody.sections, "섹션 아웃라인"));
  const topicLinks = parseWikiLinkItems(findWikiSection(parsedBody.sections, "주제"));
  const relatedWorkLinks = parseWikiLinkItems(findWikiSection(parsedBody.sections, "관련 업무 기록"));
  const summarySection = findWikiSection(parsedBody.sections, "LLM 요약");

  return (
    <div className="wiki-template wiki-template--docs" data-testid="wiki-template-docs">
      <header className="wiki-template__header">
        <h2 className="wiki-template__title">{title}</h2>
        <div className="wiki-template__badges">
          {docType ? <span className="pill">{docType}</span> : null}
          {mtime ? <span className="pill pill--soft">일자 {mtime.slice(0, 10)}</span> : null}
          {qualityScore !== null ? (
            <span className={qualityScore < 0.6 ? "pill pill--warning" : "pill pill--soft"}>
              품질 {Math.round(qualityScore * 100)}%
            </span>
          ) : null}
        </div>
        <WikiPageHeaderActions title={title} sourcePath={sourcePath} actions={actions} />
      </header>

      <div className="wiki-template__highlight" data-testid="wiki-template-overview">
        <span className="wiki-template__highlight-label">개요</span>
        <p>{wikiSectionText(overviewSection)}</p>
      </div>

      {summarySection ? (
        <div className="wiki-template__highlight wiki-template__highlight--soft">
          <span className="wiki-template__highlight-label">LLM 요약</span>
          <p>{wikiSectionText(summarySection)}</p>
        </div>
      ) : null}

      {outlineItems.length > 0 ? (
        <details className="knowledge-detail-section">
          <summary>섹션 아웃라인 {outlineItems.length}개</summary>
          <ul className="wiki-template__outline">
            {outlineItems.map((item, index) => (
              <li key={`outline-${index}`}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {keywords.length > 0 ? (
        <div className="wiki-template__chips" aria-label="키워드">
          {keywords.map((keyword) => (
            <span key={keyword} className="wiki-template__chip">
              {keyword}
            </span>
          ))}
        </div>
      ) : null}

      {topicLinks.length > 0 || relatedWorkLinks.length > 0 ? (
        <div className="wiki-template__grid">
          {topicLinks.map((link) => (
            <button
              key={`topic-${link.target}`}
              type="button"
              className="wiki-template__card"
              onClick={() => actions.openWikiTarget(link.target)}
            >
              <span className="pill pill--soft">관련 주제</span>
              <strong>{link.label}</strong>
            </button>
          ))}
          {relatedWorkLinks.map((link) => (
            <button
              key={`work-${link.target}`}
              type="button"
              className="wiki-template__card"
              onClick={() => actions.openWikiTarget(link.target)}
            >
              <span className="pill pill--soft">업무 기록</span>
              <strong>{link.label}</strong>
              {link.detail ? <p className="subtle-text">{link.detail}</p> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 주제 상세 관리(2026-07-12 UX): 재분류(어휘집 주제로 병합)·삭제 컨트롤.
 * 병합 대상 셀렉트는 마운트 시 결합 어휘집(enabled만)을 1회 조회해 채운다. */
function TopicWikiManageActions({
  topic,
  onMerge,
  onDelete,
}: {
  topic: string;
  onMerge: (intoTopicId: string, intoTopicName: string) => void;
  onDelete: () => void;
}) {
  const [vocabTopics, setVocabTopics] = useState<KnowledgeVocabTopicItem[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const summary = await fetchVocabSummary();
        if (active) {
          setVocabTopics(summary.topics.filter((item) => item.enabled));
        }
      } catch {
        // 어휘집 조회 실패(구버전 서버 등) — 병합 셀렉트만 비워 두고 삭제는 유지한다.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const mergeOptions = vocabTopics.filter((item) => item.name !== topic);
  const selectedTarget = mergeOptions.find((item) => item.id === mergeTargetId) ?? null;

  return (
    <div className="inline-actions" data-testid="wiki-topic-manage">
      <select
        aria-label={`${topic} 병합 대상 주제 선택`}
        value={mergeTargetId}
        onChange={(event) => setMergeTargetId(event.target.value)}
      >
        <option value="">병합 대상 주제 선택…</option>
        {mergeOptions.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="button-secondary"
        disabled={!selectedTarget}
        title="이 주제로 분류된 문서를 선택한 어휘집 주제로 재분류하고, 이 주제명을 동의어로 편입합니다."
        onClick={() => selectedTarget && onMerge(selectedTarget.id, selectedTarget.name)}
      >
        다른 주제로 병합
      </button>
      <button
        type="button"
        className="button-secondary"
        title="이 주제를 문서에서 제거하고, 이후 자동 분류에서도 제외합니다."
        onClick={onDelete}
      >
        주제 삭제
      </button>
    </div>
  );
}

/** F-18: topics/ 주제 페이지 템플릿 — 제목 + 문서 수 배지 + 관련 문서/업무 기록 카드 그리드.
 * Wave D F-09: 백과사전 종합본(개요/핵심 내용/경과/문서별 요점/근거 문서)이 있으면
 * 관련 문서 카드 위에 종합 섹션을 렌더한다. 근거 각주 [n]는 '근거 문서' 목록의
 * 문서 카드 링크로 이어진다. */
function TopicsWikiTemplate({ meta, parsedBody, fallbackContent, actions }: WikiTemplateProps) {
  const title = wikiMetaString(meta, "topic") ?? parsedBody.title;
  const docLinks = parseWikiLinkItems(findWikiSection(parsedBody.sections, "관련 문서"));
  if (!title || docLinks.length === 0) {
    return <div className="chat-markdown">{renderMarkdownContent(fallbackContent, actions.openWikiTarget)}</div>;
  }
  const docCount = wikiMetaString(meta, "doc_count") ?? String(docLinks.length);
  const workLinks = parseWikiLinkItems(findWikiSection(parsedBody.sections, "관련 업무 기록"));
  const synthesizedAt = wikiMetaString(meta, "synthesized_at");
  const overviewText = wikiSectionText(findWikiSection(parsedBody.sections, "개요"));
  const synthesisBlocks: Array<{ heading: string; markdown: string }> = [
    "핵심 내용",
    "경과",
    "문서별 요점",
    "근거 문서",
  ]
    .map((heading) => ({ heading, markdown: collectWikiSectionMarkdown(parsedBody.sections, heading) }))
    .filter((block) => block.markdown.length > 0);
  // 연관 주제는 "[[주제A]] · [[주제B]]" 위키링크 표기 — 링크 대상 페이지가 없을 수
  // 있으므로 클릭 없는 칩으로만 노출한다.
  const relatedTopics = wikiSectionText(findWikiSection(parsedBody.sections, "연관 주제"))
    .split(/\[\[([^\]]+)\]\]/)
    .filter((_part, index) => index % 2 === 1)
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    <div className="wiki-template wiki-template--topics" data-testid="wiki-template-topics">
      <header className="wiki-template__header">
        <h2 className="wiki-template__title">{title}</h2>
        <div className="wiki-template__badges">
          <span className="pill">문서 {docCount}건</span>
          {synthesizedAt ? (
            <span className="pill pill--soft" title="LLM이 관련 문서를 종합해 작성한 백과사전 항목입니다.">
              종합 {synthesizedAt.slice(0, 10)}
            </span>
          ) : null}
        </div>
        <WikiPageHeaderActions title={title} sourcePath={null} actions={actions} />
        {actions.mergeTopic && actions.deleteTopic ? (
          <TopicWikiManageActions
            topic={title}
            onMerge={(intoTopicId, intoTopicName) =>
              actions.mergeTopic?.(title, intoTopicId, intoTopicName)
            }
            onDelete={() => actions.deleteTopic?.(title)}
          />
        ) : null}
      </header>

      {overviewText ? (
        <div className="wiki-template__highlight" data-testid="wiki-template-topic-overview">
          <span className="wiki-template__highlight-label">개요</span>
          <p>{overviewText}</p>
        </div>
      ) : null}

      {synthesisBlocks.length > 0 ? (
        <div className="chat-markdown" data-testid="wiki-template-topic-synthesis">
          {synthesisBlocks.map((block) => (
            <div key={`synthesis-${block.heading}`}>
              {renderMarkdownContent(`## ${block.heading}\n${block.markdown}`, actions.openWikiTarget)}
            </div>
          ))}
        </div>
      ) : null}

      {relatedTopics.length > 0 ? (
        <div className="wiki-template__chips" aria-label="연관 주제" data-testid="wiki-template-topic-related">
          {relatedTopics.map((topic) => (
            <span key={`related-${topic}`} className="wiki-template__chip">
              {topic}
            </span>
          ))}
        </div>
      ) : null}

      <div className="wiki-template__grid">
        {docLinks.map((link) => (
          <button
            key={`doc-${link.target}`}
            type="button"
            className="wiki-template__card"
            onClick={() => actions.openWikiTarget(link.target)}
          >
            <span className="pill pill--soft">관련 문서</span>
            <strong>{link.label}</strong>
            {link.detail ? <p className="subtle-text">{link.detail}</p> : null}
          </button>
        ))}
        {workLinks.map((link) => (
          <button
            key={`work-${link.target}`}
            type="button"
            className="wiki-template__card"
            onClick={() => actions.openWikiTarget(link.target)}
          >
            <span className="pill pill--soft">업무 기록</span>
            <strong>{link.label}</strong>
            {link.detail ? <p className="subtle-text">{link.detail}</p> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** F-18: work/ 업무 기록 페이지 템플릿 — 세션 요약 하이라이트 + 인용 문서 카드 그리드 + 연결 일정/파일 메타. */
function WorkWikiTemplate({ meta, parsedBody, fallbackContent, actions }: WikiTemplateProps) {
  const title = wikiMetaString(meta, "title") ?? parsedBody.title;
  const summarySection = findWikiSection(parsedBody.sections, "세션 요약");
  if (!title || !summarySection) {
    return <div className="chat-markdown">{renderMarkdownContent(fallbackContent, actions.openWikiTarget)}</div>;
  }
  const updatedAt = wikiMetaString(meta, "updated_at");
  const citedDocLinks = parseWikiLinkItems(findWikiSection(parsedBody.sections, "인용된 지식 문서"));
  const scheduleSection = findWikiSection(parsedBody.sections, "연결 일정");
  const fileSection = findWikiSection(parsedBody.sections, "연결 파일");
  const decisionSection = findWikiSection(parsedBody.sections, "주요 결정/후속 액션");
  const scheduleLines = scheduleSection
    ? scheduleSection.lines.map((line) => line.trim()).filter((line) => line.startsWith("-"))
    : [];
  const fileLines = fileSection
    ? fileSection.lines.map((line) => line.trim()).filter((line) => line.startsWith("-"))
    : [];

  return (
    <div className="wiki-template wiki-template--work" data-testid="wiki-template-work">
      <header className="wiki-template__header">
        <h2 className="wiki-template__title">{title}</h2>
        <div className="wiki-template__badges">
          {updatedAt ? <span className="pill pill--soft">갱신 {updatedAt.slice(0, 10)}</span> : null}
          <span className="pill">인용 문서 {citedDocLinks.length}건</span>
        </div>
        <WikiPageHeaderActions title={title} sourcePath={null} actions={actions} />
      </header>

      <div className="wiki-template__highlight" data-testid="wiki-template-work-summary">
        <span className="wiki-template__highlight-label">세션 요약</span>
        <p>{wikiSectionText(summarySection)}</p>
      </div>

      {decisionSection ? (
        <details className="knowledge-detail-section" open>
          <summary>주요 결정/후속 액션</summary>
          <ul className="wiki-template__outline">
            {decisionSection.lines
              .map((line) => line.trim())
              .filter((line) => line.startsWith("-"))
              .map((line, index) => (
                <li key={`decision-${index}`}>{line.replace(/^-\s*/, "")}</li>
              ))}
          </ul>
        </details>
      ) : null}

      {citedDocLinks.length > 0 ? (
        <div className="wiki-template__grid">
          {citedDocLinks.map((link) => (
            <button
              key={`cited-${link.target}`}
              type="button"
              className="wiki-template__card"
              onClick={() => actions.openWikiTarget(link.target)}
            >
              <span className="pill pill--soft">인용 문서</span>
              <strong>{link.label}</strong>
              {link.detail ? <p className="subtle-text">{link.detail}</p> : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="subtle-text">인용된 지식 문서가 없습니다.</p>
      )}

      {scheduleLines.length > 0 || fileLines.length > 0 ? (
        <div className="document-preview__meta">
          {scheduleLines.map((line, index) => (
            <span key={`schedule-${index}`}>{line.replace(/^-\s*/, "")}</span>
          ))}
          {fileLines.map((line, index) => (
            <span key={`file-${index}`}>{line.replace(/^-\s*/, "")}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// T-01: Work-Aware 분류체계 마법사 + 분류 대기 큐
// ---------------------------------------------------------------------------

/** 니즈 인터뷰 선택지 — 서버는 자유 문자열을 저장하므로 표시 문구가 곧 저장 값이다. */
const TAXONOMY_ORG_TYPES = ["중앙행정기관", "지방자치단체", "공공기관·공사"];
const TAXONOMY_PURPOSES = ["개인 기억", "인수인계 대비", "보고서 생산성"];

/** 공공 문서역할 8종 — 서버 DOC_ROLES와 키 일치(그림자 유형 temp_backup 제외). */
const TAXONOMY_DOC_ROLES: Array<{ key: string; label: string }> = [
  { key: "regulation", label: "규정/지침" },
  { key: "manual", label: "업무매뉴얼" },
  { key: "plan", label: "계획(안)" },
  { key: "report", label: "보고서" },
  { key: "meeting", label: "회의자료" },
  { key: "official", label: "공문/시행문" },
  { key: "form", label: "양식/서식" },
  { key: "reference", label: "참고자료" },
];

function taxonomyConfidenceLabel(confidence: string): string {
  if (confidence === "high") {
    return "확신도 높음";
  }
  if (confidence === "medium") {
    return "확신도 보통";
  }
  if (confidence === "low") {
    return "확신도 낮음";
  }
  return `확신도 ${confidence}`;
}

function taxonomyQueueReasonLabel(reason: string): string {
  if (reason === "conflict") {
    return "신호 충돌";
  }
  if (reason === "no_signal") {
    return "신호 없음";
  }
  return reason;
}

/**
 * 2026-07-14 hub-assignment (c)-4: 근거가 약한 후보 판정 — 저확신(low)이거나
 * 어휘집 폴백(vocab, folders 없이 단어 매칭만) 출신. 초안 채택 시 기본 제외하고
 * 카드의 "자동 제외 — 근거 약함" pill 근거로 쓴다(포함 버튼으로 opt-in).
 */
function isWeakTaxonomyCandidate(confidence: string | null, origin: string): boolean {
  return confidence === "low" || origin === "vocab";
}

/**
 * hub-assignment (b): 큐 항목이 속한 1단계 폴더 라벨 — 큐 목록 그룹 헤더 묶음 기준.
 * 소스 root_path 기준 상대경로의 첫 세그먼트를 쓰고, 루트 직속 파일은 별도 그룹으로 묶는다.
 */
function taxonomyQueueGroupLabel(item: TaxonomyQueueItem, sources: KnowledgeSourceItem[]): string {
  const normalized = item.source_path.replace(/\\/g, "/");
  const root = sources
    .find((source) => source.id === item.source_id)
    ?.root_path.replace(/\\/g, "/")
    .replace(/\/+$/, "");
  if (root && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    const segments = normalized.slice(root.length + 1).split("/").filter(Boolean);
    return segments.length > 1 ? segments[0] : "루트 직속";
  }
  // 소스 미매칭(경로 이동 등) 폴백 — 파일 바로 위 폴더명으로 묶는다.
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "루트 직속";
}

/** hub-assignment (b): 후보가 정확히 1개인 항목은 그 후보를 업무 드롭다운 기본 선택값으로 쓴다. */
function taxonomyQueueDefaultSelection(item: TaxonomyQueueItem): {
  work_area_slug: string;
  doc_role: string;
} {
  const candidateAreas = item.candidates?.work_areas ?? [];
  return {
    work_area_slug: candidateAreas.length === 1 ? candidateAreas[0].work_area_slug : "",
    doc_role: "",
  };
}

type TaxonomyToastPush = (tone: "info" | "error", message: string) => void;

/** 마법사 단계 2에서 편집하는 업무 후보 한 줄(초안 항목 + 사용자 편집 상태). */
type WizardWorkArea = {
  key: string;
  name: string;
  folders: string[];
  keywords: string[];
  docCount: number | null;
  confidence: string | null;
  origin: string;
  excluded: boolean;
  checked: boolean;
};

type TaxonomyWizardProps = {
  source: KnowledgeSourceItem;
  onClose: () => void;
  pushToast: TaxonomyToastPush;
  /** 백그라운드 적용 작업 시작 시 상위에서 작업 패널로 연결한다. */
  onApplied: (workJob: WorkJobItem) => void;
  onOpenSchema: () => void;
  /**
   * W7: 미스캔 소스(needs_scan=true) 감지 시 마법사가 자동 실행하는 폴더 스캔.
   * 기존 runKnowledgeSourceScan 흐름을 그대로 재사용하며, 실패하면 null을 돌려준다.
   */
  runSourceScan: (source: KnowledgeSourceItem) => Promise<KnowledgeSourceScanResult | null>;
  /** W7: 이 소스에서 색인 완료된 문서 수 — 0이면 적용 시 색인이 먼저 실행됨을 안내한다. */
  indexedDocumentCount: number;
  /** 어휘집 규격 §5: 1단계 하단 축약 팩 블록에서 팩이 바뀌면 호출 — 설정 탭 블록 갱신용. */
  onVocabChanged?: () => void;
};

/**
 * T-01 분류체계 설정 마법사 — 3단계(니즈 파악 → 편집형 트리 검토 → 적용).
 * 모듈 최상단에 두어 매 렌더마다 컴포넌트 타입이 재생성되어 하위 트리가
 * 리마운트되는 것을 막는다(F-18 템플릿과 동일한 이유).
 */
function TaxonomyWizard({
  source,
  onClose,
  pushToast,
  onApplied,
  onOpenSchema,
  runSourceScan,
  indexedDocumentCount,
  onVocabChanged,
}: TaxonomyWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [orgType, setOrgType] = useState<string>(TAXONOMY_ORG_TYPES[0]);
  const [department, setDepartment] = useState("");
  const [duty, setDuty] = useState("");
  const [purpose, setPurpose] = useState<string>(TAXONOMY_PURPOSES[0]);
  const [proposal, setProposal] = useState<TaxonomyProposalResult | null>(null);
  const [areas, setAreas] = useState<WizardWorkArea[]>([]);
  const [docRoles, setDocRoles] = useState<string[]>(TAXONOMY_DOC_ROLES.map((role) => role.key));
  const [analyzing, setAnalyzing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<TaxonomyConfirmResult | null>(null);
  const [appliedQuality, setAppliedQuality] = useState<TaxonomyQualityItem | null>(null);
  const [newAreaName, setNewAreaName] = useState("");
  const [newAreaFolder, setNewAreaFolder] = useState("");
  // W7: 신설치(미스캔) 자동 스캔 연쇄 상태 — 2단계 영역에 진행/실패를 표시한다.
  const [autoScanPhase, setAutoScanPhase] = useState<"scanning" | "failed" | null>(null);
  const [autoScanFileCount, setAutoScanFileCount] = useState<number | null>(null);

  // 저장된 인터뷰가 있으면 프리필한다(없거나 구버전 서버면 빈 폼 유지).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await fetchTaxonomyInterview();
        if (!active || !result.interview) {
          return;
        }
        if (result.interview.org_type) {
          setOrgType(result.interview.org_type);
        }
        if (result.interview.department) {
          setDepartment(result.interview.department);
        }
        if (result.interview.duty) {
          setDuty(result.interview.duty);
        }
        if (result.interview.purpose) {
          setPurpose(result.interview.purpose);
        }
      } catch {
        // 저장된 인터뷰 없음 — 기본값으로 시작한다.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Escape로 마법사 닫기
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const includedAreas = areas.filter((area) => !area.excluded && area.name.trim());
  const checkedCount = areas.filter((area) => area.checked && !area.excluded).length;
  const unclearFamilyCount = proposal
    ? proposal.families.filter((family) => family.unclear_latest).length
    : 0;
  const folderOptions = proposal
    ? Array.from(
        new Set([
          ...proposal.work_areas.flatMap((area) => area.folders),
          ...proposal.reference_shelves.map((shelf) => shelf.folder),
        ]),
      )
    : [];

  /** 분석 결과(proposal)를 마법사 편집 상태로 반영한다. */
  function adoptProposal(result: TaxonomyProposalResult) {
    setProposal(result);
    setAreas(
      result.work_areas.map((area, index) => ({
        key: `${area.slug || area.name}-${index}`,
        name: area.name,
        folders: area.folders,
        keywords: [],
        docCount: area.doc_count,
        confidence: area.confidence,
        origin: area.source,
        // hub-assignment (c)-4: 저확신·vocab 후보는 기본 제외 — 포함 버튼으로 opt-in.
        excluded: isWeakTaxonomyCandidate(area.confidence, area.source),
        checked: false,
      })),
    );
  }

  /**
   * W7: 미스캔 소스 자동 스캔 → 완료 후 proposal 재요청 연쇄.
   * 사용자가 스캔·분석을 따로 챙기지 않아도 마법사가 알아서 이어 실행한다.
   */
  async function scanThenReanalyze() {
    setAutoScanPhase("scanning");
    setAutoScanFileCount(null);
    setWizardError(null);
    try {
      const scanResult = await runSourceScan(source);
      if (!scanResult) {
        throw new Error("폴더 스캔에 실패했습니다. 폴더 경로를 확인한 뒤 다시 시도해 주세요.");
      }
      setAutoScanFileCount(scanResult.indexed_count + scanResult.metadata_count);
      const refreshed = await fetchTaxonomyProposal(source.id);
      adoptProposal(refreshed);
      setAutoScanPhase(null);
    } catch (scanError) {
      setAutoScanPhase("failed");
      setWizardError(
        scanError instanceof Error
          ? scanError.message
          : "폴더 스캔에 실패했습니다. 다시 시도해 주세요.",
      );
    }
  }

  async function analyzeFolders() {
    setAnalyzing(true);
    setWizardError(null);
    try {
      await saveTaxonomyInterview({ org_type: orgType, department, duty, purpose });
      const result = await fetchTaxonomyProposal(source.id);
      if (result.needs_scan) {
        // W7: 새 설치 등 스캔 이력이 없는 소스 — 2단계에서 스캔을 자동 실행한 뒤 재분석한다.
        setStep(2);
        await scanThenReanalyze();
        return;
      }
      adoptProposal(result);
      setStep(2);
    } catch (analyzeError) {
      setWizardError(
        analyzeError instanceof Error ? analyzeError.message : "폴더 구조 분석에 실패했습니다.",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  function renameArea(key: string, name: string) {
    setAreas((current) => current.map((area) => (area.key === key ? { ...area, name } : area)));
  }

  function toggleAreaChecked(key: string) {
    setAreas((current) =>
      current.map((area) => (area.key === key ? { ...area, checked: !area.checked } : area)),
    );
  }

  function toggleAreaExcluded(key: string) {
    setAreas((current) =>
      current.map((area) =>
        area.key === key ? { ...area, excluded: !area.excluded, checked: false } : area,
      ),
    );
  }

  /** 체크된 2개 업무를 하나로 병합한다(앞 항목 이름 유지, 폴더/키워드 합집합). */
  function mergeSelectedAreas() {
    setAreas((current) => {
      const selected = current.filter((area) => area.checked && !area.excluded);
      if (selected.length !== 2) {
        return current;
      }
      const [primary, secondary] = selected;
      const merged: WizardWorkArea = {
        ...primary,
        folders: Array.from(new Set([...primary.folders, ...secondary.folders])),
        keywords: Array.from(new Set([...primary.keywords, ...secondary.keywords])),
        docCount:
          primary.docCount === null && secondary.docCount === null
            ? null
            : (primary.docCount ?? 0) + (secondary.docCount ?? 0),
        checked: false,
      };
      return current
        .filter((area) => area.key !== secondary.key)
        .map((area) => (area.key === primary.key ? merged : area));
    });
  }

  function addWorkArea() {
    const name = newAreaName.trim();
    if (!name) {
      return;
    }
    setAreas((current) => [
      ...current,
      {
        key: `manual-${current.length}-${name}`,
        name,
        folders: newAreaFolder ? [newAreaFolder] : [],
        keywords: [],
        docCount: null,
        confidence: null,
        origin: "manual",
        excluded: false,
        checked: false,
      },
    ]);
    setNewAreaName("");
    setNewAreaFolder("");
  }

  function toggleDocRole(key: string) {
    setDocRoles((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  async function confirmSchema() {
    if (includedAreas.length === 0) {
      setWizardError("확정할 업무가 없습니다. 최소 1개 업무를 남겨 주세요.");
      return;
    }
    setConfirming(true);
    setWizardError(null);
    try {
      const result = await confirmTaxonomy({
        source_id: source.id,
        work_areas: includedAreas.map((area) => ({
          name: area.name.trim(),
          folders: area.folders,
          keywords: area.keywords,
        })),
        doc_roles_enabled: docRoles,
        family_policy: "latest_representative",
      });
      setConfirmResult(result);
      setStep(3);
      pushToast("info", "업무 분류체계를 확정했습니다. 기준이 SCHEMA.md에 기록되었습니다.");
    } catch (confirmError) {
      setWizardError(
        confirmError instanceof Error ? confirmError.message : "분류체계 확정에 실패했습니다.",
      );
    } finally {
      setConfirming(false);
    }
  }

  async function applyNow() {
    setApplying(true);
    setWizardError(null);
    try {
      const result = await applyTaxonomy({ source_id: source.id, background: true });
      onApplied(result.work_job);
      setApplied(true);
      pushToast("info", "분류체계 적용 작업을 시작했습니다. 진행 상황은 작업 패널에서 확인하세요.");
      try {
        const quality = await fetchTaxonomyQuality(source.id);
        setAppliedQuality(
          quality.items.find((item) => item.source_id === source.id) ?? quality.items[0] ?? null,
        );
      } catch {
        // 품질 리포트는 적용 완료 후 생성될 수 있다 — 없으면 조용히 생략.
      }
    } catch (applyError) {
      setWizardError(
        applyError instanceof Error ? applyError.message : "분류체계 적용을 시작하지 못했습니다.",
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <div
      className="taxonomy-wizard-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="taxonomy-wizard"
        role="dialog"
        aria-modal="true"
        aria-label="분류체계 설정 마법사"
        data-testid="taxonomy-wizard"
      >
        <header className="taxonomy-wizard__header">
          <div>
            <span className="eyebrow">Work-Aware 분류체계</span>
            <h2>분류체계 설정 — {source.label}</h2>
          </div>
          <button type="button" className="button-secondary" onClick={onClose} title="마법사를 닫습니다. (Esc)">
            닫기
          </button>
        </header>

        <ol className="taxonomy-wizard__steps" aria-label="마법사 단계">
          {["니즈 파악", "분류 검토", "적용"].map((label, index) => (
            <li
              key={label}
              className={
                step === index + 1 ? "is-active" : step > index + 1 ? "is-complete" : ""
              }
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {wizardError ? (
          <div className="hint-box hint-box--warning" role="alert">
            {wizardError}
          </div>
        ) : null}

        {step === 1 ? (
          analyzing ? (
            <div className="stack-form" data-testid="taxonomy-analyzing">
              <div
                className="knowledge-progress knowledge-progress--indeterminate"
                aria-label="폴더 구조 분석 진행 중"
              >
                <div className="knowledge-progress__bar knowledge-progress__bar--indeterminate" />
              </div>
              <p className="subtle-text">폴더 구조를 분석하는 중…</p>
            </div>
          ) : (
            <div className="stack-form">
              <div className="helper-copy">
                <p>4문항으로 업무 상황을 파악해 폴더 분석 결과를 보정합니다. 답변은 분류 기준(SCHEMA.md)에 함께 기록됩니다.</p>
              </div>
              <div className="grid-2">
                <label>
                  기관 유형
                  <select value={orgType} onChange={(event) => setOrgType(event.target.value)}>
                    {TAXONOMY_ORG_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  부서명
                  <input
                    value={department}
                    onChange={(event) => setDepartment(event.target.value)}
                    placeholder="예: 기획조정실 기획팀"
                  />
                </label>
                <label>
                  담당 업무
                  <input
                    value={duty}
                    onChange={(event) => setDuty(event.target.value)}
                    placeholder="예: 예산 편성과 성과평가 총괄"
                  />
                </label>
                <label>
                  지식관리 목적
                  <select value={purpose} onChange={(event) => setPurpose(event.target.value)}>
                    {TAXONOMY_PURPOSES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="inline-actions">
                <button type="button" onClick={() => void analyzeFolders()} disabled={analyzing}>
                  다음
                </button>
              </div>
              {/* 어휘집 규격 §5: 분류체계 설정 시 기관 어휘집 팩을 함께 입력하는 축약 블록 */}
              <VocabPackBlock variant="compact" pushToast={pushToast} onChanged={onVocabChanged} />
            </div>
          )
        ) : null}

        {step === 2 && autoScanPhase ? (
          <div className="stack-form" data-testid="taxonomy-auto-scan">
            {autoScanPhase === "scanning" ? (
              <>
                <div
                  className="knowledge-progress knowledge-progress--indeterminate"
                  aria-label="지식폴더 자동 스캔 진행 중"
                >
                  <div className="knowledge-progress__bar knowledge-progress__bar--indeterminate" />
                </div>
                <p className="subtle-text">
                  폴더를 먼저 스캔하고 있습니다 —{" "}
                  {autoScanFileCount !== null
                    ? `파일 ${autoScanFileCount}개 확인 중…`
                    : "파일 목록을 확인하는 중…"}
                </p>
                <p className="subtle-text">스캔이 끝나면 업무 후보 분석을 자동으로 이어서 실행합니다.</p>
              </>
            ) : (
              <div className="inline-actions">
                <button
                  type="button"
                  onClick={() => void scanThenReanalyze()}
                  title="폴더 스캔과 업무 후보 분석을 다시 실행합니다."
                >
                  다시 시도
                </button>
                <button type="button" className="button-secondary" onClick={() => setStep(1)}>
                  이전
                </button>
              </div>
            )}
          </div>
        ) : null}

        {step === 2 && proposal && !autoScanPhase ? (
          <div className="stack-form" data-testid="taxonomy-review-step">
            {proposal.governance_docs.length > 0 ? (
              <div className="hint-box" data-testid="taxonomy-governance-banner">
                업무분장표를 발견했습니다 — 업무 범위 파악에 참고했습니다. (
                {proposal.governance_docs.map((doc) => doc.relative_path).join(", ")})
              </div>
            ) : null}
            {proposal.hints.map((hint) => (
              <p key={hint} className="subtle-text">
                {hint}
              </p>
            ))}

            {areas.length === 0 ? (
              <div className="hint-box" data-testid="taxonomy-empty-candidates">
                폴더 안에서 업무 폴더 패턴을 찾지 못했습니다. 아래에서 직접 업무를 추가하세요.
              </div>
            ) : null}

            <div className="taxonomy-area-toolbar">
              <span className="pill">업무 후보 {includedAreas.length}개</span>
              <button
                type="button"
                className="button-secondary"
                onClick={mergeSelectedAreas}
                disabled={checkedCount !== 2}
                title="체크박스로 업무 2개를 선택하면 하나로 병합합니다."
              >
                선택 병합
              </button>
            </div>

            <div className="item-list item-list--compact" data-testid="taxonomy-area-list">
              {areas.map((area) => (
                <article
                  key={area.key}
                  className={`list-card list-card--compact taxonomy-area-card ${
                    area.excluded ? "is-excluded" : ""
                  }`}
                >
                  <div className="taxonomy-area-card__row">
                    <input
                      type="checkbox"
                      aria-label={`${area.name} 병합 선택`}
                      checked={area.checked}
                      disabled={area.excluded}
                      onChange={() => toggleAreaChecked(area.key)}
                    />
                    <input
                      className="taxonomy-area-card__name"
                      aria-label="업무 이름"
                      value={area.name}
                      disabled={area.excluded}
                      onChange={(event) => renameArea(area.key, event.target.value)}
                    />
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => toggleAreaExcluded(area.key)}
                      title={area.excluded ? "이 업무를 다시 포함합니다." : "이 업무를 분류체계에서 제외합니다."}
                    >
                      {area.excluded ? "포함" : "제외"}
                    </button>
                  </div>
                  <div className="document-preview__meta">
                    <span>폴더: {area.folders.length > 0 ? area.folders.map(cleanFolderLabel).join(", ") : "매핑 없음"}</span>
                    {area.docCount !== null ? <span>문서 {area.docCount}건</span> : null}
                    {area.confidence ? (
                      <span className={area.confidence === "low" ? "pill pill--warning" : "pill pill--soft"}>
                        {taxonomyConfidenceLabel(area.confidence)}
                      </span>
                    ) : null}
                    {/* hub-assignment (c)-4: 기본 제외된 저확신·vocab 후보 표시 — 포함 버튼으로 되살릴 수 있다. */}
                    {area.excluded && isWeakTaxonomyCandidate(area.confidence, area.origin) ? (
                      <span className="pill pill--warning" data-testid="taxonomy-auto-excluded-pill">
                        자동 제외 — 근거 약함
                      </span>
                    ) : null}
                    {area.origin === "manual" ? <span className="pill pill--soft">직접 추가</span> : null}
                  </div>
                </article>
              ))}
            </div>

            <div className="taxonomy-area-add">
              <label>
                새 업무 이름
                <input
                  value={newAreaName}
                  onChange={(event) => setNewAreaName(event.target.value)}
                  placeholder="예: 국회 협력"
                />
              </label>
              <label>
                포함 폴더
                <select value={newAreaFolder} onChange={(event) => setNewAreaFolder(event.target.value)}>
                  <option value="">(폴더 없음)</option>
                  {folderOptions.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button-secondary"
                onClick={addWorkArea}
                disabled={!newAreaName.trim()}
                title="목록에 없는 업무를 직접 추가합니다."
              >
                업무 추가
              </button>
            </div>

            {proposal.reference_shelves.length > 0 ? (
              <div className="document-preview" data-testid="taxonomy-reference-shelves">
                <div className="document-preview__meta">
                  <span className="pill pill--soft">참고자료 서고</span>
                  {proposal.reference_shelves.map((shelf) => (
                    <span key={shelf.folder}>
                      {shelf.folder} · 문서 {shelf.doc_count}건
                    </span>
                  ))}
                </div>
                <p className="subtle-text">참고/기타 접두사 폴더는 업무가 아닌 참고자료 서고로 유지됩니다.</p>
              </div>
            ) : null}

            {proposal.families.length > 0 ? (
              <div className="hint-box" data-testid="taxonomy-family-summary">
                유사 문서 {proposal.families.length}묶음 감지 — 대표 카드로 정리됩니다.
                {unclearFamilyCount > 0 ? (
                  <span className="pill pill--warning">최신본 불명확 {unclearFamilyCount}묶음</span>
                ) : null}
              </div>
            ) : null}

            <fieldset className="taxonomy-doc-roles">
              <legend>정리할 문서 유형 (기본 전체 사용)</legend>
              <div className="taxonomy-doc-roles__grid">
                {TAXONOMY_DOC_ROLES.map((role) => (
                  <label key={role.key} className="taxonomy-doc-roles__item">
                    <input
                      type="checkbox"
                      checked={docRoles.includes(role.key)}
                      onChange={() => toggleDocRole(role.key)}
                    />
                    {role.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="inline-actions">
              <button type="button" className="button-secondary" onClick={() => setStep(1)}>
                이전
              </button>
              <button
                type="button"
                onClick={() => void confirmSchema()}
                disabled={confirming || includedAreas.length === 0}
                title={
                  includedAreas.length === 0
                    ? "최소 1개 업무를 남겨야 확정할 수 있습니다."
                    : "이 업무 목록과 문서 유형으로 분류 기준(SCHEMA.md)을 확정합니다."
                }
              >
                이 체계로 확정
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 && confirmResult ? (
          <div className="stack-form" data-testid="taxonomy-apply-step">
            <div className="document-preview">
              <div className="document-preview__meta">
                <span className="pill">확정 완료</span>
                <span>업무 {confirmResult.taxonomy.work_areas.length}개</span>
                <span>문서 유형 {confirmResult.taxonomy.doc_roles_enabled.length}종</span>
              </div>
              <p className="subtle-text">분류 기준이 기록되었습니다: {confirmResult.schema_path}</p>
            </div>
            {!applied && indexedDocumentCount === 0 ? (
              <div className="hint-box" data-testid="taxonomy-apply-index-notice">
                색인이 아직 안 되어 있어, 적용 시 색인을 먼저 실행합니다. (수 분 소요 가능) 진행 상황은 작업
                패널에서 &ldquo;색인&rdquo; → &ldquo;분류 적용&rdquo; 순서로 표시됩니다.
              </div>
            ) : null}
            <div className="inline-actions">
              <button
                type="button"
                onClick={() => void applyNow()}
                disabled={applying || applied}
                title={
                  applied
                    ? "적용 작업이 이미 시작되었습니다."
                    : "확정한 분류체계로 문서 태깅과 업무 허브 생성을 시작합니다."
                }
              >
                {applying ? "적용 시작 중…" : "지금 적용"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={onOpenSchema}
                title="확정된 분류 기준 문서(SCHEMA.md)를 위키 뷰어로 엽니다."
              >
                분류 기준 보기
              </button>
              <button type="button" className="button-secondary" onClick={onClose}>
                {applied ? "완료" : "나중에 적용"}
              </button>
            </div>
            {applied ? (
              <p className="subtle-text">
                적용 작업이 백그라운드에서 진행됩니다. 진행 상황은 작업 패널에서 확인하세요.
              </p>
            ) : null}
            {appliedQuality ? (
              <div className="document-preview" data-testid="taxonomy-quality-summary">
                <div className="document-preview__meta">
                  <span className="pill">품질 요약</span>
                  <span>충돌 {appliedQuality.conflicts}건</span>
                  <span>중복 {appliedQuality.duplicates}건</span>
                  <span>최신본 불명확 {appliedQuality.unclear_latest}건</span>
                  <span className={appliedQuality.queue_count > 0 ? "pill pill--warning" : "pill pill--soft"}>
                    분류 대기 {appliedQuality.queue_count}건
                  </span>
                </div>
                {appliedQuality.queue_count > 0 ? (
                  <p className="subtle-text">
                    분류 대기 문서는 설정 탭의 위키 구성 설정에 있는 분류 대기 큐에서 직접 확정할 수 있습니다.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type TaxonomyQueueSectionProps = {
  /** 마법사에서 적용을 시작하면 증가 — 큐/품질을 다시 조회한다. */
  refreshKey: number;
  pushToast: TaxonomyToastPush;
  /** hub-assignment (b): 1단계 폴더 그룹핑에 쓰는 등록 지식폴더 목록(root_path 기준 상대경로 계산). */
  sources: KnowledgeSourceItem[];
};

/**
 * T-01 분류 대기 큐 카드 — 설정 탭(위키 구성 설정)에서 확신도 낮은 문서를 직접 확정한다.
 * 확정된 분류체계가 없으면(구버전 서버 포함) 아무것도 렌더하지 않는다.
 */
function TaxonomyQueueSection({ refreshKey, pushToast, sources }: TaxonomyQueueSectionProps) {
  const [quality, setQuality] = useState<TaxonomyQualityResult | null>(null);
  const [status, setStatus] = useState<TaxonomyStatusResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [queueItems, setQueueItems] = useState<TaxonomyQueueItem[] | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [selections, setSelections] = useState<Record<string, { work_area_slug: string; doc_role: string }>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  // hub-assignment (b): 그룹 헤더의 "이 그룹 전체를 [선택 업무]로 반영"용 그룹별 업무 선택.
  const [groupSelections, setGroupSelections] = useState<Record<string, string>>({});
  const [bulkResolving, setBulkResolving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [qualityResult, statusResult] = await Promise.all([
          fetchTaxonomyQuality(),
          fetchTaxonomyStatus(),
        ]);
        if (!active) {
          return;
        }
        setQuality(qualityResult);
        setStatus(statusResult);
      } catch {
        if (active) {
          // 미확정/구버전 서버 — 카드를 숨긴다.
          setQuality(null);
          setStatus(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    let active = true;
    setQueueLoading(true);
    void (async () => {
      try {
        const result = await fetchTaxonomyQueue();
        if (active) {
          setQueueItems(result.items);
        }
      } catch {
        if (active) {
          setQueueItems([]);
        }
      } finally {
        if (active) {
          setQueueLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [expanded, refreshKey]);

  if (!quality?.configured) {
    return null;
  }

  const totals = quality.items.reduce(
    (acc, item) => ({
      conflicts: acc.conflicts + item.conflicts,
      duplicates: acc.duplicates + item.duplicates,
      unclearLatest: acc.unclearLatest + item.unclear_latest,
      queueCount: acc.queueCount + item.queue_count,
    }),
    { conflicts: 0, duplicates: 0, unclearLatest: 0, queueCount: 0 },
  );
  const pendingCount = queueItems !== null ? queueItems.length : totals.queueCount;
  // hub-assignment (b): 후보가 정확히 1개인 항목 — "추천 일괄 반영" 대상.
  const recommendedEntries = (queueItems ?? []).flatMap((item) => {
    const candidateAreas = item.candidates?.work_areas ?? [];
    return candidateAreas.length === 1
      ? [{ item, work_area_slug: candidateAreas[0].work_area_slug }]
      : [];
  });
  // hub-assignment (b): 1단계 폴더별 그룹 — Map은 삽입 순서를 유지하므로 서버 정렬을 존중한다.
  const queueGroups = new Map<string, TaxonomyQueueItem[]>();
  for (const item of queueItems ?? []) {
    const label = taxonomyQueueGroupLabel(item, sources);
    queueGroups.set(label, [...(queueGroups.get(label) ?? []), item]);
  }

  function areaOptionsFor(sourceId: string): ConfirmedTaxonomyArea[] {
    const items = status?.items ?? [];
    const matched = items.find((item) => item.source_id === sourceId) ?? items[0];
    return matched?.taxonomy?.work_areas ?? [];
  }

  function updateSelection(item: TaxonomyQueueItem, patch: Partial<{ work_area_slug: string; doc_role: string }>) {
    setSelections((current) => {
      // 단일 후보 기본 선택(hub-assignment (b))을 시드로 써서 부분 변경이 기본값을 지우지 않게 한다.
      const existing = current[item.id] ?? taxonomyQueueDefaultSelection(item);
      return { ...current, [item.id]: { ...existing, ...patch } };
    });
  }

  /** 해소된 항목 수만큼 소스별 분류 대기 수를 줄인다(단건·일괄 공용). */
  function decrementQueueCounts(resolvedItems: TaxonomyQueueItem[]) {
    const countsBySource = new Map<string, number>();
    for (const item of resolvedItems) {
      countsBySource.set(item.source_id, (countsBySource.get(item.source_id) ?? 0) + 1);
    }
    setQuality((current) =>
      current
        ? {
            ...current,
            items: current.items.map((qualityItem) => {
              const resolvedCount = countsBySource.get(qualityItem.source_id) ?? 0;
              return resolvedCount > 0
                ? { ...qualityItem, queue_count: Math.max(0, qualityItem.queue_count - resolvedCount) }
                : qualityItem;
            }),
          }
        : current,
    );
  }

  async function resolveItem(item: TaxonomyQueueItem) {
    const selection = selections[item.id] ?? taxonomyQueueDefaultSelection(item);
    setResolvingId(item.id);
    try {
      await resolveTaxonomyQueueItem(item.id, selection);
      setQueueItems((current) => (current ?? []).filter((queued) => queued.id !== item.id));
      decrementQueueCounts([item]);
      pushToast("info", `${item.title || "문서"} 분류를 반영했습니다.`);
    } catch (resolveError) {
      pushToast(
        "error",
        resolveError instanceof Error ? resolveError.message : "분류 반영에 실패했습니다.",
      );
    } finally {
      setResolvingId(null);
    }
  }

  /**
   * hub-assignment (b): 그룹 전체/추천(단일 후보) 전건을 bulk-resolve 한 요청으로 확정한다.
   * 성공 시 해당 항목을 목록에서 제거하고 분류 대기 수를 함께 줄인다.
   */
  async function resolveBulk(
    entries: Array<{ item: TaxonomyQueueItem; work_area_slug: string; doc_role?: string }>,
    successMessage: string,
  ) {
    if (entries.length === 0) {
      return;
    }
    setBulkResolving(true);
    try {
      await bulkResolveTaxonomyQueue(
        entries.map(({ item, work_area_slug, doc_role }) => ({
          id: item.id,
          work_area_slug,
          ...(doc_role ? { doc_role } : {}),
        })),
      );
      const resolvedIds = new Set(entries.map(({ item }) => item.id));
      setQueueItems((current) => (current ?? []).filter((queued) => !resolvedIds.has(queued.id)));
      decrementQueueCounts(entries.map(({ item }) => item));
      pushToast("info", successMessage);
    } catch (bulkError) {
      pushToast(
        "error",
        bulkError instanceof Error ? bulkError.message : "분류 일괄 반영에 실패했습니다.",
      );
    } finally {
      setBulkResolving(false);
    }
  }

  return (
    <SectionCard eyebrow="분류 대기" title="분류 대기 큐" testId="knowledge-taxonomy-queue">
      <div className="knowledge-index-status-row">
        <button
          type="button"
          className="button-secondary knowledge-index-status-button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          title="자동 분류에서 확신도가 낮았던 문서 목록을 펼칩니다."
        >
          분류 대기 {pendingCount}건
        </button>
        <span className="pill pill--soft">충돌 {totals.conflicts}</span>
        <span className="pill pill--soft">중복 {totals.duplicates}</span>
        <span className="pill pill--soft">최신본 불명확 {totals.unclearLatest}</span>
      </div>
      {expanded ? (
        queueLoading ? (
          <p className="subtle-text">분류 대기 문서를 불러오는 중…</p>
        ) : (queueItems ?? []).length === 0 ? (
          <EmptyState
            title="분류 대기 문서가 없습니다."
            body="자동 분류에서 확신도가 낮았던 문서만 여기에 모입니다."
          />
        ) : (
          <div className="stack-form">
            {/* hub-assignment (b): 단일 후보 항목 전건을 그 후보 업무로 한 번에 확정한다. */}
            <div className="knowledge-index-status-row" data-testid="taxonomy-queue-bulk-toolbar">
              <button
                type="button"
                onClick={() =>
                  void resolveBulk(
                    recommendedEntries,
                    `추천 업무로 ${recommendedEntries.length}건을 일괄 반영했습니다.`,
                  )
                }
                disabled={bulkResolving || recommendedEntries.length === 0}
                title={
                  recommendedEntries.length === 0
                    ? "후보가 1개뿐인 문서가 없습니다."
                    : "후보가 1개뿐인 문서 전건을 그 후보 업무로 한 번에 확정합니다."
                }
              >
                추천 일괄 반영 ({recommendedEntries.length}건)
              </button>
              <span className="subtle-text">후보가 1개뿐인 문서는 업무가 미리 선택되어 있습니다.</span>
            </div>
            {Array.from(queueGroups.entries()).map(([groupLabel, groupItems]) => {
              const groupSlug = groupSelections[groupLabel] ?? "";
              const groupAreaOptions = areaOptionsFor(groupItems[0].source_id);
              const groupAreaName = groupAreaOptions.find((area) => area.slug === groupSlug)?.name;
              return (
                <div key={groupLabel} data-testid="taxonomy-queue-group">
                  {/* hub-assignment (b): 1단계 폴더 그룹 헤더 — 그룹 전체 일괄 반영 */}
                  <div className="knowledge-index-status-row" data-testid="taxonomy-queue-group-header">
                    <span className="pill pill--soft">{cleanFolderLabel(groupLabel)}</span>
                    <span className="subtle-text">{groupItems.length}건</span>
                    <label>
                      그룹 업무
                      <select
                        aria-label={`${groupLabel} 그룹 업무 선택`}
                        value={groupSlug}
                        onChange={(event) =>
                          setGroupSelections((current) => ({
                            ...current,
                            [groupLabel]: event.target.value,
                          }))
                        }
                      >
                        <option value="">선택 안 함</option>
                        {groupAreaOptions.map((area) => (
                          <option key={area.slug} value={area.slug}>
                            {area.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() =>
                        void resolveBulk(
                          groupItems.map((item) => {
                            const docRole = (selections[item.id] ?? taxonomyQueueDefaultSelection(item)).doc_role;
                            return {
                              item,
                              work_area_slug: groupSlug,
                              ...(docRole ? { doc_role: docRole } : {}),
                            };
                          }),
                          `${cleanFolderLabel(groupLabel)} 그룹 ${groupItems.length}건을 '${groupAreaName ?? groupSlug}' 업무로 반영했습니다.`,
                        )
                      }
                      disabled={bulkResolving || !groupSlug}
                      title={
                        groupSlug
                          ? "이 그룹의 분류 대기 문서 전건을 선택한 업무로 확정합니다."
                          : "그룹 업무를 먼저 선택해 주세요."
                      }
                    >
                      이 그룹 전체를 [선택 업무]로 반영
                    </button>
                  </div>
                  <div className="item-list item-list--compact">
            {groupItems.map((item) => {
              const areaOptions = areaOptionsFor(item.source_id);
              const selection = selections[item.id] ?? taxonomyQueueDefaultSelection(item);
              const candidateAreas = item.candidates?.work_areas ?? [];
              return (
                <article key={item.id} className="list-card list-card--compact" data-testid="taxonomy-queue-item">
                  <div className="list-card__main list-card__main--static">
                    <div>
                      <h3>{displayTitleForFile(item.title || item.doc_slug, item.source_path) || "제목 없는 문서"}</h3>
                      <p>{relativePath(item.source_path)}</p>
                    </div>
                    <span className="pill pill--warning">{taxonomyQueueReasonLabel(item.reason)}</span>
                  </div>
                  {candidateAreas.length > 0 ? (
                    <div className="document-preview__meta">
                      <span className="subtle-text">후보:</span>
                      {candidateAreas.map((candidate) => (
                        <button
                          key={candidate.work_area_slug}
                          type="button"
                          className="knowledge-query-history__chip"
                          onClick={() => updateSelection(item, { work_area_slug: candidate.work_area_slug })}
                          title="이 후보 업무로 선택합니다."
                        >
                          {candidate.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="taxonomy-queue-controls">
                    <label>
                      업무
                      <select
                        aria-label={`${item.title} 업무 선택`}
                        value={selection.work_area_slug}
                        onChange={(event) => updateSelection(item, { work_area_slug: event.target.value })}
                      >
                        <option value="">선택 안 함</option>
                        {areaOptions.map((area) => (
                          <option key={area.slug} value={area.slug}>
                            {area.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      유형
                      <select
                        aria-label={`${item.title} 유형 선택`}
                        value={selection.doc_role}
                        onChange={(event) => updateSelection(item, { doc_role: event.target.value })}
                      >
                        <option value="">선택 안 함</option>
                        {TAXONOMY_DOC_ROLES.map((role) => (
                          <option key={role.key} value={role.key}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => void resolveItem(item)}
                      disabled={resolvingId === item.id || (!selection.work_area_slug && !selection.doc_role)}
                      title={
                        !selection.work_area_slug && !selection.doc_role
                          ? "업무 또는 유형을 먼저 선택해 주세요."
                          : "선택한 업무/유형으로 이 문서의 분류를 확정합니다."
                      }
                    >
                      반영
                    </button>
                  </div>
                </article>
              );
            })}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : null}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 주제 어휘집 팩 규격(2026-07-12) §5 기관팩 임포트 + §6 후보 큐 승인
// ---------------------------------------------------------------------------

/** §6: 표본 문서 항목(문자열/객체 혼용 허용)을 표시용 짧은 라벨로 바꾼다. */
function vocabSampleDocLabel(
  doc: string | { title?: string | null; file_path?: string | null },
): string {
  if (typeof doc === "string") {
    return relativePath(doc);
  }
  if (doc.title && doc.title.trim()) {
    return doc.title;
  }
  return doc.file_path ? relativePath(doc.file_path) : "";
}

type VocabPackBlockProps = {
  /** full: 설정 탭 위키 구성 카드용(층 요약·제거 버튼 포함) / compact: 마법사 1단계 하단 축약형. */
  variant: "full" | "compact";
  pushToast: TaxonomyToastPush;
  /** 다른 블록(마법사 축약형 등)에서 팩이 바뀌면 증가 — 요약을 다시 조회한다. */
  refreshKey?: number;
  /** 임포트/제거 성공 시 호출 — 상위가 형제 블록·후보 섹션을 갱신하는 데 쓴다. */
  onChanged?: () => void;
};

/**
 * §5 "기관 어휘집 팩" 블록 — 현재 적용 팩 정보(GET /api/knowledge/vocab) 표시,
 * 파일 경로 임포트(POST /pack), 제거(DELETE /pack). 검증 실패 시 저장하지 않고
 * 서버가 돌려준 오류 목록 전체를 그대로 렌더한다(부분 임포트 금지).
 */
function VocabPackBlock({ variant, pushToast, refreshKey = 0, onChanged }: VocabPackBlockProps) {
  const [summary, setSummary] = useState<KnowledgeVocabSummary | null>(null);
  const [packPath, setPackPath] = useState("");
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [importResult, setImportResult] = useState<KnowledgeVocabPackImportResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function refreshSummary() {
    try {
      setSummary(await fetchVocabSummary());
    } catch {
      // 구버전 서버/백엔드 미기동 — 요약 없이 "미적용"으로 표시한다.
      setSummary(null);
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await fetchVocabSummary();
        if (active) {
          setSummary(result);
        }
      } catch {
        if (active) {
          setSummary(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const institution = summary?.layers.institution ?? null;
  const isCompact = variant === "compact";

  async function runImport() {
    const path = packPath.trim();
    if (!path) {
      return;
    }
    setImporting(true);
    setRequestError(null);
    setImportResult(null);
    try {
      const result = await importVocabPack({ path });
      setImportResult(result);
      if (result.ok) {
        const imported = result.imported;
        pushToast(
          "info",
          imported
            ? `기관 어휘집 팩을 적용했습니다 — ${imported.name} v${imported.version} · 주제 ${imported.topics}개`
            : "기관 어휘집 팩을 적용했습니다.",
        );
        setPackPath("");
        await refreshSummary();
        onChanged?.();
      } else {
        pushToast("error", "어휘집 팩 검증에 실패했습니다. 오류 목록을 확인해 주세요.");
      }
    } catch (importError) {
      const message =
        importError instanceof Error ? importError.message : "어휘집 팩을 불러오지 못했습니다.";
      setRequestError(message);
      pushToast("error", message);
    } finally {
      setImporting(false);
    }
  }

  async function runRemove() {
    setRemoving(true);
    setRequestError(null);
    setImportResult(null);
    try {
      await removeVocabPack();
      pushToast("info", "기관 어휘집 팩을 제거했습니다. 기존 문서 주제는 유지되고 이후 태깅에만 반영됩니다.");
      await refreshSummary();
      onChanged?.();
    } catch (removeError) {
      const message =
        removeError instanceof Error ? removeError.message : "어휘집 팩을 제거하지 못했습니다.";
      setRequestError(message);
      pushToast("error", message);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div
      className="knowledge-settings-subgroup"
      data-testid={isCompact ? "knowledge-vocab-pack-compact" : "knowledge-vocab-pack"}
    >
      <div className="document-preview__meta">
        <span className="pill">기관 어휘집 팩</span>
        <span className="subtle-text">
          {isCompact
            ? "기관 어휘집 팩(.gongmu-vocab.json)이 있다면 지금 불러와 두세요(선택)."
            : "기관 고유 업무 주제 어휘집(.gongmu-vocab.json)을 불러오면 주제 태깅이 통제어휘 기반으로 정돈됩니다."}
        </span>
      </div>
      <div className="document-preview__meta" data-testid="knowledge-vocab-pack-status">
        {institution ? (
          <>
            <span className="pill pill--soft">적용 중</span>
            <span>
              {institution.name} · v{institution.version} · 주제 {institution.topics}개
            </span>
          </>
        ) : (
          <span className="pill pill--soft">미적용</span>
        )}
        {!isCompact && summary ? (
          <span className="subtle-text">
            내장 공통 {summary.layers.common} · 승인 확장 {summary.layers.user}
          </span>
        ) : null}
      </div>
      <div className="taxonomy-area-add">
        <label>
          팩 파일 경로
          <input
            value={packPath}
            onChange={(event) => setPackPath(event.target.value)}
            placeholder="C:\Users\USER\Documents\기관어휘집.gongmu-vocab.json"
          />
        </label>
        <button
          type="button"
          className="button-secondary"
          onClick={() => void runImport()}
          disabled={importing || !packPath.trim()}
          title={
            !packPath.trim()
              ? "어휘집 팩 파일(.gongmu-vocab.json) 경로를 먼저 입력해 주세요."
              : "입력한 경로의 어휘집 팩을 검증한 뒤 적용합니다."
          }
        >
          {importing ? "불러오는 중…" : "팩 불러오기"}
        </button>
        {!isCompact && institution ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() => void runRemove()}
            disabled={removing}
            title="적용 중인 기관 어휘집 팩을 제거합니다. 이미 태깅된 문서 주제는 유지됩니다."
          >
            {removing ? "제거 중…" : "팩 제거"}
          </button>
        ) : null}
      </div>
      {requestError ? (
        <div className="hint-box hint-box--warning" role="alert">
          {requestError}
        </div>
      ) : null}
      {importResult && !importResult.ok ? (
        <div
          className="hint-box hint-box--warning"
          role="alert"
          data-testid="knowledge-vocab-import-errors"
        >
          <p>팩을 저장하지 않았습니다 — 아래 오류를 모두 수정한 뒤 다시 불러와 주세요.</p>
          <ul>
            {(importResult.errors ?? []).map((error, index) => (
              <li key={`${index}-${error.slice(0, 24)}`}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {importResult?.ok && importResult.imported ? (
        <p className="subtle-text" data-testid="knowledge-vocab-import-result">
          불러오기 완료 — {importResult.imported.name} v{importResult.imported.version} · 주제{" "}
          {importResult.imported.topics}개
        </p>
      ) : null}
      {importResult && (importResult.warnings ?? []).length > 0 ? (
        <div className="hint-box" data-testid="knowledge-vocab-import-warnings">
          {(importResult.warnings ?? []).map((warning) => (
            <p key={warning} className="subtle-text">
              {warning}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type VocabCandidateSectionProps = {
  /** 팩 임포트/제거 시 증가 — 후보·병합 대상 주제 목록을 다시 조회한다. */
  refreshKey: number;
  pushToast: TaxonomyToastPush;
};

/**
 * §6 확장: 서버 추천을 렌더 그룹으로 환원한다 — merge 추천인데 대상 id가 없거나
 * 구버전 서버라 필드가 없으면 안전하게 review(사람 검토)로 강등한다.
 */
function vocabRecommendationOf(
  item: KnowledgeVocabCandidateItem,
): "merge" | "reject" | "review" {
  if (item.recommended_action === "merge" && item.recommended_target_id) {
    return "merge";
  }
  if (item.recommended_action === "reject") {
    return "reject";
  }
  return "review";
}

/**
 * §6 "주제 어휘 후보" 섹션 — 자동 선별(triage) 추천과 함께 pending 후보를 처리한다.
 * 검토 필요(review)만 기본 펼침 목록으로 보여주고, merge/reject 추천분은 접힌
 * "자동 처리 예정" 그룹 + 상단 [추천 일괄 적용] 버튼으로 몰아 사용자 압도를 막는다.
 * 각 행에는 추천 배지와 개별 오버라이드([승인]/[병합]/[거절])를 유지한다.
 * 후보 조회가 실패하면(구버전 서버/백엔드 미기동) 섹션 전체를 숨긴다.
 */
function VocabCandidateSection({ refreshKey, pushToast }: VocabCandidateSectionProps) {
  const [candidates, setCandidates] = useState<KnowledgeVocabCandidateItem[] | null>(null);
  const [topics, setTopics] = useState<KnowledgeVocabTopicItem[]>([]);
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [applyingRecommended, setApplyingRecommended] = useState(false);
  /** 일괄 적용 후 서버 상태를 다시 읽기 위한 내부 재조회 트리거. */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [candidatesResult, summaryResult] = await Promise.allSettled([
        fetchVocabCandidates("pending"),
        fetchVocabSummary(),
      ]);
      if (!active) {
        return;
      }
      setCandidates(candidatesResult.status === "fulfilled" ? candidatesResult.value.items : null);
      setTopics(
        summaryResult.status === "fulfilled"
          ? summaryResult.value.topics.filter((topic) => topic.enabled !== false)
          : [],
      );
    })();
    return () => {
      active = false;
    };
  }, [refreshKey, reloadKey]);

  async function decide(
    item: KnowledgeVocabCandidateItem,
    payload: KnowledgeVocabCandidateDecisionPayload,
    successMessage: string,
  ) {
    setDecidingId(item.id);
    try {
      await decideVocabCandidate(item.id, payload);
      setCandidates((current) => (current ?? []).filter((candidate) => candidate.id !== item.id));
      pushToast("info", successMessage);
    } catch (decideError) {
      pushToast(
        "error",
        decideError instanceof Error ? decideError.message : "주제 후보 처리에 실패했습니다.",
      );
    } finally {
      setDecidingId(null);
    }
  }

  async function applyRecommended() {
    setApplyingRecommended(true);
    try {
      const result = await applyRecommendedVocabCandidates();
      pushToast(
        "info",
        `추천을 일괄 적용했습니다 — 병합 ${result.merged}건 · 거절 ${result.rejected}건 · 검토 필요 ${result.remaining_review}건 남음`,
      );
      // 병합으로 어휘집(동의어)이 바뀌었을 수 있으므로 후보·주제 목록을 함께 재조회한다.
      setReloadKey((value) => value + 1);
    } catch (applyError) {
      pushToast(
        "error",
        applyError instanceof Error ? applyError.message : "추천 일괄 적용에 실패했습니다.",
      );
    } finally {
      setApplyingRecommended(false);
    }
  }

  if (candidates === null) {
    return null;
  }

  const topicNameById = new Map(topics.map((topic) => [topic.id, topic.name]));
  const reviewItems = candidates.filter((item) => vocabRecommendationOf(item) === "review");
  const autoItems = candidates.filter((item) => vocabRecommendationOf(item) !== "review");
  const mergeCount = autoItems.filter((item) => vocabRecommendationOf(item) === "merge").length;
  const rejectCount = autoItems.length - mergeCount;

  function renderCandidate(item: KnowledgeVocabCandidateItem) {
    const recommendation = vocabRecommendationOf(item);
    const recommendedTargetName = item.recommended_target_id
      ? (topicNameById.get(item.recommended_target_id) ?? item.recommended_target_id)
      : "";
    const mergeTarget = mergeTargets[item.id] ?? "";
    const sampleLabels = (item.sample_docs ?? []).map(vocabSampleDocLabel).filter(Boolean);
    const busy = decidingId === item.id;
    return (
      <article
        key={item.id}
        className="list-card list-card--compact"
        data-testid="vocab-candidate-item"
      >
        <div className="list-card__main list-card__main--static">
          <div>
            <h3>{item.name}</h3>
            <p>
              등장 {item.hit_count}회
              {sampleLabels.length > 0 ? ` · 표본 문서: ${sampleLabels.join(", ")}` : ""}
            </p>
          </div>
          {recommendation === "merge" ? (
            <span className="pill pill--soft" data-testid="vocab-candidate-recommendation">
              병합 추천 → {recommendedTargetName}
            </span>
          ) : recommendation === "reject" ? (
            <span className="pill pill--soft" data-testid="vocab-candidate-recommendation">
              거절 추천
            </span>
          ) : (
            <span className="pill pill--warning" data-testid="vocab-candidate-recommendation">
              검토 필요
            </span>
          )}
        </div>
        <div className="taxonomy-queue-controls">
          <button
            type="button"
            onClick={() =>
              void decide(
                item,
                { action: "approve" },
                `'${item.name}' 주제를 어휘집에 추가했습니다.`,
              )
            }
            disabled={busy}
            title="이 후보를 정식 주제로 어휘집에 편입합니다."
          >
            승인
          </button>
          <label>
            병합 대상
            <select
              aria-label={`${item.name} 병합 대상 선택`}
              value={mergeTarget}
              onChange={(event) =>
                setMergeTargets((current) => ({ ...current, [item.id]: event.target.value }))
              }
            >
              <option value="">기존 주제 선택</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              const target = topics.find((topic) => topic.id === mergeTarget);
              void decide(
                item,
                { action: "merge", merge_into_id: mergeTarget },
                `'${item.name}'을(를) '${target?.name ?? mergeTarget}' 주제의 동의어로 병합했습니다.`,
              );
            }}
            disabled={busy || !mergeTarget}
            title={
              mergeTarget
                ? "이 후보명을 선택한 주제의 동의어로 추가합니다."
                : "병합할 기존 주제를 먼저 선택해 주세요."
            }
          >
            병합
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() =>
              void decide(item, { action: "reject" }, `'${item.name}' 후보를 거절했습니다.`)
            }
            disabled={busy}
            title="이 후보를 어휘집에 추가하지 않습니다."
          >
            거절
          </button>
        </div>
      </article>
    );
  }

  return (
    <SectionCard eyebrow="주제 어휘" title="주제 어휘 후보" testId="knowledge-vocab-candidates">
      <div className="helper-copy">
        <p>
          색인·요약 보강 중 어휘집에 없는 새 주제 제안이 여기에 모입니다. 기존 주제의 표기
          변형은 병합, 일회성 잡음은 거절로 자동 추천되므로 검토 필요 후보만 직접 판단하면
          됩니다.
        </p>
      </div>
      {candidates.length === 0 ? (
        <EmptyState
          title="대기 중인 주제 후보가 없습니다."
          body="색인이나 LLM 요약 보강 중 새 주제가 제안되면 여기에 표시됩니다."
        />
      ) : (
        <>
          <div className="taxonomy-queue-controls">
            <button
              type="button"
              onClick={() => void applyRecommended()}
              disabled={applyingRecommended || autoItems.length === 0}
              data-testid="vocab-apply-recommended"
              title={
                autoItems.length === 0
                  ? "자동 처리(병합/거절) 추천 후보가 없습니다."
                  : "병합 추천은 대상 주제의 동의어로, 거절 추천은 거절로 한 번에 처리합니다. 검토 필요 후보는 남습니다."
              }
            >
              {applyingRecommended
                ? "적용 중…"
                : `추천 일괄 적용 (병합 ${mergeCount} · 거절 ${rejectCount})`}
            </button>
          </div>
          {reviewItems.length > 0 ? (
            <div className="item-list item-list--compact" data-testid="vocab-review-list">
              {reviewItems.map((item) => renderCandidate(item))}
            </div>
          ) : (
            <p className="subtle-text">검토가 필요한 후보는 없습니다.</p>
          )}
          {autoItems.length > 0 ? (
            <details data-testid="vocab-auto-group">
              <summary>자동 처리 예정 {autoItems.length}건</summary>
              <div className="item-list item-list--compact">
                {autoItems.map((item) => renderCandidate(item))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

export function KnowledgeScreen() {
  const {
    error,
    expandedIngestionLogJobId,
    handleAction,
    knowledgeAskResult,
    knowledgeBackendStatus,
    knowledgeDiffBySource,
    knowledgeDocumentStructure,
    knowledgeDocumentTables,
    knowledgeEnrichStarting,
    knowledgeExtractionView,
    knowledgeIngestionLockMessage,
    knowledgeInspectorLoading,
    knowledgePanel,
    knowledgeParserStatus,
    knowledgeQuery,
    knowledgeScanActivity,
    knowledgeSearchResult,
    knowledgeSourceForm,
    knowledgeWikiIndex,
    knowledgeWikiLoading,
    knowledgeWikiPage,
    knowledgeWikiTree,
    lockedKnowledgeIngestion,
    mergeKnowledgeIngestionJob,
    openKnowledgeLogDumpFolder,
    pushToast,
    refreshDeferredSnapshot,
    refreshShellSnapshot,
    revealContextSection,
    runningKnowledgeIngestion,
    selectedSession,
    selectedSessionId,
    setSelectedSessionId,
    setActiveMenu,
    setChatDraft,
    setError,
    setKnowledgeAskResult,
    setKnowledgeDiffBySource,
    setKnowledgeDocumentStructure,
    setKnowledgeDocumentTables,
    setKnowledgeEnrichStarting,
    setKnowledgeExtractionView,
    setKnowledgeInspectorLoading,
    setKnowledgePanel,
    setKnowledgeQuery,
    setKnowledgeScanActivity,
    setKnowledgeSearchResult,
    setKnowledgeSourceForm,
    setKnowledgeWikiLoading,
    setKnowledgeWikiPage,
    setKnowledgeWikiTree,
    setNotice,
    setSnapshot,
    snapshot,
    submitting,
    toggleKnowledgeLogDump,
    connectLocalFileToSession,
  } = useAppStore();

  // F-14: 검색 단일 질의 모델 — 검색 방법 선택과 질의 히스토리는 화면 로컬 상태로 관리한다.
  // (메뉴 전환 시 화면이 언마운트되면서 히스토리가 초기화되는 것을 허용)
  const [knowledgeSearchMode, setKnowledgeSearchMode] = useState<KnowledgeSearchMode>("keyword");
  const [knowledgeQueryHistory, setKnowledgeQueryHistory] = useState<string[]>([]);

  // 검색·위키 통합: 위키 탭 우측 뷰어가 위키 페이지를 보여줄지, 검색 결과를 보여줄지.
  const [wikiViewerMode, setWikiViewerMode] = useState<"wiki" | "search">("wiki");

  // 위키 이동 히스토리(2026-07-12 UX): 각주·연관주제 링크로 들어가도 '← 이전'으로
  // 직전 페이지에 돌아갈 수 있게 relative_path 스택을 유지한다(최대 20).
  // '← 이전'으로 여는 이동은 push하지 않아(fromHistory) 무한루프를 막는다.
  const [wikiPageHistory, setWikiPageHistory] = useState<string[]>([]);

  // ⑥(3) 핵심문서 미리보기: 트리 문서행에서 카드 마크다운을 우측 뷰어 대체 없이 인플레이스
  // 모달로 미리 본다. 파싱 본문은 이미 fetchWikiPage가 서빙하므로 그대로 재사용한다.
  const [wikiPreview, setWikiPreview] = useState<{ title: string; content: string } | null>(null);
  const [wikiPreviewLoading, setWikiPreviewLoading] = useState(false);

  // T-01: 분류체계 마법사 열림 상태 + 큐/품질 재조회 트리거 (화면 로컬 상태)
  const [taxonomyWizardOpen, setTaxonomyWizardOpen] = useState(false);
  const [taxonomyRefreshKey, setTaxonomyRefreshKey] = useState(0);

  // 어휘집 규격 §5·§6: 팩 임포트/제거 시 증가 — 팩 블록·후보 섹션이 요약을 다시 조회한다.
  const [vocabRefreshKey, setVocabRefreshKey] = useState(0);

  // 대시보드 "위키 구성" 상태 카드 + 드리프트 배지(§5.9)용 — 확정 분류체계·품질(분류 대기 수)을 조회한다.
  // 드리프트 배지는 설정 탭 위키 구성 그룹에도 붙으므로 대시보드·설정 두 탭에서 갱신한다.
  const [dashboardTaxonomy, setDashboardTaxonomy] = useState<TaxonomyStatusResult | null>(null);
  const [dashboardTaxonomyQuality, setDashboardTaxonomyQuality] = useState<TaxonomyQualityResult | null>(null);
  const [dashboardTaxonomyLoaded, setDashboardTaxonomyLoaded] = useState(false);

  // P1 "변경 확인"(설계서 §4.4): diff 견적은 store 공용 상태(knowledgeDiffBySource)를 쓴다
  // (시작 diff §9와 공유) — 실행 중 표시만 화면 로컬 상태로 남긴다.
  const [knowledgeDiffCheckingSourceId, setKnowledgeDiffCheckingSourceId] = useState<string | null>(null);

  // P3 §6: 무결성 점검 — 최근 결과·시작 중·완료 감시 대상 작업 id (화면 로컬 상태).
  const [knowledgeVerifyLatest, setKnowledgeVerifyLatest] = useState<KnowledgeVerifyLatestResult | null>(null);
  const [knowledgeVerifyStarting, setKnowledgeVerifyStarting] = useState(false);
  const [pendingVerifyJobId, setPendingVerifyJobId] = useState<string | null>(null);
  // P0 후속: 스캔 완료 배지용 최근 스캔 결과(보류 unstable_count 노출) — 화면 로컬 상태.
  const [knowledgeScanSummaryBySource, setKnowledgeScanSummaryBySource] = useState<
    Record<string, KnowledgeSourceScanResult>
  >({});

  // 호환 리다이렉트: 구 "search" 패널 키는 위키 탭으로 정규화한다.
  // (store의 위키 목차 자동 로딩 조건이 knowledgePanel === "wiki"이므로 키 자체를 바꿔 준다.)
  const activePanel: KnowledgeWorkspacePanel = knowledgePanel === "search" ? "wiki" : knowledgePanel;
  useEffect(() => {
    if (knowledgePanel === "search") {
      setKnowledgePanel("wiki");
      setWikiViewerMode("search");
    }
  }, [knowledgePanel, setKnowledgePanel]);

  useEffect(() => {
    if (activePanel !== "dashboard" && activePanel !== "indexing") {
      return;
    }
    let active = true;
    void (async () => {
      const [statusResult, qualityResult] = await Promise.allSettled([
        fetchTaxonomyStatus(),
        fetchTaxonomyQuality(),
      ]);
      if (!active) {
        return;
      }
      // 미확정/구버전 서버 — 미구성으로 표시한다.
      setDashboardTaxonomy(statusResult.status === "fulfilled" ? statusResult.value : null);
      setDashboardTaxonomyQuality(qualityResult.status === "fulfilled" ? qualityResult.value : null);
      setDashboardTaxonomyLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [activePanel, taxonomyRefreshKey]);

  // P3 §6: 최근 무결성 점검 결과 — 대시보드 정합성 카드와 설정 탭 결과 카드가 함께 쓴다.
  // 이력이 없거나(404) 구버전 서버면 조용히 비워 둔다.
  useEffect(() => {
    if (activePanel !== "dashboard" && activePanel !== "indexing") {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const latest = await fetchKnowledgeVerifyLatest();
        if (active) {
          setKnowledgeVerifyLatest(latest);
        }
      } catch {
        if (active) {
          setKnowledgeVerifyLatest(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [activePanel]);

  // P3 §6: 시작한 verify 작업이 종결되면 최신 결과를 다시 조회해 결과 카드를 갱신한다.
  useEffect(() => {
    if (!pendingVerifyJobId) {
      return;
    }
    const job = (snapshot.workJobs ?? []).find((workJob) => workJob.id === pendingVerifyJobId);
    if (!job || !["succeeded", "partial", "failed", "canceled"].includes(job.status)) {
      return;
    }
    setPendingVerifyJobId(null);
    if (job.status === "failed") {
      pushToast("error", "무결성 점검이 실패했습니다. 작업 패널에서 원인을 확인하세요.");
      return;
    }
    if (job.status === "canceled") {
      return;
    }
    void (async () => {
      try {
        const latest = await fetchKnowledgeVerifyLatest();
        setKnowledgeVerifyLatest(latest);
      } catch {
        // 결과 조회 실패 — 다음 탭 진입 시 재조회한다.
      }
    })();
  }, [pendingVerifyJobId, snapshot.workJobs]);

  /** 대시보드 [설정으로] — 설정 탭으로 이동한 뒤 해당 그룹 카드로 스크롤한다. */
  function goToSettingsGroup(anchorId?: string) {
    setKnowledgePanel("indexing");
    setKnowledgeExtractionView(false);
    if (!anchorId) {
      return;
    }
    window.setTimeout(() => {
      const element = document.getElementById(anchorId);
      if (element && typeof element.scrollIntoView === "function") {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 60);
  }

  /** T-01: 백그라운드 적용 작업을 기존 작업 진행 UI(작업 패널)로 연결한다. */
  function handleTaxonomyApplied(workJob: WorkJobItem) {
    setSnapshot((current) =>
      mergeWorkspaceSnapshot(current, {
        workJobs: [workJob, ...(current.workJobs ?? []).filter((job) => job.id !== workJob.id)],
      }),
    );
    revealContextSection("jobs");
    setTaxonomyRefreshKey((value) => value + 1);
  }

  /** T-01: 분류 기준 문서(SCHEMA.md)를 위키 페이지 뷰어로 연다. 404면 토스트로 안내한다. */
  async function openSchemaDocument() {
    setTaxonomyWizardOpen(false);
    setKnowledgePanel("wiki");
    setWikiViewerMode("wiki");
    setKnowledgeWikiLoading(true);
    try {
      const page = await fetchWikiPage("SCHEMA.md");
      setKnowledgeWikiPage(page);
    } catch (schemaError) {
      console.warn("failed to open taxonomy schema page", schemaError);
      pushToast("error", "분류 기준 문서(SCHEMA.md)를 아직 찾을 수 없습니다. 분류체계를 먼저 확정해 주세요.");
    } finally {
      setKnowledgeWikiLoading(false);
    }
  }

  async function copyKnowledgeLogDumpPath(logDumpPath: string) {
    try {
      await copyTextToClipboard(logDumpPath);
      pushToast("info", "색인 상세 로그 경로를 복사했습니다.");
    } catch (error) {
      console.warn("failed to copy knowledge wiki log dump path", error);
      pushToast("error", "색인 상세 로그 경로 복사에 실패했습니다.");
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
      { revealSection: "logs", refresh: "none" },
    );
    if (created) {
      setSnapshot((current) =>
        mergeWorkspaceSnapshot(current, {
          knowledgeSources: [created, ...current.knowledgeSources.filter((source) => source.id !== created.id)],
        }),
      );
      setKnowledgeSourceForm({ label: "", root_path: "" });
    }
  }

  async function runKnowledgeSourceScan(
    source: KnowledgeSourceItem,
  ): Promise<KnowledgeSourceScanResult | null> {
    setKnowledgePanel("indexing");
    if (lockedKnowledgeIngestion) {
      setNotice(knowledgeIngestionLockMessage);
      return null;
    }
    setKnowledgeScanActivity({
      sourceId: source.id,
      sourceLabel: source.label,
      startedAt: Date.now(),
    });
    const result = await handleAction(
      () => scanKnowledgeSource(source.id),
      `${source.label} 폴더를 스캔했습니다.`,
      { revealSection: "logs", refresh: "none" },
    );
    void refreshDeferredSnapshot("knowledge");
    void refreshDeferredSnapshot("logs");
    setKnowledgeScanActivity(null);
    if (result) {
      // P0 후속: 스캔 완료 배지에 보류(unstable) 건수를 노출하기 위해 최근 결과를 보관한다.
      setKnowledgeScanSummaryBySource((current) => ({ ...current, [source.id]: result }));
    }
    return result ?? null;
  }

  /**
   * P1 "변경 확인" — 색인을 실행하지 않고 diff 견적만 조회한다(설계서 §4.4).
   * 결과는 화면 로컬 상태에만 저장한다(폴링 아님 — 버튼 실행 시에만 갱신).
   */
  async function runKnowledgeSourceDiff(source: KnowledgeSourceItem) {
    setKnowledgeDiffCheckingSourceId(source.id);
    setError(null);
    try {
      const result = await diffKnowledgeSource(source.id);
      setKnowledgeDiffBySource((current) => ({
        ...current,
        [source.id]: { result, sourceLabel: source.label, checkedAt: new Date().toISOString() },
      }));
    } catch (diffError) {
      setError(diffError instanceof Error ? diffError.message : "변경 확인에 실패했습니다.");
    } finally {
      setKnowledgeDiffCheckingSourceId(null);
    }
  }

  async function runKnowledgeSourceIngestion(source: KnowledgeSourceItem) {
    setKnowledgePanel("indexing");
    if (lockedKnowledgeIngestion) {
      setNotice(knowledgeIngestionLockMessage);
      return;
    }
    const started = await handleAction(
      () => ingestKnowledgeSource(source.id, true, true),
      `${source.label} 색인 작업을 시작했습니다.`,
      { revealSection: "dump", refresh: "none" },
    );
    if (started) {
      await refreshDeferredSnapshot("knowledge");
      mergeKnowledgeIngestionJob(started.job);
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
      `${source.label} 강제 재색인 작업을 시작했습니다.`,
      { revealSection: "dump", refresh: "none" },
    );
    if (started) {
      await refreshDeferredSnapshot("knowledge");
      mergeKnowledgeIngestionJob(started.job);
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
      setNotice("이미 실행 중인 색인 작업이 있습니다. 현재 작업이 끝난 뒤 실행해 주세요.");
      return;
    }
    const result = await handleAction(
      () => runKnowledgeIngestionJob(job.id),
      "색인 작업을 실행했습니다.",
      { revealSection: "dump", refresh: "shell" },
    );
    if (result) {
      mergeKnowledgeIngestionJob(result.job);
    }
  }

  async function cancelQueuedKnowledgeIngestionJob(job: KnowledgeIngestionJobItem) {
    const result = await handleAction(
      () => cancelKnowledgeIngestionJob(job.id),
      "색인 작업 취소를 요청했습니다.",
      { revealSection: "dump", refresh: "shell" },
    );
    if (result) {
      mergeKnowledgeIngestionJob(result.job);
    }
  }

  function recordKnowledgeQueryHistory(query: string) {
    setKnowledgeQueryHistory((current) =>
      [query, ...current.filter((item) => item !== query)].slice(0, KNOWLEDGE_QUERY_HISTORY_LIMIT),
    );
  }

  async function runKnowledgeSearchQuery(query: string) {
    setKnowledgePanel("wiki");
    setWikiViewerMode("search");
    setKnowledgeInspectorLoading(true);
    setError(null);
    try {
      const result = await searchKnowledge(query);
      setKnowledgeSearchResult(result);
      // F-14: 결과 영역은 항상 최신 질의 1건 — 이전 근거 답변은 함께 비운다.
      setKnowledgeAskResult(null);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "지식 검색을 실행하지 못했습니다.");
    } finally {
      setKnowledgeInspectorLoading(false);
    }
  }

  async function runKnowledgeAskQuery(query: string) {
    setKnowledgePanel("wiki");
    setWikiViewerMode("search");
    setKnowledgeInspectorLoading(true);
    setError(null);
    try {
      const result = await askKnowledge(query, { session_id: selectedSessionId ?? null, limit: 5 });
      setKnowledgeAskResult(result);
      // F-14: 근거 답변 실행 시 이전 키워드 검색 결과를 비운다.
      setKnowledgeSearchResult(null);
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : "근거 답변을 생성하지 못했습니다.");
    } finally {
      setKnowledgeInspectorLoading(false);
    }
  }

  async function submitKnowledgeQuery(mode: KnowledgeSearchMode = knowledgeSearchMode, queryOverride?: string) {
    const query = (queryOverride ?? knowledgeQuery).trim();
    if (!query) {
      return;
    }
    recordKnowledgeQueryHistory(query);
    if (mode === "keyword") {
      await runKnowledgeSearchQuery(query);
    } else {
      await runKnowledgeAskQuery(query);
    }
  }

  function rerunKnowledgeQueryFromHistory(query: string) {
    setKnowledgeQuery(query);
    void submitKnowledgeQuery(knowledgeSearchMode, query);
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

  async function startKnowledgeEnrichJob() {
    if (knowledgeBackendStatus?.llm_enrichment && !knowledgeBackendStatus.llm_enrichment.configured) {
      setNotice("LLM 요약 보강을 사용하려면 환경설정에서 LLM 연결을 먼저 구성하세요.");
      return;
    }
    setKnowledgeEnrichStarting(true);
    setError(null);
    try {
      const started = await startKnowledgeEnrich({ background: true });
      if (started.work_job) {
        setSnapshot((current) =>
          mergeWorkspaceSnapshot(current, {
            workJobs: [
              started.work_job,
              ...(current.workJobs ?? []).filter((job) => job.id !== started.work_job.id),
            ],
          }),
        );
      }
      revealContextSection("jobs");
      setNotice("LLM 요약 보강 작업을 시작했습니다. 진행 상황은 작업 패널에서 확인하세요.");
    } catch (enrichError) {
      setError(enrichError instanceof Error ? enrichError.message : "LLM 요약 보강을 시작하지 못했습니다.");
    } finally {
      setKnowledgeEnrichStarting(false);
    }
  }

  /**
   * P3 §6: 무결성 점검 잡 시작 — quick(기본)은 재해시 없이 빠르게, deep은 전량 재해시.
   * 진행은 기존 작업 패널(work_job)로 흘려보내고, 종결 감시는 pendingVerifyJobId effect가 맡는다.
   */
  async function startKnowledgeVerifyJob(deep: boolean) {
    if (lockedKnowledgeIngestion) {
      setNotice(knowledgeIngestionLockMessage);
      return;
    }
    setKnowledgeVerifyStarting(true);
    setError(null);
    try {
      const started = await startKnowledgeVerify({ deep });
      setSnapshot((current) =>
        mergeWorkspaceSnapshot(current, {
          workJobs: [
            started.work_job,
            ...(current.workJobs ?? []).filter((job) => job.id !== started.work_job.id),
          ],
        }),
      );
      setPendingVerifyJobId(started.work_job.id);
      revealContextSection("jobs");
      setNotice(
        deep
          ? "심층 무결성 점검을 시작했습니다. 전체 파일을 다시 읽으므로 수 분이 걸릴 수 있습니다."
          : "무결성 점검을 시작했습니다. 진행 상황은 작업 패널에서 확인하세요.",
      );
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "무결성 점검을 시작하지 못했습니다.");
    } finally {
      setKnowledgeVerifyStarting(false);
    }
  }

  /**
   * P3 §5.9: 드리프트 제안 배지 클릭 — 분류체계 마법사 재진입.
   * 신규 폴더 후보는 마법사가 폴더 재분석으로 자연 반영하므로 별도 프리필이 필요 없다.
   * 자동 재구성은 하지 않는다(확정 전까지 기존 체계 유지).
   */
  function openTaxonomyWizardFromDrift() {
    setKnowledgePanel("indexing");
    setKnowledgeExtractionView(false);
    setTaxonomyWizardOpen(true);
  }

  function isRelativeWikiPageTarget(target: string) {
    const trimmed = target.trim();
    if (!trimmed || !/\.md$/i.test(trimmed)) {
      return false;
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      return false;
    }
    return !trimmed.startsWith("/") && !trimmed.startsWith("\\");
  }

  // 위키 내부 링크는 "여는 페이지의 디렉터리" 기준의 상대경로(예: work-areas 허브의
  // ../docs/foo.md)라, 열린 페이지 경로를 base로 삼아 ./..를 정규화해야 wiki_root 안으로
  // 떨어진다. base 없이 그냥 fetch하면 백엔드가 wiki_root 밖으로 resolve → 400 (2026-07-08 리뷰).
  function resolveWikiTargetPath(target: string, base?: string): string {
    const trimmed = target.trim().replace(/\\/g, "/");
    // 위키링크([[topics/slug]]) 등 vault-root 기준 경로는 현재 페이지 디렉터리를 base로
    // 적용하면 안 된다(docs/foo.md 안의 topics/x.md → docs/topics/x.md 오해석). 알려진
    // 최상위 디렉터리로 시작하고 상대 이동(../)이 없으면 wiki_root 기준으로 해석한다(⑤).
    const rootRelative =
      /^(docs|topics|work|work-areas|extracted)\//.test(trimmed) && !trimmed.includes("../");
    const baseDir =
      base && !rootRelative ? base.replace(/\\/g, "/").replace(/\/[^/]*$/, "") : "";
    const combined = baseDir ? `${baseDir}/${trimmed}` : trimmed;
    const parts: string[] = [];
    for (const seg of combined.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        parts.pop();
        continue;
      }
      parts.push(seg);
    }
    return parts.join("/");
  }

  /** 위키 이동 히스토리 상한 — 스택이 무한히 자라지 않게 오래된 항목부터 버린다. */
  const WIKI_HISTORY_LIMIT = 20;

  async function openKnowledgeWikiTarget(
    target: string,
    base?: string,
    options?: { fromHistory?: boolean },
  ) {
    if (!isRelativeWikiPageTarget(target)) {
      await openExternalTarget(target);
      return;
    }
    // 검색 결과 뷰에서 위키 문서를 열면 뷰어를 위키 모드로 되돌린다.
    setWikiViewerMode("wiki");
    setKnowledgeWikiLoading(true);
    setError(null);
    try {
      const page = await fetchWikiPage(resolveWikiTargetPath(target, base));
      // 페이지 전환 성공 시에만 직전 페이지를 push — '← 이전'을 통한 이동은 제외(무한루프 방지).
      const previousPath = knowledgeWikiPage?.relative_path ?? null;
      if (!options?.fromHistory && previousPath && previousPath !== page.relative_path) {
        setWikiPageHistory((current) => [...current, previousPath].slice(-WIKI_HISTORY_LIMIT));
      }
      setKnowledgeWikiPage(page);
    } catch (pageError) {
      setError(pageError instanceof Error ? pageError.message : "지식위키 문서를 열지 못했습니다.");
    } finally {
      setKnowledgeWikiLoading(false);
    }
  }

  /** '← 이전': 히스토리 스택 top의 페이지로 돌아간다(이 이동은 push하지 않는다). */
  function goBackWikiPage() {
    const previous = wikiPageHistory[wikiPageHistory.length - 1];
    if (!previous) {
      return;
    }
    setWikiPageHistory((current) => current.slice(0, -1));
    void openKnowledgeWikiTarget(previous, undefined, { fromHistory: true });
  }

  /** '← 목차'/주제 관리 성공 시: 뷰어를 목차 상태로 되돌리고 히스토리를 초기화한다. */
  function returnToWikiToc() {
    setKnowledgeWikiPage(null);
    setWikiPageHistory([]);
  }

  /** ⑥(3) 트리 문서행 미리보기 — 카드 마크다운을 우측 뷰어 대체 없이 인플레이스 모달로 띄운다. */
  async function openWikiDocPreview(path: string, title: string) {
    setWikiPreviewLoading(true);
    setWikiPreview({ title, content: "" });
    try {
      const page = await fetchWikiPage(resolveWikiTargetPath(path));
      setWikiPreview({ title, content: page.content });
    } catch (previewError) {
      setWikiPreview({
        title,
        content: previewError instanceof Error ? previewError.message : "문서를 불러오지 못했습니다.",
      });
    } finally {
      setWikiPreviewLoading(false);
    }
  }

  /** J-08: 검색 결과 항목에서 위키 문서 카드 상대 경로를 유도한다. */
  function knowledgeItemWikiTarget(item: KnowledgeSearchItem): string | null {
    if (item.slug) {
      return `docs/${item.slug}.md`;
    }
    if (item.card_path) {
      const normalized = item.card_path.replace(/\\/g, "/");
      const marker = "/wiki/";
      const index = normalized.lastIndexOf(marker);
      if (index >= 0) {
        return normalized.slice(index + marker.length);
      }
    }
    return null;
  }

  function openKnowledgeItemWikiCard(item: KnowledgeSearchItem) {
    const target = knowledgeItemWikiTarget(item);
    if (!target) {
      return;
    }
    setKnowledgePanel("wiki");
    void openKnowledgeWikiTarget(target);
  }

  /** J-08: 검색 결과를 파일찾기 연결 핸들러(D-04) 형태로 변환해 세션에 연결한다. */
  function toLocalFileHit(item: KnowledgeSearchItem): LocalFileSearchResult["items"][number] {
    return {
      file: {
        id: item.document_id ?? item.doc_id,
        source_id: "",
        file_path: item.source_path,
        relative_path: item.relative_path ?? item.source_path,
        file_hash: "",
        size_bytes: 0,
        modified_at: "",
        status: "indexed",
        title: displayTitleForFile(item.title, item.source_path),
        mime_type: null,
        text_excerpt: item.snippet ?? null,
        extracted_text_path: null,
        created_at: "",
        updated_at: "",
      },
      score: item.score ?? 0,
      match_reasons: [],
    };
  }

  async function copyKnowledgeAnswer(answer: string) {
    try {
      await copyTextToClipboard(answer);
      pushToast("info", "근거 답변을 복사했습니다.");
    } catch (copyError) {
      console.warn("failed to copy knowledge answer", copyError);
      pushToast("error", "근거 답변 복사에 실패했습니다.");
    }
  }

  /** F-14: 선택된 세션이 없으면 자동으로 새 세션을 만들어 연계 흐름의 맥락 유실을 막는다. */
  async function ensureWorkSession(): Promise<string | null> {
    if (selectedSessionId) {
      return selectedSessionId;
    }
    try {
      const created = await createWorkSession({ title: "새 업무 세션", schedule_id: null });
      setSnapshot((current) => ({
        ...current,
        workSessions: [created, ...current.workSessions.filter((session) => session.id !== created.id)],
      }));
      setSelectedSessionId(created.id);
      pushToast("info", "업무대화 세션을 새로 만들었습니다.");
      return created.id;
    } catch {
      pushToast("error", "업무대화 세션 생성에 실패했습니다.");
      return null;
    }
  }

  /** J-08: 근거 답변을 업무대화 컴포저에 프리필하고 이동한다. */
  async function continueAnswerInChat(query: string, answer: string) {
    await ensureWorkSession();
    setChatDraft(`지식폴더 근거 답변을 이어서 검토하고 싶습니다.\n질문: ${query}\n\n${answer}`);
    setActiveMenu("chat");
    pushToast("info", "업무대화 입력창에 근거 답변을 채워 두었습니다.");
  }

  /** J-09: 위키 문서 헤더의 "이 문서로 질문하기" — 업무대화 컴포저에 문서 제목을 프리필하고 이동한다. */
  function askAboutWikiPage(title: string) {
    setChatDraft(`『${title}』 문서에서 `);
    setActiveMenu("chat");
    pushToast("info", "업무대화 입력창에 이 문서 이름을 채워 두었습니다.");
  }

  /** J-09: 위키 문서 헤더의 "관련 검색" — 위키 탭 검색 바로 문서 제목 키워드 검색을 즉시 실행한다. */
  function searchRelatedToWikiPage(title: string) {
    setKnowledgeSearchMode("keyword");
    setKnowledgeQuery(title);
    void submitKnowledgeQuery("keyword", title);
  }

  async function copyWikiSourcePath(sourcePath: string) {
    try {
      await copyTextToClipboard(sourcePath);
      pushToast("info", "원본 경로를 복사했습니다.");
    } catch (copyError) {
      console.warn("failed to copy wiki source path", copyError);
      pushToast("error", "원본 경로 복사에 실패했습니다.");
    }
  }

  /** 주제 병합/삭제 후 위키 목차 트리를 다시 조회한다(실패 시 다음 탭 진입 때 store가 재조회). */
  async function refreshKnowledgeWikiTree() {
    try {
      setKnowledgeWikiTree(await fetchWikiTree());
    } catch (treeError) {
      console.warn("failed to refresh knowledge wiki tree", treeError);
    }
  }

  /** 주제 상세 관리(2026-07-12 UX): 주제를 다른 어휘집 주제로 병합 — synonym 편입 + 문서 재태깅. */
  async function mergeKnowledgeWikiTopic(topic: string, intoTopicId: string, intoTopicName: string) {
    const confirmed = window.confirm(
      `'${topic}' 주제를 '${intoTopicName}' 주제로 병합할까요?\n` +
        `이 주제로 분류된 문서가 '${intoTopicName}'(으)로 재분류되고, 기존 주제 페이지는 삭제됩니다.`,
    );
    if (!confirmed) {
      return;
    }
    try {
      const result = await mergeWikiTopic({ topic, into_topic_id: intoTopicId });
      pushToast(
        "info",
        `'${topic}' 주제를 '${intoTopicName}'(으)로 병합했습니다 — 문서 ${result.retagged_docs}건 재분류.`,
      );
      returnToWikiToc();
      await refreshKnowledgeWikiTree();
    } catch (mergeError) {
      pushToast("error", mergeError instanceof Error ? mergeError.message : "주제 병합에 실패했습니다.");
    }
  }

  /** 주제 상세 관리(2026-07-12 UX): 주제 삭제(차단) — 문서에서 제거 + 이후 자동 분류 제외. */
  async function deleteKnowledgeWikiTopic(topic: string) {
    const confirmed = window.confirm(
      `'${topic}' 주제를 삭제할까요?\n문서에서 이 주제가 제거되고, 이후 자동 분류에서도 제외됩니다.`,
    );
    if (!confirmed) {
      return;
    }
    try {
      const result = await deleteWikiTopic({ topic });
      pushToast("info", `'${topic}' 주제를 삭제했습니다 — 문서 ${result.retagged_docs}건에서 제거.`);
      returnToWikiToc();
      await refreshKnowledgeWikiTree();
    } catch (deleteError) {
      pushToast("error", deleteError instanceof Error ? deleteError.message : "주제 삭제에 실패했습니다.");
    }
  }

  /** F-18: 위키 페이지 유형(docs/topics/work)에 맞춰 템플릿을 고르고, 실패 시 기존 마크다운 렌더로 폴백한다. */
  function renderWikiPageBody(page: { relative_path: string; content: string }) {
    const actions: WikiTemplateActions = {
      openWikiTarget: (target) => void openKnowledgeWikiTarget(target, page.relative_path),
      askAboutPage: askAboutWikiPage,
      searchRelated: searchRelatedToWikiPage,
      openSource: (sourcePath) => void openExternalTarget(sourcePath),
      copySource: (sourcePath) => void copyWikiSourcePath(sourcePath),
      mergeTopic: (topic, intoTopicId, intoTopicName) =>
        void mergeKnowledgeWikiTopic(topic, intoTopicId, intoTopicName),
      deleteTopic: (topic) => void deleteKnowledgeWikiTopic(topic),
    };
    const kind = inferWikiPageKind(page.relative_path);
    if (!kind) {
      // work-areas 허브·SCHEMA·index 등 폴백 페이지도 front-matter(YAML)·자동생성 주석은
      // 감추고 본문만 렌더한다(전용 템플릿과 동일한 가독성).
      return (
        <div className="chat-markdown">
          {renderMarkdownContent(
            parseWikiFrontMatter(page.content).body.replace(/<!--[\s\S]*?-->/g, "").trim(),
            actions.openWikiTarget,
          )}
        </div>
      );
    }
    try {
      const { meta, body } = parseWikiFrontMatter(page.content);
      const parsedBody = parseWikiBodySections(body);
      if (kind === "docs") {
        return (
          <DocsWikiTemplate meta={meta} parsedBody={parsedBody} fallbackContent={page.content} actions={actions} />
        );
      }
      if (kind === "topics") {
        return (
          <TopicsWikiTemplate meta={meta} parsedBody={parsedBody} fallbackContent={page.content} actions={actions} />
        );
      }
      return (
        <WorkWikiTemplate meta={meta} parsedBody={parsedBody} fallbackContent={page.content} actions={actions} />
      );
    } catch (renderError) {
      // 렌더 실패/비정형 페이지: 오류를 노출하지 않고 기존 마크다운 렌더로 조용히 폴백한다.
      console.warn("failed to render wiki page template", renderError);
      return (
        <div className="chat-markdown">
          {renderMarkdownContent(
            parseWikiFrontMatter(page.content).body.replace(/<!--[\s\S]*?-->/g, "").trim(),
            actions.openWikiTarget,
          )}
        </div>
      );
    }
  }

  function renderKnowledgeSection() {
    const indexedFileCount = snapshot.knowledgeSourceFiles.filter((file) => file.status === "indexed").length;
    const selectedStructureTableCount = knowledgeDocumentTables.length;
    const wikiCounts = knowledgeWikiTree?.counts ?? null;
    const wikiWorkAreas = knowledgeWikiTree?.work_areas ?? [];
    // W7 §5.5: 원본이 삭제/이동된(soft delete) 카드는 폴더 목록에서 분리해
    // 트리 하단 "원본 없는 카드" 그룹으로 모아 보여준다 — "지웠는데 남아있다" 혼동 방지.
    const wikiSourcesWithActiveDocs = (knowledgeWikiTree?.sources ?? []).map((source) => ({
      ...source,
      docs: source.docs.filter((doc) => doc.status !== "missing"),
    }));
    const wikiActiveDocCount = wikiSourcesWithActiveDocs.reduce(
      (total, source) => total + source.docs.length,
      0,
    );
    const wikiMissingDocs = (knowledgeWikiTree?.sources ?? []).flatMap((source) =>
      source.docs.filter((doc) => doc.status === "missing"),
    );
    const hasWikiTree = Boolean(
      knowledgeWikiTree &&
        (knowledgeWikiTree.topics.length > 0 ||
          knowledgeWikiTree.works.length > 0 ||
          wikiWorkAreas.length > 0 ||
          knowledgeWikiTree.sources.length > 0 ||
          knowledgeWikiTree.counts.docs > 0),
    );
    const latestIngestionJob = snapshot.knowledgeIngestionJobs[0] ?? null;
    const searchEngineStatus = describeKnowledgeSearchEngine(knowledgeBackendStatus);
    const kordocAvailable =
      knowledgeBackendStatus?.kordoc?.available ?? knowledgeParserStatus?.kordoc.available ?? null;
    const llmEnrichmentConfigured = knowledgeBackendStatus?.llm_enrichment?.configured ?? null;
    const knowledgeSearchItems = knowledgeSearchResult?.items ?? [];
    const indexedDocCount = wikiCounts?.docs ?? snapshot.knowledgeDocuments.length;
    const primaryKnowledgeSource = snapshot.knowledgeSources[0] ?? null;
    const enrichDisabledReason =
      llmEnrichmentConfigured === false
        ? "환경설정에서 LLM 연결을 구성하면 사용할 수 있습니다."
        : knowledgeEnrichStarting
          ? "LLM 요약 보강 작업을 시작하는 중입니다."
          : null;
    const parserDetail =
      kordocAvailable === false
        ? "HWP/HWPX 본문 추출을 사용할 수 없습니다. Node 실행 환경을 설치한 뒤 앱을 다시 시작해 주세요."
        : knowledgeParserStatus?.kordoc.node_version
          ? `HWP/HWPX 본문 추출 준비 완료 · 실행 환경 Node ${knowledgeParserStatus.kordoc.node_version}`
          : "HWP/HWPX 등 한국어 문서의 본문을 추출하는 파서입니다.";
    const taxonomyConfigured = dashboardTaxonomy?.configured ?? false;
    const taxonomyWorkAreaCount = dashboardTaxonomy?.items?.[0]?.taxonomy?.work_areas?.length ?? 0;
    const taxonomyConfirmedAt = dashboardTaxonomy?.items?.[0]?.confirmed_at ?? null;
    // hub-assignment (d): 재적용 후 잔존할 수 있는 '문서 0건 허브' 수 — 마법사 재확정 정리 권장 힌트 근거.
    // 위키 트리 미로딩 상태에서는 0이 되어 힌트가 숨는다(조건부 표시).
    const zeroDocWorkAreaCount = wikiWorkAreas.filter((area) => area.doc_count === 0).length;
    // P1+P3: 대시보드 색인 카드의 "미반영 변경 N건" 한 줄 — [변경 확인] 실행분과
    // 앱 시작 diff(§9, store 공용 상태) 중 가장 최근 결과를 재사용한다(폴링 아님).
    const knowledgeDiffEntries = Object.values(knowledgeDiffBySource);
    const latestKnowledgeDiff =
      knowledgeDiffEntries.length > 0
        ? knowledgeDiffEntries.reduce((latest, entry) => (entry.checkedAt > latest.checkedAt ? entry : latest))
        : null;
    const latestKnowledgeDiffChanged = latestKnowledgeDiff ? diffChangedTotal(latestKnowledgeDiff.result) : 0;
    // §4.4: "마지막 동기화" = 가장 최근에 완료된 색인 작업 시각.
    const latestCompletedIngestionJob =
      snapshot.knowledgeIngestionJobs.find((job) => Boolean(job.completed_at)) ?? null;
    // P3 §5.9: 분류체계 드리프트 — 제안 배지만, 자동 재구성 금지.
    // 서버는 drift를 소스별 items 항목에 싣는다(다중 소스 대비) — 감지된 첫 소스를 쓴다.
    const taxonomyDrift =
      dashboardTaxonomy?.items?.map((item) => item.drift).find((drift) => Boolean(drift)) ?? null;
    const driftNewFolderCount = taxonomyDrift?.new_folders?.length ?? 0;
    const driftVanishedFolderCount = taxonomyDrift?.vanished_folders?.length ?? 0;
    const driftDetected = driftNewFolderCount > 0 || driftVanishedFolderCount > 0;
    const driftBadgeLabel =
      driftNewFolderCount > 0
        ? `분류체계 재정비 제안 — 새 업무 폴더 ${driftNewFolderCount}개`
        : `분류체계 재정비 제안 — 사라진 업무 폴더 ${driftVanishedFolderCount}개`;
    // P3 §4.4: 위키 구성 카드의 "분류 대기 N건 · 무태그 M건" — 무태그는 verify 결과(V 표 untagged)에서.
    const taxonomyQueueTotal = (dashboardTaxonomyQuality?.items ?? []).reduce(
      (sum, item) => sum + (item.queue_count ?? 0),
      0,
    );
    const untaggedCheck = knowledgeVerifyLatest?.checks.find((check) => check.code === "untagged") ?? null;
    // P3 §5.4: 요약 대기 N건 — 서버가 pending_count 필드를 내려줄 때만 표시한다.
    const enrichPendingCount =
      typeof knowledgeBackendStatus?.llm_enrichment?.pending_count === "number"
        ? knowledgeBackendStatus.llm_enrichment.pending_count
        : null;
    // Wave D F-11: 커버리지 "요약 보유 n/전체" — 두 필드가 모두 있을 때만 표시(구버전 호환).
    const enrichEnrichedCount =
      typeof knowledgeBackendStatus?.llm_enrichment?.enriched_count === "number"
        ? knowledgeBackendStatus.llm_enrichment.enriched_count
        : null;
    const enrichTotalCount =
      typeof knowledgeBackendStatus?.llm_enrichment?.total_count === "number"
        ? knowledgeBackendStatus.llm_enrichment.total_count
        : null;
    // 어휘집 §6 확장: "주제 후보 검토 n건" 배지 — 사람 검토(review) 추천분 기준.
    // merge/reject 추천분은 일괄 적용 대상이라 세지 않는다. 구버전 서버(review 필드 없음)는
    // 전체 pending으로 폴백하고, 필드가 둘 다 없으면 배지를 숨긴다.
    const vocabCandidatesReview =
      typeof knowledgeBackendStatus?.llm_enrichment?.vocab_candidates_review === "number"
        ? knowledgeBackendStatus.llm_enrichment.vocab_candidates_review
        : typeof knowledgeBackendStatus?.llm_enrichment?.vocab_candidates_pending === "number"
          ? knowledgeBackendStatus.llm_enrichment.vocab_candidates_pending
          : null;
    // P3 §6: 정합성 카드 — 마지막 검증 시점과 확인 필요 건수.
    const verifyAttentionCount = knowledgeVerifyLatest ? verifyAttentionTotal(knowledgeVerifyLatest) : 0;
    const verifyHealedCount = knowledgeVerifyLatest ? verifyHealedTotal(knowledgeVerifyLatest) : 0;
    const verifyRanAgoLabel = knowledgeVerifyLatest ? verifyDaysAgoLabel(knowledgeVerifyLatest.ran_at) : null;
    // 확인 필요·자동 수리가 있었던 검사만 결과 카드 목록에 노출한다(0건 검사는 요약 한 줄로 갈음).
    const verifyIssueChecks = knowledgeVerifyLatest
      ? knowledgeVerifyLatest.checks.filter((check) => check.count > 0 || check.healed > 0)
      : [];
    const verifyActionDisabled =
      submitting || knowledgeVerifyStarting || Boolean(pendingVerifyJobId) || lockedKnowledgeIngestion;
    const verifyDisabledReason = lockedKnowledgeIngestion
      ? knowledgeIngestionLockMessage
      : pendingVerifyJobId
        ? "무결성 점검이 이미 진행 중입니다."
        : knowledgeVerifyStarting
          ? "무결성 점검을 시작하는 중입니다."
          : null;

    return (
      <>
        <div className="knowledge-workspace-tabs" role="tablist" aria-label="지식폴더 작업 화면">
          {KNOWLEDGE_SCREEN_TABS.map((panel) => (
            <button
              key={panel.key}
              type="button"
              role="tab"
              aria-label={panel.label}
              aria-selected={activePanel === panel.key}
              className={`knowledge-workspace-tab ${activePanel === panel.key ? "is-active" : ""}`}
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

        {activePanel === "dashboard" ? (
          <SectionCard eyebrow="설정 상태" title="지식폴더 대시보드" testId="knowledge-dashboard">
            <div className="helper-copy">
              <p>유형별 설정 상태를 한눈에 확인합니다. 변경이 필요하면 각 카드의 [설정으로]를 눌러 설정 탭에서 진행하세요.</p>
            </div>
            <div className="knowledge-status-grid">
              {/* ① 지식폴더 지정 상태 */}
              <div
                className={`knowledge-status-card ${snapshot.knowledgeSources.length === 0 ? "is-warning" : ""}`}
                data-testid="knowledge-status-sources"
              >
                <span className="eyebrow">지식폴더</span>
                <strong>{snapshot.knowledgeSources.length > 0 ? `등록 ${snapshot.knowledgeSources.length}개` : "미등록"}</strong>
                <p>
                  {primaryKnowledgeSource
                    ? `${primaryKnowledgeSource.label} · 최근 스캔 ${
                        primaryKnowledgeSource.last_scanned_at
                          ? formatDateTime(primaryKnowledgeSource.last_scanned_at)
                          : "없음"
                      }`
                    : "지식폴더를 지정하면 문서 수집을 시작할 수 있습니다."}
                </p>
                <div className="knowledge-status-card__actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => goToSettingsGroup(KNOWLEDGE_SETTINGS_ANCHORS.sources)}
                    title="설정 탭의 지식폴더 지정 그룹으로 이동합니다."
                  >
                    설정으로
                  </button>
                </div>
              </div>
              {/* ② 위키 구성(분류체계) 상태 */}
              <div
                className={`knowledge-status-card ${dashboardTaxonomyLoaded && !taxonomyConfigured ? "is-warning" : ""}`}
                data-testid="knowledge-status-taxonomy"
              >
                <span className="eyebrow">위키 구성</span>
                <strong>{!dashboardTaxonomyLoaded ? "확인 중" : taxonomyConfigured ? "구성됨" : "미구성"}</strong>
                <p>
                  {taxonomyConfigured
                    ? `업무 ${taxonomyWorkAreaCount}개 기준(SCHEMA.md)으로 문서를 정리합니다.${
                        taxonomyConfirmedAt ? ` 확정 ${formatDateTime(taxonomyConfirmedAt)}` : ""
                      }`
                    : "분류체계 마법사로 업무 단위 위키 구성 기준을 만들 수 있습니다."}
                </p>
                {taxonomyConfigured ? (
                  <>
                    <p data-testid="knowledge-status-taxonomy-queue">
                      분류 대기 {taxonomyQueueTotal}건
                      {untaggedCheck ? ` · 무태그 ${untaggedCheck.count}건` : ""}{" "}
                      {/* hub-assignment (b): 설정 탭의 분류 대기 큐로 바로가기 */}
                      <button
                        type="button"
                        className="knowledge-query-history__chip"
                        onClick={() => goToSettingsGroup(KNOWLEDGE_SETTINGS_ANCHORS.taxonomy)}
                        title="설정 탭의 분류 대기 큐로 바로 이동합니다."
                      >
                        큐 열기
                      </button>
                    </p>
                    {/* hub-assignment: 참고서고 문서의 빈 confidence는 결함이 아니라 설계 — 오해 방지 안내 */}
                    <p className="subtle-text" data-testid="knowledge-status-taxonomy-refshelf-note">
                      참고서고(■참고■) 문서는 설계상 태깅 제외되어 집계에 포함되지 않습니다.
                    </p>
                    {zeroDocWorkAreaCount > 0 ? (
                      <p className="subtle-text" data-testid="knowledge-status-taxonomy-zerodoc-hint">
                        문서 0건 업무 {zeroDocWorkAreaCount}개 — 마법사에서 정리를 권장합니다.
                      </p>
                    ) : null}
                  </>
                ) : null}
                {driftDetected ? (
                  <button
                    type="button"
                    className="pill pill--warning knowledge-drift-badge"
                    data-testid="knowledge-drift-badge"
                    onClick={openTaxonomyWizardFromDrift}
                    disabled={!primaryKnowledgeSource}
                    title="폴더 구조 변화를 반영하도록 분류체계 마법사를 다시 엽니다. 확정 전까지는 기존 체계가 그대로 유지됩니다."
                  >
                    {driftBadgeLabel}
                  </button>
                ) : null}
                <div className="knowledge-status-card__actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => goToSettingsGroup(KNOWLEDGE_SETTINGS_ANCHORS.taxonomy)}
                    title="설정 탭의 위키 구성 설정 그룹으로 이동합니다."
                  >
                    설정으로
                  </button>
                </div>
              </div>
              {/* ③ 색인(검색 엔진·파서·최근 작업) 상태 */}
              <div
                className={`knowledge-status-card ${
                  searchEngineStatus.tone === "warning" || kordocAvailable === false ? "is-warning" : ""
                }`}
                data-testid="knowledge-status-indexing"
              >
                <span className="eyebrow">색인</span>
                <strong>{searchEngineStatus.label}</strong>
                {searchEngineStatus.detail ? <p>{searchEngineStatus.detail}</p> : null}
                <p>
                  한국어 문서 파서 {kordocAvailable === null ? "확인 중" : kordocAvailable ? "사용 가능" : "사용 불가"} ·{" "}
                  {parserDetail}
                </p>
                <p data-testid="knowledge-status-indexing-latest">
                  {latestIngestionJob
                    ? `최근 색인 ${ingestionJobStatusLabel(latestIngestionJob)} · ${ingestionProgressPercent(latestIngestionJob)}% · ${formatDateTime(latestIngestionJob.created_at)}`
                    : "아직 색인 작업이 없습니다."}
                </p>
                <p data-testid="knowledge-status-indexing-diff">
                  마지막 동기화{" "}
                  {latestCompletedIngestionJob?.completed_at
                    ? formatDateTime(latestCompletedIngestionJob.completed_at)
                    : "없음"}{" "}
                  · 미반영 변경{" "}
                  {latestKnowledgeDiff
                    ? latestKnowledgeDiffChanged === 0
                      ? "없음 — 색인이 최신입니다"
                      : `${latestKnowledgeDiffChanged}건 (${diffSummaryLine(latestKnowledgeDiff.result)})`
                    : "미확인 — 설정 탭의 [변경 확인]으로 조회할 수 있습니다"}
                  {latestKnowledgeDiff ? ` · 확인 ${formatDateTime(latestKnowledgeDiff.checkedAt)}` : ""}
                </p>
                <div className="knowledge-status-card__actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => goToSettingsGroup(KNOWLEDGE_SETTINGS_ANCHORS.indexing)}
                    title="설정 탭의 색인 설정·실행 그룹으로 이동합니다."
                  >
                    설정으로
                  </button>
                </div>
              </div>
              {/* ④ LLM 요약 보강 상태 */}
              <div
                className={`knowledge-status-card ${llmEnrichmentConfigured === false ? "is-warning" : ""}`}
                data-testid="knowledge-status-enrich"
              >
                <span className="eyebrow">LLM 요약 보강</span>
                <strong>
                  {llmEnrichmentConfigured === null ? "확인 중" : llmEnrichmentConfigured ? "설정됨" : "미설정"}
                </strong>
                <p>
                  {llmEnrichmentConfigured
                    ? "문서 카드 요약을 LLM으로 보강할 수 있습니다. 실행은 설정 탭에서 시작합니다."
                    : "환경설정에서 LLM 연결을 구성하면 사용할 수 있습니다."}
                </p>
                {enrichEnrichedCount !== null && enrichTotalCount !== null ? (
                  <p data-testid="knowledge-status-enrich-coverage">
                    요약 보유 {enrichEnrichedCount}건 / 전체 {enrichTotalCount}건
                  </p>
                ) : null}
                {enrichPendingCount !== null ? (
                  <p data-testid="knowledge-status-enrich-pending">요약 대기 {enrichPendingCount}건</p>
                ) : null}
                {vocabCandidatesReview !== null && vocabCandidatesReview > 0 ? (
                  <p data-testid="knowledge-status-vocab-pending">
                    <span className="pill pill--warning">주제 후보 검토 {vocabCandidatesReview}건</span>
                  </p>
                ) : null}
                <div className="knowledge-status-card__actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => goToSettingsGroup(KNOWLEDGE_SETTINGS_ANCHORS.enrich)}
                    title="설정 탭의 LLM 요약 보강 항목으로 이동합니다."
                  >
                    설정으로
                  </button>
                </div>
                {llmEnrichmentConfigured === false ? (
                  <LlmSetupNotice
                    message="LLM 요약 보강을 사용하려면 환경설정에서 모델 연결을 먼저 완료해 주세요."
                    onOpenSettings={() => setActiveMenu("settings")}
                  />
                ) : null}
              </div>
              {/* ⑤ 정합성(무결성 점검) 상태 — P3 §6 */}
              <div
                className={`knowledge-status-card ${verifyAttentionCount > 0 ? "is-warning" : ""}`}
                data-testid="knowledge-status-verify"
              >
                <span className="eyebrow">정합성</span>
                <strong>
                  {knowledgeVerifyLatest
                    ? verifyAttentionCount > 0
                      ? `확인 필요 ${verifyAttentionCount}건`
                      : "이상 없음"
                    : "검증 이력 없음"}
                </strong>
                <p data-testid="knowledge-status-verify-summary">
                  {knowledgeVerifyLatest
                    ? `마지막 검증 ${verifyRanAgoLabel ?? formatDateTime(knowledgeVerifyLatest.ran_at)} — ${
                        verifyAttentionCount > 0 ? `확인 필요 ${verifyAttentionCount}건` : "이상 없음"
                      }${verifyHealedCount > 0 ? ` (자동 수리 ${verifyHealedCount}건)` : ""}`
                    : "무결성 점검으로 색인·지식카드·검색 인덱스의 정합성을 확인할 수 있습니다."}
                </p>
                <div className="knowledge-status-card__actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => goToSettingsGroup(KNOWLEDGE_SETTINGS_ANCHORS.verify)}
                    title="설정 탭의 무결성 점검 그룹으로 이동합니다."
                  >
                    무결성 점검
                  </button>
                </div>
              </div>
            </div>
            <div className="knowledge-overview-stats" data-testid="knowledge-wiki-counts">
              {(wikiCounts?.work_areas ?? 0) > 0 ? (
                <span className="pill">업무 {wikiCounts?.work_areas}</span>
              ) : null}
              <span className="pill">문서 {wikiCounts?.docs ?? snapshot.knowledgeDocuments.length}</span>
              <span className="pill">주제 {wikiCounts?.topics ?? 0}</span>
              <span className="pill">업무 기록 {wikiCounts?.works ?? 0}</span>
              <span className="pill pill--soft">등록 폴더 {snapshot.knowledgeSources.length}</span>
              <span className="pill pill--soft">본문 추출 {indexedFileCount}</span>
            </div>
          </SectionCard>
        ) : null}

        {activePanel === "indexing" && knowledgeExtractionView ? (
          <SectionCard
            eyebrow="색인 결과"
            title="색인 완료 문서"
            actions={
              <button type="button" className="button-secondary" onClick={() => setKnowledgeExtractionView(false)}>
                색인이력으로 돌아가기
              </button>
            }
          >
            {snapshot.knowledgeDocuments.length === 0 ? (
              <EmptyState
                title="아직 색인된 문서 카드가 없습니다."
                body="지식 소스를 스캔한 뒤 색인을 실행하면 파서, 품질, 섹션/표 상태가 여기에 표시됩니다."
              />
            ) : (
              <div className="item-list">
                {snapshot.knowledgeDocuments.slice(0, 25).map((document) => (
                  <article key={document.id} className="list-card">
                    <div className="list-card__main list-card__main--static">
                      <div>
                        <h3>{displayTitleForFile(document.title, document.file_path)}</h3>
                        <p>{relativePath(document.file_path)}</p>
                      </div>
                      <span className={document.partial ? "pill pill--warning" : "pill"}>
                        {document.partial ? "부분 추출" : "전체 추출"}
                      </span>
                    </div>
                    <div className="document-preview__meta">
                      <span>파서 {document.parser_name}</span>
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
                  <span>
                    {displayTitleForFile(
                      knowledgeDocumentStructure.document.title,
                      knowledgeDocumentStructure.document.file_path,
                    )}
                  </span>
                  <span className="subtle-text">{relativePath(knowledgeDocumentStructure.document.file_path)}</span>
                  <span
                    className={
                      knowledgeDocumentStructure.document.partial ? "pill pill--warning" : "pill pill--soft"
                    }
                  >
                    {knowledgeDocumentStructure.document.partial ? "부분 추출" : "전체 추출"}
                  </span>
                  {knowledgeDocumentStructure.document.parser_name ? (
                    <span>파서 {knowledgeDocumentStructure.document.parser_name}</span>
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
                            <p>{section.level}단계 제목</p>
                          </div>
                          <span className="pill">{section.order_index + 1}</span>
                        </div>
                        {section.text ? (
                          <ParsedExcerpt text={section.text} />
                        ) : (
                          <p className="subtle-text">섹션 본문 미리보기 없음</p>
                        )}
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
                            <span className="pill">표</span>
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

        {activePanel === "indexing" && !knowledgeExtractionView ? (
          <>
            {/* 설정 탭 상단: 대시보드 복귀 */}
            <div className="inline-actions knowledge-settings-return">
              <button
                type="button"
                className="button-secondary"
                onClick={() => setKnowledgePanel("dashboard")}
                title="설정을 마치고 대시보드로 돌아갑니다."
              >
                ← 대시보드로
              </button>
            </div>

            {lockedKnowledgeIngestion ? (
              <div className="hint-box hint-box--warning">{knowledgeIngestionLockMessage}</div>
            ) : null}

            {/* 설정 ① 지식폴더 지정 — 폴더 등록/변경/스캔 */}
            <div id={KNOWLEDGE_SETTINGS_ANCHORS.sources} className="knowledge-settings-group">
            <SectionCard eyebrow="설정 ①" title="지식폴더 지정">
              <div className="helper-copy">
                <p>지식폴더로 쓸 업무 폴더를 등록하고, 스캔으로 파일 목록과 본문 원본을 갱신합니다.</p>
              </div>
              <details className="knowledge-detail-section">
                <summary>지식 소스 등록 설정</summary>
                <div className="helper-copy">
                  <p>특정 폴더를 지정하면 하위 문서의 본문과 메타데이터를 스캔해 개인 지식위키 DB로 만듭니다.</p>
                  <p>Markdown/TXT/CSV/JSON은 본문을 저장하고, DOCX/XLSX/PPTX/PDF 계열은 가능한 범위에서 본문 추출을 시도합니다.</p>
                  <p>폴더 등록 후 실제 스캔, 색인, 재색인은 아래 등록 폴더 카드에서 실행합니다.</p>
                </div>
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
                      title={lockedKnowledgeIngestion ? knowledgeIngestionLockMessage : "지식폴더로 쓸 폴더를 선택합니다."}
                    >
                      폴더 선택
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || lockedKnowledgeIngestion}
                      title={lockedKnowledgeIngestion ? knowledgeIngestionLockMessage : undefined}
                    >
                      지식 소스 등록
                    </button>
                  </div>
                </form>
              </details>

              <div className="knowledge-indexing-controls">
                <div className="document-preview__meta">
                  <span className="pill">등록 폴더</span>
                  <span className="subtle-text">폴더 스캔은 여기에서, 색인 실행은 아래 색인 설정·실행 그룹에서 진행합니다.</span>
                </div>
                {snapshot.knowledgeSources.length === 0 ? (
                  <EmptyState
                    title="등록된 지식 소스가 없습니다."
                    body="위 지식 소스 등록 설정에서 업무 폴더를 먼저 등록해 주세요."
                  />
                ) : (
                  <div className="item-list item-list--compact">
                    {snapshot.knowledgeSources.map((source) => {
                      const fileCount = snapshot.knowledgeSourceFiles.filter(
                        (file) => file.source_id === source.id && file.status !== "deleted",
                      ).length;
                      const sourceActionDisabled = submitting || source.status === "missing" || lockedKnowledgeIngestion;
                      const sourceDisabledReason =
                        source.status === "missing"
                          ? "폴더를 찾을 수 없어 실행할 수 없습니다."
                          : lockedKnowledgeIngestion
                            ? knowledgeIngestionLockMessage
                            : null;
                      // P0 후속: 최근 스캔에서 보류(잠금·쓰기 중)된 파일 수 — 0이면 숨긴다.
                      const scanUnstableCount = knowledgeScanSummaryBySource[source.id]?.unstable_count ?? 0;
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
                          {scanUnstableCount > 0 ? (
                            <div className="document-preview__meta">
                              <span className="pill pill--warning" data-testid="knowledge-scan-unstable">
                                보류 {scanUnstableCount}건 — 다음 스캔에서 처리
                              </span>
                            </div>
                          ) : null}
                          <div className="inline-actions">
                            <button
                              type="button"
                              className="button-with-icon"
                              onClick={() => void runKnowledgeSourceScan(source)}
                              disabled={sourceActionDisabled}
                              title={sourceDisabledReason ?? "폴더의 파일 목록과 본문 원본을 갱신합니다."}
                            >
                              <AssetIcon src="/icons/action/play-inverse.svg" />
                              스캔 시작
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </SectionCard>
            </div>

            {/* 설정 ② 위키 구성 설정 — 분류체계 마법사 + SCHEMA.md + 분류 대기 큐 (T-01) */}
            <div id={KNOWLEDGE_SETTINGS_ANCHORS.taxonomy} className="knowledge-settings-group">
            <SectionCard eyebrow="설정 ②" title="위키 구성 설정" testId="knowledge-taxonomy-entry">
              <div className="helper-copy">
                <p>
                  4문항 인터뷰와 폴더 구조 분석으로 업무 분류체계를 만들고, 확정하면 문서가 업무 단위 허브로 자동
                  정리됩니다. 확정 기준은 SCHEMA.md에 기록됩니다.
                </p>
              </div>
              <div className="inline-actions">
                <button
                  type="button"
                  onClick={() => setTaxonomyWizardOpen(true)}
                  disabled={!primaryKnowledgeSource}
                  title={
                    primaryKnowledgeSource
                      ? "분류체계 설정 마법사를 엽니다."
                      : "지식폴더를 먼저 등록하면 분류체계를 설정할 수 있습니다."
                  }
                >
                  분류체계 설정
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void openSchemaDocument()}
                  title="확정된 분류 기준 문서(SCHEMA.md)를 위키 뷰어로 엽니다."
                >
                  분류 기준 보기
                </button>
              </div>
              {driftDetected ? (
                <div className="document-preview__meta">
                  <button
                    type="button"
                    className="pill pill--warning knowledge-drift-badge"
                    data-testid="knowledge-drift-badge-settings"
                    onClick={() => setTaxonomyWizardOpen(true)}
                    disabled={!primaryKnowledgeSource}
                    title="폴더 구조 변화를 반영하도록 분류체계 마법사를 다시 엽니다. 확정 전까지는 기존 체계가 그대로 유지됩니다."
                  >
                    {driftBadgeLabel}
                  </button>
                </div>
              ) : null}
              {/* 어휘집 규격 §5: 기관 어휘집 팩 — 현재 적용 팩 정보 / 임포트 / 제거 */}
              <VocabPackBlock
                variant="full"
                pushToast={pushToast}
                refreshKey={vocabRefreshKey}
                onChanged={() => setVocabRefreshKey((value) => value + 1)}
              />
            </SectionCard>
            <TaxonomyQueueSection
              refreshKey={taxonomyRefreshKey}
              pushToast={pushToast}
              sources={snapshot.knowledgeSources}
            />
            {/* 어휘집 규격 §6: 주제 어휘 후보 — pending 후보 승인/병합/거절 */}
            <VocabCandidateSection refreshKey={vocabRefreshKey} pushToast={pushToast} />
            </div>

            {/* 설정 ③ 색인 설정·실행 — 색인 시작/강제 재색인/LLM 요약 보강/진행 상태/색인 상세 로그 */}
            <div id={KNOWLEDGE_SETTINGS_ANCHORS.indexing} className="knowledge-settings-group">
            <SectionCard eyebrow="설정 ③" title="색인 설정·실행">
              <div className="helper-copy">
                <p>색인은 스캔된 문서를 검색용 인덱스와 위키 문서 카드로 만듭니다. 강제 재색인은 전체 문서를 처음부터 다시 처리합니다.</p>
              </div>
              {snapshot.knowledgeSources.length === 0 ? (
                <EmptyState
                  title="색인할 지식폴더가 없습니다."
                  body="위 지식폴더 지정에서 폴더를 등록하고 스캔한 뒤 색인을 실행하세요."
                />
              ) : (
                <div className="item-list item-list--compact">
                  {snapshot.knowledgeSources.map((source) => {
                    const sourceActionDisabled = submitting || source.status === "missing" || lockedKnowledgeIngestion;
                    const sourceDisabledReason =
                      source.status === "missing"
                        ? "폴더를 찾을 수 없어 실행할 수 없습니다."
                        : lockedKnowledgeIngestion
                          ? knowledgeIngestionLockMessage
                          : null;
                    const diffChecking = knowledgeDiffCheckingSourceId === source.id;
                    const diffEntry = knowledgeDiffBySource[source.id] ?? null;
                    const diffResult = diffEntry?.result ?? null;
                    const diffChanged = diffResult ? diffChangedTotal(diffResult) : 0;
                    return (
                      <article key={source.id} className="list-card list-card--compact">
                        <div className="list-card__main list-card__main--static">
                          <div>
                            <h3>{source.label}</h3>
                            <p>{relativePath(source.root_path)}</p>
                          </div>
                          <span className="pill">{describeKnowledgeSourceStatus(source.status)}</span>
                        </div>
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="button-secondary button-with-icon"
                            onClick={() => void runKnowledgeSourceDiff(source)}
                            disabled={sourceActionDisabled || diffChecking}
                            title={
                              sourceDisabledReason ??
                              (diffChecking
                                ? "변경 사항을 확인하는 중입니다."
                                : "색인 실행 없이 마지막 스캔 이후 변경 견적을 먼저 확인합니다.")
                            }
                          >
                            <AssetIcon src="/icons/action/search.svg" />
                            변경 확인
                          </button>
                          <button
                            type="button"
                            className="button-with-icon"
                            onClick={() => void runKnowledgeSourceIngestion(source)}
                            disabled={sourceActionDisabled}
                            title={sourceDisabledReason ?? "변경된 문서를 색인해 검색과 위키에 반영합니다."}
                          >
                            <AssetIcon src="/icons/action/play-inverse.svg" />
                            색인 시작
                          </button>
                          <button
                            type="button"
                            className="button-secondary button-with-icon"
                            onClick={() => void runKnowledgeSourceReindex(source)}
                            disabled={sourceActionDisabled}
                            title={sourceDisabledReason ?? "전체 문서를 처음부터 다시 색인합니다."}
                          >
                            <AssetIcon src="/icons/action/rebuild.svg" />
                            강제 재색인
                          </button>
                        </div>
                        {diffChecking ? (
                          <p className="subtle-text" data-testid="knowledge-diff-checking">
                            마지막 스캔 이후 변경 사항을 확인하는 중…
                          </p>
                        ) : null}
                        {diffEntry && diffResult ? (
                          <div
                            className={`knowledge-diff-estimate ${
                              diffResult.exceeds_gate ? "knowledge-diff-estimate--gate" : ""
                            }`}
                            data-testid="knowledge-diff-estimate"
                          >
                            <div className="document-preview__meta">
                              <span className="pill">변경 견적</span>
                              <span className="subtle-text">확인 {formatDateTime(diffEntry.checkedAt)}</span>
                            </div>
                            {diffChanged === 0 ? (
                              <p className="subtle-text" data-testid="knowledge-diff-empty">
                                변경된 파일이 없습니다 — 색인이 최신입니다.
                                {diffResult.unstable > 0
                                  ? ` (보류 ${diffResult.unstable}건 — 다음 스캔에서 처리)`
                                  : ""}
                              </p>
                            ) : (
                              <>
                                <p className="knowledge-diff-estimate__summary">{diffSummaryLine(diffResult)}</p>
                                <p className="subtle-text">
                                  확인 필요 {diffResult.rehash_estimate.files}개 파일 ·{" "}
                                  {formatRehashMegabytes(diffResult.rehash_estimate.bytes)}
                                </p>
                                {diffResult.exceeds_gate ? (
                                  <>
                                    <div className="hint-box hint-box--warning" data-testid="knowledge-diff-gate">
                                      전체 파일의 상당수가 변경되어 확인에 수 분이 걸릴 수 있습니다.
                                    </div>
                                    <div className="inline-actions">
                                      <button
                                        type="button"
                                        className="button-secondary button-with-icon"
                                        onClick={() => void runKnowledgeSourceIngestion(source)}
                                        disabled={sourceActionDisabled}
                                        title={
                                          sourceDisabledReason ??
                                          "확인 시간이 걸리더라도 지금 증분 색인을 실행합니다."
                                        }
                                      >
                                        <AssetIcon src="/icons/action/play.svg" />
                                        그래도 실행
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <div className="inline-actions">
                                    <button
                                      type="button"
                                      className="button-with-icon"
                                      onClick={() => void runKnowledgeSourceIngestion(source)}
                                      disabled={sourceActionDisabled}
                                      title={
                                        sourceDisabledReason ??
                                        "확인된 변경분만 색인해 검색과 위키에 반영합니다."
                                      }
                                    >
                                      <AssetIcon src="/icons/action/play-inverse.svg" />
                                      증분 색인 실행
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}

              {/* LLM 요약 보강 — 색인 품질 보강 실행 */}
              <div id={KNOWLEDGE_SETTINGS_ANCHORS.enrich} className="knowledge-settings-subgroup">
                <div className="document-preview__meta">
                  <span className="pill">LLM 요약 보강</span>
                  <span className="subtle-text">
                    색인된 위키 문서 카드의 요약을 LLM으로 다시 작성해 검색과 근거 답변 품질을 높입니다.
                  </span>
                </div>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="button-with-icon"
                    onClick={() => void startKnowledgeEnrichJob()}
                    disabled={knowledgeEnrichStarting || llmEnrichmentConfigured === false}
                    title={enrichDisabledReason ?? "위키 문서 카드 요약을 LLM으로 보강하는 작업을 시작합니다."}
                  >
                    <AssetIcon src="/icons/action/sparkle-inverse.svg" />
                    LLM 요약 보강 시작
                  </button>
                </div>
                {llmEnrichmentConfigured === false ? (
                  <LlmSetupNotice
                    message="LLM 요약 보강을 사용하려면 환경설정에서 모델 연결을 먼저 완료해 주세요."
                    onOpenSettings={() => setActiveMenu("settings")}
                  />
                ) : null}
              </div>

              {/* 무결성 점검 — P3 §6: quick 기본, 심층(전량 재해시)은 접힘 보조 */}
              <div
                id={KNOWLEDGE_SETTINGS_ANCHORS.verify}
                className="knowledge-settings-subgroup"
                data-testid="knowledge-verify-group"
              >
                <div className="document-preview__meta">
                  <span className="pill">무결성 점검</span>
                  <span className="subtle-text">
                    색인·지식카드·검색 인덱스의 불일치를 검사합니다. 안전한 항목(카드 재생성, 고아 파일
                    정리)은 자동 수리하고, 파싱 비용이 드는 항목은 보고 후 안내를 따릅니다.
                  </span>
                </div>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="button-with-icon"
                    onClick={() => void startKnowledgeVerifyJob(false)}
                    disabled={verifyActionDisabled}
                    title={
                      verifyDisabledReason ??
                      "파일을 다시 읽지 않는 빠른 점검을 실행합니다. 진행은 작업 패널에서 확인합니다."
                    }
                  >
                    <AssetIcon src="/icons/action/play-inverse.svg" />
                    무결성 점검
                  </button>
                </div>
                <details className="knowledge-detail-section">
                  <summary>심층 점검 — 전체 파일 재확인</summary>
                  <p className="subtle-text">
                    모든 파일 내용을 다시 읽어(전량 재해시) 크기·수정일이 보존된 조용한 변경까지 찾아냅니다.
                    파일이 많으면 수 분이 걸릴 수 있습니다.
                  </p>
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void startKnowledgeVerifyJob(true)}
                      disabled={verifyActionDisabled}
                      title={verifyDisabledReason ?? "전체 파일을 다시 읽는 심층 점검을 실행합니다."}
                    >
                      심층 — 전체 파일 재확인
                    </button>
                  </div>
                </details>
                {pendingVerifyJobId ? (
                  <p className="subtle-text" data-testid="knowledge-verify-running">
                    무결성 점검이 진행 중입니다 — 진행률은 작업 패널에서 확인하세요.
                  </p>
                ) : null}
                {knowledgeVerifyLatest ? (
                  <div className="document-preview" data-testid="knowledge-verify-result">
                    <div className="document-preview__meta">
                      <span className="pill">최근 점검 결과</span>
                      <span>{knowledgeVerifyLatest.mode === "deep" ? "심층 점검" : "빠른 점검"}</span>
                      <span className="subtle-text">실행 {formatDateTime(knowledgeVerifyLatest.ran_at)}</span>
                      {verifyAttentionCount > 0 ? (
                        <span className="pill pill--warning">확인 필요 {verifyAttentionCount}건</span>
                      ) : (
                        <span className="pill pill--soft">이상 없음</span>
                      )}
                      {verifyHealedCount > 0 ? (
                        <span className="pill pill--soft">자동 수리 {verifyHealedCount}건</span>
                      ) : null}
                      {(knowledgeVerifyLatest.disk_reclaimed_bytes ?? 0) > 0 ? (
                        <span className="subtle-text">
                          회수 공간 {formatRehashMegabytes(knowledgeVerifyLatest.disk_reclaimed_bytes ?? 0)}
                        </span>
                      ) : null}
                    </div>
                    {verifyIssueChecks.length === 0 ? (
                      <p className="subtle-text">모든 검사 항목이 정상입니다.</p>
                    ) : (
                      <div className="item-list item-list--compact">
                        {verifyIssueChecks.map((check) => {
                          const remaining = verifyCheckRemaining(check);
                          return (
                            <article
                              key={check.code}
                              className="list-card list-card--compact"
                              data-testid="knowledge-verify-check"
                            >
                              <div className="list-card__main list-card__main--static">
                                <div>
                                  <h3>{check.label_ko}</h3>
                                  {remaining > 0 && check.action_hint ? <p>{check.action_hint}</p> : null}
                                </div>
                                <span className={remaining > 0 ? "pill pill--warning" : "pill pill--soft"}>
                                  {remaining > 0
                                    ? `확인 필요 ${remaining}건`
                                    : `자동 수리 ${check.healed}건`}
                                </span>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              {/* 진행 상태 — 진행률, 소요시간, 색인 상세 로그 */}
              <div className="knowledge-settings-subgroup">
                <div className="document-preview__meta">
                  <span className="pill">진행 상태</span>
                  <span className="subtle-text">색인 작업 진행률과 색인 상세 로그를 확인합니다.</span>
                </div>
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
                  title="아직 색인 작업이 없습니다."
                  body="지식 소스를 등록하고 색인을 실행하면 진행률, 소요시간, 실패 로그가 이 화면에 표시됩니다."
                />
              ) : (
                <div className="item-list">
                  {snapshot.knowledgeIngestionJobs.slice(0, 10).map((job) => {
                    const progress = ingestionProgressPercent(job);
                    const activeStageIndex = ingestionStageIndex(job);
                    const errors = splitIngestionErrors(job.error_message);
                    const jobSource = snapshot.knowledgeSources.find((source) => source.id === job.source_id) ?? null;
                    const retryDisabledReason = !jobSource
                      ? "원본 지식폴더를 찾을 수 없어 다시 색인할 수 없습니다."
                      : lockedKnowledgeIngestion
                        ? knowledgeIngestionLockMessage
                        : null;
                    return (
                      <article
                        key={job.id}
                        className={`list-card knowledge-ingestion-card ${job.status === "running" ? "is-running" : ""}`}
                      >
                        <div className="list-card__main list-card__main--static">
                          <div>
                            <h3>{shortDisplayId(job.id, "색인 작업")}</h3>
                            <p>{ingestionStageLabel(job)}</p>
                          </div>
                          <span className="pill">{ingestionJobStatusLabel(job)}</span>
                        </div>
                        <div
                          className="knowledge-ingestion-stage-rail"
                          data-testid="knowledge-ingestion-stage-rail"
                          aria-label={`${job.id} 색인 단계`}
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
                          {(job.unstable_count ?? 0) > 0 ? (
                            <span className="pill pill--warning" data-testid="knowledge-job-unstable">
                              보류 {job.unstable_count}건 — 다음 스캔에서 처리
                            </span>
                          ) : null}
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
                            <span className="pill">색인 상세 로그</span>
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
                              {expandedIngestionLogJobId === job.id ? "색인 상세 로그 닫기" : "색인 상세 로그 열기"}
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
                        {job.status === "failed" ? (
                          <div className="inline-actions">
                            <button
                              type="button"
                              className="button-with-icon"
                              disabled={submitting || Boolean(retryDisabledReason)}
                              title={retryDisabledReason ?? "실패한 폴더를 처음부터 다시 색인합니다."}
                              onClick={() => {
                                if (jobSource) {
                                  void runKnowledgeSourceReindex(jobSource);
                                }
                              }}
                            >
                              <AssetIcon src="/icons/action/rebuild-inverse.svg" />
                              다시 색인
                            </button>
                          </div>
                        ) : null}
                        {job.status === "queued" || job.status === "partial" ? (
                          <div className="inline-actions">
                            <button
                              type="button"
                              disabled={submitting || runningKnowledgeIngestion}
                              onClick={() => void runQueuedKnowledgeIngestionJob(job)}
                            >
                              색인 실행
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
            </div>

            {taxonomyWizardOpen && primaryKnowledgeSource ? (
              <TaxonomyWizard
                source={primaryKnowledgeSource}
                onClose={() => setTaxonomyWizardOpen(false)}
                pushToast={pushToast}
                onApplied={handleTaxonomyApplied}
                onOpenSchema={() => void openSchemaDocument()}
                runSourceScan={runKnowledgeSourceScan}
                onVocabChanged={() => setVocabRefreshKey((value) => value + 1)}
                indexedDocumentCount={
                  snapshot.knowledgeDocuments.filter(
                    (document) => document.source_id === primaryKnowledgeSource.id,
                  ).length
                }
              />
            ) : null}

            {/* 사용자 피드백(2026-07): 설정 ④ "진단·상세 데이터" 그룹 제거.
                - 색인 처리 흐름 안내 → 색인 작업 카드의 단계 레일(스캔·추출·색인·위키)과 중복.
                - 등록된 문서 메타데이터 → [색인완료 파일 N개] 상세 화면과 중복(원문 발췌 날것 노출 문제도 함께 제거).
                - 업무대화 반영 기록 → 반영 결과는 위키 탭 "업무 기록", 반영 이력은 실행기록의
                  "개인화 요약 생성/반영" 이벤트에서 이미 확인 가능하므로 중복 삭제. */}
          </>
        ) : null}

        {activePanel === "wiki" ? (
          <SectionCard eyebrow="지식위키" title="지식 검색과 위키" testId="knowledge-wiki">
            {/* 검색·위키 통합: 상단 검색 바 — 실행하면 우측 뷰어가 검색 결과로 전환된다. */}
            <div className="knowledge-wiki-search" data-testid="knowledge-wiki-search">
              <div
                className="seg-control knowledge-search-method"
                role="group"
                aria-label="검색 방법 선택"
                data-testid="knowledge-search-method"
              >
                <button
                  type="button"
                  className={`seg-control__option ${knowledgeSearchMode === "keyword" ? "is-active" : ""}`}
                  aria-pressed={knowledgeSearchMode === "keyword"}
                  onClick={() => setKnowledgeSearchMode("keyword")}
                >
                  키워드 검색
                </button>
                <button
                  type="button"
                  className={`seg-control__option ${knowledgeSearchMode === "ask" ? "is-active" : ""}`}
                  aria-pressed={knowledgeSearchMode === "ask"}
                  onClick={() => setKnowledgeSearchMode("ask")}
                >
                  근거 답변
                </button>
              </div>
              <form
                className="knowledge-search-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitKnowledgeQuery();
                }}
              >
                <label>
                  지식 검색
                  <input
                    value={knowledgeQuery}
                    onChange={(event) => setKnowledgeQuery(event.target.value)}
                    placeholder="예: 예산"
                  />
                </label>
                <div className="inline-actions">
                  <button
                    type="submit"
                    className="button-with-icon"
                    disabled={knowledgeInspectorLoading || !knowledgeQuery.trim()}
                    title={
                      knowledgeInspectorLoading
                        ? "이전 질의를 처리하는 중입니다."
                        : !knowledgeQuery.trim()
                          ? "검색어를 먼저 입력해 주세요."
                          : knowledgeSearchMode === "keyword"
                            ? "선택한 방법으로 키워드 검색을 실행합니다."
                            : "선택한 방법으로 근거 답변을 생성합니다."
                    }
                  >
                    <AssetIcon
                      src={
                        knowledgeSearchMode === "keyword"
                          ? "/icons/action/search-inverse.svg"
                          : "/icons/action/sparkle-inverse.svg"
                      }
                    />
                    {knowledgeSearchMode === "keyword" ? "키워드 검색 실행" : "근거 답변 생성"}
                  </button>
                  {knowledgeSearchResult?.mode && knowledgeSearchResult.mode !== "empty" ? (
                    <span className="pill pill--soft" data-testid="knowledge-search-mode">
                      {knowledgeSearchResult.mode === "fts5" ? "정확 일치(트라이그램)" : "부분 일치"}
                    </span>
                  ) : null}
                </div>
              </form>

              {knowledgeQueryHistory.length > 0 ? (
                <div className="knowledge-query-history" data-testid="knowledge-query-history">
                  <span className="knowledge-query-history__label">최근 질의</span>
                  {knowledgeQueryHistory.map((query) => (
                    <button
                      key={query}
                      type="button"
                      className="knowledge-query-history__chip"
                      title="이 질의를 다시 실행합니다."
                      onClick={() => rerunKnowledgeQueryFromHistory(query)}
                    >
                      {query}
                    </button>
                  ))}
                </div>
              ) : null}

            </div>

            <div className="wiki-browser" data-testid="knowledge-wiki-browser">
              <nav className="wiki-tree" aria-label="위키 목차">
                {hasWikiTree && knowledgeWikiTree ? (
                  <>
                    {/* T-01: 확정 분류체계 적용 후 생성되는 업무 허브 — 트리 최상단 */}
                    {wikiWorkAreas.length > 0 ? (
                      <details className="wiki-tree__group" open data-testid="wiki-tree-work-areas">
                        <summary>업무 ({wikiWorkAreas.length})</summary>
                        <ul className="wiki-tree__list">
                          {wikiWorkAreas.map((area) => (
                            <li key={area.slug}>
                              <button
                                type="button"
                                className="wiki-tree__item"
                                onClick={() => void openKnowledgeWikiTarget(area.path)}
                              >
                                <span>{area.title}</span>
                                <span className="wiki-tree__count">{area.doc_count}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    <details className="wiki-tree__group" open>
                      <summary>주제 ({knowledgeWikiTree.topics.length})</summary>
                      {knowledgeWikiTree.topics.length === 0 ? (
                        <p className="subtle-text">아직 정리된 주제가 없습니다.</p>
                      ) : (
                        <ul className="wiki-tree__list">
                          {knowledgeWikiTree.topics.map((topic) => (
                            <li key={topic.slug}>
                              <button
                                type="button"
                                className="wiki-tree__item"
                                onClick={() => void openKnowledgeWikiTarget(topic.path)}
                              >
                                <span>{topic.title}</span>
                                <span className="wiki-tree__count">{topic.doc_count}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                    <details className="wiki-tree__group" open>
                      <summary>업무 기록 ({knowledgeWikiTree.works.length})</summary>
                      {knowledgeWikiTree.works.length === 0 ? (
                        <p className="subtle-text">아직 반영된 업무 기록이 없습니다.</p>
                      ) : (
                        <ul className="wiki-tree__list">
                          {knowledgeWikiTree.works.map((work) => (
                            <li key={work.slug}>
                              <button
                                type="button"
                                className="wiki-tree__item"
                                onClick={() => void openKnowledgeWikiTarget(work.path)}
                              >
                                <span>{work.title}</span>
                                {work.updated_at ? (
                                  <span className="wiki-tree__meta">{formatDateTime(work.updated_at)}</span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                    <details className="wiki-tree__group" open>
                      <summary>폴더별 문서 ({wikiActiveDocCount})</summary>
                      {wikiSourcesWithActiveDocs.length === 0 ? (
                        <p className="subtle-text">아직 색인된 문서가 없습니다.</p>
                      ) : (
                        wikiSourcesWithActiveDocs.map((source) => (
                          <details key={source.source_id} className="wiki-tree__subgroup" open>
                            <summary>
                              {source.label} ({source.docs.length})
                            </summary>
                            <ul className="wiki-tree__list">
                              {source.docs.map((doc, docIndex) => (
                                <li key={`${doc.slug}-${docIndex}`} className="wiki-tree__doc-row">
                                  <button
                                    type="button"
                                    className="wiki-tree__item"
                                    onClick={() => void openKnowledgeWikiTarget(doc.path)}
                                  >
                                    <span>{displayTitleForFile(doc.title, doc.path)}</span>
                                    {/* W7 §5.6: 동일 내용 사본은 대표 1건만 보이고 사본 수를 접힘 배지로 알린다. */}
                                    {typeof doc.duplicate_count === "number" && doc.duplicate_count > 1 ? (
                                      <span
                                        className="wiki-tree__badge"
                                        data-testid="wiki-tree-duplicate-badge"
                                        title={`같은 내용의 파일이 ${doc.duplicate_count}개 있어 대표 1건만 표시합니다.`}
                                      >
                                        사본 {doc.duplicate_count}개
                                      </span>
                                    ) : null}
                                    {typeof doc.quality_score === "number" ? (
                                      <span className="wiki-tree__meta">
                                        품질 {Math.round(doc.quality_score * 100)}%
                                      </span>
                                    ) : null}
                                  </button>
                                  <button
                                    type="button"
                                    className="wiki-tree__preview-button"
                                    title={`${displayTitleForFile(doc.title, doc.path)} — 미리보기(현재 화면 유지)`}
                                    aria-label="문서 카드 미리보기"
                                    data-testid="wiki-tree-preview-button"
                                    onClick={() =>
                                      void openWikiDocPreview(
                                        doc.path,
                                        displayTitleForFile(doc.title, doc.path),
                                      )
                                    }
                                  >
                                    <AssetIcon src="/icons/action/preview.svg" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ))
                      )}
                    </details>
                    {/* W7 §5.5: 소프트 삭제된 카드 — 원본은 사라졌지만 카드는 보관 기간 동안 유지된다. */}
                    {wikiMissingDocs.length > 0 ? (
                      <details
                        className="wiki-tree__group wiki-tree__group--missing"
                        open
                        data-testid="wiki-tree-missing-docs"
                      >
                        <summary>원본 없는 카드 ({wikiMissingDocs.length})</summary>
                        <p className="subtle-text">
                          원본 파일이 삭제되거나 이동되어 지식카드만 남았습니다. 보관 기간이 지나면 자동
                          정리됩니다.
                        </p>
                        <ul className="wiki-tree__list">
                          {wikiMissingDocs.map((doc, docIndex) => (
                            <li key={`${doc.slug}-missing-${docIndex}`}>
                              <button
                                type="button"
                                className="wiki-tree__item wiki-tree__item--missing"
                                title="원본 파일이 없는 지식카드입니다. 카드 내용은 계속 열어볼 수 있습니다."
                                onClick={() => void openKnowledgeWikiTarget(doc.path)}
                              >
                                <span>{displayTitleForFile(doc.title, doc.path)}</span>
                                <span className="wiki-tree__badge wiki-tree__badge--missing">
                                  원본 삭제됨
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </>
                ) : knowledgeWikiIndex ? (
                  <div className="chat-markdown" data-testid="knowledge-wiki-index">
                    {renderMarkdownContent(knowledgeWikiIndex.content, (target) => {
                      void openKnowledgeWikiTarget(target);
                    })}
                  </div>
                ) : knowledgeWikiLoading ? (
                  <p className="subtle-text">지식위키 목차를 불러오는 중…</p>
                ) : (
                  <div data-testid="knowledge-wiki-empty">
                    <EmptyState
                      title="색인된 문서가 없습니다."
                      body="설정에서 지식폴더를 색인하면 위키 목차가 자동으로 생성됩니다."
                    />
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => goToSettingsGroup(KNOWLEDGE_SETTINGS_ANCHORS.sources)}
                      >
                        설정으로 이동
                      </button>
                    </div>
                  </div>
                )}
              </nav>
              <div className="wiki-page-pane">
                {wikiViewerMode === "search" ? (
                  <div className="stack-form" data-testid="knowledge-search-view">
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button-secondary button-with-icon"
                        onClick={() => setWikiViewerMode("wiki")}
                        title="검색 결과를 닫고 위키 화면으로 돌아갑니다."
                      >
                        <AssetIcon src="/icons/action/list.svg" />
                        ← 위키로
                      </button>
                      <span className="pill pill--soft">검색 결과</span>
                    </div>

                    {knowledgeInspectorLoading ? <p className="subtle-text">질의를 처리하는 중…</p> : null}

                    {/* J-07: 색인 문서가 없으면 결과 대신 설정 안내 */}
                    {!knowledgeInspectorLoading && !knowledgeSearchResult && !knowledgeAskResult ? (
                      indexedDocCount === 0 ? (
                        <div data-testid="knowledge-search-empty-index">
                          <EmptyState
                            title="색인된 문서가 없습니다."
                            body="지식폴더를 등록하고 색인을 실행하면 여기에서 검색할 수 있습니다."
                          />
                          <div className="inline-actions">
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => goToSettingsGroup(KNOWLEDGE_SETTINGS_ANCHORS.sources)}
                            >
                              설정으로 이동
                            </button>
                          </div>
                        </div>
                      ) : (
                        <EmptyState
                          title="검색 결과가 여기에 표시됩니다."
                          body="위 검색 바에서 검색 방법을 고르고 질의를 실행해 주세요."
                        />
                      )
                    ) : null}

                    {knowledgeSearchResult ? (
                knowledgeSearchItems.length === 0 ? (
                  indexedDocCount === 0 ? (
                    <div data-testid="knowledge-search-empty-index">
                      <EmptyState
                        title="색인된 문서가 없습니다."
                        body="검색할 문서가 아직 없습니다. 지식폴더를 등록하고 색인을 먼저 실행해 주세요."
                      />
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => goToSettingsGroup(KNOWLEDGE_SETTINGS_ANCHORS.sources)}
                        >
                          설정으로 이동
                        </button>
                      </div>
                    </div>
                  ) : (
                    <EmptyState
                      title="검색 결과가 없습니다."
                      body="색인된 문서에서 일치하는 내용을 찾지 못했습니다. 다른 키워드나 더 짧은 단어로 다시 시도해 보세요."
                    />
                  )
                ) : (
                  <div className="item-list" data-testid="knowledge-search-results">
                    {knowledgeSearchItems.map((item) => {
                      const wikiTarget = knowledgeItemWikiTarget(item);
                      // 표 첫 행/PPT 마스터 등 날것 제목은 파일명으로 대체(부제로 경로 유지).
                      const itemTitle = displayTitleForFile(item.title, item.source_path);
                      return (
                        <article key={item.doc_id} className="list-card">
                          <div className="list-card__main list-card__main--static">
                            <div>
                              <h3>{itemTitle}</h3>
                              <p>{relativePath(item.source_path)}</p>
                            </div>
                            <div className="inline-actions">
                              <button
                                type="button"
                                className="icon-button icon-button--sm"
                                aria-label={`${itemTitle} 원본 열기`}
                                title="원본 열기"
                                onClick={() => void openExternalTarget(item.source_path)}
                              >
                                <AssetIcon src="/icons/action/folder-open.svg" />
                              </button>
                              <button
                                type="button"
                                className="icon-button icon-button--sm"
                                aria-label={`${itemTitle} 경로 복사`}
                                title="경로 복사"
                                onClick={() => void copyTextToClipboard(item.source_path)}
                              >
                                <AssetIcon src="/icons/action/copy.svg" />
                              </button>
                            </div>
                          </div>
                          <ParsedExcerpt text={item.snippet} />
                          <div className="document-preview__meta">
                            {typeof item.quality_score === "number" ? (
                              <span>품질 {Math.round(item.quality_score * 100)}%</span>
                            ) : null}
                            {(item.warnings ?? []).length > 0 ? (
                              <span className="pill pill--warning">
                                경고: {(item.warnings ?? []).map(describeExtractionQualityWarning).join(", ")}
                              </span>
                            ) : null}
                          </div>
                          <div className="inline-actions">
                            <button
                              type="button"
                              className="button-secondary"
                              disabled={!wikiTarget}
                              title={
                                wikiTarget
                                  ? "이 문서의 지식위키 카드를 엽니다."
                                  : "이 결과에는 연결된 위키 카드가 없습니다."
                              }
                              onClick={() => openKnowledgeItemWikiCard(item)}
                            >
                              위키 카드 보기
                            </button>
                            <button
                              type="button"
                              className="button-secondary"
                              title={
                                selectedSessionId
                                  ? "이 문서를 현재 업무대화 세션에 관련 파일로 연결합니다."
                                  : "세션이 없으면 새 업무대화 세션을 만들어 연결합니다."
                              }
                              onClick={() =>
                                void (async () => {
                                  // F-14: 세션이 없으면 자동 생성 후 연결(무반응 방지)
                                  const sessionId = await ensureWorkSession();
                                  if (sessionId) {
                                    await connectLocalFileToSession(toLocalFileHit(item), sessionId);
                                  }
                                })()
                              }
                            >
                              세션에 연결
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )
              ) : null}

              {knowledgeAskResult ? (
                <div className="document-preview" data-testid="knowledge-ask-result">
                  <div className="document-preview__meta">
                    <span className="pill">근거 답변</span>
                    <span className="pill pill--soft" data-testid="knowledge-answer-mode">
                      {knowledgeAskResult.answer_mode === "llm" ? "LLM 합성" : "발췌 요약"}
                    </span>
                    <span className="subtle-text">{knowledgeAskResult.query}</span>
                    {selectedSession ? (
                      <span className="subtle-text">세션 맥락: {selectedSession.title}</span>
                    ) : null}
                    {knowledgeAskResult.retrieval_summary ? (
                      <span className="subtle-text">
                        검색근거 {knowledgeAskResult.retrieval_summary.source_count}개
                      </span>
                    ) : null}
                  </div>
                  <div className="chat-markdown">
                    {renderMarkdownContent(knowledgeAskResult.answer, (target) => {
                      void openExternalTarget(target);
                    })}
                  </div>
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="button-secondary button-with-icon"
                      onClick={() => void copyKnowledgeAnswer(knowledgeAskResult.answer)}
                    >
                      <AssetIcon src="/icons/action/copy.svg" />
                      답변 복사
                    </button>
                    <button
                      type="button"
                      className="button-secondary button-with-icon"
                      onClick={() => void continueAnswerInChat(knowledgeAskResult.query, knowledgeAskResult.answer)}
                    >
                      <AssetIcon src="/icons/action/send.svg" />
                      업무대화로 이어가기
                    </button>
                  </div>
                  <h3 className="subheading">출처 문서</h3>
                  {knowledgeAskResult.citations.length > 0 ? (
                    <div className="item-list">
                      {knowledgeAskResult.citations.map((citation, index) => {
                        const citationPath = citation.source_path ?? citation.file_path;
                        const citationTitle = displayTitleForFile(citation.title, citationPath);
                        return (
                        <article key={`${citation.doc_id ?? citation.file_path}-${index}`} className="list-card">
                          <div className="list-card__main list-card__main--static">
                            <div>
                              <h3>{citationTitle}</h3>
                              <p>원본: {relativePath(citationPath)}</p>
                            </div>
                            <button
                              type="button"
                              className="icon-button icon-button--sm"
                              aria-label={`${citationTitle} 원본 열기`}
                              title="원본 열기"
                              onClick={() => void openExternalTarget(citationPath)}
                            >
                              <AssetIcon src="/icons/action/folder-open.svg" />
                            </button>
                          </div>
                          <ParsedExcerpt text={citation.snippet} label="발췌" />
                          <div className="document-preview__meta">
                            {typeof citation.quality_score === "number" ? (
                              <span>품질 {Math.round(citation.quality_score * 100)}%</span>
                            ) : null}
                            {(citation.quality_warnings ?? []).length > 0 ? (
                              <span className="pill pill--warning">
                                경고: {(citation.quality_warnings ?? []).map(describeExtractionQualityWarning).join(", ")}
                              </span>
                            ) : null}
                          </div>
                        </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="subtle-text">표시할 출처 문서가 없습니다.</p>
                  )}
                </div>
              ) : null}
                  </div>
                ) : knowledgeWikiPage ? (
                  <div className="stack-form">
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button-secondary button-with-icon"
                        onClick={returnToWikiToc}
                      >
                        <AssetIcon src="/icons/action/list.svg" />
                        ← 목차
                      </button>
                      {/* 위키 이동 히스토리(2026-07-12 UX): 스택이 비어 있으면 숨긴다. */}
                      {wikiPageHistory.length > 0 ? (
                        <button
                          type="button"
                          className="button-secondary"
                          data-testid="knowledge-wiki-back"
                          title="직전에 보던 위키 페이지로 돌아갑니다."
                          onClick={goBackWikiPage}
                        >
                          ← 이전
                        </button>
                      ) : null}
                      <span className="pill pill--soft" data-testid="knowledge-wiki-breadcrumb">
                        목차 / {knowledgeWikiPage.relative_path}
                      </span>
                    </div>
                    <div data-testid="knowledge-wiki-page">{renderWikiPageBody(knowledgeWikiPage)}</div>
                  </div>
                ) : knowledgeWikiLoading ? (
                  <p className="subtle-text">위키 문서를 불러오는 중…</p>
                ) : (
                  <EmptyState
                    title="왼쪽 목차에서 문서를 선택하세요."
                    body="주제, 업무 기록, 폴더별 문서 항목을 누르면 이 영역에 내용이 표시됩니다."
                  />
                )}
              </div>
            </div>
          </SectionCard>
        ) : null}

        {/* ⑥(3) 핵심문서 미리보기 — 우측 뷰어를 대체하지 않는 인플레이스 모달. */}
        {wikiPreview ? (
          <div
            className="wiki-preview-overlay"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setWikiPreview(null);
              }
            }}
          >
            <div
              className="wiki-preview-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`${wikiPreview.title} 미리보기`}
              data-testid="wiki-preview-modal"
            >
              <header className="wiki-preview-modal__header">
                <div>
                  <span className="eyebrow">문서 미리보기</span>
                  <h3>{wikiPreview.title}</h3>
                </div>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setWikiPreview(null)}
                  title="미리보기를 닫습니다."
                >
                  닫기
                </button>
              </header>
              <div className="wiki-preview-modal__body chat-markdown">
                {wikiPreviewLoading && !wikiPreview.content ? (
                  <p className="subtle-text">미리보기를 불러오는 중…</p>
                ) : (
                  // 전체 뷰어와 동일하게 front-matter(YAML)와 자동생성 안내 주석은 제거하고
                  // 본문만 렌더한다.
                  renderMarkdownContent(
                    parseWikiFrontMatter(wikiPreview.content).body.replace(/<!--[\s\S]*?-->/g, "").trim(),
                    (target) => {
                      // 미리보기 안의 링크는 미리보기를 닫고 우측 뷰어에서 연다.
                      setWikiPreview(null);
                      void openKnowledgeWikiTarget(target);
                    },
                  )
                )}
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return renderKnowledgeSection();
}
