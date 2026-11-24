// The seam suite (media-resolver.test.ts) owns the behaviour. What it
// cannot see is the copy each failure tag produces, which is all this file
// has left to guard.

import { describe, expect, test } from "vitest";

import { toThrownError } from "./twitter-effect";

describe("twitter-effect", () => {
  test("every tag maps to its legacy message", () => {
    expect(toThrownError({ _tag: "TwitterBadRedirect" as const }).message).toBe(
      "This link redirects somewhere invalid."
    );
    expect(
      toThrownError({ _tag: "TwitterTooManyRedirects" as const }).message
    ).toBe("This link redirects too many times.");
    expect(
      toThrownError({ _tag: "TwitterGuardBlocked" as const }).message
    ).toBe("Only public links are supported.");
    expect(toThrownError({ _tag: "TwitterUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
  });
});
