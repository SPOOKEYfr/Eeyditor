/**
 * Minimal Adobe `.cube` 3D LUT support.
 *
 * Only the parts needed by the monitor are implemented: `LUT_3D_SIZE`, an
 * optional `DOMAIN_MIN`/`DOMAIN_MAX`, and `TITLE`. 1D LUTs are ignored.
 */
export interface LutTable {
  title: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** Red-fastest, then green, then blue; 3 floats per entry, 0..1. */
  data: Float32Array;
}

const DOMAIN_DEFAULT = 1;

export function parseCube(text: string): LutTable | null {
  const lines = text.split(/\r?\n/);
  let size = 0;
  let title = "LUT";
  const domainMin: [number, number, number] = [0, 0, 0];
  const domainMax: [number, number, number] = [
    DOMAIN_DEFAULT,
    DOMAIN_DEFAULT,
    DOMAIN_DEFAULT,
  ];
  const values: number[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith("TITLE")) {
      const match = line.match(/"([^"]*)"/);
      title = match ? match[1] : line.slice(5).trim();
      continue;
    }
    if (upper.startsWith("LUT_3D_SIZE")) {
      size = Number.parseInt(line.split(/\s+/)[1] ?? "0", 10);
      continue;
    }
    if (upper.startsWith("LUT_1D_SIZE")) return null;
    if (upper.startsWith("DOMAIN_MIN")) {
      const parts = line.split(/\s+/).slice(1, 4).map(Number);
      if (parts.length === 3 && parts.every(Number.isFinite)) domainMin.splice(0, 3, ...parts);
      continue;
    }
    if (upper.startsWith("DOMAIN_MAX")) {
      const parts = line.split(/\s+/).slice(1, 4).map(Number);
      if (parts.length === 3 && parts.every(Number.isFinite)) domainMax.splice(0, 3, ...parts);
      continue;
    }
    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.every(Number.isFinite)) values.push(parts[0], parts[1], parts[2]);
  }

  if (!Number.isInteger(size) || size < 2 || values.length !== size * size * size * 3) return null;
  return {
    title,
    size,
    domainMin,
    domainMax,
    data: Float32Array.from(values),
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Apply a parsed 3D LUT to an RGBA byte buffer in place using trilinear
 * interpolation. `data` must be RGBA with `width * height * 4` entries.
 */
export function applyLutToRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  lut: LutTable,
): void {
  const n = lut.size;
  const max = n - 1;
  const span = [lut.domainMax[0] - lut.domainMin[0], lut.domainMax[1] - lut.domainMin[1], lut.domainMax[2] - lut.domainMin[2]];
  const table = lut.data;
  const xStep = 3;
  const yStep = 3 * n;
  const zStep = 3 * n * n;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const r = clamp01((data[offset] / 255 - lut.domainMin[0]) / span[0]);
    const g = clamp01((data[offset + 1] / 255 - lut.domainMin[1]) / span[1]);
    const b = clamp01((data[offset + 2] / 255 - lut.domainMin[2]) / span[2]);

    const fx = r * max;
    const fy = g * max;
    const fz = b * max;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const z0 = Math.floor(fz);
    const dx = x0 < max ? 1 : 0;
    const dy = y0 < max ? 1 : 0;
    const dz = z0 < max ? 1 : 0;
    const tx = x0 < max ? fx - x0 : 0;
    const ty = y0 < max ? fy - y0 : 0;
    const tz = z0 < max ? fz - z0 : 0;

    for (let channel = 0; channel < 3; channel += 1) {
      const base = (z0 * n * n + y0 * n + x0) * 3 + channel;
      const c000 = table[base];
      const c100 = table[base + xStep * dx];
      const c010 = table[base + yStep * dy];
      const c110 = table[base + yStep * dy + xStep * dx];
      const c001 = table[base + zStep * dz];
      const c101 = table[base + zStep * dz + xStep * dx];
      const c011 = table[base + zStep * dz + yStep * dy];
      const c111 = table[base + zStep * dz + yStep * dy + xStep * dx];
      const cx00 = c000 + (c100 - c000) * tx;
      const cx10 = c010 + (c110 - c010) * tx;
      const cx01 = c001 + (c101 - c001) * tx;
      const cx11 = c011 + (c111 - c011) * tx;
      const cy0 = cx00 + (cx10 - cx00) * ty;
      const cy1 = cx01 + (cx11 - cx01) * ty;
      const value = cy0 + (cy1 - cy0) * tz;
      data[offset + channel] = Math.round(clamp01(value) * 255);
    }
  }
}

const cache = new Map<string, LutTable | null>();

export function cachedCube(path: string): LutTable | null | undefined {
  return cache.get(path);
}

export function rememberCube(path: string, lut: LutTable | null): void {
  cache.set(path, lut);
}

/** Path of the first enabled LUT effect on a clip, if any. */
export function lutPath(effects: { kind: string; enabled: boolean; params: Record<string, number | string | boolean> }[]): string | null {
  for (const effect of effects) {
    if (effect.kind !== "lut" || !effect.enabled) continue;
    const path = effect.params.path;
    if (typeof path === "string" && path.length > 0) return path;
  }
  return null;
}
