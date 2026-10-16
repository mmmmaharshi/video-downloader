// Chrome DevTools requests this well-known path when it looks for a workspace config.
// Matching it with a route stops React Router logging a "No route matches" stack trace
// for traffic the browser generates on its own. We publish no workspace, so it is a 404.
export function loader() {
  return new Response(null, { status: 404 });
}
