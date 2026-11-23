import { describe, expect, test } from "bun:test";

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
