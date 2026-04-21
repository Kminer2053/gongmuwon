from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys


@dataclass(frozen=True)
class WorkspacePaths:
    root: Path
    db_dir: Path
    db_file: Path
    knowledge_root: Path
    knowledge_raw: Path
    knowledge_structured: Path
    knowledge_graph: Path
    documents_root: Path
    content_bases: Path
    drafts: Path
    outputs: Path
    templates: Path
    logs: Path
    cache: Path


def resolve_workspace_root(explicit_root: Path | str | None) -> Path:
    if explicit_root is not None:
        return Path(explicit_root).expanduser().resolve()

    if getattr(sys, "frozen", False):
        return (Path(sys.executable).resolve().parent / "runtime-workspace").resolve()

    repo_root = Path(__file__).resolve().parents[4]
    return (repo_root / "runtime-workspace").resolve()


def ensure_workspace(explicit_root: Path | str | None = None) -> WorkspacePaths:
    root = resolve_workspace_root(explicit_root)
    db_dir = root / "db"
    knowledge_root = root / "knowledge"
    documents_root = root / "documents"

    paths = WorkspacePaths(
        root=root,
        db_dir=db_dir,
        db_file=db_dir / "gongmu.db",
        knowledge_root=knowledge_root,
        knowledge_raw=knowledge_root / "raw",
        knowledge_structured=knowledge_root / "structured",
        knowledge_graph=knowledge_root / "graph",
        documents_root=documents_root,
        content_bases=documents_root / "content-bases",
        drafts=documents_root / "drafts",
        outputs=documents_root / "outputs",
        templates=documents_root / "templates",
        logs=root / "logs",
        cache=root / "cache",
    )

    for path in (
        paths.root,
        paths.db_dir,
        paths.knowledge_root,
        paths.knowledge_raw,
        paths.knowledge_structured,
        paths.knowledge_graph,
        paths.documents_root,
        paths.content_bases,
        paths.drafts,
        paths.outputs,
        paths.templates,
        paths.logs,
        paths.cache,
    ):
        path.mkdir(parents=True, exist_ok=True)

    return paths

