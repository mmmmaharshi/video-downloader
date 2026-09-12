// Module: MediaResolver — deep module per CONTEXT.md
// Interface: resolve(sourceUrl, deps?) → VideoAsset
// Seam: fetch (live in prod, in-memory fixtures in tests — two adapters = real seam)

export type VideoAsset = {
  videoUrl: string;
  thumbnail?: string;
  shortcode: string;
  sourceUrl: string;
};

export type MediaResolverDeps = {
  fetch?: typeof fetch;
};

const INSTA_RE = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?(\?.*)?$/;

function parseShortcode(sourceUrl: string): string {
  const m = sourceUrl.trim().match(INSTA_RE);
  if (!m) throw new Error("Invalid URL. Use https://instagram.com/reel/… or /p/…");
  return m[3];
}

function normalizeUrl(raw: string): string {
  return raw.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
}

function extractOgVideo(html: string): string | undefined {
  let v =
    html.match(/<meta\s+property="og:video:secure_url"\s+content="([^"]+)"/)?.[1] ??
    html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/)?.[1] ??
    html.match(/"video_url"\s*:\s*"([^"]+)"/)?.[1] ??
    html.match(/"videoUrl"\s*:\s*"([^"]+)"/)?.[1];
  return v ? normalizeUrl(v) : undefined;
}

function extractThumbnail(html: string): string | undefined {
  return html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
}

export async function resolve(sourceUrl: string, deps: MediaResolverDeps = {}): Promise<VideoAsset> {
  const trimmed = sourceUrl.trim();
  if (!trimmed) throw new Error("Paste an Instagram URL");
  const shortcode = parseShortcode(trimmed);

  const doFetch = deps.fetch ?? fetch;

  const res = await doFetch(trimmed, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (res.status === 404) throw new Error("Post not found. Check the URL.");
  // node fetch sets redirected; bun fetch similar — check raw url if available
  const finalUrl = (res as unknown as { url?: string }).url ?? "";
  if ((res as unknown as { redirected?: boolean }).redirected && finalUrl.includes("/accounts/login")) {
    throw new Error("Private or login-required post. Only public posts are supported.");
  }
  if (!res.ok) throw new Error(`Instagram returned ${res.status}. Try again later.`);

  const html = await res.text();

  if (html.includes("/accounts/login") && !html.includes("og:video")) {
    throw new Error("Private post or requires login. Only public posts work.");
  }

  let videoUrl = extractOgVideo(html);

  // embed fallback — double-escaped JSON in embed HTML
  if (!videoUrl) {
    try {
      const embedKind = trimmed.includes("/reel/") ? "reel" : trimmed.includes("/tv/") ? "tv" : "p";
      const embedUrl = `https://www.instagram.com/${embedKind}/${shortcode}/embed/captioned/`;
      const er = await doFetch(embedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (er.ok) {
        const ehtml = await er.text();
        const evRaw =
          ehtml.match(/(?:\\"|")video_url(?:\\"|")\s*:\s*(?:\\"|")([^"]+)(?:\\"|")/)?.[1] ??
          ehtml.match(/(?:\\"|")videoUrl(?:\\"|")\s*:\s*(?:\\"|")([^"]+)(?:\\"|")/)?.[1];
        if (evRaw) videoUrl = evRaw.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/\\/g, "").replace(/&amp;/g, "&");
      }
    } catch {
      // swallow — handled by final throw
    }
  }

  if (!videoUrl) throw new Error("No video found. Only video/reel posts are downloadable, or IG changed its page.");

  return { videoUrl, thumbnail: extractThumbnail(html), shortcode, sourceUrl: trimmed };
}
