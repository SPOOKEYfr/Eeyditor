import { useEffect } from "react";
import { editorStore } from "../state/editorStore";

/** Single authoritative requestAnimationFrame clock driving playback. */
export function usePlaybackClock(): void {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const delta = (now - last) / 1000;
      last = now;
      if (delta > 0 && delta < 0.5) {
        editorStore.tick(delta);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}
