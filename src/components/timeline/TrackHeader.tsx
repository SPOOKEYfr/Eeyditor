import {
  Eye,
  EyeOff,
  Lock,
  LockOpen,
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

  return (
    <div
      className={cn(
        "group flex items-center gap-2 border-b border-black/40 px-2",
        selected ? "bg-surface" : "bg-[#15161d]",
      )}
      style={{ height }}
      onClick={() => editorStore.selectTrack(track.id)}
    >
      <span
        className="h-6 w-1 rounded-full"
        style={{ background: TYPE_ACCENT[track.type] }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-ink">{track.name}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted">
          {track.type}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {track.type === "audio" ? (
          <IconToggle
            active={track.muted}
            title="Mute"
            onClick={() => toggle((t) => ({ ...t, muted: !t.muted }))}
            on={<VolumeX size={13} />}
            off={<Volume2 size={13} />}
          />
        ) : (
          <IconToggle
            active={track.hidden}
            title="Hide"
            onClick={() => toggle((t) => ({ ...t, hidden: !t.hidden }))}
            on={<EyeOff size={13} />}
            off={<Eye size={13} />}
          />
        )}
        <IconToggle
          active={track.locked}
          title="Lock"
          onClick={() => toggle((t) => ({ ...t, locked: !t.locked }))}
          on={<Lock size={13} />}
          off={<LockOpen size={13} />}
        />
      </div>
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
