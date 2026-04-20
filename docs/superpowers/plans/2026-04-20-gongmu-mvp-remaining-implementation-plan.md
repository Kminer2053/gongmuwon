# Gongmu MVP Remaining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 구현된 공무 MVP 골격을 실제로 이어서 사용할 수 있는 Alpha 수준으로 끌어올리고, 중간 점검과 진행 추적이 쉬운 실행 구조를 만든다.

**Architecture:** 이미 구축된 `apps/desktop` 셸과 `services/sidecar` FastAPI 코어는 유지하고, 남은 공백을 `설정 계약`, `문서 최종 산출`, `지식 탐색`, `파일정리 적용`, `도구/운영 문서`의 다섯 축으로 채운다. 각 축은 `TDD -> 최소 구현 -> 검증 -> 체크포인트 보드 갱신` 순서로 수행한다.

**Tech Stack:** `Tauri 2`, `React 19`, `TypeScript`, `Vitest`, `FastAPI`, `SQLite`, `LanceDB`, `NetworkX`, `pytest`

---

## Current Status Audit

### Verified Today

- `services/sidecar`: 일정, 업무세션, 참고자료, 지식 반영 후보, Content Base, 승인 요청, 파일정리 제안 API가 동작한다.
- `apps/desktop`: 메뉴 순서, 입력 폼, 우측 승인/실행기록 패널, 주요 화면 전환이 동작한다.
- `runtime-workspace`: `db/`, `knowledge/`, `documents/`, `logs/`, `cache/` 구조가 자동 생성된다.
- 검증 결과:
  - `.venv/bin/pytest services/sidecar/tests -q` -> `6 passed`
  - `npm --workspace apps/desktop run test` -> `2 passed`
  - `npm --workspace apps/desktop run build` -> 성공
  - `source "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` -> 성공

### Gaps To Close

1. 데스크톱과 사이드카 사이의 런타임 설정 계약이 없다.
2. 문서작성이 `ContentBase`에서 멈추고 최종 산출 승인/저장까지 닫히지 않는다.
3. 지식 검색과 그래프 산출물이 UI에서 탐색되지 않는다.
4. 파일정리 제안은 생성만 되고 적용/되돌리기가 없다.
5. 도구 목록, 운영 문서, 진행 체크 보드가 코드와 함께 순환하지 않는다.

---

## Execution Prerequisites

이 저장소는 아직 Git 저장소가 아니므로, 체크포인트 추적과 task 단위 커밋을 위해 아래를 한 번만 먼저 실행한다.

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
git init
git add .
git commit -m "chore: snapshot current gongmu mvp baseline"
```

예상 결과:

- `.git/` 생성
- `git log --oneline -1` 에 baseline commit 1건 표시

---

## File Structure For Remaining Work

- `services/sidecar/src/gongmu_sidecar/settings.py`
  - 런타임 설정 계약과 기본 정책을 정의한다.
- `services/sidecar/src/gongmu_sidecar/file_organizer.py`
  - 파일정리 제안 적용/rollback 로직을 캡슐화한다.
- `services/sidecar/src/gongmu_sidecar/tools.py`
  - Tool Manifest를 단일 책임으로 제공한다.
- `services/sidecar/src/gongmu_sidecar/app.py`
  - FastAPI 라우트와 서비스 연결만 담당한다.
- `services/sidecar/src/gongmu_sidecar/documents.py`
  - `ContentBase -> final output` 흐름을 관리한다.
- `services/sidecar/src/gongmu_sidecar/knowledge.py`
  - 지식 검색과 graph summary 반환을 담당한다.
- `services/sidecar/src/gongmu_sidecar/db.py`
  - 남은 테이블(`final_document_outputs`, `file_org_operations`)만 추가한다.
- `apps/desktop/src/api.ts`
  - UI와 사이드카 간 계약을 한 곳에서 관리한다.
- `apps/desktop/src/app.tsx`
  - 현재 단일 셸 안에서 남은 기능 UI를 붙인다.
- `apps/desktop/src/app.test.tsx`
  - 주요 워크플로 UI 회귀를 고정한다.
- `services/sidecar/tests/*.py`
  - 남은 API 워크플로를 TDD로 고정한다.
- `services/sidecar/README.md`
  - 개발/운영 런북을 남긴다.
- `docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md`
  - 매 task 종료 후 상태와 증거를 갱신하는 진행 보드다.

---

### Task 1: Runtime Settings Contract And Verification Bundle

**Files:**
- Create: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/settings.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/app.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/tests/test_bootstrap.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/api.ts`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/app.tsx`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/app.test.tsx`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/package.json`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md`

- [ ] **Step 1: Write the failing test**

Add this test to `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/tests/test_bootstrap.py`:

```python
from pathlib import Path

from gongmu_sidecar.app import create_app


def test_settings_endpoint_exposes_runtime_contract(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    client = app.state.test_client_factory()

    response = client.get("/api/settings")
    assert response.status_code == 200
    payload = response.json()
    assert payload["defaults"]["llm_mode"] == "local_first"
    assert payload["defaults"]["anything_launch_mode"] == "external_link_only"
    assert payload["paths"]["workspace_root"] == str(tmp_path)
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
.venv/bin/pytest services/sidecar/tests/test_bootstrap.py::test_settings_endpoint_exposes_runtime_contract -v
```

Expected:

- FAIL with `404 Not Found` for `/api/settings`

- [ ] **Step 3: Write minimal implementation**

Create `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/settings.py`:

```python
from __future__ import annotations

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class SidecarSettings(BaseSettings):
    llm_mode: Literal["local_first", "internal_server"] = "local_first"
    anything_launch_mode: Literal["external_link_only"] = "external_link_only"
    default_template_key: Literal["report", "meeting", "review"] = "report"
    internal_api_base_url: str | None = None

    model_config = SettingsConfigDict(
        env_prefix="GONGMU_",
        extra="ignore",
    )
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/app.py`:

```python
from .settings import SidecarSettings


class AppServices:
    def __init__(self, workspace_root: Path | str | None = None) -> None:
        self.settings = SidecarSettings()
        self.paths: WorkspacePaths = ensure_workspace(workspace_root)
        self.db = Database(self.paths)
        self.knowledge = KnowledgeManager(self.paths, self.db)
        self.documents = DocumentManager(self.paths, self.db)


@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    return {
        "defaults": {
            "llm_mode": services.settings.llm_mode,
            "anything_launch_mode": services.settings.anything_launch_mode,
            "default_template_key": services.settings.default_template_key,
            "internal_api_base_url": services.settings.internal_api_base_url,
        },
        "paths": {
            "workspace_root": str(services.paths.root),
            "database": str(services.paths.db_file),
            "knowledge_root": str(services.paths.knowledge_root),
            "documents_root": str(services.paths.documents_root),
        },
    }
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/api.ts`:

```ts
export type WorkspaceSettings = {
  defaults: {
    llm_mode: "local_first" | "internal_server";
    anything_launch_mode: "external_link_only";
    default_template_key: "report" | "meeting" | "review";
    internal_api_base_url: string | null;
  };
  paths: {
    workspace_root: string;
    database: string;
    knowledge_root: string;
    documents_root: string;
  };
};

export type WorkspaceSnapshot = {
  health: WorkspaceHealth | null;
  settings: WorkspaceSettings | null;
  schedules: ScheduleItem[];
  workSessions: WorkSessionItem[];
  referenceSets: ReferenceSetItem[];
  templates: TemplateItem[];
  knowledgeCandidates: KnowledgeCandidateItem[];
  knowledgePages: KnowledgePageItem[];
  approvalTickets: ApprovalTicketItem[];
  fileProposals: FileProposalItem[];
  logs: ExecutionLogItem[];
};

requestJson<WorkspaceSettings>("/api/settings")
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/app.tsx` to show the live settings in the `기타 환경설정` panel and to fall back to `settings.defaults.default_template_key` when nothing is selected:

```tsx
<div>
  <p className="settings-grid__label">LLM 정책</p>
  <p>{snapshot.settings?.defaults.llm_mode ?? "local_first"}</p>
</div>
<div>
  <p className="settings-grid__label">검색 실행 방식</p>
  <p>{snapshot.settings?.defaults.anything_launch_mode ?? "external_link_only"}</p>
</div>
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/package.json`:

```json
{
  "scripts": {
    "sidecar:test": ".venv/bin/pytest services/sidecar/tests -q",
    "sidecar:serve": ".venv/bin/python -m uvicorn gongmu_sidecar.app:create_app --factory --host 127.0.0.1 --port 8765",
    "desktop:test": "npm --workspace apps/desktop run test",
    "desktop:build": "npm --workspace apps/desktop run build",
    "verify:all": "npm run sidecar:test && npm run desktop:test && npm run desktop:build && source \"$HOME/.cargo/env\" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml"
  }
}
```

- [ ] **Step 4: Run tests to verify it passes**

Run:

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
.venv/bin/pytest services/sidecar/tests/test_bootstrap.py::test_settings_endpoint_exposes_runtime_contract -v
npm --workspace apps/desktop run test
```

Expected:

- `1 passed` for the new bootstrap test
- desktop test suite PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
git add package.json \
  services/sidecar/src/gongmu_sidecar/settings.py \
  services/sidecar/src/gongmu_sidecar/app.py \
  services/sidecar/tests/test_bootstrap.py \
  apps/desktop/src/api.ts \
  apps/desktop/src/app.tsx \
  apps/desktop/src/app.test.tsx \
  docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md
git commit -m "feat: add runtime settings contract"
```

---

### Task 2: Final Document Save Approval Flow

**Files:**
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/db.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/documents.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/app.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/tests/test_api_flows.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/api.ts`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/app.tsx`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/app.test.tsx`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md`

- [ ] **Step 1: Write the failing test**

Append this test to `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/tests/test_api_flows.py`:

```python
def test_document_finalize_requires_approval_and_creates_output(tmp_path: Path) -> None:
    client = _client(tmp_path)

    ref_set = client.post(
        "/api/reference-sets",
        json={"title": "문서 참고", "items": [{"kind": "note", "label": "쟁점", "value": "예산 조정"}]},
    )
    reference_set_id = ref_set.json()["id"]

    content_base = client.post(
        "/api/documents/content-bases",
        json={
            "title": "주간 보고 초안",
            "purpose": "보고서형",
            "reference_set_id": reference_set_id,
            "template_key": "report",
        },
    )
    content_base_id = content_base.json()["id"]

    finalize = client.post(
        "/api/documents/finalize",
        json={"content_base_id": content_base_id, "output_name": "주간보고-2026-04-20"},
    )
    assert finalize.status_code == 202
    ticket_id = finalize.json()["approval_ticket"]["id"]

    decision = client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "최종 저장 승인"},
    )
    assert decision.status_code == 200

    apply = client.post(f"/api/documents/finalize/{ticket_id}/apply")
    assert apply.status_code == 201
    artifact_path = Path(apply.json()["artifact"]["path"])
    assert artifact_path.exists()
    assert artifact_path.parent.name == "outputs"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
.venv/bin/pytest services/sidecar/tests/test_api_flows.py::test_document_finalize_requires_approval_and_creates_output -v
```

Expected:

- FAIL with `404 Not Found` for `/api/documents/finalize`

- [ ] **Step 3: Write minimal implementation**

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/db.py` schema:

```sql
CREATE TABLE IF NOT EXISTS final_document_outputs (
    id TEXT PRIMARY KEY,
    content_base_id TEXT NOT NULL,
    output_name TEXT NOT NULL,
    output_path TEXT NOT NULL,
    approval_ticket_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/documents.py`:

```python
    def request_finalize(self, *, content_base_id: str, output_name: str) -> dict[str, Any]:
        approval_ticket = self.db.create_approval_ticket(
            target_type="document_finalize",
            target_id=content_base_id,
            action="documents.finalize",
        )
        self.db.log(
            feature="documents",
            action="documents.finalize.requested",
            status="pending_approval",
            inputs={"content_base_id": content_base_id, "output_name": output_name},
            outputs={"approval_ticket_id": approval_ticket["id"]},
            approval_ticket_id=approval_ticket["id"],
        )
        return {"approval_ticket": approval_ticket, "output_name": output_name}

    def apply_finalize(self, *, approval_ticket_id: str) -> dict[str, Any]:
        ticket = self.db.fetch_one(
            "SELECT * FROM approval_tickets WHERE id = ?",
            (approval_ticket_id,),
        )
        if ticket is None or ticket["status"] != "approved":
            raise ValueError("approval ticket must be approved before applying")

        content_base = self.db.fetch_one(
            "SELECT * FROM content_bases WHERE id = ?",
            (ticket["target_id"],),
        )
        if content_base is None:
            raise KeyError(ticket["target_id"])

        output_id = str(uuid4())
        output_path = self.paths.outputs / f"{output_id}-{content_base['title']}.md"
        source_path = Path(content_base["artifact_path"])
        output_path.write_text(source_path.read_text(encoding="utf-8"), encoding="utf-8")

        record = {
            "id": output_id,
            "content_base_id": content_base["id"],
            "output_name": content_base["title"],
            "output_path": str(output_path),
            "approval_ticket_id": approval_ticket_id,
            "created_at": now_iso(),
        }
        self.db.insert("final_document_outputs", record)
        self.db.log(
            feature="documents",
            action="documents.finalize.applied",
            status="success",
            inputs={"approval_ticket_id": approval_ticket_id},
            outputs={"output_path": str(output_path)},
            approval_ticket_id=approval_ticket_id,
        )
        return {"artifact": {"path": str(output_path)}, "id": output_id}
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/app.py`:

```python
class FinalizeDocumentRequest(BaseModel):
    content_base_id: str
    output_name: str


@app.post("/api/documents/finalize", status_code=202)
def request_document_finalize(payload: FinalizeDocumentRequest) -> dict[str, Any]:
    return services.documents.request_finalize(
        content_base_id=payload.content_base_id,
        output_name=payload.output_name,
    )


@app.post("/api/documents/finalize/{ticket_id}/apply", status_code=201)
def apply_document_finalize(ticket_id: str) -> dict[str, Any]:
    try:
        return services.documents.apply_finalize(approval_ticket_id=ticket_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/api.ts`:

```ts
export async function requestDocumentFinalize(payload: {
  content_base_id: string;
  output_name: string;
}) {
  return requestJson<{ approval_ticket: ApprovalTicketItem; output_name: string }>(
    "/api/documents/finalize",
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function applyDocumentFinalize(ticketId: string) {
  return requestJson<{ artifact: { path: string }; id: string }>(
    `/api/documents/finalize/${ticketId}/apply`,
    { method: "POST" },
  );
}
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/app.tsx` to expose:

```tsx
<button type="button" onClick={() => requestDocumentFinalize(...)} disabled={!lastContentBase}>
  최종 저장 요청
</button>
```

and in the approval panel:

```tsx
{ticket.action === "documents.finalize" ? (
  <button type="button" className="button-secondary" onClick={() => applyDocumentFinalize(ticket.id)}>
    승인 후 저장 적용
  </button>
) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
.venv/bin/pytest services/sidecar/tests/test_api_flows.py::test_document_finalize_requires_approval_and_creates_output -v
npm --workspace apps/desktop run test
```

Expected:

- new API test PASS
- desktop test suite PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
git add services/sidecar/src/gongmu_sidecar/db.py \
  services/sidecar/src/gongmu_sidecar/documents.py \
  services/sidecar/src/gongmu_sidecar/app.py \
  services/sidecar/tests/test_api_flows.py \
  apps/desktop/src/api.ts \
  apps/desktop/src/app.tsx \
  apps/desktop/src/app.test.tsx \
  docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md
git commit -m "feat: add document finalize approval flow"
```

---

### Task 3: Knowledge Search And Graph Inspector

**Files:**
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/knowledge.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/app.py`
- Create: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/tests/test_knowledge_search.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/api.ts`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/app.tsx`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/app.test.tsx`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md`

- [ ] **Step 1: Write the failing test**

Create `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/tests/test_knowledge_search.py`:

```python
from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_knowledge_search_and_graph_summary_are_exposed(tmp_path: Path) -> None:
    client = _client(tmp_path)

    candidate = client.post(
        "/api/knowledge/candidates/from-note",
        json={"title": "예산편성", "body": "예산편성 일정과 쟁점을 정리한다.", "candidate_type": "topic"},
    )
    candidate_id = candidate.json()["id"]
    client.post(f"/api/knowledge/candidates/{candidate_id}/approve", json={"page_type": "topic"})

    search = client.get("/api/knowledge/search", params={"query": "예산"})
    assert search.status_code == 200
    assert search.json()["vector_hits"]

    graph = client.get("/api/knowledge/graph")
    assert graph.status_code == 200
    assert graph.json()["node_count"] >= 1
    assert graph.json()["artifacts"]["graph_json_path"].endswith("graph.json")
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
.venv/bin/pytest services/sidecar/tests/test_knowledge_search.py -v
```

Expected:

- FAIL with `404 Not Found` for `/api/knowledge/graph`

- [ ] **Step 3: Write minimal implementation**

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/knowledge.py`:

```python
    def graph_summary(self) -> dict[str, Any]:
        data = self._read_graph()
        return {
            "node_count": len(data.get("nodes", [])),
            "edge_count": len(data.get("links", [])),
            "artifacts": {
                "graph_json_path": str(self.graph_path),
                "graph_html_path": str(self.graph_html_path),
                "graph_report_path": str(self.graph_report_path),
            },
            "nodes": data.get("nodes", [])[:20],
        }
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/app.py`:

```python
@app.get("/api/knowledge/graph")
def get_knowledge_graph() -> dict[str, Any]:
    return services.knowledge.graph_summary()
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/api.ts`:

```ts
export type KnowledgeGraphSummary = {
  node_count: number;
  edge_count: number;
  artifacts: {
    graph_json_path: string;
    graph_html_path: string;
    graph_report_path: string;
  };
  nodes: Array<{ id: string; label?: string; node_type?: string; neighbors?: string[] }>;
};

export async function loadKnowledgeGraph() {
  return requestJson<KnowledgeGraphSummary>("/api/knowledge/graph");
}

export async function searchKnowledge(query: string) {
  return requestJson<{
    query: string;
    vector_hits: Array<{ page: KnowledgePageItem; score: number; keyword_overlap: number }>;
    graph_neighbors: string[];
  }>(`/api/knowledge/search?query=${encodeURIComponent(query)}`);
}
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/app.tsx` in the `내 지식폴더` panel to add:

```tsx
<label>
  지식 검색
  <input value={knowledgeQuery} onChange={(event) => setKnowledgeQuery(event.target.value)} placeholder="예: 예산" />
</label>
<button type="button" onClick={() => void runKnowledgeSearch()}>
  검색 실행
</button>
```

and render graph stats:

```tsx
<div className="hint-box">
  <span>graph nodes: {knowledgeGraph?.node_count ?? 0}</span>
  <span>graph edges: {knowledgeGraph?.edge_count ?? 0}</span>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
.venv/bin/pytest services/sidecar/tests/test_knowledge_search.py -v
npm --workspace apps/desktop run test
```

Expected:

- knowledge search test PASS
- desktop test suite PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
git add services/sidecar/src/gongmu_sidecar/knowledge.py \
  services/sidecar/src/gongmu_sidecar/app.py \
  services/sidecar/tests/test_knowledge_search.py \
  apps/desktop/src/api.ts \
  apps/desktop/src/app.tsx \
  apps/desktop/src/app.test.tsx \
  docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md
git commit -m "feat: add knowledge search and graph inspector"
```

---

### Task 4: File Organizer Apply And Rollback

**Files:**
- Create: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/file_organizer.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/db.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/app.py`
- Create: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/tests/test_file_organizer_apply.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/api.ts`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/app.tsx`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md`

- [ ] **Step 1: Write the failing test**

Create `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/tests/test_file_organizer_apply.py`:

```python
from pathlib import Path

from gongmu_sidecar.app import create_app


def _client(tmp_path: Path):
    app = create_app(tmp_path)
    return app.state.test_client_factory()


def test_file_proposal_apply_and_rollback(tmp_path: Path) -> None:
    client = _client(tmp_path)
    incoming = tmp_path / "incoming"
    incoming.mkdir()
    source = incoming / "회의메모.md"
    source.write_text("# 회의메모", encoding="utf-8")

    proposals = client.post("/api/file-organizer/proposals", json={"target_path": str(incoming)})
    proposal_id = proposals.json()["items"][0]["id"]

    request_apply = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply")
    assert request_apply.status_code == 202
    ticket_id = request_apply.json()["approval_ticket"]["id"]

    client.post(
        f"/api/approval-tickets/{ticket_id}/decision",
        json={"status": "approved", "decision_note": "적용 승인"},
    )

    applied = client.post(f"/api/file-organizer/proposals/{proposal_id}/apply/commit")
    assert applied.status_code == 201
    operation_id = applied.json()["operation"]["id"]
    assert Path(applied.json()["operation"]["destination_path"]).exists()

    rollback = client.post(f"/api/file-organizer/operations/{operation_id}/rollback")
    assert rollback.status_code == 200
    assert Path(rollback.json()["restored_path"]).exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
.venv/bin/pytest services/sidecar/tests/test_file_organizer_apply.py -v
```

Expected:

- FAIL with `404 Not Found` for `/api/file-organizer/proposals/{proposal_id}/apply`

- [ ] **Step 3: Write minimal implementation**

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/db.py` schema:

```sql
CREATE TABLE IF NOT EXISTS file_org_operations (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    source_path TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    action TEXT NOT NULL,
    approval_ticket_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rolled_back_at TEXT
);
```

Create `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/file_organizer.py`:

```python
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any
from uuid import uuid4

from .db import Database, now_iso
from .workspace import WorkspacePaths


class FileOrganizer:
    def __init__(self, paths: WorkspacePaths, db: Database) -> None:
        self.paths = paths
        self.db = db

    def request_apply(self, proposal_id: str) -> dict[str, Any]:
        proposal = self.db.fetch_one("SELECT * FROM file_org_proposals WHERE id = ?", (proposal_id,))
        if proposal is None:
            raise KeyError(proposal_id)
        ticket = self.db.create_approval_ticket(
            target_type="file_org_apply",
            target_id=proposal_id,
            action="file_org.apply",
        )
        return {"approval_ticket": ticket, "proposal": proposal}

    def commit_apply(self, proposal_id: str) -> dict[str, Any]:
        proposal = self.db.fetch_one("SELECT * FROM file_org_proposals WHERE id = ?", (proposal_id,))
        source = Path(proposal["target_path"])
        destination = Path(proposal["proposed_destination"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        operation = {
            "id": str(uuid4()),
            "proposal_id": proposal_id,
            "source_path": str(source),
            "destination_path": str(destination),
            "action": "copy",
            "approval_ticket_id": self.db.fetch_all(
                "SELECT id FROM approval_tickets WHERE target_id = ? AND action = 'file_org.apply' ORDER BY requested_at DESC",
                (proposal_id,),
            )[0]["id"],
            "created_at": now_iso(),
            "rolled_back_at": None,
        }
        self.db.insert("file_org_operations", operation)
        return {"operation": operation}

    def rollback(self, operation_id: str) -> dict[str, Any]:
        operation = self.db.fetch_one("SELECT * FROM file_org_operations WHERE id = ?", (operation_id,))
        destination = Path(operation["destination_path"])
        if destination.exists():
            destination.unlink()
        self.db.execute(
            "UPDATE file_org_operations SET rolled_back_at = ? WHERE id = ?",
            (now_iso(), operation_id),
        )
        return {"restored_path": operation["source_path"], "operation_id": operation_id}
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/app.py`:

```python
from .file_organizer import FileOrganizer


class AppServices:
    def __init__(self, workspace_root: Path | str | None = None) -> None:
        self.settings = SidecarSettings()
        self.paths = ensure_workspace(workspace_root)
        self.db = Database(self.paths)
        self.knowledge = KnowledgeManager(self.paths, self.db)
        self.documents = DocumentManager(self.paths, self.db)
        self.file_organizer = FileOrganizer(self.paths, self.db)


@app.post("/api/file-organizer/proposals/{proposal_id}/apply", status_code=202)
def request_file_org_apply(proposal_id: str) -> dict[str, Any]:
    return services.file_organizer.request_apply(proposal_id)


@app.post("/api/file-organizer/proposals/{proposal_id}/apply/commit", status_code=201)
def commit_file_org_apply(proposal_id: str) -> dict[str, Any]:
    return services.file_organizer.commit_apply(proposal_id)


@app.post("/api/file-organizer/operations/{operation_id}/rollback")
def rollback_file_org(operation_id: str) -> dict[str, Any]:
    return services.file_organizer.rollback(operation_id)
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/api.ts`:

```ts
export async function requestFileProposalApply(proposalId: string) {
  return requestJson<{ approval_ticket: ApprovalTicketItem }>(`/api/file-organizer/proposals/${proposalId}/apply`, {
    method: "POST",
  });
}

export async function commitFileProposalApply(proposalId: string) {
  return requestJson<{ operation: { id: string; destination_path: string } }>(
    `/api/file-organizer/proposals/${proposalId}/apply/commit`,
    { method: "POST" },
  );
}

export async function rollbackFileOperation(operationId: string) {
  return requestJson<{ restored_path: string; operation_id: string }>(
    `/api/file-organizer/operations/${operationId}/rollback`,
    { method: "POST" },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
.venv/bin/pytest services/sidecar/tests/test_file_organizer_apply.py -v
.venv/bin/pytest services/sidecar/tests -q
```

Expected:

- file organizer apply/rollback test PASS
- full sidecar suite PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
git add services/sidecar/src/gongmu_sidecar/file_organizer.py \
  services/sidecar/src/gongmu_sidecar/db.py \
  services/sidecar/src/gongmu_sidecar/app.py \
  services/sidecar/tests/test_file_organizer_apply.py \
  apps/desktop/src/api.ts \
  apps/desktop/src/app.tsx \
  docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md
git commit -m "feat: add file organizer apply and rollback"
```

---

### Task 5: Tool Manifest, Runbook, And Checkpoint Hygiene

**Files:**
- Create: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/tools.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/app.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/tests/test_bootstrap.py`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/api.ts`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/app.tsx`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/README.md`
- Modify: `/Users/hoonsbook/Agent_Gongmu_Codex/docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md`

- [ ] **Step 1: Write the failing test**

Append this test to `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/tests/test_bootstrap.py`:

```python
def test_tools_manifest_endpoint_is_exposed(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    client = app.state.test_client_factory()

    response = client.get("/api/tools")
    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["key"] == "ocr"
    assert payload["items"][0]["status"] in {"mvp", "later"}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
.venv/bin/pytest services/sidecar/tests/test_bootstrap.py::test_tools_manifest_endpoint_is_exposed -v
```

Expected:

- FAIL with `404 Not Found` for `/api/tools`

- [ ] **Step 3: Write minimal implementation**

Create `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/tools.py`:

```python
TOOLS = [
    {
        "key": "ocr",
        "label": "OCR",
        "description": "스캔 문서를 참고자료 텍스트로 변환한다.",
        "status": "later",
    },
    {
        "key": "document-summary",
        "label": "문서 요약",
        "description": "긴 문서를 핵심 쟁점과 후속 조치 중심으로 요약한다.",
        "status": "mvp",
    },
    {
        "key": "entity-extract",
        "label": "엔티티 추출",
        "description": "인물, 부서, 사업명을 지식 후보로 정리한다.",
        "status": "mvp",
    },
    {
        "key": "template-check",
        "label": "템플릿 점검",
        "description": "문서 섹션 누락 여부를 점검한다.",
        "status": "mvp",
    },
]
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/src/gongmu_sidecar/app.py`:

```python
from .tools import TOOLS


@app.get("/api/tools")
def list_tools() -> dict[str, Any]:
    return {"items": TOOLS}
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/api.ts`:

```ts
export type ToolManifestItem = {
  key: string;
  label: string;
  description: string;
  status: "mvp" | "later";
};

export async function loadTools() {
  return requestJson<{ items: ToolManifestItem[] }>("/api/tools");
}
```

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/apps/desktop/src/app.tsx` to replace the hardcoded tool cards with the manifest response and render `label`, `description`, `status`.

Modify `/Users/hoonsbook/Agent_Gongmu_Codex/services/sidecar/README.md`:

```md
# Gongmu Sidecar

## Dev Commands

- `npm run sidecar:test`
- `npm run sidecar:serve`
- `npm run desktop:test`
- `npm run desktop:build`
- `npm run verify:all`

## Runtime Notes

- 기본 포트: `127.0.0.1:8765`
- 워크스페이스 루트: `runtime-workspace/`
- 지식 정본: `runtime-workspace/knowledge/structured`
- 문서 산출: `runtime-workspace/documents/`
```

Update `/Users/hoonsbook/Agent_Gongmu_Codex/docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md`:

```md
| W7 | 설치/운영 안정화 | 부분 완료 | dev/runbook/tool manifest 정리 | README + /api/tools |
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
.venv/bin/pytest services/sidecar/tests/test_bootstrap.py::test_tools_manifest_endpoint_is_exposed -v
npm run verify:all
```

Expected:

- tool manifest test PASS
- full verification bundle PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/hoonsbook/Agent_Gongmu_Codex
git add services/sidecar/src/gongmu_sidecar/tools.py \
  services/sidecar/src/gongmu_sidecar/app.py \
  services/sidecar/tests/test_bootstrap.py \
  apps/desktop/src/api.ts \
  apps/desktop/src/app.tsx \
  services/sidecar/README.md \
  docs/superpowers/plans/2026-04-20-gongmu-mvp-checkpoint-board.md
git commit -m "docs: add tool manifest and runbook"
```

---

## Self-Review

### Spec Coverage

- 일정/업무대화/검색 연계: 현재 구현 완료, 남은 설정 계약은 Task 1에서 보강한다.
- 문서작성: `ContentBase`는 완료되어 있고, 최종 저장 승인/산출은 Task 2에서 닫는다.
- 내 지식폴더: 후보 생성/반영은 완료, 검색/그래프 탐색은 Task 3에서 닫는다.
- 파일정리: 제안 생성은 완료, 적용/rollback은 Task 4에서 닫는다.
- 도구/실행기록/환경설정: Tool Manifest와 README, 설정 계약은 Task 1과 Task 5에서 닫는다.

### Placeholder Scan

- `TODO`, `TBD`, `implement later` 같은 표현 없음
- 각 task에 실제 테스트 코드, 명령, 코드 스니펫 포함
- 남은 공백은 task로 모두 연결됨

### Type Consistency

- `ApprovalTicketItem`, `KnowledgeGraphSummary`, `ToolManifestItem`, `WorkspaceSettings` 는 모두 `apps/desktop/src/api.ts`에 정의하고 재사용한다.
- 문서 최종 저장은 `request -> approval -> apply` 3단계를 유지한다.
- 파일정리는 `proposal -> apply request -> commit -> rollback` 4단계를 유지한다.

