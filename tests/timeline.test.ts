import { describe, expect, it } from "vitest";
import {
  clipEnd,
  clipsInTimeRange,
  closeGaps,
  formatTimecode,
  moveClip,
  parseTimecode,
  rippleDelete,
  snapTime,
  snapToFrame,
  splitClip,
  sourceOffsetFor,
  clipSegments,
  timeToX,
  trimClip,
  xToTime,
} from "../src/core/timeline/engine";
import { createClip, createTrack, createEmptyProject } from "../src/core/project/factory";
import { editorStore } from "../src/state/editorStore";

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

  it("collects clips intersecting a marquee time window", () => {
    const clips = [clipAt("t", 0, 2), clipAt("t", 3, 2), clipAt("t", 8, 1)];
    expect(clipsInTimeRange(clips, 0.5, 3.5).map((clip) => clip.start)).toEqual([0, 3]);
    expect(clipsInTimeRange(clips, 2.1, 2.9)).toEqual([]);
    expect(clipsInTimeRange(clips, 3.5, 3).map((clip) => clip.start)).toEqual([3]);
    expect(clipsInTimeRange(clips, 0, 20)).toHaveLength(3);
  });

  it("creates tracks with type-specific heights", () => {
    expect(createTrack("video", 0).height).not.toBe(createTrack("audio", 0).height);
  });
});

describe("speed curves", () => {
  it("sourceOffsetFor uses constant speed when there is no curve", () => {
    const clip = createClip({ trackId: "t", start: 0, duration: 6, kind: "video" });
    clip.speed = 2;
    expect(sourceOffsetFor(clip, 3)).toBe(6);
    expect(sourceOffsetFor(clip, 6)).toBe(12);
  });

  it("sourceOffsetFor integrates a piecewise-constant speed curve", () => {
    const clip = createClip({
      trackId: "t",
      start: 0,
      duration: 6,
      kind: "video",
      inPoint: 10,
    });
    clip.speedCurve = [{ time: 0, speed: 1 }, { time: 2, speed: 4 }];
    expect(sourceOffsetFor(clip, 1)).toBe(1);
    expect(sourceOffsetFor(clip, 3)).toBe(2 + 4);
    expect(sourceOffsetFor(clip, 6)).toBe(2 + 16);
    const flat = { ...clip, speedCurve: [] };
    expect(sourceOffsetFor(flat, 6)).toBe(6);
  });

  it("clipSegments splits at curve points with correct source ranges", () => {
    const clip = createClip({ trackId: "t", start: 0, duration: 4, kind: "video", inPoint: 5 });
    clip.speed = 2;
    expect(clipSegments(clip)).toEqual([
      { t0: 0, t1: 4, speed: 2, srcStart: 5, srcEnd: 13 },
    ]);
    const curved = { ...clip, speedCurve: [{ time: 0, speed: 1 }, { time: 2, speed: 4 }] };
    expect(clipSegments(curved)).toEqual([
      { t0: 0, t1: 2, speed: 1, srcStart: 5, srcEnd: 7 },
      { t0: 2, t1: 4, speed: 4, srcStart: 7, srcEnd: 15 },
    ]);
  });

  it("setClipSpeedCurve persists and normalizes points", () => {
    editorStore.loadProject(createEmptyProject());
    const video = editorStore.getState().project.tracks.find((track) => track.type === "video")!;
    const clip = createClip({ trackId: video.id, start: 0, duration: 4, kind: "video" });
    editorStore.updateProject(
      (project) => ({
        ...project,
        tracks: project.tracks.map((track) => (track.id === video.id ? { ...track, clips: [clip] } : track)),
      }),
      "add clip",
    );
    editorStore.setClipSpeedCurve(clip.id, [{ time: 2, speed: 4 }, { time: 0, speed: 1 }]);
    const stored = editorStore.getState().project.tracks.flatMap((track) => track.clips)[0];
    expect(stored.speedCurve).toEqual([{ time: 0, speed: 1 }, { time: 2, speed: 4 }]);
  });
});
