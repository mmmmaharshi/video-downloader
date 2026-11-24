// The seam suite (media-resolver.test.ts) owns the behaviour. What it
// cannot see is the copy each failure tag produces, which is all this file
// has left to guard.

import { describe, expect, test } from "vitest";

import { toThrownError } from "./tiktok-effect";

describe("tiktok-effect", () => {
  test("every tag maps to its legacy message", () => {
    expect(toThrownError({ _tag: "TikTokNotFound" as const }).message).toBe(
      "Post not found. Check the URL."
    );
    expect(toThrownError({ _tag: "TikTokUnreachable" as const }).message).toBe(
      "TikTok is unreachable right now. Try again later."
    );
    expect(toThrownError({ _tag: "TikTokBadRedirect" as const }).message).toBe(
      "This link redirects somewhere invalid."
    );
    expect(
      toThrownError({ _tag: "TikTokTooManyRedirects" as const }).message
    ).toBe("This link redirects too many times.");
    expect(toThrownError({ _tag: "TikTokGuardBlocked" as const }).message).toBe(
      "Only public links are supported."
    );
    expect(toThrownError({ _tag: "TikTokUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
  });
});
