# CONTEXT.md — Video Downloader

Domain language for seams. Names here drive module boundaries — grep the term, find the seam.

## Glossary

- **SourceUrl** — raw string the user pastes (e.g. `https://www.instagram.com/reel/ABC/` or `https://x.com/user/status/123`). Validated, not trusted. Owns normalization (trim) and identity extraction.
- **Shortcode** — post identity taken from SourceUrl: the `([A-Za-z0-9_-]+)` segment after `/p/`, `/reel/`, `/tv/`, or the numeric id after `status/`. Flows everywhere as typed string, not bare regex group.
- **VideoAsset** — resolved domain object: `{ videoUrl, thumbnail?, shortcode, sourceUrl, platform }`. Created only by **MediaResolver**. Crosses seams by value — the action returns it whole and **DownloadLink** encodes it; never reconstruct `videoUrl` + `shortcode` separately at call sites.
- **MediaResolver** — deep module. Interface: `resolve(sourceUrl, deps?) → Promise<VideoAsset>`. Implementation hides: platform detection, SourceUrl validation, IG HTML fetch + `og:video` parse + embed fallback, X syndication fetch + mp4 variant selection, `&amp;`/`\u0026` normalization, thumbnail extraction. Seam is `fetch`. Adapters: live `fetch` in prod, in-memory fixtures in tests (two adapters → real seam).
- **Transfer** — deep module. Interface: `proxy(videoUrl, stem, deps?) → Promise<Response>` and `isAllowedHost(url) → boolean`. Owns allowlist policy (`cdninstagram.com`, `fbcdn.net`, `scontent.cdninstagram.com`, `video.twimg.com` — exact or suffix, not `includes()`), upstream fetch, `Content-Disposition` + `Cache-Control`. Both routes call it — one allowlist, N call sites. The second argument is a stem (`<platform>-<shortcode>`), not a filename — `proxy` appends `.mp4`.
- **Preview** — deep module. Interface: `nextPreview(state, event) → PreviewState`. Owns the preview's open/dismiss rule: `resolved` opens on the asset that opened it (keyed by response identity, so an identical re-fetch reopens), `failed` and `dismissed` close, `backdropClicked` is an explicit no-op. The route keeps rendering and the effects that apply the rule; the rule itself is tested in-process through this seam.
- **DownloadLink** — deep module. Interface: `toDownloadHref(asset) → string` and `fromDownloadRequest(url) → { videoUrl, stem }`. Owns the VideoAsset → download-file round trip: the `url` + `name` param names, the `<platform>-<shortcode>` stem format, encode and decode. Both routes cross this seam.

## Seams

- `MediaResolver ↔ fetch` — local-substitutable, ports & adapters. Tests inject fixture map; prod injects global fetch.
- `Transfer ↔ fetch` — in-process. Tests inject recorded CDN body.

## Non-goals

- No backward-compat shims. Old `validateInstaUrl` / raw `videoUrl` string seams are deleted when replaced.
