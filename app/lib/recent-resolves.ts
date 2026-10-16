// Module: RecentResolves — short-lived memory of video URLs the form resolved.
// Interface: rememberResolved(url, now?), wasResolved(url, now?).
// The download loader only serves remembered URLs, so the proxy answers the app, not the internet.
// shortcut: single-process memory — if the server ever runs on multiple processes, this needs a shared store.

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 200;

const seen = new Map<string, number>();

function prune(now: number): void {
  for (const [url, at] of seen) if (now - at >= TTL_MS) seen.delete(url);
}

export function rememberResolved(url: string, now: number = Date.now()): void {
  prune(now);
  seen.set(url, now);
  // bound memory even if distinct urls flood in faster than they expire
  for (const oldest of seen.keys()) {
    if (seen.size <= MAX_ENTRIES) break;
    seen.delete(oldest);
  }
}

export function wasResolved(url: string | null, now: number = Date.now()): boolean {
  if (!url) return false;
  const at = seen.get(url);
  return at !== undefined && now - at < TTL_MS;
}
