// The seam suite (media-resolver.test.ts) owns the behaviour. What it
// cannot see is the copy each failure tag produces, which is all this file
// has left to guard.

import { describe, expect, test } from "vitest";

import { toThrownError } from "./instagram-effect";

describe("instagram-effect", () => {
  test("every tag maps to its legacy message", () => {
    expect(
      toThrownError({ _tag: "InstagramUnreachable" as const }).message
    ).toBe("Instagram is unreachable right now. Try again later.");
    expect(
      toThrownError({ _tag: "InstagramBadRedirect" as const }).message
    ).toBe("This link redirects somewhere invalid.");
    expect(
      toThrownError({ _tag: "InstagramTooManyRedirects" as const }).message
    ).toBe("This link redirects too many times.");
    expect(
      toThrownError({ _tag: "InstagramGuardBlocked" as const }).message
    ).toBe("Only public links are supported.");
    expect(
      toThrownError({ _tag: "InstagramUnresolved" as const }).message
    ).toBe("Could not resolve this link. Check the URL.");
  });
});
