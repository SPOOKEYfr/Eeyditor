import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface NeumorphicPanelProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  raised?: boolean;
  padded?: boolean;
  title?: ReactNode;
  actions?: ReactNode;
}

export function NeumorphicPanel({
  raised = true,
  padded = true,
  title,
  actions,
  className,
  children,
  ...rest
}: NeumorphicPanelProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.03] bg-surface",
        raised ? "shadow-raised" : "shadow-recessed",
        padded && "p-3",
        className,
      )}
      {...rest}
    >
      {(title || actions) && (
        <div className="mb-2 flex items-center justify-between px-1">
          {title && (
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              {title}
            </span>
          )}
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
