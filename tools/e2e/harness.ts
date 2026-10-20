import { spawnSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFfmpegPlan } from "../../src/core/exporter/FFmpegBridge";
import type { EeyditorProject } from "../../src/types/timeline";

let failures = 0;
let passes = 0;

export const workDir = mkdtempSync(join(tmpdir(), "eey-e2e-"));

/** Render a project through the real FFmpeg plan; returns the output path. */
export function render(project: EeyditorProject, name: string, container = "mp4"): string | null {
  const out = join(workDir, `${name}.${container}`);
  const plan = buildFfmpegPlan(project, out);
  const result = spawnSync("ffmpeg", plan.args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status === 0) {
    report(true, `${name} (${statSync(out).size} bytes)`);
    return out;
  }
  report(false, name);
  const lines = (result.stderr || "")
    .split("\n")
    .filter((line) => /Error|Invalid|No such|Cannot|Unrecognized|not supported/i.test(line))
    .slice(-5);
  for (const line of lines) console.log(`      ${line.trim()}`);
  return null;
}

export function report(ok: boolean, label: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (ok) passes += 1;
  else failures += 1;
}

/** Decode a single downscaled RGB frame at `time` seconds. */
export function sample(path: string, time: number, size = "16:12"): number[] {
  const result = spawnSync(
    "ffmpeg",
    ["-v", "error", "-ss", String(time), "-i", path, "-frames:v", "1", "-vf", `scale=${size},format=rgb24`, "-f", "rawvideo", "-"],
    { maxBuffer: 1024 * 1024 },
  );
  return result.stdout ? [...result.stdout] : [];
}

export function distance(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + Math.abs(value - (b[index] ?? 0)), 0);
}

export function probe(path: string, entries: string): string {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", entries, "-of", "default=nw=1", path],
    { encoding: "utf8" },
  );
  return (result.stdout || "").trim().split("\n").join(" ");
}

export function exitCode(): number {
  console.log(`\n${passes} passed, ${failures} failed`);
  return failures === 0 ? 0 : 1;
}
