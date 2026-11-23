import { Effect } from "effect";

import type { FetchDeps } from "./fetch-deps";
import {
  INVALID_REDIRECT_MESSAGE,
  PAGE_HEADERS,
  TOO_MANY_REDIRECTS_MESSAGE,
} from "./guarded-fetch";
import { extractOgVideo, extractThumbnail, normalizeUrl } from "./og-meta";
import { readPageText } from "./page-body";
import { fetchPage } from "./page-fetch";
import { GUARD_BLOCKED_MESSAGE, GUARD_UNRESOLVED_MESSAGE } from "./public-host";
import type { Rendition } from "./renditions";
import type { VideoAsset } from "./resolve-query";
import { unhandledError } from "./unhandled-error";

// Module: FacebookEffect — the Facebook page scrape as an Effect program.
// Facebook ships the video file only on the full (browser-header) page
// variant: browser_native_hd/sd_url inside the ScheduledPayloads, with
// og:video and hd_src/sd_src as fallbacks. A login redirect is the only
// reliable private signal: public pages carry login links in their chrome,
// so page text never decides that. Dependencies arrive as a FetchDeps Layer;
// failures are a plain tagged union, mapped to the legacy user-facing strings
// at the bridge in media-resolver, which keeps resolve()'s thrown-Error
// contract.

export type FacebookError =
  | { readonly _tag: "FacebookBadRedirect" }
  | { readonly _tag: "FacebookGuardBlocked" }
  | { readonly _tag: "FacebookLoginRedirect" }
  | { readonly _tag: "FacebookNoVideo" }
  | { readonly _tag: "FacebookNotFound" }
  | { readonly _tag: "FacebookTooManyRedirects" }
  | { readonly _tag: "FacebookUnreachable" }
  | { readonly _tag: "FacebookUnresolved" }
  | { readonly _tag: "FacebookUpstream"; readonly status: number };

// Legacy strings, pinned by test: the bridge keeps resolve()'s contract while
// the program reasons in tags.
export const facebookErrorMessage = (error: FacebookError): string => {
  switch (error._tag) {
    case "FacebookNotFound": {
      return "Post not found. Check the URL.";
    }

    case "FacebookUpstream": {
      return `Facebook returned ${error.status}. Try again later.`;
    }

    case "FacebookLoginRedirect": {
      return "Private or login-required post. Only public posts are supported.";
    }

    case "FacebookNoVideo": {
      return "No downloadable video found. Only public video/reel posts work, and Facebook limits anonymous access to some of them.";
    }

    case "FacebookUnreachable": {
      return "Facebook is unreachable right now. Try again later.";
    }

    case "FacebookBadRedirect": {
      return INVALID_REDIRECT_MESSAGE;
    }

    case "FacebookTooManyRedirects": {
      return TOO_MANY_REDIRECTS_MESSAGE;
    }

    case "FacebookGuardBlocked": {
      return GUARD_BLOCKED_MESSAGE;
    }

    case "FacebookUnresolved": {
      return GUARD_UNRESOLVED_MESSAGE;
    }

    default: {
      return unhandledError("Facebook", error);
    }
  }
};

export const toThrownError = (error: FacebookError): Error =>
  new Error(facebookErrorMessage(error));

const extractFbFile = (html: string, key: string): string | undefined => {
  const v = html.match(new RegExp(`"${key}"\\s*:\\s*"(?<value>[^"]+)"`, "u"))
    ?.groups?.value;

  return v ? normalizeUrl(v) : undefined;
};

export interface FacebookInput {
  readonly fetchUrl: string;
  readonly id: string;
  readonly sourceUrl: string;
}

export const resolveFacebookProgram = (
  input: FacebookInput
): Effect.Effect<VideoAsset[], FacebookError, FetchDeps> =>
  Effect.gen(function* program() {
    const { fetchUrl, id, sourceUrl } = input;

    const { res, url } = yield* fetchPage(
      fetchUrl,
      { ...PAGE_HEADERS },
      {
        badRedirect: { _tag: "FacebookBadRedirect" as const },
        blocked: { _tag: "FacebookGuardBlocked" as const },
        tooManyRedirects: { _tag: "FacebookTooManyRedirects" as const },
        unreachable: { _tag: "FacebookUnreachable" as const },
        unresolved: { _tag: "FacebookUnresolved" as const },
      }
    );

    // a login redirect is the only reliable private signal: public pages carry
    // login links in their chrome, so page text never decides this
    if (
      (res.redirected && res.url.includes("facebook.com/login")) ||
      url.includes("facebook.com/login")
    ) {
      return yield* Effect.fail({ _tag: "FacebookLoginRedirect" as const });
    }

    if (res.status === 404) {
      return yield* Effect.fail({ _tag: "FacebookNotFound" as const });
    }

    if (!res.ok) {
      return yield* Effect.fail({
        _tag: "FacebookUpstream" as const,
        status: res.status,
      });
    }

    const html = yield* Effect.tryPromise({
      catch: () => ({ _tag: "FacebookUnreachable" as const }),
      try: () => readPageText(res),
    });

    // Facebook names two rungs of the same video; og:video is the sd-grade last
    // resort when neither stream url is in the page
    const hd =
      extractFbFile(html, "browser_native_hd_url") ??
      extractFbFile(html, "hd_src");

    const sd =
      extractFbFile(html, "browser_native_sd_url") ??
      extractFbFile(html, "sd_src") ??
      extractOgVideo(html);

    const renditions: Rendition[] = [];

    if (hd !== undefined) {
      renditions.push({ label: "HD", url: hd });
    }

    // the page usually repeats the same url for both rungs — one option then
    if (sd !== undefined && sd !== hd) {
      renditions.push({ label: hd === undefined ? undefined : "SD", url: sd });
    }

    if (!renditions.length) {
      return yield* Effect.fail({ _tag: "FacebookNoVideo" as const });
    }

    return renditions.map((r) => ({
      label: r.label,
      platform: "facebook" as const,
      shortcode: id,
      sourceUrl,
      thumbnail: extractThumbnail(html),
      videoUrl: r.url,
    }));
  });
