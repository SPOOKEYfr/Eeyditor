import { useEffect } from "react";
import { TitleBar } from "./components/layout/TitleBar";
import { ShortcutsOverlay } from "./components/layout/ShortcutsOverlay";
import { RecoveryBanner } from "./components/layout/RecoveryBanner";
import { Splash } from "./components/layout/Splash";
import { MediaBin } from "./components/layout/MediaBin";
import { Inspector } from "./components/layout/Inspector";
import { ExportPanel } from "./components/layout/ExportPanel";
import { PreviewPlayer } from "./components/player/PreviewPlayer";
import { Timeline } from "./components/timeline/Timeline";
import { usePlaybackClock } from "./hooks/usePlaybackClock";
import { useShortcuts } from "./hooks/useShortcuts";
import { useAutosave } from "./hooks/useAutosave";
import { isTauri } from "./lib/tauri";
import { editorStore } from "./state/editorStore";

function useCloseGuard(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unsubscribe = () => {};
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const stop = await getCurrentWindow().onCloseRequested((event) => {
          if (editorStore.getState().past.length === 0) return;
          event.preventDefault();
          if (window.confirm("Discard unsaved changes and close Eeyditor?")) {
            void getCurrentWindow().destroy();
          }
        });
        if (!cancelled) unsubscribe = stop;
        else stop();
      } catch (error) {
        console.error("[eeyditor] close guard failed", error);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
}

export default function App() {
  usePlaybackClock();
  useShortcuts();
  useAutosave();
  useCloseGuard();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink">
      <TitleBar />
      <Splash />
      <ShortcutsOverlay />
      <RecoveryBanner />
      <main
        className="grid min-h-0 flex-1 gap-2 p-2"
        style={{
          gridTemplateColumns: "236px minmax(0, 1fr) 304px",
          gridTemplateRows: "minmax(0, 1fr) 304px",
        }}
      >
        <div className="min-h-0">
          <MediaBin />
        </div>
        <div className="min-h-0">
          <PreviewPlayer />
        </div>
        <div className="flex min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-1">
            <Inspector />
          </div>
          <ExportPanel />
        </div>
        <div className="col-span-3 min-h-0">
          <Timeline />
        </div>
      </main>
    </div>
  );
}
