# Agent Instructions

- Always respond to the user with `$simple-english` `$i-have-adhd`.
- Question the premise once, up front, when a simpler or sturdier path exists; then do what is chosen. Silence means the requested path is the best one found.
- Analyze thoroughly, then recommend one option with its evidence. Do not hand back menus, and do not hedge.
- Follow all guidelines defined in @CODING_STANDARDS.md for every code change, review, and architectural decision in this repository.
- Use Bun (https://bun.sh/llms.txt) as the runtime and package manager for this project.
- The stack is mid-migration to AFE on Cloudflare (see `docs/adr/0003-afe-on-cloudflare-with-scandinavian-ui.md`). Do not reintroduce the pieces ADR-0003 retires.

## Styling

- HeroUI is retired from routes: no HeroUI import remains (styles import removed with the old home). Do not reintroduce it.
- Home UI is Foldkit with the `$scandinavian-design` system: near-black canvas, neutral alpha ink, restraint, no decorative color. One primary action per view. Left-align text. It lives in `app/foldkit-home/` (Model, Messages, update, view, Commands); `app/client/entry.ts` boots it as the page application via `Runtime.run`.
- Keep the dark theme (`<html class="dark" data-theme="dark">` in `index.html`) and the Geist Pixel Variable typeface (`--font-sans` in `app/app.css`).
- Layout with standard Tailwind utilities only. No custom CSS beyond the tailwind import and the font token.

## Effect

- New server logic is an Effect 4 program with dependencies as a Layer and failures as a plain tagged union. Follow the `rumble-effect.ts` pattern: `FetchDeps` service, `Effect.provide` at the seam, `rumbleErrorMessage`-style mapper back to the legacy contract.
- Never change a seam's user-facing contract in the porting commit: `resolve()` still throws `Error`, `Transfer.proxy` still throws `Response` (ADR-0001). Error-currency changes are their own ADR.
- Test Effect code with `Effect.runPromise` / `Effect.flip` and injected Layers under `vitest`. Keep the legacy promise tests green as equivalence proof.

## Workflow

- Don't run the dev server. Verify with `bun run verify`.
- Make each change fully verifiable: prefer the real service and a real browser click-through over mocks and fixtures. If no check can fail, say so instead of faking verification.
- Run long-running processes in the foreground so they end with the session. Detach one only when the user asks for a process that outlives the session.
- Production is the Cloudflare Worker `video-downloader`, declared in `cloudflare.config.ts` and shipped with `bun run deploy` (which calls `npx cf deploy`). Do not add Alchemy or Vercel infrastructure.
- A push to `master` also deploys, through Cloudflare Workers Builds: build `bun run verify`, deploy `npx cf deploy` with `DOWNLOAD_SECRET` from the build variable of the same name. Keep `.dev.vars` equal to that value, or a local deploy and a CI deploy will sign with different keys.
- The Cloudflare deploy runs through the `cf` CLI (`npx cf deploy --secrets-file .dev.vars`), configured by `cloudflare.config.ts`. `cf` needs Node, never Bun. The `cf-cli`, `wrangler`, `frameworks-on-cloudflare`, `workers-best-practices`, and `workers-development` skills are installed — consult them before touching deploy config.
- Don't push without the user's permission. Commit locally; the user pushes.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `mmmmaharshi/video-downloader`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: the domain doc is `CONTEXT.md` at the root — glossary and seams — plus `docs/adr/`. There is no `GLOSSARY.md` (ADR 0002). See `docs/agents/domain.md`.

# Ultracite (oxlint + oxfmt)

- `bun run check` verifies lint + format; `bun run fix` repairs.
- Don't disable rules to make check pass. When a rule conflicts with real semantics, the exception is an inline disable with a stated reason: `// eslint-disable-next-line <rule> -- why`, or a config entry carrying the same reason.
- Every opt-in preset is on: `js-plugins` (github, sonarjs, react-doctor, TSDoc and JSDoc), `anti-slop`, `shadcn`, `gdp`, and `landmines`.
- Four config-level exceptions, each because the rule contradicts a documented repo rule:
  - `landmines-style/no-comments` — this repo comments the why the code cannot show.
  - `landmines-types/no-explicit-return-types` — Effect programs state their failure union at the call site.
  - `sonarjs/shorthand-property-grouping` — `sort-keys` orders keys alphabetically, so grouping the shorthand ones cannot also pass.
  - `sonarjs/no-undefined-assignment` — the wire contract marks absent fields `undefined` via `Schema.optional`; `null` is not in the type.
- Test files turn off `sonarjs/no-hardcoded-ip`, `landmines-testing/no-test-doubles`, and `landmines-testing/no-flake-masking`: fixtures address hosts by literal IP, and tests inject `FetchDeps` layers by design.
- `app/foldkit-home/main.ts` turns off `sonarjs/function-name`: Foldkit message tags are PascalCase.
- Keep oxlint's `--type-aware` off; doctor expects the stock setup otherwise.

## Editing these rules

- Before adding a rule here or in `CODING_STANDARDS.md`, check it does not already exist; merge into or modify the existing one instead.
- Use canonical engineering terms over explanatory jargon, and keep sentences short.
- Only add a rule that changes behavior on real work. Structure wording per https://raw.githubusercontent.com/mattpocock/skills/refs/heads/main/skills/productivity/writing-for-agents/SKILL.md.
