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

  while (!exceeded) {
    // eslint-disable-next-line no-await-in-loop -- the cap is checked between reads
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    // one more read after the cap proves whether the body had more bytes
    if (read >= cap) {
      exceeded = true;
      break;
    }

    const remaining = cap - read;

    read += value.byteLength;
    // a single chunk can be larger than the budget — keep only what fits
    text += decoder.decode(value.subarray(0, remaining), { stream: true });

    if (read > cap) {
      exceeded = true;
    }
  }

  await reader.cancel();

  return { exceeded, text };
};
