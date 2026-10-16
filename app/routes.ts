import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/download", "routes/api.download.ts"),
  route("api/resolve", "routes/api.resolve.ts"),
  route(".well-known/appspecific/com.chrome.devtools.json", "routes/devtools-workspace.ts"),
] satisfies RouteConfig;
