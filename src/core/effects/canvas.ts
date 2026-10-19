import type { EffectInstance } from "../../types/timeline";

export interface CanvasEffectPlan {
  /** A CSS filter string applied through `CanvasRenderingContext2D.filter`. */
  filter: string;
  /** Vignette strength in 0..1, drawn as a radial overlay. */
  vignette: number;
}

/**
 * Translate the export effect stack into an equivalent canvas filter plan.
 * Chroma-key is applied separately as a per-pixel pass; sharpen and LUT stay
 * export-only because the 2D context cannot express a convolution or a
 * three-dimensional lookup.
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

/** Enabled chroma-key strength, or 0 when the clip has no active key. */
export function chromaKeyStrength(effects: EffectInstance[]): number {
  let strength = 0;
  for (const effect of effects) {
    if (effect.enabled && effect.kind === "chroma-key") {
      strength = Math.max(strength, effect.amount);
    }
  }
  return strength;
}

const scratch = typeof document !== "undefined" ? document.createElement("canvas") : null;

/** Reusable offscreen surface for keying, capped to keep per-frame cost bounded. */
export function chromaKeyScratch(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  if (!scratch) return null;
  const scale = Math.min(1, 960 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (scratch.width !== w) scratch.width = w;
  if (scratch.height !== h) scratch.height = h;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  return ctx ? { canvas: scratch, ctx, width: w, height: h } : null;
}

/** Remove near-green pixels with a soft alpha edge, matching FFmpeg's colorkey. */
export function applyChromaKey(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number,
): void {
  if (strength <= 0 || width <= 0 || height <= 0) return;
  const image = ctx.getImageData(0, 0, width, height);
  const pixels = image.data;
  const threshold = 0.22 + Math.min(0.25, strength * 0.12);
  const feather = 0.14;
  const maxDistance = Math.SQRT2;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index] / 255;
    const green = pixels[index + 1] / 255;
    const blue = pixels[index + 2] / 255;
    const distance =
      Math.sqrt(red * red + (green - 1) * (green - 1) + blue * blue) / maxDistance;
    if (distance <= threshold) {
      pixels[index + 3] = 0;
    } else if (distance < threshold + feather) {
      const factor = (distance - threshold) / feather;
      pixels[index + 3] = Math.round(pixels[index + 3] * factor);
    }
  }
  ctx.putImageData(image, 0, 0);
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
