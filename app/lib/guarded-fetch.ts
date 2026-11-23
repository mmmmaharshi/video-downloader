// Module: GuardedFetch — one check-then-dial loop for every server fetch.
// Each hop is validated against the public-address guard before its socket is
// pinned, so a DNS change between check and dial cannot redirect the socket.
// Redirects stay manual: the loop resolves the next hop and checks it again.

import { pinnedFetch } from "./pinned-fetch";
import type { HostLookup } from "./public-host";
import { resolvePublicAddresses } from "./public-host";
import { CHROME_UA } from "./user-agent";

const MAX_REDIRECTS = 4;

// the shared fetch loop's own control-flow failures, named here so Effect
// programs can map a failed fetch back to the exact legacy message instead
// of collapsing everything into "unreachable"
export const TOO_MANY_REDIRECTS_MESSAGE = "This link redirects too many times.";

export const INVALID_REDIRECT_MESSAGE =
  "This link redirects somewhere invalid.";

// header-stall bound shared by every guarded page fetch
export const FETCH_TIMEOUT_MS = 15_000;

// page-fetch policy shared by every resolver and the Rumble Effect program:
// a page document with a browser-like identity
export const PAGE_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": CHROME_UA,
};

export interface GuardedFetch {
  doFetch: typeof fetch;
  lookup: HostLookup;
}

export const fetchGuarded = async (
  http: GuardedFetch,
  url: string,
  init: BunFetchRequestInit
): Promise<{ res: Response; url: string }> => {
  let current = url;

  for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
    // eslint-disable-next-line no-await-in-loop -- each hop feeds the next check
    const addresses = await resolvePublicAddresses(current, http.lookup);

    // eslint-disable-next-line no-await-in-loop -- the response decides whether another hop is needed
    const res = await pinnedFetch(http.doFetch, current, addresses, {
      ...init,
      redirect: "manual",
    });

    const location =
      res.status >= 300 && res.status < 400
        ? res.headers.get("location")
        : null;

    if (!location) {
      return { res, url: current };
    }

    try {
      current = new URL(location, current).href;
    } catch {
      throw new Error(INVALID_REDIRECT_MESSAGE);
    }
  }

  throw new Error(TOO_MANY_REDIRECTS_MESSAGE);
};
