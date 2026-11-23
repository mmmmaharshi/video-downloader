// Module: Runtime — the one place that asks which JavaScript host is running.
// Workers has no raw sockets, so the transport differs there; every other
// branch stays identical. Keeping the question here means the answer changes
// in one file, not in every consumer.

export const runsOnWorkers = (): boolean => {
  try {
    return navigator.userAgent.includes("Cloudflare");
  } catch {
    return false;
  }
};
