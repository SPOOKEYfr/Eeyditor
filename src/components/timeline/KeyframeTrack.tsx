import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Diamond, Pause, Trash2, TrendingUp } from "lucide-react";
import type { AnimatableProperty, Keyframe, TimelineClip } from "../../types/timeline";
import { editorStore, getCurve, useEditorSelector } from "../../state/editorStore";
import { evaluateCurve } from "../../core/keyframes/bezier";
import { formatTimecode } from "../../core/timeline/engine";
import { NeumorphicButton } from "../neumorphic";
import { cn } from "../../lib/cn";

const ROWS = 200;
const PADDING_X = 12;
const PADDING_Y = 14;

const PROPERTIES: { id: AnimatableProperty; label: string; min: number; max: number }[] = [
  { id: "opacity", label: "Opacity", min: 0, max: 1 },
  { id: "scaleX", label: "Scale X", min: 0, max: 2 },
  { id: "scaleY", label: "Scale Y", min: 0, max: 2 },
  { id: "positionX", label: "Pos X", min: -0.5, max: 0.5 },
  { id: "positionY", label: "Pos Y", min: -0.5, max: 0.5 },
  { id: "rotation", label: "Rotation", min: -180, max: 180 },
  { id: "volume", label: "Volume", min: -60, max: 12 },
];

function findClip(clipId: string | null): TimelineClip | null {
  if (!clipId) return null;
  for (const track of editorStore.getState().project.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return null;
}

function valueRange(property: AnimatableProperty, curveValues: number[]): [number, number] {
  const preset = PROPERTIES.find((entry) => entry.id === property);
  const min = preset?.min ?? -1;
  const max = preset?.max ?? 1;
  if (curveValues.length === 0) return [min, max];
  let lo = Math.min(min, ...curveValues);
  let hi = Math.max(max, ...curveValues);
  const pad = (hi - lo) * 0.1 || 1;
  return [lo - pad, hi + pad];
}

export function KeyframeTrack() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [property, setProperty] = useState<AnimatableProperty>("opacity");
  const selectedClipId = useEditorSelector((state) => state.selectedClipId);
  const clip = useMemo(() => findClip(selectedClipId), [selectedClipId]);
  const marker = useEditorSelector((state) => state.project.metadata.modifiedAt);

  const curve = clip ? getCurve(clip, property) : null;
  const keyframes = curve?.keyframes ?? [];

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let raf = 0;
    let width = 0;
    let height = ROWS;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      width = rect.width;
      height = rect.height || ROWS;
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

  const geometry = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !clip) return null;
    const rect = canvas.getBoundingClientRect();
    const current = findClip(selectedClipId);
    const activeCurve = current ? getCurve(current, property) : null;
    const values = (activeCurve?.keyframes ?? []).map((keyframe) => keyframe.value);
    const [lo, hi] = valueRange(property, values);
    return {
      rect,
      duration: Math.max(clip.duration, 0.001),
      lo,
      hi,
      width: rect.width,
      height: rect.height || ROWS,
    };
  }, [clip, property, selectedClipId]);

  const toX = useCallback(
    (time: number, g: NonNullable<ReturnType<typeof geometry>>) =>
      PADDING_X + (time / g.duration) * (g.width - PADDING_X * 2),
    [],
  );
  const toY = useCallback(
    (value: number, g: NonNullable<ReturnType<typeof geometry>>) =>
      g.height - PADDING_Y - ((value - g.lo) / (g.hi - g.lo || 1)) * (g.height - PADDING_Y * 2),
    [],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const g = geometry();
      const current = findClip(selectedClipId);
      if (!g || !current) return;
      const activeCurve = getCurve(current, property);
      if (!activeCurve) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      canvasRef.current!.setPointerCapture(event.pointerId);

      for (const keyframe of activeCurve.keyframes) {
        const kx = toX(keyframe.time, g);
        const ky = toY(keyframe.value, g);
        if (Math.hypot(kx - x, ky - y) <= 6) {
          editorStore.beginInteraction();
          dragRef.current = { mode: "keyframe", keyframeId: keyframe.id };
          return;
        }
        if (keyframe.interpolation === "bezier") {
          const outX = kx + keyframe.outHandle.x * 60;
          const outY = ky - keyframe.outHandle.y * 40;
          const inX = kx - keyframe.inHandle.x * 60;
          const inY = ky + keyframe.inHandle.y * 40;
          if (Math.hypot(outX - x, outY - y) <= 6) {
            editorStore.beginInteraction();
            dragRef.current = { mode: "outHandle", keyframeId: keyframe.id };
            return;
          }
          if (Math.hypot(inX - x, inY - y) <= 6) {
            editorStore.beginInteraction();
            dragRef.current = { mode: "inHandle", keyframeId: keyframe.id };
            return;
          }
        }
      }
    },
    [geometry, property, selectedClipId, toX, toY],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      const g = geometry();
      if (!drag || !g || !selectedClipId) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const time = ((x - PADDING_X) / (g.width - PADDING_X * 2)) * g.duration;
      const value = g.lo + ((g.height - PADDING_Y - y) / (g.height - PADDING_Y * 2)) * (g.hi - g.lo);

      if (drag.mode === "keyframe") {
        const clampedTime = Math.max(0, Math.min(time, g.duration));
        editorStore.updateKeyframesLive(selectedClipId, property, (frames) =>
          frames
            .map((frame) =>
              frame.id === drag.keyframeId
                ? { ...frame, time: clampedTime, value }
                : frame,
            )
            .sort((a, b) => a.time - b.time),
        );
      } else {
        const deltaX = Math.max(0, Math.min(1, (x - PADDING_X) / (g.width - PADDING_X * 2)));
        const deltaY = Math.max(0, Math.min(1, (y - PADDING_Y) / (g.height - PADDING_Y * 2)));
        editorStore.updateKeyframesLive(selectedClipId, property, (frames) =>
          frames.map((frame) => {
            if (frame.id !== drag.keyframeId) return frame;
            if (drag.mode === "outHandle") {
              return { ...frame, interpolation: "bezier" as const, outHandle: { x: deltaX, y: 1 - deltaY } };
            }
            return { ...frame, interpolation: "bezier" as const, inHandle: { x: 1 - deltaX, y: deltaY } };
          }),
        );
      }
    },
    [geometry, property, selectedClipId, toX],
  );

  const handlePointerUp = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null;
      editorStore.commitInteraction("Adjusted keyframe");
    }
  }, []);

  return (
    <div className="border-t border-black/40 bg-recessed px-3 py-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Diamond size={13} className="text-amber" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
          Keyframes
        </span>
        <div className="ml-1 flex flex-wrap gap-1">
          {PROPERTIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setProperty(entry.id)}
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] transition-colors",
                property === entry.id
                  ? "bg-brand text-[#1a1206] font-semibold"
                  : "text-muted hover:text-ink",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-muted">
            {keyframes.length} keys
          </span>
          <NeumorphicButton
            size="sm"
            iconOnly
            title="Add keyframe at playhead"
            disabled={!selectedClipId}
            onClick={() =>
              selectedClipId && editorStore.addKeyframeAtPlayhead(selectedClipId, property)
            }
            icon={<Diamond size={13} />}
          />
          <NeumorphicButton
            size="sm"
            iconOnly
            title="Set interpolation: hold"
            disabled={!selectedClipId || keyframes.length === 0}
            onClick={() => {
              const last = keyframes[keyframes.length - 1];
              if (selectedClipId && last) {
                editorStore.updateKeyframeInterpolation(selectedClipId, property, last.id, "hold");
              }
            }}
            icon={<Pause size={13} />}
          />
          <NeumorphicButton
            size="sm"
            iconOnly
            title="Set interpolation: linear"
            disabled={!selectedClipId || keyframes.length === 0}
            onClick={() => {
              const last = keyframes[keyframes.length - 1];
              if (selectedClipId && last) {
                editorStore.updateKeyframeInterpolation(selectedClipId, property, last.id, "linear");
              }
            }}
            icon={<TrendingUp size={13} />}
          />
          <NeumorphicButton
            size="sm"
            iconOnly
            variant="danger"
            title="Clear keyframes"
            disabled={!selectedClipId || keyframes.length === 0}
            onClick={() => {
              if (!selectedClipId) return;
              for (const keyframe of keyframes) {
                editorStore.removeKeyframeById(selectedClipId, property, keyframe.id);
              }
            }}
            icon={<Trash2 size={13} />}
          />
        </div>
      </div>
      <div ref={wrapRef} className="h-[132px] overflow-hidden rounded-lg bg-canvas shadow-recessed-sm">
        <canvas
          ref={canvasRef}
          className="touch-none"
          style={{ display: "block", cursor: "crosshair" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
      <span hidden>{marker}</span>
    </div>
  );

  function paint(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.clearRect(0, 0, width, height);
    const currentClip = findClip(selectedClipId);
    if (!currentClip) {
      ctx.fillStyle = "rgba(138,140,160,0.6)";
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.fillText("Select a clip to edit its animation curves", PADDING_X, height / 2);
      return;
    }
    const activeCurve = getCurve(currentClip, property);
    if (!activeCurve) return;
    const values = activeCurve.keyframes.map((keyframe) => keyframe.value);
    const [lo, hi] = valueRange(property, values);
    const duration = Math.max(currentClip.duration, 0.001);
    const xOf = (time: number) => PADDING_X + (time / duration) * (width - PADDING_X * 2);
    const yOf = (value: number) =>
      height - PADDING_Y - ((value - lo) / (hi - lo || 1)) * (height - PADDING_Y * 2);

    // Grid.
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 8; i += 1) {
      const x = PADDING_X + ((width - PADDING_X * 2) * i) / 8;
      ctx.moveTo(x, PADDING_Y);
      ctx.lineTo(x, height - PADDING_Y);
    }
    for (let i = 0; i <= 4; i += 1) {
      const y = PADDING_Y + ((height - PADDING_Y * 2) * i) / 4;
      ctx.moveTo(PADDING_X, y);
      ctx.lineTo(width - PADDING_X, y);
    }
    ctx.stroke();

    // Curve.
    const samples = Math.max(24, Math.floor(width));
    ctx.strokeStyle = "#FF5100";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < samples; i += 1) {
      const time = (duration * i) / (samples - 1);
      const value = evaluateCurve(activeCurve, time);
      const x = xOf(time);
      const y = yOf(value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Playhead.
    const playhead = editorStore.getState().playhead - currentClip.start;
    if (playhead >= 0 && playhead <= duration) {
      const x = xOf(playhead);
      ctx.strokeStyle = "rgba(255,179,0,0.6)";
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x, height - 2);
      ctx.stroke();
    }

    // Handles and keyframes.
    for (const keyframe of activeCurve.keyframes) {
      const x = xOf(keyframe.time);
      const y = yOf(keyframe.value);
      if (keyframe.interpolation === "bezier") {
        const outX = x + keyframe.outHandle.x * 60;
        const outY = y - keyframe.outHandle.y * 40;
        const inX = x - keyframe.inHandle.x * 60;
        const inY = y + keyframe.inHandle.y * 40;
        ctx.strokeStyle = "rgba(230,0,103,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(inX, inY);
        ctx.lineTo(x, y);
        ctx.lineTo(outX, outY);
        ctx.stroke();
        ctx.fillStyle = "#E60067";
        ctx.beginPath();
        ctx.arc(outX, outY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(inX, inY, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      const gradient = ctx.createLinearGradient(-5, -5, 5, 5);
      gradient.addColorStop(0, "#FFB300");
      gradient.addColorStop(1, "#E60067");
      ctx.fillStyle = gradient;
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }

    // Axis labels.
    ctx.fillStyle = "rgba(231,232,239,0.5)";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillText(hi.toFixed(2), 4, PADDING_Y + 8);
    ctx.fillText(lo.toFixed(2), 4, height - PADDING_Y);
    ctx.fillText(formatTimecode(duration, editorStore.getState().project.frameRate), width - 88, height - 6);
  }
}

interface DragState {
  mode: "keyframe" | "inHandle" | "outHandle";
  keyframeId: string;
}

export type { Keyframe };
