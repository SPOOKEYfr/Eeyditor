import {
  PROJECT_SCHEMA_VERSION,
  type EeyditorProject,
  type Keyframe,
  type TimelineClip,
  type TimelineTrack,
} from "../../types/timeline";
import { makeId } from "../project/factory";
import { clamp } from "../keyframes/bezier";

export const MIN_CLIP_DURATION = 1 / 60;
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 4800;
export const SNAP_THRESHOLD_PX = 8;

export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

export function snapToFrame(seconds: number, fps: number): number {
  return Math.round(seconds * fps) / fps;
}

export function formatTimecode(seconds: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30;
  const totalFrames = Math.max(0, Math.round(seconds * safeFps));
  const frames = totalFrames % Math.round(safeFps);
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number, length = 2) => value.toString().padStart(length, "0");
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

export function parseTimecode(text: string, fps: number): number | null {
  const match = text.trim().match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})[:;](\d{1,3})$/);
  if (!match) return null;
  const [, hh, mm, ss, ff] = match;
  const framesPerSecond = Math.round(fps);
  const seconds =
    Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ff) / framesPerSecond;
  return seconds;
}

export function clipEnd(clip: TimelineClip): number {
  return clip.start + clip.duration;
}

export function sortClips(clips: TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

export function findClipAt(track: TimelineTrack, time: number): TimelineClip | null {
  for (const clip of track.clips) {
    if (time >= clip.start && time < clipEnd(clip)) return clip;
  }
  return null;
}

/** Clips intersecting an inclusive time window, used by the marquee selection. */
export function clipsInTimeRange(clips: TimelineClip[], start: number, end: number): TimelineClip[] {
  if (end < start) return clipsInTimeRange(clips, end, start);
  return clips.filter((clip) => clip.start <= end && clipEnd(clip) >= start);
}

export function findClipById(
  project: EeyditorProject,
  clipId: string,
): { track: TimelineTrack; clip: TimelineClip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function projectDuration(project: EeyditorProject): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clipEnd(clip));
    }
  }
  return end;
}

export interface SnapResult {
  time: number;
  snapped: boolean;
  target?: number;
}

export function collectSnapTargets(
  project: EeyditorProject,
  excludeClipId?: string,
): number[] {
  const targets = new Set<number>([0]);
  targets.add(project.duration);
  for (const marker of project.markers) targets.add(marker.time);
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      targets.add(clip.start);
      targets.add(clipEnd(clip));
    }
  }
  return [...targets].sort((a, b) => a - b);
}

export function snapTime(
  time: number,
  targets: number[],
  thresholdSeconds: number,
): SnapResult {
  let best = time;
  let bestDistance = thresholdSeconds;
  let snapped = false;
  for (const target of targets) {
    const distance = Math.abs(target - time);
    if (distance <= bestDistance) {
      best = target;
      bestDistance = distance;
      snapped = true;
    }
  }
  return { time: best, snapped, target: snapped ? best : undefined };
}

/**
 * Overwrite semantics: place `movingClip` at `newStart`, trimming or removing
 * any clips it covers on the same track. The moving clip itself is removed
 * first so the operation is idempotent.
 */
export function overwriteRange(
  clips: TimelineClip[],
  movingClip: TimelineClip,
  newStart: number,
): TimelineClip[] {
  const start = Math.max(0, newStart);
  const end = start + movingClip.duration;
  const result: TimelineClip[] = [];

  for (const clip of clips) {
    if (clip.id === movingClip.id) continue;
    const clipStart = clip.start;
    const clipStop = clipEnd(clip);

    if (clipStop <= start || clipStart >= end) {
      result.push(clip);
      continue;
    }

    const coversStart = clipStart < start && clipStop > start;
    const coversEnd = clipStart < end && clipStop > end;
    const fullyCovered = clipStart >= start && clipStop <= end;

    if (fullyCovered) continue;

    if (coversStart && coversEnd) {
      const leftDuration = start - clipStart;
      const rightDuration = clipStop - end;
      const left = trimDuration(clip, 0, leftDuration);
      const right = trimDuration(clip, end - clipStart, rightDuration, true);
      if (leftDuration > MIN_CLIP_DURATION) result.push(left);
      if (rightDuration > MIN_CLIP_DURATION) result.push(right);
      continue;
    }

    if (coversStart) {
      const leftDuration = start - clipStart;
      if (leftDuration > MIN_CLIP_DURATION) result.push(trimDuration(clip, 0, leftDuration));
      continue;
    }

    if (coversEnd) {
      const rightDuration = clipStop - end;
      if (rightDuration > MIN_CLIP_DURATION) {
        result.push(trimDuration(clip, end - clipStart, rightDuration, true));
      }
      continue;
    }
  }

  const placed: TimelineClip = {
    ...movingClip,
    start,
    duration: movingClip.duration,
  };
  result.push(placed);
  return sortClips(result);
}

function trimDuration(
  clip: TimelineClip,
  offsetFromClipStart: number,
  duration: number,
  isRightPiece = false,
): TimelineClip {
  const speed = clip.speed || 1;
  const inPoint = clip.inPoint + offsetFromClipStart * speed;
  const next: TimelineClip = {
    ...clip,
    id: isRightPiece ? makeId("clip") : clip.id,
    start: clip.start + offsetFromClipStart,
    duration,
    inPoint,
    outPoint: inPoint + duration * speed,
  };
  return next;
}

export function moveClip(
  clips: TimelineClip[],
  clipId: string,
  newStart: number,
): TimelineClip[] {
  const clip = clips.find((candidate) => candidate.id === clipId);
  if (!clip) return clips;
  return overwriteRange(clips, clip, newStart);
}

/** Move several clips on one track to absolute starts, resolving overlaps once. */
export function moveClipsTo(
  clips: TimelineClip[],
  targets: ReadonlyMap<string, number>,
): TimelineClip[] {
  if (targets.size === 0) return clips;
  const moving = clips.filter((clip) => targets.has(clip.id));
  if (moving.length === 0) return clips;
  let result = clips.filter((clip) => !targets.has(clip.id));
  for (const clip of moving) {
    result = overwriteRange(result, clip, targets.get(clip.id) ?? clip.start);
  }
  return sortClips(result);
}

export type TrimEdge = "start" | "end";

export function trimClip(
  clip: TimelineClip,
  edge: TrimEdge,
  newTime: number,
  minDuration = MIN_CLIP_DURATION,
): TimelineClip {
  if (edge === "start") {
    const maxStart = clip.start + clip.duration - minDuration;
    const nextStart = clamp(newTime, 0, maxStart);
    const delta = nextStart - clip.start;
    const speed = clip.speed || 1;
    return {
      ...clip,
      start: nextStart,
      duration: clip.duration - delta,
      inPoint: clip.inPoint + delta * speed,
      outPoint: clip.inPoint + delta * speed + (clip.duration - delta) * speed,
    };
  }
  const minEnd = clip.start + minDuration;
  const nextEnd = Math.max(newTime, minEnd);
  const duration = nextEnd - clip.start;
  const speed = clip.speed || 1;
  return {
    ...clip,
    duration,
    outPoint: clip.inPoint + duration * speed,
  };
}

export function splitClip(
  clip: TimelineClip,
  atTime: number,
): [TimelineClip, TimelineClip] | null {
  const offset = atTime - clip.start;
  if (offset <= MIN_CLIP_DURATION || offset >= clip.duration - MIN_CLIP_DURATION) {
    return null;
  }
  const speed = clip.speed || 1;

  const leftSide = (keyframes: Keyframe[]): Keyframe[] =>
    keyframes.filter((keyframe) => keyframe.time <= offset).map((keyframe) => ({ ...keyframe }));

  const rightSide = (keyframes: Keyframe[]): Keyframe[] =>
    keyframes
      .filter((keyframe) => keyframe.time >= offset)
      .map((keyframe) => ({
        ...keyframe,
        id: makeId("kf"),
        time: keyframe.time - offset,
      }));

  const splitCurve = <T extends { keyframes: Keyframe[] }>(curve: T, side: "left" | "right"): T => ({
    ...curve,
    keyframes: side === "left" ? leftSide(curve.keyframes) : rightSide(curve.keyframes),
  });

  const left: TimelineClip = {
    ...clip,
    id: clip.id,
    duration: offset,
    outPoint: clip.inPoint + offset * speed,
    transform: {
      ...clip.transform,
      positionX: splitCurve(clip.transform.positionX, "left"),
      positionY: splitCurve(clip.transform.positionY, "left"),
      scaleX: splitCurve(clip.transform.scaleX, "left"),
      scaleY: splitCurve(clip.transform.scaleY, "left"),
      rotation: splitCurve(clip.transform.rotation, "left"),
      opacity: splitCurve(clip.transform.opacity, "left"),
    },
    volume: { ...clip.volume, keyframes: leftSide(clip.volume.keyframes) },
  };

  const right: TimelineClip = {
    ...clip,
    id: makeId("clip"),
    start: clip.start + offset,
    duration: clip.duration - offset,
    inPoint: clip.inPoint + offset * speed,
    outPoint: clip.outPoint,
    transitionIn: undefined,
    transform: {
      ...clip.transform,
      positionX: splitCurve(clip.transform.positionX, "right"),
      positionY: splitCurve(clip.transform.positionY, "right"),
      scaleX: splitCurve(clip.transform.scaleX, "right"),
      scaleY: splitCurve(clip.transform.scaleY, "right"),
      rotation: splitCurve(clip.transform.rotation, "right"),
      opacity: splitCurve(clip.transform.opacity, "right"),
    },
    volume: { ...clip.volume, keyframes: rightSide(clip.volume.keyframes) },
  };

  return [left, right];
}

export function rippleDelete(clips: TimelineClip[], clipId: string): TimelineClip[] {
  const target = clips.find((clip) => clip.id === clipId);
  if (!target) return clips;
  const gap = target.duration;
  const removedEnd = clipEnd(target);
  return sortClips(
    clips
      .filter((clip) => clip.id !== clipId)
      .map((clip) =>
        clip.start >= removedEnd ? { ...clip, start: clip.start - gap } : clip,
      ),
  );
}

export function closeGaps(clips: TimelineClip[]): TimelineClip[] {
  let cursor = 0;
  return sortClips(clips).map((clip) => {
    const next = { ...clip, start: cursor };
    cursor += clip.duration;
    return next;
  });
}

export function timeToX(time: number, zoom: number, scroll: number): number {
  return time * zoom - scroll;
}

export function xToTime(x: number, zoom: number, scroll: number): number {
  return (x + scroll) / zoom;
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

export function emptyProjectShell(): EeyditorProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: makeId("project"),
    name: "Untitled",
    frameRate: 30,
    sampleRate: 48000,
    resolution: { width: 1920, height: 1080 },
    duration: 0,
    tracks: [],
    markers: [],
    subtitles: [],
    media: [],
    renderPreset: {
      id: "custom",
      name: "Custom",
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: "libx264",
      videoBitrate: "12M",
      crf: 20,
      encoderPreset: "medium",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      audioBitrate: "256k",
      audioSampleRate: 48000,
      channels: 2,
      container: "mp4",
      hardware: "cpu",
      faststart: true,
    },
    metadata: {
      generator: "Eeyditor",
      appVersion: "0.1.0",
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
  };
}
