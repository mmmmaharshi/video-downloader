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

const openOn = (shown: VideoAsset): PreviewState => ({ open: true, shown });

describe("nextPreview", () => {
  test("opens on a resolved response, showing that asset", () => {
    const a = asset("1");
    expect(nextPreview(closedPreview, { type: "resolved", asset: a })).toEqual({ open: true, shown: a });
  });

  test("reopens when the same link resolves again — equal content, fresh response", () => {
    const first = asset("1");
    const again = asset("1");
    const next = nextPreview(openOn(first), { type: "resolved", asset: again });
    expect(next.open).toBe(true);
    expect(next.shown).toBe(again);
  });

  test("replaces the shown asset when a different link resolves", () => {
    const next = nextPreview(openOn(asset("1")), { type: "resolved", asset: asset("2") });
    expect(next).toEqual({ open: true, shown: asset("2") });
  });

  test("closes an open preview on a failed response", () => {
    expect(nextPreview(openOn(asset("1")), { type: "failed" })).toEqual({ open: false, shown: asset("1") });
  });

  test("stays closed on a failed response when already closed", () => {
    expect(nextPreview(closedPreview, { type: "failed" })).toBe(closedPreview);
  });

  test("closes on dismissed", () => {
    expect(nextPreview(openOn(asset("1")), { type: "dismissed" }).open).toBe(false);
  });

  test("stays closed on dismissed when already closed", () => {
    expect(nextPreview(closedPreview, { type: "dismissed" })).toBe(closedPreview);
  });

  test("a backdrop click leaves an open preview open", () => {
    const state = openOn(asset("1"));
    expect(nextPreview(state, { type: "backdropClicked" })).toBe(state);
  });

  test("a backdrop click leaves a closed preview closed", () => {
    expect(nextPreview(closedPreview, { type: "backdropClicked" })).toBe(closedPreview);
  });
});
