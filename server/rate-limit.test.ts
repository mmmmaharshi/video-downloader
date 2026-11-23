// The burst cap: a key over its per-minute budget is refused.

import { describe, expect, test } from "vitest";

import { overLimit } from "./rate-limit";

const fixedClock = () => 1_000_000;

describe("overLimit", () => {
  test("allows a burst up to the budget, then refuses", async () => {
    const key = `burst-${Math.random()}`;
    const results: boolean[] = [];

    for (let i = 0; i < 31; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- each call increments the shared counter
      results.push(await overLimit(key, undefined, { now: fixedClock }));
    }

    expect(results.slice(0, 30).every((limited) => !limited)).toBe(true);
    expect(results.at(-1)).toBe(true);
  });

  test("the window resets", async () => {
    const key = `reset-${Math.random()}`;
    let clock = 0;
    const now = () => clock;

    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential budget
      await overLimit(key, undefined, { now });
    }

    expect(await overLimit(key, undefined, { now })).toBe(true);

    clock = 61_000;

    expect(await overLimit(key, undefined, { now })).toBe(false);
  });

  test("defers to the platform limiter when one is bound", async () => {
    const seen: string[] = [];

    const limiter = {
      limit: ({ key }: { key: string }) => {
        seen.push(key);

        return Promise.resolve({ success: false });
      },
    };

    expect(await overLimit("1.2.3.4", limiter)).toBe(true);
    expect(seen).toEqual(["1.2.3.4"]);
  });
});
