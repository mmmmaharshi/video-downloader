// Module: YouTube — anonymous MP4 extraction via the IOS InnerTube client.
// Interface: getYouTubeFormats(id, deps?) → TubeAsset[] (best rendition first).
// The IOS client returns plain playback URLs with no attestation; the default WEB
// client is gated and yields none. Some videos (typically label music) refuse anonymous
// playback on every IOS url, so a HEAD probe walks each ladder until a rung
// plays and ANDROID (360p, playable) is the fallback. A sweep that answers OK
// but plays nothing is usually throttling, so it runs once more before giving up.
// Seam: getInfo + fetch (live Innertube in prod, stubs in tests).
// The vocabulary is re-exported from youtube-types so callers keep one path.

import { Effect, Layer, Schema } from "effect";

import { fetchDepsLayer } from "./fetch-deps";
import { fetchGuarded, FETCH_TIMEOUT_MS } from "./guarded-fetch";
import type { GuardedFetch } from "./guarded-fetch";
import { defaultLookup } from "./public-host";
import type { HostLookup } from "./public-host";
import {
  getYouTubeFormatsProgram,
  toThrownError,
  YouTubeInfo,
} from "./youtube-effect";
import type {
  ClientName,
  TubeAsset,
  TubeFormat,
  TubeInfo,
} from "./youtube-types";

export interface YouTubeDeps {
  getInfo?: (id: string, client: ClientName) => Promise<TubeInfo> | TubeInfo;
  fetch?: typeof fetch;
  lookup?: HostLookup;
}

// One recent POST per client — no session object, no Node APIs, so the same
// code runs on Bun and on Workers. InnerTube answers the player payload the
// library used to parse for us; Schema reads only the fields we consume.
interface ClientContext {
  readonly androidSdkVersion?: number;
  readonly clientName: ClientName;
  readonly clientVersion: string;
  readonly deviceModel?: string;
  readonly osName: string;
  readonly osVersion: string;
}

// One source per identity fact: the UA strings interpolate these, so a
// version bump cannot leave the header and the UA disagreeing.
const ANDROID_VERSION = "20.10.38";
const IOS_VERSION = "20.10.4";
const IOS_DEVICE = "iPhone16,2";

const CLIENTS: Record<
  ClientName,
  { client: ClientContext; key: string; userAgent: string }
> = {
  ANDROID: {
    client: {
      androidSdkVersion: 34,
      clientName: "ANDROID",
      clientVersion: ANDROID_VERSION,
      osName: "Android",
      osVersion: "14",
    },
    key: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
    userAgent: `com.google.android.youtube/${ANDROID_VERSION} (Linux; U; Android 14) gzip`,
  },
  IOS: {
    client: {
      clientName: "IOS",
      clientVersion: IOS_VERSION,
      deviceModel: IOS_DEVICE,
      osName: "iPhone",
      osVersion: "18.3.2.22D82",
    },
    key: "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc",
    userAgent: `com.google.ios.youtube/${IOS_VERSION} (${IOS_DEVICE}; U; CPU iOS 18_3_2 like Mac OS X;)`,
  },
};

const InnertubeFormat = Schema.Struct({
  height: Schema.optional(Schema.Number),
  mimeType: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
});

const InnertubePlayer = Schema.Struct({
  playabilityStatus: Schema.optional(
    Schema.Struct({
      reason: Schema.optional(Schema.String),
      status: Schema.optional(Schema.String),
    })
  ),
  streamingData: Schema.optional(
    Schema.Struct({
      adaptiveFormats: Schema.optional(Schema.Array(InnertubeFormat)),
      formats: Schema.optional(Schema.Array(InnertubeFormat)),
    })
  ),
  videoDetails: Schema.optional(
    Schema.Struct({ title: Schema.optional(Schema.String) })
  ),
});

const toFormat =
  (muxed: boolean) =>
  (f: typeof InnertubeFormat.Type): TubeFormat[] =>
    f.url === undefined || f.mimeType === undefined
      ? []
      : [
          {
            height: f.height,
            mime_type: f.mimeType,
            muxed,
            url: f.url,
            width: f.width,
          },
        ];

// The InnerTube POST goes through the same guarded seam as every other read:
// an injected fetch and lookup must cover this call too, not only the probe.
const liveGetInfo = async (
  id: string,
  name: ClientName,
  http: GuardedFetch
): Promise<TubeInfo> => {
  const { client, key, userAgent } = CLIENTS[name];

  const { res } = await fetchGuarded(
    http,
    `https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`,
    {
      body: JSON.stringify({ context: { client }, videoId: id }),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": userAgent,
        "X-Youtube-Client-Name": name === "IOS" ? "5" : "3",
        "X-Youtube-Client-Version": String(client.clientVersion),
      },
      method: "POST",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  );

  if (!res.ok) {
    throw new Error(`InnerTube ${name} returned ${res.status}`);
  }

  const payload = Schema.decodeUnknownSync(InnertubePlayer)(await res.json());
  const sd = payload.streamingData;

  return {
    // progressive first: those are the only streams with sound
    formats: [
      ...(sd?.formats ?? []).flatMap(toFormat(true)),
      ...(sd?.adaptiveFormats ?? []).flatMap(toFormat(false)),
    ],
    playability: payload.playabilityStatus?.status ?? "UNKNOWN",
    reason: payload.playabilityStatus?.reason,
    title: payload.videoDetails?.title,
  };
};

// The format extraction runs as an Effect program (FetchDeps plus YouTubeInfo
// Layers) and is bridged back to promises here, so resolve()'s thrown-Error
// contract — including the unreachable cause — is unchanged.
export const getYouTubeFormats = async (
  id: string,
  deps: YouTubeDeps = {}
): Promise<TubeAsset[]> => {
  const layer = Layer.merge(
    fetchDepsLayer(deps.fetch, deps.lookup),
    Layer.succeed(YouTubeInfo)({
      getInfo:
        deps.getInfo ??
        ((videoId, client) =>
          liveGetInfo(videoId, client, {
            doFetch: deps.fetch ?? fetch,
            lookup: deps.lookup ?? defaultLookup,
          })),
    })
  );

  return await Effect.runPromise(
    Effect.mapError(
      Effect.provide(getYouTubeFormatsProgram(id), layer),
      toThrownError
    )
  );
};

export type {
  ClientName,
  TubeAsset,
  TubeFormat,
  TubeInfo,
} from "./youtube-types";
