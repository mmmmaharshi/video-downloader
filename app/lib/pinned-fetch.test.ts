// The two dial paths: Bun pins the socket to an approved address, Workers has
// no raw sockets and must dial the hostname. Both are pinned by test.

import { afterEach, describe, expect, test } from "vitest";

import { pinnedFetch } from "./pinned-fetch";

const recorded = () => {
  const calls: { init?: RequestInit; url: string }[] = [];

  // a function taking the wider input union is assignable to fetch; the
  // preconnect hook is a Bun addition the tests never call
  const doFetch: typeof fetch = Object.assign(
    (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ init, url: String(input) });

      return Promise.resolve(new Response("ok"));
    },
    { preconnect: () => {} }
  );

  return { calls, doFetch };
};

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
});

const pretendWorkers = () => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Cloudflare-Workers" },
  });
};

describe("pinnedFetch", () => {
  test("on Workers dials the hostname and never sends socket options", async () => {
    pretendWorkers();

    const { calls, doFetch } = recorded();

    await pinnedFetch(doFetch, "https://example.com/v.mp4", ["93.184.216.34"], {
      headers: { Accept: "video/mp4" },
      method: "GET",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://example.com/v.mp4");
    expect(calls[0]?.init).not.toHaveProperty("tls");
    expect(calls[0]?.init).not.toHaveProperty("proxy");
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect(new Headers(calls[0]?.init?.headers).get("accept")).toBe(
      "video/mp4"
    );
  });

  test("on Workers still fails closed without an approved address", async () => {
    pretendWorkers();

    const { calls, doFetch } = recorded();

    await expect(
      pinnedFetch(doFetch, "https://example.com/v.mp4", [], {})
    ).rejects.toThrow("Only public links are supported.");
    expect(calls).toEqual([]);
  });

  test("on Bun dials the approved address and keeps the origin in Host", async () => {
    const { calls, doFetch } = recorded();

    await pinnedFetch(
      doFetch,
      "https://example.com/v.mp4",
      ["93.184.216.34"],
      {}
    );

    expect(calls[0]?.url).toBe("https://93.184.216.34/v.mp4");
    expect(new Headers(calls[0]?.init?.headers).get("host")).toBe(
      "example.com"
    );
  });
});
