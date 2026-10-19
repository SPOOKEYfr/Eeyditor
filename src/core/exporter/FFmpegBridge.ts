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
import {
  hasTransition,
  isFadeKind,
  transitionInDuration,
  transitionOutDuration,
  zoomScaleExpression,
} from "../timeline/transitions";

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

/**
 * Escape a value so it survives a single pass through ffmpeg's filtergraph
 * tokenizer. `:` separates options, `,` separates filters, `;` separates
 * chains, `[`/`]` delimit labels and `'` toggles quoting; all of them must be
 * backslash-escaped when they appear inside a filter argument value.
 *
 * Quoting is deliberately avoided: ffmpeg's graph parser strips a single quote
 * and then consumes everything up to the next quote, which desyncs the parse
 * when a value (or a later argument such as `enable`) also contains quotes.
 */
export function escapeFilterGraph(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([:;,'\[\]])/g, "\\$1");
}

/** Escape a value for use inside a drawtext text parameter. */
export function escapeDrawtext(text: string): string {
  return escapeFilterGraph(text)
    .replace(/%/g, "\\%")
    .replace(/\n/g, "\\n");
}

/**
 * Build a piecewise expression in terms of `t` for a keyframe curve.
 *
 * The expression is emitted as a flat sum of gate-weighted segments rather
 * than a nested `if` chain: ffmpeg's expression parser caps nesting depth near
 * ~90 levels, while a densely sampled bezier segment can require hundreds of
 * steps. Both forms are mathematically identical; the flat form keeps parser
 * depth constant regardless of sampling density.
 *
 * Gating uses half-open windows so exactly one segment is active at any `t`
 * (piecewise-linear segments share endpoints, so the value is continuous).
 */
export function piecewiseLinearExpression(curve: KeyframeCurve, fps: number): string {
  const keyframes = [...curve.keyframes].sort((a, b) => a.time - b.time);
  if (keyframes.length === 0) return f(curve.defaultValue);
  if (keyframes.length === 1) return f(keyframes[0].value);

  const terms: string[] = [`lt(t,${f(keyframes[0].time)})*${f(keyframes[0].value)}`];

  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    const span = b.time - a.time;
    if (span <= 0) continue;

    if (a.interpolation === "hold") {
      terms.push(
        `${f(a.value)}*gte(t,${f(a.time)})*lt(t,${f(b.time)})`,
      );
      continue;
    }

    // Densely sample bezier segments; linear segments use exact endpoints.
    const steps = a.interpolation === "bezier" ? Math.max(2, Math.round(span * fps)) : 1;
    for (let step = 0; step < steps; step += 1) {
      const t0 = a.time + (span * step) / steps;
      const t1 = a.time + (span * (step + 1)) / steps;
      const v0 = step === 0 ? a.value : evaluateCurve(curve, t0);
      const v1 = step === steps - 1 ? b.value : evaluateCurve(curve, t1);
      const slope = (v1 - v0) / (t1 - t0);
      const gate = `gte(t,${f(t0)})*lt(t,${f(t1)})`;
      terms.push(`(${f(v0)}+${f(slope)}*(t-${f(t0)}))*${gate}`);
    }
  }

  const last = keyframes[keyframes.length - 1];
  // Clamp to the final value for t at or beyond the last keyframe.
  terms.push(`gte(t,${f(last.time)})*${f(last.value)}`);

  return terms.join("+");
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
  const options = [
    `s=${preset.width}x${preset.height}`,
    `r=${preset.fps}`,
    `d=${f(Math.max(0.1, duration))}`,
    `c0=${c0}`,
    `c1=${c1}`,
    "x0=0",
    "y0=0",
    `x1=${preset.width}`,
    `y1=${preset.height}`,
  ];
  return `gradients=${options.join(":")}`;
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
  opacityMaskIndex?: number;
}

function buildDrawText(clip: TimelineClip): string {
  const text = clip.text;
  if (!text) return "null";
  const color = text.color.replace(/^#/, "0x");
  const parts = [
    `text=${escapeDrawtext(text.content)}`,
    `fontcolor=${color}`,
    `fontsize=${f(text.fontSize)}`,
    `line_spacing=${f(text.lineHeight * text.fontSize - text.fontSize)}`,
    "x=(w-text_w)/2",
    "y=(h-text_h)/2",
  ];
  if (text.strokeWidth > 0) {
    parts.push(`borderw=${f(text.strokeWidth)}`);
    parts.push(`bordercolor=${text.strokeColor.replace(/^#/, "0x")}`);
  }
  if (text.shadowBlur > 0) {
    parts.push("shadowx=2", "shadowy=2", "shadowcolor=black@0.5");
  }
  return `drawtext=${parts.join(":")}`;
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

      if (
        entry.videoIndex !== undefined &&
        (clip.transform.opacity.keyframes.length > 0 || hasTransition(clip))
      ) {
        inputs.push(
          "-f",
          "lavfi",
          "-i",
          `color=c=black:s=128x72:r=${f(fps)}:d=${f(Math.max(0.1, clip.duration))}`,
        );
        entry.opacityMaskIndex = nextInput++;
      }

      clipInputs.push(entry);
    }
  }

  const hasSolo = project.tracks.some((track) => track.solo);
  const audibleTrack = (track: TimelineTrack): boolean =>
    !track.muted && (hasSolo ? track.solo : true);

  let videoCursor = "[base]";
  filters.push(`[0:v]setsar=1[base]`);
  let videoCounter = 0;

  for (const entry of clipInputs) {
    if (entry.videoIndex === undefined) continue;
    if (entry.track.hidden) continue;
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
        chain.push(`scale=${escapeFilterGraph(`iw*(${sx})`)}:${escapeFilterGraph(`ih*(${sy})`)}:eval=frame`);
      } else if (clip.transform.scaleX.defaultValue !== 1 || clip.transform.scaleY.defaultValue !== 1) {
        chain.push(`scale=iw*${f(clip.transform.scaleX.defaultValue)}:ih*${f(clip.transform.scaleY.defaultValue)}`);
      }
      const rotation = staticOrExpression(clip.transform.rotation, fps);
      if (clip.transform.rotation.keyframes.length || clip.transform.rotation.defaultValue !== 0) {
        chain.push(
          `rotate=${escapeFilterGraph(`${rotation}*PI/180`)}:c=none:ow=rotw(iw):oh=roth(ih)`,
        );
      }
      // Effects layers.
      for (const effect of clip.effects) {
        if (!effect.enabled) continue;
        chain.push(effectFilter(effect.kind, effect.amount));
      }
    }

    chain.push("format=rgba");
    const opacityCurve = clip.transform.opacity;
    const transitionExpr = transitionExpression(clip);
    const wipeExpr = wipeExpression(clip);
    const animatedOpacity =
      (opacityCurve.keyframes.length > 0 || transitionExpr !== null || wipeExpr !== null) &&
      entry.opacityMaskIndex !== undefined;
    if (!animatedOpacity) {
      // colorchannelmixer only accepts a constant alpha; animated opacity uses
      // a bounded-size luma mask (below) so the per-pixel cost stays constant.
      if (opacityCurve.defaultValue !== 1) {
        chain.push(`colorchannelmixer=aa=${f(opacityCurve.defaultValue)}`);
      }
      chain.push(`setpts=PTS+${f(clip.start)}/TB`);
    }

    const label = `vc${videoCounter++}`;
    const zoomExpr = zoomScaleExpression(clip, `(t-${f(clip.start)})`);
    const staged = zoomExpr ? `${label}raw` : label;
    if (animatedOpacity && entry.opacityMaskIndex !== undefined) {
      const base = piecewiseLinearExpression(opacityCurve, fps);
      const factors = [base, transitionExpr, wipeExpr].filter(
        (part): part is string => Boolean(part),
      );
      const combined = `min(1,max(0,${factors.map((part) => `(${part})`).join("*")}))`;
      const exprT = combined.replace(/\bt\b/g, "T");
      const lum = escapeFilterGraph(`min(1,max(0,(${exprT})))*255`);
      filters.push(`${inputLabel}${chain.join(",")}[${staged}m]`);
      filters.push(
        `[${entry.opacityMaskIndex}:v]format=gray,geq=lum=${lum},scale=${preset.width}:${preset.height}:flags=bilinear,format=gray[${staged}k]`,
      );
      filters.push(
        `[${staged}m][${staged}k]alphamerge,setpts=PTS+${f(clip.start)}/TB[${staged}]`,
      );
    } else {
      filters.push(`${inputLabel}${chain.join(",")}[${staged}]`);
    }
    if (zoomExpr) {
      filters.push(
        `[${staged}]scale=w=${escapeFilterGraph(`iw*(${zoomExpr})`)}:h=${escapeFilterGraph(`ih*(${zoomExpr})`)}:eval=frame[${label}]`,
      );
    }

    const posX = staticOrExpression(clip.transform.positionX, fps);
    const posY = staticOrExpression(clip.transform.positionY, fps);
    const slide = slideExpression(clip);
    const xExpr = `(W*(0.5+(${posX}))-w*${f(clip.transform.anchorX)}${slide.x})`;
    const yExpr = `(H*(0.5+(${posY}))-h*${f(clip.transform.anchorY)}${slide.y})`;
    const enable = `enable=${escapeFilterGraph(`between(t,${f(clip.start)},${f(clipEnd(clip))})`)}`;
    const next = `[v${videoCounter}]`;
    filters.push(
      `${videoCursor}[${label}]overlay=x=${escapeFilterGraph(xExpr)}:y=${escapeFilterGraph(yExpr)}:${enable}:eval=frame:format=auto:shortest=0${next}`,
    );
    videoCursor = next;
  }

  let subtitleCursor = videoCursor;
  const subtitleSize = Math.max(12, Math.round(project.resolution.height * 0.045));
  project.subtitles.forEach((cue, index) => {
    if (!cue.text.trim() || cue.end <= cue.start) return;
    const parts = [
      `text=${escapeDrawtext(cue.text)}`,
      "fontcolor=white",
      `fontsize=${subtitleSize}`,
      "line_spacing=6",
      "box=1",
      "boxcolor=black@0.55",
      "boxborderw=10",
      "x=(w-text_w)/2",
      "y=h-text_h-h*0.06",
      `enable=${escapeFilterGraph(`between(t,${f(cue.start)},${f(cue.end)})`)}`,
    ];
    const next = `[sub${index}]`;
    filters.push(`${subtitleCursor}drawtext=${parts.join(":")}${next}`);
    subtitleCursor = next;
  });

  filters.push(`${subtitleCursor}format=${preset.pixelFormat}[vout]`);

  const audioLabels: string[] = [];
  let audioCounter = 0;
  for (const entry of clipInputs) {
    if (entry.audioIndex === undefined) continue;
    if (!audibleTrack(entry.track)) continue;
    const { clip } = entry;
    const chain: string[] = [];
    chain.push(
      `atrim=start=${f(Math.max(0, clip.inPoint))}:end=${f(clip.inPoint + clip.duration * clip.speed)}`,
    );
    chain.push("asetpts=PTS-STARTPTS");
    const tempo = atempoChain(clip.speed);
    if (tempo) chain.push(tempo);
    if (entry.track.volume !== 0) chain.push(`volume=${f(entry.track.volume)}dB`);
    if (clip.volume.gainDb !== 0) chain.push(`volume=${f(clip.volume.gainDb)}dB`);
    if (clip.volume.keyframes.length) {
      const volumeExpr = piecewiseLinearExpression(
        { property: "volume", defaultValue: clip.volume.gainDb, keyframes: clip.volume.keyframes },
        fps,
      );
      chain.push(`volume=volume=${escapeFilterGraph(`(${volumeExpr})/20`)}:eval=frame`);
    }
    if (clip.volume.fadeIn > 0) {
      chain.push(`afade=t=in:st=0:d=${f(clip.volume.fadeIn)}`);
    }
    if (clip.volume.fadeOut > 0) {
      const start = Math.max(0, clip.duration - clip.volume.fadeOut);
      chain.push(`afade=t=out:st=${f(start)}:d=${f(clip.volume.fadeOut)}`);
    }
    const audioFadeIn = transitionInDuration(clip);
    if (audioFadeIn > 0) {
      chain.push(`afade=t=in:st=0:d=${f(audioFadeIn)}`);
    }
    const audioFadeOut = transitionOutDuration(clip);
    if (audioFadeOut > 0) {
      const start = Math.max(0, clip.duration - audioFadeOut);
      chain.push(`afade=t=out:st=${f(start)}:d=${f(audioFadeOut)}`);
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

/** Edge-transition opacity ramp in terms of clip-local `t`, or null. */
function transitionExpression(clip: TimelineClip): string | null {
  const parts: string[] = [];
  const fadeIn = transitionInDuration(clip);
  if (fadeIn > 0 && isFadeKind(clip.transitionIn?.kind)) {
    parts.push(`min(1,max(0,t/${f(fadeIn)}))`);
  }
  const fadeOut = transitionOutDuration(clip);
  if (fadeOut > 0 && isFadeKind(clip.transitionOut?.kind)) {
    parts.push(`min(1,max(0,(${f(clip.duration)}-t)/${f(fadeOut)}))`);
  }
  return parts.length > 0 ? parts.join("*") : null;
}

/** Spatial wipe mask in clip-local `t`, evaluated on the 128x72 mask proxy. */
function wipeExpression(clip: TimelineClip): string | null {
  const feather = 0.04;
  const coordinate = (direction: "left" | "right" | "up" | "down"): string => {
    switch (direction) {
      case "right":
        return "(1-X/W)";
      case "up":
        return "(Y/H)";
      case "down":
        return "(1-Y/H)";
      case "left":
      default:
        return "(X/W)";
    }
  };
  const parts: string[] = [];
  const inDuration = transitionInDuration(clip);
  if (clip.transitionIn?.kind === "wipe" && inDuration > 0) {
    const progress = `min(1,max(0,t/${f(inDuration)}))`;
    parts.push(
      `min(1,max(0,((${progress})-${coordinate(clip.transitionIn.direction)})/${feather}))`,
    );
  }
  const outDuration = transitionOutDuration(clip);
  if (clip.transitionOut?.kind === "wipe" && outDuration > 0) {
    const progress = `min(1,max(0,(t-${f(clip.duration - outDuration)})/${f(outDuration)}))`;
    parts.push(
      `min(1,max(0,((1-(${progress}))-${coordinate(clip.transitionOut.direction)})/${feather}))`,
    );
  }
  return parts.length > 0 ? parts.join("*") : null;
}

/** Overlay offsets (fractions of the main frame) for slide transitions. */
function slideExpression(clip: TimelineClip): { x: string; y: string } {
  const x: string[] = [];
  const y: string[] = [];
  const append = (direction: "left" | "right" | "up" | "down", offscreen: string): void => {
    const magnitude = `(${offscreen})`;
    switch (direction) {
      case "left":
        x.push(`-W*${magnitude}`);
        break;
      case "right":
        x.push(`W*${magnitude}`);
        break;
      case "up":
        y.push(`-H*${magnitude}`);
        break;
      case "down":
        y.push(`H*${magnitude}`);
        break;
    }
  };
  const inDuration = transitionInDuration(clip);
  if (clip.transitionIn?.kind === "slide" && inDuration > 0) {
    append(
      clip.transitionIn.direction,
      `min(1,max(0,1-(t-${f(clip.start)})/${f(inDuration)}))`,
    );
  }
  const outDuration = transitionOutDuration(clip);
  if (clip.transitionOut?.kind === "slide" && outDuration > 0) {
    append(
      clip.transitionOut.direction,
      `min(1,max(0,(t-${f(clip.start + clip.duration - outDuration)})/${f(outDuration)}))`,
    );
  }
  return {
    x: x.map((part) => `+${part}`).join(""),
    y: y.map((part) => `+${part}`).join(""),
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
    case "chroma-key": {
      const similarity = Math.min(1, 0.2 + Math.max(0, amount) * 0.1);
      const blend = Math.min(1, 0.1 + Math.max(0, amount) * 0.05);
      return `colorkey=green:${f(similarity)}:${f(blend)}`;
    }
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
