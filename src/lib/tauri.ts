import { parseProbe, type ProbedMedia } from "../core/media/probe";

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
