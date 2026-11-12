// Module: Mp4ToGif — turn an mp4 download into a real GIF file, in the browser.
// Interface: convertMp4ToGif(src) → Promise<Blob> (extracts frames on the
// main thread, encodes them in a worker where available),
//   extractFrames(src) → Promise<GifFrame[]> (DOM: video + canvas),
//   encodeFrames(frames) → Promise<Uint8Array> (pure pixels + gifenc, tested in bun),
//   encodeInWorker(frames) → Promise<Uint8Array> (same encode, off the main thread),
//   canCopyGif(env?) → boolean (clipboard write support, tested with injected env),
//   pruneGifJobs(jobs) (caps remembered conversions, tested).
// The src is the signed same-origin href, so the canvas stays clean: a
// cross-origin file would taint it and block pixel reads.

export interface GifFrame {
  data: Uint8ClampedArray;
  delayMs: number;
  height: number;
  width: number;
}

// one copy, every app picks the rep it understands
export type ClipboardReps = Record<string, string | Blob>;

// the pieces of browser support the gif copy path needs, injected in tests
// and read from the real environment in the route
export interface GifCopySupport {
  ClipboardItem?: unknown;
  Worker?: unknown;
  clipboardWrite?: unknown;
}

const browserGifSupport = (): GifCopySupport => ({
  ClipboardItem:
    typeof ClipboardItem === "undefined" ? undefined : ClipboardItem,
  Worker: typeof Worker === "undefined" ? undefined : Worker,
  clipboardWrite:
    typeof navigator === "undefined" ? undefined : navigator.clipboard?.write,
});

export const canCopyGif = (
  support: GifCopySupport = browserGifSupport()
): boolean =>
  support.ClipboardItem !== undefined &&
  support.Worker !== undefined &&
  support.clipboardWrite !== undefined;

// remembered conversions stay usable for the session; bound so heavy use
// cannot pile unbounded bitmaps into memory
export const MAX_GIF_JOBS = 3;

// probing the global any other way throws where it does not exist
export const hasWorker = (): boolean => {
  try {
    return Worker !== undefined;
  } catch {
    return false;
  }
};

export const pruneGifJobs = <T>(jobs: Map<string, T>): void => {
  while (jobs.size > MAX_GIF_JOBS) {
    const oldest = jobs.keys().next().value;

    if (oldest === undefined) {
      break;
    }

    jobs.delete(oldest);
  }
};

// gif holds 256 colors at most: fewer posterizes, more is not encodable
const MAX_GIF_COLORS = 256;

// one palette for the whole gif: quantize over spread samples instead of
// per frame — faster and stops colors flickering between frames
export const MAX_SAMPLE_FRAMES = 12;

export const sampleFrames = (
  frames: GifFrame[],
  max: number = MAX_SAMPLE_FRAMES
): GifFrame[] => {
  if (frames.length <= max) {
    return frames;
  }

  if (max < 2) {
    return frames.slice(0, 1);
  }

  const sampled: GifFrame[] = [];

  for (let i = 0; i < max; i += 1) {
    const frame = frames[Math.round((i * (frames.length - 1)) / (max - 1))];

    if (frame !== undefined) {
      sampled.push(frame);
    }
  }

  return sampled;
};

export const encodeFrames = async (
  frames: GifFrame[]
): Promise<Uint8Array<ArrayBuffer>> => {
  // dynamic so the server bundle never loads it: gifenc ships CJS without
  // named ESM exports, which the Node-based production server cannot import
  const { GIFEncoder, applyPalette, quantize } = await import("gifenc");
  const gif = GIFEncoder();
  const sampled = sampleFrames(frames);
  const total = sampled.reduce((sum, frame) => sum + frame.data.length, 0);
  const sample = new Uint8Array(total);

  let offset = 0;

  for (const frame of sampled) {
    sample.set(frame.data, offset);
    offset += frame.data.length;
  }

  const palette = quantize(sample, MAX_GIF_COLORS);

  for (const frame of frames) {
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
const LOAD_TIMEOUT_MS = 15_000;
const SEEK_TIMEOUT_MS = 10_000;

export const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  what: string
): Promise<T> =>
  Promise.race([
    promise,
    // eslint-disable-next-line promise/avoid-new -- a timeout race has no awaitable form; the promise only bridges setTimeout
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    }),
  ]);

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

const extractFrames = async (src: string): Promise<GifFrame[]> => {
  const video = await withTimeout(
    loadVideo(src),
    LOAD_TIMEOUT_MS,
    "video metadata"
  );

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
    const image = await withTimeout(
      grabFrame(video, ctx, at),
      SEEK_TIMEOUT_MS,
      `seek to ${at.toFixed(1)}s`
    );

    frames.push({
      data: image.data,
      delayMs: Math.round(1000 / FPS),
      height,
      width,
    });
  }

  return frames;
};

// frames cross into the worker by value unless transferred; the buffers are
// encode-only, so transfer them instead of paying for a copy
export const encodeInWorker = (
  frames: GifFrame[]
): Promise<Uint8Array<ArrayBuffer>> =>
  // eslint-disable-next-line promise/avoid-new -- worker messages have no awaitable form; the promise only bridges them
  new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("gif-encode.worker.ts", import.meta.url),
      { type: "module" }
    );

    const done = () => worker.terminate();

    worker.addEventListener(
      "message",
      (event) => {
        const data: unknown =
          event instanceof MessageEvent ? event.data : undefined;

        done();

        if (
          data instanceof Object &&
          "bytes" in data &&
          data.bytes instanceof Uint8Array
        ) {
          resolve(Uint8Array.from(data.bytes));
        } else {
          reject(new Error("gif worker failed"));
        }
      },
      { once: true }
    );

    worker.addEventListener(
      "error",
      () => {
        done();
        reject(new Error("gif worker failed"));
      },
      { once: true }
    );

    const transferable: ArrayBuffer[] = [];

    for (const frame of frames) {
      if (frame.data.buffer instanceof ArrayBuffer) {
        transferable.push(frame.data.buffer);
      }
    }

    worker.postMessage({ frames }, transferable);
  });

export const convertMp4ToGif = async (src: string): Promise<Blob> => {
  const frames = await extractFrames(src);
  const encode = hasWorker() ? encodeInWorker : encodeFrames;

  return new Blob([await encode(frames)], { type: "image/gif" });
};

// base64 by hand: FileReader would work in the browser but not in bun's tests,
// while arrayBuffer + btoa runs in both
export const blobToDataUrl = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";

  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + 8192));
  }

  return `data:${blob.type};base64,${btoa(binary)}`;
};
