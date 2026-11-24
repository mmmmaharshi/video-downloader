// Module: GifConvert — turn an mp4 download into a real GIF file, in the
// browser. Pure functions plus browser fns: extractFrames reads pixels off a
// video element, encodeFrames quantizes one shared palette, convertMp4ToGif
// runs the encode off the main thread with an inline fallback.
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
// and read from the real environment by callers
export interface GifCopySupport {
  ClipboardItem?: { supports?: (type: string) => boolean };
  clipboardWrite?: unknown;
}

// globals are probed by reference inside try: referencing a missing one
// throws, which is the only honest existence check outside typeof
const probe = <T>(read: () => T): T | undefined => {
  try {
    return read();
  } catch {
    return undefined;
  }
};

const browserGifSupport = (): GifCopySupport => ({
  ClipboardItem: probe(() => ClipboardItem),
  clipboardWrite: probe(() => navigator.clipboard?.write),
});

export const canCopyGif = (
  support: GifCopySupport = browserGifSupport()
): boolean =>
  support.ClipboardItem !== undefined && support.clipboardWrite !== undefined;

// probing the global by reference throws where it does not exist;
// prefetching a conversion is only safe when it can run off the main thread,
// while the encode path itself also falls back inline when the worker fails
export const hasWorker = (): boolean => {
  try {
    return Worker !== undefined;
  } catch {
    return false;
  }
};

// gif holds 256 colors at most: fewer posterizes, more is not encodable
const MAX_GIF_COLORS = 256;

// one palette for the whole gif: quantize over spread samples instead of
// per frame — faster and stops colors flickering between frames
const MAX_SAMPLE_FRAMES = 12;

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
  // dynamic so the encoder loads on first conversion instead of weighing
  // down the initial bundle: gifenc ships CJS without named ESM exports
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

const withTimeout = <T>(
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

  if (duration <= 0) {
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
    // eslint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop -- frames must come out in time order
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

// frames are cloned, not transferred: a transfer detaches the caller's buffers,
// and convertMp4ToGif must still be able to encode them inline if the worker fails
const encodeInWorker = (frames: GifFrame[]): Promise<Uint8Array<ArrayBuffer>> =>
  // eslint-disable-next-line promise/avoid-new -- worker messages have no awaitable form; the promise only bridges them
  new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("gif-encode.worker.ts", import.meta.url),
      {
        type: "module",
      }
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

    // eslint-disable-next-line unicorn/require-post-message-target-origin -- this is Worker.postMessage, which has no targetOrigin
    worker.postMessage({ frames });
  });

export const convertMp4ToGif = async (src: string): Promise<Blob> => {
  const frames = await extractFrames(src);

  if (hasWorker()) {
    try {
      return new Blob([await encodeInWorker(frames)], { type: "image/gif" });
    } catch {
      // keep the frames: the inline encode below still needs them
    }
  }

  return new Blob([await encodeFrames(frames)], { type: "image/gif" });
};

// base64 by hand: FileReader works in the browser but not in node tests,
// while arrayBuffer + btoa runs in both
export const blobToDataUrl = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";

  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + 8192));
  }

  return `data:${blob.type};base64,${btoa(binary)}`;
};

// an X gif has no gif file to point an <img> at, so its reps are built from
// the converted bytes: an inline image for rich-text apps, the link for chats
export const convertedReps = async (
  blob: Blob,
  videoUrl: string
): Promise<ClipboardReps> => {
  const dataUrl = await blobToDataUrl(blob);

  return {
    "text/html": `<img src="${dataUrl}" alt="GIF">`,
    "text/plain": videoUrl,
  };
};

// a gif file already exists at the href: bytes where the clipboard takes
// them, an html image for rich-text apps, the link for chats (which unfurl it)
export const gifFileReps = async (
  videoUrl: string,
  downloadHref: string,
  support: GifCopySupport = browserGifSupport()
): Promise<ClipboardReps> => {
  // the url comes from a remote page: keep it inside the attribute
  const html = `<img src="${videoUrl.replaceAll('"', "%22")}" alt="GIF">`;

  if (support.ClipboardItem?.supports?.("image/gif")) {
    const res = await fetch(downloadHref);

    if (!res.ok) {
      throw new Error(`downloadHref returned ${res.status}`);
    }

    return {
      "image/gif": await res.blob(),
      "text/html": html,
      "text/plain": videoUrl,
    };
  }

  return { "text/html": html, "text/plain": videoUrl };
};
