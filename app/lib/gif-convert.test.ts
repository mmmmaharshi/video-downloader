// Unit tests for the side-effect-free gif surface: sampling, encoding,
// data urls, and support detection with injected environments.

import { describe, expect, test } from "vitest";

import {
  blobToDataUrl,
  canCopyGif,
  encodeFrames,
  sampleFrames,
} from "./gif-convert";
import type { GifFrame } from "./gif-convert";

const frame = (seed: number): GifFrame => ({
  data: new Uint8ClampedArray([seed, seed + 1, seed + 2, 255]),
  delayMs: 100,
  height: 1,
  width: 1,
});

describe("gif-convert", () => {
  test("sampling keeps a short list whole", () => {
    expect(sampleFrames([frame(1), frame(2)])).toHaveLength(2);
  });

  test("sampling spreads across a long list", () => {
    const frames = Array.from({ length: 60 }, (_, i) => frame(i));

    expect(sampleFrames(frames, 12)).toHaveLength(12);
  });

  test("sampling a single slot keeps the first frame", () => {
    expect(sampleFrames([frame(9), frame(10)], 1)).toEqual([frame(9)]);
  });

  test("encoding a frame produces gif bytes", async () => {
    const bytes = await encodeFrames([frame(200)]);

    expect(bytes.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe("GIF89a");
  });

  test("a blob round-trips through a data url", async () => {
    const blob = new Blob(["gif-bytes"], { type: "image/gif" });

    expect(await blobToDataUrl(blob)).toBe(
      `data:image/gif;base64,${btoa("gif-bytes")}`
    );
  });

  test("copying needs both a ClipboardItem and a write", () => {
    expect(
      canCopyGif({
        ClipboardItem: { supports: () => true },
        clipboardWrite: () => {},
      })
    ).toBe(true);
    expect(canCopyGif({})).toBe(false);
    expect(canCopyGif({ ClipboardItem: { supports: () => true } })).toBe(false);
  });
});
