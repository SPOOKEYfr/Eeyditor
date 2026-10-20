import { useEffect } from "react";
import { X } from "lucide-react";
import { editorStore, useEditorSelector } from "../../state/editorStore";

export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Playback",
    items: [
      ["Space", "Play / pause"],
      ["J / K / L", "Step back / pause / play"],
      ["← / →", "Step one frame"],
      ["Shift + ← / →", "Step one second"],
      ["Home / End", "Jump to start / end"],
    ],
  },
  {
    title: "Editing",
    items: [
      ["V / C", "Select / blade tool"],
      ["Ctrl + B", "Split at playhead"],
      ["Ctrl + C / X / V", "Copy / cut / paste"],
      ["Ctrl + D", "Duplicate clip"],
      ["Delete", "Ripple delete"],
      ["M", "Add marker"],
    ],
  },
  {
    title: "View",
    items: [
      ["Ctrl + Z", "Undo"],
      ["Ctrl + Shift + Z", "Redo"],
      ["Ctrl + wheel", "Zoom timeline"],
      ["S", "Toggle snapping"],
      ["+ / -", "Zoom in / out"],
      ["?", "Toggle this panel"],
    ],
  },
];

export function ShortcutsOverlay() {
  const open = useEditorSelector((state) => state.showShortcuts);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") editorStore.setShortcuts(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/55 p-6"
      onClick={() => editorStore.setShortcuts(false)}
    >
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-2xl rounded-2xl bg-surface p-4 shadow-raised"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center">
          <h2 className="flex-1 text-sm font-semibold tracking-tight text-ink">Keyboard shortcuts</h2>
          <button
            type="button"
            title="Close"
            onClick={() => editorStore.setShortcuts(false)}
            className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="rounded-xl bg-recessed p-2.5 shadow-recessed-sm">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                {group.title}
              </div>
              <dl className="space-y-1">
                {group.items.map(([keys, label]) => (
                  <div key={keys} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <dt className="font-mono text-[10px] text-amber">{keys}</dt>
                    <dd className="text-right text-muted">{label}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
