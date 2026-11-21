# Video downloader

Save videos from Instagram, X (Twitter), YouTube, Facebook, Reddit, Streamable, Vimeo, TikTok, Threads, Dailymotion, Loom, and direct video links to your device. Paste a link, preview it, and hit download — no account, no sign-up, and nothing of yours is stored anywhere.

Live: https://download.maharshi.work

## Run it

    bun install
    DOWNLOAD_SECRET="$(openssl rand -base64 32)" bun run dev

`DOWNLOAD_SECRET` signs the download links (`/api/download?…&s=…`) and must be the same value on every instance — set it once in the deploy environment. Without it the resolve action cannot build a download link.

In Vercel, scope `DOWNLOAD_SECRET` to Production only. Contributors can open pull requests, so Preview deployments must not read this value. `vercel.json` disables git auto-deploys. The `verify` workflow's deploy hook on `master` is the only path to production.

Verify with `bun run verify` (typecheck, tests, lint + format, production build).

The HeroUI MCP server in `opencode.json` is pinned to `@heroui/react-mcp@1.1.4`. Without `-y`, `npx` prompts before install.
