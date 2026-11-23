// Module: PageBody — the one bounded read every platform resolver uses.
// A page carrying its data is small; a mislabelled binary is not, so the read
// stops at a shared budget instead of buffering whatever the host sends.

import { readCappedUtf8 } from "./capped-body";

// Head-read budget: one place decides how much of an upstream body is worth
// reading, so every resolver changes together if it ever needs to.
const PAGE_READ_BYTES = 512 * 1024;

export const readPageText = async (res: Response): Promise<string> => {
  const { text } = await readCappedUtf8(res.body, PAGE_READ_BYTES);

  return text;
};
