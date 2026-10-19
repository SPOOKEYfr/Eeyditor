import { useCallback, useRef, useState } from "react";
import { cn } from "../../lib/cn";

export interface NeumorphicKnobProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  unit?: string;
  size?: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function NeumorphicKnob({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  unit = "",
  size = 56,
  onChange,
  onCommit,
  className,
}: NeumorphicKnobProps) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ y: 0, value: 0 });

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      origin.current = { y: event.clientY, value };
      setDragging(true);
    },
    [value],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const range = max - min;
      const delta = (origin.current.y - event.clientY) / 180;
      const raw = origin.current.value + delta * range;
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(snapped, min, max));
    },
    [dragging, max, min, onChange, step],
  );

  const handlePointerUp = useCallback(() => {
    if (dragging) {
      setDragging(false);
      onCommit?.(value);
    }
  }, [dragging, onCommit, value]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const direction = event.deltaY > 0 ? -1 : 1;
      onChange(clamp(value + direction * step * 2, min, max));
    },
    [max, min, onChange, step, value],
  );

  const progress = (value - min) / (max - min || 1);
  const angle = -135 + progress * 270;

  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        className="relative grid cursor-ns-resize place-items-center rounded-full bg-surface shadow-raised transition-shadow active:shadow-recessed-sm"
        style={{ width: size, height: size }}
      >
        <div
          className="absolute rounded-full bg-recessed shadow-recessed-sm"
          style={{ width: size * 0.72, height: size * 0.72 }}
        />
        <div
          className="absolute inset-0 transition-transform duration-75"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <div
            className="absolute left-1/2 top-[10%] h-[26%] w-[3px] -translate-x-1/2 rounded-full bg-brand"
            style={{ boxShadow: "0 0 8px rgba(255,81,0,0.8)" }}
          />
        </div>
        <div
          className="absolute rounded-full bg-canvas shadow-recessed-sm"
          style={{ width: size * 0.4, height: size * 0.4 }}
        />
      </div>
      {(label || unit) && (
        <span className="text-[10px] uppercase tracking-wider text-muted">
          {label}
          {unit && <span className="ml-1 text-ink/70">{unit}</span>}
        </span>
      )}
    </div>
  );
}
