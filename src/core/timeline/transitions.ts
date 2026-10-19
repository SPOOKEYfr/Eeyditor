import type { TimelineClip, TransitionKind } from "../../types/timeline";
import { clamp01 } from "../keyframes/bezier";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Offset {
  dx: number;
  dy: number;
}

export function transitionInDuration(clip: TimelineClip): number {
  return clip.transitionIn?.duration && clip.transitionIn.duration > 0
    ? clip.transitionIn.duration
    : 0;
}

export function transitionOutDuration(clip: TimelineClip): number {
  return clip.transitionOut?.duration && clip.transitionOut.duration > 0
    ? clip.transitionOut.duration
    : 0;
}

export function hasTransition(clip: TimelineClip): boolean {
  return transitionInDuration(clip) > 0 || transitionOutDuration(clip) > 0;
}

/** Kinds that are rendered as an opacity fade rather than a spatial move. */
export function isFadeKind(kind: TransitionKind | undefined): boolean {
  return kind === "fade" || kind === "dissolve" || kind === "zoom";
}

/**
 * Opacity multiplier for a clip's edge transitions, evaluated at clip-relative
 * time. Wipe and slide transitions are spatial and return 1 here; use
 * `wipeRect` and `slideOffset` for those.
 */
export function transitionOpacityFactor(clip: TimelineClip, localTime: number): number {
  let factor = 1;
  const fadeIn = transitionInDuration(clip);
  if (fadeIn > 0 && isFadeKind(clip.transitionIn?.kind) && localTime < fadeIn) {
    factor *= clamp01(localTime / fadeIn);
  }
  const fadeOut = transitionOutDuration(clip);
  if (fadeOut > 0 && isFadeKind(clip.transitionOut?.kind)) {
    const start = clip.duration - fadeOut;
    if (localTime > start) {
      factor *= clamp01((clip.duration - localTime) / fadeOut);
    }
  }
  return clamp01(factor);
}

function revealRect(rect: Rect, direction: "left" | "right" | "up" | "down", fraction: number): Rect {
  const f = clamp01(fraction);
  switch (direction) {
    case "right":
      return { x: rect.x + rect.w * (1 - f), y: rect.y, w: rect.w * f, h: rect.h };
    case "up":
      return { x: rect.x, y: rect.y, w: rect.w, h: rect.h * f };
    case "down":
      return { x: rect.x, y: rect.y + rect.h * (1 - f), w: rect.w, h: rect.h * f };
    case "left":
    default:
      return { x: rect.x, y: rect.y, w: rect.w * f, h: rect.h };
  }
}

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/**
 * Visible frame-space rectangle for a wipe transition. Returns undefined when
 * the clip has no wipe, null when the wipe currently hides it completely.
 */
export function wipeRect(
  clip: TimelineClip,
  localTime: number,
  rect: Rect,
): Rect | null | undefined {
  let visible: Rect | null = null;
  let active = false;
  const fadeIn = transitionInDuration(clip);
  if (clip.transitionIn?.kind === "wipe" && fadeIn > 0 && localTime < fadeIn) {
    active = true;
    visible = revealRect(rect, clip.transitionIn.direction, localTime / fadeIn);
  }
  const fadeOut = transitionOutDuration(clip);
  if (clip.transitionOut?.kind === "wipe" && fadeOut > 0) {
    const start = clip.duration - fadeOut;
    if (localTime > start) {
      active = true;
      const fraction = 1 - clamp01((localTime - start) / fadeOut);
      const shrinking = revealRect(rect, clip.transitionOut.direction, fraction);
      visible = visible ? intersect(visible, shrinking) : shrinking;
    }
  }
  if (!active) return undefined;
  return visible && visible.w > 0 && visible.h > 0 ? visible : null;
}

/** Slide offset in pixels for the clip's edge transitions at clip-local time. */
export function slideOffset(clip: TimelineClip, localTime: number, rect: Rect): Offset {
  let dx = 0;
  let dy = 0;
  const apply = (
    direction: "left" | "right" | "up" | "down",
    offscreen: number,
  ) => {
    const amountX = rect.w * offscreen;
    const amountY = rect.h * offscreen;
    switch (direction) {
      case "left":
        dx -= amountX;
        break;
      case "right":
        dx += amountX;
        break;
      case "up":
        dy -= amountY;
        break;
      case "down":
        dy += amountY;
        break;
    }
  };
  const fadeIn = transitionInDuration(clip);
  if (clip.transitionIn?.kind === "slide" && fadeIn > 0 && localTime < fadeIn) {
    apply(clip.transitionIn.direction, 1 - clamp01(localTime / fadeIn));
  }
  const fadeOut = transitionOutDuration(clip);
  if (clip.transitionOut?.kind === "slide" && fadeOut > 0) {
    const start = clip.duration - fadeOut;
    if (localTime > start) {
      apply(clip.transitionOut.direction, clamp01((localTime - start) / fadeOut));
    }
  }
  return { dx, dy };
}

const ZOOM_AMOUNT = 0.12;

function smoothstep(value: number): number {
  const p = clamp01(value);
  return p * p * (3 - 2 * p);
}

/**
 * Scale multiplier for zoom transitions, evaluated at clip-relative time.
 * Starts slightly enlarged and settles at 1 (in), or grows on the way out.
 */
export function zoomFactor(clip: TimelineClip, localTime: number): number {
  let strength = 0;
  const inDuration = transitionInDuration(clip);
  if (inDuration > 0 && clip.transitionIn?.kind === "zoom") {
    strength = Math.max(strength, smoothstep(1 - localTime / inDuration));
  }
  const outDuration = transitionOutDuration(clip);
  if (outDuration > 0 && clip.transitionOut?.kind === "zoom") {
    strength = Math.max(strength, smoothstep(1 - (clip.duration - localTime) / outDuration));
  }
  return 1 + ZOOM_AMOUNT * strength;
}

/**
 * Filter-graph scale multiplier for zoom transitions. `timeExpr` must resolve
 * to clip-relative seconds (the export chain uses global timestamps).
 */
export function zoomScaleExpression(clip: TimelineClip, timeExpr: string): string | null {
  const terms: string[] = [];
  const inDuration = transitionInDuration(clip);
  if (inDuration > 0 && clip.transitionIn?.kind === "zoom") {
    const p = `min(1,max(0,1-(${timeExpr})/${inDuration}))`;
    terms.push(`(${p})*(${p})*(3-2*(${p}))`);
  }
  const outDuration = transitionOutDuration(clip);
  if (outDuration > 0 && clip.transitionOut?.kind === "zoom") {
    const p = `min(1,max(0,1-(${clip.duration}-(${timeExpr}))/${outDuration}))`;
    terms.push(`(${p})*(${p})*(3-2*(${p}))`);
  }
  if (!terms.length) return null;
  const strength = terms.length === 1 ? terms[0] : `max(${terms.join(",")})`;
  return `1+${ZOOM_AMOUNT}*(${strength})`;
}
