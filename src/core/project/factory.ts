import {
  PROJECT_SCHEMA_VERSION,
  TRACK_DEFAULT_HEIGHT,
  type AudioEnvelope,
  type EeyditorProject,
  type EffectInstance,
  type EffectKind,
  type KeyframeCurve,
  type MediaSource,
  type RenderPreset,
  type SourceKind,
  type TextOverlay,
  type TimelineClip,
  type TimelineMarker,
  type TimelineTrack,
  type TrackType,
  type Transform,
} from "../../types/timeline";

let idCounter = 0;

export function makeId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}${random}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export const CLIP_COLORS = [
  "#FFB300",
  "#FF5100",
  "#E60067",
  "#7C5CFF",
  "#26C6DA",
  "#2EE6A8",
  "#FF6E9C",
];

export function colorForIndex(index: number): string {
  return CLIP_COLORS[Math.abs(index) % CLIP_COLORS.length];
}

export function createCurve(
  property: KeyframeCurve["property"],
  defaultValue: number,
): KeyframeCurve {
  return { property, defaultValue, keyframes: [] };
}

export function createTransform(): Transform {
  return {
    positionX: createCurve("positionX", 0),
    positionY: createCurve("positionY", 0),
    scaleX: createCurve("scaleX", 1),
    scaleY: createCurve("scaleY", 1),
    rotation: createCurve("rotation", 0),
    opacity: createCurve("opacity", 1),
    anchorX: 0.5,
    anchorY: 0.5,
    blendMode: "normal",
  };
}

export function createAudioEnvelope(): AudioEnvelope {
  return { gainDb: 0, fadeIn: 0, fadeOut: 0, keyframes: [] };
}

export function createTextOverlay(): TextOverlay {
  return {
    content: "",
    fontFamily: "Inter",
    fontSize: 64,
    fontWeight: 700,
    color: "#FFFFFF",
    align: "center",
    strokeColor: "#000000",
    strokeWidth: 0,
    shadowColor: "rgba(0,0,0,0.6)",
    shadowBlur: 12,
    letterSpacing: 0,
    lineHeight: 1.2,
    backgroundColor: "transparent",
    backgroundOpacity: 0,
  };
}

export function createEffect(kind: EffectKind, amount = 1): EffectInstance {
  return {
    id: makeId("fx"),
    kind,
    enabled: true,
    amount,
    params: {},
  };
}

export function createMediaSource(
  partial: Partial<MediaSource> & { path: string; kind: SourceKind },
): MediaSource {
  return {
    id: partial.id ?? makeId("media"),
    path: partial.path,
    kind: partial.kind,
    name: partial.name ?? partial.path.split(/[\\/]/).pop() ?? "media",
    duration: partial.duration ?? 0,
    width: partial.width ?? 1920,
    height: partial.height ?? 1080,
    fps: partial.fps ?? 30,
    sampleRate: partial.sampleRate ?? 48000,
    channels: partial.channels ?? 2,
    hasVideo: partial.hasVideo ?? partial.kind !== "audio",
    hasAudio: partial.hasAudio ?? partial.kind !== "image",
    thumbnail: partial.thumbnail,
    metadata: partial.metadata,
  };
}

export interface CreateClipOptions {
  trackId: string;
  sourceId?: string;
  name?: string;
  kind?: SourceKind;
  start?: number;
  duration?: number;
  inPoint?: number;
  colorIndex?: number;
}

export function createClip(options: CreateClipOptions): TimelineClip {
  const start = options.start ?? 0;
  const duration = options.duration ?? 5;
  const kind = options.kind ?? "video";
  return {
    ...(kind === "text" ? { text: createTextOverlay() } : {}),
    id: makeId("clip"),
    trackId: options.trackId,
    sourceId: options.sourceId ?? "",
    name: options.name ?? "Clip",
    kind,
    start,
    duration,
    inPoint: options.inPoint ?? 0,
    outPoint: (options.inPoint ?? 0) + duration,
    speed: 1,
    reversed: false,
    transform: createTransform(),
    volume: createAudioEnvelope(),
    effects: [],
    color: colorForIndex(options.colorIndex ?? 0),
    locked: false,
    enabled: true,
  };
}

export function createTrack(
  type: TrackType,
  index: number,
  name?: string,
): TimelineTrack {
  return {
    id: makeId("track"),
    type,
    name: name ?? defaultTrackName(type, index),
    index,
    height: TRACK_DEFAULT_HEIGHT[type],
    muted: false,
    solo: false,
    locked: false,
    hidden: false,
    volume: 0,
    blendMode: "normal",
    clips: [],
  };
}

function defaultTrackName(type: TrackType, index: number): string {
  const labels: Record<TrackType, string> = {
    video: "Video",
    overlay: "Overlay",
    effects: "Effects",
    text: "Text",
    audio: "Audio",
    adjustment: "Adjustment",
  };
  return `${labels[type]} ${index + 1}`;
}

export function createMarker(time = 0, label = "Marker"): TimelineMarker {
  return { id: makeId("marker"), time, label, color: "#FFB300" };
}

export const RENDER_PRESETS: RenderPreset[] = [
  {
    id: "draft-720p30",
    name: "Fast Draft - 720p30",
    width: 1280,
    height: 720,
    fps: 30,
    videoCodec: "libx264",
    videoBitrate: "6M",
    crf: 23,
    encoderPreset: "veryfast",
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    audioBitrate: "160k",
    audioSampleRate: 48000,
    channels: 2,
    container: "mp4",
    hardware: "cpu",
    faststart: true,
  },
  {
    id: "hq-1080p60",
    name: "High Quality - 1080p60",
    width: 1920,
    height: 1080,
    fps: 60,
    videoCodec: "libx264",
    videoBitrate: "20M",
    crf: 18,
    encoderPreset: "medium",
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    audioBitrate: "320k",
    audioSampleRate: 48000,
    channels: 2,
    container: "mp4",
    hardware: "cpu",
    faststart: true,
  },
  {
    id: "hq-4k60",
    name: "High Quality - 4K60",
    width: 3840,
    height: 2160,
    fps: 60,
    videoCodec: "libx264",
    videoBitrate: "70M",
    crf: 18,
    encoderPreset: "medium",
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    audioBitrate: "320k",
    audioSampleRate: 48000,
    channels: 2,
    container: "mp4",
    hardware: "cpu",
    faststart: true,
  },
  {
    id: "nvenc-1080p60",
    name: "High Quality - 1080p60 (NVENC)",
    width: 1920,
    height: 1080,
    fps: 60,
    videoCodec: "h264_nvenc",
    videoBitrate: "20M",
    crf: 19,
    encoderPreset: "p5",
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    audioBitrate: "320k",
    audioSampleRate: 48000,
    channels: 2,
    container: "mp4",
    hardware: "nvenc",
    faststart: true,
  },
  {
    id: "gif-480p12",
    name: "Animated GIF - 480p12",
    width: 480,
    height: 270,
    fps: 12,
    videoCodec: "gif",
    videoBitrate: "0",
    crf: 0,
    encoderPreset: "none",
    pixelFormat: "rgb24",
    audioCodec: "none",
    audioBitrate: "0",
    audioSampleRate: 48000,
    channels: 2,
    container: "gif",
    hardware: "cpu",
    faststart: false,
  },
  {
    id: "audio-mp3-320",
    name: "Audio only - MP3 320k",
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: "none",
    videoBitrate: "0",
    crf: 0,
    encoderPreset: "none",
    pixelFormat: "yuv420p",
    audioCodec: "libmp3lame",
    audioBitrate: "320k",
    audioSampleRate: 48000,
    channels: 2,
    container: "mp3",
    hardware: "cpu",
    faststart: false,
  },
];

export function createEmptyProject(name = "Untitled Project"): EeyditorProject {
  const createdAt = nowIso();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: makeId("project"),
    name,
    frameRate: 30,
    sampleRate: 48000,
    resolution: { width: 1920, height: 1080 },
    duration: 30,
    tracks: [
      createTrack("video", 0, "Video 1"),
      createTrack("overlay", 0, "Overlay 1"),
      createTrack("text", 0, "Text 1"),
      createTrack("audio", 0, "Audio 1"),
    ],
    markers: [],
    subtitles: [],
    media: [],
    renderPreset: { ...RENDER_PRESETS[1] },
    metadata: {
      generator: "Eeyditor",
      appVersion: "0.1.0",
      description: "",
      createdAt,
      modifiedAt: createdAt,
    },
  };
}

/**
 * Build a small, deterministic demo arrangement so the UI has meaningful
 * content on first launch without shipping any binary media.
 */
export function createDemoProject(): EeyditorProject {
  const project = createEmptyProject("Welcome to Eeyditor");
  project.duration = 24;

  const videoTrack = project.tracks[0];
  const overlayTrack = project.tracks[1];
  const textTrack = project.tracks[2];
  const audioTrack = project.tracks[3];

  const videoSource = createMediaSource({
    path: "generator://gradient",
    kind: "generator",
    name: "Brand Gradient",
    duration: 24,
    hasVideo: true,
    hasAudio: false,
  });
  const secondSource = createMediaSource({
    path: "generator://mesh",
    kind: "generator",
    name: "Aurora Mesh",
    duration: 12,
    hasVideo: true,
    hasAudio: false,
  });
  const audioSource = createMediaSource({
    path: "generator://tone",
    kind: "generator",
    name: "Ambient Bed",
    duration: 24,
    hasVideo: false,
    hasAudio: true,
  });
  project.media = [videoSource, secondSource, audioSource];

  const first = createClip({
    trackId: videoTrack.id,
    sourceId: videoSource.id,
    name: "Brand Gradient",
    start: 0,
    duration: 9,
    kind: "generator",
    colorIndex: 1,
  });
  first.transitionOut = {
    id: makeId("transition"),
    kind: "dissolve",
    duration: 0.75,
    direction: "left",
  };
  first.transform.opacity.keyframes = [
    {
      id: makeId("kf"),
      time: 0,
      value: 0,
      interpolation: "bezier",
      inHandle: { x: 0.28, y: 0 },
      outHandle: { x: 0.3, y: 0.28 },
    },
    {
      id: makeId("kf"),
      time: 1,
      value: 1,
      interpolation: "linear",
      inHandle: { x: 0.33, y: 0 },
      outHandle: { x: 0.33, y: 0 },
    },
  ];

  const second = createClip({
    trackId: videoTrack.id,
    sourceId: secondSource.id,
    name: "Aurora Mesh",
    start: 9,
    duration: 8,
    kind: "generator",
    colorIndex: 2,
  });
  second.transform.scaleX = {
    property: "scaleX",
    defaultValue: 1,
    keyframes: [
      {
        id: makeId("kf"),
        time: 0,
        value: 1,
        interpolation: "bezier",
        inHandle: { x: 0.33, y: 0 },
        outHandle: { x: 0.2, y: 0.6 },
      },
      {
        id: makeId("kf"),
        time: 8,
        value: 1.18,
        interpolation: "linear",
        inHandle: { x: 0.33, y: 0 },
        outHandle: { x: 0.33, y: 0 },
      },
    ],
  };

  const overlay = createClip({
    trackId: overlayTrack.id,
    sourceId: secondSource.id,
    name: "Lower Third",
    start: 2,
    duration: 6,
    kind: "generator",
    colorIndex: 3,
  });
  overlay.transform.scaleX.defaultValue = 0.36;
  overlay.transform.scaleY.defaultValue = 0.36;
  overlay.transform.positionX.defaultValue = 0.44;
  overlay.transform.positionY.defaultValue = 0.62;

  const title = createClip({
    trackId: textTrack.id,
    sourceId: "",
    name: "Title",
    start: 1,
    duration: 5,
    kind: "text",
    colorIndex: 0,
  });
  title.text = {
    ...createTextOverlay(),
    content: "Eeyditor",
    fontSize: 108,
    fontWeight: 800,
    letterSpacing: 2,
    color: "#FFFFFF",
  };
  title.transform.positionY.defaultValue = -0.12;

  const audio = createClip({
    trackId: audioTrack.id,
    sourceId: audioSource.id,
    name: "Ambient Bed",
    start: 0,
    duration: 20,
    kind: "generator",
    colorIndex: 5,
  });
  audio.volume.fadeIn = 1.5;
  audio.volume.fadeOut = 2.5;

  videoTrack.clips = [first, second];
  overlayTrack.clips = [overlay];
  textTrack.clips = [title];
  audioTrack.clips = [audio];

  project.markers = [
    createMarker(0, "Start"),
    createMarker(9, "Scene 2"),
    createMarker(17, "Outro"),
  ];
  return project;
}
