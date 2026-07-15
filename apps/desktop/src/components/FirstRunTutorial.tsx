import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { APP_TIPS, dailyTipIndex } from "../shared/tips";
import { MENU_ITEMS, useAppStore } from "../store";
import "../styles/tutorial.css";

/**
 * W6: 최초 실행 튜토리얼.
 *
 * - 발동: localStorage 플래그(gongmu.tutorial.done)가 없으면 앱 로드 후 1회 (store가 판단).
 * - 종료: [건너뛰기]/[시작하기] 시 플래그 저장 — 이후 자동 실행 없음.
 * - 재실행: 환경설정 > [튜토리얼 다시 보기].
 * - "~로 이동" 버튼은 해당 화면으로 이동하면서 그 단계를 완료 처리하고
 *   튜토리얼을 최소화 칩으로 접어 둔다(칩 클릭 시 다음 단계부터 복귀).
 * - API 키 입력은 절대 대행하지 않는다 — 사용자가 직접 입력하도록 안내만 한다.
 */

const TUTORIAL_STEPS = ["환영", "LLM 연결", "내 지식폴더", "마무리"] as const;

// 단계별 안내 일러스트 (public/illustrations — 폐쇄망용 로컬 SVG, 캡션 내장)
const TUTORIAL_ILLUSTRATIONS = [
  "/illustrations/tutorial-welcome.svg",
  "/illustrations/tutorial-llm.svg",
  "/illustrations/tutorial-knowledge.svg",
  "/illustrations/tutorial-done.svg",
] as const;

const LLM_MODE_LABELS: Record<string, string> = {
  local_first: "로컬 우선",
  internal_server: "내부 서버",
  external_model: "외부 모델",
};

export function FirstRunTutorial() {
  const {
    completeTutorial,
    deferredLoadState,
    isLlmConfigured,
    refreshDeferredSnapshot,
    setActiveMenu,
    setKnowledgePanel,
    snapshot,
    tutorialOpen,
  } = useAppStore();

  const [step, setStep] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);

  // 열릴 때마다 1단계부터 시작한다 (환경설정 재실행 포함).
  useEffect(() => {
    if (tutorialOpen && !wasOpenRef.current) {
      setStep(0);
      setMinimized(false);
    }
    wasOpenRef.current = tutorialOpen;
  }, [tutorialOpen]);

  // 3단계(지식폴더 유무 표시)를 위해 지연 로드 그룹을 미리 불러온다.
  useEffect(() => {
    if (tutorialOpen && deferredLoadState.knowledge === "idle") {
      void refreshDeferredSnapshot("knowledge");
    }
  }, [tutorialOpen, deferredLoadState.knowledge]);

  useEffect(() => {
    if (tutorialOpen && !minimized) {
      dialogRef.current?.focus();
    }
  }, [tutorialOpen, minimized]);

  if (!tutorialOpen) {
    return null;
  }

  if (minimized) {
    return (
      <button
        type="button"
        className="tutorial-minimized-chip"
        data-testid="tutorial-minimized-chip"
        onClick={() => setMinimized(false)}
        aria-label={`튜토리얼 계속하기 — ${step + 1}/${TUTORIAL_STEPS.length} 단계`}
        title="접어 둔 튜토리얼을 이어서 봅니다"
      >
        튜토리얼 계속하기 ({step + 1}/{TUTORIAL_STEPS.length})
      </button>
    );
  }

  const llmDefaults = snapshot.settings?.defaults ?? null;
  const llmModeLabel = llmDefaults ? LLM_MODE_LABELS[llmDefaults.llm_mode] ?? llmDefaults.llm_mode : "확인 중";
  const knowledgeSources = snapshot.knowledgeSources;
  const finishTip = APP_TIPS[dailyTipIndex(APP_TIPS.length)];
  const isLastStep = step === TUTORIAL_STEPS.length - 1;

  function goNext() {
    setStep((current) => Math.min(current + 1, TUTORIAL_STEPS.length - 1));
  }

  function goPrev() {
    setStep((current) => Math.max(current - 1, 0));
  }

  /** "~로 이동" — 해당 스텝을 완료 처리하고 최소화 칩으로 접은 뒤 이동한다. */
  function navigateAndMinimize(navigate: () => void) {
    navigate();
    setStep((current) => Math.min(current + 1, TUTORIAL_STEPS.length - 1));
    setMinimized(true);
  }

  // 기존 모달 패턴(role=dialog + aria-modal + Esc)에 Tab 순환 포커스 트랩을 더한다.
  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      // Esc는 실수로 영영 닫히지 않도록 파기 대신 최소화한다.
      setMinimized(true);
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function renderWelcomeStep() {
    return (
      <div className="tutorial-step-body">
        <p>
          &lsquo;공무원&rsquo;은 공공분야 사무업무자를 위한 로컬 우선 AI 워크스페이스입니다. 업무대화로 요청하고, 문서로 만들고,
          내 지식폴더에 쌓는 흐름을 한 곳에서 처리합니다.
        </p>
        <ul className="tutorial-menu-list">
          {MENU_ITEMS.map((item) => (
            <li key={item.key}>
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </li>
          ))}
        </ul>
        <p className="subtle-text">다음 두 단계에서 LLM 연결과 내 지식폴더만 준비하면 바로 쓸 수 있습니다.</p>
      </div>
    );
  }

  function renderLlmStep() {
    return (
      <div className="tutorial-step-body">
        <p>업무대화·문서작성은 LLM 연결이 있어야 동작합니다. 현재 설정 상태입니다.</p>
        <dl className="tutorial-status" data-testid="tutorial-llm-status">
          <div>
            <dt>LLM 정책</dt>
            <dd>{llmModeLabel}</dd>
          </div>
          <div>
            <dt>공급자 / 모델</dt>
            <dd>
              {llmDefaults
                ? `${llmDefaults.llm_provider ?? "미설정"} / ${llmDefaults.llm_model ?? "미설정"}`
                : "업무 엔진 연결 후 확인됩니다"}
            </dd>
          </div>
          <div>
            <dt>연결 상태</dt>
            <dd>
              {isLlmConfigured ? (
                <span className="pill pill--soft">설정 완료</span>
              ) : (
                <span className="pill tutorial-pill--warning">설정 필요</span>
              )}
            </dd>
          </div>
        </dl>
        {isLlmConfigured ? (
          <p className="subtle-text">이미 사용할 수 있는 연결이 있습니다. 환경설정에서 언제든 다른 프로필로 바꿀 수 있습니다.</p>
        ) : (
          <>
            <p>
              환경설정의 모델 연결 카드에서 로컬 모델(Ollama 등) 또는 외부 모델을 선택해 주세요. 외부 모델의{" "}
              <strong>API 키는 보안을 위해 사용자가 직접 입력</strong>합니다 — 앱이 키 입력을 대신하지 않습니다.
            </p>
            <button
              type="button"
              className="button-with-icon"
              data-testid="tutorial-goto-settings"
              onClick={() => navigateAndMinimize(() => setActiveMenu("settings"))}
            >
              환경설정으로 이동
            </button>
            <p className="subtle-text">이동하면 튜토리얼은 오른쪽 아래 칩으로 접혀 기다립니다.</p>
          </>
        )}
      </div>
    );
  }

  function renderKnowledgeStep() {
    return (
      <div className="tutorial-step-body">
        <p>내 지식폴더에 업무 폴더를 등록하면 지식위키 색인과 상세검색을 쓸 수 있습니다.</p>
        <div className="tutorial-status" data-testid="tutorial-knowledge-status">
          {knowledgeSources.length > 0 ? (
            <p>
              등록된 지식폴더 <strong>{knowledgeSources.length}개</strong> —{" "}
              {knowledgeSources
                .slice(0, 3)
                .map((source) => source.label)
                .join(", ")}
              {knowledgeSources.length > 3 ? " 외" : ""}
            </p>
          ) : (
            <p>아직 등록된 지식폴더가 없습니다.</p>
          )}
        </div>
        {knowledgeSources.length === 0 ? (
          <button
            type="button"
            className="button-with-icon"
            data-testid="tutorial-goto-knowledge"
            onClick={() =>
              navigateAndMinimize(() => {
                setActiveMenu("knowledge");
                setKnowledgePanel("indexing");
              })
            }
          >
            지식폴더 설정으로 이동
          </button>
        ) : null}
        <p className="subtle-text">
          폴더를 등록하면 분류체계 마법사가 폴더 구조를 분석해 업무 분류 트리를 제안해 줍니다.
        </p>
      </div>
    );
  }

  function renderFinishStep() {
    return (
      <div className="tutorial-step-body">
        <p>
          준비 끝입니다. 홈 화면의 <strong>앱 이용팁 카드</strong>와 업무대화 입력창 안내가 이어서 사용법을
          알려줍니다. 예를 들면 이런 팁입니다.
        </p>
        <blockquote className="tutorial-tip-quote" data-testid="tutorial-tip-quote">
          {finishTip?.text}
        </blockquote>
        <p className="subtle-text">튜토리얼은 환경설정의 [튜토리얼 다시 보기]로 언제든 다시 볼 수 있습니다.</p>
      </div>
    );
  }

  const stepBodies = [renderWelcomeStep, renderLlmStep, renderKnowledgeStep, renderFinishStep] as const;
  const stepTitles = [
    "'공무원' 워크스페이스에 오신 것을 환영합니다",
    "LLM 연결을 확인하세요",
    "내 지식폴더를 준비하세요",
    "이제 시작할 준비가 됐습니다",
  ] as const;

  return (
    <div className="tutorial-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="tutorial-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="첫 실행 튜토리얼"
        data-testid="first-run-tutorial"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="tutorial-dialog__header">
          <span className="eyebrow">처음 시작 안내</span>
          <h2>{stepTitles[step]}</h2>
        </header>

        <ol className="tutorial-steps" aria-label="튜토리얼 단계">
          {TUTORIAL_STEPS.map((label, index) => (
            <li key={label} className={step === index ? "is-active" : step > index ? "is-complete" : ""}>
              <span aria-hidden="true">{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        <img
          className="tutorial-illustration"
          src={TUTORIAL_ILLUSTRATIONS[step]}
          alt=""
          aria-hidden="true"
          data-testid="tutorial-illustration"
        />

        {stepBodies[step]!()}

        <footer className="tutorial-dialog__footer">
          <button
            type="button"
            className="button-secondary"
            data-testid="tutorial-skip"
            onClick={completeTutorial}
            title="튜토리얼을 마치고 다시 자동으로 띄우지 않습니다"
          >
            건너뛰기
          </button>
          <div className="tutorial-dialog__nav">
            {step > 0 ? (
              <button type="button" className="button-secondary" data-testid="tutorial-prev" onClick={goPrev}>
                이전
              </button>
            ) : null}
            {isLastStep ? (
              <button type="button" data-testid="tutorial-finish" onClick={completeTutorial}>
                시작하기
              </button>
            ) : (
              <button type="button" data-testid="tutorial-next" onClick={goNext}>
                다음
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
