from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import uvicorn

from .app import create_app


@dataclass(frozen=True)
class ServerOptions:
    host: str
    port: int
    workspace_root: Path | None


def resolve_server_options() -> ServerOptions:
    workspace_root = os.environ.get("GONGMU_WORKSPACE_ROOT")

    return ServerOptions(
        host=os.environ.get("GONGMU_SIDECAR_HOST", "127.0.0.1"),
        port=int(os.environ.get("GONGMU_SIDECAR_PORT", "8765")),
        workspace_root=Path(workspace_root).expanduser().resolve()
        if workspace_root
        else None,
    )


def main() -> None:
    options = resolve_server_options()
    app = create_app(options.workspace_root)
    uvicorn.run(app, host=options.host, port=options.port)


if __name__ == "__main__":
    main()
