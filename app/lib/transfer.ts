// Module: Transfer — deep module per CONTEXT.md
// Interface: isAllowedHost(url), proxy(videoUrl, stem, deps?) → Response
// Owns allowlist policy + streaming. Both routes call it — one policy, N call sites.

import { UA } from "./user-agent";

const ALLOWED_HOSTS = ["cdninstagram.com", "fbcdn.net", "scontent.cdninstagram.com", "video.twimg.com"] as const;
const UPSTREAM_TIMEOUT_MS = 15_000;

export type TransferDeps = {
  fetch?: typeof fetch;
};

export function isAllowedHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const h = parsed.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

export async function proxy(
  videoUrl: string | null,
  stem: string,
  deps: TransferDeps = {},
): Promise<Response> {
  if (!videoUrl) throw new Response("Missing url", { status: 400 });
  if (!isAllowedHost(videoUrl)) throw new Response("URL not allowed", { status: 400 });

  const doFetch = deps.fetch ?? fetch;

  // Only time-to-headers is bounded — aborting mid-stream would truncate the download
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await doFetch(videoUrl, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
  } catch {
    throw new Response("Upstream unreachable", { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  if (!upstream.ok || !upstream.body) throw new Response(`Upstream ${upstream.status}`, { status: 502 });

  const contentType = upstream.headers.get("content-type") ?? "video/mp4";
  // the stem arrives from the query string — keep it out of the header grammar
  const safeName = stem.replace(/[^\w.-]+/g, "_");
  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeName}.mp4"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
