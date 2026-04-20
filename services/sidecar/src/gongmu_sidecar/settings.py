from __future__ import annotations

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class SidecarSettings(BaseSettings):
    llm_mode: Literal["local_first", "internal_server"] = "local_first"
    anything_launch_mode: Literal["external_link_only"] = "external_link_only"
    default_template_key: Literal["report", "meeting", "review"] = "report"
    internal_api_base_url: str | None = None

    model_config = SettingsConfigDict(env_prefix="GONGMU_", extra="ignore")
