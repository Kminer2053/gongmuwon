import type { ReactNode } from "react";

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      <p>{body}</p>
    </div>
  );
}

export function AssetIcon({ src, testId, className }: { src: string; testId?: string; className?: string }) {
  return (
    <img
      className={["asset-icon", className].filter(Boolean).join(" ")}
      src={src}
      alt=""
      aria-hidden="true"
      data-testid={testId}
    />
  );
}

export function SectionCard({
  eyebrow,
  title,
  children,
  actions,
  className,
  testId,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={className ? `panel-card ${className}` : "panel-card"} data-testid={testId}>
      <div className="panel-card__header">
        <div>
          {eyebrow ? <p className="panel-card__eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {actions ? <div className="panel-card__actions">{actions}</div> : null}
      </div>
      <div className="panel-card__body">{children}</div>
    </section>
  );
}

/**
 * J-11+G-01: 업무 엔진 미연결 상태를 알리는 상단 고정 배너.
 * silent 폴링 실패는 토스트 대신 이 배너(store.engineUnreachable)로 유지 표시한다.
 */
export function EngineBanner({
  starting,
  onStart,
  onReconnect,
}: {
  starting?: boolean;
  onStart: () => void;
  onReconnect: () => void;
}) {
  return (
    <div className="engine-banner" role="alert" data-testid="engine-banner">
      <p className="engine-banner__message">업무 엔진에 연결되지 않았습니다</p>
      <div className="engine-banner__actions">
        <button type="button" onClick={onStart} disabled={starting}>
          {starting ? "시작 중..." : "엔진 시작"}
        </button>
        <button type="button" className="button-secondary" onClick={onReconnect}>
          다시 연결
        </button>
      </div>
    </div>
  );
}

/**
 * J-02: LLM 미설정 안내 공용 컴포넌트.
 * 화면에서 store.isLlmConfigured가 false일 때 렌더링한다.
 * onOpenSettings에는 () => setActiveMenu("settings")를 연결한다.
 */
export function LlmSetupNotice({
  message,
  onOpenSettings,
}: {
  message?: string;
  onOpenSettings: () => void;
}) {
  return (
    <div className="llm-setup-notice" role="status" data-testid="llm-setup-notice">
      <p>{message ?? "LLM 연결이 아직 설정되지 않았습니다. 환경설정에서 모델 연결을 먼저 완료해 주세요."}</p>
      <button type="button" className="button-secondary" onClick={onOpenSettings}>
        환경설정으로 이동
      </button>
    </div>
  );
}

export function DetailPanel({
  title,
  fields,
}: {
  title: string;
  fields: Array<{ label: string; value: ReactNode; code?: boolean }>;
}) {
  return (
    <div className="detail-panel">
      <p className="detail-panel__title">{title}</p>
      <dl className="detail-grid">
        {fields.map((field) => (
          <div key={field.label} className="detail-grid__row">
            <dt>{field.label}</dt>
            <dd className={field.code ? "detail-grid__value detail-grid__value--code" : "detail-grid__value"}>
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
