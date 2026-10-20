import { Sparkles, Trash2 } from "lucide-react";
import type { BlendMode, EffectKind, TimelineClip, TransitionKind } from "../../types/timeline";

type TransformProperty =
  | "opacity"
  | "scaleX"
  | "scaleY"
  | "positionX"
  | "positionY"
  | "rotation";
import { editorStore, useEditorSelector } from "../../state/editorStore";
import { pickOpenPaths } from "../../lib/tauri";
import { createEffect } from "../../core/project/factory";
import { NeumorphicPanel, NeumorphicSlider } from "../neumorphic";

const BLEND_MODES: BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "add",
];

const EFFECT_KINDS: EffectKind[] = [
  "blur",
  "brightness",
  "contrast",
  "saturation",
  "hue",
  "sharpen",
  "vignette",
  "glow",
  "chroma-key",
  "lut",
];

function findClip(clipId: string | null, project: ReturnType<typeof editorStore.getState>["project"]): TimelineClip | null {
  if (!clipId) return null;
  for (const track of project.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return null;
}

export function Inspector() {
  const project = useEditorSelector((state) => state.project);
  const selectedClipId = useEditorSelector((state) => state.selectedClipId);
  const selectedCount = useEditorSelector((state) => state.selectedClipIds.length);
  const clip = findClip(selectedClipId, project);

  if (!clip) {
    return (
      <NeumorphicPanel title="Inspector" className="h-full">
        <p className="px-1 py-6 text-xs text-muted">
          Select a clip to inspect and refine its properties.
        </p>
        <MarkerList />
      </NeumorphicPanel>
    );
  }

  const setCurveDefault = (property: TransformProperty | "volume", value: number) => {
    editorStore.updateClip(clip.id, (current) => {
      if (property === "volume") {
        return { ...current, volume: { ...current.volume, gainDb: value } };
      }
      return {
        ...current,
        transform: {
          ...current.transform,
          [property]: { ...current.transform[property], defaultValue: value },
        },
      };
    }, "Adjusted value");
  };

  return (
    <NeumorphicPanel title="Inspector" className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <div className="flex items-center gap-2 rounded-xl bg-recessed px-3 py-2 shadow-recessed-sm">
          <span className="h-3 w-3 rounded-sm" style={{ background: clip.color }} />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-ink">{clip.name}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted">
              {clip.kind} · {clip.duration.toFixed(2)}s
            </div>
          </div>
        </div>

        <Section title="Transform">
          <NeumorphicSlider label="Opacity" min={0} max={1} step={0.01} value={clip.transform.opacity.defaultValue} formatValue={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setCurveDefault("opacity", v)} />
          <NeumorphicSlider label="Scale X" min={0.1} max={2} step={0.01} value={clip.transform.scaleX.defaultValue} onChange={(v) => setCurveDefault("scaleX", v)} />
          <NeumorphicSlider label="Scale Y" min={0.1} max={2} step={0.01} value={clip.transform.scaleY.defaultValue} onChange={(v) => setCurveDefault("scaleY", v)} />
          <NeumorphicSlider label="Position X" min={-0.5} max={0.5} step={0.005} value={clip.transform.positionX.defaultValue} onChange={(v) => setCurveDefault("positionX", v)} />
          <NeumorphicSlider label="Position Y" min={-0.5} max={0.5} step={0.005} value={clip.transform.positionY.defaultValue} onChange={(v) => setCurveDefault("positionY", v)} />
          <NeumorphicSlider label="Rotation" min={-180} max={180} step={1} value={clip.transform.rotation.defaultValue} formatValue={(v) => `${v.toFixed(0)}°`} onChange={(v) => setCurveDefault("rotation", v)} />
          <label className="block text-[10px] uppercase tracking-wider text-muted">
            Blend
            <select
              value={clip.transform.blendMode}
              onChange={(event) =>
                editorStore.updateClip(
                  clip.id,
                  (current) => ({
                    ...current,
                    transform: { ...current.transform, blendMode: event.target.value as BlendMode },
                  }),
                  "Changed blend mode",
                )
              }
              className="mt-1 w-full rounded-lg bg-recessed px-2 py-1 text-[11px] text-ink shadow-recessed-sm outline-none"
            >
              {BLEND_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
        </Section>

        <Section title="Timing">
          <NeumorphicSlider label="Speed" min={0.1} max={4} step={0.05} value={clip.speed} formatValue={(v) => `${v.toFixed(2)}x`} onChange={(v) => editorStore.setClipSpeed(clip.id, v)} />
          <button
            type="button"
            onClick={() =>
              editorStore.updateClip(
                clip.id,
                (current) => ({ ...current, reversed: !current.reversed }),
                clip.reversed ? "Played forward" : "Played in reverse",
              )
            }
            className={`w-full rounded-lg px-2 py-1 text-[11px] shadow-recessed-sm transition-colors ${
              clip.reversed ? "bg-amber/20 text-amber" : "bg-recessed text-muted hover:text-ink"
            }`}
          >
            {clip.reversed ? "Reversed" : "Reverse clip"}
          </button>
          <button
            type="button"
            onClick={() => editorStore.setClipLocked(clip.id, !clip.locked)}
            className={`w-full rounded-lg px-2 py-1 text-[11px] shadow-recessed-sm transition-colors ${
              clip.locked ? "bg-amber/20 text-amber" : "bg-recessed text-muted hover:text-ink"
            }`}
          >
            {clip.locked ? "Locked" : "Lock clip"}
          </button>
        </Section>

        <Section title="Audio">
          <NeumorphicSlider label="Gain" min={-60} max={12} step={0.5} value={clip.volume.gainDb} formatValue={(v) => `${v.toFixed(1)} dB`} onChange={(v) => setCurveDefault("volume", v)} />
          <NeumorphicSlider label="Fade In" min={0} max={5} step={0.05} value={clip.volume.fadeIn} formatValue={(v) => `${v.toFixed(2)}s`} onChange={(v) => editorStore.updateClip(clip.id, (current) => ({ ...current, volume: { ...current.volume, fadeIn: v } }), "Adjusted fade")} />
          <NeumorphicSlider label="Fade Out" min={0} max={5} step={0.05} value={clip.volume.fadeOut} formatValue={(v) => `${v.toFixed(2)}s`} onChange={(v) => editorStore.updateClip(clip.id, (current) => ({ ...current, volume: { ...current.volume, fadeOut: v } }), "Adjusted fade")} />
        </Section>

        <Section title="Transitions">
          {(["in", "out"] as const).map((edge) => {
            const transition = edge === "in" ? clip.transitionIn : clip.transitionOut;
            const set = (
              kind: TransitionKind | "none",
              duration = transition?.duration ?? 0.75,
              direction = transition?.direction ?? "left",
            ) => editorStore.setClipTransition(clip.id, edge, kind, duration, direction);
            return (
              <div key={edge} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-8 text-[10px] uppercase tracking-wider text-muted">{edge}</span>
                  <select
                    value={transition?.kind ?? "none"}
                    onChange={(event) => set(event.target.value as TransitionKind | "none")}
                    className="min-w-0 flex-1 rounded-lg bg-recessed px-2 py-1 text-[11px] text-ink shadow-recessed-sm outline-none"
                  >
                    <option value="none">none</option>
                    <option value="fade">fade</option>
                    <option value="dissolve">dissolve</option>
                    <option value="wipe">wipe</option>
                    <option value="slide">slide</option>
                    <option value="zoom">zoom</option>
                  </select>
                </div>
                {transition && (
                  <>
                    <NeumorphicSlider
                      label="Duration"
                      min={0.1}
                      max={3}
                      step={0.05}
                      value={transition.duration}
                      formatValue={(value) => `${value.toFixed(2)}s`}
                      onChange={(value) => set(transition.kind, value, transition.direction)}
                    />
                    {(transition.kind === "wipe" || transition.kind === "slide") && (
                      <select
                        value={transition.direction}
                        onChange={(event) =>
                          set(transition.kind, transition.duration, event.target.value as typeof transition.direction)
                        }
                        className="w-full rounded-lg bg-recessed px-2 py-1 text-[11px] text-ink shadow-recessed-sm outline-none"
                      >
                        <option value="left">from left</option>
                        <option value="right">from right</option>
                        <option value="up">from top</option>
                        <option value="down">from bottom</option>
                      </select>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </Section>

        <Section title="Link">
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={selectedCount < 2}
              onClick={() => editorStore.linkSelectedClips()}
              className="flex-1 rounded-md bg-recessed px-2 py-1 text-[10px] text-muted shadow-recessed-sm transition-colors hover:text-ink disabled:opacity-40"
            >
              Link selection
            </button>
            <button
              type="button"
              disabled={!clip.groupId}
              onClick={() => editorStore.unlinkSelectedClips()}
              className="flex-1 rounded-md bg-recessed px-2 py-1 text-[10px] text-muted shadow-recessed-sm transition-colors hover:text-ink disabled:opacity-40"
            >
              Unlink
            </button>
          </div>
          <div className="text-[10px] text-muted">
            {clip.groupId ? `Linked group ${clip.groupId.slice(-6)}` : "Not linked"}
          </div>
        </Section>

        <Section title="Effects">
          <div className="flex flex-wrap gap-1">
            {EFFECT_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => editorStore.updateClip(clip.id, (current) => ({ ...current, effects: [...current.effects, createEffect(kind)] }), "Added effect")}
                className="flex items-center gap-1 rounded-md bg-recessed px-2 py-1 text-[10px] text-muted shadow-recessed-sm transition-colors hover:text-ink"
              >
                <Sparkles size={11} /> {kind}
              </button>
            ))}
          </div>
          {clip.effects.map((effect) => (
            <div key={effect.id} className="mt-1.5 rounded-lg bg-recessed px-2 py-1.5 shadow-recessed-sm">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[11px] text-ink">{effect.kind}</span>
                <span className="font-mono text-[9px] text-muted">{effect.amount.toFixed(2)}</span>
                <input
                  type="checkbox"
                  checked={effect.enabled}
                  onChange={(event) =>
                    editorStore.updateClip(
                      clip.id,
                      (current) => ({
                        ...current,
                        effects: current.effects.map((entry) =>
                          entry.id === effect.id ? { ...entry, enabled: event.target.checked } : entry,
                        ),
                      }),
                      "Toggled effect",
                    )
                  }
                  className="accent-amber"
                />
                <button
                  type="button"
                  onClick={() =>
                    editorStore.updateClip(
                      clip.id,
                      (current) => ({ ...current, effects: current.effects.filter((entry) => entry.id !== effect.id) }),
                      "Removed effect",
                    )
                  }
                  className="grid h-5 w-5 place-items-center rounded text-muted hover:text-magenta"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {effect.kind === "lut" && (
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const paths = await pickOpenPaths(["cube"], false);
                      if (!paths.length) return;
                      editorStore.updateClip(
                        clip.id,
                        (current) => ({
                          ...current,
                          effects: current.effects.map((entry) =>
                            entry.id === effect.id
                              ? { ...entry, params: { ...entry.params, path: paths[0] } }
                              : entry,
                          ),
                        }),
                        "Chose LUT",
                      );
                    }}
                    className="flex-1 rounded-md bg-recessed px-2 py-1 text-[10px] text-muted shadow-recessed-sm transition-colors hover:text-ink"
                  >
                    {typeof effect.params.path === "string" ? "Change .cube" : "Choose .cube"}
                  </button>
                  <span className="max-w-[120px] truncate font-mono text-[9px] text-muted">
                    {typeof effect.params.path === "string"
                      ? effect.params.path.split("/").pop()
                      : "none"}
                  </span>
                </div>
              )}
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={effect.amount}
                onChange={(event) =>
                  editorStore.updateClip(
                    clip.id,
                    (current) => ({
                      ...current,
                      effects: current.effects.map((entry) =>
                        entry.id === effect.id
                          ? { ...entry, amount: Number(event.target.value) }
                          : entry,
                      ),
                    }),
                    "Adjusted effect",
                  )
                }
                className="mt-1 w-full accent-amber"
              />
            </div>
          ))}
        </Section>

        <MarkerList />
      </div>
    </NeumorphicPanel>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl bg-surface px-2.5 py-2.5 shadow-raised-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </div>
      {children}
    </div>
  );
}

function MarkerList() {
  const markers = useEditorSelector((state) => state.project.markers);
  if (markers.length === 0) return null;
  return (
    <Section title="Markers">
      {markers.map((marker) => (
        <div key={marker.id} className="flex items-center gap-2 rounded-lg bg-recessed px-2 py-1 text-[10px] shadow-recessed-sm">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: marker.color }} />
          <button
            type="button"
            title="Jump to marker"
            onClick={() => editorStore.setPlayhead(marker.time)}
            className="flex-1 truncate text-left font-mono text-[9px] text-muted transition-colors hover:text-ink"
          >
            {marker.time.toFixed(2)}s {marker.label}
          </button>
          <button
            type="button"
            title="Rename marker"
            onClick={() => {
              const label = window.prompt("Marker label", marker.label);
              if (label !== null) editorStore.renameMarker(marker.id, label.trim() || marker.label);
            }}
            className="text-muted transition-colors hover:text-ink"
          >
            edit
          </button>
          <button
            type="button"
            title="Delete marker"
            onClick={() => editorStore.removeMarker(marker.id)}
            className="text-muted transition-colors hover:text-magenta"
          >
            x
          </button>
        </div>
      ))}
    </Section>
  );
}
