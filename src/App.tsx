import { TitleBar } from "./components/layout/TitleBar";
import { Splash } from "./components/layout/Splash";
import { MediaBin } from "./components/layout/MediaBin";
import { Inspector } from "./components/layout/Inspector";
import { ExportPanel } from "./components/layout/ExportPanel";
import { PreviewPlayer } from "./components/player/PreviewPlayer";
import { Timeline } from "./components/timeline/Timeline";
import { usePlaybackClock } from "./hooks/usePlaybackClock";
import { useShortcuts } from "./hooks/useShortcuts";

export default function App() {
  usePlaybackClock();
  useShortcuts();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink">
      <TitleBar />
      <Splash />
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
