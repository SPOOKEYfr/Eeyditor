import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../src/core/project/factory";
import { decodeAutosave, encodeAutosave } from "../src/lib/autosave";

describe("autosave records", () => {
  it("round-trips a project with a timestamp", () => {
    const project = createEmptyProject("Autosaved");
    const text = encodeAutosave(project, 1_000);
    const record = decodeAutosave(text, 2_000);
    expect(record?.savedAt).toBe(1_000);
    expect(record?.project.name).toBe("Autosaved");
  });

  it("rejects garbage, stale stamps and empty payloads", () => {
    expect(decodeAutosave(null)).toBeNull();
    expect(decodeAutosave("not json")).toBeNull();
    expect(decodeAutosave(JSON.stringify({ savedAt: 1, project: {} }))).toBeNull();
    const project = createEmptyProject();
    const text = encodeAutosave(project, 1_000);
    expect(decodeAutosave(text, 1_000 + 1000 * 60 * 60 * 24 * 8)).toBeNull();
  });
});
