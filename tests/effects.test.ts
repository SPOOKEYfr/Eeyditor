import { describe, expect, it } from "vitest";
import { canvasEffectPlan, chromaKeyStrength } from "../src/core/effects/canvas";
import { createEffect } from "../src/core/project/factory";

describe("canvas effect parity", () => {
  it("maps supported effects into a single filter string", () => {
    const plan = canvasEffectPlan([
      createEffect("blur", 1),
      createEffect("brightness", 1.4),
      createEffect("contrast", 1.2),
      createEffect("saturation", 0.5),
      createEffect("hue", 0.5),
    ]);
    expect(plan.filter).toContain("blur(");
    expect(plan.filter).toContain("brightness(1.2)");
    expect(plan.filter).toContain("contrast(1.2)");
    expect(plan.filter).toContain("saturate(0.5)");
    expect(plan.filter).toContain("hue-rotate(90deg)");
    expect(plan.vignette).toBe(0);
  });

  it("collects vignette strength and skips disabled effects", () => {
    const disabled = { ...createEffect("blur", 1), enabled: false };
    const plan = canvasEffectPlan([createEffect("vignette", 0.6), disabled]);
    expect(plan.filter).toBe("none");
    expect(plan.vignette).toBeCloseTo(0.6);
  });

  it("uses a no-op filter when nothing is applicable", () => {
    expect(canvasEffectPlan([createEffect("sharpen", 1)]).filter).toBe("none");
    expect(canvasEffectPlan([]).filter).toBe("none");
  });

  it("reports the strongest enabled chroma-key", () => {
    const disabled = { ...createEffect("chroma-key", 2), enabled: false };
    expect(chromaKeyStrength([])).toBe(0);
    expect(chromaKeyStrength([disabled])).toBe(0);
    expect(chromaKeyStrength([createEffect("chroma-key", 0.5)])).toBeCloseTo(0.5);
    expect(
      chromaKeyStrength([createEffect("chroma-key", 0.5), createEffect("chroma-key", 1.2)]),
    ).toBeCloseTo(1.2);
  });
});
