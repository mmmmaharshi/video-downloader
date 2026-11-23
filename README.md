# Video downloader

Save videos from Instagram, X (Twitter), YouTube, Facebook, Reddit, Streamable, Vimeo, TikTok, Threads, Dailymotion, Loom, and direct video links to your device. Paste a link, preview it, and hit download — no account, no sign-up, and nothing of yours is stored anywhere.

Live: https://download.maharshi.work

## Run it

    bun install
    DOWNLOAD_SECRET="$(openssl rand -base64 32)" bun run dev

`DOWNLOAD_SECRET` signs the download links (`/api/download?…&s=…`) and must be the same value on every instance — set it once in the deploy environment. Without it, resolving fails closed instead of minting links.

`bun run dev` serves the client with the API in-process. `bun run build` emits `dist/`; `bun server/serve.ts` serves it (`PORT` defaults to 3000). `vercel.json` keeps git-push deploys off: production deploys from the CI `deploy` job after `verify` passes. Verify with `bun run verify` (typecheck, tests, lint + format, production build).
