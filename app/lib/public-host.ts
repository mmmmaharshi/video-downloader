// Module: PublicHost — the one guard that keeps a server-side fetch of a
// user-supplied link off the private network. MediaResolver checks the pasted
// link and every redirect hop; Transfer checks the file it is about to stream,
// so a page cannot hand us an internal address to fetch. Server-only.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

// DNS seam: production resolves for real, tests inject addresses.
// Both sync and async doubles work — every use site awaits.
export type HostLookup = (hostname: string) => Promise<string[]> | string[];

export const defaultLookup: HostLookup = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true });

  return records.map((r) => r.address);
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

export const assertPublicHost = async (
  url: string,
  lookup: HostLookup
): Promise<void> => {
  let addresses: string[];

  try {
    addresses = await lookup(new URL(url).hostname);
  } catch {
    throw new Error("Could not resolve this link. Check the URL.");
  }

  if (!addresses.length || addresses.some(isBlockedAddress)) {
    throw new Error("Only public links are supported.");
  }
};
