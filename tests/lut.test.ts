import { describe, expect, it } from "vitest";
import { applyLutToRgba, lutPath, parseCube } from "../src/core/effects/lut";

const INVERT_CUBE = `TITLE "Invert"
LUT_3D_SIZE 2
1.0 1.0 1.0
0.0 1.0 1.0
1.0 0.0 1.0
0.0 0.0 1.0
1.0 1.0 0.0
0.0 1.0 0.0
1.0 0.0 0.0
0.0 0.0 0.0
`;

const IDENTITY_CUBE = `LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;

describe("cube luts", () => {
  it("parses size, title and entries", () => {
    const lut = parseCube(INVERT_CUBE);
    expect(lut?.size).toBe(2);
    expect(lut?.title).toBe("Invert");
    expect(lut?.data.length).toBe(2 * 2 * 2 * 3);
  });

  it("rejects malformed data", () => {
    expect(parseCube("LUT_1D_SIZE 32\n0 0 0")).toBeNull();
    expect(parseCube("LUT_3D_SIZE 2\n0 0 0")).toBeNull();
    expect(parseCube("")).toBeNull();
  });

  it("inverts RGB through the table", () => {
    const lut = parseCube(INVERT_CUBE);
    if (!lut) throw new Error("lut missing");
    const data = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      64, 128, 192, 255,
    ]);
    applyLutToRgba(data, 3, 1, lut);
    expect([...data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...data.slice(4, 8)]).toEqual([0, 0, 0, 255]);
    expect([...data.slice(8, 12)]).toEqual([191, 127, 63, 255]);
  });

  it("leaves an identity table unchanged and honours the alpha channel", () => {
    const lut = parseCube(IDENTITY_CUBE);
    if (!lut) throw new Error("lut missing");
    const data = new Uint8ClampedArray([10, 200, 30, 128]);
    applyLutToRgba(data, 1, 1, lut);
    expect([...data]).toEqual([10, 200, 30, 128]);
  });

  it("finds the first enabled lut path", () => {
    const effects: { kind: string; enabled: boolean; params: Record<string, string> }[] = [
      { kind: "lut", enabled: false, params: { path: "/a.cube" } },
      { kind: "blur", enabled: true, params: {} },
      { kind: "lut", enabled: true, params: { path: "/b.cube" } },
    ];
    expect(lutPath(effects)).toBe("/b.cube");
    expect(lutPath([{ kind: "lut", enabled: true, params: {} }])).toBeNull();
  });
});
