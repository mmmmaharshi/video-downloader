// Module: PublicHost — the one guard that keeps a server-side fetch of a
// user-supplied link off the private network. MediaResolver checks the pasted
// link and every redirect hop; Transfer checks the file it is about to stream,
// so a page cannot hand us an internal address to fetch. Server-only.
// PinnedFetch owns dialing the addresses this module approves.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { Schema } from "effect";

// DNS seam: production resolves for real, tests inject addresses.
// Both sync and async doubles work — every use site awaits.
export type HostLookup = (hostname: string) => Promise<string[]> | string[];

export const defaultLookup: HostLookup = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true });

  return records.map((r) => r.address);
};

// Workers has no node:dns and no raw sockets. Resolve over DNS-over-HTTPS so
// the same guard runs on Cloudflare. Query both A and AAAA: an AAAA-only
// host must not slip past an A-only check. The caller still re-checks every
// redirect hop; a TTL-0 rebind between this check and the Worker's fetch stays
// open (see ADR-0003) because cf.resolveOverride only pins names in our zone.
const DohResponse = Schema.Struct({
  Answer: Schema.optional(Schema.Array(Schema.Struct({ data: Schema.String }))),
});

const dohQuery = async (
  hostname: string,
  recordType: "A" | "AAAA",
  doFetch: DohFetch
): Promise<string[]> => {
  const res = await doFetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${recordType}`,
    { headers: { Accept: "application/dns-json" } }
  );

  if (!res.ok) {
    throw new Error(`DoH ${recordType} query failed with ${res.status}`);
  }

  try {
    return (
      Schema.decodeUnknownSync(DohResponse)(await res.json()).Answer ?? []
    ).map((record) => record.data);
  } catch {
    return [];
  }
};

export type DohFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export const dohLookup = async (
  hostname: string,
  doFetch: DohFetch = fetch
): Promise<string[]> => {
  const [aRecords, aaaaRecords] = await Promise.all([
    dohQuery(hostname, "A", doFetch),
    dohQuery(hostname, "AAAA", doFetch),
  ]);

  return [...aRecords, ...aaaaRecords];
};

// Explicit range checks — Bun's net.BlockList mishandles IPv6.
const isBlockedIPV4 = (addr: string): boolean => {
  const [a, b, c] = addr.split(".").map(Number);

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    // CGNAT
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    // IETF-assigned, private
    (a === 192 && ((b === 0 && c === 0) || b === 168)) ||
    // benchmarking
    (a === 198 && (b === 18 || b === 19))
  );
};

// An IPv4-mapped address is the same host in another notation, and resolvers
// hand back the hex form: ::ffff:7f00:1 is 127.0.0.1. Judge the embedded address.
const mappedIPv4 = (addr: string): string | undefined => {
  const hex =
    /^(?::*|(?:0:)+)ffff:(?<hi>[0-9a-f]{1,4}):(?<lo>[0-9a-f]{1,4})$/u.exec(
      addr
    )?.groups;

  if (hex) {
    const hi = Number.parseInt(hex.hi, 16);
    const lo = Number.parseInt(hex.lo, 16);

    return `${Math.floor(hi / 256)}.${hi % 256}.${Math.floor(lo / 256)}.${lo % 256}`;
  }

  return /^(?::*|(?:0:)+)ffff:(?<v4>\d+\.\d+\.\d+\.\d+)$/u.exec(addr)?.groups
    ?.v4;
};

const isBlockedIPV6 = (addr: string): boolean => {
  const n = addr.toLowerCase();
  const mapped = mappedIPv4(n);

  if (mapped) {
    return isBlockedIPV4(mapped);
  }

  const [first] = n.split(":");

  // fe80::/10 is first hextet fe80–febf, i.e. second hex digit 8–b
  return (
    n === "::" ||
    n === "::1" ||
    /^0(?::0){6,7}(?::1)?$/u.test(n) ||
    first.startsWith("fc") ||
    first.startsWith("fd") ||
    first.startsWith("ff") ||
    /^fe[89ab]/u.test(first)
  );
};

const isBlockedAddress = (addr: string): boolean => {
  if (isIP(addr) === 4) {
    return isBlockedIPV4(addr);
  }

  if (isIP(addr) === 6) {
    return isBlockedIPV6(addr);
  }

  return true;
};

// The guard decision without dialing: manual-hop loops (Rumble's cookie loop)
// classify each hop's addresses through it and stay fully typed.
export const areAddressesPublic = (addresses: string[]): boolean =>
  addresses.length > 0 && !addresses.some(isBlockedAddress);

// The guard's user-facing messages: single source for resolvePublicAddresses
// and the Effect programs that classify a failed fetch back into them.
export const GUARD_BLOCKED_MESSAGE = "Only public links are supported.";

export const GUARD_UNRESOLVED_MESSAGE =
  "Could not resolve this link. Check the URL.";

// Resolve and validate in one step so the caller can pin the connection to the
// very addresses the guard approved. Discarding them reintroduces DNS rebinding.
export const resolvePublicAddresses = async (
  url: string,
  lookup: HostLookup
): Promise<string[]> => {
  let addresses: string[];

  try {
    addresses = await lookup(new URL(url).hostname);
  } catch {
    throw new Error(GUARD_UNRESOLVED_MESSAGE);
  }

  if (!addresses.length || addresses.some(isBlockedAddress)) {
    throw new Error(GUARD_BLOCKED_MESSAGE);
  }

  return addresses;
};
