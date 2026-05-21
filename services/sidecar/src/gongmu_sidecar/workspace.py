from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys


@dataclass(frozen=True)
class WorkspacePaths:
    root: Path
    config_file: Path
    db_dir: Path
    db_file: Path
    knowledge_root: Path
    knowledge_raw: Path
    knowledge_structured: Path
    knowledge_graph: Path
    personalization_root: Path
    personalization_session_summaries: Path
    personalization_work_patterns: Path
    personalization_user_preferences: Path
    personalization_entity_aliases: Path
    personalization_extraction_rules: Path
    personalization_feedback_signals: Path
    personalization_audit_log: Path
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
    personalization_root = root / "personalization"
    documents_root = root / "documents"

    paths = WorkspacePaths(
        root=root,
        config_file=root / "settings.json",
        db_dir=db_dir,
        db_file=db_dir / "gongmu.db",
        knowledge_root=knowledge_root,
        knowledge_raw=knowledge_root / "raw",
        knowledge_structured=knowledge_root / "structured",
        knowledge_graph=knowledge_root / "graph",
        personalization_root=personalization_root,
        personalization_session_summaries=personalization_root / "session-summaries",
        personalization_work_patterns=personalization_root / "work-patterns",
        personalization_user_preferences=personalization_root / "user-preferences",
        personalization_entity_aliases=personalization_root / "entity-aliases",
        personalization_extraction_rules=personalization_root / "extraction-rules",
        personalization_feedback_signals=personalization_root / "feedback-signals",
        personalization_audit_log=personalization_root / "audit-log",
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
        paths.personalization_root,
        paths.personalization_session_summaries,
        paths.personalization_work_patterns,
        paths.personalization_user_preferences,
        paths.personalization_entity_aliases,
        paths.personalization_extraction_rules,
        paths.personalization_feedback_signals,
        paths.personalization_audit_log,
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

