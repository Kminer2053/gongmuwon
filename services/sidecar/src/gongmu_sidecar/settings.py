from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ModeKey = Literal["local_first", "internal_server", "external_model"]
PersonalizationApplyMode = Literal["approval_required", "auto_apply"]
EmbeddingProviderKey = Literal["deterministic", "ollama"]
GraphRAGVectorBackendKey = Literal["sqlite", "chromadb"]


class LlmConnectionProfile(BaseModel):
    provider: str
    model: str
    api_key: str | None = None
    base_url: str | None = None
    site_url: str | None = None
    application_name: str | None = None


def _default_external_provider_profiles() -> dict[str, LlmConnectionProfile]:
    return {
        "openai": LlmConnectionProfile(
            provider="openai",
            model="gpt-5.5",
            base_url="https://api.openai.com/v1",
        ),
        "openrouter": LlmConnectionProfile(
            provider="openrouter",
            model="openai/gpt-5.5",
            base_url="https://openrouter.ai/api/v1",
        ),
        "anthropic": LlmConnectionProfile(
            provider="anthropic",
            model="claude-sonnet-4-20250514",
            base_url="https://api.anthropic.com/v1",
        ),
        "gemini": LlmConnectionProfile(
            provider="gemini",
            model="gemini-2.5-flash",
            base_url="https://generativelanguage.googleapis.com/v1beta",
        ),
        "nvidia_nim": LlmConnectionProfile(
            provider="nvidia_nim",
            model="meta/llama-3.1-8b-instruct",
            base_url="https://integrate.api.nvidia.com/v1",
        ),
        "ollama": LlmConnectionProfile(
            provider="ollama",
            model="qwen3.6:27b",
            base_url="http://127.0.0.1:11434",
        ),
    }


def _default_mode_profile(mode: ModeKey) -> LlmConnectionProfile:
    if mode == "internal_server":
        return LlmConnectionProfile(
            provider="openai_compatible",
            model="gpt-4.1-mini",
            base_url="http://127.0.0.1:9000/v1",
        )
    return LlmConnectionProfile(
        provider="ollama",
        model="qwen3.6:27b",
        base_url="http://127.0.0.1:11434",
    )


class ExternalModelProfiles(BaseModel):
    active_provider: str = "openai"
    providers: dict[str, LlmConnectionProfile] = Field(default_factory=_default_external_provider_profiles)


class WorkspaceLlmProfiles(BaseModel):
    local_first: LlmConnectionProfile = Field(default_factory=lambda: _default_mode_profile("local_first"))
    internal_server: LlmConnectionProfile = Field(default_factory=lambda: _default_mode_profile("internal_server"))
    external_model: ExternalModelProfiles = Field(default_factory=ExternalModelProfiles)


def _copy_profiles(profiles: WorkspaceLlmProfiles) -> WorkspaceLlmProfiles:
    return WorkspaceLlmProfiles.model_validate(profiles.model_dump())


def _profiles_with_active_overrides(base: "SidecarSettings") -> WorkspaceLlmProfiles:
    profiles = _copy_profiles(base.llm_profiles)
    profile = _resolve_profile_slot(profiles, base.llm_mode, base.llm_provider)
    profile.provider = base.llm_provider
    profile.model = base.llm_model
    profile.api_key = base.llm_api_key
    profile.base_url = base.internal_api_base_url
    profile.site_url = base.llm_site_url
    profile.application_name = base.llm_application_name
    if base.llm_mode == "external_model":
        profiles.external_model.active_provider = base.llm_provider
    return profiles


def _resolve_profile_slot(
    profiles: WorkspaceLlmProfiles,
    mode: ModeKey,
    provider: str | None = None,
) -> LlmConnectionProfile:
    if mode == "external_model":
        provider_key = (provider or profiles.external_model.active_provider or "openai").strip() or "openai"
        if provider_key not in profiles.external_model.providers:
            default_profile = _default_external_provider_profiles().get(
                provider_key,
                LlmConnectionProfile(provider=provider_key, model="", base_url=None),
            )
            profiles.external_model.providers[provider_key] = default_profile
        profiles.external_model.active_provider = provider_key
        return profiles.external_model.providers[provider_key]
    return getattr(profiles, mode)


def _sync_active_fields(
    base: "SidecarSettings",
    *,
    mode: ModeKey,
    provider: str | None,
    profiles: WorkspaceLlmProfiles,
    default_template_key: Literal["report", "meeting", "review"] | None = None,
) -> "SidecarSettings":
    profile = _resolve_profile_slot(profiles, mode, provider)
    return base.model_copy(
        update={
            "llm_mode": mode,
            "llm_provider": profile.provider,
            "llm_model": profile.model,
            "llm_api_key": profile.api_key,
            "llm_site_url": profile.site_url,
            "llm_application_name": profile.application_name,
            "internal_api_base_url": profile.base_url,
            "default_template_key": default_template_key or base.default_template_key,
            "llm_profiles": profiles,
        }
    )


class WorkspaceSettingsDefaults(BaseModel):
    llm_mode: ModeKey
    llm_provider: str
    llm_model: str
    llm_api_key: str | None
    llm_site_url: str | None
    llm_application_name: str | None
    anything_launch_mode: Literal["external_app_preferred"]
    default_template_key: Literal["report", "meeting", "review"]
    internal_api_base_url: str | None
    personalization_apply_mode: PersonalizationApplyMode
    embedding_provider: EmbeddingProviderKey
    embedding_model: str
    embedding_base_url: str | None
    embedding_fallback_enabled: bool
    graphrag_vector_backend: GraphRAGVectorBackendKey
    profiles: WorkspaceLlmProfiles


class WorkspaceSettingsPaths(BaseModel):
    workspace_root: str
    database: str
    knowledge_root: str
    documents_root: str
    personalization_root: str


class WorkspaceSettingsResponse(BaseModel):
    defaults: WorkspaceSettingsDefaults
    paths: WorkspaceSettingsPaths


class WorkspaceSettingsUpdate(BaseModel):
    llm_mode: ModeKey | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_site_url: str | None = None
    llm_application_name: str | None = None
    llm_profiles: WorkspaceLlmProfiles | None = None
    default_template_key: Literal["report", "meeting", "review"] | None = None
    internal_api_base_url: str | None = None
    personalization_apply_mode: PersonalizationApplyMode | None = None
    personalization_root: str | None = None
    embedding_provider: EmbeddingProviderKey | None = None
    embedding_model: str | None = None
    embedding_base_url: str | None = None
    embedding_fallback_enabled: bool | None = None
    graphrag_vector_backend: GraphRAGVectorBackendKey | None = None


class SidecarSettings(BaseSettings):
    llm_mode: ModeKey = "local_first"
    llm_provider: str = "ollama"
    llm_model: str = "qwen3.6:27b"
    llm_api_key: str | None = None
    llm_site_url: str | None = None
    llm_application_name: str | None = None
    llm_profiles: WorkspaceLlmProfiles = Field(default_factory=WorkspaceLlmProfiles)
    anything_launch_mode: Literal["external_app_preferred"] = "external_app_preferred"
    default_template_key: Literal["report", "meeting", "review"] = "report"
    internal_api_base_url: str | None = None
    personalization_apply_mode: PersonalizationApplyMode = "approval_required"
    personalization_root: str | None = None
    embedding_provider: EmbeddingProviderKey = "deterministic"
    embedding_model: str = "nomic-embed-text"
    embedding_base_url: str | None = "http://127.0.0.1:11434"
    embedding_fallback_enabled: bool = True
    graphrag_vector_backend: GraphRAGVectorBackendKey = "chromadb"

    model_config = SettingsConfigDict(env_prefix="GONGMU_", extra="ignore")

    @classmethod
    def load(cls, config_file: Path | None = None) -> "SidecarSettings":
        base = cls()
        if config_file is None or not config_file.exists():
            return _sync_active_fields(
                base,
                mode=base.llm_mode,
                provider=base.llm_provider,
                profiles=_profiles_with_active_overrides(base),
            )

        try:
            payload = json.loads(config_file.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            return _sync_active_fields(
                base,
                mode=base.llm_mode,
                provider=base.llm_provider,
                profiles=_profiles_with_active_overrides(base),
            )

        if not isinstance(payload, dict):
            return _sync_active_fields(
                base,
                mode=base.llm_mode,
                provider=base.llm_provider,
                profiles=_profiles_with_active_overrides(base),
            )

        profiles = _profiles_with_active_overrides(base)
        raw_profiles = payload.get("llm_profiles")
        if isinstance(raw_profiles, dict):
            try:
                profiles = WorkspaceLlmProfiles.model_validate(raw_profiles)
            except Exception:
                profiles = _profiles_with_active_overrides(base)
        else:
            legacy_mode = payload.get("llm_mode", base.llm_mode)
            legacy_provider = payload.get("llm_provider", base.llm_provider)
            legacy_profile = _resolve_profile_slot(profiles, legacy_mode, legacy_provider)
            legacy_profile.provider = legacy_provider
            legacy_profile.model = payload.get("llm_model", base.llm_model)
            legacy_profile.api_key = payload.get("llm_api_key", base.llm_api_key)
            legacy_profile.base_url = payload.get("internal_api_base_url", base.internal_api_base_url)
            legacy_profile.site_url = payload.get("llm_site_url", base.llm_site_url)
            legacy_profile.application_name = payload.get(
                "llm_application_name",
                base.llm_application_name,
            )

        mode = payload.get("llm_mode", base.llm_mode)
        provider = payload.get("llm_provider")
        default_template_key = payload.get("default_template_key", base.default_template_key)
        synced = _sync_active_fields(
            base,
            mode=mode,
            provider=provider,
            profiles=profiles,
            default_template_key=default_template_key,
        )
        return synced.model_copy(
            update={
                "anything_launch_mode": payload.get("anything_launch_mode", base.anything_launch_mode),
                "personalization_apply_mode": payload.get(
                    "personalization_apply_mode",
                    base.personalization_apply_mode,
                ),
                "personalization_root": payload.get("personalization_root", base.personalization_root),
                "embedding_provider": payload.get("embedding_provider", base.embedding_provider),
                "embedding_model": payload.get("embedding_model", base.embedding_model),
                "embedding_base_url": payload.get("embedding_base_url", base.embedding_base_url),
                "embedding_fallback_enabled": payload.get(
                    "embedding_fallback_enabled",
                    base.embedding_fallback_enabled,
                ),
                "graphrag_vector_backend": payload.get(
                    "graphrag_vector_backend",
                    base.graphrag_vector_backend,
                ),
            }
        )

    def persist(self, config_file: Path) -> None:
        config_file.write_text(
            json.dumps(
                {
                    "llm_mode": self.llm_mode,
                    "llm_provider": self.llm_provider,
                    "llm_model": self.llm_model,
                    "llm_api_key": self.llm_api_key,
                    "llm_site_url": self.llm_site_url,
                    "llm_application_name": self.llm_application_name,
                    "llm_profiles": self.llm_profiles.model_dump(),
                    "anything_launch_mode": self.anything_launch_mode,
                    "default_template_key": self.default_template_key,
                    "internal_api_base_url": self.internal_api_base_url,
                    "personalization_apply_mode": self.personalization_apply_mode,
                    "personalization_root": self.personalization_root,
                    "embedding_provider": self.embedding_provider,
                    "embedding_model": self.embedding_model,
                    "embedding_base_url": self.embedding_base_url,
                    "embedding_fallback_enabled": self.embedding_fallback_enabled,
                    "graphrag_vector_backend": self.graphrag_vector_backend,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def apply_update(self, payload: WorkspaceSettingsUpdate) -> "SidecarSettings":
        next_profiles = _copy_profiles(payload.llm_profiles or self.llm_profiles)
        next_mode = payload.llm_mode or self.llm_mode
        next_provider = payload.llm_provider

        profile = _resolve_profile_slot(next_profiles, next_mode, next_provider or self.llm_provider)
        profile.provider = next_provider or profile.provider
        profile.model = payload.llm_model or profile.model
        if payload.llm_api_key is not None:
            profile.api_key = payload.llm_api_key
        if payload.llm_site_url is not None:
            profile.site_url = payload.llm_site_url
        if payload.llm_application_name is not None:
            profile.application_name = payload.llm_application_name
        if payload.internal_api_base_url is not None:
            profile.base_url = payload.internal_api_base_url

        next_default_template_key = payload.default_template_key or self.default_template_key
        synced = _sync_active_fields(
            self,
            mode=next_mode,
            provider=profile.provider,
            profiles=next_profiles,
            default_template_key=next_default_template_key,
        )
        return synced.model_copy(
            update={
                "personalization_apply_mode": payload.personalization_apply_mode or self.personalization_apply_mode,
                "personalization_root": payload.personalization_root
                if payload.personalization_root is not None
                else self.personalization_root,
                "embedding_provider": payload.embedding_provider or self.embedding_provider,
                "embedding_model": payload.embedding_model or self.embedding_model,
                "embedding_base_url": payload.embedding_base_url
                if payload.embedding_base_url is not None
                else self.embedding_base_url,
                "embedding_fallback_enabled": payload.embedding_fallback_enabled
                if payload.embedding_fallback_enabled is not None
                else self.embedding_fallback_enabled,
                "graphrag_vector_backend": payload.graphrag_vector_backend or self.graphrag_vector_backend,
            }
        )
