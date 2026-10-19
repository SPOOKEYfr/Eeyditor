import { useState } from "react";
import { Download, FolderOpen, Save } from "lucide-react";
import { editorStore, useEditorSelector } from "../../state/editorStore";
import { RENDER_PRESETS } from "../../core/project/factory";
import { parseProject, serializeProject } from "../../core/project/serialize";
import { buildFfmpegPlan } from "../../core/exporter/FFmpegBridge";
import { invokeSafe, isTauri, pickOpenPaths, pickSavePath } from "../../lib/tauri";
import { NeumorphicButton, NeumorphicPanel } from "../neumorphic";

export function ExportPanel() {
  const project = useEditorSelector((state) => state.project);
  const status = useEditorSelector((state) => state.status);
  const [outputPath, setOutputPath] = useState("eeyditor-export.mp4");
  const [busy, setBusy] = useState(false);
  const [filterPreview, setFilterPreview] = useState<string | null>(null);

  const plan = buildFfmpegPlan(project, outputPath);

  const setPreset = (id: string) => {
    const preset = RENDER_PRESETS.find((entry) => entry.id === id);
    if (!preset) return;
    editorStore.updateProject((current) => ({ ...current, renderPreset: { ...preset } }), `Preset: ${preset.name}`);
  };

  const handleExport = async () => {
    setBusy(true);
    setFilterPreview(plan.filterComplex);
    const target = isTauri()
      ? (await pickSavePath(outputPath, "mp4")) ?? outputPath
      : outputPath;
    const result = await invokeSafe<{ success: boolean; code: number | null; stderr: string }>(
      "run_ffmpeg",
      { args: plan.args },
    );
    if (result) {
      editorStore.setStatus(result.success ? `Export complete: ${target}` : `Export failed (${result.code})`);
      if (!result.success) console.error(result.stderr.slice(-2000));
    } else {
      await copyText(plan.filterComplex);
      editorStore.setStatus("Filtergraph copied to clipboard (desktop app required to render)");
    }
    setBusy(false);
  };

  const handleSave = async () => {
    const contents = serializeProject(project);
    const path = await pickSavePath(`${project.name}.eeyproj`, "eeyproj");
    if (path) {
      await invokeSafe("save_project", { path, contents });
      editorStore.setStatus(`Saved ${path}`);
      return;
    }
    downloadText(`${project.name}.eeyproj`, contents);
    editorStore.setStatus("Downloaded project file");
  };

  const handleOpen = async () => {
    const paths = await pickOpenPaths(["eeyproj", "json"], false);
    if (paths.length > 0) {
      const contents = await invokeSafe<string>("load_project", { path: paths[0] });
      if (contents) {
        editorStore.loadProject(parseProject(contents));
        return;
      }
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".eeyproj,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      editorStore.loadProject(parseProject(await file.text()));
    };
    input.click();
  };

  return (
    <NeumorphicPanel title="Render & Project" className="shrink-0">
      <div className="space-y-2">
        <label className="block text-[10px] uppercase tracking-wider text-muted">
          Preset
          <select
            value={project.renderPreset.id}
            onChange={(event) => setPreset(event.target.value)}
            className="mt-1 w-full rounded-lg bg-recessed px-2 py-1.5 text-xs text-ink shadow-recessed-sm outline-none"
          >
            {RENDER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[10px] uppercase tracking-wider text-muted">
          Output
          <input
            value={outputPath}
            onChange={(event) => setOutputPath(event.target.value)}
            className="mt-1 w-full rounded-lg bg-recessed px-2 py-1.5 font-mono text-[11px] text-ink shadow-recessed-sm outline-none"
          />
        </label>
        <div className="flex gap-1.5">
          <NeumorphicButton size="sm" variant="primary" icon={<Download size={14} />} disabled={busy} onClick={handleExport} className="flex-1">
            {busy ? "Rendering" : "Export"}
          </NeumorphicButton>
          <NeumorphicButton size="sm" iconOnly title="Save project" onClick={handleSave} icon={<Save size={14} />} />
          <NeumorphicButton size="sm" iconOnly title="Open project" onClick={handleOpen} icon={<FolderOpen size={14} />} />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted">
          <span className="truncate">{status}</span>
          <span className="font-mono">{plan.args.length} args</span>
        </div>
        {filterPreview && (
          <pre className="max-h-24 overflow-auto rounded-lg bg-recessed p-2 font-mono text-[9px] leading-tight text-muted shadow-recessed-sm">
            {filterPreview.slice(0, 600)}
          </pre>
        )}
      </div>
    </NeumorphicPanel>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    /* clipboard unavailable */
  }
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
