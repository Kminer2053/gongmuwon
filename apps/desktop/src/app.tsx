import { type CSSProperties } from "react";
import { X } from "lucide-react";
import { renderMarkdownContent } from "./shared/markdown";
import { EngineBanner } from "./shared/primitives";
import { AppStoreProvider, useAppStoreValue } from "./store";
import { FirstRunTutorial } from "./components/FirstRunTutorial";
import { ContextPane } from "./layout/ContextPane";
import { SessionRail } from "./layout/SessionRail";
import { TopBar } from "./layout/TopBar";
import { ChatScreen } from "./screens/ChatScreen";
import { DocumentsScreen } from "./screens/DocumentsScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { ScheduleScreen } from "./screens/ScheduleScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { KnowledgeScreen } from "./screens/KnowledgeScreen";
import { LogsScreen } from "./screens/LogsScreen";

export { renderMarkdownContent };

export function App() {
  const store = useAppStoreValue();
  const {
    activeMenu,
    loading,
    contextPaneOpen,
    contextPaneWidth,
    engineUnreachable,
    handleRecoverSidecar,
    handleStartSidecar,
    refreshShellSnapshot,
    runtimeStarting,
    runtimeStatus,
    snapshot,
    uiFontScale,
    toastItems,
    removeToast,
  } = store;

  // J-11: 엔진 미연결 판단 — 헬스 스냅샷이 없거나, silent 폴링이 실패했거나,
  // 관리형 런타임이 실행 중이 아닌 경우.
  const engineOffline =
    engineUnreachable ||
    snapshot.health === null ||
    (runtimeStatus?.available === true && !runtimeStatus.running);

  function renderMainPanel() {
    switch (activeMenu) {
      case "home":
        return <HomeScreen />;
      case "schedule":
        return <ScheduleScreen />;
      case "chat":
        return <ChatScreen />;
      case "documents":
        return <DocumentsScreen />;
      case "knowledge":
        return <KnowledgeScreen />;
      case "logs":
        return <LogsScreen />;
      case "settings":
        return <SettingsScreen />;
      default:
        return null;
    }
  }

  return (
    <AppStoreProvider value={store}>
    <div
      className={`workspace-shell ${contextPaneOpen ? "" : "workspace-shell--context-collapsed"}`.trim()}
      style={
        {
          "--ui-font-scale": uiFontScale,
          "--context-pane-width": `${contextPaneWidth}px`,
        } as CSSProperties
      }
    >
      <TopBar />
      <SessionRail />

      <main className="main-pane">
        {!loading && engineOffline ? (
          <EngineBanner
            starting={runtimeStarting}
            onStart={() => void handleStartSidecar()}
            onReconnect={() => {
              void handleRecoverSidecar();
              void refreshShellSnapshot({ silent: true });
            }}
          />
        ) : null}
        <div className={`main-pane__scroll ${activeMenu === "chat" ? "main-pane__scroll--chat" : ""}`.trim()}>
          {loading ? <div className="loading-panel">워크스페이스를 불러오는 중입니다...</div> : renderMainPanel()}
        </div>
      </main>

      <ContextPane />
      <FirstRunTutorial />
      {toastItems.length ? (
        <div className="toast-stack" data-testid="toast-stack" aria-live="polite">
          {toastItems.map((toast) => (
            <div
              key={toast.id}
              className={`toast toast--${toast.tone}`}
              role={toast.tone === "error" ? "alert" : "status"}
            >
              <p>{toast.message}</p>
              <button type="button" className="toast__close" aria-label="알림 닫기" onClick={() => removeToast(toast.id)}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
    </AppStoreProvider>
  );
}
