// Module: FormBody — read a request body with a hard byte cap, whatever the
// client declares. `content-length` is a claim; a chunked body has none, so the
// cap is enforced while reading instead of before it.

export type BoundedBody =
  | { readonly body: ArrayBuffer; readonly ok: true }
  | { readonly ok: false; readonly reason: "too-large" };

export const readBounded = async (
  request: Request,
  max: number
): Promise<BoundedBody> => {
  const declared = Number(request.headers.get("content-length") ?? 0);

  // the cheap path: a declared size over the cap never gets read
  if (declared > max) {
    return { ok: false, reason: "too-large" };
  }

  if (request.body === null) {
    return { body: new ArrayBuffer(0), ok: true };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];

  let size = 0;

  let exceeded = false;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- bytes must be counted in order before the next read
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > max) {
      exceeded = true;
      break;
    }

    chunks.push(value);
  }

  if (exceeded) {
    await reader.cancel();

    return { ok: false, reason: "too-large" };
  }

  const body = new Uint8Array(size);

  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { body: body.buffer, ok: true };
};
