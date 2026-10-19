use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Deserialize)]
pub struct RenderResult {
    pub success: bool,
    pub code: Option<i32>,
    pub stderr: String,
}

/// Atomically persist a `.eeyproj` manifest next to the requested path.
#[tauri::command]
fn save_project(path: String, contents: String) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    let tmp = target.with_extension("eeyproj.tmp");
    fs::write(&tmp, contents).map_err(|error| error.to_string())?;
    fs::rename(&tmp, target).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_project(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Run a fully-resolved ffmpeg argument vector. The frontend owns filtergraph
/// construction; the backend only executes and reports.
#[tauri::command]
fn run_ffmpeg(args: Vec<String>) -> Result<RenderResult, String> {
    let output = Command::new("ffmpeg")
        .args(&args)
        .output()
        .map_err(|error| error.to_string())?;
    Ok(RenderResult {
        success: output.status.success(),
        code: output.status.code(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[tauri::command]
fn probe_media(path: String) -> Result<String, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            &path,
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            save_project,
            load_project,
            ffmpeg_available,
            run_ffmpeg,
            probe_media
        ])
        .run(tauri::generate_context!())
        .expect("error while running Eeyditor");
}
