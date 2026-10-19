import type { MediaSource } from "../../types/timeline";

const THUMB_WIDTH = 176;
const THUMB_HEIGHT = 99;

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): void {
  if (sourceWidth <= 0 || sourceHeight <= 0) return;
  const scale = Math.max(THUMB_WIDTH / sourceWidth, THUMB_HEIGHT / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  ctx.drawImage(image, (THUMB_WIDTH - width) / 2, (THUMB_HEIGHT - height) / 2, width, height);
}

/**
 * Capture a poster frame for a media source. Video seeks to ~10% of its
 * duration; images draw directly. Returns a JPEG data URL, or null when the
 * platform cannot decode the file.
 */
export function captureThumbnail(
  source: MediaSource,
  url: string,
): Promise<string | null> {
  if (typeof document === "undefined" || !url) return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      try {
        resolve(ok ? canvas.toDataURL("image/jpeg", 0.7) : null);
      } catch {
        resolve(null);
      }
    };

    if (source.kind === "image") {
      const image = new Image();
      image.onload = () => {
        ctx.fillStyle = "#0B0C10";
        ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        drawCover(ctx, image, image.naturalWidth, image.naturalHeight);
        finish(true);
      };
      image.onerror = () => finish(false);
      image.src = url;
      return;
    }

    if (!source.hasVideo) {
      finish(false);
      return;
    }

    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      video.removeAttribute("src");
      video.load();
      finish(ok);
    };
    video.onloadeddata = () => {
      const target = Math.min(source.duration > 0 ? source.duration * 0.1 : 1, 2);
      video.onseeked = () => {
        ctx.fillStyle = "#0B0C10";
        ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        drawCover(ctx, video, video.videoWidth, video.videoHeight);
        settle(true);
      };
      try {
        video.currentTime = target;
      } catch {
        ctx.drawImage(video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        settle(true);
      }
    };
    video.onerror = () => settle(false);
    video.src = url;
    video.load();
  });
}
