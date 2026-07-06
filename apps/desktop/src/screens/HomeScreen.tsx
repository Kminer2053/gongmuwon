import { useEffect, useMemo, useState } from "react";
import {
  BookMarked,
  BotMessageSquare,
  CalendarDays,
  CheckCircle2,
  Circle,
  Compass,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import {
  fetchWikiTree,
  searchKnowledge,
  type ScheduleItem,
  type WikiTreeResult,
  type WorkSessionItem,
} from "../api";
import { formatDateTime } from "../shared/format";
import { APP_TIPS, dailyTipIndex, tipIllustration } from "../shared/tips";
import { MENU_ITEMS, useAppStore, type MenuKey } from "../store";
import "../styles/home-screen.css";

/**
 * D-06: 다가오는 일정 필터 — ContextPane(가까운 일정)과 동일한 미래 판정을
 * 로컬로 구현한다: 종료(없으면 시작) 시각이 아직 지나지 않았고,
 * 시작 시각이 지금부터 24시간 안인 일정만 남긴다.
 */
export function upcomingSchedulesWithin24h(schedules: ScheduleItem[], now = Date.now()) {
  const horizon = now + 24 * 60 * 60 * 1000;
  return [...schedules]
    .filter((schedule) => {
      const boundary = new Date(schedule.ends_at || schedule.starts_at).getTime();
      const startsAt = new Date(schedule.starts_at).getTime();
      if (Number.isNaN(boundary) || Number.isNaN(startsAt)) {
        return false;
      }
      return boundary >= now && startsAt <= horizon;
    })
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
}

const HOOK_SNOOZE_STORAGE_KEY = "gongmu.home.feature-hook.snoozed-on";

function todayKey(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readHookSnoozedToday() {
  try {
    return window.localStorage.getItem(HOOK_SNOOZE_STORAGE_KEY) === todayKey();
  } catch {
    return false;
  }
}

type FeatureHook = {
  feature: string;
  title: string;
  body: string;
  menu: MenuKey;
  ctaLabel: string;
};

// snapshot.logs의 feature 값과 비교해 아직 써 보지 않은 기능 1개를 고른다.
const FEATURE_HOOKS: FeatureHook[] = [
  {
    feature: "knowledge",
    title: "대화를 지식으로 축적해 보세요",
    body: "지식폴더를 등록해 색인하면 업무대화와 문서작성이 내 자료를 근거로 답합니다.",
    menu: "knowledge",
    ctaLabel: "내 지식폴더 열기",
  },
  {
    feature: "documents",
    title: "작성 콘텐츠로 문서 초안을 만들어 보세요",
    body: "세션 대화나 파일을 바탕으로 보고서·회의자료 초안을 자동으로 구성합니다.",
    menu: "documents",
    ctaLabel: "문서작성 열기",
  },
  {
    feature: "schedule",
    title: "일정을 등록해 업무 흐름을 연결해 보세요",
    body: "일정에 세션을 연결하면 알림과 브리핑이 해당 업무를 중심으로 정리됩니다.",
    menu: "schedule",
    ctaLabel: "일정 열기",
  },
];

function latestSessionSortKey(session: WorkSessionItem) {
  const messageTimes = (session.messages ?? []).map((message) => new Date(message.created_at).getTime());
  const base = new Date(session.created_at).getTime();
  return Math.max(Number.isNaN(base) ? 0 : base, ...messageTimes.filter((time) => !Number.isNaN(time)), 0);
}

export function HomeScreen() {
  const {
    deferredLoadState,
    isLlmConfigured,
    latestSessionPreview,
    pendingApprovals,
    refreshDeferredSnapshot,
    revealContextSection,
    setActiveMenu,
    setDocumentForm,
    setDocumentSourceMode,
    setDocumentSourceSessionId,
    setSelectedScheduleId,
    setSelectedSessionId,
    snapshot,
  } = useAppStore();

  const [wikiTree, setWikiTree] = useState<WikiTreeResult | null>(null);
  const [wikiTreeLoaded, setWikiTreeLoaded] = useState(false);
  const [suggestionHitCount, setSuggestionHitCount] = useState(0);
  const [suggestionScheduleId, setSuggestionScheduleId] = useState("");
  const [hookSnoozedToday, setHookSnoozedToday] = useState(readHookSnoozedToday);
  // W6: 앱 이용팁 — 날짜 기반 결정적 회전 + [다음 팁]으로 수동 이동.
  const [tipOffset, setTipOffset] = useState(0);

  // 홈은 지식/실행기록 요약을 함께 보여주므로 지연 그룹을 미리 불러온다.
  useEffect(() => {
    if (deferredLoadState.knowledge === "idle") {
      void refreshDeferredSnapshot("knowledge");
    }
    if (deferredLoadState.logs === "idle") {
      void refreshDeferredSnapshot("logs");
    }
    // 마운트 시 1회면 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ③ 지식 브리핑: 위키 트리 counts — 엔드포인트 부재(404)는 조용히 폴백.
  useEffect(() => {
    let alive = true;
    void fetchWikiTree()
      .then((tree) => {
        if (alive) {
          setWikiTree(tree);
        }
      })
      .catch(() => {
        if (alive) {
          setWikiTree(null);
        }
      })
      .finally(() => {
        if (alive) {
          setWikiTreeLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const upcomingSchedules = useMemo(
    () => upcomingSchedulesWithin24h(snapshot.schedules),
    [snapshot.schedules],
  );
  const firstUpcomingSchedule = upcomingSchedules[0] ?? null;

  // ④ 오늘의 제안: 다가오는 일정 제목으로 결정론 FTS 매칭 (LLM 불필요).
  useEffect(() => {
    const schedule = firstUpcomingSchedule;
    if (!schedule || !schedule.title.trim()) {
      setSuggestionHitCount(0);
      setSuggestionScheduleId("");
      return;
    }

    let alive = true;
    void searchKnowledge(schedule.title.trim())
      .then((result) => {
        if (!alive) {
          return;
        }
        const hits = (result.items ?? []).slice(0, 3);
        setSuggestionHitCount(hits.length);
        setSuggestionScheduleId(hits.length > 0 ? schedule.id : "");
      })
      .catch(() => {
        if (alive) {
          setSuggestionHitCount(0);
          setSuggestionScheduleId("");
        }
      });
    return () => {
      alive = false;
    };
  }, [firstUpcomingSchedule?.id, firstUpcomingSchedule?.title]);

  const recentSession = useMemo(() => {
    if (snapshot.workSessions.length === 0) {
      return null;
    }
    return [...snapshot.workSessions].sort(
      (left, right) => latestSessionSortKey(right) - latestSessionSortKey(left),
    )[0]!;
  }, [snapshot.workSessions]);

  const linkedSessionForFirstSchedule = firstUpcomingSchedule
    ? snapshot.workSessions.find((session) => session.schedule_id === firstUpcomingSchedule.id) ?? null
    : null;

  const latestIngestionJob = snapshot.knowledgeIngestionJobs[0] ?? null;

  const unusedFeatureHook = useMemo(() => {
    const usedFeatures = new Set(snapshot.logs.map((log) => log.feature));
    return (
      FEATURE_HOOKS.find(
        (hook) =>
          ![...usedFeatures].some(
            (feature) => feature === hook.feature || feature.startsWith(`${hook.feature}.`),
          ),
      ) ?? null
    );
  }, [snapshot.logs]);

  // J-06: 첫 실행(일정·세션 데이터 0)이면 카드 대신 온보딩 3단계.
  const onboardingMode = snapshot.schedules.length === 0 && snapshot.workSessions.length === 0;

  function openSessionInChat(sessionId: string) {
    setSelectedSessionId(sessionId);
    setActiveMenu("chat");
  }

  function startDocumentDraft() {
    const schedule = firstUpcomingSchedule;
    if (schedule) {
      setDocumentForm((current) => ({ ...current, title: `${schedule.title} 보고` }));
      const linkedSession = linkedSessionForFirstSchedule;
      if (linkedSession) {
        // 세션 기반 모드 프리필 — 기존 store 상태를 그대로 사용한다.
        setDocumentSourceMode("session");
        setDocumentSourceSessionId(linkedSession.id);
      }
    }
    setActiveMenu("documents");
  }

  function snoozeFeatureHookForToday() {
    try {
      window.localStorage.setItem(HOOK_SNOOZE_STORAGE_KEY, todayKey());
    } catch {
      // localStorage를 쓸 수 없으면 현재 세션에서만 숨긴다.
    }
    setHookSnoozedToday(true);
  }

  function renderOnboarding() {
    const steps = [
      {
        key: "llm",
        title: "LLM 연결",
        body: "모델 제공자와 모델을 연결하면 대화·문서작성·지식 검색이 동작합니다.",
        done: isLlmConfigured,
        doneNote: "LLM 연결이 이미 완료되었습니다.",
        ctaLabel: "환경설정 열기",
        menu: "settings" as MenuKey,
      },
      {
        key: "knowledge",
        title: "지식폴더 등록·색인",
        body: "내 문서 폴더를 등록해 색인하면 근거 있는 답변과 지식위키가 만들어집니다.",
        done: snapshot.knowledgeSources.length > 0,
        doneNote: "지식폴더가 이미 등록되어 있습니다.",
        ctaLabel: "내 지식폴더 열기",
        menu: "knowledge" as MenuKey,
      },
      {
        key: "session",
        title: "첫 세션 시작",
        body: "업무대화에서 첫 요청을 남기면 일정·문서·지식이 한 흐름으로 이어집니다.",
        done: snapshot.workSessions.length > 0,
        doneNote: "이미 업무대화 세션이 있습니다.",
        ctaLabel: "업무대화 시작",
        menu: "chat" as MenuKey,
      },
    ];

    return (
      <section className="home-onboarding" data-testid="home-onboarding" aria-label="처음 시작 가이드">
        <h3>처음 오셨네요 — 3단계로 시작해 보세요</h3>
        <p className="home-onboarding__lead">
          아래 순서대로 준비하면 오늘의 브리핑이 내 업무 데이터로 채워집니다.
        </p>
        <ol className="home-onboarding__steps">
          {steps.map((step, index) => (
            <li
              key={step.key}
              className={`home-onboarding__step ${step.done ? "is-done" : ""}`.trim()}
              data-testid={`home-onboarding-step-${step.key}`}
            >
              <span className="home-onboarding__check" aria-hidden="true">
                {step.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              </span>
              <div className="home-onboarding__step-body">
                <strong>
                  {index + 1}. {step.title}
                  {step.done ? <span className="home-onboarding__done-badge">완료</span> : null}
                </strong>
                <p>{step.body}</p>
              </div>
              <button
                type="button"
                className={step.done ? "button-secondary" : undefined}
                disabled={step.done}
                title={step.done ? step.doneNote : step.ctaLabel}
                onClick={() => setActiveMenu(step.menu)}
              >
                {step.ctaLabel}
              </button>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  function renderScheduleCard() {
    return (
      <article className="home-card" data-testid="home-card-schedule">
        <header className="home-card__header">
          <span className="home-card__icon" aria-hidden="true">
            <CalendarDays size={18} />
          </span>
          <h3>오늘 일정</h3>
        </header>
        {upcomingSchedules.length === 0 ? (
          <p className="home-card__empty">24시간 안에 시작하는 일정이 없습니다.</p>
        ) : (
          <ul className="home-card__list">
            {upcomingSchedules.slice(0, 3).map((schedule) => (
              <li key={schedule.id}>
                <span className="home-card__time">{formatDateTime(schedule.starts_at)}</span>
                <span className="home-card__item-title">{schedule.title}</span>
              </li>
            ))}
          </ul>
        )}
        <footer className="home-card__footer">
          {firstUpcomingSchedule && linkedSessionForFirstSchedule ? (
            <button type="button" onClick={() => openSessionInChat(linkedSessionForFirstSchedule.id)}>
              세션 열기
            </button>
          ) : firstUpcomingSchedule ? (
            <button
              type="button"
              onClick={() => {
                setSelectedScheduleId(firstUpcomingSchedule.id);
                setActiveMenu("schedule");
              }}
            >
              세션 만들기
            </button>
          ) : (
            <button type="button" className="button-secondary" onClick={() => setActiveMenu("schedule")}>
              일정 열기
            </button>
          )}
        </footer>
      </article>
    );
  }

  function renderContinueCard() {
    return (
      <article className="home-card" data-testid="home-card-continue">
        <header className="home-card__header">
          <span className="home-card__icon" aria-hidden="true">
            <BotMessageSquare size={18} />
          </span>
          <h3>이어서 하기</h3>
        </header>
        {recentSession ? (
          <div className="home-card__body">
            <strong className="home-card__item-title">{recentSession.title}</strong>
            <p className="home-card__preview">{latestSessionPreview(recentSession)}</p>
          </div>
        ) : (
          <p className="home-card__empty">아직 업무대화 세션이 없습니다.</p>
        )}
        {pendingApprovals.length > 0 ? (
          <div className="home-card__notice" data-testid="home-approvals-notice">
            <span>승인 대기 {pendingApprovals.length}건</span>
            <button
              type="button"
              className="button-secondary"
              onClick={() => revealContextSection("approvals", { force: true })}
            >
              승인 확인
            </button>
          </div>
        ) : null}
        <footer className="home-card__footer">
          {recentSession ? (
            <button type="button" onClick={() => openSessionInChat(recentSession.id)}>
              이어서 대화
            </button>
          ) : (
            <button type="button" className="button-secondary" onClick={() => setActiveMenu("chat")}>
              업무대화 시작
            </button>
          )}
        </footer>
      </article>
    );
  }

  function renderKnowledgeCard() {
    return (
      <article className="home-card" data-testid="home-card-knowledge">
        <header className="home-card__header">
          <span className="home-card__icon" aria-hidden="true">
            <BookMarked size={18} />
          </span>
          <h3>지식 브리핑</h3>
        </header>
        {!wikiTreeLoaded ? (
          <p className="home-card__empty">지식위키 요약을 불러오는 중…</p>
        ) : wikiTree ? (
          <ul className="home-card__stats">
            <li>
              <strong>{wikiTree.counts.docs}</strong>
              <span>문서</span>
            </li>
            <li>
              <strong>{wikiTree.counts.topics}</strong>
              <span>주제</span>
            </li>
            <li>
              <strong>{wikiTree.counts.works}</strong>
              <span>업무 기록</span>
            </li>
          </ul>
        ) : (
          <p className="home-card__empty">아직 지식위키 요약이 없습니다. 지식폴더를 색인해 보세요.</p>
        )}
        <p className="home-card__meta">
          {latestIngestionJob
            ? `최근 색인: ${
                latestIngestionJob.status === "completed"
                  ? "완료"
                  : latestIngestionJob.status === "running"
                    ? "진행 중"
                    : latestIngestionJob.status === "queued"
                      ? "대기"
                      : latestIngestionJob.status === "partial"
                        ? "부분 완료"
                        : "실패"
              }`
            : "최근 색인 이력이 없습니다."}
        </p>
        <footer className="home-card__footer">
          <button type="button" onClick={() => setActiveMenu("knowledge")}>
            지식폴더 열기
          </button>
        </footer>
      </article>
    );
  }

  function renderSuggestionCard() {
    if (!firstUpcomingSchedule || suggestionHitCount === 0 || suggestionScheduleId !== firstUpcomingSchedule.id) {
      return null;
    }
    return (
      <article className="home-card home-card--accent" data-testid="home-card-suggestion">
        <header className="home-card__header">
          <span className="home-card__icon" aria-hidden="true">
            <Lightbulb size={18} />
          </span>
          <h3>오늘의 제안</h3>
        </header>
        <p className="home-card__body-text">
          &lsquo;{firstUpcomingSchedule.title}&rsquo; 관련 문서 {suggestionHitCount}건 — 보고 초안을
          시작할까요?
        </p>
        <footer className="home-card__footer">
          <button type="button" onClick={startDocumentDraft}>
            문서작성 시작
          </button>
        </footer>
      </article>
    );
  }

  function renderFeatureHookCard() {
    if (!unusedFeatureHook || hookSnoozedToday) {
      return null;
    }
    return (
      <article className="home-card" data-testid="home-card-hook">
        <header className="home-card__header">
          <span className="home-card__icon" aria-hidden="true">
            <Compass size={18} />
          </span>
          <h3>{unusedFeatureHook.title}</h3>
        </header>
        <p className="home-card__body-text">{unusedFeatureHook.body}</p>
        <footer className="home-card__footer">
          <button type="button" onClick={() => setActiveMenu(unusedFeatureHook.menu)}>
            {unusedFeatureHook.ctaLabel}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={snoozeFeatureHookForToday}
            title="이 안내를 오늘 하루 동안 숨깁니다"
          >
            오늘 하루 숨기기
          </button>
        </footer>
      </article>
    );
  }

  // W6: 앱 이용팁 카드 — shared/tips.ts 단일 원천에서 오늘의 팁 1개를 보여준다.
  function renderTipsCard() {
    if (APP_TIPS.length === 0) {
      return null;
    }
    const tip = APP_TIPS[(dailyTipIndex(APP_TIPS.length) + tipOffset) % APP_TIPS.length];
    const menuLabel = MENU_ITEMS.find((item) => item.key === tip.menu)?.label ?? tip.menu;
    return (
      <article className="home-card" data-testid="home-card-tips">
        <header className="home-card__header">
          <span className="home-card__icon" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <h3>앱 이용팁</h3>
        </header>
        {tipIllustration(tip) ? (
          <img
            className="home-card__illustration"
            src={tipIllustration(tip)!}
            alt=""
            aria-hidden="true"
            data-testid="home-tip-illustration"
          />
        ) : null}
        <p className="home-card__body-text" data-testid="home-tip-text">
          {tip.text}
        </p>
        <footer className="home-card__footer">
          <button
            type="button"
            data-testid="home-tip-open-menu"
            title={`${menuLabel} 화면에서 이 팁을 바로 써 봅니다`}
            onClick={() => setActiveMenu(tip.menu)}
          >
            {menuLabel} 열기
          </button>
          <button
            type="button"
            className="button-secondary"
            data-testid="home-tip-next"
            title="다른 이용팁을 봅니다"
            onClick={() => setTipOffset((current) => current + 1)}
          >
            다음 팁
          </button>
        </footer>
      </article>
    );
  }

  return (
    <section className="home-screen" data-testid="home-screen">
      <header className="home-screen__header">
        <h2>오늘의 브리핑</h2>
        <p>{formatDateTime(new Date().toISOString())} 기준 — 오늘 할 일과 이어갈 업무를 모았습니다.</p>
      </header>
      {onboardingMode ? (
        renderOnboarding()
      ) : (
        <div className="home-screen__grid">
          {renderScheduleCard()}
          {renderContinueCard()}
          {renderKnowledgeCard()}
          {renderSuggestionCard()}
          {renderFeatureHookCard()}
          {renderTipsCard()}
        </div>
      )}
    </section>
  );
}
