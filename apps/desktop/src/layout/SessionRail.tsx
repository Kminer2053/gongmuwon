import { type FormEvent } from "react";
import { createWorkSession, type WorkSessionItem } from "../api";
import { AssetIcon, EmptyState, SectionCard } from "../shared/primitives";
import { MENU_ITEMS, useAppStore } from "../store";

export function SessionRail() {
  const {
    activeMenu,
    filteredWorkSessions,
    handleAction,
    latestSessionPreview,
    revealContextSection,
    selectedSessionId,
    sessionCreateExpanded,
    sessionForm,
    sessionMessages,
    sessionRailQuery,
    setActiveMenu,
    setSelectedSessionId,
    setSessionCreateExpanded,
    setSessionForm,
    setSessionRailQuery,
    setSnapshot,
    snapshot,
    submitting,
  } = useAppStore();

  async function submitWorkSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await handleAction(
      () =>
        createWorkSession({
          title: sessionForm.title,
          schedule_id: null,
        }),
      "업무대화 세션을 만들었습니다.",
      { refresh: "none" },
    );
    if (created) {
      setSnapshot((current) => ({
        ...current,
        workSessions: [created, ...current.workSessions.filter((session) => session.id !== created.id)],
      }));
      revealContextSection("context");
      setSelectedSessionId(created.id);
      setSessionForm({ title: "" });
      setSessionCreateExpanded(false);
    }
  }

  function renderSessionRailItem(session: WorkSessionItem) {
    const linkedSchedule = snapshot.schedules.find((schedule) => schedule.id === session.schedule_id);
    const hasLinkedSchedule = Boolean(session.schedule_id);
    const messageCount = sessionMessages[session.id]?.length ?? session.messages?.length ?? 0;

    return (
      <button
        key={session.id}
        type="button"
        className={`session-rail__item ${selectedSessionId === session.id ? "is-selected" : ""}`}
        onClick={() => {
          setSelectedSessionId(session.id);
          setActiveMenu("chat");
        }}
      >
        <div className="session-rail__item-main">
          <div className="session-rail__title-row">
            <strong>{session.title}</strong>
            {hasLinkedSchedule ? (
              <span className="session-rail__badge" aria-label="일정 연결 세션">
                일정
              </span>
            ) : (
              <span className="session-rail__badge session-rail__badge--muted" aria-label="독립 업무대화 세션">
                독립
              </span>
            )}
          </div>
          <span>{linkedSchedule?.title ?? "독립 업무대화 세션"}</span>
          <p className="session-rail__preview">{latestSessionPreview(session)}</p>
          <p className="session-rail__meta">
            <span>{messageCount}개 메시지</span>
            {hasLinkedSchedule ? <span>일정 연결</span> : <span>독립 흐름</span>}
          </p>
        </div>
      </button>
    );
  }

  function renderCompactSessionRailList() {
    if (filteredWorkSessions.length === 0) {
      return (
        <EmptyState
          title={snapshot.workSessions.length === 0 ? "아직 업무대화 세션이 없습니다." : "검색 조건에 맞는 세션이 없습니다."}
          body={
            snapshot.workSessions.length === 0
              ? "새 세션을 만들고 일정 연결이 필요한 세션에만 작은 리본 배지를 붙입니다."
              : "검색어를 줄이거나 새 독립 세션을 바로 열어 흐름을 이어갈 수 있습니다."
          }
        />
      );
    }

    return (
      <div className="session-rail__list">
        {filteredWorkSessions.map((session) => renderSessionRailItem(session))}
      </div>
    );
  }

  function renderSessionRail() {
    return (
      <aside className="sidebar session-rail" data-testid="session-rail">
        <nav className="feature-rail" aria-label="주요 작업 메뉴">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`feature-rail__item ${activeMenu === item.key ? "is-active" : ""}`}
              onClick={() => setActiveMenu(item.key)}
              aria-label={item.label}
              title={item.label}
            >
              <AssetIcon src={item.iconSrc} className="feature-rail__icon" />
              <span className="feature-rail__label">{item.label}</span>
            </button>
          ))}
        </nav>
        <SectionCard
          eyebrow="업무대화 우선"
          title="업무대화 세션"
          actions={
            <div className="inline-actions">
              <span className="pill pill--soft">
                {filteredWorkSessions.length}/{snapshot.workSessions.length}개 세션
              </span>
              <button
                type="button"
                className="button-secondary"
                aria-label="새 세션"
                aria-expanded={sessionCreateExpanded}
                onClick={() => setSessionCreateExpanded((current) => !current)}
              >
                +
              </button>
            </div>
          }
        >
          <div className="session-rail__scroll">
            <div className="session-rail__summary">
              <p>왼쪽은 세션을 고르는 곳입니다. 일정 연결은 가운데 대화 화면에서 자연스럽게 이어집니다.</p>
              <label className="session-rail__search">
                세션 검색
                <input
                  data-testid="session-rail-search"
                  value={sessionRailQuery}
                  onChange={(event) => setSessionRailQuery(event.target.value)}
                  placeholder="세션 제목, 일정 제목, 최근 메시지 검색"
                />
              </label>
            </div>
            {sessionCreateExpanded ? (
              <form className="stack-form session-rail__quick-create" onSubmit={submitWorkSession}>
                <label>
                  새 세션 제목
                  <input
                    value={sessionForm.title}
                    onChange={(event) => setSessionForm({ title: event.target.value })}
                    placeholder="예: 주간 보고 준비"
                    required
                  />
                </label>
                <div className="inline-actions">
                  <button type="submit" disabled={submitting}>
                    세션 만들기
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      setSessionForm({ title: "" });
                      setSessionCreateExpanded(false);
                    }}
                  >
                    취소
                  </button>
                </div>
              </form>
            ) : null}
            {renderCompactSessionRailList()}
          </div>
        </SectionCard>
      </aside>
    );
  }

  return renderSessionRail();
}
