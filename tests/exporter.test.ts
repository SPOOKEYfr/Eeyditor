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
  createEffect,
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

  it("emits wipe masks and slide offsets instead of a plain fade", () => {
    const project = createEmptyProject();
    const track = project.tracks.find((entry) => entry.type === "video");
    if (!track) throw new Error("missing video track");
    const clip = createClip({ trackId: track.id, start: 0, duration: 4, kind: "video" });
    clip.transitionIn = { id: "t", kind: "wipe", duration: 1, direction: "left" };
    track.clips = [clip];
    const wipePlan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(wipePlan.args.join(" ")).toContain("128x72");
    expect(wipePlan.filterComplex).toContain("alphamerge");
    expect(wipePlan.filterComplex).toContain("X/W");

    clip.transitionIn = { id: "t2", kind: "slide", duration: 1, direction: "right" };
    const slidePlan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(slidePlan.filterComplex).toContain("+W*");
    expect(slidePlan.filterComplex).toContain("1-(t-");
  });

  it("positions and sizes subtitle cues per cue", () => {
    const project = createEmptyProject();
    project.subtitles = [
      { id: "a", start: 0, end: 1, text: "low", position: "bottom", sizeScale: 1 },
      { id: "b", start: 1, end: 2, text: "high", position: "top", sizeScale: 1.5, color: "#FFB300" },
      { id: "c", start: 2, end: 3, text: "mid", position: "center" },
    ];
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.filterComplex).toContain("y=h*0.94-text_h");
    expect(plan.filterComplex).toContain("y=h*0.165-text_h");
    expect(plan.filterComplex).toContain("y=h*0.5-text_h");
    expect(plan.filterComplex).toContain("fontcolor=#FFB300");
    expect(plan.filterComplex).toContain("fontsize=73");
  });

  it("applies 3D LUT effects and skips them without a file", () => {
    const project = createEmptyProject();
    const track = project.tracks.find((entry) => entry.type === "video");
    if (!track) throw new Error("missing video track");
    const clip = createClip({ trackId: track.id, start: 0, duration: 3, kind: "video" });
    const effect = createEffect("lut");
    effect.params.path = "/tmp/luts/teal.cube";
    clip.effects = [effect];
    track.clips = [clip];
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.filterComplex).toContain("lut3d=file=/tmp/luts/teal.cube");

    effect.params = {};
    const bare = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(bare.filterComplex).not.toContain("lut3d");
  });

  it("blends non-normal clip modes through an alpha-masked blend pass", () => {
    const project = createEmptyProject();
    const track = project.tracks.find((entry) => entry.type === "video");
    if (!track) throw new Error("missing video track");
    const clip = createClip({ trackId: track.id, start: 0, duration: 3, kind: "video" });
    clip.transform.blendMode = "multiply";
    track.clips = [clip];
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.filterComplex).toContain("blend=all_mode=multiply");
    expect(plan.filterComplex).toContain("alphaextract");
    expect(plan.filterComplex).toContain("alphamerge");

    clip.transform.blendMode = "color-dodge";
    const dodge = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(dodge.filterComplex).toContain("blend=all_mode=dodge");

    clip.transform.blendMode = "normal";
    const normal = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(normal.filterComplex).not.toContain("alphaextract");
  });

  it("builds a GIF palette chain and drops the audio stream", () => {
    const project = createEmptyProject();
    project.renderPreset = { ...RENDER_PRESETS.find((preset) => preset.id === "gif-480p12")! };
    const plan = buildFfmpegPlan(project, "/tmp/out.gif");
    expect(plan.filterComplex).toContain("palettegen");
    expect(plan.filterComplex).toContain("paletteuse");
    expect(plan.args.join(" ")).toContain("-c:v gif");
    expect(plan.args.join(" ")).not.toContain("-map [aout]");
    expect(plan.audioLabel).toBeNull();
  });

  it("supports audio-only presets without mapping video", () => {
    const project = createEmptyProject();
    project.renderPreset = { ...RENDER_PRESETS.find((preset) => preset.id === "audio-mp3-320")! };
    const track = project.tracks.find((entry) => entry.type === "audio");
    if (!track) throw new Error("missing audio track");
    const source = createMediaSource({ path: "generator://a", kind: "audio", name: "A", duration: 4, hasVideo: false, hasAudio: true });
    project.media = [source];
    track.clips = [
      createClip({ trackId: track.id, sourceId: source.id, start: 0, duration: 3, kind: "audio" }),
    ];
    const plan = buildFfmpegPlan(project, "/tmp/out.mp3");
    expect(plan.args.join(" ")).toContain("-vn");
    expect(plan.args.join(" ")).not.toContain("-map [vout]");
    expect(plan.args.join(" ")).toContain("-c:a libmp3lame");
  });

  it("reverses video and audio for reversed clips", () => {
    const project = createEmptyProject();
    const track = project.tracks.find((entry) => entry.type === "video");
    if (!track) throw new Error("missing video track");
    const source = createMediaSource({
      path: "generator://rev",
      kind: "generator",
      name: "Rev",
      duration: 4,
      hasVideo: true,
      hasAudio: true,
    });
    project.media = [source];
    const clip = createClip({ trackId: track.id, sourceId: source.id, start: 0, duration: 3, kind: "generator" });
    clip.reversed = true;
    track.clips = [clip];
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.filterComplex).toContain("reverse");
    expect(plan.filterComplex).toContain("areverse");
    expect(plan.filterComplex).toContain("trim=");
    expect(plan.filterComplex).toContain("atrim=");
  });

  it("scales zoom transitions per frame instead of fading", () => {
    const project = createEmptyProject();
    const track = project.tracks.find((entry) => entry.type === "video");
    if (!track) throw new Error("missing video track");
    const clip = createClip({ trackId: track.id, start: 0, duration: 4, kind: "video" });
    clip.transitionIn = { id: "t", kind: "zoom", duration: 1, direction: "left" };
    track.clips = [clip];
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.filterComplex).toContain("1+0.12*");
    expect(plan.filterComplex).toContain("scale=w=iw*");
    expect(plan.filterComplex).toContain(":eval=frame");
    expect(plan.filterComplex).toContain("alphamerge");
  });

  it("burns subtitle cues as timed drawtext overlays", () => {
    const project = createEmptyProject();
    project.subtitles = [{ id: "cue", start: 1, end: 2.5, text: "Hello, world" }];
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.filterComplex).toContain("drawtext=text=Hello\\, world");
    expect(plan.filterComplex).toContain("enable=between(t\\,1\\,2.5)");
    expect(plan.filterComplex).toContain("boxcolor=black@0.55");
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

  it("drops audio from muted tracks and applies track gain", () => {
    const project = createEmptyProject();
    const source = createMediaSource({
      path: "generator://bed",
      kind: "generator",
      duration: 4,
      hasVideo: false,
      hasAudio: true,
    });
    project.media = [source];
    project.tracks[3].clips = [
      createClip({
        trackId: project.tracks[3].id,
        sourceId: source.id,
        start: 0,
        duration: 4,
        kind: "generator",
      }),
    ];

    project.tracks[3].muted = true;
    expect(buildFfmpegPlan(project, "/tmp/out.mp4").audioLabel).toBeNull();

    project.tracks[3].muted = false;
    project.tracks[3].volume = -6;
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.audioLabel).toBe("aout");
    expect(plan.filterComplex).toContain("volume=-6dB");
  });

  it("skips hidden video tracks", () => {
    const project = createDemoProject();
    const before = buildFfmpegPlan(project, "/tmp/out.mp4").filterComplex;
    project.tracks[0].hidden = true;
    const after = buildFfmpegPlan(project, "/tmp/out.mp4").filterComplex;
    expect(after.split(";").length).toBeLessThan(before.split(";").length);
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

  it("blends a partial-strength LUT over the source", () => {
    const project = createEmptyProject();
    const track = project.tracks.find((entry) => entry.type === "video");
    if (!track) throw new Error("missing video track");
    const clip = createClip({ trackId: track.id, start: 0, duration: 3, kind: "video" });
    track.clips = [clip];
    clip.effects = [
      { id: "e1", kind: "lut", enabled: true, amount: 0.4, params: { path: "/tmp/invert.cube" } },
    ];
    const plan = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(plan.filterComplex).toContain("blend=all_expr=A*(1-0.4)+B*0.4");
    expect(plan.filterComplex).toContain("split[v");
    expect(plan.filterComplex).toContain("lut3d=file=/tmp/invert.cube");

    clip.effects[0].amount = 1;
    const full = buildFfmpegPlan(project, "/tmp/out.mp4");
    expect(full.filterComplex).not.toContain("all_expr");
    expect(full.filterComplex).toContain("lut3d=file=/tmp/invert.cube");
  });
});
