import { describe, expect, it } from "vitest";
import { formatSrt, formatTimestamp, parseSrt, parseTimestamp } from "../src/core/subtitles/srt";

describe("SRT subtitles", () => {
  it("parses timestamps with comma or dot separators", () => {
    expect(parseTimestamp("00:00:01,250")).toBeCloseTo(1.25);
    expect(parseTimestamp("01:02:03.5")).toBeCloseTo(3723.5);
    expect(parseTimestamp("nope")).toBeNull();
    expect(formatTimestamp(3723.5)).toBe("01:02:03,500");
  });

  it("parses cues, multi-line text and skips broken blocks", () => {
    const cues = parseSrt(
      [
        "1",
        "00:00:00,500 --> 00:00:02,000",
        "First line",
        "second line",
        "",
        "2",
        "00:00:03,000 --> 00:00:04,000",
        "Later cue",
        "",
        "broken block",
        "",
        "3",
        "00:00:01,000 --> 00:00:00,500",
        "Inverted",
      ].join("\n"),
    );
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBeCloseTo(0.5);
    expect(cues[0].text).toBe("First line\nsecond line");
    expect(cues[1].start).toBeCloseTo(3);
  });

  it("round-trips through formatSrt", () => {
    const source =
      "1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n00:00:02,000 --> 00:00:03,250\nWorld\n";
    const parsed = parseSrt(source);
    const reparsed = parseSrt(formatSrt(parsed));
    expect(reparsed.map((cue) => cue.text)).toEqual(["Hello", "World"]);
    expect(reparsed[1].end).toBeCloseTo(3.25);
  });
});
