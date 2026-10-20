/**
 * Eeyditor project schema.
 *
 * The `.eeyproj` container is a JSON-serialized manifest produced from these
 * structures. All times are seconds unless explicitly suffixed with `Frame`.
 * Keyframe times are clip-relative; clip start/end are timeline-relative.
 */

export const PROJECT_SCHEMA_VERSION = 1;
export const EEYPROJ_EXTENSION = ".eeyproj";

export type TrackType =
  | "video"
  | "audio"
  | "overlay"
  | "effects"
  | "text"
  | "adjustment";

export type SourceKind =
  | "video"
  | "audio"
  | "image"
  | "text"
  | "generator"
  | "nested";

export type Interpolation = "linear" | "hold" | "bezier";

export type AnimatableProperty =
  | "opacity"
  | "scaleX"
  | "scaleY"
  | "positionX"
  | "positionY"
  | "rotation"
  | "volume"
  | "pan"
  | "blur"
  | "brightness"
  | "contrast"
  | "saturation"
  | "speed";

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "add";

export type EffectKind =
  | "blur"
  | "brightness"
  | "contrast"
  | "saturation"
  | "hue"
  | "sharpen"
  | "vignette"
  | "glow"
  | "chroma-key"
  | "lut";

export type TransitionKind =
  | "fade"
  | "dissolve"
  | "wipe"
  | "slide"
  | "zoom";

export type HardwareAcceleration =
  | "cpu"
  | "nvenc"
  | "qsv"
  | "videotoolbox"
  | "amf";

export interface Vec2 {
  x: number;
  y: number;
}

/** Normalized control handles in segment space: x in [0, 1], y in [0, 1]. */
export interface BezierHandle extends Vec2 {}

export interface Keyframe {
  id: string;
  /** Clip-relative time in seconds. */
  time: number;
  value: number;
  interpolation: Interpolation;
  inHandle: BezierHandle;
  outHandle: BezierHandle;
}

export interface KeyframeCurve {
  property: AnimatableProperty;
  defaultValue: number;
  keyframes: Keyframe[];
}

export interface AudioEnvelope {
  /** Static gain in decibels applied before keyframes. */
  gainDb: number;
  /** Linear fade-in duration in seconds. */
  fadeIn: number;
  /** Linear fade-out duration in seconds. */
  fadeOut: number;
  /** Optional clip-relative volume curve in decibels. */
  keyframes: Keyframe[];
}

export interface Transform {
  positionX: KeyframeCurve;
  positionY: KeyframeCurve;
  scaleX: KeyframeCurve;
  scaleY: KeyframeCurve;
  rotation: KeyframeCurve;
  opacity: KeyframeCurve;
  /** Normalized anchor within the source frame, 0..1. */
  anchorX: number;
  anchorY: number;
  blendMode: BlendMode;
}

export interface EffectInstance {
  id: string;
  kind: EffectKind;
  enabled: boolean;
  amount: number;
  params: Record<string, number | string | boolean>;
}

export interface Transition {
  id: string;
  kind: TransitionKind;
  duration: number;
  direction: "left" | "right" | "up" | "down";
}

export interface TextOverlay {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  letterSpacing: number;
  lineHeight: number;
  backgroundColor: string;
  backgroundOpacity: number;
}

export interface MediaSource {
  id: string;
  path: string;
  kind: SourceKind;
  name: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  sampleRate: number;
  channels: number;
  hasVideo: boolean;
  hasAudio: boolean;
  thumbnail?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  sourceId: string;
  name: string;
  kind: SourceKind;
  /** Timeline-relative start in seconds. */
  start: number;
  /** Timeline duration in seconds. */
  duration: number;
  /** Source-relative in point in seconds. */
  inPoint: number;
  /** Source-relative out point in seconds. */
  outPoint: number;
  /** Playback rate multiplier; 1 is realtime. */
  speed: number;
  reversed: boolean;
  transform: Transform;
  volume: AudioEnvelope;
  effects: EffectInstance[];
  transitionIn?: Transition;
  transitionOut?: Transition;
  text?: TextOverlay;
  color: string;
  locked: boolean;
  enabled: boolean;
  groupId?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface TimelineTrack {
  id: string;
  type: TrackType;
  name: string;
  index: number;
  height: number;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  hidden: boolean;
  volume: number;
  blendMode: BlendMode;
  clips: TimelineClip[];
}

export interface TimelineMarker {
  id: string;
  time: number;
  label: string;
  color: string;
}

export interface Resolution {
  width: number;
  height: number;
}

export interface RenderPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  videoBitrate: string;
  crf: number;
  encoderPreset: string;
  pixelFormat: string;
  audioCodec: string;
  audioBitrate: string;
  audioSampleRate: number;
  channels: number;
  container: string;
  hardware: HardwareAcceleration;
  faststart: boolean;
}

export interface ProjectMetadata {
  generator: "Eeyditor";
  appVersion: string;
  author?: string;
  description?: string;
  createdAt: string;
  modifiedAt: string;
}

export type SubtitlePosition = "bottom" | "center" | "top";

export interface SubtitleCue {
  id: string;
  /** Timeline-relative start in seconds. */
  start: number;
  /** Timeline-relative end in seconds. */
  end: number;
  text: string;
  /** Vertical placement; defaults to the lower third. */
  position?: SubtitlePosition;
  /** Multiplier over the default font size (0.5..2). */
  sizeScale?: number;
  /** CSS-style hex text colour. */
  color?: string;
}

export interface EeyditorProject {
  schemaVersion: number;
  id: string;
  name: string;
  frameRate: number;
  sampleRate: number;
  resolution: Resolution;
  /** Explicit project duration; may exceed the last clip end. */
  duration: number;
  tracks: TimelineTrack[];
  markers: TimelineMarker[];
  subtitles: SubtitleCue[];
  media: MediaSource[];
  renderPreset: RenderPreset;
  metadata: ProjectMetadata;
}

export const TRACK_DEFAULT_HEIGHT: Record<TrackType, number> = {
  video: 84,
  overlay: 72,
  effects: 64,
  text: 64,
  audio: 68,
  adjustment: 60,
};

export const TRACK_TYPE_ORDER: TrackType[] = [
  "video",
  "overlay",
  "effects",
  "text",
  "audio",
  "adjustment",
];
