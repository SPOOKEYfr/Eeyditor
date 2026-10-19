import type { EffectInstance } from "../../types/timeline";

export interface CanvasEffectPlan {
  /** A CSS filter string applied through `CanvasRenderingContext2D.filter`. */
  filter: string;
  /** Vignette strength in 0..1, drawn as a radial overlay. */
  vignette: number;
}

/**
 * Translate the export effect stack into an equivalent canvas filter plan.
 * Sharpen, chroma-key and LUT stay export-only because they need per-pixel
 * processing that the 2D context cannot express.
 */
export function canvasEffectPlan(effects: EffectInstance[]): CanvasEffectPlan {
  const parts: string[] = [];
  let vignette = 0;

  for (const effect of effects) {
    if (!effect.enabled) continue;
    switch (effect.kind) {
      case "blur":
        parts.push(`blur(${Math.max(0, effect.amount * 6)}px)`);
        break;
      case "brightness":
        parts.push(`brightness(${Math.max(0, 1 + (effect.amount - 1) * 0.5)})`);
        break;
      case "contrast":
        parts.push(`contrast(${Math.max(0, effect.amount)})`);
        break;
      case "saturation":
        parts.push(`saturate(${Math.max(0, effect.amount)})`);
        break;
      case "hue":
        parts.push(`hue-rotate(${effect.amount * 180}deg)`);
        break;
      case "glow":
        parts.push(`blur(${Math.max(0, effect.amount * 3)}px)`);
        break;
      case "vignette":
        vignette = Math.max(vignette, Math.min(1, effect.amount));
        break;
      default:
        break;
    }
  }

  return { filter: parts.join(" ") || "none", vignette };
}

export function drawVignette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  strength: number,
): void {
  if (strength <= 0) return;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const gradient = ctx.createRadialGradient(
    cx,
    cy,
    Math.min(width, height) * 0.2,
    cx,
    cy,
    Math.max(width, height) * 0.72,
  );
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, `rgba(0,0,0,${Math.min(1, strength)})`);
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}
