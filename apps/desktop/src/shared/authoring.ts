import type { AuthoringFormatItem } from "../api";

export const AUTHORING_FORMAT_FALLBACK: AuthoringFormatItem[] = [
  {
    key: "officialMemo",
    label: "시행문",
    description: "수신처에 발송하는 공문. 가나다 위계 항목과 붙임으로 구성",
  },
  {
    key: "onePageReport",
    label: "1페이지 보고서",
    description: "두괄식 요약 + 섹션 2~5개(□→◦→- 위계)로 정리하는 한 장 보고",
  },
  {
    key: "fullReport",
    label: "풀버전 보고서",
    description: "장·절·항목 위계의 상세 보고서. 확정 일정표 포함 가능",
  },
  {
    key: "email",
    label: "이메일",
    description: "업무 이메일 본문. 제목·인사·본문 문단·맺음말·서명으로 구성",
  },
];

export const AUTHORING_FORMAT_ICONS: Record<string, string> = {
  officialMemo: "file",
  onePageReport: "doc-forward",
  fullReport: "list",
  email: "send",
};

export function authoringFormatIconSrc(formatKey: string, active: boolean) {
  const name = AUTHORING_FORMAT_ICONS[formatKey] ?? "file";
  return `/icons/action/${name}${active ? "-inverse" : ""}.svg`;
}

export const AUTHORING_TABS = [
  { key: "references", label: "참고자료" },
  { key: "content", label: "작성 콘텐츠" },
  { key: "preview", label: "미리보기" },
  { key: "final", label: "최종 HWPX" },
] as const;

export type AuthoringTabKey = (typeof AUTHORING_TABS)[number]["key"];

export const AUTHORING_STAGE_LABELS: Record<string, string> = {
  organize: "내용 정리",
  format: "양식 맞춤",
};

export function authoringFormatLabel(formats: AuthoringFormatItem[], key: string) {
  return (
    formats.find((format) => format.key === key)?.label ??
    AUTHORING_FORMAT_FALLBACK.find((format) => format.key === key)?.label ??
    "보고서"
  );
}

export function splitAuthoringLines(value: string) {
  return value.split(/\r?\n/);
}

export function joinAuthoringLines(value: unknown) {
  if (!Array.isArray(value)) {
    return "";
  }
  return value.map((item) => String(item ?? "")).join("\n");
}

export function cleanAuthoringLines(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

export function readStructureText(structure: Record<string, unknown>, key: string) {
  const value = structure[key];
  return typeof value === "string" ? value : "";
}

export function readStructureList(structure: Record<string, unknown>, key: string): unknown[] {
  const value = structure[key];
  return Array.isArray(value) ? value : [];
}

export function cloneAuthoringStructure(structure: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(structure)) as Record<string, unknown>;
}

export function sanitizeAuthoringStructure(formatKey: string, structure: Record<string, unknown>) {
  const draft = cloneAuthoringStructure(structure);
  if (formatKey === "onePageReport") {
    draft.sections = readStructureList(draft, "sections").map((section) => {
      const record = (section ?? {}) as Record<string, unknown>;
      return { ...record, items: cleanAuthoringLines(record.items) };
    });
  }
  if (formatKey === "fullReport") {
    draft.summary = cleanAuthoringLines(draft.summary);
    draft.chapters = readStructureList(draft, "chapters").map((chapter) => {
      const chapterRecord = (chapter ?? {}) as Record<string, unknown>;
      return {
        ...chapterRecord,
        sections: (Array.isArray(chapterRecord.sections) ? chapterRecord.sections : []).map((section) => {
          const sectionRecord = (section ?? {}) as Record<string, unknown>;
          return { ...sectionRecord, items: cleanAuthoringLines(sectionRecord.items) };
        }),
      };
    });
  }
  if (formatKey === "officialMemo") {
    draft.items = readStructureList(draft, "items").map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      const subs = cleanAuthoringLines(record.subs);
      const next: Record<string, unknown> = { ...record };
      if (subs.length > 0) {
        next.subs = subs;
      } else {
        delete next.subs;
      }
      return next;
    });
    const attachments = cleanAuthoringLines(draft.attachments);
    if (attachments.length > 0) {
      draft.attachments = attachments;
    } else {
      delete draft.attachments;
    }
  }
  if (formatKey === "email") {
    draft.body_paragraphs = cleanAuthoringLines(draft.body_paragraphs);
  }
  return draft;
}
