import { parseProbe, type ProbedMedia } from "../core/media/probe";
import { peaksToAmplitudes, type Peaks } from "../core/audio/waveform";

interface RawAudioPeaks {
  min: number[];
  max: number[];
  rms: number[];
  buckets: number;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function invokeSafe<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch (error) {
    console.error(`[eeyditor] invoke ${command} failed`, error);
    return null;
  }
}

export interface RenderResult {
  success: boolean;
  code: number | null;
  stderr: string;
}

export interface ExportProgress {
  jobId: string;
  seconds: number;
  percent: number;
}

/** Run ffmpeg with live progress streaming and cancellable job tracking. */
export async function renderExport(
  jobId: string,
  duration: number,
  args: string[],
): Promise<RenderResult | null> {
  return invokeSafe<RenderResult>("render_export", { jobId, duration, args });
}

export async function cancelExport(jobId: string): Promise<void> {
  await invokeSafe("cancel_export", { jobId });
}

/** Subscribe to render progress. Returns an unsubscribe function. */
export async function onExportProgress(
  handler: (progress: ExportProgress) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<ExportProgress>("export-progress", (event) =>
      handler(event.payload),
    );
  } catch (error) {
    console.error("[eeyditor] progress listener failed", error);
    return () => {};
  }
}

const mediaUrlCache = new Map<string, string>();

/**
 * Resolve a local media path into a URL the webview can decode. In the desktop
 * build this uses Tauri's asset protocol; in a browser the path is passed
 * through unchanged (used for blob URLs during development).
 */
export async function convertMediaUrl(path: string): Promise<string> {
  if (!path || path.startsWith("generator://")) return "";
  const cached = mediaUrlCache.get(path);
  if (cached) return cached;
  let url = path;
  if (isTauri()) {
    try {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      url = convertFileSrc(path);
    } catch (error) {
      console.error("[eeyditor] asset URL conversion failed", error);
      return "";
    }
  }
  mediaUrlCache.set(path, url);
  return url;
}

/** Read real duration/stream metadata for a media file via ffprobe. */
export async function probeMedia(path: string): Promise<ProbedMedia | null> {
  const json = await invokeSafe<string>("probe_media", { path });
  return json ? parseProbe(json) : null;
}

/** Extract display-ready waveform amplitudes from a media file's audio. */
export async function audioWaveform(
  path: string,
  columns = 1024,
): Promise<Float32Array | null> {
  const buckets = Math.max(16, Math.min(16384, columns * 2));
  const raw = await invokeSafe<RawAudioPeaks>("audio_peaks", { path, buckets });
  if (!raw || !Array.isArray(raw.min)) return null;
  const peaks: Peaks = {
    min: Float32Array.from(raw.min),
    max: Float32Array.from(raw.max),
    rms: Float32Array.from(raw.rms),
    buckets: raw.buckets,
    sampleRate: 8000,
    duration: 0,
  };
  return peaksToAmplitudes(peaks, columns);
}

export async function pickOpenPaths(
  extensions: string[],
  multiple = true,
): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple,
      filters: [{ name: "Media", extensions }],
    });
    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
  } catch (error) {
    console.error("[eeyditor] open dialog failed", error);
    return [];
  }
}

export async function pickSavePath(
  defaultPath: string,
  extension: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const selected = await save({
      defaultPath,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    return selected ?? null;
  } catch (error) {
    console.error("[eeyditor] save dialog failed", error);
    return null;
  }
}
