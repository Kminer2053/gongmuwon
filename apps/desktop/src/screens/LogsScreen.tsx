import { useMemo, useState } from "react";
import type { ExecutionLogItem } from "../api";
import { buildExecutionLogDisplay } from "../executionLogDisplay";
import { formatDateTime, formatStructuredValue } from "../shared/format";
import { describeExecutionAction, describeExecutionFeature, describeStatus } from "../shared/labels";
import { AssetIcon, DetailPanel, EmptyState, SectionCard } from "../shared/primitives";
import { useAppStore } from "../store";
import "../styles/logs-screen.css";

type LogCategory = "all" | "schedule" | "chat" | "knowledge" | "documents" | "settings" | "failed";

const CATEGORY_FILTERS: Array<{ key: LogCategory; label: string }> = [
  { key: "all", label: "전체" },
  { key: "schedule", label: "일정" },
  { key: "chat", label: "업무대화" },
  { key: "knowledge", label: "지식" },
  { key: "documents", label: "문서" },
  { key: "settings", label: "설정" },
  { key: "failed", label: "실패" },
];

const FAILED_STATUSES = new Set(["failed"]);

function matchesCategory(log: ExecutionLogItem, category: LogCategory): boolean {
  if (category === "all") {
    return true;
  }
  if (category === "failed") {
    return FAILED_STATUSES.has(log.status);
  }
  if (category === "schedule") {
    return log.feature === "schedule";
  }
  if (category === "chat") {
    return log.feature === "chat";
  }
  if (category === "knowledge") {
    return log.feature === "knowledge" || log.feature === "search" || log.feature === "references";
  }
  if (category === "documents") {
    return log.feature === "documents";
  }
  if (category === "settings") {
    return log.feature === "settings" || log.feature === "approval";
  }
  return true;
}

function dayGroupLabel(createdAt: string, todayKey: string, yesterdayKey: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "이전";
  }
  const key = date.toDateString();
  if (key === todayKey) {
    return "오늘";
  }
  if (key === yesterdayKey) {
    return "어제";
  }
  return "이전";
}

export function LogsScreen() {
  const { detailCard, snapshot, toggleDetailCard } = useAppStore();
  const [category, setCategory] = useState<LogCategory>("all");

  const filteredLogs = useMemo(
    () => snapshot.logs.filter((log) => matchesCategory(log, category)),
    [snapshot.logs, category],
  );

  const groupedLogs = useMemo(() => {
    const now = new Date();
    const todayKey = now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toDateString();

    const groups: Array<{ label: string; logs: ExecutionLogItem[] }> = [];
    const order = ["오늘", "어제", "이전"];
    const buckets: Record<string, ExecutionLogItem[]> = { 오늘: [], 어제: [], 이전: [] };
    for (const log of filteredLogs) {
      const label = dayGroupLabel(log.created_at, todayKey, yesterdayKey);
      buckets[label].push(log);
    }
    for (const label of order) {
      if (buckets[label].length > 0) {
        groups.push({ label, logs: buckets[label] });
      }
    }
    return groups;
  }, [filteredLogs]);

  function renderLogRow(log: ExecutionLogItem) {
    const display = buildExecutionLogDisplay(log);
    const isFailed = FAILED_STATUSES.has(log.status);
    const isExpanded = detailCard?.kind === "log" && detailCard.id === log.id;
    return (
      <article
        key={log.id}
        className={`logs-row ${isFailed ? "logs-row--failed" : ""} ${isExpanded ? "is-expanded" : ""}`}
      >
        <button
          type="button"
          className="logs-row__main"
          onClick={() => toggleDetailCard({ kind: "log", id: log.id })}
          aria-expanded={isExpanded}
        >
          <span className="logs-row__time">{formatDateTime(log.created_at)}</span>
          <span className="logs-row__summary">
            <span className="logs-row__title">{display.title}</span>
            <span className="logs-row__subtitle">{display.subtitle}</span>
          </span>
          <span className={`pill ${isFailed ? "pill--warning" : "pill--soft"}`}>{display.statusLabel}</span>
        </button>
        {isExpanded ? (
          <div className="logs-row__detail">
            <p className="subtle-text">{display.detail}</p>
            <details className="logs-row__dev-info">
              <summary>개발자 정보</summary>
              <DetailPanel
                title="실행 상세"
                fields={[
                  { label: "기능", value: describeExecutionFeature(log.feature) },
                  { label: "작업", value: describeExecutionAction(log.action) },
                  { label: "상태", value: describeStatus(log.status) },
                  { label: "승인 티켓", value: log.approval_ticket_id ?? "없음" },
                  { label: "입력", value: formatStructuredValue(log.inputs), code: true },
                  { label: "출력", value: formatStructuredValue(log.outputs), code: true },
                ]}
              />
            </details>
          </div>
        ) : null}
      </article>
    );
  }

  function renderLogsSection() {
    return (
      <SectionCard eyebrow="사용자 작업 이력" title="실행기록" testId="logs-screen">
        <div className="logs-filter-bar" role="group" aria-label="실행기록 카테고리 필터">
          {CATEGORY_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`logs-filter-chip ${category === filter.key ? "is-active" : ""}`}
              aria-pressed={category === filter.key}
              onClick={() => setCategory(filter.key)}
            >
              <AssetIcon src="/icons/action/list.svg" />
              {filter.label}
            </button>
          ))}
        </div>
        {snapshot.logs.length === 0 ? (
          <EmptyState title="실행기록이 없습니다." body="문서작성, 지식 반영 등 작업 요청은 모두 이력으로 쌓입니다." />
        ) : filteredLogs.length === 0 ? (
          <EmptyState title="해당 카테고리의 실행기록이 없습니다." body="다른 필터를 선택해 보세요." />
        ) : (
          <div className="logs-group-list">
            {groupedLogs.map((group) => (
              <section key={group.label} className="logs-group">
                <h3 className="logs-group__heading">{group.label}</h3>
                <div className="logs-row-list">{group.logs.map((log) => renderLogRow(log))}</div>
              </section>
            ))}
          </div>
        )}
      </SectionCard>
    );
  }

  return renderLogsSection();
}
