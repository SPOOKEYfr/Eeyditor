import { useEffect, useState } from "react";
import { Download, FilePlus2, FolderOpen, Save, X } from "lucide-react";
import { editorStore, useEditorSelector } from "../../state/editorStore";
import { createEmptyProject, RENDER_PRESETS } from "../../core/project/factory";
import { parseProject } from "../../core/project/serialize";
import { clearAutosave } from "../../lib/autosave";
import { openProject, saveProject } from "../../lib/projectFile";
import { buildFfmpegPlan } from "../../core/exporter/FFmpegBridge";
import {
  cancelExport,
  isTauri,
  onExportProgress,
  pickSavePath,
  renderExport,
} from "../../lib/tauri";
import { NeumorphicButton, NeumorphicPanel } from "../neumorphic";

export function ExportPanel() {
  const project = useEditorSelector((state) => state.project);
  const status = useEditorSelector((state) => state.status);
  const [outputPath, setOutputPath] = useState("eeyditor-export.mp4");
  const [busy, setBusy] = useState(false);
  const [filterPreview, setFilterPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    void onExportProgress((update) => setProgress(update.percent)).then((stop) => {
      if (active) unsubscribe = stop;
      else stop();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const previewPlan = buildFfmpegPlan(project, outputPath);

  const setPreset = (id: string) => {
    const preset = RENDER_PRESETS.find((entry) => entry.id === id);
    if (!preset) return;
    setOutputPath((current) => current.replace(/\.[^./\\]+$/, `.${preset.container}`));
    editorStore.updateProject((current) => ({ ...current, renderPreset: { ...preset } }), `Preset: ${preset.name}`);
  };

  const handleExport = async () => {
    setBusy(true);
    let target = outputPath;
    if (isTauri()) {
      const chosen = await pickSavePath(outputPath, project.renderPreset.container);
      if (!chosen) {
        editorStore.setStatus("Export cancelled");
        setBusy(false);
        return;
      }
      target = chosen;
      setOutputPath(chosen);
    }
    const plan = buildFfmpegPlan(project, target);
    setFilterPreview(plan.filterComplex);
    if (!isTauri()) {
      await copyText(plan.filterComplex);
      editorStore.setStatus("Filtergraph copied to clipboard (desktop app required to render)");
      setBusy(false);
      return;
    }
    const id = `export-${Date.now()}`;
    setJobId(id);
    setProgress(0);
    const result = await renderExport(id, plan.duration, plan.args);
    setJobId(null);
    if (result?.success) {
      setProgress(100);
      editorStore.setStatus(`Export complete: ${target}`);
    } else {
      setProgress(null);
      editorStore.setStatus(
        result?.stderr === "Export cancelled"
          ? "Export cancelled"
          : `Export failed (${result?.code ?? "unknown"})`,
      );
      if (result && result.stderr !== "Export cancelled") console.error(result.stderr.slice(-2000));
    }
    setBusy(false);
  };

  const handleCancel = async () => {
    if (jobId) await cancelExport(jobId);
  };

  const handleNew = () => {
    if (editorStore.getState().past.length > 0 && !window.confirm("Discard unsaved changes and start a new project?")) {
      return;
    }
    clearAutosave();
    editorStore.loadProject(createEmptyProject());
    editorStore.setStatus("New project");
  };

  const handleSave = async () => {
    editorStore.setStatus(await saveProject(project));
    clearAutosave();
  };

  const handleOpen = async () => {
    const opened = await openProject();
    if (opened) {
      clearAutosave();
      editorStore.loadProject(opened);
      return;
    }
    if (!isTauri()) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".eeyproj,.json";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        clearAutosave();
        editorStore.loadProject(parseProject(await file.text()));
      };
      input.click();
    }
  };

  return (
    <NeumorphicPanel title="Render & Project" className="shrink-0">
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-1.5">
          <label className="block text-[10px] uppercase tracking-wider text-muted">
            Composition
            <select
              value={`${project.resolution.width}x${project.resolution.height}`}
              onChange={(event) => {
                const [width, height] = event.target.value.split("x").map(Number);
                editorStore.updateProject((current) => {
                  const fixedSize = ["gif", "none"].includes(current.renderPreset.videoCodec);
                  return {
                    ...current,
                    resolution: { width, height },
                    renderPreset: fixedSize
                      ? current.renderPreset
                      : { ...current.renderPreset, id: "custom", name: `Custom ${width}x${height}`, width, height },
                  };
                }, "Changed composition");
              }}
              className="mt-1 w-full rounded-lg bg-recessed px-2 py-1.5 text-xs text-ink shadow-recessed-sm outline-none"
            >
              <option value="1920x1080">1920 x 1080</option>
              <option value="1080x1920">1080 x 1920</option>
              <option value="1080x1080">1080 x 1080</option>
              <option value="1280x720">1280 x 720</option>
              <option value="3840x2160">3840 x 2160</option>
            </select>
          </label>
          <label className="block text-[10px] uppercase tracking-wider text-muted">
            Frame rate
            <select
              value={project.frameRate}
              onChange={(event) => {
                const frameRate = Number(event.target.value);
                editorStore.updateProject((current) => {
                  const fixedSize = ["gif", "none"].includes(current.renderPreset.videoCodec);
                  return {
                    ...current,
                    frameRate,
                    renderPreset: fixedSize
                      ? current.renderPreset
                      : { ...current.renderPreset, id: "custom", name: `Custom ${frameRate}fps`, fps: frameRate },
                  };
                }, "Changed frame rate");
              }}
              className="mt-1 w-full rounded-lg bg-recessed px-2 py-1.5 text-xs text-ink shadow-recessed-sm outline-none"
            >
              {[24, 25, 30, 50, 60].map((rate) => (
                <option key={rate} value={rate}>
                  {rate} fps
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-[10px] uppercase tracking-wider text-muted">
          Preset
          <select
            value={project.renderPreset.id}
            onChange={(event) => setPreset(event.target.value)}
            className="mt-1 w-full rounded-lg bg-recessed px-2 py-1.5 text-xs text-ink shadow-recessed-sm outline-none"
          >
            {!RENDER_PRESETS.some((preset) => preset.id === project.renderPreset.id) && (
              <option value={project.renderPreset.id}>{project.renderPreset.name}</option>
            )}
            {RENDER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-lg bg-recessed px-2 py-1.5 text-[10px] shadow-recessed-sm">
          <div className="flex items-center gap-1.5">
            <span className="flex-1 uppercase tracking-wider text-muted">Range</span>
            <span className="font-mono text-[10px] text-ink">
              {project.exportRange
                ? `${project.exportRange.start.toFixed(2)}s - ${project.exportRange.end.toFixed(2)}s`
                : `full (${project.duration.toFixed(2)}s)`}
            </span>
          </div>
          <div className="mt-1 flex gap-1.5">
            <button
              type="button"
              title="Set the export in point at the playhead"
              onClick={() => {
                const start = editorStore.getState().playhead;
                const end = project.exportRange?.end ?? project.duration;
                editorStore.setExportRange({ start, end: Math.max(start + 0.1, end) });
              }}
              className="flex-1 rounded-md bg-surface px-2 py-1 text-[10px] text-muted shadow-raised-sm transition-colors hover:text-ink"
            >
              Set in
            </button>
            <button
              type="button"
              title="Set the export out point at the playhead"
              onClick={() => {
                const end = editorStore.getState().playhead;
                const start = project.exportRange?.start ?? 0;
                if (end > start) editorStore.setExportRange({ start, end });
              }}
              className="flex-1 rounded-md bg-surface px-2 py-1 text-[10px] text-muted shadow-raised-sm transition-colors hover:text-ink disabled:opacity-40"
            >
              Set out
            </button>
            <button
              type="button"
              title="Export the whole timeline"
              disabled={!project.exportRange}
              onClick={() => editorStore.setExportRange(null)}
              className="flex-1 rounded-md bg-surface px-2 py-1 text-[10px] text-muted shadow-raised-sm transition-colors hover:text-ink disabled:opacity-40"
            >
              Full
            </button>
          </div>
        </div>
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
            {busy ? `Rendering ${progress === null ? "" : `${Math.round(progress)}%`}` : "Export"}
          </NeumorphicButton>
          {busy && (
            <NeumorphicButton size="sm" iconOnly title="Cancel export" onClick={handleCancel} icon={<X size={14} />} />
          )}
          <NeumorphicButton size="sm" iconOnly title="New project" onClick={handleNew} icon={<FilePlus2 size={14} />} />
          <NeumorphicButton size="sm" iconOnly title="Save project" onClick={handleSave} icon={<Save size={14} />} />
          <NeumorphicButton size="sm" iconOnly title="Open project" onClick={handleOpen} icon={<FolderOpen size={14} />} />
        </div>
        {busy && (
          <div className="h-1.5 overflow-hidden rounded-full bg-recessed shadow-recessed-sm">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber via-magma to-magenta transition-[width] duration-200"
              style={{ width: `${progress ?? 0}%` }}
            />
          </div>
        )}
        <div className="flex items-center justify-between text-[10px] text-muted">
          <span className="truncate">{status}</span>
          <span className="font-mono">{previewPlan.args.length} args</span>
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

