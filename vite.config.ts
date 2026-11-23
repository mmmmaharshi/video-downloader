import { cloudflare } from "@cloudflare/vite-plugin";
import { foldkit } from "@foldkit/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The Cloudflare plugin builds the Worker bundle and the client assets, and in
// dev it runs the real Worker: server/worker.ts answers /api/* exactly as it
// does in production, so there is no second dev-only implementation.
// The Worker shape lives in cloudflare.config.ts, which both this plugin and
// `cf deploy` read.
export default defineConfig({
  plugins: [tailwindcss(), foldkit(), cloudflare()],
  server: {
    port: 5173,
  },
});
