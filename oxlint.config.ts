import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

export default defineConfig({
  env: core.env,
  extends: [core, react],
  // vendored agent-skill assets, not project code — never shipped
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "agent/",
    ".claude/",
    ".agents/",
  ],
});
