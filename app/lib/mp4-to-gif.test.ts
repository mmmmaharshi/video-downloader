import { describe, expect, test } from "bun:test";

import { blobToDataUrl, encodeFrames } from "./mp4-to-gif";
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
});
