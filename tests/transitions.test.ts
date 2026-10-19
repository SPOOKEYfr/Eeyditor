import { describe, expect, it } from "vitest";
import { createClip } from "../src/core/project/factory";
import {
  hasTransition,
  transitionOpacityFactor,
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
});
