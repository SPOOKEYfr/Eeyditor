import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export type NeumorphicButtonVariant = "default" | "primary" | "ghost" | "danger";
export type NeumorphicButtonSize = "sm" | "md" | "lg";

export interface NeumorphicButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: NeumorphicButtonVariant;
  size?: NeumorphicButtonSize;
  active?: boolean;
  iconOnly?: boolean;
  icon?: ReactNode;
}

const VARIANT: Record<NeumorphicButtonVariant, string> = {
  default:
    "bg-surface text-ink shadow-raised-sm hover:text-white active:shadow-recessed-sm",
  primary:
    "bg-brand text-[#1a1206] font-semibold shadow-raised-sm hover:brightness-110 active:shadow-recessed-sm",
  ghost:
    "bg-transparent text-muted hover:text-ink hover:bg-white/[0.04] shadow-none",
  danger:
    "bg-magenta/90 text-white shadow-raised-sm hover:brightness-110 active:shadow-recessed-sm",
};

const SIZE: Record<NeumorphicButtonSize, string> = {
  sm: "h-8 px-3 text-xs rounded-lg",
  md: "h-10 px-4 text-sm rounded-xl",
  lg: "h-12 px-6 text-base rounded-2xl",
};

export const NeumorphicButton = forwardRef<
  HTMLButtonElement,
  NeumorphicButtonProps
>(function NeumorphicButton(
  {
    variant = "default",
    size = "md",
    active = false,
    iconOnly = false,
    icon,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 font-medium tracking-tight",
        "transition-all duration-150 ease-tactile focus:outline-none focus-visible:ring-2 focus-visible:ring-amber/50",
        "disabled:pointer-events-none disabled:opacity-40",
        SIZE[size],
        VARIANT[variant],
        active && "shadow-recessed-sm brightness-95",
        iconOnly && (size === "sm" ? "w-8 px-0" : size === "lg" ? "w-12 px-0" : "w-10 px-0"),
        className,
      )}
      {...rest}
    >
      {icon}
      {!iconOnly && children}
    </button>
  );
});
