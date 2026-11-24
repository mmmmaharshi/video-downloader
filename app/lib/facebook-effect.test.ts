// The seam suite (media-resolver.test.ts) owns the behaviour. What it
// cannot see is the copy each failure tag produces, which is all this file
// has left to guard.

import { describe, expect, test } from "vitest";

import { toThrownError } from "./facebook-effect";

describe("facebook-effect", () => {
  test("every tag maps to its legacy message", () => {
    expect(
      toThrownError({ _tag: "FacebookUnreachable" as const }).message
    ).toBe("Facebook is unreachable right now. Try again later.");
    expect(
      toThrownError({ _tag: "FacebookBadRedirect" as const }).message
    ).toBe("This link redirects somewhere invalid.");
    expect(
      toThrownError({ _tag: "FacebookTooManyRedirects" as const }).message
    ).toBe("This link redirects too many times.");
    expect(toThrownError({ _tag: "FacebookUnresolved" as const }).message).toBe(
      "Could not resolve this link. Check the URL."
    );
    expect(
      toThrownError({ _tag: "FacebookUpstream", status: 500 } as const).message
    ).toBe("Facebook returned 500. Try again later.");
  });
});
