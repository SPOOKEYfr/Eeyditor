import {
  PROJECT_SCHEMA_VERSION,
  TRACK_DEFAULT_HEIGHT,
  type AudioEnvelope,
  type BezierHandle,
  type BlendMode,
  type EffectInstance,
  type EffectKind,
  type EeyditorProject,
  type HardwareAcceleration,
  type Interpolation,
  type Keyframe,
  type KeyframeCurve,
  type MediaSource,
  type ProjectMetadata,
  type RenderPreset,
  type SourceKind,
  type SubtitleCue,
  type TextOverlay,
  type TimelineClip,
  type TimelineMarker,
  type TimelineTrack,
  type TrackType,
  type Transform,
  type Transition,
} from "../../types/timeline";
import { createEmptyProject, nowIso } from "./factory";

export class ProjectValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ProjectValidationError";
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new ProjectValidationError(path, message);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function num(value: unknown, path: string, fallback?: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (fallback !== undefined) return fallback;
  return fail(path, "expected a finite number");
}

function str(value: unknown, path: string, fallback?: string): string {
  if (typeof value === "string") return value;
  if (fallback !== undefined) return fallback;
  return fail(path, "expected a string");
}

function bool(value: unknown, path: string, fallback?: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (fallback !== undefined) return fallback;
  return fail(path, "expected a boolean");
}

function arr(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined) return [];
  return fail(path, "expected an array");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  fallback: T,
): T {
  void path;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  return fallback;
}

const INTERPOLATIONS: readonly Interpolation[] = ["linear", "hold", "bezier"];
const BLEND_MODES: readonly BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "add",
];
const TRACK_TYPES: readonly TrackType[] = [
  "video",
  "overlay",
  "effects",
  "text",
  "audio",
  "adjustment",
];
const SOURCE_KINDS: readonly SourceKind[] = [
  "video",
  "audio",
  "image",
  "text",
  "generator",
  "nested",
];
const EFFECT_KINDS: readonly EffectKind[] = [
  "blur",
  "brightness",
  "contrast",
  "saturation",
  "hue",
  "sharpen",
  "vignette",
  "glow",
  "chroma-key",
  "lut",
];
const HARDWARE: readonly HardwareAcceleration[] = [
  "cpu",
  "nvenc",
  "qsv",
  "videotoolbox",
  "amf",
];

function normalizeHandle(
  value: unknown,
  path: string,
  fallback: BezierHandle,
): BezierHandle {
  if (value === undefined) return { ...fallback };
  const record = asRecord(value, path);
  return {
    x: num(record.x, `${path}.x`, fallback.x),
    y: num(record.y, `${path}.y`, fallback.y),
  };
}

function normalizeKeyframe(value: unknown, path: string): Keyframe {
  const record = asRecord(value, path);
  return {
    id: str(record.id, `${path}.id`, "kf"),
    time: num(record.time, `${path}.time`),
    value: num(record.value, `${path}.value`),
    interpolation: oneOf(
      record.interpolation,
      INTERPOLATIONS,
      `${path}.interpolation`,
      "linear",
    ),
    inHandle: normalizeHandle(record.inHandle, `${path}.inHandle`, {
      x: 1 / 3,
      y: 0,
    }),
    outHandle: normalizeHandle(record.outHandle, `${path}.outHandle`, {
      x: 1 / 3,
      y: 0,
    }),
  };
}

function normalizeCurve(
  value: unknown,
  path: string,
  property: KeyframeCurve["property"],
  defaultValue: number,
): KeyframeCurve {
  const record = value === undefined ? {} : asRecord(value, path);
  return {
    property,
    defaultValue: num(record.defaultValue, `${path}.defaultValue`, defaultValue),
    keyframes: arr(record.keyframes, `${path}.keyframes`).map((entry, index) =>
      normalizeKeyframe(entry, `${path}.keyframes[${index}]`),
    ),
  };
}

function normalizeEnvelope(value: unknown, path: string): AudioEnvelope {
  const record = value === undefined ? {} : asRecord(value, path);
  return {
    gainDb: num(record.gainDb, `${path}.gainDb`, 0),
    fadeIn: num(record.fadeIn, `${path}.fadeIn`, 0),
    fadeOut: num(record.fadeOut, `${path}.fadeOut`, 0),
    keyframes: arr(record.keyframes, `${path}.keyframes`).map((entry, index) =>
      normalizeKeyframe(entry, `${path}.keyframes[${index}]`),
    ),
  };
}

function normalizeTransform(value: unknown, path: string): Transform {
  const record = value === undefined ? {} : asRecord(value, path);
  return {
    positionX: normalizeCurve(record.positionX, `${path}.positionX`, "positionX", 0),
    positionY: normalizeCurve(record.positionY, `${path}.positionY`, "positionY", 0),
    scaleX: normalizeCurve(record.scaleX, `${path}.scaleX`, "scaleX", 1),
    scaleY: normalizeCurve(record.scaleY, `${path}.scaleY`, "scaleY", 1),
    rotation: normalizeCurve(record.rotation, `${path}.rotation`, "rotation", 0),
    opacity: normalizeCurve(record.opacity, `${path}.opacity`, "opacity", 1),
    anchorX: num(record.anchorX, `${path}.anchorX`, 0.5),
    anchorY: num(record.anchorY, `${path}.anchorY`, 0.5),
    blendMode: oneOf(record.blendMode, BLEND_MODES, `${path}.blendMode`, "normal"),
  };
}

function normalizeEffect(value: unknown, path: string): EffectInstance {
  const record = asRecord(value, path);
  const params = record.params === undefined ? {} : asRecord(record.params, `${path}.params`);
  const paramsOut: Record<string, number | string | boolean> = {};
  for (const [key, entry] of Object.entries(params)) {
    if (
      typeof entry === "number" ||
      typeof entry === "string" ||
      typeof entry === "boolean"
    ) {
      paramsOut[key] = entry;
    }
  }
  return {
    id: str(record.id, `${path}.id`, "fx"),
    kind: oneOf(record.kind, EFFECT_KINDS, `${path}.kind`, "blur"),
    enabled: bool(record.enabled, `${path}.enabled`, true),
    amount: num(record.amount, `${path}.amount`, 1),
    params: paramsOut,
  };
}

function normalizeTransition(value: unknown, path: string): Transition {
  const record = asRecord(value, path);
  return {
    id: str(record.id, `${path}.id`, "transition"),
    kind: oneOf(
      record.kind,
      ["fade", "dissolve", "wipe", "slide", "zoom"] as const,
      `${path}.kind`,
      "fade",
    ),
    duration: num(record.duration, `${path}.duration`, 0.5),
    direction: oneOf(
      record.direction,
      ["left", "right", "up", "down"] as const,
      `${path}.direction`,
      "left",
    ),
  };
}

function normalizeText(value: unknown, path: string): TextOverlay {
  const record = value === undefined ? {} : asRecord(value, path);
  return {
    content: str(record.content, `${path}.content`, ""),
    fontFamily: str(record.fontFamily, `${path}.fontFamily`, "Inter"),
    fontSize: num(record.fontSize, `${path}.fontSize`, 64),
    fontWeight: num(record.fontWeight, `${path}.fontWeight`, 700),
    color: str(record.color, `${path}.color`, "#FFFFFF"),
    align: oneOf(
      record.align,
      ["left", "center", "right"] as const,
      `${path}.align`,
      "center",
    ),
    strokeColor: str(record.strokeColor, `${path}.strokeColor`, "#000000"),
    strokeWidth: num(record.strokeWidth, `${path}.strokeWidth`, 0),
    shadowColor: str(record.shadowColor, `${path}.shadowColor`, "rgba(0,0,0,0.6)"),
    shadowBlur: num(record.shadowBlur, `${path}.shadowBlur`, 12),
    letterSpacing: num(record.letterSpacing, `${path}.letterSpacing`, 0),
    lineHeight: num(record.lineHeight, `${path}.lineHeight`, 1.2),
    backgroundColor: str(
      record.backgroundColor,
      `${path}.backgroundColor`,
      "transparent",
    ),
    backgroundOpacity: num(record.backgroundOpacity, `${path}.backgroundOpacity`, 0),
  };
}

function normalizeClip(value: unknown, path: string): TimelineClip {
  const record = asRecord(value, path);
  const kind = oneOf(record.kind, SOURCE_KINDS, `${path}.kind`, "video");
  const clip: TimelineClip = {
    id: str(record.id, `${path}.id`, "clip"),
    trackId: str(record.trackId, `${path}.trackId`, ""),
    sourceId: str(record.sourceId, `${path}.sourceId`, ""),
    name: str(record.name, `${path}.name`, "Clip"),
    kind,
    start: num(record.start, `${path}.start`),
    duration: num(record.duration, `${path}.duration`),
    inPoint: num(record.inPoint, `${path}.inPoint`, 0),
    outPoint: num(record.outPoint, `${path}.outPoint`, 0),
    speed: num(record.speed, `${path}.speed`, 1),
    reversed: bool(record.reversed, `${path}.reversed`, false),
    transform: normalizeTransform(record.transform, `${path}.transform`),
    volume: normalizeEnvelope(record.volume, `${path}.volume`),
    effects: arr(record.effects, `${path}.effects`).map((entry, index) =>
      normalizeEffect(entry, `${path}.effects[${index}]`),
    ),
    color: str(record.color, `${path}.color`, "#FFB300"),
    locked: bool(record.locked, `${path}.locked`, false),
    enabled: bool(record.enabled, `${path}.enabled`, true),
  };
  if (clip.duration <= 0) fail(`${path}.duration`, "must be positive");
  if (record.transitionIn !== undefined && record.transitionIn !== null) {
    clip.transitionIn = normalizeTransition(record.transitionIn, `${path}.transitionIn`);
  }
  if (record.transitionOut !== undefined && record.transitionOut !== null) {
    clip.transitionOut = normalizeTransition(
      record.transitionOut,
      `${path}.transitionOut`,
    );
  }
  if (record.text !== undefined && record.text !== null) {
    clip.text = normalizeText(record.text, `${path}.text`);
  }
  if (typeof record.groupId === "string") clip.groupId = record.groupId;
  if (record.metadata !== undefined) {
    clip.metadata = normalizeMetadataBag(record.metadata, `${path}.metadata`);
  }
  return clip;
}

function normalizeMetadataBag(
  value: unknown,
  path: string,
): Record<string, string | number | boolean> {
  const record = asRecord(value, path);
  const out: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (
      typeof entry === "number" ||
      typeof entry === "string" ||
      typeof entry === "boolean"
    ) {
      out[key] = entry;
    }
  }
  return out;
}

function normalizeTrack(value: unknown, path: string): TimelineTrack {
  const record = asRecord(value, path);
  const type = oneOf(record.type, TRACK_TYPES, `${path}.type`, "video");
  return {
    id: str(record.id, `${path}.id`, "track"),
    type,
    name: str(record.name, `${path}.name`, "Track"),
    index: num(record.index, `${path}.index`, 0),
    height: num(record.height, `${path}.height`, TRACK_DEFAULT_HEIGHT[type]),
    muted: bool(record.muted, `${path}.muted`, false),
    solo: bool(record.solo, `${path}.solo`, false),
    locked: bool(record.locked, `${path}.locked`, false),
    hidden: bool(record.hidden, `${path}.hidden`, false),
    volume: num(record.volume, `${path}.volume`, 0),
    blendMode: oneOf(record.blendMode, BLEND_MODES, `${path}.blendMode`, "normal"),
    clips: arr(record.clips, `${path}.clips`).map((entry, index) =>
      normalizeClip(entry, `${path}.clips[${index}]`),
    ),
  };
}

function normalizeMedia(value: unknown, path: string): MediaSource {
  const record = asRecord(value, path);
  const kind = oneOf(record.kind, SOURCE_KINDS, `${path}.kind`, "video");
  const source: MediaSource = {
    id: str(record.id, `${path}.id`, "media"),
    path: str(record.path, `${path}.path`, ""),
    kind,
    name: str(record.name, `${path}.name`, "media"),
    duration: num(record.duration, `${path}.duration`, 0),
    width: num(record.width, `${path}.width`, 1920),
    height: num(record.height, `${path}.height`, 1080),
    fps: num(record.fps, `${path}.fps`, 30),
    sampleRate: num(record.sampleRate, `${path}.sampleRate`, 48000),
    channels: num(record.channels, `${path}.channels`, 2),
    hasVideo: bool(record.hasVideo, `${path}.hasVideo`, true),
    hasAudio: bool(record.hasAudio, `${path}.hasAudio`, true),
  };
  if (typeof record.thumbnail === "string") source.thumbnail = record.thumbnail;
  if (record.metadata !== undefined) {
    source.metadata = normalizeMetadataBag(record.metadata, `${path}.metadata`);
  }
  return source;
}

function normalizeMarker(value: unknown, path: string): TimelineMarker {
  const record = asRecord(value, path);
  return {
    id: str(record.id, `${path}.id`, "marker"),
    time: num(record.time, `${path}.time`, 0),
    label: str(record.label, `${path}.label`, "Marker"),
    color: str(record.color, `${path}.color`, "#FFB300"),
  };
}

function normalizeSubtitle(value: unknown, path: string): SubtitleCue {
  const record = asRecord(value, path);
  const start = Math.max(0, num(record.start, `${path}.start`, 0));
  const end = Math.max(start, num(record.end, `${path}.end`, start));
  const cue: SubtitleCue = {
    id: str(record.id, `${path}.id`, `cue-${start.toFixed(3)}`),
    start,
    end,
    text: str(record.text, `${path}.text`, ""),
  };
  if (record.position !== undefined) {
    cue.position = oneOf(record.position, ["bottom", "center", "top"] as const, `${path}.position`, "bottom");
  }
  if (record.sizeScale !== undefined) {
    cue.sizeScale = clamp(num(record.sizeScale, `${path}.sizeScale`, 1), 0.5, 2);
  }
  if (record.color !== undefined && typeof record.color === "string") {
    cue.color = record.color;
  }
  return cue;
}

function normalizePreset(value: unknown, path: string): RenderPreset {
  const record = value === undefined ? {} : asRecord(value, path);
  return {
    id: str(record.id, `${path}.id`, "custom"),
    name: str(record.name, `${path}.name`, "Custom"),
    width: num(record.width, `${path}.width`, 1920),
    height: num(record.height, `${path}.height`, 1080),
    fps: num(record.fps, `${path}.fps`, 30),
    videoCodec: str(record.videoCodec, `${path}.videoCodec`, "libx264"),
    videoBitrate: str(record.videoBitrate, `${path}.videoBitrate`, "12M"),
    crf: num(record.crf, `${path}.crf`, 20),
    encoderPreset: str(record.encoderPreset, `${path}.encoderPreset`, "medium"),
    pixelFormat: str(record.pixelFormat, `${path}.pixelFormat`, "yuv420p"),
    audioCodec: str(record.audioCodec, `${path}.audioCodec`, "aac"),
    audioBitrate: str(record.audioBitrate, `${path}.audioBitrate`, "256k"),
    audioSampleRate: num(record.audioSampleRate, `${path}.audioSampleRate`, 48000),
    channels: num(record.channels, `${path}.channels`, 2),
    container: str(record.container, `${path}.container`, "mp4"),
    hardware: oneOf(record.hardware, HARDWARE, `${path}.hardware`, "cpu"),
    faststart: bool(record.faststart, `${path}.faststart`, true),
  };
}

function normalizeMetadata(value: unknown, path: string): ProjectMetadata {
  const record = value === undefined ? {} : asRecord(value, path);
  const createdAt = str(record.createdAt, `${path}.createdAt`, nowIso());
  const metadata: ProjectMetadata = {
    generator: "Eeyditor",
    appVersion: str(record.appVersion, `${path}.appVersion`, "0.1.0"),
    createdAt,
    modifiedAt: str(record.modifiedAt, `${path}.modifiedAt`, createdAt),
  };
  if (typeof record.author === "string") metadata.author = record.author;
  if (typeof record.description === "string") metadata.description = record.description;
  return metadata;
}

export function normalizeProject(value: unknown): EeyditorProject {
  const record = asRecord(value, "project");
  const schemaVersion = num(record.schemaVersion, "project.schemaVersion", PROJECT_SCHEMA_VERSION);
  if (schemaVersion > PROJECT_SCHEMA_VERSION) {
    fail(
      "project.schemaVersion",
      `unsupported schema version ${schemaVersion}; this build supports up to ${PROJECT_SCHEMA_VERSION}`,
    );
  }
  const resolution = asRecord(record.resolution ?? {}, "project.resolution");
  const frameRate = num(record.frameRate, "project.frameRate", 30);
  if (frameRate <= 0) fail("project.frameRate", "must be positive");

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: str(record.id, "project.id", "project"),
    name: str(record.name, "project.name", "Untitled Project"),
    frameRate,
    sampleRate: num(record.sampleRate, "project.sampleRate", 48000),
    resolution: {
      width: num(resolution.width, "project.resolution.width", 1920),
      height: num(resolution.height, "project.resolution.height", 1080),
    },
    duration: num(record.duration, "project.duration", 0),
    tracks: arr(record.tracks, "project.tracks").map((entry, index) =>
      normalizeTrack(entry, `project.tracks[${index}]`),
    ),
    markers: arr(record.markers, "project.markers").map((entry, index) =>
      normalizeMarker(entry, `project.markers[${index}]`),
    ),
    subtitles: arr(record.subtitles, "project.subtitles").map((entry, index) =>
      normalizeSubtitle(entry, `project.subtitles[${index}]`),
    ),
    media: arr(record.media, "project.media").map((entry, index) =>
      normalizeMedia(entry, `project.media[${index}]`),
    ),
    renderPreset: normalizePreset(record.renderPreset, "project.renderPreset"),
    metadata: normalizeMetadata(record.metadata, "project.metadata"),
  };
}

export function serializeProject(project: EeyditorProject): string {
  return `${JSON.stringify(normalizeProject(project), null, 2)}\n`;
}

export function parseProject(text: string): EeyditorProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail("project", `invalid JSON: ${(error as Error).message}`);
  }
  return normalizeProject(raw);
}

export function cloneProject(project: EeyditorProject): EeyditorProject {
  if (typeof structuredClone === "function") {
    return structuredClone(project);
  }
  return JSON.parse(JSON.stringify(project)) as EeyditorProject;
}

export function createProjectFromJson(text: string): EeyditorProject {
  return parseProject(text);
}

/** Convenience helper used by tests and the render pipeline. */
export function projectOrEmpty(project?: EeyditorProject | null): EeyditorProject {
  return project ?? createEmptyProject();
}
