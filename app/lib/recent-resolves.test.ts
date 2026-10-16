import { describe, expect, test } from "bun:test";

import { rememberResolved, wasResolved } from "./recent-resolves";

describe("wasResolved", () => {
  test("allows a url the form just resolved", () => {
    rememberResolved("https://video.twimg.com/a.mp4", 1000);
    expect(wasResolved("https://video.twimg.com/a.mp4", 2000)).toBe(true);
  });

  test("rejects a url nobody resolved", () => {
    expect(wasResolved("https://video.twimg.com/never-seen.mp4", 2000)).toBe(
      false
    );
  });

  test("rejects a missing url", () => {
    expect(wasResolved(null, 2000)).toBe(false);
  });

  test("rejects a resolve older than ten minutes", () => {
    rememberResolved("https://video.twimg.com/old.mp4", 1000);
    expect(
      wasResolved("https://video.twimg.com/old.mp4", 1000 + 10 * 60_000)
    ).toBe(false);
  });

  test("still allows a resolve just inside ten minutes", () => {
    rememberResolved("https://video.twimg.com/fresh.mp4", 1000);
    expect(
      wasResolved("https://video.twimg.com/fresh.mp4", 1000 + 10 * 60_000 - 1)
    ).toBe(true);
  });

  test("caps memory by evicting the oldest resolve", () => {
    for (let i = 0; i < 200; i += 1) {
      rememberResolved(`https://video.twimg.com/fill-${i}.mp4`, 5000);
    }
    rememberResolved("https://video.twimg.com/one-more.mp4", 5000);
    expect(wasResolved("https://video.twimg.com/fill-0.mp4", 5000)).toBe(false);
    expect(wasResolved("https://video.twimg.com/one-more.mp4", 5000)).toBe(
      true
    );
  });
});
