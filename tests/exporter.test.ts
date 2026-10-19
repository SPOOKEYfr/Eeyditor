import { describe, expect, it } from "vitest";
import {
  buildFFmpegArgs,
  buildFfmpegPlan,
  escapeDrawtext,
  piecewiseLinearExpression,
} from "../src/core/exporter/FFmpegBridge";
import {
  createClip,
  createDemoProject,
  createEmptyProject,
  createMediaSource,
  RENDER_PRESETS,
} from "../src/core/project/factory";
import type { KeyframeCurve } from "../src/types/timeline";

describe("ffmpeg export pipeline", () => {
  it("builds a filtergraph with a video output and mapping", () => {
    const project = createDemoProject();
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.filterComplex).toContain("[vout]");
    expect(plan.videoLabel).toBe("vout");
    expect(plan.args).toContain("-filter_complex");
    expect(plan.args).toContain("[vout]");
    expect(plan.args.at(-1)).toBe("/tmp/out.mp4");
  });

  it("overlays visual clips and mixes audio", () => {
    const project = createDemoProject();
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.filterComplex).toContain("overlay=");
    expect(plan.filterComplex).toContain("enable=between(t\\,");
    expect(plan.audioLabel).toBe("aout");
  });

  it("emits an empty-project plan that still renders a background", () => {
    const project = createEmptyProject();
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.args.join(" ")).toContain("color=c=black");
    expect(plan.filterComplex).toContain("[vout]");
    expect(plan.audioLabel).toBeNull();
  });

  it("applies the NVENC codec arguments when requested", () => {
    const project = createDemoProject();
    project.renderPreset = { ...RENDER_PRESETS[3] };
    const args = buildFFmpegArgs(project, "/tmp/out.mp4");
    expect(args).toContain("h264_nvenc");
    expect(args).toContain("-rc");
    expect(args).toContain("vbr");
  });

  it("uses CRF for CPU software encoding", () => {
    const project = createDemoProject();
    project.renderPreset = { ...RENDER_PRESETS[1] };
    const args = buildFFmpegArgs(project, "/tmp/out.mp4");
    expect(args).toContain("-crf");
    expect(args).toContain("libx264");
  });

  it("builds a piecewise-linear expression that interpolates keyframes", () => {
    const curve: KeyframeCurve = {
      property: "opacity",
      defaultValue: 1,
      keyframes: [
        { id: "a", time: 0, value: 0, interpolation: "linear", inHandle: { x: 0.33, y: 0 }, outHandle: { x: 0.33, y: 0 } },
        { id: "b", time: 2, value: 1, interpolation: "linear", inHandle: { x: 0.33, y: 0 }, outHandle: { x: 0.33, y: 0 } },
      ],
    };
    const expression = piecewiseLinearExpression(curve, 30);
    expect(expression).toContain("gte(t,0)");
    expect(expression).toContain("lt(t,2)");
    expect(expression).toContain("(t-");
  });

  it("emits a flat piecewise expression without deep if-nesting", () => {
    const keyframes = Array.from({ length: 120 }, (_, index) => ({
      id: `k${index}`,
      time: index / 60,
      value: index % 2,
      interpolation: "linear" as const,
      inHandle: { x: 0.33, y: 0 },
      outHandle: { x: 0.33, y: 0 },
    }));
    const expression = piecewiseLinearExpression(
      { property: "opacity", defaultValue: 1, keyframes },
      60,
    );
    const depth = expression.split("if(").length - 1;
    expect(depth).toBe(0);
  });

  it("compiles edge transitions into an alpha ramp and audio fades", () => {
    const project = createEmptyProject();
    const source = createMediaSource({
      path: "generator://transition",
      kind: "generator",
      duration: 4,
      hasVideo: true,
      hasAudio: true,
    });
    project.media = [source];
    const clip = createClip({
      trackId: project.tracks[0].id,
      sourceId: source.id,
      start: 0,
      duration: 4,
      kind: "generator",
    });
    clip.transitionOut = {
      id: "tout",
      kind: "dissolve",
      duration: 1,
      direction: "left",
    };
    project.tracks[0].clips = [clip];
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.filterComplex).toContain("alphamerge");
    expect(plan.filterComplex).toContain("min(1\\,max(0\\,");
    expect(plan.filterComplex).toContain("afade=t=out");
  });

  it("names the drawtext filter with '=' before its options", () => {
    const project = createEmptyProject();
    const clip = createClip({
      trackId: project.tracks[2].id,
      sourceId: "",
      start: 0,
      duration: 2,
      kind: "text",
    });
    project.tracks[2].clips = [clip];
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.filterComplex).toContain("drawtext=text=");
    expect(plan.filterComplex).not.toContain("drawtext:text=");
  });

  it("returns a constant expression for flat curves", () => {
    const curve: KeyframeCurve = { property: "opacity", defaultValue: 0.7, keyframes: [] };
    expect(piecewiseLinearExpression(curve, 30)).toBe("0.7");
  });

  it("escapes drawtext-sensitive characters", () => {
    const escaped = escapeDrawtext("a:b'c%d\\e");
    expect(escaped).not.toContain("a:b");
    expect(escaped).toContain("\\:");
    expect(escaped).toContain("\\'");
  });

  it("keeps a stable argument count for the demo project", () => {
    const project = createDemoProject();
    const first = buildFFmpegArgs(project, "/tmp/out.mp4");
    const second = buildFFmpegArgs(project, "/tmp/out.mp4");
    expect(first).toEqual(second);
  });
});
