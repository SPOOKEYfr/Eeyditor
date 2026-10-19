use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Deserialize)]
pub struct RenderResult {
    pub success: bool,
    pub code: Option<i32>,
    pub stderr: String,
}

#[derive(Default)]
struct ExportState {
    children: Mutex<HashMap<String, Child>>,
    cancelled: Mutex<HashSet<String>>,
}

#[derive(Serialize)]
pub struct AudioPeaks {
    pub min: Vec<f32>,
    pub max: Vec<f32>,
    pub rms: Vec<f32>,
    pub buckets: usize,
}

/// Decode a media file's audio to mono PCM with ffmpeg and reduce it into
/// min/max/rms buckets for waveform drawing. Runs entirely in the host so the
/// webview never has to fetch or decode the file itself.
#[tauri::command]
fn audio_peaks(path: String, buckets: usize) -> Result<AudioPeaks, String> {
    let buckets = buckets.clamp(16, 16384);
    let output = Command::new("ffmpeg")
        .args([
            "-v", "error", "-i", &path, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-",
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let samples: Vec<i16> = output
        .stdout
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    if samples.is_empty() {
        return Ok(AudioPeaks {
            min: vec![0.0; buckets],
            max: vec![0.0; buckets],
            rms: vec![0.0; buckets],
            buckets,
        });
    }

    let mut min = vec![0f32; buckets];
    let mut max = vec![0f32; buckets];
    let mut rms = vec![0f32; buckets];
    let per_bucket = samples.len() as f32 / buckets as f32;

    for bucket in 0..buckets {
        let start = ((bucket as f32 * per_bucket) as usize).min(samples.len());
        let end = (((bucket + 1) as f32 * per_bucket) as usize)
            .max(start + 1)
            .min(samples.len());
        let mut lo = 1f32;
        let mut hi = -1f32;
        let mut sum_squares = 0f64;
        let mut count = 0usize;
        for value in &samples[start..end] {
            let normalized = *value as f32 / 32768.0;
            if normalized < lo {
                lo = normalized;
            }
            if normalized > hi {
                hi = normalized;
            }
            sum_squares += (normalized as f64) * (normalized as f64);
            count += 1;
        }
        if count == 0 {
            lo = 0.0;
            hi = 0.0;
        }
        min[bucket] = lo;
        max[bucket] = hi;
        rms[bucket] = if count > 0 {
            (sum_squares / count as f64).sqrt() as f32
        } else {
            0.0
        };
    }

    Ok(AudioPeaks {
        min,
        max,
        rms,
        buckets,
    })
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

/// Run ffmpeg while streaming progress to the frontend and allowing cancel.
/// `-progress pipe:1` emits machine-readable `out_time_ms=<us>` lines on
/// stdout; the running child is tracked so `cancel_export` can kill it.
#[tauri::command]
fn render_export(
    app: AppHandle,
    state: State<ExportState>,
    job_id: String,
    duration: f64,
    args: Vec<String>,
) -> Result<RenderResult, String> {
    let mut child = Command::new("ffmpeg")
        .args(["-progress", "pipe:1", "-nostats", "-loglevel", "error"])
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let stdout = child.stdout.take();
    state
        .children
        .lock()
        .unwrap()
        .insert(job_id.clone(), child);

    let mut last_percent = -1f64;
    if let Some(stdout) = stdout {
        for line in BufReader::new(stdout).lines().flatten() {
            if let Some(value) = line.strip_prefix("out_time_ms=") {
                if let Ok(micros) = value.trim().parse::<f64>() {
                    let seconds = micros / 1_000_000.0;
                    let percent = if duration > 0.0 {
                        (seconds / duration * 100.0).clamp(0.0, 100.0)
                    } else {
                        0.0
                    };
                    if percent - last_percent >= 0.5 {
                        last_percent = percent;
                        let _ = app.emit(
                            "export-progress",
                            serde_json::json!({
                                "jobId": job_id,
                                "seconds": seconds,
                                "percent": percent,
                            }),
                        );
                    }
                }
            }
        }
    }

    // Poll instead of `wait()` so `cancel_export` can always take the lock and
    // kill the process without deadlocking with the waiter.
    let status = loop {
        let mut children = state.children.lock().unwrap();
        let Some(child) = children.get_mut(&job_id) else {
            break None;
        };
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {}
            Err(error) => return Err(error.to_string()),
        }
        drop(children);
        std::thread::sleep(std::time::Duration::from_millis(40));
    };
    let mut finished = state.children.lock().unwrap().remove(&job_id);
    let stderr = finished
        .as_mut()
        .and_then(|child| child.stderr.take())
        .map(|mut pipe| {
            let mut buffer = String::new();
            use std::io::Read;
            let _ = pipe.read_to_string(&mut buffer);
            buffer
        })
        .unwrap_or_default();

    let cancelled = state.cancelled.lock().unwrap().remove(&job_id);

    Ok(RenderResult {
        success: status.map(|exit| exit.success()).unwrap_or(false) && !cancelled,
        code: status.and_then(|exit| exit.code()),
        stderr: if cancelled {
            "Export cancelled".to_string()
        } else {
            stderr
        },
    })
}

#[tauri::command]
fn cancel_export(state: State<ExportState>, job_id: String) {
    state.cancelled.lock().unwrap().insert(job_id.clone());
    if let Some(child) = state.children.lock().unwrap().get_mut(&job_id) {
        let _ = child.kill();
    }
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
        .manage(ExportState::default())
        .invoke_handler(tauri::generate_handler![
            save_project,
            load_project,
            ffmpeg_available,
            run_ffmpeg,
            render_export,
            cancel_export,
            probe_media,
            audio_peaks
        ])
        .run(tauri::generate_context!())
        .expect("error while running Eeyditor");
}
