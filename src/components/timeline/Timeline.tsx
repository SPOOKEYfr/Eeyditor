import { useCallback, useEffect, useRef, useState } from "react";
import {
  Magnet,
  MousePointer2,
  Plus,
  Redo2,
  Scissors,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { EeyditorProject, TimelineClip, TimelineTrack } from "../../types/timeline";
import {
  editorStore,
  useEditorSelector,
} from "../../state/editorStore";
import {
  clipsInTimeRange,
  collectSnapTargets,
  formatTimecode,
  SNAP_THRESHOLD_PX,
  snapTime,
  timeToX,
  xToTime,
} from "../../core/timeline/engine";
import { syntheticChannel } from "../../core/audio/waveform";
import { audioWaveform } from "../../lib/tauri";
import { NeumorphicButton } from "../neumorphic";
import { TrackHeader } from "./TrackHeader";
import { KeyframeTrack } from "./KeyframeTrack";

const RULER_HEIGHT = 30;
const LANE_GAP = 5;
const EDGE_HANDLE = 8;
const HEADER_WIDTH = 176;

const waveformCache = new Map<string, Float32Array>();
const realWaveforms = new Map<string, Float32Array>();
const pendingWaveforms = new Set<string>();

const WAVEFORM_COLUMNS = 1024;

function waveformFor(clip: TimelineClip): Float32Array {
  const real = realWaveforms.get(clip.sourceId);
  if (real) return real;
  const cached = waveformCache.get(clip.id);
  if (cached) return cached;
  const channel = syntheticChannel(256, clip.name.length + 3, clip.volume);
  waveformCache.set(clip.id, channel);
  return channel;
}

interface Lane {
  track: TimelineTrack;
  y: number;
  height: number;
}

function computeLanes(tracks: TimelineTrack[], scrollY: number): Lane[] {
  let cursor = RULER_HEIGHT + LANE_GAP - scrollY;
  return tracks.map((track) => {
    const lane: Lane = { track, y: cursor, height: track.height };
    cursor += track.height + LANE_GAP;
    return lane;
  });
}

function totalTracksHeight(tracks: TimelineTrack[]): number {
  return tracks.reduce((sum, track) => sum + track.height + LANE_GAP, LANE_GAP);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, height / 2, width / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const bigint = parseInt(value.length === 3 ? value.replace(/(.)/g, "$1$1") : value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function chooseTickStep(zoom: number): number {
  const steps = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((step) => step * zoom >= 84) ?? 900;
}

export function Timeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollYRef = useRef(0);
  const [scrollY, setScrollY] = useState(0);
  const dragRef = useRef<DragState | null>(null);
  const snapLineRef = useRef<number | null>(null);

  const tracks = useEditorSelector((state) => state.project.tracks);
  const selectedTrackId = useEditorSelector((state) => state.selectedTrackId);
  const media = useEditorSelector((state) => state.project.media);
  const visualTick = useEditorSelector((state) => state.project.metadata.modifiedAt);

  useEffect(() => {
    let cancelled = false;
    for (const source of media) {
      if (!source.hasAudio || source.path.startsWith("generator://")) continue;
      if (realWaveforms.has(source.id) || pendingWaveforms.has(source.id)) continue;
      pendingWaveforms.add(source.id);
      void audioWaveform(source.path, WAVEFORM_COLUMNS)
        .then((channel) => {
          if (!cancelled && channel) realWaveforms.set(source.id, channel);
        })
        .finally(() => pendingWaveforms.delete(source.id));
    }
    return () => {
      cancelled = true;
    };
  }, [media]);

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
      if (ctx) renderTimeline(ctx, width, height, scrollYRef.current, snapLineRef.current, dragRef.current);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = editorStore.getState();
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      if (event.ctrlKey || event.metaKey) {
        editorStore.zoomBy(Math.exp(-event.deltaY * 0.0025), mouseX);
        return;
      }
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        editorStore.setScroll(state.scroll + (event.deltaX || event.deltaY));
        return;
      }
      const maxScroll = Math.max(0, totalTracksHeight(state.project.tracks) - (height - RULER_HEIGHT));
      const next = Math.max(0, Math.min(scrollYRef.current + event.deltaY, maxScroll));
      scrollYRef.current = next;
      setScrollY(next);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  const pointerToTime = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const state = editorStore.getState();
    return xToTime(clientX - rect.left, state.zoom, state.scroll);
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const state = editorStore.getState();
      canvas.setPointerCapture(event.pointerId);

      if (y < RULER_HEIGHT) {
        dragRef.current = { mode: "playhead" };
        const time = pointerToTime(event.clientX);
        const hit = state.project.markers.find(
          (marker) => Math.abs(timeToX(marker.time, state.zoom, state.scroll) - x) < 6,
        );
        editorStore.setPlayhead(hit ? hit.time : time);
        return;
      }

      const lanes = computeLanes(state.project.tracks, scrollYRef.current);
      const lane = lanes.find((entry) => y >= entry.y && y <= entry.y + entry.height);
      if (!lane) {
        editorStore.selectClip(null);
        return;
      }
      const time = pointerToTime(event.clientX);
      const clip = lane.track.clips.find(
        (candidate) => time >= candidate.start && time < candidate.start + candidate.duration,
      );
      if (!clip) {
        if (state.tool === "blade") return;
        dragRef.current = {
          mode: "marquee",
          x0: x,
          y0: y,
          x1: x,
          y1: y,
          additive: event.shiftKey || event.metaKey || event.ctrlKey,
        };
        if (!dragRef.current.additive) editorStore.setClipSelection([]);
        return;
      }

      const startX = timeToX(clip.start, state.zoom, state.scroll);
      const endX = timeToX(clip.start + clip.duration, state.zoom, state.scroll);

      if (state.tool === "blade") {
        editorStore.splitClipAt(clip.id, time);
        return;
      }

      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      if (additive) {
        editorStore.toggleClipSelection(clip.id);
      } else if (!editorStore.getState().selectedClipIds.includes(clip.id)) {
        editorStore.selectClip(clip.id);
      }
      if (clip.locked || lane.track.locked) {
        editorStore.setStatus("Clip is locked");
        return;
      }
      editorStore.beginInteraction();
      if (x - startX <= EDGE_HANDLE) {
        dragRef.current = { mode: "trim-start", clipId: clip.id };
      } else if (endX - x <= EDGE_HANDLE) {
        dragRef.current = { mode: "trim-end", clipId: clip.id };
      } else {
        dragRef.current = { mode: "move", clipId: clip.id, grabOffset: time - clip.start };
      }
    },
    [pointerToTime],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const state = editorStore.getState();
      const time = pointerToTime(event.clientX);

      if (drag.mode === "playhead") {
        editorStore.setPlayhead(time);
        return;
      }

      if (drag.mode === "marquee") {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          drag.x1 = event.clientX - rect.left;
          drag.y1 = event.clientY - rect.top;
        }
        snapLineRef.current = null;
        return;
      }

      if (state.snapEnabled && drag.clipId) {
        const targets = collectSnapTargets(state.project, drag.clipId);
        const result = snapTime(time, targets, SNAP_THRESHOLD_PX / state.zoom);
        snapLineRef.current = result.snapped ? result.time : null;
      } else {
        snapLineRef.current = null;
      }

      if (drag.mode === "move" && drag.clipId) {
        editorStore.moveClipsLive(drag.clipId, time - (drag.grabOffset ?? 0));
      } else if (drag.mode === "trim-start" && drag.clipId) {
        editorStore.trimClipLive(drag.clipId, "start", time);
      } else if (drag.mode === "trim-end" && drag.clipId) {
        editorStore.trimClipLive(drag.clipId, "end", time);
      }
    },
    [pointerToTime],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    snapLineRef.current = null;
    if (!drag) return;
    if (drag.mode === "marquee") {
      const bounds = marqueeBounds(drag);
      const state = editorStore.getState();
      const left = xToTime(bounds.left, state.zoom, state.scroll);
      const right = xToTime(bounds.right, state.zoom, state.scroll);
      const lanes = computeLanes(state.project.tracks, scrollYRef.current);
      const hits: string[] = [];
      for (const lane of lanes) {
        if (lane.track.hidden) continue;
        const top = lane.y + 3;
        const bottom = lane.y + lane.height - 3;
        if (bottom < bounds.top || top > bounds.bottom) continue;
        for (const clip of clipsInTimeRange(lane.track.clips, left, right)) hits.push(clip.id);
      }
      editorStore.setClipSelection(hits, drag.additive ?? false);
      return;
    }
    if (drag.mode !== "playhead") {
      editorStore.commitInteraction(drag.mode === "move" ? "Moved clip" : "Trimmed clip");
    }
  }, []);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.03] bg-surface shadow-raised">
      <TimelineToolbar />
      <div className="relative flex min-h-0 flex-1">
        <div
          className="relative z-10 shrink-0 border-r border-black/50 bg-[#15161d]"
          style={{ width: HEADER_WIDTH }}
        >
          <div
            className="flex items-center justify-between border-b border-black/50 px-3"
            style={{ height: RULER_HEIGHT }}
          >
            <TimecodeReadout />
          </div>
          <div className="overflow-hidden" style={{ transform: `translateY(${-scrollY}px)` }}>
            {tracks.map((track) => (
              <TrackHeader
                key={track.id}
                track={track}
                selected={track.id === selectedTrackId}
                height={track.height + LANE_GAP}
              />
            ))}
          </div>
        </div>
        <div ref={wrapRef} className="relative min-h-0 flex-1">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 touch-none"
            style={{ cursor: "crosshair" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          <span hidden>{visualTick}</span>
        </div>
      </div>
      <KeyframeTrack />
    </section>
  );
}

interface DragState {
  mode: "playhead" | "move" | "trim-start" | "trim-end" | "marquee";
  clipId?: string;
  grabOffset?: number;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  additive?: boolean;
}

function marqueeBounds(drag: DragState): { left: number; top: number; right: number; bottom: number } {
  const x0 = drag.x0 ?? 0;
  const y0 = drag.y0 ?? 0;
  const x1 = drag.x1 ?? x0;
  const y1 = drag.y1 ?? y0;
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    right: Math.max(x0, x1),
    bottom: Math.max(y0, y1),
  };
}

function renderTimeline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scrollY: number,
  snapLine: number | null,
  drag: DragState | null,
): void {
  const state = editorStore.getState();
  const { project, zoom, scroll, playhead } = state;
  const lanes = computeLanes(project.tracks, scrollY);

  ctx.clearRect(0, 0, width, height);

  // Lane wells.
  for (const lane of lanes) {
    if (lane.y + lane.height < RULER_HEIGHT || lane.y > height) continue;
    ctx.fillStyle = "#16171F";
    roundRect(ctx, 0, lane.y, width, lane.height, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Clips.
  for (const lane of lanes) {
    if (lane.y + lane.height < RULER_HEIGHT || lane.y > height) continue;
    if (lane.track.hidden) continue;
    for (const clip of lane.track.clips) {
      const x0 = timeToX(clip.start, zoom, scroll);
      const x1 = timeToX(clip.start + clip.duration, zoom, scroll);
      if (x1 < -20 || x0 > width + 20) continue;
      drawClip(ctx, clip, lane, x0, x1, zoom, scroll);
    }
  }

  // Markers.
  ctx.fillStyle = "rgba(255,179,0,0.85)";
  for (const marker of project.markers) {
    const x = timeToX(marker.time, zoom, scroll);
    if (x < -6 || x > width + 6) continue;
    roundRect(ctx, x - 1, RULER_HEIGHT, 2, Math.max(0, height - RULER_HEIGHT), 1);
    ctx.fill();
  }

  drawRuler(ctx, width, project, zoom, scroll);

  if (snapLine !== null) {
    const x = timeToX(snapLine, zoom, scroll);
    ctx.strokeStyle = "rgba(255,179,0,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, RULER_HEIGHT);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Playhead.
  const px = timeToX(playhead, zoom, scroll);
  if (px >= -4 && px <= width + 4) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#FFB300");
    gradient.addColorStop(0.5, "#FF5100");
    gradient.addColorStop(1, "#E60067");
    ctx.fillStyle = gradient;
    ctx.fillRect(px - 1.5, RULER_HEIGHT, 3, height - RULER_HEIGHT);
    ctx.beginPath();
    ctx.moveTo(px - 7, RULER_HEIGHT);
    ctx.lineTo(px + 7, RULER_HEIGHT);
    ctx.lineTo(px, RULER_HEIGHT + 11);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = "rgba(255,81,0,0.9)";
    ctx.shadowBlur = 10;
    ctx.fillRect(px - 1.5, RULER_HEIGHT, 3, height - RULER_HEIGHT);
    ctx.shadowBlur = 0;
  }

  // Selection marquee.
  if (drag?.mode === "marquee") {
    const bounds = marqueeBounds(drag);
    ctx.fillStyle = "rgba(255,179,0,0.12)";
    ctx.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    ctx.strokeStyle = "rgba(255,179,0,0.75)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
  }

  void drag;
}

function drawClip(
  ctx: CanvasRenderingContext2D,
  clip: TimelineClip,
  lane: Lane,
  x0: number,
  x1: number,
  zoom: number,
  scroll: number,
): void {
  const selected = editorStore.getState().selectedClipIds.includes(clip.id);
  const top = lane.y + 3;
  const clipHeight = lane.height - 6;
  const drawX = Math.max(x0, -2);
  const drawW = Math.min(x1, ctx.canvas.clientWidth + 2) - drawX;
  if (drawW <= 0) return;

  const gradient = ctx.createLinearGradient(drawX, top, drawX, top + clipHeight);
  gradient.addColorStop(0, hexToRgba(clip.color, 0.35));
  gradient.addColorStop(1, hexToRgba(clip.color, 0.16));
  ctx.fillStyle = gradient;
  roundRect(ctx, drawX, top, drawW, clipHeight, 7);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(clip.color, selected ? 0.95 : 0.55);
  ctx.lineWidth = selected ? 2 : 1;
  ctx.stroke();

  // Accent stripe.
  ctx.fillStyle = clip.color;
  roundRect(ctx, drawX, top, Math.min(4, drawW), clipHeight, 3);
  ctx.fill();

  // Audio waveform.
  if (clip.kind === "audio" || lane.track.type === "audio") {
    const samples = waveformFor(clip);
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, drawX + 1, top, drawW - 2, clipHeight, 7);
    ctx.clip();
    ctx.strokeStyle = hexToRgba(clip.color, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    const mid = top + clipHeight / 2;
    const columns = Math.max(2, Math.floor(drawW / 2));
    for (let i = 0; i < columns; i += 1) {
      const sample = samples[Math.floor((i / columns) * samples.length)];
      const x = drawX + i * 2;
      const amplitude = (sample * clipHeight) / 2.4;
      ctx.moveTo(x, mid - amplitude);
      ctx.lineTo(x, mid + amplitude);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Label.
  if (drawW > 44) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX + 8, top, drawW - 12, clipHeight);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(clip.name, drawX + 9, top + 6);
    ctx.restore();
  }

  // Opacity keyframe diamonds.
  const curve = clip.transform.opacity;
  if (curve.keyframes.length > 0) {
    const y = top + clipHeight - 6;
    ctx.fillStyle = clip.color;
    for (const keyframe of curve.keyframes) {
      const x = timeToX(clip.start + keyframe.time, zoom, scroll);
      if (x < drawX || x > drawX + drawW) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    }
  }

  if (selected) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(drawX, top, 3, clipHeight);
    ctx.fillRect(drawX + drawW - 3, top, 3, clipHeight);
  }
}

function drawRuler(
  ctx: CanvasRenderingContext2D,
  width: number,
  project: EeyditorProject,
  zoom: number,
  scroll: number,
): void {
  ctx.fillStyle = "#1A1B23";
  ctx.fillRect(0, 0, width, RULER_HEIGHT);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(0, RULER_HEIGHT - 1, width, 1);

  const step = chooseTickStep(zoom);
  const minor = step / 5;
  const start = Math.floor(xToTime(0, zoom, scroll) / minor) * minor;
  const endTime = xToTime(width, zoom, scroll);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let time = start; time <= endTime; time += minor) {
    const x = Math.round(timeToX(time, zoom, scroll)) + 0.5;
    ctx.moveTo(x, RULER_HEIGHT - 6);
    ctx.lineTo(x, RULER_HEIGHT);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.fillStyle = "rgba(231,232,239,0.7)";
  ctx.font = "500 10px JetBrains Mono, monospace";
  ctx.textBaseline = "top";
  for (let time = Math.floor(start / step) * step; time <= endTime; time += step) {
    const x = Math.round(timeToX(time, zoom, scroll)) + 0.5;
    ctx.moveTo(x, RULER_HEIGHT - 12);
    ctx.lineTo(x, RULER_HEIGHT);
    ctx.fillText(formatTimecode(time, project.frameRate), x + 3, 5);
  }
  ctx.stroke();
}

function TimelineToolbar() {
  const tool = useEditorSelector((state) => state.tool);
  const snap = useEditorSelector((state) => state.snapEnabled);
  const canUndo = useEditorSelector((state) => state.past.length > 0);
  const canRedo = useEditorSelector((state) => state.future.length > 0);

  return (
    <div className="flex items-center gap-1.5 border-b border-black/40 px-3 py-2">
      <NeumorphicButton
        size="sm"
        iconOnly
        active={tool === "select"}
        title="Select (V)"
        onClick={() => editorStore.setTool("select")}
        icon={<MousePointer2 size={15} />}
      />
      <NeumorphicButton
        size="sm"
        iconOnly
        active={tool === "blade"}
        title="Blade (C)"
        onClick={() => editorStore.setTool("blade")}
        icon={<Scissors size={15} />}
      />
      <NeumorphicButton
        size="sm"
        iconOnly
        active={snap}
        title="Magnetic snap (S)"
        onClick={() => editorStore.toggleSnap()}
        icon={<Magnet size={15} />}
      />
      <div className="mx-1 h-5 w-px bg-white/10" />
      <NeumorphicButton
        size="sm"
        iconOnly
        title="Split at playhead (Ctrl+B)"
        onClick={() => editorStore.splitAtPlayhead()}
        icon={<Scissors size={15} />}
      />
      <NeumorphicButton
        size="sm"
        iconOnly
        title="Add video track"
        onClick={() => editorStore.addTrack("video")}
        icon={<Plus size={15} />}
      />
      <NeumorphicButton
        size="sm"
        iconOnly
        title="Undo (Ctrl+Z)"
        disabled={!canUndo}
        onClick={() => editorStore.undo()}
        icon={<Undo2 size={15} />}
      />
      <NeumorphicButton
        size="sm"
        iconOnly
        title="Redo (Ctrl+Shift+Z)"
        disabled={!canRedo}
        onClick={() => editorStore.redo()}
        icon={<Redo2 size={15} />}
      />
      <div className="ml-auto flex items-center gap-1.5">
        <NeumorphicButton
          size="sm"
          iconOnly
          title="Zoom out"
          onClick={() => editorStore.zoomBy(1 / 1.35)}
          icon={<ZoomOut size={15} />}
        />
        <NeumorphicButton
          size="sm"
          iconOnly
          title="Zoom in"
          onClick={() => editorStore.zoomBy(1.35)}
          icon={<ZoomIn size={15} />}
        />
      </div>
    </div>
  );
}

function TimecodeReadout() {
  const playhead = useEditorSelector((state) => state.playhead);
  const frameRate = useEditorSelector((state) => state.project.frameRate);
  return (
    <span className="font-mono text-sm tracking-widest text-amber">
      {formatTimecode(playhead, frameRate)}
    </span>
  );
}

export { HEADER_WIDTH };
