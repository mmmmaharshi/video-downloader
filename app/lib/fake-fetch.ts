// Adapter: in-memory fixtures at the fetch seams (see CONTEXT.md — MediaResolver ↔ fetch, Transfer ↔ fetch)

export const stubFetch = (
  responder: (url: string) => Response | Promise<Response>
): typeof fetch =>
  // Bun's typeof fetch requires preconnect; stubs never exercise it
  Object.assign(
    (input: RequestInfo | URL): Promise<Response> =>
      Promise.resolve(responder(String(input))),
    // the global fetch's real preconnect, unused by the resolver/transfer paths
    { preconnect: fetch.preconnect }
  );
