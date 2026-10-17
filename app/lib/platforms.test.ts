// Guards the client-safe boundary that broke the dev form: the platform
// vocabulary must stay importable by browser code. A client module once pulled
// it from media-resolver (which imports node:dns), so Vite's externalized stub
// threw during hydration and the Fetch form fell back to a native page reload.
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PLATFORMS } from "./platforms";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

// Modules a browser cannot evaluate: they reach node:dns or youtubei.js. A value
// import drags them into the client graph, which kills hydration in dev while
// typecheck and the prod build stay green.
const SERVER_ONLY_MODULES = ["media-resolver", "transfer", "youtube"];

const SERVER_ONLY_FILE =
  /(?<lead>^|\/)(?<name>api\.|media-resolver\.|transfer\.|youtube\.)/u;

/** every file under app/ a browser may load, as posix-joined relative paths */
const clientFiles = async () => {
  const entries = await readdir(APP_DIR, { recursive: true });

  return entries
    .map((entry) => entry.replaceAll("\\", "/"))
    .filter(
      (entry) =>
        /\.tsx?$/u.test(entry) &&
        !entry.includes(".test.") &&
        !SERVER_ONLY_FILE.test(entry)
    );
};

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
});

describe("client boundary", () => {
  // The guard that broke: browser code may take the resolver's types (erased at
  // build) but never its runtime. Scanned over the whole app/ tree, so a new
  // route or component is covered without editing this test.
  test("no client file value-imports a server-only module", async () => {
    const files = await clientFiles();

    // if the scan finds nothing, the assertions below prove nothing
    expect(files).toContain("routes/home.tsx");

    const found = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(path.join(APP_DIR, file), "utf-8");

        return SERVER_ONLY_MODULES.flatMap((name) =>
          new RegExp(
            `import\\s+(?!type\\b)[^;]*from\\s+"[^"]*${name}"`,
            "u"
          ).test(source)
            ? [`${file} imports ${name} for value`]
            : []
        );
      })
    );

    expect(found.flat()).toEqual([]);
  });
});

describe("styling surface", () => {
  // Every visual rule lives in a Tailwind utility or a HeroUI token, so new CSS
  // means a decision someone should make on purpose.
  test("app.css is the only stylesheet under app/", async () => {
    const entries = await readdir(APP_DIR, { recursive: true });

    const sheets = entries
      .map((entry) => entry.replaceAll("\\", "/"))
      .filter((entry) => entry.endsWith(".css"));

    expect(sheets).toEqual(["app.css"]);
  });
});
