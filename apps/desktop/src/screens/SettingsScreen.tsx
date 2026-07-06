import { useState, type FormEvent } from "react";
import { cloneWorkspaceLlmProfiles, testWorkspaceLlmConnection, updateWorkspaceSettings } from "../api";
import { LLM_PROVIDER_PRESETS, normalizeProviderKey, type LlmProviderKey } from "../llmProviders";
import { AssetIcon, SectionCard } from "../shared/primitives";
import { PROVIDER_OPTION_ORDER, useAppStore } from "../store";
import "../styles/settings-screen.css";

type ProfileCardKey = "local_first" | "internal_server" | `external_model:${string}`;

export function SettingsScreen() {
  const {
    applySettingsFormPatch,
    buildSettingsFormFromProfiles,
    commitSettingsFormToProfiles,
    handleAction,
    openTutorial,
    refreshDeferredSnapshot,
    refreshShellSnapshot,
    runtimeStatus,
    selectedProviderAttributionLabel,
    selectedProviderPreset,
    selectedProviderSupportsAttributionHeaders,
    setNotice,
    setSettingsForm,
    setSettingsProfiles,
    setSnapshot,
    setStartupDiffEnabled,
    settingsForm,
    settingsProfiles,
    snapshot,
    startupDiffEnabled,
    submitting,
  } = useAppStore();

  // F-16: 편집 폼은 카드에서 열리는 접힘 영역. null이면 폼을 닫아둔다.
  const [editingCard, setEditingCard] = useState<ProfileCardKey | null>(null);

  function activeCardKey(): ProfileCardKey {
    if (settingsForm.llm_mode === "external_model") {
      return `external_model:${normalizeProviderKey(settingsForm.llm_provider)}`;
    }
    return settingsForm.llm_mode;
  }

  function openEditorFor(mode: "local_first" | "internal_server" | "external_model", providerKey?: LlmProviderKey) {
    const committedProfiles = commitSettingsFormToProfiles(settingsProfiles, settingsForm);
    const nextProfiles = cloneWorkspaceLlmProfiles(committedProfiles);
    const nextProvider =
      mode === "external_model" ? providerKey ?? nextProfiles.external_model.active_provider : nextProfiles[mode].provider;
    if (mode === "external_model" && providerKey) {
      nextProfiles.external_model.active_provider = providerKey;
    }
    setSettingsProfiles(nextProfiles);
    setSettingsForm(
      buildSettingsFormFromProfiles(nextProfiles, mode, nextProvider, settingsForm.default_template_key),
    );
    setEditingCard(mode === "external_model" ? `external_model:${normalizeProviderKey(nextProvider ?? "openai")}` : mode);
  }

  function applyProviderPreset(providerKey: LlmProviderKey) {
    const committedProfiles = commitSettingsFormToProfiles(settingsProfiles, settingsForm);
    const nextProfiles = cloneWorkspaceLlmProfiles(committedProfiles);
    nextProfiles.external_model.active_provider = providerKey;
    const nextForm = buildSettingsFormFromProfiles(
      nextProfiles,
      "external_model",
      providerKey,
      settingsForm.default_template_key,
    );
    setSettingsProfiles(nextProfiles);
    setSettingsForm(nextForm);
    setEditingCard(`external_model:${providerKey}`);
  }

  function buildSettingsPayload() {
    const nextProfiles = commitSettingsFormToProfiles(settingsProfiles, settingsForm);
    return {
      llm_mode: settingsForm.llm_mode,
      llm_provider: settingsForm.llm_provider.trim() || "openai_compatible",
      llm_model: settingsForm.llm_model.trim() || selectedProviderPreset.defaultModel,
      llm_api_key: settingsForm.llm_api_key.trim() || null,
      llm_site_url: settingsForm.llm_site_url.trim() || null,
      llm_application_name: settingsForm.llm_application_name.trim() || null,
      llm_profiles: nextProfiles,
      default_template_key: settingsForm.default_template_key,
      internal_api_base_url: settingsForm.internal_api_base_url.trim() || null,
      personalization_apply_mode: settingsForm.personalization_apply_mode,
      personalization_root: settingsForm.personalization_root.trim() || null,
    };
  }

  async function persistSettings(successMessage: string) {
    return handleAction(
      async () => {
        const updated = await updateWorkspaceSettings(buildSettingsPayload());
        setSnapshot((current) => ({
          ...current,
          settings: updated,
          logs: current.logs,
        }));
        void refreshShellSnapshot({ silent: true });
        void refreshDeferredSnapshot("logs");
        return updated;
      },
      successMessage,
      { revealSection: "logs", refresh: "none" },
    );
  }

  async function submitSettingsUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persistSettings("환경설정을 저장했습니다.");
  }

  /**
   * F-16: 카드의 [이 프로필 사용] — 해당 mode/provider로 즉시 전환하고 저장한다.
   */
  async function useProfileNow(mode: "local_first" | "internal_server" | "external_model", providerKey?: string) {
    const committedProfiles = commitSettingsFormToProfiles(settingsProfiles, settingsForm);
    const nextProfiles = cloneWorkspaceLlmProfiles(committedProfiles);
    const nextProvider = mode === "external_model" ? providerKey ?? nextProfiles.external_model.active_provider : undefined;
    if (mode === "external_model" && nextProvider) {
      nextProfiles.external_model.active_provider = nextProvider;
    }
    const nextForm = buildSettingsFormFromProfiles(nextProfiles, mode, nextProvider, settingsForm.default_template_key);
    setSettingsProfiles(nextProfiles);
    setSettingsForm(nextForm);
    setEditingCard(null);
    await handleAction(
      async () => {
        const updated = await updateWorkspaceSettings({
          llm_mode: nextForm.llm_mode,
          llm_provider: nextForm.llm_provider.trim() || "openai_compatible",
          llm_model: nextForm.llm_model.trim() || selectedProviderPreset.defaultModel,
          llm_api_key: nextForm.llm_api_key.trim() || null,
          llm_site_url: nextForm.llm_site_url.trim() || null,
          llm_application_name: nextForm.llm_application_name.trim() || null,
          llm_profiles: nextProfiles,
          default_template_key: nextForm.default_template_key,
          internal_api_base_url: nextForm.internal_api_base_url.trim() || null,
          personalization_apply_mode: nextForm.personalization_apply_mode,
          personalization_root: nextForm.personalization_root.trim() || null,
        });
        setSnapshot((current) => ({
          ...current,
          settings: updated,
          logs: current.logs,
        }));
        void refreshShellSnapshot({ silent: true });
        void refreshDeferredSnapshot("logs");
        return updated;
      },
      "선택한 프로필을 활성화했습니다.",
      { revealSection: "logs", refresh: "none" },
    );
  }

  /**
   * J-13: [저장 후 연결 테스트]는 클릭 즉시 현재 입력값을 저장한 뒤 테스트한다.
   * dry-run 경로는 서버가 지원하지 않으므로, 몰래 저장하지 않고 라벨/title로 정직하게 고지한다.
   */
  async function runLlmConnectionTest() {
    await handleAction(
      async () => {
        const updated = await updateWorkspaceSettings(buildSettingsPayload());
        setSnapshot((current) => ({
          ...current,
          settings: updated,
          logs: current.logs,
        }));
        const result = await testWorkspaceLlmConnection();
        await refreshShellSnapshot({ silent: true });
        void refreshDeferredSnapshot("logs");
        if (result.status === "failed") {
          throw new Error(result.text);
        }
        setNotice(`LLM 연결 테스트 성공: ${result.provider} / ${result.model}`);
        return result;
      },
      "LLM 연결 테스트가 완료되었습니다.",
      { revealSection: "logs", refresh: "none" },
    );
  }

  function providerLabel(providerValue: string) {
    return LLM_PROVIDER_PRESETS[normalizeProviderKey(providerValue) as LlmProviderKey]?.label ?? providerValue;
  }

  function renderEditForm() {
    return (
      <form className="stack-form settings-edit-form" onSubmit={submitSettingsUpdate}>
        <div className="grid-2">
          <label className="select-field">
            LLM 정책
            <select
              value={settingsForm.llm_mode}
              onChange={(event) => {
                const nextMode = event.target.value as "local_first" | "internal_server" | "external_model";
                const committedProfiles = commitSettingsFormToProfiles(settingsProfiles, settingsForm);
                const nextProfiles = cloneWorkspaceLlmProfiles(committedProfiles);
                const nextProvider =
                  nextMode === "external_model"
                    ? nextProfiles.external_model.active_provider
                    : nextProfiles[nextMode].provider;
                setSettingsProfiles(nextProfiles);
                setSettingsForm(
                  buildSettingsFormFromProfiles(
                    nextProfiles,
                    nextMode,
                    nextProvider,
                    settingsForm.default_template_key,
                  ),
                );
                setEditingCard(
                  nextMode === "external_model"
                    ? `external_model:${normalizeProviderKey(nextProvider ?? "openai")}`
                    : nextMode,
                );
              }}
            >
              <option value="local_first">로컬 우선</option>
              <option value="internal_server">내부 서버</option>
              <option value="external_model">외부 모델</option>
            </select>
          </label>
          <label className="select-field">
            {settingsForm.llm_mode === "external_model" ? "외부 모델 공급자" : "연결 공급자 preset"}
            <select
              value={normalizeProviderKey(settingsForm.llm_provider)}
              onChange={(event) => applyProviderPreset(event.target.value as LlmProviderKey)}
            >
              {PROVIDER_OPTION_ORDER.filter((providerKey) =>
                settingsForm.llm_mode === "external_model" ? providerKey !== "custom_openai" : providerKey === "custom_openai",
              ).map((providerKey) => (
                <option key={providerKey} value={providerKey}>
                  {LLM_PROVIDER_PRESETS[providerKey].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            LLM Model
            <input
              value={settingsForm.llm_model}
              onChange={(event) => applySettingsFormPatch({ llm_model: event.target.value })}
              placeholder={selectedProviderPreset.modelPlaceholder}
            />
          </label>
          <label>
            {selectedProviderPreset.apiKeyLabel}
            <input
              type="password"
              value={settingsForm.llm_api_key}
              onChange={(event) => applySettingsFormPatch({ llm_api_key: event.target.value })}
              placeholder={selectedProviderPreset.apiKeyPlaceholder}
            />
          </label>
        </div>
        <div className="detail-panel">
          <p className="detail-panel__title">연결 preset 요약</p>
          <dl className="detail-grid">
            <div className="detail-grid__row">
              <dt>공급자</dt>
              <dd className="detail-grid__value">{selectedProviderPreset.label}</dd>
            </div>
            <div className="detail-grid__row">
              <dt>권장 Base URL</dt>
              <dd className="detail-grid__value detail-grid__value--code">{selectedProviderPreset.defaultBaseUrl}</dd>
            </div>
            <div className="detail-grid__row">
              <dt>모델 예시</dt>
              <dd className="detail-grid__value detail-grid__value--code">{selectedProviderPreset.defaultModel}</dd>
            </div>
            <div className="detail-grid__row">
              <dt>가이드</dt>
              <dd className="detail-grid__value">
                <a href={selectedProviderPreset.docsUrl} target="_blank" rel="noreferrer">
                  공식 연결 가이드
                </a>
              </dd>
            </div>
          </dl>
          <ul className="helper-copy helper-copy--compact">
            {selectedProviderPreset.helperLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <label>
          모델 API Base URL
          <input
            value={settingsForm.internal_api_base_url}
            onChange={(event) => applySettingsFormPatch({ internal_api_base_url: event.target.value })}
            placeholder={selectedProviderPreset.defaultBaseUrl}
          />
        </label>
        {selectedProviderSupportsAttributionHeaders ? (
          <div className="grid-2">
            <label>
              {selectedProviderAttributionLabel} 사이트 URL (선택)
              <input
                value={settingsForm.llm_site_url}
                onChange={(event) => applySettingsFormPatch({ llm_site_url: event.target.value })}
                placeholder="https://example.com"
              />
            </label>
            <label>
              {selectedProviderAttributionLabel} 앱 이름 (선택)
              <input
                value={settingsForm.llm_application_name}
                onChange={(event) => applySettingsFormPatch({ llm_application_name: event.target.value })}
                placeholder="Gongmu Workspace"
              />
            </label>
          </div>
        ) : null}
        <div className="toolbar">
          <button type="submit" className="button-with-icon" disabled={submitting}>
            <AssetIcon src="/icons/action/check-inverse.svg" />
            설정 저장
          </button>
          <button
            type="button"
            className="button-secondary button-with-icon"
            onClick={() => void runLlmConnectionTest()}
            disabled={submitting}
            title="현재 입력값을 먼저 저장한 뒤 LLM 응답을 테스트합니다. 확인 없이 바로 저장됩니다."
          >
            <AssetIcon src="/icons/action/play.svg" />
            저장 후 연결 테스트
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => setEditingCard(null)}
            disabled={submitting}
          >
            편집 닫기
          </button>
        </div>
      </form>
    );
  }

  function renderProfileCard(options: {
    key: ProfileCardKey;
    title: string;
    providerLabelText: string;
    modelText: string;
    baseUrlText: string;
    apiKeyText?: string;
    isActive: boolean;
    onUse: () => void;
    onEdit: () => void;
  }) {
    const { key, title, providerLabelText, modelText, baseUrlText, apiKeyText, isActive, onUse, onEdit } = options;
    const isEditing = editingCard === key;
    return (
      <article key={key} className={`settings-profile-card ${isActive ? "is-active" : ""}`}>
        <div className="settings-profile-card__header">
          <strong>{title}</strong>
          {isActive ? <span className="pill pill--soft">사용 중</span> : null}
        </div>
        <p>{providerLabelText}</p>
        <p className="detail-grid__value--code">{modelText || "미설정"}</p>
        <p className="subtle-text">{baseUrlText || "Base URL 미설정"}</p>
        {apiKeyText ? <p className="subtle-text">{apiKeyText}</p> : null}
        <div className="settings-profile-card__actions">
          <button
            type="button"
            className="button-secondary"
            onClick={onUse}
            disabled={submitting || isActive}
            title={isActive ? "이미 사용 중인 프로필입니다" : "이 프로필로 즉시 전환하고 저장합니다"}
          >
            {isActive ? "사용 중" : "이 프로필 사용"}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={onEdit}
            aria-pressed={isEditing}
          >
            수정
          </button>
        </div>
      </article>
    );
  }

  function renderModelConnectionSection() {
    const externalProviders = Object.entries(settingsProfiles.external_model.providers);
    const activeExternalProviderKey = normalizeProviderKey(
      snapshot.settings?.defaults.llm_mode === "external_model"
        ? snapshot.settings.defaults.llm_provider ?? settingsProfiles.external_model.active_provider
        : settingsProfiles.external_model.active_provider,
    );
    const active = activeCardKey();

    return (
      <div data-testid="saved-llm-profiles">
        <div className="settings-section-heading">
          <p className="detail-panel__title">모델 연결</p>
          <button
            type="button"
            className="button-secondary button-with-icon"
            onClick={() => openEditorFor("external_model")}
          >
            <AssetIcon src="/icons/action/plus.svg" />
            새 프로필
          </button>
        </div>
        <div className="settings-profile-list">
          {renderProfileCard({
            key: "local_first",
            title: "로컬 우선",
            providerLabelText: providerLabel(settingsProfiles.local_first.provider),
            modelText: settingsProfiles.local_first.model,
            baseUrlText: settingsProfiles.local_first.base_url ?? "",
            isActive: active === "local_first",
            onUse: () => void useProfileNow("local_first"),
            onEdit: () => openEditorFor("local_first"),
          })}
          {renderProfileCard({
            key: "internal_server",
            title: "내부 서버",
            providerLabelText: providerLabel(settingsProfiles.internal_server.provider),
            modelText: settingsProfiles.internal_server.model,
            baseUrlText: settingsProfiles.internal_server.base_url ?? "",
            isActive: active === "internal_server",
            onUse: () => void useProfileNow("internal_server"),
            onEdit: () => openEditorFor("internal_server"),
          })}
          {externalProviders.map(([providerKey, profile]) => {
            const cardKey: ProfileCardKey = `external_model:${providerKey}`;
            return renderProfileCard({
              key: cardKey,
              title: providerLabel(profile.provider),
              providerLabelText: activeExternalProviderKey === providerKey ? "외부 모델 · 활성 공급자" : "외부 모델",
              modelText: profile.model,
              baseUrlText: profile.base_url ?? "",
              apiKeyText: profile.api_key ? "API Key 저장됨" : "API Key 미설정",
              isActive: active === cardKey,
              onUse: () => void useProfileNow("external_model", providerKey),
              onEdit: () => openEditorFor("external_model", providerKey as LlmProviderKey),
            });
          })}
        </div>
        {editingCard ? renderEditForm() : null}
      </div>
    );
  }

  function renderPersonalizationSection() {
    return (
      <div className="settings-personalization">
        <p className="detail-panel__title">개인화</p>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            void persistSettings("환경설정을 저장했습니다.");
          }}
        >
          <div className="grid-2">
            <label>
              개인화 학습 저장폴더
              <input
                value={settingsForm.personalization_root}
                onChange={(event) => applySettingsFormPatch({ personalization_root: event.target.value })}
                placeholder="runtime-workspace/personalization"
              />
            </label>
            <label className="select-field">
              학습 후보 반영 방식
              <select
                value={settingsForm.personalization_apply_mode}
                onChange={(event) =>
                  applySettingsFormPatch({
                    personalization_apply_mode: event.target.value as "approval_required" | "auto_apply",
                  })
                }
              >
                <option value="approval_required">승인 후 반영</option>
                <option value="auto_apply">낮은 위험 항목 자동 반영</option>
              </select>
            </label>
          </div>
          <div className="toolbar">
            <button type="submit" className="button-with-icon" disabled={submitting}>
              <AssetIcon src="/icons/action/check-inverse.svg" />
              설정 저장
            </button>
          </div>
        </form>
      </div>
    );
  }

  /**
   * W7 P3 §9(승인값: 감지·배지 자동 on, 색인 자동 실행 off):
   * 앱 시작 시 지식폴더 변경 감지(1회 diff) 토글 — localStorage에 유지된다.
   */
  function renderKnowledgeStartupSection() {
    return (
      <div className="settings-knowledge-startup">
        <p className="detail-panel__title">지식폴더</p>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            data-testid="settings-startup-diff-toggle"
            checked={startupDiffEnabled}
            onChange={(event) => setStartupDiffEnabled(event.target.checked)}
          />
          시작 시 지식폴더 변경 감지
        </label>
        <p className="subtle-text">
          앱 시작 뒤 잠시 기다렸다가 지식폴더의 변경 여부를 1회 확인해, 내 지식폴더 대시보드에
          &ldquo;미반영 변경&rdquo; 건수로 알려 줍니다. 색인은 자동으로 실행하지 않습니다.
        </p>
      </div>
    );
  }

  // W6: 최초 실행 튜토리얼 재실행 진입점.
  function renderTutorialReplaySection() {
    return (
      <div className="settings-tutorial-replay">
        <p className="detail-panel__title">시작 안내</p>
        <p className="subtle-text">
          첫 실행 때 보여 준 LLM 연결·내 지식폴더 준비 안내를 다시 볼 수 있습니다.
        </p>
        <button
          type="button"
          className="button-secondary"
          data-testid="settings-tutorial-replay"
          onClick={openTutorial}
          title="첫 실행 튜토리얼을 처음 단계부터 다시 엽니다"
        >
          튜토리얼 다시 보기
        </button>
      </div>
    );
  }

  function renderSystemInfoSection() {
    return (
      <details className="knowledge-detail-section settings-system-info">
        <summary>시스템 정보</summary>
        <div className="settings-grid">
          <div>
            <p className="settings-grid__label">워크스페이스 루트</p>
            <p>{snapshot.settings?.paths.workspace_root ?? snapshot.health?.workspace_root ?? "업무 엔진 연결 필요"}</p>
          </div>
          <div>
            <p className="settings-grid__label">SQLite</p>
            <p>{snapshot.settings?.paths.database ?? snapshot.health?.database ?? "-"}</p>
          </div>
          <div>
            <p className="settings-grid__label">지식 정본</p>
            <p>{snapshot.settings?.paths.knowledge_root ?? "Obsidian-compatible Markdown Vault"}</p>
          </div>
          <div>
            <p className="settings-grid__label">문서 루트</p>
            <p>{snapshot.settings?.paths.documents_root ?? "-"}</p>
          </div>
          <div>
            <p className="settings-grid__label">개인화 학습 저장소</p>
            <p>{snapshot.settings?.paths.personalization_root ?? "runtime-workspace/personalization"}</p>
          </div>
          <div>
            <p className="settings-grid__label">학습 반영 방식</p>
            <p>
              {snapshot.settings?.defaults.personalization_apply_mode === "auto_apply"
                ? "낮은 위험 항목 자동 반영"
                : "승인 후 반영"}
            </p>
          </div>
          <div>
            <p className="settings-grid__label">모델 공급자</p>
            <p>{LLM_PROVIDER_PRESETS[normalizeProviderKey(snapshot.settings?.defaults.llm_provider ?? "openai_compatible")].label}</p>
          </div>
          <div>
            <p className="settings-grid__label">모델명</p>
            <p>{snapshot.settings?.defaults.llm_model ?? "gpt-4.1-mini"}</p>
          </div>
          <div>
            <p className="settings-grid__label">API Key</p>
            <p>{snapshot.settings?.defaults.llm_api_key ? "저장됨" : "미설정"}</p>
          </div>
          <div>
            <p className="settings-grid__label">기본 접속 URL</p>
            <p>{snapshot.settings?.defaults.internal_api_base_url ?? selectedProviderPreset.defaultBaseUrl}</p>
          </div>
          <div>
            <p className="settings-grid__label">OpenRouter 부가 헤더</p>
            <p>
              {snapshot.settings?.defaults.llm_site_url || snapshot.settings?.defaults.llm_application_name
                ? [snapshot.settings?.defaults.llm_site_url, snapshot.settings?.defaults.llm_application_name]
                    .filter(Boolean)
                    .join(" / ")
                : "미설정"}
            </p>
          </div>
          <div>
            <p className="settings-grid__label">런타임 모드</p>
            <p>{runtimeStatus?.mode ?? "-"}</p>
          </div>
          <div>
            <p className="settings-grid__label">업무 엔진 URL</p>
            <p>{runtimeStatus?.sidecar_url ?? "http://127.0.0.1:8765"}</p>
          </div>
          <div>
            <p className="settings-grid__label">업무 엔진 로그</p>
            <p>{runtimeStatus?.log_path ? "로그 파일 준비됨" : "-"}</p>
          </div>
          <div>
            <p className="settings-grid__label">런타임 관리</p>
            <p>{runtimeStatus?.managed ? "앱이 관리 중" : "외부 또는 미연결"}</p>
          </div>
        </div>
      </details>
    );
  }

  function renderSettingsSection() {
    return (
      <SectionCard eyebrow="로컬 우선 설정" title="환경설정">
        <div className="helper-copy">
          <p>저장된 프로필 카드에서 바로 전환하거나, 필요한 프로필을 새로 만들어 저장할 수 있습니다.</p>
          <p>LLM 정책과 외부 또는 내부 모델 연결값을 바꾸면 이후 업무대화 워크플로에 바로 반영됩니다.</p>
        </div>
        {renderModelConnectionSection()}
        <div className="settings-section-divider" />
        {renderPersonalizationSection()}
        <div className="settings-section-divider" />
        {renderKnowledgeStartupSection()}
        <div className="settings-section-divider" />
        {renderTutorialReplaySection()}
        <div className="settings-section-divider" />
        {renderSystemInfoSection()}
      </SectionCard>
    );
  }

  return renderSettingsSection();
}
