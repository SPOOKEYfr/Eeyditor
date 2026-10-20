import {
  Copy,
  Eye,
  EyeOff,
  Headphones,
  Lock,
  LockOpen,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { TimelineTrack } from "../../types/timeline";
import { editorStore } from "../../state/editorStore";
import { cn } from "../../lib/cn";

const TYPE_ACCENT: Record<TimelineTrack["type"], string> = {
  video: "#FF5100",
  overlay: "#E60067",
  effects: "#7C5CFF",
  text: "#FFB300",
  audio: "#2EE6A8",
  adjustment: "#26C6DA",
};

export interface TrackHeaderProps {
  track: TimelineTrack;
  selected: boolean;
  height: number;
}

export function TrackHeader({ track, selected, height }: TrackHeaderProps) {
  const toggle = (recipe: (track: TimelineTrack) => TimelineTrack) => {
    editorStore.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((candidate) =>
        candidate.id === track.id ? recipe(candidate) : candidate,
      ),
    }), "Updated track", false);
  };

  const showVolume =
    track.type === "audio" || track.type === "video" || track.type === "overlay";

  return (
    <div
      className={cn(
        "flex flex-col justify-center gap-1 border-b border-black/40 px-2",
        selected ? "bg-surface" : "bg-[#15161d]",
      )}
      style={{ height }}
      onClick={() => editorStore.selectTrack(track.id)}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-6 w-1 rounded-full"
          style={{ background: TYPE_ACCENT[track.type] }}
        />
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-xs font-medium text-ink"
            title="Double-click to rename"
            onDoubleClick={() => {
              const name = window.prompt("Track name", track.name);
              if (name && name.trim()) {
                editorStore.updateProject(
                  (project) => ({
                    ...project,
                    tracks: project.tracks.map((candidate) =>
                      candidate.id === track.id ? { ...candidate, name: name.trim() } : candidate,
                    ),
                  }),
                  "Renamed track",
                  false,
                );
              }
            }}
          >
            {track.name}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted">
            {track.type}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Duplicate track"
            onClick={(event) => {
              event.stopPropagation();
              editorStore.duplicateTrack(track.id);
            }}
            className="grid h-5 w-5 place-items-center text-muted transition-colors hover:text-ink"
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            title={track.clips.length > 0 ? `Delete track (${track.clips.length} clips)` : "Delete track"}
            onClick={(event) => {
              event.stopPropagation();
              if (
                track.clips.length > 0 &&
                !window.confirm(`Delete ${track.name} and its ${track.clips.length} clip(s)?`)
              ) {
                return;
              }
              editorStore.removeTrack(track.id);
            }}
            className="grid h-5 w-5 place-items-center text-muted transition-colors hover:text-magenta"
          >
            <Trash2 size={13} />
          </button>
          {track.type !== "audio" && (
            <IconToggle
              active={track.hidden}
              title="Hide"
              onClick={() => toggle((t) => ({ ...t, hidden: !t.hidden }))}
              on={<EyeOff size={13} />}
              off={<Eye size={13} />}
            />
          )}
          <IconToggle
            active={track.muted}
            title="Mute"
            onClick={() => toggle((t) => ({ ...t, muted: !t.muted }))}
            on={<VolumeX size={13} />}
            off={<Volume2 size={13} />}
          />
          <IconToggle
            active={track.solo}
            title="Solo"
            onClick={() => toggle((t) => ({ ...t, solo: !t.solo }))}
            on={<Headphones size={13} />}
            off={<Headphones size={13} />}
          />
          <IconToggle
            active={track.locked}
            title="Lock"
            onClick={() => toggle((t) => ({ ...t, locked: !t.locked }))}
            on={<Lock size={13} />}
            off={<LockOpen size={13} />}
          />
        </div>
      </div>
      {showVolume && (
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            min={-60}
            max={12}
            step={0.5}
            value={track.volume}
            title={`Volume ${track.volume.toFixed(1)} dB`}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) =>
              toggle((t) => ({ ...t, volume: Number(event.target.value) }))
            }
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-recessed"
            style={{ accentColor: TYPE_ACCENT[track.type] }}
          />
          <span className="w-9 text-right font-mono text-[9px] text-muted">
            {track.volume.toFixed(1)}dB
          </span>
        </div>
      )}
    </div>
  );
}

interface IconToggleProps {
  active: boolean;
  title: string;
  on: React.ReactNode;
  off: React.ReactNode;
  onClick: () => void;
}

function IconToggle({ active, title, on, off, onClick }: IconToggleProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "grid h-6 w-6 place-items-center rounded-md transition-colors",
        active ? "bg-brand/20 text-amber" : "text-muted hover:text-ink",
      )}
    >
      {active ? on : off}
    </button>
  );
}
