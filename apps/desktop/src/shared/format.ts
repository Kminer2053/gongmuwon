export function formatDateTime(value?: string | null) {
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

export function toIso(value: string) {
  if (!value) {
    return new Date().toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function normalizeDisplayText(value: string) {
  return value.normalize("NFC");
}

export function relativePath(fullPath?: string | null) {
  if (!fullPath) {
    return "-";
  }

  const parts = normalizeDisplayText(fullPath).split(/[\\/]/);
  return parts.slice(Math.max(parts.length - 3, 0)).join("/");
}

export function fileNameFromPath(fullPath?: string | null) {
  if (!fullPath) {
    return "파일";
  }
  const normalized = normalizeDisplayText(fullPath);
  return normalized.split(/[\\/]/).pop() || normalized;
}

export function shortDisplayId(value?: string | null, label = "작업") {
  const normalized = value?.trim();
  if (!normalized) {
    return `${label} 없음`;
  }
  const compact = normalized.replace(/[^a-zA-Z0-9]/g, "");
  return `${label} #${(compact || normalized).slice(0, 8)}`;
}

export function friendlyArtifactLabel(path?: string | null) {
  const fileName = fileNameFromPath(path);
  const match = fileName.match(/^([a-f0-9]{8})[a-f0-9-]*\.(md|hwpx|hwtx)$/i);
  if (match) {
    return `문서 산출물 #${match[1]}`;
  }
  return relativePath(path);
}

export function parentPathFromPath(fullPath?: string | null) {
  const normalized = fullPath?.trim();
  if (!normalized) {
    return "";
  }
  const separatorIndex = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : normalized;
}

export function createDraftAttachmentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatStructuredValue(value?: Record<string, unknown>) {
  if (!value || Object.keys(value).length === 0) {
    return "없음";
  }

  return JSON.stringify(value, null, 2).normalize("NFC");
}

export function formatClipboardImageName(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}`;
  return `클립보드-${stamp}.png`;
}

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function formatDateInputValue(date: Date, hour = 9, minute = 0) {
  const local = new Date(date);
  local.setHours(hour, minute, 0, 0);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  const hours = String(local.getHours()).padStart(2, "0");
  const minutes = String(local.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function formatZoomPercent(scale: number) {
  return `${Math.round(scale * 100)}%`;
}

export function formatLatencyBadge(latencyMs?: number | null) {
  if (typeof latencyMs !== "number" || latencyMs < 0) {
    return null;
  }
  if (latencyMs < 1000) {
    return `응답 ${latencyMs}ms`;
  }
  return `응답 ${(latencyMs / 1000).toFixed(1)}초`;
}

export function formatDurationMs(value: number) {
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  return `${(value / 1000).toFixed(1)}초`;
}

// ---------------------------------------------------------------------------
// 파싱 산출물 표출 보정 — 파서가 만든 날것 텍스트(서식 보일러플레이트, 표 셀 나열,
// 개조식 마크다운)를 실사용자가 읽을 수 있는 형태로 바꾸기 위한 헬퍼 모음.
// ---------------------------------------------------------------------------

// 파싱 산출 제목이 서식 보일러플레이트/표 셀 나열일 때 파일명으로 대체한다.
// (예: PPT 마스터 "Click to edit Master title style", 엑셀 첫 행 "202506 202507 ... 합계")
const GARBAGE_TITLE_PATTERNS = [
  /click to edit master/i,
  /^slide ?\d*$/i,
  /^sheet ?\d*$/i,
  /^(?:슬라이드|시트|페이지)\s*\d*$/,
  /^presentation ?\d*$/i,
  /^제목\s*없(?:는|음)/,
  /^(?:[\d,.%()\-\s]|합계|소계|판매금액|금액)+$/,
];

/** 숫자·기호로만 이루어진 토큰(표 셀 값으로 흔한 형태)인지 판별한다. */
const NUMERIC_LIKE_TOKEN_PATTERN = /^[\d,.%()\-~:/]+$/;

/**
 * 표에서 흘러나온 한 줄인지 판별한다.
 * 숫자 셀이 대부분이거나("202506 202507 … 합계"), 같은 셀 텍스트가 반복되면
 * ("판매금액 (-) 판매금액 (-) …") 문장이 아니라 표 행으로 본다.
 */
export function looksLikeTableRowText(value: string, minTokens = 6): boolean {
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length < minTokens) {
    return false;
  }
  const numericCount = tokens.filter((token) => NUMERIC_LIKE_TOKEN_PATTERN.test(token)).length;
  if (numericCount / tokens.length >= 0.6) {
    return true;
  }
  return new Set(tokens).size / tokens.length <= 0.4;
}

/** 경로에서 확장자를 뗀 파일 이름(stem)을 얻는다. 윈도우 역슬래시 경로도 처리한다. */
export function fileStemFromPath(filePath?: string | null): string {
  const normalized = (filePath ?? "").trim();
  if (!normalized) {
    return "";
  }
  const name = normalizeDisplayText(normalized).split(/[\\/]/).pop() ?? "";
  return name.replace(/\.[^.]+$/, "").trim();
}

export function displayTitleForFile(title: string | null | undefined, filePath: string): string {
  const trimmed = (title ?? "").replace(/\s+/g, " ").trim();
  const stem = fileStemFromPath(filePath);
  if (!trimmed) {
    return stem || filePath;
  }
  if (GARBAGE_TITLE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return stem || trimmed;
  }
  // 표 첫 행이 제목으로 흘러들어온 경우(숫자 나열·셀 반복)도 파일명이 더 읽기 쉽다.
  if (stem && looksLikeTableRowText(trimmed, 4)) {
    return stem;
  }
  // 숫자·기호 비중이 압도적인 제목(표 데이터 유입)도 파일명이 더 읽기 쉽다.
  const letters = trimmed.replace(/[^0-9A-Za-z가-힣]/g, "");
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (letters.length > 0 && digits.length / letters.length > 0.7 && stem) {
    return stem;
  }
  return trimmed;
}

/** 발췌(excerpt/snippet)를 어떻게 그릴지 — 표 데이터면 요약+원문, 아니면 본문 그대로. */
export type ExcerptDisplay =
  | { kind: "text"; text: string }
  | { kind: "table"; rowCount: number; firstRowPreview: string; raw: string };

/**
 * 파싱 발췌가 표 셀 나열이면 "표 데이터 N행 — 첫 행: …" 요약으로 바꿔 그리도록 분류한다.
 * 일반 문장은 kind="text"로 그대로 통과시킨다. 빈 값은 null.
 */
export function describeExcerptForDisplay(raw?: string | null): ExcerptDisplay | null {
  const text = (raw ?? "").trim();
  if (!text) {
    return null;
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  const isTableRowLine = (line: string) => {
    if (looksLikeTableRowText(line)) {
      return true;
    }
    // 탭/연속 공백으로 3칸 이상 나뉘는 줄도 표 행으로 본다.
    return line.split(/\t| {2,}/).filter(Boolean).length >= 3;
  };
  const tableLike =
    lines.length === 1
      ? looksLikeTableRowText(lines[0], 8)
      : lines.filter(isTableRowLine).length / lines.length >= 0.6;
  if (!tableLike) {
    return { kind: "text", text };
  }
  const firstRow = lines[0].replace(/\s+/g, " ");
  const firstRowPreview = firstRow.length > 60 ? `${firstRow.slice(0, 60)}…` : firstRow;
  return { kind: "table", rowCount: lines.length, firstRowPreview, raw: text };
}

/** 개조식/마크다운 위계 한 줄 — depth 들여쓰기 + 종류(제목/항목/비고/본문). */
export type OutlineDisplayLine = {
  depth: 0 | 1 | 2;
  kind: "heading" | "bullet" | "note" | "text";
  text: string;
};

/**
 * 위키 카드·검색 스니펫에 섞여 오는 개조식(□ ◦ -)·마크다운(#) 위계를
 * 플레인 텍스트로 뭉개지 않도록 줄 단위 depth 정보로 분해한다.
 * 개조식 기호(□ ◦ - ※)는 공무원에게 의미가 있으므로 그대로 남긴다.
 */
export function splitOutlineDisplayLines(text: string): OutlineDisplayLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): OutlineDisplayLine => {
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        return { depth: heading[1].length <= 2 ? 0 : 1, kind: "heading", text: heading[2].trim() };
      }
      if (/^[□■]/.test(line)) {
        return { depth: 0, kind: "bullet", text: line };
      }
      if (/^[◦○]/.test(line)) {
        return { depth: 1, kind: "bullet", text: line };
      }
      if (/^※/.test(line)) {
        return { depth: 1, kind: "note", text: line };
      }
      if (/^[-•·*]\s/.test(line)) {
        return { depth: 2, kind: "bullet", text: line };
      }
      return { depth: 0, kind: "text", text: line };
    });
}

/** 위계 렌더가 필요한 텍스트인지 — 여러 줄이거나 개조식/헤딩 기호가 있으면 true. */
export function hasOutlineHierarchy(lines: OutlineDisplayLine[]): boolean {
  return lines.length > 1 || lines.some((line) => line.kind !== "text");
}
