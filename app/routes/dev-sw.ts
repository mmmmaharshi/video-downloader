import type { LoaderFunctionArgs } from "react-router";

export function loader({}: LoaderFunctionArgs) {
  return new Response(`self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",()=>self.clients.claim());`, {
    headers: { "Content-Type": "application/javascript", "Cache-Control": "no-store" },
  });
}
