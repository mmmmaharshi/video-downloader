import { Context, Effect } from "effect";

import { FetchDeps } from "./fetch-deps";
import { fetchGuarded } from "./guarded-fetch";
import { unhandledError } from "./unhandled-error";
import type { ClientName, TubeAsset, TubeInfo } from "./youtube";

// Module: YouTubeEffect — the anonymous MP4 extraction as an Effect program.
// The IOS client returns plain playback URLs with no attestation; some videos
// refuse anonymous playback on every IOS url, so a HEAD probe gates every
// rung and ANDROID is the fallback. A sweep that answers OK but plays
// nothing is usually throttling, not an unplayable video, so it runs once
// more after a breath before reporting empty. Dependencies arrive as Layers
// (FetchDeps for transport, YouTubeInfo for InnerTube); failures are a plain
// tagged union, mapped to the legacy user-facing strings at the bridge in
// youtube.ts, which keeps getYouTubeFormats' thrown-Error contract.

export interface YouTubeGetInfo {
  readonly getInfo: (
    id: string,
    client: ClientName
  ) => Promise<TubeInfo> | TubeInfo;
}

export class YouTubeInfo extends Context.Service<YouTubeInfo, YouTubeGetInfo>()(
  "YouTubeInfo"
) {}

export interface YouTubeUnreachable {
  readonly _tag: "YouTubeUnreachable";
  readonly cause: unknown;
}

export interface YouTubeUnavailable {
  readonly _tag: "YouTubeUnavailable";
  readonly reason: string;
}

export type YouTubeError = YouTubeUnavailable | YouTubeUnreachable;

// Legacy strings, pinned by test: the bridge keeps the promise contract while
// the program reasons in tags.
export const youtubeErrorMessage = (error: YouTubeError): string => {
  switch (error._tag) {
    case "YouTubeUnreachable": {
      return "YouTube is unreachable right now. Try again later.";
    }

    case "YouTubeUnavailable": {
      return `This video is unavailable: ${error.reason}. Private or age-restricted videos need a login, which is not supported.`;
    }

    default: {
      return unhandledError("YouTube", error);
    }
  }
};

// The bridge maps tags to thrown Errors; a named function (not an inline
// callback) so the call site stays a plain Effect pipeline.
export const toThrownError = (error: YouTubeError): Error => {
  if (error._tag === "YouTubeUnreachable") {
    return new Error(youtubeErrorMessage(error), { cause: error.cause });
  }

  return new Error(youtubeErrorMessage(error));
};

const CLIENTS: ClientName[] = ["IOS", "ANDROID"];

interface TubeFormat {
  readonly height?: number;
  readonly mime_type: string;
  readonly muxed?: boolean;
  readonly url?: string;
  readonly width?: number;
}

interface RungChoice {
  assets: TubeAsset[];
  muxed: boolean;
}

// Only muxed streams carry audio: a video-only rung downloads silent, so it is
// offered only when no client publishes a muxed rung at all.
const bestMp4s = (info: TubeInfo): RungChoice => {
  const mp4s = info.formats.filter(
    (f): f is TubeFormat & { url: string } =>
      f.mime_type.startsWith("video/mp4") && f.url !== undefined
  );

  const withAudio = mp4s.filter((f) => f.muxed === true);
  const chosen = withAudio.length > 0 ? withAudio : mp4s;

  return {
    assets: chosen
      .map((f) => ({ height: f.height ?? 0, videoUrl: f.url }))
      // eslint-disable-next-line unicorn/no-array-sort -- fresh mapped copy, and toSorted needs ES2023 lib
      .sort((a, b) => b.height - a.height),
    muxed: withAudio.length > 0,
  };
};

// An InnerTube format url is upstream-supplied; the guarded loop checks every
// hop so a redirect cannot carry the probe onto a private host. A failed probe
// means the client cannot play this video, not that the whole resolve failed.
const probeHead = (url: string): Effect.Effect<boolean, never, FetchDeps> =>
  Effect.gen(function* probe() {
    const { doFetch, lookup } = yield* FetchDeps;

    return yield* Effect.promise(() =>
      fetchGuarded({ doFetch, lookup }, url, { method: "HEAD" }).then(
        ({ res }) => res.ok,
        () => false
      )
    );
  });

export const getYouTubeFormatsProgram = (
  id: string
): Effect.Effect<TubeAsset[], YouTubeError, FetchDeps | YouTubeInfo> =>
  Effect.gen(function* program() {
    const { getInfo } = yield* YouTubeInfo;

    // at most two sweeps: the second answers a throttled first, and a video
    // with truly no mp4 answer costs one extra second, not an endless probe
    for (let sweep = 0; sweep < 2; sweep += 1) {
      let answered = false;
      let failure: unknown;
      let reason: string | undefined;
      let silentFallback: TubeAsset[] | undefined;

      for (const client of CLIENTS) {
        // a per-client failure is data (fall through to the next client), not a
        // program failure: the inner promise never rejects, it reports ok/cause
        const attempt = yield* Effect.promise(() =>
          Promise.resolve()
            .then(() => getInfo(id, client))
            .then(
              (info) => ({ info, ok: true as const }),
              // eslint-disable-next-line anti-slop/no-unknown-parameters -- the injected getInfo double can throw any value; the sentinel carries it opaquely as the unreachable cause without inspecting it
              (error: unknown) => ({ cause: error, ok: false as const })
            )
        );

        if (!attempt.ok) {
          failure = attempt.cause;
          continue;
        }

        answered = true;

        const { info } = attempt;

        if (info.playability !== "OK") {
          reason ??= info.reason;
          continue;
        }

        const { assets, muxed } = bestMp4s(info);

        if (!assets.length) {
          continue;
        }

        // the best rung usually decides, but a throttled head rung must not
        // condemn the rest of the ladder: probe down it until one plays
        let playable = false;

        for (const candidate of assets) {
          if (yield* probeHead(candidate.videoUrl)) {
            playable = true;
            break;
          }
        }

        if (!playable) {
          continue;
        }

        const titled = assets.map((m) => ({ ...m, title: info.title }));

        // a muxed answer wins outright; a video-only one is kept only in case
        // no client offers sound for this video
        if (muxed) {
          return titled;
        }

        silentFallback ??= titled;
      }

      if (!answered) {
        return yield* Effect.fail({
          _tag: "YouTubeUnreachable" as const,
          cause: failure,
        });
      }

      if (silentFallback !== undefined) {
        return silentFallback;
      }

      if (reason !== undefined) {
        return yield* Effect.fail({
          _tag: "YouTubeUnavailable" as const,
          reason,
        });
      }

      if (sweep === 0) {
        yield* Effect.sleep("1 second");
      }
    }

    return [];
  });
