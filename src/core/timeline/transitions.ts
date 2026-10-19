import type { TimelineClip } from "../../types/timeline";
import { clamp01 } from "../keyframes/bezier";

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

/**
 * Opacity multiplier for a clip's edge transitions, evaluated at clip-relative
 * time. A trailing `transitionOut` ramps the clip down; a leading
 * `transitionIn` ramps it up. When two clips overlap on a track the two ramps
 * compose into a cross-dissolve; on adjacent clips they render as fades.
 */
export function transitionOpacityFactor(clip: TimelineClip, localTime: number): number {
  let factor = 1;
  const fadeIn = transitionInDuration(clip);
  if (fadeIn > 0 && localTime < fadeIn) {
    factor *= clamp01(localTime / fadeIn);
  }
  const fadeOut = transitionOutDuration(clip);
  if (fadeOut > 0) {
    const start = clip.duration - fadeOut;
    if (localTime > start) {
      factor *= clamp01((clip.duration - localTime) / fadeOut);
    }
  }
  return clamp01(factor);
}
