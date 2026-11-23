# ADR-0003: AFE on Cloudflare with Scandinavian UI

Status: accepted

## Context

The project evaluated rat-stack.sh, a reference stack by Joel Hooks. Rat-stack uses CAFE: Cloudflare, Alchemy, Foldkit, and Effect.

The project first chose Vercel with Alchemy, Foldkit, and Effect. That choice fails. Alchemy 2.0.0-beta.87 has no Vercel provider. No `@alchemy.run/vercel` package is published. The Alchemy repository has no Vercel package on `main`. The docs at `https://alchemy.run/providers/vercel/project` describe a provider that is not released. Only Cloudflare has a working Alchemy provider today.

The project also chose to drop HeroUI and React Router. Foldkit replaces them. The UI follows the `$scandinavian-design` skill: a near-black canvas, neutral alpha ink, restraint, and no decorative color.

## Decision

Adopt the full AFE stack on Cloudflare:

- **Effect 4.1.4** for typed failures, required services, and Layers.
- **Foldkit 0.170.0** for the UI. Model, Messages, update, view, and Commands.
- **Alchemy 2.0.0-beta.87** with `@alchemy.run/cloudflare` for declared infrastructure.
- **Cloudflare Workers** as the runtime.

Keep the deep modules and seams in `CONTEXT.md`. Port each module to Effect at its own seam. Replace Zod with Effect Schema. Replace TanStack Query with Foldkit Commands. Replace `bun:test` with Vitest.

Keep Bun as the package manager until a separate decision changes it.

## Consequences

ADR-0001 keeps two failure currencies: `Error` from MediaResolver and `Response` from Transfer. Effect gives both modules typed failures. Revisit ADR-0001 when each module moves to Effect. Do not unify the surfaces by hand.

PinnedFetch relies on `node:dns` and Bun's dial behavior. Cloudflare Workers has no `node:dns` and no raw sockets. The new guard uses DNS over HTTPS to resolve both A and AAAA records. It refuses private, loopback, link-local, and IPv4-mapped IPv6 answers. It runs the check on the first URL and on every redirect hop with `redirect: "manual"`. All byte caps and timeouts stay.

Workers cannot pin a connection to a validated IP for a host outside your Cloudflare zone. `cf.resolveOverride` works only for names in your own zone. A TTL-0 DNS rebind between the DoH check and the Worker's fetch stays open. Treat that as a documented residual risk, not a closed gap. The rationale is that Cloudflare edge egress does not route to RFC1918 space and exposes no fixed tenant metadata address. Record the risk in the guard's tests and in `CONTEXT.md` when the seam moves. Source: https://developers.cloudflare.com/workers/runtime-apis/request/

`AGENTS.md` still mandates HeroUI, the dark HeroUI token set, Geist Pixel Variable, and Vercel deploys. Update it before the first UI commit. Otherwise agents will restore the old stack.

Typeface choice stays open. Geist Pixel Variable is the current brand face. The Scandinavian skill defaults to Inter Variable for the web. Keep Geist Pixel unless a readability check argues against it.

Foldkit server rendering is experimental. Pin exact versions and test upgrades against a deployed stage.

## Sources

- https://ratstack.sh/llms.txt
- https://ratstack.sh/lore/cafe-stack
- https://ratstack.sh/pins.md
- https://alchemy.run/providers/vercel/project
- https://foldkit.dev/core/server-rendering
