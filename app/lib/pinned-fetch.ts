// Module: PinnedFetch — dial a validated address while the request still names
// the original origin. Server-only; the address approval lives in PublicHost.

import { isIP } from "node:net";

type PinHost = (
  doFetch: typeof fetch,
  url: string,
  addresses: string[],
  init: BunFetchRequestInit
) => Promise<Response>;

// Bun dials the address that appears in the URL, so put the checked address
// there and keep the origin in Host and tls.serverName. A relative Location
// resolves against the address, so callers follow redirects themselves.
// eslint-disable-next-line require-await -- the seam stays async so a rejected approval surfaces as a rejection, not a sync throw
export const pinnedFetch: PinHost = async (doFetch, url, addresses, init) => {
  const [address] = addresses;

  // fail closed: an empty approval set must never turn into a hostname fetch
  if (!address) {
    throw new Error("Only public links are supported.");
  }

  const target = new URL(url);
  const dial = new URL(url);

  // the URL parser only accepts a bare address for IPv4; IPv6 needs brackets
  dial.hostname = isIP(address) === 6 ? `[${address}]` : address;

  const headers = new Headers(init.headers);

  headers.set("Host", target.host);

  return doFetch(dial.href, {
    ...init,
    headers,
    proxy: false,
    tls: { serverName: target.hostname },
  });
};
