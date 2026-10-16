# CONTEXT.md — Video Downloader

Domain language for seams. Names here drive module boundaries — grep the term, find the seam.

## Glossary

- **SourceUrl** — raw string the user pastes (e.g. `https://www.instagram.com/reel/ABC/` or `https://x.com/user/status/123`). Validated, not trusted. Owns normalization (trim) and identity extraction.
- **Shortcode** — post identity taken from SourceUrl: the `([A-Za-z0-9_-]+)` segment after `/p/`, `/reel/`, `/tv/`, the numeric id after `status/`, or the 11-char YouTube video id. Flows everywhere as typed string, not bare regex group.
- **VideoAsset** — resolved domain object: `{ videoUrl, thumbnail?, shortcode, sourceUrl, platform }`. Created only by **MediaResolver**. Crosses seams by value — the action returns it whole and **DownloadLink** encodes it; never reconstruct `videoUrl` + `shortcode` separately at call sites.
- **MediaResolver** — deep module. Interface: `resolve(sourceUrl, deps?) → Promise<VideoAsset[]>`. Implementation hides: platform detection, SourceUrl validation, IG HTML fetch + `og:video` parse + embed fallback, X syndication fetch + mp4 variant selection, YouTube anonymous MP4 extraction via the IOS InnerTube client (see **YouTube**), `&amp;`/`\u0026` normalization, thumbnail extraction. X returns every video in the post, best mp4 each, in post order; IG's page exposes at most one and a YouTube page is one video, so both resolve to a one-element list. Seam is `fetch`. Adapters: live `fetch` in prod, in-memory fixtures in tests (two adapters → real seam).
- **YouTube** — deep module. Interface: `getYouTubeFormats(id, deps?) → TubeAsset[]` (best rendition first). Owns the InnerTube session (one anonymous session per process, retries creation on failure) and maps streaming data to plain MP4 urls. Seam is `getInfo` (live Innertube in prod, stub in tests).
- **Transfer** — deep module. Interface: `proxy(videoUrl, stem, deps?) → Promise<Response>` and `isAllowedHost(url) → boolean`. Owns allowlist policy (`cdninstagram.com`, `fbcdn.net`, `scontent.cdninstagram.com`, `video.twimg.com`, `googlevideo.com` — exact or suffix, not `includes()`), upstream fetch, `Content-Disposition` + `Cache-Control`. Both routes call it — one allowlist, N call sites. The second argument is a stem (`<platform>-<shortcode>`), not a filename — `proxy` appends `.mp4`. Bounds the upstream twice: fast-fail on headers, overall deadline past which a stalled stream is cut; passes the upstream size through for progress display.
- **Preview** — deep module. Interface: `nextPreview(state, event) → PreviewState`, where the state carries the shown list and the active position. Owns the preview's open/dismiss rule: `resolved` opens on the list that opened it (keyed by response identity, so an identical re-fetch reopens), `failed` and `dismissed` close, `backdropClicked` is an explicit no-op, `selected` flips position. The route keeps rendering and the effects that apply the rule; the rule itself is tested in-process through this seam.
- **DownloadLink** — deep module. Interface: `toDownloadHref(assets, index?) → string` and `fromDownloadRequest(url) → { videoUrl, stem }`. Owns the VideoAsset → download-file round trip: the `url` + `name` param names, the `<platform>-<shortcode>` stem format (numbered `-1`, `-2` … when siblings exist), encode and decode. Both routes cross this seam.
- **RecentResolves** — short-lived memory of video URLs the form resolved. Interface: `rememberResolved(url, now?)`, `wasResolved(url, now?)`. The download loader only serves remembered URLs (ten-minute window, capped at 200 entries), so the proxy answers the app, not the internet.

## Seams

- `MediaResolver ↔ fetch` — local-substitutable, ports & adapters. Tests inject fixture map; prod injects global fetch.
- `Transfer ↔ fetch` — in-process. Tests inject recorded CDN body.

## Non-goals

- No backward-compat shims. Old `validateInstaUrl` / raw `videoUrl` string seams are deleted when replaced.
