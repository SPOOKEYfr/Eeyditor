# Eeyditor

A fast, precise desktop video editor built for frame-accurate editing,
multi-track compositing and deterministic FFmpeg rendering.

Eeyditor is original software released under the **GNU General Public License
v3.0**. It ships a Rust/Tauri shell, a React + TypeScript editing surface, a
canvas-rendered 60fps timeline, a WebAudio-synced program monitor and a
filtergraph compiler that turns a project manifest into a single `ffmpeg`
invocation.

```
Eeyditor logo (src/assets/logo.png)
```

## Highlights

- **Canvas timeline** rendered at 60fps with infinite zoom, magnetic snapping
  (snap-to-cut, snap-to-edge, snap-to-marker), frame-accurate `HH:MM:SS:FF`
  timecode and virtualized clip drawing.
- **Keyframe engine** with linear, hold and cubic Bézier interpolation, an
  interactive Bézier curve editor and per-property animation for opacity,
  scale, position, rotation and volume.
- **Real-time program monitor** with a 2D transform matrix, blend-aware
  overlays, safe-frame guides and a live WebAudio waveform scope.
- **Deterministic export** that compiles the timeline into one FFmpeg
  `filter_complex` graph (multi-track overlay, keyframed transforms, audio
  mixing, fades, transitions) and renders through the Rust host.
- **Tactile dark neumorphism** design system with a sampled brand gradient.

## Design system

Brand gradient:

```css
linear-gradient(135deg, #FFB300 0%, #FF5100 50%, #E60067 100%)
```

| Token         | Value     |
| ------------- | --------- |
| Canvas        | `#121318` |
| Elevated      | `#1A1B23` |
| Recessed      | `#16171F` |
| Neon Amber    | `#FFB300` |
| Magma Orange  | `#FF5100` |
| Electric Pink | `#E60067` |

The `NeumorphicButton`, `NeumorphicPanel`, `NeumorphicTrackSlot`,
`NeumorphicKnob` and `NeumorphicSlider` components implement the raised and
recessed illumination model.

## Architecture

```
src/
  assets/logo.png            app icon, titlebar and splash branding
  types/timeline.ts          the .eeyproj schema (single source of truth)
  core/
    project/factory.ts       project, track, clip and preset factories
    project/serialize.ts     validation + serialize/parse round trip
    keyframes/bezier.ts      cubic Bézier solver and curve evaluation
    timeline/engine.ts       timecode, snapping, trim, split, ripple edits
    audio/waveform.ts        peak extraction, envelopes, synthetic preview
    exporter/FFmpegBridge.ts filtergraph compiler
  state/editorStore.ts       observable store, undo/redo, gestures
  components/
    neumorphic/              the component kit
    timeline/                Timeline + KeyframeTrack (canvas)
    player/PreviewPlayer.tsx WebAudio-synced monitor
    layout/                  TitleBar, Splash, MediaBin, Inspector, ExportPanel
  hooks/                     playback clock + keyboard shortcuts
src-tauri/                   Rust host: save/load, ffmpeg, ffprobe
tests/                       Vitest suites (schema, keyframes, timeline, export)
```

### Project format

Projects serialize to `.eeyproj`, a JSON manifest. The schema validates and
normalizes on load and round-trips deterministically:

```
EeyditorProject
├─ resolution, frameRate, sampleRate, duration
├─ tracks: TimelineTrack[]        (video | overlay | effects | text | audio | adjustment)
│   └─ clips: TimelineClip[]
│       ├─ transform: KeyframeCurve per property
│       ├─ volume: AudioEnvelope
│       ├─ effects, transitionIn/Out, text
├─ media: MediaSource[]
├─ markers, renderPreset, metadata
```

### Export pipeline

`buildFfmpegPlan(project, output)` produces:

1. a generated background (`lavfi color`), so gaps resolve to black;
2. one scaled/padded/rotated, alpha-blended stream per visual clip, shifted onto
   the timeline with `setpts`;
3. bottom-up `overlay` composition gated by `between(t, …)`;
4. audio `atrim`/`atempo`/`volume`/`afade`/`adelay` chains mixed with `amix`;
5. codec arguments for CPU (CRF) or hardware (NVENC) presets.

## Development

Requires Node 20+/22+, Rust (stable) and the Tauri system libraries
(`webkit2gtk-4.1`, `gtk+-3.0`, `libsoup-3.0`).

```bash
npm install
npm run dev            # Vite dev server
npm run test           # Vitest (40 tests)
npm run typecheck      # tsc --noEmit
npm run build          # typecheck + production bundle
npm run tauri:dev      # desktop app
npm run tauri:build    # bundled desktop build
```

## Verification status

| Gate                 | Result                     |
| -------------------- | -------------------------- |
| `tsc --noEmit`       | clean                      |
| `vitest run`         | 40 / 40 passed             |
| `vite build`         | success                    |
| `cargo check`        | success                    |

## License

GNU General Public License v3.0. See [`LICENSE`](./LICENSE).
