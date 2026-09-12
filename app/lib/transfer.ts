// Module: Transfer — deep module per CONTEXT.md
// Interface: isAllowedHost(url), proxy(videoUrl, shortcode, deps?) → Response
// Owns allowlist policy + streaming. Both routes call it — one policy, N call sites.

const ALLOWED_HOSTS = ["cdninstagram.com", "fbcdn.net", "scontent.cdninstagram.com"] as const;

export type TransferDeps = {
  fetch?: typeof fetch;
};

export function isAllowedHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return ALLOWED_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

export async function proxy(videoUrl: string, shortcode: string, deps: TransferDeps = {}): Promise<Response> {
  if (!videoUrl) throw new Response("Missing url", { status: 400 });
  if (!isAllowedHost(videoUrl)) throw new Response("URL not allowed", { status: 400 });

  const doFetch = deps.fetch ?? fetch;
  const upstream = await doFetch(videoUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!upstream.ok || !upstream.body) throw new Response(`Upstream ${upstream.status}`, { status: 502 });

  const contentType = upstream.headers.get("content-type") ?? "video/mp4";
  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="instagram-${shortcode}.mp4"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
