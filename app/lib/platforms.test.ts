// Guards the client-safe boundary that broke the dev form: the platform
// vocabulary must stay importable by browser code. A client module once pulled
// it from media-resolver (which imports node:dns), so Vite's externalized stub
// threw during hydration and the Fetch form fell back to a native page reload.
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { PLATFORMS } from "./platforms";

describe("platforms", () => {
  test("carries the full platform vocabulary in one place", () => {
    expect([...PLATFORMS]).toEqual([
      "instagram",
      "twitter",
      "youtube",
      "facebook",
      "reddit",
      "streamable",
      "vimeo",
      "tiktok",
      "threads",
      "dailymotion",
      "loom",
      "direct",
    ]);
  });

  test("stays dependency-free so the client can import it", async () => {
    const source = await readFile(new URL("platforms.ts", import.meta.url), {
      encoding: "utf-8",
    });

    expect(source).not.toMatch(/\bimport\b/u);
  });

  test("resolve-query no longer imports the server-only resolver", async () => {
    const source = await readFile(
      new URL("resolve-query.ts", import.meta.url),
      { encoding: "utf-8" }
    );

    expect(source).not.toMatch(/media-resolver/u);
  });

  // the guard above is the one that actually broke: browser code may take the
  // resolver's types (erased at build) but never its runtime, which drags
  // node:dns into the client bundle
  test.each(["preview.ts", "download-link.ts", "../routes/home.tsx"])(
    "%s takes the resolver as types only",
    async (file) => {
      const source = await readFile(new URL(file, import.meta.url), {
        encoding: "utf-8",
      });

      expect(source).not.toMatch(
        /import\s+(?!type\b)[^;]*from\s+"[^"]*media-resolver"/u
      );
    }
  );
});
