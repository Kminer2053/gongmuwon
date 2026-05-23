from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from gongmu_sidecar.db import Database
from gongmu_sidecar.workspace import ensure_workspace


def test_database_serializes_concurrent_execution_logs(tmp_path: Path) -> None:
    db = Database(ensure_workspace(tmp_path))

    def write_log(index: int) -> str:
        record = db.log(
            feature="concurrency",
            action="write",
            status="success",
            inputs={"index": index},
            outputs={"index": index},
        )
        return record["id"]

    with ThreadPoolExecutor(max_workers=10) as executor:
        ids = list(executor.map(write_log, range(50)))

    rows = db.fetch_all("SELECT * FROM execution_logs WHERE feature = ?", ("concurrency",))
    journal_mode = db.connection.execute("PRAGMA journal_mode").fetchone()[0]
    busy_timeout = db.connection.execute("PRAGMA busy_timeout").fetchone()[0]

    assert len(rows) == 50
    assert len(set(ids)) == 50
    assert journal_mode.lower() in {"wal", "memory"}
    assert busy_timeout >= 5000


def test_database_transaction_rolls_back_grouped_writes(tmp_path: Path) -> None:
    db = Database(ensure_workspace(tmp_path))

    try:
        with db.transaction():
            db.insert(
                "execution_logs",
                {
                    "id": "rolled-back",
                    "feature": "transaction",
                    "action": "first",
                    "status": "pending",
                    "inputs_json": "{}",
                    "outputs_json": "{}",
                    "approval_ticket_id": None,
                    "created_at": "2026-05-23T00:00:00+00:00",
                },
            )
            raise RuntimeError("force rollback")
    except RuntimeError:
        pass

    row = db.fetch_one("SELECT * FROM execution_logs WHERE id = ?", ("rolled-back",))

    assert row is None
