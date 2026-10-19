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
import { clipEnd, formatTimecode, secondsToFrames } from "../../core/timeline/engine";
import { NeumorphicButton } from "../neumorphic";
import type { TimelineClip, TimelineTrack } from "../../types/timeline";

const BRAND_STOPS = ["#FFB300", "#FF5100", "#E60067"];

interface AudioGraph {
  context: AudioContext;
  analyser: AnalyserNode;
  gain: GainNode;
  data: Uint8Array<ArrayBuffer>;
}

export function PreviewPlayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioGraph | null>(null);
  const playingRef = useRef(false);

  const playing = useEditorSelector((state) => state.playing);
  const loop = useEditorSelector((state) => state.loop);

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

  useEffect(() => {
    playingRef.current = playing;
    const graph = audioRef.current;
    if (!graph) return;
    if (playing) {
      void graph.context.resume();
      graph.gain.gain.setTargetAtTime(0.14, graph.context.currentTime, 0.05);
    } else {
      graph.gain.gain.setTargetAtTime(0, graph.context.currentTime, 0.1);
    }
  }, [playing]);

  const ensureAudio = useCallback((): AudioGraph | null => {
    if (audioRef.current) return audioRef.current;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      const context = new Ctor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      const data = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      const gain = context.createGain();
      gain.gain.value = 0;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1800;
      const oscA = context.createOscillator();
      oscA.frequency.value = 110;
      const oscB = context.createOscillator();
      oscB.type = "triangle";
      oscB.frequency.value = 220;
      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(analyser);
      analyser.connect(gain);
      gain.connect(context.destination);
      oscA.start();
      oscB.start();
      const graph: AudioGraph = { context, analyser, gain, data };
      audioRef.current = graph;
      return graph;
    } catch {
      return null;
    }
  }, []);

  const stepFrame = useCallback((direction: number) => {
    const state = editorStore.getState();
    const frame = 1 / state.project.frameRate;
    editorStore.setPlaying(false);
    editorStore.setPlayhead(state.playhead + frame * direction);
  }, []);

  const handlePlayToggle = useCallback(() => {
    if (!editorStore.getState().playing) ensureAudio();
    editorStore.togglePlay();
  }, [ensureAudio]);

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

  function paint(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const state = editorStore.getState();
    const { project, playhead } = state;
    const aspect = project.resolution.width / project.resolution.height;
    let frameW = width;
    let frameH = width / aspect;
    if (frameH > height - 6) {
      frameH = height - 6;
      frameW = frameH * aspect;
    }
    const offsetX = (width - frameW) / 2;
    const offsetY = (height - frameH) / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0B0C10";
    ctx.fillRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(offsetX, offsetY, offsetX, offsetY + frameH);
    gradient.addColorStop(0, "#101118");
    gradient.addColorStop(1, "#0a0b0f");
    ctx.fillStyle = gradient;
    ctx.fillRect(offsetX, offsetY, frameW, frameH);

    const visualTracks = project.tracks.filter((track) => track.type !== "audio");
    for (const track of visualTracks) {
      if (track.hidden) continue;
      const clip = track.clips.find(
        (candidate) => playhead >= candidate.start && playhead < clipEnd(candidate),
      );
      if (!clip) continue;
      drawClip(ctx, clip, track, playhead, offsetX, offsetY, frameW, frameH);
    }

    // Safe frame guides.
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX, offsetY, frameW, frameH);
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = "rgba(255,179,0,0.16)";
    ctx.strokeRect(offsetX + frameW * 0.05, offsetY + frameH * 0.05, frameW * 0.9, frameH * 0.9);
    ctx.setLineDash([]);

    drawAudioScope(ctx, width, height - 34, 30);
  }

  function drawAudioScope(ctx: CanvasRenderingContext2D, width: number, y: number, height: number): void {
    const graph = audioRef.current;
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

function drawClip(
  ctx: CanvasRenderingContext2D,
  clip: TimelineClip,
  track: TimelineTrack,
  playhead: number,
  offsetX: number,
  offsetY: number,
  frameW: number,
  frameH: number,
): void {
  const local = playhead - clip.start;
  const opacity = evaluateCurve(clip.transform.opacity, local);
  const scaleX = evaluateCurve(clip.transform.scaleX, local);
  const scaleY = evaluateCurve(clip.transform.scaleY, local);
  const rotation = evaluateCurve(clip.transform.rotation, local);
  const posX = evaluateCurve(clip.transform.positionX, local);
  const posY = evaluateCurve(clip.transform.positionY, local);
  if (opacity <= 0.001) return;

  const centerX = offsetX + frameW * (0.5 + posX);
  const centerY = offsetY + frameH * (0.5 + posY);

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity * (track.type === "overlay" ? 0.95 : 1)));
  ctx.translate(centerX, centerY);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(scaleX, scaleY);

  if (clip.kind === "text" && clip.text) {
    ctx.fillStyle = clip.text.color;
    ctx.font = `${clip.text.fontWeight} ${clip.text.fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = clip.text.align;
    ctx.textBaseline = "middle";
    ctx.shadowColor = clip.text.shadowColor;
    ctx.shadowBlur = clip.text.shadowBlur;
    ctx.fillText(clip.text.content, 0, 0);
    ctx.restore();
    return;
  }

  const w = frameW * 0.6;
  const h = frameH * 0.6;
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
