import type { EeyditorProject } from "../types/timeline";
import { normalizeProject, serializeProject } from "../core/project/serialize";

export const AUTOSAVE_KEY = "eeyditor:autosave";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

export interface AutosaveRecord {
  savedAt: number;
  project: EeyditorProject;
}

export function encodeAutosave(project: EeyditorProject, savedAt = Date.now()): string {
  return JSON.stringify({ savedAt, project: JSON.parse(serializeProject(project)) });
}

export function decodeAutosave(text: string | null, now = Date.now()): AutosaveRecord | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as { savedAt?: unknown; project?: unknown };
    const savedAt = typeof raw.savedAt === "number" ? raw.savedAt : 0;
    if (!savedAt || now - savedAt > MAX_AGE_MS) return null;
    return { savedAt, project: normalizeProject(raw.project) };
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveAutosave(project: EeyditorProject): void {
  try {
    storage()?.setItem(AUTOSAVE_KEY, encodeAutosave(project));
  } catch {
    // Quota or privacy mode: autosave is best-effort.
  }
}

export function loadAutosave(): AutosaveRecord | null {
  try {
    return decodeAutosave(storage()?.getItem(AUTOSAVE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    storage()?.removeItem(AUTOSAVE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
