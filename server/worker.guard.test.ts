// The two guards on /api/resolve: a body cap and a per-instance burst limit.
// Both run before any outbound fetch.

import { describe, expect, test } from "vitest";

import { stubFetch } from "../app/lib/fake-fetch";
import { handleWorkerRequest } from "./worker";

const lookup = () => ["93.184.216.34"];
const env = { DOWNLOAD_SECRET: "test-secret" };

const mp4 = () =>
  stubFetch(
    () =>
      new Response("video-bytes", {
        headers: { "content-type": "video/mp4" },
        status: 200,
      })
  );

const post = (body: string, ip: string) =>
  new Request("http://localhost/api/resolve", {
    body,
    headers: { "cf-connecting-ip": ip, "content-length": String(body.length) },
    method: "POST",
  });

describe("resolve guards", () => {
  test("refuses a body larger than a pasted link", async () => {
    const huge = "a".repeat(9000);

    const res = await handleWorkerRequest(post(huge, "1.1.1.1"), env, {
      fetch: mp4(),
      lookup,
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Request body too large." });
  });

  test("cuts off a burst from one client", async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 40; i += 1) {
      const form = new FormData();

      form.set("url", "https://cdn.example.com/clips/funny-cat.mp4");

      // eslint-disable-next-line no-await-in-loop -- the limiter counts calls in order
      const res = await handleWorkerRequest(
        new Request("http://localhost/api/resolve", {
          body: form,
          headers: { "cf-connecting-ip": "5.5.5.5" },
          method: "POST",
        }),
        env,
        { fetch: mp4(), lookup }
      );

      statuses.push(res.status);
    }

    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
