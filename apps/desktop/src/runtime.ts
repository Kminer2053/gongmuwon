import { invoke } from "@tauri-apps/api/core";

const DEFAULT_SIDECAR_URL = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:8765";

export type DesktopRuntimeStatus = {
  available: boolean;
  mode: "tauri" | "browser";
  sidecar_url: string;
  running: boolean;
  managed: boolean;
  log_path: string | null;
  detail: string;
};

function isTauriRuntimeAvailable() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function browserFallback(detail = "브라우저 모드에서는 앱 런타임 제어를 사용할 수 없습니다."): DesktopRuntimeStatus {
  return {
    available: false,
    mode: "browser",
    sidecar_url: DEFAULT_SIDECAR_URL,
    running: false,
    managed: false,
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
    return browserFallback(
      error instanceof Error ? error.message : "런타임 상태를 확인하지 못했습니다.",
    );
  }
}

export async function startDesktopSidecar(): Promise<DesktopRuntimeStatus> {
  if (!isTauriRuntimeAvailable()) {
    return browserFallback();
  }

  return invoke<DesktopRuntimeStatus>("start_desktop_sidecar");
}
