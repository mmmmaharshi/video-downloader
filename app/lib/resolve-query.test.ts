import { describe, expect, test } from "bun:test";
import { FRESH_MS, isFresh, resolveKey } from "./resolve-query";

describe("resolve-query", () => {
  test("keys a resolution by its trimmed url", () => {
    expect(resolveKey("  https://x.com/a  ")).toEqual(["resolve", "https://x.com/a"]);
  });

  test("freshness matches the download gate window", () => {
    expect(FRESH_MS).toBe(10 * 60_000);
    expect(isFresh(Date.now() - FRESH_MS + 1_000)).toBe(true);
    expect(isFresh(Date.now() - FRESH_MS - 1_000)).toBe(false);
  });
});
