import type { SubtitleCue } from "../../types/timeline";
import { makeId } from "../project/factory";

const TIMESTAMP = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

/** Parse `HH:MM:SS,mmm` (or `.`) into seconds, or null when malformed. */
export function parseTimestamp(value: string): number | null {
  const match = TIMESTAMP.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes, seconds, millis] = match;
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(millis.padEnd(3, "0")) / 1000
  );
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const millis = Math.round((total - Math.floor(total)) * 1000);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}

/**
 * Parse SubRip text into cues. Blank-line separated blocks, an optional numeric
 * index, one timing line and one or more text lines. Invalid blocks are skipped
 * rather than rejected so a partially broken file is still usable.
 */
export function parseSrt(source: string): SubtitleCue[] {
  const blocks = source.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;
    const [rawStart, rawEnd] = lines[timingIndex].split("-->");
    if (!rawStart || !rawEnd) continue;
    const start = parseTimestamp(rawStart);
    const end = parseTimestamp(rawEnd);
    if (start === null || end === null || end <= start) continue;
    const text = lines
      .slice(timingIndex + 1)
      .join("\n")
      .trim();
    if (!text) continue;
    cues.push({ id: makeId("cue"), start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function formatSrt(cues: SubtitleCue[]): string {
  return `${cues
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((cue, index) =>
      [
        String(index + 1),
        `${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}`,
        cue.text,
      ].join("\n"),
    )
    .join("\n\n")}\n`;
}
