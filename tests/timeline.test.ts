import { describe, expect, it } from "vitest";
import {
  clipEnd,
  closeGaps,
  formatTimecode,
  moveClip,
  parseTimecode,
  rippleDelete,
  snapTime,
  snapToFrame,
  splitClip,
  timeToX,
  trimClip,
  xToTime,
} from "../src/core/timeline/engine";
import { createClip, createTrack } from "../src/core/project/factory";

function clipAt(trackId: string, start: number, duration: number, name = "Clip") {
  return createClip({ trackId, start, duration, name });
}

describe("timeline engine", () => {
  it("formats and parses HH:MM:SS:FF timecode", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00:00");
    expect(formatTimecode(61.5, 30)).toBe("00:01:01:15");
    expect(parseTimecode("00:01:01:15", 30)).toBeCloseTo(61.5, 6);
    expect(parseTimecode("nonsense", 30)).toBeNull();
  });

  it("snaps times to frame boundaries", () => {
    expect(snapToFrame(1.017, 30)).toBeCloseTo(1.0333333, 5);
    expect(snapToFrame(1.0, 30)).toBe(1);
  });

  it("maps time to pixels and back", () => {
    expect(timeToX(2, 50, 25)).toBe(75);
    expect(xToTime(75, 50, 25)).toBe(2);
  });

  it("snaps to the nearest target within threshold", () => {
    expect(snapTime(1.02, [0, 1, 5], 0.05).time).toBe(1);
    expect(snapTime(3, [0, 1, 5], 0.05).snapped).toBe(false);
  });

  it("moves a clip and overwrites covered clips", () => {
    const trackId = "t";
    const a = clipAt(trackId, 0, 4, "A"); // 0..4
    const b = clipAt(trackId, 4, 4, "B"); // 4..8
    const moved = moveClip([a, b], b.id, 2); // B now 2..6 overwrites A 2..4
    expect(moved.find((clip) => clip.id === b.id)?.start).toBe(2);
    const remainingA = moved.find((clip) => clip.id === a.id);
    expect(remainingA?.duration).toBeCloseTo(2, 6);
    expect(clipEnd(remainingA!)).toBeCloseTo(2, 6);
  });

  it("splits a clip into two adjacent parts", () => {
    const clip = clipAt("t", 0, 10);
    const parts = splitClip(clip, 4);
    expect(parts).not.toBeNull();
    const [left, right] = parts!;
    expect(left.duration).toBeCloseTo(4, 6);
    expect(right.duration).toBeCloseTo(6, 6);
    expect(right.start).toBeCloseTo(4, 6);
    expect(left.duration + right.duration).toBeCloseTo(clip.duration, 6);
  });

  it("refuses to split at the very edges", () => {
    const clip = clipAt("t", 0, 4);
    expect(splitClip(clip, 0)).toBeNull();
    expect(splitClip(clip, 4)).toBeNull();
  });

  it("ripple-deletes and closes the resulting gap", () => {
    const a = clipAt("t", 0, 2);
    const b = clipAt("t", 2, 3);
    const c = clipAt("t", 5, 2);
    const afterDelete = rippleDelete([a, b, c], b.id);
    expect(afterDelete.map((clip) => clip.start)).toEqual([0, 2]);
    expect(afterDelete[1].id).toBe(c.id);
  });

  it("closes internal gaps", () => {
    const a = clipAt("t", 0, 2);
    const b = clipAt("t", 5, 1);
    const c = clipAt("t", 9, 3);
    const packed = closeGaps([a, b, c]);
    expect(packed.map((clip) => clip.start)).toEqual([0, 2, 3]);
  });

  it("trims start and end while respecting source points", () => {
    const clip = clipAt("t", 2, 6);
    const trimmedStart = trimClip(clip, "start", 3.5);
    expect(trimmedStart.start).toBe(3.5);
    expect(trimmedStart.inPoint).toBeCloseTo(1.5, 6);
    expect(trimmedStart.duration).toBeCloseTo(4.5, 6);

    const trimmedEnd = trimClip(clip, "end", 6);
    expect(trimmedEnd.duration).toBeCloseTo(4, 6);
    expect(trimmedEnd.outPoint).toBeCloseTo(4, 6);
  });

  it("creates tracks with type-specific heights", () => {
    expect(createTrack("video", 0).height).not.toBe(createTrack("audio", 0).height);
  });
});
