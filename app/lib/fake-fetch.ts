// Adapter: in-memory fixtures at the fetch seams (see CONTEXT.md — MediaResolver ↔ fetch, Transfer ↔ fetch)
export function stubFetch(responder: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => responder(String(input))) as unknown as typeof fetch;
}
