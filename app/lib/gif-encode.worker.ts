// Module: GifEncodeWorker — runs gifenc off the main thread.
// Bundled as a separate chunk when the route creates it with
// `new Worker(new URL(...))`. Never imported by tests or the server.

import { encodeFrames } from "./mp4-to-gif";
import type { GifFrame } from "./mp4-to-gif";

const isFrameList = (data: unknown): data is { frames: GifFrame[] } =>
  data instanceof Object && "frames" in data && Array.isArray(data.frames);

addEventListener("message", (event) => {
  const run = async (): Promise<void> => {
    try {
      if (!(event instanceof MessageEvent) || !isFrameList(event.data)) {
        throw new Error("bad gif worker message");
      }

      const bytes = await encodeFrames(event.data.frames);
      postMessage({ bytes }, { transfer: [bytes.buffer] });
    } catch {
      postMessage({ error: "encode failed" });
    }
  };

  run();
});
