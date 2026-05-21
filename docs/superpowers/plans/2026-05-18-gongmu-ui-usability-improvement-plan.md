# Gongmu UI Usability Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 컴퓨터유즈 기반 UI 점검에서 발견된 첫 로딩 지연, 업무대화 상태 불명확, 지식폴더/GraphRAG 화면 과밀, 파일검색/실행기록/문서작성 혼선을 실제 사용 가능한 수준으로 개선한다.

**Architecture:** 현재의 Tauri + React + TypeScript 단일 앱 구조와 FastAPI sidecar 구조를 유지하되, 무거운 데이터는 화면 진입 시 lazy load하도록 API 호출 계층을 분리한다. UI는 업무대화 중심 좌/중앙/우 패널 레이아웃을 유지하면서, 지식폴더와 실행기록처럼 정보량이 많은 화면은 사용자용 요약과 개발자용 상세를 분리한다.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Tauri 2, FastAPI, SQLite, ChromaDB optional backend, PowerShell/Windows dev loop.

---

## Source Audit

기준 문서:

- `docs/operations/2026-05-18-gongmu-ui-usability-audit.md`

핵심 문제:

- 초기 앱 로딩이 `/api/knowledge/documents` 같은 무거운 API에 묶여 전체 화면이 40초 이상 멈춘 것처럼 보인다.
- 업무대화 완료 후 `잠시만 기다려 주세요.` 또는 `응답을 준비하는 중입니다.` 계열 pending 문구가 최종 답변과 섞일 수 있다.
- 업무대화에 GraphRAG, 연결파일, 첨부 이미지가 실제로 포함됐는지 사용자가 알기 어렵다.
- 지식폴더가 그래프, 설정, 색인, 검색, 상세 데이터를 한 화면에 길게 펼쳐 목적이 흐려진다.
- GraphRAG ingestion 시간과 로그가 wall-clock 기준으로 보여 신뢰도가 낮아지고, JSONL 덤프가 카드 안에서 너무 크게 펼쳐진다.
- 파일검색 화면에서 내장 검색보다 Anything history가 더 크게 느껴진다.
- 실행기록은 raw event와 JSON이 노출되어 일반 업무자가 읽기 어렵다.
- 문서작성은 `보고서형/회의자료형/검토메모형`과 `시행문/1페이지 보고서/풀버전 보고서/이메일`이 함께 보여 선택 의미가 흐려진다.

---

## File Structure

### Existing files to modify

- `apps/desktop/src/api.ts`
  - `loadWorkspaceSnapshot()`을 shell/deferred/domain loaders로 분리한다.
  - 신규 lazy loader 타입과 merge helper를 둔다.

- `apps/desktop/src/app.tsx`
  - 초기 로딩, 메뉴별 lazy load, 업무대화 context evidence strip, 지식폴더 IA, 실행기록 표시를 수정한다.
  - 단일 파일이 크므로 이번 계획에서는 파일 분리보다 위험 낮은 helper 추출부터 진행한다.

- `apps/desktop/src/styles.css`
  - lazy 상태, context evidence strip, 지식폴더 대시보드, 로그 뷰어 모달, 파일검색 접힘 UI, 실행기록 요약 카드 스타일을 추가한다.

- `services/sidecar/src/gongmu_sidecar/app.py`
  - 업무대화 pending assistant message 저장 방식, GraphRAG context summary, 실행기록 action output을 정리한다.
  - 필요한 경우 ingestion active lock과 user-facing error message를 보강한다.

- `services/sidecar/src/gongmu_sidecar/graphrag_ingestion.py`
  - stage별 진단 이벤트와 실제 처리시간 집계 품질을 개선한다.

- `services/sidecar/src/gongmu_sidecar/local_file_search.py`
  - 파일명/경로 Unicode NFC 정규화와 검색 결과 display label 정리를 추가한다.

- `services/sidecar/src/gongmu_sidecar/db.py`
  - 실행기록 필드 추가가 필요할 경우 migration을 둔다. 가능하면 기존 `inputs`/`outputs` JSON에 user-facing summary를 넣어 schema churn을 줄인다.

### Existing tests to modify

- `apps/desktop/src/api.test.ts`
- `apps/desktop/src/app.test.tsx`
- `apps/desktop/src/chat-turn-submit.test.tsx`
- `apps/desktop/src/chat-attachments-latency.test.tsx`
- `apps/desktop/src/knowledge-sources.test.tsx`
- `apps/desktop/src/local-file-search.test.tsx`
- `apps/desktop/src/document-workflow-handoff.test.tsx`
- `apps/desktop/src/settings-edit.test.tsx`
- `services/sidecar/tests/test_work_session_turn.py`
- `services/sidecar/tests/test_work_session_attachments.py`
- `services/sidecar/tests/test_graphrag_ingestion.py`
- `services/sidecar/tests/test_local_file_search.py`

### New helper files

- Create: `apps/desktop/src/workspaceSnapshot.ts`
  - shell/deferred snapshot merge와 panel load state helper를 담당한다.

- Create: `apps/desktop/src/executionLogDisplay.ts`
  - raw execution log를 사용자용 제목, 상태, 설명, 개발자 상세로 변환한다.

- Create: `apps/desktop/src/knowledgeUi.ts`
  - ingestion stage, quality summary, issue queue, dump preview view model을 만든다.

- Create: `apps/desktop/src/chatContextSummary.ts`
  - 업무대화 요청에 포함되는 GraphRAG, 연결파일, 첨부, 모델/도구 상태를 UI용 문구로 만든다.

---

## Release Slices

### Slice A: 사용자가 앱을 켜고 업무대화/지식폴더를 믿을 수 있게 만든다

- Task 1: 초기 로딩 shell/deferred 분리
- Task 2: 업무대화 pending/latency/status 정리
- Task 3: 업무대화 GraphRAG/파일/첨부 context evidence 표시
- Task 4: 지식폴더 IA 3분리와 접근 가능한 tab role 정리
- Task 5: GraphRAG ingestion 진단/로그 UX 개선

### Slice B: 보조 화면의 혼선을 줄인다

- Task 6: 파일검색 기본 흐름과 Anything history 재배치
- Task 7: 실행기록 사용자용 요약화
- Task 8: 문서작성 출력 유형 중심 정리와 환경설정 섹션화
- Task 9: 컴퓨터유즈 회귀 점검 문서 갱신

---

## Task 1: Split Initial Workspace Loading

**Files:**

- Create: `apps/desktop/src/workspaceSnapshot.ts`
- Modify: `apps/desktop/src/api.ts`
- Modify: `apps/desktop/src/app.tsx`
- Test: `apps/desktop/src/api.test.ts`
- Test: `apps/desktop/src/app.test.tsx`

- [ ] **Step 1: Write failing API tests for shell snapshot**

Add to `apps/desktop/src/api.test.ts`:

```ts
import {
  createEmptyWorkspaceSnapshot,
  loadWorkspaceDeferredSnapshot,
  loadWorkspaceShellSnapshot,
  mergeWorkspaceSnapshot,
} from "./api";

it("loads the shell snapshot without waiting for heavy knowledge documents", async () => {
  const originalFetch = global.fetch;
  const calls: string[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({ status: "ok", workspace_root: "/tmp/ws", database: "/tmp/ws/db/gongmu.db" }), { status: 200 });
    }
    if (url.endsWith("/api/settings")) {
      return new Response(JSON.stringify({ defaults: {}, paths: { workspace_root: "/tmp/ws" } }), { status: 200 });
    }
    if (url.endsWith("/api/schedules") || url.endsWith("/api/work-sessions") || url.endsWith("/api/reference-sets")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    throw new Error(`unexpected shell call: ${url}`);
  }) as typeof fetch;

  try {
    const snapshot = await loadWorkspaceShellSnapshot();
    expect(snapshot.health?.status).toBe("ok");
    expect(snapshot.settings?.paths.workspace_root).toBe("/tmp/ws");
    expect(calls.some((url) => url.endsWith("/api/knowledge/documents"))).toBe(false);
  } finally {
    global.fetch = originalFetch;
  }
});

it("merges deferred snapshot lists into an existing shell snapshot", () => {
  const base = createEmptyWorkspaceSnapshot();
  const merged = mergeWorkspaceSnapshot(base, {
    knowledgeDocuments: [{ id: "doc-1", title: "문서", file_path: "C:/a.pdf", relative_path: "a.pdf", document_type: "pdf", status: "structured", partial: false }],
    logs: [{ id: "log-1", feature: "knowledge", action: "knowledge.ingest.job.run", status: "completed", created_at: "2026-05-18T00:00:00Z" }],
  });

  expect(merged.knowledgeDocuments).toHaveLength(1);
  expect(merged.logs).toHaveLength(1);
});
```

Expected now: FAIL because these functions do not exist.

- [ ] **Step 2: Implement focused snapshot helpers**

In `apps/desktop/src/api.ts`, create `createEmptyWorkspaceSnapshot()`, `loadWorkspaceShellSnapshot()`, `loadWorkspaceDeferredSnapshot(group)`, and `mergeWorkspaceSnapshot()`.

Required shell endpoints:

```ts
const shellRequests = [
  requestJson<WorkspaceHealth>("/health"),
  requestJson<unknown>("/api/settings"),
  requestJson<{ items: ScheduleItem[] }>("/api/schedules"),
  requestJson<{ items: WorkSessionItem[] }>("/api/work-sessions"),
  requestJson<{ items: ReferenceSetItem[] }>("/api/reference-sets"),
  requestJson<{ items: TemplateItem[] }>("/api/templates"),
  requestJson<{ items: ApprovalTicketItem[] }>("/api/approval-tickets"),
];
```

Required deferred groups:

```ts
export type WorkspaceDeferredGroup = "knowledge" | "search" | "fileOrganizer" | "logs" | "settingsExtras";
```

Knowledge group must include:

```ts
[
  "/api/knowledge/candidates",
  "/api/knowledge/pages",
  "/api/knowledge/sources",
  "/api/knowledge/source-files",
  "/api/knowledge/ingestion-jobs",
  "/api/knowledge/documents",
  "/api/personalization/candidates",
]
```

Search group must include:

```ts
[
  "/api/integrations/anything/launches",
]
```

File organizer group must include:

```ts
[
  "/api/file-organizer/proposals",
]
```

Logs group must include:

```ts
[
  "/api/execution-logs",
]
```

- [ ] **Step 3: Preserve backwards compatibility**

Keep `loadWorkspaceSnapshot()` exported, but make it call shell + all deferred groups. This keeps existing tests and older code paths working while app.tsx moves to lazy loading.

Implementation shape:

```ts
export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  let snapshot = await loadWorkspaceShellSnapshot();
  for (const group of ["knowledge", "search", "fileOrganizer", "logs"] as const) {
    snapshot = mergeWorkspaceSnapshot(snapshot, await loadWorkspaceDeferredSnapshot(group));
  }
  return snapshot;
}
```

- [ ] **Step 4: Update App initial load**

In `apps/desktop/src/app.tsx`, replace the initial `refreshSnapshot()` call with shell-first loading:

```ts
async function refreshShellSnapshot(options: { silent?: boolean } = {}) {
  if (!options.silent) setLoading(true);
  try {
    const next = await loadWorkspaceShellSnapshot();
    startTransition(() => setSnapshot((current) => mergeWorkspaceSnapshot(current, next)));
    setError(null);
  } catch (loadError) {
    setError(loadError instanceof Error ? loadError.message : "워크스페이스 핵심 정보를 불러오지 못했습니다.");
  } finally {
    if (!options.silent) setLoading(false);
  }
}
```

Then load deferred groups on panel entry:

```ts
useEffect(() => {
  const groupByMenu: Partial<Record<MenuKey, WorkspaceDeferredGroup>> = {
    knowledge: "knowledge",
    search: "search",
    files: "fileOrganizer",
    logs: "logs",
  };
  const group = groupByMenu[activeMenu];
  if (!group) return;
  void refreshDeferredSnapshot(group);
}, [activeMenu]);
```

- [ ] **Step 5: Add UI partial-load status**

In `app.tsx`, add a small status chip near the header summary:

```tsx
{deferredLoadState.knowledge === "loading" ? <span className="pill pill--soft">지식 데이터 로딩 중</span> : null}
{deferredLoadState.knowledge === "failed" ? <span className="pill pill--warning">지식 데이터 지연</span> : null}
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm.cmd run desktop:test -- apps/desktop/src/api.test.ts apps/desktop/src/app.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/desktop/src/api.ts apps/desktop/src/app.tsx apps/desktop/src/workspaceSnapshot.ts apps/desktop/src/api.test.ts apps/desktop/src/app.test.tsx
git commit -m "fix: split workspace shell loading from deferred data"
```

---

## Task 2: Clean Chat Pending, Latency, And Completion State

**Files:**

- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
- Modify: `apps/desktop/src/app.tsx`
- Modify: `apps/desktop/src/chat-turn-submit.test.tsx`
- Modify: `services/sidecar/tests/test_work_session_turn.py`

- [ ] **Step 1: Write failing sidecar test for pending text**

In `services/sidecar/tests/test_work_session_turn.py`, add:

```py
def test_work_session_turn_does_not_persist_waiting_placeholder_after_completion(tmp_path: Path, monkeypatch) -> None:
    def fake_generate_reply(settings, messages, **kwargs):
        return LLMGenerationResult(text="최종 답변입니다.", provider="ollama", model="qwen3.6:27b")

    monkeypatch.setattr("gongmu_sidecar.app.generate_session_reply", fake_generate_reply)
    client = TestClient(create_app(tmp_path))
    session = client.post("/api/work-sessions", json={"title": "테스트"}).json()

    payload = client.post(
        f"/api/work-sessions/{session['id']}/turn",
        json={"text": "안녕", "attachment_ids": []},
    ).json()

    assert payload["assistant_message"]["status"] == "completed"
    assert payload["assistant_message"]["text"] == "최종 답변입니다."
    assert "기다려" not in payload["assistant_message"]["text"]
    assert "준비" not in payload["assistant_message"]["text"]
```

Expected now: FAIL if garbled/pending placeholder remains in stored text.

- [ ] **Step 2: Store pending assistant as empty text**

In `services/sidecar/src/gongmu_sidecar/app.py`, change the assistant pending creation inside `run_work_session_turn()`:

```py
assistant_message = self.create_work_session_message(
    session_id,
    WorkSessionMessageCreate(
        role="assistant",
        text="",
        message_type="chat",
        status="pending",
        provider=self.settings.llm_provider,
        model=self.settings.llm_model,
    ),
)
```

- [ ] **Step 3: Render pending text only from status**

In `apps/desktop/src/app.tsx`, add:

```ts
function visibleMessageText(message: WorkSessionMessageItem) {
  if (message.status === "pending" || message.status === "streaming") {
    return "응답을 준비하는 중입니다.";
  }
  return message.text;
}
```

Use it in assistant and user rendering:

```tsx
{message.role === "assistant" ? (
  <div className="chat-markdown">
    {renderMarkdownContent(visibleMessageText(message))}
  </div>
) : (
  <div className="chat-user-bubble">
    <p>{visibleMessageText(message)}</p>
  </div>
)}
```

- [ ] **Step 4: Ensure latency is visible on completed assistant message**

In `apps/desktop/src/chat-turn-submit.test.tsx`, assert:

```tsx
expect(await screen.findByText("응답 1.2초")).toBeInTheDocument();
expect(screen.queryByText("응답을 준비하는 중입니다.")).not.toBeInTheDocument();
```

Use the existing mocked `runWorkSessionTurn()` response and set `latency_ms: 1200`.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm.cmd run desktop:test -- apps/desktop/src/chat-turn-submit.test.tsx
npm.cmd run sidecar:test -- services/sidecar/tests/test_work_session_turn.py
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add services/sidecar/src/gongmu_sidecar/app.py services/sidecar/tests/test_work_session_turn.py apps/desktop/src/app.tsx apps/desktop/src/chat-turn-submit.test.tsx
git commit -m "fix: separate chat pending state from completed answers"
```

---

## Task 3: Show Chat Context Evidence For RAG, Files, And Attachments

**Files:**

- Create: `apps/desktop/src/chatContextSummary.ts`
- Modify: `apps/desktop/src/app.tsx`
- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
- Modify: `services/sidecar/tests/test_work_session_turn.py`
- Modify: `apps/desktop/src/chat-attachments-latency.test.tsx`
- Modify: `apps/desktop/src/session-file-links.test.tsx`

- [ ] **Step 1: Add sidecar context summary to turn response**

In `services/sidecar/src/gongmu_sidecar/app.py`, return context metadata from `run_work_session_turn()`:

```py
context_summary = {
    "graphrag_used": bool(graphrag_prompt_block),
    "attachment_count": len(attached_files),
    "linked_file_count": len(self.list_work_session_file_links(session_id)),
    "model": assistant_message.get("model"),
    "provider": assistant_message.get("provider"),
}
```

Add it to response:

```py
return {
    "user_message": user_message,
    "assistant_message": assistant_message,
    "duration_ms": duration_ms,
    "context_summary": context_summary,
}
```

- [ ] **Step 2: Write sidecar assertion**

In `services/sidecar/tests/test_work_session_turn.py`:

```py
assert payload["context_summary"]["graphrag_used"] is True
assert payload["context_summary"]["attachment_count"] == 0
assert "linked_file_count" in payload["context_summary"]
```

Use the existing `test_work_session_turn_injects_graphrag_context_by_default`.

- [ ] **Step 3: Add frontend summary helper**

Create `apps/desktop/src/chatContextSummary.ts`:

```ts
export type ChatContextSummaryInput = {
  knowledgeDocumentCount: number;
  linkedFileCount: number;
  attachmentCount: number;
  provider?: string | null;
  model?: string | null;
  multimodalEnabled?: boolean;
};

export function buildChatContextSummary(input: ChatContextSummaryInput) {
  return [
    `지식근거 ${input.knowledgeDocumentCount}개`,
    `연결파일 ${input.linkedFileCount}개`,
    `첨부 ${input.attachmentCount}개`,
    [input.provider, input.model].filter(Boolean).join(" / ") || "모델 미설정",
    input.attachmentCount > 0 && !input.multimodalEnabled ? "이미지 이해 미확인" : null,
  ].filter(Boolean);
}
```

- [ ] **Step 4: Render evidence strip above composer**

In `apps/desktop/src/app.tsx`, just above `<form className="chat-composer"...>`:

```tsx
<div className="chat-context-strip" data-testid="chat-context-strip">
  {buildChatContextSummary({
    knowledgeDocumentCount: snapshot.knowledgeDocuments.length,
    linkedFileCount: selectedSessionFileLinks.length,
    attachmentCount: chatAttachments.length,
    provider: snapshot.settings?.defaults.llm_provider,
    model: activeChatModel,
    multimodalEnabled: chatAttachments.some((attachment) => attachment.file.type.startsWith("image/")),
  }).map((item) => (
    <span key={item} className="pill pill--soft">{item}</span>
  ))}
</div>
```

- [ ] **Step 5: Add warning for image attachment when model path cannot carry images**

If the current backend only converts attachments to text prompt blocks, display:

```tsx
{chatAttachments.some((attachment) => attachment.file.type.startsWith("image/")) ? (
  <p className="subtle-text chat-context-warning">
    현재 이미지 첨부는 파일 정보로 전달됩니다. 실제 이미지 이해는 모델/공급자 연동이 지원될 때 활성화됩니다.
  </p>
) : null}
```

- [ ] **Step 6: Add frontend tests**

In `apps/desktop/src/chat-attachments-latency.test.tsx`:

```tsx
expect(screen.getByTestId("chat-context-strip")).toHaveTextContent("첨부 1개");
expect(screen.getByText(/현재 이미지 첨부는 파일 정보로 전달됩니다/)).toBeInTheDocument();
```

In `apps/desktop/src/session-file-links.test.tsx`:

```tsx
expect(screen.getByTestId("chat-context-strip")).toHaveTextContent("연결파일 2개");
```

- [ ] **Step 7: Run tests**

Run:

```powershell
npm.cmd run desktop:test -- apps/desktop/src/chat-attachments-latency.test.tsx apps/desktop/src/session-file-links.test.tsx
npm.cmd run sidecar:test -- services/sidecar/tests/test_work_session_turn.py services/sidecar/tests/test_work_session_attachments.py
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/desktop/src/chatContextSummary.ts apps/desktop/src/app.tsx apps/desktop/src/chat-attachments-latency.test.tsx apps/desktop/src/session-file-links.test.tsx services/sidecar/src/gongmu_sidecar/app.py services/sidecar/tests/test_work_session_turn.py services/sidecar/tests/test_work_session_attachments.py
git commit -m "feat: show chat context evidence before model calls"
```

---

## Task 4: Rework Knowledge Folder IA Into Dashboard, Indexing, Search

**Files:**

- Create: `apps/desktop/src/knowledgeUi.ts`
- Modify: `apps/desktop/src/app.tsx`
- Modify: `apps/desktop/src/styles.css`
- Test: `apps/desktop/src/knowledge-sources.test.tsx`

- [ ] **Step 1: Write test for accessible knowledge tabs**

In `apps/desktop/src/knowledge-sources.test.tsx`:

```tsx
expect(screen.getByRole("tab", { name: "대시보드" })).toBeInTheDocument();
expect(screen.getByRole("tab", { name: "색인/진단" })).toBeInTheDocument();
expect(screen.getByRole("tab", { name: "검색/검증" })).toBeInTheDocument();

await user.click(screen.getByRole("tab", { name: "색인/진단" }));
expect(screen.getByRole("tabpanel", { name: "색인/진단" })).toHaveTextContent("GraphRAG ingestion 작업");

await user.click(screen.getByRole("tab", { name: "검색/검증" }));
expect(screen.getByRole("tabpanel", { name: "검색/검증" })).toHaveTextContent("근거 답변 생성");
```

Expected now: FAIL because current labels are `설정/상태`, `색인 처리`, `GraphRAG 검색` and may not expose proper tab roles.

- [ ] **Step 2: Add knowledge panel labels**

In `apps/desktop/src/app.tsx`, replace `KNOWLEDGE_WORKSPACE_PANELS` labels with:

```ts
const KNOWLEDGE_WORKSPACE_PANELS = [
  { key: "sources", label: "대시보드", description: "그래프, 품질, 상태 요약" },
  { key: "indexing", label: "색인/진단", description: "스캔, 재색인, 로그 확인" },
  { key: "search", label: "검색/검증", description: "근거 답변과 관계 확인" },
] as const;
```

- [ ] **Step 3: Use real tab semantics**

Replace tab buttons with:

```tsx
<button
  key={panel.key}
  type="button"
  role="tab"
  id={`knowledge-tab-${panel.key}`}
  aria-controls={`knowledge-panel-${panel.key}`}
  aria-selected={knowledgePanel === panel.key}
  className={`knowledge-workspace-tab ${knowledgePanel === panel.key ? "is-active" : ""}`}
  onClick={() => setKnowledgePanel(panel.key)}
>
  <span>{panel.label}</span>
  <small>{panel.description}</small>
</button>
```

Wrap each panel with:

```tsx
<section
  role="tabpanel"
  id={`knowledge-panel-${knowledgePanel}`}
  aria-labelledby={`knowledge-tab-${knowledgePanel}`}
>
  ...
</section>
```

- [ ] **Step 4: Move folder registration to Dashboard and scan buttons to Indexing**

Dashboard must show:

- graph preview
- source count
- document count
- extracted body count
- metadata-only count
- latest job summary
- problem files count

Indexing must show:

- source list with `스캔 시작`, `GraphRAG 인덱싱`, `강제 재색인`
- active job progress
- stage timeline
- diagnostics event count
- log dump buttons
- problem file queue

Search/검증 must show:

- query box
- `검색 실행`
- `근거 답변 생성`
- citations
- graph relationships
- chunk/structure details

- [ ] **Step 5: Create knowledge view model helper**

Create `apps/desktop/src/knowledgeUi.ts`:

```ts
import type { KnowledgeDocumentItem, KnowledgeIngestionJobItem } from "./api";

export function summarizeKnowledgeQuality(documents: KnowledgeDocumentItem[]) {
  const metadataOnly = documents.filter((doc) => doc.partial || (doc.quality_score ?? 0) < 0.1).length;
  const structured = documents.length - metadataOnly;
  const lowQuality = documents.filter((doc) => (doc.quality_score ?? 0) < 0.4).length;
  return { total: documents.length, structured, metadataOnly, lowQuality };
}

export function summarizeLatestIngestionJob(jobs: KnowledgeIngestionJobItem[]) {
  const [latest] = [...jobs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (!latest) return null;
  return {
    id: latest.id,
    status: latest.status,
    processed: latest.processed_count ?? 0,
    failed: latest.failed_count ?? 0,
    total: latest.queued_count ?? 0,
    percent: latest.queued_count ? Math.round(((latest.processed_count ?? 0) / latest.queued_count) * 100) : 100,
  };
}
```

- [ ] **Step 6: Add visual hierarchy styles**

In `apps/desktop/src/styles.css`, add:

```css
.knowledge-dashboard-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(420px, 1.4fr);
  gap: 16px;
}

.knowledge-health-card {
  border: 1px solid var(--line-soft);
  border-radius: 24px;
  padding: 18px;
  background: rgba(255, 255, 255, 0.78);
}

.knowledge-issue-list {
  display: grid;
  gap: 10px;
  max-height: 320px;
  overflow: auto;
}
```

- [ ] **Step 7: Run tests**

Run:

```powershell
npm.cmd run desktop:test -- apps/desktop/src/knowledge-sources.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/desktop/src/app.tsx apps/desktop/src/styles.css apps/desktop/src/knowledgeUi.ts apps/desktop/src/knowledge-sources.test.tsx
git commit -m "feat: clarify knowledge folder dashboard and indexing IA"
```

---

## Task 5: Improve GraphRAG Ingestion Progress, Timing, And Log Viewer

**Files:**

- Modify: `services/sidecar/src/gongmu_sidecar/graphrag_ingestion.py`
- Modify: `services/sidecar/src/gongmu_sidecar/app.py`
- Modify: `apps/desktop/src/app.tsx`
- Modify: `apps/desktop/src/knowledgeUi.ts`
- Modify: `apps/desktop/src/styles.css`
- Test: `services/sidecar/tests/test_graphrag_ingestion.py`
- Test: `apps/desktop/src/knowledge-sources.test.tsx`

- [ ] **Step 1: Write sidecar test for active ingestion lock**

In `services/sidecar/tests/test_graphrag_ingestion.py`:

```py
def test_ingestion_rejects_new_run_when_active_job_exists(tmp_path: Path) -> None:
    client = TestClient(create_app(tmp_path))
    source = client.post("/api/knowledge/sources", json={"label": "자료", "root_path": str(tmp_path)}).json()

    # Simulate active job directly in DB through app service if existing helper is not available.
    services = client.app.state.services
    services.db.insert(
        "knowledge_ingestion_jobs",
        {
            "id": "active-job",
            "source_id": source["id"],
            "status": "running",
            "queued_count": 1,
            "processed_count": 0,
            "failed_count": 0,
            "created_at": "2026-05-18T00:00:00Z",
        },
    )

    response = client.post(f"/api/knowledge/sources/{source['id']}/ingest", json={"force": False})
    assert response.status_code == 409
    assert "진행 중" in response.json()["detail"]
```

- [ ] **Step 2: Add stage timing summary**

In `graphrag_ingestion.py`, collect stage timing:

```py
stage_started_at = perf_counter()

def finish_stage(stage: str, processed: int = 0) -> dict[str, Any]:
    elapsed_ms = int((perf_counter() - stage_started_at) * 1000)
    return {"stage": stage, "duration_ms": elapsed_ms, "processed_count": processed}
```

Append stage timing to job outputs or metadata:

```py
job_summary["stage_timings"] = stage_timings
job_summary["processing_duration_ms"] = sum(item["duration_ms"] for item in stage_timings)
```

- [ ] **Step 3: Separate wall time from processing time in UI**

In `knowledgeUi.ts`:

```ts
export function formatIngestionDuration(job: KnowledgeIngestionJobItem) {
  const processing = job.processing_duration_ms ?? job.duration_ms ?? null;
  const wall = job.duration_ms ?? null;
  return {
    processingLabel: processing === null ? "처리시간 미집계" : `실제 처리 ${formatDurationMs(processing)}`,
    wallLabel: wall === null ? "총 경과 미집계" : `총 경과 ${formatDurationMs(wall)}`,
  };
}
```

- [ ] **Step 4: Replace inline JSONL dump with modal viewer**

In `app.tsx`, add state:

```ts
const [knowledgeLogViewer, setKnowledgeLogViewer] = useState<{
  jobId: string;
  path: string;
  content: string;
  filter: "all" | "error" | "warning" | "info";
} | null>(null);
```

Change `덤프 펼쳐보기` button to:

```tsx
<button type="button" className="button-secondary" onClick={() => void openKnowledgeLogViewer(job)}>
  덤프 뷰어 열기
</button>
```

Render modal:

```tsx
{knowledgeLogViewer ? (
  <div className="modal-backdrop" role="dialog" aria-label="GraphRAG 로그 뷰어">
    <section className="knowledge-log-viewer">
      <header>
        <h2>GraphRAG 로그 뷰어</h2>
        <button type="button" onClick={() => setKnowledgeLogViewer(null)}>닫기</button>
      </header>
      <input
        aria-label="로그 필터"
        value={knowledgeLogViewer.filter}
        readOnly
      />
      <pre>{knowledgeLogViewer.content}</pre>
    </section>
  </div>
) : null}
```

- [ ] **Step 5: Add UI test for log viewer**

In `apps/desktop/src/knowledge-sources.test.tsx`:

```tsx
await user.click(screen.getByRole("button", { name: "덤프 뷰어 열기" }));
expect(await screen.findByRole("dialog", { name: "GraphRAG 로그 뷰어" })).toBeInTheDocument();
expect(screen.getByText(/job.created/)).toBeInTheDocument();
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm.cmd run desktop:test -- apps/desktop/src/knowledge-sources.test.tsx
npm.cmd run sidecar:test -- services/sidecar/tests/test_graphrag_ingestion.py
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add services/sidecar/src/gongmu_sidecar/graphrag_ingestion.py services/sidecar/src/gongmu_sidecar/app.py services/sidecar/tests/test_graphrag_ingestion.py apps/desktop/src/app.tsx apps/desktop/src/knowledgeUi.ts apps/desktop/src/styles.css apps/desktop/src/knowledge-sources.test.tsx
git commit -m "feat: improve graphrag ingestion diagnostics"
```

---

## Task 6: Make Built-In File Search The Primary Flow

**Files:**

- Modify: `services/sidecar/src/gongmu_sidecar/local_file_search.py`
- Modify: `apps/desktop/src/app.tsx`
- Modify: `apps/desktop/src/styles.css`
- Test: `services/sidecar/tests/test_local_file_search.py`
- Test: `apps/desktop/src/local-file-search.test.tsx`

- [ ] **Step 1: Add Unicode NFC normalization test**

In `services/sidecar/tests/test_local_file_search.py`:

```py
def test_local_file_search_normalizes_display_names(tmp_path: Path) -> None:
    decomposed = "클로드.pdf"
    path = tmp_path / decomposed
    path.write_text("prompt guide", encoding="utf-8")

    client = TestClient(create_app(tmp_path / "workspace"))
    response = client.post("/api/local-file-search/index", json={"root_path": str(tmp_path)})
    assert response.status_code == 200

    results = client.get("/api/local-file-search", params={"query": "클로드"}).json()["items"]
    assert results
    assert results[0]["file"]["display_name"] == "클로드.pdf"
```

- [ ] **Step 2: Normalize file display fields**

In `local_file_search.py`:

```py
from unicodedata import normalize

def normalize_display_text(value: str) -> str:
    return normalize("NFC", value)
```

Apply to display name, relative path, highlighted snippets.

- [ ] **Step 3: Move Anything history behind collapsed details**

In `app.tsx`, change the Anything section:

```tsx
<details className="secondary-section" data-testid="anything-history-details">
  <summary>외부 고급검색 기록</summary>
  <SectionCard eyebrow="Anything history" title="승인 후 다시 열기">
    ...
  </SectionCard>
</details>
```

Default must be closed unless the user has just requested Anything launch.

- [ ] **Step 4: Put search results and selected session linking first**

In `renderSearchSection()`, order must be:

1. current target session card
2. built-in search input
3. index status and refresh button
4. result cards
5. selected file count/link action
6. collapsed Anything
7. advanced Reference Set creation

- [ ] **Step 5: Add frontend test**

In `apps/desktop/src/local-file-search.test.tsx`:

```tsx
expect(screen.getByTestId("anything-history-details")).not.toHaveAttribute("open");
expect(screen.getByRole("heading", { name: "내장 파일찾기" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "세션에 연결" })).toBeInTheDocument();
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm.cmd run desktop:test -- apps/desktop/src/local-file-search.test.tsx
npm.cmd run sidecar:test -- services/sidecar/tests/test_local_file_search.py
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add services/sidecar/src/gongmu_sidecar/local_file_search.py services/sidecar/tests/test_local_file_search.py apps/desktop/src/app.tsx apps/desktop/src/styles.css apps/desktop/src/local-file-search.test.tsx
git commit -m "feat: prioritize built-in local file search"
```

---

## Task 7: Humanize Execution Logs

**Files:**

- Create: `apps/desktop/src/executionLogDisplay.ts`
- Modify: `apps/desktop/src/app.tsx`
- Modify: `apps/desktop/src/styles.css`
- Test: `apps/desktop/src/app.test.tsx`

- [ ] **Step 1: Add display helper tests**

Create or extend `apps/desktop/src/app.test.tsx` with:

```tsx
expect(screen.getByText("지식폴더 색인 완료")).toBeInTheDocument();
expect(screen.queryByText("knowledge.ingest.job.run")).not.toBeInTheDocument();
```

Use mocked execution log:

```ts
{
  id: "log-1",
  feature: "knowledge",
  action: "knowledge.ingest.job.run",
  status: "completed",
  created_at: "2026-05-18T00:00:00Z",
  inputs: { source_id: "source-1" },
  outputs: { processed_count: 17, failed_count: 0 },
}
```

- [ ] **Step 2: Create log display helper**

Create `apps/desktop/src/executionLogDisplay.ts`:

```ts
import type { ExecutionLogItem } from "./api";

const ACTION_TITLES: Record<string, string> = {
  "knowledge.ingest.job.run": "지식폴더 색인 완료",
  "knowledge.source.scan": "지식 소스 폴더 스캔",
  "work_session.turn.failed": "업무대화 응답 실패",
  "work_session.turn.completed": "업무대화 응답 완료",
  "documents.content_base.created": "콘텐츠 베이스 생성",
  "documents.finalize.applied": "최종 문서 저장",
  "settings.llm.test.completed": "LLM 연결 테스트 성공",
  "settings.llm.test.failed": "LLM 연결 테스트 실패",
};

export function describeExecutionLog(log: ExecutionLogItem) {
  return {
    title: ACTION_TITLES[log.action] ?? log.action,
    feature: featureLabel(log.feature),
    status: statusLabel(log.status),
    showDeveloperDetail: !ACTION_TITLES[log.action],
  };
}

function featureLabel(feature: string) {
  return {
    knowledge: "지식폴더",
    chat: "업무대화",
    documents: "문서작성",
    settings: "환경설정",
    approval: "승인",
    search: "파일검색",
  }[feature] ?? feature;
}

function statusLabel(status: string) {
  return {
    completed: "성공",
    success: "성공",
    failed: "실패",
    pending: "대기",
    approved: "승인됨",
  }[status] ?? status;
}
```

- [ ] **Step 3: Render user summary first and raw JSON in details**

In `renderLogsSection()`:

```tsx
const display = describeExecutionLog(log);
...
<h3>{display.title}</h3>
<p>{display.feature} / {display.status}</p>
<details>
  <summary>개발자 정보</summary>
  <pre>{JSON.stringify({ action: log.action, inputs: log.inputs, outputs: log.outputs }, null, 2)}</pre>
</details>
```

- [ ] **Step 4: Add filters**

Add state:

```ts
const [logFeatureFilter, setLogFeatureFilter] = useState("all");
const [logStatusFilter, setLogStatusFilter] = useState("all");
```

Render select controls above the log list and filter `snapshot.logs`.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm.cmd run desktop:test -- apps/desktop/src/app.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/desktop/src/executionLogDisplay.ts apps/desktop/src/app.tsx apps/desktop/src/styles.css apps/desktop/src/app.test.tsx
git commit -m "feat: humanize execution log summaries"
```

---

## Task 8: Clarify Document Output Type And Settings Sections

**Files:**

- Modify: `apps/desktop/src/app.tsx`
- Modify: `apps/desktop/src/styles.css`
- Modify: `apps/desktop/src/document-workflow-handoff.test.tsx`
- Modify: `apps/desktop/src/settings-edit.test.tsx`

- [ ] **Step 1: Write document output type test**

In `apps/desktop/src/document-workflow-handoff.test.tsx`:

```tsx
expect(screen.getByRole("group", { name: "출력 유형" })).toHaveTextContent("시행문");
expect(screen.getByRole("group", { name: "출력 유형" })).toHaveTextContent("1페이지 보고서");
expect(screen.queryByText("보고서형")).not.toBeInTheDocument();
expect(screen.getByText("고급 문서 구조 설정")).toBeInTheDocument();
```

- [ ] **Step 2: Move old template into advanced details**

In `renderDocumentSection()`:

```tsx
<fieldset aria-label="출력 유형" className="document-output-type-grid">
  ...
</fieldset>
<details className="secondary-section">
  <summary>고급 문서 구조 설정</summary>
  <label className="select-field">
    내부 구성 프리셋
    <select value={documentForm.template_key} ...>
      <option value="report">보고서형</option>
      <option value="meeting">회의자료형</option>
      <option value="review">검토메모형</option>
    </select>
  </label>
</details>
```

- [ ] **Step 3: Write settings section test**

In `apps/desktop/src/settings-edit.test.tsx`:

```tsx
expect(screen.getByRole("button", { name: "모델 연결" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "지식/임베딩" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "개인화" })).toBeInTheDocument();
expect(screen.getByText(/현재 활성 프로필/)).toBeInTheDocument();
```

- [ ] **Step 4: Split settings UI into visible sections**

In `renderSettingsSection()` add segmented local state:

```ts
const [settingsPanel, setSettingsPanel] = useState<"model" | "knowledge" | "personalization" | "advanced">("model");
```

Render section buttons:

```tsx
<div className="settings-tabbar" role="tablist" aria-label="환경설정 섹션">
  <button role="tab" aria-selected={settingsPanel === "model"} onClick={() => setSettingsPanel("model")}>모델 연결</button>
  <button role="tab" aria-selected={settingsPanel === "knowledge"} onClick={() => setSettingsPanel("knowledge")}>지식/임베딩</button>
  <button role="tab" aria-selected={settingsPanel === "personalization"} onClick={() => setSettingsPanel("personalization")}>개인화</button>
  <button role="tab" aria-selected={settingsPanel === "advanced"} onClick={() => setSettingsPanel("advanced")}>고급</button>
</div>
```

Only render controls belonging to the selected section.

- [ ] **Step 5: Add active profile card**

In model settings section:

```tsx
<div className="settings-profile-card">
  <span className="pill">현재 활성 프로필</span>
  <strong>{settingsForm.llm_mode} / {settingsForm.llm_provider}</strong>
  <p>{settingsForm.llm_model}</p>
  <p className="subtle-text">{settingsForm.internal_api_base_url || selectedProviderPreset.baseUrl}</p>
</div>
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm.cmd run desktop:test -- apps/desktop/src/document-workflow-handoff.test.tsx apps/desktop/src/settings-edit.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/desktop/src/app.tsx apps/desktop/src/styles.css apps/desktop/src/document-workflow-handoff.test.tsx apps/desktop/src/settings-edit.test.tsx
git commit -m "feat: clarify document and model settings choices"
```

---

## Task 9: Computer-Use Regression Validation And Documentation

**Files:**

- Create: `docs/operations/2026-05-18-gongmu-ui-usability-improvement-validation.md`
- Modify: `docs/operations/2026-05-18-gongmu-ui-usability-audit.md`

- [ ] **Step 1: Run fresh automated verification**

Run:

```powershell
npm.cmd run desktop:test
npm.cmd run sidecar:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected:

- desktop tests pass
- sidecar tests pass
- cargo check pass

- [ ] **Step 2: Run dev UI**

Confirm:

```powershell
Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:8765/health
Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:5173/
```

Expected:

- sidecar 200 with `status=ok`
- frontend 200

- [ ] **Step 3: Computer-use checklist**

Using Browser computer-use, verify:

- App initial usable shell appears in under 5 seconds even if knowledge documents are slow.
- `내 지식폴더` tablist exposes `대시보드`, `색인/진단`, `검색/검증`.
- `색인/진단` shows stage timeline and opens `GraphRAG 로그 뷰어` modal.
- 업무대화 completed response does not show pending placeholder.
- 업무대화 context strip shows knowledge/file/attachment counts.
- 파일검색 shows built-in search before Anything history.
- 실행기록 shows Korean titles and raw JSON only inside `개발자 정보`.
- 문서작성 primary output choices are `시행문`, `1페이지 보고서`, `풀버전 보고서`, `이메일`.
- 환경설정 shows separate `모델 연결`, `지식/임베딩`, `개인화`, `고급` sections.

- [ ] **Step 4: Write validation document**

Create `docs/operations/2026-05-18-gongmu-ui-usability-improvement-validation.md` with:

```md
# Gongmu UI/UX 개선 검증 기록

작성일: 2026-05-18

## 검증 환경

- Windows Codex desktop session
- Frontend: http://127.0.0.1:5173/
- Sidecar: http://127.0.0.1:8765/

## 자동 검증

- npm.cmd run desktop:test: PASS/FAIL
- npm.cmd run sidecar:test: PASS/FAIL
- cargo check: PASS/FAIL

## 컴퓨터유즈 검증

| 항목 | 결과 | 메모 |
| --- | --- | --- |
| 초기 shell 5초 이내 표시 |  |  |
| 지식폴더 3탭 |  |  |
| GraphRAG 로그 뷰어 |  |  |
| 업무대화 pending 제거 |  |  |
| context evidence strip |  |  |
| 파일검색 우선순위 |  |  |
| 실행기록 한국어 요약 |  |  |
| 문서작성 출력 유형 |  |  |
| 환경설정 섹션화 |  |  |

## 남은 리스크

- Tauri native-only 파일 열기/폴더 열기/Anything 실행은 별도 네이티브 검증 필요.
- 실제 멀티모달 모델 이미지 분석은 공급자별 API payload 지원 구현 후 재검증 필요.
```

- [ ] **Step 5: Commit**

```powershell
git add docs/operations/2026-05-18-gongmu-ui-usability-improvement-validation.md docs/operations/2026-05-18-gongmu-ui-usability-audit.md
git commit -m "docs: record ui usability improvement validation"
```

---

## Final Verification Gate

Before claiming the improvement branch is complete:

```powershell
npm.cmd run desktop:test
npm.cmd run sidecar:test
node scripts/portable-run.mjs cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Optional but recommended before user test package:

```powershell
npm.cmd run desktop:bundle
```

Do not run `desktop:bundle` for every small UI task. Use it only after Slice A or Slice B is complete, or when installer/offline package behavior is being verified.

---

## Acceptance Criteria

- 앱 첫 화면은 sidecar가 정상일 때 5초 안에 shell UI를 보여준다.
- 무거운 지식/로그 API가 느려도 업무대화, 일정, 기본 메뉴 이동은 막히지 않는다.
- 업무대화 완료 답변에는 pending placeholder가 남지 않는다.
- 업무대화 입력 영역에서 이번 요청에 포함될 지식/파일/첨부 상태가 보인다.
- 지식폴더는 `대시보드`, `색인/진단`, `검색/검증`으로 명확히 구분된다.
- GraphRAG ingestion 화면은 stage별 진행률, 문제 파일, 로그 뷰어를 제공한다.
- 파일검색은 내장 검색이 주 흐름이고 Anything은 접힌 보조 흐름이다.
- 실행기록 기본 목록은 한국어 사용자 문장으로 보이고 raw JSON은 접혀 있다.
- 문서작성은 최종 출력 유형 4개가 중심이고 과거 내부 템플릿은 고급설정으로 내려간다.
- 환경설정은 모델 연결/지식 임베딩/개인화/고급으로 분리된다.

---

## Self-Review

Spec coverage:

- 초기 로딩 지연: Task 1
- 업무대화 pending/latency: Task 2
- 업무대화 GraphRAG/파일/첨부 상태: Task 3
- 지식폴더 IA: Task 4
- GraphRAG 진단/로그: Task 5
- 파일검색/Anything 정리: Task 6
- 실행기록 한국어화: Task 7
- 문서작성/환경설정 정리: Task 8
- 컴퓨터유즈 재검증: Task 9

Placeholder scan:

- No `TBD`
- No `TODO`
- No "similar to"
- All tasks include exact files and commands

Type consistency:

- `WorkspaceDeferredGroup`, `mergeWorkspaceSnapshot`, `buildChatContextSummary`, `describeExecutionLog`, `summarizeKnowledgeQuality` are defined before use.
- Existing `KnowledgeWorkspacePanel` values can remain `sources | indexing | search`; only labels change to Korean IA labels.

