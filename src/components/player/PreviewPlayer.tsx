import { useCallback, useEffect, useRef } from "react";
import {
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
} from "lucide-react";
import { editorStore, useEditorSelector } from "../../state/editorStore";
import { evaluateCurve } from "../../core/keyframes/bezier";
import { dbToGain, evaluateEnvelope } from "../../core/audio/waveform";
import {
  applyChromaKey,
  applySharpen,
  canvasEffectPlan,
  chromaKeyScratch,
  chromaKeyStrength,
  drawVignette,
  effectAmount,
} from "../../core/effects/canvas";
import { clipEnd, formatTimecode, secondsToFrames } from "../../core/timeline/engine";
import {
  slideOffset,
  transitionOpacityFactor,
  wipeRect,
  zoomFactor,
} from "../../core/timeline/transitions";
import { applyLutToRgba, cachedCube, lutPath, parseCube, rememberCube } from "../../core/effects/lut";
import { subtitleBaseline, subtitleFontSize } from "../../core/subtitles/style";
import { convertMediaUrl, invokeSafe, isTauri } from "../../lib/tauri";
import { NeumorphicButton } from "../neumorphic";
import type { BlendMode, MediaSource, SubtitleCue, TimelineClip, TimelineTrack } from "../../types/timeline";

const BRAND_STOPS = ["#FFB300", "#FF5100", "#E60067"];

type MediaElement = HTMLVideoElement | HTMLImageElement | HTMLAudioElement;

interface MediaEntry {
  source: MediaSource;
  url: string;
  element?: MediaElement;
  connected: boolean;
  lastSeek: number;
}

interface AudioGraph {
  context: AudioContext;
  analyser: AnalyserNode;
  master: GainNode;
  data: Uint8Array<ArrayBuffer>;
}

interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isPlayable(element: MediaElement | undefined): element is HTMLVideoElement | HTMLAudioElement {
  return element instanceof HTMLVideoElement || element instanceof HTMLAudioElement;
}

function frameWidth(element: MediaElement): number {
  if (element instanceof HTMLVideoElement) return element.videoWidth;
  if (element instanceof HTMLImageElement) return element.naturalWidth;
  return 0;
}

function frameHeight(element: MediaElement): number {
  if (element instanceof HTMLVideoElement) return element.videoHeight;
  if (element instanceof HTMLImageElement) return element.naturalHeight;
  return 0;
}

function isReady(element: MediaElement): boolean {
  if (element instanceof HTMLVideoElement) return element.readyState >= 2 && element.videoWidth > 0;
  if (element instanceof HTMLImageElement) return element.complete && element.naturalWidth > 0;
  return false;
}

function releaseEntry(entry: MediaEntry): void {
  if (isPlayable(entry.element)) {
    entry.element.pause();
    entry.element.removeAttribute("src");
    entry.element.load();
  }
}

function pauseEntry(entry: MediaEntry): void {
  if (isPlayable(entry.element) && !entry.element.paused) entry.element.pause();
}

function activeClip(track: TimelineTrack, playhead: number): TimelineClip | null {
  return (
    track.clips.find((clip) => playhead >= clip.start && playhead < clipEnd(clip)) ?? null
  );
}

function renderRect(width: number, height: number, aspect: number): FrameRect {
  let w = width;
  let h = width / aspect;
  if (h > height - 6) {
    h = height - 6;
    w = h * aspect;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

const CANVAS_BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-dodge": "color-dodge",
  "color-burn": "color-burn",
  "hard-light": "hard-light",
  "soft-light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  add: "lighter",
};

function compositeFor(mode: BlendMode | undefined): GlobalCompositeOperation {
  return mode ? CANVAS_BLEND[mode] ?? "source-over" : "source-over";
}

function drawTextClip(
  ctx: CanvasRenderingContext2D,
  clip: TimelineClip,
  track: TimelineTrack,
  playhead: number,
  rect: FrameRect,
  projectWidth: number,
): void {
  const text = clip.text;
  if (!text) return;
  const local = playhead - clip.start;
  const opacity = evaluateCurve(clip.transform.opacity, local) * transitionOpacityFactor(clip, local);
  if (opacity <= 0.001) return;
  const scaleX = evaluateCurve(clip.transform.scaleX, local);
  const scaleY = evaluateCurve(clip.transform.scaleY, local);
  const rotation = evaluateCurve(clip.transform.rotation, local);
  const posX = evaluateCurve(clip.transform.positionX, local);
  const posY = evaluateCurve(clip.transform.positionY, local);
  const size = rect.w / Math.max(1, projectWidth);

  ctx.save();
  ctx.globalAlpha = clamp01(opacity);
  ctx.globalCompositeOperation = compositeFor(clip.transform.blendMode);
  ctx.translate(rect.x + rect.w * (0.5 + posX), rect.y + rect.h * (0.5 + posY));
  ctx.rotate((rotation * Math.PI) / 180);
  const zoom = zoomFactor(clip, local);
  ctx.scale(scaleX * zoom, scaleY * zoom);
  ctx.fillStyle = text.color;
  ctx.font = `${text.fontWeight} ${text.fontSize * size}px ${text.fontFamily}`;
  ctx.textAlign = text.align;
  ctx.textBaseline = "middle";
  ctx.shadowColor = text.shadowColor;
  ctx.shadowBlur = text.shadowBlur * size;
  const lines = text.content.split("\n");
  const lineHeight = text.fontSize * text.lineHeight * size;
  lines.forEach((line, index) => {
    const y = (index - (lines.length - 1) / 2) * lineHeight;
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
  void track;
}

const pendingCubes = new Set<string>();

function drawMediaClip(
  ctx: CanvasRenderingContext2D,
  element: HTMLVideoElement | HTMLImageElement,
  clip: TimelineClip,
  track: TimelineTrack,
  playhead: number,
  rect: FrameRect,
): boolean {
  const sourceW = frameWidth(element);
  const sourceH = frameHeight(element);
  if (sourceW <= 0 || sourceH <= 0) return false;
  const local = playhead - clip.start;
  const opacity = evaluateCurve(clip.transform.opacity, local) * transitionOpacityFactor(clip, local);
  if (opacity <= 0.001) return true;
  const scaleX = evaluateCurve(clip.transform.scaleX, local);
  const scaleY = evaluateCurve(clip.transform.scaleY, local);
  const rotation = evaluateCurve(clip.transform.rotation, local);
  const posX = evaluateCurve(clip.transform.positionX, local);
  const posY = evaluateCurve(clip.transform.positionY, local);
  const fit = Math.min(rect.w / sourceW, rect.h / sourceH);
  const zoom = zoomFactor(clip, local);
  const drawW = sourceW * fit * scaleX * zoom;
  const drawH = sourceH * fit * scaleY * zoom;
  const fx = canvasEffectPlan(clip.effects);
  const key = chromaKeyStrength(clip.effects);
  const sharpen = effectAmount(clip.effects, "sharpen");
  const lutFile = lutPath(clip.effects);
  const lut = lutFile ? cachedCube(lutFile) ?? null : null;
  const wipe = wipeRect(clip, local, rect);
  const slide = slideOffset(clip, local, rect);

  ctx.save();
  if (wipe === null) {
    ctx.restore();
    return true;
  }
  if (wipe) {
    ctx.beginPath();
    ctx.rect(wipe.x, wipe.y, wipe.w, wipe.h);
    ctx.clip();
  }
  ctx.globalAlpha = clamp01(opacity);
  ctx.globalCompositeOperation = compositeFor(clip.transform.blendMode);
  ctx.translate(
    rect.x + rect.w * (0.5 + posX) + slide.dx,
    rect.y + rect.h * (0.5 + posY) + slide.dy,
  );
  ctx.rotate((rotation * Math.PI) / 180);

  const scratch =
    key > 0 || sharpen > 0 || lut
      ? chromaKeyScratch(Math.abs(drawW), Math.abs(drawH))
      : null;
  if (scratch) {
    const { ctx: keyCtx, width: keyWidth, height: keyHeight } = scratch;
    keyCtx.setTransform(1, 0, 0, 1, 0, 0);
    keyCtx.globalAlpha = 1;
    keyCtx.clearRect(0, 0, keyWidth, keyHeight);
    keyCtx.filter = fx.filter;
    keyCtx.drawImage(element, 0, 0, keyWidth, keyHeight);
    keyCtx.filter = "none";
    if (key > 0) applyChromaKey(keyCtx, keyWidth, keyHeight, key);
    if (lut) {
      const frame = keyCtx.getImageData(0, 0, keyWidth, keyHeight);
      applyLutToRgba(frame.data, keyWidth, keyHeight, lut);
      keyCtx.putImageData(frame, 0, 0);
    }
    if (sharpen > 0) applySharpen(keyCtx, keyWidth, keyHeight, sharpen);
    ctx.filter = "none";
    ctx.drawImage(
      scratch.canvas,
      -drawW * clip.transform.anchorX,
      -drawH * clip.transform.anchorY,
      drawW,
      drawH,
    );
  } else {
    ctx.filter = fx.filter;
    ctx.drawImage(
      element,
      -drawW * clip.transform.anchorX,
      -drawH * clip.transform.anchorY,
      drawW,
      drawH,
    );
  }
  ctx.restore();
  if (fx.vignette > 0) {
    ctx.save();
    ctx.globalAlpha = clamp01(opacity);
    drawVignette(ctx, rect.x, rect.y, rect.w, rect.h, fx.vignette);
    ctx.restore();
  }
  void track;
  return true;
}

function drawSubtitles(
  ctx: CanvasRenderingContext2D,
  cues: SubtitleCue[],
  playhead: number,
  rect: FrameRect,
): void {
  const cue = cues.find((entry) => playhead >= entry.start && playhead < entry.end);
  if (!cue || !cue.text.trim()) return;
  const fontSize = subtitleFontSize(rect.h, cue);
  const lines = cue.text.split("\n");
  const lineHeight = fontSize * 1.25;
  const padding = fontSize * 0.4;
  ctx.save();
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const height = lines.length * lineHeight;
  const cx = rect.x + rect.w / 2;
  const bottom = rect.y + rect.h * subtitleBaseline(cue);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(
    cx - width / 2 - padding,
    bottom - height - padding * 0.6,
    width + padding * 2,
    height + padding * 1.2,
  );
  ctx.fillStyle = cue.color ?? "#FFFFFF";
  lines.forEach((line, index) => {
    ctx.fillText(line, cx, bottom - (lines.length - 1 - index) * lineHeight);
  });
  ctx.restore();
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  clip: TimelineClip,
  track: TimelineTrack,
  playhead: number,
  rect: FrameRect,
): void {
  const local = playhead - clip.start;
  const opacity = evaluateCurve(clip.transform.opacity, local) * transitionOpacityFactor(clip, local);
  if (opacity <= 0.001) return;
  const scaleX = evaluateCurve(clip.transform.scaleX, local);
  const scaleY = evaluateCurve(clip.transform.scaleY, local);
  const rotation = evaluateCurve(clip.transform.rotation, local);
  const posX = evaluateCurve(clip.transform.positionX, local);
  const posY = evaluateCurve(clip.transform.positionY, local);
  const w = rect.w * 0.6;
  const h = rect.h * 0.6;
  const fx = canvasEffectPlan(clip.effects);

  ctx.save();
  ctx.globalAlpha = clamp01(opacity);
  ctx.globalCompositeOperation = compositeFor(clip.transform.blendMode);
  ctx.translate(rect.x + rect.w * (0.5 + posX), rect.y + rect.h * (0.5 + posY));
  ctx.rotate((rotation * Math.PI) / 180);
  const zoom = zoomFactor(clip, local);
  ctx.scale(scaleX * zoom, scaleY * zoom);
  ctx.filter = fx.filter;
  const gradient = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  if (clip.kind === "generator") {
    gradient.addColorStop(0, BRAND_STOPS[0]);
    gradient.addColorStop(0.5, BRAND_STOPS[1]);
    gradient.addColorStop(1, BRAND_STOPS[2]);
  } else {
    gradient.addColorStop(0, clip.color);
    gradient.addColorStop(1, "rgba(18,19,24,0.9)");
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "600 12px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(clip.name, 0, 0);
  ctx.restore();
  if (fx.vignette > 0) {
    ctx.save();
    ctx.globalAlpha = clamp01(opacity);
    drawVignette(ctx, rect.x, rect.y, rect.w, rect.h, fx.vignette);
    ctx.restore();
  }
  void track;
}

function syncPlayable(
  element: HTMLVideoElement | HTMLAudioElement,
  clip: TimelineClip,
  track: TimelineTrack,
  playhead: number,
  playing: boolean,
  audible: boolean,
  entry: MediaEntry,
  now: number,
): void {
  const local = playhead - clip.start;
  const rate = clip.speed > 0 ? clip.speed : 1;
  const sourceDuration =
    Number.isFinite(element.duration) && element.duration > 0
      ? element.duration
      : Number.POSITIVE_INFINITY;
  const limit = Math.max(0, sourceDuration - 0.02);
  const reversed = clip.reversed;
  const target = reversed
    ? Math.min(Math.max(0, clip.inPoint + (clip.duration - local) * rate), limit)
    : Math.min(Math.max(0, clip.inPoint + local * rate), limit);

  element.playbackRate = rate;
  if (reversed) {
    // Browsers cannot decode audio backwards, so a reversed clip previews as a
    // muted frame scrub: the element stays paused and seeks each painted frame.
    if (!element.paused) element.pause();
    if (Math.abs(element.currentTime - target) > 0.02 && now - entry.lastSeek > 55) {
      element.currentTime = target;
      entry.lastSeek = now;
    }
  } else if (playing) {
    if (element.paused) {
      if (now - entry.lastSeek > 300) {
        element.currentTime = target;
        void element.play().catch(() => undefined);
        entry.lastSeek = now;
      }
    } else if (Math.abs(element.currentTime - target) > 0.35 && now - entry.lastSeek > 400) {
      element.currentTime = target;
      entry.lastSeek = now;
    }
  } else {
    if (!element.paused) element.pause();
    if (Math.abs(element.currentTime - target) > 0.05 && now - entry.lastSeek > 90) {
      element.currentTime = target;
      entry.lastSeek = now;
    }
  }

  const gain = audible && !reversed
    ? evaluateEnvelope(clip.volume, local, clip.duration) *
      transitionOpacityFactor(clip, local) *
      dbToGain(track.volume)
    : 0;
  element.volume = clamp01(gain);
  element.muted = !audible;
  void track;
}

export function PreviewPlayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<Map<string, MediaEntry>>(new Map());
  const graphRef = useRef<AudioGraph | null>(null);

  const playing = useEditorSelector((state) => state.playing);
  const loop = useEditorSelector((state) => state.loop);
  const media = useEditorSelector((state) => state.project.media);
  const tracks = useEditorSelector((state) => state.project.tracks);

  useEffect(() => {
    if (!isTauri()) return;
    const wanted = new Set<string>();
    for (const track of tracks) {
      for (const clip of track.clips) {
        const path = lutPath(clip.effects);
        if (path) wanted.add(path);
      }
    }
    for (const path of wanted) {
      if (cachedCube(path) !== undefined || pendingCubes.has(path)) continue;
      pendingCubes.add(path);
      void invokeSafe<string>("load_project", { path })
        .then((text) => rememberCube(path, text ? parseCube(text) : null))
        .catch(() => rememberCube(path, null))
        .finally(() => pendingCubes.delete(path));
    }
  }, [tracks]);

  useEffect(() => {
    let cancelled = false;

    const createEntry = async (source: MediaSource): Promise<MediaEntry | null> => {
      const url = await convertMediaUrl(source.path);
      if (!url) return null;
      const entry: MediaEntry = { source, url, connected: false, lastSeek: 0 };
      if (source.kind === "image") {
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        entry.element = image;
      } else if (source.hasVideo) {
        const video = document.createElement("video");
        video.preload = "auto";
        video.playsInline = true;
        video.src = url;
        video.load();
        entry.element = video;
      } else if (source.hasAudio) {
        const audio = document.createElement("audio");
        audio.preload = "auto";
        audio.src = url;
        audio.load();
        entry.element = audio;
      } else {
        return null;
      }
      return entry;
    };

    void (async () => {
      const entries = new Map<string, MediaEntry>();
      for (const source of media) {
        if (source.kind === "generator" || source.kind === "text") continue;
        if (source.path.startsWith("generator://")) continue;
        const entry = await createEntry(source);
        if (cancelled) {
          if (entry) releaseEntry(entry);
          return;
        }
        if (entry) entries.set(source.id, entry);
      }
      if (cancelled) return;
      for (const old of poolRef.current.values()) releaseEntry(old);
      poolRef.current = entries;
    })();

    return () => {
      cancelled = true;
    };
  }, [media]);

  useEffect(() => {
    return () => {
      for (const entry of poolRef.current.values()) releaseEntry(entry);
      poolRef.current.clear();
      const graph = graphRef.current;
      graphRef.current = null;
      void graph?.context.close();
    };
  }, []);

  const ensureGraph = useCallback((): AudioGraph | null => {
    const existing = graphRef.current;
    if (existing) {
      void existing.context.resume();
      return existing;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      const context = new Ctor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      const master = context.createGain();
      master.gain.value = 1;
      analyser.connect(master);
      master.connect(context.destination);
      const data = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      const graph: AudioGraph = { context, analyser, master, data };
      graphRef.current = graph;
      void context.resume();
      return graph;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let raf = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (ctx) paint(ctx, width, height);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const stepFrame = useCallback((direction: number) => {
    const state = editorStore.getState();
    const frame = 1 / state.project.frameRate;
    editorStore.setPlaying(false);
    editorStore.setPlayhead(state.playhead + frame * direction);
  }, []);

  const handlePlayToggle = useCallback(() => {
    if (!editorStore.getState().playing) {
      const graph = ensureGraph();
      if (graph) attachGraph(graph);
    }
    editorStore.togglePlay();
  }, [ensureGraph]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.03] bg-surface shadow-raised">
      <div className="flex items-center justify-between border-b border-black/40 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Program Monitor
        </span>
        <Timecode />
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1 bg-canvas">
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
      <div className="flex items-center justify-center gap-1.5 border-t border-black/40 px-3 py-2.5">
        <NeumorphicButton size="sm" iconOnly title="Back 1s" onClick={() => editorStore.setPlayhead(editorStore.getState().playhead - 1)} icon={<SkipBack size={15} />} />
        <NeumorphicButton size="sm" iconOnly title="Previous frame (J)" onClick={() => stepFrame(-1)} icon={<StepBack size={15} />} />
        <NeumorphicButton
          size="md"
          iconOnly
          variant="primary"
          title="Play / Pause (Space)"
          onClick={handlePlayToggle}
          icon={playing ? <Pause size={18} /> : <Play size={18} />}
        />
        <NeumorphicButton size="sm" iconOnly title="Next frame (L)" onClick={() => stepFrame(1)} icon={<StepForward size={15} />} />
        <NeumorphicButton size="sm" iconOnly title="Forward 1s" onClick={() => editorStore.setPlayhead(editorStore.getState().playhead + 1)} icon={<SkipForward size={15} />} />
        <NeumorphicButton
          size="sm"
          iconOnly
          title="Loop"
          active={loop}
          onClick={() => editorStore.toggleLoop()}
          icon={<Repeat size={15} />}
        />
      </div>
    </section>
  );

  function attachGraph(graph: AudioGraph): void {
    for (const entry of poolRef.current.values()) {
      const element = entry.element;
      if (!isPlayable(element) || entry.connected) continue;
      entry.connected = true;
      try {
        const source = graph.context.createMediaElementSource(element);
        source.connect(graph.analyser);
      } catch {
        // Leave the element on its native output path.
      }
    }
  }

  function paint(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const state = editorStore.getState();
    const project = state.project;
    const playhead = state.playhead;
    const rect = renderRect(width, height, project.resolution.width / project.resolution.height);
    const now = performance.now();
    const used = new Set<string>();

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0B0C10";
    ctx.fillRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
    gradient.addColorStop(0, "#101118");
    gradient.addColorStop(1, "#0a0b0f");
    ctx.fillStyle = gradient;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    const hasSolo = project.tracks.some((track) => track.solo);
    const visualTracks = project.tracks.filter((track) => track.type !== "audio");
    for (const track of visualTracks) {
      if (track.hidden) continue;
      const clip = activeClip(track, playhead);
      if (!clip) continue;
      if (clip.kind === "text") {
        drawTextClip(ctx, clip, track, playhead, rect, project.resolution.width);
        continue;
      }
      const entry = poolRef.current.get(clip.sourceId);
      const element = entry?.element;
      const visual =
        element instanceof HTMLVideoElement || element instanceof HTMLImageElement
          ? element
          : undefined;
      if (entry && visual && isReady(visual) && drawMediaClip(ctx, visual, clip, track, playhead, rect)) {
        used.add(entry.source.id);
        if (isPlayable(element)) {
          if (graphRef.current) attachGraph(graphRef.current);
          const audible = !track.muted && (hasSolo ? track.solo : true) && entry.source.hasAudio;
          syncPlayable(element, clip, track, playhead, state.playing, audible, entry, now);
        }
      } else {
        drawPlaceholder(ctx, clip, track, playhead, rect);
      }
    }

    for (const track of project.tracks) {
      if (track.type !== "audio") continue;
      const clip = activeClip(track, playhead);
      if (!clip) continue;
      const entry = poolRef.current.get(clip.sourceId);
      const element = entry?.element;
      if (!entry || !isPlayable(element)) continue;
      used.add(entry.source.id);
      if (graphRef.current) attachGraph(graphRef.current);
      const audible = !track.hidden && !track.muted && (hasSolo ? track.solo : true);
      syncPlayable(element, clip, track, playhead, state.playing, audible, entry, now);
    }

    drawSubtitles(ctx, project.subtitles, playhead, rect);

    for (const [id, entry] of poolRef.current) {
      if (!used.has(id)) pauseEntry(entry);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = "rgba(255,179,0,0.16)";
    ctx.strokeRect(rect.x + rect.w * 0.05, rect.y + rect.h * 0.05, rect.w * 0.9, rect.h * 0.9);
    ctx.setLineDash([]);

    drawAudioScope(ctx, width, height - 34, 30);
  }

  function drawAudioScope(ctx: CanvasRenderingContext2D, width: number, y: number, height: number): void {
    const graph = graphRef.current;
    ctx.fillStyle = "rgba(22,23,31,0.85)";
    ctx.fillRect(0, y, width, height);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.moveTo(0, y + height / 2 + 0.5);
    ctx.lineTo(width, y + height / 2 + 0.5);
    ctx.stroke();
    if (!graph) return;
    graph.analyser.getByteTimeDomainData(graph.data);
    const gradient = ctx.createLinearGradient(0, y, width, y);
    gradient.addColorStop(0, BRAND_STOPS[0]);
    gradient.addColorStop(0.5, BRAND_STOPS[1]);
    gradient.addColorStop(1, BRAND_STOPS[2]);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const slice = width / graph.data.length;
    for (let i = 0; i < graph.data.length; i += 1) {
      const value = (graph.data[i] - 128) / 128;
      const x = i * slice;
      const py = y + height / 2 + value * (height / 2.4);
      if (i === 0) ctx.moveTo(x, py);
      else ctx.lineTo(x, py);
    }
    ctx.stroke();
  }
}

function Timecode() {
  const playhead = useEditorSelector((state) => state.playhead);
  const frameRate = useEditorSelector((state) => state.project.frameRate);
  return (
    <div className="flex items-center gap-2 font-mono text-xs text-muted">
      <span className="text-amber">{formatTimecode(playhead, frameRate)}</span>
      <span>{secondsToFrames(playhead, frameRate)}f</span>
    </div>
  );
}
