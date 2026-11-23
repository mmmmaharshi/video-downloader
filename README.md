# Video downloader

Save videos from Instagram, X (Twitter), YouTube, Facebook, Reddit, Streamable, Vimeo, TikTok, Threads, Dailymotion, Loom, and direct video links to your device. Paste a link, preview it, and hit download — no account, no sign-up, and nothing of yours is stored anywhere.

Live: https://download.maharshi.work

## Run it

    bun install
    DOWNLOAD_SECRET="$(openssl rand -base64 32)" bun run dev

`DOWNLOAD_SECRET` signs the download links (`/api/download?…&s=…`) and must be the same value on every instance — set it once in the deploy environment. Without it, resolving fails closed instead of minting links.

`bun run dev` serves the client with the API in-process. `bun run build` emits `dist/`; `bun server/serve.ts` serves it (`PORT` defaults to 3000).

## Deploy

Production is the Cloudflare Worker `video-downloader`, declared in `cloudflare.config.ts` and deployed with `cf` (Node-only, so it runs through `npx`):

    CLOUDFLARE_ACCOUNT_ID=<account> bun run deploy

`cf` builds through Vite, so the same `dist/` client ships and `server/worker.ts` answers `/api/*`. Secrets come from `.dev.vars` (gitignored); rotate `DOWNLOAD_SECRET` there and redeploy. Set `CLOUDFLARE_ACCOUNT_ID` once in your shell or CI.

Verify with `bun run verify` (typecheck, tests, lint + format, Cloudflare build).
