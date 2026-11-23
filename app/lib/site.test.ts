// The static shell carries the same title and canonical URL the runtime writes
// into <head>. This fails when the two drift, which is the only way a rename
// can leave visitors and crawlers with different answers.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { SITE_TITLE, SITE_URL } from "./site";

const shell = readFileSync(
  fileURLToPath(new URL("../../index.html", import.meta.url)),
  "utf-8"
);

describe("site facts", () => {
  test("the static shell carries the shared title", () => {
    expect(shell).toContain(`<title>${SITE_TITLE}</title>`);
  });

  test("the static shell carries the shared canonical url", () => {
    expect(shell).toContain(`<link rel="canonical" href="${SITE_URL}" />`);
  });
});
