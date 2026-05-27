export type LlmProviderKey =
  | "ollama"
  | "openai"
  | "openrouter"
  | "featherless"
  | "anthropic"
  | "gemini"
  | "nvidia_nim"
  | "custom_openai";

export type LlmProviderPreset = {
  key: LlmProviderKey;
  label: string;
  docsUrl: string;
  defaultBaseUrl: string;
  defaultModel: string;
  modelPlaceholder: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  helperLines: string[];
  supportsAttributionHeaders?: boolean;
  attributionLabel?: string;
  supportsOpenRouterHeaders?: boolean;
};

export const LLM_PROVIDER_PRESETS: Record<LlmProviderKey, LlmProviderPreset> = {
  ollama: {
    key: "ollama",
    label: "Ollama / 로컬 모델",
    docsUrl: "https://github.com/ollama/ollama/blob/main/docs/api.md",
    defaultBaseUrl: "http://127.0.0.1:11434",
    defaultModel: "gemma4:e2b",
    modelPlaceholder: "gemma4:e2b 또는 qwen3.6:27b",
    apiKeyLabel: "API Key (선택)",
    apiKeyPlaceholder: "보통 비워둡니다",
    helperLines: [
      "Ollama 기본 주소는 http://127.0.0.1:11434 입니다.",
      "공무 앱은 sidecar를 통해 /api/chat을 호출하므로 브라우저 CORS 제약을 직접 받지 않습니다.",
    ],
  },
  openai: {
    key: "openai",
    label: "ChatGPT / OpenAI",
    docsUrl: "https://platform.openai.com/docs/api-reference/responses/create",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.5",
    modelPlaceholder: "gpt-5.5",
    apiKeyLabel: "OpenAI API Key",
    apiKeyPlaceholder: "sk-...",
    helperLines: [
      "공식 기본 Base URL은 https://api.openai.com/v1 입니다.",
      "Responses API를 우선 사용하고, 필요하면 Chat Completions 호환 경로로 자동 fallback 합니다.",
    ],
  },
  openrouter: {
    key: "openrouter",
    label: "OpenRouter",
    docsUrl: "https://openrouter.ai/docs/api-reference/overview",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-5.5",
    modelPlaceholder: "openai/gpt-5.5",
    apiKeyLabel: "OpenRouter API Key",
    apiKeyPlaceholder: "sk-or-v1-...",
    helperLines: [
      "공식 기본 Base URL은 https://openrouter.ai/api/v1 입니다.",
      "모델명은 공급자/모델 slug 형식으로 입력합니다.",
    ],
    supportsAttributionHeaders: true,
    attributionLabel: "OpenRouter",
    supportsOpenRouterHeaders: true,
  },
  featherless: {
    key: "featherless",
    label: "Featherless API",
    docsUrl: "https://featherless.ai/docs/api-overview-and-common-options",
    defaultBaseUrl: "https://api.featherless.ai/v1",
    defaultModel: "google/gemma-4-E2B-it",
    modelPlaceholder: "google/gemma-4-E2B-it or a Featherless model slug",
    apiKeyLabel: "Featherless API Key",
    apiKeyPlaceholder: "featherless api key",
    helperLines: [
      "Featherless uses an OpenAI-compatible Chat Completions API.",
      "Use https://api.featherless.ai/v1 as the Base URL; Gongmu appends /chat/completions.",
      "Vision-capable Featherless models can receive image attachments as OpenAI-style data URLs.",
    ],
    supportsAttributionHeaders: true,
    attributionLabel: "Featherless API",
  },
  anthropic: {
    key: "anthropic",
    label: "Claude / Anthropic",
    docsUrl: "https://docs.anthropic.com/en/api/messages",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-20250514",
    modelPlaceholder: "claude-sonnet-4-20250514",
    apiKeyLabel: "Anthropic API Key",
    apiKeyPlaceholder: "sk-ant-...",
    helperLines: [
      "공식 Messages API를 사용합니다.",
      "Anthropic은 x-api-key와 anthropic-version 헤더가 필요합니다.",
    ],
  },
  gemini: {
    key: "gemini",
    label: "Gemini / Google AI",
    docsUrl: "https://ai.google.dev/gemini-api/docs/text-generation",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
    modelPlaceholder: "gemini-2.5-flash",
    apiKeyLabel: "Google AI API Key",
    apiKeyPlaceholder: "AIza...",
    helperLines: [
      "공식 REST generateContent 경로를 사용합니다.",
      "Gemini는 x-goog-api-key 헤더와 models/{model}:generateContent 형식을 사용합니다.",
    ],
  },
  nvidia_nim: {
    key: "nvidia_nim",
    label: "NVIDIA NIM",
    docsUrl: "https://docs.api.nvidia.com/nim/reference/meta-llama3-8b-infer",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "meta/llama-3.1-8b-instruct",
    modelPlaceholder: "meta/llama-3.1-8b-instruct",
    apiKeyLabel: "NVIDIA API Key",
    apiKeyPlaceholder: "nvapi-...",
    helperLines: [
      "NIM 통합 엔드포인트는 OpenAI-compatible chat/completions 계약을 사용합니다.",
      "모델명은 NVIDIA catalog slug를 그대로 입력합니다.",
    ],
  },
  custom_openai: {
    key: "custom_openai",
    label: "커스텀 OpenAI 호환 서버",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat/create",
    defaultBaseUrl: "http://127.0.0.1:9000/v1",
    defaultModel: "gpt-4.1-mini",
    modelPlaceholder: "gpt-4.1-mini 또는 로컬 서버 모델명",
    apiKeyLabel: "API Key (선택)",
    apiKeyPlaceholder: "필요한 경우만 입력",
    helperLines: [
      "vLLM, LM Studio, OpenAI 호환 프록시처럼 /v1/chat/completions를 제공하는 서버에 사용합니다.",
      "Ollama 기본 서버는 가능하면 Ollama / 로컬 모델 preset을 사용하세요.",
    ],
  },
};

export function normalizeProviderKey(provider: string): LlmProviderKey {
  const raw = provider.trim().toLowerCase().replace(/[- ]/g, "_");
  switch (raw) {
    case "ollama":
    case "ollama_native":
      return "ollama";
    case "openai":
    case "chatgpt":
      return "openai";
    case "openrouter":
      return "openrouter";
    case "featherless":
    case "featherless_ai":
    case "featherlessapi":
      return "featherless";
    case "anthropic":
    case "claude":
      return "anthropic";
    case "gemini":
    case "google":
    case "google_gemini":
      return "gemini";
    case "nvidia":
    case "nim":
    case "nvidia_nim":
      return "nvidia_nim";
    case "custom_openai":
    case "openai_compatible":
    default:
      return "custom_openai";
  }
}
