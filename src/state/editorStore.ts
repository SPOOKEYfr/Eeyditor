import { useSyncExternalStore } from "react";
import {
  type AnimatableProperty,
  type EeyditorProject,
  type Keyframe,
  type KeyframeCurve,
  type TrackType,
} from "../types/timeline";
import {
  createClip,
  createEmptyProject,
  createDemoProject,
  createTrack,
  makeId,
  nowIso,
} from "../core/project/factory";
import {
  clampZoom,
  closeGaps as closeGapsEngine,
  MIN_CLIP_DURATION,
  moveClip as moveClipEngine,
  projectDuration,
  rippleDelete as rippleDeleteEngine,
  snapTime,
  collectSnapTargets,
  splitClip as splitClipEngine,
  trimClip as trimClipEngine,
  SNAP_THRESHOLD_PX,
} from "../core/timeline/engine";
import {
  createKeyframe,
  evaluateCurve,
  removeKeyframe,
  upsertKeyframe,
} from "../core/keyframes/bezier";
import { cloneProject } from "../core/project/serialize";

export type EditorTool = "select" | "blade";

export interface EditorState {
  project: EeyditorProject;
  playhead: number;
  playing: boolean;
  loop: boolean;
  zoom: number;
  scroll: number;
  tool: EditorTool;
  snapEnabled: boolean;
  selectedClipId: string | null;
  selectedTrackId: string | null;
  status: string;
  showSplash: boolean;
  past: EeyditorProject[];
  future: EeyditorProject[];
}

const HISTORY_LIMIT = 120;

type TransformKey = "positionX" | "positionY" | "scaleX" | "scaleY" | "rotation" | "opacity";
const TRANSFORM_KEYS: readonly TransformKey[] = [
  "positionX",
  "positionY",
  "scaleX",
  "scaleY",
  "rotation",
  "opacity",
];

function isTransformKey(property: AnimatableProperty): property is TransformKey {
  return (TRANSFORM_KEYS as readonly string[]).includes(property);
}

class EditorStore {
  private state: EditorState;
  private listeners = new Set<() => void>();

  constructor(project: EeyditorProject) {
    this.state = {
      project,
      playhead: 0,
      playing: false,
      loop: false,
      zoom: 48,
      scroll: 0,
      tool: "select",
      snapEnabled: true,
      selectedClipId: project.tracks[0]?.clips[0]?.id ?? null,
      selectedTrackId: project.tracks[0]?.id ?? null,
      status: "Ready",
      showSplash: true,
      past: [],
      future: [],
    };
  }

  getState = (): EditorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private patch(partial: Partial<EditorState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private commitProject(project: EeyditorProject, label: string, history = true): void {
    const nextProject: EeyditorProject = {
      ...project,
      metadata: { ...project.metadata, modifiedAt: nowIso() },
    };
    if (history) {
      const past = [...this.state.past, this.state.project].slice(-HISTORY_LIMIT);
      this.patch({ project: nextProject, past, future: [], status: label });
    } else {
      this.patch({ project: nextProject, status: label });
    }
  }

  updateProject(recipe: (project: EeyditorProject) => EeyditorProject, label: string, history = true): void {
    this.commitProject(recipe(this.state.project), label, history);
  }

  private interactionSnapshot: EeyditorProject | null = null;

  /** Begin a pointer gesture; all live updates coalesce into one undo entry. */
  beginInteraction(): void {
    this.interactionSnapshot = this.state.project;
  }

  updateProjectLive(recipe: (project: EeyditorProject) => EeyditorProject, label: string): void {
    this.commitProject(recipe(this.state.project), label, false);
  }

  commitInteraction(label: string): void {
    if (this.interactionSnapshot) {
      const past = [...this.state.past, this.interactionSnapshot].slice(-HISTORY_LIMIT);
      this.patch({ past, future: [], status: label });
      this.interactionSnapshot = null;
    }
  }

  cancelInteraction(): void {
    if (this.interactionSnapshot) {
      this.patch({ project: this.interactionSnapshot, status: "Cancelled" });
      this.interactionSnapshot = null;
    }
  }

  /** Move a clip without creating per-frame history entries. */
  moveClipLive(clipId: string, newStart: number): void {
    const state = this.state;
    let target = Math.max(0, newStart);
    if (state.snapEnabled) {
      const targets = collectSnapTargets(state.project, clipId);
      target = snapTime(target, targets, SNAP_THRESHOLD_PX / state.zoom).time;
    }
    this.updateProjectLive((project) => ({
      ...project,
      tracks: project.tracks.map((track) => {
        if (!track.clips.some((clip) => clip.id === clipId)) return track;
        return { ...track, clips: moveClipEngine(track.clips, clipId, target) };
      }),
    }), "Moved clip");
  }

  trimClipLive(clipId: string, edge: "start" | "end", newTime: number): void {
    this.updateProjectLive((project) => ({
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId ? trimClipEngine(clip, edge, newTime) : clip,
        ),
      })),
    }), "Trimmed clip");
  }

  // ---- transport ---------------------------------------------------------

  setPlayhead(time: number): void {
    const duration = projectDuration(this.state.project);
    const clamped = Math.max(0, Math.min(time, duration));
    this.patch({ playhead: clamped });
  }

  setPlaying(playing: boolean): void {
    this.patch({ playing, status: playing ? "Playing" : "Paused" });
  }

  togglePlay(): void {
    this.setPlaying(!this.state.playing);
  }

  toggleLoop(): void {
    this.patch({ loop: !this.state.loop });
  }

  toggleSnap(): void {
    this.patch({ snapEnabled: !this.state.snapEnabled });
  }

  tick(deltaSeconds: number): void {
    if (!this.state.playing) return;
    const project = this.state.project;
    const duration = Math.max(projectDuration(project), 0.001);
    let next = this.state.playhead + deltaSeconds;
    if (next >= duration) {
      if (this.state.loop) {
        next = next % duration;
      } else {
        this.patch({ playhead: duration, playing: false, status: "Reached end" });
        return;
      }
    }
    this.patch({ playhead: next });
  }

  // ---- viewport ----------------------------------------------------------

  setZoom(zoom: number, anchorPixel = 0): void {
    const nextZoom = clampZoom(zoom);
    const anchorTime = (this.state.scroll + anchorPixel) / this.state.zoom;
    const nextScroll = Math.max(0, anchorTime * nextZoom - anchorPixel);
    this.patch({ zoom: nextZoom, scroll: nextScroll });
  }

  zoomBy(factor: number, anchorPixel = 0): void {
    this.setZoom(this.state.zoom * factor, anchorPixel);
  }

  setScroll(scroll: number): void {
    this.patch({ scroll: Math.max(0, scroll) });
  }

  setTool(tool: EditorTool): void {
    this.patch({ tool, status: tool === "blade" ? "Blade tool" : "Select tool" });
  }

  // ---- selection ---------------------------------------------------------

  selectClip(clipId: string | null): void {
    const track = clipId
      ? this.state.project.tracks.find((candidate) =>
          candidate.clips.some((clip) => clip.id === clipId),
        )
      : undefined;
    this.patch({ selectedClipId: clipId, selectedTrackId: track?.id ?? this.state.selectedTrackId });
  }

  selectTrack(trackId: string | null): void {
    this.patch({ selectedTrackId: trackId });
  }

  // ---- editing -----------------------------------------------------------

  addTrack(type: TrackType): void {
    this.updateProject((project) => {
      const count = project.tracks.filter((track) => track.type === type).length;
      const track = createTrack(type, count);
      const tracks = [...project.tracks, track];
      return { ...project, tracks };
    }, `Added ${type} track`);
  }

  removeTrack(trackId: string): void {
    this.updateProject(
      (project) => ({ ...project, tracks: project.tracks.filter((t) => t.id !== trackId) }),
      "Removed track",
    );
  }

  addClip(trackId: string, start: number): string {
    const track = this.state.project.tracks.find((candidate) => candidate.id === trackId);
    const kind = track?.type === "audio" ? "audio" : track?.type === "text" ? "text" : "video";
    const clip = createClip({ trackId, start, duration: 4, kind, colorIndex: Math.floor(start) });
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((candidate) =>
        candidate.id === trackId
          ? { ...candidate, clips: [...candidate.clips, clip].sort((a, b) => a.start - b.start) }
          : candidate,
      ),
    }), "Added clip");
    return clip.id;
  }

  updateClip(clipId: string, recipe: (clip: ReturnType<typeof createClip>) => ReturnType<typeof createClip>, label = "Updated clip"): void {
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => (clip.id === clipId ? recipe(clip) : clip)),
      })),
    }), label);
  }

  moveClip(clipId: string, newStart: number): void {
    const state = this.state;
    let target = Math.max(0, newStart);
    if (state.snapEnabled) {
      const targets = collectSnapTargets(state.project, clipId);
      const threshold = SNAP_THRESHOLD_PX / state.zoom;
      target = snapTime(target, targets, threshold).time;
    }
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((track) => {
        if (!track.clips.some((clip) => clip.id === clipId)) return track;
        return { ...track, clips: moveClipEngine(track.clips, clipId, target) };
      }),
    }), "Moved clip");
  }

  trimClip(clipId: string, edge: "start" | "end", newTime: number): void {
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId ? trimClipEngine(clip, edge, newTime) : clip,
        ),
      })),
    }), "Trimmed clip");
  }

  splitClipAt(clipId: string, time: number): void {
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((track) => {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (!clip) return track;
        const parts = splitClipEngine(clip, time);
        if (!parts) return track;
        const others = track.clips.filter((candidate) => candidate.id !== clipId);
        return { ...track, clips: [...others, ...parts].sort((a, b) => a.start - b.start) };
      }),
    }), "Split clip");
  }

  splitAtPlayhead(): void {
    const time = this.state.playhead;
    const clips = this.state.project.tracks.flatMap((track) => track.clips);
    const target = clips.find((clip) => time > clip.start && time < clip.start + clip.duration);
    if (target) this.splitClipAt(target.id, time);
  }

  rippleDeleteSelected(): void {
    const clipId = this.state.selectedClipId;
    if (!clipId) return;
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((track) =>
        track.clips.some((clip) => clip.id === clipId)
          ? { ...track, clips: rippleDeleteEngine(track.clips, clipId) }
          : track,
      ),
    }), "Ripple delete");
    this.patch({ selectedClipId: null });
  }

  closeGaps(trackId: string): void {
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((track) =>
        track.id === trackId ? { ...track, clips: closeGapsEngine(track.clips) } : track,
      ),
    }), "Closed gaps");
  }

  setClipSpeed(clipId: string, speed: number): void {
    const safe = Math.max(0.1, Math.min(10, speed));
    this.updateClip(clipId, (clip) => ({ ...clip, speed: safe }), "Changed speed");
  }

  // ---- keyframes ---------------------------------------------------------

  addKeyframeAtPlayhead(clipId: string, property: AnimatableProperty): void {
    const time = this.state.playhead;
    this.updateClip(clipId, (clip) => {
      const local = time - clip.start;
      const curve = getCurve(clip, property);
      if (!curve) return clip;
      const value = evaluateCurve(curve, local);
      const keyframe = createKeyframe(makeId("kf"), local, value, "bezier");
      return setCurve(clip, property, { ...curve, keyframes: upsertKeyframe(curve.keyframes, keyframe) });
    }, "Added keyframe");
  }

  moveKeyframe(clipId: string, property: AnimatableProperty, keyframeId: string, time: number): void {
    this.updateClip(clipId, (clip) => {
      const curve = getCurve(clip, property);
      if (!curve) return clip;
      const clamped = Math.max(0, Math.min(time, clip.duration));
      const keyframes = curve.keyframes.map((keyframe) =>
        keyframe.id === keyframeId ? { ...keyframe, time: clamped } : keyframe,
      );
      return setCurve(clip, property, { ...curve, keyframes: [...keyframes].sort((a, b) => a.time - b.time) });
    }, "Moved keyframe");
  }

  updateKeyframeValue(clipId: string, property: AnimatableProperty, keyframeId: string, value: number): void {
    this.updateClip(clipId, (clip) => {
      const curve = getCurve(clip, property);
      if (!curve) return clip;
      const keyframes = curve.keyframes.map((keyframe) =>
        keyframe.id === keyframeId ? { ...keyframe, value } : keyframe,
      );
      return setCurve(clip, property, { ...curve, keyframes });
    }, "Updated keyframe");
  }

  updateKeyframeInterpolation(clipId: string, property: AnimatableProperty, keyframeId: string, interpolation: Keyframe["interpolation"]): void {
    this.updateClip(clipId, (clip) => {
      const curve = getCurve(clip, property);
      if (!curve) return clip;
      const keyframes = curve.keyframes.map((keyframe) =>
        keyframe.id === keyframeId ? { ...keyframe, interpolation } : keyframe,
      );
      return setCurve(clip, property, { ...curve, keyframes });
    }, "Changed interpolation");
  }

  updateKeyframeHandle(
    clipId: string,
    property: AnimatableProperty,
    keyframeId: string,
    handle: "inHandle" | "outHandle",
    position: { x: number; y: number },
  ): void {
    this.updateClip(clipId, (clip) => {
      const curve = getCurve(clip, property);
      if (!curve) return clip;
      const keyframes = curve.keyframes.map((keyframe) =>
        keyframe.id === keyframeId
          ? { ...keyframe, interpolation: "bezier" as const, [handle]: position }
          : keyframe,
      );
      return setCurve(clip, property, { ...curve, keyframes });
    }, "Adjusted curve handle");
  }

  /** Mutate a curve during a drag gesture without per-frame undo entries. */
  updateKeyframesLive(
    clipId: string,
    property: AnimatableProperty,
    recipe: (keyframes: Keyframe[]) => Keyframe[],
  ): void {
    this.updateProjectLive((project) => ({
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id !== clipId) return clip;
          const curve = getCurve(clip, property);
          if (!curve) return clip;
          return setCurve(clip, property, { ...curve, keyframes: recipe(curve.keyframes) });
        }),
      })),
    }), "Adjusted keyframe");
  }

  removeKeyframeById(clipId: string, property: AnimatableProperty, keyframeId: string): void {
    this.updateClip(clipId, (clip) => {
      const curve = getCurve(clip, property);
      if (!curve) return clip;
      return setCurve(clip, property, { ...curve, keyframes: removeKeyframe(curve.keyframes, keyframeId) });
    }, "Removed keyframe");
  }

  // ---- markers -----------------------------------------------------------

  addMarker(time: number): void {
    this.updateProject((project) => ({
      ...project,
      markers: [...project.markers, { id: makeId("marker"), time, label: "Marker", color: "#FFB300" }],
    }), "Added marker");
  }

  // ---- history / project lifecycle --------------------------------------

  undo(): void {
    const { past } = this.state;
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    this.patch({
      project: previous,
      past: past.slice(0, -1),
      future: [this.state.project, ...this.state.future].slice(0, HISTORY_LIMIT),
      status: "Undo",
    });
  }

  redo(): void {
    const { future } = this.state;
    if (future.length === 0) return;
    const next = future[0];
    this.patch({
      project: next,
      past: [...this.state.past, this.state.project].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      status: "Redo",
    });
  }

  newProject(): void {
    const project = createEmptyProject();
    this.patch({
      project,
      past: [],
      future: [],
      playhead: 0,
      playing: false,
      scroll: 0,
      zoom: 48,
      selectedClipId: null,
      selectedTrackId: project.tracks[0]?.id ?? null,
      status: "New project",
    });
  }

  loadProject(project: EeyditorProject): void {
    const safe = cloneProject(project);
    this.patch({
      project: safe,
      past: [],
      future: [],
      playhead: 0,
      playing: false,
      scroll: 0,
      selectedClipId: null,
      selectedTrackId: safe.tracks[0]?.id ?? null,
      status: `Loaded ${safe.name}`,
    });
  }

  setStatus(status: string): void {
    this.patch({ status });
  }

  setSplash(showSplash: boolean): void {
    this.patch({ showSplash });
  }
}

export function getCurve(clip: ReturnType<typeof createClip>, property: AnimatableProperty): KeyframeCurve | null {
  if (property === "volume") {
    return { property: "volume", defaultValue: clip.volume.gainDb, keyframes: clip.volume.keyframes };
  }
  if (isTransformKey(property)) {
    return clip.transform[property];
  }
  return null;
}

function setCurve(
  clip: ReturnType<typeof createClip>,
  property: AnimatableProperty,
  curve: KeyframeCurve,
): ReturnType<typeof createClip> {
  if (property === "volume") {
    return { ...clip, volume: { ...clip.volume, gainDb: curve.defaultValue, keyframes: curve.keyframes } };
  }
  if (isTransformKey(property)) {
    return { ...clip, transform: { ...clip.transform, [property]: curve } };
  }
  return clip;
}

export const editorStore = new EditorStore(createDemoProject());

export function useEditor(): EditorState {
  return useSyncExternalStore(editorStore.subscribe, editorStore.getState, editorStore.getState);
}

export function useEditorSelector<T>(selector: (state: EditorState) => T): T {
  return useSyncExternalStore(
    editorStore.subscribe,
    () => selector(editorStore.getState()),
    () => selector(editorStore.getState()),
  );
}

export { MIN_CLIP_DURATION };
