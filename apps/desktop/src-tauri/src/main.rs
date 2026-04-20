#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

const DEFAULT_SIDECAR_URL: &str = "http://127.0.0.1:8765";

#[derive(Default)]
struct SidecarManager {
    child: Mutex<Option<Child>>,
}

#[derive(Clone, Serialize)]
struct DesktopRuntimeStatus {
    available: bool,
    mode: &'static str,
    sidecar_url: String,
    running: bool,
    managed: bool,
    log_path: Option<String>,
    detail: String,
}

struct RuntimePaths {
    repo_root: PathBuf,
    workspace_root: PathBuf,
    sidecar_app_dir: PathBuf,
    log_path: PathBuf,
}

impl RuntimePaths {
    fn detect() -> Self {
        let repo_root = resolve_repo_root();
        let workspace_root = std::env::var("GONGMU_WORKSPACE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| repo_root.join("runtime-workspace"));
        let sidecar_app_dir = repo_root.join("services").join("sidecar").join("src");
        let log_path = workspace_root.join("logs").join("sidecar-runtime.log");

        Self {
            repo_root,
            workspace_root,
            sidecar_app_dir,
            log_path,
        }
    }
}

fn resolve_repo_root() -> PathBuf {
    let mut current = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for _ in 0..3 {
        if let Some(parent) = current.parent() {
            current = parent.to_path_buf();
        }
    }
    current
}

fn resolve_sidecar_addr() -> Result<SocketAddr, String> {
    DEFAULT_SIDECAR_URL
        .strip_prefix("http://")
        .unwrap_or(DEFAULT_SIDECAR_URL)
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .next()
        .ok_or_else(|| "sidecar socket address not found".to_string())
}

fn resolve_python_binary(repo_root: &Path) -> PathBuf {
    if let Ok(value) = std::env::var("GONGMU_PYTHON_BIN") {
        return PathBuf::from(value);
    }

    let candidates = [
        repo_root.join(".venv").join("bin").join("python"),
        repo_root.join(".venv").join("Scripts").join("python.exe"),
    ];

    for candidate in candidates {
        if candidate.exists() {
            return candidate;
        }
    }

    if cfg!(windows) {
        PathBuf::from("python")
    } else {
        PathBuf::from("python3")
    }
}

fn managed_sidecar_is_running(manager: &SidecarManager) -> bool {
    let mut guard = match manager.child.lock() {
        Ok(guard) => guard,
        Err(_) => return false,
    };

    match guard.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(Some(_)) => {
                *guard = None;
                false
            }
            Ok(None) => true,
            Err(_) => {
                *guard = None;
                false
            }
        },
        None => false,
    }
}

fn stop_managed_sidecar(manager: &SidecarManager) -> Result<bool, String> {
    let mut guard = manager
        .child
        .lock()
        .map_err(|_| "sidecar state lock poisoned".to_string())?;

    let Some(child) = guard.as_mut() else {
        return Ok(false);
    };

    child
        .kill()
        .map_err(|error| format!("sidecar stop failed: {error}"))?;
    let _ = child.wait();
    *guard = None;
    Ok(true)
}

fn socket_is_open(addr: &SocketAddr) -> bool {
    TcpStream::connect_timeout(addr, Duration::from_millis(250)).is_ok()
}

fn desktop_runtime_status_inner(manager: &SidecarManager) -> DesktopRuntimeStatus {
    let paths = RuntimePaths::detect();
    let managed = managed_sidecar_is_running(manager);
    let running = resolve_sidecar_addr()
        .map(|addr| socket_is_open(&addr))
        .unwrap_or(false);

    let detail = if running && managed {
        "앱이 sidecar를 관리 중".to_string()
    } else if running {
        "외부에서 실행 중인 sidecar 감지".to_string()
    } else {
        "sidecar 시작 필요".to_string()
    };

    DesktopRuntimeStatus {
        available: true,
        mode: "tauri",
        sidecar_url: DEFAULT_SIDECAR_URL.to_string(),
        running,
        managed,
        log_path: Some(paths.log_path.display().to_string()),
        detail,
    }
}

#[tauri::command]
fn desktop_runtime_status(state: tauri::State<'_, SidecarManager>) -> DesktopRuntimeStatus {
    desktop_runtime_status_inner(state.inner())
}

#[tauri::command]
fn start_desktop_sidecar(
    state: tauri::State<'_, SidecarManager>,
) -> Result<DesktopRuntimeStatus, String> {
    let current = desktop_runtime_status_inner(state.inner());
    if current.running {
        return Ok(current);
    }

    let paths = RuntimePaths::detect();
    fs::create_dir_all(
        paths
            .log_path
            .parent()
            .ok_or_else(|| "invalid sidecar log path".to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::create_dir_all(&paths.workspace_root).map_err(|error| error.to_string())?;

    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.log_path)
        .map_err(|error| error.to_string())?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;

    let python = resolve_python_binary(&paths.repo_root);
    let child = Command::new(python)
        .arg("-m")
        .arg("uvicorn")
        .arg("gongmu_sidecar.app:create_app")
        .arg("--factory")
        .arg("--app-dir")
        .arg(&paths.sidecar_app_dir)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("8765")
        .current_dir(&paths.repo_root)
        .env("PYTHONUNBUFFERED", "1")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| format!("sidecar spawn failed: {error}"))?;

    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "sidecar state lock poisoned".to_string())?;
        *guard = Some(child);
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        let status = desktop_runtime_status_inner(state.inner());
        if status.running {
            return Ok(status);
        }
        thread::sleep(Duration::from_millis(250));
    }

    Err(format!(
        "sidecar did not become reachable in time. check log: {}",
        paths.log_path.display()
    ))
}

#[tauri::command]
fn stop_desktop_sidecar(
    state: tauri::State<'_, SidecarManager>,
) -> Result<DesktopRuntimeStatus, String> {
    stop_managed_sidecar(state.inner())?;

    Ok(desktop_runtime_status_inner(state.inner()))
}

#[tauri::command]
fn restart_desktop_sidecar(
    state: tauri::State<'_, SidecarManager>,
) -> Result<DesktopRuntimeStatus, String> {
    stop_managed_sidecar(state.inner())?;
    start_desktop_sidecar(state)
}

fn main() {
    let app = tauri::Builder::default()
        .manage(SidecarManager::default())
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_status,
            start_desktop_sidecar,
            stop_desktop_sidecar,
            restart_desktop_sidecar
        ])
        .build(tauri::generate_context!())
        .expect("failed to build gongmu desktop");

    app.run(move |_app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
            let sidecar_manager = _app_handle.state::<SidecarManager>();
            let _ = stop_managed_sidecar(sidecar_manager.inner());
        }
    });
}
