import { Effect } from "effect";

import { readCappedUtf8 } from "./capped-body";
import { containerOf, isManifestContainer } from "./container";
import type { Container } from "./container";
import { FetchDeps, guardAddresses } from "./fetch-deps";
import { FETCH_TIMEOUT_MS } from "./guarded-fetch";
import { pinnedFetch } from "./pinned-fetch";
import { UA } from "./user-agent";

// Module: TransferEffect — the download proxy as an Effect program.
// Dependencies arrive as a FetchDeps Layer; failures are a plain tagged union,
// mapped to the legacy thrown-Response contract at the bridge in transfer.ts
// (ADR-0001 keeps Transfer's Response currency). Byte caps, range
// passthrough, and manifest absolutization move with the flow so the two
// never disagree.

// the header-stall bound is the one every server fetch shares

// stays inside the function's own wall clock; the platform still cuts a stream that overruns it
const UPSTREAM_MAX_MS = 4 * 60_000;

// one download through the function, not a bulk mirror
const MAX_DOWNLOAD_BYTES = 1024 ** 3;

export interface TransferForbidden {
  readonly _tag: "TransferForbidden";
}

export interface TransferUnreachable {
  readonly _tag: "TransferUnreachable";
}

export interface TransferBadUpstream {
  readonly _tag: "TransferBadUpstream";
  readonly status: number;
}

export interface TransferTooLarge {
  readonly _tag: "TransferTooLarge";
}

export type TransferError =
  | TransferBadUpstream
  | TransferForbidden
  | TransferTooLarge
  | TransferUnreachable;

// One 413 for both places that answer it: a known length refuses before the
// body, and a manifest read refuses while buffering.
const TOO_LARGE_MESSAGE = "This file is too large to download here";

const tooLarge = (): Response =>
  new Response(TOO_LARGE_MESSAGE, { status: 413 });

// Legacy contracts, pinned by test: the bridge keeps proxy()'s thrown-Response
// behavior while the program reasons in tags.
export const toThrownResponse = (error: TransferError): Response => {
  switch (error._tag) {
    case "TransferForbidden": {
      // legacy transfer copy has no trailing period; the guard message does
      return new Response("Only public links are supported", { status: 403 });
    }

    case "TransferUnreachable": {
      return new Response("Upstream unreachable", { status: 502 });
    }

    case "TransferBadUpstream": {
      return new Response(`Upstream ${error.status}`, { status: 502 });
    }

    case "TransferTooLarge": {
      return tooLarge();
    }

    default: {
      const exhaustive: never = error;

      throw new Error(`Unhandled TransferError: ${JSON.stringify(exhaustive)}`);
    }
  }
};

// content-length is only a claim from upstream. Count the bytes that actually
// arrive so a chunked or under-reported body cannot exceed the cap.
const boundedBody = (
  body: ReadableStream<Uint8Array>,
  limit: number
): ReadableStream<Uint8Array> => {
  let seen = 0;

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;

        if (seen > limit) {
          // headers are already on the wire, so the client sees a truncated
          // download instead of a late 413; the length check above covers the
          // hosts that declare their size
          controller.error(new Error(TOO_LARGE_MESSAGE));

          return;
        }

        controller.enqueue(chunk);
      },
    })
  );
};

// A manifest is buffered to rewrite its refs, so it needs a small cap of its
// own: a playlist is text, and downloading the video's 1 GiB budget into memory
// would be a mistake.
const MANIFEST_MAX_BYTES = 8 * 1024 * 1024;

const readCappedText = async (
  body: ReadableStream<Uint8Array> | null,
  limit: number
): Promise<string> => {
  const { exceeded, text } = await readCappedUtf8(body, limit);

  if (exceeded) {
    throw tooLarge();
  }

  return text;
};

// A manifest points at its media relatively, and a saved playlist has no base
// url left to resolve them against, so the downloaded file would not play.
// Rewrite every reference absolute. `new URL` leaves absolute refs alone.
// `catch` keeps a reference that is not a url at all verbatim: the player fails
// that one file, rather than us failing the whole download.
const absolutize = (ref: string, base: string): string => {
  try {
    return new URL(ref, base).href;
  } catch {
    return ref;
  }
};

const absolutizeM3u8 = (body: string, base: string): string =>
  body
    .split("\n")
    .map((line) => {
      if (line.trim() === "") {
        return line;
      }

      // tags carry their own refs in URI="…" attributes (key, init map, renditions)
      const tagged = line.replaceAll(
        /URI="(?<ref>[^"]+)"/gu,
        (_match, ref: string) => `URI="${absolutize(ref, base)}"`
      );

      return tagged.startsWith("#") ? tagged : absolutize(tagged.trim(), base);
    })
    .join("\n");

// The DASH refs are BaseURL elements and the attributes that name media
// (byte ranges — indexRange, mediaRange — are numbers, not urls, so they are
// left alone). Median templates like `$Number$` survive `new URL` verbatim.
const absolutizeMpd = (body: string, base: string): string =>
  body
    .replaceAll(
      /<BaseURL>(?<ref>[^<]+)<\/BaseURL>/gu,
      (_match, ref: string) =>
        `<BaseURL>${absolutize(ref.trim(), base)}</BaseURL>`
    )
    .replaceAll(
      /(?<attr>\b(?:initialization|media|sourceURL|xlink:href)=")(?<ref>[^"]+)"/gu,
      (_match, attr: string, ref: string) => `${attr}${absolutize(ref, base)}"`
    );

const absolutizeManifest = (
  body: string,
  base: string,
  container: Container
): string =>
  container === "mpd" ? absolutizeMpd(body, base) : absolutizeM3u8(body, base);

interface TransferInput {
  readonly maxBytes?: number;
  readonly maxMs?: number;
  readonly range?: string | null;
  readonly stem: string;
  readonly videoUrl: string;
}

export const transferProgram = (
  input: TransferInput
): Effect.Effect<Response, TransferError, FetchDeps> =>
  Effect.gen(function* program() {
    const { stem, videoUrl } = input;
    const { doFetch, lookup } = yield* FetchDeps;

    const limit = input.maxBytes ?? MAX_DOWNLOAD_BYTES;
    const maxMs = input.maxMs ?? UPSTREAM_MAX_MS;
    const range = input.range ?? null;

    // a page can name an internal host as its video; the proxy must not fetch it.
    const addresses = yield* guardAddresses(videoUrl, lookup, {
      blocked: { _tag: "TransferForbidden" as const },
      unresolved: { _tag: "TransferForbidden" as const },
    });

    // fast-fail when headers stall; the overall bound accepts truncating a stalled stream
    const upstream = yield* Effect.tryPromise({
      catch: () => ({ _tag: "TransferUnreachable" as const }),
      try: () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const headers = new Headers({ "User-Agent": UA });

        // a seeking video asks for byte ranges; the upstream answers 206 and the
        // proxy passes that answer through instead of rebuffering the whole file
        if (range !== null) {
          headers.set("Range", range);
        }

        return pinnedFetch(doFetch, videoUrl, addresses, {
          headers,
          // the overall bound outlives this block: a trickling upstream must not hold the connection forever
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(maxMs),
          ]),
        }).finally(() => clearTimeout(timer));
      },
    });

    if (!upstream.ok || upstream.body === null) {
      return yield* Effect.fail({
        _tag: "TransferBadUpstream" as const,
        status: upstream.status,
      });
    }

    const { body } = upstream;

    const contentType = upstream.headers.get("content-type") ?? "video/mp4";

    // the container decides the download's extension: one rule, shared with the
    // preview, so the two can never disagree about what this file is
    const ext = containerOf(videoUrl, contentType);

    // the stem arrives from the query string — keep it out of the header grammar
    const safeName = stem.replaceAll(/[^\w.-]+/gu, "_");

    const base = {
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `attachment; filename="${safeName}.${ext}"`,
      "Content-Type": contentType,
    };

    const length = upstream.headers.get("content-length");

    if (length && Number(length) > limit) {
      yield* Effect.promise(() => body.cancel());

      return yield* Effect.fail({ _tag: "TransferTooLarge" as const });
    }

    // a 206 is a byte slice, not a file: stream it through untouched, naming nothing
    if (upstream.status === 206) {
      const rangeHeaders = new Headers({
        "Cache-Control": "private, max-age=60",
        "Content-Type": contentType,
      });

      for (const name of ["Accept-Ranges", "Content-Length", "Content-Range"]) {
        const value = upstream.headers.get(name);

        if (value) {
          rangeHeaders.set(name, value);
        }
      }

      return new Response(boundedBody(body, limit), {
        headers: rangeHeaders,
        status: 206,
      });
    }

    if (isManifestContainer(ext)) {
      const text = yield* Effect.tryPromise({
        // overflow answers 413; anything else that breaks mid-body is the
        // upstream failing, which must not claim the file was too large
        catch: (cause) =>
          cause instanceof Response
            ? { _tag: "TransferTooLarge" as const }
            : { _tag: "TransferUnreachable" as const },
        try: () => readCappedText(body, Math.min(MANIFEST_MAX_BYTES, limit)),
      });

      return new Response(absolutizeManifest(text, videoUrl, ext), {
        headers: base,
      });
    }

    const headers = length ? { ...base, "Content-Length": length } : base;

    // seeking works when the client knows ranges are served
    return new Response(boundedBody(body, limit), {
      headers: { ...headers, "Accept-Ranges": "bytes" },
    });
  });
