// Module: Mp4ToGif — turn an mp4 download into a real GIF file, in the browser.
// Interface: convertMp4ToGif(src) → Promise<Blob> (needs DOM: video + canvas),
//   encodeFrames(frames) → Promise<Uint8Array> (pure pixels + gifenc, tested in bun).
// The src is the signed same-origin href, so the canvas stays clean: a
// cross-origin file would taint it and block pixel reads.

export interface GifFrame {
  data: Uint8ClampedArray;
  delayMs: number;
  height: number;
  width: number;
}

export const encodeFrames = async (
  frames: GifFrame[]
): Promise<Uint8Array<ArrayBuffer>> => {
  // dynamic so the server bundle never loads it: gifenc ships CJS without
  // named ESM exports, which the Node-based production server cannot import
  const { GIFEncoder, applyPalette, quantize } = await import("gifenc");
  const gif = GIFEncoder();

  for (const frame of frames) {
    const palette = quantize(frame.data, 256);
    const index = applyPalette(frame.data, palette);

    gif.writeFrame(index, frame.width, frame.height, {
      delay: frame.delayMs,
      palette,
    });
  }

  gif.finish();

  return gif.bytes();
};

// an X gif loops for a few seconds; bound the work so a long video cannot hang the tab
const MAX_SECONDS = 6;
const FPS = 10;
const MAX_WIDTH = 480;

const loadVideo = (src: string): Promise<HTMLVideoElement> =>
  // eslint-disable-next-line promise/avoid-new -- media events have no awaitable form; the promise only bridges them
  new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.addEventListener(
      "error",
      () => reject(new Error("video failed to load")),
      { once: true }
    );
    video.addEventListener("loadedmetadata", () => resolve(video), {
      once: true,
    });
    video.src = src;
  });

const grabFrame = (
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  at: number
): Promise<ImageData> =>
  // eslint-disable-next-line promise/avoid-new -- seek events have no awaitable form; the promise only bridges them
  new Promise((resolve, reject) => {
    video.addEventListener("error", () => reject(new Error("seek failed")), {
      once: true,
    });
    video.addEventListener(
      "seeked",
      () => {
        ctx.drawImage(video, 0, 0, ctx.canvas.width, ctx.canvas.height);
        resolve(ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height));
      },
      { once: true }
    );

    video.currentTime = at;
  });

export const convertMp4ToGif = async (src: string): Promise<Blob> => {
  const video = await loadVideo(src);
  const duration = Math.min(video.duration || 0, MAX_SECONDS);

  if (!(duration > 0)) {
    throw new Error("video has no playable duration");
  }

  const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("canvas 2d unavailable");
  }

  const frames: GifFrame[] = [];

  for (let at = 0; at < duration; at += 1 / FPS) {
    // eslint-disable-next-line no-await-in-loop -- frames must come out in time order
    const image = await grabFrame(video, ctx, at);

    frames.push({
      data: image.data,
      delayMs: Math.round(1000 / FPS),
      height,
      width,
    });
  }

  return new Blob([await encodeFrames(frames)], { type: "image/gif" });
};
