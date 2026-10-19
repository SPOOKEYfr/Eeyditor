import { useCallback, useRef } from "react";
import { cn } from "../../lib/cn";

export interface NeumorphicSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  formatValue?: (value: number) => string;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  className?: string;
  disabled?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function NeumorphicSlider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  formatValue,
  onChange,
  onCommit,
  className,
  disabled = false,
}: NeumorphicSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const resolve = useCallback(
    (clientX: number): number => {
      const element = trackRef.current;
      if (!element) return value;
      const rect = element.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const raw = min + ratio * (max - min);
      return clamp(Math.round(raw / step) * step, min, max);
    },
    [max, min, step, value],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = true;
      onChange(resolve(event.clientX));
    },
    [disabled, onChange, resolve],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || !dragging.current) return;
      onChange(resolve(event.clientX));
    },
    [disabled, onChange, resolve],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      dragging.current = false;
      onCommit?.(resolve(event.clientX));
    },
    [disabled, onCommit, resolve],
  );

  const progress = clamp((value - min) / (max - min || 1), 0, 1);

  return (
    <div className={cn("w-full", disabled && "opacity-50", className)}>
      {(label || formatValue) && (
        <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted">
          <span>{label}</span>
          <span className="font-mono text-ink/80">
            {formatValue ? formatValue(value) : value.toFixed(2)}
          </span>
        </div>
      )}
      <div
        ref={trackRef}
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
        className="relative h-3 w-full cursor-pointer rounded-full bg-recessed shadow-recessed-sm"
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-brand"
          style={{ width: `${progress * 100}%` }}
        />
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface shadow-raised-sm ring-1 ring-white/10"
          style={{ left: `${progress * 100}%` }}
        >
          <div className="absolute inset-1 rounded-full bg-brand/80" />
        </div>
      </div>
    </div>
  );
}
