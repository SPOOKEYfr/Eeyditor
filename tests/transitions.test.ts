import { describe, expect, it } from "vitest";
import { createClip } from "../src/core/project/factory";
import {
  hasTransition,
  slideOffset,
  transitionOpacityFactor,
  wipeRect,
} from "../src/core/timeline/transitions";

function clipWithTransition(duration = 4) {
  const clip = createClip({ trackId: "track", start: 0, duration, kind: "video" });
  clip.transitionIn = {
    id: "tin",
    kind: "fade",
    duration: 1,
    direction: "left",
  };
  clip.transitionOut = {
    id: "tout",
    kind: "dissolve",
    duration: 1,
    direction: "right",
  };
  return clip;
}

describe("clip transitions", () => {
  it("detects configured transitions", () => {
    const clip = clipWithTransition();
    expect(hasTransition(clip)).toBe(true);
    expect(hasTransition(createClip({ trackId: "t", start: 0, duration: 2, kind: "video" }))).toBe(false);
  });

  it("ramps in and out linearly at the clip edges", () => {
    const clip = clipWithTransition(4);
    expect(transitionOpacityFactor(clip, 0)).toBe(0);
    expect(transitionOpacityFactor(clip, 0.5)).toBeCloseTo(0.5);
    expect(transitionOpacityFactor(clip, 2)).toBe(1);
    expect(transitionOpacityFactor(clip, 3.5)).toBeCloseTo(0.5);
    expect(transitionOpacityFactor(clip, 4)).toBe(0);
  });

  it("clamps to the range even with overlapping edges", () => {
    const clip = clipWithTransition(1);
    for (const local of [-1, 0, 0.25, 0.5, 0.75, 1, 2]) {
      const value = transitionOpacityFactor(clip, local);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("reveals a wipe spatially instead of fading", () => {
    const clip = createClip({ trackId: "track", start: 0, duration: 4, kind: "video" });
    clip.transitionIn = { id: "t", kind: "wipe", duration: 1, direction: "left" };
    const rect = { x: 100, y: 50, w: 200, h: 100 };
    expect(transitionOpacityFactor(clip, 0.5)).toBe(1);
    expect(wipeRect(clip, 0.5, rect)).toEqual({ x: 100, y: 50, w: 100, h: 100 });
    expect(wipeRect(clip, 0, rect)).toBeNull();
    expect(wipeRect(clip, 2, rect)).toBeUndefined();
  });

  it("slides a clip in from the requested side", () => {
    const clip = createClip({ trackId: "track", start: 0, duration: 4, kind: "video" });
    clip.transitionIn = { id: "t", kind: "slide", duration: 1, direction: "right" };
    const rect = { x: 0, y: 0, w: 200, h: 100 };
    expect(slideOffset(clip, 0, rect).dx).toBeCloseTo(200);
    expect(slideOffset(clip, 0.5, rect).dx).toBeCloseTo(100);
    expect(slideOffset(clip, 1, rect).dx).toBeCloseTo(0);
    expect(slideOffset(clip, 0.5, rect).dy).toBeCloseTo(0);
  });
});
