import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import gdp from "ultracite/oxlint/gdp";
import jsPlugins, { jsPluginSettings } from "ultracite/oxlint/js-plugins";
import landmines from "ultracite/oxlint/landmines";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";

// Every opt-in Ultracite preset: ESLint parity (github, sonarjs,
// react-doctor), TSDoc and public-API docs, anti-slop, the shadcn design
// system, gdp-ts proofs, and the landmines shortcut rules.
export default defineConfig({
  env: core.env,
  extends: [core, react, jsPlugins, antiSlop, shadcn, gdp, landmines],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    // vendored agent-skill assets, not project code — never shipped
    "agent/",
    ".claude/",
    ".agents/",
    // opencode harness session state, written at runtime — not project code
    ".opencode/",
  ],
  jsPlugins: [
    ...jsPlugins.jsPlugins,
    ...landmines.jsPlugins,
    ...shadcn.jsPlugins,
  ],
  overrides: [
    {
      // Foldkit message tags are PascalCase by the framework's convention: the
      // Messages union and update table both use those names.
      files: ["app/foldkit-home/main.ts"],
      rules: { "sonarjs/function-name": "off" },
    },
    {
      files: ["**/*.test.ts", "**/fake-fetch.ts"],
      rules: {
        // Fixtures address documentation IP ranges and DoH resolvers by
        // literal address; that is the point of the fixture.
        "sonarjs/no-hardcoded-ip": "off",
        // Tests inject FetchDeps layers and fetch doubles on purpose: the
        // seam is the dependency, per AGENTS.md.
        "landmines-testing/no-test-doubles": "off",
        // The live suite talks to real providers and needs a wider timeout.
        "landmines-testing/no-flake-masking": "off",
      },
    },
  ],
  rules: {
    // AGENTS.md requires a comment for the why the code cannot show.
    "landmines-style/no-comments": "off",
    // Effect programs and exported seams state their return types so the
    // failure union is visible at the call site.
    "landmines-types/no-explicit-return-types": "off",
    // sort-keys orders object keys alphabetically; grouping the shorthand ones
    // would undo that order, so the two rules cannot both pass.
    "sonarjs/shorthand-property-grouping": "off",
    // The wire contract marks absent fields optional with `undefined`
    // (Schema.optional); `null` is not part of that type.
    "sonarjs/no-undefined-assignment": "off",
  },
  settings: jsPluginSettings,
});
