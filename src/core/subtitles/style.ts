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

/** Canvas font stacks for the per-cue font family. */
const FONT_STACKS: Record<string, string> = {
  sans: '600 {SIZE}px Inter, system-ui, sans-serif',
  serif: '600 {SIZE}px "DejaVu Serif", serif',
  mono: '600 {SIZE}px "DejaVu Sans Mono", monospace',
};

export function subtitleFontStack(cue: SubtitleCue, size: number): string {
  return (FONT_STACKS[cue.font ?? "sans"] ?? FONT_STACKS.sans).replace("{SIZE}", String(Math.round(size)));
}

/** Fontconfig family for drawtext, or null to use the system default. */
export function subtitleFontFamily(cue: SubtitleCue): string | null {
  switch (cue.font) {
    case "serif":
      return "DejaVu Serif";
    case "mono":
      return "DejaVu Sans Mono";
    case "sans":
      return null;
    default:
      return null;
  }
}
