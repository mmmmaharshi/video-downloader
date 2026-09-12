import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/download", "routes/api.download.ts"),
  route("dev-sw.js", "routes/dev-sw.ts"),
] satisfies RouteConfig;
