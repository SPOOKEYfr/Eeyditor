import { useEffect, useState } from "react";
import logo from "../../assets/logo.png";
import { editorStore } from "../../state/editorStore";
import { cn } from "../../lib/cn";

export function Splash() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = window.setTimeout(() => setFading(true), 1150);
    const hideTimer = window.setTimeout(() => {
      setVisible(false);
      editorStore.setSplash(false);
    }, 1600);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 grid place-items-center bg-canvas transition-opacity duration-500",
        fading ? "opacity-0" : "opacity-100",
      )}
    >
      <div className="flex flex-col items-center gap-6">
        <div className="relative">
          <div className="absolute -inset-6 rounded-full bg-brand-soft blur-2xl" />
          <img
            src={logo}
            alt="Eeyditor"
            className="relative h-28 w-28 rounded-3xl shadow-raised"
            draggable={false}
          />
        </div>
        <div className="text-center">
          <h1 className="bg-brand bg-clip-text text-3xl font-black tracking-tight text-transparent">
            EEYDITOR
          </h1>
          <p className="mt-1 text-xs uppercase tracking-[0.34em] text-muted">
            precision editing engine
          </p>
        </div>
        <div className="h-1 w-52 overflow-hidden rounded-full bg-recessed shadow-recessed-sm">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-brand" />
        </div>
      </div>
    </div>
  );
}
