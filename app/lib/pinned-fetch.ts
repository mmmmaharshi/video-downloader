// Module: PinnedFetch — dial a validated address while the request still names
// the original origin. Server-only; the address approval lives in PublicHost.

import { GUARD_BLOCKED_MESSAGE, ipVersion } from "./public-host";
import { runsOnWorkers } from "./runtime";

type PinHost = (
  doFetch: typeof fetch,
  url: string,
  addresses: string[],
  init: BunFetchRequestInit
) => Promise<Response>;

// Bun dials the address that appears in the URL, so put the checked address
// there and keep the origin in Host and tls.serverName. A relative Location
// resolves against the address, so callers follow redirects themselves.
// Workers has no raw sockets: there the guard check still runs (DoH, via the
// injected lookup), but the dial goes to the hostname itself — a TTL-0 rebind
// between the two stays open (see ADR-0003). Only Workers takes that path:
// Node and Bun both honor the pinned dial.

// eslint-disable-next-line require-await -- the seam stays async so a rejected approval surfaces as a rejection, not a sync throw
export const pinnedFetch: PinHost = async (doFetch, url, addresses, init) => {
  const [address] = addresses;

  // fail closed: an empty approval set must never turn into a hostname fetch
  if (!address) {
    throw new Error(GUARD_BLOCKED_MESSAGE);
  }

  if (runsOnWorkers()) {
    const { headers, method, body, signal } = init;

    return doFetch(url, {
      body,
      headers,
      method,
      redirect: "manual",
      signal,
    });
  }

  const target = new URL(url);
  const dial = new URL(url);

  // the URL parser only accepts a bare address for IPv4; IPv6 needs brackets
  dial.hostname = ipVersion(address) === 6 ? `[${address}]` : address;

  const headers = new Headers(init.headers);

  headers.set("Host", target.host);

  return doFetch(dial.href, {
    ...init,
    headers,
    proxy: false,
    tls: { serverName: target.hostname },
  });
};
