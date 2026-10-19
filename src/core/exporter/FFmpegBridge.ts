import type {
  EeyditorProject,
  KeyframeCurve,
  MediaSource,
  RenderPreset,
  TimelineClip,
  TimelineTrack,
  TrackType,
} from "../../types/timeline";
import { evaluateCurve } from "../keyframes/bezier";
import { clipEnd } from "../timeline/engine";

export interface FfmpegPlan {
  /** Full ffmpeg argument vector, excluding the `ffmpeg` binary itself. */
  args: string[];
  /** The generated complex filtergraph body. */
  filterComplex: string;
  videoLabel: string;
  audioLabel: string | null;
  duration: number;
}

const TRANSPARENT_BG = "black@0.0";
const VIDEO_TRACKS: TrackType[] = ["video", "overlay", "effects", "text", "adjustment"];

function f(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

/** Escape a value for use inside a drawtext text parameter. */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/:/g, "\\\\:")
    .replace(/'/g, "\\\\'")
    .replace(/%/g, "\\\\%")
    .replace(/\n/g, "\\n");
}

/**
 * Build a piecewise-linear ffmpeg expression in terms of `t` for a keyframe
 * curve. Bezier segments are sampled to a tight linear approximation so the
 * filtergraph stays deterministic and evaluable per frame.
 */
export function piecewiseLinearExpression(curve: KeyframeCurve, fps: number): string {
  const keyframes = [...curve.keyframes].sort((a, b) => a.time - b.time);
  if (keyframes.length === 0) return f(curve.defaultValue);
  if (keyframes.length === 1) return f(keyframes[0].value);

  const segments: string[] = [];
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    const span = b.time - a.time;
    if (span <= 0) continue;

    if (a.interpolation === "hold") {
      segments.push(`if(lt(t,${f(b.time)}),${f(a.value)},`);
      continue;
    }

    // Densely sample bezier segments; linear segments use exact endpoints.
    const steps = a.interpolation === "bezier" ? Math.max(2, Math.round(span * fps)) : 1;
    for (let step = 0; step < steps; step += 1) {
      const t0 = a.time + (span * step) / steps;
      const t1 = a.time + (span * (step + 1)) / steps;
      const v0 =
        step === 0 ? a.value : evaluateCurve(curve, t0);
      const v1 = step === steps - 1 ? b.value : evaluateCurve(curve, t1);
      segments.push(`if(lt(t,${f(t1)}),${f(v0)}+${f(v1 - v0)}*(t-${f(t0)})/${f(t1 - t0)},`);
    }
  }

  const last = keyframes[keyframes.length - 1];
  let expression = `${f(last.value)}`;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    expression = `${segments[i]}${expression})`;
  }
  // Clamp before the first keyframe to its value.
  return `if(lt(t,${f(keyframes[0].time)}),${f(keyframes[0].value)},${expression})`;
}

function staticOrExpression(curve: KeyframeCurve, fps: number): string {
  if (curve.keyframes.length === 0) return f(curve.defaultValue);
  return piecewiseLinearExpression(curve, fps);
}

function atempoChain(speed: number): string {
  if (speed <= 0 || Math.abs(speed - 1) < 1e-3) return "";
  const steps: string[] = [];
  let remaining = speed;
  while (remaining > 2) {
    steps.push("atempo=2.0");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    steps.push("atempo=0.5");
    remaining /= 0.5;
  }
  steps.push(`atempo=${f(remaining)}`);
  return steps.join(",");
}

function generatorVideoSource(preset: RenderPreset, duration: number, seed: number): string {
  const hues = ["0xFFB300", "0xFF5100", "0xE60067", "0x7C5CFF"];
  const c0 = hues[seed % hues.length];
  const c1 = hues[(seed + 1) % hues.length];
  return [
    "gradients",
    `s=${preset.width}x${preset.height}`,
    `r=${preset.fps}`,
    `d=${f(Math.max(0.1, duration))}`,
    `c0=${c0}`,
    `c1=${c1}`,
    "x0=0",
    "y0=0",
    `x1=${preset.width}`,
    `y1=${preset.height}`,
  ].join(":");
}

function generatorAudioSource(duration: number, frequency = 220): string {
  return `sine=frequency=${frequency}:sample_rate=48000:duration=${f(
    Math.max(0.1, duration),
  )}`;
}

function textSource(preset: RenderPreset, duration: number): string {
  return `color=c=${TRANSPARENT_BG}:s=${preset.width}x${preset.height}:r=${preset.fps}:d=${f(
    Math.max(0.1, duration),
  )}`;
}

interface ClipInputs {
  clip: TimelineClip;
  track: TimelineTrack;
  videoIndex?: number;
  audioIndex?: number;
}

function buildDrawText(clip: TimelineClip): string {
  const text = clip.text;
  if (!text) return "null";
  const color = text.color.replace(/^#/, "0x");
  const border =
    text.strokeWidth > 0
      ? `:borderw=${f(text.strokeWidth)}:bordercolor=${text.strokeColor.replace(/^#/, "0x")}`
      : "";
  const shadow =
    text.shadowBlur > 0
      ? `:shadowx=2:shadowy=2:shadowcolor=black@0.5`
      : "";
  return [
    "drawtext",
    `text='${escapeDrawtext(text.content)}'`,
    `fontcolor=${color}`,
    `fontsize=${f(text.fontSize)}`,
    `line_spacing=${f(text.lineHeight * text.fontSize - text.fontSize)}`,
    "x=(w-text_w)/2",
    "y=(h-text_h)/2",
    border,
    shadow,
  ]
    .join(":")
    .replace(/::/g, ":");
}

/**
 * Compile a project into a deterministic ffmpeg invocation. The composition is
 * always rasterized over a generated background and then overlaid bottom-up by
 * track order, so gaps resolve to the background rather than the previous clip.
 */
export function buildFfmpegPlan(
  project: EeyditorProject,
  outputPath: string,
): FfmpegPlan {
  const preset = project.renderPreset;
  const fps = preset.fps || project.frameRate || 30;
  const duration = Math.max(project.duration, 0.1);

  const mediaById = new Map<string, MediaSource>(
    project.media.map((source) => [source.id, source]),
  );

  const inputs: string[] = [
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${preset.width}x${preset.height}:r=${fps}:d=${f(duration)}`,
  ];
  let nextInput = 1;

  const filters: string[] = [];

  const trackOrder = [...project.tracks].sort((a, b) => {
    const ai = VIDEO_TRACKS.indexOf(a.type);
    const bi = VIDEO_TRACKS.indexOf(b.type);
    if (a.type === "audio" && b.type !== "audio") return 1;
    if (b.type === "audio" && a.type !== "audio") return -1;
    return ai - bi;
  });

  let generatorSeed = 0;
  const clipInputs: ClipInputs[] = [];

  for (const track of trackOrder) {
    for (const clip of [...track.clips].sort((a, b) => a.start - b.start)) {
      const source = mediaById.get(clip.sourceId);
      const entry: ClipInputs = { clip, track };
      const isGenerator = !source || source.path.startsWith("generator://");

      if (clip.kind === "text") {
        inputs.push("-f", "lavfi", "-i", textSource(preset, clip.duration));
        entry.videoIndex = nextInput++;
      } else if (isGenerator) {
        if (source?.hasVideo ?? clip.kind !== "audio") {
          inputs.push(
            "-f",
            "lavfi",
            "-i",
            generatorVideoSource(preset, clip.duration, generatorSeed++),
          );
          entry.videoIndex = nextInput++;
        }
        if (source?.hasAudio ?? clip.kind === "audio") {
          inputs.push("-f", "lavfi", "-i", generatorAudioSource(clip.duration));
          entry.audioIndex = nextInput++;
        }
      } else {
        inputs.push("-i", source.path);
        const index = nextInput++;
        if (source.hasVideo) entry.videoIndex = index;
        if (source.hasAudio) entry.audioIndex = index;
      }

      clipInputs.push(entry);
    }
  }

  let videoCursor = "[base]";
  filters.push(`[0:v]setsar=1[base]`);
  let videoCounter = 0;

  for (const entry of clipInputs) {
    if (entry.videoIndex === undefined) continue;
    const { clip } = entry;
    const chain: string[] = [];
    const inputLabel = `[${entry.videoIndex}:v]`;

    chain.push(`trim=start=${f(Math.max(0, clip.inPoint))}:end=${f(clip.inPoint + clip.duration * clip.speed)}`);
    chain.push("setpts=PTS-STARTPTS");
    if (clip.speed !== 1 && clip.speed > 0) {
      chain.push(`setpts=PTS/${f(clip.speed)}`);
    }
    chain.push(`fps=${f(fps)}`);

    if (clip.kind === "text") {
      chain.push(buildDrawText(clip));
    } else {
      chain.push(
        `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease:eval=frame`,
      );
      chain.push(
        `pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2:color=${TRANSPARENT_BG}`,
      );
      const sx = staticOrExpression(clip.transform.scaleX, fps);
      const sy = staticOrExpression(clip.transform.scaleY, fps);
      if (clip.transform.scaleX.keyframes.length || clip.transform.scaleY.keyframes.length) {
        chain.push(`scale=iw*(${sx}):ih*(${sy}):eval=frame`);
      } else if (clip.transform.scaleX.defaultValue !== 1 || clip.transform.scaleY.defaultValue !== 1) {
        chain.push(`scale=iw*${f(clip.transform.scaleX.defaultValue)}:ih*${f(clip.transform.scaleY.defaultValue)}`);
      }
      const rotation = staticOrExpression(clip.transform.rotation, fps);
      if (clip.transform.rotation.keyframes.length || clip.transform.rotation.defaultValue !== 0) {
        chain.push(
          `rotate=${rotation}*PI/180:c=none:ow=rotw(iw):oh=roth(ih)`,
        );
      }
      // Effects layers.
      for (const effect of clip.effects) {
        if (!effect.enabled) continue;
        chain.push(effectFilter(effect.kind, effect.amount));
      }
    }

    chain.push("format=rgba");
    const opacity = staticOrExpression(clip.transform.opacity, fps);
    if (clip.transform.opacity.keyframes.length || clip.transform.opacity.defaultValue !== 1) {
      chain.push(`colorchannelmixer=aa=(${opacity})`);
    }
    chain.push(`setpts=PTS+${f(clip.start)}/TB`);

    const label = `vc${videoCounter++}`;
    filters.push(`${inputLabel}${chain.join(",")}[${label}]`);

    const posX = staticOrExpression(clip.transform.positionX, fps);
    const posY = staticOrExpression(clip.transform.positionY, fps);
    const xExpr = `(W*(0.5+(${posX}))-w*${f(clip.transform.anchorX)})`;
    const yExpr = `(H*(0.5+(${posY}))-h*${f(clip.transform.anchorY)})`;
    const enable = `enable='between(t,${f(clip.start)},${f(clipEnd(clip))})'`;
    const next = `[v${videoCounter}]`;
    filters.push(
      `${videoCursor}[${label}]overlay=x=${xExpr}:y=${yExpr}:${enable}:eval=frame:format=auto:shortest=0${next}`,
    );
    videoCursor = next;
  }

  filters.push(`${videoCursor}format=${preset.pixelFormat}[vout]`);

  const audioLabels: string[] = [];
  let audioCounter = 0;
  for (const entry of clipInputs) {
    if (entry.audioIndex === undefined) continue;
    const { clip } = entry;
    const chain: string[] = [];
    chain.push(
      `atrim=start=${f(Math.max(0, clip.inPoint))}:end=${f(clip.inPoint + clip.duration * clip.speed)}`,
    );
    chain.push("asetpts=PTS-STARTPTS");
    const tempo = atempoChain(clip.speed);
    if (tempo) chain.push(tempo);
    if (clip.volume.gainDb !== 0) chain.push(`volume=${f(clip.volume.gainDb)}dB`);
    if (clip.volume.keyframes.length) {
      chain.push(`volume=volume='${piecewiseLinearExpression(
        { property: "volume", defaultValue: clip.volume.gainDb, keyframes: clip.volume.keyframes },
        fps,
      )}/20':eval=frame`);
    }
    if (clip.volume.fadeIn > 0) {
      chain.push(`afade=t=in:st=0:d=${f(clip.volume.fadeIn)}`);
    }
    if (clip.volume.fadeOut > 0) {
      const start = Math.max(0, clip.duration - clip.volume.fadeOut);
      chain.push(`afade=t=out:st=${f(start)}:d=${f(clip.volume.fadeOut)}`);
    }
    if (clip.start > 0) {
      const delayMs = Math.round(clip.start * 1000);
      chain.push(`adelay=${delayMs}|${delayMs}`);
    }
    chain.push("aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo");
    const label = `ac${audioCounter++}`;
    filters.push(`[${entry.audioIndex}:a]${chain.join(",")}[${label}]`);
    audioLabels.push(`[${label}]`);
  }

  let audioLabel: string | null = null;
  if (audioLabels.length === 1) {
    filters.push(`${audioLabels[0]}anull[aout]`);
    audioLabel = "aout";
  } else if (audioLabels.length > 1) {
    filters.push(
      `${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0[aout]`,
    );
    audioLabel = "aout";
  }

  const filterComplex = filters.join(";");
  const args: string[] = ["-y", "-hide_banner", ...inputs, "-filter_complex", filterComplex, "-map", "[vout]"];
  if (audioLabel) args.push("-map", `[${audioLabel}]`);

  args.push(...videoCodecArgs(preset));
  if (audioLabel) {
    args.push("-c:a", preset.audioCodec, "-b:a", preset.audioBitrate, "-ar", String(preset.audioSampleRate), "-ac", String(preset.channels));
  }
  args.push("-t", f(duration));
  if (preset.faststart && preset.container === "mp4") args.push("-movflags", "+faststart");
  args.push(outputPath);

  return {
    args,
    filterComplex,
    videoLabel: "vout",
    audioLabel,
    duration,
  };
}

function effectFilter(kind: string, amount: number): string {
  switch (kind) {
    case "blur":
      return `gblur=sigma=${f(Math.max(0, amount * 12))}`;
    case "brightness":
      return `eq=brightness=${f((amount - 1) * 0.5)}`;
    case "contrast":
      return `eq=contrast=${f(Math.max(0, amount))}`;
    case "saturation":
      return `eq=saturation=${f(Math.max(0, amount))}`;
    case "hue":
      return `hue=h=${f(amount * 180)}`;
    case "sharpen":
      return `unsharp=5:5:${f(Math.max(0, amount * 1.5))}`;
    case "vignette":
      return "vignette";
    case "glow":
      return `gblur=sigma=${f(Math.max(0, amount * 6))}`;
    case "chroma-key":
      return "colorkey=green:0.3:0.15";
    default:
      return "null";
  }
}

function videoCodecArgs(preset: RenderPreset): string[] {
  if (preset.hardware === "nvenc" || preset.videoCodec.endsWith("_nvenc")) {
    return [
      "-c:v",
      preset.videoCodec,
      "-preset",
      preset.encoderPreset,
      "-rc",
      "vbr",
      "-cq",
      String(preset.crf),
      "-b:v",
      preset.videoBitrate,
      "-pix_fmt",
      preset.pixelFormat,
    ];
  }
  return [
    "-c:v",
    preset.videoCodec,
    "-preset",
    preset.encoderPreset,
    "-crf",
    String(preset.crf),
    "-pix_fmt",
    preset.pixelFormat,
  ];
}

export function buildFFmpegArgs(project: EeyditorProject, outputPath: string): string[] {
  return buildFfmpegPlan(project, outputPath).args;
}

export function renderPresetSummary(preset: RenderPreset): string {
  return `${preset.width}x${preset.height} @ ${preset.fps}fps - ${preset.videoCodec}`;
}
