// The seam suite (media-resolver.test.ts) owns the behaviour. What it
// cannot see is the copy each failure tag produces, which is all this file
// has left to guard.

import { describe, expect, test } from "vitest";

import { toThrownError } from "./threads-effect";

describe("threads-effect", () => {
  test("every tag maps to its legacy message", () => {
    expect(toThrownError({ _tag: "ThreadsUnreachable" as const }).message).toBe(
      "Threads is unreachable right now. Try again later."
    );
    expect(toThrownError({ _tag: "ThreadsBadRedirect" as const }).message).toBe(
      "This link redirects somewhere invalid."
    );
    expect(
      toThrownError({ _tag: "ThreadsTooManyRedirects" as const }).message
    ).toBe("This link redirects too many times.");
    expect(
      toThrownError({ _tag: "ThreadsGuardBlocked" as const }).message
    ).toBe("Only public links are supported.");
    expect(toThrownError({ _tag: "ThreadsUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
  });
});
