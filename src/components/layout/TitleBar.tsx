import { CircleHelp, Minus, Square, X } from "lucide-react";
import type { Window as TauriWindow } from "@tauri-apps/api/window";
import logo from "../../assets/logo.png";
import { isTauri } from "../../lib/tauri";
import { editorStore, useEditorSelector } from "../../state/editorStore";
import { cn } from "../../lib/cn";

async function withWindow(action: (win: TauriWindow) => Promise<void>): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await action(getCurrentWindow());
  } catch (error) {
    console.error("[eeyditor] window action failed", error);
  }
}

export function TitleBar() {
  const projectName = useEditorSelector((state) => state.project.name);
  const dirty = useEditorSelector((state) => state.past.length > 0);

  return (
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-3 border-b border-black/50 bg-surface px-3 shadow-raised-sm"
    >
      <div className="flex items-center gap-2">
        <img
          src={logo}
          alt="Eeyditor"
          className="h-7 w-7 rounded-lg shadow-raised-sm"
          draggable={false}
        />
        <div className="leading-none">
          <div className="bg-brand bg-clip-text text-sm font-extrabold tracking-tight text-transparent">
            EEYDITOR
          </div>
          <div className="text-[9px] uppercase tracking-[0.28em] text-muted">
            precision editing
          </div>
        </div>
      </div>

      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center justify-center gap-2 text-xs text-muted"
      >
        <span className="truncate text-ink/80">{projectName}</span>
        {dirty && <span className="text-amber">•</span>}
      </div>

      <div className="flex items-center gap-1">
        <WindowButton
          title="Keyboard shortcuts"
          onClick={() => editorStore.setShortcuts(true)}
          icon={<CircleHelp size={14} />}
        />
        <WindowButton title="Minimize" onClick={() => withWindow((win) => win.minimize())} icon={<Minus size={14} />} />
        <WindowButton title="Maximize" onClick={() => withWindow((win) => win.toggleMaximize())} icon={<Square size={12} />} />
        <WindowButton
          title={dirty ? "Close (unsaved changes)" : "Close"}
          danger
          onClick={() => {
            if (dirty && !window.confirm("Discard unsaved changes and close?")) return;
            void withWindow((win) => win.close());
          }}
          icon={<X size={14} />}
        />
      </div>
    </header>
  );
}

interface WindowButtonProps {
  title: string;
  danger?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}

function WindowButton({ title, danger, icon, onClick }: WindowButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "grid h-7 w-9 place-items-center rounded-md text-muted transition-colors",
        danger ? "hover:bg-magenta hover:text-white" : "hover:bg-white/[0.06] hover:text-ink",
      )}
    >
      {icon}
    </button>
  );
}
