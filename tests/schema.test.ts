import { describe, expect, it } from "vitest";
import {
  ProjectValidationError,
  cloneProject,
  normalizeProject,
  parseProject,
  serializeProject,
} from "../src/core/project/serialize";
import {
  PROJECT_SCHEMA_VERSION,
  type EeyditorProject,
} from "../src/types/timeline";
import {
  createClip,
  createDemoProject,
  createEmptyProject,
  createMediaSource,
  createTrack,
} from "../src/core/project/factory";

describe("Eeyditor project schema", () => {
  it("round-trips an empty project through .eeyproj serialization", () => {
    const project = createEmptyProject("Round Trip");
    const parsed = parseProject(serializeProject(project));
    expect(parsed).toEqual(project);
    expect(parsed.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it("round-trips the demo project with keyframes, effects and text", () => {
    const project = createDemoProject();
    const text = project.tracks[2].clips[0];
    text.text = { ...text.text!, content: "Title\nLine" };
    text.effects.push({
      id: "fx_test",
      kind: "blur",
      enabled: true,
      amount: 0.5,
      params: { passes: 2, mode: "gaussian" },
    });
    const parsed = parseProject(serializeProject(project));
    expect(parsed).toEqual(project);
    expect(parsed.tracks[2].clips[0].text?.content).toBe("Title\nLine");
    expect(parsed.tracks[2].clips[0].effects[0].params.passes).toBe(2);
  });

  it("produces deterministic, human-readable JSON", () => {
    const project = createEmptyProject("Deterministic");
    const first = serializeProject(project);
    const second = serializeProject(normalizeProject(project));
    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(JSON.parse(first)).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION });
  });

  it("rejects invalid JSON with a typed error", () => {
    expect(() => parseProject("{ not json")).toThrow(ProjectValidationError);
  });

  it("rejects an unsupported future schema version", () => {
    const project = createEmptyProject();
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>;
    raw.schemaVersion = PROJECT_SCHEMA_VERSION + 5;
    expect(() => normalizeProject(raw)).toThrow(/unsupported schema version/);
  });

  it("rejects clips with non-positive duration", () => {
    const project = createEmptyProject();
    const track = project.tracks[0];
    const clip = createClip({ trackId: track.id, duration: 0.0001 });
    clip.duration = 0;
    project.tracks[0].clips.push(clip);
    expect(() => normalizeProject(project)).toThrow(/must be positive/);
  });

  it("normalizes a minimal partial project and fills defaults", () => {
    const normalized = normalizeProject({
      name: "Partial",
      tracks: [
        {
          id: "t1",
          type: "video",
          clips: [{ id: "c1", start: 1, duration: 2 }],
        },
      ],
    });
    expect(normalized.name).toBe("Partial");
    expect(normalized.resolution).toEqual({ width: 1920, height: 1080 });
    expect(normalized.tracks[0].clips[0].transform.opacity.defaultValue).toBe(1);
    expect(normalized.tracks[0].clips[0].speed).toBe(1);
    expect(normalized.metadata.generator).toBe("Eeyditor");
  });

  it("clones without sharing references", () => {
    const project = createDemoProject();
    const clone = cloneProject(project);
    clone.tracks[0].clips[0].name = "mutated";
    expect(project.tracks[0].clips[0].name).not.toBe("mutated");
  });

  it("keeps media and marker inventories through a round trip", () => {
    const project: EeyditorProject = createEmptyProject();
    project.media.push(
      createMediaSource({ path: "/media/a.mp4", kind: "video", hasAudio: true }),
    );
    project.markers.push({ id: "m1", time: 3.5, label: "Beat", color: "#FFB300" });
    const parsed = parseProject(serializeProject(project));
    expect(parsed.media).toHaveLength(1);
    expect(parsed.markers[0].time).toBe(3.5);
  });

  it("assigns stable track defaults by type", () => {
    const track = createTrack("audio", 0);
    expect(track.height).toBeGreaterThan(0);
    expect(track.type).toBe("audio");
  });
});
