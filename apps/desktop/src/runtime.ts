import { invoke } from "@tauri-apps/api/core";

const DEFAULT_SIDECAR_URL = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:8765";

export type DesktopRuntimeStatus = {
  available: boolean;
  mode: "tauri" | "browser";
  sidecar_url: string;
  anything_available: boolean;
  anything_mode: "external_app_detected" | "install_page_fallback";
  anything_path: string | null;
  anything_autopaste_enabled: boolean;
  running: boolean;
  managed: boolean;
  auto_restart_recommended: boolean;
  log_path: string | null;
  detail: string;
};

function isTauriRuntimeAvailable() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function browserFallback(
  detail = "브라우저 모드에서는 업무 엔진을 직접 제어할 수 없습니다.",
): DesktopRuntimeStatus {
  return {
    available: false,
    mode: "browser",
    sidecar_url: DEFAULT_SIDECAR_URL,
    anything_available: false,
    anything_mode: "install_page_fallback",
    anything_path: null,
    anything_autopaste_enabled: false,
    running: false,
    managed: false,
    auto_restart_recommended: false,
    log_path: null,
    detail,
  };
}

export async function loadDesktopRuntimeStatus(): Promise<DesktopRuntimeStatus> {
  if (!isTauriRuntimeAvailable()) {
    return browserFallback();
  }

  try {
    return await invoke<DesktopRuntimeStatus>("desktop_runtime_status");
  } catch (error) {
    return browserFallback(error instanceof Error ? error.message : "업무 엔진 상태를 확인하지 못했습니다.");
  }
}

export async function startDesktopSidecar(): Promise<DesktopRuntimeStatus> {
  if (!isTauriRuntimeAvailable()) {
    return browserFallback();
  }

  return invoke<DesktopRuntimeStatus>("start_desktop_sidecar");
}

export async function stopDesktopSidecar(): Promise<DesktopRuntimeStatus> {
  if (!isTauriRuntimeAvailable()) {
    return browserFallback();
  }

  return invoke<DesktopRuntimeStatus>("stop_desktop_sidecar");
}

export async function restartDesktopSidecar(): Promise<DesktopRuntimeStatus> {
  if (!isTauriRuntimeAvailable()) {
    return browserFallback();
  }

  return invoke<DesktopRuntimeStatus>("restart_desktop_sidecar");
}

export async function openExternalTarget(target: string): Promise<void> {
  if (!isTauriRuntimeAvailable()) {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }

  await invoke("open_external_target", { target });
}

export async function launchAnythingQuery(query: string, fallbackTarget: string): Promise<void> {
  if (!isTauriRuntimeAvailable()) {
    window.open(fallbackTarget, "_blank", "noopener,noreferrer");
    return;
  }

  await invoke("launch_anything_query", { query, fallbackTarget });
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new Error("clipboard API is not available");
  }

  await navigator.clipboard.writeText(text);
}

export async function pickDirectory(): Promise<string | null> {
  if (!isTauriRuntimeAvailable()) {
    return null;
  }

  return invoke<string | null>("pick_directory");
}

export async function setDesktopZoom(scale: number): Promise<number> {
  if (!isTauriRuntimeAvailable()) {
    return scale;
  }

  return invoke<number>("set_desktop_zoom", { scale });
}
