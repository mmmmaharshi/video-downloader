// Module: Cloudflare project config — the deploy shape for download.maharshi.work.
// One Worker serves the API and the built client: `runWorkerFirst` sends /api/*
// to the Worker, everything else is a static asset with SPA fallback. The
// signing secret is a Cloudflare secret, never a committed value.

import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
    // youtubei.js pulls Node built-ins; without compat the InnerTube call dies
    // and every YouTube link reports "unreachable"
    compatibilityDate: "2026-11-01",
    compatibilityFlags: ["nodejs_compat"],
    domains: ["download.maharshi.work"],
    entrypoint: "./server/worker.ts",
    env: {
      DOWNLOAD_SECRET: bindings.secret(),
      RATE_LIMITER: bindings.rateLimit({
        namespace: "1001",
        simple: { limit: 30, period: 60 },
      }),
    },
    name: "video-downloader",
    observability: {
      enabled: true,
      logs: { enabled: true, invocationLogs: true },
    },
  },
});
