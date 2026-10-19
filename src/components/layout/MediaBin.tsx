import { Film, Image as ImageIcon, Music, Plus, Type } from "lucide-react";
import type { MediaSource, SourceKind } from "../../types/timeline";
import { editorStore, useEditorSelector } from "../../state/editorStore";
import { createMediaSource, makeId } from "../../core/project/factory";
import { pickOpenPaths, probeMedia } from "../../lib/tauri";
import { NeumorphicButton, NeumorphicPanel } from "../neumorphic";

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

  const addSource = (source: MediaSource) => {
    editorStore.updateProject(
      (project) => ({ ...project, media: [...project.media, source] }),
      "Added media",
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
      <NeumorphicButton size="sm" iconOnly title="Import media" onClick={handleImport} icon={<Plus size={14} />} />
    }>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {media.length === 0 && (
          <p className="px-1 py-4 text-xs text-muted">
            No assets yet. Import media or add a generated field.
          </p>
        )}
        {media.map((source) => (
          <button
            key={source.id}
            type="button"
            onClick={() => addToTimeline(source)}
            className="flex w-full items-center gap-2 rounded-xl bg-recessed px-2.5 py-2 text-left shadow-recessed-sm transition-colors hover:bg-surface"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface text-amber shadow-raised-sm">
              {iconForKind(source.kind)}
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
