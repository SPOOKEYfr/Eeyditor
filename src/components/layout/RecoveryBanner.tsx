import { useState } from "react";
import { editorStore } from "../../state/editorStore";
import { clearAutosave, loadAutosave } from "../../lib/autosave";

export function RecoveryBanner() {
  const [record] = useState(() => loadAutosave());
  const [visible, setVisible] = useState(() => Boolean(record));

  if (!visible || !record) return null;
  const minutes = Math.max(0, Math.round((Date.now() - record.savedAt) / 60000));
  const age = minutes < 60
    ? minutes < 1
      ? "just now"
      : `${minutes} min ago`
    : minutes < 60 * 24
      ? `${Math.round(minutes / 60)} h ago`
      : `${Math.round(minutes / (60 * 24))} days ago`;
  const stale = minutes >= 60 * 24;

  return (
    <div className="fixed left-1/2 top-12 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-surface px-3 py-2 text-[11px] text-ink shadow-raised">
      <span className={stale ? "text-amber" : "text-muted"}>
        Unsaved session from {age}:
        <span className="ml-1 text-ink/80">{record.project.name}</span>
      </span>
      <button
        type="button"
        onClick={() => {
          editorStore.loadProject(record.project);
          editorStore.setStatus("Restored autosaved session");
          clearAutosave();
          setVisible(false);
        }}
        className="rounded-md bg-brand px-2 py-1 text-[10px] font-semibold text-black shadow-raised-sm"
      >
        Restore
      </button>
      <button
        type="button"
        onClick={() => {
          clearAutosave();
          setVisible(false);
        }}
        className="text-[10px] text-muted transition-colors hover:text-ink"
      >
        Dismiss
      </button>
    </div>
  );
}
