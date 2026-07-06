from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

from .db import Database, now_iso
from .embeddings import tokenize
from .workspace import WorkspacePaths


def slugify(value: str) -> str:
    slug = re.sub(r"[^\w가-힣\s-]", "", value, flags=re.UNICODE).strip().lower()
    slug = re.sub(r"[\s_]+", "-", slug)
    return slug or f"note-{uuid4().hex[:8]}"


class KnowledgeManager:
    TEXT_EXTENSIONS = {".md", ".markdown", ".txt", ".csv", ".json"}
    METADATA_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx", ".hwp", ".hwpx"}
    EXCLUDED_PATH_PARTS = {
        ".git",
        ".hg",
        ".svn",
        ".venv",
        "venv",
        "__pycache__",
        "node_modules",
        "dist",
        "build",
        "target",
    }
    # Windows 스캔 위생(설계서 §7-1): 오피스 소유자 파일(~$), LibreOffice 잠금(.~lock),
    # 다운로드·저장 중간 산출물은 파일명 단위로 제외한다.
    TEMP_FILE_NAME_PREFIXES = ("~$", ".~lock")
    TEMP_FILE_NAME_SUFFIXES = (".tmp", ".temp", ".crdownload", ".partial")
    # 설계서 §4.2: mtime이 이 창(초) 이내면 아직 쓰기 중일 수 있으므로 UNSTABLE로 보류한다.
    UNSTABLE_MTIME_WINDOW_SECONDS: float = 10.0
    # 설계서 §4.2 견적 게이트: 재해시 대상이 이 임계를 넘으면 응답에 exceeds_gate로 표시만
    # 한다(자동 차단 아님 — 진행 판단은 UI 몫).
    DIFF_REHASH_GATE_FILES: int = 100
    DIFF_REHASH_GATE_BYTES: int = 500 * 1024 * 1024

    def __init__(self, paths: WorkspacePaths, db: Database) -> None:
        self.paths = paths
        self.db = db
        self.graph_path = self.paths.knowledge_graph / "graph.json"
        self.graph_html_path = self.paths.knowledge_graph / "graph.html"
        self.graph_report_path = self.paths.knowledge_graph / "GRAPH_REPORT.md"
        # §4.3 MOVED rebind 훅: KnowledgeWikiManager.rebind_moved_source_file가 주입된다
        # (app.Services에서 배선). 스캔이 위키 산출물(문서·카드·FTS)까지 단일 트랜잭션으로
        # 전파할 수 있게 한다. 미주입 시 source_files 행 갱신만 수행한다.
        self.wiki_rebinder: Callable[..., dict[str, Any]] | None = None
        # 이동 반영 후 index.md 즉시 재생성용(주입식 — 미주입 시 다음 인제스트가 수복).
        self.wiki_index_rebuilder: Callable[[], Any] | None = None
        # P3 §5.9 드리프트 감지 훅: WorkTaxonomyManager.detect_drift가 주입된다
        # (스캔 완료 시 확정 taxonomy.folders vs 현재 1단계 폴더 diff에 편승).
        self.drift_detector: Callable[[str], Any] | None = None

    def register_source(self, *, label: str, root_path: str) -> dict[str, Any]:
        normalized_label = label.strip()
        if not normalized_label:
            raise ValueError("knowledge source label is required")

        root = Path(root_path).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError("knowledge source root_path must be an existing directory")

        existing = self.db.fetch_one(
            "SELECT * FROM knowledge_sources WHERE root_path = ?",
            (str(root),),
        )
        if existing is not None:
            self.db.execute(
                "UPDATE knowledge_sources SET label = ?, status = ?, updated_at = ? WHERE id = ?",
                (normalized_label, "active", now_iso(), existing["id"]),
            )
            return self.db.fetch_one(
                "SELECT * FROM knowledge_sources WHERE id = ?",
                (existing["id"],),
            ) or existing

        timestamp = now_iso()
        payload = {
            "id": str(uuid4()),
            "label": normalized_label,
            "root_path": str(root),
            "status": "active",
            "last_scanned_at": None,
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        self.db.insert("knowledge_sources", payload)
        self.db.log(
            feature="knowledge",
            action="knowledge.source.registered",
            status="success",
            inputs={"label": normalized_label, "root_path": str(root)},
            outputs={"source_id": payload["id"]},
        )
        return payload

    def list_sources(self) -> list[dict[str, Any]]:
        return self.db.fetch_all("SELECT * FROM knowledge_sources ORDER BY created_at DESC")

    def list_source_files(self, source_id: str | None = None) -> list[dict[str, Any]]:
        if source_id:
            return self.db.fetch_all(
                "SELECT * FROM knowledge_source_files WHERE source_id = ? ORDER BY updated_at DESC",
                (source_id,),
            )
        return self.db.fetch_all("SELECT * FROM knowledge_source_files ORDER BY updated_at DESC")

    def scan_source(self, source_id: str) -> dict[str, Any]:
        """2-pass 스캔(설계서 §4.2): 판정 수집(메모리) → 일괄 반영.

        워크 중 즉시 INSERT하던 현행을 개편해 ADDED/DELETED 후보를 전부 모은 뒤
        이동 판정(§4.2 [4])을 수행한다. MOVED는 rebind(§4.3)로 처리해 kordoc
        재파싱 없이 태그·요약·검토 이력을 승계한다.
        """
        source = self.db.fetch_one("SELECT * FROM knowledge_sources WHERE id = ?", (source_id,))
        if source is None:
            raise KeyError(source_id)

        root = Path(source["root_path"]).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            self.db.execute(
                "UPDATE knowledge_sources SET status = ?, updated_at = ? WHERE id = ?",
                ("missing", now_iso(), source_id),
            )
            raise ValueError("knowledge source root_path is no longer available")

        decisions = self._collect_scan_decisions(source_id, root)
        scanned_at = now_iso()
        applied = self._apply_scan_decisions(
            source_id=source_id, root=root, decisions=decisions, scanned_at=scanned_at
        )
        if applied.get("moved_count") and self.wiki_index_rebuilder is not None:
            try:
                self.wiki_index_rebuilder()
            except OSError:
                pass
        self.db.execute(
            "UPDATE knowledge_sources SET status = ?, last_scanned_at = ?, updated_at = ? WHERE id = ?",
            ("active", scanned_at, scanned_at, source_id),
        )
        # P3 §5.9: 스캔 완료 시 분류체계 드리프트 감지에 편승(실패해도 스캔은 성공).
        if self.drift_detector is not None:
            try:
                self.drift_detector(source_id)
            except Exception:  # noqa: BLE001 - 드리프트 감지 실패가 스캔을 막으면 안 된다
                pass
        result = {
            "source_id": source_id,
            "status": "completed",
            "failed_count": 0,
            "scanned_at": scanned_at,
            **applied,
        }
        # §4.3-⑦: 실행기록 페이로드에 moved 목록 포함 (스캔 요약 1건 + 이동별 1줄은 _apply_move)
        self.db.log(
            feature="knowledge",
            action="knowledge.source.scanned",
            status="success",
            inputs={"source_id": source_id, "root_path": str(root)},
            outputs=result,
        )
        return result

    def diff_source(self, source_id: str) -> dict[str, Any]:
        """변경 확인 견적(설계서 §9 P1) — **읽기 전용**: 반영 없이 판정 수집만 재사용한다.

        DB를 일절 갱신하지 않으므로(needs_rescan 마킹·mtime_ns 백필·실행기록 포함 전무)
        연속 호출해도 결과가 동일해야 한다. 견적 게이트 초과는 exceeds_gate로 표시만
        하고 진행 판단은 UI에 맡긴다.
        """
        source = self.db.fetch_one("SELECT * FROM knowledge_sources WHERE id = ?", (source_id,))
        if source is None:
            raise KeyError(source_id)
        root = Path(source["root_path"]).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError("knowledge source root_path is no longer available")

        decisions = self._collect_scan_decisions(source_id, root)
        estimate = decisions["rehash_estimate"]
        return {
            "source_id": source_id,
            "added": len(decisions["added"]),
            "modified": len(decisions["modified"]),
            "moved": len(decisions["moved"]),
            "deleted": len(decisions["deleted_rows"]),
            # TOUCHED(해시 동일·메타만 변경)는 사용자 관점 '변경없음'으로 집계한다.
            "unchanged": len(decisions["unchanged"]) + len(decisions["touched"]),
            "unstable": decisions["unstable_count"],
            "moved_items": [
                {"from": str(entry["row"]["file_path"]), "to": str(entry["path"])}
                for entry in decisions["moved"]
            ][:200],
            "rehash_estimate": estimate,
            "exceeds_gate": (
                estimate["files"] > self.DIFF_REHASH_GATE_FILES
                or estimate["bytes"] > self.DIFF_REHASH_GATE_BYTES
            ),
        }

    def _collect_scan_decisions(self, source_id: str, root: Path) -> dict[str, Any]:
        """2-pass의 1단계(§4.2 [0]~[4]): 판정만 수집한다 — **DB 무변경**.

        스캔과 diff 견적이 이 로직을 공유한다. 경로 매칭은 casefold 키(§7-6)로,
        대소문자만 다른 rename이 행 2개를 만들지 않고 같은 행으로 수렴하게 한다
        (DB 저장은 원문 유지 — 반영 단계에서 새 표기로 갱신).
        """
        scan_epoch = time.time()
        rows = self.db.fetch_all(
            "SELECT * FROM knowledge_source_files WHERE source_id = ? AND status != ?",
            (source_id, "deleted"),
        )
        rows_by_exact: dict[str, dict[str, Any]] = {str(row["file_path"]): row for row in rows}
        rows_by_casefold: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            rows_by_casefold.setdefault(str(row["file_path"]).casefold(), []).append(row)

        claimed_row_ids: set[str] = set()
        unchanged: list[dict[str, Any]] = []
        touched: list[dict[str, Any]] = []
        modified: list[dict[str, Any]] = []
        added: list[dict[str, Any]] = []
        moved: list[dict[str, Any]] = []
        rescan_rows: list[dict[str, Any]] = []
        unstable_count = 0
        rehash_files = 0
        rehash_bytes = 0

        for file_path in sorted(root.rglob("*")):
            # [0] 제외 필터 선적용 (P0 §7-1)
            if self._is_excluded(file_path, root):
                continue
            extension = file_path.suffix.lower()
            if extension not in self.TEXT_EXTENSIONS and extension not in self.METADATA_EXTENSIONS:
                continue

            path_text = str(file_path)
            row = rows_by_exact.get(path_text)
            if row is not None and row["id"] in claimed_row_ids:
                row = None
            if row is None:
                # §7-6 casefold 수렴: 대소문자(표기)만 다른 기존 행이 정확히 1개면 그 행으로.
                candidates = [
                    candidate
                    for candidate in rows_by_casefold.get(path_text.casefold(), [])
                    if candidate["id"] not in claimed_row_ids
                ]
                if len(candidates) == 1:
                    row = candidates[0]

            try:
                if not file_path.is_file():
                    continue
                stat_result = file_path.stat()
            except OSError:
                # §7-2: 잠금·권한 오류 = UNSTABLE. 행이 있으면 claim해 삭제 오판을 막고
                # 이번 회차 처리만 보류한다.
                if row is not None:
                    claimed_row_ids.add(row["id"])
                unstable_count += 1
                continue

            if abs(scan_epoch - stat_result.st_mtime) < self.UNSTABLE_MTIME_WINDOW_SECONDS:
                # 방금 수정된(쓰기 진행 중일 수 있는) 파일 — 다음 스캔으로 보류.
                if row is not None:
                    claimed_row_ids.add(row["id"])
                unstable_count += 1
                continue

            if row is not None:
                claimed_row_ids.add(row["id"])
                modified_iso = datetime.fromtimestamp(stat_result.st_mtime, timezone.utc).isoformat()
                metadata_unchanged = (
                    not row.get("needs_rescan")
                    and row["size_bytes"] == stat_result.st_size
                    and row["modified_at"] == modified_iso
                )
                if metadata_unchanged:
                    if str(row["file_path"]) != path_text:
                        # 대소문자만 바뀐 rename — size+mtime 보존으로 내용 동일이 보장되므로
                        # 재해시 없이 MOVED(rebind) 판정한다.
                        moved.append(
                            {"row": row, "path": file_path, "stat": stat_result, "case_only": True}
                        )
                    else:
                        unchanged.append(
                            {
                                "row": row,
                                "backfill_mtime_ns": row.get("mtime_ns") != stat_result.st_mtime_ns,
                                "mtime_ns": stat_result.st_mtime_ns,
                            }
                        )
                    continue
                rehash_files += 1
                rehash_bytes += stat_result.st_size
                file_hash = self._hash_with_sandwich(file_path, stat_result)
                if file_hash is None:
                    # §7-4 샌드위치 불일치 — 반영 단계에서 needs_rescan=1 마킹.
                    rescan_rows.append(row)
                    unstable_count += 1
                    continue
                if str(row.get("file_hash") or "") == str(file_hash):
                    # §4.2 TOUCHED: 해시 동일(내용 불변) — 메타만 갱신, 재추출·재색인 없음.
                    # USB 폴더 교체(전 파일 mtime 변동)가 전량 '수정'으로 과대 표기되지 않게 한다.
                    touched.append({"row": row, "stat": stat_result})
                    continue
                modified.append(
                    {"row": row, "path": file_path, "stat": stat_result, "file_hash": file_hash}
                )
                continue

            # 행 없음 → ADDED 후보. 이동 판정용 해시는 어차피 신규에 필수(추가 I/O 0 — §4.2 [4]).
            rehash_files += 1
            rehash_bytes += stat_result.st_size
            file_hash = self._hash_with_sandwich(file_path, stat_result)
            if file_hash is None:
                unstable_count += 1
                continue
            added.append({"path": file_path, "stat": stat_result, "file_hash": file_hash})

        # [3] DB에 있는데 디스크에서 못 본 행 = DELETED 후보
        deleted_rows = [row for row in rows if row["id"] not in claimed_row_ids]

        # [4] 이동 판정: (size, file_hash) 정확 1:1만 MOVED, 그 외(0개·사본 다수)는
        # ADDED+DELETED 폴백 — 오매칭보다 재파싱이 싸다(§3-5).
        added_by_key: dict[tuple[int, str], list[dict[str, Any]]] = {}
        for candidate in added:
            key = (candidate["stat"].st_size, str(candidate["file_hash"]))
            added_by_key.setdefault(key, []).append(candidate)
        deleted_by_key: dict[tuple[int, str], list[dict[str, Any]]] = {}
        for row in deleted_rows:
            key = (int(row["size_bytes"] or 0), str(row["file_hash"] or ""))
            deleted_by_key.setdefault(key, []).append(row)
        moved_row_ids: set[str] = set()
        moved_added_ids: set[int] = set()
        for key, add_candidates in added_by_key.items():
            if not key[1]:
                continue  # 해시 없는 행은 매칭 불가
            delete_candidates = deleted_by_key.get(key, [])
            if len(add_candidates) != 1 or len(delete_candidates) != 1:
                continue
            candidate = add_candidates[0]
            moved.append(
                {
                    "row": delete_candidates[0],
                    "path": candidate["path"],
                    "stat": candidate["stat"],
                    "case_only": False,
                }
            )
            moved_row_ids.add(delete_candidates[0]["id"])
            moved_added_ids.add(id(candidate))
        added = [candidate for candidate in added if id(candidate) not in moved_added_ids]
        deleted_rows = [row for row in deleted_rows if row["id"] not in moved_row_ids]

        return {
            "unchanged": unchanged,
            "touched": touched,
            "modified": modified,
            "added": added,
            "moved": moved,
            "deleted_rows": deleted_rows,
            "rescan_rows": rescan_rows,
            "unstable_count": unstable_count,
            "rehash_estimate": {"files": rehash_files, "bytes": rehash_bytes},
        }

    def _hash_with_sandwich(self, file_path: Path, stat_before: os.stat_result) -> str | None:
        """stat-해시-stat 샌드위치(§7-4): 해시 도중 파일이 바뀌면 None."""
        try:
            file_hash = self._sha256(file_path)
            stat_after = file_path.stat()
        except OSError:
            return None
        if (
            stat_before.st_size != stat_after.st_size
            or stat_before.st_mtime_ns != stat_after.st_mtime_ns
        ):
            return None
        return file_hash

    def _apply_scan_decisions(
        self,
        *,
        source_id: str,
        root: Path,
        decisions: dict[str, Any],
        scanned_at: str,
    ) -> dict[str, Any]:
        """2-pass의 2단계(§4.2 [5]): 수집된 판정을 일괄 반영한다."""
        indexed_count = 0
        metadata_count = 0
        unstable_count = int(decisions["unstable_count"])
        added_count = 0
        modified_count = 0
        moved_entries: list[dict[str, str]] = []

        def count_status(status: Any) -> None:
            nonlocal indexed_count, metadata_count
            if status == "indexed":
                indexed_count += 1
            else:
                metadata_count += 1

        for entry in decisions["unchanged"]:
            row = entry["row"]
            if entry["backfill_mtime_ns"]:
                # 과도기 전략(§4.2): 비교는 ISO 문자열 유지, mtime_ns는 기록(백필)만 한다.
                self.db.execute(
                    "UPDATE knowledge_source_files SET mtime_ns = ? WHERE id = ?",
                    (entry["mtime_ns"], row["id"]),
                )
            count_status(row["status"])

        for row in decisions["rescan_rows"]:
            # §7-4: 샌드위치 불일치 행은 다음 스캔 강제 재처리 대상으로 마킹한다.
            self.db.execute(
                "UPDATE knowledge_source_files SET needs_rescan = 1, updated_at = ? WHERE id = ?",
                (scanned_at, row["id"]),
            )

        for entry in decisions["touched"]:
            # §4.2 TOUCHED: 내용 불변(해시 동일) — 메타만 갱신하고 재추출은 생략한다.
            row = entry["row"]
            stat_result = entry["stat"]
            self.db.execute(
                "UPDATE knowledge_source_files "
                "SET size_bytes = ?, modified_at = ?, mtime_ns = ?, needs_rescan = 0, updated_at = ? "
                "WHERE id = ?",
                (
                    stat_result.st_size,
                    datetime.fromtimestamp(stat_result.st_mtime, timezone.utc).isoformat(),
                    stat_result.st_mtime_ns,
                    scanned_at,
                    row["id"],
                ),
            )
            count_status(row["status"])

        for candidate in decisions["modified"]:
            try:
                record = self._build_file_record(
                    source_id=source_id, root=root, file_path=candidate["path"]
                )
            except OSError:
                record = None
            if record is None:
                unstable_count += 1
                self.db.execute(
                    "UPDATE knowledge_source_files SET needs_rescan = 1, updated_at = ? WHERE id = ?",
                    (scanned_at, candidate["row"]["id"]),
                )
                continue
            # 대소문자 rename+내용 변경이 겹쳐도 행 id 기준 UPDATE라 행이 늘지 않는다(§7-6).
            self._update_source_file_row(candidate["row"]["id"], record)
            modified_count += 1
            count_status(record["status"])

        for candidate in decisions["added"]:
            try:
                record = self._build_file_record(
                    source_id=source_id, root=root, file_path=candidate["path"]
                )
            except OSError:
                record = None
            if record is None:
                unstable_count += 1
                continue
            self._upsert_source_file(record)
            added_count += 1
            count_status(record["status"])

        for entry in decisions["moved"]:
            moved_entries.append(
                self._apply_move(source_id=source_id, root=root, entry=entry, scanned_at=scanned_at)
            )
            count_status(entry["row"]["status"])

        deleted_count = 0
        for row in decisions["deleted_rows"]:
            self.db.execute(
                "UPDATE knowledge_source_files SET status = ?, updated_at = ? WHERE id = ?",
                ("deleted", scanned_at, row["id"]),
            )
            deleted_count += 1

        return {
            "indexed_count": indexed_count,
            "metadata_count": metadata_count,
            "deleted_count": deleted_count,
            "unstable_count": unstable_count,
            "added_count": added_count,
            "modified_count": modified_count,
            "moved_count": len(moved_entries),
            "unchanged_count": len(decisions["unchanged"]) + len(decisions["touched"]),
            "moved": moved_entries,
        }

    def _apply_move(
        self, *, source_id: str, root: Path, entry: dict[str, Any], scanned_at: str
    ) -> dict[str, str]:
        """MOVED rebind(§4.3): 행 id 보존 + 경로 사본 전파를 파일당 단일 트랜잭션으로.

        ① knowledge_source_files.file_path(+relative_path) 갱신은 여기서,
        ②~⑥(documents·wiki_docs·카드 재투영·FTS·stem 유래 title)은 주입된
        wiki_rebinder가 같은 트랜잭션 안에서 수행한다. 구 카드 unlink는 롤백
        안전을 위해 커밋 후에 한다(P0 refcount 패턴 준수).
        """
        row = entry["row"]
        new_path: Path = entry["path"]
        stat_result: os.stat_result = entry["stat"]
        old_path = str(row["file_path"])
        new_path_text = str(new_path)
        new_relative = new_path.relative_to(root).as_posix()
        old_stem = Path(old_path).stem
        title = str(row.get("title") or "")
        if title == old_stem and new_path.stem != old_stem:
            # stem 폴백 title(추출 실패 문서 등)은 새 파일명 stem으로 갱신한다(§4.3-⑥).
            title = new_path.stem
        modified_iso = datetime.fromtimestamp(stat_result.st_mtime, timezone.utc).isoformat()

        stale_card_path: str | None = None
        with self.db.transaction():
            self.db.execute(
                """
                UPDATE knowledge_source_files
                SET file_path = ?, relative_path = ?, modified_at = ?, mtime_ns = ?,
                    needs_rescan = 0, title = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    new_path_text,
                    new_relative,
                    modified_iso,
                    stat_result.st_mtime_ns,
                    title,
                    scanned_at,
                    row["id"],
                ),
            )
            if self.wiki_rebinder is not None:
                rebind = self.wiki_rebinder(
                    source_file_id=row["id"],
                    old_path=old_path,
                    new_path=new_path_text,
                    new_relative=new_relative,
                )
                stale_card_path = rebind.get("stale_card_path")
        if stale_card_path:
            Path(stale_card_path).unlink(missing_ok=True)

        # §4.3-⑦ 실행기록 1줄: 파일 이동 감지 (재파싱 생략)
        self.db.log(
            feature="knowledge",
            action="knowledge.source.file_moved",
            status="success",
            inputs={"source_id": source_id, "from": old_path},
            outputs={
                "to": new_path_text,
                "case_only": bool(entry.get("case_only")),
                "message": f"파일 이동 감지: {old_path} → {new_path_text} (재파싱 생략)",
            },
        )
        return {"from": old_path, "to": new_path_text}

    def create_candidate(self, *, title: str, body: str, candidate_type: str) -> dict[str, Any]:
        candidate_id = str(uuid4())
        payload = {
            "id": candidate_id,
            "title": title,
            "body": body,
            "candidate_type": candidate_type,
            "status": "pending",
            "proposed_page_slug": slugify(title),
            "proposed_page_type": candidate_type,
            "approved_page_id": None,
            "approved_page_path": None,
            "created_at": now_iso(),
            "approved_at": None,
        }
        self.db.insert("knowledge_candidates", payload)
        self.db.log(
            feature="knowledge",
            action="knowledge.candidate.created",
            status="success",
            inputs={"title": title, "candidate_type": candidate_type},
            outputs={"candidate_id": candidate_id},
        )
        return payload

    def approve_candidate(self, candidate_id: str, page_type: str) -> dict[str, Any]:
        candidate = self.db.fetch_one(
            "SELECT * FROM knowledge_candidates WHERE id = ?",
            (candidate_id,),
        )
        if candidate is None:
            raise KeyError(candidate_id)
        if candidate["status"] == "approved":
            raise ValueError("candidate already approved")

        page_id = str(uuid4())
        page_dir = self.paths.knowledge_structured / f"{page_type}s"
        page_dir.mkdir(parents=True, exist_ok=True)
        slug, page_path = self._available_page_path(page_dir, candidate["proposed_page_slug"])
        title = candidate["title"]
        body = candidate["body"].strip()
        note = (
            "---\n"
            f"id: {page_id}\n"
            f"title: {title}\n"
            f"type: {page_type}\n"
            f"source_candidate_id: {candidate_id}\n"
            "confidence: medium\n"
            f"created_at: {now_iso()}\n"
            "---\n\n"
            f"# {title}\n\n"
            "## 요약\n"
            f"{body}\n\n"
            "## 관련 노트\n"
            "[[지식 인덱스]]\n\n"
            "## 출처\n"
            f"- 반영 후보 메모: {title}\n"
        )
        page_path.write_text(note, encoding="utf-8")

        page = {
            "id": page_id,
            "slug": slug,
            "title": title,
            "page_type": page_type,
            "path": str(page_path),
            "source_candidate_id": candidate_id,
            "created_at": now_iso(),
        }
        self.db.insert("knowledge_pages", page)
        self.db.execute(
            "UPDATE knowledge_candidates SET status = ?, approved_page_id = ?, approved_page_path = ?, approved_at = ? WHERE id = ?",
            ("approved", page_id, str(page_path), now_iso(), candidate_id),
        )
        graph = self._update_graph(page=page, body=body)
        self.db.log(
            feature="knowledge",
            action="knowledge.candidate.approved",
            status="success",
            inputs={"candidate_id": candidate_id, "page_type": page_type},
            outputs={"page_id": page_id, "path": str(page_path), "nodes": graph["node_count"]},
        )
        return {"page": page, "graph": graph}

    def search(self, query: str, limit: int = 5) -> dict[str, Any]:
        """레거시 검색: 승인된 지식 페이지 + 스캔된 원본 파일 키워드 매칭."""
        keyword = set(tokenize(query))
        page_hits = []
        for page in self.db.fetch_all("SELECT * FROM knowledge_pages ORDER BY created_at DESC"):
            try:
                body = Path(page["path"]).read_text(encoding="utf-8", errors="replace")
            except OSError:
                body = str(page.get("title") or "")
            overlap = len(keyword.intersection(tokenize(f"{page['title']}\n{body}")))
            if overlap <= 0 and query.lower() not in body.lower():
                continue
            page_hits.append({"page": page, "score": float(overlap), "keyword_overlap": overlap})
        page_hits.sort(key=lambda hit: hit["keyword_overlap"], reverse=True)

        graph_data = self._read_graph()
        neighbors: list[str] = []
        if graph_data["nodes"]:
            for node in graph_data["nodes"]:
                if query.lower() in node.get("label", "").lower():
                    neighbors.extend(node.get("neighbors", []))

        return {
            "query": query,
            "page_hits": page_hits[:limit],
            "source_file_hits": self._search_source_files(query, limit=limit),
            "graph_neighbors": sorted(set(neighbors)),
        }

    def search_source_files(self, query: str, limit: int = 20) -> dict[str, Any]:
        normalized_query = query.strip().lower()
        if not normalized_query:
            return {"query": query, "items": []}

        safe_limit = max(1, min(limit, 50))
        query_tokens = set(tokenize(normalized_query))
        candidates = self.db.fetch_all(
            """
            SELECT *
            FROM knowledge_source_files
            WHERE status != ?
            ORDER BY updated_at DESC
            """,
            ("deleted",),
        )

        hits: list[dict[str, Any]] = []
        for file_record in candidates:
            score, reasons = self._score_source_file_hit(
                file_record=file_record,
                normalized_query=normalized_query,
                query_tokens=query_tokens,
            )
            if score <= 0:
                continue
            hits.append({"file": file_record, "score": score, "match_reasons": reasons})

        hits.sort(key=lambda hit: (hit["score"], hit["file"].get("updated_at") or ""), reverse=True)
        return {"query": query, "items": hits[:safe_limit]}

    def graph_summary(self) -> dict[str, Any]:
        data = self._read_graph()
        source_graph = self._source_graph_summary()
        nodes_by_id = {
            str(node.get("id")): node
            for node in [*data.get("nodes", []), *source_graph["nodes"]]
            if node.get("id")
        }
        edges = [*(data.get("edges") or data.get("links") or []), *source_graph["edges"]]
        neighbor_map: dict[str, set[str]] = {node_id: set() for node_id in nodes_by_id}
        for edge in edges:
            source = str(edge.get("source") or "")
            target = str(edge.get("target") or "")
            if source and target:
                neighbor_map.setdefault(source, set()).add(target)
                neighbor_map.setdefault(target, set()).add(source)
        nodes = []
        for node_id, node in nodes_by_id.items():
            neighbors = [
                nodes_by_id.get(neighbor, {}).get("label", neighbor)
                for neighbor in sorted(neighbor_map.get(node_id, set()))
            ]
            nodes.append({**node, "neighbors": neighbors})
        return {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "artifacts": {
                "graph_json_path": str(self.graph_path),
                "graph_html_path": str(self.graph_html_path),
                "graph_report_path": str(self.graph_report_path),
            },
            "nodes": nodes[:20],
            "edges": edges[:40],
        }

    def _read_graph(self) -> dict[str, Any]:
        if not self.graph_path.exists():
            return {"nodes": [], "edges": []}
        return json.loads(self.graph_path.read_text(encoding="utf-8"))

    def _update_graph(self, *, page: dict[str, Any], body: str) -> dict[str, Any]:
        """지식 페이지 승인 시 경량 JSON 그래프를 갱신한다 (networkx 미사용)."""
        data = self._read_graph()
        nodes: dict[str, dict[str, Any]] = {
            str(node.get("id")): dict(node) for node in data.get("nodes", []) if node.get("id")
        }
        edges: list[dict[str, Any]] = [
            dict(edge) for edge in (data.get("edges") or data.get("links") or [])
        ]
        edge_keys = {(str(edge.get("source")), str(edge.get("target"))) for edge in edges}

        page_node = str(page["id"])
        nodes[page_node] = {
            "id": page_node,
            "label": page["title"],
            "node_type": page["page_type"],
        }
        keywords = [token for token in tokenize(body) if len(token) >= 2][:6]
        for keyword in keywords:
            concept_id = f"concept:{keyword}"
            nodes.setdefault(concept_id, {"id": concept_id, "label": keyword, "node_type": "concept"})
            if (page_node, concept_id) not in edge_keys:
                edges.append({"source": page_node, "target": concept_id, "relation": "mentions"})
                edge_keys.add((page_node, concept_id))

        neighbor_map: dict[str, list[str]] = {node_id: [] for node_id in nodes}
        for edge in edges:
            source = str(edge.get("source") or "")
            target = str(edge.get("target") or "")
            if source in nodes and target in nodes:
                neighbor_map[source].append(nodes[target].get("label", target))
                neighbor_map[target].append(nodes[source].get("label", source))
        serializable = {
            "nodes": [
                {**node, "neighbors": sorted(set(neighbor_map.get(node_id, []))) }
                for node_id, node in nodes.items()
            ],
            "edges": edges,
        }

        self.graph_path.write_text(
            json.dumps(serializable, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self.graph_html_path.write_text(
            (
                "<!doctype html><html><head><meta charset='utf-8'><title>Gongmu Graph</title>"
                "<style>body{font-family:system-ui;padding:24px;}pre{white-space:pre-wrap;}</style>"
                "</head><body><h1>공무 지식 그래프</h1><pre>"
                + json.dumps(serializable, ensure_ascii=False, indent=2)
                + "</pre></body></html>"
            ),
            encoding="utf-8",
        )
        report = [
            "# GRAPH_REPORT",
            "",
            f"- node_count: {len(serializable['nodes'])}",
            f"- edge_count: {len(edges)}",
            "",
            "## 주요 노드",
        ]
        for node in serializable["nodes"][:10]:
            report.append(f"- {node.get('label', node['id'])} ({node.get('node_type', 'unknown')})")
        self.graph_report_path.write_text("\n".join(report), encoding="utf-8")
        return {
            "node_count": len(serializable["nodes"]),
            "edge_count": len(edges),
            "graph_json_path": str(self.graph_path),
            "graph_html_path": str(self.graph_html_path),
            "graph_report_path": str(self.graph_report_path),
        }

    def _available_page_path(self, page_dir: Path, slug: str) -> tuple[str, Path]:
        candidate_slug = slug
        counter = 2
        while True:
            candidate_path = page_dir / f"{candidate_slug}.md"
            if not candidate_path.exists():
                return candidate_slug, candidate_path
            candidate_slug = f"{slug}-{counter}"
            counter += 1

    def _is_excluded(self, path: Path, root: Path | None = None) -> bool:
        """루트 기준 상대 경로 조각만 검사한다.

        절대 경로 전체를 검사하면 지식폴더가 점(.) 디렉터리(예: .claude 작업트리)
        아래에 있을 때 루트의 조상 경로 때문에 모든 파일이 제외되는 버그가 생긴다.
        """
        parts = path.relative_to(root).parts if root is not None else path.parts
        if any(part in self.EXCLUDED_PATH_PARTS or part.startswith(".") for part in parts):
            return True
        # 디렉터리 조각과 별개로 파일명 단위 임시·잠금 파일 패턴도 검사한다 (§7-1).
        name = (parts[-1] if parts else path.name).lower()
        if name.startswith(self.TEMP_FILE_NAME_PREFIXES):
            return True
        return name.endswith(self.TEMP_FILE_NAME_SUFFIXES)

    def _build_file_record(self, *, source_id: str, root: Path, file_path: Path) -> dict[str, Any] | None:
        """파일 레코드를 만든다. stat-해시-stat 샌드위치(설계서 §7-4) 불일치면 None.

        해시·발췌 읽기 도중 파일이 바뀌면 'v2 내용이 v1 해시 이름으로 저장'되는
        오염이 생기므로, 앞뒤 stat이 다르면 이번 레코드를 저장하지 않는다.
        """
        stat_before = file_path.stat()
        file_hash = self._sha256(file_path)
        extension = file_path.suffix.lower()
        text: str | None = None
        status = "metadata_only"

        if extension in self.TEXT_EXTENSIONS:
            text = file_path.read_text(encoding="utf-8", errors="replace")
            status = "indexed"
        elif extension in self.METADATA_EXTENSIONS:
            extracted = self._extract_document_text(file_path, extension)
            if extracted.strip():
                text = extracted
                status = "indexed"

        stat_after = file_path.stat()
        if (
            stat_before.st_size != stat_after.st_size
            or stat_before.st_mtime_ns != stat_after.st_mtime_ns
        ):
            return None

        title = file_path.stem
        text_excerpt: str | None = None
        extracted_text_path: str | None = None
        if text is not None:
            title = self._title_from_text(text, fallback=file_path.stem)
            text_excerpt = self._excerpt(text)
            extracted_path = self.paths.knowledge_raw / "source-files" / source_id / f"{file_hash}.txt"
            extracted_path.parent.mkdir(parents=True, exist_ok=True)
            extracted_path.write_text(text, encoding="utf-8")
            extracted_text_path = str(extracted_path)

        timestamp = now_iso()
        return {
            "id": str(uuid4()),
            "source_id": source_id,
            "file_path": str(file_path),
            "relative_path": file_path.relative_to(root).as_posix(),
            "file_hash": file_hash,
            "size_bytes": stat_after.st_size,
            "modified_at": datetime.fromtimestamp(stat_after.st_mtime, timezone.utc).isoformat(),
            "mtime_ns": stat_after.st_mtime_ns,
            "needs_rescan": 0,
            "status": status,
            "title": title,
            "mime_type": mimetypes.guess_type(file_path.name)[0],
            "text_excerpt": text_excerpt,
            "extracted_text_path": extracted_text_path,
            "created_at": timestamp,
            "updated_at": timestamp,
        }

    def _upsert_source_file(self, payload: dict[str, Any]) -> None:
        existing = self.db.fetch_one(
            "SELECT * FROM knowledge_source_files WHERE source_id = ? AND file_path = ?",
            (payload["source_id"], payload["file_path"]),
        )
        if existing is None:
            self.db.insert("knowledge_source_files", payload)
            return
        self._update_source_file_row(existing["id"], payload)

    def _update_source_file_row(self, row_id: str, payload: dict[str, Any]) -> None:
        self.db.execute(
            """
            UPDATE knowledge_source_files
            SET file_path = ?,
                relative_path = ?,
                file_hash = ?,
                size_bytes = ?,
                modified_at = ?,
                mtime_ns = ?,
                needs_rescan = 0,
                status = ?,
                title = ?,
                mime_type = ?,
                text_excerpt = ?,
                extracted_text_path = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                payload["file_path"],
                payload["relative_path"],
                payload["file_hash"],
                payload["size_bytes"],
                payload["modified_at"],
                payload["mtime_ns"],
                payload["status"],
                payload["title"],
                payload["mime_type"],
                payload["text_excerpt"],
                payload["extracted_text_path"],
                payload["updated_at"],
                row_id,
            ),
        )

    def _sha256(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _title_from_text(self, text: str, fallback: str) -> str:
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                title = stripped.lstrip("#").strip()
                if title:
                    return title
            if stripped:
                return stripped[:80]
        return fallback

    def _excerpt(self, text: str, limit: int = 240) -> str:
        return re.sub(r"\s+", " ", text).strip()[:limit]

    def _extract_document_text(self, file_path: Path, extension: str) -> str:
        if extension == ".docx":
            return self._extract_zip_xml_text(file_path, ["word/document.xml"])
        if extension == ".xlsx":
            return self._extract_xlsx_text(file_path)
        if extension in {".pptx", ".hwpx"}:
            return self._extract_zip_xml_text(file_path, None)
        if extension == ".pdf":
            return self._extract_pdf_text(file_path)
        return ""

    def _extract_zip_xml_text(self, file_path: Path, preferred_members: list[str] | None) -> str:
        try:
            with ZipFile(file_path) as archive:
                names = preferred_members or [
                    name
                    for name in archive.namelist()
                    if name.lower().endswith(".xml") and not name.lower().endswith(".rels")
                ]
                parts: list[str] = []
                for name in names:
                    if name not in archive.namelist():
                        continue
                    parts.extend(self._xml_text_nodes(archive.read(name)))
                return "\n".join(parts)
        except (BadZipFile, KeyError, OSError, ET.ParseError, UnicodeDecodeError):
            return ""

    def _extract_xlsx_text(self, file_path: Path) -> str:
        try:
            with ZipFile(file_path) as archive:
                names = archive.namelist()
                candidates = ["xl/sharedStrings.xml"] + [
                    name
                    for name in names
                    if name.startswith("xl/worksheets/") and name.endswith(".xml")
                ]
                parts: list[str] = []
                for name in candidates:
                    if name in names:
                        parts.extend(self._xml_text_nodes(archive.read(name)))
                return "\n".join(parts)
        except (BadZipFile, KeyError, OSError, ET.ParseError, UnicodeDecodeError):
            return ""

    def _xml_text_nodes(self, raw_xml: bytes) -> list[str]:
        root = ET.fromstring(raw_xml)
        values: list[str] = []
        for element in root.iter():
            tag = element.tag.rsplit("}", 1)[-1]
            if tag in {"t", "v"} and element.text:
                text = element.text.strip()
                if text:
                    values.append(text)
        return values

    def _extract_pdf_text(self, file_path: Path) -> str:
        try:
            from pypdf import PdfReader  # type: ignore
        except Exception:
            return ""
        try:
            reader = PdfReader(str(file_path))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception:
            return ""

    def _source_graph_summary(self) -> dict[str, list[dict[str, Any]]]:
        sources = self.db.fetch_all("SELECT * FROM knowledge_sources WHERE status != ? ORDER BY created_at DESC", ("deleted",))
        files = self.db.fetch_all(
            "SELECT * FROM knowledge_source_files WHERE status != ? ORDER BY updated_at DESC",
            ("deleted",),
        )
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        seen_keywords: set[str] = set()

        for source in sources:
            source_node_id = f"source_folder:{source['id']}"
            nodes.append(
                {
                    "id": source_node_id,
                    "label": source["label"],
                    "node_type": "source_folder",
                    "path": source["root_path"],
                }
            )

        for file_record in files:
            file_node_id = f"source_file:{file_record['id']}"
            source_node_id = f"source_folder:{file_record['source_id']}"
            text = "\n".join(
                value
                for value in [
                    str(file_record.get("title") or ""),
                    str(file_record.get("relative_path") or ""),
                    str(file_record.get("text_excerpt") or ""),
                    self._read_extracted_text(file_record.get("extracted_text_path")),
                ]
                if value
            )
            nodes.append(
                {
                    "id": file_node_id,
                    "label": file_record.get("title") or file_record.get("relative_path") or file_record["file_path"],
                    "node_type": "source_file",
                    "path": file_record["file_path"],
                    "status": file_record["status"],
                }
            )
            edges.append({"source": source_node_id, "target": file_node_id, "relation": "contains"})

            for keyword in [token for token in tokenize(text) if len(token) >= 3][:8]:
                keyword_node_id = f"keyword:{keyword}"
                if keyword_node_id not in seen_keywords:
                    nodes.append({"id": keyword_node_id, "label": keyword, "node_type": "keyword"})
                    seen_keywords.add(keyword_node_id)
                edges.append({"source": file_node_id, "target": keyword_node_id, "relation": "mentions"})

        return {"nodes": nodes, "edges": edges}

    def _search_source_files(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        normalized_query = query.strip().lower()
        if not normalized_query:
            return []

        query_tokens = set(tokenize(normalized_query))
        candidates = self.db.fetch_all(
            """
            SELECT *
            FROM knowledge_source_files
            WHERE status = ?
            ORDER BY updated_at DESC
            """,
            ("indexed",),
        )

        hits: list[dict[str, Any]] = []
        for file_record in candidates:
            haystack = "\n".join(
                str(value or "")
                for value in (
                    file_record.get("title"),
                    file_record.get("relative_path"),
                    file_record.get("text_excerpt"),
                    self._read_extracted_text(file_record.get("extracted_text_path")),
                )
            ).lower()
            overlap = len(query_tokens.intersection(tokenize(haystack)))
            if normalized_query in haystack:
                overlap = max(overlap, 1)
            if overlap == 0:
                continue
            hits.append({"file": file_record, "keyword_overlap": overlap})

        hits.sort(key=lambda hit: hit["keyword_overlap"], reverse=True)
        return hits[:limit]

    def _score_source_file_hit(
        self,
        *,
        file_record: dict[str, Any],
        normalized_query: str,
        query_tokens: set[str],
    ) -> tuple[int, list[str]]:
        title = str(file_record.get("title") or "")
        relative_path = str(file_record.get("relative_path") or "")
        file_path = str(file_record.get("file_path") or "")
        file_name = Path(file_path).name
        excerpt = str(file_record.get("text_excerpt") or "")
        extracted_text = self._read_extracted_text(file_record.get("extracted_text_path"))

        score = 0
        reasons: list[str] = []

        name_haystack = "\n".join([file_name, title]).lower()
        path_haystack = "\n".join([relative_path, file_path]).lower()
        body_haystack = "\n".join([excerpt, extracted_text]).lower()

        if normalized_query in name_haystack:
            score += 120
            reasons.append("파일명")
        if normalized_query in path_haystack:
            score += 80
            reasons.append("경로")
        if body_haystack and normalized_query in body_haystack:
            score += 70
            reasons.append("본문")

        metadata_tokens = set(tokenize("\n".join([file_name, title, relative_path, file_path]).lower()))
        body_tokens = set(tokenize(body_haystack))
        metadata_overlap = len(query_tokens.intersection(metadata_tokens))
        body_overlap = len(query_tokens.intersection(body_tokens))

        if metadata_overlap:
            score += metadata_overlap * 12
            if "파일명" not in reasons and "경로" not in reasons:
                reasons.append("파일정보")
        if body_overlap:
            score += body_overlap * 10
            if "본문" not in reasons:
                reasons.append("본문")
        if file_record.get("status") == "indexed":
            score += 2

        return score, reasons

    def _read_extracted_text(self, path_value: Any) -> str:
        if not path_value:
            return ""
        path = Path(str(path_value))
        if not path.exists() or not path.is_file():
            return ""
        try:
            return path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
