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
            probe_media,
            audio_peaks
        ])
        .run(tauri::generate_context!())
        .expect("error while running Eeyditor");
}
