import { formatZoomPercent } from "../shared/format";
import { userFacingRuntimeDetail } from "../shared/labels";
import { AssetIcon } from "../shared/primitives";
import { useAppStore } from "../store";

export function TopBar() {
  const {
    ActiveMenuIcon,
    activeMenuMeta,
    activeWorkJobCount,
    contextPaneOpen,
    handleRecoverSidecar,
    handleRestartSidecar,
    handleStartSidecar,
    handleStopSidecar,
    handleUiZoom,
    lockedKnowledgeIngestion,
    pushToast,
    refreshKnowledgeIngestionJobsOnly,
    refreshSnapshot,
    runtimeIndicatorButtonRef,
    runtimeLoading,
    runtimePanelOpen,
    runtimePanelRef,
    runtimeStarting,
    runtimeStatus,
    setActiveMenu,
    setContextPaneOpen,
    setRuntimePanelOpen,
    snapshot,
    uiFontScale,
    unmanagedRuntimeReachable,
  } = useAppStore();

  function renderTopBar() {
    return (
      <header className="shell-topbar">
          <div
            className="brand-card shell-topbar__brand shell-topbar__brand--home-link"
            role="button"
            tabIndex={0}
            aria-label="홈으로"
            title="홈으로 (오늘의 브리핑)"
            data-testid="topbar-home-link"
            onClick={() => setActiveMenu("home")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setActiveMenu("home");
              }
            }}
          >
            <div className="brand-card__main">
              <div>
                <p className="brand-card__eyebrow">공공분야 사무업무자를 위한 보안 걱정 없는 로컬 우선 업무공간</p>
                <h1>로컬 AI에이전트 워크플레이스 : 공무원</h1>
                <p>대화에서 시작해 일정, 검색, 지식, 문서작성, 실행기록까지 한 워크플로로 묶습니다.</p>
              </div>
              <div className="shell-topbar__current" data-testid="shell-topbar-current">
                <span className="shell-topbar__current-icon"><ActiveMenuIcon size={18} /></span>
                <div>
                  <strong>{activeMenuMeta.label}</strong>
                  <span>{activeMenuMeta.description}</span>
                </div>
              </div>
            </div>
          </div>
        <div className="shell-topbar__actions" aria-label="작업 표시 도구">
          <button
            type="button"
            className="icon-button topbar-zoom-button"
            onClick={() => void handleUiZoom(-0.1)}
            aria-label="화면 축소"
            title="화면 축소"
          >
            <AssetIcon src="/icons/action/minus.svg" testId="topbar-zoom-out-icon" />
          </button>
          <span className="pill pill--soft topbar-zoom-pill" title="현재 배율">
            {formatZoomPercent(uiFontScale)}
          </span>
          <button
            type="button"
            className="icon-button topbar-zoom-button"
            onClick={() => void handleUiZoom(0.1)}
            aria-label="화면 확대"
            title="화면 확대"
          >
            <AssetIcon src="/icons/action/plus.svg" testId="topbar-zoom-in-icon" />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              if (lockedKnowledgeIngestion) {
                pushToast("info", "색인 처리 중에는 지식위키 색인 상태만 갱신합니다.");
                void refreshKnowledgeIngestionJobsOnly();
                return;
              }
              void refreshSnapshot();
            }}
            aria-label="새로고침"
            title="새로고침"
          >
            <AssetIcon src="/icons/refresh.svg" testId="topbar-refresh-icon" />
          </button>
          <button
            type="button"
            className={`icon-button ${contextPaneOpen ? "is-active" : ""}`}
            aria-expanded={contextPaneOpen}
            onClick={() => setContextPaneOpen((current) => !current)}
            aria-label={contextPaneOpen ? "오른쪽 정보 패널 닫기" : "오른쪽 정보 패널 열기"}
            title={contextPaneOpen ? "오른쪽 정보 패널 닫기" : "오른쪽 정보 패널 열기"}
          >
            <AssetIcon
              src={contextPaneOpen ? "/icons/panel-close.svg" : "/icons/panel-open.svg"}
              testId="topbar-context-toggle-icon"
            />
          </button>
          <div className="runtime-indicator-wrap">
            <button
              type="button"
              className={`runtime-indicator ${snapshot.health?.status === "ok" ? "is-ok" : "is-offline"}`}
              data-testid="runtime-indicator-toggle"
              aria-label="업무 엔진 상태"
              aria-expanded={runtimePanelOpen}
              ref={runtimeIndicatorButtonRef}
              onClick={() => setRuntimePanelOpen((current) => !current)}
            >
              <span className="runtime-indicator__light" />
            </button>
            {runtimePanelOpen ? (
              <div className="runtime-popover" data-testid="runtime-popover" ref={runtimePanelRef}>
                <p className="runtime-popover__title">업무 엔진 상태</p>
                <p>{runtimeLoading ? "업무 엔진 상태 확인 중" : userFacingRuntimeDetail(runtimeStatus?.detail)}</p>
                <p className="workspace-header__hint">
                  준비도 {snapshot.runtimeReady?.status === "ready" ? "정상" : "확인 중"} · 진행 작업{" "}
                  {snapshot.runtimeMetrics?.jobs.active_count ?? activeWorkJobCount}개 · runner{" "}
                  {snapshot.runtimeMetrics?.runner.active_count ?? 0}개
                </p>
                {(snapshot.runtimeReady?.recovered.work_jobs ?? 0) > 0 ||
                (snapshot.runtimeReady?.recovered.knowledge_ingestion_jobs ?? 0) > 0 ? (
                  <p className="workspace-header__hint">
                    재시작 복구: 작업 {snapshot.runtimeReady?.recovered.work_jobs ?? 0}개 · 지식위키 색인{" "}
                    {snapshot.runtimeReady?.recovered.knowledge_ingestion_jobs ?? 0}개
                  </p>
                ) : null}
                {runtimeStatus?.log_path ? (
                  <p className="workspace-header__hint">업무 엔진 로그 파일 준비됨</p>
                ) : null}
                <div className="runtime-popover__actions">
                  {runtimeStatus?.available && !runtimeStatus.running ? (
                    <button type="button" className="button-secondary" onClick={() => void handleStartSidecar()} disabled={runtimeStarting}>
                      {runtimeStarting ? "시작 중..." : "시작"}
                    </button>
                  ) : null}
                  {unmanagedRuntimeReachable ? (
                    <button type="button" className="button-secondary" onClick={() => void handleRecoverSidecar()} disabled={runtimeLoading}>
                      {runtimeLoading ? "복구 중..." : "복구"}
                    </button>
                  ) : null}
                  {runtimeStatus?.available && runtimeStatus.running && runtimeStatus.managed ? (
                    <button type="button" className="button-secondary" onClick={() => void handleRestartSidecar()} disabled={runtimeStarting}>
                      {runtimeStarting ? "재시작 중..." : "재시작"}
                    </button>
                  ) : null}
                  {runtimeStatus?.available && runtimeStatus.running && runtimeStatus.managed ? (
                    <button type="button" className="button-secondary" onClick={() => void handleStopSidecar()} disabled={runtimeStarting}>
                      {runtimeStarting ? "종료 중..." : "종료"}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>
    );
  }

  return renderTopBar();
}
