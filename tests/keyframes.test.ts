import { describe, expect, it } from "vitest";
import {
  cubicBezier,
  createKeyframe,
  evaluateCurve,
  evaluateKeyframes,
  removeKeyframe,
  solveBezierT,
  upsertKeyframe,
} from "../src/core/keyframes/bezier";
import type { Keyframe } from "../src/types/timeline";

function kf(time: number, value: number, interpolation: Keyframe["interpolation"] = "linear"): Keyframe {
  return createKeyframe(`k${time}`, time, value, interpolation);
}

describe("keyframe interpolation", () => {
  it("returns the fallback when no keyframes exist", () => {
    expect(evaluateKeyframes([], 5, 0.42)).toBe(0.42);
  });

  it("linearly interpolates between keyframes", () => {
    const frames = [kf(0, 0), kf(10, 100)];
    expect(evaluateKeyframes(frames, 0, 0)).toBe(0);
    expect(evaluateKeyframes(frames, 5, 0)).toBeCloseTo(50, 6);
    expect(evaluateKeyframes(frames, 10, 0)).toBe(100);
  });

  it("holds the previous value for hold interpolation", () => {
    const frames = [kf(0, 10, "hold"), kf(4, 90)];
    expect(evaluateKeyframes(frames, 3.9, 0)).toBe(10);
    expect(evaluateKeyframes(frames, 4, 0)).toBe(90);
  });

  it("clamps outside the keyframe range", () => {
    const frames = [kf(2, 5), kf(6, 9)];
    expect(evaluateKeyframes(frames, 0, -1)).toBe(5);
    expect(evaluateKeyframes(frames, 100, -1)).toBe(9);
  });

  it("solves cubic bezier easing monotonically", () => {
    let previous = -1;
    for (let i = 0; i <= 100; i += 1) {
      const x = i / 100;
      const t = solveBezierT(x, 0.42, 0.58);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
      expect(t).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = t;
    }
  });

  it("produces a symmetric ease-in-out at the midpoint", () => {
    const mid = cubicBezier(0.5, { x: 0.42, y: 0 }, { x: 0.42, y: 0 });
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });

  it("evaluates a bezier keyframe segment without overshooting", () => {
    const start = kf(0, 0, "bezier");
    start.outHandle = { x: 0.2, y: 0.7 };
    const end = kf(2, 1, "bezier");
    end.inHandle = { x: 0.3, y: 0.4 };
    const values = [];
    for (let i = 0; i <= 20; i += 1) values.push(evaluateKeyframes([start, end], i / 10, 0));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(-0.001);
    expect(Math.max(...values)).toBeLessThanOrEqual(1.001);
  });

  it("upserts and sorts keyframes by time", () => {
    const frames = upsertKeyframe([kf(2, 2), kf(0, 0)], kf(1, 1));
    expect(frames.map((frame) => frame.time)).toEqual([0, 1, 2]);
    const replaced = upsertKeyframe(frames, kf(1, 99));
    expect(replaced.find((frame) => frame.time === 1)?.value).toBe(99);
    expect(replaced).toHaveLength(3);
  });

  it("removes keyframes by id", () => {
    const frames = [kf(0, 0), kf(1, 1)];
    expect(removeKeyframe(frames, "k0")).toHaveLength(1);
  });

  it("evaluates a curve using its default when empty", () => {
    expect(evaluateCurve({ property: "opacity", defaultValue: 0.5, keyframes: [] }, 3)).toBe(0.5);
  });
});
