import type { AudioEnvelope, Keyframe, SourceKind } from "../../types/timeline";
import { evaluateKeyframes, clamp, clamp01 } from "../keyframes/bezier";

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
  rms: Float32Array;
  buckets: number;
  sampleRate: number;
  duration: number;
}

export function dbToGain(db: number): number {
  return db <= -120 ? 0 : 10 ** (db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -120 : 20 * Math.log10(gain);
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const length = Math.min(...channels.map((channel) => channel.length));
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    mono[i] = sum / channels.length;
  }
  return mono;
}

/**
 * Reduce an audio channel into min/max/rms buckets. This is the same shape
 * used by the timeline waveform cache and is O(n) in the sample count.
 */
export function computePeaks(
  channel: Float32Array,
  buckets: number,
  sampleRate = 48000,
): Peaks {
  const count = Math.max(1, Math.floor(buckets));
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  const rms = new Float32Array(count);
  const samplesPerBucket = channel.length / count;

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor(bucket * samplesPerBucket);
    const end = Math.min(channel.length, Math.floor((bucket + 1) * samplesPerBucket));
    let lo = 0;
    let hi = 0;
    let sumSquares = 0;
    let samples = 0;
    for (let i = start; i < end; i += 1) {
      const value = channel[i];
      if (value < lo) lo = value;
      if (value > hi) hi = value;
      sumSquares += value * value;
      samples += 1;
    }
    min[bucket] = lo;
    max[bucket] = hi;
    rms[bucket] = samples > 0 ? Math.sqrt(sumSquares / samples) : 0;
  }

  return {
    min,
    max,
    rms,
    buckets: count,
    sampleRate,
    duration: sampleRate > 0 ? channel.length / sampleRate : 0,
  };
}

/** Reduce peaks into `columns` absolute amplitudes for symmetric waveform drawing. */
export function peaksToAmplitudes(peaks: Peaks, columns: number): Float32Array {
  const count = Math.max(1, Math.floor(columns));
  const output = new Float32Array(count);
  for (let column = 0; column < count; column += 1) {
    const start = Math.floor((column * peaks.buckets) / count);
    const end = Math.max(start + 1, Math.floor(((column + 1) * peaks.buckets) / count));
    let amplitude = 0;
    for (let bucket = start; bucket < end && bucket < peaks.buckets; bucket += 1) {
      amplitude = Math.max(
        amplitude,
        Math.abs(peaks.min[bucket]),
        Math.abs(peaks.max[bucket]),
      );
    }
    output[column] = amplitude;
  }
  return output;
}

export interface WaveformColumn {
  min: number;
  max: number;
}

/** Resample peaks into `columns` display columns (nearest-bucket mix). */
export function buildColumns(peaks: Peaks, columns: number): WaveformColumn[] {
  const count = Math.max(1, Math.floor(columns));
  const output: WaveformColumn[] = [];
  for (let column = 0; column < count; column += 1) {
    const start = Math.floor((column * peaks.buckets) / count);
    const end = Math.max(start + 1, Math.floor(((column + 1) * peaks.buckets) / count));
    let lo = 0;
    let hi = 0;
    for (let bucket = start; bucket < end && bucket < peaks.buckets; bucket += 1) {
      lo = Math.min(lo, peaks.min[bucket]);
      hi = Math.max(hi, peaks.max[bucket]);
    }
    output.push({ min: lo, max: hi });
  }
  return output;
}

/**
 * Evaluate a clip-relative audio envelope. The static gain and fades compose
 * with any explicit volume keyframes (in decibels).
 */
export function evaluateEnvelope(
  envelope: AudioEnvelope,
  localTime: number,
  clipDuration: number,
): number {
  const curveValue = evaluateKeyframes(envelope.keyframes, localTime, envelope.gainDb);
  let gain = dbToGain(curveValue);
  if (envelope.fadeIn > 0 && localTime < envelope.fadeIn) {
    gain *= clamp01(localTime / envelope.fadeIn);
  }
  if (envelope.fadeOut > 0) {
    const fadeStart = clipDuration - envelope.fadeOut;
    if (localTime > fadeStart) {
      gain *= clamp01((clipDuration - localTime) / envelope.fadeOut);
    }
  }
  return gain;
}

/** Peak-normalize a mono channel in place-safe (returns a copy). */
export function normalizeChannel(channel: Float32Array, target = 0.98): Float32Array {
  let peak = 0;
  for (const value of channel) peak = Math.max(peak, Math.abs(value));
  if (peak <= 0) return channel.slice();
  const scale = target / peak;
  const output = new Float32Array(channel.length);
  for (let i = 0; i < channel.length; i += 1) output[i] = channel[i] * scale;
  return output;
}

/**
 * Deterministic pseudo-audio used to preview generator clips that have no
 * backing file on disk. Not random: seeded so the UI is stable across frames.
 */
export function syntheticChannel(
  buckets: number,
  seed = 1,
  _envelope: AudioEnvelope = { gainDb: 0, fadeIn: 0, fadeOut: 0, keyframes: [] },
): Float32Array {
  const output = new Float32Array(buckets);
  let state = seed * 2654435761;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  for (let i = 0; i < buckets; i += 1) {
    const t = buckets > 1 ? i / (buckets - 1) : 0;
    const tone =
      0.55 * Math.sin(t * Math.PI * 2 * 6) +
      0.28 * Math.sin(t * Math.PI * 2 * 11.5) +
      0.18 * (next() - 0.5);
    const shaped = tone * (0.6 + 0.4 * Math.sin(t * Math.PI));
    output[i] = clamp(shaped, -1, 1);
  }
  return output;
}

export function keyframesToDbCurve(keyframes: Keyframe[]): number[] {
  return keyframes.map((keyframe) => keyframe.value);
}

export interface WaveformBand {
  /** Vertical centre of the drawn waveform, relative to the clip top. */
  mid: number;
  /** Half-height of the waveform, in pixels. */
  amplitude: number;
  /** Stroke alpha for the waveform line. */
  alpha: number;
}

/**
 * Geometry for a clip's waveform, or null when the clip has nothing to draw.
 * Audio clips get a centred band; video clips with a real waveform get a
 * slimmer band tucked under the label.
 */
export function waveformBand(
  kind: SourceKind,
  clipHeight: number,
  hasAudio: boolean,
  onAudioTrack: boolean,
): WaveformBand | null {
  if (kind === "audio" || onAudioTrack) {
    return { mid: clipHeight / 2, amplitude: clipHeight / 2.4, alpha: 0.7 };
  }
  if (kind === "video" && hasAudio) {
    return { mid: clipHeight * 0.72, amplitude: clipHeight / 3.6, alpha: 0.45 };
  }
  return null;
}
