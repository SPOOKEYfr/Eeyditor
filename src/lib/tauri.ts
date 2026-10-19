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
