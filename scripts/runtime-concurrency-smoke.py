from __future__ import annotations

import argparse
import json
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path

from gongmu_sidecar.app import create_app


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify file search and chat stay responsive during GraphRAG ingestion.")
    parser.add_argument(
        "--root",
        default="runtime-workspace/cache/runtime-concurrency-smoke-20260615",
        help="Sandbox root to recreate for the smoke run.",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if root.exists():
        shutil.rmtree(root)
    workspace = root / "workspace"
    source = root / "source"
    workspace.mkdir(parents=True, exist_ok=True)
    source.mkdir(parents=True, exist_ok=True)
    for index in range(1, 4):
        (source / f"concurrency-evidence-{index}.md").write_text(
            f"# 병행 처리 검증 {index}\n\nGraphRAG 인덱싱 중에도 파일검색과 업무대화가 응답해야 합니다.\n",
            encoding="utf-8",
        )

    app = create_app(workspace)
    setup_client = app.state.test_client_factory()
    ingest_client = app.state.test_client_factory()
    interactive_client = app.state.test_client_factory()
    services = app.state.services

    created = setup_client.post("/api/knowledge/sources", json={"label": "병행 검증", "root_path": str(source)})
    created.raise_for_status()
    source_id = created.json()["id"]
    queued = setup_client.post("/api/knowledge/ingest", json={"source_id": source_id, "run_now": False})
    queued.raise_for_status()
    job_id = queued.json()["job"]["id"]

    original_ingest = services.graphrag._ingest_source_file
    entered_slow_file = threading.Event()

    def slow_ingest(source_file):
        result = original_ingest(source_file)
        entered_slow_file.set()
        time.sleep(1.0)
        return result

    services.graphrag._ingest_source_file = slow_ingest

    run_payload: dict[str, object] = {}

    def run_ingestion() -> None:
        response = ingest_client.post(f"/api/knowledge/ingestion-jobs/{job_id}/run")
        run_payload["status_code"] = response.status_code
        run_payload["body"] = response.json()

    thread = threading.Thread(target=run_ingestion, daemon=True)
    started_at = time.perf_counter()
    thread.start()
    entered = entered_slow_file.wait(timeout=5)

    search_started = time.perf_counter()
    file_search = interactive_client.get("/api/files/search?query=concurrency-evidence&limit=5")
    search_ms = round((time.perf_counter() - search_started) * 1000, 2)

    session = interactive_client.post("/api/work-sessions", json={"title": "병행 처리 검증"})
    session.raise_for_status()
    session_id = session.json()["id"]
    chat_started = time.perf_counter()
    turn = interactive_client.post(
        f"/api/work-sessions/{session_id}/turn",
        json={"text": "업무대화와 파일찾기 사용법을 간단히 안내해줘"},
    )
    chat_ms = round((time.perf_counter() - chat_started) * 1000, 2)

    thread.join(timeout=15)
    total_ms = round((time.perf_counter() - started_at) * 1000, 2)
    jobs = setup_client.get("/api/jobs").json()["items"]
    ingestion_job = setup_client.get("/api/knowledge/ingestion-jobs").json()["items"][0]

    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "workspace": str(workspace),
        "source": str(source),
        "ingestion_job_id": job_id,
        "entered_slow_ingest": entered,
        "file_search_status": file_search.status_code,
        "file_search_result_count": len(file_search.json().get("items", [])),
        "file_search_latency_ms": search_ms,
        "chat_turn_status": turn.status_code,
        "chat_turn_latency_ms": chat_ms,
        "chat_model": turn.json().get("assistant_message", {}).get("model"),
        "ingestion_run_status": run_payload.get("status_code"),
        "ingestion_final_status": ingestion_job.get("status"),
        "total_elapsed_ms": total_ms,
        "work_job_kinds": [job["kind"] for job in jobs],
        "file_search_responsive": search_ms < 2500,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))

    ok = (
        entered
        and file_search.status_code == 200
        and len(file_search.json().get("items", [])) >= 1
        and search_ms < 2500
        and turn.status_code == 201
        and run_payload.get("status_code") == 200
        and ingestion_job.get("status") in {"completed", "partial"}
    )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
