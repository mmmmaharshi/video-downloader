import { describe, expect, test } from "bun:test";
import { closedPreview, nextPreview, type PreviewState } from "./preview";
import type { VideoAsset } from "./media-resolver";

const asset = (shortcode: string, videoUrl = `https://video.twimg.com/${shortcode}.mp4`): VideoAsset => ({
  videoUrl,
  thumbnail: "https://pbs.twimg.com/thumb.jpg",
  shortcode,
  sourceUrl: `https://x.com/u/status/${shortcode}`,
  platform: "twitter",
});

const openOn = (shown: VideoAsset[], active = 0): PreviewState => ({ open: true, shown, active });

describe("nextPreview", () => {
  test("opens on a resolved response, showing the first asset", () => {
    const assets = [asset("1"), asset("2")];
    expect(nextPreview(closedPreview, { type: "resolved", assets })).toEqual({ open: true, shown: assets, active: 0 });
  });

  test("reopens when the same link resolves again — equal content, fresh response", () => {
    const again = [asset("1")];
    const next = nextPreview(openOn([asset("1")]), { type: "resolved", assets: again });
    expect(next.open).toBe(true);
    expect(next.shown).toBe(again);
    expect(next.active).toBe(0);
  });

  test("replaces the shown list when a different link resolves", () => {
    const next = nextPreview(openOn([asset("1")]), { type: "resolved", assets: [asset("2"), asset("3")] });
    expect(next).toEqual({ open: true, shown: [asset("2"), asset("3")], active: 0 });
  });

  test("closes an open preview on a failed response", () => {
    expect(nextPreview(openOn([asset("1")]), { type: "failed" })).toEqual({ open: false, shown: [asset("1")], active: 0 });
  });

  test("stays closed on a failed response when already closed", () => {
    expect(nextPreview(closedPreview, { type: "failed" })).toBe(closedPreview);
  });

  test("closes on dismissed", () => {
    expect(nextPreview(openOn([asset("1")]), { type: "dismissed" }).open).toBe(false);
  });

  test("stays closed on dismissed when already closed", () => {
    expect(nextPreview(closedPreview, { type: "dismissed" })).toBe(closedPreview);
  });

  test("selected flips to that video", () => {
    const next = nextPreview(openOn([asset("1"), asset("2")]), { type: "selected", index: 1 });
    expect(next).toEqual({ open: true, shown: [asset("1"), asset("2")], active: 1 });
  });

  test("selected ignores an index past the end", () => {
    const state = openOn([asset("1")]);
    expect(nextPreview(state, { type: "selected", index: 1 })).toBe(state);
  });

  test("selected ignores a negative index", () => {
    const state = openOn([asset("1")]);
    expect(nextPreview(state, { type: "selected", index: -1 })).toBe(state);
  });

  test("selected keeps the reference when nothing changes", () => {
    const state = openOn([asset("1"), asset("2")], 1);
    expect(nextPreview(state, { type: "selected", index: 1 })).toBe(state);
  });
});
