import { describe, expect, it } from "vitest";
import { parseProbe, parseRate } from "../src/core/media/probe";

describe("ffprobe metadata parsing", () => {
  it("parses rational frame rates", () => {
    expect(parseRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseRate("60/1")).toBe(60);
    expect(parseRate("0/0")).toBeNull();
    expect(parseRate(undefined)).toBeNull();
  });

  it("extracts video and audio metadata", () => {
    const json = JSON.stringify({
      format: { duration: "24.500000" },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          avg_frame_rate: "60000/1001",
          r_frame_rate: "60/1",
        },
        { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
      ],
    });
    const probed = parseProbe(json);
    expect(probed).not.toBeNull();
    expect(probed?.duration).toBeCloseTo(24.5);
    expect(probed?.width).toBe(1920);
    expect(probed?.height).toBe(1080);
    expect(probed?.fps).toBeCloseTo(59.94, 2);
    expect(probed?.sampleRate).toBe(48000);
    expect(probed?.channels).toBe(2);
    expect(probed?.hasVideo).toBe(true);
    expect(probed?.hasAudio).toBe(true);
    expect(probed?.kind).toBe("video");
  });

  it("detects audio-only files", () => {
    const json = JSON.stringify({
      format: { duration: "3.2" },
      streams: [{ codec_type: "audio", sample_rate: "44100", channels: 1 }],
    });
    const probed = parseProbe(json);
    expect(probed?.kind).toBe("audio");
    expect(probed?.hasVideo).toBe(false);
    expect(probed?.hasAudio).toBe(true);
  });

  it("ignores embedded cover art when picking the video stream", () => {
    const json = JSON.stringify({
      format: { duration: "180" },
      streams: [
        {
          codec_type: "video",
          codec_name: "mjpeg",
          width: 600,
          height: 600,
          disposition: { attached_pic: 1 },
        },
        { codec_type: "audio", sample_rate: "48000", channels: 2 },
      ],
    });
    const probed = parseProbe(json);
    expect(probed?.hasVideo).toBe(false);
    expect(probed?.kind).toBe("audio");
  });

  it("rejects invalid payloads and stream-less files", () => {
    expect(parseProbe("not json")).toBeNull();
    expect(parseProbe("")).toBeNull();
    expect(parseProbe(JSON.stringify({ streams: [] }))).toBeNull();
  });
});
