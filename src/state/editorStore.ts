import { useSyncExternalStore } from "react";
import {
  type AnimatableProperty,
  type EeyditorProject,
  type Keyframe,
  type KeyframeCurve,
  type TimelineClip,
  type TrackType,
  type Transition,
  type TransitionKind,
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
  moveClipsTo,
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
  selectedClipIds: string[];
  selectedTrackId: string | null;
  status: string;
  showSplash: boolean;
  past: EeyditorProject[];
  future: EeyditorProject[];
}

const HISTORY_LIMIT = 120;

let clipClipboard: TimelineClip[] | null = null;

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
      selectedClipIds: project.tracks[0]?.clips[0]?.id ? [project.tracks[0].clips[0].id] : [],
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

  /** Move every selected clip together, preserving relative offsets. */
  moveClipsLive(anchorId: string, newStart: number): void {
    const state = this.state;
    const ids = this.expandLinked(state.selectedClipIds);
    const snapshot = this.interactionSnapshot ?? state.project;
    const snapshotClips = snapshot.tracks.flatMap((track) => track.clips);
    const anchor = snapshotClips.find((clip) => clip.id === anchorId);
    if (!anchor || ids.length <= 1) {
      this.moveClipLive(anchorId, newStart);
      return;
    }
    let target = Math.max(0, newStart);
    if (state.snapEnabled) {
      const targets = collectSnapTargets(state.project, anchorId);
      target = snapTime(target, targets, SNAP_THRESHOLD_PX / state.zoom).time;
    }
    const starts = ids.map(
      (id) => snapshotClips.find((clip) => clip.id === id)?.start ?? Number.POSITIVE_INFINITY,
    );
    const minStart = Math.min(...starts);
    const delta = Math.max(
      target - anchor.start,
      Number.isFinite(minStart) ? -minStart : 0,
    );
    const targetStarts = new Map<string, number>();
    for (const id of ids) {
      const clip = snapshotClips.find((candidate) => candidate.id === id);
      if (clip) targetStarts.set(id, clip.start + delta);
    }
    this.updateProjectLive((project) => ({
      ...project,
      tracks: project.tracks.map((track) =>
        track.clips.some((clip) => targetStarts.has(clip.id))
          ? { ...track, clips: moveClipsTo(track.clips, targetStarts) }
          : track,
      ),
    }), "Moved clips");
  }

  setClipTransition(
    clipId: string,
    edge: "in" | "out",
    kind: TransitionKind | "none",
    duration = 0.75,
    direction: Transition["direction"] = "left",
  ): void {
    const key = edge === "in" ? "transitionIn" : "transitionOut";
    this.updateClip(clipId, (clip) => {
      if (kind === "none") {
        const next = { ...clip };
        delete next[key];
        return next;
      }
      return {
        ...clip,
        [key]: {
          id: clip[key]?.id ?? makeId("transition"),
          kind,
          duration: Math.max(0.05, duration),
          direction,
        },
      };
    }, `Set ${edge} transition`);
  }

  trimClipLive(clipId: string, edge: "start" | "end", newTime: number): void {
    const ids = new Set(this.expandLinked([clipId]));
    this.updateProjectLive((project) => ({
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          ids.has(clip.id) ? trimClipEngine(clip, edge, newTime) : clip,
        ),
      })),
    }), ids.size > 1 ? "Trimmed linked clips" : "Trimmed clip");
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
    this.patch({
      selectedClipId: clipId,
      selectedClipIds: clipId ? [clipId] : [],
      selectedTrackId: track?.id ?? this.state.selectedTrackId,
    });
  }

  /** Link all selected clips so they move, trim, split and delete together. */
  linkSelectedClips(): void {
    const ids = new Set(this.state.selectedClipIds);
    if (ids.size < 2) {
      this.patch({ status: "Select at least two clips to link" });
      return;
    }
    const groupId = makeId("link");
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => (ids.has(clip.id) ? { ...clip, groupId } : clip)),
      })),
    }), `Linked ${ids.size} clips`);
  }

  /** Break the link group for every clip in the current selection. */
  unlinkSelectedClips(): void {
    const selected = new Set(this.state.selectedClipIds);
    if (this.state.selectedClipId) selected.add(this.state.selectedClipId);
    const groups = new Set(
      this.state.project.tracks
        .flatMap((track) => track.clips)
        .filter((clip) => selected.has(clip.id) && clip.groupId)
        .map((clip) => clip.groupId as string),
    );
    if (groups.size === 0) {
      this.patch({ status: "No linked clips selected" });
      return;
    }
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.groupId && groups.has(clip.groupId) ? { ...clip, groupId: undefined } : clip,
        ),
      })),
    }), "Unlinked clips");
  }

  toggleClipSelection(clipId: string): void {
    const track = this.state.project.tracks.find((candidate) =>
      candidate.clips.some((clip) => clip.id === clipId),
    );
    const selected = new Set(this.state.selectedClipIds);
    if (selected.has(clipId)) selected.delete(clipId);
    else selected.add(clipId);
    const ids = [...selected];
    this.patch({
      selectedClipId: selected.has(clipId) ? clipId : (ids[ids.length - 1] ?? null),
      selectedClipIds: ids,
      selectedTrackId: track?.id ?? this.state.selectedTrackId,
    });
  }

  selectTrack(trackId: string | null): void {
    this.patch({ selectedTrackId: trackId });
  }

  // ---- clipboard ---------------------------------------------------------

  copySelectedClip(): void {
    const clips = this.selectedClips();
    if (clips.length === 0) return;
    clipClipboard = clips.map((clip) => structuredClone(clip));
    this.patch({
      status: clips.length === 1 ? `Copied ${clips[0].name}` : `Copied ${clips.length} clips`,
    });
  }

  cutSelectedClip(): void {
    if (this.state.selectedClipIds.length === 0) return;
    this.copySelectedClip();
    this.rippleDeleteSelected();
  }

  pasteClipboard(): void {
    const sources = clipClipboard;
    if (!sources || sources.length === 0) return;
    const anchor = Math.min(...sources.map((source) => source.start));
    const groups = new Map<string, string>();
    const placed = sources.map((source) => {
      const fallbackType: TrackType = source.kind === "audio" ? "audio" : "video";
      const track =
        this.state.project.tracks.find((candidate) => candidate.id === source.trackId) ??
        this.state.project.tracks.find((candidate) => candidate.type === fallbackType) ??
        this.state.project.tracks[0];
      let groupId = source.groupId;
      if (groupId) {
        const remapped = groups.get(groupId) ?? makeId("link");
        groups.set(groupId, remapped);
        groupId = remapped;
      }
      return {
        ...structuredClone(source),
        id: makeId("clip"),
        trackId: track?.id ?? source.trackId,
        start: Math.max(0, this.state.playhead + (source.start - anchor)),
        groupId,
      } satisfies TimelineClip;
    });
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((candidate) => {
        const additions = placed.filter((clip) => clip.trackId === candidate.id);
        if (additions.length === 0) return candidate;
        return {
          ...candidate,
          clips: [...candidate.clips, ...additions].sort((a, b) => a.start - b.start),
        };
      }),
    }), placed.length === 1 ? "Pasted clip" : `Pasted ${placed.length} clips`);
    this.patch({
      selectedClipId: placed[placed.length - 1]?.id ?? null,
      selectedClipIds: placed.map((clip) => clip.id),
      selectedTrackId: placed[0]?.trackId ?? this.state.selectedTrackId,
    });
  }

  duplicateSelectedClip(): void {
    const sources = this.selectedClips();
    if (sources.length === 0) return;
    const span = Math.max(...sources.map((clip) => clip.start + clip.duration)) -
      Math.min(...sources.map((clip) => clip.start));
    const groups = new Map<string, string>();
    const copies = sources.map((source) => {
      let groupId = source.groupId;
      if (groupId) {
        const remapped = groups.get(groupId) ?? makeId("link");
        groups.set(groupId, remapped);
        groupId = remapped;
      }
      return {
        ...structuredClone(source),
        id: makeId("clip"),
        start: source.start + span,
        groupId,
      };
    });
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((candidate) => {
        const additions = copies.filter((clip) => clip.trackId === candidate.id);
        if (additions.length === 0) return candidate;
        return {
          ...candidate,
          clips: [...candidate.clips, ...additions].sort((a, b) => a.start - b.start),
        };
      }),
    }), copies.length === 1 ? "Duplicated clip" : `Duplicated ${copies.length} clips`);
    this.patch({
      selectedClipId: copies[copies.length - 1]?.id ?? null,
      selectedClipIds: copies.map((clip) => clip.id),
    });
  }

  private selectedClips(): TimelineClip[] {
    const ids = new Set(this.state.selectedClipIds);
    if (ids.size === 0 && this.state.selectedClipId) ids.add(this.state.selectedClipId);
    return this.state.project.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => ids.has(clip.id));
  }

  /** Expand ids to include every clip sharing a link group with the selection. */
  private expandLinked(ids: string[]): string[] {
    const set = new Set(ids);
    if (set.size === 0) return [];
    const clips = this.state.project.tracks.flatMap((track) => track.clips);
    const groups = new Set(
      clips
        .filter((clip) => set.has(clip.id) && clip.groupId)
        .map((clip) => clip.groupId as string),
    );
    if (groups.size === 0) return [...set];
    for (const clip of clips) {
      if (clip.groupId && groups.has(clip.groupId)) set.add(clip.id);
    }
    return [...set];
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
    const clips = this.state.project.tracks.flatMap((track) => track.clips);
    const target = clips.find((clip) => clip.id === clipId);
    if (!target) return;
    const ids = new Set<string>([clipId]);
    if (target.groupId) {
      for (const clip of clips) {
        if (clip.groupId === target.groupId) ids.add(clip.id);
      }
    }
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((track) => {
        const parts: TimelineClip[] = [];
        let changed = false;
        for (const clip of track.clips) {
          if (!ids.has(clip.id)) {
            parts.push(clip);
            continue;
          }
          const split = splitClipEngine(clip, time);
          if (!split) {
            parts.push(clip);
            continue;
          }
          parts.push(...split);
          changed = true;
        }
        return changed
          ? { ...track, clips: parts.sort((a, b) => a.start - b.start) }
          : track;
      }),
    }), ids.size > 1 ? "Split linked clips" : "Split clip");
  }

  splitAtPlayhead(): void {
    const time = this.state.playhead;
    const clips = this.state.project.tracks.flatMap((track) => track.clips);
    const target = clips.find((clip) => time > clip.start && time < clip.start + clip.duration);
    if (target) this.splitClipAt(target.id, time);
  }

  rippleDeleteSelected(): void {
    const baseIds = this.state.selectedClipIds.length > 0
      ? this.state.selectedClipIds
      : this.state.selectedClipId
        ? [this.state.selectedClipId]
        : [];
    if (baseIds.length === 0) return;
    const ids = this.expandLinked(baseIds);
    this.updateProject((project) => ({
      ...project,
      tracks: project.tracks.map((track) => {
        const remove = ids.filter((id) => track.clips.some((clip) => clip.id === id));
        if (remove.length === 0) return track;
        const clips = remove.reduce(
          (current, id) => rippleDeleteEngine(current, id),
          track.clips,
        );
        return { ...track, clips };
      }),
    }), ids.length === 1 ? "Ripple delete" : `Ripple delete ${ids.length} clips`);
    this.patch({ selectedClipId: null, selectedClipIds: [] });
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
      selectedClipIds: [],
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
      selectedClipIds: [],
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
