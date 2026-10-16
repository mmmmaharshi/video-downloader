// Adapter: in-memory fixtures at the fetch seams (see CONTEXT.md — MediaResolver ↔ fetch, Transfer ↔ fetch)
export const stubFetch = (
  responder: (url: string) => Response | Promise<Response>
): typeof fetch =>
  ((input: RequestInfo | URL) =>
    Promise.resolve(responder(String(input)))) as unknown as typeof fetch;
