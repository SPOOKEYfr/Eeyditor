import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "../src/state/editorStore";
import { createDemoProject, createEmptyProject } from "../src/core/project/factory";

function firstClipId(): string {
  const project = editorStore.getState().project;
  for (const track of project.tracks) {
    if (track.clips.length > 0) return track.clips[0].id;
  }
  throw new Error("demo project has no clips");
}

function clipCount(): number {
  return editorStore.getState().project.tracks.reduce(
    (total, track) => total + track.clips.length,
    0,
  );
}

describe("clip clipboard", () => {
  beforeEach(() => {
    editorStore.loadProject(createDemoProject());
  });

  it("pastes a copy at the playhead", () => {
    editorStore.selectClip(firstClipId());
    const before = clipCount();
    editorStore.setPlayhead(5);
    editorStore.copySelectedClip();
    editorStore.pasteClipboard();
    expect(clipCount()).toBe(before + 1);
    const selected = editorStore.getState().selectedClipId;
    const clip = editorStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === selected);
    expect(clip?.start).toBeCloseTo(5);
  });

  it("moves a multi-selection together and deletes it", () => {
    editorStore.loadProject(createEmptyProject());
    const track = editorStore.getState().project.tracks[0];
    const first = editorStore.addClip(track.id, 1);
    const second = editorStore.addClip(track.id, 5);
    editorStore.addClip(track.id, 9);
    editorStore.selectClip(first);
    editorStore.toggleClipSelection(second);
    expect(editorStore.getState().selectedClipIds).toEqual([first, second]);
    editorStore.beginInteraction();
    editorStore.moveClipsLive(first, 3);
    editorStore.commitInteraction("Moved clips");
    const starts = () =>
      editorStore
        .getState()
        .project.tracks.flatMap((candidate) => candidate.clips)
        .map((clip) => Math.round(clip.start))
        .sort((a, b) => a - b);
    expect(starts()).toEqual([3, 7, 11]);
    editorStore.rippleDeleteSelected();
    expect(clipCount()).toBe(1);
  });

  it("duplicates inline after the original", () => {
    const id = firstClipId();
    editorStore.selectClip(id);
    const original = editorStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === id);
    const before = clipCount();
    editorStore.duplicateSelectedClip();
    expect(clipCount()).toBe(before + 1);
    const selected = editorStore.getState().selectedClipId;
    const copy = editorStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === selected);
    expect(copy?.start).toBeCloseTo((original?.start ?? 0) + (original?.duration ?? 0));
  });
});
