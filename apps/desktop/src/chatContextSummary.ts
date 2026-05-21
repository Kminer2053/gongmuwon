import type { WorkSessionTurnContextSummary } from "./api";

export function buildChatContextEvidence(summary?: WorkSessionTurnContextSummary | null) {
  if (!summary) {
    return [];
  }

  const evidence = [
    summary.graphrag_used
      ? `GraphRAG 근거 ${summary.graphrag_evidence_count}개`
      : "GraphRAG 근거 없음",
    `첨부 ${summary.attachment_count}개`,
    `연결 파일 ${summary.linked_file_count}개`,
  ];

  const modelLabel = [summary.provider, summary.model].filter(Boolean).join(" / ");
  if (modelLabel) {
    evidence.push(`모델 ${modelLabel}`);
  }

  return evidence;
}
