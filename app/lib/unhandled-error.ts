// Module: UnhandledError — one exhaustiveness guard for every platform's
// message mapper. The switch narrows the last argument to `never`, so adding a
// tag without a case fails to compile instead of silently returning undefined.

export const unhandledError = (platform: string, error: never): never => {
  throw new Error(`Unhandled ${platform}Error: ${JSON.stringify(error)}`);
};
