import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  createClip,
  createDemoProject,
  createEmptyProject,
  createMediaSource,
  RENDER_PRESETS,
} from "../../src/core/project/factory";
import { createKeyframe } from "../../src/core/keyframes/bezier";
import type { EeyditorProject, TimelineClip } from "../../src/types/timeline";
import { distance, exitCode, probe, render, report, sample, workDir } from "./harness";

function videoTrack(project: EeyditorProject) {
  const track = project.tracks.find((entry) => entry.type === "video");
  if (!track) throw new Error("project has no video track");
  return track;
}

function generatorProject(kind: "video" | "audio" = "video"): {
  project: EeyditorProject;
  clip: TimelineClip;
} {
  const project = createEmptyProject("E2E");
  project.duration = 4;
  const source = createMediaSource({
    path: `generator://${kind}`,
    kind: "generator",
    name: "Generator",
    duration: 8,
    hasVideo: kind === "video",
    hasAudio: true,
  });
  project.media = [source];
  const track = kind === "video" ? videoTrack(project) : project.tracks[3];
  const clip = createClip({
    trackId: track.id,
    sourceId: source.id,
    start: 0,
    duration: 4,
    kind: "generator",
  });
  track.clips = [clip];
  return { project, clip };
}

// 1. Empty timeline still renders a valid black frame.
{
  const project = createEmptyProject("Empty");
  project.duration = 1;
  report(Boolean(render(project, "empty")), "empty-timeline");
}

// 2. Generator clip with a static transform.
{
  const { project, clip } = generatorProject();
  clip.transform.scaleX.defaultValue = 0.5;
  clip.transform.scaleY.defaultValue = 0.5;
  report(Boolean(render(project, "generator-scaled")), "generator-static-scale");
}

// 3. Keyframed scale compiles to a dynamic overlay.
{
  const { project, clip } = generatorProject();
  clip.transform.scaleX = {
    ...clip.transform.scaleX,
    keyframes: [createKeyframe("k1", 0, 0.5), createKeyframe("k2", 3, 1.4)],
  };
  const plan = render(project, "generator-keyframed");
  report(Boolean(plan), "generator-keyframed");
}

// 4. Text clip renders its own drawtext layer.
{
  const project = createEmptyProject("Text");
  project.duration = 2;
  const track = project.tracks.find((entry) => entry.type === "text");
  if (!track) throw new Error("no text track");
  const clip = createClip({ trackId: track.id, start: 0, duration: 2, kind: "text" });
  if (clip.text) clip.text.content = "E2E";
  track.clips = [clip];
  report(Boolean(render(project, "text")), "text-clip");
}

// 5. Audio-only track mixes into the output.
{
  const project = createEmptyProject("Audio");
  project.duration = 2;
  const source = createMediaSource({ path: "generator://audio", kind: "generator", name: "A", duration: 4, hasVideo: false, hasAudio: true });
  project.media = [source];
  const track = project.tracks[3];
  track.clips = [createClip({ trackId: track.id, sourceId: source.id, start: 0, duration: 2, kind: "audio" })];
  report(Boolean(render(project, "audio")), "audio-clip");
}

// 6. The shipped demo arrangement renders.
report(Boolean(render(createDemoProject(), "demo")), "demo-project");

// 7. Spatial transitions.
for (const [kind, direction] of [
  ["wipe", "left"],
  ["wipe", "up"],
  ["slide", "right"],
  ["slide", "down"],
] as const) {
  const { project, clip } = generatorProject();
  clip.transitionIn = { id: "in", kind, duration: 1, direction };
  clip.transitionOut = { id: "out", kind, duration: 1, direction };
  report(Boolean(render(project, `${kind}-${direction}`)), `${kind}-${direction}`);
}

// 8. Zoom transitions change the frame geometry at the edges.
{
  const { project, clip } = generatorProject();
  clip.transitionIn = { id: "in", kind: "zoom", duration: 1, direction: "left" };
  clip.transitionOut = { id: "out", kind: "zoom", duration: 1, direction: "left" };
  const out = render(project, "zoom");
  const atStart = out ? sample(out, 0.4) : [];
  const atMiddle = out ? sample(out, 2) : [];
  const atEnd = out ? sample(out, 3.6) : [];
  const inbound = distance(atStart, atMiddle);
  const outbound = distance(atEnd, atMiddle);
  report(Boolean(out) && inbound > 12 && outbound > 12, `zoom-corner-shift (in=${inbound} out=${outbound})`);
}

// 9. Subtitle burn-in.
{
  const project = createEmptyProject("Subs");
  project.duration = 2;
  project.subtitles = [
    { id: "c1", start: 0.2, end: 1, text: "Hello, subtitle" },
    { id: "c2", start: 1, end: 2, text: "Second line\nwith wrap" },
  ];
  report(Boolean(render(project, "subtitles")), "subtitles");
}

// 10. Reversed clips mirror the forward render.
{
  const fixture = join(workDir, "fixture.mp4");
  const generated = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", fixture,
  ]);
  if (generated.status !== 0) {
    report(false, "reverse-fixture");
  } else {
    const build = (reversed: boolean) => {
      const project = createEmptyProject("Reverse");
      project.duration = 2;
      const source = createMediaSource({ path: fixture, kind: "video", name: "Fixture", duration: 2, hasVideo: true, hasAudio: false });
      project.media = [source];
      const track = videoTrack(project);
      const clip = createClip({ trackId: track.id, sourceId: source.id, start: 0, duration: 2, kind: "video" });
      clip.reversed = reversed;
      track.clips = [clip];
      return project;
    };
    const forward = render(build(false), "forward");
    const reversed = render(build(true), "reversed");
    let mirrored = 0;
    const pairs: [number, number][] = [[0.25, 1.75], [0.5, 1.5]];
    for (const [here, there] of pairs) {
      if (!forward || !reversed) break;
      const actual = distance(sample(reversed, here), sample(forward, there));
      const control = distance(sample(reversed, here), sample(forward, here));
      if (actual < control) mirrored += 1;
    }
    report(Boolean(forward && reversed) && mirrored === pairs.length, `reverse-mirrors-forward (${mirrored}/${pairs.length})`);
  }
}

// 11. Animated GIF preset emits a real GIF.
{
  const { project } = generatorProject();
  project.duration = 2;
  project.renderPreset = { ...RENDER_PRESETS.find((preset) => preset.id === "gif-480p12")! };
  const out = render(project, "animation", "gif");
  const info = out ? probe(out, "stream=codec_name,width,nb_frames") : "";
  report(Boolean(out) && info.includes("codec_name=gif") && info.includes("width=480"), "gif-preset");
}

// 12. Audio-only preset emits an MP3 with no video stream.
{
  const { project } = generatorProject("audio");
  project.duration = 2;
  project.renderPreset = { ...RENDER_PRESETS.find((preset) => preset.id === "audio-mp3-320")! };
  const out = render(project, "song", "mp3");
  const info = out ? probe(out, "stream=codec_name:format=format_name") : "";
  report(Boolean(out) && info.includes("codec_name=mp3") && !info.includes("h264"), "audio-only-preset");
}

process.exit(exitCode());
