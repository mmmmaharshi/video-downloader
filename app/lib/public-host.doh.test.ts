import { describe, expect, test } from "vitest";

import type { DohFetch } from "./public-host";
import { dohLookup, resolvePublicAddresses } from "./public-host";

const dohResponse = (answers: string[]) =>
  Response.json({ Answer: answers.map((data) => ({ data })) });

const privateIPv4: DohFetch = () => Promise.resolve(dohResponse(["127.0.0.1"]));

const ipv6Loopback: DohFetch = (url) =>
  Promise.resolve(
    dohResponse(url.toString().includes("type=AAAA") ? ["::1"] : [])
  );

const dohDown: DohFetch = () =>
  Promise.resolve(new Response("down", { status: 500 }));

const cdnAnswer: DohFetch = (url) =>
  Promise.resolve(
    dohResponse(
      url.toString().includes("type=AAAA")
        ? []
        : ["d2siujj6mte9cd.cloudfront.net.", "54.240.162.66"]
    )
  );

describe("dohLookup", () => {
  test("merges A and AAAA answers", async () => {
    const seen: string[] = [];

    const dohFetch: DohFetch = (url) => {
      seen.push(url.toString());

      const answers = url.toString().includes("type=AAAA")
        ? ["2606:4700:4700::1111"]
        : ["1.1.1.1"];

      return Promise.resolve(dohResponse(answers));
    };

    const addresses = await dohLookup("example.com", dohFetch);

    expect(addresses).toEqual(["1.1.1.1", "2606:4700:4700::1111"]);
    expect(seen.some((u) => u.includes("type=A"))).toBe(true);
    expect(seen.some((u) => u.includes("type=AAAA"))).toBe(true);
  });

  test("drops CNAME targets a CDN answer mixes in", async () => {
    // DoH answers carry the CNAME chain beside the addresses; a hostname is
    // not an address, and treating it as one blocked every CDN-backed site
    expect(await dohLookup("www.dailymotion.com", cdnAnswer)).toEqual([
      "54.240.162.66",
    ]);
  });

  test("refuses a private answer before the caller dials it", async () => {
    await expect(
      resolvePublicAddresses("https://example.com/v.mp4", (host) =>
        dohLookup(host, privateIPv4)
      )
    ).rejects.toThrow("Only public links");
  });

  test("refuses an IPv6 loopback answer", async () => {
    await expect(
      resolvePublicAddresses("https://example.com/v.mp4", (host) =>
        dohLookup(host, ipv6Loopback)
      )
    ).rejects.toThrow("Only public links");
  });

  test("throws a resolve error when DoH fails", async () => {
    await expect(
      resolvePublicAddresses("https://example.com/v.mp4", (host) =>
        dohLookup(host, dohDown)
      )
    ).rejects.toThrow("Could not resolve");
  });
});
