import type { SourceKind } from "../../types/timeline";

export interface ProbedMedia {
  duration: number;
  width: number;
  height: number;
  fps: number;
  sampleRate: number;
  channels: number;
  hasVideo: boolean;
  hasAudio: boolean;
  kind: Extract<SourceKind, "video" | "audio">;
}

interface RawStream {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  disposition?: { attached_pic?: number };
}

interface RawProbe {
  format?: { duration?: string };
  streams?: RawStream[];
}

/** Parse an ffprobe rational such as `30000/1001` into frames per second. */
export function parseRate(value: string | undefined): number | null {
  if (!value) return null;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  const rate = numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function positive(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Reduce ffprobe's JSON into the subset the editor needs. Returns null when the
 * payload is invalid or contains neither an audio nor a video stream.
 */
export function parseProbe(json: string): ProbedMedia | null {
  if (!json) return null;
  let raw: RawProbe;
  try {
    raw = JSON.parse(json) as RawProbe;
  } catch {
    return null;
  }

  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const video = streams.find(
    (stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
  );
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const hasVideo = Boolean(video);
  const hasAudio = Boolean(audio);
  if (!hasVideo && !hasAudio) return null;

  const durations = [raw.format?.duration, ...streams.map((stream) => stream.duration)]
    .map(positive)
    .filter((value) => value > 0);

  return {
    duration: durations.length > 0 ? Math.max(...durations) : 0,
    width: positive(video?.width),
    height: positive(video?.height),
    fps: parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate) ?? 0,
    sampleRate: positive(audio?.sample_rate),
    channels: positive(audio?.channels),
    hasVideo,
    hasAudio,
    kind: hasVideo ? "video" : "audio",
  };
}
