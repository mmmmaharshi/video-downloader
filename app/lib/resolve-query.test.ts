import { describe, expect, test } from "bun:test";
import { isFresh, resolveKey } from "./resolve-query";

describe("resolve-query", () => {
  test("keys a resolution by its trimmed url", () => {
    expect(resolveKey("  https://x.com/a  ")).toEqual(["resolve", "https://x.com/a"]);
  });

  test("freshness ends where the download gate ends", () => {
    expect(isFresh(Date.now() - 9 * 60_000)).toBe(true);
    expect(isFresh(Date.now() - 11 * 60_000)).toBe(false);
  });
});
