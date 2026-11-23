// Module: GuardedFetch — one check-then-dial loop for every server fetch.
// Each hop is validated against the public-address guard before its socket is
// pinned, so a DNS change between check and dial cannot reach a private host.
// Redirects stay manual: the loop resolves the next hop and checks it again.

import { pinnedFetch } from "./pinned-fetch";
import type { HostLookup } from "./public-host";
import { resolvePublicAddresses } from "./public-host";

const MAX_REDIRECTS = 4;

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
      throw new Error("This link redirects somewhere invalid.");
    }
  }

  throw new Error("This link redirects too many times.");
};
