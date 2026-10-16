import { describe, expect, test } from "bun:test";

import type { VideoAsset } from "./media-resolver";
import { closedPreview, nextPreview } from "./preview";
import type { PreviewState } from "./preview";

const asset = (
  shortcode: string,
  videoUrl = `https://video.twimg.com/${shortcode}.mp4`
): VideoAsset => ({
  platform: "twitter",
  shortcode,
  sourceUrl: `https://x.com/u/status/${shortcode}`,
  thumbnail: "https://pbs.twimg.com/thumb.jpg",
  videoUrl,
});

const openOn = (shown: VideoAsset[], active = 0): PreviewState => ({
  active,
  open: true,
  shown,
});

describe("nextPreview", () => {
  test("opens on a resolved response, showing the first asset", () => {
    const assets = [asset("1"), asset("2")];
    expect(nextPreview(closedPreview, { assets, type: "resolved" })).toEqual({
      active: 0,
      open: true,
      shown: assets,
    });
  });

  test("reopens when the same link resolves again — equal content, fresh response", () => {
    const again = [asset("1")];
    const next = nextPreview(openOn([asset("1")]), {
      assets: again,
      type: "resolved",
    });
    expect(next.open).toBe(true);
    expect(next.shown).toBe(again);
    expect(next.active).toBe(0);
  });

  test("replaces the shown list when a different link resolves", () => {
    const next = nextPreview(openOn([asset("1")]), {
      assets: [asset("2"), asset("3")],
      type: "resolved",
    });
    expect(next).toEqual({
      active: 0,
      open: true,
      shown: [asset("2"), asset("3")],
    });
  });

  test("closes an open preview on a failed response", () => {
    expect(nextPreview(openOn([asset("1")]), { type: "failed" })).toEqual({
      active: 0,
      open: false,
      shown: [asset("1")],
    });
  });

  test("stays closed on a failed response when already closed", () => {
    expect(nextPreview(closedPreview, { type: "failed" })).toBe(closedPreview);
  });

  test("closes on dismissed", () => {
    expect(nextPreview(openOn([asset("1")]), { type: "dismissed" }).open).toBe(
      false
    );
  });

  test("stays closed on dismissed when already closed", () => {
    expect(nextPreview(closedPreview, { type: "dismissed" })).toBe(
      closedPreview
    );
  });

  test("selected flips to that video", () => {
    const next = nextPreview(openOn([asset("1"), asset("2")]), {
      index: 1,
      type: "selected",
    });
    expect(next).toEqual({
      active: 1,
      open: true,
      shown: [asset("1"), asset("2")],
    });
  });

  test("selected ignores an index past the end", () => {
    const state = openOn([asset("1")]);
    expect(nextPreview(state, { index: 1, type: "selected" })).toBe(state);
  });

  test("selected ignores a negative index", () => {
    const state = openOn([asset("1")]);
    expect(nextPreview(state, { index: -1, type: "selected" })).toBe(state);
  });

  test("selected keeps the reference when nothing changes", () => {
    const state = openOn([asset("1"), asset("2")], 1);
    expect(nextPreview(state, { index: 1, type: "selected" })).toBe(state);
  });
});
