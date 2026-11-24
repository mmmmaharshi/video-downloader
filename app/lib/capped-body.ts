// Module: CappedBody — one bounded UTF-8 read for the two server fetch paths.
// The caller decides what overflow means: MediaResolver keeps the head, Transfer
// answers 413. Only the byte-accurate read is shared.

interface CappedRead {
  exceeded: boolean;
  text: string;
}

export const readCappedUtf8 = async (
  body: ReadableStream<Uint8Array> | null,
  cap: number
): Promise<CappedRead> => {
  if (!body) {
    return { exceeded: false, text: "" };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let read = 0;
  let exceeded = false;
  let finished = false;

  while (!(finished || exceeded)) {
    // eslint-disable-next-line no-await-in-loop -- the cap is checked between reads
    const chunk = await reader.read();

    finished = chunk.done;

    if (!chunk.done) {
      if (read >= cap) {
        // one more read after the cap proves whether the body had more bytes
        exceeded = true;
      } else {
        const remaining = cap - read;

        read += chunk.value.byteLength;
        // a single chunk can be larger than the budget — keep only what fits
        text += decoder.decode(chunk.value.subarray(0, remaining), {
          stream: true,
        });

        if (read > cap) {
          exceeded = true;
        }
      }
    }
  }

  await reader.cancel();

  return { exceeded, text };
};
