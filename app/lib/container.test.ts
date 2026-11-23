import { describe, expect, test } from "vitest";

import { containerOf, isManifestContainer } from "./container";
import type { Container } from "./container";

const CASES: [string, string | undefined, Container][] = [
  ["https://x/video.m3u8", undefined, "m3u8"],
  ["https://x/playlist", "application/x-mpegURL", "m3u8"],
  ["https://x/manifest.mpd", undefined, "mpd"],
  ["https://x/stream", "application/dash+xml", "mpd"],
  ["https://x/clip", "video/webm", "webm"],
  ["https://x/clip", "video/quicktime", "mov"],
  ["https://x/clip.mp4?sig=abc", "video/mp4", "mp4"],
  ["https://x/funny.gif", undefined, "gif"],
  ["https://x/funny", "image/gif", "gif"],
  ["https://x/clip", undefined, "mp4"],
];

describe("containerOf", () => {
  test.each(CASES)("reads %s (%s) as .%s", (url, contentType, container) => {
    expect(containerOf(url, contentType)).toBe(container);
  });

  test("only playlist containers count as manifests", () => {
    expect(isManifestContainer("m3u8")).toBe(true);
    expect(isManifestContainer("mpd")).toBe(true);
    expect(isManifestContainer("mp4")).toBe(false);
    expect(isManifestContainer("gif")).toBe(false);
    expect(isManifestContainer("webm")).toBe(false);
    expect(isManifestContainer("mov")).toBe(false);
  });
});
