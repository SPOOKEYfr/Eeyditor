import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export interface NeumorphicTrackSlotProps extends HTMLAttributes<HTMLDivElement> {
  height?: number;
}

export function NeumorphicTrackSlot({
  height,
  className,
  children,
  ...rest
}: NeumorphicTrackSlotProps) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg bg-recessed shadow-recessed-sm",
        className,
      )}
      style={height ? { height } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}
