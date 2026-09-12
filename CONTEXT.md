# CONTEXT.md — Video Downloader

Domain language for seams. Names here drive module boundaries — grep the term, find the seam.

## Glossary

- **SourceUrl** — raw string the user pastes (e.g. `https://www.instagram.com/reel/ABC/`). Validated, not trusted. Owns normalization (trim) and shortcode extraction.
- **Shortcode** — `([A-Za-z0-9_-]+)` segment from SourceUrl path (`/p/`, `/reel/`, `/tv/`). Identity of a post. Flows everywhere as typed string, not bare regex group.
- **VideoAsset** — resolved domain object: `{ videoUrl, thumbnail?, shortcode, sourceUrl }`. Created only by **MediaResolver**. Crosses seams by value — never reconstruct `videoUrl` + `shortcode` separately at call sites.
- **MediaResolver** — deep module. Interface: `resolve(sourceUrl, deps?) → Promise<VideoAsset>`. Implementation hides: SourceUrl validation, IG HTML fetch, `og:video` parse, embed fallback, `&amp;`/`\u0026` normalization, thumbnail extraction. Seam is `fetch`. Adapters: live `fetch` in prod, in-memory fixtures in tests (two adapters → real seam).
- **Transfer** — deep module. Interface: `proxy(videoUrl, shortcode, deps?) → Promise<Response>` and `isAllowedHost(url) → boolean`. Owns allowlist policy (`cdninstagram.com`, `fbcdn.net` — exact or suffix, not `includes()`), upstream fetch, `Content-Disposition` + `Cache-Control`. Both routes call it — one allowlist, N call sites.

## Seams

- `MediaResolver ↔ fetch` — local-substitutable, ports & adapters. Tests inject fixture map; prod injects global fetch.
- `Transfer ↔ fetch` — in-process. Tests inject recorded CDN body.

## Non-goals

- No backward-compat shims. Old `validateInstaUrl` / raw `videoUrl` string seams are deleted when replaced.
