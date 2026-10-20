import type { EeyditorProject } from "../types/timeline";
import { parseProject, serializeProject } from "../core/project/serialize";
import { invokeSafe, isTauri, pickOpenPaths, pickSavePath } from "./tauri";

/** Save the project to a chosen path (desktop) or download it (web). */
export async function saveProject(project: EeyditorProject): Promise<string> {
  const contents = serializeProject(project);
  const filename = `${project.name}.eeyproj`;
  if (isTauri()) {
    const path = await pickSavePath(filename, "eeyproj");
    if (path) {
      await invokeSafe("save_project", { path, contents });
      return `Saved ${path}`;
    }
  }
  downloadText(filename, contents);
  return "Downloaded project file";
}

/** Ask for a project file and parse it; null when cancelled. */
export async function openProject(): Promise<EeyditorProject | null> {
  const paths = await pickOpenPaths(["eeyproj", "json"], false);
  if (paths.length === 0) return null;
  const contents = await invokeSafe<string>("load_project", { path: paths[0] });
  if (!contents) return null;
  return parseProject(contents);
}

function downloadText(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
