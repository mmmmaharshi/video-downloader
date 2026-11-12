import { describe, expect, test } from "bun:test";

import {
  blobToDataUrl,
  canCopyGif,
  encodeFrames,
  pruneGifJobs,
  sampleFrames,
  withTimeout,
} from "./mp4-to-gif";
import type { GifFrame } from "./mp4-to-gif";

const frame = (pixels: [number, number, number][]): GifFrame => {
  const data = new Uint8ClampedArray(4 * 2 * 2);

  for (const [i, [r, g, b]] of pixels.entries()) {
    data.set([r, g, b, 255], i * 4);
  }

  return { data, delayMs: 100, height: 2, width: 2 };
};

const headerOf = (bytes: Uint8Array): string =>
  String.fromCodePoint(...bytes.subarray(0, 6));

const writeTrue = () => Promise.resolve();

describe("encodeFrames", () => {
  test("encodes frames into gif bytes", async () => {
    const bytes = await encodeFrames([
      frame([
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 255],
      ]),
      frame([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ]);

    expect(headerOf(bytes)).toBe("GIF89a");
    expect(bytes.length).toBeGreaterThan(13);
  });

  test("a single frame still ends with the gif trailer", async () => {
    const bytes = await encodeFrames([
      frame([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
        [10, 11, 12],
      ]),
    ]);

    expect(headerOf(bytes)).toBe("GIF89a");
    expect(bytes.at(-1)).toBe(0x3b);
  });

  test("encodes a blob as a data url", async () => {
    expect(await blobToDataUrl(new Blob(["abc"], { type: "image/gif" }))).toBe(
      "data:image/gif;base64,YWJj"
    );
  });

  test("withTimeout passes through fast work", async () => {
    await expect(
      withTimeout(Promise.resolve("done"), 1000, "work")
    ).resolves.toBe("done");
  });

  test("withTimeout rejects stalled work instead of hanging", async () => {
    // eslint-disable-next-line promise/avoid-new -- a never-settling promise is the stall itself
    const stalled = new Promise<string>(() => {});

    await expect(withTimeout(stalled, 10, "seek")).rejects.toThrow(
      "seek timed out"
    );
  });

  test("reports no support without browser apis", () => {
    expect(canCopyGif({})).toBe(false);
  });

  test("reports no support when the clipboard cannot write", () => {
    expect(canCopyGif({ ClipboardItem: {}, clipboardWrite: undefined })).toBe(
      false
    );
  });

  test("does not need a worker to allow copying", () => {
    expect(canCopyGif({ ClipboardItem: {}, clipboardWrite: writeTrue })).toBe(
      true
    );
  });

  test("pruneGifJobs keeps only the latest conversions", () => {
    const jobs = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);

    pruneGifJobs(jobs);

    expect([...jobs.keys()]).toEqual(["b", "c", "d"]);
  });

  test("samples evenly across many frames and keeps the ends", () => {
    const frames = Array.from({ length: 60 }, (_, i): GifFrame => ({
      data: new Uint8ClampedArray([i, 0, 0, 255]),
      delayMs: 100,
      height: 1,
      width: 1,
    }));

    const sampled = sampleFrames(frames);

    expect(sampled.length).toBeLessThanOrEqual(12);
    expect(sampled[0]).toBe(frames[0]);
    expect(sampled.at(-1)).toBe(frames.at(-1));
  });

  test("keeps every frame when there are few", () => {
    const frames = [
      frame([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
        [10, 11, 12],
      ]),
    ];

    expect(sampleFrames(frames)).toEqual(frames);
  });
});
