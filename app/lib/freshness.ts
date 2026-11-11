// Module: Freshness — the one window a resolution stays usable: the client
// cache re-serves a hit, and the download link stays valid, for exactly this
// long. Its own module so the download route never imports the client schema.

export const FRESH_MS = 10 * 60_000;
