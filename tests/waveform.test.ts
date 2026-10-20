import { describe, expect, it } from "vitest";
import {
  computePeaks,
  dbToGain,
  gainToDb,
  mixToMono,
  peaksToAmplitudes,
  waveformBand,
  waveformSample,
} from "../src/core/audio/waveform";

describe("audio waveform math", () => {
  it("mixes channels to mono", () => {
    const left = new Float32Array([1, -1, 0.5]);
    const right = new Float32Array([-1, 1, 0.5]);
    expect(Array.from(mixToMono([left, right]))).toEqual([0, 0, 0.5]);
  });

  it("reduces samples into min/max/rms buckets", () => {
    const channel = new Float32Array(8).fill(0).map((_, index) => (index % 2 === 0 ? 0.5 : -0.5));
    const peaks = computePeaks(channel, 4, 8);
    expect(peaks.buckets).toBe(4);
    expect(peaks.max[0]).toBeCloseTo(0.5);
    expect(peaks.min[0]).toBeCloseTo(-0.5);
    expect(peaks.rms[0]).toBeCloseTo(0.5);
  });

  it("projects peaks into symmetric amplitudes", () => {
    const channel = new Float32Array([0.2, -0.8, 0.4, -0.1, 0.9, -0.3, 0.0, 0.0]);
    const amplitudes = peaksToAmplitudes(computePeaks(channel, 4, 8), 4);
    expect(amplitudes.length).toBe(4);
    expect(Math.max(...amplitudes)).toBeCloseTo(0.9);
    expect(Math.min(...amplitudes)).toBeGreaterThanOrEqual(0);
  });

  it("converts between decibels and linear gain", () => {
    expect(dbToGain(0)).toBeCloseTo(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
    expect(gainToDb(1)).toBeCloseTo(0);
    expect(gainToDb(0)).toBe(-120);
  });

  it("places waveforms for audio clips and audio-bearing video clips", () => {
    expect(waveformBand("audio", 60, false, false)).toEqual({ mid: 30, amplitude: 25, alpha: 0.7 });
    expect(waveformBand("video", 60, true, false)?.alpha).toBeCloseTo(0.45);
    expect(waveformBand("video", 60, false, false)).toBeNull();
    expect(waveformBand("image", 60, false, false)).toBeNull();
    expect(waveformBand("video", 60, false, true)?.mid).toBeCloseTo(30);
  });

  it("mirrors waveform samples for reversed clips", () => {
    expect(waveformSample(0, 10, 100, false)).toBe(0);
    expect(waveformSample(9, 10, 100, false)).toBe(90);
    expect(waveformSample(0, 10, 100, true)).toBe(99);
    expect(waveformSample(9, 10, 100, true)).toBe(9);
    expect(waveformSample(-5, 10, 100, false)).toBe(0);
  });
});
