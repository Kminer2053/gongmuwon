#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::path::BaseDirectory;
use tauri::Manager;

const DEFAULT_SIDECAR_URL: &str = "http://127.0.0.1:8765";
const BUNDLED_SIDECAR_RESOURCE_PATH: &str =
    "sidecar/windows-x64/gongmu-sidecar/gongmu-sidecar.exe";

fn bundled_sidecar_resource_path() -> PathBuf {
    PathBuf::from(BUNDLED_SIDECAR_RESOURCE_PATH)
}

#[derive(Default)]
struct SidecarManager {
    child: Mutex<Option<Child>>,
    last_exit: Mutex<Option<SidecarExitReason>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SidecarExitReason {
    ManualStop,
    Crashed,
}

#[derive(Clone, Serialize)]
struct DesktopRuntimeStatus {
    available: bool,
    mode: &'static str,
    sidecar_url: String,
    running: bool,
    managed: bool,
    auto_restart_recommended: bool,
    log_path: Option<String>,
    detail: String,
}

struct RuntimePaths {
    repo_root: PathBuf,
    workspace_root: PathBuf,
    sidecar_app_dir: PathBuf,
    bundled_sidecar_exe: Option<PathBuf>,
    log_path: PathBuf,
}

impl RuntimePaths {
    fn detect<R: tauri::Runtime>(app: Option<&tauri::AppHandle<R>>) -> Self {
        let repo_root = resolve_repo_root();
        let sidecar_app_dir = repo_root.join("services").join("sidecar").join("src");
        let bundled_sidecar_exe = app.and_then(resolve_bundled_sidecar_executable);
        let default_workspace_root = if bundled_sidecar_exe.is_some() {
            app.and_then(resolve_packaged_workspace_root)
                .unwrap_or_else(|| repo_root.join("runtime-workspace"))
        } else {
            repo_root.join("runtime-workspace")
        };
        let workspace_root = std::env::var("GONGMU_WORKSPACE_ROOT")
            .map(PathBuf::from)
            .unwrap_or(default_workspace_root);
        let log_path = workspace_root.join("logs").join("sidecar-runtime.log");

        Self {
            repo_root,
            workspace_root,
            sidecar_app_dir,
            bundled_sidecar_exe,
            log_path,
        }
    }
}

enum SidecarLaunch {
    Bundled {
        executable: PathBuf,
        working_dir: PathBuf,
    },
    Development {
        python: PathBuf,
        working_dir: PathBuf,
        sidecar_app_dir: PathBuf,
    },
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

fn resolve_packaged_workspace_root<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|path| path.join("runtime-workspace"))
}

fn resolve_bundled_sidecar_executable<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Option<PathBuf> {
    let resource_path = app
        .path()
        .resolve(
            bundled_sidecar_resource_path(),
            BaseDirectory::Resource,
        )
        .ok()?;

    if resource_path.exists() {
        Some(resource_path)
    } else {
        None
    }
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

fn resolve_sidecar_launch(paths: &RuntimePaths) -> SidecarLaunch {
    if let Some(executable) = paths.bundled_sidecar_exe.clone() {
        let working_dir = executable
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| paths.repo_root.clone());
        SidecarLaunch::Bundled {
            executable,
            working_dir,
        }
    } else {
        SidecarLaunch::Development {
            python: resolve_python_binary(&paths.repo_root),
            working_dir: paths.repo_root.clone(),
            sidecar_app_dir: paths.sidecar_app_dir.clone(),
        }
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
                if let Ok(mut last_exit) = manager.last_exit.lock() {
                    *last_exit = Some(SidecarExitReason::Crashed);
                }
                false
            }
            Ok(None) => true,
            Err(_) => {
                *guard = None;
                if let Ok(mut last_exit) = manager.last_exit.lock() {
                    *last_exit = Some(SidecarExitReason::Crashed);
                }
                false
            }
        },
        None => false,
    }
}

fn stop_managed_sidecar(
    manager: &SidecarManager,
    reason: SidecarExitReason,
) -> Result<bool, String> {
    let mut guard = manager
        .child
        .lock()
        .map_err(|_| "sidecar state lock poisoned".to_string())?;

    let Some(child) = guard.as_mut() else {
        let mut last_exit = manager
            .last_exit
            .lock()
            .map_err(|_| "sidecar exit state lock poisoned".to_string())?;
        *last_exit = Some(reason);
        return Ok(false);
    };

    child
        .kill()
        .map_err(|error| format!("sidecar stop failed: {error}"))?;
    let _ = child.wait();
    *guard = None;
    let mut last_exit = manager
        .last_exit
        .lock()
        .map_err(|_| "sidecar exit state lock poisoned".to_string())?;
    *last_exit = Some(reason);
    Ok(true)
}

fn socket_is_open(addr: &SocketAddr) -> bool {
    TcpStream::connect_timeout(addr, Duration::from_millis(250)).is_ok()
}

fn desktop_runtime_status_inner<R: tauri::Runtime>(
    app: Option<&tauri::AppHandle<R>>,
    manager: &SidecarManager,
) -> DesktopRuntimeStatus {
    let paths = RuntimePaths::detect(app);
    let managed = managed_sidecar_is_running(manager);
    let running = resolve_sidecar_addr()
        .map(|addr| socket_is_open(&addr))
        .unwrap_or(false);
    let last_exit = manager
        .last_exit
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().copied());
    let auto_restart_recommended =
        !running && !managed && last_exit == Some(SidecarExitReason::Crashed);

    let detail = if running && managed {
        if paths.bundled_sidecar_exe.is_some() {
            "bundled sidecar managed by desktop".to_string()
        } else {
            "development sidecar managed by desktop".to_string()
        }
    } else if auto_restart_recommended {
        "managed sidecar exited unexpectedly".to_string()
    } else if running {
        "sidecar is already reachable".to_string()
    } else if paths.bundled_sidecar_exe.is_some() {
        "bundled sidecar start available".to_string()
    } else {
        "development sidecar start available".to_string()
    };

    DesktopRuntimeStatus {
        available: true,
        mode: "tauri",
        sidecar_url: DEFAULT_SIDECAR_URL.to_string(),
        running,
        managed,
        auto_restart_recommended,
        log_path: Some(paths.log_path.display().to_string()),
        detail,
    }
}

#[tauri::command]
fn desktop_runtime_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarManager>,
) -> DesktopRuntimeStatus {
    desktop_runtime_status_inner(Some(&app), state.inner())
}

#[tauri::command]
fn start_desktop_sidecar(
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarManager>,
) -> Result<DesktopRuntimeStatus, String> {
    let current = desktop_runtime_status_inner(Some(&app), state.inner());
    if current.running {
        return Ok(current);
    }

    let paths = RuntimePaths::detect(Some(&app));
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

    let launch = resolve_sidecar_launch(&paths);
    let child = match launch {
        SidecarLaunch::Bundled {
            executable,
            working_dir,
        } => Command::new(executable)
            .current_dir(working_dir)
            .env("PYTHONUNBUFFERED", "1")
            .env("GONGMU_SIDECAR_HOST", "127.0.0.1")
            .env("GONGMU_SIDECAR_PORT", "8765")
            .env("GONGMU_WORKSPACE_ROOT", &paths.workspace_root)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|error| format!("bundled sidecar spawn failed: {error}"))?,
        SidecarLaunch::Development {
            python,
            working_dir,
            sidecar_app_dir,
        } => Command::new(python)
            .arg("-m")
            .arg("uvicorn")
            .arg("gongmu_sidecar.app:create_app")
            .arg("--factory")
            .arg("--app-dir")
            .arg(sidecar_app_dir)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg("8765")
            .current_dir(working_dir)
            .env("PYTHONUNBUFFERED", "1")
            .env("GONGMU_WORKSPACE_ROOT", &paths.workspace_root)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|error| format!("development sidecar spawn failed: {error}"))?,
    };

    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "sidecar state lock poisoned".to_string())?;
        *guard = Some(child);
    }
    {
        let mut last_exit = state
            .last_exit
            .lock()
            .map_err(|_| "sidecar exit state lock poisoned".to_string())?;
        *last_exit = None;
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        let status = desktop_runtime_status_inner(Some(&app), state.inner());
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
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarManager>,
) -> Result<DesktopRuntimeStatus, String> {
    stop_managed_sidecar(state.inner(), SidecarExitReason::ManualStop)?;
    Ok(desktop_runtime_status_inner(Some(&app), state.inner()))
}

#[tauri::command]
fn restart_desktop_sidecar(
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarManager>,
) -> Result<DesktopRuntimeStatus, String> {
    stop_managed_sidecar(state.inner(), SidecarExitReason::ManualStop)?;
    start_desktop_sidecar(app, state)
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

    app.run(move |app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
            let sidecar_manager = app_handle.state::<SidecarManager>();
            let _ = stop_managed_sidecar(sidecar_manager.inner(), SidecarExitReason::ManualStop);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_sidecar_resource_path_does_not_repeat_resources_prefix() {
        let resource_path = bundled_sidecar_resource_path();

        assert_eq!(
            resource_path,
            PathBuf::from("sidecar/windows-x64/gongmu-sidecar/gongmu-sidecar.exe")
        );
        assert!(!resource_path.starts_with("resources"));
    }
}
