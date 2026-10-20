import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "../src/state/editorStore";
import { createClip, createDemoProject, createEmptyProject, createMediaSource } from "../src/core/project/factory";

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

  it("links clips so they move, split and delete together", () => {
    editorStore.loadProject(createEmptyProject());
    const tracks = editorStore.getState().project.tracks;
    const video = tracks.find((track) => track.type === "video");
    const audio = tracks.find((track) => track.type === "audio");
    if (!video || !audio) throw new Error("missing tracks");
    const first = editorStore.addClip(video.id, 2);
    const second = editorStore.addClip(audio.id, 2);
    editorStore.selectClip(first);
    editorStore.toggleClipSelection(second);
    editorStore.linkSelectedClips();

    const linked = editorStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .filter((clip) => clip.groupId);
    expect(linked).toHaveLength(2);
    expect(new Set(linked.map((clip) => clip.groupId)).size).toBe(1);

    editorStore.selectClip(first);
    editorStore.beginInteraction();
    editorStore.moveClipsLive(first, 4);
    editorStore.commitInteraction("Moved linked clips");
    const starts = editorStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .map((clip) => Math.round(clip.start))
      .sort((a, b) => a - b);
    expect(starts).toEqual([4, 4]);

    editorStore.splitClipAt(first, 5);
    expect(clipCount()).toBe(4);

    editorStore.selectClip(first);
    editorStore.rippleDeleteSelected();
    expect(clipCount()).toBe(0);
  });

  it("blocks timeline edits on locked clips and tracks", () => {
    editorStore.loadProject(createEmptyProject());
    const project = editorStore.getState().project;
    const video = project.tracks.find((track) => track.type === "video");
    const audio = project.tracks.find((track) => track.type === "audio");
    if (!video || !audio) throw new Error("missing tracks");
    const lockedClip = editorStore.addClip(video.id, 0);
    const freeClip = editorStore.addClip(audio.id, 0);
    editorStore.selectClip(lockedClip);
    editorStore.setClipLocked(lockedClip, true);

    const startOf = (id: string) =>
      editorStore
        .getState()
        .project.tracks.flatMap((track) => track.clips)
        .find((clip) => clip.id === id)?.start;

    editorStore.moveClip(lockedClip, 10);
    expect(startOf(lockedClip)).toBe(0);
    editorStore.trimClip(lockedClip, "end", 1);
    const lockedDuration = editorStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((clip) => clip.id === lockedClip)?.duration;
    expect(lockedDuration).toBe(editorStore.getState().project.tracks.flatMap((t) => t.clips).find((c) => c.id === lockedClip)?.duration);
    editorStore.splitClipAt(lockedClip, 2);
    expect(
      editorStore.getState().project.tracks.flatMap((track) => track.clips).filter((clip) => clip.trackId === video.id),
    ).toHaveLength(1);
    editorStore.rippleDeleteSelected();
    expect(
      editorStore.getState().project.tracks.flatMap((track) => track.clips).some((clip) => clip.id === lockedClip),
    ).toBe(true);
    expect(editorStore.getState().status).toBe("Clip is locked");

    editorStore.setClipLocked(lockedClip, false);
    editorStore.moveClip(lockedClip, 10);
    expect(startOf(lockedClip)).toBe(10);

    editorStore.updateProject(
      (current) => ({
        ...current,
        tracks: current.tracks.map((track) =>
          track.id === audio.id ? { ...track, locked: true } : track,
        ),
      }),
      "Locked track",
    );
    editorStore.selectClip(freeClip);
    editorStore.moveClip(freeClip, 5);
    expect(startOf(freeClip)).toBe(0);
  });

  it("replaces or extends the marquee selection", () => {
    editorStore.loadProject(createEmptyProject());
    const track = editorStore.getState().project.tracks[0];
    const first = editorStore.addClip(track.id, 0);
    const second = editorStore.addClip(track.id, 4);
    editorStore.setClipSelection([first, second]);
    expect(editorStore.getState().selectedClipIds).toEqual([first, second]);
    editorStore.setClipSelection([first]);
    editorStore.setClipSelection([second], true);
    expect(editorStore.getState().selectedClipIds).toEqual([first, second]);
    expect(editorStore.getState().selectedClipId).toBe(first);
  });

  it("sets and clears clip transitions", () => {
    editorStore.loadProject(createEmptyProject());
    const track = editorStore.getState().project.tracks[0];
    const id = editorStore.addClip(track.id, 0);
    editorStore.setClipTransition(id, "in", "wipe", 1.25, "up");
    let clip = editorStore
      .getState()
      .project.tracks.flatMap((candidate) => candidate.clips)
      .find((candidate) => candidate.id === id);
    expect(clip?.transitionIn?.kind).toBe("wipe");
    expect(clip?.transitionIn?.duration).toBeCloseTo(1.25);
    expect(clip?.transitionIn?.direction).toBe("up");
    editorStore.setClipTransition(id, "in", "none");
    clip = editorStore
      .getState()
      .project.tracks.flatMap((candidate) => candidate.clips)
      .find((candidate) => candidate.id === id);
    expect(clip?.transitionIn).toBeUndefined();
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

  it("removes and rewrites markers", () => {
    editorStore.loadProject(createEmptyProject());
    editorStore.addMarker(3);
    const marker = editorStore.getState().project.markers[0];
    editorStore.renameMarker(marker.id, "Beat");
    expect(editorStore.getState().project.markers[0].label).toBe("Beat");
    expect(editorStore.getState().project.markers).toHaveLength(1);
    editorStore.removeMarker(marker.id);
    expect(editorStore.getState().project.markers).toHaveLength(0);
  });

  it("toggles the shortcuts overlay", () => {
    expect(editorStore.getState().showShortcuts).toBe(false);
    editorStore.setShortcuts(true);
    expect(editorStore.getState().showShortcuts).toBe(true);
    editorStore.setShortcuts(false);
    expect(editorStore.getState().showShortcuts).toBe(false);
  });
});

describe("dropping media onto lanes", () => {
  beforeEach(() => {
    editorStore.loadProject(createEmptyProject());
  });

  it("places a source on the requested track, overwriting overlaps", () => {
    editorStore.updateProject((project) => ({
      ...project,
      media: [createMediaSource({ id: "s1", path: "generator://a", kind: "video", name: "A", duration: 4, hasVideo: true, hasAudio: false })],
    }), "Adds a media source for the test");
    const video = editorStore.getState().project.tracks.find((track) => track.type === "video")!;
    editorStore.addSourceAt("s1", video.id, 1);
    let clips = editorStore.getState().project.tracks[0].clips;
    expect(clips).toHaveLength(1);
    expect(clips[0].start).toBe(1);
    expect(clips[0].duration).toBeCloseTo(4);

    editorStore.addSourceAt("s1", video.id, 2);
    clips = editorStore.getState().project.tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[0].duration).toBeCloseTo(1);
    expect(clips[1].start).toBe(2);
    expect(clips[1].duration).toBeCloseTo(4);
  });

  it("rejects audio on visual tracks and media on text tracks", () => {
    const source = createMediaSource({ path: "generator://song", kind: "audio", name: "Song", duration: 4, hasVideo: false, hasAudio: true });
    editorStore.updateProject((project) => ({ ...project, media: [source] }), "Adds a media source for the test");
    const before = editorStore.getState().project.tracks.flatMap((track) => track.clips).length;
    const video = editorStore.getState().project.tracks.find((track) => track.type === "video")!;
    editorStore.addSourceAt(source.id, video.id, 0);
    expect(editorStore.getState().status).toBe("Audio goes on audio tracks");
    const text = editorStore.getState().project.tracks.find((track) => track.type === "text")!;
    editorStore.addSourceAt(source.id, text.id, 0);
    expect(editorStore.getState().status).toBe("Drop media on a video or audio track");
    const after = editorStore.getState().project.tracks.flatMap((track) => track.clips).length;
    expect(after).toBe(before);
  });

  it("refuses locked tracks", () => {
    const source = createMediaSource({ path: "generator://v", kind: "video", name: "V", duration: 2, hasVideo: true, hasAudio: false });
    editorStore.updateProject((project) => ({
      ...project,
      media: [source],
      tracks: project.tracks.map((track) =>
        track.type === "video" ? { ...track, locked: true } : track,
      ),
    }), "Locks a track for the test");
    const video = editorStore.getState().project.tracks.find((track) => track.type === "video")!;
    editorStore.addSourceAt(source.id, video.id, 0);
    expect(editorStore.getState().status).toBe("Track is locked");
    expect(editorStore.getState().project.tracks.flatMap((track) => track.clips)).toHaveLength(0);
  });


describe("moving clips across tracks", () => {
  beforeEach(() => {
    editorStore.loadProject(createEmptyProject());
  });

  const seedClip = (trackId: string, kind: string, extra = {}) => {
    const source = createMediaSource({
      path: "generator://x",
      kind: kind as never,
      name: "X",
      duration: 3,
      hasVideo: kind !== "audio",
      hasAudio: kind === "audio",
    });
    editorStore.updateProject(
      (project) => ({ ...project, media: [...project.media, source] }),
      "Seed source",
    );
    const clip = createClip({ trackId, start: 0, duration: 2, kind: kind as never });
    editorStore.updateProject(
      (project) => ({
        ...project,
        tracks: project.tracks.map((track) =>
          track.id === trackId
            ? { ...track, clips: [...track.clips, { ...clip, sourceId: source.id, ...extra }] }
            : track,
        ),
      }),
      "Seed clip",
    );
    return clip.id;
  };

  const trackId = (type: string) =>
    editorStore.getState().project.tracks.find((track) => track.type === type)!.id;

  it(("moves a video clip from the overlay back to the main video track") as never, () => {
    const id = seedClip(trackId("overlay"), "video");
    editorStore.moveClipAcrossLive(id, trackId("video"), 1);
    const clips = editorStore.getState().project.tracks.find((t) => t.type === "video")!.clips;
    expect(clips.map((clip) => clip.id)).toContain(id);
    expect(editorStore.getState().project.tracks.find((t) => t.type === "overlay")!.clips).toHaveLength(0);
  });

  it("refuses audio clips on visual tracks", () => {
    const id = seedClip(trackId("audio"), "audio");
    editorStore.moveClipAcrossLive(id, trackId("video"), 1);
    expect(editorStore.getState().status).toBe("Audio stays on audio tracks");
    const audio = editorStore.getState().project.tracks.find((t) => t.type === "audio")!.clips[0];
    expect(audio.start).toBe(0);
  });

  it("locks the cross-track move behind locked tracks and clips", () => {
    const id = seedClip(trackId("video"), "video", { locked: true });
    editorStore.moveClipAcrossLive(id, trackId("overlay"), 1);
    expect(editorStore.getState().status).toBe("Clip is locked");
  });
});
});

