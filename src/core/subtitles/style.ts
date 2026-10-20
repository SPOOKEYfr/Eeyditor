import type { SubtitleCue } from "../../types/timeline";

/** Fraction of the frame height where a cue's last text baseline sits. */
export function subtitleBaseline(cue: SubtitleCue): number {
  const scale = cue.sizeScale ?? 1;
  switch (cue.position) {
    case "top":
      return 0.14 + 0.05 * (scale - 1);
    case "center":
      return 0.5 + 0.05 * (scale - 1);
    case "bottom":
    default:
      return 0.94 - 0.05 * (scale - 1);
  }
}

/** Effective cue font size in pixels for a given frame height. */
export function subtitleFontSize(frameHeight: number, cue: SubtitleCue): number {
  return Math.max(9, frameHeight * 0.045 * (cue.sizeScale ?? 1));
}
