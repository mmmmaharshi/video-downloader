import { Context, Effect } from "effect";

import { FetchDeps } from "./fetch-deps";
import { fetchGuarded } from "./guarded-fetch";
import { unhandledError } from "./unhandled-error";
import type {
  ClientName,
  TubeAsset,
  TubeFormat,
  TubeInfo,
} from "./youtube-types";

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

    return yield* Effect.promise(async () => {
      try {
        const { res } = await fetchGuarded({ doFetch, lookup }, url, {
          method: "HEAD",
        });

        return res.ok;
      } catch {
        return false;
      }
    });
  });

// One client's answer, reduced to the four things the sweep acts on.
type ClientOutcome =
  | { readonly cause: unknown; readonly tag: "failed" }
  | { readonly reason: string | undefined; readonly tag: "unplayable" }
  | { readonly tag: "none" }
  | {
      readonly assets: TubeAsset[];
      readonly muxed: boolean;
      readonly tag: "playable";
    };

// the best rung usually decides, but a throttled head rung must not condemn the
// rest of the ladder: probe down it until one plays
const anyPlayable = (
  assets: TubeAsset[]
): Effect.Effect<boolean, never, FetchDeps> =>
  Effect.gen(function* probe() {
    for (const candidate of assets) {
      if (yield* probeHead(candidate.videoUrl)) {
        return true;
      }
    }

    return false;
  });

const attemptClient = (
  id: string,
  client: ClientName,
  getInfo: (id: string, client: ClientName) => TubeInfo | Promise<TubeInfo>
): Effect.Effect<ClientOutcome, never, FetchDeps> =>
  Effect.gen(function* attempt() {
    // a per-client failure is data (fall through to the next client), not a
    // program failure: the attempt reports ok/cause and never rejects
    const answer = yield* Effect.promise(async () => {
      try {
        return { info: await getInfo(id, client), tag: "info" as const };
        // eslint-disable-next-line anti-slop/no-unknown-parameters -- the injected getInfo double can throw any value; the sentinel carries it opaquely as the unreachable cause without inspecting it
      } catch (error: unknown) {
        return { cause: error, tag: "failed" as const };
      }
    });

    if (answer.tag === "failed") {
      return { cause: answer.cause, tag: "failed" as const };
    }

    const { info } = answer;

    if (info.playability !== "OK") {
      return { reason: info.reason, tag: "unplayable" as const };
    }

    const { assets, muxed } = bestMp4s(info);

    if (assets.length === 0 || !(yield* anyPlayable(assets))) {
      return { tag: "none" as const };
    }

    return {
      assets: assets.map((m) => ({ ...m, title: info.title })),
      muxed,
      tag: "playable" as const,
    };
  });

// What one sweep over the clients concluded.
type SweepResult =
  | { readonly assets: TubeAsset[]; readonly tag: "muxed" | "silent" }
  | { readonly cause: unknown; readonly tag: "unreachable" }
  | { readonly reason: string; readonly tag: "unavailable" }
  | { readonly tag: "retry" };

const runSweep = (
  id: string,
  getInfo: (id: string, client: ClientName) => TubeInfo | Promise<TubeInfo>
): Effect.Effect<SweepResult, never, FetchDeps> =>
  Effect.gen(function* sweep() {
    let answered = false;
    let failure: unknown;
    let reason: string | undefined;
    let silentFallback: TubeAsset[] | undefined;

    for (const client of CLIENTS) {
      const outcome = yield* attemptClient(id, client, getInfo);

      if (outcome.tag === "failed") {
        failure = outcome.cause;
      } else {
        answered = true;

        if (outcome.tag === "unplayable") {
          reason ??= outcome.reason;
        } else if (outcome.tag === "playable") {
          // a muxed answer wins outright; a video-only one is kept only in
          // case no client offers sound for this video
          if (outcome.muxed) {
            return { assets: outcome.assets, tag: "muxed" as const };
          }

          silentFallback ??= outcome.assets;
        }
      }
    }

    if (!answered) {
      return { cause: failure, tag: "unreachable" as const };
    }

    if (silentFallback !== undefined) {
      return { assets: silentFallback, tag: "silent" as const };
    }

    if (reason !== undefined) {
      return { reason, tag: "unavailable" as const };
    }

    return { tag: "retry" as const };
  });

export const getYouTubeFormatsProgram = (
  id: string
): Effect.Effect<TubeAsset[], YouTubeError, FetchDeps | YouTubeInfo> =>
  Effect.gen(function* program() {
    const { getInfo } = yield* YouTubeInfo;

    // at most two sweeps: the second answers a throttled first, and a video
    // with truly no mp4 answer costs one extra second, not an endless probe
    for (let sweep = 0; sweep < 2; sweep += 1) {
      const result = yield* runSweep(id, getInfo);

      if (result.tag === "muxed" || result.tag === "silent") {
        return result.assets;
      }

      if (result.tag === "unreachable") {
        return yield* Effect.fail({
          _tag: "YouTubeUnreachable" as const,
          cause: result.cause,
        });
      }

      if (result.tag === "unavailable") {
        return yield* Effect.fail({
          _tag: "YouTubeUnavailable" as const,
          reason: result.reason,
        });
      }

      if (sweep === 0) {
        yield* Effect.sleep("1 second");
      }
    }

    return [];
  });
