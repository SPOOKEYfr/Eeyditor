import type {
  BezierHandle,
  Interpolation,
  Keyframe,
  KeyframeCurve,
} from "../../types/timeline";

export const LINEAR_OUT: BezierHandle = { x: 1 / 3, y: 0 };
export const LINEAR_IN: BezierHandle = { x: 1 / 3, y: 0 };

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Cubic Bezier with fixed endpoints (0,0) and (1,1). */
function bezierComponent(t: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
}

function bezierDerivative(t: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * p1 + 6 * mt * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/**
 * Solve the parametric t for a given x on a CSS-style cubic-bezier curve.
 * Uses Newton-Raphson with a bisection fallback so the solver is monotonic and
 * stable even for strongly asymmetric handles.
 */
export function solveBezierT(
  x: number,
  x1: number,
  x2: number,
): number {
  const target = clamp01(x);
  if (target <= 0) return 0;
  if (target >= 1) return 1;

  let t = target;
  for (let i = 0; i < 8; i += 1) {
    const current = bezierComponent(t, x1, x2) - target;
    if (Math.abs(current) < 1e-7) return t;
    const slope = bezierDerivative(t, x1, x2);
    if (Math.abs(slope) < 1e-8) break;
    t -= current / slope;
    if (t < 0 || t > 1) break;
  }

  let low = 0;
  let high = 1;
  t = target;
  for (let i = 0; i < 40; i += 1) {
    const current = bezierComponent(t, x1, x2);
    if (Math.abs(current - target) < 1e-7) return t;
    if (current < target) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return t;
}

/** Evaluate a normalized easing curve with the given control handles. */
export function cubicBezier(
  progress: number,
  outHandle: BezierHandle,
  inHandle: BezierHandle,
): number {
  const p1x = clamp01(outHandle.x);
  const p1y = clamp01(outHandle.y);
  const p2x = clamp01(1 - inHandle.x);
  const p2y = clamp01(1 - inHandle.y);
  const t = solveBezierT(progress, p1x, p2x);
  return bezierComponent(t, p1y, p2y);
}

export function sortKeyframes(keyframes: Keyframe[]): Keyframe[] {
  return [...keyframes].sort((a, b) => a.time - b.time);
}

export function createKeyframe(
  id: string,
  time: number,
  value: number,
  interpolation: Interpolation = "linear",
): Keyframe {
  return {
    id,
    time,
    value,
    interpolation,
    inHandle: { ...LINEAR_IN },
    outHandle: { ...LINEAR_OUT },
  };
}

/**
 * Evaluate a clip-relative curve. Before the first keyframe the first value is
 * held; after the last keyframe the last value is held. `hold` interpolation
 * preserves the outgoing value until the next keyframe.
 */
export function evaluateKeyframes(
  keyframes: Keyframe[],
  time: number,
  fallback: number,
): number {
  if (keyframes.length === 0) return fallback;
  const sorted = sortKeyframes(keyframes);
  if (time <= sorted[0].time) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (time >= last.time) return last.value;

  let previous = sorted[0];
  let next = last;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      previous = sorted[i];
      next = sorted[i + 1];
      break;
    }
  }

  const span = next.time - previous.time;
  if (span <= 0) return next.value;
  const progress = clamp01((time - previous.time) / span);

  if (previous.interpolation === "hold") return previous.value;
  if (previous.interpolation === "bezier") {
    const eased = cubicBezier(progress, previous.outHandle, next.inHandle);
    return lerp(previous.value, next.value, eased);
  }
  return lerp(previous.value, next.value, progress);
}

export function evaluateCurve(curve: KeyframeCurve, time: number): number {
  return evaluateKeyframes(curve.keyframes, time, curve.defaultValue);
}

/** Insert or replace the keyframe at exactly `time` (within epsilon). */
export function upsertKeyframe(
  keyframes: Keyframe[],
  keyframe: Keyframe,
  epsilon = 1e-4,
): Keyframe[] {
  const existing = keyframes.findIndex(
    (candidate) => Math.abs(candidate.time - keyframe.time) <= epsilon,
  );
  if (existing >= 0) {
    const next = [...keyframes];
    next[existing] = keyframe;
    return sortKeyframes(next);
  }
  return sortKeyframes([...keyframes, keyframe]);
}

export function removeKeyframe(
  keyframes: Keyframe[],
  keyframeId: string,
): Keyframe[] {
  return keyframes.filter((keyframe) => keyframe.id !== keyframeId);
}

/** Sample a curve into evenly spaced values for canvas previews. */
export function sampleCurve(
  curve: KeyframeCurve,
  from: number,
  to: number,
  samples: number,
): number[] {
  const count = Math.max(2, Math.floor(samples));
  const values: number[] = [];
  const span = to - from;
  for (let i = 0; i < count; i += 1) {
    const time = from + (span * i) / (count - 1);
    values.push(evaluateCurve(curve, time));
  }
  return values;
}
