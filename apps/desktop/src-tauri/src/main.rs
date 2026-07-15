#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager};

const DEFAULT_SIDECAR_URL: &str = "http://127.0.0.1:8765";
const BUNDLED_SIDECAR_RESOURCE_PATH: &str =
    "sidecar/windows-x64/gongmu-sidecar/gongmu-sidecar.exe";
const SIDECAR_STARTUP_TIMEOUT_SECS: u64 = 60;
fn bundled_sidecar_resource_path() -> PathBuf {
    PathBuf::from(BUNDLED_SIDECAR_RESOURCE_PATH)
}

#[derive(Default)]
struct SidecarManager {
    child: Mutex<Option<Child>>,
    last_exit: Mutex<Option<SidecarExitReason>>,
}
struct ZoomState {
    scale: Mutex<f64>,
}

// T1(4호): 화면 글자 크기 기본을 90%로. 프런트가 저장 배율(없으면 90%)로 부팅 시 덮어쓴다.
const DEFAULT_ZOOM_SCALE: f64 = 0.9;

impl Default for ZoomState {
    fn default() -> Self {
        Self {
            scale: Mutex::new(DEFAULT_ZOOM_SCALE),
        }
    }
}

fn minimum_window_width_for_zoom(scale: f64) -> u32 {
    let base_width = 980.0;
    (base_width * scale).ceil() as u32
}

// 보기 메뉴의 줌 항목 → 목표 배율. 순수 함수로 분리해 단위 테스트로 검증한다.
fn menu_zoom_target(menu_id: &str, current_scale: f64) -> f64 {
    match menu_id {
        "view-zoom-in" => (current_scale + 0.1).min(1.4),
        "view-zoom-out" => (current_scale - 0.1).max(0.8),
        "view-zoom-reset" => DEFAULT_ZOOM_SCALE,
        "view-zoom-80" => 0.8,
        "view-zoom-90" => 0.9,
        "view-zoom-100" => 1.0,
        "view-zoom-110" => 1.1,
        "view-zoom-125" => 1.25,
        "view-zoom-150" => 1.5,
        _ => current_scale,
    }
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
    anything_available: bool,
    anything_mode: &'static str,
    anything_path: Option<String>,
    anything_autopaste_enabled: bool,
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
    bundled_sidecar_candidates: Vec<PathBuf>,
    anything_exe: Option<PathBuf>,
    log_path: PathBuf,
}

impl RuntimePaths {
    fn detect<R: tauri::Runtime>(app: Option<&tauri::AppHandle<R>>) -> Self {
        let repo_root = resolve_repo_root();
        let sidecar_app_dir = repo_root.join("services").join("sidecar").join("src");
        let bundled_sidecar_candidates = if cfg!(debug_assertions) {
            Vec::new()
        } else {
            app.map(resolve_bundled_sidecar_candidates).unwrap_or_default()
        };
        let bundled_sidecar_exe = bundled_sidecar_candidates
            .iter()
            .find(|candidate| candidate.exists())
            .cloned();
        let anything_exe = resolve_anything_executable();
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
            bundled_sidecar_candidates,
            anything_exe,
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

fn resolve_bundled_sidecar_candidates<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    for relative in [
        bundled_sidecar_resource_path(),
        PathBuf::from("resources").join(bundled_sidecar_resource_path()),
    ] {
        if let Ok(candidate) = app.path().resolve(relative, BaseDirectory::Resource) {
            candidates.push(candidate);
        }
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(app_dir) = current_exe.parent() {
            candidates.push(
                app_dir
                    .join("resources")
                    .join(bundled_sidecar_resource_path()),
            );
            candidates.push(app_dir.join(bundled_sidecar_resource_path()));
        }
    }

    candidates.sort();
    candidates.dedup();
    candidates
}

fn resolve_anything_executable() -> Option<PathBuf> {
    let env_pairs: Vec<(String, String)> = std::env::vars().collect();
    let candidates = resolve_anything_candidate_paths_from_env(env_pairs);

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn env_flag_enabled(key: &str) -> bool {
    std::env::var(key)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn schedule_anything_autopaste(process_id: u32) {
    let script = format!(
        "$wshell = New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 900; if ($wshell.AppActivate({process_id})) {{ Start-Sleep -Milliseconds 250; $wshell.SendKeys('^v') }}"
    );

    let _ = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .spawn();
}

#[cfg(not(windows))]
fn schedule_anything_autopaste(_process_id: u32) {}

fn resolve_anything_candidate_paths_from_env<K, V, I>(env: I) -> Vec<PathBuf>
where
    K: AsRef<str>,
    V: AsRef<str>,
    I: IntoIterator<Item = (K, V)>,
{
    let mut local_app_data: Option<String> = None;
    let mut program_files: Option<String> = None;
    let mut program_files_x86: Option<String> = None;

    for (key, value) in env {
        match key.as_ref() {
            "LOCALAPPDATA" => local_app_data = Some(value.as_ref().to_string()),
            "ProgramFiles" => program_files = Some(value.as_ref().to_string()),
            "ProgramFiles(x86)" => program_files_x86 = Some(value.as_ref().to_string()),
            _ => {}
        }
    }

    if let Ok(value) = std::env::var("GONGMU_ANYTHING_EXE") {
        let path = PathBuf::from(value);
        if path.exists() {
            return vec![path];
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(local_app_data) = local_app_data {
        candidates.push(
            PathBuf::from(&local_app_data)
                .join("Anything")
                .join("docufinder.exe"),
        );
        candidates.push(
            PathBuf::from(&local_app_data)
                .join("Programs")
                .join("Anything")
                .join("Anything.exe"),
        );
        candidates.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("Docufinder")
                .join("Anything.exe"),
        );
    }

    if let Some(program_files) = program_files {
        candidates.push(
            PathBuf::from(&program_files)
                .join("Anything")
                .join("Anything.exe"),
        );
        candidates.push(
            PathBuf::from(&program_files)
                .join("Docufinder")
                .join("Anything.exe"),
        );
        candidates.push(
            PathBuf::from(&program_files)
                .join("Anything")
                .join("docufinder.exe"),
        );
        candidates.push(
            PathBuf::from(&program_files)
                .join("Docufinder")
                .join("docufinder.exe"),
        );
    }

    if let Some(program_files_x86) = program_files_x86 {
        candidates.push(
            PathBuf::from(&program_files_x86)
                .join("Anything")
                .join("Anything.exe"),
        );
        candidates.push(
            PathBuf::from(&program_files_x86)
                .join("Docufinder")
                .join("Anything.exe"),
        );
        candidates.push(
            PathBuf::from(&program_files_x86)
                .join("Anything")
                .join("docufinder.exe"),
        );
        candidates.push(
            PathBuf::from(&program_files_x86)
                .join("Docufinder")
                .join("docufinder.exe"),
        );
    }

    candidates
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

fn resolve_sidecar_launch(paths: &RuntimePaths) -> Result<SidecarLaunch, String> {
    if let Some(executable) = paths.bundled_sidecar_exe.clone() {
        let working_dir = executable
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| paths.repo_root.clone());
        return Ok(SidecarLaunch::Bundled {
            executable,
            working_dir,
        });
    }

    if !cfg!(debug_assertions) {
        let checked_paths = paths
            .bundled_sidecar_candidates
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!(
            "bundled sidecar executable not found. checked paths: {checked_paths}"
        ));
    }

    Ok(SidecarLaunch::Development {
            python: resolve_python_binary(&paths.repo_root),
            working_dir: paths.repo_root.clone(),
            sidecar_app_dir: paths.sidecar_app_dir.clone(),
    })
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

fn cleanup_failed_start_state(manager: &SidecarManager) -> Result<(), String> {
    let child = {
        let mut guard = manager
            .child
            .lock()
            .map_err(|_| "sidecar state lock poisoned".to_string())?;
        guard.take()
    };

    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }

    let mut last_exit = manager
        .last_exit
        .lock()
        .map_err(|_| "sidecar exit state lock poisoned".to_string())?;
    *last_exit = None;
    Ok(())
}

fn socket_is_open(addr: &SocketAddr) -> bool {
    TcpStream::connect_timeout(addr, Duration::from_millis(250)).is_ok()
}

fn open_external_target_inner(target: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler").arg(target);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(target);
        command
    };

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(target);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("external open failed: {error}"))
}

fn launch_anything_query_inner<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    query: &str,
    fallback_target: &str,
) -> Result<(), String> {
    let paths = RuntimePaths::detect(Some(app));

    if let Some(executable) = paths.anything_exe {
        let working_dir = executable
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| paths.repo_root.clone());

        let child = Command::new(executable)
            .current_dir(working_dir)
            .spawn()
            .map_err(|error| format!("Anything launch failed: {error}"))?;

        if env_flag_enabled("GONGMU_ANYTHING_AUTOPASTE") && !query.trim().is_empty() {
            schedule_anything_autopaste(child.id());
        }
        return Ok(());
    }

    open_external_target_inner(fallback_target)
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
        anything_available: paths.anything_exe.is_some(),
        anything_mode: if paths.anything_exe.is_some() {
            "external_app_detected"
        } else {
            "install_page_fallback"
        },
        anything_path: paths.anything_exe.as_ref().map(|path| path.display().to_string()),
        anything_autopaste_enabled: env_flag_enabled("GONGMU_ANYTHING_AUTOPASTE"),
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
    if current.running || current.managed {
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

    let launch = resolve_sidecar_launch(&paths)?;
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

    let deadline = Instant::now() + Duration::from_secs(SIDECAR_STARTUP_TIMEOUT_SECS);
    while Instant::now() < deadline {
        let status = desktop_runtime_status_inner(Some(&app), state.inner());
        if status.running {
            return Ok(status);
        }
        thread::sleep(Duration::from_millis(250));
    }

    cleanup_failed_start_state(state.inner())?;
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

#[tauri::command]
fn open_external_target(target: String) -> Result<(), String> {
    open_external_target_inner(&target)
}

#[tauri::command]
fn launch_anything_query(
    app: tauri::AppHandle,
    query: String,
    fallback_target: String,
) -> Result<(), String> {
    launch_anything_query_inner(&app, &query, &fallback_target)
}

#[tauri::command]
fn pick_directory() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.display().to_string()))
}

#[tauri::command]
fn set_desktop_zoom(
    app: tauri::AppHandle,
    state: tauri::State<'_, ZoomState>,
    scale: f64,
) -> Result<f64, String> {
    let next_scale = scale.clamp(0.8, 1.5);

    let webview_window = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    webview_window
        .set_zoom(next_scale)
        .map_err(|error| format!("failed to set desktop zoom: {error}"))?;

    {
        let mut zoom_guard = state
            .scale
            .lock()
            .map_err(|_| "zoom state lock poisoned".to_string())?;
        *zoom_guard = next_scale;
    }

    let _ = webview_window.eval(&format!(
        "window.dispatchEvent(new CustomEvent('gongmu-zoom-scale', {{ detail: {} }}));",
        next_scale
    ));

    Ok(next_scale)
}

fn emit_zoom_scale<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    webview_window: &tauri::WebviewWindow<R>,
    scale: f64,
) {
    let _ = app.emit("gongmu-zoom-scale", scale);
    let _ = webview_window.emit("gongmu-zoom-scale", scale);
    let _ = webview_window.eval(&format!(
        "window.dispatchEvent(new CustomEvent('gongmu-zoom-scale', {{ detail: {} }}));",
        scale
    ));
}

fn emit_zoom_blocked<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    webview_window: &tauri::WebviewWindow<R>,
    message: &str,
) {
    let _ = app.emit("gongmu-zoom-blocked", message);
    let _ = webview_window.emit("gongmu-zoom-blocked", message);
    let _ = webview_window.eval(&format!(
        "window.dispatchEvent(new CustomEvent('gongmu-zoom-blocked', {{ detail: {:?} }}));",
        message
    ));
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let file_menu = SubmenuBuilder::new(app, "파일")
                .text("file-new-session", "새 업무 세션")
                .separator()
                .close_window()
                .quit()
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "편집")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let view_menu = SubmenuBuilder::new(app, "보기")
                .text("view-refresh", "새로고침")
                .separator()
                .text("view-zoom-in", "확대")
                .text("view-zoom-out", "축소")
                .text("view-zoom-reset", "기본 크기 (90%)")
                .separator()
                .text("view-zoom-80", "80%")
                .text("view-zoom-90", "90%")
                .text("view-zoom-100", "100%")
                .text("view-zoom-110", "110%")
                .text("view-zoom-125", "125%")
                .text("view-zoom-150", "150%")
                .separator()
                .fullscreen()
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "창")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .build()?;
            let help_menu = SubmenuBuilder::new(app, "도움말")
                .text("help-about", "공무 워크스페이스 정보")
                .build()?;
            let menu = MenuBuilder::new(app)
                .items(&[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
                .build()?;

            app.set_menu(menu)?;
            Ok(())
        })
        .manage(SidecarManager::default())
        .manage(ZoomState::default())
        .on_menu_event(|app, event| {
            let webview_window = app.get_webview_window("main");

            match event.id().as_ref() {
                "view-refresh" => {
                    if let Some(webview_window) = &webview_window {
                        let _ = webview_window.emit("gongmu-menu-action", "view.refresh");
                    }
                    let _ = app.emit("gongmu-menu-action", "view.refresh");
                }
                "view-zoom-in"
                | "view-zoom-out"
                | "view-zoom-reset"
                | "view-zoom-80"
                | "view-zoom-90"
                | "view-zoom-100"
                | "view-zoom-110"
                | "view-zoom-125"
                | "view-zoom-150" => {
                    let zoom_state = app.state::<ZoomState>();
                    let mut zoom_guard = match zoom_state.scale.lock() {
                        Ok(guard) => guard,
                        Err(_) => return,
                    };

                    let current_scale = *zoom_guard;
                    let next_scale = menu_zoom_target(event.id().as_ref(), current_scale);

                    if let Some(webview_window) = &webview_window {
                        let is_zoom_in = next_scale > current_scale;
                        if is_zoom_in {
                            if let Ok(size) = webview_window.inner_size() {
                                let required_width = minimum_window_width_for_zoom(next_scale);
                                if size.width < required_width {
                                    emit_zoom_blocked(
                                        &app,
                                        webview_window,
                                        "이 창 크기에서는 더 확대할 수 없습니다. 창을 넓히거나 오른쪽 정보 패널을 접어주세요.",
                                    );
                                    return;
                                }
                            }
                        }

                        let _ = webview_window.set_zoom(next_scale);
                        *zoom_guard = next_scale;
                        emit_zoom_scale(&app, webview_window, next_scale);
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_status,
            start_desktop_sidecar,
            stop_desktop_sidecar,
            restart_desktop_sidecar,
            open_external_target,
            launch_anything_query,
            pick_directory,
            set_desktop_zoom
        ])
        .build(tauri::generate_context!())
        .expect("failed to build gongmu desktop");

    app.run(move |app_handle, event| {
        match event {
            tauri::RunEvent::Ready => {
                let sidecar_manager = app_handle.state::<SidecarManager>();
                let _ = start_desktop_sidecar(app_handle.clone(), sidecar_manager);
            }
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } => {
                let sidecar_manager = app_handle.state::<SidecarManager>();
                let _ = stop_managed_sidecar(sidecar_manager.inner(), SidecarExitReason::ManualStop);
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn zoom_state_default_is_ninety_percent() {
        // T1(4호): 기본 배율 90%
        let scale = *ZoomState::default().scale.lock().unwrap();
        assert!((scale - 0.9).abs() < 1e-9);
    }

    #[test]
    fn menu_zoom_reset_returns_ninety_percent() {
        // '기본 크기'는 100%가 아니라 90%로 되돌린다
        assert!((menu_zoom_target("view-zoom-reset", 1.3) - 0.9).abs() < 1e-9);
        assert!((menu_zoom_target("view-zoom-90", 1.0) - 0.9).abs() < 1e-9);
    }

    #[test]
    fn menu_zoom_in_out_respects_bounds() {
        assert!((menu_zoom_target("view-zoom-in", 0.9) - 1.0).abs() < 1e-9);
        assert!((menu_zoom_target("view-zoom-in", 1.4) - 1.4).abs() < 1e-9); // 상한 유지
        assert!((menu_zoom_target("view-zoom-out", 0.8) - 0.8).abs() < 1e-9); // 하한 유지
        assert!((menu_zoom_target("view-zoom-150", 0.9) - 1.5).abs() < 1e-9);
        assert!((menu_zoom_target("unknown-id", 1.1) - 1.1).abs() < 1e-9); // 미지 id는 현재값 유지
    }

    #[test]
    fn bundled_sidecar_resource_path_does_not_repeat_resources_prefix() {
        let resource_path = bundled_sidecar_resource_path();

        assert_eq!(
            resource_path,
            PathBuf::from("sidecar/windows-x64/gongmu-sidecar/gongmu-sidecar.exe")
        );
        assert!(!resource_path.starts_with("resources"));
    }

    #[test]
    fn anything_candidate_paths_include_actual_local_appdata_install_shape() {
        let mut env = HashMap::new();
        env.insert(
            "LOCALAPPDATA".to_string(),
            "C:\\Users\\USER\\AppData\\Local".to_string(),
        );
        env.insert("ProgramFiles".to_string(), "C:\\Program Files".to_string());
        env.insert(
            "ProgramFiles(x86)".to_string(),
            "C:\\Program Files (x86)".to_string(),
        );

        let candidates = resolve_anything_candidate_paths_from_env(&env);

        assert!(candidates.contains(&PathBuf::from(
            "C:\\Users\\USER\\AppData\\Local\\Anything\\docufinder.exe"
        )));
        assert!(candidates.contains(&PathBuf::from(
            "C:\\Users\\USER\\AppData\\Local\\Programs\\Docufinder\\Anything.exe"
        )));
    }

    #[cfg(windows)]
    #[test]
    fn cleanup_failed_start_state_clears_spawned_child_and_exit_state() {
        let manager = SidecarManager::default();
        let child = Command::new("cmd")
            .args(["/C", "ping 127.0.0.1 -n 30 >NUL"])
            .spawn()
            .expect("failed to spawn test child");

        {
            let mut guard = manager.child.lock().expect("child lock");
            *guard = Some(child);
        }
        {
            let mut last_exit = manager.last_exit.lock().expect("exit lock");
            *last_exit = Some(SidecarExitReason::Crashed);
        }

        cleanup_failed_start_state(&manager).expect("cleanup should succeed");

        assert!(manager.child.lock().expect("child lock").is_none());
        assert!(manager.last_exit.lock().expect("exit lock").is_none());
    }
}
