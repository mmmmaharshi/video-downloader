import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import gdp from "ultracite/oxlint/gdp";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";

export default defineConfig({
  env: core.env,
  extends: [core, react, antiSlop, shadcn, gdp],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    // vendored agent-skill assets, not project code — never shipped
    "agent/",
    ".claude/",
    ".agents/",
    // opencode harness session state, written at runtime — not project code
    ".opencode/",
  ],
  jsPlugins: shadcn.jsPlugins,
});
