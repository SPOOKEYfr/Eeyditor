import { useEffect, useState } from "react";
import { FileText, Film, Image as ImageIcon, Music, Plus, Type } from "lucide-react";
import type { MediaSource, SourceKind } from "../../types/timeline";
import { editorStore, useEditorSelector } from "../../state/editorStore";
import { createMediaSource, makeId } from "../../core/project/factory";
import { captureThumbnail } from "../../core/media/thumbnail";
import { setDragSource } from "../../core/dragSource";
import { parseSrt } from "../../core/subtitles/srt";
import { parseProject } from "../../core/project/serialize";
import { clearAutosave } from "../../lib/autosave";
import { convertMediaUrl, invokeSafe, onFileDrop, pickOpenPaths, probeMedia } from "../../lib/tauri";
import { NeumorphicButton, NeumorphicPanel } from "../neumorphic";

const thumbnailCache = new Map<string, string>();

const MEDIA_EXTENSIONS = [
  "mp4",
  "mov",
  "mkv",
  "webm",
  "avi",
  "wav",
  "mp3",
  "aac",
  "flac",
  "m4a",
  "ogg",
  "png",
  "jpg",
  "jpeg",
  "webp",
];

function kindForPath(path: string): SourceKind {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (["wav", "mp3", "aac", "flac", "m4a", "ogg"].includes(extension)) return "audio";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "image";
  return "video";
}

function iconForKind(kind: SourceKind): React.ReactNode {
  switch (kind) {
    case "audio":
      return <Music size={14} />;
    case "image":
      return <ImageIcon size={14} />;
    case "text":
      return <Type size={14} />;
    default:
      return <Film size={14} />;
  }
}

export function MediaBin() {
  const media = useEditorSelector((state) => state.project.media);
  const subtitles = useEditorSelector((state) => state.project.subtitles);
  const [, setThumbVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let generated = false;
      for (const source of media) {
        if (thumbnailCache.has(source.id)) continue;
        if (source.kind === "generator" || source.kind === "text") continue;
        const url = await convertMediaUrl(source.path);
        if (!url || cancelled) continue;
        const thumb = await captureThumbnail(source, url);
        if (cancelled) return;
        if (thumb) {
          thumbnailCache.set(source.id, thumb);
          generated = true;
        }
      }
      if (generated && !cancelled) setThumbVersion((version) => version + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [media]);

  const addSource = (source: MediaSource) => {
    editorStore.updateProject(
      (project) => ({ ...project, media: [...project.media, source] }),
      "Added media",
    );
  };

  const importSrtPath = async (path: string) => {
    const contents = await invokeSafe<string>("load_project", { path });
    if (!contents) return false;
    const cues = parseSrt(contents);
    if (cues.length === 0) return false;
    editorStore.updateProject(
      (project) => ({ ...project, subtitles: cues }),
      `Imported ${cues.length} subtitle cues`,
    );
    return true;
  };

  const importMediaPaths = async (paths: string[]) => {
    await importMediaPaths(paths);
  };

  const handleDroppedPaths = async (paths: string[]) => {
    let media = 0;
    for (const path of paths) {
      const extension = path.split(".").pop()?.toLowerCase() ?? "";
      if (extension === "eeyproj" || extension === "json") {
        const contents = await invokeSafe<string>("load_project", { path });
        if (!contents) continue;
        try {
          clearAutosave();
          editorStore.loadProject(parseProject(contents));
        } catch {
          editorStore.setStatus(`Could not open ${path.split(/[\\/]/).pop()}`);
        }
        continue;
      }
      if (extension === "srt") {
        const ok = await importSrtPath(path);
        if (!ok) editorStore.setStatus(`No valid cues in ${path.split(/[\\/]/).pop()}`);
        continue;
      }
      media += 1;
      void importMediaPaths([path]);
    }
    if (media > 0 && paths.length === media) return;
    if (media === 0) editorStore.setStatus("Nothing importable in the drop");
  };

  useEffect(() => {
    let active = true;
    let stop = () => {};
    void onFileDrop((paths) => {
      if (active) void handleDroppedPaths(paths);
    }).then((unsubscribe) => {
      if (active) stop = unsubscribe;
      else unsubscribe();
    });
    return () => {
      active = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImportSubtitles = async () => {
    const paths = await pickOpenPaths(["srt"], false);
    if (paths.length === 0) return;
    const contents = await invokeSafe<string>("load_project", { path: paths[0] });
    if (!contents) {
      editorStore.setStatus("Subtitle import needs the desktop app");
      return;
    }
    const cues = parseSrt(contents);
    if (cues.length === 0) {
      editorStore.setStatus("No valid cues found in the subtitle file");
      return;
    }
    editorStore.updateProject(
      (project) => ({ ...project, subtitles: cues }),
      `Imported ${cues.length} subtitle cues`,
    );
  };

  const handleAddCue = () => {
    const text = window.prompt("Subtitle text for the next 2 seconds");
    if (!text || !text.trim()) return;
    const start = editorStore.getState().playhead;
    editorStore.updateProject(
      (project) => ({
        ...project,
        subtitles: [
          ...project.subtitles,
          { id: makeId("cue"), start, end: start + 2, text: text.trim() },
        ].sort((a, b) => a.start - b.start),
      }),
      "Added subtitle cue",
    );
  };

  const handleClearSubtitles = () => {
    editorStore.updateProject(
      (project) => ({ ...project, subtitles: [] }),
      "Cleared subtitles",
    );
  };

  const handleImport = async () => {
    const paths = await pickOpenPaths(MEDIA_EXTENSIONS);
    if (paths.length === 0) {
      addSource(
        createMediaSource({
          path: `generator://field-${makeId("g").slice(-4)}`,
          kind: "generator",
          name: "Generated Field",
          duration: 8,
        }),
      );
      editorStore.setStatus("Added generated source");
      return;
    }
    for (const path of paths) {
      const extensionKind = kindForPath(path);
      const probed = await probeMedia(path);
      const kind =
        extensionKind === "image"
          ? "image"
          : probed?.kind ?? (extensionKind === "audio" ? "audio" : "video");
      addSource(
        createMediaSource({
          path,
          kind,
          name: path.split(/[\\/]/).pop() ?? "media",
          duration: probed && probed.duration > 0 ? probed.duration : 8,
          width: probed?.width || undefined,
          height: probed?.height || undefined,
          fps: probed?.fps || undefined,
          sampleRate: probed?.sampleRate || undefined,
          channels: probed?.channels || undefined,
          hasVideo: extensionKind === "image" ? true : (probed?.hasVideo ?? kind !== "audio"),
          hasAudio: extensionKind === "image" ? false : (probed?.hasAudio ?? kind === "audio"),
        }),
      );
    }
    editorStore.setStatus(`Imported ${paths.length} asset(s)`);
  };

  const addToTimeline = (source: MediaSource) => {
    const state = editorStore.getState();
    const preferred = source.kind === "audio" ? "audio" : source.kind === "text" ? "text" : "video";
    const track = state.project.tracks.find((candidate) => candidate.type === preferred) ?? state.project.tracks[0];
    if (!track) return;
    const id = editorStore.addClip(track.id, state.playhead);
    if (!id) return;
    editorStore.updateClip(id, (clip) => ({
      ...clip,
      sourceId: source.id,
      name: source.name,
      kind: source.kind,
      duration: source.duration > 0 ? source.duration : clip.duration,
    }));
  };

  return (
    <NeumorphicPanel title="Media" className="flex h-full min-h-0 flex-col" actions={
      <>
        <NeumorphicButton size="sm" iconOnly title="Import media" onClick={handleImport} icon={<Plus size={14} />} />
        <NeumorphicButton size="sm" iconOnly title="Import SRT subtitles" onClick={handleImportSubtitles} icon={<FileText size={14} />} />
      </>
    }>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        <div className="flex items-center gap-1.5 rounded-lg bg-recessed px-2 py-1.5 text-[10px] text-muted shadow-recessed-sm">
          <span className="flex-1">{subtitles.length} subtitle cues</span>
          <button type="button" onClick={handleAddCue} className="transition-colors hover:text-ink">
            Add cue
          </button>
          {subtitles.length > 0 && (
            <button type="button" onClick={handleClearSubtitles} className="transition-colors hover:text-magenta">
              Clear
            </button>
          )}
        </div>
        {subtitles.map((cue) => (
          <div
            key={cue.id}
            className="space-y-1 rounded-lg bg-recessed px-2 py-1.5 text-[10px] text-muted shadow-recessed-sm"
          >
            <div className="flex items-center gap-1.5">
              <span className="flex-1 truncate text-ink">{cue.text.replace(/\n/g, " ")}</span>
              <button
                type="button"
                title="Cycle vertical position"
                onClick={() => {
                  const next = cue.position === "bottom" ? "center" : cue.position === "center" ? "top" : "bottom";
                  editorStore.updateSubtitleCue(cue.id, (current) => ({ ...current, position: next }), "Moved cue");
                }}
                className="transition-colors hover:text-ink"
              >
                {cue.position === "top" ? "top" : cue.position === "center" ? "mid" : "low"}
              </button>
              <button
                type="button"
                title="Smaller text"
                onClick={() =>
                  editorStore.updateSubtitleCue(
                    cue.id,
                    (current) => ({ ...current, sizeScale: Math.max(0.5, (current.sizeScale ?? 1) - 0.1) }),
                    "Resized cue",
                  )
                }
                className="transition-colors hover:text-ink"
              >
                -
              </button>
              <span className="w-7 text-center font-mono text-[9px]">
                {Math.round((cue.sizeScale ?? 1) * 100)}%
              </span>
              <button
                type="button"
                title="Larger text"
                onClick={() =>
                  editorStore.updateSubtitleCue(
                    cue.id,
                    (current) => ({ ...current, sizeScale: Math.min(2, (current.sizeScale ?? 1) + 0.1) }),
                    "Resized cue",
                  )
                }
                className="transition-colors hover:text-ink"
              >
                +
              </button>
              <input
                type="color"
                value={cue.color ?? "#FFFFFF"}
                onChange={(event) =>
                  editorStore.updateSubtitleCue(cue.id, (current) => ({ ...current, color: event.target.value }), "Recoloured cue")
                }
                className="h-4 w-4 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <button
                type="button"
                title="Remove cue"
                onClick={() => editorStore.removeSubtitleCue(cue.id)}
                className="transition-colors hover:text-magenta"
              >
                x
              </button>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[9px]">
              <button
                type="button"
                title="Start at the playhead"
                onClick={() =>
                  editorStore.updateSubtitleCue(
                    cue.id,
                    (current) => {
                      const start = editorStore.getState().playhead;
                      const length = Math.max(0.2, current.end - current.start);
                      return { ...current, start, end: start + length };
                    },
                    "Moved cue",
                  )
                }
                className="transition-colors hover:text-ink"
              >
                {cue.start.toFixed(2)}s
              </button>
              <span>-</span>
              <span>{cue.end.toFixed(2)}s</span>
            </div>
          </div>
        ))}
        {media.length === 0 && (
          <p className="px-1 py-4 text-xs text-muted">
            No assets yet. Import media or add a generated field.
          </p>
        )}
        {media.map((source) => (
          <button
            key={source.id}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/eey-source", source.id);
              event.dataTransfer.setData("text/plain", source.id);
              event.dataTransfer.effectAllowed = "copy";
              setDragSource(source.id);
            }}
            onDragEnd={() => setDragSource(null)}
            onClick={() => addToTimeline(source)}
            title="Drag onto a timeline lane or click to add at the playhead"
            className="flex w-full items-center gap-2 rounded-xl bg-recessed px-2.5 py-2 text-left shadow-recessed-sm transition-colors hover:bg-surface"
          >
            <span className="grid h-9 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface text-amber shadow-raised-sm">
              {thumbnailCache.get(source.id) ? (
                <img
                  src={thumbnailCache.get(source.id)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                iconForKind(source.kind)
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-ink">{source.name}</span>
              <span className="block text-[10px] uppercase tracking-wider text-muted">
                {source.kind} · {source.duration.toFixed(1)}s
              </span>
            </span>
          </button>
        ))}
      </div>
    </NeumorphicPanel>
  );
}
