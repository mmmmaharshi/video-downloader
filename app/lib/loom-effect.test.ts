// The seam suite (media-resolver.test.ts) owns the behaviour. What it
// cannot see is the copy each failure tag produces, which is all this file
// has left to guard.

import { describe, expect, test } from "vitest";

import { toThrownError } from "./loom-effect";

describe("loom-effect", () => {
  test("every tag maps to its legacy message", () => {
    expect(toThrownError({ _tag: "LoomUnreachable" as const }).message).toBe(
      "Loom is unreachable right now. Try again later."
    );
    expect(toThrownError({ _tag: "LoomBadRedirect" as const }).message).toBe(
      "This link redirects somewhere invalid."
    );
    expect(
      toThrownError({ _tag: "LoomTooManyRedirects" as const }).message
    ).toBe("This link redirects too many times.");
    expect(toThrownError({ _tag: "LoomUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
  });
});
