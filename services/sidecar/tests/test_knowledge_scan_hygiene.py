"""P0 스캔 위생(설계서 §7-1,2,4 + §4.2) 회귀 테스트.

1. 임시·잠금 파일(~$, .~lock, .tmp 등) 제외
2. 읽기 실패/최근 수정 파일 = UNSTABLE (deleted 오판 금지)
3. stat-해시-stat 샌드위치 불일치 시 레코드 보류 + needs_rescan 재처리
4. mtime_ns 기록·백필 (비교는 과도기 동안 ISO 문자열 유지)
"""

import os
import pathlib
import time
from pathlib import Path

import pytest

from gongmu_sidecar.app import create_app
from gongmu_sidecar.knowledge import KnowledgeManager


def _make_app(tmp_path: Path):
    app = create_app(tmp_path)
    return app, app.state.test_client_factory()


def _register(client, source: Path, label: str = "업무자료") -> str:
    created = client.post(
        "/api/knowledge/sources",
        json={"label": label, "root_path": str(source)},
    )
    assert created.status_code == 201
    return created.json()["id"]


def _files_by_relative_path(client, source_id: str) -> dict[str, dict]:
    files = client.get(f"/api/knowledge/source-files?source_id={source_id}")
    assert files.status_code == 200
    return {item["relative_path"].replace("\\", "/"): item for item in files.json()["items"]}


# ---------------------------------------------------------------------------
# 1. 임시·잠금 파일 제외 필터
# ---------------------------------------------------------------------------


def test_scan_excludes_office_owner_files(tmp_path: Path) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    (source / "예산보고.md").write_text("# 예산 보고\n\n본문", encoding="utf-8")
    # 한글/오피스가 편집 세션 동안 만드는 소유자 파일 — 확장자는 지원 대상(.hwp)이라
    # 확장자 게이트만으로는 걸러지지 않는다.
    (source / "~$예산보고.hwp").write_bytes(b"\x00owner-lock")
    (source / "~$문서.docx").write_bytes(b"\x00owner-lock")

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)

    scan = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert scan.status_code == 200
    payload = scan.json()
    assert payload["indexed_count"] == 1
    assert payload["metadata_count"] == 0

    indexed = _files_by_relative_path(client, source_id)
    assert set(indexed) == {"예산보고.md"}


def test_is_excluded_covers_temp_and_lock_filename_patterns(tmp_path: Path) -> None:
    app, _client = _make_app(tmp_path)
    manager: KnowledgeManager = app.state.services.knowledge
    root = tmp_path / "src"

    excluded_names = [
        "~$문서.hwp",
        "~$report.docx",
        ".~lock.문서.hwp#",
        "받는중.hwp.crdownload",
        "저장중.hwpx.partial",
        "작업.tmp",
        "작업.TMP",
        "메모.temp",
    ]
    for name in excluded_names:
        assert manager._is_excluded(root / name, root), name

    allowed_names = ["예산보고.hwp", "정리.md", "tmp정리.md", "lock목록.txt"]
    for name in allowed_names:
        assert not manager._is_excluded(root / name, root), name


# ---------------------------------------------------------------------------
# 2. 읽기 실패(잠금) = UNSTABLE, deleted 오판 금지
# ---------------------------------------------------------------------------


def test_locked_file_survives_repeated_scans_without_deleted_marking(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    locked = source / "locked.md"
    locked.write_text("# 잠긴 문서\n\n한글이 열어 둔 파일", encoding="utf-8")
    (source / "stable.md").write_text("# 안정 문서\n\n본문", encoding="utf-8")

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    assert _files_by_relative_path(client, source_id)["locked.md"]["status"] == "indexed"

    # Windows 공유 위반(한글/Excel이 잠근 파일) 시뮬레이션: stat 자체가 실패한다.
    real_stat = pathlib.Path.stat

    def failing_stat(self, *args, **kwargs):
        if self.name == "locked.md":
            raise PermissionError(13, "다른 프로세스가 파일을 사용 중입니다", str(self))
        return real_stat(self, *args, **kwargs)

    monkeypatch.setattr(pathlib.Path, "stat", failing_stat)

    for _ in range(2):
        scan = client.post(f"/api/knowledge/sources/{source_id}/scan")
        assert scan.status_code == 200
        payload = scan.json()
        # seen_paths에 포함돼 삭제 마킹 대상에서 제외되고, 처리만 보류된다.
        assert payload["deleted_count"] == 0
        assert payload["unstable_count"] == 1

    indexed = _files_by_relative_path(client, source_id)
    assert indexed["locked.md"]["status"] == "indexed"
    assert indexed["stable.md"]["status"] == "indexed"


def test_recently_modified_file_is_held_unstable_not_deleted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    settled = source / "settled.md"
    settled.write_text("# 안정 문서\n\n구버전 본문", encoding="utf-8")
    past = time.time() - 7200
    os.utime(settled, (past, past))

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)

    # 운영 기본값 수준의 보류 창을 복원한다 (conftest가 테스트 전역에서 0으로 둠).
    monkeypatch.setattr(KnowledgeManager, "UNSTABLE_MTIME_WINDOW_SECONDS", 3600.0)

    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    baseline = _files_by_relative_path(client, source_id)["settled.md"]
    assert baseline["status"] == "indexed"

    # 신규 파일이 방금 생성됨(쓰기 진행 중일 수 있음) → 이번 회차는 보류, 행 미생성.
    fresh = source / "fresh.md"
    fresh.write_text("# 새 문서\n\n아직 쓰는 중", encoding="utf-8")
    # 기존 파일도 방금 수정됨 → 기존 행 유지(갱신 보류), 삭제 마킹 금지.
    settled.write_text("# 안정 문서\n\n신버전 본문 (쓰는 중)", encoding="utf-8")

    scan = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert scan.status_code == 200
    payload = scan.json()
    assert payload["unstable_count"] == 2
    assert payload["deleted_count"] == 0

    indexed = _files_by_relative_path(client, source_id)
    assert "fresh.md" not in indexed
    assert indexed["settled.md"]["status"] == "indexed"
    assert "구버전" in indexed["settled.md"]["text_excerpt"]


# ---------------------------------------------------------------------------
# 3. stat-해시-stat 샌드위치
# ---------------------------------------------------------------------------


def _racing_sha256(target_name: str, next_content: str):
    """해시 계산 직후 파일이 바뀌는(다른 프로세스 쓰기) 상황을 시뮬레이션한다."""
    real_sha256 = KnowledgeManager._sha256

    def racing(self, path: Path) -> str:
        digest = real_sha256(self, path)
        if path.name == target_name:
            path.write_text(next_content, encoding="utf-8")
        return digest

    return racing


def test_sandwich_mismatch_keeps_existing_record_and_marks_needs_rescan(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    racy = source / "racy.md"
    racy.write_text("# 문서\n\nv1 본문", encoding="utf-8")

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    baseline = _files_by_relative_path(client, source_id)["racy.md"]
    assert "v1" in baseline["text_excerpt"]
    assert baseline["needs_rescan"] == 0

    # 내용이 바뀐 상태에서(스킵 판정 통과 불가) 해시 도중 다시 바뀐다.
    racy.write_text("# 문서\n\nv2 본문 (수정)", encoding="utf-8")
    monkeypatch.setattr(
        KnowledgeManager, "_sha256", _racing_sha256("racy.md", "# 문서\n\nv3 최종 본문입니다")
    )

    scan = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert scan.status_code == 200
    assert scan.json()["unstable_count"] == 1

    held = _files_by_relative_path(client, source_id)["racy.md"]
    # 이번 회차 레코드는 저장되지 않고(v1 유지), 재처리 플래그만 선다.
    assert "v1" in held["text_excerpt"]
    assert held["file_hash"] == baseline["file_hash"]
    assert held["needs_rescan"] == 1

    monkeypatch.undo()
    monkeypatch.setattr(KnowledgeManager, "UNSTABLE_MTIME_WINDOW_SECONDS", 0.0)

    rescan = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert rescan.status_code == 200
    assert rescan.json()["unstable_count"] == 0
    settled = _files_by_relative_path(client, source_id)["racy.md"]
    assert "v3" in settled["text_excerpt"]
    assert settled["needs_rescan"] == 0


def test_sandwich_mismatch_on_new_file_skips_insert_until_stable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    (source / "copying.md").write_text("# 복사 중\n\n앞부분만 도착", encoding="utf-8")

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)

    monkeypatch.setattr(
        KnowledgeManager, "_sha256", _racing_sha256("copying.md", "# 복사 완료\n\n전체 본문 도착")
    )
    scan = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert scan.status_code == 200
    payload = scan.json()
    assert payload["unstable_count"] == 1
    assert payload["indexed_count"] == 0
    assert _files_by_relative_path(client, source_id) == {}

    monkeypatch.undo()
    monkeypatch.setattr(KnowledgeManager, "UNSTABLE_MTIME_WINDOW_SECONDS", 0.0)

    rescan = client.post(f"/api/knowledge/sources/{source_id}/scan")
    assert rescan.status_code == 200
    assert rescan.json()["indexed_count"] == 1
    settled = _files_by_relative_path(client, source_id)["copying.md"]
    assert "복사 완료" in settled["title"] or "전체 본문" in settled["text_excerpt"]


def test_needs_rescan_row_is_reprocessed_even_when_metadata_unchanged(tmp_path: Path) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    (source / "flagged.md").write_text("# 문서\n\n본문", encoding="utf-8")

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    baseline = _files_by_relative_path(client, source_id)["flagged.md"]

    # 샌드위치 보류가 남긴 재처리 플래그를 직접 심는다(파일 메타는 그대로).
    app.state.services.db.execute(
        "UPDATE knowledge_source_files SET needs_rescan = 1 WHERE id = ?",
        (baseline["id"],),
    )

    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    reprocessed = _files_by_relative_path(client, source_id)["flagged.md"]
    # size+mtime이 그대로여도 스킵되지 않고 재처리되어 플래그가 해제된다.
    assert reprocessed["needs_rescan"] == 0
    assert reprocessed["updated_at"] != baseline["updated_at"]


# ---------------------------------------------------------------------------
# 4. mtime_ns 기록·백필
# ---------------------------------------------------------------------------


def test_scan_records_mtime_ns_and_backfills_legacy_rows(tmp_path: Path) -> None:
    source = tmp_path / "source-documents"
    source.mkdir()
    tracked = source / "tracked.md"
    tracked.write_text("# 문서\n\n본문", encoding="utf-8")

    app, client = _make_app(tmp_path)
    source_id = _register(client, source)
    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200

    recorded = _files_by_relative_path(client, source_id)["tracked.md"]
    assert recorded["mtime_ns"] == tracked.stat().st_mtime_ns

    # mtime_ns 컬럼 도입 이전에 만들어진 레거시 행 시뮬레이션.
    app.state.services.db.execute(
        "UPDATE knowledge_source_files SET mtime_ns = NULL WHERE id = ?",
        (recorded["id"],),
    )

    assert client.post(f"/api/knowledge/sources/{source_id}/scan").status_code == 200
    backfilled = _files_by_relative_path(client, source_id)["tracked.md"]
    # 스킵(unchanged) 경로에서도 mtime_ns만 백필된다 — 비교는 여전히 ISO 문자열.
    assert backfilled["mtime_ns"] == tracked.stat().st_mtime_ns
    assert backfilled["updated_at"] == recorded["updated_at"]
    assert backfilled["file_hash"] == recorded["file_hash"]
