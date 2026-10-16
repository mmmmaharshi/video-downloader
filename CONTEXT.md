# CONTEXT.md — Video Downloader

Domain language for seams. Names here drive module boundaries — grep the term, find the seam.

## Glossary

- **SourceUrl** — raw string the user pastes (e.g. `https://www.instagram.com/reel/ABC/` or `https://x.com/user/status/123`). Validated, not trusted. Owns normalization (trim) and identity extraction.
- **Shortcode** — post identity taken from SourceUrl: the `([A-Za-z0-9_-]+)` segment after `/p/`, `/reel/`, `/tv/`, the numeric id after `status/`, or the 11-char YouTube video id. Flows everywhere as typed string, not bare regex group.
- **VideoAsset** — resolved domain object: `{ videoUrl, thumbnail?, shortcode, sourceUrl, platform, label?, title? }`. Created only by **MediaResolver**. Crosses seams by value — the api action returns it whole and **DownloadLink** encodes it; never reconstruct `videoUrl` + `shortcode` separately at call sites. `label` names the option where siblings exist (YouTube rendition quality like `1080p`); `title` carries the YouTube video title for the preview header; `platform` is `instagram` | `twitter` | `youtube` | `facebook` | `direct` (`direct` = any other link that serves video).
- **MediaResolver** — deep module. Interface: `resolve(sourceUrl, deps?) → Promise<VideoAsset[]>`. Implementation hides: platform detection, SourceUrl validation, IG HTML fetch + `og:video` parse + embed fallback, X syndication fetch + mp4 variant selection, YouTube anonymous MP4 extraction with IOS→ANDROID fallback (see **YouTube**), Facebook `browser_native_hd/sd_url` extraction with `og:video`/`hd_src` fallbacks, and a generic catch-all (video content-type resolves the link itself, else the page's `og:video`). Unknown hosts go through a public-DNS guard (private ranges refused, redirects re-checked per hop); supported hosts with unrecognized paths fail fast as invalid. Seam is `fetch` (plus injectable `youtube` formats function and `lookup` DNS function). Adapters: live `fetch`/DNS in prod, in-memory fixtures in tests (two adapters → real seam).
- **YouTube** — deep module. Interface: `getYouTubeFormats(id, deps?) → TubeAsset[]` (playable renditions, best first). Owns the InnerTube session (one anonymous session per process, retries creation on failure): tries the IOS client first, probes the best url with a HEAD, and falls back to ANDROID when a video's urls refuse anonymous playback. Maps streaming data to plain MP4 urls. Seam is `getInfo(id, client)` + `fetch` (live Innertube in prod, stubs in tests).
- **Transfer** — deep module. Interface: `proxy(videoUrl, stem, deps?) → Response`. Owns streaming, `Content-Disposition` + `Cache-Control`. Access control lives upstream, not here: the download route only passes urls the resolver produced (public hosts only, inside the remember window), so there is no host allowlist. The second argument is a stem (`<platform>-<shortcode>`), not a filename — `proxy` appends `.mp4`. Bounds the upstream twice: fast-fail on headers, overall deadline past which a stalled stream is cut; passes the upstream size through for progress display.
- **Preview** — deep module. Interface: `nextPreview(state, event) → PreviewState`, where the state carries the shown list and the active position. Owns the preview's open/dismiss rule: `resolved` opens on the list that opened it (keyed by response identity, so an identical re-fetch reopens), `failed` and `dismissed` close, `selected` flips position. The route keeps rendering; dismissal (backdrop, Escape, close button) arrives via the modal's open-state callback, and focus trap/scroll lock come from React Aria. The rule itself is tested in-process through this seam.
- **DownloadLink** — deep module. Interface: `toDownloadHref(assets, index?) → string` and `fromDownloadRequest(url) → { videoUrl, stem }`. Owns the VideoAsset → download-file round trip: the `url` + `name` param names, the `<platform>-<shortcode>` stem format (suffixed `-1`, `-2` … for X siblings or `-1080p`, `-720p` … for labeled YouTube renditions), encode and decode. Both routes cross this seam.
- **RecentResolves** — short-lived memory of video URLs the form resolved. Interface: `rememberResolved(url, now?)`, `wasResolved(url, now?)`. The download loader only serves remembered URLs, so the proxy answers the app, not the internet. The window is `FRESH_MS`, shared with the client's TanStack Query cache (`resolve-query`), so a cached re-submit can still download.

## Seams

- `MediaResolver ↔ fetch` — local-substitutable, ports & adapters. Tests inject fixture map; prod injects global fetch.
- `Transfer ↔ fetch` — in-process. Tests inject recorded CDN body.

## Non-goals

- No backward-compat shims. Old `validateInstaUrl` / raw `videoUrl` string seams are deleted when replaced.
