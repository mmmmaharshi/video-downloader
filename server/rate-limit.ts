// Module: RateLimit — the burst cap for the one endpoint that reaches out to
// third parties. Cloudflare's native limiter binding does the counting when it
// is bound (production); local dev and tests fall back to module memory.

const LIMIT = 30;
const WINDOW_S = 60;

// the Workers rate-limiting binding's runtime shape
export interface RateLimiterBinding {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
}

const memory = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitDeps {
  // injected in tests so no wall clock is needed
  now?: () => number;
}

const bumpMemory = (key: string, now: number): boolean => {
  const entry = memory.get(key);

  if (entry === undefined || now >= entry.resetAt) {
    if (memory.size > 1000) {
      memory.clear();
    }

    memory.set(key, { count: 1, resetAt: now + WINDOW_S * 1000 });

    return false;
  }

  entry.count += 1;

  return entry.count > LIMIT;
};

// true when this key is over its budget for the current window
export const overLimit = async (
  key: string,
  limiter?: RateLimiterBinding,
  deps: RateLimitDeps = {}
): Promise<boolean> => {
  if (limiter !== undefined) {
    const verdict = await limiter.limit({ key });

    return !verdict.success;
  }

  return bumpMemory(key, (deps.now ?? Date.now)());
};
